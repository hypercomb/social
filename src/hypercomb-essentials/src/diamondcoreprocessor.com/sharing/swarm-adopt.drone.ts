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
}

const _swarmAdopt = new SwarmAdoptDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/SwarmAdoptDrone',
  _swarmAdopt,
)
