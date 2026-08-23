"use client";

/**
 * The single import point for the Happy Oyster React SDK in this app.
 *
 * Everything Reactor-specific — provider, video element, hooks, held-control
 * input mapping — lives inside `lib/reactor`; app components consume only
 * these wrappers, so the integration can be swapped or extended in one place.
 */
import type { VideoHTMLAttributes } from "react";
import {
  HappyOysterProvider,
  HappyOysterVideo,
  useHappyOyster,
  useHappyOysterTravelError,
} from "@reactor-models/happy-oyster/react";
import { ADVENTURE_MAX_EXPERIENCE_SEC } from "@reactor-models/happy-oyster";
import { getReactorJwt } from "./token";

/** Longest Adventure travel the platform grants — sizes the HUD countdown. */
export { ADVENTURE_MAX_EXPERIENCE_SEC };

/**
 * App-wide Adventure session. Mounts one mode-fixed client (Adventure =
 * first-person movement/look controls), authenticates with the server-minted
 * JWT resolver, and connects automatically on mount.
 */
export function ReactorWorldProvider({ children }: { children: React.ReactNode }) {
  return (
    <HappyOysterProvider mode="adventure" jwt={getReactorJwt}>
      {children}
    </HappyOysterProvider>
  );
}

/** Reactive Happy Oyster session: lifecycle phase, world/travel snapshots, and actions. */
export function useReactorWorld() {
  return useHappyOyster();
}

export type ReactorWorld = ReturnType<typeof useHappyOyster>;

/** The <video> element the live world stream renders into (mount before startTravel). */
export function ReactorWorldVideo(props: VideoHTMLAttributes<HTMLVideoElement>) {
  return <HappyOysterVideo {...props} />;
}

/** Subscribe to runtime errors from the live world stream. */
export function useReactorWorldTravelError(handler: (error: unknown) => void) {
  useHappyOysterTravelError(handler);
}
