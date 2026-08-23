import type { Exit, FloorPlan, PlayerStateData, RoomTransition, MoveResult } from './types'
import { PlayerState } from './PlayerState'
import { RoomGraph } from './RoomGraph'
import { CollisionEngine } from './CollisionEngine'
import { ExitDetector } from './ExitDetector'

export type RoomTransitionCallback = (transition: RoomTransition) => void

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

      // ── Ping-pong guard ─────────────────────────────────────────────────
      // The player is still physically standing inside the shared doorway
      // rectangle, and the destination room owns a mirrored exit with the
      // *same* bounds pointing back at the room we just left.  A plain
      // `reset()` here would let that reverse exit fire on the very next tick
      // and bounce us back (A → B → A → B …).  Instead we prime the detector
      // with the reverse exit so it is treated as already-occupied until the
      // player genuinely walks out of the doorway.
      //
      // NOTE: we deliberately do NOT teleport the player to the destination
      // spawn point here — the caller owns that decision because the Reactor
      // world switch is async.  See `respawnIn()`.
      const destination = this.graph.getRoom(transition.toRoomId)
      const reverseExit = destination?.exits.find(
        (e) => e.targetRoomId === transition.fromRoomId,
      )
      this.exitDetector.prime(reverseExit ? reverseExit.id : null)

      // Notify all listeners
      for (const cb of this.callbacks) {
        cb(transition)
      }

      return { allowed: true, position: collisionResult.position, transition }
    }

    return { allowed: true, position: collisionResult.position, transition: null }
  }

  /**
   * Teleports the player to a room's spawn point and clears the exit debounce.
   *
   * This is what a caller invokes once the (async) world switch triggered by a
   * RoomTransition has completed: the logical room has already been updated by
   * `update()`, but the player is still standing in the doorway rectangle.
   * Dropping them on the destination's spawn point puts geometry and logic back
   * in agreement.
   *
   * @param roomId - The room to respawn in.
   * @returns `false` when the room id is unknown (nothing is changed).
   */
  respawnIn(roomId: string): boolean {
    const room = this.graph.getRoom(roomId)
    if (!room) return false

    this.player.setRoom(roomId)
    this.player.setPosition(room.spawnPoint.x, room.spawnPoint.y)

    // Spawn points are guaranteed to sit outside every exit rectangle, so a
    // full reset is correct here — the next doorway entry should fire.
    this.exitDetector.reset()

    return true
  }

  /**
   * Teleports the player to an explicit position within a room.
   *
   * Unlike `respawnIn()` the target position is arbitrary, so it may land
   * inside a doorway rectangle.  The exit detector is therefore primed against
   * whatever exit the destination position occupies (or cleared when it is open
   * floor), which prevents a spurious transition on the very next tick.
   *
   * @param roomId - The room the player is logically in after the teleport.
   * @param x      - Destination x (metres).
   * @param y      - Destination y (metres).
   * @param yaw    - Optional absolute heading in radians.
   */
  teleport(roomId: string, x: number, y: number, yaw?: number): void {
    this.player.setRoom(roomId)
    this.player.setPosition(x, y)

    if (yaw !== undefined) {
      // PlayerState only exposes a relative rotate(); convert to an absolute set.
      this.player.rotate(yaw - this.player.getState().yaw)
    }

    const occupied = this.findOccupiedExit()
    this.exitDetector.prime(occupied ? occupied.id : null)
  }

  /**
   * Returns the exit the player is currently standing inside, or `null` when
   * they are on open floor.
   *
   * Purely a read — it never mutates debounce state, so it is safe to poll on
   * every frame (e.g. to render a "press to enter" doorway hint).
   */
  getPendingExit(): { exitId: string; targetRoomId: string } | null {
    const occupied = this.findOccupiedExit()
    if (!occupied) return null

    return { exitId: occupied.id, targetRoomId: occupied.targetRoomId }
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

  // ── Internals ────────────────────────────────────────────────────────────────

  /** Finds the current room's exit whose rect contains the player, if any. */
  private findOccupiedExit(): Exit | undefined {
    const room = this.graph.getRoom(this.player.getRoomId())
    if (!room) return undefined

    const { x, y } = this.player.getPosition()

    return room.exits.find(
      (exit) =>
        x >= exit.bounds.x &&
        x <= exit.bounds.x + exit.bounds.width &&
        y >= exit.bounds.y &&
        y <= exit.bounds.y + exit.bounds.height,
    )
  }
}
