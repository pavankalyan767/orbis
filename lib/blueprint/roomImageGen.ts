import type { Room, FloorPlan, Point } from '@/navigation/types'

// ─── Prompt Builder ───────────────────────────────────────────────────────────

/**
 * Builds a detailed text prompt for generating a realistic first-person
 * room image, grounded in the architectural geometry.
 */
export function buildRoomImagePrompt(room: Room, floorPlan: FloorPlan): string {
  // Estimate room dimensions from polygon bounding box
  const xs = room.polygon.map((p) => p.x)
  const ys = room.polygon.map((p) => p.y)
  const width  = (Math.max(...xs) - Math.min(...xs)).toFixed(1)
  const height = (Math.max(...ys) - Math.min(...ys)).toFixed(1)

  // Describe exit directions
  const exitDescriptions = room.exits.map((exit) => {
    const target = floorPlan.rooms.find((r) => r.id === exit.targetRoomId)
    return target ? `doorway to ${target.name}` : `doorway`
  })
  const exitStr = exitDescriptions.length
    ? `with ${exitDescriptions.join(' and ')}`
    : 'with no connecting doorways'

  return [
    `Architectural interior photograph of a ${room.name}.`,
    `Room dimensions approximately ${width} metres wide by ${height} metres deep.`,
    `First-person perspective from standing eye level, ${exitStr}.`,
    `Modern residential design, warm natural lighting from windows,`,
    `realistic materials, high detail, photorealistic render.`,
    `No people, no text, no watermarks.`,
    `Wide angle lens, sharp focus throughout the room.`,
  ].join(' ')
}

// ─── HuggingFace Inference ───────────────────────────────────────────────────

const HF_API_URL = 'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0'

export type RoomImageResult =
  | { ok: true;  roomId: string; dataUrl: string }
  | { ok: false; roomId: string; error: string }

/**
 * Generates a room image via HuggingFace Inference API.
 *
 * If HUGGINGFACE_API_KEY is set in env vars it will be used (higher rate limits).
 * If not, the request is sent without auth (free tier — may be slow or unavailable).
 */
export async function generateRoomImage(
  room: Room,
  floorPlan: FloorPlan,
  hfApiKey?: string,
): Promise<RoomImageResult> {
  const prompt = buildRoomImagePrompt(room, floorPlan)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'image/png',
  }
  if (hfApiKey) {
    headers['Authorization'] = `Bearer ${hfApiKey}`
  }

  try {
    const response = await fetch(HF_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          width: 1024,
          height: 576,
          num_inference_steps: 30,
          guidance_scale: 7.5,
        },
      }),
      // HuggingFace can be slow on cold starts — 90s timeout
      signal: AbortSignal.timeout(90_000),
    })

    if (!response.ok) {
      const body = await response.text()
      // Model loading (503) is normal — caller can retry
      return { ok: false, roomId: room.id, error: `HF ${response.status}: ${body.slice(0, 200)}` }
    }

    const blob = await response.blob()
    const arrayBuffer = await blob.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    const dataUrl = `data:image/png;base64,${base64}`

    return { ok: true, roomId: room.id, dataUrl }
  } catch (err) {
    return {
      ok: false,
      roomId: room.id,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
