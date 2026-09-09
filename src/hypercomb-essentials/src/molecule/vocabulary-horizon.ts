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

/** One plate of a host's publication ledger, as far as the horizon cares. */
export interface HorizonCard {
  readonly pubkey?: unknown
  readonly hosts?: readonly { readonly host?: unknown }[]
}

/**
 * EVERY PUBLISHER THE HOSTS YOU CARRY PUBLISH FOR, as follow rows — the
 * community's whole horizon, so a word can be looked for ACROSS DOMAINS
 * without having visited or been offered anything first. A ledger card
 * names its publisher and every door the creation answers on; those doors
 * serve the publisher's signed index too (`/hive/<pubkey>` answers on a
 * site door and on the relay face alike), so they are the doors to ask.
 * Keyed so the same publisher listed by two hosts folds to one row with
 * both hosts' doors. Cards without a usable key contribute nothing.
 */
export const publishersFromCards = (cards: readonly HorizonCard[]): Record<string, HorizonFollow> => {
  const out: Record<string, HorizonFollow> = {}
  for (const card of cards ?? []) {
    const pubkey = clean(card?.pubkey)
    if (!/^[a-f0-9]{64}$/.test(pubkey)) continue
    const hosts = (card?.hosts ?? []).map(d => clean(d?.host)).filter(Boolean)
    const key = `ledger:${pubkey}`
    const prior = out[key]
    out[key] = { pubkey, hosts: prior ? [...new Set([...(prior.hosts ?? []), ...hosts])] : hosts }
  }
  return out
}

const bareHost = (zone: unknown): string =>
  clean(zone).replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/+$/, '').split(/[/?#]/)[0] ?? ''

/**
 * THE APEX A WILDCARD ZONE HANGS OFF.
 *
 * `susan.hypercomb.com` is a site on the `hypercomb.com` zone: the DNS
 * wildcard covers ONE label, so the relay's write face is `content.hypercomb.com`
 * and `content.susan.hypercomb.com` is a name that resolves to nothing at all.
 * A loopback or port-bearing address is a machine, not a zone, and is left
 * exactly as it is.
 */
export const apexOf = (zone: unknown): string => {
  const bare = bareHost(zone)
  if (!bare || bare.includes(':') || /^(localhost|127(?:\.\d+){3})$/.test(bare)) return bare
  const labels = bare.split('.').filter(Boolean)
  return labels.length > 2 ? labels.slice(-2).join('.') : labels.join('.')
}

/**
 * `content.<apex>` — the relay's write/read face for a zone.
 *
 * It was `content.<zone>` on whatever it was handed, which minted a DEAD door
 * for every site on a wildcard zone: a visit to `susan.hypercomb.com` asked
 * `content.susan.hypercomb.com`, a name no DNS record covers, and the search
 * spent its timeout there and reported "no door answered in time". The face
 * belongs to the APEX (`resolveSite` in the blossom worker: a hostname that is
 * not `content.<zone>` and not a site is answered `nothingHere`).
 */
export const contentDoorOf = (zone: unknown): string => {
  const bare = bareHost(zone)
  if (!bare) return ''
  if (bare.startsWith('content.')) return bare
  const apex = apexOf(bare)
  return apex ? `content.${apex}` : ''
}

/**
 * EVERY DOOR WORTH ASKING FOR A ZONE, in reading order.
 *
 * The zone ITSELF is a door: `/hive/<pubkey>` is matched above the site branch
 * in the worker's router, so a published site serves its publisher's signed
 * index on its own hostname. Asking only the relay face threw that away — and
 * on a wildcard zone the relay face it minted did not exist. Both are asked
 * concurrently and ranked, so a door that is down costs nothing but itself.
 */
export const doorsOfZone = (zone: unknown): string[] => {
  const bare = bareHost(zone)
  if (!bare) return []
  const face = contentDoorOf(bare)
  return face && face !== bare ? [bare, face] : [bare]
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
    for (const door of doorsOfZone(zone)) if (!zones.includes(door)) zones.push(door)
  }
  const orZones = (own: string[]): string[] => (own.length ? own : zones)

  const rows: VocabularyPublisher[] = []
  for (const visit of sources.visits ?? []) {
    const pubkey = clean(visit?.pubkey)
    if (!pubkey) continue
    rows.push({ pubkey, hosts: orZones(doorsOfZone(visit?.domain)) })
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
