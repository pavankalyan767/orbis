import Anthropic from '@anthropic-ai/sdk'
import type { FloorPlan } from '@/navigation/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are an expert architectural floor plan analyser.
Your job is to extract a precise, machine-readable JSON representation of a floor plan image.

Return ONLY valid JSON — no markdown fences, no explanation, no extra text.

The JSON must conform exactly to this TypeScript schema:

{
  "rooms": [
    {
      "id": "string (lowercase, no spaces, e.g. 'living', 'kitchen')",
      "name": "string (human readable, e.g. 'Living Room')",
      "polygon": [{ "x": number, "y": number }, ...],  // convex polygon vertices, CCW order
      "spawnPoint": { "x": number, "y": number },       // centre of the room
      "exits": [
        {
          "id": "string (e.g. 'living-kitchen')",
          "roomId": "string (owning room id)",
          "targetRoomId": "string (destination room id)",
          "bounds": { "x": number, "y": number, "width": number, "height": number }
        }
      ]
    }
  ],
  "walls": [
    {
      "id": "string",
      "start": { "x": number, "y": number },
      "end": { "x": number, "y": number },
      "thickness": 0.2
    }
  ]
}

COORDINATE RULES:
- Use METRES as the unit.
- Place the origin (0, 0) at the TOP-LEFT corner of the building footprint.
- Y increases DOWNWARD (floor-plan convention).
- Estimate real-world dimensions: a typical residential room is 3–6 m wide.
- If a scale bar is visible, use it. Otherwise estimate from typical room sizes.
- Walls must have gaps at doorways. Each gap should be 0.9–1.2 m wide.
- Exit "bounds" rectangles must cover the doorway gap (same width as the gap, ~1 m tall).
- Every exit must have a matching reverse exit in the neighbouring room (same bounds, swapped room IDs).
- Wall IDs must be unique. Use a descriptive scheme e.g. "w-north", "w-living-kitchen-top".
- Spawn points should be the centroid of the room polygon.
- Include ALL rooms visible in the image — do not skip small rooms like bathrooms or corridors.`

const USER_PROMPT = `Analyse this architectural floor plan image and return a FloorPlan JSON.
Be precise with room boundaries and wall positions.
Identify every doorway and represent it as both a wall gap and an exit rectangle.`

export async function parseFloorPlanWithClaude(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
): Promise<FloorPlan> {
  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: USER_PROMPT,
          },
        ],
      },
    ],
  })

  const raw = message.content.find((c) => c.type === 'text')?.text ?? ''

  // Strip any accidental markdown fences Claude might add
  const cleaned = raw
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Claude returned invalid JSON: ${cleaned.slice(0, 200)}`)
  }

  return parsed as FloorPlan
}
