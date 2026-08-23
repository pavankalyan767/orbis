"use client";

/**
 * One Happy Oyster world, end to end: reference image + prompt → world build →
 * live first-person stream with WASD/look controls.
 *
 * All Reactor access goes through `lib/reactor`. UI state is derived from the
 * SDK's authoritative snapshots (`phase`, `worldState`) rather than local
 * reconstruction, per the Happy Oyster docs.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactorWorldProvider,
  useReactorWorld,
  useReactorWorldTravelError,
} from "@/lib/reactor/world-provider";
import { describeReactorError } from "@/lib/reactor/errors";
import { getReactorJwt } from "@/lib/reactor/token";
import { WorldForm } from "./world-form";
import { LiveWorld } from "./live-world";
import { StageOverlay } from "./stage-overlay";

const CONNECTION_LABELS: Record<string, string> = {
  idle: "Initializing",
  connecting: "Connecting…",
  connected: "Connected",
  starting_stream: "Opening stream",
  streaming: "Streaming",
  ended: "Travel ended",
  failed: "Connection failed",
};

export function WorldConsole() {
  return (
    <ReactorWorldProvider>
      <Console />
    </ReactorWorldProvider>
  );
}

function Console() {
  const world = useReactorWorld();
  const { phase, worldState, streaming, disconnect } = world;

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formOpen, setFormOpen] = useState(true);
  
  // One auto-start per world: after the platform ends a travel (2-min budget)
  // we show explicit actions instead of looping into a new one.
  const startAttempted = useRef(false);
  const worldRef = useRef(world);
  worldRef.current = world;

  useReactorWorldTravelError((streamError) => {
    setError(describeReactorError(streamError));
  });

  const worldPhase = worldState?.phase ?? "no_world";
  const buildingWorld = worldPhase === "creating" || worldPhase === "building";
  // Only mount the <video> when actively traveling/streaming — not when merely
  // "ready", so the explicit "Enter world" overlay can show.
  const showVideo = worldPhase === "traveling" || streaming;
  const connected = phase === "connected" || phase === "starting_stream" || phase === "streaming";

  // DEV SAFETY: Do NOT auto-enter the world. Each startTravel() costs credits,
  // and hot-reloads during development re-mount the provider, which would
  // silently start new travel sessions. The user must click "Enter world".

  // DEV SAFETY: Auto-disconnect every 20 seconds during development to prevent
  // runaway credit usage if left idle or looping.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !streaming) return;
    const timer = setTimeout(() => {
      console.warn("Dev safety: auto-disconnecting after 20s to save credits.");
      worldRef.current.disconnect();
    }, 20_000);
    return () => clearTimeout(timer);
  }, [streaming]);

  const handleSubmit = useCallback(async (prompt: string, image: File | null) => {
    setError(null);
    setSubmitting(true);
    startAttempted.current = false;
    try {
      if (worldRef.current.phase === "idle" || worldRef.current.phase === "disconnected") {
        await worldRef.current.connect(getReactorJwt);
      }
      const created = await worldRef.current.createWorld({
        prompt,
        perspective: "first_person",
        ...(image ? { firstFrameImage: image } : {}),
      });
      // Worlds persist beyond the session — keep the id for a later attachWorld.
      if (created.encrypted_world_id) {
        window.localStorage.setItem("reactor-world-id", created.encrypted_world_id);
      }
      setFormOpen(false);
    } catch (submitError) {
      setError(describeReactorError(submitError));
    } finally {
      setSubmitting(false);
    }
  }, []);

  const enterAgain = useCallback(async () => {
    setError(null);
    startAttempted.current = true;
    try {
      await worldRef.current.startTravel();
    } catch (startError) {
      startAttempted.current = false;
      setError(describeReactorError(startError));
    }
  }, []);

  const reconnect = useCallback(() => {
    setError(null);
    worldRef.current.connect(getReactorJwt).catch((connectError: unknown) => {
      setError(describeReactorError(connectError));
    });
  }, []);

  const showForm =
    !streaming &&
    !buildingWorld &&
    !submitting &&
    (formOpen || worldPhase === "no_world" || worldPhase === "failed");

  return (
    <main className="console">
      <header className="console-header">
        <h1>
          Orbis <span>·</span> Happy Oyster
        </h1>
        <span className="connection-chip" data-state={phase}>
          <span className="dot" />
          {CONNECTION_LABELS[phase] ?? phase}
        </span>
      </header>

      {(error || phase === "failed") && (
        <div className="error-banner">
          <span>
            {error ?? "Connection to Reactor failed — check REACTOR_API_KEY and your network."}{" "}
            {phase === "failed" && (
              <button className="link-button" onClick={reconnect}>
                Reconnect
              </button>
            )}
          </span>
          {error && (
            <button onClick={() => setError(null)} aria-label="Dismiss">
              ✕
            </button>
          )}
        </div>
      )}

      <section className="stage" aria-label="World view">
        {showVideo ? (
          <LiveWorld world={world} onEnterAgain={() => void enterAgain()} onNewWorld={() => setFormOpen(true)} />
        ) : buildingWorld ? (
          <StageOverlay
            spinner
            title={worldPhase === "creating" ? "Creating world…" : "Building world…"}
            subtitle="Happy Oyster is generating the world from your prompt and reference image. This usually takes under a minute."
            imageUrl={worldState?.first_frame ?? null}
          />
        ) : worldPhase === "ready" ? (
          <StageOverlay
            title="World ready"
            subtitle="Your world has been generated. Click below to step in and explore."
            imageUrl={worldState?.first_frame ?? null}
          >
            <button className="primary" onClick={() => void enterAgain()}>
              Enter world
            </button>
            <button className="secondary" onClick={() => setFormOpen(true)}>
              Build a new world
            </button>
          </StageOverlay>
        ) : worldPhase === "failed" ? (
          <StageOverlay
            title="World build failed"
            subtitle="The prompt or reference image may have been rejected. Adjust them and try again below."
          />
        ) : (
          <StageOverlay
            title={connected ? "No world yet" : "Waiting for connection"}
            subtitle={
              connected
                ? "Describe a world below, attach a reference image, and generate it."
                : "Connecting to the Reactor Happy Oyster model…"
            }
          />
        )}
      </section>

      {showForm && (
        <WorldForm onSubmit={handleSubmit} submitting={submitting} disabled={!connected} />
      )}
    </main>
  );
}
