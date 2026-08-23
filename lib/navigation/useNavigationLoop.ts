'use client'

import { useEffect, useRef, useState } from 'react'
import type { NavigationEngine } from '@/navigation/NavigationEngine'
import type { RoomTransition } from '@/navigation/types'

// ─── Tunables ─────────────────────────────────────────────────────────────────

/** Normal human walking pace, in metres per second. */
export const WALK_SPEED = 1.4

/**
 * Upper bound on a single frame's delta time.
 *
 * A backgrounded tab can hand us a multi-second dt on the first frame after it
 * regains focus.  CollisionEngine has no swept collision — it only tests the
 * candidate end point — so an unclamped dt would tunnel the player straight
 * through walls and across the map.
 */
const MAX_FRAME_DT = 0.1

/**
 * Hard fallback for un-freezing dead reckoning after a transition, in case the
 * caller's async world swap never reports back.
 */
const TRANSITION_FREEZE_MS = 1200

/** Position quantum (metres) below which we do not bother re-rendering React. */
const POSITION_QUANTUM = 0.25

/** Minimum gap between position-only re-renders (~10 Hz ceiling). */
const MIN_PUBLISH_INTERVAL_MS = 100

/**
 * Movement keys, in floor-plan space.  y grows DOWNWARD, so north/up is -y.
 *
 * Arrow keys are deliberately absent: they are camera rotation and belong to
 * the Reactor controls hook, not to translation.
 */
const MOVEMENT_KEYS: Record<string, { dx: number; dy: number }> = {
  KeyW: { dx: 0, dy: -1 },
  KeyS: { dx: 0, dy: 1 },
  KeyA: { dx: -1, dy: 0 },
  KeyD: { dx: 1, dy: 0 },
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type NavigationLoopState = {
  roomId: string
  x: number
  y: number
  pendingExit: { exitId: string; targetRoomId: string } | null
}

const EMPTY_STATE: NavigationLoopState = {
  roomId: '',
  x: 0,
  y: 0,
  pendingExit: null,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** True when the keystroke belongs to a text field rather than to the world. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

function readState(nav: NavigationEngine): NavigationLoopState {
  const { roomId, x, y } = nav.getState()
  return { roomId, x, y, pendingExit: nav.getPendingExit() }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useNavigationLoop — the missing game loop.
 *
 * Bridges *held* keyboard state to `NavigationEngine.update()` via a
 * requestAnimationFrame loop ("dead reckoning"): the player keeps walking for
 * as long as a key is down, and crossing a doorway automatically fires
 * `onTransition` so the caller can swap worlds.
 *
 * Manual override is preserved — this hook never blocks the room-switcher UI,
 * and it surfaces `pendingExit` so the caller can show a doorway hint.
 *
 * Deliberately installs its own listeners rather than reusing the Reactor
 * controls hook: the two subsystems must stay decoupled, and this one must NOT
 * call `preventDefault()` (Reactor's controls own that).
 *
 * @param nav          - The engine, or `null` before it has been constructed.
 * @param enabled      - When false, listeners and the rAF loop are torn down.
 * @param onTransition - Fired once per doorway crossing.  Dead reckoning is
 *                       frozen until the caller's async swap settles.
 */
export function useNavigationLoop(
  nav: NavigationEngine | null,
  enabled: boolean,
  onTransition: (t: RoomTransition) => void,
): NavigationLoopState {
  const [state, setState] = useState<NavigationLoopState>(EMPTY_STATE)

  const heldRef = useRef<Set<string>>(new Set())
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number | null>(null)

  // Freeze flags — set while an async world swap is in flight.
  const transitioningRef = useRef(false)
  const transitionTargetRef = useRef<string | null>(null)
  const freezeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Publish throttling.
  const publishedRef = useRef<NavigationLoopState>(EMPTY_STATE)
  const publishedAtRef = useRef(0)

  // Keep the latest callback without re-subscribing the loop every render.
  const onTransitionRef = useRef(onTransition)
  useEffect(() => {
    onTransitionRef.current = onTransition
  }, [onTransition])

  // ── Keyboard: held-key tracking ───────────────────────────────────────────
  useEffect(() => {
    const held = heldRef.current

    if (!enabled) {
      held.clear()
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      if (!(event.code in MOVEMENT_KEYS)) return
      // No preventDefault — the Reactor controls hook owns that.
      held.add(event.code)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      held.delete(event.code)
    }

    // Losing focus mid-stride would otherwise leave a key stuck down forever.
    const onBlur = () => held.clear()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      held.clear()
    }
  }, [enabled])

  // ── requestAnimationFrame loop ────────────────────────────────────────────
  useEffect(() => {
    if (!nav || !enabled) return

    let cancelled = false

    const clearFreeze = () => {
      transitioningRef.current = false
      transitionTargetRef.current = null
      if (freezeTimerRef.current !== null) {
        clearTimeout(freezeTimerRef.current)
        freezeTimerRef.current = null
      }
    }

    /** Re-render at most ~10 Hz, and only on a change that is actually visible. */
    const publish = (next: NavigationLoopState, now: number) => {
      const prev = publishedRef.current

      const roomChanged = prev.roomId !== next.roomId
      const exitChanged =
        (prev.pendingExit?.exitId ?? null) !== (next.pendingExit?.exitId ?? null)
      const moved =
        Math.round(prev.x / POSITION_QUANTUM) !== Math.round(next.x / POSITION_QUANTUM) ||
        Math.round(prev.y / POSITION_QUANTUM) !== Math.round(next.y / POSITION_QUANTUM)

      if (!roomChanged && !exitChanged && !moved) return
      // Room / doorway changes are latency-sensitive; position drift is not.
      if (!roomChanged && !exitChanged && now - publishedAtRef.current < MIN_PUBLISH_INTERVAL_MS) {
        return
      }

      publishedRef.current = next
      publishedAtRef.current = now
      setState(next)
    }

    const frame = (ts: number) => {
      if (cancelled) return

      const previousTs = lastTsRef.current
      lastTsRef.current = ts
      // Clamp: a backgrounded tab must not teleport the player through walls.
      const dt = previousTs === null ? 0 : Math.min((ts - previousTs) / 1000, MAX_FRAME_DT)

      // A world swap has settled once the caller has repositioned us out of the
      // shared doorway rect inside the destination room.
      if (
        transitioningRef.current &&
        nav.getState().roomId === transitionTargetRef.current &&
        nav.getPendingExit() === null
      ) {
        clearFreeze()
      }

      if (!transitioningRef.current && dt > 0) {
        let dx = 0
        let dy = 0
        for (const code of heldRef.current) {
          const vector = MOVEMENT_KEYS[code]
          if (!vector) continue
          dx += vector.dx
          dy += vector.dy
        }

        if (dx !== 0 || dy !== 0) {
          // Normalise so diagonals are not sqrt(2)x faster than cardinals.
          const magnitude = Math.hypot(dx, dy)
          const step = WALK_SPEED * dt
          dx = (dx / magnitude) * step
          dy = (dy / magnitude) * step

          const result = nav.update(dx, dy, 0) // yaw is Reactor's business

          if (result.transition) {
            const transition = result.transition
            transitioningRef.current = true
            transitionTargetRef.current = transition.toRoomId

            if (freezeTimerRef.current !== null) clearTimeout(freezeTimerRef.current)
            freezeTimerRef.current = setTimeout(clearFreeze, TRANSITION_FREEZE_MS)

            onTransitionRef.current(transition)
          }
        }
      }

      publish(readState(nav), ts)
      rafRef.current = requestAnimationFrame(frame)
    }

    // Seed the reported state immediately so consumers are never blank.
    publishedRef.current = readState(nav)
    publishedAtRef.current = 0
    setState(publishedRef.current)

    lastTsRef.current = null
    rafRef.current = requestAnimationFrame(frame)

    return () => {
      cancelled = true
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      lastTsRef.current = null
      clearFreeze()
    }
  }, [nav, enabled])

  return state
}
