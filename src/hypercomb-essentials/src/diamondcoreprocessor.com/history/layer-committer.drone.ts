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
  explorerDir?: () => FileSystemDirectoryHandle | undefined
  explorerSegments?: () => string[]
}

type LayoutSnapshot = {
  version: 2
  orientation: 'flat-top' | 'point-top'
  pivot: boolean
  accent: string
  gapPx: number
  textOnly: boolean
}

export class LayerCommitter {

  #scheduled = false

  // Layout state is scattered across EffectBus effects. We subscribe at
  // construction and keep the latest value locally. Late subscribers get
  // the last-emitted value automatically (EffectBus replay).
  #layout: LayoutSnapshot = {
    version: 2,
    orientation: 'point-top',
    pivot: false,
    accent: '',
    gapPx: 0,
    textOnly: false,
  }

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

    window.addEventListener('synchronize', () => this.#schedule())

    // Capture a baseline layer on first render so there's always a
    // "before" snapshot to undo to. render:cell-count fires after
    // ShowCellDrone finishes painting — cells are fully resolved.
    // commitLayer dedupes identical states, so this is cheap for
    // subsequent renders.
    EffectBus.on('render:cell-count', () => this.#schedule())
  }

  #schedule(): void {
    if (this.#scheduled) return
    this.#scheduled = true
    queueMicrotask(async () => {
      this.#scheduled = false
      try {
        await this.#commit()
      } catch {
        // commit is best-effort; never let a snapshot failure break the UI
      }
    })
  }

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
   * Build the full layer snapshot from live state sources.
   */
  async #assembleLayer(lineage: Lineage, locationSig: string): Promise<LayerContent> {
    const order = get<OrderProjection>('@diamondcoreprocessor.com/OrderProjection')
    // peek is synchronous; if the projection hasn't hydrated yet for this
    // location, hydrate now so the first layer captures the real cell list
    // instead of an empty array.
    const cells = order?.peek(locationSig) ?? await order?.hydrate(locationSig) ?? []

    const { contentByCell, tagsByCell } = await this.#readCellState(lineage, cells)

    const bees = this.#readBees()
    const hidden = this.#readHidden(lineage)
    const notesByCell = this.#readNotesIndex(cells)
    const layoutSig = await this.#signLayout()
    const instructionsSig = this.#readInstructionsSig()

    // TODO(stage-3): wire to DependencyLoader for loaded deps sigs
    const dependencies: string[] = []

    return {
      version: 2,
      cells,
      hidden,
      contentByCell,
      tagsByCell,
      notesByCell,
      bees,
      dependencies,
      layoutSig,
      instructionsSig,
    }
  }

  /**
   * Read the per-cell `noteSetSig` index that NotesService maintains.
   * Filtered to the cells present in this snapshot so dangling pointers
   * for removed cells are not folded into the layer.
   */
  #readNotesIndex(cells: string[]): Record<string, string> {
    const notes = get<{ readIndex(): Record<string, string> }>('@diamondcoreprocessor.com/NotesService')
    if (!notes?.readIndex) return {}
    const all = notes.readIndex()
    const present = new Set(cells)
    const out: Record<string, string> = {}
    for (const cell of Object.keys(all)) {
      if (!present.has(cell)) continue
      const sig = all[cell]
      if (sig) out[cell] = sig
    }
    return out
  }

  async #readCellState(
    lineage: Lineage,
    cells: string[],
  ): Promise<{ contentByCell: Record<string, string>; tagsByCell: Record<string, string[]> }> {
    const contentByCell: Record<string, string> = {}
    const tagsByCell: Record<string, string[]> = {}

    let tilePropsIndex: Record<string, string> = {}
    try {
      tilePropsIndex = JSON.parse(localStorage.getItem('hc:tile-props-index') ?? '{}')
    } catch {
      tilePropsIndex = {}
    }

    const explorerDir = lineage.explorerDir?.()
    if (!explorerDir) return { contentByCell, tagsByCell }

    // TODO(stage-3): replace per-cell OPFS reads with an in-memory cache
    // invalidated on tile:saved / tags:changed. For now we pay the read
    // cost once per user-intent boundary, which is rare.
    for (const cell of cells) {
      const contentSig = tilePropsIndex[cell]
      if (contentSig) contentByCell[cell] = contentSig

      try {
        const cellDir = await explorerDir.getDirectoryHandle(cell, { create: false })
        const propsHandle = await cellDir.getFileHandle('0000')
        const file = await propsHandle.getFile()
        const props = JSON.parse(await file.text())
        if (Array.isArray(props.tags) && props.tags.length > 0) {
          tagsByCell[cell] = props.tags.map((t: unknown) => String(t))
        }
      } catch {
        // cell has no props file yet — that's fine, just omit
      }
    }

    return { contentByCell, tagsByCell }
  }

  /**
   * Drone set for the layer. Reading from `window.ioc.list()` is not
   * stable during startup — drones self-register asynchronously, so
   * every early commit sees a larger set than the one before. The diff
   * then shows up as a cascade of "bees" entries on every refresh,
   * which is pure noise. Until a formal drone registry exists (the
   * stage-3 TODO), this returns an empty list so layer identity is
   * driven by actual user-facing state.
   */
  #readBees(): string[] {
    return []
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

  /**
   * Sign the current layout snapshot and store it as a resource. The
   * returned signature is referenced by the layer; identical layouts
   * dedupe to the same resource.
   */
  async #signLayout(): Promise<string> {
    // canonical key order — stable signatures regardless of field mutation order
    const canonical = {
      version: 2 as const,
      orientation: this.#layout.orientation,
      pivot: this.#layout.pivot,
      accent: this.#layout.accent,
      gapPx: this.#layout.gapPx,
      textOnly: this.#layout.textOnly,
    }
    const json = JSON.stringify(canonical)
    const bytes = new TextEncoder().encode(json).buffer as ArrayBuffer
    const sig = await SignatureService.sign(bytes)

    const store = get<{ putResource: (blob: Blob) => Promise<void> }>('@hypercomb.social/Store')
    if (store) {
      await store.putResource(new Blob([json], { type: 'application/json' }))
    }
    return sig
  }

  /**
   * Read the current instruction settings signature from the
   * InstructionDrone. Returns "" when no instructions are configured for
   * this location.
   */
  #readInstructionsSig(): string {
    const drone = get<{ state?: { settingsSig?: string } }>('@diamondcoreprocessor.com/InstructionDrone')
    return drone?.state?.settingsSig ?? ''
  }
}

const _layerCommitter = new LayerCommitter()
window.ioc.register('@diamondcoreprocessor.com/LayerCommitter', _layerCommitter)
