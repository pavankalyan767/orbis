import { TOKEN_ROUTE } from "./config";

/**
 * Client-side JWT source for the Reactor SDK.
 *
 * The Reactor API key never reaches the browser: this fetches a short-lived,
 * session-scoped JWT from our own API route, which performs the key exchange
 * server-side. Passed to the SDK as a lazy resolver so later Coordinator
 * requests can mint a fresh token transparently.
 */
export async function getReactorJwt(): Promise<string> {
  const response = await fetch(TOKEN_ROUTE);
  if (!response.ok) {
    let detail = "";
    try {
      detail = ((await response.json()) as { error?: string }).error ?? "";
    } catch {
      // Non-JSON error body — fall through to the status line.
    }
    throw new Error(detail || `Reactor token request failed (${response.status})`);
  }
  const { jwt } = (await response.json()) as { jwt?: string };
  if (!jwt) throw new Error("Reactor token response contained no JWT");
  return jwt;
}
