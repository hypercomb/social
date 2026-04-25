// diamondcoreprocessor.com/history/layer-committer.drone.ts
//
// Single commit site for history. Listens to one event — `synchronize` —
// assembles a full layer snapshot of the current location, and commits it
// via HistoryService.commitLayer(). Deduplication is automatic: if the
// assembled layer signature matches the current head, commitLayer returns
// null and nothing is written.
//
// Drones never name an op. They mutate state, the processor dispatches
// `synchronize`, and a new numbered layer falls out. Ops are a *view*
// derived by diffLayers, never storage.
import { EffectBus, SignatureService } from '@hypercomb/core'
import type { HistoryService, LayerContent } from './history.service.js'
import type { HistoryCursorService } from './history-cursor.service.js'
import type { OrderProjection } from './order-projection.js'

type Lineage = {
  domain?: () => string
  explorerLabel?: () => string
  // Async in the live lineage; resolves to the explorer's directory
  // handle (or null when not available yet).
  explorerDir?: () => Promise<FileSystemDirectoryHandle | null> | FileSystemDirectoryHandle | null | undefined
  explorerSegments?: () => string[]
}

type LayoutSnapshot = {
  orientation: 'flat-top' | 'point-top'
  pivot: boolean
  accent: string
  gapPx: number
  textOnly: boolean
}

/**
 * Strict FIFO commit chain. One event = one commit slot, no
 * coalescing. Every `request()` appends to the tail of a Promise
 * chain that runs `#run()` in order. Layer count grows by exactly
 * one per event — that's the contract.
 *
 * Why no coalescing: the user's mental model is "every action is
 * one undo step." A multi-select delete of 5 cells emits 5
 * `cell:removed` events; each must produce its own marker so the
 * user can undo cell-by-cell. Coalescing collapses the burst into
 * one marker that undoes all 5 at once — wrong granularity.
 *
 * Serialisation is still required because each commit allocates a
 * numeric marker name (max+1 of existing markers). Two parallel
 * commits would race on that allocation.
 */
class CommitMachine {
  #chain: Promise<void> = Promise.resolve()
  readonly #run: () => Promise<void>

  constructor(run: () => Promise<void>) {
    this.#run = run
  }

  request(): void {
    this.#chain = this.#chain.then(() => this.#run()).catch(() => { /* failures don't break the chain */ })
  }
}

export class LayerCommitter {

  // Layout state is scattered across EffectBus effects. We subscribe at
  // construction and keep the latest value locally. Late subscribers get
  // the last-emitted value automatically (EffectBus replay).
  #layout: LayoutSnapshot = {
    orientation: 'point-top',
    pivot: false,
    accent: '',
    gapPx: 0,
    textOnly: false,
  }

  // Single serialised commit machine for this committer. Every event
  // source — per-event lifecycle, microtask-batched layout changes,
  // synchronize — calls machine.request(). The machine collapses
  // same-turn requests and serialises cross-turn ones; commitLayer
  // dedup then absorbs any redundant identical content. Together
  // they guarantee one commit per distinct state change, no more.
  //
  // Leaf + ancestors still commit as one atomic #commit() call
  // inside the machine's #run — each ancestor is a merkle-chain
  // update cascading up from the leaf.
  readonly #machine = new CommitMachine(() => this.#commit())

  constructor() {
    // layout:mode subscription removed — dense/spiral mode is phased
    // out. The layer's layout signature no longer carries a mode field;
    // the renderer operates only in pinned mode.
    EffectBus.on<{ flat: boolean }>('render:set-orientation', p => {
      if (p) { this.#layout = { ...this.#layout, orientation: p.flat ? 'flat-top' : 'point-top' }; this.#schedule() }
    })
    EffectBus.on<{ pivot: boolean }>('render:set-pivot', p => {
      if (p != null) { this.#layout = { ...this.#layout, pivot: !!p.pivot }; this.#schedule() }
    })
    EffectBus.on<{ name: string }>('overlay:neon-color', p => {
      if (p?.name) { this.#layout = { ...this.#layout, accent: p.name }; this.#schedule() }
    })
    EffectBus.on<{ gapPx: number }>('render:set-gap', p => {
      if (p?.gapPx != null) { this.#layout = { ...this.#layout, gapPx: p.gapPx }; this.#schedule() }
    })
    EffectBus.on<{ textOnly: boolean }>('render:set-text-only', p => {
      if (p?.textOnly != null) { this.#layout = { ...this.#layout, textOnly: !!p.textOnly }; this.#schedule() }
    })

    // Layers are minted ONLY when a real thing happens — a cell is
    // added/removed/edited/hidden/unhidden, or a tag/saved event.
    // No `synchronize` subscription, no `render:cell-count` baseline,
    // no batched "wait until things settle" commits. One event = one
    // commit attempt. The bag's per-event timeline IS the user's
    // actions; nothing speculative is allowed in.
    EffectBus.on('cell:added',   () => this.#queueCommit())
    EffectBus.on('cell:removed', () => this.#queueCommit())
    EffectBus.on('tile:saved',   () => this.#queueCommit())
    EffectBus.on('tags:changed', () => this.#queueCommit())
    EffectBus.on('tile:hidden',  () => this.#queueCommit())
    EffectBus.on('tile:unhidden',() => this.#queueCommit())
  }

  // All commit requests — batched or per-event — route through the
  // single CommitMachine. See the class above for the state transitions.
  #schedule(): void { this.#machine.request() }
  #queueCommit(): void { this.#machine.request() }

  async #commit(): Promise<void> {
    // Never commit while cursor is rewound — the assembled state reflects
    // the past view, not a new user intent.
    const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursor?.state?.rewound) {
      console.log('[commit] skip: cursor rewound')
      return
    }

    const lineage = get<Lineage>('@hypercomb.social/Lineage')
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !history) {
      console.log('[commit] skip: missing lineage or history', { lineage: !!lineage, history: !!history })
      return
    }

    const segments = [...(lineage.explorerSegments?.() ?? [])]

    // Leaf commit.
    const leafLocSig = await history.sign(lineage)
    const leafLayer = await this.#assembleLayer(lineage, leafLocSig)
    const leafSig = await history.commitLayer(leafLocSig, leafLayer)
    console.log('[commit] leaf', {
      segments,
      cells: leafLayer.cells.length,
      sig: leafSig?.slice(0, 8) ?? '(none)',
    })

    // Ancestor commits — each ancestor's bag gets its own entry per
    // user-intent mutation. Content-dedup is disabled in commitLayer,
    // so even identical ancestor content across mutations yields new
    // time-stamped entries (with a shared resource blob under the hood).
    // The ancestor layer is assembled from the ancestor's own lineage;
    // for unvisited ancestors this is mostly-empty but still legitimate.
    for (let i = segments.length - 1; i >= 0; i--) {
      const ancestorSegments = segments.slice(0, i)
      const ancestorLineage: Lineage = {
        domain: lineage.domain,
        explorerDir: lineage.explorerDir,
        explorerSegments: () => ancestorSegments,
      }
      const ancestorLocSig = await history.sign(ancestorLineage)
      const ancestorLayer = await this.#assembleLayer(ancestorLineage, ancestorLocSig)
      const ancestorSig = await history.commitLayer(ancestorLocSig, ancestorLayer)
      console.log('[commit] ancestor', {
        segments: ancestorSegments,
        cells: ancestorLayer.cells.length,
        sig: ancestorSig?.slice(0, 8) ?? '(none)',
      })
    }

    // Notify the cursor so the slider / activity log / ShowCell see the new head
    const cursorAfter = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursorAfter) await cursorAfter.onNewLayer()
  }

  /**
   * Build the slim layer snapshot — `cells` (ordered) + `hidden` (set).
   *
   * Source of truth = what is actually on screen. Cells = the OPFS cell
   * directory listing (the same set the renderer at head walks). Order
   * comes from OrderProjection but is INTERSECTED with the directory
   * listing so the layer can never claim cells that don't exist on disk.
   * Any directory cell that the projection doesn't have an order for is
   * appended at the end.
   */
  async #assembleLayer(lineage: Lineage, locationSig: string): Promise<LayerContent> {
    // explorerDir is async in the live lineage — await before iterating.
    // Calling it sync returned a Promise that we then iterated as if it
    // were a directory, producing zero cells and a phantom-empty layer
    // even when the disk had cells. The committer's "what's on disk"
    // reading was silently broken.
    const explorerDir = await (lineage.explorerDir?.() as Promise<FileSystemDirectoryHandle | null> | FileSystemDirectoryHandle | undefined)
    const onDisk = new Set<string>()
    if (explorerDir) {
      for await (const [name, handle] of (explorerDir as any).entries()) {
        if (handle.kind === 'directory') onDisk.add(name)
      }
    }

    const order = get<OrderProjection>('@diamondcoreprocessor.com/OrderProjection')
    const ordered = order?.peek(locationSig) ?? await order?.hydrate(locationSig) ?? []

    // Intersect order with on-disk: drop ordered entries that have no
    // directory (stale projection), and append any on-disk cells the
    // projection didn't know about.
    const cells: string[] = []
    const seen = new Set<string>()
    for (const cell of ordered) {
      if (onDisk.has(cell) && !seen.has(cell)) { cells.push(cell); seen.add(cell) }
    }
    for (const cell of onDisk) {
      if (!seen.has(cell)) { cells.push(cell); seen.add(cell) }
    }

    const hidden = this.#readHidden(lineage)
    return { cells, hidden }
  }

  /**
   * Read the set of hidden cells for the active location directly from
   * localStorage. ShowCellDrone writes this key on `tile:hidden` /
   * `tile:unhidden`, so it is always up-to-date when `synchronize` fires.
   */
  #readHidden(lineage: Lineage): string[] {
    const locationKey = String(lineage.explorerLabel?.() ?? '/')
    try {
      const raw = localStorage.getItem(`hc:hidden-tiles:${locationKey}`)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }

  // Layout signing / instruction-sig reading were both layer-driven —
  // the layer captured a `layoutSig` and `instructionsSig`. The slim
  // layer doesn't carry either; layout and instructions are bee-owned
  // primitives, and any per-position playback (e.g., undo of a layout
  // gap change) is the responsibility of the layout/instruction bee
  // tracking its own per-state primitive. Removed from the committer.
}

const _layerCommitter = new LayerCommitter()
window.ioc.register('@diamondcoreprocessor.com/LayerCommitter', _layerCommitter)
