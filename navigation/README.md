# Navigation — Deterministic Spatial Navigation Engine

**Part of the ArchWorld hackathon project.**

This package is the authoritative navigation layer for the simulated building.  
It is **completely independent of Reactor, WebRTC, React, or any external API**.

---

## Overview

```
FloorPlan  +  movement commands
        ↓
  NavigationEngine
        ↓
  updated PlayerState  +  RoomTransition events
```

The player is modelled as a 2-D circle navigating a floor plan made of rooms and wall segments.  
On each game-loop tick the engine:

1. Runs a **circle-vs-segment collision check** against every wall.  
2. If the move is valid, updates the player's logical position.  
3. Checks whether the player's position is inside any **exit rectangle**.  
4. If an exit is crossed (for the first time — debounced), fires a `RoomTransition` event.

---

## File Structure

```
navigation/
├── types.ts            — shared data contracts (Point, Wall, Exit, Room, FloorPlan, …)
├── mockFloorPlan.ts    — 4-room demo house (living, kitchen, hall, bedroom)
├── RoomGraph.ts        — room connectivity graph (getRoom, getNeighbors, getExit)
├── PlayerState.ts      — authoritative player position (x, y, yaw, roomId)
├── CollisionEngine.ts  — 2-D wall collision (circle vs. line segment)
├── ExitDetector.ts     — doorway crossing detection (fires once per crossing)
├── NavigationEngine.ts — full pipeline orchestrator (public API)
└── tests/
    ├── roomGraph.test.ts
    ├── collision.test.ts
    └── exitDetector.test.ts
```

---

## Quick Start

```ts
import { NavigationEngine } from '@/navigation/NavigationEngine'
import { mockFloorPlan }    from '@/navigation/mockFloorPlan'

// Spawn the player in the living room at its default spawn point
const nav = new NavigationEngine(
  mockFloorPlan,
  'living',
  mockFloorPlan.rooms.find(r => r.id === 'living')!.spawnPoint.x,
  mockFloorPlan.rooms.find(r => r.id === 'living')!.spawnPoint.y,
)

// Register for room-transition events (Prem: wire this to the Reactor world-switcher)
nav.onRoomTransition(({ fromRoomId, toRoomId, exitId }) => {
  console.log(`ROOM_CHANGED: ${fromRoomId} → ${toRoomId} (via ${exitId})`)
  // TODO (Prem): stop current Reactor session, attach target room world
})

// Call once per animation frame / game loop tick
function tick(dx: number, dy: number, deltaYaw: number) {
  const result = nav.update(dx, dy, deltaYaw)

  if (!result.allowed) {
    // Wall collision — player did not move
  }

  if (result.transition) {
    // Room transition was emitted — nav.getState().roomId is already updated
  }

  const state = nav.getState()
  // { roomId, x, y, yaw, radius }
}
```

---

## Integration Contract

### Input (from Pavan's blueprint pipeline)

The engine accepts any `FloorPlan` that conforms to the schema in `types.ts`:

```ts
type FloorPlan = {
  rooms: Room[]   // each with id, name, polygon, exits, spawnPoint
  walls: Wall[]   // each with id, start, end, thickness
}
```

As long as Pavan's parser produces this structure the navigation engine works without changes.

### Output (consumed by Prem's Reactor integration)

```ts
type RoomTransition = {
  fromRoomId: string
  toRoomId: string
  exitId: string
}
```

Prem wires `onRoomTransition` to the Reactor world-switcher:

```text
ROOM_CHANGED: living → hall
  ↓
stop current Reactor session
disconnect
attach hall world
start hall world
reset player state to hall spawn point
```

---

## Running Tests

```bash
npm test
```

All 37 tests should pass in ~0.3 s.

---

## Coordinate System

- **Origin**: top-left corner of the house.  
- **Units**: metres.  
- **Y-axis**: grows downward (standard 2-D floor-plan / SVG convention).  
- **Mock house dimensions**: 16 m × 12 m.

---

## Known Limitations

- Collision is 2-D only (no vertical/floor height).  
- Room polygons are stored but collision uses the wall segment list — the player can theoretically walk outside polygon bounds if a wall segment is missing. Pavan's validator should ensure wall coverage.  
- Exit bounds are axis-aligned rectangles; non-rectangular doorways are not supported in v1.  
- Object collision (furniture) is not implemented — walls only.  
- No pathfinding — navigation is purely player-driven via WASD.

---

## Task Board Reference

| Task | Status |
|---|---|
| T06 — Room graph | ✅ Done |
| T07 — Player state | ✅ Done |
| T08 — Collision + exit detector | ✅ Done |
