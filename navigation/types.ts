// ─── Core geometry ────────────────────────────────────────────────────────────

export type Point = {
  x: number
  y: number
}

export type Rectangle = {
  x: number      // left edge
  y: number      // top edge  (y grows downward in 2-D floor-plan space)
  width: number
  height: number
}

// ─── Architectural primitives ─────────────────────────────────────────────────

/** A wall segment between two points. `thickness` is stored but not currently
 *  used in collision – the segment itself is treated as infinitely thin for the
 *  purposes of a circle-vs-segment collision check. */
export type Wall = {
  id: string
  start: Point
  end: Point
  thickness: number
}

/** A doorway / portal that connects one room to another.
 *  `bounds` is an axis-aligned rectangle large enough to cover the opening. */
export type Exit = {
  id: string
  /** The room that *owns* this exit (the room the player leaves from). */
  roomId: string
  /** The room the player will enter when they cross this exit. */
  targetRoomId: string
  /** Axis-aligned trigger region.  Player centre must be inside to trigger. */
  bounds: Rectangle
}

/** A room described by its convex polygon and the exits it contains. */
export type Room = {
  id: string
  name: string
  /** Ordered list of vertices describing the room's floor polygon. */
  polygon: Point[]
  /** Exits reachable from this room. */
  exits: Exit[]
  /** Spawn point — where the player appears when first entering this room. */
  spawnPoint: Point
}

/** The complete floor plan – single source of architectural truth. */
export type FloorPlan = {
  rooms: Room[]
  walls: Wall[]
}

// ─── Player ───────────────────────────────────────────────────────────────────

export type PlayerStateData = {
  roomId: string
  x: number
  y: number
  /** Heading in radians, 0 = facing positive-x axis. */
  yaw: number
  /** Collision radius in metres. */
  radius: number
}

// ─── Navigation events ────────────────────────────────────────────────────────

export type RoomTransition = {
  fromRoomId: string
  toRoomId: string
  exitId: string
}

export type MoveResult = {
  /** Whether the move was accepted (no wall collision). */
  allowed: boolean
  /** Resulting position (unchanged if blocked). */
  position: Point
  /** Set when the move caused a room transition. */
  transition: RoomTransition | null
}
