// The publication ledger — the read side of publish/unpublish.
//
// A publication-directory host (pluginthematrix.com) answers
// `GET /publications.json` with its operator-approved publisher bindings
// and, per publisher, the verified signed head of that lineage — null until
// the approved key has actually published it. The worker builds the answer
// from the same publisher-signed hive indexes every other read trusts, so
// the ledger IS the publish state: publishing a branch puts its site here,
// unpublishing takes it away, and nothing is hand-maintained.
//
// This module is the ledger's reader. Same-origin first — a directory site
// always carries its own ledger, and the visitor profile's read-only
// network gate admits only same-origin GETs, so the deployed case never
// leaves the door it came in through. Away from a directory host (the
// authoring hive, the dev shell) the same creation still renders: the read
// falls back to the canonical public directory, whose worker answers with
// open CORS. The fallback is a default, not a binding — a different
// deployment's own origin always answers first.

/** One approved publisher on a site binding, as the worker reports it. */
export interface LedgerPublisher {
  readonly pubkey: string
  readonly label: string
  readonly primary?: boolean
  /** The verified signed head — null means "approved, never published". */
  readonly head: string | null
  readonly publishedAt: number | null
}

/** One address a creation answers on. A creation reachable through two zones
 *  has two of these; `primary` is the first, and equals the site's own `host`. */
export interface LedgerDoor {
  readonly host: string
  readonly url: string
  readonly primary: boolean
  /** Brought to life by the wildcard rule rather than bound by hand. */
  readonly implicit: boolean
}

/** One bound site in the directory host's `SITE_BINDINGS`. */
export interface LedgerSite {
  readonly host: string
  readonly url: string
  readonly title: string
  readonly lineage: string
  readonly publishers: readonly LedgerPublisher[]
  /** Every door, primary first. Absent from a worker that predates the field —
   *  read it through `doorsOf`, never directly. */
  readonly hosts?: readonly LedgerDoor[]
}

/** One plate on the directory page — a site somebody has actually
 *  published. Everything here is already verified by the worker; the view
 *  renders it without a second trust decision. */
export interface PublicationCard {
  readonly host: string
  readonly url: string
  readonly title: string
  readonly lineage: string
  readonly publisherLabel: string
  /** Unix seconds. */
  readonly publishedAt: number | null
  /** Every address this creation answers on, primary first — never empty, and
   *  `hosts[0].host === host` always. */
  readonly hosts: readonly LedgerDoor[]
}

/** The public directory this beehavior reads when its own origin has no
 *  ledger (authoring hive, dev shell). A deployed directory site never
 *  reaches this — same origin answers first. */
export const CANONICAL_DIRECTORY = 'https://pluginthematrix.com/publications.json'

const SIG_RE = /^[0-9a-f]{64}$/

/** The publisher whose publication puts the site on the page: the primary
 *  when the primary has published, else the first approved key that has.
 *  Nobody published → no plate; that IS the unpublish gesture. */
const publishedBy = (site: LedgerSite): LedgerPublisher | null => {
  const published = site.publishers.filter(p => typeof p.head === 'string' && SIG_RE.test(p.head))
  if (!published.length) return null
  return published.find(p => p.primary) ?? published[0]
}

/** A site's doors, primary first. A worker that predates `hosts` reports one
 *  address in `host`; that is still a door, so it becomes the whole list rather
 *  than an empty one. Anything malformed falls back the same way. */
export function doorsOf(site: LedgerSite): readonly LedgerDoor[] {
  const doors = Array.isArray(site.hosts)
    ? site.hosts.filter((d): d is LedgerDoor => typeof d?.host === 'string' && typeof d?.url === 'string')
    : []
  if (doors.length) return doors
  return [{ host: site.host, url: site.url, primary: true, implicit: false }]
}

/** Ledger JSON → plates. Pure — the fetch stays at the edge so this shape
 *  is provable without a network. `exclude` names the directory itself
 *  (its own host, and the lineage the view is standing on): the page is
 *  the door, never a door to itself — and a directory reached through its
 *  SECOND name must exclude itself just as surely, which is why this tests
 *  every door and not only the primary. */
export function shapePublications(
  sites: readonly unknown[],
  exclude: { host?: string; lineage?: string } = {},
): PublicationCard[] {
  const cards: PublicationCard[] = []
  for (const raw of sites) {
    const site = raw as Partial<LedgerSite>
    if (typeof site?.host !== 'string' || typeof site.url !== 'string'
      || typeof site.title !== 'string' || typeof site.lineage !== 'string'
      || !Array.isArray(site.publishers)) continue
    const doors = doorsOf(site as LedgerSite)
    if (exclude.host && doors.some(d => d.host === exclude.host)) continue
    if (exclude.lineage && site.lineage === exclude.lineage) continue
    const publisher = publishedBy(site as LedgerSite)
    if (!publisher) continue
    cards.push({
      host: site.host,
      url: site.url,
      hosts: doors,
      title: site.title,
      lineage: site.lineage,
      publisherLabel: publisher.label || publisher.pubkey.slice(0, 12) + '…',
      publishedAt: publisher.publishedAt,
    })
  }
  // Newest shared first — the page reads as "what just arrived".
  return cards.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
}

/** Read the ledger and shape it. Null means NO ledger answered — distinct
 *  from an empty page, which is a ledger honestly reporting that nothing
 *  has been published yet.
 *
 *  `directory` is the DISCOVERY door: an explicit origin whose ledger is
 *  wanted verbatim — no same-origin preference, no canonical fallback, so
 *  an unreachable domain reads as unreachable rather than as somewhere
 *  else's ledger wearing its name. */
export async function fetchPublicationCards(
  exclude: { host?: string; lineage?: string } = {},
  directory?: string,
): Promise<PublicationCard[] | null> {
  const doors = directory
    ? [`${directory.replace(/\/+$/, '')}/publications.json`]
    : ['/publications.json', CANONICAL_DIRECTORY]
  for (const url of doors) {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) continue
      const body = await response.json() as { sites?: unknown[] }
      if (!Array.isArray(body?.sites)) continue
      return shapePublications(body.sites, exclude)
    } catch { /* same-origin miss or gated cross-origin — try the next door */ }
  }
  return null
}
