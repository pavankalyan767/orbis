"use client";

/**
 * The live first-person view: the SDK's video element, an always-reachable
 * room switcher bar, and a streaming-only HUD (travel clock, control hints,
 * end travel). WASD/arrow-key input is bound for as long as the stream
 * accepts input.
 *
 * Two invariants this component exists to protect:
 *  1. <ReactorWorldVideo/> is rendered UNCONDITIONALLY. The SDK binds it with
 *     a ref callback that ignores null, so unmounting it leaves the model
 *     pointing at a detached node and the next startTravel() streams into
 *     nothing — a black frame with no error.
 *  2. The room switcher is rendered in EVERY phase. It used to live inside the
 *     `streaming` branch, so it vanished at the exact moment the user needed
 *     it (travel ended, budget expired, stream died).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactorWorldVideo,
  ADVENTURE_MAX_EXPERIENCE_SEC,
  useReactorWorldTravelError,
  type ReactorWorld,
} from "@/lib/reactor/world-provider";
import { useAdventureControls } from "@/lib/reactor/controls";
import { describeReactorError } from "@/lib/reactor/errors";
import { recoverStuckSession, type SwitchStage } from "@/lib/reactor/session";
import { StageOverlay } from "./stage-overlay";
import {
  RoomSwitcherHUD,
  describeSwitchStage,
  dismissSwitchError,
  useSwitchSnapshot,
  type RoomWorldInfo,
} from "./room-switcher";

export function LiveWorld({
  world,
  onEnterAgain,
  onNewWorld,
  rooms,
  activeRoomId,
  switching,
  onSwitchRoom,
  switchStage,
  switchError,
  onDismissError,
}: {
  world: ReactorWorld;
  onEnterAgain: () => void;
  onNewWorld: () => void;
  rooms?: RoomWorldInfo[];
  activeRoomId?: string;
  switching?: boolean;
  onSwitchRoom?: (roomId: string) => void;
  /** Optional overrides — omitted, the bar reads the live switch status. */
  switchStage?: SwitchStage | null;
  switchError?: string | null;
  onDismissError?: () => void;
}) {
  const { streaming, phase } = world;
  const budget = world.maxExperienceTimeSec ?? ADVENTURE_MAX_EXPERIENCE_SEC;
  const [remaining, setRemaining] = useState(budget);
  const [travelError, setTravelError] = useState<string | null>(null);

  useAdventureControls(world, streaming);

  const shared = useSwitchSnapshot();
  const isSwitching = Boolean(switching) || shared.switching;

  useEffect(() => {
    setRemaining(budget);
    if (!streaming) return;
    const timer = setInterval(() => {
      setRemaining((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [budget, streaming]);

  // `world` is a fresh object literal every render; keep a ref so the travel
  // error handler and recovery never act on a stale session facade.
  const worldRef = useRef(world);
  useEffect(() => {
    worldRef.current = world;
  });

  // A fatal playback disconnect leaves the SDK parked on `streaming` with a
  // dead session — every later action fails until it is unstuck.
  const recoveringRef = useRef(false);
  useReactorWorldTravelError((error: unknown) => {
    setTravelError(describeReactorError(error));
    if (recoveringRef.current) return;
    recoveringRef.current = true;
    void recoverStuckSession(worldRef.current).finally(() => {
      recoveringRef.current = false;
    });
  });

  const endTravel = useCallback(() => {
    // Ends the travel only — the session and its world stay alive, so the
    // next room switch (or "Enter world") does not need a full reconnect.
    setTravelError(null);
    void worldRef.current.endTravelSession().catch((error: unknown) => {
      setTravelError(describeReactorError(error));
    });
  }, []);

  const disconnectSession = useCallback(() => {
    // The credit-burn escape hatch: closes the Reactor session entirely.
    setTravelError(null);
    void worldRef.current.disconnect().catch((error: unknown) => {
      setTravelError(describeReactorError(error));
    });
  }, []);

  const dismissError = useCallback(() => {
    setTravelError(null);
    dismissSwitchError();
    onDismissError?.();
  }, [onDismissError]);

  const travelEnded = phase === "ended";
  const opening = !streaming && phase === "starting_stream";
  const showRooms = Boolean(rooms?.length && onSwitchRoom);
  const switchStageText = describeSwitchStage(switchStage ?? shared.stage);

  return (
    <>
      <ReactorWorldVideo autoPlay muted playsInline className="world-video" />

      {streaming ? (
        <div className="hud">
          <span className="clock">
            {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")} left
          </span>
          <span className="hint">
            <b>WASD</b> move · <b>←↑↓→</b> look · <b>Space</b> jump · <b>Shift</b> sprint
          </span>
          <span className="hud-actions">
            <button className="secondary" onClick={endTravel}>
              End travel
            </button>
            <button
              className="hud-danger"
              onClick={disconnectSession}
              title="Close the Reactor session completely to stop all credit burn"
            >
              Disconnect (stop billing)
            </button>
          </span>
        </div>
      ) : isSwitching ? (
        <StageOverlay
          spinner
          title="Switching room…"
          subtitle={switchStageText ?? "Handing the live stream over to the next world."}
        />
      ) : opening ? (
        <StageOverlay
          spinner
          title="Opening live stream…"
          subtitle="Negotiating the stream with the Happy Oyster gateway. First entry can take a few seconds."
        />
      ) : (
        <StageOverlay
          title={travelEnded ? "Session closed" : "World ready"}
          subtitle={
            travelEnded
              ? showRooms
                ? "The Reactor session is closed to stop credit burn. Re-enter below, or just pick a room above — switching reconnects for you."
                : "The Reactor session has been completely closed to stop all credit burn. Click below to reconnect and step in again."
              : showRooms
                ? "The world is built and waiting. Step in, pick a room above, or build something different."
                : "The world is built and waiting. Step in, or build something different."
          }
        >
          <button className="primary" onClick={onEnterAgain}>
            {travelEnded ? "Enter world again" : "Enter world"}
          </button>
          <button className="secondary" onClick={onNewWorld}>
            Build a new world
          </button>
        </StageOverlay>
      )}

      {/* Persistent: painted above every overlay, in every phase. */}
      {(showRooms || travelError) && (
        <div className="world-room-bar">
          {showRooms && (
            <RoomSwitcherHUD
              rooms={rooms ?? []}
              activeRoomId={activeRoomId ?? ""}
              switching={isSwitching}
              onSwitch={(roomId) => onSwitchRoom?.(roomId)}
              switchStage={switchStage}
              switchError={switchError ?? travelError}
              onDismissError={dismissError}
            />
          )}
          {!showRooms && travelError && (
            <div className="room-switcher-hud">
              <div className="switch-error" role="alert">
                <span className="switch-error-text">{travelError}</span>
                <button
                  type="button"
                  className="switch-error-dismiss"
                  onClick={dismissError}
                  aria-label="Dismiss error"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
