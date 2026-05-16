// diamondcoreprocessor.com/sharing/swarm-adopt.drone.ts
//
// Adoption path for unadopted swarm tiles. When a user clicks the
// `sync` icon on a tile that's currently rendered as `kind: 'peer'`
// (i.e. it appears in the canvas because a peer published it but the
// local OPFS doesn't have it yet), this drone materialises a local
// directory for the tile so it becomes the user's own.
//
// After adoption:
//   - The tile is in the user's OPFS at the current lineage.
//   - cell:added fires, so show-cell + activity log + auto-fit react.
//   - SwarmDrone's next publish at this lineage will include the tile
//     in this user's children list (since it's now local), and other
//     peers will see the user as a co-publisher of that tile.
//   - On the next render, the tile renders as `kind: 'opfs'` (owned)
//     instead of `kind: 'peer'` (preview style).
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
  peerTilesAtCurrentSig: () => readonly { name: string; peerPubkey: string }[]
}

interface LineageLike {
  explorerDir?: () => Promise<FileSystemDirectoryHandle | null>
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
  protected override emits: string[] = ['cell:added']

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
    const isPeer = peerTiles.some(p => p.name === label)
    if (!isPeer) return

    const lineage = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
      LINEAGE_KEY,
    ) as LineageLike | undefined
    const dir = await lineage?.explorerDir?.()
    if (!dir) return

    // getDirectoryHandle with create:true is idempotent — returns the
    // existing handle if present, creates a new dir otherwise. We
    // always re-emit cell:added afterwards so adopt feels responsive
    // even when the tile is already on disk (substrate auto-applies
    // an image when 0000.imageSig is missing, so adopt visibly
    // "appears" with a fresh image even for an idle, image-less
    // existing tile).
    try {
      await dir.getDirectoryHandle(label, { create: true })
    } catch (err) {
      console.warn('[swarm-adopt] failed to create/open local dir for', label, err)
      return
    }

    // cell:added → show-cell re-renders, activity log surfaces it,
    // AutoFitFirstAddDrone fits if this is the first cell at this
    // lineage. Emitting for an already-existing tile is harmless
    // idempotent — show-cell's incremental path no-ops if the slot
    // already has the name.
    EffectBus.emit('cell:added', { cell: label })

    // Force-apply substrate to this cell so an image visibly appears.
    // substrate.drone's cell:added listener has guards (drop/paste/
    // editor pending) that can skip; calling the service directly
    // bypasses those for the explicit user-driven adopt action — if
    // the cell already has an imageSig in 0000 the service is a noop,
    // otherwise an image is assigned and substrate:applied fires for
    // the in-place buffer update.
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
