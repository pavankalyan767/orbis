# Orbis — Reactor Happy Oyster Prototype

A minimal Next.js (App Router) + TypeScript prototype for **exactly one**
[first-person] Happy Oyster world on [Reactor](https://reactor.inc): upload one
reference image, enter a prompt, generate the world, and walk around it live in
the browser with WASD + arrow-key look controls.

Built entirely on the official typed SDK
([`@reactor-models/happy-oyster`](https://www.npmjs.com/package/@reactor-models/happy-oyster))
and the documented auth flow ([docs](https://docs.reactor.inc)). No browser
reverse-engineering, no raw WebRTC plumbing — the SDK owns transport
negotiation with the Happy Oyster gateway.

## Setup

```bash
npm install
cp .env.local.example .env.local
# edit .env.local and set REACTOR_API_KEY=rk_…  (reactor.inc → Account → API keys)
npm run dev
```

Open http://localhost:3000. Without a key the app shows a setup screen and
never attempts a connection.

## How it works

```
app/page.tsx                      server gate: SetupRequired until REACTOR_API_KEY is set
app/api/reactor/token/route.ts    GET → exchanges rk_ key for a session-scoped JWT (server-only)
components/world-console.tsx      state machine: form → building → live stream, driven by SDK snapshots
components/world-form.tsx         reference image + prompt input (SDK-validated image rules)
components/live-world.tsx         video element, HUD (travel clock, hints), end/enter actions
components/stage-overlay.tsx      loading / building / ended / failed overlays
lib/reactor/                      ← ALL Reactor integration lives here
  world-provider.tsx              ReactorWorldProvider / useReactorWorld / video + error hooks
  controls.ts                     WASD + arrows → SDK held-control commands (hold/release/stop)
  token.ts                        client JWT resolver (fetches /api/reactor/token)
  first-frame.ts                  reference-image rules (≤ 2 MB, landscape, ratio 1.5–2.0)
  errors.ts                       HappyOysterActionError code → human message
  config.ts                       model slug + endpoints
```

**Auth model:** the `rk_` API key never leaves the server. The token route
POSTs it to `https://api.reactor.inc/tokens` with `authorization_details`
scoping the minted JWT to sessions on the `reactor/happy-oyster-adventure`
model only. The browser holds just that short-lived JWT (cached via
`Cache-Control` for its remaining lifetime).

**Session flow** (per the Happy Oyster docs): `connect → createWorld →
startTravel → controls → endTravelSession / disconnect`. The UI renders from
the SDK's authoritative `phase` / `worldState` snapshots, not local
reconstruction. Each generated world's `encrypted_world_id` is saved to
`localStorage` for a future `attachWorld` feature.

## Controls (Adventure mode)

| Input           | Action                                  |
| --------------- | --------------------------------------- |
| `W A S D`       | Move (diagonals compose)                |
| `← ↑ ↓ →`       | Look (diagonals compose)                |
| `Space`         | Jump                                    |
| `Shift`         | Sprint (hold)                           |
| Window blur     | Release everything (avatar won't run off) |

## Known platform limits

- Adventure travels last **up to 2 minutes** (`maxExperienceTimeSec`, usually
  120 s); the platform ends the stream when the budget runs out. The world
  stays ready and can be re-entered.
- Reference image: **≤ 2 MB, landscape, aspect ratio 1.5–2.0**, content policy
  applies (error `403005` on rejection).
- Prompt: up to 2,000 characters (error `403004` on rejection).
- Adventure runs at 720p; the mode (adventure/directing) is fixed per session
  because each is a separate Reactor model.

## Scripts

- `npm run dev` — dev server
- `npm run build` / `npm run start` — production
- `npm run typecheck` — `tsc --noEmit`

## Deliberately out of scope (for now)

Architecture parsing, voice, database persistence, multi-room worlds, user
authentication, world redesign, directing mode.
