// diamondcoreprocessor.com/sharing/swarm-observation.ts
//
// The READ-MODEL for the swarm-as-observation substrate.
//
// The swarm's whole base job is to OBSERVE: it collects attributed data points
// — each one a tile some participant is publishing at the current location —
// and imposes nothing. What a participant DOES with those points (build their
// own tools, signal interest, or adopt them as features) is a separate verb on
// top. This module is the substrate under all of it: it rolls the swarm drone's
// live caches into one ranked, attributed list the observer can browse.
//
// EPHEMERAL BY CONSTRUCTION. Every source here is live — `peerTilesAtCurrentSig`
// drops a peer's tiles when they leave (lifecycle tombstone / NIP-40 expiry),
// and `presenceGlowSnapshot` prunes interest to who is LIVE right now. So a
// point exists only while its participant is present; the moment they leave it
// vanishes on the next read. This module persists NO snapshot of points — it
// re-derives them on every call. The ONLY persisted thing is the observer's own
// FILTER (what they choose to see), participant-local in localStorage, never in
// any lineage — same principle as viewport / clipboard / adopted-roots /
// feature-verified.
//
// DEFAULT RELEVANCE is the aggregate: points rank by live interest count. As the
// (separately-owned) tag layer matures, relevance refines from popularity toward
// tag-match — this module consumes tags only through that read-interface and is
// aggregate-only until it lands. It never writes tags.

const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const FILTER_KEY = 'hc:observation-filter'
// The recoverable receipt of branch roots this hive has folded in (written by
// SwarmAdoptDrone). The baseline for the "changed" cue: a point whose sig is NOT
// here is something you haven't taken — a passive colour signal, never a sync.
const FOLDED_KEY = 'hc:last-folded'
const SIG_RE = /^[a-f0-9]{64}$/

/** Strip scheme + trailing slash so a host compares equal however it was
 *  written (`https://jwize.com/` === `jwize.com`). Mirrors feature-availability's
 *  normHost — kept local so this read-model has no cross-module coupling. */
const normHost = (raw: unknown): string =>
  String(raw ?? '').trim().toLowerCase().replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/+$/, '')

/** A short, neutral identity stamp for a pubkey, used when names are hidden.
 *  A pubkey is the canonical (possibly ephemeral) participant ID — showing a
 *  truncation of it reveals no human name while still distinguishing peers. */
const shortId = (pubkey: string): string => {
  const pk = String(pubkey ?? '').trim()
  return pk.length > 10 ? `${pk.slice(0, 8)}…` : pk
}

// ── types ──────────────────────────────────────────────────────────

/** Who a data point is attributed to. There is NO unattributed point — every
 *  one carries a participant ID (pubkey is the floor; domain when the mesh
 *  attributed one). `label` is the human name and is OMITTED when the observer
 *  has chosen not to show names, or when none is known: neutrality lives in the
 *  view, not in the data. */
export interface ObservedParticipant {
  pubkey: string
  label?: string
  domain?: string
}

/** One observed data point — a tile a participant is publishing here, now. */
export interface ObservedPoint {
  name: string
  /** The publisher's signed branch root, when present (adopt resolves from it). */
  layerSig?: string
  participant: ObservedParticipant
  /** LIVE interest — count of present peers signalling interest in this tile
   *  name at this location (self-excluded, stale-pruned). Ephemeral. */
  interestCount: number
  /** True when this point is a CHANGE you haven't taken — its branch sig isn't
   *  in your folded receipt (a new tile, or a peer's newer version of one you
   *  already have). Drives a passive colour cue only; there is NO sync action —
   *  you act through the same features icon you use solo. */
  changed: boolean
}

export type ObservationGrouping = 'flat' | 'participant' | 'domain'

/** The observer's own view choices — the only persisted state. */
export interface ObservationFilter {
  /** Show human names, or stay neutral (truncated pubkey only). */
  showNames: boolean
  groupBy: ObservationGrouping
}

/** A rendered grouping of points. `flat` yields a single group with `key:''`. */
export interface ObservationGroup {
  key: string
  label: string
  points: ObservedPoint[]
}

/** The slice of the SwarmDrone surface this read-model consumes. Declared
 *  structurally so the pure core can be exercised with a stub source. */
export interface SwarmObservationSource {
  peerTilesAtCurrentSig: () => readonly ({ name: string; peerPubkey: string; layerSig?: string } & Record<string, unknown>)[]
  presenceGlowSnapshot: () => ReadonlyMap<string, number>
  labelFor: (pubkey: string) => string
}

export const DEFAULT_OBSERVATION_FILTER: ObservationFilter = { showNames: true, groupBy: 'flat' }

// ── observer-local filter persistence (participant-local, never in lineage) ──

export function readObservationFilter(): ObservationFilter {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTER_KEY) ?? 'null')
    if (raw && typeof raw === 'object') {
      const grouping = (raw as { groupBy?: unknown }).groupBy
      return {
        showNames: (raw as { showNames?: unknown }).showNames !== false,
        groupBy: grouping === 'participant' || grouping === 'domain' ? grouping : 'flat',
      }
    }
  } catch { /* malformed / no storage — fall through to default */ }
  return { ...DEFAULT_OBSERVATION_FILTER }
}

export function writeObservationFilter(filter: ObservationFilter): void {
  const clean: ObservationFilter = {
    showNames: filter.showNames !== false,
    groupBy: filter.groupBy === 'participant' || filter.groupBy === 'domain' ? filter.groupBy : 'flat',
  }
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(clean)) } catch { /* quota — best effort */ }
}

/** The set of branch-root sigs this hive has folded in, from the recoverable
 *  receipt at `hc:last-folded`. Synchronous — a localStorage read, like the
 *  filter. A point whose sig is absent here is "changed" (not yet taken). */
function readFoldedSigs(): Set<string> {
  const out = new Set<string>()
  try {
    const arr = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]')
    if (Array.isArray(arr)) {
      for (const e of arr) {
        const s = String((e && typeof e === 'object' ? (e as { sig?: unknown }).sig : e) ?? '').trim().toLowerCase()
        if (SIG_RE.test(s)) out.add(s)
      }
    }
  } catch { /* malformed / nothing folded */ }
  return out
}

// ── pure core: derive ephemeral, ranked points from a source + filter ──

/** Roll the live swarm caches into ranked, attributed points. Pure given the
 *  `source` and `filter` — deterministic ordering (interest desc, then name),
 *  no clock or randomness of its own. Two peers publishing the same tile name
 *  yield two points (same name, different participant); interest is per-name at
 *  this location, so both carry the same live count. */
export function deriveObservedPoints(
  source: SwarmObservationSource,
  filter: ObservationFilter,
  foldedSigs: ReadonlySet<string> = readFoldedSigs(),
): ObservedPoint[] {
  const interest = source.presenceGlowSnapshot()
  const tiles = source.peerTilesAtCurrentSig()

  const points: ObservedPoint[] = []
  for (const tile of tiles) {
    const name = String(tile.name ?? '').trim()
    const pubkey = String(tile.peerPubkey ?? '').trim()
    if (!name || !pubkey) continue

    const rawSig = typeof tile.layerSig === 'string' ? tile.layerSig.trim().toLowerCase() : ''
    const layerSig = SIG_RE.test(rawSig) ? rawSig : undefined
    const domain = normHost((tile as Record<string, unknown>)['domain']) || undefined

    const knownName = source.labelFor(pubkey)
    const label = filter.showNames && knownName ? knownName : undefined

    points.push({
      name,
      layerSig,
      participant: { pubkey, label, domain },
      interestCount: interest.get(name) ?? 0,
      // A point you've folded the exact version of is current — no cue. Anything
      // else (new name, or a sig you haven't taken) reads as a change.
      changed: !!layerSig && !foldedSigs.has(layerSig),
    })
  }

  // Default relevance = aggregate interest, highest first; name breaks ties for
  // a stable order across reads (tag-match refinement layers on top later).
  return points.sort((a, b) => b.interestCount - a.interestCount || a.name.localeCompare(b.name))
}

/** Partition already-ranked points into display groups. `flat` keeps the pure
 *  interest ranking; `participant` / `domain` add the "separated by whom" axis
 *  the observer asked for. Groups are ordered by their strongest point's
 *  interest so the most-wanted cluster sits first; points keep their order
 *  within a group. */
export function groupObservedPoints(points: readonly ObservedPoint[], grouping: ObservationGrouping): ObservationGroup[] {
  if (grouping === 'flat') {
    return points.length ? [{ key: '', label: '', points: [...points] }] : []
  }

  const groups = new Map<string, ObservationGroup>()
  for (const point of points) {
    const isDomain = grouping === 'domain'
    const key = isDomain
      ? (point.participant.domain ?? '')
      : point.participant.pubkey
    const label = isDomain
      ? (point.participant.domain ?? '(unattributed)')
      : (point.participant.label ?? shortId(point.participant.pubkey))

    let group = groups.get(key)
    if (!group) { group = { key, label, points: [] }; groups.set(key, group) }
    group.points.push(point)
  }

  // Strongest interest first (points are pre-sorted, so [0] is each group's max).
  return [...groups.values()].sort((a, b) =>
    (b.points[0]?.interestCount ?? 0) - (a.points[0]?.interestCount ?? 0) || a.label.localeCompare(b.label))
}

// ── top-level: live read from IoC + the persisted filter ───────────

/** Observe the current location: the ephemeral, attributed, ranked, grouped
 *  data points, as the observer has chosen to see them. Reads the live swarm
 *  drone from IoC and the persisted filter; returns [] when the swarm isn't
 *  available or no one is publishing here. */
export function observeDataPoints(filterOverride?: ObservationFilter): ObservationGroup[] {
  const swarm = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(SWARM_DRONE_KEY) as SwarmObservationSource | undefined
  if (!swarm?.peerTilesAtCurrentSig || !swarm.presenceGlowSnapshot || !swarm.labelFor) return []
  const filter = filterOverride ?? readObservationFilter()
  return groupObservedPoints(deriveObservedPoints(swarm, filter), filter.groupBy)
}
