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
// represent local render state or stale protocol markers that don't
// belong on the adopter's layer. `index` is excluded because the local
// layout owns slot assignment.
const STRIPPED_PEER_KEYS = [
  'children', 'facade', 'branchSig', 'channelId', 'approvalId',
  'index', 'viewport', 'pan', 'zoom', 'meshOffset',
  'transient',
] as const

interface SwarmDroneLike {
  peerTilesAtCurrentSig: () => readonly {
    name: string
    peerPubkey: string
    props?: Record<string, unknown>
    imageSig?: string
    index?: number
  }[]
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

    // The peer's 0000 is already parsed and inlined in peerEntry.props
    // — no fetch, no parse. Strip session-only / paired-channel-era
    // markers and we're ready to commit.
    let peerProps: Record<string, unknown> | null = null
    if (peerEntry.props && typeof peerEntry.props === 'object' && !Array.isArray(peerEntry.props)) {
      const cloned = { ...peerEntry.props }
      for (const k of STRIPPED_PEER_KEYS) delete cloned[k]
      if (Object.keys(cloned).length > 0) peerProps = cloned
    }

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
