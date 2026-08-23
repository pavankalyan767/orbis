import { HappyOysterActionError } from "@reactor-models/happy-oyster";

const ACTION_ERROR_HINTS: Record<string, string> = {
  TRAVELING: "End the active travel before creating or attaching a world.",
  BUSY: "Another world action is still running — wait a moment and retry.",
  NO_WORLD: "Create a world before starting a travel.",
  WORLD_NOT_READY: "The world is still building — try again once it is ready.",
  MODE_MISMATCH: "This world belongs to the other Happy Oyster experience.",
  "403001": "Unknown world id, or it belongs to another account.",
  "403004": "The prompt was rejected — try rewording it.",
  "403005": "The starting image was rejected — try a different landscape image.",
};

/** Human-readable message for any error thrown by the Reactor integration. */
export function describeReactorError(error: unknown): string {
  if (error instanceof HappyOysterActionError) {
    const hint = ACTION_ERROR_HINTS[String(error.code)] ?? error.message;
    return `${hint} (code ${error.code})`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
