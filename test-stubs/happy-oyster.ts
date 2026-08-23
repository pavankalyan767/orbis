/**
 * CommonJS stub for @reactor-models/happy-oyster.
 *
 * The real package is ESM-only ("type": "module", and its exports map offers
 * no "require" condition), so Jest's CJS resolver cannot load it. Nothing
 * under navigation/tests/ exercises real SDK behaviour — the session tests
 * drive a hand-built fake facade — so mapping the package to this stub keeps
 * the suite in fast CJS/node mode instead of forcing ESM Jest.
 *
 * Only the symbols our own modules import at VALUE level need to exist here.
 */

/** Mirrors the SDK's action-error shape so `instanceof` narrowing still works. */
export class HappyOysterActionError extends Error {
  readonly action: string
  readonly code: string

  constructor(action: string, code: string, message: string) {
    super(`[${code}] ${message}`)
    this.name = 'HappyOysterActionError'
    this.action = action
    this.code = code
  }
}

export const ADVENTURE_MAX_EXPERIENCE_SEC = 120
