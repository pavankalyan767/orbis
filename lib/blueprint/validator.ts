import type { FloorPlan, Room, Wall, Exit } from '@/navigation/types'

export type ValidationResult =
  | { ok: true; floorPlan: FloorPlan }
  | { ok: false; errors: string[] }

export function validateFloorPlan(raw: unknown): ValidationResult {
  const errors: string[] = []

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['Root value must be an object'] }
  }

  const obj = raw as Record<string, unknown>

  // Populated by the rooms pass, consumed by the referential checks below.
  const roomIds = new Set<string>()

  // ── rooms ─────────────────────────────────────────────────────────────────
  if (!Array.isArray(obj.rooms)) {
    errors.push('"rooms" must be an array')
  } else {
    ;(obj.rooms as unknown[]).forEach((r, i) => {
      const room = r as Record<string, unknown>
      if (!room.id || typeof room.id !== 'string') errors.push(`rooms[${i}].id missing`)
      else if (roomIds.has(room.id)) errors.push(`rooms[${i}].id "${room.id}" is duplicated`)
      else roomIds.add(room.id)
      if (!room.name || typeof room.name !== 'string') errors.push(`rooms[${i}].name missing`)
      if (!Array.isArray(room.polygon) || room.polygon.length < 3)
        errors.push(`rooms[${i}].polygon must have ≥3 points`)
      if (!isPoint(room.spawnPoint)) errors.push(`rooms[${i}].spawnPoint must be a {x,y} point`)
      else if (!isFinitePoint(room.spawnPoint))
        errors.push(`rooms[${i}].spawnPoint coordinates must be finite numbers`)
      if (!Array.isArray(room.exits)) errors.push(`rooms[${i}].exits must be an array`)
      else {
        ;(room.exits as unknown[]).forEach((e, j) => {
          const exit = e as Record<string, unknown>
          if (!exit.id || typeof exit.id !== 'string') errors.push(`rooms[${i}].exits[${j}].id missing`)
          if (!exit.roomId) errors.push(`rooms[${i}].exits[${j}].roomId missing`)
          if (!exit.targetRoomId) errors.push(`rooms[${i}].exits[${j}].targetRoomId missing`)
          if (!isRect(exit.bounds)) errors.push(`rooms[${i}].exits[${j}].bounds must be {x,y,width,height}`)
        })
      }
    })
  }

  // ── walls ─────────────────────────────────────────────────────────────────
  if (!Array.isArray(obj.walls)) {
    errors.push('"walls" must be an array')
  } else {
    ;(obj.walls as unknown[]).forEach((w, i) => {
      const wall = w as Record<string, unknown>
      if (!wall.id || typeof wall.id !== 'string') errors.push(`walls[${i}].id missing`)
      if (!isPoint(wall.start)) errors.push(`walls[${i}].start must be a {x,y} point`)
      if (!isPoint(wall.end)) errors.push(`walls[${i}].end must be a {x,y} point`)
      if (typeof wall.thickness !== 'number') errors.push(`walls[${i}].thickness must be a number`)
    })
  }

  // ── graph integrity ───────────────────────────────────────────────────────
  // Only meaningful once the structural pass produced a usable room list.
  if (Array.isArray(obj.rooms)) {
    const rooms = obj.rooms as Record<string, unknown>[]

    // Exits keyed by owning room id, used for the reciprocity check.
    const exitsByRoom = new Map<string, Exit[]>()
    for (const room of rooms) {
      if (typeof room.id !== 'string') continue
      const exits = Array.isArray(room.exits) ? (room.exits as Exit[]) : []
      exitsByRoom.set(room.id, exits)
    }

    rooms.forEach((room, i) => {
      if (!Array.isArray(room.exits)) return
      ;(room.exits as Exit[]).forEach((exit, j) => {
        const target = exit?.targetRoomId
        if (typeof target !== 'string' || target.length === 0) return // already reported

        if (!roomIds.has(target)) {
          errors.push(
            `rooms[${i}].exits[${j}].targetRoomId "${target}" does not match any room id`,
          )
          return
        }

        // Reciprocity: every doorway must be traversable in both directions.
        // Bounds/id mismatches are tolerated — only a completely missing return
        // exit is an error, because that strands the player in the target room.
        const owner = typeof room.id === 'string' ? room.id : null
        if (!owner) return
        const back = exitsByRoom.get(target) ?? []
        const hasReturn = back.some((e) => e?.targetRoomId === owner)
        if (!hasReturn) {
          errors.push(
            `rooms[${i}].exits[${j}]: room "${target}" has no exit back to "${owner}"`,
          )
        }
      })
    })
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, floorPlan: raw as FloorPlan }
}

function isFinitePoint(v: unknown): boolean {
  const p = v as Record<string, unknown>
  return Number.isFinite(p.x) && Number.isFinite(p.y)
}

function isPoint(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const p = v as Record<string, unknown>
  return typeof p.x === 'number' && typeof p.y === 'number'
}

function isRect(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.x === 'number' &&
    typeof r.y === 'number' &&
    typeof r.width === 'number' &&
    typeof r.height === 'number'
  )
}
