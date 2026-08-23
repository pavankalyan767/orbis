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
  idle: "Idle",
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
  const { phase, worldState, streaming } = world;

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formOpen, setFormOpen] = useState(true);

  const startAttempted = useRef(false);
  const worldRef = useRef(world);
  worldRef.current = world;

  useReactorWorldTravelError((streamError) => {
    setError(describeReactorError(streamError));
  });

  const worldPhase = worldState?.phase ?? "no_world";
  const buildingWorld = worldPhase === "creating" || worldPhase === "building";
  
  // Video element MUST remain mounted whenever a world is ready, traveling, or stream is starting,
  // so <ReactorWorldVideo /> is in the DOM when startTravel() is called.
  const showVideo =
    worldPhase === "ready" ||
    worldPhase === "traveling" ||
    streaming ||
    phase === "starting_stream";

  // DEV SAFETY: Auto-end travel after 20 seconds of streaming during development.
  // We call endTravelSession() instead of disconnect() so WebRTC stream stops,
  // credit burn stops, but the Reactor session & world remain attached and ready!
  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !streaming) return;
    const timer = setTimeout(() => {
      console.warn("Dev safety: ending travel session after 20s to save credits.");
      worldRef.current.endTravelSession().catch(() => {});
    }, 20_000);
    return () => clearTimeout(timer);
  }, [streaming]);

  const handleSubmit = useCallback(async (prompt: string, image: File | null) => {
    setError(null);
    setSubmitting(true);
    startAttempted.current = false;
    try {
      if (worldRef.current.streaming) {
        await worldRef.current.endTravelSession();
      }
      const p = worldRef.current.phase;
      // Connect if not already connected/streaming
      if (p !== "connected" && p !== "starting_stream" && p !== "streaming") {
        await worldRef.current.connect(getReactorJwt);
      }
      const created = await worldRef.current.createWorld({
        prompt,
        perspective: "first_person",
        ...(image ? { firstFrameImage: image } : {}),
      });
      if (created.encrypted_world_id && typeof window !== "undefined") {
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
      const p = worldRef.current.phase;
      if (p !== "connected" && p !== "starting_stream" && p !== "streaming") {
        await worldRef.current.connect(getReactorJwt);
      }
      
      const savedWorldId =
        worldRef.current.worldState?.encrypted_world_id ||
        (typeof window !== "undefined" ? window.localStorage.getItem("reactor-world-id") : null);

      if (!worldRef.current.worldState && savedWorldId) {
        await worldRef.current.attachWorld(savedWorldId);
      }

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
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          {streaming && (
            <button 
              className="link-button" 
              onClick={() => worldRef.current.endTravelSession().catch(() => {})}
              style={{ color: "#ff4444", fontSize: "0.85rem", fontWeight: "bold" }}
            >
              End Travel (Stop Billing)
            </button>
          )}
          <span className="connection-chip" data-state={phase}>
            <span className="dot" />
            {CONNECTION_LABELS[phase] ?? phase}
          </span>
        </div>
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
        ) : worldPhase === "failed" ? (
          <StageOverlay
            title="World build failed"
            subtitle="The prompt or reference image may have been rejected. Adjust them and try again below."
          />
        ) : (
          <StageOverlay
            title="No world yet"
            subtitle="Describe a world below, attach a reference image, and click Generate to connect to Happy Oyster and build it."
          />
        )}
      </section>

      {showForm && (
        <WorldForm onSubmit={handleSubmit} submitting={submitting} disabled={false} />
      )}
    </main>
  );
}
