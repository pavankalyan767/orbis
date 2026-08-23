/**
 * Local room image resolution.
 *
 * While Puter's txt2img is switched off (see `USE_PUTER_IMAGE_GEN` in
 * ./roomImageGen), room renders come from static files the user dropped into
 * `public/rooms/`. Next serves `public/` from the site root, so
 * `public/rooms/living_room.jpeg` is fetched at `/rooms/living_room.jpeg` —
 * same origin, which means it will not taint the canvas downstream.
 *
 * Room ids and names coming out of the vision parser are free text, so the
 * filename -> room matching has to be fuzzy rather than an enum lookup.
 */

/** Public path prefix the files are served from. */
const ROOM_IMAGE_DIR = '/rooms'

/** Files present under public/rooms/, served from the site root. */
export const LOCAL_ROOM_IMAGES: readonly string[] = [
  'bedroom.jpeg',
  'hall_room.jpeg',
  'living_room.jpeg',
]

/** Extensions stripped by `slugify` so filenames and room names normalise alike. */
const IMAGE_EXTENSION = /\.(jpe?g|png|webp|avif|gif|svg)$/i

/**
 * Generic token shared by many filenames ("living_room", "hall_room"). It is
 * ignored while matching so that `bedroom` cannot match `living_room` purely
 * because both mention a "room". Kept only when it is a side's sole token.
 */
const GENERIC_TOKEN = 'room'

/** Minimum shared prefix length for a stem match (lets `hall` match `hallway`). */
const MIN_PREFIX_MATCH = 4

/**
 * Lowercases, strips a trailing image extension, and collapses separators and
 * punctuation down to single spaces.
 *
 * `slugify('Master Bedroom')`  -> `'master bedroom'`
 * `slugify('living_room.jpeg')` -> `'living room'`
 * `slugify('Hall-Room')`        -> `'hall room'`
 */
export function slugify(input: string): string {
  if (!input) return ''
  return input
    .replace(IMAGE_EXTENSION, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** Splits a slug into its whitespace-delimited tokens. */
function tokenize(slug: string): string[] {
  return slug.length ? slug.split(' ') : []
}

/** Length of the common leading substring of two tokens. */
function sharedPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let i = 0
  while (i < max && a[i] === b[i]) i++
  return i
}

/** True when two tokens are equal, or one is a >= 4 character stem of the other. */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true
  if (!a.startsWith(b) && !b.startsWith(a)) return false
  return sharedPrefixLength(a, b) >= MIN_PREFIX_MATCH
}

/**
 * Drops the generic "room" token from both sides, unless "room" is the only
 * token one of the sides has (in which case it is the actual signal).
 */
function stripGenericTokens(
  fileTokens: string[],
  roomTokens: string[],
): { file: string[]; room: string[] } {
  const isSoleGeneric = (tokens: string[]) =>
    tokens.length === 1 && tokens[0] === GENERIC_TOKEN

  if (isSoleGeneric(fileTokens) || isSoleGeneric(roomTokens)) {
    return { file: fileTokens, room: roomTokens }
  }

  const drop = (tokens: string[]) => {
    const kept = tokens.filter((t) => t !== GENERIC_TOKEN)
    return kept.length ? kept : tokens
  }

  return { file: drop(fileTokens), room: drop(roomTokens) }
}

/**
 * Scores one filename against one room string. Returns 0 when they do not
 * match at all; higher is a better match.
 */
function scoreCandidate(fileSlug: string, roomSlug: string): number {
  if (!fileSlug || !roomSlug) return 0

  // 1. Exact slug match — always wins.
  if (fileSlug === roomSlug) return 1000

  const { file, room } = stripGenericTokens(tokenize(fileSlug), tokenize(roomSlug))
  if (!file.length || !room.length) return 0

  // 2 + 3. Token equality first, then >= 4 character prefix/stem matches.
  let exactPairs = 0
  const matchedFile = file.filter((f) =>
    room.some((r) => {
      if (!tokensMatch(f, r)) return false
      if (f === r) exactPairs++
      return true
    }),
  )
  const matchedRoom = room.filter((r) => file.some((f) => tokensMatch(f, r)))

  // Need at least one matched pair, and one side fully accounted for so a
  // stray token cannot drag in an unrelated room ("bathroom" vs "bedroom").
  if (!matchedFile.length) return 0
  const subset = matchedFile.length === file.length || matchedRoom.length === room.length
  if (!subset) return 0

  // 4. Rank by matched-token count, favouring exact token equality over stems.
  return matchedFile.length + matchedRoom.length + exactPairs * 2
}

/**
 * Resolves a room to a local image path like `/rooms/living_room.jpeg`,
 * or `null` when no file under public/rooms/ plausibly depicts it.
 */
export function resolveLocalRoomImage(roomId: string, roomName: string): string | null {
  const roomSlugs = [slugify(roomId ?? ''), slugify(roomName ?? '')].filter(Boolean)
  if (!roomSlugs.length) return null

  let bestFile: string | null = null
  let bestScore = 0

  for (const file of LOCAL_ROOM_IMAGES) {
    const fileSlug = slugify(file)
    const score = Math.max(...roomSlugs.map((slug) => scoreCandidate(fileSlug, slug)))
    if (score <= 0) continue

    if (
      score > bestScore ||
      // 4. Deterministic tie-break: shortest filename, then alphabetical.
      (score === bestScore &&
        bestFile !== null &&
        (file.length < bestFile.length ||
          (file.length === bestFile.length && file < bestFile)))
    ) {
      bestScore = score
      bestFile = file
    }
  }

  // 5. Nothing plausible.
  return bestFile ? `${ROOM_IMAGE_DIR}/${bestFile}` : null
}
