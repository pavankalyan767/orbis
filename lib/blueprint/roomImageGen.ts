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
    `First-person perspective standing just inside the entrance doorway, looking directly into the center of the room.`,
    `The room's architecture expands outwards from the viewer, ${exitStr}.`,
    `Modern residential design, warm natural lighting from windows,`,
    `realistic materials, high detail, photorealistic render.`,
    `No people, no text, no watermarks.`,
    `Wide angle lens, sharp focus throughout the room.`,
  ].join(' ')
}

import { puter } from '@heyputer/puter.js';

export type RoomImageResult =
  | { ok: true;  roomId: string; dataUrl: string }
  | { ok: false; roomId: string; error: string }

/**
 * Generates a room image via Puter.js API (Client-side only)
 */
export async function generateRoomImage(
  room: Room,
  floorPlan: FloorPlan,
): Promise<RoomImageResult> {
  const prompt = buildRoomImagePrompt(room, floorPlan)

  try {
    // Puter returns an HTMLImageElement
    const imageElement = await puter.ai.txt2img(
      prompt + " (Please generate this in 16:9 landscape aspect ratio)",
      { model: "google/gemini-3-pro-image-preview" } // Using one of the supported free models
    );

    return { ok: true, roomId: room.id, dataUrl: imageElement.src }
  } catch (err) {
    return {
      ok: false,
      roomId: room.id,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
