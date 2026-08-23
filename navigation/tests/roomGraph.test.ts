import { RoomGraph } from '../RoomGraph'
import { mockFloorPlan } from '../mockFloorPlan'

describe('RoomGraph', () => {
  let graph: RoomGraph

  beforeEach(() => {
    graph = new RoomGraph(mockFloorPlan)
  })

  // ── Room existence ──────────────────────────────────────────────────────────

  test('living room exists', () => {
    const room = graph.getRoom('living')
    expect(room).toBeDefined()
    expect(room!.name).toBe('Living Room')
  })

  test('hall exists', () => {
    const room = graph.getRoom('hall')
    expect(room).toBeDefined()
    expect(room!.name).toBe('Hallway')
  })

  test('kitchen exists', () => {
    const room = graph.getRoom('kitchen')
    expect(room).toBeDefined()
  })

  test('bedroom exists', () => {
    const room = graph.getRoom('bedroom')
    expect(room).toBeDefined()
  })

  // ── Unknown rooms ───────────────────────────────────────────────────────────

  test('unknown room returns undefined', () => {
    expect(graph.getRoom('attic')).toBeUndefined()
  })

  test('getNeighbors on unknown room returns empty array', () => {
    expect(graph.getNeighbors('attic')).toEqual([])
  })

  test('getExit on unknown room returns undefined', () => {
    expect(graph.getExit('attic', 'exit-1')).toBeUndefined()
  })

  // ── Connectivity ────────────────────────────────────────────────────────────

  test('living connects to kitchen', () => {
    expect(graph.getNeighbors('living')).toContain('kitchen')
  })

  test('living connects to hall', () => {
    expect(graph.getNeighbors('living')).toContain('hall')
  })

  test('hall connects to living', () => {
    expect(graph.getNeighbors('hall')).toContain('living')
  })

  test('hall connects to bedroom', () => {
    expect(graph.getNeighbors('hall')).toContain('bedroom')
  })

  test('bedroom connects to hall', () => {
    expect(graph.getNeighbors('bedroom')).toContain('hall')
  })

  test('bedroom connects to kitchen', () => {
    expect(graph.getNeighbors('bedroom')).toContain('kitchen')
  })

  // ── Exit lookup ─────────────────────────────────────────────────────────────

  test('getExit returns the correct exit', () => {
    const exit = graph.getExit('living', 'living-hall')
    expect(exit).toBeDefined()
    expect(exit!.targetRoomId).toBe('hall')
  })

  test('getExit returns undefined for unknown exit ID', () => {
    expect(graph.getExit('living', 'nonexistent-exit')).toBeUndefined()
  })

  // ── getAllRoomIds ────────────────────────────────────────────────────────────

  test('getAllRoomIds returns all four rooms', () => {
    const ids = graph.getAllRoomIds()
    expect(ids).toHaveLength(4)
    expect(ids).toContain('living')
    expect(ids).toContain('kitchen')
    expect(ids).toContain('hall')
    expect(ids).toContain('bedroom')
  })
})
