import { CollisionEngine } from '../CollisionEngine'
import { PlayerState } from '../PlayerState'
import type { Wall } from '../types'

// ─── Shared walls for most tests ─────────────────────────────────────────────
//
// Simple isolated box: (0,0) – (10,10) with four walls.
// The player starts at (5, 5) by default.
//
//   (0,0) ──────────── (10,0)
//     |                  |
//     |    open space    |
//     |                  |
//   (0,10) ─────────── (10,10)

const boxWalls: Wall[] = [
  { id: 'top',    start: { x: 0,  y: 0  }, end: { x: 10, y: 0  }, thickness: 0.2 },
  { id: 'right',  start: { x: 10, y: 0  }, end: { x: 10, y: 10 }, thickness: 0.2 },
  { id: 'bottom', start: { x: 0,  y: 10 }, end: { x: 10, y: 10 }, thickness: 0.2 },
  { id: 'left',   start: { x: 0,  y: 0  }, end: { x: 0,  y: 10 }, thickness: 0.2 },
]

function makePlayer(x = 5, y = 5, radius = 0.3): PlayerState {
  return new PlayerState('living', x, y, 0, radius)
}

describe('CollisionEngine', () => {
  let engine: CollisionEngine

  beforeEach(() => {
    engine = new CollisionEngine(boxWalls)
  })

  // ── Open space ──────────────────────────────────────────────────────────────

  test('player can move in open space', () => {
    const player = makePlayer(5, 5)
    const result = engine.tryMove(player, 0.5, 0)
    expect(result.allowed).toBe(true)
    expect(result.position.x).toBeCloseTo(5.5)
    expect(result.position.y).toBeCloseTo(5)
  })

  test('player can move diagonally in open space', () => {
    const player = makePlayer(5, 5)
    const result = engine.tryMove(player, 0.3, 0.3)
    expect(result.allowed).toBe(true)
    expect(result.position.x).toBeCloseTo(5.3)
    expect(result.position.y).toBeCloseTo(5.3)
  })

  test('zero-delta move is always allowed', () => {
    const player = makePlayer(5, 5)
    const result = engine.tryMove(player, 0, 0)
    expect(result.allowed).toBe(true)
  })

  // ── Wall collision ──────────────────────────────────────────────────────────

  test('player cannot pass through the right wall', () => {
    // Place the player near the right wall and try to move through it
    const player = makePlayer(9.8, 5)
    const result = engine.tryMove(player, 0.5, 0)   // would reach x = 10.3
    expect(result.allowed).toBe(false)
    // Position must remain unchanged when blocked
    expect(result.position.x).toBeCloseTo(9.8)
    expect(result.position.y).toBeCloseTo(5)
  })

  test('player cannot pass through the top wall', () => {
    const player = makePlayer(5, 0.2)
    const result = engine.tryMove(player, 0, -0.5)
    expect(result.allowed).toBe(false)
    expect(result.position.x).toBeCloseTo(5)
    expect(result.position.y).toBeCloseTo(0.2)
  })

  test('player cannot pass through the left wall', () => {
    const player = makePlayer(0.2, 5)
    const result = engine.tryMove(player, -0.5, 0)
    expect(result.allowed).toBe(false)
  })

  test('player cannot pass through the bottom wall', () => {
    const player = makePlayer(5, 9.8)
    const result = engine.tryMove(player, 0, 0.5)
    expect(result.allowed).toBe(false)
  })

  // ── Parallel movement ───────────────────────────────────────────────────────

  test('player can move parallel to the right wall when close', () => {
    // x=9.4 is close to the wall at x=10 but the radius is 0.3,
    // so distance from player centre to wall is 0.6 — above the radius.
    const player = makePlayer(9.4, 5)
    // Move parallel (vertical only) — should NOT be blocked
    const result = engine.tryMove(player, 0, -0.5)
    expect(result.allowed).toBe(true)
  })

  // ── Player radius ───────────────────────────────────────────────────────────

  test('player radius is respected — larger radius blocked sooner', () => {
    // With radius 0.8, the player at x=9.4 is already only 0.6 m from the
    // right wall. Moving +0.1 x puts the nearest point of the circle at
    // 9.5 + 0.8 = 10.3 which intersects the wall.
    const bigPlayer = makePlayer(9.4, 5, 0.8)
    const result = engine.tryMove(bigPlayer, 0.1, 0)
    expect(result.allowed).toBe(false)
  })

  test('smaller radius allows moving closer to a wall', () => {
    // With radius 0.1, player can get within 0.1 m of the wall
    const tinyPlayer = makePlayer(9.8, 5, 0.1)
    // move to x = 9.85 — still 0.15 m away from wall, so allowed
    const result = engine.tryMove(tinyPlayer, 0.05, 0)
    expect(result.allowed).toBe(true)
  })

  // ── State is not modified when blocked ──────────────────────────────────────

  test('blocked movement does not modify player position', () => {
    const player = makePlayer(9.8, 5)
    engine.tryMove(player, 0.5, 0)           // blocked
    // Player position must still be 9.8
    expect(player.getPosition().x).toBeCloseTo(9.8)
    expect(player.getPosition().y).toBeCloseTo(5)
  })

  // ── No walls edge case ──────────────────────────────────────────────────────

  test('no walls — any movement is allowed', () => {
    const openEngine = new CollisionEngine([])
    const player = makePlayer(5, 5)
    const result = openEngine.tryMove(player, 100, 100)
    expect(result.allowed).toBe(true)
  })
})
