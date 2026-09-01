// sharing/publish-status.drone.ts
//
// THE PUBLISH DIFFERENTIAL — what the world sees, next to what is here now.
//
// One row per publishable branch, in the grammar of the enablement roster: a
// name, a state light, a reason, one action. The row's state is a comparison
// of THREE signatures, and it takes three rather than two because two cannot
// tell "behind" from "cannot see":
//
//   live  — the head named by the publisher-signed hive index, schnorr-verified
//           against our own pubkey. What a visitor would resolve right now.
//   here  — history.sealSubtree(segments). What publishing would advance to.
//   mine  — the ledger record of our last index advance (publish-heads.ts):
//           the head we put there, when, and under which index stamp.
//
// THE DISCIPLINE, which is most of the value: this surface must never claim
// more than it can prove.
//
//   • Only a 404 asserts absence. Offline, CORS, 5xx and the local breaker all
//     resolve to `unknown`, which renders as the last observation with its age
//     — not as a red light.
//   • `sealSubtree` returning null means a child is cold: that is CANNOT-SEE,
//     never "different". Collapsing the two would invent drift out of an
//     unvisited tile.
//   • A schnorr check proves an index is ours, never that it is the latest.
//     An index stamped older than one we ourselves signed is `stale-edge` —
//     authentic and wrong, the one case a cached 200 can still lie about.
//   • A signature that does NOT verify is not an outage. It is a host serving
//     something that is not ours, and it is stated loudly.
//
// Shell parity: the panel is a shared Angular component and must not import
// essentials, so everything crosses as `publish:render` payloads and comes
// back as intents (publish:run, publish:unpublish, publish:expand, …).

import { Drone, EffectBus, get, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { PUBLIC_CONTENT_HOSTS } from './hive-link.js'
import { fetchHiveIndex } from './hive-pointer.js'
import { publishVerdict, type PublishIndexState, type PublishRowState } from './publish-verdict.js'
import {
  addCommunityHost,
  hostsOfBranch,
  listCommunityHosts,
  removeCommunityHost,
  setBranchHosts,
} from './community-hosts.js'
import { lineageKey } from '../history/lineage-key.js'
import { readPublicBranches } from '../presentation/tiles/tile-actions.drone.js'
import {
  collidingPaths,
  highWaterIndexStamp,
  latestByLineageKey,
  listPublishRecords,
  readObservation,
  writeObservation,
  type PublishLedgerEntry,
} from './publish-heads.js'
import {
  ENABLEMENT_CHANGED,
  isKindGloballyOff,
  isPublishedVisitorShell,
} from './behavior-enablement.js'
import { clearDefaultView, defaultViewAt, writeDefaultView } from '../commands/view-default.js'
import { visualBeeIconSvg } from '../commands/visual-bee-icon-svg.js'
import {
  publishBranch,
  unpublishBranch,
  type PublishFailure,
  type PublishProgress,
} from './publish-branch.js'

/** English fallbacks for every way publishing can stop. Each one names what
 *  happened AND what it means for the participant's existing links — the
 *  refusal cases especially, since "nothing happened" is the good outcome
 *  there and needs to read as protection rather than as an error. */
const PUBLISH_FAILURE_TEXT: Record<PublishFailure, string> = {
  'services': 'Core services are not ready yet.',
  'no-branch': 'That row has no branch here to publish.',
  'seal-failed': 'The branch could not be sealed — a child is cold. Visit its tiles once, then publish again.',
  'no-signer': 'No signing key available — the hive index must be signed.',
  'not-available': 'Still uploading — the index was NOT advanced, so no dead links. It keeps retrying.',
  'index-unsafe': 'Your hive index could not be read back, so it was left untouched — publishing over an index we cannot see would drop every other branch. Try again when the host answers.',
  'index-failed': 'The bytes are hosted but the index update failed. Publish again to retry the index.',
  'bundle-failed': 'The link resource could not be created.',
}

const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'

const SIG_RE = /^[a-f0-9]{64}$/
/** Gap enumeration reads local bytes across a closure — opt-in per row, and
 *  capped: "at least this many holes" is enough to refuse a green light. */
const GAP_LIMIT = 8
/** Version history shown per row — enough to step back through, short enough
 *  for a side panel. Every entry is just a signature + a stamp. */
const VERSIONS_SHOWN = 6
/** Head-change bursts (a commit storm while the panel is open) invalidate
 *  every seal. Coalesce instead of restarting the sweep on each one. */
const REFRESH_DEBOUNCE_MS = 750
/** Status work must never turn into a permanent UI state. Sealing and public
 *  probes are observations, not publish operations; after this deadline the
 *  row settles conservatively and the user can explicitly re-check it. */
const STATUS_STEP_TIMEOUT_MS = 15_000

async function beforeDeadline<T>(work: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), STATUS_STEP_TIMEOUT_MS) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

interface HistoryLike {
  sealSubtree: (segments: readonly string[]) => Promise<string | null>
}
interface HostSyncLike {
  isPublicHostEnabled?: () => boolean
  publicHostDomain?: () => string
  publicHostDomainFor?: (key: string) => string
  publicHostDomainsFor?: (key: string) => string[]
  setPublicHostDomainsFor?: (key: string, domains: readonly string[]) => boolean
  probeServed?: (host: string, sig: string) => Promise<'served' | 'absent' | 'unknown'>
  closureGaps?: (sig: string, kind?: string, closure?: boolean, limit?: number) => Promise<string[]>
  isClosureAvailable?: (sig: string, kind: string, closure: boolean) => Promise<boolean>
}
interface SignerLike { getPublicKeyHex?: () => Promise<string | null> }

export type { PublishRowState } from './publish-verdict.js'

export interface PublishRow {
  /** lineageKey — the index's own key, and this row's identity. */
  key: string
  /** The branch path, from the ledger's verbatim segments where we have one. */
  path: string
  segments: string[]
  state: PublishRowState
  /** Head the index names (null when the index has no entry). */
  live: string | null
  /** Head publishing would advance to (null while comparing / cannot-compare). */
  here: string | null
  /** Epoch ms of our last publish of this branch, when we have a record. */
  publishedAt: number | null
  /** Epoch ms of the last observation we stored, for the offline "as of" line. */
  seenAt: number | null
  /** Objects in the published closure that are not served. Filled on expand. */
  gaps: string[]
  expanded: boolean
  /** The shareable link, when a record carries its bundle sig. */
  link: string | null
  /** The public site URL once the branch is published — the domain a visitor
   *  actually uses, derived from the lineage's last label on the branch's
   *  PRIMARY zone. Nested lineages resolve only where the worker binds them. */
  site: string | null
  /** Every root domain this branch claims, primary first. The name is the
   *  subdomain on each; the first is the door writes and probes go through. */
  zones: string[]
  /** Present while this row is publishing. */
  busyPhase: string | null
  /** The view the branch ROOT opens as — its own `view:default` mark, '' for
   *  hexagons. The root face is the one publishing decides: it is what a
   *  visitor lands on, and it is read from (and written back as) the same
   *  atomic decorator the rest of the system honours. */
  opensAs: string
  /** Every head this branch has ever published, newest first — the ledger's
   *  immutable records, so a version IS a signature and nothing more. */
  versions: { sig: string; at: number }[]
}

/** One choice on the "opens as" strip. `view: ''` is the hexagons ground. */
export interface PublishViewChoice {
  view: string
  label: string
  /** Inline SVG mark (visual-bee-icon-svg) — the same identity the tiles wear. */
  icon: string
  /** The behaviour is not lit in the global roster. Carried, not dropped: a
   *  row whose face is ALREADY pinned to a put-out view must still show that
   *  face, and must still be able to unpin it. The picker drops the rest. */
  dormant?: boolean
}

export interface PublishRenderPayload {
  open: boolean
  /** The public-host opt-in. With it off, marking public is inert and every
   *  row would look broken for the wrong reason — the panel says so instead. */
  gateActive: boolean
  host: string
  /** The ROOT domain of the target (host minus its `content.` label) — the
   *  only part of an address a participant ever edits: the tile's name is the
   *  subdomain and the content endpoint is plumbing, both derived from this. */
  zone: string
  pubkey: string
  /** The row for THE CURRENT PAGE — the nearest branch at or above where the
   *  participant stands, or where they stand itself as the branch a first
   *  publish would create. The panel is a properties window for this one
   *  row; there is no list. '' at the hive root. */
  currentKey: string
  /** THE HOSTS THIS PARTICIPANT HAS — the only addresses a branch can
   *  actually be published to. A domain is not typed: it is one of these, and
   *  a hostname nobody serves is a publication that never answers. Standing
   *  default first, then every host any branch already claims. A NEW host
   *  arrives by a consent handshake with whoever runs it (kinds 20410/30411),
   *  never by someone spelling it into a field. */
  hosts: string[]
  /** How the index read went. `forged` is the loud one. */
  index: PublishIndexState
  /** Seconds-epoch stamp of the index we read, or 0. */
  indexCreatedAt: number
  /** The index we can read is older than one we signed. */
  indexStale: boolean
  /** Ledger records exist under a different pubkey than the current signer. */
  keyMismatch: boolean
  refreshing: boolean
  rows: PublishRow[]
  /** Distinct paths that fold to the same index key — only one can be served. */
  collisions: { key: string; paths: string[] }[]
  /** The opens-as choices, once for every row — the registry's views plus the
   *  hexagons ground. */
  views: PublishViewChoice[]
}

export class PublishStatusDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'The publish differential: one row per publishable branch comparing the head the signed hive index names (what the world sees) against the head sealing would produce now (what is here), with an honest online proof — schnorr-verified index, monotonic freshness against our own publish ledger, and a 404-only absence rule. Publishes, republishes and unpublishes per row.'

  protected override listens: string[] = [
    'publish:view-toggle', 'publish:close', 'publish:refresh',
    'publish:run', 'publish:unpublish', 'publish:expand', 'publish:copy-link',
    'publish:opens-as', 'publish:set-target',
    'history:head-changed', 'share:receipt-revoked', 'behavior:enablement-changed',
  ]
  protected override emits: string[] = ['publish:render', 'toast:show', 'activity:log']

  #open = false
  #refreshing = false
  #rows: PublishRow[] = []

  /** THE COMMUNITY — the hosts this participant carries, re-read from the
   *  `community:hosts` pool on every refresh. The panel's pick-list, and
   *  nothing else: a host is here because it was ADDED, never because some
   *  branch once claimed it. */
  #community: string[] = []

  /** Where each branch says it publishes — the marks it wears, by key. */
  readonly #branchHosts = new Map<string, string[]>()
  /** The STANDING default zone, refreshed each sweep — the fallback for any
   *  branch that never chose its own. */
  #zone = ''
  /** Each row's primary door for this sweep — probes, gap observations and
   *  the panel's addresses all read the same resolution. */
  #hostByKey = new Map<string, string>()
  #payload: PublishRenderPayload = {
    open: false, gateActive: false, host: '', zone: '', pubkey: '', currentKey: '', hosts: [],
    index: 'checking', indexCreatedAt: 0, indexStale: false,
    keyMismatch: false, refreshing: false, rows: [], collisions: [], views: [],
  }
  #debounce: ReturnType<typeof setTimeout> | null = null
  /** Rows the participant opened. Gap enumeration is expensive; it happens
   *  only for these, and only once per (row, head). */
  #expanded = new Set<string>()

  constructor() {
    super()

    this.onEffect('publish:view-toggle', () => {
      this.#open = !this.#open
      this.#emit()
      if (this.#open) void this.#refresh()
    })

    this.onEffect('publish:close', () => {
      if (!this.#open) return
      this.#open = false
      this.#emit()
    })

    this.onEffect('publish:refresh', () => { if (this.#open) void this.#refresh() })

    // WHERE ONE BRANCH PUBLISHES. Per branch, never global — /susan moving
    // zones must not move /dylan. The intent carries the branch key and its
    // ROOT domains (primary first): an address is `<name>.<domain>` where the
    // name is the tile's own, and the content endpoint is `content.<domain>`
    // — both derived, never typed. An empty list clears the branch back to
    // the standing default; a value the service refuses leaves everything
    // untouched and says so, because silently keeping the old target after
    // someone typed a new one is how you publish to the wrong place.
    this.onEffect<{ key?: string; domains?: string[] }>('publish:set-target', (p) => {
      const hostSync = get<HostSyncLike>(HOST_SYNC_KEY)
      const key = String(p?.key ?? '')
      if (!key || !hostSync?.setPublicHostDomainsFor) return
      const zones = (Array.isArray(p?.domains) ? p.domains : [])
        .map(z => String(z ?? '').trim().toLowerCase()
          .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
          .replace(/[/?#].*$/, '')
          .replace(/\.$/, ''))
        .filter(Boolean)
      const domains = zones.map(z => z.startsWith('content.') ? z : `content.${z}`)
      if (!hostSync.setPublicHostDomainsFor(key, domains)) {
        this.emitEffect('toast:show', { message: `not a domain: ${zones.join(', ')}` })
        return
      }
      const now = (hostSync.publicHostDomainsFor?.(key) ?? [])
        .map(h => h.replace(/^content\./, ''))
      // The MARKS are the statement. The host-sync record stays written too, so
      // the transport that already reads it keeps working while both are true.
      const segments = this.#rows.find(r => r.key === key)?.segments ?? key.split('/').filter(Boolean)
      void setBranchHosts(segments, zones).then(() => { if (this.#open) void this.#refresh() })
      this.emitEffect('activity:log', { message: `${key} publishes at ${now.join(', ')}` })
      if (this.#open) void this.#refresh()
    })

    // THE COMMUNITY — adding a host is its own act, never a side effect of
    // publishing somewhere. A host you carry is an artifact in the
    // `community:hosts` pool; removing it deletes that artifact and leaves
    // every branch that names it exactly as it was.
    this.onEffect<{ zone?: string }>('publish:community-add', (p) => {
      void addCommunityHost(p?.zone).then(zone => {
        if (!zone) {
          this.emitEffect('toast:show', { message: `not a domain: ${String(p?.zone ?? '')}` })
          return
        }
        this.emitEffect('activity:log', { message: `${zone} joined your community` })
        if (this.#open) void this.#refresh()
      })
    })

    this.onEffect<{ zone?: string }>('publish:community-remove', (p) => {
      void removeCommunityHost(p?.zone).then(gone => {
        if (gone) this.emitEffect('activity:log', { message: `${String(p?.zone ?? '')} left your community` })
        if (this.#open) void this.#refresh()
      })
    })

    // ONE row open at a time — the panel shows a single properties pane, so
    // a second selection replaces the first rather than stacking.
    this.onEffect<{ key?: string }>('publish:expand', (p) => {
      const key = String(p?.key ?? '')
      if (!key) return
      const open = !this.#expanded.has(key)
      this.#expanded.clear()
      if (open) this.#expanded.add(key)
      for (const row of this.#rows) row.expanded = this.#expanded.has(row.key)
      this.#emit()
      if (open) void this.#refreshGaps(key)
    })

    this.onEffect<{ key?: string }>('publish:run', (p) => { void this.#run(String(p?.key ?? '')) })
    this.onEffect<{ key?: string }>('publish:unpublish', (p) => { void this.#unpublish(String(p?.key ?? '')) })
    this.onEffect<{ key?: string }>('publish:copy-link', (p) => { void this.#copyLink(String(p?.key ?? '')) })
    this.onEffect<{ key?: string; view?: string }>('publish:opens-as', (p) => {
      void this.#setOpensAs(String(p?.key ?? ''), String(p?.view ?? ''))
    })

    // A commit anywhere bumps the tree epoch, which invalidates every seal —
    // so every row's local side is stale. Coalesce: a burst of commits must
    // not restart the sweep once per commit.
    const invalidate = (): void => {
      if (!this.#open) return
      if (this.#debounce) clearTimeout(this.#debounce)
      this.#debounce = setTimeout(() => { this.#debounce = null; void this.#refresh() }, REFRESH_DEBOUNCE_MS)
    }
    this.onEffect('history:head-changed', invalidate)
    this.onEffect('share:receipt-revoked', invalidate)
    // The panel describes THE CURRENT PAGE, so walking is what changes its
    // subject. Navigation dispatches a plain window event, not a bus effect.
    window.addEventListener('navigate', invalidate)

    // Lighting or putting out a behaviour changes what the strip may offer.
    // No sweep is owed for that — only the choices are restated.
    this.onEffect(ENABLEMENT_CHANGED, () => {
      if (!this.#open) return
      this.#payload = { ...this.#payload, views: this.#viewChoices() }
      this.#emit()
    })
  }

  // ── the sweep ─────────────────────────────────────────────────────────

  async #refresh(): Promise<void> {
    if (this.#refreshing) return
    this.#refreshing = true
    try {
      const hostSync = get<HostSyncLike>(HOST_SYNC_KEY)
      const signer = get<SignerLike>(NOSTR_SIGNER_KEY)
      const history = get<HistoryLike>(HISTORY_KEY)
      // WHERE THIS PARTICIPANT PUBLISHES. Read from the service, which
      // owns the setting; the compiled-in list is the standing default for
      // anyone who never chose. Reading it here rather than importing the
      // constant is what lets the panel show a target that can change.
      const host = hostSync?.publicHostDomain?.() || PUBLIC_CONTENT_HOSTS[0] || ''
      this.#zone = host.replace(/^content\./, '')
      const gateActive = hostSync?.isPublicHostEnabled?.() === true

      const pubkey = String((await signer?.getPublicKeyHex?.()) ?? '').toLowerCase()
      if (!SIG_RE.test(pubkey)) {
        this.#payload = {
          ...this.#payload, open: this.#open, gateActive, host, zone: this.#zone, pubkey: '',
          index: 'checking', refreshing: false, rows: [], collisions: [],
        }
        this.#emit()
        return
      }

      const ledger = await latestByLineageKey(pubkey)
      const anyRecord = (await latestByLineageKey()).size > 0
      const keyMismatch = ledger.size === 0 && anyRecord

      // Candidate rows: everything we published, everything any door's index
      // names, and everything marked public locally. Public branches arrive
      // as PATHS (`/a/b`), so they must be folded through lineageKey before
      // they can join the other key spaces.
      const candidates = new Map<string, string[]>()
      for (const [key, entry] of ledger) candidates.set(key, entry.record.segments)
      for (const path of readPublicBranches()) {
        const segments = path.split('/').map(s => s.trim()).filter(Boolean)
        if (segments.length === 0) continue
        const key = lineageKey(segments)
        if (!candidates.has(key)) candidates.set(key, segments)
      }

      // THE CURRENT PAGE decides what the panel shows: the nearest branch at
      // or above where the participant stands — or where they stand itself,
      // added as the branch a first publish would create. The hive IS the
      // list; walking to a tile selects it.
      const nav = get<{ segments?: () => string[] }>('@hypercomb.social/Navigation')
      const here = (nav?.segments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
      let currentKey = ''
      for (let i = here.length; i > 0; i--) {
        const k = lineageKey(here.slice(0, i))
        if (candidates.has(k)) { currentKey = k; break }
      }
      if (!currentKey && here.length > 0) {
        currentKey = lineageKey(here)
        candidates.set(currentKey, here)
      }
      // The current row's gap check runs without a click — it is the only
      // row, and its holes are the difference between green and a lie.
      this.#expanded.clear()
      if (currentKey) this.#expanded.add(currentKey)

      // WHAT YOU CARRY, AND WHAT EACH BRANCH NAMES — read once per refresh so
      // the row build stays synchronous. The marks are the branch's statement;
      // the community pool is the pick-list they are chosen from.
      this.#branchHosts.clear()
      for (const [key, segments] of candidates) {
        const named = await hostsOfBranch(segments.length > 0 ? segments : key.split('/').filter(Boolean))
        if (named.length > 0) this.#branchHosts.set(key, named)
      }
      this.#community = await this.#readCommunity(candidates.keys())

      // THE DOORS IN USE: the standing default plus every branch's own
      // choice. Every zone fronts the same per-key index, but a row is
      // proven through ITS OWN door — which is the point of choosing one:
      // one dead zone dims its own rows and nobody else's.
      this.#hostByKey.clear()
      const hostFor = (key: string): string => {
        let door = this.#hostByKey.get(key)
        if (!door) {
          door = hostSync?.publicHostDomainFor?.(key) || host
          this.#hostByKey.set(key, door)
        }
        return door
      }
      const doors = new Set<string>([host])
      for (const key of candidates.keys()) doors.add(hostFor(key))

      // ONE index read per door answers every row behind that door.
      const indexes = new Map<string, {
        state: PublishIndexState; roots: Record<string, string>
        createdAt: number; stale: boolean
      }>()
      for (const door of doors) {
        const read = await fetchHiveIndex(door, pubkey)
        const roots = read.ok ? read.manifest.roots : {}
        const createdAt = read.ok ? read.manifest.createdAt : 0
        const state: PublishIndexState = read.ok
          ? 'ok'
          : read.reason === 'http' && read.status === 404 ? 'none' : read.reason
        // Authentic, but is it the LATEST? Only our own signed stamps —
        // which are recorded per host — can say.
        const highWater = await highWaterIndexStamp(door, pubkey)
        indexes.set(door, {
          state, roots, createdAt,
          stale: read.ok && highWater > 0 && createdAt < highWater,
        })
      }

      // An index entry we have no record and no local mark for: published
      // from another device. We cannot invert the key into a path, so the
      // row carries the key itself and can be compared but not re-sealed.
      for (const ix of indexes.values()) {
        for (const key of Object.keys(ix.roots)) {
          if (!candidates.has(key)) candidates.set(key, [])
        }
      }
      for (const key of candidates.keys()) hostFor(key)

      // The header speaks for the STANDING door; each row speaks for its own.
      const head = indexes.get(host)
      const indexState: PublishRenderPayload['index'] = head?.state ?? 'checking'
      const indexCreatedAt = head?.createdAt ?? 0
      const indexStale = head?.stale ?? false

      const collisions = [...await collidingPaths(pubkey)].map(([key, paths]) => ({ key, paths }))

      // Version history straight from the ledger: every record IS a head sig,
      // immutable, newest first — a version needs no storage beyond that.
      const versionsByKey = new Map<string, { sig: string; at: number }[]>()
      for (const entry of await listPublishRecords()) {
        if (entry.record.pubkey !== pubkey) continue
        const list = versionsByKey.get(entry.record.lineageKey) ?? []
        if (list.length < VERSIONS_SHOWN) list.push({ sig: entry.sealed, at: entry.record.at })
        versionsByKey.set(entry.record.lineageKey, list)
      }

      // Paint what we already know, then fill the local side progressively:
      // sealing is the only expensive step and it must not hold the panel shut.
      const draft: PublishRow[] = []
      for (const [key, segments] of candidates) {
        const entry = ledger.get(key)
        const live = indexes.get(hostFor(key))?.roots[key] ?? null
        const row = this.#draftRow(key, segments, live, entry)
        row.versions = versionsByKey.get(key) ?? []
        draft.push(row)
      }
      draft.sort((a, b) => a.path.localeCompare(b.path))
      this.#rows = draft
      this.#payload = {
        open: this.#open, gateActive, host, zone: this.#zone, pubkey, currentKey,
        hosts: this.#knownZones(candidates.keys()),
        index: indexState, indexCreatedAt, indexStale, keyMismatch,
        refreshing: true, rows: this.#rows, collisions,
        views: this.#viewChoices(),
      }
      this.#emit()

      // Serial, with a yield between rows. sealSubtree is O(1) while the tree
      // epoch holds, but after a commit it re-walks live heads across the
      // branch — running N of those concurrently is how a status panel becomes
      // a stall.
      // The current row is the ONLY one on screen — its verdict lands first.
      const sweep = [...this.#rows]
        .sort((a, b) => (b.key === currentKey ? 1 : 0) - (a.key === currentKey ? 1 : 0))
      for (const row of sweep) {
        // The branch root's opening face — read, never guessed, from the same
        // view:default decorator the arrival machinery honours.
        if (row.segments.length > 0) {
          row.opensAs = await beforeDeadline(defaultViewAt(row.segments).catch(() => ''), '')
        }
        const here = row.segments.length > 0 && history?.sealSubtree
          ? await beforeDeadline(history.sealSubtree(row.segments).catch(() => null), null)
          : null
        // Everything online about this row happens at ITS door: the probe,
        // the index verdicts, and the observation it leaves behind.
        const door = this.#hostByKey.get(row.key) ?? host
        const ix = indexes.get(door)
        const served = row.live
          ? await beforeDeadline(
              hostSync?.probeServed?.(door, row.live) ?? Promise.resolve('unknown' as const),
              'unknown' as const,
            )
          : 'unknown'
        const entry = ledger.get(row.key)
        row.here = here
        row.state = publishVerdict({
          live: row.live, here, served,
          indexState: ix?.state ?? 'checking',
          indexStale: ix?.stale ?? false,
          record: entry ? { sealed: entry.sealed, at: entry.record.at } : undefined,
          sealable: row.segments.length > 0,
        })
        if (row.live) {
          void writeObservation(row.live, door, {
            at: Date.now(), verdict: row.state, indexCreatedAt: ix?.createdAt ?? 0,
          })
        }
        this.#emit()
        await new Promise(r => setTimeout(r, 0))
      }

      this.#payload = { ...this.#payload, refreshing: false, rows: this.#rows }
      this.#emit()
      for (const key of this.#expanded) void this.#refreshGaps(key)
    } finally {
      this.#refreshing = false
    }
  }

  #draftRow(
    key: string,
    segments: string[],
    live: string | null,
    entry: PublishLedgerEntry | undefined,
  ): PublishRow {
    const path = segments.length > 0 ? '/' + segments.join('/') : key
    return {
      key,
      path,
      segments,
      state: 'comparing',
      live,
      here: null,
      publishedAt: entry?.record.at ?? null,
      seenAt: null,
      gaps: [],
      expanded: this.#expanded.has(key),
      link: entry?.record.bundleSig ? this.#linkFor(entry.record.bundleSig) : null,
      // Every row has an address the moment it has a name — an unpublished
      // branch shows where it WILL live, which is where the domain is edited.
      site: this.#siteFor(key),
      zones: this.#zonesFor(key),
      busyPhase: null,
      opensAs: '',
      versions: [],
    }
  }

  /** The opens-as choices: the hexagons ground first, then every registered
   *  view, wearing the same SVG identity the tiles wear. */
  #viewChoices(): PublishViewChoice[] {
    const registry = get<{ all?: () => {
      view: string; toggleIcon?: string; decorationKind?: string; labelKey?: string
    }[] }>('@diamondcoreprocessor.com/VisualBeeRegistry')
    const i18n = get<I18nProvider>(I18N_IOC_KEY)
    // The roster's own answer, not a per-tile one: this strip is a single list
    // shared by every row, so the question it can honestly ask is the GLOBAL
    // one — "is this behaviour lit at all". A binding stays listed (it is lit,
    // just narrowed), and a visitor shell has no roster to consult, so nothing
    // is put out there.
    const visitor = isPublishedVisitorShell()
    const choices: PublishViewChoice[] = [
      { view: '', label: 'hexagons', icon: visualBeeIconSvg('hexagon', 'hexagons') },
    ]
    for (const bee of registry?.all?.() ?? []) {
      if (!bee?.view) continue
      const kind = String(bee.decorationKind ?? '')
      const key = String(bee.labelKey ?? '')
      const label = key ? (i18n?.t(key) ?? bee.view) : bee.view
      choices.push({
        view: bee.view,
        label: label === key ? bee.view : label,
        icon: visualBeeIconSvg(String(bee.toggleIcon ?? ''), bee.view),
        dormant: !visitor && !!kind && isKindGloballyOff(kind),
      })
    }
    return choices
  }

  /** `publish:opens-as` — pin (or unpin) the branch ROOT's opening face. The
   *  write is the same atomic `view:default` decorator every surface reads;
   *  the head changes, so the differential immediately shows the republish
   *  this pin now owes. */
  async #setOpensAs(key: string, view: string): Promise<void> {
    const row = this.#rows.find(r => r.key === key)
    if (!row || row.segments.length === 0) return
    try {
      if (view) await writeDefaultView(row.segments, view)
      else await clearDefaultView(row.segments)
      row.opensAs = view
      this.#emit()
    } catch { /* cold layer — the next refresh re-reads the truth */ }
  }

  /** Gap enumeration for one expanded row. Reads local bytes across the
   *  published closure, so it is opt-in and capped. */
  async #refreshGaps(key: string): Promise<void> {
    const row = this.#rows.find(r => r.key === key)
    if (!row) return
    row.expanded = this.#expanded.has(key)
    if (!row.expanded || !row.live) { row.gaps = []; this.#emit(); return }
    // Expansion is a UI fact, so render it before the optional closure walk.
    // A slow/cold store must not make the click look like it was ignored.
    this.#emit()
    const hostSync = get<HostSyncLike>(HOST_SYNC_KEY)
    const host = this.#hostByKey.get(key) ?? this.#payload.host
    row.gaps = await beforeDeadline(
      hostSync?.closureGaps?.(row.live, 'layer', true, GAP_LIMIT) ?? Promise.resolve([]),
      [],
    )
    const observation = await readObservation(row.live, host)
    row.seenAt = observation?.at ?? null
    this.#emit()
  }

  // ── the actions ───────────────────────────────────────────────────────

  async #run(key: string): Promise<void> {
    const row = this.#rows.find(r => r.key === key)
    if (!row) return
    if (row.segments.length === 0) {
      // Published from another device: the key cannot be inverted into a path,
      // so there is nothing here to seal. Say that rather than failing oddly.
      this.#toast('tip', 'publish.other-device',
        'This entry was published from another device — this hive has no branch at that path to publish.')
      return
    }
    // `markPublic` short-circuits on sigs it marked this session, so a plain
    // retry after a failure would do nothing at all. Anything that is not a
    // clean forward publish re-verifies and re-stages.
    const forceReDrain = row.state === 'pending' || row.state === 'gone' || row.state === 'stale-edge'

    row.busyPhase = 'staging'
    this.#emit()
    const result = await publishBranch(row.segments, {
      forceReDrain,
      onProgress: (p: PublishProgress) => {
        row.busyPhase = p.phase
        this.#emit()
      },
    })
    row.busyPhase = null

    if (!result.ok) {
      this.#toast('error', `publish.failure.${result.failure}`, PUBLISH_FAILURE_TEXT[result.failure])
      this.#emit()
      void this.#refresh()
      return
    }
    this.#toast(
      result.status === 'confirmed' ? 'success' : 'info',
      result.status === 'confirmed' ? 'publish.done' : 'publish.done-unconfirmed',
      result.status === 'confirmed'
        ? 'Published — the public host is serving it.'
        : 'Published — the public host has not served it back yet. This row re-checks on its own.')
    void this.#refresh()
  }

  async #unpublish(key: string): Promise<void> {
    const row = this.#rows.find(r => r.key === key)
    if (!row || row.segments.length === 0) return
    const result = await unpublishBranch(row.segments)
    if (!result.ok) {
      this.#toast('error', `publish.failure.${result.failure}`, PUBLISH_FAILURE_TEXT[result.failure])
      return
    }
    // The honest limit, stated every time: this stops the branch being
    // advertised. It does not un-share what was already shared — the bytes stay
    // hosted and an old link still carries a cold head hint.
    this.#toast('info', 'publish.unpublished',
      'Removed from your hive index. The bytes stay hosted and links already shared still resolve — this stops it being advertised and tracked, it does not un-share it.')
    void this.#refresh()
  }

  async #copyLink(key: string): Promise<void> {
    const row = this.#rows.find(r => r.key === key)
    if (!row?.link) return
    try {
      await navigator.clipboard.writeText(row.link)
      this.#toast('success', 'publish.link-copied', 'Link copied.')
    } catch {
      // Clipboard refused (permission, or too far from a gesture) — the link
      // is on the row anyway.
      this.#toast('tip', 'publish.link-shown', 'The link is shown on the row — copy it from there.')
    }
  }

  /** The root domains a branch claims, primary first — its own choice, else
   *  the standing default. Zones, not content hosts: the panel's material. */
  /** THE HOSTS YOU KNOW, as zones — the pick-list a branch chooses from.
   *
   *  A domain is not free text. It is a host that exists, that you are
   *  entitled to publish to, and that serves your signed index; typing a
   *  hostname nobody runs produces an address that never answers. So the
   *  panel offers what this participant actually has:
   *
   *   • the standing default — the one host every hive starts with;
   *   • whatever the participant pointed publishing at;
   *   • every host a branch here already claims — including one granted since,
   *     because a claim is proof it was offered.
   *
   *  Standing default first (it is what an unset branch rides), the rest in
   *  stable order. Zones, not content hosts: `content.` is plumbing. */
  #knownZones(_keys: Iterable<string>): string[] {
    // THE COMMUNITY, verbatim. The old union-of-every-claim is gone: a claim
    // was never withdrawn, so one mistyped hostname stayed in this list
    // forever, on every branch, with nothing anywhere able to remove it. What
    // you carry is now a set of artifacts you can delete.
    return [...this.#community]
  }

  /** The hosts you carry. Seeded ONCE from what publishing already knew — the
   *  standing default and every zone a branch claims — so the first open shows
   *  the addresses in use rather than an empty list; from then on the pool is
   *  the answer and anything in it can be dropped. */
  async #readCommunity(keys: Iterable<string>): Promise<string[]> {
    const carried = await listCommunityHosts()
    if (carried.length > 0) return carried
    const hostSync = get<HostSyncLike>(HOST_SYNC_KEY)
    const bare = (h: string): string => String(h ?? '').trim().toLowerCase().replace(/^content\./, '')
    const seed = new Set<string>()
    const standing = bare(this.#zone || hostSync?.publicHostDomain?.() || PUBLIC_CONTENT_HOSTS[0] || '')
    if (standing) seed.add(standing)
    for (const key of keys) {
      for (const claimed of hostSync?.publicHostDomainsFor?.(key) ?? []) {
        const zone = bare(claimed)
        if (zone) seed.add(zone)
      }
    }
    for (const zone of seed) await addCommunityHost(zone)
    const after = await listCommunityHosts()
    return after.length > 0 ? after : [...seed]
  }

  #zonesFor(key: string): string[] {
    // THE MARKS FIRST — a branch's own statement of where it publishes. The
    // host-sync record answers for branches that have not been re-stated yet.
    const named = this.#branchHosts.get(key) ?? []
    if (named.length > 0) return named
    const hostSync = get<HostSyncLike>(HOST_SYNC_KEY)
    const zones = (hostSync?.publicHostDomainsFor?.(key) ?? [])
      .map(h => h.replace(/^content\./, ''))
      .filter(Boolean)
    if (zones.length > 0) return zones
    const fallback = this.#zone || PUBLIC_CONTENT_HOSTS[0]?.replace(/^content\./, '') || ''
    return fallback ? [fallback] : []
  }

  /** The published address for a lineage key: its last label as a subdomain
   *  of the branch's OWN primary zone. The worker maps a first-level label to
   *  a top-level lineage implicitly; nested lineages reach here only when an
   *  explicit binding names the same label. */
  #siteFor(key: string): string | null {
    const zone = this.#zonesFor(key)[0]
    const label = key.split('/').filter(Boolean).pop()
    return zone && label ? `https://${label}.${zone}` : null
  }

  #linkFor(bundleSig: string): string {
    try {
      const host = window.location.host
      const scheme = /^(localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i.test(host) ? 'http' : 'https'
      return `${scheme}://${host}/${bundleSig}`
    } catch { return '' }
  }

  /** Toasts carry RESOLVED text — the bus payload is display copy, and the
   *  shell must not have to know which fields are keys (the /host queen
   *  resolves the same way). */
  #toast(type: string, messageKey: string, fallback: string): void {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    EffectBus.emit('toast:show', {
      type,
      title: i18n?.t('publish.title') ?? 'Publish',
      message: i18n?.t(messageKey) ?? fallback,
    })
  }

  #emit(): void {
    this.#payload = { ...this.#payload, open: this.#open, rows: this.#rows, refreshing: this.#refreshing }
    this.emitEffect<PublishRenderPayload>('publish:render', this.#payload)
  }
}

const _publishStatus = new PublishStatusDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/PublishStatusDrone',
  _publishStatus,
)
