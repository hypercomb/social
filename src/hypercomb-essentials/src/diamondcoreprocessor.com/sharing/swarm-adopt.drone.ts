// diamondcoreprocessor.com/sharing/swarm-adopt.drone.ts
//
// Adoption path for peer-published swarm tiles. When the user clicks
// the `adopt` icon on a tile rendered as `kind: 'peer'` (a peer is
// publishing it but our local layer doesn't list it), this drone folds
// the tile into the local layer.
//
// Layer-as-primitive: adoption is a layer mutation. The peer's 0000
// JSON travels INLINE on the wire (`SwarmLayerPayload.visuals[i].props`),
// so adopt reads the cached parsed object straight from
// `SwarmDrone.peerTilesAtCurrentSig` — no resource fetch, no parse
// step. We strip session-only / paired-channel-era keys and commit
// via the canonical `writeTilePropertiesAt` path. The cascade folds
// the new tile-layer sig into the parent's `children` slot — one
// undoable marker per ancestor depth, atomic.
//
// Image bytes (referenced by sig inside the props) ride kind 30201
// separately; they're already in __resources__/ by adopt-time thanks
// to the swarm pull pipeline. Substrate fills any visual gap when
// the peer published a label-only tile (no `props`).

import { Drone, EffectBus } from '@hypercomb/core'
import { writeTilePropertiesAt } from '../editor/tile-properties.js'

const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const SUBSTRATE_SERVICE_KEY = '@diamondcoreprocessor.com/SubstrateService'
const CONTENT_BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'
const STORE_KEY = '@hypercomb.social/Store'

const SIG_RE = /^[0-9a-f]{64}$/

/** Walk a value (the peer's adopted props object) for sig-shaped
 *  strings — `imageSig`, `small.image`, `flat.small.image`, anything
 *  nested deeper. Returns deduped sigs the receiver should try to
 *  resolve via broker so adopt brings the visual content along with
 *  the tile shape. */
function collectSigs(value: unknown, out: Set<string>): void {
  if (!value) return
  if (typeof value === 'string') {
    if (SIG_RE.test(value)) out.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectSigs(v, out)
    return
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectSigs(v, out)
  }
}

// Property keys we strip from the peer's 0000 before committing — they
// represent stale protocol markers or per-session render state that
// doesn't belong on the adopter's layer.
//
// `index` is KEPT (not stripped) — adopt-in-place is the user-facing
// promise: the peer tile sits at slot N on the receiver's canvas (we
// honor peer.index when the slot is free, per show-cell.drone.ts
// Pass 2); adopting it should leave it sitting at slot N, not toss
// it back into the score-based unindexed pile. Dropping `index` here
// produced the jarring "tile leaps to a different slot the moment I
// adopt it" UX. Local layout sovereignty is already enforced in
// Pass 1 — if the adopter ALSO has a local tile at slot N (or any
// tile occupies it before this commit lands), #orderByIndexPinned's
// collision check demotes the new arrival to unindexed; the
// publisher's index only ever sticks when the slot is genuinely free.
const STRIPPED_PEER_KEYS = [
  'children', 'facade', 'branchSig', 'channelId', 'approvalId',
  'viewport', 'pan', 'zoom', 'meshOffset',
  'transient',
] as const

interface SwarmDroneLike {
  peerTilesAtCurrentSig: () => readonly ({
    name: string
    peerPubkey: string
    imageSig?: string
  } & Record<string, unknown>)[]
}

interface LineageLike {
  explorerSegments?: () => readonly string[]
}

interface SubstrateServiceLike {
  applyToCell?: (cell: string) => boolean
}

interface TileActionPayload {
  action: string
  label?: string
  // When the action is fired from the selection menu (Adopt All on
  // a multi-selected set), `labels` carries the full set and `label`
  // is unused. Single-tile adopt continues to use `label`.
  labels?: readonly string[]
  q?: number
  r?: number
  index?: number
}

export class SwarmAdoptDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Adopts unadopted swarm peer tiles into the local layer. Reads the inlined 0000 from the peer\'s wire payload, strips session-only fields, commits via writeTilePropertiesAt — one atomic cascade with full carry-over.'

  protected override listens: string[] = ['tile:action']
  protected override emits: string[] = ['cell:added', 'cell:0000-changed', 'tile:saved', 'substrate:applied']

  constructor() {
    super()

    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      const action = String(payload?.action ?? '')
      if (action !== 'adopt' && action !== 'sync') return

      // Multi-tile adopt — UI fires this from the selection vertical
      // menu with the set of selected names. We iterate and adopt each
      // one independently; each call creates its own local layer commit
      // (writeTilePropertiesAt cascades a per-tile marker through the
      // ancestor chain), so undo replays one tile at a time too.
      //
      // Sequential rather than parallel: writeTilePropertiesAt resolves
      // the PARENT layer at write time, and parallel writes against the
      // same parent race on the cascade. Sequential is also the natural
      // mental model — "adopt these three in order" — and on the local
      // commit path it's plenty fast (no network gating).
      const labels = Array.isArray(payload?.labels)
        ? payload.labels.map(s => String(s ?? '').trim()).filter(Boolean)
        : []
      if (labels.length > 0) {
        void (async () => {
          for (const label of labels) {
            await this.#adoptPeerTile(label)
          }
        })()
        return
      }

      const label = String(payload?.label ?? '').trim()
      if (!label) return
      void this.#adoptPeerTile(label)
    })
  }

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => { /* noop */ }

  #adoptPeerTile = async (label: string): Promise<void> => {
    const ioc = (window as { ioc?: { get: (k: string) => unknown } }).ioc
    const swarm = ioc?.get?.(SWARM_DRONE_KEY) as SwarmDroneLike | undefined
    if (!swarm?.peerTilesAtCurrentSig) return

    // Filter — only act if this tile is currently surfaced as a peer
    // tile by the swarm. Other action handlers (editor for owned tiles)
    // cover their own kinds; we no-op so they don't double-handle.
    //
    // Reads from the in-memory cache LIVE at click-time — multiple
    // peer updates that landed during the debounce window are all
    // reflected, so we always commit the latest props the peer
    // published.
    const peerTiles = swarm.peerTilesAtCurrentSig()
    const peerEntry = peerTiles.find(p => p.name === label)
    if (!peerEntry) return

    const lineage = ioc?.get?.(LINEAGE_KEY) as LineageLike | undefined
    const segments = lineage?.explorerSegments?.() ?? []
    const segmentsClean = (Array.isArray(segments) ? segments : [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)

    // The peer's 0000 is already inlined as first-class fields on
    // peerEntry (no `props` wrapper — they ARE the cell properties).
    // Destructure off the swarm-only fields and strip session-only /
    // paired-channel-era markers; what's left is what we commit.
    //
    // Trust boundary: `peerEntry` is read from `peerTilesAtCurrentSig`,
    // which surfaces data from `#peerLayersBySig` — every entry in that
    // map was filtered through `sanitizeVisual` at receive time
    // (swarm.drone.ts `#onEvent`). So `rest` here contains only known-
    // safe keys with validated value shapes: nothing the renderer or
    // any downstream consumer treats as code, no unknown-key escape
    // vectors. The STRIPPED_PEER_KEYS pass below remains as
    // defence-in-depth, dropping fields that ARE safe-shaped but are
    // local-only by policy (session viewport, paired-channel-era ids,
    // the publisher's `index` since local layout owns slot assignment).
    let peerProps: Record<string, unknown> | null = null
    const { name: _n, peerPubkey: _p, imageSig: _i, ...rest } = peerEntry as Record<string, unknown>
    void _n; void _p; void _i  // intentionally discarded
    const cloned: Record<string, unknown> = { ...rest }
    for (const k of STRIPPED_PEER_KEYS) delete cloned[k]
    if (Object.keys(cloned).length > 0) peerProps = cloned

    if (peerProps) {
      // Atomic adopt-with-carry-over. writeTilePropertiesAt writes the
      // child layer's `properties` slot via LayerCommitter; the cascade
      // folds the new child layer sig into the parent's `children` slot.
      // ONE undoable marker per ancestor depth — no per-event legacy
      // commit hop (we never emit cell:added in this branch).
      try {
        await writeTilePropertiesAt(segmentsClean, label, peerProps)
        EffectBus.emit('tile:saved', { cell: label })

        // Adopt brings the tile AND its resources. Walk the props the
        // peer published for any sig-shaped fields (imageSig,
        // small.image, flat.small.image, anything nested deeper) and
        // ask the broker to fetch each. Fire-and-forget — the broker
        // verifies sha256 on receive and writes to Store, so the
        // resource lands in __resources__/<sig> ready for show-cell's
        // atlas binder to pick up on its next render.
        //
        // The same sigs also become "keys to look for unexplored
        // resources": broker subscribes to the sig channel; any other
        // participant who has cached the bytes responds. Even if the
        // original publisher leaves, the swarm collectively serves it.
        //
        // This is the line of consent: visuals-only browse never
        // triggers this; only explicit adopt does.
        void this.#fetchAdoptedResources(peerProps)
        return
      } catch (err) {
        console.warn('[swarm-adopt] writeTilePropertiesAt failed for', label, err)
        // Fall through to legacy path so the tile still becomes
        // adoptable; the user can re-trigger to retry property carry.
      }
    }

    // Fallback: peer didn't publish a 0000 (label-only tile) or the
    // commit failed. Use the legacy cell:added cascade so the tile
    // still mints into the parent's children, then let substrate fill
    // in a placeholder image so the result is at least visible.
    EffectBus.emit('cell:added', { cell: label, segments: segmentsClean })
    EffectBus.emit('tile:saved', { cell: label })

    const substrate = ioc?.get?.(SUBSTRATE_SERVICE_KEY) as SubstrateServiceLike | undefined
    if (substrate?.applyToCell) {
      try {
        if (substrate.applyToCell(label)) {
          EffectBus.emit('substrate:applied', { cell: label })
        }
      } catch (err) {
        console.warn('[swarm-adopt] substrate.applyToCell failed for', label, err)
      }
    }
  }

  /** After committing an adopted tile, walk its props for sig-shaped
   *  fields and ask the broker to fetch each one. Verified bytes land
   *  in Store via the broker's own write path. Already-cached sigs are
   *  no-ops at the Store layer. Sigs the swarm can't locate just fail
   *  silently — the tile still renders (substrate fills in the gap)
   *  and a later re-trigger can succeed if a host turns up.
   *
   *  Fire-and-forget — the adopt success isn't blocked on resource
   *  arrival. The renderer's atlas binder picks up the bytes the next
   *  time it walks the cell. */
  #fetchAdoptedResources = async (peerProps: Record<string, unknown>): Promise<void> => {
    const ioc = (window as { ioc?: { get: (k: string) => unknown } }).ioc
    const broker = ioc?.get?.(CONTENT_BROKER_KEY) as {
      fetchBySig?: (sig: string, type: string, timeoutMs?: number) => Promise<Uint8Array | null>
    } | undefined
    if (!broker?.fetchBySig) return

    const sigs = new Set<string>()
    collectSigs(peerProps, sigs)
    if (sigs.size === 0) return

    // Don't await all — the tile commit already succeeded; the resources
    // arrive when they arrive. The broker coalesces concurrent fetches
    // for the same sig, so multiple adopts touching the same resource
    // share one in-flight request.
    for (const sig of sigs) {
      void broker.fetchBySig(sig, 'resource').catch(() => { /* silent — broker logs */ })
    }
  }
}

const _swarmAdopt = new SwarmAdoptDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/SwarmAdoptDrone',
  _swarmAdopt,
)
