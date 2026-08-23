import Anthropic from '@anthropic-ai/sdk'
import type { FloorPlan } from '@/navigation/types'
import { SYSTEM_PROMPT, USER_PROMPT } from './prompts'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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
