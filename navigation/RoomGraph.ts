import type { FloorPlan, Room, Exit } from './types'

/**
 * RoomGraph — builds the building connectivity graph from a FloorPlan.
 *
 * Responsibilities:
 *   - Look up rooms by ID.
 *   - Return the set of neighbour room IDs for a given room.
 *   - Look up a specific exit by (roomId, exitId).
 *
 * This class is purely a read-only index.  It does NOT:
 *   - Handle WASD input.
 *   - Perform collision checks.
 *   - Modify player position.
 *   - Know anything about Reactor.
 */
export class RoomGraph {
  private readonly rooms: Map<string, Room>

  constructor(floorPlan: FloorPlan) {
    this.rooms = new Map(floorPlan.rooms.map((r) => [r.id, r]))
  }

  /** Returns the Room for the given ID, or `undefined` if it does not exist. */
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId)
  }

  /**
   * Returns the IDs of all rooms reachable directly from the given room
   * (i.e. rooms connected via an exit).  Returns an empty array for unknown rooms.
   */
  getNeighbors(roomId: string): string[] {
    const room = this.rooms.get(roomId)
    if (!room) return []
    return room.exits.map((e) => e.targetRoomId)
  }

  /**
   * Returns the Exit with the given `exitId` inside `roomId`,
   * or `undefined` if either the room or the exit does not exist.
   */
  getExit(roomId: string, exitId: string): Exit | undefined {
    const room = this.rooms.get(roomId)
    if (!room) return undefined
    return room.exits.find((e) => e.id === exitId)
  }

  /** Returns all room IDs in the graph. */
  getAllRoomIds(): string[] {
    return Array.from(this.rooms.keys())
  }
}
