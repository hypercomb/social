// sharing/swarm-adopt.drone.ts
//
// Adoption is paste with a fetch in front. When the user clicks `adopt`
// on a peer tile (kind: 'peer'), this drone localizes the publisher's
// branch subtree via the ContentBroker (the resolution protocol), re-homes
// it at the participant's CURRENT location, and folds it into the layer's
// `children` through the SAME `update({ children })` cascade as create and
// paste. After that the adopted cell is an ordinary child of the hive's
// layer — same bytes, same lineage, broadcast with everything else, drawn
// in one preloaded pass. There is no separate render source for adopted
// content and no snapshot bridge: your layer is the one way into your hive.
//
// SAFETY: this drone applies content ONLY in response to an explicit user
// click. ADOPT IS ADOPT: clicking adopt folds the branch's LAYER closure in
// right away (structure only — resources stream on demand at render), then
// lands on the Beehaviors panel so the participant can see what behaviors
// the adopted tiles carry. Consent stays where it matters: a branch that
// declares CODE still stops for an explicit allow before anything installs,
// and foreign pages stay behind the render-time verification gate until
// allowed. There is NO adopt-time decision surface, no per-feature add, and
// no tile merging from the Beehaviors window — behaviors are toggles on
// what the adopted tile already carries. `sync` (re-pull a publisher's
// current version of a tile you hold) has NO user button — it remains a
// programmatic action a future auto-sync can ride. Nothing enters your tree
// without a participant action.

import { Drone, EffectBus, hypercomb, requestConfirm, revisionName, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import {
  childLayerOf,
  childNamesOfStrict,
  childSigsOf,
  flattenLayerTree,
  resolveCurrentLayer,
  resolveLayerAt,
  type PlacementHistory,
  type PlacementLayer,
  type PlacementLineage,
} from '../history/layer-placement.js'
import {
  cellLocationSig,
  seedLayerKeyedTileProps,
  writeTilePropertiesAt,
} from '../editor/tile-properties.js'
import { recordVisit, dropVisitsWithin, visitRecordAt } from './visit-genome.js'
import { forgetDecorationLabel } from '../commands/decoration-kind-index.js'
import { recordWithheldAtRoot } from './behavior-enablement.js'
import { WEBSITE_SLOT } from '../commands/website-slot.js'
import { extractPageRefSigs } from './decoration-closure.js'
import {
  markAdoptedRoot,
  unmarkAdoptedRoot,
  isWithinAdoptedRoot,
  markAdoptTombstone,
  clearAdoptTombstone,
  isAdoptTombstoned,
} from './adopted-roots.js'
import { setDivergedLabels, clearPeerDivergence } from './peer-divergence.js'
import { allows as intakeAllows } from '../pheromones/intake-filter.js'

const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'
const SNAPSHOT_QUEEN_KEY = '@diamondcoreprocessor.com/SnapshotQueenBee'
// Recoverable receipt of branches this hive has folded in — the baseline the
// pending-diff (portal counts) and the un-fold (remove) path read from.
const FOLDED_KEY = 'hc:last-folded'
// Folds the participant asked for that haven't LANDED yet — deferred by the
// complete-or-defer guard (or a failed post-commit read-back). Persisted so a
// page refresh RESUMES the retry ladder instead of silently cancelling the
// adopt: the user watched the import, reloaded, and the fold must still be owed.
const PENDING_FOLDS_KEY = 'hc:pending-folds'
// AUTO-SYNC receipts: adopted-root path → the publisher's branch sig we last
// folded/synced FROM. The O(1) update detector: a peer broadcast whose
// layerSig differs from the receipt means the publisher changed something
// beneath that root (merkle), so the held copy re-syncs automatically —
// "keeping a held tile current with its publisher is an INTERNAL concern"
// (the no-sync-button rule's second half, finally wired). The held root's
// OWN marker can never be compared against the publisher's sig directly:
// the fold re-homes children by name, so the bytes always differ.
const SYNC_RECEIPTS_KEY = 'hc:synced-publisher-roots'

const SIG_RE = /^[a-f0-9]{64}$/
const STORE_KEY_LOCAL = '@hypercomb.social/Store'
// The durable work-list behind a multi-tile adopt (AdoptQueueService).
const ADOPT_QUEUE_KEY = '@diamondcoreprocessor.com/AdoptQueueService'

/** The queue surface this drone drains. Structural, so an older bundle
 *  without the service simply resolves undefined and the direct fold runs. */
interface AdoptQueueLike {
  enqueueAll: (
    picks: readonly { sig: string; label: string; at: readonly string[]; domain?: string }[],
    batch: string,
  ) => unknown
  next: () => { sig: string; label: string; at: string[]; domain?: string } | null
  waitMs: () => number | null
  complete: (sig: string, at: readonly string[]) => void
  defer: (sig: string, at: readonly string[]) => void
  remainingIn: (batch: string) => number
}

interface SwarmDroneLike {
  peerTilesAtCurrentSig: () => readonly ({ name: string; peerPubkey: string } & Record<string, unknown>)[]
  subscribedTiles?: () => readonly ({ name: string; peerPubkey: string } & Record<string, unknown>)[]
  /** Peer tiles at an ARBITRARY location sig — lets the divergence scan
   *  look one level INTO a held tile without navigating there. */
  peerTilesAtSig?: (sig: string) => readonly ({ name: string; peerPubkey: string } & Record<string, unknown>)[]
  /** Compose the swarm sig for a path (same bytes the publisher used), so
   *  the scan can address a child location's peer cache. */
  composeSigForSegments?: (segments: readonly string[]) => Promise<string>
  /** Ask the mesh for cached visuals at a composed sig and inject them into
   *  the peer cache — fills a CHILD location's cache the receiver never
   *  subscribed at, so the scan/additive-adopt can read one level in.
   *  Witness only; injection emits swarm:peers-changed. */
  primePeerTilesAt?: (sig: string, opts?: { force?: boolean }) => Promise<void>
  /** Decoration kinds this publisher withholds from the swarm (their global
   *  roster's off list, broadcast on wire kind 30208). */
  withheldByPeer?: (pubkey: string) => readonly string[]
}

interface LineageLike {
  explorerSegments?: () => readonly string[]
}

interface BrokerLike {
  adopt: (rootSig: string, opts?: { layersOnly?: boolean; silent?: boolean }) => Promise<{ layers: number; leaves: number; failed: number }>
  noteDomainsForSig?: (sig: string, domains: string[]) => void
  getKnownDomains?: (sig: string) => string[]
}

interface CommitterLike {
  update: (
    segments: readonly string[],
    layer: { name?: string; [slot: string]: unknown },
    nameSlots?: ReadonlySet<string>,
  ) => Promise<string>
  importTree: (
    updates: { segments: readonly string[]; layer: { name?: string } & { [slot: string]: unknown } }[],
    nameSlots?: ReadonlySet<string>,
  ) => Promise<void>
}

/** A branch this hive has folded in — the recoverable receipt persisted at
 *  FOLDED_KEY. Read by swarm-observation to mark a peer's point already
 *  taken, and lets a disable
 *  un-fold the right tile. Removal is recoverable: the installer keeps the
 *  branch record (re-enable re-folds) and history keeps the prior marker +
 *  the content-addressed bytes, so nothing is ever lost. */
interface FoldedEntry { sig: string; name: string; at: string[] }

/** A deferred fold's durable intent (see PENDING_FOLDS_KEY). */
interface PendingFold { sig: string; at: string[]; domain?: string; mode: 'fold' | 'sync' }

interface TileActionPayload {
  action: string
  label?: string
  /** `Adopt All` over a multi-selected set carries the full list. */
  labels?: readonly string[]
  /** `adopt-selected` (panel confirm) carries participant-grouped picks;
   *  pubkey disambiguates the same name published by two peers. */
  selections?: readonly { label: string; pubkey?: string }[]
}

/** SwarmDrone's `swarm:tile-visited` — a real navigation landed on a tile
 *  a peer offers at the parent location. `entry` is the witnessed wire
 *  visual (sanitizer-filtered on receive) plus the publisher pubkey.
 *  `retry` is internal: the bounded re-attempt counter for folds refused
 *  by a transiently-rewound cursor. */
interface VisitPayload {
  segments?: string[]
  parentSegments?: string[]
  name?: string
  entry?: Record<string, unknown>
  retry?: number
}

/** How many times a refused visit fold re-attempts, and how far apart.
 *  The cursor falls legitimately behind for a beat after the PREVIOUS
 *  fold's own commits at the current location; a couple of spaced
 *  retries ride that out, while a participant genuinely viewing history
 *  stays rewound and the last attempt honestly gives up. */
const VISIT_RETRY_MAX = 2
const VISIT_RETRY_DELAY_MS = 2_500

/** The 0000 fields a take carries — exactly the visual-sanitizer's
 *  first-class property whitelist, minus swarm metadata (name, peerPubkey,
 *  layerSig, inviteSig, label). `index` IS carried (Jaime, 2026-08-20:
 *  "when I click the tiles the indexes change — this should not be the
 *  case"): the tile was already rendered at the publisher's slot while
 *  witnessed, so taking it must keep it exactly there — it loses its
 *  transparency and shows static, it never jumps. The old strip rule
 *  ("local layout owns slot assignment") made every take land unindexed
 *  and score-fill to a NEW slot — the visible shuffle. A local tile
 *  already holding the slot still wins: the ordinary collision demotion
 *  in #orderByIndexPinned applies unchanged. */
const VISIT_PROP_KEYS = [
  'imageSig', 'small', 'large', 'flat', 'point', 'background', 'border',
  'accent', 'tags', 'link', 'hideText', 'participant', 'substrate',
  'thread', 'contentSig', 'stopReason', 'index',
] as const

export class SwarmAdoptDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Adopts a peer tile by localizing its branch (ContentBroker) and folding it into the hive layer via the same update({children}) cascade as paste, on explicit user click ONLY — no snapshot bridge, no automatic installer fold.'

  protected override listens: string[] = ['tile:action', 'features:download', 'swarm:peers-changed', 'swarm:tile-visited', 'swarm:wand']
  protected override emits: string[] = ['adopt:started', 'fs:changed', 'tile:saved', 'tile:action', 'features:download:done', 'activity:log', 'features:outcome', 'toast:show', 'swarm:visit-folded']

  // Latest installer registry projection — cached for the Done-gated fold.

  constructor() {
    super()

    // ── DIVERGENCE SCAN: detect, NEVER apply ───────────────────────────
    // NOTHING EVER RE-SYNCS ON ITS OWN. This pass used to auto-fold a
    // publisher's newer bytes into any adopted root ("adopted branches
    // follow their publisher"); that is retired. Every swarm join where
    // something changed now requires an EXPLICIT add — adopt (folds the
    // whole tree), or the installer (per-tile on/off), with behaviors
    // added afterwards in the Beehaviors window. The only sanctioned
    // automation is DETECTION, which lights the adopt affordance and
    // applies nothing.
    //
    // Three rules mark a HELD tile as having something to take, all
    // ADDITIVE ("they have something you don't") and never "yours is
    // stale":
    //   1. adopted root whose publisher sig differs from our receipt —
    //      the merkle handle covers their whole subtree, so this catches
    //      changes at any depth beneath it;
    //   2. announced-sig watch — the same comparison for tiles we
    //      AUTHORED (no receipt exists): the publisher's branch sig for
    //      a held tile CHANGED since we first saw them this session.
    //      In-memory, first sight baselines, acked when an adopt lands;
    //   3. any held tile a peer publishes children for that we lack —
    //      the name diff, the unit the participant can act on. A child
    //      location the receiver never subscribed at is PROBED via
    //      primePeerTilesAt (mesh cached-visuals ask), so this rule
    //      works without ever having navigated into the tile.
    // Debounced off the peers-changed burst; the result is a sync-readable
    // set the overlay reads, never a commit.
    this.onEffect('swarm:peers-changed', () => { this.#scheduleDivergenceScan(); this.#hintWand() })

    // The answer is LOCATION-scoped. Leaving invalidates it immediately —
    // carrying it across would light adopt on a same-named tile somewhere
    // else entirely. The next peer burst at the new location recomputes.
    this.onEffect('navigation:guard-start', () => {
      if (this.#divergenceTimer) { clearTimeout(this.#divergenceTimer); this.#divergenceTimer = null }
      if (clearPeerDivergence()) EffectBus.emit('swarm:divergence-changed', {})
    })

    // ── DELETE IS THE UNSUBSCRIBE ──────────────────────────────────────
    // Removing a tile inside an adopted branch revokes the adoption for
    // that path: tombstone it (auto-sync skips it from now on), drop
    // adopted roots at/beneath it, and forget its sync receipts. Cascade
    // emits (fromCascade) are a commit's diff — including our own sync
    // folds — not participant intent, so they never tombstone. Only an
    // explicit adopt/sync gesture on the tile clears the stone — that is
    // the way back in.
    this.onEffect<{ cell?: string; segments?: string[]; fromCascade?: boolean }>('cell:removed', (p) => {
      if (p?.fromCascade) return
      const cell = String(p?.cell ?? '').trim()
      if (!cell || !Array.isArray(p?.segments)) return
      const target = [...p.segments.map(s => String(s ?? '').trim()).filter(Boolean), cell]
      if (!isWithinAdoptedRoot(target)) return
      markAdoptTombstone(target)
      unmarkAdoptedRoot(target)
      this.#dropSyncReceipts(target)
      // A deleted tile's provenance should not linger in the visit genome.
      dropVisitsWithin(target)
    })

    // ── THE SIGNAL, NOT THE ACQUISITION ────────────────────────────────
    // The visit itself still writes nothing. Taking is a GESTURE (the
    // click below, or the ctrl sweep) — it is never a side effect of
    // where the URL happens to point, so a deep link, a back button or a
    // restored session browses without collecting.
    //
    // The signal is still worth hearing: it names the entered tile in the
    // debug ladder, and when the tile is one you ALREADY hold it refreshes
    // that path's provenance stamp. It never MINTS a genome record — the
    // genome means "I took this", and the record is minted by the fold.
    this.onEffect<VisitPayload>('swarm:tile-visited', (p) => { void this.#onTileVisited(p) })

    // ── FIRST CLICK ADOPTS, SECOND CLICK ENTERS ────────────────────────
    // (Jaime's rulings, 2026-08-20.) In a swarm the tiles you don't own
    // render SHADED — a standing state the moment you arrive, not a
    // modifier preview. CLICK ONE AND IT IS ADDED: that tile is yours,
    // permanently, painted at full strength — and you STAY where you
    // stand to watch it light up ("the first click adopts and a second
    // click navigates"). The next click walks in like any other tile's,
    // its children arrive shaded in their turn, and each one is added by
    // its own first click. Walking a peer's hive is COLLECTING it, one
    // layer at a time, two beats per layer.
    //
    // Two gestures reach this handler, both taking exactly ONE ITEM and
    // never its children (what is inside becomes yours by clicking in
    // there too):
    //   • TileOverlayDrone's entry choke point (#firstClickTakes) — the
    //     first click, hold-to-enter, or tap on a shaded tile. The only
    //     take a finger can perform.
    //   • SelectionInputDrone's ctrl (⌘) sweep — press, or drag across
    //     several, to take without a second thought of entering. SELECT IS
    //     SUPPRESSED FOR THE WHOLE GESTURE there: in a swarm ctrl+press
    //     already MEANS take-this, so the ordinary add-to-selection must
    //     not fire too.
    //
    // A take is explicit, so — unlike a bare visit — it CLEARS a
    // tombstone: clicking a tile you gave back adds it again. Native tiles
    // are untouchable (both callers only ever offer a label the renderer
    // reported EXTERNAL, and wandEligible demands a live peer offer at
    // this location).
    this.onEffect<{ label?: string }>('swarm:wand', (p) => {
      void this.#onWand(String(p?.label ?? '').trim())
    })

    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      const action = String(payload?.action ?? '')

      // Panel-confirmed en-masse adopt. Sequential so commits land in pick
      // order rather than racing the committer queue.
      if (action === 'adopt-selected') {
        const selections = Array.isArray(payload?.selections)
          ? payload.selections
              .map(s => ({ label: String(s?.label ?? '').trim(), pubkey: String(s?.pubkey ?? '').trim().toLowerCase() }))
              .filter(s => s.label.length > 0)
          : []
        void (async () => { await this.#adoptMany(selections) })()
        return
      }

      if (action !== 'adopt' && action !== 'sync') return

      // Multi-tile adopt (selection-menu Adopt All) — sequential. Only the
      // `adopt` gesture fans out a `labels` array; `sync` is a single-tile
      // overlay click carrying one `label`.
      const labels = Array.isArray(payload?.labels)
        ? payload.labels.map(s => String(s ?? '').trim()).filter(Boolean)
        : []
      if (labels.length > 0) {
        void (async () => { await this.#adoptMany(labels.map(label => ({ label }))) })()
        return
      }

      const label = String(payload?.label ?? '').trim()
      if (!label) return

      // Single adopt-gesture. ADOPT IS ADOPT: fold the branch in right here —
      // the tiles are what the click asked for. Structure only (layersOnly;
      // resources stream on demand at render); a branch that declares CODE
      // still stops for explicit consent inside #adoptInline. The fold lands
      // on the Beehaviors panel so the participant immediately sees which
      // behaviors the adopted tiles carry. Two+ publishers of the same name
      // still disambiguate through the participant-grouped panel first.
      if (action === 'adopt') {
        if (!this.#isPeerTile(label)) return
        // PAGE TILES ONLY (Jaime's ruling, 2026-08-20): the adopt verb —
        // like the walk and the pick-tiles pill — acquires the ONE tile as
        // it stands on this page, never its branch. WHAT YOU SEE IS WHAT
        // YOU GET on name collisions: the freshest entry, the copy the
        // canvas rendered.
        void this.#adoptPageTile(label)
        return
      }

      // NOTE: `features` no longer routes here. It is "show features" now
      // — ShowFeaturesDrone gathers the tile's bee metadata
      // and opens the right-docked panel (read-only, stays in the hive). The
      // installer hand-off survives only as the panel's BENIGN staging: a
      // wanted feature's branch sig is pre-ticked when the installer is opened
      // later (portal-overlay #stage handoff). The visible-installer route
      // lives in adoptResolvedBranch (the couldn't-inspect fallback).

      // `sync` → adopt the publisher's VISUALS straight into the hive,
      // replacing the stale local copy in place. No installer; scripts stay
      // off until the participant opts in via the `features` icon.
      void this.#syncPeerTile(label, undefined, { explicit: true })
    })

    // ── features:download — pull a feature's bytes onto this machine NOW ──
    // Backs the features panel's bulk "download" action. A peer-offered /
    // adopted BRANCH mirrors via the broker's FULL adopt walk (layers +
    // resources + decoration descent); a bare page feature pulls its body plus
    // every ref the renderer would resolve (extractPageRefSigs — the same
    // pattern set rewritePageRefs mounts with). sha256 gates every byte.
    this.onEffect<{ cell?: string; segments?: string[]; branchSig?: string; gateSig?: string }>(
      'features:download',
      (p) => { void this.#downloadFeature(p) },
    )

    // ── resume folds a refresh interrupted ─────────────────────────────
    // Each deferred fold persisted its intent (PENDING_FOLDS_KEY); re-enter
    // it through the same bounded ladder. The first rung fires 20s out, so
    // boot warming and IoC registration are long done by the first attempt.
    // A landed commit / exists / ladder give-up clears the entry.
    try {
      for (const f of this.#loadPendingFolds()) {
        this.#scheduleFoldRetry(f.sig, f.at, f.domain, f.mode === 'sync' ? 'sync' : 'fold')
      }
    } catch { /* best-effort — a manual re-adopt always works */ }

    // ── resume the ADOPT QUEUE ────────────────────────────────────────
    // A multi-tile adopt is owed until every signature in it has landed.
    // The queue persists that debt, so a refresh mid-batch resumes the
    // drain instead of quietly abandoning the tail (see AdoptQueueService).
    try { void this.#drainAdoptQueue() }
    catch { /* best-effort — the next adopt gesture restarts the drain */ }
  }

  #ioc = () => (window as { ioc?: { get: (k: string) => unknown } }).ioc

  /** Is this label currently surfaced as a peer tile (current-location
   *  cache or subscribed channel)? Gate for opening the adopt panel. */
  #isPeerTile = (label: string): boolean => {
    const swarm = this.#ioc()?.get?.(SWARM_DRONE_KEY) as SwarmDroneLike | undefined
    if (!swarm?.peerTilesAtCurrentSig) return false
    if (swarm.peerTilesAtCurrentSig().some(p => p.name === label)) return true
    return swarm.subscribedTiles?.().some(p => p.name === label) ?? false
  }

  // ── resolve a peer tile → its signed branch + natural placement ────
  // Shared by adopt/features (→ installer) and sync (→ local fold). Looks
  // first in the current-location peer cache, then the subscribed channel
  // (auto-adopt-on-subscribe — the leader's tiles live at THEIR channel
  // sig). pubkey pins the publisher on overlapping names. Returns the
  // publisher's signed branch root (mesh visuals carry layerSig via
  // visual-sanitizer §170, validated at the trust boundary as 64-hex), the
  // participant's CURRENT path as the placement `at` (natural placement:
  // content lands where the participant is, regardless of where the
  // publisher had it), and the publisher domain (if the broker learned it
  // from the mesh) so the resolution protocol can HTTP-direct fetch bytes.
  #resolvePeerBranch = (
    label: string,
    pubkey?: string,
  ): { layerSig: string; at: string[]; domain?: string; label: string; pubkey?: string } | null => {
    const ioc = this.#ioc()
    const swarm = ioc?.get?.(SWARM_DRONE_KEY) as SwarmDroneLike | undefined
    if (!swarm?.peerTilesAtCurrentSig) return null

    const matches = (p: { name: string; peerPubkey: string }): boolean =>
      p.name === label && (!pubkey || p.peerPubkey === pubkey)
    const peerTiles = swarm.peerTilesAtCurrentSig()
    let peerEntry = peerTiles.find(matches)
    if (!peerEntry && swarm.subscribedTiles) peerEntry = swarm.subscribedTiles().find(matches)
    if (!peerEntry && pubkey) {
      peerEntry = peerTiles.find(p => p.name === label) ?? swarm.subscribedTiles?.().find(p => p.name === label)
    }
    if (!peerEntry) return null

    const layerSig = String((peerEntry as Record<string, unknown>)['layerSig'] ?? '').trim().toLowerCase()
    if (!SIG_RE.test(layerSig)) return null

    const lineage = ioc?.get?.(LINEAGE_KEY) as LineageLike | undefined
    const segments = lineage?.explorerSegments?.() ?? []
    const at = (Array.isArray(segments) ? segments : []).map(s => String(s ?? '').trim()).filter(Boolean)

    const broker = ioc?.get?.(BROKER_KEY) as BrokerLike | undefined
    const ownerDomain = String(broker?.getKnownDomains?.(layerSig)?.[0] ?? '').trim()

    const publisherPubkey = String(peerEntry.peerPubkey ?? '').trim().toLowerCase()
    return { layerSig, at, domain: ownerDomain || undefined, label, pubkey: publisherPubkey || undefined }
  }

  // ── visit-driven acquisition: the one-level fold ────────────────────
  // The walk is the adopt. Landed-or-nothing: the fold is verified by
  // read-back before ANY record (genome, receipt, root, public mark) is
  // written — a committer that refused (preview active, transient error)
  // leaves zero traces, and the next visit simply tries again.

  /** Last visit-fold decision, console-readable via
   *  ioc.get('@diamondcoreprocessor.com/SwarmAdoptDrone').visitDebug() —
   *  a dead drill names its failing stage instead of reading as broken. */
  #lastVisit: Record<string, unknown> | null = null
  public visitDebug = (): Record<string, unknown> | null => this.#lastVisit
  #visitStage = (stage: string, extra?: Record<string, unknown>): void => {
    this.#lastVisit = { stage, atMs: Date.now(), ...(extra ?? {}) }
  }

  /** Bounded re-attempt for a refused visit fold. Idempotent by
   *  construction — a fold that landed meanwhile short-circuits at the
   *  held-here check; a participant who genuinely rewound stays rewound
   *  and the final attempt gives up honestly. */
  #scheduleVisitRetry = (p?: VisitPayload): void => {
    const attempt = Number(p?.retry ?? 0)
    if (attempt >= VISIT_RETRY_MAX) return
    const name = String(p?.name ?? '').trim()
    const parentSegments = Array.isArray(p?.parentSegments)
      ? p!.parentSegments!.map(s => String(s ?? '').trim()).filter(Boolean) : []
    const entry = p?.entry && typeof p.entry === 'object' ? p.entry : null
    if (!name || !entry) return
    // Re-enter the FOLD, never the visit signal: a visit keeps nothing now,
    // so routing the retry back through #onTileVisited would silently drop
    // the owed acquisition the wand (or a verb) asked for.
    setTimeout(() => {
      void this.#foldPageTile(parentSegments, name, entry, { ...(p ?? {}), retry: attempt + 1 })
    }, VISIT_RETRY_DELAY_MS)
  }

  #onTileVisited = async (p?: VisitPayload): Promise<void> => {
    const name = String(p?.name ?? '').trim()
    const segments = Array.isArray(p?.segments)
      ? p!.segments!.map(s => String(s ?? '').trim()).filter(Boolean) : []
    const parentSegments = Array.isArray(p?.parentSegments)
      ? p!.parentSegments!.map(s => String(s ?? '').trim()).filter(Boolean) : []
    const entry = p?.entry && typeof p.entry === 'object' ? p.entry : null
    if (!name || segments.length === 0 || !entry) { this.#visitStage('bad-payload', { name }); return }
    if (segments[segments.length - 1] !== name) { this.#visitStage('path-mismatch', { name }); return }

    // A WALK KEEPS NOTHING. No commit, no genome, no receipt, no adopted
    // root, no public mark — the wand is the only thing that takes a tile.
    // The one write left is a provenance REFRESH on a path already in the
    // genome (a tile you took earlier, re-entered): its record follows the
    // publisher's current handle so divergence keeps baselining honestly.
    // A path with no record stays recordless — minting one here would
    // paint the collection rim green on tiles you never took.
    if (visitRecordAt(segments) !== null && (await this.#isHeldHere(parentSegments, name))) {
      const layerSig = String(entry['layerSig'] ?? '').trim().toLowerCase()
      const pubkey = String(entry['peerPubkey'] ?? '').trim().toLowerCase()
      if (SIG_RE.test(layerSig) && SIG_RE.test(pubkey)) {
        const broker = this.#ioc()?.get?.(BROKER_KEY) as BrokerLike | undefined
        const domain = String(broker?.getKnownDomains?.(layerSig)?.[0] ?? '').trim() || undefined
        recordVisit({ segments, layerSig, pubkey, domain })
      }
      this.#visitStage('held', { name })
      return
    }
    this.#visitStage('witnessed', { name })
  }

  /** THE one-level fold — the single acquisition primitive of the swarm
   *  surface. The WAND rides it per wanded tile; the programmatic verbs
   *  and the pick-tiles pill ride it per picked tile. Walking rides it
   *  no longer (a walk keeps nothing). It acquires exactly ONE tile of
   *  the current page — never a branch, never the children: what is
   *  inside a taken tile becomes the participant's only when they walk
   *  in and take it there too. Returns true when the tile is held here
   *  after the call (landed now or already ours). */
  #foldPageTile = async (
    parentSegments: string[],
    name: string,
    entry: Record<string, unknown>,
    retrySrc?: VisitPayload,
  ): Promise<boolean> => {
    const segments = [...parentSegments, name]
    // Same peer-authored name guard as every fold.
    if (/[\\/\x00-\x1f]/.test(name)) { this.#visitStage('bad-name', { name }); return false }

    const layerSig = String(entry['layerSig'] ?? '').trim().toLowerCase()
    const pubkey = String(entry['peerPubkey'] ?? '').trim().toLowerCase()
    if (!SIG_RE.test(pubkey)) { this.#visitStage('no-pubkey', { name }); return false }

    // DELETE IS THE UNSUBSCRIBE — a tombstoned path renders live as a
    // witness but never re-folds on a walk. (Nothing here clears stones.)
    if (isAdoptTombstoned(segments)) { this.#visitStage('tombstoned', { name }); return false }

    const ioc = this.#ioc()
    const swarm = ioc?.get?.(SWARM_DRONE_KEY) as SwarmDroneLike | undefined
    const broker = ioc?.get?.(BROKER_KEY) as BrokerLike | undefined
    const domain = SIG_RE.test(layerSig)
      ? String(broker?.getKnownDomains?.(layerSig)?.[0] ?? '').trim() || undefined
      : undefined

    // Already ours — the visit changes nothing (foreign children inside
    // fold as they are entered). Refresh the genome's provenance stamp
    // when the path is one we acquired by visiting.
    if (await this.#isHeldHere(parentSegments, name)) {
      this.#visitStage('held', { name })
      if (SIG_RE.test(layerSig)) recordVisit({ segments, layerSig, pubkey, domain })
      return true
    }

    // THE INTAKE GATE, and it belongs HERE — on the single acquisition
    // primitive — rather than on one of its callers.
    //
    // It sat on `#adoptPageTile`, which is one of FOUR paths into this
    // function. The others are the wand (`#onWand`, the only take a finger can
    // perform), the retry, and the child fold of an adopted branch — all of
    // them arriving content, none of them gated. Worse, the wand's own
    // `wandEligible` check is SYNCHRONOUS and so can only ask the location
    // carrier, which holds nothing for a peer's tile: the half that can
    // actually refuse foreign bytes was exactly the half that path skipped. Two
    // takes of the same bytes disagreed — refused through the adopt panel,
    // admitted by a click.
    //
    // Below the held-here return on purpose: a tile already in the hive is not
    // arriving, and re-judging it would refuse a SYNC of the participant's own
    // content. The gate is for what is coming in.
    if (!await intakeAllows({
      segments,
      ...(SIG_RE.test(layerSig) ? { sig: layerSig } : {}),
    })) {
      this.#visitStage('filtered', { name })
      return false
    }

    // Viewing history — the committer refuses rewound writes; don't try.
    // state.rewound is the canonical test (same as #doCommitBranch) —
    // currentLayerSig is a POSITION and can be set in perfectly normal
    // operation; gating on it silently killed every visit fold.
    //
    // TRANSIENT rewound: during a rapid drill the cursor briefly reads
    // rewound while it catches up with the markers the PREVIOUS visit just
    // minted — a timing artifact, not participant intent. A person actually
    // viewing history stays rewound for seconds, so give the cursor a short
    // settle window before treating rewound as real; only a state that
    // HOLDS refuses the fold.
    const cursor = ioc?.get?.('@diamondcoreprocessor.com/HistoryCursorService') as
      | { state?: { rewound?: boolean } }
      | undefined
    if (cursor?.state?.rewound) {
      let stillRewound = true
      for (let i = 0; i < 4 && stillRewound; i++) {
        await new Promise(r => setTimeout(r, 250))
        stillRewound = cursor?.state?.rewound === true
      }
      if (stillRewound) { this.#visitStage('rewound', { name }); this.#scheduleVisitRetry(retrySrc ?? { segments, parentSegments, name, entry }); return false }
    }

    // ONE-LEVEL fold, ONE COMMIT. The tile materializes WITH its props —
    // name, children:[], and the wire visual's 0000 in the same importTree
    // update. A two-step (egg first, props after) opened an imageless
    // window in which the new-tile theming stamped a substrate filler
    // picture, whose small.image then beat the real imageSig the late
    // props merge added — folded hives painted STOCK ART over people's
    // real pictures. Single-commit closes the window: the tile is never,
    // for any frame, an imageless local tile.
    const history = ioc?.get?.(HISTORY_KEY) as PlacementHistory | undefined
    const committer = ioc?.get?.(COMMITTER_KEY) as CommitterLike | undefined
    const lineage = ioc?.get?.(LINEAGE_KEY) as PlacementLineage | undefined
    const store = ioc?.get?.(STORE_KEY_LOCAL) as { putResource?: (b: Blob) => Promise<string> } | undefined
    if (!history || !committer?.importTree) { this.#visitStage('no-services', { name }); return false }

    // Props from the witnessed wire visual — canonical sorted-key bytes,
    // the same shape writeTilePropertiesAt mints, so identical content
    // dedups to identical sigs.
    const props: Record<string, unknown> = {}
    for (const key of VISIT_PROP_KEYS) {
      if (entry[key] !== undefined) props[key] = entry[key]
    }
    let propSig = ''
    if (Object.keys(props).length > 0 && store?.putResource) {
      const canonical: Record<string, unknown> = {}
      for (const k of Object.keys(props).sort()) canonical[k] = props[k]
      try { propSig = await store.putResource(new Blob([JSON.stringify(canonical)], { type: 'application/json' })) }
      catch { propSig = '' }
    }

    try {
      const parent = await resolveLayerAt(history, lineage?.domain, parentSegments)
      const { names: existing, coldMiss } = await childNamesOfStrict(history, parent)
      // Never SET a children list we couldn't fully read — the same
      // cold-sibling wipe guard every fold honours.
      if (coldMiss) { this.#visitStage('cold-parent', { name }); return false }
      if (!existing.includes(name)) {
        const childLayer: Record<string, unknown> = { name, children: [] }
        if (propSig) childLayer['properties'] = [propSig]
        await committer.importTree([
          { segments: parentSegments, layer: { ...(parent ?? {}), children: [...existing, name] } },
          { segments: [...segments], layer: childLayer },
        ])
      } else if (propSig) {
        // Already linked (a racing create) — carry the wire props onto it
        // through the canonical writer instead.
        try { await writeTilePropertiesAt(parentSegments, name, props) } catch { /* best-effort */ }
      }
    } catch (err) { this.#visitStage('import-threw', { name, err: String(err).slice(0, 120) }); return false }

    // Read-back: only a landed fold mints records. importTree refuses
    // SILENTLY while the cursor is rewound (a beat of legitimate lag after
    // the previous fold's own commits), so a failed read-back retries on
    // the same schedule as a held rewound state.
    if (!(await this.#isHeldHere(parentSegments, name))) {
      this.#visitStage('not-landed', { name })
      this.#scheduleVisitRetry(retrySrc ?? { segments, parentSegments, name, entry })
      return false
    }
    // `name` is the stable address/pool identity. The editor's rename field
    // writes localized title decorations, which are equally part of the
    // participant's variant but must never be smuggled into 0000 properties
    // or used as the fold key. Apply that projection only after the identity
    // has landed; a full branch pull already carries the canonical decoration
    // slot, while this one-level lightweight fold needs the explicit bridge.
    await this.#applyWireTitles(segments, entry)
    this.#visitStage('landed', { name, at: [...segments] })

    if (SIG_RE.test(layerSig)) {
      recordVisit({ segments, layerSig, pubkey, domain })
      // The generation we saw IS the generation we hold — divergence
      // detection baselines here instead of re-lighting immediately.
      this.#recordSyncReceipt(segments, layerSig)
      // NO branch-closure pre-cache here (removed 2026-08-20): "you never
      // give away the structure unless the participant navigates" — deeper
      // pages arrive only as they are walked, via the drill tunnel. The
      // genome keeps the sealed handle as provenance, nothing more.
    }

    // The topmost foreign tile of a drill is the adopted ROOT — it covers
    // every deeper visit (first-visit fit, tombstone scoping, and the
    // publisher's withheld-behaviors record all key off it). Deeper
    // visits land inside it and mark nothing new.
    if (!isWithinAdoptedRoot(parentSegments)) {
      markAdoptedRoot(segments)
      try { recordWithheldAtRoot(segments, [...(swarm?.withheldByPeer?.(pubkey) ?? [])]) } catch { /* never blocks a visit */ }
    }

    // Acquired from the zone, visible to the zone: SwarmDrone marks the
    // taken tile public (the same default a tile CREATED in a swarm gets
    // via #autoPublishInSwarm) and republishes — it owns share semantics,
    // so the marking lives there, not here.
    EffectBus.emit('swarm:visit-folded', { segments, parentSegments, name })

    EffectBus.emit('fs:changed', { segments: parentSegments })
    const i18n = this.#ioc()?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
    EffectBus.emit('activity:log', {
      message: i18n?.t('swarm.kept', { cell: name }) ?? `"${name}" is yours now — kept from the swarm`,
      icon: '●',
    })
    return true
  }

  /** Is `label` something a take can add right here? Synchronous, so both
   *  callers can decide in the middle of a gesture — SelectionInputDrone on
   *  POINTERDOWN (is this press a take, and must select stand down?) and
   *  TileOverlayDrone at the entry choke point (does walking in also add
   *  this tile?). Two conditions: we are in a zone, and a live peer offers
   *  this name at the current location. HELD-ness is the caller's half of
   *  the test — both only ever offer a label the renderer reported EXTERNAL
   *  — which keeps the whole check off the async layer reads. */
  public wandEligible = (label: string): boolean => {
    const name = String(label ?? '').trim()
    if (!name) return false
    let inZone = false
    try { inZone = localStorage.getItem('hc:mesh-public') === 'true' } catch { /* private default */ }
    if (!inZone) return false
    // NO INTAKE GATE HERE, deliberately — it was added and is now removed.
    //
    // `wandEligible` is not an adoption predicate. It has three consumers:
    // SelectionInputDrone asks it on POINTERDOWN (is this press a take, and
    // must select stand down?), and TileOverlayDrone asks it both at the entry
    // choke point and to paint the TAKEABLE SHADE. Filtering here therefore
    // changed navigation and how tiles LOOK, which is far beyond deciding what
    // enters the hive — a tile would have quietly stopped reading as takeable
    // and the press would have fallen through to selection with no explanation.
    //
    // It could not have done the job anyway: this predicate is synchronous by
    // contract, so it can only read the location carrier, which holds nothing
    // for a peer's tile. The gate that can actually refuse foreign bytes is the
    // union read in `#foldPageTile`, at the commit.
    return this.#peerEntryFor(name) !== null
  }

  /** THE TAKE (see the constructor comment). One witnessed tile per touch,
   *  the item only — never its children. Every guard the fold has applies;
   *  a take additionally CLEARS a tombstone, because it is an explicit
   *  gesture and that is the way back in after a delete — click a tile you
   *  gave back and you add it again. Giving a tile back stays what it always
   *  was: delete it (delete is the unsubscribe). */
  #onWand = async (label: string): Promise<void> => {
    if (!label) { this.#visitStage('wand-no-label'); return }
    if (!this.wandEligible(label)) { this.#visitStage('wand-ineligible', { name: label }); return }

    // RESOLVE WHERE AND WHAT SYNCHRONOUSLY, before the first await. A
    // navigation can commit in the same turn right behind this emit — the
    // participant's SECOND click racing the fold, or any gesture that moves
    // the lineage — so anything read after an await describes the page just
    // entered instead of the one we took from. (Live trap: the offer lookup
    // used to sit after the held-here read and resolved null every time, so
    // a clicked tile navigated but never landed.) The location and the
    // offer are both gesture-time facts.
    const at = this.#currentSegments()
    const entry = this.#peerEntryFor(label)
    if (!entry) { this.#visitStage('wand-no-entry', { name: label }); return }
    const path = [...at, label]
    if (await this.#isHeldHere(at, label)) { this.#visitStage('wand-held', { name: label }); return }
    this.#visitStage('wand-folding', { name: label, at: [...path] })
    clearAdoptTombstone(path)
    await this.#foldPageTile(at, label, entry)
  }

  /** The shade shows WHICH tiles are takeable; it can't say what a click
   *  will do with one. Say that ONCE per session, the first time the
   *  participant is standing among tiles they could add. (An activity line,
   *  not a tile: the hive gains nothing from a hint.) */
  #wandHinted = false
  #hintWand = (): void => {
    if (this.#wandHinted) return
    let inZone = false
    try { inZone = localStorage.getItem('hc:mesh-public') === 'true' } catch { /* private default */ }
    if (!inZone) return
    const swarm = this.#ioc()?.get?.(SWARM_DRONE_KEY) as SwarmDroneLike | undefined
    if (!(swarm?.peerTilesAtCurrentSig?.().length)) return
    this.#wandHinted = true
    const i18n = this.#ioc()?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
    EffectBus.emit('activity:log', {
      message: i18n?.t('swarm.wand-hint') ?? 'the shaded tiles are not yours yet — click one to add it and step inside',
      icon: '✦',
    })
  }

  /** Resolve the witnessed wire entry for `label` at the current location
   *  (freshest publisher first — the copy the canvas rendered; a pinned
   *  pubkey narrows when the caller knows whose). */
  #peerEntryFor = (label: string, pubkey?: string): Record<string, unknown> | null => {
    const swarm = this.#ioc()?.get?.(SWARM_DRONE_KEY) as SwarmDroneLike | undefined
    if (!swarm?.peerTilesAtCurrentSig) return null
    const matches = (p: { name: string; peerPubkey: string }): boolean =>
      p.name === label && (!pubkey || p.peerPubkey === pubkey)
    return (swarm.peerTilesAtCurrentSig().find(matches)
      ?? swarm.subscribedTiles?.().find(matches)
      ?? swarm.peerTilesAtCurrentSig().find(p => p.name === label)
      ?? null) as Record<string, unknown> | null
  }

  #applyWireTitles = async (
    segments: readonly string[],
    entry: Readonly<Record<string, unknown>>,
  ): Promise<void> => {
    const raw = entry['titles']
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
    const decorations = this.#ioc()?.get?.('@diamondcoreprocessor.com/DecorationService') as
      | { setTitle?: (at: readonly string[], text: string, locale?: string) => Promise<unknown> }
      | undefined
    if (!decorations?.setTitle) return
    for (const [locale, text] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof text !== 'string' || !text.trim()) continue
      try { await decorations.setTitle(segments, text, locale) } catch { /* title never blocks content adoption */ }
    }
  }

  /** The current explorer path — where a picked page tile folds. */
  #currentSegments = (): string[] => {
    const lineage = this.#ioc()?.get?.(LINEAGE_KEY) as PlacementLineage | undefined
    return [...(lineage?.explorerSegments?.() ?? [])].map(s => String(s ?? '').trim()).filter(Boolean)
  }

  // ── inline adopt: fold content in place, route only code to the installer ──
  // The smooth single-feature adoption. A CONTENT feature (a website is layers +
  // a `visual:website:page` decoration + streamed resources; its renderer already
  // ships in essentials) folds straight into the hive HERE via the same
  // #commitBranch cascade sync uses — immediate, in place, nothing deferred to
  // "next time". Trust is enforced downstream by the render-time verification gate
  // (site-view #reconcile → featureNeedsReview), which is fail-closed and path-
  // agnostic, so a directly-folded foreign page is reviewed before it ever mounts.
  // Only a branch that declares CODE (bees/deps) — or one we can't resolve to
  // inspect — routes to the installer.
  /** One row action, one visible landing: the same plain-words sentence goes
   *  to the activity log AND to `features:outcome`, which the features panel
   *  puts ON THE ROW that asked — the busy switch settles immediately instead
   *  of waiting out a silent leash (features-experience-overhaul.md §panel). */
  #rowOutcome = (cell: string, kind: string | undefined, ok: boolean, message: string): void => {
    EffectBus.emit('activity:log', { message, icon: ok ? '●' : '○' })
    EffectBus.emit('features:outcome', { cell, kind: kind ?? '', ok, message })
  }

  /** Fold a SET of picked page tiles — the verb behind the pick-tiles pill
   *  and `adopt-selected`. PAGE TILES ONLY: each pick folds as the ONE tile
   *  it is on this page (props from the wire), never its branch — deeper
   *  pages join the hive only when the participant walks into them.
   *
   *  ENTRIES FIRST, FOLDS AFTER: every pick's wire entry is snapshotted
   *  before any fold — each fold commits and re-renders, which invalidates
   *  the live peer cache, so resolving inside the loop silently dropped the
   *  tail of a big selection. Sequential folds keep commit order; the
   *  Beehaviors panel lands once, on the first tile that made it in. */
  #adoptMany = async (picks: readonly { label: string; pubkey?: string }[]): Promise<void> => {
    const resolved = picks.map(pick => ({
      label: pick.label,
      pubkey: pick.pubkey || undefined,
      entry: this.#peerEntryFor(pick.label, pick.pubkey || undefined),
    }))
    let first: string | null = null
    let landed = 0
    for (const r of resolved) {
      if (!r.entry) {
        this.#rowOutcome(r.label, undefined, false, `couldn't keep "${r.label}" — it's no longer offered here`)
        continue
      }
      const ok = await this.#adoptPageTile(r.label, r.pubkey, { entry: r.entry, silent: true })
      if (ok) { landed++; if (!first) first = r.label }
    }
    if (landed > 0) {
      EffectBus.emit('activity:log', {
        message: `kept ${landed} tile${landed === 1 ? '' : 's'} from this page`,
        icon: '●',
      })
      if (first) this.#openBehaviours(first)
    }
  }

  /** One picked page tile. Held → additive (its missing PAGE children fold,
   *  one level, nothing removed); foreign → the one-level fold. True when
   *  the tile is held here afterwards. */
  #adoptPageTile = async (
    label: string,
    pubkey?: string,
    opts?: { entry?: Record<string, unknown> | null; silent?: boolean },
  ): Promise<boolean> => {
    const at = this.#currentSegments()
    // HELD HERE ALREADY? Then this is not intake at all — it is a SYNC of a
    // tile the participant accepted at some earlier point, and the intake gate
    // must not sit in front of it. Judging it would refuse an update to their
    // own content the moment a filter excluded something about it, and would
    // say "didn't keep it" about a tile sitting in their hive. The gate is for
    // what is arriving, not for what has already been taken.
    if (await this.#isHeldHere(at, label)) {
      const entry = opts?.entry ?? this.#peerEntryFor(label, pubkey)
      const layerSig = String(entry?.['layerSig'] ?? '').trim().toLowerCase()
      await this.#additiveAdoptHeld({
        layerSig: SIG_RE.test(layerSig) ? layerSig : '',
        at, label,
      })
      return true
    }
    // The intake gate lives in `#foldPageTile` — the acquisition primitive all
    // four take paths share. It ran here as well, on an entry resolved BEFORE
    // its own await and then thrown away: the offer was re-resolved afterwards,
    // so the gate could judge one entry while a different one was committed.
    // One gate, on the primitive, judging the entry it is actually given.
    const entry = opts?.entry ?? this.#peerEntryFor(label, pubkey)
    if (!entry) {
      this.#rowOutcome(label, undefined, false, `couldn't keep "${label}" — it's no longer offered here`)
      return false
    }
    const ok = await this.#foldPageTile(at, label, entry)
    if (ok && !opts?.silent) {
      this.#rowOutcome(label, undefined, true, `"${label}" is yours now`)
      this.#openBehaviours(label)
    }
    if (!ok && !opts?.silent) {
      this.#rowOutcome(label, undefined, false, `couldn't keep "${label}" just now — step into it or try again in a moment`)
    }
    return ok
  }

  #adoptQueue = (): AdoptQueueLike | undefined =>
    this.#ioc()?.get?.(ADOPT_QUEUE_KEY) as AdoptQueueLike | undefined

  /** BEHAVIOURS COME AFTER THE TILES — the Beehaviors panel lands ONCE, on
   *  the first tile of the gesture, when the whole gesture is in. The panel
   *  replaces its subject, so firing it per fold meant N wipes and
   *  last-one-wins; firing it mid-drain would land it on a half-adopted set. */
  #openBehaviours = (label: string): void => {
    const at = [...(this.#ioc()?.get?.(LINEAGE_KEY) as PlacementLineage | undefined)?.explorerSegments?.() ?? []]
    EffectBus.emit('features:outcome', { cell: label, kind: '', ok: true, message: '' })
    EffectBus.emit('tile:action', { action: 'features', label, segments: [...at, label] })
  }

  /** True while a drain is running — the queue is serial by construction so
   *  commits land in ask order and never race the committer. */
  #draining = false
  #drainTimer: ReturnType<typeof setTimeout> | undefined

  /** Work the persisted queue from first to last until nothing is owed.
   *  Continuous: an entry that can't land yet backs off and STAYS owed, so
   *  the drain keeps returning to it for as long as it takes. Nothing is ever
   *  silently dropped — that is the whole point of the queue. */
  #drainAdoptQueue = async (batch?: string, panelLabel?: string): Promise<void> => {
    const queue = this.#adoptQueue()
    if (!queue || this.#draining) return
    this.#draining = true
    try {
      for (;;) {
        const entry = queue.next()
        if (!entry) break
        const branch = { layerSig: entry.sig, at: entry.at, domain: entry.domain, label: entry.label }
        let landed = false
        try {
          // A tile we already hold is ADDITIVE — add the children the peer
          // publishes that we lack, never re-home (a shared tile stays one
          // tile). Anything else folds whole through the normal gates.
          if (await this.#isHeldHere(entry.at, entry.label)) {
            await this.#additiveAdoptHeld(branch)
            landed = true
          } else {
            const res = await this.adoptResolvedBranch(branch, { silent: true })
            landed = res === 'committed' || res === 'exists'
            // 'unavailable' means the bytes aren't reachable from any host we
            // know — "they didn't find the file". That is the EGG case: put
            // the tile in the hive now, empty, and let the queue keep trying
            // until it hatches. 'rewound' is not a missing file (the cursor is
            // in history) and must never lay one.
            if (!landed && res === 'unavailable') await this.#layEgg(branch)
          }
        } catch (err) {
          console.warn('[swarm-adopt] queued adopt threw', { sig: entry.sig.slice(0, 8), err })
        }
        if (landed) queue.complete(entry.sig, entry.at)
        else queue.defer(entry.sig, entry.at)
      }

      // Behaviours come AFTER the tiles — once, when the gesture is fully
      // landed, never interleaved with the folds.
      if (batch && panelLabel && queue.remainingIn(batch) === 0) this.#openBehaviours(panelLabel)
    } finally {
      this.#draining = false
    }

    // Anything still owed is backing off — come back when the soonest is due.
    const wait = queue.waitMs()
    if (wait !== null) {
      clearTimeout(this.#drainTimer)
      this.#drainTimer = setTimeout(() => { void this.#drainAdoptQueue(batch, panelLabel) }, Math.max(wait, 1_000))
    }
  }

  /** Lay an EGG: the tile enters the hive now, real and navigable, holding
   *  its place while the content it names is still out of reach. It carries
   *  no children — an egg is a tile whose branch hasn't hatched yet — and the
   *  persisted queue is what remembers it is still owed. When the bytes turn
   *  up, the ordinary fold re-homes the real subtree over it and the egg IS
   *  the tile. Idempotent: an egg already laid here is left alone. */
  #layEgg = async (branch: { layerSig: string; at: string[]; label: string }): Promise<void> => {
    const ioc = this.#ioc()
    const history = ioc?.get?.(HISTORY_KEY) as PlacementHistory | undefined
    const committer = ioc?.get?.(COMMITTER_KEY) as CommitterLike | undefined
    const lineage = ioc?.get?.(LINEAGE_KEY) as PlacementLineage | undefined
    if (!history || !committer?.importTree || !lineage) return
    // The name rides untrusted peer content — the same guard the fold uses.
    if (!branch.label || /[\\/\x00-\x1f]/.test(branch.label)) return
    try {
      const parent = await resolveLayerAt(history, lineage.domain, branch.at)
      const { names: existing, coldMiss } = await childNamesOfStrict(history, parent)
      // Never SET a children list we couldn't fully read — the same
      // cold-sibling wipe guard the fold honours.
      if (coldMiss || existing.includes(branch.label)) return
      await committer.importTree([
        { segments: branch.at, layer: { ...(parent ?? {}), children: [...existing, branch.label] } },
        { segments: [...branch.at, branch.label], layer: { name: branch.label, children: [] } },
      ])
      EffectBus.emit('fs:changed', { segments: branch.at })
      EffectBus.emit('activity:log', {
        message: `"${branch.label}" isn't reachable yet — it's an egg in your hive until it hatches`,
        icon: '○',
      })
    } catch (err) {
      console.warn('[swarm-adopt] egg refused', { label: branch.label, err })
    }
  }

  // (#adoptInline — the whole-branch mesh fold — is deleted: every swarm
  // acquisition rides #foldPageTile / #adoptPageTile now. adoptResolvedBranch
  // remains the branch primitive for the NON-mesh flows that legitimately
  // install a whole bundle: hive-link previews, the DCP round-trip, the
  // example-hives first-boot offer, and the legacy queue drain.)

  /** Is `label` a live child of the layer at `at` right now? Routes adopt to
   *  its additive branch. Cursor-aware; resolves through the parent chain so a
   *  cold own-bag never reads as absent. False on any resolve failure — treat
   *  unknown as NOT held, i.e. fall back to the whole-tile fold, never to a
   *  path that could silently overwrite. */
  #isHeldHere = async (at: readonly string[], label: string): Promise<boolean> => {
    const ioc = this.#ioc()
    const history = ioc?.get?.(HISTORY_KEY) as PlacementHistory | undefined
    const lineage = ioc?.get?.(LINEAGE_KEY) as PlacementLineage | undefined
    if (!history) return false
    const cursor = ioc?.get?.('@diamondcoreprocessor.com/HistoryCursorService') as { currentLayerSig?: string } | undefined
    const parent = await resolveCurrentLayer(history, lineage?.domain, at, cursor?.currentLayerSig).catch(() => null)
    if (!parent) return false
    const child = await childLayerOf(history, parent, label).catch(() => null)
    return !!child
  }

  /**
   * Additive adopt for a tile you ALREADY HOLD: fold in the children the peer
   * publishes that you don't have — and NOTHING else. Never re-homes the tile
   * (that SETs its children to the peer's list, dropping your own-only ones);
   * never removes; never overwrites a child you already hold. One level here —
   * deeper divergence re-lights as you navigate in, matching the one-level
   * detector. On full success records the peer's current generation as the
   * held tile's receipt so the adopt affordance clears.
   */
  #additiveAdoptHeld = async (
    branch: { layerSig: string; at: string[]; domain?: string; label: string },
  ): Promise<void> => {
    const ioc = this.#ioc()
    const swarm = ioc?.get?.(SWARM_DRONE_KEY) as SwarmDroneLike | undefined
    const history = ioc?.get?.(HISTORY_KEY) as PlacementHistory | undefined
    const lineage = ioc?.get?.(LINEAGE_KEY) as PlacementLineage | undefined
    const childLoc = [...branch.at, branch.label]

    if (!swarm?.composeSigForSegments || !swarm?.peerTilesAtSig || !history) {
      this.#rowOutcome(branch.label, undefined, false, `couldn't read what "${branch.label}" is missing — try again in a moment`)
      return
    }

    // Their direct children of the held tile (from the live peer cache at the
    // held tile's OWN location sig — the same read the divergence scan used).
    // A cold cache is PRIMED first (forced — a user gesture is behind this):
    // the receiver never subscribed at the child sig, so without the probe
    // this read was empty unless the user had walked into the tile earlier,
    // and the adopt reported "already has everything" against no evidence.
    const theirSig = await swarm.composeSigForSegments(childLoc).catch(() => '')
    if (theirSig && swarm.primePeerTilesAt && swarm.peerTilesAtSig(theirSig).length === 0) {
      await swarm.primePeerTilesAt(theirSig, { force: true }).catch(() => undefined)
    }
    const theirs = theirSig ? swarm.peerTilesAtSig(theirSig) : []

    // My direct children — resolved THROUGH the parent so a cold own-bag never
    // reads as empty. coldMiss ⇒ refuse rather than mis-add against partial
    // knowledge (a cold read that dropped a child I hold would re-add it).
    const cursor = ioc?.get?.('@diamondcoreprocessor.com/HistoryCursorService') as { currentLayerSig?: string } | undefined
    const parent = await resolveCurrentLayer(history, lineage?.domain, branch.at, cursor?.currentLayerSig).catch(() => null)
    const held = parent ? await childLayerOf(history, parent, branch.label).catch(() => null) : null
    const { names: myNames, coldMiss } = held
      ? await childNamesOfStrict(history, held.layer).catch(() => ({ names: [] as string[], coldMiss: true }))
      : { names: [] as string[], coldMiss: true }
    if (coldMiss) {
      this.#rowOutcome(branch.label, undefined, false, `"${branch.label}" isn't fully loaded yet — try again in a moment`)
      return
    }
    const mine = new Set(myNames.map(n => n.trim().toLowerCase()))

    const missing = theirs
      .map(t => ({
        name: String(t?.name ?? '').trim(),
        entry: t as Record<string, unknown>,
      }))
      .filter(t => t.name.length > 0 && !mine.has(t.name.toLowerCase()))

    // Fold each missing child as the ONE PAGE TILE it is (props from the
    // wire) — never its branch: "only the tiles on the current page are
    // adopted"; anything deeper joins when the participant walks in. A
    // props fold cannot carry code, so no consent modal can interrupt a
    // bulk additive pass — and no fold is ever counted landed without the
    // read-back (the old path counted a routed-away install as success and
    // dark-cleared the divergence light over missing content).
    let failed = 0
    for (const child of missing) {
      const ok = await this.#foldPageTile(childLoc, child.name, child.entry)
      if (!ok) failed++
    }

    // Acknowledge the peer's current generation for the HELD tile so rule 1
    // (adopted-root receipt ≠ announced sig) clears — but only when nothing was
    // left owed, so a deferred/failed child keeps the affordance lit to retry.
    if (failed === 0 && SIG_RE.test(branch.layerSig)) this.#recordSyncReceipt(childLoc, branch.layerSig.toLowerCase())

    // Recompute the diverged set now so the adopt icon updates without waiting
    // for the next peer burst.
    this.#scheduleDivergenceScan()

    const added = missing.length - failed
    if (missing.length === 0) {
      // Nothing to add AT THIS LEVEL. The icon lit because the publisher's
      // branch sig moved (their merkle handle covers the whole subtree), so
      // when their top-level children all match ours the change lives deeper
      // — say where to go instead of claiming there's nothing.
      this.#rowOutcome(branch.label, undefined, true, `"${branch.label}" matches what they share at this level — any update is deeper inside; step in and adopt where it lights up`)
    } else if (failed === 0) {
      this.#rowOutcome(branch.label, undefined, true, `added ${added} to "${branch.label}"`)
    } else {
      this.#rowOutcome(branch.label, undefined, false, `added ${added} to "${branch.label}", ${failed} couldn't be reached — try again shortly`)
    }
  }

  /** Adopt an ALREADY-RESOLVED branch — the shared tail of every explicit
   *  adopt gesture. Mesh adopt resolves via #resolvePeerBranch (live peer
   *  cache); the static hive-visit drone resolves via a publisher-signed
   *  hive index. Inspection, code consent, the fold, receipts, and the
   *  Beehaviors landing are identical either way — ADOPT IS ADOPT. */
  public adoptResolvedBranch = async (
    branch: { layerSig: string; at: string[]; domain?: string; label: string },
    opts?: { silent?: boolean },
  ): Promise<'committed' | 'exists' | 'rewound' | 'unavailable' | 'declined' | 'uninspectable'> => {
    // The explicit adopt gesture is the participant RE-SUBSCRIBING — clear
    // any revocation on this path before the fold (delete's counterpart).
    clearAdoptTombstone([...branch.at, branch.label])
    const codeSigs = await this.#branchCodeSigs(branch.layerSig, branch.domain)
    if (codeSigs === null) {
      // Couldn't resolve the branch to inspect it. Never inline-fold content we
      // couldn't verify, and don't falsely claim "brings code" for something we
      // can't see — say so and fold nothing.
      EffectBus.emit('features:outcome', { cell: branch.label, kind: '', ok: false, message: `"${branch.label}" could not be resolved for inspection — nothing was folded` })
      return 'uninspectable'
    }
    if (codeSigs.length > 0) {
      // Declares CODE. There is no installer to route this to: code arrives by
      // replicating a root signature (documentation/install-by-replication.md),
      // and no install channel is stamped yet, so there is nothing to replicate
      // against. Refuse honestly and fold NOTHING rather than half-adopting the
      // content half of a branch whose code cannot follow it.
      EffectBus.emit('features:outcome', { cell: branch.label, kind: '', ok: false, message: `"${branch.label}" brings code — code adoption is unavailable until its install channel is published; nothing was folded` })
      return 'unavailable'
    }
    // Content-only → pull the publisher's LATEST and fold it in place. ADOPT
    // MEANS GET THE LATEST: commit with `sync` semantics so a re-adopt re-homes
    // the publisher's CURRENT subtree over a stale local copy and SAVES a fresh
    // revision — instead of the old idempotent `exists` no-op that re-pulled
    // nothing. An unchanged branch still dedups to no new marker (commitLayer
    // byte-dedup), so re-adopting settled content is free. The render-time gate
    // stays the trust surface (a foreign page is reviewed before it mounts).
    const res = await this.#commitBranch(branch.layerSig, branch.at, branch.domain, 'sync')
    if (res === 'committed') {
      // The pull may add/refresh feature decorations without a per-decoration
      // event — forget the label so the re-render re-walks the decorations slot
      // (keeps the features icon's visual-bee gate honest) and bust the tile's
      // per-cell caches so the publisher's latest image/border/tags show.
      forgetDecorationLabel(branch.label)
      EffectBus.emit('tile:saved', { cell: branch.label })
    }
    // Adopt SHOWS THE BEHAVIORS: after the pull lands (re-clicking adopt
    // re-pulls the publisher's latest and returns you to this view), open the
    // Beehaviors panel for the tile. The tiles are IN; the panel is where
    // the participant sees what they carry and toggles it — a community-
    // blocked feature reads "needs your OK" with its allow override right
    // there.
    if (res === 'committed' || res === 'exists') {
      // Seed the auto-sync receipt: this publisher sig IS the current
      // generation here, so re-broadcasts of the same sig never re-fold.
      this.#recordSyncReceipt([...branch.at, branch.label], branch.layerSig)
      // …and the recoverable FOLDED receipt (`hc:last-folded`), the branch-sig
      // list swarm-observation reads to mark a peer's point "already taken".
      // The adopt gesture itself owns this now: it used to be written only by
      // the installer's config fold, so when the installer went the marker
      // would have gone stale for every adopt that isn't one.
      this.#recordFoldedBranch(branch.layerSig, branch.label, [...branch.at])
      // Bulk additive child-adopt (#additiveAdoptHeld) suppresses the per-tile
      // Beehaviors landing — folding N missing children must not open N panels.
      // The single-tile adopt still lands on the panel (its whole point).
      if (!opts?.silent) {
        EffectBus.emit('features:outcome', { cell: branch.label, kind: '', ok: true, message: '' })
        EffectBus.emit('tile:action', { action: 'features', label: branch.label, segments: [...branch.at, branch.label] })
      }
    } else if (res === 'rewound') {
      // The history cursor is viewing the past — the committer refuses to
      // write, so a fold now would be a phantom. Only the user can return
      // to head; say so instead of blaming reachability.
      this.#rowOutcome(branch.label, undefined, false, `couldn't adopt "${branch.label}" — you're viewing history here; return to the present first, then adopt again`)
    } else {
      // 'unavailable' — bytes unreachable or a cold-sibling abort. Loud, not
      // console-only: the user clicked and must see WHY nothing appeared.
      this.#rowOutcome(branch.label, undefined, false, `couldn't adopt "${branch.label}" — its content isn't reachable right now, try again shortly`)
    }
    return res
  }

  // ── features:download — mirror a feature's bytes locally (panel action) ──
  // Branch known (peer cache / explicit sig) → the broker's full adopt walk.
  // Page-only feature → body + single-level ref closure, matching what the
  // renderer resolves. ALWAYS terminates with `features:download:done
  // { cell, ok, files, failed }` — files = sigs that landed, failed = sigs
  // that didn't — so the panel can show a real outcome ("42 files
  // downloaded" / "already local" / "3 missing"), never just un-dim a button.
  #downloadFeature = async (p?: { cell?: string; branchSig?: string; gateSig?: string }): Promise<void> => {
    const cell = String(p?.cell ?? '').trim()
    const broker = this.#ioc()?.get?.(BROKER_KEY) as
      | (BrokerLike & { fetchBySig?: (sig: string, type: 'layer' | 'resource' | 'dependency') => Promise<Uint8Array | null> })
      | undefined
    let ok = false
    let files = 0
    let failed = 0
    if (!broker?.adopt) {
      EffectBus.emit('features:download:done', { cell, ok, files, failed })
      return
    }
    try {
      const explicit = String(p?.branchSig ?? '').trim().toLowerCase()
      const branchSig = SIG_RE.test(explicit)
        ? explicit
        : (cell ? this.#resolvePeerBranch(cell)?.layerSig ?? '' : '')
      if (SIG_RE.test(branchSig)) {
        // Full walk — resources included; silent so the shells' adopt:done
        // handler doesn't yank the participant to hexagons mid-download.
        const stats = await broker.adopt(branchSig, { silent: true })
        // Honest outcome: ANY failed fetch means the mirror is incomplete —
        // partial success must not read as "downloaded".
        ok = stats.failed === 0
        files = stats.layers + stats.leaves
        failed = stats.failed
      } else {
        const gateSig = String(p?.gateSig ?? '').trim().toLowerCase()
        if (SIG_RE.test(gateSig) && broker.fetchBySig) {
          const bytes = await broker.fetchBySig(gateSig, 'resource')
          ok = !!bytes
          if (bytes) {
            files++
            try {
              const refs = extractPageRefSigs(new TextDecoder().decode(bytes))
              for (const s of refs) {
                const got = await broker.fetchBySig(s, 'resource')
                if (got) files++
                else failed++
              }
            } catch { /* refs are best-effort — the page body itself landed */ }
          } else {
            failed++
          }
        }
      }
    } catch (err) {
      console.warn('[swarm-adopt] features:download failed', { cell, err })
    }
    EffectBus.emit('features:download:done', { cell, ok, files, failed })
    // A visible receipt in the activity log too — the panel may already be
    // closed by the time a long walk finishes.
    const i18n = this.#ioc()?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
    const message = ok
      ? (i18n?.t('activity.downloaded', { count: files, cell }) ?? `downloaded ${files} file(s) for "${cell}"`)
      : (i18n?.t('activity.download-failed', { cell }) ?? `couldn't fully download "${cell}"`)
    EffectBus.emit('activity:log', { message, icon: ok ? '●' : '○' })
  }

  // The branch's executable-CODE signatures (bee + dependency sigs) anywhere in
  // its subtree — the nodes a headless DCP install must pre-tick. Content-only
  // branches declare none, so they fold inline with no installer. Pulls the
  // layer closure (layersOnly — the same cheap immutable-cache fetch
  // #doCommitBranch reuses) then walks root + children.
  //   []    → content-only (fold inline)
  //   [...] → declares code (headless DCP install of these sigs)
  //   null  → couldn't resolve/inspect fully (caller opens the visible installer)
  #branchCodeSigs = async (layerSig: string, domain?: string): Promise<string[] | null> => {
    const ioc = this.#ioc()
    const broker = ioc?.get?.(BROKER_KEY) as BrokerLike | undefined
    const history = ioc?.get?.(HISTORY_KEY) as PlacementHistory | undefined
    if (!broker?.adopt || !history?.getLayerBySig) return null
    try {
      if (domain) broker.noteDomainsForSig?.(layerSig, [domain])
      // silent: a pre-consent inspection walk must not switch the view.
      await broker.adopt(layerSig, { layersOnly: true, silent: true })
      const root = await history.getLayerBySig(layerSig)
      if (!root) return null
      // Seed the root so an adversarial child→root back-reference can't re-walk it.
      const seen = new Set<string>([String(layerSig).trim().toLowerCase()])
      const codeSigs = new Set<string>()
      // Fail CLOSED: if ANY descendant layer can't be resolved (cold pool /
      // partially-offline publisher), we can't trust a "content-only" verdict —
      // a bee/dep may live on the unreachable node. Route to the visible
      // installer instead of inline-folding hidden code.
      let incomplete = false
      const collect = (arr: unknown): void => {
        if (Array.isArray(arr)) for (const s of arr) {
          const v = String(s ?? '').trim().toLowerCase()
          if (SIG_RE.test(v)) codeSigs.add(v)
        }
      }
      const walk = async (layer: PlacementLayer): Promise<void> => {
        collect((layer as { bees?: unknown }).bees)
        collect((layer as { dependencies?: unknown }).dependencies)
        // Descend into whichever canonical child slot the layer uses — a built
        // module nests under `cells`, so reading only `children` would miss its
        // code entirely and mis-route the branch to an inline fold.
        for (const sig of childSigsOf(layer)) {
          const s = String(sig).trim().toLowerCase()
          if (seen.has(s)) continue
          seen.add(s)
          const child = await history.getLayerBySig(s)
          if (child) await walk(child)
          else incomplete = true
        }
      }
      await walk(root)
      return incomplete ? null : [...codeSigs]
    } catch {
      return null
    }
  }

  // ── sync → FOLD THE PUBLISHER'S VISUALS INTO THE HIVE (replace) ─────
  // The counterpart to adopt's installer hand-off: sync pulls the
  // broadcasting peer's CURRENT branch layers straight into the hive via the
  // same #commitBranch cascade, replacing the stale local copy at the SAME
  // (name, at). Resources stream on demand at render. After the fold lands we
  // bust the tile's per-cell visual caches (tile:saved — show-cell's
  // single-tile invalidate + re-render chokepoint) so the publisher's
  // refreshed image/border/tags replace the old ones; sync IS the
  // authoritative "give me their current version" gesture.
  #syncPeerTile = async (label: string, pubkey?: string, opts?: { explicit?: boolean }): Promise<void> => {
    const branch = this.#resolvePeerBranch(label, pubkey)
    if (!branch) return
    // An EXPLICIT sync gesture re-subscribes a revoked path; the auto-sync
    // caller never clears stones — it SKIPS tombstoned targets instead.
    if (opts?.explicit) clearAdoptTombstone([...branch.at, branch.label])
    await this.syncResolvedBranch(branch)
  }

  /** Sync an ALREADY-RESOLVED branch — the shared tail of #syncPeerTile,
   *  also driven by the static-hive boot pass (hive-visit.drone.ts), where
   *  the publisher's current head comes from a signed hive index instead of
   *  a live broadcast. Auto-sync semantics: never clears tombstones (the
   *  caller skips revoked targets), announces a landed update visibly. */
  public syncResolvedBranch = async (
    branch: { layerSig: string; at: string[]; domain?: string; label: string },
  ): Promise<'committed' | 'exists' | 'unavailable' | 'rewound'> => {
    const res = await this.#commitBranch(branch.layerSig, branch.at, branch.domain, 'sync')
    if (res === 'committed' || res === 'exists') {
      this.#recordSyncReceipt([...branch.at, branch.label], branch.layerSig)
    }
    if (res === 'committed') {
      // The fold may have added feature decorations to this tile WITHOUT
      // firing per-decoration decorations:changed — forget the label so the
      // re-render's render:cell-count re-walks its decorations slot, keeping
      // the `features` icon's visual-bee gate honest in-session.
      forgetDecorationLabel(branch.label)
      EffectBus.emit('tile:saved', { cell: branch.label })
      // VISIBILITY: an upgrade that just changed what the participant sees
      // must SAY so — a silent fold reads as "nothing happened" (or worse,
      // "something moved under me"). A website update is named as one.
      void this.#announceSynced([...branch.at, branch.label], branch.label)
    }
    return res
  }

  /** Toast the landed sync, naming a WEBSITE update as one. Website-ness is
   *  read from the freshly folded layer itself: a non-empty `website` slot or
   *  a `visual:website:page` decoration kind (hot index first, layer records
   *  as the cold fallback — the fold may predate the next index walk). */
  #announceSynced = async (target: readonly string[], label: string): Promise<void> => {
    let isWebsite = false
    try {
      const ioc = this.#ioc()
      const history = ioc?.get?.(HISTORY_KEY) as PlacementHistory | undefined
      const lineage = ioc?.get?.(LINEAGE_KEY) as PlacementLineage | undefined
      const store = ioc?.get?.('@hypercomb.social/Store') as { getResource?: (sig: string) => Promise<Blob | null> } | undefined
      const layer = (history && lineage) ? await resolveLayerAt(history, lineage.domain, target) : null
      const slot = (layer as Record<string, unknown> | null)?.[WEBSITE_SLOT]
      if (Array.isArray(slot) && slot.some(s => typeof s === 'string' && SIG_RE.test(s))) isWebsite = true
      if (!isWebsite && layer && store?.getResource) {
        const decos = Array.isArray((layer as { decorations?: unknown }).decorations)
          ? (layer as { decorations: unknown[] }).decorations : []
        for (const entry of decos) {
          const sig = String(entry ?? '')
          if (!SIG_RE.test(sig)) continue
          try {
            const rec = JSON.parse(await (await store.getResource(sig))!.text()) as { kind?: string }
            if (rec?.kind === 'visual:website:page') { isWebsite = true; break }
          } catch { /* unavailable record — skip */ }
        }
      }
    } catch { /* announcement is best-effort — the sync already landed */ }
    EffectBus.emit('toast:show', {
      type: 'success',
      title: isWebsite ? 'Website updated' : 'Tile updated',
      message: isWebsite
        ? `"${label}" changed at its source — you now have the publisher's latest website.`
        : `"${label}" now shows its publisher's latest version.`,
    })
  }

  // ── auto-sync: adopted branches follow their publisher ─────────────
  // Receipts map an adopted root's PATH to the publisher branch sig last
  // folded from. Detection is O(1) per broadcast: an EXISTING receipt
  // that differs → the publisher changed something beneath that root. An
  // ABSENT receipt baselines instead of folding — a pre-receipt adoption
  // must never mass-refold the first time this pass sees it.
  #loadSyncReceipts = (): Record<string, string> => {
    try {
      const raw = localStorage.getItem(SYNC_RECEIPTS_KEY)
      const obj = raw ? JSON.parse(raw) : {}
      return obj && typeof obj === 'object' ? obj as Record<string, string> : {}
    } catch { return {} }
  }
  #recordSyncReceipt = (segments: readonly string[], publisherSig: string): void => {
    const pathKey = segments.map(s => String(s ?? '').trim()).filter(Boolean).join('/')
    // The adopt landed — ack the announced-sig watch for this path. Next
    // scan re-baselines from whatever the publisher currently announces
    // (which includes the sig just folded), so the light clears without
    // ever clearing on its own.
    this.#peerSigWatch.delete(pathKey)
    try {
      const receipts = this.#loadSyncReceipts()
      receipts[pathKey] = publisherSig
      localStorage.setItem(SYNC_RECEIPTS_KEY, JSON.stringify(receipts))
    } catch { /* no localStorage — auto-sync degrades to once-per-session */ }
  }
  /** Forget receipts at/beneath `segments` — delete-side hygiene so a stale
   *  receipt can't shadow the fresh baseline of a future explicit re-adopt. */
  #dropSyncReceipts = (segments: readonly string[]): void => {
    const key = segments.map(s => String(s ?? '').trim()).filter(Boolean).join('/')
    if (!key) return
    // Same hygiene for the in-memory watch — a deleted path's baselines
    // must not shadow a future re-adopt's fresh first sight.
    for (const k of this.#peerSigWatch.keys()) {
      if (k === key || k.startsWith(key + '/')) this.#peerSigWatch.delete(k)
    }
    try {
      const receipts = this.#loadSyncReceipts()
      let changed = false
      for (const k of Object.keys(receipts)) {
        if (k === key || k.startsWith(key + '/')) { delete receipts[k]; changed = true }
      }
      if (changed) localStorage.setItem(SYNC_RECEIPTS_KEY, JSON.stringify(receipts))
    } catch { /* no localStorage — nothing recorded to forget */ }
  }

  // Announced-sig watch (scan rule 2): path → publisher pubkey → the branch
  // sig we FIRST saw them announce for a held tile this session. A later
  // broadcast with a different sig means they changed something beneath it.
  // In-memory by doctrine (peer-divergence.ts header) — never persisted;
  // acked by #recordSyncReceipt when an adopt lands on the path.
  readonly #peerSigWatch = new Map<string, Map<string, string>>()

  #divergenceTimer: ReturnType<typeof setTimeout> | null = null

  #scheduleDivergenceScan = (): void => {
    if (this.#divergenceTimer) clearTimeout(this.#divergenceTimer)
    this.#divergenceTimer = setTimeout(() => {
      this.#divergenceTimer = null
      void this.#divergenceScanPass()
    }, 4000)
  }

  /**
   * Which HELD tiles at this location have something a peer is offering
   * that we don't have. Pure detection — this pass NEVER commits, folds,
   * or fetches. Its only output is the sync-readable set the overlay
   * reads to decide whether `adopt` appears on a tile you already hold.
   *
   * Depth: rules 1 and 2 (receipt / announced-sig watch) cover a held
   * tile at ANY depth, because the publisher's handle seals their whole
   * subtree. Rule 3 (name diff) sees ONE level into a held tile — deeper
   * differences surface as the participant navigates in, which is also
   * where they'd act on them.
   */
  #divergenceScanPass = async (): Promise<void> => {
    const ioc = this.#ioc()
    const swarm = ioc?.get?.(SWARM_DRONE_KEY) as SwarmDroneLike | undefined
    const lineage = ioc?.get?.(LINEAGE_KEY) as LineageLike | undefined
    const history = ioc?.get?.(HISTORY_KEY) as PlacementHistory | undefined
    if (!swarm?.peerTilesAtCurrentSig || !lineage || !history) {
      if (clearPeerDivergence()) EffectBus.emit('swarm:divergence-changed', {})
      return
    }
    // A rewound cursor is viewing the past — the tiles on screen aren't the
    // present, so "what am I missing" is not a question we can answer
    // honestly here. Say nothing rather than mark the wrong generation.
    const cursor = ioc?.get?.('@diamondcoreprocessor.com/HistoryCursorService') as
      | { state?: { rewound?: boolean }; currentLayerSig?: string }
      | undefined
    if (cursor?.state?.rewound) {
      if (clearPeerDivergence()) EffectBus.emit('swarm:divergence-changed', {})
      return
    }

    const at = (lineage.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    const receipts = this.#loadSyncReceipts()
    // Resolve the CURRENT parent once — membership in ITS child list is the
    // "held here" test. Resolving the tile's OWN bag is wrong for this:
    // history is append-only, so a DELETED tile still resolves from its old
    // markers and would read as held — the resurrection loop that kept
    // folding deleted tiles back in.
    const domain = (ioc?.get?.(LINEAGE_KEY) as PlacementLineage | undefined)?.domain
    const parent = await resolveCurrentLayer(history, domain, at, cursor?.currentLayerSig)
      .catch(() => null)
    if (!parent) {
      // No local layer here — everything on screen is a projection, and an
      // unheld tile already carries adopt through the peer profile.
      if (clearPeerDivergence()) EffectBus.emit('swarm:divergence-changed', {})
      return
    }
    const diverged = new Set<string>()
    for (const tile of swarm.peerTilesAtCurrentSig()) {
      const name = String(tile.name ?? '').trim()
      if (!name) continue
      const sig = String((tile as Record<string, unknown>)['layerSig'] ?? '').trim().toLowerCase()
      const target = [...at, name]
      // Deleted here stays deleted — the tombstone is the participant's
      // revocation; only an explicit adopt gesture is the way back in, so
      // nothing about a revoked path should light up again.
      if (isAdoptTombstoned(target)) continue
      // Held here? Present in the parent's CURRENT child list. An UNHELD
      // peer tile is out of scope: it already shows adopt via the peer
      // profile, and marking it here would double the affordance.
      const held = await childLayerOf(history, parent, name).catch(() => null)
      if (!held) continue

      // ── rule 1: adopted root, publisher moved past our receipt ────────
      if (SIG_RE.test(sig) && isWithinAdoptedRoot(target)) {
        const receipt = receipts[target.join('/')]
        // No receipt = adopted before receipts existed. BASELINE it (record
        // WITHOUT folding) so an old install doesn't light up wholesale on
        // its first pass. Changes from here on read as divergence.
        if (!receipt) { this.#recordSyncReceipt(target, sig); continue }
        if (receipt !== sig) { diverged.add(name); continue }
      }

      // ── rule 2: announced-sig watch (held tiles with no receipt) ──────
      // Rule 1's comparison, generalized to tiles that were never adopted —
      // the AUTHORED-on-both-hives case, where no receipt can exist. Every
      // peer visual carries the publisher's branch sig, a merkle handle
      // over their whole subtree, so a CHANGED sig on a held tile means
      // they changed something beneath it since we first saw them. First
      // sight BASELINES (joining a swarm is not news) and falls through to
      // the name diff; the baseline is acked only when an adopt lands
      // (#recordSyncReceipt drops the path), so the light stays on until
      // acted on rather than flickering out on the next heartbeat. IN
      // MEMORY ONLY — a swarm-scoped judgement must not outlive the swarm
      // (the peer-divergence doctrine); a fresh session re-baselines.
      if (SIG_RE.test(sig) && !isWithinAdoptedRoot(target)) {
        const pubkey = String(tile.peerPubkey ?? '').trim().toLowerCase()
        if (pubkey) {
          const pathKey = target.join('/')
          let byPub = this.#peerSigWatch.get(pathKey)
          if (!byPub) { byPub = new Map(); this.#peerSigWatch.set(pathKey, byPub) }
          const prev = byPub.get(pubkey)
          if (prev === undefined) byPub.set(pubkey, sig)
          else if (prev !== sig) { diverged.add(name); continue }
        }
      }

      // ── rule 3: name diff one level in ────────────────────────────────
      // The only rule that works for tiles we AUTHORED (no receipt can
      // exist) and the only unit the participant can act on: children they
      // publish that we don't hold. Additive by construction — children we
      // have and they don't are simply never considered.
      // NOTE `held.layer`, not `held` — childLayerOf returns { sig, layer }.
      // PlacementLayer carries an index signature, so the wrapper satisfies
      // it structurally and tsc stays silent; the wrapper has no `children`,
      // which reads as "I hold nothing here" and would mark EVERY held tile
      // with any peer child as diverged.
      if (await this.#peerOffersUnheldChildren(swarm, history, target, held.layer)) {
        diverged.add(name)
      }
    }
    if (setDivergedLabels(diverged)) {
      EffectBus.emit('swarm:divergence-changed', { labels: [...diverged] })
    }
  }

  /**
   * Does any peer publish a child of `target` whose NAME we don't hold?
   *
   * Names, not signatures — deliberately. The fold re-homes children by
   * name, so an adopted copy's bytes always differ from the publisher's
   * (swarm-adopt.drone.ts header); byte comparison between two hives can
   * never read equal and would light this permanently. Name membership is
   * the only comparison that both converges and matches what the
   * participant can act on.
   *
   * Returns false on ANY uncertainty — no peer cache for the child
   * location, or a cold local read (`coldMiss`). Absence of evidence is
   * not evidence of divergence: a cold page must not light adopt on
   * everything it hasn't finished reading.
   */
  #peerOffersUnheldChildren = async (
    swarm: SwarmDroneLike,
    history: PlacementHistory,
    target: readonly string[],
    heldChild: PlacementLayer,
  ): Promise<boolean> => {
    if (!swarm.composeSigForSegments || !swarm.peerTilesAtSig) return false
    const childSig = await swarm.composeSigForSegments(target).catch(() => '')
    if (!childSig) return false
    const theirs = swarm.peerTilesAtSig(childSig)
    if (!theirs || theirs.length === 0) {
      // The receiver only ever subscribes at its CURRENT sig, so a child
      // location's cache is empty unless the user once navigated into it —
      // which made this rule almost never fire. PROBE the mesh for cached
      // visuals there, fire-and-forget: an answer injects into the peer
      // cache and emits swarm:peers-changed, which re-runs this scan with
      // the cache warm; no answer = nothing published there = correctly
      // silent. (Cooldown inside primePeerTilesAt keeps heartbeat-driven
      // rescans from re-asking the same empty location every burst.)
      void swarm.primePeerTilesAt?.(childSig).catch(() => undefined)
      return false
    }
    const { names, coldMiss } = await childNamesOfStrict(history, heldChild)
      .catch(() => ({ names: [] as string[], coldMiss: true }))
    if (coldMiss) return false
    const mine = new Set(names.map(n => n.trim().toLowerCase()))
    for (const t of theirs) {
      const n = String(t?.name ?? '').trim().toLowerCase()
      if (n && !mine.has(n)) return true
    }
    return false
  }

  // ── the one primitive: localize + re-home + re-point children ──────
  // Mirrors clipboard paste exactly, with broker.adopt() in front.
  //
  // Serialized through #commitLock: two concurrent click-adopts both read the
  // parent's children, append, and write the full list, so running them at the
  // same time (e.g. during the slow broker.adopt) would lose one append. The
  // lock makes every commit read AFTER the previous wrote.
  #commitLock: Promise<unknown> = Promise.resolve()
  #commitBranch = (
    branchSig: string,
    atSegments: readonly string[],
    domain?: string,
    mode: 'fold' | 'sync' = 'fold',
  ): Promise<'committed' | 'exists' | 'unavailable' | 'rewound'> => {
    const run = () => this.#doCommitBranch(branchSig, atSegments, domain, mode)
    const next = this.#commitLock.then(run, run)
    this.#commitLock = next.catch(() => undefined)
    return next
  }

  // ── deferred-fold retry ladder (complete-or-defer, see #doCommitBranch) ──
  // A fold refused on an incomplete layer closure retries here: the
  // publisher may just be mid-upload (their availability gate holds the
  // announce until receipts land, but a receiver can race a byte the host
  // hasn't confirmed yet), or a mirror may come online. Bounded + per-sig
  // deduped; success or ladder-end clears the slot. The timers are
  // in-memory, but the INTENT is persisted (PENDING_FOLDS_KEY): a page
  // refresh mid-ladder resumes it on the next boot instead of silently
  // cancelling an adopt the user watched download.
  readonly #foldRetryAttempts = new Map<string, number>()
  static readonly #FOLD_RETRY_DELAYS_MS = [20_000, 60_000, 180_000]

  #scheduleFoldRetry = (
    branchSig: string,
    atSegments: readonly string[],
    domain?: string,
    mode: 'fold' | 'sync' = 'fold',
  ): void => {
    const attempt = this.#foldRetryAttempts.get(branchSig) ?? 0
    if (attempt >= SwarmAdoptDrone.#FOLD_RETRY_DELAYS_MS.length) {
      this.#foldRetryAttempts.delete(branchSig)
      this.#clearPendingFold(branchSig)
      EffectBus.emit('activity:log', {
        message: `couldn't fetch all of "${branchSig.slice(0, 8)}…" — parts aren't reachable from any host yet; adopt it again later`,
        icon: '○',
      })
      return
    }
    this.#persistPendingFold({ sig: branchSig, at: [...atSegments], domain, mode })
    // attempt+1 marks the slot BEFORE the timer so overlapping deferrals
    // for the same sig don't stack parallel ladders.
    this.#foldRetryAttempts.set(branchSig, attempt + 1)
    setTimeout(() => {
      void this.#commitBranch(branchSig, atSegments, domain, mode).then(res => {
        if (res === 'committed' || res === 'exists') {
          this.#foldRetryAttempts.delete(branchSig)
          if (res === 'committed') {
            // importTree's cell:added reconciliation already mounted the
            // tiles — this line just tells the user the earlier "isn't
            // reachable" message resolved itself.
            EffectBus.emit('activity:log', { message: 'adopt completed — the missing content became reachable', icon: '●' })
          }
        }
        // 'unavailable' re-entered #doCommitBranch, which re-scheduled the
        // next rung (or ended the ladder) — nothing to do here. 'rewound'
        // stalls the ladder on purpose: only the user can return to head,
        // and the persisted intent resumes on the next boot.
      }).catch(() => undefined)
    }, SwarmAdoptDrone.#FOLD_RETRY_DELAYS_MS[attempt])
  }

  // mode `fold` (default, DCP-config fold): idempotent — a tile already
  // present at (name, at) is left untouched, and the props-index seed is
  // fill-if-empty (never disturbs an image already on a tile).
  // mode `sync`: INTERNAL "pull their latest" — re-homes the publisher's
  // CURRENT subtree OVER the stale local copy and overwrites the props index
  // so their refreshed image wins. NOT a user-facing option (there is no sync
  // icon/button): the explicit adopt gesture rides it (ADOPT MEANS GET THE
  // LATEST) and the automatic refresh of adopted branches rides it. The mode
  // name is historical plumbing only.
  #doCommitBranch = async (
    branchSig: string,
    atSegments: readonly string[],
    domain?: string,
    mode: 'fold' | 'sync' = 'fold',
  ): Promise<'committed' | 'exists' | 'unavailable' | 'rewound'> => {
    const sig = String(branchSig ?? '').toLowerCase().trim()
    if (!SIG_RE.test(sig)) return 'unavailable'

    const ioc = this.#ioc()
    const broker = ioc?.get?.(BROKER_KEY) as BrokerLike | undefined
    const history = ioc?.get?.(HISTORY_KEY) as PlacementHistory | undefined
    const committer = ioc?.get?.(COMMITTER_KEY) as CommitterLike | undefined
    const lineage = ioc?.get?.(LINEAGE_KEY) as PlacementLineage | undefined
    if (!broker?.adopt || !history?.getLayerBySig || !committer?.update || !lineage) return 'unavailable'

    // REWOUND = read-only. importTree refuses to commit while the cursor is
    // viewing history (its guard returns void), so a fold attempted now would
    // resolve as success while writing NOTHING — the "adopted tile vanishes
    // on refresh" phantom. Refuse up front with an outcome the click path can
    // explain honestly; no retry ladder (only the user can return to head).
    const cursor = ioc?.get?.('@diamondcoreprocessor.com/HistoryCursorService') as
      | { state?: { rewound?: boolean } }
      | undefined
    if (cursor?.state?.rewound) {
      console.warn('[swarm-adopt] fold refused — history cursor is rewound', { sig: sig.slice(0, 8) })
      return 'rewound'
    }

    try {
      // Resolution protocol: pull the branch's LAYER closure into our pool so
      // getLayerBySig resolves it locally and flattenLayerTree can re-home it.
      // layersOnly — resources are sig-refs that STREAM on demand at render
      // (memory→OPFS→host write-through), so a content-rich adopt transfers a
      // handful of tiny layers, not its hundreds of images.
      if (domain) broker.noteDomainsForSig?.(sig, [domain])
      const adoptRes = await broker.adopt(sig, { layersOnly: true })

      const branchLayer = await history.getLayerBySig(sig)
      // DIAGNOSTIC: did the HIVE resolve the branch bytes? broker.adopt fetches
      // local→HTTP(domain)→mesh; failed>0 or resolved=false means the bytes
      // aren't reachable from the hive (publisher offline / domainless / not on
      // the mesh) — the content-availability edge, distinct from a wiring break.
      console.info('[swarm-adopt] fold branch', sig.slice(0, 8),
        'domain=', domain || '(none)', 'broker.adopt=', JSON.stringify(adoptRes), 'resolved=', !!branchLayer)

      // COMPLETE-OR-DEFER: failed>0 means part of the branch's LAYER closure
      // never fetched — and flattenLayerTree DROPS unresolvable children from
      // the re-homed tree, so committing now would fold a silently-truncated
      // copy as FINAL (the pruned branches aren't referenced by the local
      // copy at all, so not even the layer self-heal can recover them). The
      // receiver-side half of the availability doctrine: never commit an
      // incomplete closure. Defer instead — 'unavailable' surfaces loudly at
      // the click path, and a bounded retry ladder re-runs the whole fold
      // (adopt is content-addressed + idempotent, and this commit is
      // serialized through #commitLock, so a retry that finds the closure
      // complete commits exactly what this attempt should have).
      if ((adoptRes?.failed ?? 0) > 0) {
        console.warn('[swarm-adopt] fold deferred — layer closure incomplete; refusing truncated commit',
          { sig: sig.slice(0, 8), ...adoptRes })
        this.#scheduleFoldRetry(sig, atSegments, domain, mode)
        return 'unavailable'
      }
      const name = (branchLayer && typeof branchLayer.name === 'string') ? branchLayer.name.trim() : ''
      // Name rides untrusted signed peer content — reject path separators and
      // control chars (they corrupt the lineage path). Hyphens/spaces are fine.
      if (!branchLayer || !name || /[\\/\x00-\x1f]/.test(name)) return 'unavailable'

      const at = (Array.isArray(atSegments) ? atSegments : []).map(s => String(s ?? '').trim()).filter(Boolean)
      // Resolve the parent ROBUSTLY — resolveLayerAt walks the parent chain to
      // root. The bare currentLayerAt(sign(at)) reads `at`'s OWN bag, which is
      // cold for the very location the user is viewing when they adopt (the
      // renderer paints through the cursor, warming a different cache); a null
      // read there makes existing=[] and the children SET below WIPE the
      // siblings it couldn't see. Mirrors clipboard paste's #resolveParentLayer.
      const parent = await resolveLayerAt(history, lineage.domain, at)
      // Cold-sibling wipe guard: childNamesOfStrict resolves the parent's
      // existing children by name, but a child whose layer bytes are COLD
      // resolves to null and is dropped — and we SET the full children list
      // below, so a dropped sibling is PERMANENTLY removed. If any sibling is
      // unresolved, abort with 'unavailable' (retries when the pool warms)
      // rather than write a lossy list. Visible siblings of the current location
      // are warm (rendered), so this only bites truly-cold members.
      const { names: existing, coldMiss } = await childNamesOfStrict(history, parent)
      if (coldMiss) {
        // Defer, don't dead-end: the miss is usually the boot drain still
        // warming the pool — the same ladder that re-runs an incomplete
        // closure re-runs this, and the whole fold is idempotent.
        console.warn('[swarm-adopt] fold aborted — cold sibling(s) unresolved; refusing lossy children SET', { at })
        this.#scheduleFoldRetry(sig, atSegments, domain, mode)
        return 'unavailable'
      }
      const alreadyChild = existing.includes(name)
      // FOLD is idempotent — a tile already present here is left untouched.
      // SYNC deliberately falls through to re-home the publisher's CURRENT
      // subtree over the stale local copy (the "pull their latest" gesture).
      if (alreadyChild && mode !== 'sync') {
        this.#clearPendingFold(sig)
        return 'exists'
      }

      // Re-home the subtree and fold the name into the parent's children in ONE
      // mechanical importTree cascade — each affected ancestor commits exactly
      // once, the same primitive create / paste / bulk-import use.
      // flattenLayerTree re-expresses the branch subtree as importTree updates
      // (children by name, other slots verbatim); the parent update folds in the
      // new top.
      const treeUpdates = await flattenLayerTree(history, branchLayer, [...at, name])

      // Layer-sig-keyed props seeds ONLY (visuals-across-lineages.md,
      // Phase B — the location-keyed fill-if-empty/sync SEED-DANCE IS
      // DELETED). Each entry is keyed by the folded node's NEW head and
      // is a pure derivation of the adopted layer (its `properties[0]`),
      // so it can neither wipe another lineage's entry nor go stale — the
      // occupied-slot and sync-overwrite special cases have nothing left
      // to protect. A same-named local tile keeps its own head sig, so
      // both lineages' entries COEXIST and the paint path serves
      // whichever head is current; the substrate's blank test reads
      // canonical (a cold read counts as an image), so an adopted tile
      // can no longer be mistaken for blank and randomly re-dressed —
      // the old "image recycled to a random one on adopt" class is
      // closed at the model, not by seeding order.
      const layerSeeds: Array<[string, string]> = []
      try {
        for (const u of treeUpdates) {
          const props = (u.layer as { properties?: unknown }).properties
          const propSig = Array.isArray(props) && typeof props[0] === 'string' ? props[0] : undefined
          if (!propSig || !SIG_RE.test(propSig)) continue
          const segs = u.segments
          if (segs.length === 0) continue
          const key = await cellLocationSig(segs.slice(0, -1), segs[segs.length - 1])
          if (!key) continue
          layerSeeds.push([key, propSig])
        }
      } catch (err) {
        console.warn('[swarm-adopt] props seed prep skipped', err)
      }

      await committer.importTree([
        // De-dupe on sync replace: the name is already in `existing`, so don't
        // append a second copy — re-homing treeUpdates over [...at, name]
        // replaces the child's layer in place. Fold appends the new top.
        { segments: at, layer: { ...(parent ?? {}), children: alreadyChild ? [...existing] : [...existing, name] } },
        ...treeUpdates,
      ])

      // Post-commit so the warm head cache already points at the folded
      // layers (commitLayer keeps it in sync); each seed is a map lookup
      // plus one localStorage write, best-effort.
      try {
        for (const [locSig, propSig] of layerSeeds) seedLayerKeyedTileProps(locSig, propSig)
      } catch { /* best-effort cache seed */ }

      // READ-BACK: resolve the fold target through the SAME path a cold boot
      // uses before reporting success. importTree resolves as void even when
      // it refused to write (a cursor that rewound mid-await, a machine
      // refusal), and a 'committed' that didn't land is exactly the "adopted
      // tile vanishes on refresh" report — the live peer projection keeps the
      // screen looking right until then. Defer + retry instead of lying.
      const landed = await resolveLayerAt(history, lineage.domain, [...at, name])
      if (!landed) {
        console.warn('[swarm-adopt] fold did not land — no marker after importTree; deferring', { sig: sig.slice(0, 8), at })
        this.#scheduleFoldRetry(sig, atSegments, domain, mode)
        return 'unavailable'
      }
      this.#clearPendingFold(sig)

      // Remember this branch root so the first visit to it (and to any page
      // beneath it) fits-to-content instead of opening at an arbitrary scale.
      // Participant-local — never folded into the layer (see adopted-roots.ts).
      markAdoptedRoot([...at, name])

      // A line item in the revision history for every adopt: the commit that
      // folded this branch in gets a NAME, minted by the same word-pair
      // service the breadcrumb and the upgrade pill use — two words from the
      // branch signature (one adoption reads as one name on every device)
      // plus what happened. Best-effort: a label that can't be written never
      // un-adopts anything.
      await this.#labelAdoptRevision(history, at, sig, name, mode)

      // Pre-warm the freshly-committed neighbourhood BEFORE the render fires, so
      // show-cell's COMPLETENESS GATE resolves every child on the FIRST paint
      // instead of holding the WHOLE canvas blank while cold bytes land — the
      // "post-adopt nothing shows, not even the root tile" symptom. A fold
      // changes the current location's parent sig, which invalidates show-cell's
      // child-name memo and forces a full re-resolve of that layer's children;
      // any child cold on that pass (the new tile OR a pre-existing sibling)
      // fails the name gate and blanks the view. 79c36e63 gated the render walk
      // and the compensating pre-warm was never built (see
      // project_boot_first_click_warming). Warm by LOCATION down the fold path:
      // resolveLayerAt resolves each ancestor (the current view is one of them)
      // and getLayerBySig warms every child sig at each level, plus the folded
      // node's own children (its pages). Additive, read-only, best-effort — a
      // warm miss never blocks the fold, it just lets the gate's own retry heal.
      try {
        const foldPath = [...at, name]
        for (let d = 0; d <= foldPath.length; d++) {
          const hop = await resolveLayerAt(history, lineage.domain, foldPath.slice(0, d))
          const kids = hop ? childSigsOf(hop) : []
          if (kids.length) await Promise.all(kids.map(s => history.getLayerBySig(String(s))))
        }
      } catch (err) {
        console.warn('[swarm-adopt] post-fold neighbourhood warm skipped', err)
      }

      EffectBus.emit('fs:changed', { segments: at })
      await new hypercomb().act()
      return 'committed'
    } catch (err) {
      console.warn('[swarm-adopt] commit failed', { sig: sig.slice(0, 8), err })
      return 'unavailable'
    }
  }

  /**
   * Name the marker an adopt just minted at the parent location — the line
   * item Revision History shows for this adoption. The name is deterministic
   * (revisionName over the BRANCH signature), so the same adoption carries
   * the same two words on every device, and the participant can rename it
   * later like any revision.
   */
  #labelAdoptRevision = async (
    history: PlacementHistory,
    at: readonly string[],
    branchSig: string,
    name: string,
    mode: 'fold' | 'sync',
  ): Promise<void> => {
    try {
      const h = history as unknown as {
        sign?: (lineage: unknown) => Promise<string>
        listMarkerFilenames?: (locationSig: string) => Promise<string[]>
        setMarkerMeta?: (
          locationSig: string,
          filename: string,
          meta: { label?: string; marked?: boolean; path?: readonly string[] },
        ) => Promise<void>
      }
      if (!h.sign || !h.listMarkerFilenames || !h.setMarkerMeta) return
      const locale = (this.#ioc()?.get?.(I18N_IOC_KEY) as I18nProvider | undefined)?.locale
      const label = revisionName({
        packageSig: branchSig,
        label: mode === 'sync' ? `synced "${name}"` : `adopted "${name}"`,
        locale,
      })
      const locationSig = await h.sign({ explorerSegments: () => [...at] })
      const markers = await h.listMarkerFilenames(locationSig)
      const latest = [...markers].sort().at(-1)
      if (latest) await h.setMarkerMeta(locationSig, latest, { label, marked: true, path: [...at] })
    } catch (err) {
      console.warn('[swarm-adopt] adopt landed but its revision label could not be written', err)
    }
  }

  // ── recoverable fold receipt (persisted) ──────────────────────────
  #loadFolded = (): FoldedEntry[] => {
    try {
      const raw = localStorage.getItem(FOLDED_KEY)
      const arr = raw ? JSON.parse(raw) : []
      return Array.isArray(arr)
        ? arr
            .filter((e: unknown): e is FoldedEntry =>
              !!e && typeof (e as FoldedEntry).sig === 'string' && typeof (e as FoldedEntry).name === 'string')
            .map((e: FoldedEntry) => ({ sig: e.sig.toLowerCase(), name: e.name, at: Array.isArray(e.at) ? e.at : [] }))
        : []
    } catch { return [] }
  }
  /** Add ONE landed branch to the recoverable folded receipt, idempotently
   *  (a re-adopt of the same sig refreshes the entry rather than duplicating
   *  it). Kept sorted by sig so the list's own sha256 stays stable. */
  #recordFoldedBranch = (sig: string, name: string, at: string[]): void => {
    const clean = String(sig ?? '').trim().toLowerCase()
    if (!SIG_RE.test(clean)) return
    try {
      const next = this.#loadFolded().filter(e => e.sig !== clean)
      next.push({ sig: clean, name: String(name ?? '').trim(), at })
      this.#saveFolded(next.sort((a, b) => a.sig.localeCompare(b.sig)))
    } catch { /* quota / malformed — the receipt is recoverable, never load-bearing */ }
  }

  #saveFolded = (entries: FoldedEntry[]): void => {
    try { localStorage.setItem(FOLDED_KEY, JSON.stringify(entries)) } catch { /* no localStorage — diff degrades */ }
  }

  // ── pending (deferred) folds — the durable intent behind the ladder ──
  // Keyed by branch sig (one owed fold per branch; a newer target wins).
  // Written on every deferral, cleared on landed commit / exists / ladder
  // give-up, resumed by the constructor on the next boot.
  #loadPendingFolds = (): PendingFold[] => {
    try {
      const raw = localStorage.getItem(PENDING_FOLDS_KEY)
      const arr = raw ? JSON.parse(raw) : []
      return Array.isArray(arr)
        ? arr.filter((e: unknown): e is PendingFold =>
            !!e
            && SIG_RE.test(String((e as PendingFold).sig ?? ''))
            && Array.isArray((e as PendingFold).at))
        : []
    } catch { return [] }
  }
  #savePendingFolds = (entries: PendingFold[]): void => {
    try { localStorage.setItem(PENDING_FOLDS_KEY, JSON.stringify(entries)) } catch { /* no localStorage — retries stay session-only */ }
  }
  #persistPendingFold = (f: PendingFold): void => {
    this.#savePendingFolds([...this.#loadPendingFolds().filter(e => e.sig !== f.sig), f])
  }
  #clearPendingFold = (sig: string): void => {
    const all = this.#loadPendingFolds()
    const rest = all.filter(e => e.sig !== sig)
    if (rest.length !== all.length) this.#savePendingFolds(rest)
  }

  // ── un-fold (remove) a tile from the hive membership — recoverable ──
  // Serialized through the SAME #commitLock as #commitBranch so adds/removes
  // never race on a parent's children list.
  #unfoldBranch = (name: string, atSegments: readonly string[]): Promise<boolean> => {
    const run = () => this.#doUnfoldBranch(name, atSegments)
    const next = this.#commitLock.then(run, run)
    this.#commitLock = next.catch(() => undefined)
    return next
  }

  #doUnfoldBranch = async (name: string, atSegments: readonly string[]): Promise<boolean> => {
    const n = String(name ?? '').trim()
    if (!n) return false
    const ioc = this.#ioc()
    const history = ioc?.get?.(HISTORY_KEY) as PlacementHistory | undefined
    const committer = ioc?.get?.(COMMITTER_KEY) as CommitterLike | undefined
    const lineage = ioc?.get?.(LINEAGE_KEY) as PlacementLineage | undefined
    if (!history?.sign || !history?.currentLayerAt || !committer?.update || !lineage) return false
    try {
      const at = (Array.isArray(atSegments) ? atSegments : []).map(s => String(s ?? '').trim()).filter(Boolean)
      // Resolve the parent ROBUSTLY (parent-chain walk), matching #doCommitBranch.
      // The bare currentLayerAt reads the location's OWN bag, which is cold for the
      // current location → existing=[] → a false "already gone" that the DCP
      // receipt records as a successful removal (desync: the branch stays folded
      // forever, never retried). A null parent means we cannot CONFIRM the removal.
      const parent = await resolveLayerAt(history, lineage.domain, at)
      if (!parent) return false
      const { names: existing, coldMiss } = await childNamesOfStrict(history, parent)
      if (coldMiss) {
        console.warn('[swarm-adopt] unfold aborted — cold sibling(s) unresolved; refusing lossy children SET', { at })
        return false
      }
      if (!existing.includes(n)) return true   // confirmed absent — idempotent
      // Removal = a NEW marker without this child. The prior marker (with it)
      // and the content bytes persist (append-only + content-addressed), so a
      // later re-enable re-folds it — "a path back to recovery, always".
      await committer.update(at, { ...parent, children: existing.filter(c => c !== n) })
      EffectBus.emit('fs:changed', { segments: at })
      await new hypercomb().act()
      return true
    } catch (err) {
      console.warn('[swarm-adopt] unfold failed', { name: n, err })
      return false
    }
  }

}

const _swarmAdopt = new SwarmAdoptDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/SwarmAdoptDrone',
  _swarmAdopt,
)
