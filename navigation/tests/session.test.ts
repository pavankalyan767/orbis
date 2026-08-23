/**
 * Unit tests for the world-switching primitive in `lib/reactor/session.ts`.
 *
 * The Happy Oyster SDK is never loaded here — `switchToWorld` only ever talks
 * to the facade surface, so a plain object with jest.fn()s plus a live `model`
 * reproduces every behaviour that matters. The fake deliberately mirrors the
 * real thing on two points:
 *
 *   • `model.phase` / `model.worldState` are the LIVE values, and the facade's
 *     `phase` / `worldState` / `streaming` are views onto them. That is what
 *     the SDK does (`get phase()` on HappyOysterModel, and `worldState` is a
 *     public field re-assigned inside HappyOysterBase's own onWorldState
 *     handler), and it is why the unlock poll can observe change at all.
 *   • `endTravelSession()` does NOT refresh `worldState` — the exact hole that
 *     leaves `worldState.phase === "traveling"` after a travel self-completes
 *     and bricks every later `attachWorld`.
 */
import type { ReactorWorld } from '@/lib/reactor/world-provider'

// `@reactor-models/happy-oyster` is ESM-only (`"type": "module"`, and its
// package `exports` map offers only an `import` condition), so Jest's
// CommonJS resolver cannot load it — and `lib/reactor/errors.ts` imports
// `HappyOysterActionError` from it for an `instanceof` check. A virtual mock
// keeps that resolution out of the test runtime without touching
// jest.config.js. The stand-in mirrors the real class: an Error subclass
// carrying `action` and `code` from the model's `action_error` message.
jest.mock(
  '@reactor-models/happy-oyster',
  () => ({
    HappyOysterActionError: class HappyOysterActionError extends Error {
      readonly action: string
      readonly code: string
      constructor(message: { action: string; code: string; message: string }) {
        super(message.message)
        this.name = 'HappyOysterActionError'
        this.action = message.action
        this.code = message.code
      }
    },
  }),
  { virtual: true },
)

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { HappyOysterActionError } = require('@reactor-models/happy-oyster') as {
  HappyOysterActionError: new (m: { action: string; code: string; message: string }) => Error
}

import {
  isWorldApiLocked,
  ensureWorldApiUnlocked,
  switchToWorld,
  recoverStuckSession,
  type SwitchStage,
} from '@/lib/reactor/session'

type Phase = ReactorWorld['phase']
type WorldSnapshot = NonNullable<ReactorWorld['worldState']>
type WorldPhase = WorldSnapshot['phase']

/** Minimal but shape-accurate `world_state` snapshot. */
function ws(encryptedWorldId: string, phase: WorldPhase): WorldSnapshot {
  return {
    type: 'world_state',
    encrypted_world_id: encryptedWorldId,
    phase,
  } as unknown as WorldSnapshot
}

interface FakeWorldInit {
  phase?: Phase
  worldState?: WorldSnapshot | null
}

/**
 * A fake `useHappyOyster()` facade. Mutate `model.phase` / `model.worldState`
 * to move the live state; the facade getters follow, exactly like the SDK.
 */
function makeWorld(init: FakeWorldInit = {}) {
  const model = {
    phase: init.phase ?? ('connected' as Phase),
    worldState: init.worldState === undefined ? null : init.worldState,
    requestState: jest.fn(async () => {}),
  }

  const world = {
    model,
    get phase() {
      return model.phase
    },
    get worldState() {
      return model.worldState
    },
    get streaming() {
      return model.phase === 'streaming'
    },
    endTravelSession: jest.fn(async () => {
      // Mirrors the SDK: the phase unsticks, the world snapshot does NOT.
      if (model.phase === 'streaming' || model.phase === 'starting_stream') {
        model.phase = 'connected'
      }
    }),
    attachWorld: jest.fn(async (id: string) => {
      model.worldState = ws(id, 'ready')
      return model.worldState
    }),
    startTravel: jest.fn(async () => {
      model.phase = 'streaming'
      return { credentials: null, streaming: true, session: null }
    }),
    connect: jest.fn(async (_jwt?: unknown) => {
      model.phase = 'connected'
    }),
    disconnect: jest.fn(async () => {}),
  }

  return world
}

type FakeWorld = ReturnType<typeof makeWorld>

/** The cast every call site needs — the fake is structurally a facade subset. */
const asWorld = (w: FakeWorld) => w as unknown as ReactorWorld

/**
 * Run `fn` with modern fake timers so the 200 ms unlock poll costs nothing.
 * `advanceTimersByTimeAsync` flushes microtasks between timers, so the async
 * poll loop actually progresses, and it fakes `Date.now()` so the deadline
 * arithmetic inside `ensureWorldApiUnlocked` advances with it.
 */
async function withFakeTimers<T>(fn: () => Promise<T>, advanceMs = 5_000): Promise<T> {
  jest.useFakeTimers()
  try {
    const pending = fn()
    await jest.advanceTimersByTimeAsync(advanceMs)
    return await pending
  } finally {
    jest.useRealTimers()
  }
}

// ─── 1. isWorldApiLocked ─────────────────────────────────────────────────────

describe('isWorldApiLocked', () => {
  test('locked while phase is "streaming"', () => {
    expect(isWorldApiLocked({ phase: 'streaming', worldState: ws('w-1', 'ready') })).toBe(true)
  })

  test('locked while phase is "starting_stream"', () => {
    expect(isWorldApiLocked({ phase: 'starting_stream', worldState: ws('w-1', 'ready') })).toBe(
      true,
    )
  })

  test('THE regression: locked when worldState.phase is "traveling" even though phase is "connected"', () => {
    // This is the self-completed-travel state: handleTravelCompleted() pushed
    // the client phase back to "connected" but never refreshed the snapshot.
    expect(isWorldApiLocked({ phase: 'connected', worldState: ws('w-1', 'traveling') })).toBe(true)
  })

  test('unlocked for a connected client on a ready world', () => {
    expect(isWorldApiLocked({ phase: 'connected', worldState: ws('w-1', 'ready') })).toBe(false)
  })

  test('unlocked with no world snapshot at all', () => {
    expect(isWorldApiLocked({ phase: 'connected', worldState: null })).toBe(false)
  })
})

// ─── 2. endTravelSession is unconditional ────────────────────────────────────

describe('switchToWorld — end-travel stage', () => {
  test('ends the travel even when streaming is false (self-completed travel)', async () => {
    const world = makeWorld({ phase: 'connected', worldState: ws('w-old', 'ready') })
    expect(world.streaming).toBe(false)

    const result = await switchToWorld(asWorld(world), 'w-new')

    expect(world.endTravelSession).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true, worldId: 'w-new', skipped: false })
  })
})

// ─── 3. The stale "traveling" mirror ─────────────────────────────────────────

describe('switchToWorld — stale traveling snapshot', () => {
  test('polls requestState() until the mirror clears, then completes the switch', async () => {
    const world = makeWorld({ phase: 'connected', worldState: ws('w-old', 'traveling') })

    // The SDK only repairs the snapshot on a fresh broadcast: the first
    // refresh still reports "traveling", the second finally reports "ready".
    let refreshes = 0
    world.model.requestState.mockImplementation(async () => {
      refreshes += 1
      if (refreshes >= 2) world.model.worldState = ws('w-old', 'ready')
    })

    const result = await withFakeTimers(() => switchToWorld(asWorld(world), 'w-new'))

    expect(world.model.requestState).toHaveBeenCalled()
    expect(refreshes).toBeGreaterThanOrEqual(2)
    expect(world.attachWorld).toHaveBeenCalledWith('w-new')
    expect(result).toEqual({ ok: true, worldId: 'w-new', skipped: false })
  })

  test('ensureWorldApiUnlocked returns true immediately when nothing is locked', async () => {
    const world = makeWorld({ phase: 'connected', worldState: ws('w-1', 'ready') })

    await expect(ensureWorldApiUnlocked(asWorld(world))).resolves.toBe(true)
    expect(world.model.requestState).not.toHaveBeenCalled()
  })
})

// ─── 4. Never unlocks ────────────────────────────────────────────────────────

describe('switchToWorld — unlock timeout', () => {
  test('fails at the unlock stage and never touches attachWorld', async () => {
    const world = makeWorld({ phase: 'connected', worldState: ws('w-old', 'traveling') })
    // requestState never repairs the snapshot.

    const result = await withFakeTimers(() =>
      switchToWorld(asWorld(world), 'w-new', { unlockTimeoutMs: 600 }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.stage).toBe('unlock')
    expect(result.error).toEqual(expect.stringContaining('traveling'))
    expect(world.attachWorld).not.toHaveBeenCalled()
    expect(world.startTravel).not.toHaveBeenCalled()
  })

  test('ensureWorldApiUnlocked reports false when the lock never clears', async () => {
    const world = makeWorld({ phase: 'streaming', worldState: ws('w-1', 'traveling') })

    const unlocked = await withFakeTimers(() => ensureWorldApiUnlocked(asWorld(world), 600))

    expect(unlocked).toBe(false)
    expect(world.model.requestState).toHaveBeenCalled()
  })
})

// ─── 5. Already there ────────────────────────────────────────────────────────

describe('switchToWorld — no-op', () => {
  test('already streaming that world → skipped, no SDK calls at all', async () => {
    const world = makeWorld({ phase: 'streaming', worldState: ws('w-1', 'traveling') })

    const result = await switchToWorld(asWorld(world), 'w-1')

    expect(result).toEqual({ ok: true, worldId: 'w-1', skipped: true })
    expect(world.endTravelSession).not.toHaveBeenCalled()
    expect(world.attachWorld).not.toHaveBeenCalled()
    expect(world.startTravel).not.toHaveBeenCalled()
  })
})

// ─── 6. Already attached and ready, but not streaming ────────────────────────

describe('switchToWorld — attach short-circuit', () => {
  test('skips attachWorld for the current ready world but still starts travel', async () => {
    // attachWorld would hang forever here: no new world_state is broadcast
    // for a world that is already current and already ready.
    const world = makeWorld({ phase: 'connected', worldState: ws('w-1', 'ready') })

    const result = await switchToWorld(asWorld(world), 'w-1')

    expect(world.attachWorld).not.toHaveBeenCalled()
    expect(world.startTravel).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true, worldId: 'w-1', skipped: false })
  })

  test('still attaches when the current world matches but is not ready', async () => {
    const world = makeWorld({ phase: 'connected', worldState: ws('w-1', 'building') })

    const result = await switchToWorld(asWorld(world), 'w-1')

    expect(world.attachWorld).toHaveBeenCalledWith('w-1')
    expect(result).toEqual({ ok: true, worldId: 'w-1', skipped: false })
  })
})

// ─── 7. Reconnect gating ─────────────────────────────────────────────────────

describe('switchToWorld — reconnect stage', () => {
  test('reconnects when the phase is "ended"', async () => {
    const world = makeWorld({ phase: 'ended', worldState: ws('w-old', 'ready') })
    const jwt = jest.fn(async () => 'jwt-token')

    const result = await switchToWorld(asWorld(world), 'w-new', { jwt })

    expect(world.connect).toHaveBeenCalledTimes(1)
    expect(world.connect).toHaveBeenCalledWith(jwt)
    expect(result).toEqual({ ok: true, worldId: 'w-new', skipped: false })
  })

  test('reconnects when the phase is "failed" or "idle"', async () => {
    for (const phase of ['failed', 'idle'] as const) {
      const world = makeWorld({ phase, worldState: ws('w-old', 'ready') })
      await switchToWorld(asWorld(world), 'w-new', { jwt: async () => 'jwt' })
      expect(world.connect).toHaveBeenCalledTimes(1)
    }
  })

  test('does NOT reconnect when the phase is "connected" (endTravelSession keeps the session)', async () => {
    const world = makeWorld({ phase: 'connected', worldState: ws('w-old', 'ready') })

    const result = await switchToWorld(asWorld(world), 'w-new', { jwt: async () => 'jwt' })

    expect(world.connect).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, worldId: 'w-new', skipped: false })
  })

  test('a failed reconnect surfaces as stage "reconnect"', async () => {
    const world = makeWorld({ phase: 'ended', worldState: ws('w-old', 'ready') })
    world.connect.mockRejectedValue(new Error('token mint failed'))

    const result = await switchToWorld(asWorld(world), 'w-new', { jwt: async () => 'jwt' })

    expect(result).toEqual({ ok: false, stage: 'reconnect', error: 'token mint failed' })
    expect(world.attachWorld).not.toHaveBeenCalled()
  })
})

// ─── 8 & 9. Failure mapping ──────────────────────────────────────────────────

describe('switchToWorld — failures never throw', () => {
  test('attachWorld rejecting → { ok: false, stage: "attach" }', async () => {
    const world = makeWorld({ phase: 'connected', worldState: ws('w-old', 'ready') })
    world.attachWorld.mockRejectedValue(new Error('attachWorld() is locked while a travel is live'))

    const result = await switchToWorld(asWorld(world), 'w-new')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.stage).toBe('attach')
    expect(result.error.length).toBeGreaterThan(0)
    expect(world.startTravel).not.toHaveBeenCalled()
  })

  test('a non-Error rejection still yields a non-empty message', async () => {
    const world = makeWorld({ phase: 'connected', worldState: ws('w-old', 'ready') })
    world.attachWorld.mockRejectedValue('403001')

    const result = await switchToWorld(asWorld(world), 'w-new')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.stage).toBe('attach')
    expect(result.error.length).toBeGreaterThan(0)
  })

  test('a HappyOysterActionError is mapped through describeReactorError', async () => {
    const world = makeWorld({ phase: 'connected', worldState: ws('w-old', 'ready') })
    world.attachWorld.mockRejectedValue(
      new HappyOysterActionError({
        action: 'attach_world',
        code: '403001',
        message: 'world not found',
      }),
    )

    const result = await switchToWorld(asWorld(world), 'w-new')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.stage).toBe('attach')
    // The shared hint table in lib/reactor/errors.ts, not a duplicated copy.
    expect(result.error).toBe('Unknown world id, or it belongs to another account. (code 403001)')
  })

  test('startTravel rejecting → { ok: false, stage: "start-travel" }', async () => {
    const world = makeWorld({ phase: 'connected', worldState: ws('w-old', 'ready') })
    world.startTravel.mockRejectedValue(new Error('No video element: none attached'))

    const result = await switchToWorld(asWorld(world), 'w-new')

    expect(result).toEqual({
      ok: false,
      stage: 'start-travel',
      error: 'No video element: none attached',
    })
  })
})

// ─── 10. Stage reporting ─────────────────────────────────────────────────────

describe('switchToWorld — onStage', () => {
  test('reports every executed stage in order, including reconnect', async () => {
    const world = makeWorld({ phase: 'ended', worldState: ws('w-old', 'ready') })
    const stages: SwitchStage[] = []

    await switchToWorld(asWorld(world), 'w-new', {
      jwt: async () => 'jwt',
      onStage: (s) => stages.push(s),
    })

    expect(stages).toEqual(['end-travel', 'unlock', 'reconnect', 'attach', 'start-travel'])
  })

  test('omits the stages it legitimately skips', async () => {
    const world = makeWorld({ phase: 'connected', worldState: ws('w-1', 'ready') })
    const stages: SwitchStage[] = []

    await switchToWorld(asWorld(world), 'w-1', { onStage: (s) => stages.push(s) })

    // No reconnect (session alive) and no attach (already the ready world).
    expect(stages).toEqual(['end-travel', 'unlock', 'start-travel'])
  })

  test('stops reporting at the stage that failed', async () => {
    const world = makeWorld({ phase: 'connected', worldState: ws('w-old', 'ready') })
    world.attachWorld.mockRejectedValue(new Error('nope'))
    const stages: SwitchStage[] = []

    await switchToWorld(asWorld(world), 'w-new', { onStage: (s) => stages.push(s) })

    expect(stages).toEqual(['end-travel', 'unlock', 'attach'])
  })
})

// ─── Extras ──────────────────────────────────────────────────────────────────

describe('switchToWorld — abort', () => {
  test('an already-aborted signal fails fast without touching the SDK', async () => {
    const world = makeWorld({ phase: 'connected', worldState: ws('w-old', 'ready') })
    const controller = new AbortController()
    controller.abort()

    const result = await switchToWorld(asWorld(world), 'w-new', { signal: controller.signal })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.stage).toBe('end-travel')
    expect(world.endTravelSession).not.toHaveBeenCalled()
    expect(world.attachWorld).not.toHaveBeenCalled()
  })
})

describe('recoverStuckSession', () => {
  test('ends the travel and refreshes the snapshot', async () => {
    // A fatal playback disconnect leaves status "idle", so the facade stays
    // "streaming" over a dead session and the world API is locked forever.
    const world = makeWorld({ phase: 'streaming', worldState: ws('w-1', 'traveling') })

    await recoverStuckSession(asWorld(world))

    expect(world.endTravelSession).toHaveBeenCalledTimes(1)
    expect(world.model.requestState).toHaveBeenCalledTimes(1)
    expect(world.phase).toBe('connected')
  })

  test('swallows errors from both calls', async () => {
    const world = makeWorld({ phase: 'streaming', worldState: ws('w-1', 'traveling') })
    world.endTravelSession.mockRejectedValue(new Error('boom'))
    world.model.requestState.mockRejectedValue(new Error('also boom'))

    await expect(recoverStuckSession(asWorld(world))).resolves.toBeUndefined()
  })
})
