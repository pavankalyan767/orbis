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

  // ── rooms ─────────────────────────────────────────────────────────────────
  if (!Array.isArray(obj.rooms)) {
    errors.push('"rooms" must be an array')
  } else {
    const roomIds = new Set<string>()
    ;(obj.rooms as unknown[]).forEach((r, i) => {
      const room = r as Record<string, unknown>
      if (!room.id || typeof room.id !== 'string') errors.push(`rooms[${i}].id missing`)
      else roomIds.add(room.id as string)
      if (!room.name || typeof room.name !== 'string') errors.push(`rooms[${i}].name missing`)
      if (!Array.isArray(room.polygon) || room.polygon.length < 3)
        errors.push(`rooms[${i}].polygon must have ≥3 points`)
      if (!isPoint(room.spawnPoint)) errors.push(`rooms[${i}].spawnPoint must be a {x,y} point`)
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

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, floorPlan: raw as FloorPlan }
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
