/**
 * Shown when the server has no REACTOR_API_KEY: the app renders nothing that
 * would attempt a connection until a key is configured.
 */
export function SetupRequired() {
  return (
    <main className="setup-required">
      <h1>
        Orbis <span>·</span> Happy Oyster
      </h1>
      <p>
        This prototype builds one first-person Happy Oyster world on{" "}
        <a href="https://reactor.inc" target="_blank" rel="noreferrer">
          Reactor
        </a>
        . Before it can connect, it needs a Reactor API key on the server side.
      </p>
      <div className="steps">
        <b>1.</b> Create an API key at <b>reactor.inc → Account → API keys</b>{" "}
        (it starts with <code>rk_…</code>).
        <br />
        <b>2.</b> Copy <code>.env.local.example</code> to <code>.env.local</code>{" "}
        and set <code>REACTOR_API_KEY</code>.
        <br />
        <b>3.</b> Restart <code>npm run dev</code> and reload this page.
      </div>
      <p>
        The key is exchanged server-side for short-lived session JWTs — it never
        reaches the browser.
      </p>
    </main>
  );
}
