import { NavigationEngine } from '../NavigationEngine'
import { mockFloorPlan } from '../mockFloorPlan'
import type { RoomTransition } from '../types'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const living = mockFloorPlan.rooms.find((r) => r.id === 'living')!
const kitchen = mockFloorPlan.rooms.find((r) => r.id === 'kitchen')!

/**
 * The living ↔ hall doorway: x = 1.5–2.5, y = 5.5–6.5.
 *
 * Both rooms own a mirrored exit over these EXACT bounds ('living-hall' and
 * 'hall-living'), which is precisely what used to cause the ping-pong.
 */
const DOOR_X = 2.0
const DOOR_Y_TOP = 5.5
const DOOR_Y_BOTTOM = 6.5

const STEP = 0.2

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Harness = {
  nav: NavigationEngine
  transitions: RoomTransition[]
}

/** Builds an engine in the living room with a transition recorder attached. */
function harness(x = DOOR_X, y = 4.5): Harness {
  const nav = new NavigationEngine(mockFloorPlan, 'living', x, y)
  const transitions: RoomTransition[] = []
  nav.onRoomTransition((t) => transitions.push(t))
  return { nav, transitions }
}

/**
 * Steps the engine until `predicate` holds, or `maxSteps` is exhausted.
 * Mirrors what the rAF loop does: many small dead-reckoned increments.
 */
function walkUntil(
  nav: NavigationEngine,
  dx: number,
  dy: number,
  predicate: () => boolean,
  maxSteps = 40,
): number {
  let steps = 0
  while (steps < maxSteps && !predicate()) {
    nav.update(dx, dy)
    steps++
  }
  return steps
}

const inDoorway = (nav: NavigationEngine): boolean => {
  const { y } = nav.getState()
  return y >= DOOR_Y_TOP && y <= DOOR_Y_BOTTOM
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NavigationEngine — automatic room transitions', () => {
  // ── 1. Crossing a doorway fires exactly one transition ────────────────────

  test('walking from the living room into the living–hall doorway fires exactly ONE transition', () => {
    const { nav, transitions } = harness()

    walkUntil(nav, 0, STEP, () => transitions.length > 0)

    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toEqual({
      fromRoomId: 'living',
      toRoomId: 'hall',
      exitId: 'living-hall',
    })
    expect(nav.getState().roomId).toBe('hall')
    expect(inDoorway(nav)).toBe(true)
  })

  // ── 2. THE PING-PONG REGRESSION ───────────────────────────────────────────

  test('REGRESSION: lingering in the doorway after a transition does NOT bounce back', () => {
    const { nav, transitions } = harness()

    walkUntil(nav, 0, STEP, () => transitions.length > 0)
    expect(transitions).toHaveLength(1)

    // Still standing inside the shared doorway rect, now logically in 'hall'.
    // The old code reset() the detector here, so 'hall-living' (identical
    // bounds) read as newly entered and fired hall → living immediately.
    for (let i = 0; i < 5; i++) nav.update(0, 0)
    for (let i = 0; i < 5; i++) nav.update(0, 0.01)

    expect(inDoorway(nav)).toBe(true)
    expect(transitions).toHaveLength(1)
    expect(nav.getState().roomId).toBe('hall')
  })

  // ── 3. The prime is not permanent ─────────────────────────────────────────

  test('leaving the doorway and re-entering it DOES fire a fresh transition (hall → living)', () => {
    const { nav, transitions } = harness()

    walkUntil(nav, 0, STEP, () => transitions.length > 0)
    expect(transitions).toHaveLength(1)

    // Walk on into the hall, clear of the doorway rect.
    walkUntil(nav, 0, STEP, () => nav.getState().y > DOOR_Y_BOTTOM)
    expect(inDoorway(nav)).toBe(false)
    expect(transitions).toHaveLength(1)

    // Turn around and step back into the same rect.
    walkUntil(nav, 0, -STEP, () => transitions.length > 1)

    expect(transitions).toHaveLength(2)
    expect(transitions[1]).toEqual({
      fromRoomId: 'hall',
      toRoomId: 'living',
      exitId: 'hall-living',
    })
    expect(nav.getState().roomId).toBe('living')
  })

  // ── 4. respawnIn ──────────────────────────────────────────────────────────

  describe('respawnIn()', () => {
    test('moves the player to the target room spawn point', () => {
      const { nav } = harness()

      expect(nav.respawnIn('kitchen')).toBe(true)

      const state = nav.getState()
      expect(state.roomId).toBe('kitchen')
      expect(state.x).toBe(kitchen.spawnPoint.x)
      expect(state.y).toBe(kitchen.spawnPoint.y)
    })

    test('unknown room id returns false and changes nothing', () => {
      const { nav } = harness(living.spawnPoint.x, living.spawnPoint.y)
      const before = nav.getState()

      expect(nav.respawnIn('nope')).toBe(false)
      expect(nav.getState()).toEqual(before)
    })

    test('clears the exit debounce so the next doorway entry still fires', () => {
      const { nav, transitions } = harness()

      walkUntil(nav, 0, STEP, () => transitions.length > 0)
      expect(transitions).toHaveLength(1)

      // The caller finishes the async world swap by respawning us in 'hall'.
      expect(nav.respawnIn('hall')).toBe(true)
      expect(nav.getPendingExit()).toBeNull()

      // Walking back up into the doorway must still be detected.
      walkUntil(nav, 0, -STEP, () => transitions.length > 1)
      expect(transitions).toHaveLength(2)
      expect(transitions[1].toRoomId).toBe('living')
    })
  })

  // ── 5. teleport ───────────────────────────────────────────────────────────

  test('teleport() sets room, position and (optionally) yaw', () => {
    const { nav } = harness()

    nav.teleport('bedroom', 10, 9, Math.PI / 2)

    const state = nav.getState()
    expect(state.roomId).toBe('bedroom')
    expect(state.x).toBe(10)
    expect(state.y).toBe(9)
    expect(state.yaw).toBeCloseTo(Math.PI / 2)
  })

  test('teleport() into a doorway primes the detector instead of firing', () => {
    const { nav, transitions } = harness()

    nav.teleport('living', DOOR_X, 6.0)
    nav.update(0, 0)

    expect(transitions).toHaveLength(0)
  })

  // ── 6. getPendingExit ─────────────────────────────────────────────────────

  describe('getPendingExit()', () => {
    test('returns the exit while standing inside a doorway rect', () => {
      const { nav } = harness()

      nav.teleport('living', DOOR_X, 6.0)

      expect(nav.getPendingExit()).toEqual({
        exitId: 'living-hall',
        targetRoomId: 'hall',
      })
    })

    test('returns null on open floor', () => {
      const { nav } = harness(living.spawnPoint.x, living.spawnPoint.y)
      expect(nav.getPendingExit()).toBeNull()
    })
  })

  // ── 7. Wall collision regression guard ────────────────────────────────────

  test('a move that would cross a wall is rejected and the position is unchanged', () => {
    const { nav } = harness(living.spawnPoint.x, living.spawnPoint.y)
    const before = nav.getState()

    // Straight south from (5, 3) into the solid 'w-lh-right' segment at y = 6.
    const result = nav.update(0, 3)

    expect(result.allowed).toBe(false)
    expect(result.transition).toBeNull()
    expect(result.position).toEqual({ x: before.x, y: before.y })
    expect(nav.getState().x).toBe(before.x)
    expect(nav.getState().y).toBe(before.y)
  })
})
