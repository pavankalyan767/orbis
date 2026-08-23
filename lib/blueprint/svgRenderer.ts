import type { FloorPlan, Room, Wall, Exit, Point } from '@/navigation/types'

// ─── Config ───────────────────────────────────────────────────────────────────

const PADDING = 40           // SVG padding in px
const SCALE   = 40           // pixels per metre
const WALL_WIDTH = 3         // px
const FONT    = 'Inter, system-ui, sans-serif'

// Colour palette
const ROOM_FILL    = '#1a1f2e'
const ROOM_STROKE  = '#2d3447'
const WALL_COLOR   = '#e2e8f0'
const EXIT_FILL    = 'rgba(99,179,237,0.25)'
const EXIT_STROKE  = '#63b3ed'
const SPAWN_COLOR  = '#68d391'
const LABEL_COLOR  = '#a0aec0'
const RADIUS_COLOR = 'rgba(251,191,36,0.3)'
const BG_COLOR     = '#0d1117'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function m2px(metres: number): number {
  return metres * SCALE
}

function ptX(p: Point): number {
  return PADDING + m2px(p.x)
}

function ptY(p: Point): number {
  return PADDING + m2px(p.y)
}

function polygonPoints(pts: Point[]): string {
  return pts.map((p) => `${ptX(p)},${ptY(p)}`).join(' ')
}

function centroid(pts: Point[]): Point {
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const y = pts.reduce((s, p) => s + p.y, 0) / pts.length
  return { x, y }
}

function computeBounds(fp: FloorPlan): { width: number; height: number } {
  let maxX = 0, maxY = 0
  for (const room of fp.rooms) {
    for (const pt of room.polygon) {
      if (pt.x > maxX) maxX = pt.x
      if (pt.y > maxY) maxY = pt.y
    }
  }
  return {
    width:  PADDING * 2 + m2px(maxX),
    height: PADDING * 2 + m2px(maxY),
  }
}

// ─── Renderers ────────────────────────────────────────────────────────────────

function renderRoom(room: Room): string {
  const c = centroid(room.polygon)
  return `
  <!-- Room: ${room.id} -->
  <polygon
    points="${polygonPoints(room.polygon)}"
    fill="${ROOM_FILL}"
    stroke="${ROOM_STROKE}"
    stroke-width="1"
  />
  <!-- spawn point -->
  <circle
    cx="${ptX(room.spawnPoint)}"
    cy="${ptY(room.spawnPoint)}"
    r="${m2px(0.3)}"
    fill="${RADIUS_COLOR}"
    stroke="${SPAWN_COLOR}"
    stroke-width="1.5"
    stroke-dasharray="4 2"
  />
  <circle
    cx="${ptX(room.spawnPoint)}"
    cy="${ptY(room.spawnPoint)}"
    r="3"
    fill="${SPAWN_COLOR}"
  />
  <!-- label -->
  <text
    x="${ptX(c)}"
    y="${ptY(c)}"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="${FONT}"
    font-size="11"
    fill="${LABEL_COLOR}"
    font-weight="600"
    letter-spacing="0.05em"
  >${room.name.toUpperCase()}</text>`
}

function renderExit(exit: Exit): string {
  const b = exit.bounds
  return `
  <!-- Exit: ${exit.id} -->
  <rect
    x="${ptX({ x: b.x, y: 0 })}"
    y="${ptY({ x: 0, y: b.y })}"
    width="${m2px(b.width)}"
    height="${m2px(b.height)}"
    fill="${EXIT_FILL}"
    stroke="${EXIT_STROKE}"
    stroke-width="1"
    stroke-dasharray="4 2"
    rx="2"
  />`
}

function renderWall(wall: Wall): string {
  return `
  <!-- Wall: ${wall.id} -->
  <line
    x1="${ptX(wall.start)}"
    y1="${ptY(wall.start)}"
    x2="${ptX(wall.end)}"
    y2="${ptY(wall.end)}"
    stroke="${WALL_COLOR}"
    stroke-width="${WALL_WIDTH}"
    stroke-linecap="round"
  />`
}

function renderLegend(svgWidth: number, svgHeight: number): string {
  const items = [
    { color: ROOM_FILL,   stroke: ROOM_STROKE, label: 'Room polygon' },
    { color: EXIT_FILL,   stroke: EXIT_STROKE,  label: 'Exit / doorway trigger' },
    { color: RADIUS_COLOR,stroke: SPAWN_COLOR,  label: 'Player spawn + 0.3m radius' },
  ]
  const startX = 16, startY = svgHeight - 16 - items.length * 20
  return `
  <g font-family="${FONT}" font-size="10" fill="${LABEL_COLOR}">
    <text x="${startX}" y="${startY - 6}" font-size="9" opacity="0.6" letter-spacing="0.08em">COLLISION GEOMETRY VIEW</text>
    ${items.map((item, i) => `
      <rect x="${startX}" y="${startY + i * 20}" width="12" height="12"
        fill="${item.color}" stroke="${item.stroke}" stroke-width="1" rx="2"/>
      <text x="${startX + 18}" y="${startY + i * 20 + 9}">${item.label}</text>
    `).join('')}
    <line x1="${startX}" y1="${startY + items.length * 20 + 4}"
          x2="${startX + 30}" y2="${startY + items.length * 20 + 4}"
          stroke="${WALL_COLOR}" stroke-width="3" stroke-linecap="round"/>
    <text x="${startX + 36}" y="${startY + items.length * 20 + 8}">Wall segment</text>
  </g>`
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Converts a FloorPlan into an SVG string showing exactly what the
 * CollisionEngine and ExitDetector see:
 *   - Room polygons
 *   - Wall segments (with doorway gaps)
 *   - Exit trigger rectangles
 *   - Spawn points with player-radius reference circles
 *
 * The SVG is dark-themed and self-contained (no external assets).
 */
export function floorPlanToSVG(fp: FloorPlan): string {
  const { width, height } = computeBounds(fp)

  const rooms   = fp.rooms.map(renderRoom).join('\n')
  const exits   = fp.rooms.flatMap((r) => r.exits.map(renderExit)).join('\n')
  const walls   = fp.walls.map(renderWall).join('\n')
  const legend  = renderLegend(width, height)

  // Scale ruler: 1 metre
  const rulerX = PADDING
  const rulerY = PADDING - 16
  const ruler = `
  <g font-family="${FONT}" font-size="9" fill="${LABEL_COLOR}" opacity="0.5">
    <line x1="${rulerX}" y1="${rulerY}" x2="${rulerX + SCALE}" y2="${rulerY}"
          stroke="${LABEL_COLOR}" stroke-width="1"/>
    <line x1="${rulerX}" y1="${rulerY - 3}" x2="${rulerX}" y2="${rulerY + 3}"
          stroke="${LABEL_COLOR}" stroke-width="1"/>
    <line x1="${rulerX + SCALE}" y1="${rulerY - 3}" x2="${rulerX + SCALE}" y2="${rulerY + 3}"
          stroke="${LABEL_COLOR}" stroke-width="1"/>
    <text x="${rulerX + SCALE / 2}" y="${rulerY - 5}" text-anchor="middle">1 m</text>
  </g>`

  return `<svg
  xmlns="http://www.w3.org/2000/svg"
  width="${width}"
  height="${height}"
  viewBox="0 0 ${width} ${height}"
>
  <rect width="100%" height="100%" fill="${BG_COLOR}"/>
  ${ruler}
  ${rooms}
  ${exits}
  ${walls}
  ${legend}
</svg>`
}
