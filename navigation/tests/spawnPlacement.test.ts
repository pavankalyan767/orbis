import { mockFloorPlan } from '../mockFloorPlan'
import type { FloorPlan, Point, Room, Wall } from '../types'
import {
  applySpawnPlacement,
  chooseEntryExit,
  computeSpawnPoint,
  MIN_WALL_CLEARANCE,
} from '@/lib/blueprint/spawnPlacement'

// ─── Independent geometry oracles ─────────────────────────────────────────────
// Deliberately re-derived here rather than imported from spawnPlacement, so a
// bug in its helpers cannot make its own assertions pass.

function distToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const ab2 = abx * abx + aby * aby
  if (ab2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / ab2))
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby))
}

function nearestWallDistance(p: Point, walls: Wall[]): number {
  return Math.min(...walls.map((w) => distToSegment(p, w.start, w.end)))
}

function inPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.y > p.y !== b.y > p.y) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
      if (p.x < x) inside = !inside
    }
  }
  return inside
}

function inRect(p: Point, r: { x: number; y: number; width: number; height: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('applySpawnPlacement (mock floor plan)', () => {
  const placed = applySpawnPlacement(mockFloorPlan)

  it('places every spawn point at least 0.6 m clear of every wall', () => {
    // CollisionEngine blocks any move within 0.3 m of a wall and there is no
    // sliding, so a tighter spawn is a permanent freeze.
    for (const room of placed.rooms) {
      const d = nearestWallDistance(room.spawnPoint, placed.walls)
      expect(d).toBeGreaterThanOrEqual(MIN_WALL_CLEARANCE)
      expect(d).toBeGreaterThan(0.3) // hard collision radius, for good measure
    }
  })

  it('never places a spawn point inside one of its own exit rectangles', () => {
    // ExitDetector starts with activeExitId = null, so spawning in a trigger
    // rectangle fires a spurious transition on the first update() tick.
    for (const room of placed.rooms) {
      for (const exit of room.exits) {
        expect(inRect(room.spawnPoint, exit.bounds)).toBe(false)
      }
    }
  })

  it('places every spawn point inside its own room polygon', () => {
    for (const room of placed.rooms) {
      expect(inPolygon(room.spawnPoint, room.polygon)).toBe(true)
    }
  })

  it('produces finite coordinates for every room', () => {
    for (const room of placed.rooms) {
      expect(Number.isFinite(room.spawnPoint.x)).toBe(true)
      expect(Number.isFinite(room.spawnPoint.y)).toBe(true)
    }
  })

  it('is deterministic across repeated calls', () => {
    const again = applySpawnPlacement(mockFloorPlan)
    expect(again.rooms.map((r) => r.spawnPoint)).toEqual(
      placed.rooms.map((r) => r.spawnPoint),
    )
  })

  it('is pure — the input floor plan is not mutated', () => {
    const before = clone(mockFloorPlan)
    const result = applySpawnPlacement(mockFloorPlan)

    expect(mockFloorPlan).toEqual(before)
    expect(mockFloorPlan.rooms.map((r) => r.spawnPoint)).toEqual(
      before.rooms.map((r) => r.spawnPoint),
    )
    // New objects, not aliases of the input rooms.
    expect(result).not.toBe(mockFloorPlan)
    result.rooms.forEach((room, i) => {
      expect(room).not.toBe(mockFloorPlan.rooms[i])
      expect(room.spawnPoint).not.toBe(mockFloorPlan.rooms[i].spawnPoint)
    })
  })
})

describe('chooseEntryExit', () => {
  const roomById = (id: string): Room => {
    const room = mockFloorPlan.rooms.find((r) => r.id === id)
    if (!room) throw new Error(`missing fixture room ${id}`)
    return room
  }

  it('prefers the hallway doorway when a room has several exits', () => {
    // living has living-kitchen and living-hall; the hall is the circulation
    // space, so it is the doorway an occupant enters through.
    const exit = chooseEntryExit(roomById('living'), mockFloorPlan)
    expect(exit?.id).toBe('living-hall')
  })

  it('matches circulation spaces by room name as well as id', () => {
    // bedroom -> hall (id 'hall', name 'Hallway') beats bedroom -> kitchen.
    const exit = chooseEntryExit(roomById('bedroom'), mockFloorPlan)
    expect(exit?.id).toBe('bedroom-hall')
  })

  it('returns the sole exit for a room with exactly one doorway', () => {
    const plan: FloorPlan = {
      rooms: [
        {
          id: 'bath',
          name: 'Bathroom',
          polygon: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 },
          ],
          spawnPoint: { x: 2, y: 2 },
          exits: [
            {
              id: 'bath-hall',
              roomId: 'bath',
              targetRoomId: 'hall',
              bounds: { x: 1.5, y: 3.5, width: 1, height: 1 },
            },
          ],
        },
      ],
      walls: [],
    }

    expect(chooseEntryExit(plan.rooms[0], plan)?.id).toBe('bath-hall')
  })

  it('returns null for a room with no exits', () => {
    const room: Room = {
      id: 'void',
      name: 'Void',
      polygon: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
      ],
      spawnPoint: { x: 1, y: 1 },
      exits: [],
    }
    expect(chooseEntryExit(room, { rooms: [room], walls: [] })).toBeNull()
  })

  it('falls back to the most-connected neighbour, tie-broken by exit id', () => {
    // kitchen -> living (2 exits) and kitchen -> bedroom (2 exits): neither
    // target is a circulation space and the exit counts tie, so the
    // lexicographically smallest exit id wins.
    const exit = chooseEntryExit(roomById('kitchen'), mockFloorPlan)
    expect(exit?.id).toBe('kitchen-bedroom')
  })
})

describe('computeSpawnPoint', () => {
  it('lands roughly one metre inside the room, in front of the doorway', () => {
    const living = mockFloorPlan.rooms[0]
    const hallDoor = living.exits.find((e) => e.id === 'living-hall')!
    const spawn = computeSpawnPoint(living, hallDoor, mockFloorPlan)

    const doorCentre = {
      x: hallDoor.bounds.x + hallDoor.bounds.width / 2,
      y: hallDoor.bounds.y + hallDoor.bounds.height / 2,
    }
    const distance = Math.hypot(spawn.x - doorCentre.x, spawn.y - doorCentre.y)

    expect(distance).toBeGreaterThanOrEqual(1)
    expect(distance).toBeLessThanOrEqual(2)
    expect(inPolygon(spawn, living.polygon)).toBe(true)
    // Above the doorway (y grows downward), i.e. on the living-room side.
    expect(spawn.y).toBeLessThan(doorCentre.y)
  })

  it('returns the centroid when the room has no usable geometry to step into', () => {
    // Doorway centre coincides with the polygon centroid: no inward direction.
    const room: Room = {
      id: 'odd',
      name: 'Odd',
      polygon: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
      spawnPoint: { x: 0, y: 0 },
      exits: [
        {
          id: 'odd-x',
          roomId: 'odd',
          targetRoomId: 'x',
          bounds: { x: 1.5, y: 1.5, width: 1, height: 1 },
        },
      ],
    }
    const spawn = computeSpawnPoint(room, room.exits[0], { rooms: [room], walls: [] })
    expect(spawn).toEqual({ x: 2, y: 2 })
  })
})
