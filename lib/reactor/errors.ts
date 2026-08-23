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
  credits_depleted: "Your Reactor account credits are depleted. Please top up your credits on reactor.inc to continue.",
};

/** Human-readable message for any error thrown by the Reactor integration. */
export function describeReactorError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const errObj = error as Record<string, any>;
    if (errObj.error === "credits_depleted" || errObj.code === "credits_depleted" || errObj.message?.includes("credits_depleted")) {
      return "Your Reactor account credits are depleted. Please top up your credits on reactor.inc to continue.";
    }
  }
  if (error instanceof HappyOysterActionError) {
    const hint = ACTION_ERROR_HINTS[String(error.code)] ?? error.message;
    return `${hint} (code ${error.code})`;
  }
  if (error instanceof Error) {
    if (error.message.includes("credits_depleted")) {
      return "Your Reactor account credits are depleted. Please top up your credits on reactor.inc to continue.";
    }
    return error.message;
  }
  return String(error);
}
