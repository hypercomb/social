// hypercomb-shared/ui/publish-panel/publish-apps.ts
//
// WHAT EACH DOMAIN HOSTS, AND WHAT FEEDS YOUR COMMUNITY (jwize 2026-11-04: the
// Publish window is a drilldown; 2026-11-16: a domain is on and off only —
// on stages a creation there — and the community is apart, fed by every domain,
// a staged creation gray in it until it is published live).
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

// ── YOUR COMMUNITY (jwize 2026-11-16: "you should have your own domain and the
// community separate since you are feeding the community from all domains
// including yourself … all items go in the community; if there are multiple
// versions you should be able to drill down into the children and click the one
// of them") ─────────────────────────────────────────────────────────────────

/** One version of a creation: whose it is, which lineage, the domains it is on. */
export interface CommunityVersion {
  pubkey: string
  lineage: string
  name: string
  hosts: string[]
  /** In the owners' signed showcase: what every visitor of the community sees. */
  live: boolean
  /** This hive's own creation. */
  own: boolean
}

/** One name in the community, and every version of it. Live when one of them is;
 *  otherwise every version is gray — staged, on in a domain and waiting. */
export interface CommunityEntry {
  name: string
  versions: CommunityVersion[]
  live: boolean
}

type Version = { pubkey: string; lineage: string; name?: string; hosts?: readonly string[] }

/** ONE NAME, HOWEVER IT IS WRITTEN (jwize 2026-11-16: "I am seeing two business-card entries"): a tile's own label
 *  ("Business Card"), a lineage word ("business-card") and an offer's name are one community entry when they are one
 *  name: case, accents and separators (spaces, hyphens, underscores) folded — nothing else, so "C++" and "C#" stay two. */
export const communityNameKey = (name: string): string =>
  name.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '') || name.trim().toLowerCase()

/** The last label of a lineage — the word a creation is known by. */
export const lineageName = (lineage: string): string =>
  lineage.split('/').map(part => part.trim()).filter(Boolean).at(-1) ?? lineage

/**
 * Everything feeding the community, one entry per name: this hive's creations on
 * in its domains, what the domains it follows offer, and whatever the signed
 * showcase names that neither knows (so a live one can always be taken out). The
 * same version from several feeds is one version naming every domain. Entries by
 * name; inside one, the live version first, then by domain.
 */
export function communityEntries(
  ownKey: string,
  own: readonly Version[],
  offered: readonly Version[],
  live: readonly { pubkey: string; lineage: string }[],
): CommunityEntry[] {
  const id = (v: { pubkey: string; lineage: string }): string => `${v.pubkey}\n${v.lineage}`
  const isLive = new Set(live.map(id))
  const found = new Map<string, CommunityVersion>()
  const take = (v: Version): void => {
    if (!v.pubkey || !v.lineage) return
    const held = found.get(id(v))
    const hosts = (v.hosts ?? []).map(h => h.toLowerCase()).filter(Boolean)
    if (held) { held.hosts = [...new Set([...held.hosts, ...hosts])].sort(); return }
    found.set(id(v), {
      pubkey: v.pubkey, lineage: v.lineage, name: (v.name || lineageName(v.lineage)).trim() || v.lineage,
      hosts: [...new Set(hosts)].sort(), live: isLive.has(id(v)), own: v.pubkey === ownKey,
    })
  }
  for (const v of own) take(v)
  for (const v of offered) take(v)
  for (const v of live) take(v)
  const byName = new Map<string, CommunityVersion[]>()
  for (const v of found.values()) {
    const key = communityNameKey(v.name)
    byName.set(key, [...(byName.get(key) ?? []), v])
  }
  return [...byName.values()]
    .map(versions => {
      versions.sort((a, b) => Number(b.live) - Number(a.live) || (a.hosts[0] ?? '').localeCompare(b.hosts[0] ?? '') || id(a).localeCompare(id(b)))
      return { name: versions[0].name, versions, live: versions.some(v => v.live) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** What a press on one version asks the drone: live → out; otherwise live, and
 *  every other live version of that name out with it — one version of a name is
 *  live at a time. */
export function communityPress(entry: CommunityEntry, version: CommunityVersion): {
  pubkey: string; lineage: string; on: boolean; others: { pubkey: string; lineage: string }[]
} {
  const on = !version.live
  const others = on
    ? entry.versions.filter(v => v.live && !(v.pubkey === version.pubkey && v.lineage === version.lineage)).map(v => ({ pubkey: v.pubkey, lineage: v.lineage }))
    : []
  return { pubkey: version.pubkey, lineage: version.lineage, on, others }
}

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
