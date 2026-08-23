import Anthropic from '@anthropic-ai/sdk'
import type { FloorPlan, Room } from '@/navigation/types'
import { validateFloorPlan } from './validator'

// ─── Public types ─────────────────────────────────────────────────────────────

export type RevisionRequest = {
  floorPlan: FloorPlan
  roomId: string
  /** Accumulated natural-language feedback lines for that one room. */
  feedback: string[]
}

export type RevisionResult = {
  /** Full revised plan — every room, not just the edited one. */
  floorPlan: FloorPlan
  /** Prompt to send to the Reactor world model for this room. */
  worldPrompt: string
  /** Human-readable list of geometry edits that were applied. */
  geometryChanges: string[]
  /** Feedback that was routed into the prompt instead of the geometry. */
  cosmeticNotes: string[]
}

/**
 * Thrown when the model's revision comes back structurally invalid or breaks an
 * invariant of the original plan. The API route maps this to a 422 and surfaces
 * `errors` to the client; every other failure is a 502 (model/transport).
 */
export class RevisionValidationError extends Error {
  readonly errors: string[]
  constructor(message: string, errors: string[]) {
    super(`${message}: ${errors.join('; ')}`)
    this.name = 'RevisionValidationError'
    this.errors = errors
  }
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

export const REVISION_SYSTEM_PROMPT = `You are an expert architect revising an existing machine-readable floor plan.

You receive:
  1. The CURRENT FloorPlan JSON for a whole dwelling.
  2. The id and name of ONE room the user is giving feedback on.
  3. A list of natural-language feedback lines the user wrote about that room.

Return ONLY valid JSON — no markdown fences, no commentary, no explanation before or after.

The response must match exactly this shape:

{
  "floorPlan": { ...the FULL revised FloorPlan, same schema as the input... },
  "worldPrompt": "string",
  "geometryChanges": ["string", ...],
  "cosmeticNotes": ["string", ...]
}

── CLASSIFY EVERY FEEDBACK LINE ──────────────────────────────────────────────
For each feedback line decide whether it is SPATIAL or COSMETIC.

SPATIAL — changes the architecture. Moving or resizing a wall, changing a room's
dimensions or shape, relocating/widening/narrowing a doorway, moving where the
occupant enters. Examples: "move the wall 3-4 feet away", "make the kitchen
bigger", "put the door on the other side", "shift the partition towards the
window".
  -> EDIT THE GEOMETRY in "floorPlan" and describe what you did in
     "geometryChanges" (one entry per applied edit, e.g.
     "Moved the living/kitchen wall 1.07 m east; widened living to 11.07 m").

COSMETIC — changes what things look like, not where they are. Colours, paint,
materials, finishes, flooring, furniture and its placement, appliances,
lighting, decor, mood, style. Examples: "change the colour of the wall",
"change the table placement", "warmer lighting", "wooden floor instead of tile".
  -> DO NOT TOUCH THE GEOMETRY. Fold the request into "worldPrompt" and record
     it verbatim-ish in "cosmeticNotes".

Furniture is NEVER geometry — the FloorPlan models architecture only. A request
to move a table, sofa or bed is COSMETIC and belongs in the prompt.
If a line is ambiguous, prefer COSMETIC — never invent structural edits.

── UNITS ─────────────────────────────────────────────────────────────────────
The FloorPlan is in METRES. Y grows DOWNWARD (top-left origin, floor-plan
convention). Users often speak in imperial units: CONVERT THEM.
  1 foot = 0.3048 m, 1 inch = 0.0254 m.
  A range means its midpoint: "3-4 feet" -> 3.5 ft -> 1.07 m.
Never emit millimetres, centimetres or feet. Every coordinate stays in metres
and every absolute coordinate must stay well under 1000.

── HARD INVARIANTS (a violation makes the whole response useless) ────────────
1. Preserve EVERY room id exactly. Ids are the app's primary keys — never
   rename, never add, never delete. The room count must be identical.
2. Preserve EVERY exit id exactly, on the same owning room, with the same
   "roomId" and "targetRoomId". Never add or delete exits.
3. Every "targetRoomId" must reference a room that exists.
4. Exit reciprocity: if room A has an exit to B, room B must still have an exit
   back to A, and the two must keep IDENTICAL bounds. When you move a doorway,
   move BOTH sides.
5. Every polygon keeps at least 3 vertices and stays a closed, sensible shape.
6. All coordinates are finite numbers. No null, no NaN, no strings.
7. Only the feedback may change the plan. Rooms nobody gave feedback on stay
   byte-identical unless they share a moved wall.

── MOVING A WALL CONSISTENTLY ────────────────────────────────────────────────
A wall is not one object — it is a set of dependent facts. When you move one,
move ALL of these together so the model stays watertight:
  a. the wall segment endpoints in "walls" (all segments along that wall,
     including the stubs either side of a doorway gap);
  b. the polygon vertices of BOTH rooms that share the wall — one room grows by
     exactly as much as the other shrinks;
  c. any exit "bounds" sitting on that wall, on BOTH sides of the doorway;
  d. the "spawnPoint" of every affected room, keeping it inside the new
     polygon, at least 0.6 m clear of every wall, and out of every doorway
     rectangle;
  e. the building's outer perimeter walls if the footprint itself changed.
Round coordinates to at most 2 decimal places.

── worldPrompt ───────────────────────────────────────────────────────────────
A SINGLE paragraph of plain text (no JSON, no bullet points) describing the
revised room for an image-to-world model:
  - photorealistic architectural interior, first-person point of view standing
    just inside the entrance doorway looking into the room;
  - state the revised dimensions in metres and mention the doorways and where
    they lead;
  - fold in EVERY cosmetic instruction the user gave (colours, materials,
    furniture placement, lighting, style) — this prompt is the only place that
    feedback survives;
  - end with: no people, no text, no watermarks.
Never mention JSON, coordinates, ids or the feedback process inside the prompt.`

// ─── Model call ───────────────────────────────────────────────────────────────

/**
 * Constructed lazily: `checkRevisionIntegrity` is pure and gets imported by the
 * unit tests, and building the client at module scope kicks off credential
 * resolution just for importing this file.
 */
let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return client
}

const MODEL = 'claude-opus-4-5'
// The revision echoes the ENTIRE plan back plus the prompt and change lists, so
// it needs more headroom than the one-shot parse (8192).
const MAX_TOKENS = 16000

function buildUserPrompt(req: RevisionRequest, room: Room): string {
  const lines = req.feedback
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f, i) => `${i + 1}. ${f}`)
    .join('\n')

  return `CURRENT FLOOR PLAN (JSON, metres):
${JSON.stringify(req.floorPlan, null, 2)}

ROOM UNDER REVISION: id="${room.id}", name="${room.name}"

USER FEEDBACK FOR THIS ROOM:
${lines}

Classify each feedback line as SPATIAL or COSMETIC, apply the spatial ones to
the geometry, fold the cosmetic ones into worldPrompt, and return the JSON
object described in the system prompt. Return the FULL floor plan — all
${req.floorPlan.rooms.length} rooms — not just the revised one.`
}

/** Fallback used when the model forgets to emit a worldPrompt. */
function fallbackWorldPrompt(room: Room, plan: FloorPlan, cosmeticNotes: string[]): string {
  const xs = room.polygon.map((p) => p.x)
  const ys = room.polygon.map((p) => p.y)
  const width = (Math.max(...xs) - Math.min(...xs)).toFixed(1)
  const depth = (Math.max(...ys) - Math.min(...ys)).toFixed(1)

  const doorways = room.exits
    .map((e) => plan.rooms.find((r) => r.id === e.targetRoomId)?.name)
    .filter((n): n is string => Boolean(n))

  const doorwayStr = doorways.length
    ? `Doorways lead to the ${doorways.join(' and the ')}.`
    : 'The room has no connecting doorways.'

  const cosmetic = cosmeticNotes.length ? ` ${cosmeticNotes.join(' ')}` : ''

  return [
    `Photorealistic architectural interior of a ${room.name}, approximately ${width} metres wide by ${depth} metres deep.`,
    `First-person perspective standing just inside the entrance doorway looking into the centre of the room.`,
    doorwayStr,
    `Modern residential design, realistic materials, warm natural daylight, wide angle lens, sharp focus.${cosmetic}`,
    `No people, no text, no watermarks.`,
  ].join(' ')
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
}

/**
 * Sends the current plan plus one room's feedback to Claude and returns the
 * revised plan together with the Reactor world prompt.
 *
 * Throws `RevisionValidationError` when the revision is structurally invalid or
 * breaks an invariant of the original; throws a plain `Error` when the model
 * call itself fails or returns non-JSON.
 */
export async function reviseFloorPlan(req: RevisionRequest): Promise<RevisionResult> {
  const room = req.floorPlan?.rooms?.find((r) => r.id === req.roomId)
  if (!room) {
    throw new Error(`Unknown roomId "${req.roomId}" — not present in the floor plan.`)
  }

  const feedback = (req.feedback ?? []).map((f) => String(f).trim()).filter(Boolean)
  if (feedback.length === 0) {
    throw new Error('No feedback supplied — nothing to revise.')
  }

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: REVISION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: buildUserPrompt({ ...req, feedback }, room),
      },
    ],
  })

  const raw = message.content.find((c) => c.type === 'text')?.text ?? ''

  // Strip any accidental markdown fences Claude might add
  const cleaned = raw
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim()

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    throw new Error(`Claude returned invalid JSON: ${cleaned.slice(0, 200)}`)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Claude returned a non-object revision payload.')
  }

  // ── Structural validation (shared with the parse route) ────────────────────
  const validation = validateFloorPlan(parsed.floorPlan)
  if (!validation.ok) {
    throw new RevisionValidationError('Revised floor plan is structurally invalid', validation.errors)
  }
  const revised = validation.floorPlan

  // ── Invariants relative to the original plan ───────────────────────────────
  const integrity = checkRevisionIntegrity(req.floorPlan, revised)
  if (!integrity.ok) {
    throw new RevisionValidationError('Revision broke the original plan', integrity.errors)
  }

  const cosmeticNotes = toStringArray(parsed.cosmeticNotes)
  const geometryChanges = toStringArray(parsed.geometryChanges)

  const revisedRoom = revised.rooms.find((r) => r.id === req.roomId) ?? room
  const worldPrompt =
    typeof parsed.worldPrompt === 'string' && parsed.worldPrompt.trim().length > 0
      ? parsed.worldPrompt.trim()
      : fallbackWorldPrompt(revisedRoom, revised, cosmeticNotes)

  return { floorPlan: revised, worldPrompt, geometryChanges, cosmeticNotes }
}

// ─── Integrity check (pure — no LLM, no I/O) ──────────────────────────────────

export type IntegrityResult = { ok: true } | { ok: false; errors: string[] }

/**
 * Metres. Anything beyond this is not a building — it is a unit-confusion bug
 * (the model emitted millimetres, or multiplied instead of dividing).
 */
const MAX_ABS_COORD = 1000

type Coord = { label: string; value: unknown }

function collectCoords(plan: FloorPlan): Coord[] {
  const out: Coord[] = []
  const rooms = Array.isArray(plan?.rooms) ? plan.rooms : []

  for (const room of rooms) {
    const rid = room?.id ?? '<unnamed room>'

    const polygon = Array.isArray(room?.polygon) ? room.polygon : []
    polygon.forEach((p, i) => {
      out.push({ label: `room "${rid}" polygon[${i}].x`, value: p?.x })
      out.push({ label: `room "${rid}" polygon[${i}].y`, value: p?.y })
    })

    out.push({ label: `room "${rid}" spawnPoint.x`, value: room?.spawnPoint?.x })
    out.push({ label: `room "${rid}" spawnPoint.y`, value: room?.spawnPoint?.y })

    const exits = Array.isArray(room?.exits) ? room.exits : []
    for (const exit of exits) {
      const eid = exit?.id ?? '<unnamed exit>'
      const b = exit?.bounds
      out.push({ label: `exit "${eid}" bounds.x`, value: b?.x })
      out.push({ label: `exit "${eid}" bounds.y`, value: b?.y })
      out.push({ label: `exit "${eid}" bounds.width`, value: b?.width })
      out.push({ label: `exit "${eid}" bounds.height`, value: b?.height })
    }
  }

  const walls = Array.isArray(plan?.walls) ? plan.walls : []
  for (const wall of walls) {
    const wid = wall?.id ?? '<unnamed wall>'
    out.push({ label: `wall "${wid}" start.x`, value: wall?.start?.x })
    out.push({ label: `wall "${wid}" start.y`, value: wall?.start?.y })
    out.push({ label: `wall "${wid}" end.x`, value: wall?.end?.x })
    out.push({ label: `wall "${wid}" end.y`, value: wall?.end?.y })
  }

  return out
}

/**
 * Pure structural diff between the plan we sent and the plan the model returned.
 *
 * Deliberately says nothing about WHERE things are — a revision is supposed to
 * move geometry — only about what must never change: the id graph, exit
 * reciprocity, and coordinates being real numbers at a human building scale.
 */
export function checkRevisionIntegrity(
  original: FloorPlan,
  revised: FloorPlan,
): IntegrityResult {
  const errors: string[] = []

  if (!revised || typeof revised !== 'object' || !Array.isArray(revised.rooms)) {
    return { ok: false, errors: ['Revised plan is missing a "rooms" array'] }
  }
  if (!original || typeof original !== 'object' || !Array.isArray(original.rooms)) {
    return { ok: false, errors: ['Original plan is missing a "rooms" array'] }
  }

  const originalRooms = original.rooms
  const revisedRooms = revised.rooms

  // ── 1. Room id set must be identical ───────────────────────────────────────
  const originalIds = new Set(originalRooms.map((r) => r?.id))
  const revisedIds = new Set<string>()

  for (const room of revisedRooms) {
    const id = room?.id
    if (typeof id !== 'string' || id.length === 0) {
      errors.push('Revised plan contains a room with no id')
      continue
    }
    if (revisedIds.has(id)) errors.push(`Room id "${id}" appears more than once in the revision`)
    revisedIds.add(id)
    if (!originalIds.has(id)) {
      errors.push(`Room "${id}" was added by the revision — rooms may never be added or renamed`)
    }
  }

  for (const id of originalIds) {
    if (typeof id === 'string' && !revisedIds.has(id)) {
      errors.push(`Room "${id}" is missing from the revision — rooms may never be deleted or renamed`)
    }
  }

  if (revisedRooms.length !== originalRooms.length) {
    errors.push(
      `Room count changed: original has ${originalRooms.length}, revision has ${revisedRooms.length}`,
    )
  }

  // ── 2. Exit id set per room must be identical ──────────────────────────────
  const revisedByIdName = new Map<string, (typeof revisedRooms)[number]>()
  for (const room of revisedRooms) {
    if (typeof room?.id === 'string' && !revisedByIdName.has(room.id)) {
      revisedByIdName.set(room.id, room)
    }
  }

  for (const originalRoom of originalRooms) {
    const rid = originalRoom?.id
    if (typeof rid !== 'string') continue
    const revisedRoom = revisedByIdName.get(rid)
    if (!revisedRoom) continue // already reported as deleted

    const originalExitIds = new Set(
      (Array.isArray(originalRoom.exits) ? originalRoom.exits : []).map((e) => e?.id),
    )
    const revisedExits = Array.isArray(revisedRoom.exits) ? revisedRoom.exits : []
    const revisedExitIds = new Set<string>()

    for (const exit of revisedExits) {
      const eid = exit?.id
      if (typeof eid !== 'string' || eid.length === 0) {
        errors.push(`Room "${rid}" contains an exit with no id`)
        continue
      }
      if (revisedExitIds.has(eid)) errors.push(`Room "${rid}": exit id "${eid}" is duplicated`)
      revisedExitIds.add(eid)
      if (!originalExitIds.has(eid)) {
        errors.push(`Room "${rid}": exit "${eid}" was added by the revision — exits may never be added or renamed`)
      }
      if (exit?.roomId !== rid) {
        errors.push(`Exit "${eid}" claims roomId "${String(exit?.roomId)}" but lives on room "${rid}"`)
      }
    }

    for (const eid of originalExitIds) {
      if (typeof eid === 'string' && !revisedExitIds.has(eid)) {
        errors.push(`Room "${rid}": exit "${eid}" is missing from the revision — exits may never be deleted or renamed`)
      }
    }
  }

  // ── 3./4. Exit targets resolve, and every exit is reciprocated ─────────────
  const exitsByRoom = new Map<string, string[]>() // roomId -> targetRoomIds
  for (const room of revisedRooms) {
    if (typeof room?.id !== 'string') continue
    const targets = (Array.isArray(room.exits) ? room.exits : [])
      .map((e) => e?.targetRoomId)
      .filter((t): t is string => typeof t === 'string')
    exitsByRoom.set(room.id, targets)
  }

  for (const room of revisedRooms) {
    const rid = room?.id
    if (typeof rid !== 'string') continue
    for (const exit of Array.isArray(room.exits) ? room.exits : []) {
      const eid = exit?.id ?? '<unnamed exit>'
      const target = exit?.targetRoomId
      if (typeof target !== 'string' || target.length === 0) {
        errors.push(`Exit "${eid}" in room "${rid}" has no targetRoomId`)
        continue
      }
      if (!revisedIds.has(target)) {
        errors.push(`Exit "${eid}" in room "${rid}" targets room "${target}", which does not exist`)
        continue
      }
      const back = exitsByRoom.get(target) ?? []
      if (!back.includes(rid)) {
        errors.push(
          `Exit "${eid}" leads from "${rid}" to "${target}", but "${target}" has no exit back to "${rid}" — reciprocity broken`,
        )
      }
    }
  }

  // ── 5. Polygons keep at least 3 vertices ───────────────────────────────────
  for (const room of revisedRooms) {
    const rid = room?.id ?? '<unnamed room>'
    const polygon = room?.polygon
    if (!Array.isArray(polygon) || polygon.length < 3) {
      errors.push(
        `Room "${rid}" polygon has ${Array.isArray(polygon) ? polygon.length : 0} vertices — a room needs at least 3`,
      )
    }
  }

  // ── 6./7. Coordinates are finite and at building scale ─────────────────────
  for (const { label, value } of collectCoords(revised)) {
    if (typeof value !== 'number') {
      errors.push(`${label} must be a number (got ${value === undefined ? 'undefined' : JSON.stringify(value)})`)
      continue
    }
    if (!Number.isFinite(value)) {
      errors.push(`${label} is not a finite number (got ${String(value)})`)
      continue
    }
    if (Math.abs(value) > MAX_ABS_COORD) {
      errors.push(
        `${label} = ${value} exceeds the ±${MAX_ABS_COORD} m sanity bound — the plan is in metres, check for a unit conversion bug`,
      )
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true }
}
