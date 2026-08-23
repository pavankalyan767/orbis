"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FloorPlan, Room } from '@/navigation/types'

export type NarrationStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'done'
  | 'error'
  | 'unavailable'

export type NarrationState = {
  status: NarrationStatus
  script: string | null
  error: string | null
}

export type UseRoomNarrationOptions = {
  room: Room | null
  floorPlan: FloorPlan | null
  feedback?: string[]
  /** Flip true the moment the player spawns into this room's world. */
  active: boolean
  /** Master mute. Defaults to true. */
  enabled?: boolean
}

export type UseRoomNarrationResult = NarrationState & {
  replay: () => void
  stop: () => void
}

const AUTOPLAY_BLOCKED_MESSAGE =
  'Narration is ready but your browser blocked autoplay. Click to play it.'

const IDLE: NarrationState = { status: 'idle', script: null, error: null }

const isBrowser = () => typeof window !== 'undefined'

/**
 * Plays a one-off realtor-style narration when the player spawns into a room.
 *
 * Fires EXACTLY ONCE per room id per session. Narration is strictly optional:
 * a missing server key, a network blip, or a blocked autoplay must never throw
 * or block entering the world.
 */
export function useRoomNarration(
  opts: UseRoomNarrationOptions,
): UseRoomNarrationResult {
  const { room, floorPlan, feedback, active, enabled = true } = opts

  const [state, setState] = useState<NarrationState>(IDLE)

  // Rooms already narrated this session. Written to BEFORE the first await so
  // a re-render or a StrictMode double-invoked effect cannot double-fire.
  const narratedRef = useRef<Set<string>>(new Set())
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const inFlightRef = useRef<{ roomId: string; controller: AbortController } | null>(null)
  const mountedRef = useRef(true)

  // Kept in a ref so a fresh array literal from the parent never re-triggers
  // the spawn effect.
  const feedbackRef = useRef<string[] | undefined>(feedback)
  feedbackRef.current = feedback

  const safeSetState = useCallback((next: NarrationState) => {
    if (mountedRef.current) setState(next)
  }, [])

  const revokeUrl = useCallback(() => {
    if (objectUrlRef.current && isBrowser()) {
      try {
        URL.revokeObjectURL(objectUrlRef.current)
      } catch {
        /* nothing meaningful to do */
      }
    }
    objectUrlRef.current = null
  }, [])

  const stop = useCallback(() => {
    const audio = audioRef.current
    if (audio) {
      try {
        audio.pause()
        audio.currentTime = 0
      } catch {
        /* nothing meaningful to do */
      }
    }
    revokeUrl()
  }, [revokeUrl])

  /** Wires up an <audio> element for the freshly fetched blob and plays it. */
  const playBlob = useCallback(
    (blob: Blob, script: string | null) => {
      if (!isBrowser() || typeof Audio === 'undefined') return

      revokeUrl()
      const url = URL.createObjectURL(blob)
      objectUrlRef.current = url

      let audio = audioRef.current
      if (!audio) {
        audio = new Audio()
        audioRef.current = audio
      }

      audio.onended = () => {
        revokeUrl()
        if (mountedRef.current) {
          setState((prev) => ({ ...prev, status: 'done', error: null }))
        }
      }
      audio.onerror = () => {
        revokeUrl()
        if (mountedRef.current) {
          setState((prev) => ({
            ...prev,
            status: 'error',
            error: 'Narration audio could not be played.',
          }))
        }
      }

      audio.src = url

      // play() rejects under the browser autoplay policy when there has been
      // no user gesture. That is a normal outcome, not a crash — surface it as
      // an error state so the UI can offer a replay button.
      const attempt = audio.play()
      if (attempt && typeof attempt.then === 'function') {
        attempt
          .then(() => safeSetState({ status: 'playing', script, error: null }))
          .catch(() =>
            safeSetState({ status: 'error', script, error: AUTOPLAY_BLOCKED_MESSAGE }),
          )
      } else {
        safeSetState({ status: 'playing', script, error: null })
      }
    },
    [revokeUrl, safeSetState],
  )

  /** Fetch + play. Never rejects — every failure lands in state. */
  const runNarration = useCallback(
    async (targetRoom: Room, plan: FloorPlan) => {
      if (!isBrowser()) return

      const controller = new AbortController()
      inFlightRef.current = { roomId: targetRoom.id, controller }
      safeSetState({ status: 'loading', script: null, error: null })

      try {
        const res = await fetch('/api/narrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room: targetRoom,
            floorPlan: plan,
            feedback: feedbackRef.current,
          }),
          signal: controller.signal,
        })

        // Server has no Fish Audio key — soft skip, one info log, no noise.
        if (res.status === 503) {
          console.info('[narration] disabled on the server; skipping room narration.')
          safeSetState({ status: 'unavailable', script: null, error: null })
          return
        }

        if (!res.ok) {
          let detail = `${res.status} ${res.statusText}`
          try {
            const body = await res.json()
            if (body && typeof body.error === 'string') detail = body.error
          } catch {
            /* non-JSON error body — keep the status line */
          }
          safeSetState({ status: 'error', script: null, error: detail })
          return
        }

        let script: string | null = null
        const encoded = res.headers.get('X-Narration-Script')
        if (encoded) {
          try {
            script = decodeURIComponent(encoded)
          } catch {
            script = encoded
          }
        }

        const blob = await res.blob()
        if (!mountedRef.current || controller.signal.aborted) return

        playBlob(blob, script)
      } catch (err) {
        // Aborts are deliberate (left the room / unmounted) — stay silent.
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError') return

        const message = err instanceof Error ? err.message : String(err)
        safeSetState({ status: 'error', script: null, error: message })
      } finally {
        if (inFlightRef.current?.controller === controller) {
          inFlightRef.current = null
        }
      }
    },
    [playBlob, safeSetState],
  )

  // ── Spawn trigger ─────────────────────────────────────────────────────────
  const roomId = room?.id ?? null

  useEffect(() => {
    if (!isBrowser()) return

    // Not in this world (or muted): cancel anything still in flight.
    if (!enabled || !active || !room || !floorPlan) {
      const inFlight = inFlightRef.current
      if (inFlight) {
        inFlight.controller.abort()
        inFlightRef.current = null
      }
      return
    }

    if (narratedRef.current.has(room.id)) return

    // Claim the room synchronously, BEFORE any await.
    narratedRef.current.add(room.id)

    // Defensive: a rejection must never escape into React's error path.
    void runNarration(room, floorPlan).catch(() => {
      /* runNarration already funnels failures into state */
    })
    // `feedback` is intentionally read through a ref — see feedbackRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, enabled, roomId, floorPlan, room, runNarration])

  // ── Unmount ───────────────────────────────────────────────────────────────
  // Declared after the spawn effect so, under React StrictMode's simulated
  // remount, this cleanup runs before the spawn effect's setup re-runs. We
  // release the room claim on abort so the re-run can legitimately retry.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false

      const inFlight = inFlightRef.current
      if (inFlight) {
        narratedRef.current.delete(inFlight.roomId)
        inFlight.controller.abort()
        inFlightRef.current = null
      }

      const audio = audioRef.current
      if (audio) {
        try {
          audio.pause()
          audio.onended = null
          audio.onerror = null
          audio.src = ''
        } catch {
          /* nothing meaningful to do */
        }
      }

      if (objectUrlRef.current) {
        try {
          URL.revokeObjectURL(objectUrlRef.current)
        } catch {
          /* nothing meaningful to do */
        }
        objectUrlRef.current = null
      }
    }
  }, [])

  // ── Replay ────────────────────────────────────────────────────────────────
  // Primary use: the autoplay policy blocked the first play(). The blob URL is
  // still alive in that case, so this is a plain re-play under a user gesture.
  // If the clip was already released, re-fetch it.
  const replay = useCallback(() => {
    if (!isBrowser()) return

    const audio = audioRef.current
    if (audio && objectUrlRef.current) {
      try {
        audio.currentTime = 0
      } catch {
        /* some browsers throw before metadata loads */
      }
      const attempt = audio.play()
      if (attempt && typeof attempt.then === 'function') {
        attempt
          .then(() => setState((prev) => ({ ...prev, status: 'playing', error: null })))
          .catch(() =>
            setState((prev) => ({ ...prev, status: 'error', error: AUTOPLAY_BLOCKED_MESSAGE })),
          )
      } else {
        setState((prev) => ({ ...prev, status: 'playing', error: null }))
      }
      return
    }

    if (!room || !floorPlan || !enabled) return
    narratedRef.current.add(room.id)
    void runNarration(room, floorPlan).catch(() => {
      /* handled in state */
    })
  }, [room, floorPlan, enabled, runNarration])

  return { ...state, replay, stop }
}
