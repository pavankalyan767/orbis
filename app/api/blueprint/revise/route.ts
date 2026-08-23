import { NextRequest, NextResponse } from 'next/server'
import { reviseFloorPlan, RevisionValidationError } from '@/lib/blueprint/feedbackRevision'
import { floorPlanToSVG } from '@/lib/blueprint/svgRenderer'
import type { FloorPlan } from '@/navigation/types'

export const runtime = 'nodejs'
// Re-deriving a whole floor plan from feedback can take a while
export const maxDuration = 120

export async function POST(req: NextRequest) {
  // ── 1. Server config ───────────────────────────────────────────────────────
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured on the server.' },
      { status: 500 },
    )
  }

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Failed to parse request body as JSON.' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'Body must be an object: { floorPlan, roomId, feedback }.' },
      { status: 400 },
    )
  }

  const { floorPlan, roomId, feedback } = body as {
    floorPlan?: unknown
    roomId?: unknown
    feedback?: unknown
  }

  // ── 3. Validate body shape ─────────────────────────────────────────────────
  if (
    !floorPlan ||
    typeof floorPlan !== 'object' ||
    Array.isArray(floorPlan) ||
    !Array.isArray((floorPlan as FloorPlan).rooms)
  ) {
    return NextResponse.json(
      { error: '"floorPlan" must be a FloorPlan object with a "rooms" array.' },
      { status: 400 },
    )
  }

  if (typeof roomId !== 'string' || roomId.trim().length === 0) {
    return NextResponse.json({ error: '"roomId" must be a non-empty string.' }, { status: 400 })
  }

  const plan = floorPlan as FloorPlan
  const room = plan.rooms.find((r) => r?.id === roomId)
  if (!room) {
    return NextResponse.json(
      {
        error: `Unknown roomId "${roomId}".`,
        details: [`Known room ids: ${plan.rooms.map((r) => r?.id).join(', ')}`],
      },
      { status: 400 },
    )
  }

  if (!Array.isArray(feedback)) {
    return NextResponse.json(
      { error: '"feedback" must be an array of natural-language strings.' },
      { status: 400 },
    )
  }

  const feedbackLines = feedback
    .filter((f): f is string => typeof f === 'string')
    .map((f) => f.trim())
    .filter(Boolean)

  if (feedbackLines.length === 0) {
    return NextResponse.json(
      { error: 'No feedback supplied — send at least one non-empty feedback line.' },
      { status: 400 },
    )
  }

  // ── 4. Revise via Claude (validation + integrity happen inside) ────────────
  let result
  try {
    result = await reviseFloorPlan({ floorPlan: plan, roomId, feedback: feedbackLines })
  } catch (err) {
    if (err instanceof RevisionValidationError || (err as Error)?.name === 'RevisionValidationError') {
      const validationErr = err as RevisionValidationError
      return NextResponse.json(
        {
          error: 'The revised floor plan failed validation.',
          details: validationErr.errors ?? [validationErr.message],
        },
        { status: 422 },
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Claude revision failed: ${message}` }, { status: 502 })
  }

  // ── 5. Render the revised plan (same shape as /api/blueprint/parse) ────────
  const svg = floorPlanToSVG(result.floorPlan)

  return NextResponse.json({
    floorPlan: result.floorPlan,
    svg,
    worldPrompt: result.worldPrompt,
    geometryChanges: result.geometryChanges,
    cosmeticNotes: result.cosmeticNotes,
  })
}
