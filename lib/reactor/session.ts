/**
 * Robust world/room switching for the Happy Oyster SDK.
 *
 * Switching worlds looks like three calls (`endTravelSession` → `attachWorld`
 * → `startTravel`) and is in practice a minefield. Every guard below exists
 * because of a specific, verified SDK behaviour — the reasoning is recorded
 * here so the next reader does not "simplify" a guard back into a bug.
 *
 * ─── The two phases ────────────────────────────────────────────────────────
 * There are two independent state machines and they are easy to confuse:
 *   • `phase` (HappyOysterPhase) — the *client lifecycle*:
 *     "idle" | "connecting" | "connected" | "starting_stream" | "streaming" |
 *     "ended" | "failed".
 *   • `worldState.phase` (WorldPhase) — the *world's* build/travel state:
 *     "no_world" | "creating" | "building" | "ready" | "traveling" | "failed".
 *
 * ─── Why `isWorldApiLocked` reads BOTH ─────────────────────────────────────
 * `HappyOysterModel.attachWorld()` and `.createWorld()` both call the private
 * `assertWorldApiUnlocked()`, which throws a *plain* `Error` (no `.code`, so
 * it is NOT a `HappyOysterActionError`) with the message
 * `"attachWorld() is locked while a travel is live — end the travel first"`
 * when ANY of these hold:
 *     phase === "streaming" || phase === "starting_stream" ||
 *     worldState?.phase === "traveling"
 * (dist/chunk-6YT6YPJA.js — `assertWorldApiUnlocked`).
 *
 * That third clause is the bug that bricks room switching. When a travel
 * self-completes — e.g. the 120 s Adventure cap fires — the SDK's
 * `handleTravelCompleted()` tears down the session and pushes `phase` back to
 * "connected", but it NEVER refreshes the mirrored `worldState`. So
 * `worldState.phase` stays "traveling" forever and every later `attachWorld`
 * throws. The only thing that repairs the mirror is a fresh `world_state`
 * broadcast, i.e. `model.requestState()`.
 *
 * ─── Why `endTravelSession()` is called UNCONDITIONALLY ────────────────────
 * `endTravelSession()` only performs the internal `requestState()` refresh
 * when `travelState?.encrypted_travel_id` is non-null. After a self-completed
 * travel `travelState` is already null (the base class nulls it on a
 * "completed"/"failed" travel_state), so the refresh is skipped — the hole
 * that `ensureWorldApiUnlocked` exists to plug. Gating the call on
 * `world.streaming` (as the naive implementation did) makes it worse: a
 * self-completed or fatally-disconnected travel leaves `streaming === false`
 * while the API is still locked, so the one call that could unstick things
 * never runs. It is also cheap and safe to call with nothing running, hence
 * unconditional + error-swallowed.
 *
 * A fatal playback disconnect is the other half of this: it sets the internal
 * travel status to "idle" rather than "completed", so `handleTravelCompleted`
 * never fires, the facade never unlocks, and `phase` stays "streaming" over a
 * dead session. `endTravelSession()` is what unsticks that too — see
 * {@link recoverStuckSession}.
 *
 * ─── Why we do NOT `disconnect()` ──────────────────────────────────────────
 * `endTravelSession()` is documented as "End the live stream, keeping the
 * session and its world" and leaves `phase === "connected"`; `attachWorld`
 * works immediately after, no reconnect needed. `disconnect()` by contrast
 * sets `phase = "ended"` and closes the Reactor session, forcing a full
 * `connect(jwt)` round trip. It has no place in the switch path.
 *
 * ─── Why the travel must end BEFORE attach ─────────────────────────────────
 * `startTravel()` short-circuits and silently resolves with the OLD cached
 * `lastTravelResult` when `streaming && session && lastTravelResult`. No
 * error, no new stream — you just get handed the previous world back. Ending
 * the travel first clears `lastTravelResult` and makes the next
 * `startTravel()` real.
 *
 * ─── Why attach is skipped for an already-attached, ready world ────────────
 * `attachWorldAndWait()` resolves only when a NEWLY broadcast `world_state`
 * carries the requested `encrypted_world_id`, and it has no timeout of its
 * own. Re-attaching the world that is already current and already "ready"
 * produces no new snapshot, so the promise never settles — the call hangs
 * forever. We short-circuit that case, and belt-and-braces every real attach
 * with {@link withTimeout}.
 *
 * ─── Why live state is read off `world.model`, not the facade ──────────────
 * `useHappyOyster()` returns `phase` / `worldState` as React *snapshots*
 * captured at render time. They are frozen for the lifetime of an async
 * function, so a poll loop reading them spins on stale data forever.
 * `HappyOysterModel` exposes the live values directly:
 *   • `get phase(): HappyOysterPhase`      — live getter (dist/index.d.ts)
 *   • `worldState: WorldStateMessage|null` — public field on
 *     `HappyOysterBase`, re-assigned inside its own `onWorldState` handler
 *   • `get streaming(): boolean`           — live getter, `phase === "streaming"`
 * so no `onWorldState`/`onPhaseChanged` subscription bookkeeping is needed;
 * we read `world.model` and fall back to the facade snapshot only if a caller
 * hands us a facade without a model.
 */
import type { ReactorWorld } from "@/lib/reactor/world-provider";
import { describeReactorError } from "@/lib/reactor/errors";

/** The steps of a world switch, in the order they run. */
export type SwitchStage = "end-travel" | "unlock" | "reconnect" | "attach" | "start-travel";

export type SwitchResult =
  /** `skipped` is true when we were already streaming that exact world. */
  | { ok: true; worldId: string; skipped: boolean }
  | { ok: false; stage: SwitchStage; error: string };

export interface SwitchToWorldOptions {
  /** Called as each stage begins; skipped stages are never reported. */
  onStage?: (stage: SwitchStage) => void;
  /** JWT resolver for the reconnect step. Defaults to `getReactorJwt`. */
  jwt?: () => Promise<string>;
  /** Abort between stages (a stage already in flight is allowed to finish). */
  signal?: AbortSignal;
  /** Override the unlock poll budget. Mostly for tests. */
  unlockTimeoutMs?: number;
}

/** How long to poll `requestState()` for the "traveling" mirror to clear. */
const DEFAULT_UNLOCK_TIMEOUT_MS = 12_000;
/** Gap between `requestState()` refreshes while waiting for the unlock. */
const UNLOCK_POLL_MS = 200;
/** `attachWorld()` has no internal timeout and can hang forever. */
const ATTACH_TIMEOUT_MS = 45_000;
/** `startTravel()` waits ~10 s for a video element plus the stream open. */
const START_TRAVEL_TIMEOUT_MS = 60_000;

type LockView = Pick<ReactorWorld, "phase" | "worldState">;

/**
 * The live model behind the React facade, when there is one. Typed loosely so
 * a hand-rolled or partial facade (tests, storybook) degrades gracefully
 * instead of throwing.
 */
type LiveModel = Partial<Pick<ReactorWorld["model"], "phase" | "worldState" | "requestState">>;

function modelOf(world: Pick<ReactorWorld, "model">): LiveModel | undefined {
  return (world as { model?: LiveModel }).model;
}

/**
 * Live `{ phase, worldState }`, preferring the model's own values over the
 * React snapshot — the snapshot never changes inside a running async
 * function, which is exactly where the unlock loop lives.
 */
function liveView(world: ReactorWorld): LockView {
  const model = modelOf(world);
  return {
    // `worldState` is legitimately null a lot of the time, so test for
    // `undefined` (property absent) rather than using `??`.
    phase: model?.phase ?? world.phase,
    worldState: model?.worldState !== undefined ? model.worldState : world.worldState,
  };
}

/** Live streaming flag. Mirrors the SDK getter: `phase === "streaming"`. */
function liveStreaming(world: ReactorWorld): boolean {
  const phase = modelOf(world)?.phase;
  return phase !== undefined ? phase === "streaming" : world.streaming;
}

/** True when the SDK will reject attachWorld/createWorld right now. */
export function isWorldApiLocked(world: Pick<ReactorWorld, "phase" | "worldState">): boolean {
  return (
    world.phase === "streaming" ||
    world.phase === "starting_stream" ||
    world.worldState?.phase === "traveling"
  );
}

/** Reject with `label` if `promise` has not settled in `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, expiry]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
    signal?.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Forces the world API unlocked: ends any live travel, then refreshes the
 * mirrored world snapshot until `worldState.phase !== "traveling"`.
 *
 * `requestState()` is the ONLY thing that repairs a `worldState` left stale at
 * "traveling" by a self-completed travel, so we poll it rather than waiting
 * passively — nothing else will ever push a new snapshot.
 *
 * @returns whether the API became (or already was) unlocked.
 */
export async function ensureWorldApiUnlocked(
  world: ReactorWorld,
  timeoutMs: number = DEFAULT_UNLOCK_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (!isWorldApiLocked(liveView(world))) return true;
    if (Date.now() >= deadline) return false;

    // Swallowed: a failed refresh is the very condition we are retrying.
    try {
      await modelOf(world)?.requestState?.();
    } catch {
      /* keep polling until the deadline */
    }

    await sleep(UNLOCK_POLL_MS);
  }
}

/**
 * Call from a travel-error handler to unstick a fatally-disconnected session:
 * playback death leaves the internal status "idle" (not "completed"), so the
 * facade never unlocks itself. Both calls are error-swallowed — this is a
 * best-effort repair, never a failure path.
 */
export async function recoverStuckSession(world: ReactorWorld): Promise<void> {
  try {
    await world.endTravelSession();
  } catch {
    /* nothing was running — fine */
  }
  try {
    await modelOf(world)?.requestState?.();
  } catch {
    /* best effort */
  }
}

/**
 * The full, robust room/world switch.
 *
 * Never rejects: every failure comes back as `{ ok: false, stage, error }` so
 * callers can surface the stage that broke without a try/catch.
 */
export async function switchToWorld(
  world: ReactorWorld,
  worldId: string,
  opts: SwitchToWorldOptions = {},
): Promise<SwitchResult> {
  const { onStage, signal, unlockTimeoutMs } = opts;
  let stage: SwitchStage = "end-travel";

  const enter = (next: SwitchStage) => {
    stage = next;
    try {
      onStage?.(next);
    } catch {
      /* a broken progress callback must not fail the switch */
    }
  };
  const aborted = (): SwitchResult | null =>
    signal?.aborted ? { ok: false, stage, error: "World switch aborted" } : null;

  // 1. Already living in that world — attaching would hang and startTravel
  //    would hand back the cached result anyway. Nothing to do.
  if (liveView(world).worldState?.encrypted_world_id === worldId && liveStreaming(world)) {
    return { ok: true, worldId, skipped: true };
  }

  // 2. Unconditionally end the travel. NOT gated on `streaming`: a
  //    self-completed or fatally-disconnected travel leaves `streaming`
  //    false while the world API stays locked, and that is precisely the
  //    case that needs this call. Ending nothing is not an error.
  enter("end-travel");
  {
    const stop = aborted();
    if (stop) return stop;
  }
  try {
    await world.endTravelSession();
  } catch {
    /* no live travel to end, or the runtime already tore it down */
  }

  // 3. Repair the mirrored snapshot until the travel lock actually clears.
  enter("unlock");
  {
    const stop = aborted();
    if (stop) return stop;
  }
  if (!(await ensureWorldApiUnlocked(world, unlockTimeoutMs))) {
    const stuck = liveView(world);
    return {
      ok: false,
      stage: "unlock",
      error:
        `World API is still locked after ending the travel ` +
        `(phase "${stuck.phase}", world phase "${stuck.worldState?.phase ?? "none"}"). ` +
        `attachWorld would be rejected — reload the session to recover.`,
    };
  }

  // 4. Reconnect only from a genuinely closed session. `endTravelSession()`
  //    keeps the Reactor session alive, so the common path skips this.
  const phase = liveView(world).phase;
  if (phase === "ended" || phase === "failed" || phase === "idle") {
    enter("reconnect");
    {
      const stop = aborted();
      if (stop) return stop;
    }
    try {
      const jwt = opts.jwt ?? (await import("@/lib/reactor/token").then((m) => m.getReactorJwt));
      await world.connect(jwt);
    } catch (error) {
      return { ok: false, stage: "reconnect", error: describeReactorError(error) };
    }
  }

  // 5. Attach — unless this world is already current AND ready, in which case
  //    no fresh `world_state` would ever be broadcast and `attachWorld` would
  //    never settle.
  const attachView = liveView(world);
  const alreadyAttached =
    attachView.worldState?.encrypted_world_id === worldId &&
    attachView.worldState.phase === "ready";
  if (!alreadyAttached) {
    enter("attach");
    {
      const stop = aborted();
      if (stop) return stop;
    }
    try {
      await withTimeout(world.attachWorld(worldId), ATTACH_TIMEOUT_MS, "attachWorld timed out");
    } catch (error) {
      return { ok: false, stage: "attach", error: describeReactorError(error) };
    }
  }

  // 6. Open the stream. The SDK sets `starting_stream` before it needs the
  //    <video>, on purpose, so the UI can mount it in reaction to the phase.
  enter("start-travel");
  {
    const stop = aborted();
    if (stop) return stop;
  }
  try {
    await withTimeout(world.startTravel(), START_TRAVEL_TIMEOUT_MS, "startTravel timed out");
  } catch (error) {
    return { ok: false, stage: "start-travel", error: describeReactorError(error) };
  }

  return { ok: true, worldId, skipped: false };
}
