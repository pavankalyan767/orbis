import type { PlayerStateData, Point } from './types'

/** Default player collision radius in metres. */
const DEFAULT_RADIUS = 0.3

/**
 * PlayerState — owns the authoritative logical position of the player.
 *
 * All navigation state is tracked here, completely independent of Reactor.
 * The application MUST NOT infer player position from Reactor's generated video.
 *
 * Mutation methods apply changes to the internal state only.
 * Consumers call `getState()` or `getPosition()` to read the current values.
 */
export class PlayerState {
  private state: PlayerStateData

  constructor(
    roomId: string,
    x: number,
    y: number,
    yaw = 0,
    radius = DEFAULT_RADIUS,
  ) {
    this.state = { roomId, x, y, yaw, radius }
  }

  // ── Reads ────────────────────────────────────────────────────────────────────

  /** Returns a snapshot of the full player state (safe to read; not a live reference). */
  getState(): Readonly<PlayerStateData> {
    return { ...this.state }
  }

  /** Returns the current (x, y) position. */
  getPosition(): Point {
    return { x: this.state.x, y: this.state.y }
  }

  /** Returns the current room ID. */
  getRoomId(): string {
    return this.state.roomId
  }

  // ── Writes ───────────────────────────────────────────────────────────────────

  /** Overwrites (x, y) directly — used by the collision/movement pipeline. */
  setPosition(x: number, y: number): void {
    this.state.x = x
    this.state.y = y
  }

  /**
   * Applies a delta to (x, y).
   * NOTE: The CollisionEngine should validate the move before calling this.
   */
  move(dx: number, dy: number): void {
    this.state.x += dx
    this.state.y += dy
  }

  /** Adds `deltaYaw` (radians) to the current heading and normalises to [0, 2π). */
  rotate(deltaYaw: number): void {
    this.state.yaw = ((this.state.yaw + deltaYaw) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
  }

  /** Sets the current room ID — called by the ExitDetector after a transition. */
  setRoom(roomId: string): void {
    this.state.roomId = roomId
  }
}
