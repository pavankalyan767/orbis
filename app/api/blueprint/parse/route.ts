import { NextRequest, NextResponse } from 'next/server'
import { parseFloorPlanWithClaude } from '@/lib/blueprint/claudeParser'
import { validateFloorPlan } from '@/lib/blueprint/validator'
import { floorPlanToSVG } from '@/lib/blueprint/svgRenderer'

export const runtime = 'nodejs'
// Claude vision can take a while on large images
export const maxDuration = 120

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
type AllowedType = typeof ALLOWED_TYPES[number]

export async function POST(req: NextRequest) {
  // ── 1. Auth check ──────────────────────────────────────────────────────────
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured on the server.' },
      { status: 500 },
    )
  }

  // ── 2. Parse multipart body ────────────────────────────────────────────────
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Failed to parse request body.' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No file uploaded. Send "file" in form-data.' }, { status: 400 })
  }

  const mediaType = file.type as AllowedType
  if (!ALLOWED_TYPES.includes(mediaType)) {
    return NextResponse.json(
      { error: `Unsupported file type "${file.type}". Use JPEG, PNG, or WebP.` },
      { status: 400 },
    )
  }

  // Size guard: Claude base64-encodes so keep under ~5 MB original
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json(
      { error: 'Image too large. Maximum size is 5 MB.' },
      { status: 400 },
    )
  }

  // ── 3. Convert to base64 ──────────────────────────────────────────────────
  const arrayBuffer = await file.arrayBuffer()
  const imageBase64 = Buffer.from(arrayBuffer).toString('base64')

  // ── 4. Call Claude Vision ─────────────────────────────────────────────────
  let rawFloorPlan: unknown
  try {
    rawFloorPlan = await parseFloorPlanWithClaude(imageBase64, mediaType)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `Claude parsing failed: ${message}` },
      { status: 502 },
    )
  }

  // ── 5. Validate structure ─────────────────────────────────────────────────
  const validation = validateFloorPlan(rawFloorPlan)
  if (!validation.ok) {
    return NextResponse.json(
      { error: 'Claude returned an invalid FloorPlan structure.', details: validation.errors },
      { status: 422 },
    )
  }

  const { floorPlan } = validation

  // ── 6. Generate SVG ───────────────────────────────────────────────────────
  const svg = floorPlanToSVG(floorPlan)

  // ── 7. Build room image prompts (client will call /room-image per room) ───
  const roomPrompts = floorPlan.rooms.map((room) => ({
    roomId: room.id,
    roomName: room.name,
  }))

  return NextResponse.json({
    floorPlan,
    svg,
    roomPrompts,
    meta: {
      roomCount: floorPlan.rooms.length,
      wallCount: floorPlan.walls.length,
    },
  })
}
