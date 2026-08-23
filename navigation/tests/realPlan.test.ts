/**
 * Guards against a REAL parsed floor plan (captured from /api/blueprint/parse),
 * not the hand-written mock. Proves the spawn-placement pass and the local
 * image resolver hold on actual model output.
 */
import type { FloorPlan } from '@/navigation/types'
import { CollisionEngine } from '@/navigation/CollisionEngine'
import { PlayerState } from '@/navigation/PlayerState'
import { ExitDetector } from '@/navigation/ExitDetector'
import { resolveLocalRoomImage } from '@/lib/blueprint/localRoomImages'
import realPlan from './__realplan.json'

const floorPlan = (realPlan as { floorPlan: FloorPlan }).floorPlan

describe('real parsed floor plan', () => {
  const collision = new CollisionEngine(floorPlan.walls)

  it.each(floorPlan.rooms.map((r) => [r.name, r] as const))(
    '%s: player can move from spawn',
    (_n, room) => {
      const p = new PlayerState(room.id, room.spawnPoint.x, room.spawnPoint.y)
      const dirs: [number, number][] = [[0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05]]
      expect(dirs.filter(([dx, dy]) => collision.tryMove(p, dx, dy).allowed).length).toBeGreaterThan(0)
    },
  )

  it.each(floorPlan.rooms.map((r) => [r.name, r] as const))(
    '%s: no phantom transition on first tick',
    (_n, room) => {
      expect(new ExitDetector().check(room.spawnPoint, room)).toBeNull()
    },
  )

  it('resolves local images for the rooms we have art for', () => {
    expect(resolveLocalRoomImage('living', 'Living Room')).toBe('/rooms/living_room.jpeg')
    expect(resolveLocalRoomImage('hallway', 'Hallway')).toBe('/rooms/hall_room.jpeg')
    // No art shipped for a foyer — must degrade to null, not mis-match.
    expect(resolveLocalRoomImage('foyer', 'Foyer')).toBeNull()
  })

  it('every exit targets a room that exists', () => {
    const ids = new Set(floorPlan.rooms.map((r) => r.id))
    for (const room of floorPlan.rooms) {
      for (const exit of room.exits) expect(ids.has(exit.targetRoomId)).toBe(true)
    }
  })
})
