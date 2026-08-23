import { buildRoomBrief } from '@/lib/narration/fishAudio'
import { mockFloorPlan } from '@/navigation/mockFloorPlan'
import type { FloorPlan, Room } from '@/navigation/types'

const living = mockFloorPlan.rooms.find((r) => r.id === 'living')!

describe('buildRoomBrief', () => {
  it('names the room it is describing', () => {
    const brief = buildRoomBrief(living, mockFloorPlan)
    expect(brief).toContain('Living Room')
  })

  it('derives the bounding-box dimensions in metres', () => {
    // living polygon spans x 0..10 and y 0..6
    const brief = buildRoomBrief(living, mockFloorPlan)
    expect(brief).toContain('10.0 metres wide by 6.0 metres deep')
  })

  it('resolves every exit to the connecting room name', () => {
    // living has exits living-kitchen and living-hall
    const brief = buildRoomBrief(living, mockFloorPlan)
    expect(brief).toContain('Kitchen')
    expect(brief).toContain('Hallway')
  })

  it('handles a room with no exits without crashing', () => {
    const isolated: Room = {
      id: 'vault',
      name: 'Wine Cellar',
      polygon: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 2.5 },
        { x: 0, y: 2.5 },
      ],
      spawnPoint: { x: 1.5, y: 1.25 },
      exits: [],
    }
    const plan: FloorPlan = { rooms: [isolated], walls: [] }

    let brief = ''
    expect(() => {
      brief = buildRoomBrief(isolated, plan)
    }).not.toThrow()

    expect(brief).toContain('Wine Cellar')
    expect(brief).toContain('3.0 metres wide by 2.5 metres deep')
    expect(brief).toMatch(/Connecting rooms: none/i)
  })

  it('includes feedback lines when they are supplied', () => {
    const brief = buildRoomBrief(living, mockFloorPlan, [
      'South-facing windows flood it with afternoon light.',
      'Original oak flooring throughout.',
    ])
    expect(brief).toContain('South-facing windows flood it with afternoon light.')
    expect(brief).toContain('Original oak flooring throughout.')
  })

  it('omits the notes section entirely when no feedback is given', () => {
    expect(buildRoomBrief(living, mockFloorPlan)).not.toContain('Notes about this room')
  })

  it('is pure — identical input yields byte-identical output', () => {
    const feedback = ['Recently redecorated.']
    const a = buildRoomBrief(living, mockFloorPlan, feedback)
    const b = buildRoomBrief(living, mockFloorPlan, feedback)
    expect(a).toBe(b)

    const c = buildRoomBrief(living, mockFloorPlan)
    const d = buildRoomBrief(living, mockFloorPlan)
    expect(c).toBe(d)
  })
})
