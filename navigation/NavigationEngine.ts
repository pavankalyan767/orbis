import type { FloorPlan, PlayerStateData, RoomTransition, MoveResult } from './types'
import { PlayerState } from './PlayerState'
import { RoomGraph } from './RoomGraph'
import { CollisionEngine } from './CollisionEngine'
import { ExitDetector } from './ExitDetector'

type RoomTransitionCallback = (transition: RoomTransition) => void

/**
 * NavigationEngine — the single public entry-point for the navigation subsystem.
 *
 * Orchestrates the full movement pipeline on each tick:
 *
 *   keyboard dx/dy
 *       ↓
 *   CollisionEngine.tryMove()
 *       ↓
 *   if allowed → PlayerState.setPosition()
 *       ↓
 *   ExitDetector.check()
 *       ↓
 *   if transition → fire RoomTransition callback + update PlayerState.roomId
 *
 * Usage:
 * ```ts
 * import { NavigationEngine } from '@/navigation/NavigationEngine'
 * import { mockFloorPlan }    from '@/navigation/mockFloorPlan'
 *
 * const nav = new NavigationEngine(mockFloorPlan, 'living', 5, 3)
 *
 * nav.onRoomTransition(({ fromRoomId, toRoomId, exitId }) => {
 *   // Prem: connect this to the Reactor world-switcher
 * })
 *
 * // Called once per game-loop tick (e.g. from a requestAnimationFrame handler)
 * nav.update(dx, dy, deltaYaw)
 * ```
 *
 * This class is Reactor-free.  It has no knowledge of WebRTC, Happy Oyster,
 * LLMs, or any external API.
 */
export class NavigationEngine {
  private readonly graph: RoomGraph
  private readonly collision: CollisionEngine
  private readonly exitDetector: ExitDetector
  private readonly player: PlayerState
  private readonly callbacks: RoomTransitionCallback[] = []

  constructor(
    floorPlan: FloorPlan,
    startRoomId: string,
    startX: number,
    startY: number,
    startYaw = 0,
  ) {
    this.graph = new RoomGraph(floorPlan)
    this.collision = new CollisionEngine(floorPlan.walls)
    this.exitDetector = new ExitDetector()
    this.player = new PlayerState(startRoomId, startX, startY, startYaw)
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Registers a callback that will be called whenever the player crosses a
   * room exit.  Multiple listeners can be registered; they are all called in
   * registration order.
   *
   * The callback is intentionally fire-and-forget — the navigation engine
   * does not wait for the callback to complete.
   */
  onRoomTransition(callback: RoomTransitionCallback): void {
    this.callbacks.push(callback)
  }

  /**
   * Advances the navigation state by one tick.
   *
   * @param dx       - Requested x displacement (metres per tick).
   * @param dy       - Requested y displacement (metres per tick).
   * @param deltaYaw - Requested yaw change (radians per tick).  May be 0.
   * @returns A MoveResult with the outcome of the movement, including any
   *          RoomTransition that was triggered.
   */
  update(dx: number, dy: number, deltaYaw = 0): MoveResult {
    // ── 1. Apply rotation unconditionally ─────────────────────────────────
    if (deltaYaw !== 0) {
      this.player.rotate(deltaYaw)
    }

    // ── 2. Attempt the translation ─────────────────────────────────────────
    const collisionResult = this.collision.tryMove(this.player, dx, dy)

    if (!collisionResult.allowed) {
      return {
        allowed: false,
        position: collisionResult.position,
        transition: null,
      }
    }

    // Move is clear — commit the new position
    this.player.setPosition(collisionResult.position.x, collisionResult.position.y)

    // ── 3. Exit detection ─────────────────────────────────────────────────
    const currentRoom = this.graph.getRoom(this.player.getRoomId())
    if (!currentRoom) {
      // Should never happen with a valid FloorPlan, but guard defensively
      return { allowed: true, position: collisionResult.position, transition: null }
    }

    const transition = this.exitDetector.check(
      this.player.getPosition(),
      currentRoom,
    )

    if (transition) {
      // Transition confirmed — update the player's logical room
      this.player.setRoom(transition.toRoomId)
      // Reset the exit debounce so the player can cross back later
      this.exitDetector.reset()

      // Notify all listeners
      for (const cb of this.callbacks) {
        cb(transition)
      }

      return { allowed: true, position: collisionResult.position, transition }
    }

    return { allowed: true, position: collisionResult.position, transition: null }
  }

  /**
   * Returns the current player state snapshot.
   * Safe to read on every render frame.
   */
  getState(): Readonly<PlayerStateData> {
    return this.player.getState()
  }

  /**
   * Returns the RoomGraph for external introspection (e.g. minimap rendering).
   * Read-only — do not mutate.
   */
  getGraph(): RoomGraph {
    return this.graph
  }
}
