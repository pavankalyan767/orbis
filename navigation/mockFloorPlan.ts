import type { FloorPlan } from './types'

/**
 * Mock floor plan — a small 4-room house used for development and testing.
 *
 * Coordinate system: metres, origin at top-left corner of the house.
 * Y grows downward (standard 2-D screen / SVG convention).
 *
 * Layout (approximate, not to exact scale):
 *
 *   (0,0)          (10,0)   (16,0)
 *     ┌──────────────┬────────┐
 *     │              │        │
 *     │   LIVING     │ KITCHEN│
 *     │   (0–10 x)   │(10–16 x)
 *     │   (0–6  y)   │(0–6  y)│
 *     │              │        │
 *   (0,6)          (10,6)   (16,6)
 *     ├────┬─────────┴────────┤
 *     │    │                  │
 *     │HALL│    BEDROOM       │
 *     │(0–4│   (4–16 x)       │
 *     │  x)│   (6–12 y)       │
 *     │    │                  │
 *   (0,12) (4,12)           (16,12)
 *     └────┴──────────────────┘
 *
 * Doors (exit rectangles, 1 m wide):
 *   living  ↔ kitchen  :  x=9.5–10.5, y=2.5–3.5   (on the shared vertical wall)
 *   living  ↔ hall     :  x=1.5–2.5,  y=5.5–6.5   (on the shared horizontal wall)
 *   kitchen ↔ bedroom  :  x=9.5–10.5, y=5.5–6.5   (lower-right corner area)
 *   hall    ↔ bedroom  :  x=3.5–4.5,  y=8.5–9.5   (on the shared vertical wall)
 */
export const mockFloorPlan: FloorPlan = {
  rooms: [
    {
      id: 'living',
      name: 'Living Room',
      polygon: [
        { x: 0,  y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 6 },
        { x: 0,  y: 6 },
      ],
      spawnPoint: { x: 5, y: 3 },
      exits: [
        {
          id: 'living-kitchen',
          roomId: 'living',
          targetRoomId: 'kitchen',
          bounds: { x: 9.5, y: 2.5, width: 1, height: 1 },
        },
        {
          id: 'living-hall',
          roomId: 'living',
          targetRoomId: 'hall',
          bounds: { x: 1.5, y: 5.5, width: 1, height: 1 },
        },
      ],
    },
    {
      id: 'kitchen',
      name: 'Kitchen',
      polygon: [
        { x: 10, y: 0  },
        { x: 16, y: 0  },
        { x: 16, y: 6  },
        { x: 10, y: 6  },
      ],
      spawnPoint: { x: 13, y: 3 },
      exits: [
        {
          id: 'kitchen-living',
          roomId: 'kitchen',
          targetRoomId: 'living',
          bounds: { x: 9.5, y: 2.5, width: 1, height: 1 },
        },
        {
          id: 'kitchen-bedroom',
          roomId: 'kitchen',
          targetRoomId: 'bedroom',
          bounds: { x: 9.5, y: 5.5, width: 1, height: 1 },
        },
      ],
    },
    {
      id: 'hall',
      name: 'Hallway',
      polygon: [
        { x: 0, y: 6  },
        { x: 4, y: 6  },
        { x: 4, y: 12 },
        { x: 0, y: 12 },
      ],
      spawnPoint: { x: 2, y: 9 },
      exits: [
        {
          id: 'hall-living',
          roomId: 'hall',
          targetRoomId: 'living',
          bounds: { x: 1.5, y: 5.5, width: 1, height: 1 },
        },
        {
          id: 'hall-bedroom',
          roomId: 'hall',
          targetRoomId: 'bedroom',
          bounds: { x: 3.5, y: 8.5, width: 1, height: 1 },
        },
      ],
    },
    {
      id: 'bedroom',
      name: 'Bedroom',
      polygon: [
        { x: 4,  y: 6  },
        { x: 16, y: 6  },
        { x: 16, y: 12 },
        { x: 4,  y: 12 },
      ],
      spawnPoint: { x: 10, y: 9 },
      exits: [
        {
          id: 'bedroom-hall',
          roomId: 'bedroom',
          targetRoomId: 'hall',
          bounds: { x: 3.5, y: 8.5, width: 1, height: 1 },
        },
        {
          id: 'bedroom-kitchen',
          roomId: 'bedroom',
          targetRoomId: 'kitchen',
          bounds: { x: 9.5, y: 5.5, width: 1, height: 1 },
        },
      ],
    },
  ],

  // Walls are listed as segments. Interior walls are duplicated for each room
  // they border, but the collision engine treats them all globally.
  walls: [
    // ── Outer perimeter ──────────────────────────────────────────────────────
    { id: 'w-top',        start: { x: 0,  y: 0  }, end: { x: 16, y: 0  }, thickness: 0.2 },
    { id: 'w-right',      start: { x: 16, y: 0  }, end: { x: 16, y: 12 }, thickness: 0.2 },
    { id: 'w-bottom',     start: { x: 0,  y: 12 }, end: { x: 16, y: 12 }, thickness: 0.2 },
    { id: 'w-left',       start: { x: 0,  y: 0  }, end: { x: 0,  y: 12 }, thickness: 0.2 },

    // ── Interior: living / kitchen vertical wall (with door gap at y=2.5–3.5) ─
    { id: 'w-lk-top',    start: { x: 10, y: 0   }, end: { x: 10, y: 2.5 }, thickness: 0.2 },
    { id: 'w-lk-bot',    start: { x: 10, y: 3.5 }, end: { x: 10, y: 6   }, thickness: 0.2 },

    // ── Interior: living–hall / kitchen–bedroom horizontal wall ─────────────
    // Left segment (living/hall boundary) — door gap at x=1.5–2.5
    { id: 'w-lh-left',   start: { x: 0,   y: 6 }, end: { x: 1.5, y: 6  }, thickness: 0.2 },
    { id: 'w-lh-right',  start: { x: 2.5, y: 6 }, end: { x: 9.5, y: 6  }, thickness: 0.2 },
    // Right segment (kitchen/bedroom boundary) — door gap at x=9.5–10.5
    { id: 'w-kb-left',   start: { x: 9.5,  y: 6 }, end: { x: 10.5, y: 6 }, thickness: 0.2 },
    // Actually the gap IS at 9.5–10.5, so:
    { id: 'w-kb-right',  start: { x: 10.5, y: 6 }, end: { x: 16,   y: 6 }, thickness: 0.2 },

    // ── Interior: hall / bedroom vertical wall — door gap at y=8.5–9.5 ──────
    { id: 'w-hb-top',    start: { x: 4, y: 6   }, end: { x: 4, y: 8.5 }, thickness: 0.2 },
    { id: 'w-hb-bot',    start: { x: 4, y: 9.5 }, end: { x: 4, y: 12  }, thickness: 0.2 },
  ],
}
