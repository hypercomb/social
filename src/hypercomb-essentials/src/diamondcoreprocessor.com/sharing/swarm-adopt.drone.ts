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

// Mirror of swarm.drone.ts MAX_PUBLISH_DEPTH. The publisher walks their
// subtree this many levels deep on each publish, so a single adopt can
// in principle pull this much depth from one peer in one click. Going
// deeper than this finds nothing — the publisher didn't ship it.
const MAX_ADOPT_DEPTH = 3

// How long we wait for the relay to replay sub-location events into the
// swarm cache after we subscribe. The relay's REQ-replay arrives within
// one round-trip on local dev (sub-100ms) but public relays via CDN
// (wss://jwize.com) have round-trip + Cloudflare overhead that can
// reach 1-2s under load. With the swarm.drone polling fix landed,
// ensurePeerCacheAt early-exits the instant peer data appears — so
// raising this ceiling to 4000ms is essentially free for fast paths
// (most walks finish in <500ms) while letting slower relays complete.
const SUBSCRIBE_WAIT_MS = 4000

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
  // Public APIs used for the recursive-adopt walk below.
  composeSigForSegments?: (segments: readonly string[]) => Promise<string>
  peerTilesAtSig?: (sig: string) => readonly ({
    name: string
    peerPubkey: string
    imageSig?: string
  } & Record<string, unknown>)[]
  // Subscribe + wait for the swarm's own cache (not just the mesh
  // cache) to populate at a sub-location, so peerTilesAtSig() returns
  // populated data after this resolves.
  ensurePeerCacheAt?: (segments: readonly string[], timeoutMs?: number) => Promise<string>
}

interface LineageLike {
  explorerSegments?: () => readonly string[]
}

interface SubstrateServiceLike {
  applyToCell?: (cell: string) => boolean
}

interface TileActionPayload {
  action: string
  label: string
  q: number
  r: number
  index: number
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
      const label = String(payload?.label ?? '').trim()
      if (!label) return
      void this.#adoptPeerTile(label)
    })
  }

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => { /* noop */ }

  #adoptPeerTile = async (label: string): Promise<void> => {
    const lineage = (window as { ioc?: { get: (k: string) => unknown } }).ioc
      ?.get?.(LINEAGE_KEY) as LineageLike | undefined
    const segments = lineage?.explorerSegments?.() ?? []
    const segmentsClean = (Array.isArray(segments) ? segments : [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)

    // Top-level adopt at the current location. The single click drives
    // both this and the recursive-descendant walk below — one action,
    // one undoable cascade per layer touched, full subtree imported.
    const adopted = await this.#adoptOneAt(segmentsClean, label)
    if (!adopted) return

    // Recursive descendant walk. The publisher already ships layer events
    // for every location they visit up to swarm.drone.ts MAX_PUBLISH_DEPTH;
    // we follow that ladder by subscribing to each sub-sig and adopting
    // whatever the peer cache contains there. Stops naturally when a
    // sub-location has nothing published (leaf or unvisited subtree).
    //
    // Fire-and-forget — the user gets their top-level tile committed
    // immediately and the rest streams in as relay replays arrive.
    // Errors at any depth are warned but never abort the top-level adopt.
    void this.#adoptDescendants([...segmentsClean, label], 1).catch(err =>
      console.warn('[swarm-adopt] descendant walk failed', err))
  }

  /**
   * Adopt one peer-published tile at an arbitrary location, not just
   * the current one. Used recursively below — we need to commit tiles
   * under "/dolphin/team/foo" while the user is still at "/", so the
   * trigger location ≠ the commit location.
   *
   * Returns true when something was written (top-level commit OR
   * fallback cascade), false when there was nothing for this label
   * at the given location (peer cache miss).
   */
  #adoptOneAt = async (parentSegments: string[], label: string): Promise<boolean> => {
    const ioc = (window as { ioc?: { get: (k: string) => unknown } }).ioc
    const swarm = ioc?.get?.(SWARM_DRONE_KEY) as SwarmDroneLike | undefined
    if (!swarm?.composeSigForSegments || !swarm?.peerTilesAtSig) return false

    const parentSig = await swarm.composeSigForSegments(parentSegments)
    if (!parentSig) return false

    // Filter — only act if this tile is currently surfaced as a peer
    // tile at this location by the swarm. Other action handlers cover
    // their own kinds; we no-op so they don't double-handle.
    //
    // Reads from the in-memory cache LIVE at call-time — multiple peer
    // updates that landed during the debounce window are all reflected,
    // so we always commit the latest props the peer published.
    const peerTiles = swarm.peerTilesAtSig(parentSig)
    const peerEntry = peerTiles.find(p => p.name === label)
    if (!peerEntry) return false

    // The peer's 0000 is already inlined as first-class fields on
    // peerEntry (no `props` wrapper — they ARE the cell properties).
    // Destructure off the swarm-only fields and strip session-only /
    // paired-channel-era markers; what's left is what we commit.
    //
    // Trust boundary: `peerEntry` is read from `peerTilesAtSig`, which
    // surfaces data from `#peerLayersBySig` — every entry in that map
    // was filtered through `sanitizeVisual` at receive time
    // (swarm.drone.ts `#onEvent`). So `rest` here contains only known-
    // safe keys with validated value shapes. The STRIPPED_PEER_KEYS pass
    // below remains as defence-in-depth, dropping fields that ARE safe-
    // shaped but are local-only by policy (session viewport, paired-
    // channel-era ids).
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
        await writeTilePropertiesAt(parentSegments, label, peerProps)
        EffectBus.emit('tile:saved', { cell: label })
        return true
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
    EffectBus.emit('cell:added', { cell: label, segments: parentSegments })
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
    return true
  }

  /**
   * Recursively adopt everything the peer has published under a given
   * location. We subscribe to the location's composed sig so the mesh
   * fans relay-replayed events into the swarm cache, wait briefly for
   * them to arrive, then adopt each child and recurse.
   *
   * The walk halts naturally when:
   *   - depth > MAX_ADOPT_DEPTH (matches publisher's MAX_PUBLISH_DEPTH —
   *     deeper than this the publisher didn't ship anything anyway).
   *   - sub-location has no peer events after SUBSCRIBE_WAIT_MS
   *     (the peer never visited that subtree, so the relay has nothing
   *     to replay).
   *
   * Concurrent across sibling children — each child's subtree imports
   * in parallel via Promise.allSettled. Resilient: a single child's
   * subtree failing doesn't poison the others.
   */
  #adoptDescendants = async (parentSegments: string[], depth: number): Promise<void> => {
    if (depth > MAX_ADOPT_DEPTH) return

    const ioc = (window as { ioc?: { get: (k: string) => unknown } }).ioc
    const swarm = ioc?.get?.(SWARM_DRONE_KEY) as SwarmDroneLike | undefined
    if (!swarm?.ensurePeerCacheAt || !swarm?.peerTilesAtSig) return

    // Subscribe through the swarm's own subscribe path (NOT mesh.ensureStartedForSig)
    // — that's the only route that routes inbound events through the swarm's
    // #onEvent handler, which is what populates #peerLayersBySig. Using the mesh
    // method alone fills only the mesh-level cache, so peerTilesAtSig() comes
    // back empty even though the bytes are in memory.
    //
    // Returns the sub-sig so we can read peerTilesAtSig immediately after.
    // Idempotent — repeat calls for the same sig reuse the bucket.
    const subSig = await swarm.ensurePeerCacheAt(parentSegments, SUBSCRIBE_WAIT_MS)
    if (!subSig) return

    const subTiles = swarm.peerTilesAtSig(subSig)
    if (subTiles.length === 0) return

    // Adopt all children of this sub-location, then recurse into each
    // one's subtree. Parallel siblings (each subtree is independent);
    // sequential within a chain so a parent commits before its children
    // try to write under it (writeTilePropertiesAt resolves the parent
    // layer at write time and would create a stub if the parent didn't
    // exist yet — fine but redundant work).
    await Promise.allSettled(subTiles.map(async (subTile) => {
      const adopted = await this.#adoptOneAt(parentSegments, subTile.name)
      if (adopted) {
        await this.#adoptDescendants([...parentSegments, subTile.name], depth + 1)
      }
    }))
  }
}

const _swarmAdopt = new SwarmAdoptDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/SwarmAdoptDrone',
  _swarmAdopt,
)
