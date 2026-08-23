"use client";

/**
 * The live first-person view: the SDK's video element plus a HUD (travel
 * clock, control hints, end-travel). WASD/arrow-key input is bound for as long
 * as the stream accepts input.
 */
import { useEffect, useState } from "react";
import { ReactorWorldVideo, ADVENTURE_MAX_EXPERIENCE_SEC, type ReactorWorld } from "@/lib/reactor/world-provider";
import { useAdventureControls } from "@/lib/reactor/controls";
import { StageOverlay } from "./stage-overlay";

export function LiveWorld({
  world,
  onEnterAgain,
  onNewWorld,
}: {
  world: ReactorWorld;
  onEnterAgain: () => void;
  onNewWorld: () => void;
}) {
  const { streaming, phase, endTravelSession } = world;
  const budget = world.maxExperienceTimeSec ?? ADVENTURE_MAX_EXPERIENCE_SEC;
  const [remaining, setRemaining] = useState(budget);

  useAdventureControls(world, streaming);

  useEffect(() => {
    setRemaining(budget);
    if (!streaming) return;
    const timer = setInterval(() => {
      setRemaining((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [budget, streaming]);

  const travelEnded = phase === "ended";
  const opening = !streaming && phase === "starting_stream";

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
          <button className="secondary" onClick={() => void endTravelSession()}>
            End travel
          </button>
        </div>
      ) : opening ? (
        <StageOverlay
          spinner
          title="Opening live stream…"
          subtitle="Negotiating the stream with the Happy Oyster gateway. First entry can take a few seconds."
        />
      ) : (
        <StageOverlay
          title={travelEnded ? "Travel ended" : "World ready"}
          subtitle={
            travelEnded
              ? "The travel's time budget ran out — adventure travels last up to 2 minutes. The world itself is still ready."
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
    </>
  );
}
