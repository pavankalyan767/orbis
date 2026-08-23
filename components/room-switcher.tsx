"use client";

/**
 * Room ⇄ world mapping plus the chip bar that switches between them.
 *
 * The actual switch choreography (end travel → unlock → reconnect if needed →
 * attach → start travel) lives in `lib/reactor/session`; this file only owns
 * the room list, the persisted room→worldId mapping, and the UI.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { ReactorWorld } from "@/lib/reactor/world-provider";
import { getReactorJwt } from "@/lib/reactor/token";
import { switchToWorld, type SwitchStage } from "@/lib/reactor/session";

export interface RoomWorldInfo {
  id: string;
  name: string;
  worldId: string | null;
}

const DEFAULT_ROOMS: RoomWorldInfo[] = [
  { id: "living", name: "Living Room", worldId: null },
  { id: "kitchen", name: "Kitchen", worldId: null },
  { id: "bedroom", name: "Bedroom", worldId: null },
  { id: "hallway", name: "Hallway", worldId: null },
];

const STORAGE_KEY = "orbis-room-worlds";

/* ────────────────────────────────────────────────────────────────────────────
 * Shared switch status
 *
 * A switch can be kicked off from three places (a chip, a doorway crossing in
 * the navigation engine, or a parent page) but has to be *visible* everywhere,
 * including inside <LiveWorld/>, whose call sites do not thread the status
 * through as props. The live switch status therefore lives in one tiny module
 * store that the hook writes and any HUD can read. There is exactly one
 * `useRoomSwitcherState()` instance per page, so there is nothing to contend.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface SwitchSnapshot {
  switching: boolean;
  stage: SwitchStage | null;
  /** Room the in-flight switch is heading to (null when idle). */
  targetRoomId: string | null;
  error: string | null;
}

const IDLE_SNAPSHOT: SwitchSnapshot = {
  switching: false,
  stage: null,
  targetRoomId: null,
  error: null,
};

let snapshot: SwitchSnapshot = IDLE_SNAPSHOT;
const listeners = new Set<() => void>();

function publishSwitchState(patch: Partial<SwitchSnapshot>) {
  const next = { ...snapshot, ...patch };
  if (
    next.switching === snapshot.switching &&
    next.stage === snapshot.stage &&
    next.targetRoomId === snapshot.targetRoomId &&
    next.error === snapshot.error
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribeSwitchState(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reactive view of the newest room switch (status, stage, error). */
export function useSwitchSnapshot(): SwitchSnapshot {
  return useSyncExternalStore(
    subscribeSwitchState,
    () => snapshot,
    () => IDLE_SNAPSHOT,
  );
}

/** Clear the shared switch error from anywhere (chip bar, HUD, page). */
export function dismissSwitchError() {
  publishSwitchState({ error: null });
}

const STAGE_LABELS: Record<string, string> = {
  "end-travel": "Ending travel…",
  unlock: "Unlocking world API…",
  reconnect: "Reconnecting session…",
  attach: "Attaching world…",
  "start-travel": "Starting stream…",
};

/** Human sentence for a switch stage, tolerant of stage names we don't know. */
export function describeSwitchStage(stage: SwitchStage | null | undefined): string | null {
  if (!stage) return null;
  const key = String(stage);
  const known = STAGE_LABELS[key];
  if (known) return known;
  const words = key.replace(/[_-]+/g, " ").trim();
  if (!words) return null;
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}…`;
}

/* ────────────────────────────────────────────────────────────────────────── */

export function useRoomSwitcherState() {
  const [rooms, setRooms] = useState<RoomWorldInfo[]>(DEFAULT_ROOMS);

  // `switchRoom` must never close over a stale room list: it is held in a
  // callback with a stable identity (page-level effects depend on it) and can
  // be invoked by the navigation engine long after the render that made it.
  const roomsRef = useRef(rooms);
  useEffect(() => {
    roomsRef.current = rooms;
  });

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as RoomWorldInfo[];
        roomsRef.current = parsed;
        setRooms(parsed);
      } catch {
        // use default
      }
    }
  }, []);

  const [activeRoomId, setActiveRoomId] = useState<string>("living");
  const shared = useSwitchSnapshot();
  const { switching, error: switchError, stage: switchStage, targetRoomId: switchTargetRoomId } = shared;

  const setSwitchError = useCallback<Dispatch<SetStateAction<string | null>>>((value) => {
    const next = typeof value === "function" ? value(snapshot.error) : value;
    publishSwitchState({ error: next });
  }, []);

  const initializeRooms = useCallback((newRooms: RoomWorldInfo[]) => {
    roomsRef.current = newRooms;
    setRooms(newRooms);
    if (newRooms.length > 0) {
      setActiveRoomId(newRooms[0].id);
    }
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newRooms));
    }
  }, []);

  const saveRoomWorld = useCallback((roomId: string, encryptedWorldId: string) => {
    setRooms((prev) => {
      const updated = prev.map((r) => (r.id === roomId ? { ...r, worldId: encryptedWorldId } : r));
      roomsRef.current = updated;
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      }
      return updated;
    });
  }, []);

  // One in-flight switch at a time — a newer request supersedes the old one.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      // Unmounting mid-switch must not leave the shared status stuck on
      // "switching", which would disable every chip forever.
      if (!abortRef.current) return;
      abortRef.current.abort();
      abortRef.current = null;
      publishSwitchState(IDLE_SNAPSHOT);
    },
    [],
  );

  const switchRoom = useCallback(async (targetRoomId: string, world: ReactorWorld): Promise<boolean> => {
    const targetRoom = roomsRef.current.find((r) => r.id === targetRoomId);
    if (!targetRoom || !targetRoom.worldId) {
      publishSwitchState({ error: `No world generated for ${targetRoom?.name ?? targetRoomId} yet.` });
      return false;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    publishSwitchState({ switching: true, error: null, stage: null, targetRoomId });

    // switchToWorld never rejects — it reports failure through its result.
    const result = await switchToWorld(world, targetRoom.worldId, {
      signal: controller.signal,
      jwt: getReactorJwt,
      onStage: (stage) => {
        if (controller.signal.aborted) return;
        publishSwitchState({ stage });
      },
    });

    // A newer switch owns the status now; don't stomp on it.
    if (controller.signal.aborted) return result.ok;
    abortRef.current = null;

    if (result.ok) {
      setActiveRoomId(targetRoomId);
      publishSwitchState({ switching: false, stage: null, targetRoomId: null, error: null });
      return true;
    }

    publishSwitchState({
      switching: false,
      stage: null,
      targetRoomId: null,
      error: result.error,
    });
    return false;
  }, []);

  return {
    rooms,
    activeRoomId,
    setActiveRoomId,
    switching,
    switchError,
    setSwitchError,
    initializeRooms,
    saveRoomWorld,
    switchRoom,
    // Additive — existing consumers keep working without them.
    switchStage,
    switchTargetRoomId,
  };
}

export function RoomSwitcherHUD({
  rooms,
  activeRoomId,
  switching,
  onSwitch,
  switchStage,
  switchError,
  switchTargetId,
  onDismissError,
  disabled,
}: {
  rooms: RoomWorldInfo[];
  activeRoomId: string;
  switching: boolean;
  onSwitch: (roomId: string) => void;
  /** Overrides the shared stage; omit to read the live switch status. */
  switchStage?: SwitchStage | null;
  /** Overrides the shared error; omit to read the live switch status. */
  switchError?: string | null;
  /** Room the in-flight switch targets; omit to infer it. */
  switchTargetId?: string | null;
  onDismissError?: () => void;
  disabled?: boolean;
}) {
  const shared = useSwitchSnapshot();
  // Remember the chip that was clicked so it can show progress even when the
  // caller doesn't tell us what the target is.
  const [clickedId, setClickedId] = useState<string | null>(null);
  const busy = switching || shared.switching;
  useEffect(() => {
    if (!busy) setClickedId(null);
  }, [busy]);

  const stage = switchStage ?? shared.stage;
  const error = switchError ?? shared.error;
  const targetId = switchTargetId ?? shared.targetRoomId ?? clickedId;
  const stageText = describeSwitchStage(stage);
  const targetName = targetId ? rooms.find((r) => r.id === targetId)?.name : null;

  const dismiss = useCallback(() => {
    dismissSwitchError();
    onDismissError?.();
  }, [onDismissError]);

  return (
    <div className="room-switcher-hud" data-busy={busy ? "true" : undefined}>
      <div className="room-switcher-row">
        <span className="label">Rooms</span>
        {rooms.map((room) => {
          const isActive = room.id === activeRoomId;
          const hasWorld = Boolean(room.worldId);
          const isTarget = busy && room.id === targetId;
          return (
            <button
              key={room.id}
              type="button"
              className={[
                "room-chip",
                isActive ? "active" : "",
                hasWorld ? "" : "empty",
                isTarget ? "pending" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={disabled || busy || !hasWorld}
              aria-current={isActive ? "true" : undefined}
              aria-busy={isTarget ? "true" : undefined}
              onClick={() => {
                setClickedId(room.id);
                onSwitch(room.id);
              }}
              title={
                hasWorld
                  ? `Switch to ${room.name}`
                  : `${room.name} has no generated world yet — build one first`
              }
            >
              <span className="room-chip-name">{room.name}</span>
              {!hasWorld && <span className="room-chip-tag">no world yet</span>}
              {hasWorld && isActive && !isTarget && <span className="active-dot" />}
              {isTarget && <span className="chip-spinner" aria-hidden="true" />}
            </button>
          );
        })}
        {busy && (
          <span className="switch-stage" role="status">
            <span className="chip-spinner" aria-hidden="true" />
            {targetName ? `${stageText ?? "Switching…"} → ${targetName}` : (stageText ?? "Switching…")}
          </span>
        )}
      </div>

      {error && (
        <div className="switch-error" role="alert">
          <span className="switch-error-text">{error}</span>
          <button
            type="button"
            className="switch-error-dismiss"
            onClick={dismiss}
            aria-label="Dismiss switch error"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
