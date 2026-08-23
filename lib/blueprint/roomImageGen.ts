import type { Room, FloorPlan } from '@/navigation/types'
import { resolveLocalRoomImage } from './localRoomImages'

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
    `First-person perspective standing just inside the entrance doorway, looking directly into the center of the room.`,
    `The room's architecture expands outwards from the viewer, ${exitStr}.`,
    `Modern residential design, warm natural lighting from windows,`,
    `realistic materials, high detail, photorealistic render.`,
    `No people, no text, no watermarks.`,
    `Wide angle lens, sharp focus throughout the room.`,
  ].join(' ')
}

/** Flip to true to use Puter's txt2img instead of the local images in public/rooms/. */
export const USE_PUTER_IMAGE_GEN: boolean = true

export type RoomImageResult =
  | { ok: true;  roomId: string; dataUrl: string }
  | { ok: false; roomId: string; error: string }

/**
 * Resolves an image for a room.
 *
 * By default this serves a static file from `public/rooms/` (same origin, so it
 * will not taint the canvas downstream). Set `USE_PUTER_IMAGE_GEN` to true to
 * generate one via Puter.js instead — that module is imported dynamically so
 * the Puter bundle is never loaded while the toggle is off.
 */
export async function generateRoomImage(
  room: Room,
  floorPlan: FloorPlan,
): Promise<RoomImageResult> {
  if (!USE_PUTER_IMAGE_GEN) {
    const localPath = resolveLocalRoomImage(room.id, room.name)

    if (localPath) {
      return { ok: true, roomId: room.id, dataUrl: localPath }
    }

    return {
      ok: false,
      roomId: room.id,
      error: `No local image for "${room.name}" — add a file to public/rooms/ or enable USE_PUTER_IMAGE_GEN`,
    }
  }

  const prompt = buildRoomImagePrompt(room, floorPlan)

  try {
    // Dynamic import keeps Puter out of the bundle while the toggle is off.
    const { puter } = await import('@heyputer/puter.js')

    // txt2img(prompt, options) resolves to an HTMLImageElement whose src is a
    // same-origin blob: URL (the driver uses responseType 'blob'), so the 16:9
    // canvas crop downstream will not be tainted.
    const imageElement = await puter.ai.txt2img(
      prompt + ' (Please generate this in 16:9 landscape aspect ratio)',
      { model: 'google/gemini-3-pro-image-preview' },
    )

    if (!imageElement?.src) throw new Error('Puter returned an image with no src')

    return { ok: true, roomId: room.id, dataUrl: imageElement.src }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Demo safety net: Puter can fail for reasons outside our control — an
    // auth popup the user dismissed, an unavailable model, a rate limit. Rather
    // than leaving the room with no image at all (which blocks world
    // generation entirely), fall back to the bundled art if we have some.
    const localPath = resolveLocalRoomImage(room.id, room.name)
    if (localPath) {
      console.warn(`[roomImageGen] Puter failed for "${room.name}" (${message}) — using ${localPath}`)
      return { ok: true, roomId: room.id, dataUrl: localPath }
    }

    return { ok: false, roomId: room.id, error: `Puter image generation failed: ${message}` }
  }
}
