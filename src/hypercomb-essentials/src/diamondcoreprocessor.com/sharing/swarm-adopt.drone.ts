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
import { cellLocationSig, readCellProperties, writeCellProperties } from '../editor/tile-properties.js'

const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const SUBSTRATE_SERVICE_KEY = '@diamondcoreprocessor.com/SubstrateService'
const STORE_KEY = '@hypercomb.social/Store'

interface SwarmDroneLike {
  peerTilesAtCurrentSig: () => readonly { name: string; peerPubkey: string; index?: number; propsSig?: string; imageSig?: string }[]
}

interface LineageLike {
  explorerDir?: () => Promise<FileSystemDirectoryHandle | null>
  explorerSegments?: () => readonly string[]
}

interface SubstrateServiceLike {
  applyToCell?: (cell: string) => boolean
}

interface StoreLike {
  getResource?: (sig: string) => Promise<Blob | null>
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
    const dir = await lineage?.explorerDir?.()
    if (!dir) return

    // getDirectoryHandle with create:true is idempotent — returns the
    // existing handle if present, creates a new dir otherwise. We
    // always re-emit cell:added afterwards so adopt feels responsive
    // even when the tile is already on disk (substrate auto-applies
    // an image when 0000.imageSig is missing, so adopt visibly
    // "appears" with a fresh image even for an idle, image-less
    // existing tile).
    let cellDir: FileSystemDirectoryHandle
    try {
      cellDir = await dir.getDirectoryHandle(label, { create: true })
    } catch (err) {
      console.warn('[swarm-adopt] failed to create/open local dir for', label, err)
      return
    }

    // Adoption seeding policy — three axes, each independent:
    //
    //   1. 0000 bytes (canonical tile props): write peer's verbatim ONLY when
    //      local has no 0000. Don't clobber a user who's already edited
    //      this label.
    //
    //   2. index (slot position): keep host's index UNLESS participant
    //      already has their own. Read local 0000's index field; if absent,
    //      apply host's. Drives the "participant lays out tiles the same
    //      way the host did" requirement — without this, the pinned-order
    //      resolver demotes adopted tiles to the next-free slot.
    //
    //   3. propsIndex[label] (image pointer in localStorage): write peer's
    //      imageSig ONLY when local has none. Same don't-clobber policy
    //      as 0000.
    //
    // After ANY seeding step lands content, emit `tile:saved` for the
    // label. show-cell listens for that effect and drops cellImageCache /
    // cellBorderColorCache / cellTagsCache / cellLinkCache / cellSubstrateCache
    // entries for the label, forcing a fresh slow-path read on the next
    // render. Without this emission the per-label caches retain values
    // (often `null`) from the pre-adoption peer-render pass and the
    // refreshed propsIndex is never re-read until the user navigates
    // away and back.
    let localProps: Record<string, unknown> = {}
    let localHas0000 = false
    try {
      const h = await cellDir.getFileHandle('0000', { create: false })
      const f = await h.getFile()
      localHas0000 = f.size > 0
      if (localHas0000) {
        try { localProps = JSON.parse(await f.text()) } catch { localProps = {} }
      }
    } catch { /* no local 0000 yet */ }

    const parentSegments = lineage?.explorerSegments?.() ?? []
    const cacheKey = await cellLocationSig(parentSegments, label)

    let seededAnything = false

    if (!localHas0000 && peerEntry.propsSig) {
      const store = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
        STORE_KEY,
      ) as StoreLike | undefined
      try {
        const blob = await store?.getResource?.(peerEntry.propsSig) ?? null
        if (blob && blob.size > 0) {
          const fileHandle = await cellDir.getFileHandle('0000', { create: true })
          const writable = await fileHandle.createWritable()
          try { await writable.write(blob) } finally { await writable.close() }
          // Tell label-keyed caches (IndexNurse etc.) the 0000 just
          // changed so they re-read instead of serving stale state.
          EffectBus.emit('cell:0000-changed', { cacheKey, keys: ['index', 'imageSig', 'small', 'flat'] })
          seededAnything = true
          // Refresh local view so the index-merge step below sees the
          // peer's freshly-written 0000 content.
          try { localProps = await readCellProperties(cellDir) } catch { /* keep prior */ }
          localHas0000 = true
        }
      } catch (err) {
        console.warn('[swarm-adopt] failed to seed peer 0000 for', label, err)
      }
    }

    // Index merge — independent from the verbatim-0000 path above. Runs
    // when the participant's 0000 exists but carries no `index` field
    // (e.g. participant has a notes-only tile at this label, or 0000 was
    // lazy-patched without index). Two sources for the host's index, in
    // priority:
    //   (a) peerEntry.index — published in the layer event explicitly
    //   (b) peer's 0000.index — read from the streamed propsSig blob
    // Either way, prefer participant's existing index if any. The
    // verbatim copy above already covered the no-local-0000 case, so we
    // only re-do work when the participant has 0000 but no index field.
    const hasLocalIndex = typeof localProps['index'] === 'number' && Number.isFinite(localProps['index'])
    if (localHas0000 && !hasLocalIndex) {
      let hostIndex: number | null = null
      if (typeof peerEntry.index === 'number' && Number.isFinite(peerEntry.index) && peerEntry.index >= 0) {
        hostIndex = peerEntry.index
      } else if (peerEntry.propsSig) {
        const store = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
          STORE_KEY,
        ) as StoreLike | undefined
        try {
          const blob = await store?.getResource?.(peerEntry.propsSig) ?? null
          if (blob && blob.size > 0) {
            const peerProps = JSON.parse(await blob.text())
            const idx = Number(peerProps?.index)
            if (Number.isFinite(idx) && idx >= 0) hostIndex = idx
          }
        } catch { /* leave hostIndex null */ }
      }
      if (hostIndex !== null) {
        try {
          await writeCellProperties(cellDir, { index: hostIndex }, cacheKey)
          seededAnything = true
        } catch (err) {
          console.warn('[swarm-adopt] failed to merge host index for', label, err)
        }
      }
    }

    // Image stream — the peer's `hc:tile-props-index[label]` value
    // (their substrate-cache propsSig) carries the visual references
    // even when their canonical 0000 doesn't. Write it into the local
    // index so the renderer's read path finds the same image blob the
    // publisher had. The blob itself was already pulled to OPFS by
    // the resource stream during the layer event. Only writes when
    // the local index has no entry — same don't-clobber-user-state
    // policy as the 0000 copy above.
    if (peerEntry.imageSig) {
      try {
        const indexKey = 'hc:tile-props-index'
        const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
        if (!index[label]) {
          index[label] = peerEntry.imageSig
          localStorage.setItem(indexKey, JSON.stringify(index))
          seededAnything = true
        }
      } catch (err) {
        console.warn('[swarm-adopt] failed to seed peer imageSig for', label, err)
      }
    }

    // Fallback for the pre-streaming publisher: layer event has an
    // explicit index but no propsSig (so the verbatim-0000 copy above
    // didn't fire). Write just the index. Skipped when local already
    // has 0000 — the merge step above handled that path.
    if (!peerEntry.propsSig && typeof peerEntry.index === 'number' && peerEntry.index >= 0 && !localHas0000) {
      try {
        await writeCellProperties(cellDir, { index: peerEntry.index }, cacheKey)
        seededAnything = true
      } catch (err) {
        console.warn('[swarm-adopt] failed to seed peer index for', label, err)
      }
    }

    // cell:added → show-cell re-renders, activity log surfaces it,
    // AutoFitFirstAddDrone fits if this is the first cell at this
    // lineage. Emitting for an already-existing tile is harmless
    // idempotent — show-cell's incremental path no-ops if the slot
    // already has the name.
    EffectBus.emit('cell:added', { cell: label })

    // tile:saved → show-cell drops every per-label cache for this label
    // (cellImageCache, cellBorderColorCache, cellTagsCache, cellLinkCache,
    // cellSubstrateCache, cellHideTextCache) and triggers a fresh resolve.
    // Critical for the "image appears without refresh" requirement: the
    // pre-adoption peer render may have cached `null` for cellImageCache
    // (image bytes hadn't arrived yet, or were stored under a sig the
    // peer-render path didn't see). Clearing those caches forces the
    // next render to re-read propsIndex (which now points at the peer's
    // image blob), pull bytes from OPFS, and bind the atlas UV.
    if (seededAnything) {
      EffectBus.emit('tile:saved', { cell: label })
    }

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
