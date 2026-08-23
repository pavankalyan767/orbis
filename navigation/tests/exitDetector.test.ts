import { ExitDetector } from '../ExitDetector'
import { mockFloorPlan } from '../mockFloorPlan'
import type { Room, Point } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const livingRoom = mockFloorPlan.rooms.find((r) => r.id === 'living')!
const hallRoom = mockFloorPlan.rooms.find((r) => r.id === 'hall')!

/** living → hall exit bounds: x=1.5–2.5, y=5.5–6.5 */
const LIVING_HALL_EXIT_ID = 'living-hall'

/** Centre of the living-hall doorway */
const insideDoorway: Point = { x: 2.0, y: 6.0 }

/** Well inside the living room, far from any exit */
const insideLiving: Point = { x: 5, y: 3 }

/** Just approaching the door but not inside its rectangle */
const approachingDoor: Point = { x: 2.0, y: 5.0 }

describe('ExitDetector', () => {
  let detector: ExitDetector

  beforeEach(() => {
    detector = new ExitDetector()
  })

  // ── No transition in open space ─────────────────────────────────────────────

  test('player inside room (far from exits) → no transition', () => {
    const result = detector.check(insideLiving, livingRoom)
    expect(result).toBeNull()
  })

  test('player approaching door but not inside → no transition', () => {
    const result = detector.check(approachingDoor, livingRoom)
    expect(result).toBeNull()
  })

  // ── Transition on crossing ───────────────────────────────────────────────────

  test('player crosses doorway → transition is returned', () => {
    const result = detector.check(insideDoorway, livingRoom)
    expect(result).not.toBeNull()
    expect(result!.exitId).toBe(LIVING_HALL_EXIT_ID)
  })

  test('transition contains correct source room', () => {
    const result = detector.check(insideDoorway, livingRoom)
    expect(result!.fromRoomId).toBe('living')
  })

  test('transition contains correct target room', () => {
    const result = detector.check(insideDoorway, livingRoom)
    expect(result!.toRoomId).toBe('hall')
  })

  // ── No repeated transition while lingering ──────────────────────────────────

  test('transition is NOT emitted again while player stays in doorway', () => {
    // First tick — should fire
    const first = detector.check(insideDoorway, livingRoom)
    expect(first).not.toBeNull()

    // Second tick, same position — must NOT re-fire
    const second = detector.check(insideDoorway, livingRoom)
    expect(second).toBeNull()

    // Third tick — still inside, still null
    const third = detector.check(insideDoorway, livingRoom)
    expect(third).toBeNull()
  })

  // ── Fresh transition after leaving and re-entering ──────────────────────────

  test('transition fires again after player leaves doorway and re-enters', () => {
    // Enter doorway
    detector.check(insideDoorway, livingRoom)

    // Leave doorway (open space)
    detector.check(insideLiving, livingRoom)

    // Re-enter doorway — should fire again
    const result = detector.check(insideDoorway, livingRoom)
    expect(result).not.toBeNull()
    expect(result!.exitId).toBe(LIVING_HALL_EXIT_ID)
  })

  // ── reset() ─────────────────────────────────────────────────────────────────

  test('reset() clears debounce so the same exit can fire again', () => {
    // Enter doorway (fires)
    detector.check(insideDoorway, livingRoom)

    // Reset (simulates teleport/room load)
    detector.reset()

    // Re-enter the same doorway — should fire again
    const result = detector.check(insideDoorway, livingRoom)
    expect(result).not.toBeNull()
  })

  // ── Different exits within the same room ────────────────────────────────────

  test('entering a different exit triggers a new transition', () => {
    // Player is in hall — hall has exits to living and bedroom
    const insideHallLivingDoor: Point = { x: 2.0, y: 6.0 }  // hall-living exit
    const insideHallBedroomDoor: Point = { x: 4.0, y: 9.0 } // hall-bedroom exit

    // Cross hall → living exit
    const r1 = detector.check(insideHallLivingDoor, hallRoom)
    expect(r1).not.toBeNull()
    expect(r1!.toRoomId).toBe('living')

    // Move to open space (reset active exit)
    detector.check({ x: 2, y: 9 }, hallRoom)

    // Cross a different exit (hall → bedroom)
    const r2 = detector.check(insideHallBedroomDoor, hallRoom)
    expect(r2).not.toBeNull()
    expect(r2!.toRoomId).toBe('bedroom')
  })
})
