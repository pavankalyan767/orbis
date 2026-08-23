import { TOKEN_ROUTE } from "./config";

/**
 * Client-side JWT source for the Reactor SDK.
 *
 * The Reactor API key never reaches the browser: this fetches a short-lived,
 * session-scoped JWT from our own API route, which performs the key exchange
 * server-side. Passed to the SDK as a lazy resolver so later Coordinator
 * requests can mint a fresh token transparently.
 */
let tokenPromise: Promise<string> | null = null;
let jwtExpiresAt = 0;

export async function getReactorJwt(): Promise<string> {
  // Reuse the cached promise if it's still valid for at least 5 more minutes
  if (tokenPromise && Date.now() < jwtExpiresAt - 5 * 60 * 1000) {
    return tokenPromise;
  }

  // Create a new promise and cache it immediately so concurrent calls await this exact same promise
  tokenPromise = (async () => {
    const response = await fetch(TOKEN_ROUTE, { cache: 'no-cache' });
    if (!response.ok) {
      let detail = "";
      try {
        detail = ((await response.json()) as { error?: string }).error ?? "";
      } catch {
        // Non-JSON error body — fall through to the status line.
      }
      tokenPromise = null; // Clear on failure so next call retries
      throw new Error(detail || `Reactor token request failed (${response.status})`);
    }
    
    const { jwt } = (await response.json()) as { jwt?: string };
    if (!jwt) {
      tokenPromise = null; // Clear on failure
      throw new Error("Reactor token response contained no JWT");
    }
    
    jwtExpiresAt = Date.now() + 60 * 60 * 1000; // 1 hour from now
    return jwt;
  })();
  
  return tokenPromise;
}
