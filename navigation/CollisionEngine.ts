import type { Wall, Point } from './types'
import type { PlayerState } from './PlayerState'

export type CollisionResult = {
  /** True when the candidate position does not intersect any wall. */
  allowed: boolean
  /** The resulting position.  Same as candidate if allowed, otherwise unchanged. */
  position: Point
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/**
 * Returns the shortest distance from point `p` to the line segment `(a, b)`.
 *
 * Uses the standard project-onto-segment approach:
 *   t = clamp( dot(ap, ab) / dot(ab, ab), 0, 1 )
 *   closest = a + t * ab
 */
function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const apx = p.x - a.x
  const apy = p.y - a.y

  const ab2 = abx * abx + aby * aby

  if (ab2 === 0) {
    // Degenerate segment — both endpoints are the same point
    const dx = p.x - a.x
    const dy = p.y - a.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2))
  const closestX = a.x + t * abx
  const closestY = a.y + t * aby

  const dx = p.x - closestX
  const dy = p.y - closestY
  return Math.sqrt(dx * dx + dy * dy)
}

// ─── CollisionEngine ─────────────────────────────────────────────────────────

/** Tolerance added to the radius to handle floating-point imprecision. */
const EPSILON = 1e-9

/**
 * CollisionEngine — determines whether a proposed movement is geometrically valid.
 *
 * Algorithm: player is modelled as a circle.  A move is blocked if the player's
 * circle would overlap any wall segment after the move.
 *
 * This is a pure 2-D, segment-vs-circle approach.  No external physics library is used.
 *
 * Responsibilities:
 *   - Check candidate position against wall segments.
 *   - Respect player radius.
 *   - Return allowed/blocked result with the resulting position.
 *
 * Does NOT:
 *   - Modify PlayerState.
 *   - Know about rooms, exits, or Reactor.
 */
export class CollisionEngine {
  private readonly walls: Wall[]

  constructor(walls: Wall[]) {
    this.walls = walls
  }

  /**
   * Tests whether the player can move by `(dx, dy)`.
   *
   * @param player - Current player state (position + radius).
   * @param dx     - Requested x displacement.
   * @param dy     - Requested y displacement.
   * @returns CollisionResult with `allowed` flag and resulting `position`.
   */
  tryMove(player: PlayerState, dx: number, dy: number): CollisionResult {
    const current = player.getPosition()
    const radius = player.getState().radius

    const candidate: Point = {
      x: current.x + dx,
      y: current.y + dy,
    }

    for (const wall of this.walls) {
      const distance = pointToSegmentDistance(candidate, wall.start, wall.end)
      if (distance <= radius + EPSILON) {
        // Circle would overlap this wall segment — movement is blocked
        return { allowed: false, position: { ...current } }
      }
    }

    return { allowed: true, position: candidate }
  }
}
