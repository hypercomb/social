// diamondcoreprocessor.com/sharing/swarm-adopt.drone.ts
//
// Adoption path for unadopted swarm tiles. When a user clicks the
// `sync` icon on a tile rendered as `kind: 'peer'` (a peer is
// publishing it but our local layer doesn't list it), this drone
// folds the tile into the local layer.
//
// Layer-as-primitive: adoption is a layer mutation. We emit
// cell:added for the parent lineage; LayerCommitter's cascade adds
// the tile's sig to the parent layer's `children` slot. We do not
// mint an OPFS dir, do not write any 0000 file, do not seed any
// tile-keyed cache. The peer's content bytes (image variants,
// nested sub-tiles) live content-addressed in __resources__/ via
// the swarm resource pipeline (kind 30201); promotion to layer
// slots will happen in the 0000-to-slots refactor.
//
// This drone lives alongside the paired-channel adopt path in
// expose.drone — both listen for `tile:action` with action='sync',
// and each filters to its own kind (paired-channel facades vs swarm
// peer tiles). The first one whose filter matches the tile handles
// it; the other no-ops harmlessly.

import { Drone, EffectBus } from '@hypercomb/core'

const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const SUBSTRATE_SERVICE_KEY = '@diamondcoreprocessor.com/SubstrateService'

interface SwarmDroneLike {
  peerTilesAtCurrentSig: () => readonly { name: string; peerPubkey: string; index?: number; propsSig?: string; imageSig?: string }[]
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
    'Adopts unadopted swarm peer tiles into the local OPFS when the user invokes the sync action on a peer-rendered tile.'

  protected override listens: string[] = ['tile:action']
  protected override emits: string[] = ['cell:added', 'cell:0000-changed', 'tile:saved', 'substrate:applied']

  constructor() {
    super()

    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      const action = String(payload?.action ?? '')
      if (action !== 'sync' && action !== 'adopt') return
      const label = String(payload?.label ?? '').trim()
      if (!label) return
      void this.#adoptPeerTile(label)
    })
  }

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => { /* noop */ }

  #adoptPeerTile = async (label: string): Promise<void> => {
    const swarm = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
      SWARM_DRONE_KEY,
    ) as SwarmDroneLike | undefined
    if (!swarm?.peerTilesAtCurrentSig) return

    // Filter — only act if this tile is currently surfaced as a peer
    // tile by the swarm. Other action handlers (paired-channel adopt
    // for ephemerals, editor for owned tiles) cover their own kinds;
    // we no-op so they don't double-handle.
    const peerTiles = swarm.peerTilesAtCurrentSig()
    const peerEntry = peerTiles.find(p => p.name === label)
    if (!peerEntry) return

    const lineage = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
      LINEAGE_KEY,
    ) as LineageLike | undefined

    // LAYER-ONLY ADOPTION (project_layer_is_primitive).
    //
    // Adoption is a layer mutation, full stop. We do not mint an
    // OPFS dir for the adopted tile, we do not copy the peer's 0000
    // bytes onto the filesystem, we do not seed any tile-keyed cache.
    // The flow is exactly the same as any local /add: emit cell:added
    // for the parent lineage and let the LayerCommitter cascade fold
    // the new child into the parent layer's `children` slot.
    //
    // The peer's tile content (its image, properties, sub-children)
    // travels content-addressed through the swarm resource pipeline
    // (kind 30201). Once the user enriches the adopted tile (or once
    // the 0000-into-layer-slots refactor lands), property carry-over
    // becomes a layer-mutation step too. For now adoption sets up
    // membership only — the user's local layer for `label` starts at
    // the auto-minted empty layer, and the renderer falls back to
    // substrate-fill for the visible image. Peer image bytes already
    // in __resources__/ remain there for later promotion to a layer
    // slot when the tile-properties refactor lands.
    const segments = lineage?.explorerSegments?.() ?? []
    const segmentsClean = (Array.isArray(segments) ? segments : [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)

    EffectBus.emit('cell:added', { cell: label, segments: segmentsClean })

    // tile:saved → show-cell drops every per-label cache for this label
    // and triggers a fresh resolve so the freshly-adopted tile renders
    // immediately instead of carrying over the null cache entry left
    // by the pre-adoption peer-render pass.
    EffectBus.emit('tile:saved', { cell: label })

    // Force-apply substrate to this cell so an image visibly appears.
    // The peer's image bytes may already be in __resources__/ via the
    // swarm resource stream, but without a property slot on the new
    // tile's layer pointing at them the renderer can't bind. Substrate
    // fills in a deterministic-per-label fallback until 0000-to-slots
    // lands, at which point the peer's actual image refs carry over
    // via the layer's `image` slot and substrate becomes a no-op for
    // adopted-with-image tiles.
    const substrate = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
      SUBSTRATE_SERVICE_KEY,
    ) as SubstrateServiceLike | undefined
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
