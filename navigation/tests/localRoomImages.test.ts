import {
  LOCAL_ROOM_IMAGES,
  resolveLocalRoomImage,
  slugify,
} from '@/lib/blueprint/localRoomImages'

describe('LOCAL_ROOM_IMAGES', () => {
  it('lists the files present under public/rooms/', () => {
    expect([...LOCAL_ROOM_IMAGES].sort()).toEqual([
      'bedroom.jpeg',
      'hall_room.jpeg',
      'living_room.jpeg',
    ])
  })
})

describe('slugify', () => {
  it('normalises spacing, casing, separators and extensions consistently', () => {
    expect(slugify('Master Bedroom')).toBe('master bedroom')
    expect(slugify('living_room')).toBe('living room')
    expect(slugify('Hall-Room')).toBe('hall room')
  })

  it('strips image extensions so filenames and room names normalise alike', () => {
    expect(slugify('living_room.jpeg')).toBe(slugify('Living Room'))
    expect(slugify('bedroom.jpeg')).toBe(slugify('Bedroom'))
    expect(slugify('hall_room.jpeg')).toBe(slugify('Hall Room'))
  })

  it('collapses runs of punctuation and trims edges', () => {
    expect(slugify('  Living   Room!!  ')).toBe('living room')
    expect(slugify('')).toBe('')
  })
})

describe('resolveLocalRoomImage', () => {
  it('resolves a living room from either its id or its name', () => {
    expect(resolveLocalRoomImage('living', 'Living Room')).toBe('/rooms/living_room.jpeg')
    expect(resolveLocalRoomImage('living', '')).toBe('/rooms/living_room.jpeg')
    expect(resolveLocalRoomImage('livingroom', 'Living Room')).toBe('/rooms/living_room.jpeg')
  })

  it('resolves a bedroom by exact match', () => {
    expect(resolveLocalRoomImage('bedroom', 'Bedroom')).toBe('/rooms/bedroom.jpeg')
  })

  it('resolves "hall" -> hall_room via the prefix/stem match', () => {
    expect(resolveLocalRoomImage('hall', 'Hallway')).toBe('/rooms/hall_room.jpeg')
  })

  it('resolves "hallway" -> hall_room via the prefix/stem match', () => {
    expect(resolveLocalRoomImage('hallway', 'Hallway')).toBe('/rooms/hall_room.jpeg')
  })

  // ─── False-positive guards ─────────────────────────────────────────────────

  it('returns null for a kitchen — nothing under public/rooms/ depicts one', () => {
    expect(resolveLocalRoomImage('kitchen', 'Kitchen')).toBeNull()
  })

  it('does not match a bathroom to bedroom or to *_room via the shared "room" token', () => {
    expect(resolveLocalRoomImage('bathroom', 'Bathroom')).toBeNull()
    expect(resolveLocalRoomImage('bath', 'Bath Room')).toBeNull()
  })

  it('does not let the generic "room" token alone pull in an unrelated file', () => {
    expect(resolveLocalRoomImage('dining', 'Dining Room')).toBeNull()
    expect(resolveLocalRoomImage('study', 'Study Room')).toBeNull()
    expect(resolveLocalRoomImage('garage', 'Garage')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(resolveLocalRoomImage('', '')).toBeNull()
  })

  it('is deterministic — repeated calls give the same answer', () => {
    const first = resolveLocalRoomImage('living', 'Living Room')
    expect(resolveLocalRoomImage('living', 'Living Room')).toBe(first)
  })

  it('handles Title Case names with extra qualifiers', () => {
    expect(resolveLocalRoomImage('bedroom', 'Master Bedroom')).toBe('/rooms/bedroom.jpeg')
  })
})
