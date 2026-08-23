/**
 * The single home for Reactor identifiers used by this app.
 *
 * Happy Oyster exposes one Reactor model slug per experience; this prototype
 * is Adventure-only (first-person, held movement/look controls). The slug is
 * fixed for the life of a session — switching experience means connecting to
 * the other model.
 */
export const REACTOR_ADVENTURE_MODEL = "reactor/happy-oyster-adventure";

/** Server-side token-mint endpoint (our own Next.js route). */
export const TOKEN_ROUTE = "/api/reactor/token";
