import type { Room, Rectangle, RoomTransition } from './types'
import type { Point } from './types'

export type ExitDetectionResult = {
  exited: true
  fromRoom: string
  toRoom: string
  exitId: string
} | null

// ─── Geometry helper ──────────────────────────────────────────────────────────

/** Returns true when `p` is strictly inside (or on the border of) the rectangle. */
function pointInRect(p: Point, r: Rectangle): boolean {
  return (
    p.x >= r.x &&
    p.x <= r.x + r.width &&
    p.y >= r.y &&
    p.y <= r.y + r.height
  )
}

// ─── ExitDetector ─────────────────────────────────────────────────────────────

/**
 * ExitDetector — detects when the player crosses a room exit.
 *
 * Key invariant: a transition is fired **once** per crossing.
 *
 * If the player lingers inside a doorway rectangle the event is NOT re-fired.
 * A fresh event is only produced when the player:
 *   1. Exits one doorway and re-enters it (from either side), OR
 *   2. Enters a different doorway.
 *
 * Implementation: tracks `activeExitId` — the exit the player is currently
 * standing inside.  When the player leaves that rectangle, `activeExitId` is
 * cleared.  A transition event is only emitted when the player *enters* a new
 * exit region (i.e. when they were NOT already inside it on the previous tick).
 *
 * Does NOT:
 *   - Modify PlayerState.
 *   - Know about Reactor.
 *   - Perform wall collision.
 */
export class ExitDetector {
  /**
   * ID of the exit the player is currently standing inside, or `null` if
   * they are in open room space.
   */
  private activeExitId: string | null = null

  /**
   * Check the player's position against all exits in the current room.
   *
   * @param position   - Current player (x, y).
   * @param currentRoom - The room the player is logically inside.
   * @returns A transition result, or `null` if no crossing occurred.
   */
  check(position: Point, currentRoom: Room): RoomTransition | null {
    // ── 1. Is the player inside any exit rectangle? ────────────────────────
    const occupied = currentRoom.exits.find((exit) =>
      pointInRect(position, exit.bounds),
    )

    if (!occupied) {
      // Player is not in any exit — clear the debounce tracker
      this.activeExitId = null
      return null
    }

    // ── 2. Are we already tracking this exit (player lingering)? ──────────
    if (this.activeExitId === occupied.id) {
      // Same exit as last tick — do NOT re-fire the transition
      return null
    }

    // ── 3. Player has entered a new exit region — fire transition ──────────
    this.activeExitId = occupied.id

    return {
      fromRoomId: currentRoom.id,
      toRoomId: occupied.targetRoomId,
      exitId: occupied.id,
    }
  }

  /** Resets the debounce state — useful when teleporting the player (e.g. on spawn). */
  reset(): void {
    this.activeExitId = null
  }

  /**
   * Suppresses re-triggering until the player physically leaves this exit's rect.
   *
   * This is the ping-pong fix.  Adjoining rooms own *mirrored* exits with
   * identical bounds (`living-hall` and `hall-living` share one rectangle), so
   * the instant a transition fires the player is standing inside the
   * destination room's reverse exit.  Without priming, the very next tick would
   * detect that reverse exit as "newly entered" and bounce the player straight
   * back (A → B → A → B …).
   *
   * Priming with the destination's reverse exit id makes `check()` treat it as
   * already-occupied, so nothing fires until the player genuinely steps out of
   * the doorway rectangle and back in again.
   *
   * @param exitId - The exit to treat as already occupied, or `null` to clear.
   */
  prime(exitId: string | null): void {
    this.activeExitId = exitId
  }
}
