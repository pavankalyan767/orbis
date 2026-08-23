/**
 * End-to-end guard: a spawn point produced by applySpawnPlacement must leave
 * the player able to move and must not trip the exit detector on tick one.
 *
 * These are the two failure modes that make a room unplayable:
 *   - CollisionEngine has no wall sliding, so a spawn inside the 0.3m radius
 *     of a wall rejects every direction and freezes the player permanently.
 *   - ExitDetector starts with activeExitId=null, so a spawn inside a doorway
 *     rect fires a phantom room transition before the player has moved.
 */
import { mockFloorPlan } from '@/navigation/mockFloorPlan'
import { applySpawnPlacement } from '@/lib/blueprint/spawnPlacement'
import { CollisionEngine } from '@/navigation/CollisionEngine'
import { PlayerState } from '@/navigation/PlayerState'
import { ExitDetector } from '@/navigation/ExitDetector'

describe('spawn placement integration', () => {
  const plan = applySpawnPlacement(mockFloorPlan)
  const collision = new CollisionEngine(plan.walls)

  it.each(plan.rooms.map((r) => [r.name, r] as const))(
    '%s spawns the player somewhere they can actually move',
    (_name, room) => {
      const player = new PlayerState(room.id, room.spawnPoint.x, room.spawnPoint.y)
      const dirs: [number, number][] = [[0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05]]
      const free = dirs.filter(([dx, dy]) => collision.tryMove(player, dx, dy).allowed)
      expect(free.length).toBeGreaterThan(0)
    },
  )

  it.each(plan.rooms.map((r) => [r.name, r] as const))(
    '%s does not fire a phantom transition on the first tick',
    (_name, room) => {
      expect(new ExitDetector().check(room.spawnPoint, room)).toBeNull()
    },
  )
})
