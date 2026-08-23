/**
 * Realtor-style room narration: Claude writes the script, Fish Audio speaks it.
 *
 * ── SERVER ONLY ──────────────────────────────────────────────────────────────
 * This module reads FISH_AUDIO_API_KEY / ANTHROPIC_API_KEY. Never import it
 * from a client component — go through /api/narrate instead.
 *
 * ── Fish Audio HTTP contract ─────────────────────────────────────────────────
 * Verified 2026-08-23 against
 *   https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
 *   https://docs.fish.audio/developer-guide/core-features/text-to-speech
 *
 *   POST https://api.fish.audio/v1/tts
 *   Authorization: Bearer <FISH_AUDIO_API_KEY>
 *   Content-Type: application/json
 *   model: s1 | s2-pro | s2.1-pro | s2.1-pro-free      (OPTIONAL header;
 *                                                       server default s2.1-pro)
 *   body: {
 *     text:         string   (required)
 *     reference_id: string   (optional — a voice-model id from the Fish Audio
 *                             voice library. Omitted => provider default voice.
 *                             The docs publish no default/public voice id.)
 *     format:       "mp3" | "wav" | "pcm" | "opus"     (default "mp3")
 *     mp3_bitrate:  64 | 128 | 192                     (default 128)
 *     normalize:    boolean                            (default true)
 *     latency:      "low" | "normal" | "balanced"      (default "normal")
 *     chunk_length: 100..300                           (default 300)
 *   }
 *   200 => raw audio BYTES, chunked transfer encoding (not JSON, not base64).
 *          mp3 comes back as audio/mpeg.
 *   401 / 402 / 503 => JSON { status, message, reason }.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { Room, FloorPlan } from '@/navigation/types'

// ─── Config ───────────────────────────────────────────────────────────────────

export const FISH_AUDIO_TTS_URL = 'https://api.fish.audio/v1/tts'

/** Hard ceiling the script writer is held to. Keeps narration ~15-20 seconds. */
export const MAX_SCRIPT_WORDS = 60

/** Fish Audio TTS is optional — the world must load fine without it. */
export function isNarrationConfigured(): boolean {
  return Boolean(process.env.FISH_AUDIO_API_KEY)
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

export const NARRATION_SYSTEM_PROMPT = [
  'You are a warm, confident estate agent walking a prospective buyer through a home.',
  'You are handed a factual brief about one room. Write what you would say out loud',
  'the moment the buyer steps into that room.',
  '',
  'Hard constraints, all of them mandatory:',
  '- Two to three sentences. MAXIMUM 60 words in total.',
  '- Spoken plain prose only. This text is fed straight into a text-to-speech engine.',
  '- No markdown, no headings, no bullet points, no quotation marks around the whole line.',
  '- No stage directions, no parentheticals, no emoji, no emotes, no "Narrator:" labels.',
  '- Name the room exactly as it is given in the brief.',
  '- Mention at least one connecting room by name so the listener knows where they can go next.',
  '- Work the dimensions in naturally, the way an agent speaks ("a generous ten by six metres"),',
  '  never as a specification dump.',
  '- If the brief lists notes or feedback, weave at most one of them in; do not list them.',
  '- Never invent furniture, fittings, views, prices or history that the brief does not state.',
  '',
  'Reply with the spoken line and nothing else.',
].join('\n')

// ─── Brief builder (pure) ─────────────────────────────────────────────────────

/**
 * Builds the factual brief the script writer works from.
 *
 * Dimensions come from the axis-aligned bounding box of the room polygon
 * (metres, y grows down => the y span is depth). Pure: no I/O, no clock,
 * no randomness — same input always yields the same string.
 */
export function buildRoomBrief(
  room: Room,
  floorPlan: FloorPlan,
  feedback?: string[],
): string {
  const points = Array.isArray(room.polygon) ? room.polygon : []
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)

  const hasGeometry = xs.length > 0 && ys.length > 0
  const width = hasGeometry ? Math.max(...xs) - Math.min(...xs) : 0
  const depth = hasGeometry ? Math.max(...ys) - Math.min(...ys) : 0

  const lines: string[] = []
  lines.push(`Room name: ${room.name}`)

  if (hasGeometry) {
    lines.push(
      `Approximate size: ${width.toFixed(1)} metres wide by ${depth.toFixed(1)} metres deep.`,
    )
    lines.push(`Approximate floor area: ${(width * depth).toFixed(1)} square metres.`)
  } else {
    lines.push('Approximate size: not recorded for this room.')
  }

  // Resolve each exit to the *name* of the room it leads into, de-duplicated
  // and in exit order so the output stays deterministic.
  const exits = Array.isArray(room.exits) ? room.exits : []
  const connecting: string[] = []
  for (const exit of exits) {
    const target = floorPlan.rooms.find((r) => r.id === exit.targetRoomId)
    const name = target?.name ?? exit.targetRoomId
    if (name && !connecting.includes(name)) connecting.push(name)
  }

  lines.push(
    connecting.length > 0
      ? `Connecting rooms, reachable through doorways from here: ${connecting.join(', ')}.`
      : 'Connecting rooms: none. This room has no doorways on the plan, so it is a self-contained space.',
  )

  const notes = (feedback ?? []).map((f) => f.trim()).filter((f) => f.length > 0)
  if (notes.length > 0) {
    lines.push('Notes about this room:')
    for (const note of notes) lines.push(`- ${note}`)
  }

  return lines.join('\n')
}

// ─── Script writer ────────────────────────────────────────────────────────────

let anthropic: Anthropic | null = null

/** Lazy so that importing this module (e.g. in tests) never needs an API key. */
function getAnthropic(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return anthropic
}

/** Strips anything the TTS engine would read out loud as noise. */
function cleanScript(raw: string): string {
  let text = raw
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/[*_#`>]/g, '')          // markdown emphasis / headings / quotes
    .replace(/^\s*[-•]\s+/gm, '')     // bullet markers
    .replace(/\([^)]*\)/g, ' ')       // parentheticals / stage directions
    .replace(/\[[^\]]*\]/g, ' ')      // bracketed directions
    .replace(/\s+/g, ' ')
    .trim()

  // Belt and braces: enforce the word cap even if the model overshoots, by
  // dropping whole trailing sentences rather than cutting mid-word.
  if (text.split(' ').filter(Boolean).length > MAX_SCRIPT_WORDS) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text]
    const kept: string[] = []
    let words = 0
    for (const sentence of sentences) {
      const n = sentence.trim().split(/\s+/).filter(Boolean).length
      if (kept.length > 0 && words + n > MAX_SCRIPT_WORDS) break
      kept.push(sentence.trim())
      words += n
    }
    text = kept.join(' ').trim()
  }

  return text
}

/** Claude writes the realtor script for this room. */
export async function writeRoomScript(
  room: Room,
  floorPlan: FloorPlan,
  feedback?: string[],
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server.')
  }

  const message = await getAnthropic().messages.create({
    model: 'claude-opus-5',
    max_tokens: 2048,
    // Short, low-stakes copywriting — no need to spend thinking tokens, and
    // narration sits on the spawn path where latency is visible.
    output_config: { effort: 'low' },
    system: NARRATION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `${buildRoomBrief(room, floorPlan, feedback)}\n\nWrite the spoken line now.`,
      },
    ],
  })

  if (message.stop_reason === 'refusal') {
    throw new Error('Claude declined to write a narration script for this room.')
  }

  const raw = message.content.find((c) => c.type === 'text')?.text ?? ''
  const script = cleanScript(raw)

  if (!script) {
    throw new Error('Claude returned an empty narration script.')
  }
  return script
}

// ─── Fish Audio TTS ───────────────────────────────────────────────────────────

/**
 * Speaks `text` through Fish Audio and returns the raw audio plus the
 * content type the caller should serve it with.
 *
 * FISH_AUDIO_VOICE_ID is optional — when unset we omit `reference_id` entirely
 * and Fish Audio falls back to its own default voice.
 */
export async function synthesizeSpeech(
  text: string,
): Promise<{ audio: ArrayBuffer; contentType: string }> {
  const apiKey = process.env.FISH_AUDIO_API_KEY
  if (!apiKey) {
    throw new Error('FISH_AUDIO_API_KEY is not configured on the server.')
  }

  const voiceId = process.env.FISH_AUDIO_VOICE_ID?.trim()
  const model = process.env.FISH_AUDIO_MODEL?.trim()

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  // Optional per the docs; omitted => Fish Audio's own default (s2.1-pro).
  if (model) headers['model'] = model

  const body: Record<string, unknown> = {
    text,
    format: 'mp3',
    mp3_bitrate: 128,
    normalize: true,
    latency: 'normal',
  }
  if (voiceId) body.reference_id = voiceId

  let res: Response
  try {
    res = await fetch(FISH_AUDIO_TTS_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`Fish Audio request failed: ${detail}`)
  }

  if (!res.ok) {
    // Errors come back as JSON { status, message, reason }.
    const detail = await res.text().catch(() => '')
    throw new Error(
      `Fish Audio returned ${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
    )
  }

  const audio = await res.arrayBuffer()
  if (audio.byteLength === 0) {
    throw new Error('Fish Audio returned an empty audio stream.')
  }

  // Fish Audio streams the bytes back; trust its header, fall back to the
  // content type implied by the format we asked for.
  const contentType = res.headers.get('content-type') ?? 'audio/mpeg'

  return { audio, contentType }
}
