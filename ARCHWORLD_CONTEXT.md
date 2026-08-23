# ArchWorld — Hackathon Engineering Context & Execution Plan

> **Single source of truth for the current implementation.**
>
> Read this file before changing architecture, adding features, or picking tasks.
> Do not silently expand scope. Prefer a smaller working vertical slice over a larger incomplete system.

---

## 0. Product

### Working concept

**Experience your building before you build it.**

We turn an architectural plan into immersive, room-level, AI-generated walkthroughs. The user explores the proposed space manually with WASD, reviews it, writes design feedback, and finalizes a batch of changes. An Architect Agent converts feedback into structured design operations, deterministic code applies and validates those operations, and the affected room(s) are regenerated for another walkthrough.

### Core loop

```text
BLUEPRINT
   ↓
ARCHITECTURAL DIGITAL TWIN
   ↓
ROOM WORLDS
   ↓
USER EXPLORES WITH WASD
   ↓
USER CRITIQUES DESIGN
   ↓
BATCH FEEDBACK
   ↓
ARCHITECT AGENT
   ↓
STRUCTURED DESIGN CHANGES
   ↓
DETERMINISTIC MUTATION + VALIDATION
   ↓
UPDATED DIGITAL TWIN
   ↓
REGENERATE AFFECTED ROOM(S)
   ↓
USER EXPLORES VERSION 2
```

### Key positioning

> **We don't ask a world model to understand architecture — we give it an architectural digital twin to obey.**

The world model is the visualization/immersion layer. It is **not** the authoritative architectural, geometry, collision, or navigation engine.

---

# 1. Current Product Scope

## Build now

- One small demo house.
- 3–4 rooms maximum.
- User navigates with WASD/mouse.
- Each room has its own Reactor world/session.
- Room transitions are controlled by our deterministic room graph.
- User submits **text feedback** for a room.
- Multiple feedback items are accumulated.
- Room is regenerated **once after the user finalizes that room's feedback**.
- One Architect Agent with tools.
- Deterministic FloorPlan mutation and validation.
- Before/after floor-plan visualization.
- Optional contextual voice as an enhancement, not a dependency.

## Do NOT build for the hackathon

- Full CAD/BIM replacement.
- Full physics engine.
- Construction-ready engineering drawings.
- Arbitrary 3D geometry editing.
- Voice-controlled WASD navigation.
- Multi-agent runtime swarm.
- Regeneration after every individual feedback item.
- One giant Reactor world for the entire house.
- Full Revit/IFC/DXF integration.
- Perfect architectural parsing for arbitrary plans.
- Complex authentication/business logic.
- Mobile UI.

---

# 2. Architectural Principles

## Principle 1 — Digital Twin is the source of truth

The canonical state is our own structured `FloorPlan`.

Reactor never becomes the source of truth.

```text
                 FLOORPLAN / DIGITAL TWIN
                         │
        ┌────────────────┼─────────────────┐
        ↓                ↓                 ↓
    Geometry         Navigation         Design
        │                │              changes
        ↓                ↓                 ↓
    Collision        Player state       Agent
        │                │                 │
        └────────────────┼─────────────────┘
                         ↓
                   REACTOR WORLD
                         ↓
                     VISUALS
```

## Principle 2 — Human navigates

The user is responsible for exploration.

Do NOT build:

```text
"Take me to kitchen"
      ↓
LLM presses W/A/S/D
```

Instead:

```text
Human
  ↓
WASD / mouse
  ↓
deterministic navigation
  ↓
Reactor
```

The AI helps explain the space and process design feedback.

## Principle 3 — AI decides WHAT, code decides HOW

The Architect Agent may output:

```json
{
  "operation": "resize_room",
  "room_id": "kitchen",
  "direction": "west",
  "amount": 1.0
}
```

It must not write arbitrary Python/TypeScript or directly mutate the geometry.

Deterministic services apply and validate the change.

## Principle 4 — Bound Reactor to one room

Use:

```text
Living Room → Reactor World A
Hallway     → Reactor World B
Kitchen     → Reactor World C
Bedroom     → Reactor World D
```

This limits visual drift/hallucination.

## Principle 5 — Pre-generate where possible

Generate room worlds asynchronously ahead of the live walkthrough.

At runtime prioritize:

- switching worlds
- navigation
- feedback capture
- state management

Avoid blocking the user while expensive world generation occurs.

---

# 3. Architectural Digital Twin

For the hackathon, "digital twin" means:

> A structured, machine-readable representation of the proposed building that our application treats as authoritative.

It does NOT need to be full BIM.

Example:

```ts
type FloorPlan = {
  houseId: string;
  version: number;
  units: "meters";
  dimensions: {
    width: number;
    height: number;
  };
  rooms: Room[];
  walls: Wall[];
  doors: Door[];
  windows: Window[];
  objects: ArchitecturalObject[];
  exits: Exit[];
};
```

Minimum required semantics:

### Room

```ts
type Room = {
  id: string;
  name: string;
  bounds: Polygon;
  exits: string[];
  objects: string[];
};
```

### Wall

```ts
type Wall = {
  id: string;
  roomId: string;
  start: Point;
  end: Point;
  thickness: number;
};
```

### Door

```ts
type Door = {
  id: string;
  roomId: string;
  wallId: string;
  position: Point;
  width: number;
  targetRoomId?: string;
};
```

### Window

```ts
type Window = {
  id: string;
  roomId: string;
  wallId: string;
  position: Point;
  width: number;
  height: number;
};
```

### Object

```ts
type ArchitecturalObject = {
  id: string;
  roomId: string;
  type: string;
  position: Point;
  rotation: number;
  bounds: Bounds;
};
```

---

# 4. Current Runtime Architecture

```text
                         USER
                          │
              ┌───────────┴───────────┐
              │                       │
             WASD                 TEXT FEEDBACK
              │                       │
              ▼                       ▼
     Movement Controller        Architect Agent
              │                       │
              ▼                       │
       Collision Engine              │
              │                       │
       ┌──────┴──────┐                │
       │             │                │
     BLOCK         ALLOW              │
       │             │                │
       X             ▼                │
               Player State           │
                     │                │
               Exit Detector         │
                     │                │
               World Manager          │
                     │                │
                     ▼                │
               Reactor Adapter        │
                     │                │
                     ▼                │
                Reactor World         │
                     │                │
                   WebRTC             │
                     │                │
                  Video               │
                     │                │
                     └──────→ USER    │
                                      │
                       ┌──────────────┘
                       ↓
                DesignChange[]
                       ↓
              FloorPlan Mutator
                       ↓
               FloorPlan Validator
                       ↓
                  FloorPlan v2
                       ↓
              affected room(s)
                       ↓
                Reactor World v2
```

---

# 5. Reactor Integration

## Preferred initial model: Happy Oyster

Use Happy Oyster first for the room runtime because its first-person Adventure/session abstraction is a good fit for room-by-room exploration.

Expected high-level lifecycle:

```text
connect(jwt)
     ↓
createWorld(...) / attachWorld(...)
     ↓
startTravel(...)
     ↓
move / look / interact
     ↓
stop / disconnect
```

Worlds are persistent and can be reopened using their world ID.

### Room model

Store:

```ts
type RoomWorld = {
  roomId: string;
  reactorWorldId: string;
  referenceImage: string;
  prompt: string;
  spawnPoint: Point;
};
```

## Reactor adapter

Do NOT couple the application directly to Reactor SDK calls.

Create:

```ts
interface WorldAdapter {
  createRoomWorld(spec: RoomWorldSpec): Promise<RoomWorld>;
  attachWorld(worldId: string): Promise<void>;
  start(): Promise<void>;
  move(direction: MovementDirection): void;
  look(delta: LookDelta): void;
  stop(): void;
  disconnect(): Promise<void>;
}
```

Current implementation:

```text
WorldAdapter
   ↓
HappyOysterAdapter
```

Future option:

```text
WorldAdapter
   ├── HappyOysterAdapter
   └── LingBotWorld2Adapter
```

This keeps the rest of the system independent of one model.

---

# 6. LingBot World 2 Knowledge

We also investigated LingBot World 2 and the browser implementation.

The current API exposes movement/look controls conceptually along these lines:

```text
setMoveLongitudinal
setMoveLateral
setLookHorizontal
setLookVertical
setRotationSpeedDeg
```

The browser uses a WebRTC data channel for control and a WebRTC video track for generated video.

Our browser logs confirmed commands are sent by the Reactor frontend through the WebRTC control path.

Important:

**Do not reverse-engineer raw WebRTC packets for the app.**
Use the official SDK/API.

The browser investigation is useful for understanding the model transport and movement semantics, not for defining our implementation dependency.

---

# 7. Reactor Authentication

Long-lived API keys must stay server-side.

Target flow:

```text
Browser
   ↓
Next.js backend/token route
   ↓
Reactor credentials
   ↓
short-lived client token
   ↓
Browser
   ↓
Reactor SDK
```

Never expose the long-lived Reactor API key in client-side code.

Keep secrets in environment variables.

---

# 8. WASD Navigation

## Player state

```ts
type PlayerState = {
  roomId: string;
  x: number;
  y: number;
  yaw: number;
  radius: number;
};
```

Our app owns this state.

Do NOT infer it from Reactor video.

## Movement pipeline

```text
Keyboard event
     ↓
candidate position
     ↓
collision checks
     ↓
ALLOW / BLOCK
```

If blocked:

```text
Do not update player position.
Do not issue movement.
```

If allowed:

```text
Update local player state.
Issue Reactor movement command.
```

## MVP collision model

- player = circle
- walls = line segments/polygons
- furniture = rectangles
- room = polygon/boundary
- exits = trigger regions

Only implement:

1. wall collision
2. object collision
3. room boundary
4. exit detection

No full 3D physics.

---

# 9. Room Transitions

Each room has predefined exits:

```ts
type Exit = {
  id: string;
  roomId: string;
  targetRoomId: string;
  bounds: Polygon;
};
```

When local player state enters an exit region:

```text
Living Room
     ↓
ExitDetector
     ↓
room transition event
     ↓
stop current Reactor movement
     ↓
disconnect current session
     ↓
attach target room world
     ↓
start target travel
     ↓
reset player state to target spawn
```

Important distinction:

- `stop()` = stop active movement/look state
- `disconnect()` = terminate live Reactor session
- `attachWorld()` = reconnect to an existing saved world

Do not generate a new world just because the user walked back into an existing room.

---

# 10. One Architect Agent

Use ONE runtime Architect Agent.

Do not build three independent autonomous agents.

The agent has tools with narrowly defined contracts:

```text
parse_blueprint()
apply_feedback()
prepare_room()
```

The same agent can reason about:

```text
Blueprint → FloorPlan
FloorPlan + user feedback → DesignChanges
FloorPlan → Room visualization spec
```

Why one agent:

- shared architectural context
- easier debugging
- fewer coordination failures
- simpler state management
- lower latency
- easier hackathon execution

Specialization should come from tools and schemas, not three separate autonomous loops.

---

# 11. Architect Agent Tools

## Tool 1 — parse_blueprint

### Input

```text
blueprint image/PDF
```

### Output

```text
validated FloorPlan
```

### Acceptance test

Given the chosen demo blueprint, produce all expected demo rooms/walls/doors/windows.

---

## Tool 2 — apply_feedback

### Input

```text
Current FloorPlan
+
batched user feedback
```

### Output

```text
DesignChange[]
```

Supported MVP operations:

```text
move_object
resize_room
move_wall
add_window
```

### Example

Input:

> "Move the TV to the opposite wall."

Output:

```json
{
  "operation": "move_object",
  "object_id": "tv",
  "target_wall": "south"
}
```

---

## Tool 3 — prepare_room

### Input

```text
FloorPlan
+
room_id
```

### Output

```text
RoomWorldSpec
```

Containing:

- room description
- architectural constraints
- room objects
- style
- camera/spawn specification
- seed/reference-image prompt
- Reactor world prompt

---

# 12. Feedback UX

Voice input is NOT required for MVP.

The user should write feedback.

Example:

```text
Living Room — Feedback

1. Move the TV to the opposite wall.
2. Make the garden window wider.
3. The room feels cramped.
4. Add another power outlet near the TV.

[ Apply changes ]
```

All feedback gets accumulated.

Do NOT regenerate after every sentence.

The flow is:

```text
Room v1
  ↓
feedback 1
feedback 2
feedback 3
feedback 4
  ↓
Apply Changes
  ↓
Architect Agent
  ↓
DesignChanges
  ↓
Mutate + Validate
  ↓
Room v2
```

This reduces generation cost/latency and gives the demo a strong Version 1 → Version 2 story.

---

# 13. FloorPlan Mutator

The LLM must not directly mutate geometry.

The mutator receives validated operations.

Example:

```ts
applyDesignChanges(
  floorPlan,
  changes
): FloorPlan
```

For:

```json
{
  "operation": "resize_room",
  "room_id": "kitchen",
  "direction": "west",
  "amount": 1
}
```

the mutator changes:

- wall coordinates
- room polygon
- dependent door/window/object coordinates
- relevant exits

Return:

```text
FloorPlan v2
```

---

# 14. FloorPlan Validator

Run after mutation and before room regeneration.

Check:

```text
rooms have positive dimensions
walls are valid
doors belong to valid walls
windows belong to valid walls
objects remain inside rooms
room connections remain valid
no illegal overlaps
no invalid coordinates
```

Invalid FloorPlan:

```text
Reject
```

Never send invalid geometry downstream to Reactor.

---

# 15. Blueprint Rendering

For the hackathon:

```text
FloorPlan JSON
     ↓
SVG
```

Render:

- walls
- rooms
- doors
- windows
- major objects
- room names
- version
- player position (optional)
- exits (debug)

This lets the judge see:

```text
VERSION 1
    ↓
feedback
    ↓
VERSION 2
```

Do NOT implement DXF/IFC/Revit now.

---

# 16. Room Reference Image Generation

For each room:

```text
FloorPlan geometry
      ↓
room visualization prompt
      ↓
reference image
      ↓
Reactor
```

The room prompt should emphasize:

- exact room boundaries
- doors/windows
- major object placement
- architectural style
- dimensions/relationships
- FPP perspective
- no invented architecture outside the provided room

The seed image is an anchor for the visual world, not the authoritative geometry.

---

# 17. Voice / Fish Audio — Phase 2 Enhancement

Voice is optional for MVP.

When credits are available, pre-generate room narration:

```text
room_intro.mp3
room_object_guide.mp3
room_transition.mp3
```

Example:

> "You are now in the living room. The television is on the north wall and the garden-facing windows are ahead."

Voice should be contextual.

It should NOT control WASD navigation.

---

# 18. Frontend

## Recommended UI

```text
┌─────────────────────────────────────────────────────┐
│ ARCHWORLD                     Living Room · V1      │
├─────────────────────────────────┬───────────────────┤
│                                 │                   │
│                                 │   FLOOR PLAN      │
│        REACTOR WORLD            │                   │
│                                 │   Room context    │
│          WASD / mouse           │   Feedback count  │
│                                 │                   │
├─────────────────────────────────┴───────────────────┤
│ Describe what you'd change...      [Apply Changes]  │
└─────────────────────────────────────────────────────┘
```

UI should feel like a premium architectural review tool, not a generic game.

### Important components

```text
ReactorView
FloorPlanView
RoomHeader
FeedbackPanel
GenerationOverlay
RoomTransition
VersionSwitcher
ConnectionStatus
```

Keep a hidden dev/debug panel showing:

```text
room
worldId
connection
player x/y/yaw
Reactor status
last command/error
```

---

# 19. Suggested Repository

```text
archworld/
├── app/
│   ├── api/
│   ├── page.tsx
│   └── ...
│
├── components/
│   ├── world/
│   ├── floorplan/
│   ├── architect/
│   └── feedback/
│
├── reactor/
│   ├── WorldAdapter.ts
│   └── HappyOysterAdapter.ts
│
├── navigation/
│   ├── PlayerState.ts
│   ├── MovementController.ts
│   ├── CollisionEngine.ts
│   └── ExitDetector.ts
│
├── architecture/
│   ├── FloorPlan.ts
│   ├── Mutator.ts
│   ├── Validator.ts
│   └── SVGRenderer.ts
│
├── agent/
│   ├── ArchitectAgent.ts
│   └── tools/
│       ├── parseBlueprint.ts
│       ├── applyFeedback.ts
│       └── prepareRoom.ts
│
├── state/
│   ├── buildingStore.ts
│   ├── playerStore.ts
│   └── worldStore.ts
│
└── tests/
```

Keep Reactor calls isolated from general application logic.

---

# 20. Team Execution

Three developers:

## Prem — UI / Reactor

Own:

- Next.js UI
- Reactor SDK
- WebRTC/video rendering through SDK
- WASD/look input
- room/world switching presentation
- feedback UI
- loading/error states
- visual polish

## Pavan — AI / Blueprint / orchestration

Own:

- FloorPlan schema
- blueprint parser
- Architect Agent
- `parse_blueprint`
- `apply_feedback`
- `prepare_room`
- room prompt/spec builder
- end-to-end AI integration

## Pranav — deterministic spatial engine

Own:

- room graph
- player state
- collision
- exit detection
- FloorPlan mutator
- FloorPlan validator
- spatial correctness
- room transition logic

### Important

Do not treat ownership as permanent.

Once someone finishes their assigned task:

```text
commit
→ merge
→ pick next unblocked task
```

---

# 21. Task Board

Every task must have:

```text
Input
Deliverable
Output
Acceptance Test
```

## P0 — critical

| ID | Task | Owner | Dependency | Target |
|---|---|---|---|---:|
| T01 | Next.js repo skeleton | Pavan | — | 10m |
| T02 | Reactor auth/session connection | Prem | T01 | 20m |
| T03 | Single Happy Oyster room rendering | Prem | T02 | 20m |
| T04 | WASD/look controls | Prem | T03 | 15m |
| T05 | FloorPlan schema + demo house | Pavan | T01 | 20m |
| T06 | Room graph | Pranav | T05 | 15m |
| T07 | Player state | Pranav | T05 | 15m |
| T08 | Collision + exit detector | Pranav | T07 | 20m |
| T09 | Room/world manager | Prem | T03,T06,T08 | 20m |
| T10 | Blueprint → FloorPlan | Pavan | T05 | 25m |
| T11 | Feedback → DesignChange[] | Pavan | T05 | 20m |
| T12 | FloorPlan mutator | Pranav | T05,T11 | 20m |
| T13 | FloorPlan validator | Pranav | T12 | 15m |
| T14 | Regenerate affected room | Pavan | T12,T13 | 25m |
| T15 | Feedback/version UI | Prem | T03,T11 | 20m |
| T16 | End-to-end integration | ALL | P0 complete | 30m |

---

# 22. Task Contract Template

Every task branch/commit should document:

```md
## Deliverable
What capability was added?

## Input
What does it consume?

## Output
What does it produce?

## Acceptance Test
How can another teammate verify it?

## Known Limitations
What is intentionally unsupported?
```

Example:

```md
## Deliverable
Feedback → structured DesignChange.

## Input
"I want the TV on the opposite wall."

## Output
{
  "operation": "move_object",
  "object_id": "tv",
  "target_wall": "south"
}

## Acceptance Test
Submit the same feedback and receive schema-valid DesignChange[].

## Known Limitations
Only move_object, resize_room, move_wall, add_window supported.
```

---

# 23. Git Workflow

Use short-lived branches:

```text
main
├── feature/reactor-room
├── feature/floorplan-schema
├── feature/collision
├── feature/architect-agent
└── feature/feedback-ui
```

Commit format:

```text
feat(scope): description
fix(scope): description
chore(scope): description
```

Examples:

```text
feat(reactor): render first Happy Oyster room
feat(nav): add deterministic exit detection
feat(agent): convert feedback to DesignChange
feat(floorplan): implement resize_room
feat(ui): add room feedback panel
```

After every merge:

```text
git pull
npm test
npm run build
```

---

# 24. Definition of Done

A task is NOT done because code exists.

A task is done when:

1. It builds.
2. It has a concrete acceptance test.
3. Another teammate can run/test it.
4. It does not break `main`.
5. Its known limitations are documented.

---

# 25. 3–4 Hour Execution Strategy

## Phase A — First 45 minutes

Goal:

```text
Reactor world works
+
FloorPlan exists
+
spatial engine exists
```

Prem:
- T02
- T03
- T04

Pavan:
- T01
- T05

Pranav:
- T06
- T07
- begin T08

## Phase B — 45–120 minutes

Goal:

```text
multi-room walkthrough
+
feedback understanding
```

Prem:
- T09
- T15

Pavan:
- T10
- T11

Pranav:
- T08
- T12

## Phase C — 120–180 minutes

Goal:

```text
feedback
→ mutation
→ validation
→ room regeneration
```

Pavan:
- T14

Pranav:
- T13

Prem:
- UI polish

## Phase D — final 30–45 minutes

STOP adding features.

Only:

```text
integration
bug fixes
demo rehearsal
deployment
```

---

# 26. Final Demo

The demo must prove one complete loop:

```text
1. Upload blueprint
        ↓
2. FloorPlan generated
        ↓
3. Room world generated
        ↓
4. Enter Living Room
        ↓
5. WASD exploration
        ↓
6. Collision works
        ↓
7. Walk through doorway
        ↓
8. New room world
        ↓
9. Submit 2–3 feedback items
        ↓
10. Apply changes
        ↓
11. Architect Agent creates DesignChanges
        ↓
12. Mutator produces FloorPlan v2
        ↓
13. Validator approves
        ↓
14. Affected room regenerates
        ↓
15. User explores Version 2
        ↓
16. Show before/after floor plan
```

This is the minimum winning story.

---

# 27. Provenance / Why We Chose This Architecture

## From Pavan

- Construction/home-design use case.
- "Let humans experience the building before construction."
- Room-level Reactor worlds after observing whole-world drift/hallucination.
- Human controls navigation with WASD.
- Voice is contextual assistance rather than navigation.
- Text feedback first; voice can be added later.
- Batch multiple feedback items before regeneration.
- Pre-generate worlds asynchronously.
- Strong emphasis on real-world usefulness and demoability.

## From Pranav

- Architect Assistant concept: blueprint → AI agent → reference images → Reactor world → user walkthrough → updated design.
- Agent-driven translation of architectural inputs into world-model prompts.
- General pattern of using AI agents as orchestration around Reactor.
- Reference-image intermediate representation.

## From teammate's architecture

- Architectural Digital Twin as source of truth.
- FloorPlan JSON.
- Local player state.
- 2D collision engine.
- Deterministic room graph.
- Exit-based room transitions.
- FloorPlan mutator.
- FloorPlan validator.
- SVG before/after visualization.
- Separation between AI decisions and deterministic geometry.
- Room-level Reactor worlds.

## From combined/system synthesis

- One Architect Agent rather than three runtime agents.
- Three tools instead of three autonomous agents.
- WorldAdapter abstraction so Happy Oyster can be swapped for LingBot later.
- Next.js-first implementation for the hackathon.
- Feedback batching.
- Room generation as an asynchronous/pre-generated asset.
- Reactor as visualization layer.
- Local application state as navigation authority.

---

# 28. Important Non-Regressions

Do NOT revert to these designs unless there is a concrete technical reason:

### Do not make Reactor the geometry authority.

### Do not make the LLM control WASD.

### Do not make every feedback item trigger generation.

### Do not create three autonomous runtime agents.

### Do not create one gigantic whole-house Reactor world.

### Do not build full BIM/CAD during the hackathon.

### Do not block the user waiting for every generation if it can be pre-generated.

### Do not send invalid AI-generated geometry to Reactor.

### Do not expose provider API keys in the browser.

---

# 29. Current Priority

When choosing the next task, use this priority:

```text
P0 — makes the end-to-end demo possible
P1 — makes the demo robust
P2 — makes the demo beautiful
P3 — future feature
```

A developer should always pick:

```text
highest-priority unblocked task
```

rather than starting a new feature.

---

# 30. Antigravity Operating Instructions

When this file is present in the repository:

1. Read this file before modifying architecture.
2. Inspect the current code before implementing a task.
3. Pick one explicit task from the task board.
4. Do not implement multiple unrelated tasks in one change.
5. Preserve existing interfaces unless there is a concrete reason to change them.
6. Prefer official Reactor SDK/API documentation over reverse-engineering.
7. When a Reactor API detail is uncertain, inspect the current official documentation before coding.
8. Keep provider-specific code behind adapters/services.
9. Add or update acceptance tests for every non-trivial task.
10. After completing a task, report:
   - task ID
   - files changed
   - deliverable
   - how it was tested
   - known limitations
11. Do not mark a task complete until it passes its acceptance test.
12. Do not expand the scope of a task without updating this document.
13. Preserve the architectural source-of-truth principle.

---

# 31. External Resources

Use official Reactor resources for current API details:

- Reactor: https://www.reactor.inc/
- Reactor API/SDK docs: https://docs.reactor.inc/
- LingBot World 2 docs: https://docs.reactor.inc/model-api-reference/lingbot-world-2/overview
- Hackathon resources are listed in the participant event page.

The hackathon explicitly provides Reactor API access/credits and directs participants to the official API/SDK docs and model sandboxes. fileciteturn0file2

---

# 32. Final Mental Model

```text
                 HUMAN
                   │
               explores
                   │
                   ▼
           ┌───────────────┐
           │ REACTOR WORLD │
           └───────┬───────┘
                   │
             visualization
                   │
                   ▼
         ┌───────────────────┐
         │ DIGITAL TWIN      │
         │                   │
         │ geometry          │
         │ rooms             │
         │ walls             │
         │ doors             │
         │ objects           │
         │ player state      │
         └────────┬──────────┘
                  │
               feedback
                  │
                  ▼
          ┌───────────────┐
          │ ARCHITECT AI  │
          └───────┬───────┘
                  │
          structured changes
                  │
                  ▼
        ┌───────────────────┐
        │ MUTATOR +         │
        │ VALIDATOR         │
        └────────┬──────────┘
                 │
              FloorPlan v2
                 │
                 ▼
          REGENERATE ROOM
                 │
                 ▼
            EXPLORE AGAIN
```

**Core product loop:**

> **Design → Walk → Critique → Redesign → Walk again.**

That is the system we are building.
