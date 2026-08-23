import type { FloorPlan, Room, Point, Exit, Rectangle, Wall } from '@/navigation/types'

/**
 * Doorway-anchored spawn placement.
 *
 * The vision models that produce a FloorPlan are unreliable about spawn points:
 * they routinely drop the player inside a wall or inside a doorway rectangle.
 * Both are fatal in this engine:
 *
 *   1. `navigation/CollisionEngine.ts` blocks a move when the distance from the
 *      candidate point to ANY wall segment is <= radius (0.3 m) + epsilon, and
 *      there is no wall sliding. A spawn closer than 0.3 m to a wall freezes the
 *      player permanently, in every direction.
 *   2. `navigation/ExitDetector.ts` starts with `activeExitId = null`, so a spawn
 *      inside an exit rectangle fires a spurious room transition on the first tick.
 *
 * This module therefore re-derives every spawn point deterministically after
 * parsing: pick the doorway the occupant would enter through, then step ~1 m
 * from that doorway towards the room's interior.
 *
 * All geometry is in METRES with y growing DOWNWARD.
 */

// ─── Tuning constants ─────────────────────────────────────────────────────────

/** Minimum clearance from every wall segment. Player radius is 0.3 m
 *  (navigation/PlayerState.ts), so 0.6 m leaves a full radius of slack. */
export const MIN_WALL_CLEARANCE = 0.6

/** Exit rectangles are inflated by this much before the "not in a doorway" test,
 *  so a spawn never sits flush against a trigger edge. */
const EXIT_MARGIN = 0.1

/** Distances (in metres) tried in order when stepping in from the doorway. */
const OFFSET_LADDER = [1.0, 1.25, 1.5, 1.75, 2.0]

/** Room ids / names that identify a circulation space — the room an occupant
 *  would normally enter *from*. */
const CIRCULATION_PATTERN = /hall|corridor|foyer|entry|entrance|lobby|passage/

const EPSILON = 1e-9

// ─── Geometry helpers ─────────────────────────────────────────────────────────
//
// `pointToSegmentDistance` intentionally mirrors the implementation in
// navigation/CollisionEngine.ts rather than importing it: that module owns the
// runtime collision contract and does not export the helper. Keeping a local
// copy means this file can never drag engine internals into the parser bundle.

/** Shortest distance from `p` to the line segment `(a, b)`. */
function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const apx = p.x - a.x
  const apy = p.y - a.y

  const ab2 = abx * abx + aby * aby

  if (ab2 === 0) {
    // Degenerate segment — both endpoints are the same point
    return Math.hypot(apx, apy)
  }

  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2))
  const closestX = a.x + t * abx
  const closestY = a.y + t * aby

  return Math.hypot(p.x - closestX, p.y - closestY)
}

/** Shortest distance from `p` to the nearest wall segment, or Infinity when
 *  there are no walls. */
export function distanceToNearestWall(p: Point, walls: Wall[]): number {
  let min = Infinity
  for (const wall of walls) {
    const d = pointToSegmentDistance(p, wall.start, wall.end)
    if (d < min) min = d
  }
  return min
}

/**
 * Even-odd ray-cast point-in-polygon test.
 *
 * Casts a ray along +x and counts edge crossings. Points exactly on an edge are
 * not treated specially — that is fine here because every candidate is required
 * to clear the walls by 0.6 m anyway.
 */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false

  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    const straddles = a.y > p.y !== b.y > p.y
    if (!straddles) continue
    const xCrossing = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    if (p.x < xCrossing) inside = !inside
  }
  return inside
}

/**
 * Area-weighted polygon centroid, falling back to the vertex mean for
 * degenerate (zero-area) polygons.
 */
export function polygonCentroid(polygon: Point[]): Point {
  if (polygon.length === 0) return { x: 0, y: 0 }
  if (polygon.length < 3) return vertexMean(polygon)

  let area2 = 0
  let cx = 0
  let cy = 0

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    const cross = a.x * b.y - b.x * a.y
    area2 += cross
    cx += (a.x + b.x) * cross
    cy += (a.y + b.y) * cross
  }

  if (Math.abs(area2) < EPSILON) return vertexMean(polygon)

  const factor = 1 / (3 * area2)
  const centroid = { x: cx * factor, y: cy * factor }

  if (!Number.isFinite(centroid.x) || !Number.isFinite(centroid.y)) {
    return vertexMean(polygon)
  }
  return centroid
}

function vertexMean(polygon: Point[]): Point {
  let x = 0
  let y = 0
  for (const p of polygon) {
    x += p.x
    y += p.y
  }
  return { x: x / polygon.length, y: y / polygon.length }
}

/** Centre of an axis-aligned rectangle. */
function rectCentre(r: Rectangle): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}

/** Whether `p` lies inside `r` after inflating it by `margin` on every side. */
function pointInInflatedRect(p: Point, r: Rectangle, margin: number): boolean {
  return (
    p.x >= r.x - margin &&
    p.x <= r.x + r.width + margin &&
    p.y >= r.y - margin &&
    p.y <= r.y + r.height + margin
  )
}

/** Lowercase, alphanumeric-with-dashes form used for circulation matching. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isCirculationRoom(room: Room | undefined): boolean {
  if (!room) return false
  return (
    CIRCULATION_PATTERN.test(slugify(room.id)) ||
    CIRCULATION_PATTERN.test(slugify(room.name ?? ''))
  )
}

// ─── Entry-exit selection ─────────────────────────────────────────────────────

/**
 * Picks the exit that acts as the room's entry.
 *
 * The data model has no entry/exit distinction — every doorway is a symmetric
 * pair of `Exit` records with identical bounds — so "entry" is a heuristic:
 *
 *   1. Exactly one exit  → that exit (it is both the way in and the way out).
 *   2. Otherwise, the exit whose TARGET room is a circulation space
 *      (hall / corridor / foyer / entry / entrance / lobby / passage).
 *   3. Otherwise, the exit whose target room has the most exits — the
 *      most-connected neighbour is the circulation hub.
 *   4. Ties in (2) and (3) are broken by ascending `exit.id`, so the result is
 *      stable across runs.
 *
 * @returns the chosen exit, or `null` when the room has no exits.
 */
export function chooseEntryExit(room: Room, floorPlan: FloorPlan): Exit | null {
  const exits = Array.isArray(room.exits) ? room.exits : []
  if (exits.length === 0) return null
  if (exits.length === 1) return exits[0]

  // Deterministic ordering — every later scan keeps the first (lowest-id) winner.
  const ordered = [...exits].sort((a, b) => compareIds(a.id, b.id))

  const roomsById = new Map<string, Room>()
  for (const r of floorPlan.rooms ?? []) roomsById.set(r.id, r)

  // 2. Prefer a doorway onto a circulation space.
  for (const exit of ordered) {
    if (isCirculationRoom(roomsById.get(exit.targetRoomId))) return exit
  }

  // 3. Fall back to the most-connected neighbour.
  let best = ordered[0]
  let bestScore = neighbourExitCount(roomsById.get(best.targetRoomId))
  for (let i = 1; i < ordered.length; i++) {
    const score = neighbourExitCount(roomsById.get(ordered[i].targetRoomId))
    if (score > bestScore) {
      best = ordered[i]
      bestScore = score
    }
  }
  return best
}

function neighbourExitCount(room: Room | undefined): number {
  // Unknown target rooms rank below every real room so dangling references
  // never win the tie-break.
  if (!room) return -1
  return Array.isArray(room.exits) ? room.exits.length : 0
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// ─── Spawn point computation ──────────────────────────────────────────────────

/**
 * Computes a safe spawn point just inside `room`, in front of `exit`'s doorway.
 *
 * Walks outward from the doorway centre towards the room centroid, trying
 * 1.0 → 2.0 m, and returns the first candidate that is simultaneously:
 *   - inside the room polygon,
 *   - at least `MIN_WALL_CLEARANCE` from every wall in the plan, and
 *   - outside every exit rectangle of the room (inflated by 0.1 m).
 *
 * Never throws: if no offset qualifies it returns the polygon centroid, valid
 * or not, because a centroid is still a far better guess than the model's.
 */
export function computeSpawnPoint(room: Room, exit: Exit, floorPlan: FloorPlan): Point {
  const centroid = polygonCentroid(room.polygon ?? [])
  if (!exit || !exit.bounds) return centroid

  const doorway = rectCentre(exit.bounds)

  // Direction from the doorway into the room's interior.
  const dx = centroid.x - doorway.x
  const dy = centroid.y - doorway.y
  const length = Math.hypot(dx, dy)

  // Doorway centre coincides with the centroid — no meaningful inward
  // direction, so the centroid is the best available answer.
  if (!(length > EPSILON)) return centroid

  const dirX = dx / length
  const dirY = dy / length

  for (const offset of OFFSET_LADDER) {
    const candidate: Point = {
      x: doorway.x + dirX * offset,
      y: doorway.y + dirY * offset,
    }
    if (isValidSpawn(candidate, room, floorPlan)) return candidate
  }

  return centroid
}

/** Whether `p` satisfies every spawn safety constraint for `room`. */
export function isValidSpawn(p: Point, room: Room, floorPlan: FloorPlan): boolean {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false
  if (!pointInPolygon(p, room.polygon ?? [])) return false
  if (distanceToNearestWall(p, floorPlan.walls ?? []) < MIN_WALL_CLEARANCE) return false

  for (const exit of room.exits ?? []) {
    if (exit?.bounds && pointInInflatedRect(p, exit.bounds, EXIT_MARGIN)) return false
  }
  return true
}

/**
 * Rewrites every room's `spawnPoint` using the doorway-anchored heuristic.
 *
 * Pure: the input plan and all of its rooms are left untouched; a new FloorPlan
 * with new Room objects is returned. Walls and exits are carried over by
 * reference — nothing in this module mutates them.
 */
export function applySpawnPlacement(floorPlan: FloorPlan): FloorPlan {
  const rooms = floorPlan.rooms ?? []

  return {
    ...floorPlan,
    rooms: rooms.map((room) => {
      const entryExit = chooseEntryExit(room, floorPlan)
      const spawnPoint = entryExit
        ? computeSpawnPoint(room, entryExit, floorPlan)
        : polygonCentroid(room.polygon ?? [])

      return { ...room, spawnPoint }
    }),
    walls: floorPlan.walls ?? [],
  }
}
