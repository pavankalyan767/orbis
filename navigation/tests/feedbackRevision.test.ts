import { checkRevisionIntegrity } from '../../lib/blueprint/feedbackRevision'
import { mockFloorPlan } from '../mockFloorPlan'
import type { FloorPlan, Room } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fresh deep copy of the 4-room mock house (living, kitchen, hall, bedroom). */
function clone(): FloorPlan {
  return structuredClone(mockFloorPlan)
}

function room(plan: FloorPlan, id: string): Room {
  const found = plan.rooms.find((r) => r.id === id)
  if (!found) throw new Error(`test setup bug: no room "${id}"`)
  return found
}

/** Asserts the check failed and returns the error list. */
function expectFail(plan: FloorPlan, original: FloorPlan = mockFloorPlan): string[] {
  const result = checkRevisionIntegrity(original, plan)
  expect(result.ok).toBe(false)
  return result.ok ? [] : result.errors
}

const joined = (errors: string[]) => errors.join(' | ')

describe('checkRevisionIntegrity', () => {
  // ── 1. Identity ─────────────────────────────────────────────────────────────

  test('an unchanged clone passes', () => {
    expect(checkRevisionIntegrity(mockFloorPlan, clone())).toEqual({ ok: true })
  })

  // ── 2. Legitimate geometry edit ─────────────────────────────────────────────

  test('a legitimately shifted wall passes — real edits must not be rejected', () => {
    // "move the wall 3-4 feet away" -> 3.5 ft -> 1.07 m, applied to the
    // living/kitchen party wall at x = 10.
    const SHIFT = 1.07
    const revised = clone()

    // Wall segments either side of the doorway gap.
    for (const wall of revised.walls) {
      if (wall.id === 'w-lk-top' || wall.id === 'w-lk-bot') {
        wall.start.x += SHIFT
        wall.end.x += SHIFT
      }
    }

    // Living room grows east, kitchen shrinks by the same amount.
    for (const p of room(revised, 'living').polygon) {
      if (p.x === 10) p.x += SHIFT
    }
    for (const p of room(revised, 'kitchen').polygon) {
      if (p.x === 10) p.x += SHIFT
    }

    // Both sides of the shared doorway move with the wall.
    for (const r of revised.rooms) {
      for (const exit of r.exits) {
        if (exit.id === 'living-kitchen' || exit.id === 'kitchen-living') {
          exit.bounds.x += SHIFT
        }
      }
    }

    // Spawn points stay inside their (now resized) rooms.
    room(revised, 'living').spawnPoint.x += SHIFT / 2
    room(revised, 'kitchen').spawnPoint.x += SHIFT / 2

    expect(checkRevisionIntegrity(mockFloorPlan, revised)).toEqual({ ok: true })
  })

  // ── 3–5. Room id set ────────────────────────────────────────────────────────

  test('a renamed room id fails and the error names the id', () => {
    const revised = clone()
    room(revised, 'kitchen').id = 'kitchen-2'
    // Keep the graph otherwise consistent so the rename is what is under test.
    for (const r of revised.rooms) {
      for (const exit of r.exits) {
        if (exit.roomId === 'kitchen') exit.roomId = 'kitchen-2'
        if (exit.targetRoomId === 'kitchen') exit.targetRoomId = 'kitchen-2'
      }
    }

    const errors = expectFail(revised)
    expect(joined(errors)).toContain('kitchen')
    expect(errors.some((e) => e.includes('"kitchen"') && /missing|deleted|renamed/i.test(e))).toBe(true)
    expect(errors.some((e) => e.includes('"kitchen-2"') && /added|renamed/i.test(e))).toBe(true)
  })

  test('a deleted room fails', () => {
    const revised = clone()
    revised.rooms = revised.rooms.filter((r) => r.id !== 'bedroom')
    // Strip dangling references so the deletion is the only defect.
    for (const r of revised.rooms) {
      r.exits = r.exits.filter((e) => e.targetRoomId !== 'bedroom')
    }

    const errors = expectFail(revised)
    expect(joined(errors)).toContain('bedroom')
    expect(errors.some((e) => /missing|deleted/i.test(e))).toBe(true)
  })

  test('an added room fails', () => {
    const revised = clone()
    revised.rooms.push({
      id: 'garage',
      name: 'Garage',
      polygon: [
        { x: 16, y: 0 },
        { x: 22, y: 0 },
        { x: 22, y: 6 },
        { x: 16, y: 6 },
      ],
      spawnPoint: { x: 19, y: 3 },
      exits: [],
    })

    const errors = expectFail(revised)
    expect(joined(errors)).toContain('garage')
    expect(errors.some((e) => /added/i.test(e))).toBe(true)
  })

  // ── 6. Exit id set ──────────────────────────────────────────────────────────

  test('a dropped exit id fails', () => {
    const revised = clone()
    const hall = room(revised, 'hall')
    hall.exits = hall.exits.filter((e) => e.id !== 'hall-bedroom')

    const errors = expectFail(revised)
    expect(joined(errors)).toContain('hall-bedroom')
  })

  // ── 7. Referential integrity ────────────────────────────────────────────────

  test('an exit pointing at a nonexistent room fails', () => {
    const revised = clone()
    room(revised, 'living').exits[0].targetRoomId = 'atrium'

    const errors = expectFail(revised)
    expect(joined(errors)).toContain('atrium')
    expect(errors.some((e) => /does not exist/i.test(e))).toBe(true)
  })

  // ── 8. Reciprocity ──────────────────────────────────────────────────────────

  test('breaking exit reciprocity fails', () => {
    const revised = clone()
    // Retarget the kitchen's return exit so nothing in the kitchen leads back to
    // the living room, while keeping every id present.
    const kitchen = room(revised, 'kitchen')
    const back = kitchen.exits.find((e) => e.id === 'kitchen-living')!
    back.targetRoomId = 'bedroom'

    const errors = expectFail(revised)
    expect(errors.some((e) => /reciprocity/i.test(e))).toBe(true)
    expect(joined(errors)).toContain('living-kitchen')
  })

  // ── 9–10. Numeric sanity ────────────────────────────────────────────────────

  test('a NaN coordinate fails', () => {
    const revised = clone()
    room(revised, 'living').polygon[2].x = Number.NaN

    const errors = expectFail(revised)
    expect(errors.some((e) => /finite/i.test(e) && e.includes('NaN'))).toBe(true)
  })

  test('a coordinate of 50000 fails the sanity bound', () => {
    const revised = clone()
    // Classic unit-confusion blowup: metres emitted as millimetres.
    room(revised, 'bedroom').spawnPoint.y = 50000

    const errors = expectFail(revised)
    expect(errors.some((e) => e.includes('50000') && /1000/.test(e))).toBe(true)
  })

  // ── 11. Polygon degeneracy ──────────────────────────────────────────────────

  test('a polygon reduced to 2 vertices fails', () => {
    const revised = clone()
    const living = room(revised, 'living')
    living.polygon = living.polygon.slice(0, 2)

    const errors = expectFail(revised)
    expect(errors.some((e) => e.includes('"living"') && /at least 3/i.test(e))).toBe(true)
  })

  // ── Infinity is caught too (same class of arithmetic bug as NaN) ────────────

  test('an Infinity coordinate fails', () => {
    const revised = clone()
    revised.walls[0].end.x = Number.POSITIVE_INFINITY

    const errors = expectFail(revised)
    expect(errors.some((e) => /finite/i.test(e))).toBe(true)
  })
})
