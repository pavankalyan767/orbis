import { NextRequest, NextResponse } from 'next/server'
import { parseFloorPlanWithClaude } from '@/lib/blueprint/claudeParser'
import { parseFloorPlanWithGemini } from '@/lib/blueprint/geminiParser'
import { validateFloorPlan } from '@/lib/blueprint/validator'
import { floorPlanToSVG } from '@/lib/blueprint/svgRenderer'
import { applySpawnPlacement } from '@/lib/blueprint/spawnPlacement'

export const runtime = 'nodejs'
// Claude vision can take a while on large images
export const maxDuration = 120

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
type AllowedType = typeof ALLOWED_TYPES[number]

export async function POST(req: NextRequest) {
  const useGemini = process.env.GEMINI_USE === 'true'

  if (useGemini && !process.env.GOOGLE_API_KEY) {
    return NextResponse.json(
      { error: 'GOOGLE_API_KEY is not configured on the server.' },
      { status: 500 },
    )
  }

  if (!useGemini && !process.env.ANTHROPIC_API_KEY) {
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

  // ── 4. Call the vision model, with a real fallback ────────────────────────
  // GEMINI_USE picks the PREFERRED provider; if it fails and the other one is
  // configured, we fall through to it rather than hard-failing the request.
  type Provider = { name: string; run: () => Promise<unknown>; configured: boolean }

  const gemini: Provider = {
    name: 'Gemini',
    configured: Boolean(process.env.GOOGLE_API_KEY),
    run: () => parseFloorPlanWithGemini(imageBase64, mediaType),
  }
  const claude: Provider = {
    name: 'Claude',
    configured: Boolean(process.env.ANTHROPIC_API_KEY),
    run: () => parseFloorPlanWithClaude(imageBase64, mediaType),
  }

  const chain = (useGemini ? [gemini, claude] : [claude, gemini]).filter((p) => p.configured)

  let rawFloorPlan: unknown
  const failures: string[] = []
  for (const provider of chain) {
    try {
      rawFloorPlan = await provider.run()
      break
    } catch (err) {
      failures.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`)
      console.warn(`[blueprint/parse] ${provider.name} failed, trying next provider`, err)
    }
  }

  if (rawFloorPlan === undefined) {
    return NextResponse.json(
      { error: `Floor plan parsing failed. ${failures.join(' | ')}` },
      { status: 502 },
    )
  }

  // ── 5. Validate structure ─────────────────────────────────────────────────
  const validation = validateFloorPlan(rawFloorPlan)
  if (!validation.ok) {
    return NextResponse.json(
      {
        error: `${useGemini ? 'Gemini' : 'Claude'} returned an invalid FloorPlan structure.`,
        details: validation.errors,
      },
      { status: 422 },
    )
  }

  // ── 6. Anchor every spawn point to its room's entry doorway ───────────────
  // The prompt asks the model for this, but the model is unreliable about it.
  // This pass is the actual guarantee: each spawn lands ~1m inside the room in
  // front of its entry door, >=0.6m clear of every wall (below that the
  // CollisionEngine's 0.3m radius freezes the player, since it has no wall
  // sliding) and outside every exit rect (inside one, the ExitDetector fires a
  // spurious transition on the very first tick).
  const floorPlan = applySpawnPlacement(validation.floorPlan)

  // ── 7. Generate SVG ───────────────────────────────────────────────────────
  const svg = floorPlanToSVG(floorPlan)

  // ── 8. Build room image prompts ───────────────────────────────────────────
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
