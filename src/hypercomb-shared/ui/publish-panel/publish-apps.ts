// hypercomb-shared/ui/publish-panel/publish-apps.ts
//
// WHAT EACH DOMAIN HOSTS (jwize 2026-10-24: "each of these should be
// expandable to see the applications hosted on each domain there shouldn't be
// any duplicate values"; then "each should be … selectable to publish changes
// only on selected … so you can have them available to create a group and
// then publish to it as well").
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

/** What a domain hosts that was published from ANOTHER device: real index
 *  entries this hive has no path for. Counted and named (by key), never picked
 *  or given an address — theirs is only the bare domain. */
export function othersOn<T extends AppRow>(rows: readonly T[], zone: string): T[] {
  const seen = new Set<string>()
  return rows
    .filter(row => row.segments.length === 0 && opensOn(row, zone))
    .filter(row => !seen.has(row.key) && !!seen.add(row.key))
    .sort((a, b) => a.key.localeCompare(b.key))
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

/** The rows a selection names, as they stand now — a key whose row is gone
 *  (forgotten, unpublished elsewhere) drops out. */
export function selectedRows<T extends AppRow>(rows: readonly T[], keys: ReadonlySet<string>): T[] {
  return rows.filter(row => keys.has(row.key) && row.segments.length > 0)
}

/** A selection keeps only keys that still have a row. */
export function pruneSelection(rows: readonly AppRow[], keys: ReadonlySet<string>): ReadonlySet<string> {
  const live = new Set(rows.filter(row => row.segments.length > 0).map(row => row.key))
  const kept = [...keys].filter(key => live.has(key))
  return kept.length === keys.size ? keys : new Set(kept)
}

/** A publish group holds tiles of ONE page (publish-groups.md): the page the
 *  selected apps share, and each one's name on it — or null when they do not
 *  share one. */
export function groupPage(rows: readonly AppRow[]): { segments: string[]; members: string[] } | null {
  if (rows.length === 0) return null
  const parent = rows[0].segments.slice(0, -1)
  const same = rows.every(row =>
    row.segments.length === parent.length + 1 && parent.every((s, i) => row.segments[i] === s))
  if (!same) return null
  return { segments: [...parent], members: [...new Set(rows.map(row => row.segments[row.segments.length - 1]))] }
}

// ── BY GROUP (jwize 2026-10-24: "short list by group filters … on click group
// comes back to list also group management from the main table multiselect
// and click group") ───────────────────────────────────────────────────────

/** Is this app a member of a group on `page`? A group holds that page's
 *  tiles by name, so only a direct child wearing one of the names is in. */
export function inGroup(row: AppRow, page: readonly string[], members: readonly string[]): boolean {
  return row.segments.length === page.length + 1
    && page.every((s, i) => row.segments[i] === s)
    && members.includes(row.segments[row.segments.length - 1])
}

/** ROW SELECT, as the shell's other lists: a press picks the row or lets it
 *  go; with Shift it picks every row from the last one pressed to this one
 *  (the anchor), in the order the list shows them. Keys are what a row is
 *  picked by. */
export function pickedAfterPress(picked: ReadonlySet<string>, keys: readonly string[], key: string,
  anchor: string | null, shift: boolean): ReadonlySet<string> {
  const from = anchor === null ? -1 : keys.indexOf(anchor)
  const to = keys.indexOf(key)
  const next = new Set(picked)
  if (shift && from >= 0 && to >= 0) {
    const [lo, hi] = from <= to ? [from, to] : [to, from]
    for (let i = lo; i <= hi; i++) next.add(keys[i])
    return next
  }
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/** How much of a group the picked names already are: `all` means a press
 *  takes them out, anything else puts the rest in. */
export function groupCoverage(picked: readonly string[], members: readonly string[]): 'all' | 'some' | 'none' {
  const held = picked.filter(name => members.includes(name)).length
  return picked.length > 0 && held === picked.length ? 'all' : held > 0 ? 'some' : 'none'
}
