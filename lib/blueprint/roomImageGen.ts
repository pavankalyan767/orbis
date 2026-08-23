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

// ─── Google Gemini Imagen Inference ─────────────────────────────────────────────

export type RoomImageResult =
  | { ok: true;  roomId: string; dataUrl: string }
  | { ok: false; roomId: string; error: string }

/**
 * Generates a room image via Google Gemini Imagen 3 API.
 */
export async function generateRoomImage(
  room: Room,
  floorPlan: FloorPlan,
  googleApiKey: string,
): Promise<RoomImageResult> {
  const prompt = buildRoomImagePrompt(room, floorPlan)

  const GOOGLE_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${googleApiKey}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  try {
    const response = await fetch(GOOGLE_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        instances: [
          {
            prompt: prompt
          }
        ],
        parameters: {
          sampleCount: 1,
          aspectRatio: "16:9" // Standardized to match Happy Oyster Reactor dimension ratio
        }
      }),
      signal: AbortSignal.timeout(45_000),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return { ok: false, roomId: room.id, error: `Google Imagen API failed (${response.status}): ${errorText.slice(0, 200)}` }
    }

    const data = await response.json()
    
    if (!data.predictions?.[0]?.bytesBase64Encoded) {
      return { ok: false, roomId: room.id, error: "No image returned by Google Imagen API" }
    }

    const dataUrl = `data:image/jpeg;base64,${data.predictions[0].bytesBase64Encoded}`

    return { ok: true, roomId: room.id, dataUrl }
  } catch (err) {
    return {
      ok: false,
      roomId: room.id,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
