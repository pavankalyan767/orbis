import { NextRequest, NextResponse } from 'next/server'
import type { FloorPlan, Room } from '@/navigation/types'
import {
  isNarrationConfigured,
  synthesizeSpeech,
  writeRoomScript,
} from '@/lib/narration/fishAudio'

export const runtime = 'nodejs'
// Claude script + Fish Audio synthesis, back to back.
export const maxDuration = 60

type NarrateBody = {
  room: Room
  floorPlan: FloorPlan
  feedback?: string[]
}

function isPoint(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return typeof p.x === 'number' && typeof p.y === 'number'
}

/** Light structural check — enough to avoid crashing downstream. */
function validate(body: unknown): { ok: true; value: NarrateBody } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Body must be a JSON object.' }
  }
  const { room, floorPlan, feedback } = body as Record<string, unknown>

  if (typeof room !== 'object' || room === null) {
    return { ok: false, error: 'Missing "room".' }
  }
  const r = room as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.name !== 'string') {
    return { ok: false, error: '"room" needs a string "id" and "name".' }
  }
  if (!Array.isArray(r.polygon) || !r.polygon.every(isPoint)) {
    return { ok: false, error: '"room.polygon" must be an array of {x,y} points.' }
  }
  if (!Array.isArray(r.exits)) {
    return { ok: false, error: '"room.exits" must be an array.' }
  }

  if (typeof floorPlan !== 'object' || floorPlan === null) {
    return { ok: false, error: 'Missing "floorPlan".' }
  }
  if (!Array.isArray((floorPlan as Record<string, unknown>).rooms)) {
    return { ok: false, error: '"floorPlan.rooms" must be an array.' }
  }

  if (feedback !== undefined) {
    if (!Array.isArray(feedback) || !feedback.every((f) => typeof f === 'string')) {
      return { ok: false, error: '"feedback" must be an array of strings.' }
    }
  }

  return { ok: true, value: { room: room as Room, floorPlan: floorPlan as FloorPlan, feedback: feedback as string[] | undefined } }
}

export async function POST(req: NextRequest) {
  // ── 1. Narration is OPTIONAL. 503 tells the client to soft-skip. ───────────
  if (!isNarrationConfigured()) {
    return NextResponse.json(
      {
        error: 'FISH_AUDIO_API_KEY is not configured on the server. Narration is disabled.',
        configured: false,
      },
      { status: 503 },
    )
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error: 'ANTHROPIC_API_KEY is not configured on the server. Narration is disabled.',
        configured: false,
      },
      { status: 503 },
    )
  }

  // ── 2. Parse + validate ───────────────────────────────────────────────────
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Failed to parse JSON body.' }, { status: 400 })
  }

  const parsed = validate(raw)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const { room, floorPlan, feedback } = parsed.value

  // ── 3. Claude writes the realtor script ───────────────────────────────────
  let script: string
  try {
    script = await writeRoomScript(room, floorPlan, feedback)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Script generation failed: ${message}` }, { status: 502 })
  }

  // ── 4. Fish Audio speaks it ───────────────────────────────────────────────
  let audio: ArrayBuffer
  let contentType: string
  try {
    ;({ audio, contentType } = await synthesizeSpeech(script))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Speech synthesis failed: ${message}` }, { status: 502 })
  }

  // ── 5. Raw bytes back, so the client can URL.createObjectURL() a Blob ─────
  return new NextResponse(audio, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(audio.byteLength),
      // URI-encoded so newlines / non-ASCII stay header-safe.
      'X-Narration-Script': encodeURIComponent(script),
      // Let the browser reuse the clip if the same room is requested again.
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
