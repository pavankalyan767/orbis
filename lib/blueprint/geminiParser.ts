import type { FloorPlan } from '@/navigation/types'
import { SYSTEM_PROMPT, USER_PROMPT } from './prompts'

export async function parseFloorPlanWithGemini(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
): Promise<FloorPlan> {
  const googleApiKey = process.env.GOOGLE_API_KEY
  if (!googleApiKey) {
    throw new Error('GOOGLE_API_KEY is not configured on the server.')
  }

  const GOOGLE_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent`

  const response = await fetch(GOOGLE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Header rather than ?key= so the secret stays out of proxy/access logs.
      'x-goog-api-key': googleApiKey,
    },
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
