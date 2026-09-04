// molecule/vocabulary-horizon.ts
//
// WHO TO ASK — assembled from what this reader already holds, and nothing
// else. Pure: it takes its sources as an argument, so the spec never reads
// localStorage, never opens a pool, and never contacts a host.
//
// `foldHorizon` already exists and has no caller outside `vocabulary-search.ts`
// — there has never been a builder. This is it, and it is deliberately thin:
// every source below is something the participant chose (a branch they
// visited, a root they follow, a host they added), so the routing table is a
// consequence of their own history rather than a directory somebody serves.
//
// ── AN EMPTY HORIZON IS A STATE, NOT AN EMPTY RESULT ────────────────────
//
// `searchVocabulary` returns `findings: []` for an empty horizon and ONLY for
// an empty horizon. That is the one case a surface must render with its own
// words ("nobody to ask") rather than as a miss — see `EMPTY_HORIZON` in
// `vocabulary-words.ts`. This module therefore never invents a publisher to
// pad the list: a reader who follows nobody genuinely has nobody to ask.
//
// ── A ZONE IS NOT A DOOR, AND A SHARED DOOR IS NOT FREE ─────────────────
//
// A community host is recorded as a ZONE (`example.com`); the content door is
// `content.<zone>`, the same shape `defaultVocabularyPublishDeps().host`
// resolves.
//
// Shared doors are NOT handed to every publisher. `hiveIndexUrl` puts the
// publisher's key in the PATH, so asking a shared host about every publisher
// this reader follows discloses the follow graph, in one burst, to a host that
// hosts none of them. The standing public endpoint is never used as a
// per-publisher door at all. A community zone the participant added is offered
// ONLY to a publisher for whom this reader holds no door of its own — a bounded
// disclosure the participant chose by adding the zone, never a broadcast.
//
// `foldHorizon` does the rest: it drops ws/wss relay addresses, refuses
// anything that is not a bare authority (a host carrying a path or credentials
// would send the signatures this reader is probing for somewhere of the
// horizon-writer's choosing), and gives a malformed key its OWN row so N
// publishers in can never become fewer than N rows out.

import { foldHorizon, type VocabularyHorizon, type VocabularyPublisher } from './vocabulary-search.js'

/** A visited branch, as `visit-genome.ts` records it. */
export interface HorizonVisit {
  readonly pubkey?: string
  readonly domain?: string
}

/** One entry of `hc:static-follows` — `{ "<rootName>": { pubkey, hosts } }`. */
export interface HorizonFollow {
  readonly pubkey?: string
  readonly hosts?: readonly string[]
}

export interface HorizonSources {
  /** Branches this participant has walked into. */
  readonly visits?: readonly HorizonVisit[]
  /** Roots this participant follows, by root name. */
  readonly follows?: Readonly<Record<string, HorizonFollow | undefined>>
  /** Community host ZONES. Turned into `content.<zone>` doors. */
  readonly communityZones?: readonly string[]
  /** The standing public endpoint, as a last door. */
  readonly fallbackHosts?: readonly string[]
}

const clean = (raw: unknown): string => String(raw ?? '').trim().toLowerCase()

/** `content.<zone>` — the door, never the zone itself. */
export const contentDoorOf = (zone: unknown): string => {
  const bare = clean(zone).replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/+$/, '')
  if (!bare) return ''
  return bare.startsWith('content.') ? bare : `content.${bare}`
}

/**
 * THE ROUTING TABLE. One row per publisher, every door this reader knows.
 *
 * Order is meaningful only as a reading order — `searchVocabulary` asks every
 * door of a publisher CONCURRENTLY and ranks the answers, so no door here is
 * privileged and a single replaying host cannot decide a verdict.
 */
export const buildHorizon = (sources: HorizonSources): VocabularyHorizon => {
  // Community zones only; the standing public endpoint (`fallbackHosts`) is
  // deliberately unused here — see the header.
  const zones: string[] = []
  for (const zone of sources.communityZones ?? []) {
    const door = contentDoorOf(zone)
    if (door && !zones.includes(door)) zones.push(door)
  }
  const orZones = (own: string[]): string[] => (own.length ? own : zones)

  const rows: VocabularyPublisher[] = []
  for (const visit of sources.visits ?? []) {
    const pubkey = clean(visit?.pubkey)
    if (!pubkey) continue
    rows.push({ pubkey, hosts: orZones([contentDoorOf(visit?.domain)].filter(Boolean)) })
  }
  for (const follow of Object.values(sources.follows ?? {})) {
    const pubkey = clean(follow?.pubkey)
    if (!pubkey) continue
    rows.push({ pubkey, hosts: orZones((follow?.hosts ?? []).map(clean).filter(Boolean)) })
  }

  // The fold dedupes publishers and unions their doors, so a key reached both
  // by a visit and by a follow is ONE row holding every door either gave it.
  return foldHorizon(rows)
}
