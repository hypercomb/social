// doctrine-hold.ts
//
// A MODEL'S CHANGE TO THE DOCTRINE WAITS FOR THE PARTICIPANT (2026-11-17).
//
// The doctrine is the `/doctrine` tile tree at the hive's root: a tile per
// tier, a tile per rule, each note a codex line. It is what every model is
// sent first and what Jev judges every change against, so a model that could
// add a rule, edit a note or remove a tile there on its own would be writing
// its own rules. The words `doctrine` and `doctrine tiles` are already the
// participant's alone; this closes the other door, the ordinary tile verbs.
//
// A change is held when it runs on a page at or under `/doctrine`, or when
// any of its lines names the `doctrine` tile (a path into it from the root, a
// step into it). Held means the Execution row waits for a hand whatever the
// policy and whatever Jev scored. It errs toward holding: a note that merely
// says the word waits too, which costs one press.
//
// Pure: the chat window hands it the page and the lines.

export const DOCTRINE_TILE = 'doctrine'

/** What the Execution row says about why it waits. */
export const DOCTRINE_HOLD = 'This changes the doctrine every model is taught, so it waits for you.'

const NAMED = /(^|[^a-z0-9_-])doctrine($|[^a-z0-9_-])/i

/** A page at or under the doctrine tile. */
export const inDoctrine = (segments: readonly string[]): boolean =>
  (segments[0] ?? '').trim().toLowerCase() === DOCTRINE_TILE

/** A change that runs in the doctrine, or names it. */
export const touchesDoctrine = (segments: readonly string[], lines: readonly string[]): boolean =>
  inDoctrine(segments) || lines.some(line => NAMED.test(line))
