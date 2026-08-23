import { NextResponse } from "next/server";
import { REACTOR_ADVENTURE_MODEL } from "@/lib/reactor/config";

// Ask for the server ceiling; Reactor clamps to its own max and reports the
// real expiry in `expires_at`, which drives the browser cache window below.
const TOKEN_LIFETIME_SECONDS = 6 * 60 * 60;
const CACHE_SKEW_SECONDS = 60;

/**
 * Mint a short-lived, session-scoped Reactor JWT for the browser.
 *
 * The `REACTOR_API_KEY` (rk_…) lives only in this server process: the key is
 * exchanged here for a JWT that can do nothing beyond opening sessions on the
 * Happy Oyster Adventure model. Exposed as GET (not POST) so the browser's
 * HTTP cache can reuse the JWT for the rest of its lifetime — no localStorage,
 * no JWT parsing client-side. `private` keeps shared caches out.
 */
export async function GET() {
  const apiKey = process.env.REACTOR_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "REACTOR_API_KEY is not set on the server" },
      { status: 500 },
    );
  }

  const baseUrl = process.env.REACTOR_API_URL || "https://api.reactor.inc";

  const response = await fetch(`${baseUrl}/tokens`, {
    method: "POST",
    headers: {
      "Reactor-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: TOKEN_LIFETIME_SECONDS,
      authorization_details: [
        {
          type: "session",
          resources: { models: { match: [REACTOR_ADVENTURE_MODEL] } },
        },
      ],
    }),
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: `Reactor token exchange failed (${response.status})` },
      { status: 502 },
    );
  }

  const { jwt, expires_at } = (await response.json()) as {
    jwt?: string;
    expires_at?: number;
  };
  if (!jwt) {
    return NextResponse.json(
      { error: "Reactor token response contained no JWT" },
      { status: 502 },
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const maxAge = Math.max(0, (expires_at ?? nowSeconds) - nowSeconds - CACHE_SKEW_SECONDS);

  return NextResponse.json(
    { jwt },
    { headers: { "Cache-Control": `private, max-age=${maxAge}` } },
  );
}
