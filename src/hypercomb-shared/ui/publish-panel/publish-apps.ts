// hypercomb-shared/ui/publish-panel/publish-apps.ts
//
// WHAT EACH DOMAIN HOSTS, AND HOW A CREATION STANDS ACROSS A SET OF THEM
// (jwize 2026-11-04: the Publish window is a drilldown — the domains, then the
// creations on one domain or on several together; a creation live on only some
// of them is MIXED, and Sync makes it one state or the other).
//
// Pure: the Publish panel's rows in, answers out — no Angular, no bus, so a
// spec reads them without rendering the panel. The rows are the publish
// drone's (every branch published from here, every key a door's index names),
// mirrored by the panel.

/** The fields of a Publish row these answers read. */
export interface AppRow {
  key: string
  path: string
  segments: string[]
  state: string
  live: string | null
  /** Domains the signed index opens this branch on; null = every domain. */
  doors: string[] | null
  /** zone → where it is shown there ('' = no address there yet). */
  urls: Record<string, string>
}

/** Is it published on this domain? Only while the signed index names it —
 *  and, when its entry lists doors, only on those. */
export const opensOn = (row: AppRow, zone: string): boolean =>
  !!row.live && (row.doors === null || row.doors.includes(zone))

/** What one domain hosts: every branch published there that THIS hive can
 *  act on, once each, by path. A row published from another device has no
 *  path here — its address resolves to the bare domain, which is the
 *  duplicate a domain row must never show — so it is not listed. */
export function appsOn<T extends AppRow>(rows: readonly T[], zone: string): T[] {
  const seen = new Set<string>()
  return rows
    .filter(row => row.segments.length > 0 && opensOn(row, zone))
    .filter(row => !seen.has(row.key) && !!seen.add(row.key))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/** Where an app is read on a domain, as a person reads it — no scheme. '' when
 *  the domain has no address for it yet. An app at the domain's own front page
 *  (its own address `@`) reads as the domain itself: the caller says so in a
 *  word rather than show the domain twice. */
export const shownAt = (row: AppRow, zone: string): string =>
  String(row.urls?.[zone] ?? '').replace(/^https?:\/\//, '')

/** Has what is here moved past what the world is served? `gone` too: the
 *  host lost the head, so publishing puts it back. `unknown`, `cannot-compare`
 *  and `comparing` are never changes — they mean nothing could be proved. */
export const hasChanges = (row: AppRow): boolean => row.state === 'drift' || row.state === 'gone'

// ── A SET OF DOMAINS (a group, or a ctrl-selection) ─────────────────────

/** How a creation stands across a set of domains: on every one, on none, or on
 *  some — the mixed state Sync resolves. An empty set holds nothing: off. */
export type ScopeState = 'on' | 'off' | 'mixed'

export function scopeState(zones: readonly string[], isOn: (zone: string) => boolean): ScopeState {
  if (zones.length === 0) return 'off'
  const on = zones.filter(isOn).length
  return on === 0 ? 'off' : on === zones.length ? 'on' : 'mixed'
}

/** The domains a switch to `want` has to move: only those not already there. */
export const zonesToMove = (zones: readonly string[], isOn: (zone: string) => boolean, want: boolean): string[] =>
  zones.filter(zone => isOn(zone) !== want)

/** What a press on a creation does across a set: off turns it on everywhere, on
 *  turns it off everywhere, and a mix is synced to ON — the state a press on a
 *  half-lit switch asks for. */
export const wantAfterPress = (state: ScopeState): boolean => state !== 'on'

// ── SEARCH (jwize 2026-11-04: "the search at the top, always visible … the same
// domains and items get filtered on text search") ───────────────────────────

/** Does the text hold every word of the query? Case and accents ignored, the
 *  order of the words free; an empty query holds everything. */
export function matchesQuery(query: string, ...parts: readonly string[]): boolean {
  const fold = (text: string): string => text.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = fold(parts.join(' '))
  return words.every(word => haystack.includes(word))
}
