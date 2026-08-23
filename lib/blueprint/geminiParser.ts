import type { FloorPlan } from '@/navigation/types'

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
      "spawnPoint": { "x": number, "y": number },       // position near entry/exit
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
- Place the spawn point just inside the room, in front of its primary connecting doorway. For rooms with only one door (where the exit itself acts as the entry), use that single door. The spawn point must be safely inside the room's walkable area (at least 0.5m away from the wall line) to avoid physics collision errors.
- Include ALL rooms visible in the image — do not skip small rooms like bathrooms or corridors.`

const USER_PROMPT = `Analyse this architectural floor plan image and return a FloorPlan JSON.
Be precise with room boundaries and wall positions.
Identify every doorway and represent it as both a wall gap and an exit rectangle.`

export async function parseFloorPlanWithGemini(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
): Promise<FloorPlan> {
  const googleApiKey = process.env.GOOGLE_API_KEY
  if (!googleApiKey) {
    throw new Error('GOOGLE_API_KEY is not configured on the server.')
  }

  const GOOGLE_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${googleApiKey}`

  const response = await fetch(GOOGLE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: SYSTEM_PROMPT + '\n\n' + USER_PROMPT },
            { inlineData: { mimeType: mediaType, data: imageBase64 } },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json"
      }
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini API returned an error (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

  // Strip any accidental markdown fences Gemini might add
  const cleaned = raw
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${cleaned.slice(0, 200)}`)
  }

  return parsed as FloorPlan
}
