// navigation/walk.ts
//
// The pure half of `walk` (walk.queen.ts): which pages a walk stops at, and
// what the word asked for. No IoC, no timers, no navigation — the queen owns
// those.

/** A location's children, or null when it will not read (cold). */
export type ReadChildren = (segments: readonly string[]) => Promise<readonly { name: string }[] | null>

/** How far beneath the page you stand on a walk goes. */
export const WALK_DEPTH = 6
/** The most stops one round holds. */
export const WALK_PAGES = 64
/** How long a stop lasts, unless the word says otherwise. */
export const WALK_SECONDS = 45
export const WALK_MIN_SECONDS = 10
export const WALK_MAX_SECONDS = 600

/** The stops of a walk from `root`: the root, then every tile beneath it that
 *  holds tiles of its own, depth first, in the order the tiles stand. A tile
 *  with nothing inside is read where it stands, never stopped in — its page
 *  would be empty. Each page is read where it stands: what a parent's layer
 *  remembers of a child can be an older version of it. A page that will not
 *  read is left for the next round. */
export async function walkRoute(
  read: ReadChildren,
  root: readonly string[],
  depth = WALK_DEPTH,
  cap = WALK_PAGES,
): Promise<string[][]> {
  const stops: string[][] = []
  const visit = async (page: string[], rows: readonly { name: string }[] | null): Promise<void> => {
    if (stops.length >= cap) return
    stops.push(page)
    if (page.length - root.length >= depth) return
    for (const row of rows ?? []) {
      const inside = await read([...page, row.name])
      if (inside?.length) await visit([...page, row.name], inside)
    }
  }
  await visit([...root], await read(root))
  return stops
}

export type WalkWord =
  | { readonly verb: 'start'; readonly seconds: number }
  | { readonly verb: 'stop' }
  | { readonly verb: 'refuse' }

/** `walk` · `walk every <seconds>` · `walk stop`. Seconds outside 10–600 are
 *  brought inside; the queen says the seconds it walks at. */
export function parseWalk(args: string): WalkWord {
  const text = args.trim().toLowerCase()
  if (!text) return { verb: 'start', seconds: WALK_SECONDS }
  if (text === 'stop') return { verb: 'stop' }
  const every = /^every\s+(\d+)\s*s?$/.exec(text)
  if (!every) return { verb: 'refuse' }
  const seconds = Math.min(WALK_MAX_SECONDS, Math.max(WALK_MIN_SECONDS, Number(every[1])))
  return { verb: 'start', seconds }
}
