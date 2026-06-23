// diamondcoreprocessor.com/input/move/move.drone.ts
import { Drone, EffectBus, hypercomb } from '@hypercomb/core'
import type { HostReadyPayload } from '../presentation/tiles/pixi-host.worker.js'
import type { Axial } from '../navigation/hex-detector.js'
import type { LayerTransferService } from './layer-transfer.service.js'
import type { OrderProjection } from '../history/order-projection.js'
import { cellLocationSig, writeTilePropertiesAt } from '../editor/tile-properties.js'
import { childNamesOf, childLayerOf, resolveLayerAt, flattenLayerTree } from '../history/layer-placement.js'
import type { PlacementHistory, PlacementLayer } from '../history/layer-placement.js'

// Committer/store shapes for the Ctrl-drag COPY path — it re-homes a dragged
// cell's whole subtree under a fresh sibling name using the SAME signature-
// preserving primitive paste/adopt use (flattenLayerTree + importTree), so the
// copy is byte-for-byte exact and dedup'd. History/layer use the placement types.
interface CopyTreeUpdate { segments: readonly string[]; layer: { name?: string } & { [slot: string]: unknown } }
interface CopyCommitterLike {
  importTree(updates: CopyTreeUpdate[], nameSlots?: ReadonlySet<string>): Promise<void>
}
interface CopyStoreLike {
  getResource?: (sig: string) => Promise<Blob | null>
  putResource?: (blob: Blob) => Promise<string>
}

type CellCountPayload = { count: number; labels: string[]; coords?: Axial[]; branchLabels?: string[] }
type MoveRefs = {
  canvas: HTMLCanvasElement
  container: any
  renderer: any
  getMeshOffset: () => { x: number; y: number }
}

export type MoveDroneApi = {
  readonly moveActive: boolean
  beginMove: (anchorAxial: Axial, source: string) => boolean
  updateMove: (hoverAxial: Axial, source: string) => void
  commitMoveAt: (finalAxial: Axial, source: string) => Promise<void>
  cancelMove: (source: string) => void
  setDropIntoActive: (active: boolean) => void
  commitDropInto: (axial: Axial, source: string) => Promise<void>
  readonly dropIntoActive: boolean
  setCopyMode: (active: boolean) => void
  commitCopyAt: (axial: Axial, source: string) => Promise<void>
  readonly copyModeActive: boolean
  labelAtAxial: (axial: Axial) => string | null
}

function axialKey(q: number, r: number): string {
  return `${q},${r}`
}

export class MoveDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'movement'
  override description =
    'Coordinates multi-tile drag-and-drop — tracks move state, computes reorder, and commits placement.'
  public override effects = ['render'] as const

  #canvas: HTMLCanvasElement | null = null
  #container: any = null
  #renderer: any = null
  #meshOffset = { x: 0, y: 0 }

  #moveActive = false
  #activeSource: string | null = null
  #anchorAxial: Axial | null = null
  #movedGroup = new Map<string, Axial>()       // label → original axial
  #occupancy = new Map<string, string>()        // axialKey → label
  #labelToKey = new Map<string, string>()       // label → axialKey (reverse map)
  #keyToIndex = new Map<string, number>()       // axialKey → index (for reordering)

  // Live snapshot — always tracks the latest render:cell-count so a fresh
  // drag (after cut/paste, redo, etc.) never starts from stale state.
  #cellLabels: string[] = []
  #cellCoords: Axial[] = []
  #cellCount = 0

  // Drag snapshot — captured at beginMove from the live arrays above so
  // any render:cell-count that fires mid-drag does not shift the geometry
  // computation under the user's cursor. Cleared on #reset.
  #dragLabels: string[] = []
  #dragCoords: Axial[] = []

  // ── drop-into modifier state (Ctrl held during drag) ─────
  #dropIntoActive = false
  #dropIntoLabel: string | null = null
  #lastHoverAxial: Axial | null = null

  // ── copy-drag state (Ctrl held when the drag STARTS) ─────
  // Distinct from drop-into (Ctrl pressed mid-drag): copy duplicates the
  // dragged tiles as siblings at the current level on drop. No window — the
  // release IS the act.
  #copyMode = false

  get moveActive(): boolean { return this.#moveActive }
  get dropIntoActive(): boolean { return this.#dropIntoActive }
  get copyModeActive(): boolean { return this.#copyMode }

  labelAtAxial = (axial: Axial): string | null => {
    // During a drag, prefer the snapshot so hover detection stays
    // consistent with the geometry that beginMove captured.
    const labels = this.#dragLabels.length > 0 ? this.#dragLabels : this.#cellLabels
    const coords = this.#dragLabels.length > 0 ? this.#dragCoords : this.#cellCoords
    for (let i = 0; i < labels.length; i++) {
      const coord = coords[i]
      if (coord && coord.q === axial.q && coord.r === axial.r) {
        return labels[i] ?? null
      }
    }
    return null
  }

  protected override deps = {
    desktopMove: '@diamondcoreprocessor.com/DesktopMoveInput',
    touchMove: '@diamondcoreprocessor.com/TouchMoveInput',
    detector: '@diamondcoreprocessor.com/HexDetector',
    axial: '@diamondcoreprocessor.com/AxialService',
    lineage: '@hypercomb.social/Lineage',
    selection: '@diamondcoreprocessor.com/SelectionService',
    transfer: '@diamondcoreprocessor.com/LayerTransferService',
  }

  protected override listens = ['render:host-ready', 'render:cell-count', 'render:mesh-offset', 'controls:action']
  protected override emits = ['move:preview', 'move:committed', 'move:mode', 'cell:reorder', 'move:drop-into', 'move:drop-into-commit', 'move:copy-drag', 'cell:added']

  #effectsRegistered = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#canvas = payload.canvas
      this.#container = payload.container
      this.#renderer = payload.renderer

      const refs: MoveRefs = {
        canvas: this.#canvas!,
        container: this.#container,
        renderer: this.#renderer,
        getMeshOffset: () => this.#meshOffset,
      }

      const desktopMove = this.resolve<any>('desktopMove')
      desktopMove?.attach(this as MoveDroneApi, refs)

      const touchMove = this.resolve<any>('touchMove')
      touchMove?.attach(this as MoveDroneApi, refs)
    })

    this.onEffect<CellCountPayload>('render:cell-count', (payload) => {
      // ALWAYS update the live snapshot. Drag stability is provided by
      // #dragLabels / #dragCoords captured at beginMove. Freezing this
      // path was the cut+paste snap-back bug: any commit that threw
      // between #begin and #reset left #activeSource stuck and the
      // freeze became permanent — subsequent drags computed placements
      // against stale coords and the moved cell appeared to bounce
      // back to its starting slot.
      this.#cellCount = payload.count
      this.#cellLabels = payload.labels
      this.#cellCoords = payload.coords ?? []
    })

    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (offset) => {
      this.#meshOffset = offset
    })

    // controls:action is a command, not state — skip last-value replay
    let ready = false
    this.onEffect<{ action: string }>('controls:action', (payload) => {
      if (!ready) return
      if (payload.action === 'move') this.#toggleMode()
    })
    ready = true
  }

  public stop = async (): Promise<void> => {
    const desktopMove = this.resolve<any>('desktopMove')
    desktopMove?.detach()
    const touchMove = this.resolve<any>('touchMove')
    touchMove?.detach()
  }

  // ── move mode toggle ──────────────────────────────────

  #toggleMode(): void {
    this.#moveActive = !this.#moveActive
    if (!this.#moveActive && this.#activeSource) {
      // exiting move mode while dragging — cancel
      this.emitEffect('move:preview', null)
      if (this.#dropIntoLabel !== null) {
        this.#dropIntoLabel = null
        this.emitEffect('move:drop-into', null)
      }
      if (this.#copyMode) this.emitEffect('move:copy-drag', null)
      this.#dropIntoActive = false
      this.#copyMode = false
      this.#lastHoverAxial = null
      this.#reset(this.#activeSource)
    }
    this.emitEffect('move:mode', { active: this.#moveActive })
  }

  // ── exclusivity ──────────────────────────────────────────

  #begin = (source: string): boolean => {
    if (this.#activeSource && this.#activeSource !== source) return false
    this.#activeSource = source
    return true
  }

  #end = (source: string): void => {
    if (this.#activeSource === source) this.#activeSource = null
  }

  // ── public API (called by input handlers) ────────────────

  beginMove = (anchorAxial: Axial, source: string): boolean => {
    // Auto-heal: if a previous drag left state behind without resetting
    // (e.g., commit threw, browser swallowed pointerup, dialog stole
    // focus mid-drag), force-clear before starting fresh. The marker
    // is "activeSource set but no anchor / movedGroup" — a real drag
    // never sits in that state.
    if (this.#activeSource && (!this.#anchorAxial || this.#movedGroup.size === 0)) {
      this.#activeSource = null
      this.#anchorAxial = null
      this.#movedGroup.clear()
      this.#occupancy.clear()
      this.#labelToKey.clear()
      this.#keyToIndex.clear()
      this.#dragLabels = []
      this.#dragCoords = []
    }

    if (!this.#begin(source)) return false

    const anchorKey = axialKey(anchorAxial.q, anchorAxial.r)

    // Snapshot the live arrays so a render:cell-count emitted mid-drag
    // (image loads, tag changes, etc.) cannot shift the geometry the
    // user is dragging against.
    this.#dragLabels = [...this.#cellLabels]
    this.#dragCoords = this.#cellCoords.map(c => ({ q: c.q, r: c.r }))

    // build occupancy snapshot from current cell labels
    const axialSvc = this.resolve<any>('axial')
    if (!axialSvc?.items) {
      this.#dragLabels = []
      this.#dragCoords = []
      this.#end(source)
      return false
    }

    this.#occupancy.clear()
    this.#labelToKey.clear()
    this.#keyToIndex.clear()

    // full reverse map: every axial position → index (enables landing anywhere)
    for (const [i, coord] of axialSvc.items) {
      const key = axialKey(coord.q, coord.r)
      this.#keyToIndex.set(key, i)
    }

    // occupancy + label reverse map for occupied cells only
    // use the just-captured drag snapshot (matches labels 1:1, works in pinned mode)
    for (let i = 0; i < this.#dragLabels.length; i++) {
      const label = this.#dragLabels[i]
      if (!label) continue
      const coord = this.#dragCoords[i] as Axial | undefined
      if (!coord) continue
      const key = axialKey(coord.q, coord.r)
      this.#occupancy.set(key, label)
      this.#labelToKey.set(label, key)
    }

    // anchor must be on an occupied tile
    const anchorLabel = this.#occupancy.get(anchorKey)
    if (!anchorLabel) {
      this.#dragLabels = []
      this.#dragCoords = []
      this.#end(source)
      return false
    }

    // determine moved group: selection (if anchor is selected) or just the anchor
    const selection = this.resolve<any>('selection')
    const selected = selection?.selected as ReadonlySet<string> | undefined

    this.#movedGroup.clear()
    if (selected && selected.size > 0) {
      if (!selected.has(anchorLabel)) {
        this.#dragLabels = []
        this.#dragCoords = []
        this.#end(source)
        return false
      }
      for (let i = 0; i < this.#dragLabels.length; i++) {
        const label = this.#dragLabels[i]
        if (!label) continue
        const coord = this.#dragCoords[i] as Axial | undefined
        if (!coord) continue
        if (selected.has(label)) {
          this.#movedGroup.set(label, { q: coord.q, r: coord.r })
        }
      }
    } else {
      this.#movedGroup.set(anchorLabel, { q: anchorAxial.q, r: anchorAxial.r })
    }

    console.log('[move] beginMove', { anchorLabel, selectedLabels: selected ? [...selected] : [], movedGroupSize: this.#movedGroup.size, movedLabels: [...this.#movedGroup.keys()], cellCount: this.#cellCount, cellLabelsLen: this.#dragLabels.length, cellLabels: [...this.#dragLabels] })

    this.#anchorAxial = anchorAxial
    return true
  }

  updateMove = (hoverAxial: Axial, source: string): void => {
    if (this.#activeSource !== source) return
    if (!this.#anchorAxial) return

    this.#lastHoverAxial = hoverAxial

    if (this.#copyMode) {
      // Copy preview: the exact dragged tiles float at the hovered slot,
      // ready to drop. Originals stay put (no swap), and it's a sibling
      // (no drop-into ring). The held cluster IS the "visualize the copy".
      this.emitEffect('move:preview', null)
      this.emitEffect('move:copy-drag', { dragged: [...this.#movedGroup.keys()], q: hoverAxial.q, r: hoverAxial.r })
      return
    }

    if (this.#dropIntoActive) {
      const label = this.labelAtAxial(hoverAxial)
      const valid = !!label && !this.#movedGroup.has(label)
      const next = valid ? label : null
      if (this.#dropIntoLabel !== next) {
        this.#dropIntoLabel = next
        // Carry the dragged labels so the preview can render shrunken
        // copies of THOSE tiles hovering over the target. The set is
        // constant for the drag, so the preview rebuilds its cluster only
        // when this list changes (never mid-drag) — repositioning is free.
        this.emitEffect('move:drop-into', next ? { label: next, dragged: [...this.#movedGroup.keys()] } : null)
      }
      // suppress swap preview while drop-into is the active intent
      this.emitEffect('move:preview', null)
      return
    }

    // Ctrl released — clear any lingering drop-into overlay
    if (this.#dropIntoLabel !== null) {
      this.#dropIntoLabel = null
      this.emitEffect('move:drop-into', null)
    }

    const diff: Axial = {
      q: hoverAxial.q - this.#anchorAxial.q,
      r: hoverAxial.r - this.#anchorAxial.r,
    }

    const placements = this.#computePlacements(diff)
    const reordered = this.#reorderNames(placements)
    const movedLabels = new Set(this.#movedGroup.keys())

    this.emitEffect('move:preview', { names: reordered, movedLabels })
  }

  setDropIntoActive = (active: boolean): void => {
    if (!this.#activeSource) return
    if (this.#dropIntoActive === active) return
    this.#dropIntoActive = active
    if (this.#lastHoverAxial && this.#anchorAxial) {
      // re-pump preview based on cached hover so the overlay flips immediately
      this.updateMove(this.#lastHoverAxial, this.#activeSource)
    } else if (!active) {
      if (this.#dropIntoLabel !== null) {
        this.#dropIntoLabel = null
        this.emitEffect('move:drop-into', null)
      }
    }
  }

  // Ctrl held when the drag STARTED → copy mode. Mirrors setDropIntoActive,
  // but the two intents are mutually exclusive: entering copy clears any
  // drop-into overlay, and the drop commits a sibling duplicate (not a re-home
  // into a child). Toggled by DesktopMoveInput at threshold-cross.
  setCopyMode = (active: boolean): void => {
    if (!this.#activeSource) return
    if (this.#copyMode === active) return
    this.#copyMode = active
    if (active) {
      // mutual exclusion with drop-into
      this.#dropIntoActive = false
      if (this.#dropIntoLabel !== null) {
        this.#dropIntoLabel = null
        this.emitEffect('move:drop-into', null)
      }
    } else {
      this.emitEffect('move:copy-drag', null)
    }
    if (this.#lastHoverAxial && this.#anchorAxial) {
      this.updateMove(this.#lastHoverAxial, this.#activeSource)
    }
  }

  commitMoveAt = async (finalAxial: Axial, source: string): Promise<void> => {
    if (this.#activeSource !== source) return
    if (!this.#anchorAxial) { this.#reset(source); return }

    let didCommit = false
    try {
      const diff: Axial = {
        q: finalAxial.q - this.#anchorAxial.q,
        r: finalAxial.r - this.#anchorAxial.r,
      }

      // skip if no movement
      if (diff.q !== 0 || diff.r !== 0) {
        const placements = this.#computePlacements(diff)
        await this.#commitPlacements(placements)
        didCommit = true
      }
    } catch (err) {
      // Swallow + log so #reset always runs in finally. Leaving
      // #activeSource set is the bug we just fixed; never regress it.
      console.warn('[move] commitMoveAt failed:', err)
      this.emitEffect('move:preview', null)
    } finally {
      this.#reset(source)
    }
    if (didCommit) void new hypercomb().act()
  }

  /**
   * Commit a Ctrl-modifier drop: move the selected tiles into the hovered
   * tile's children directory, navigate down into that level, and re-seed
   * the selection with the moved tiles. Indexes start at maxExistingIndex+1
   * so they cannot collide with the target's existing children.
   */
  commitDropInto = async (axial: Axial, source: string): Promise<void> => {
    if (this.#activeSource !== source) { return }
    if (!this.#anchorAxial) { this.#reset(source); return }

    try {
      await this.#commitDropIntoUnsafe(axial, source)
    } catch (err) {
      console.warn('[move] commitDropInto failed:', err)
      this.emitEffect('move:preview', null)
      this.emitEffect('move:drop-into', null)
      this.#dropIntoActive = false
      this.#dropIntoLabel = null
      this.#lastHoverAxial = null
      this.#reset(source)
    }
  }

  async #commitDropIntoUnsafe(axial: Axial, source: string): Promise<void> {
    const targetLabel = this.labelAtAxial(axial)
    if (!targetLabel || this.#movedGroup.has(targetLabel)) {
      this.cancelMove(source)
      return
    }

    const movedLabels = [...this.#movedGroup.keys()]
    if (movedLabels.length === 0) { this.cancelMove(source); return }

    // Fire the suck-into-tile animation BEFORE the awaited transfer +
    // navigation. The preview converts its held cluster into a shrink-and-
    // vanish at the target; the navigation that follows reveals the target's
    // level underneath, so the tiles read as dropping THROUGH onto the next
    // layer. Purely visual — the data move below is the authoritative change.
    this.emitEffect('move:drop-into-commit', { label: targetLabel, dragged: [...movedLabels] })

    const lineage = this.resolve<any>('lineage')
    const transfer = this.resolve<LayerTransferService>('transfer')

    if (!transfer) { this.cancelMove(source); return }

    // Drop-into-cell: moves each label out of the source layer's
    // children slot and into the target's children slot. Under the
    // layer-primitive doctrine the target layer doesn't need a
    // physical parent dir minted — the slot write at the target's
    // segments path is the authoritative state change.
    const sourceSegments: readonly string[] = lineage?.explorerSegments?.() ?? []
    const targetParentSegments = [...sourceSegments, targetLabel]

    // PENDING re-wire: nextIndex used to scan target children's
    // existing index props from OPFS; the legacy folder walk is
    // retired. The committer-side children-slot write is responsible
    // for ordering / index assignment from the layer state.
    let nextIndex = 0

    for (const label of movedLabels) {
      try {
        await transfer.transfer(null as unknown as FileSystemDirectoryHandle, null as unknown as FileSystemDirectoryHandle, label)
        const cacheKey = await cellLocationSig(targetParentSegments, label)
        await writeTilePropertiesAt(targetParentSegments, label, { index: nextIndex })
        void cacheKey
        nextIndex++
      } catch (err) {
        console.warn('[move] drop-into transfer failed for', label, err)
      }
    }

    // moved cells are gone from the SOURCE layer. Carry sourceSegments
    // explicitly: the transfer loop above is awaited multi-step work, and
    // a segment-less emit would intent-bind the removal to wherever the
    // user is when it fires — removing the cells from the WRONG layer if
    // a navigation landed mid-move.
    for (const label of movedLabels) {
      EffectBus.emit('cell:removed', { cell: label, segments: [...sourceSegments] })
    }

    // clear all overlays
    this.emitEffect('move:preview', null)
    this.emitEffect('move:drop-into', null)
    this.emitEffect('move:committed', { order: [] })

    // reset move state
    this.#dropIntoActive = false
    this.#dropIntoLabel = null
    this.#lastHoverAxial = null
    this.#reset(source)

    // re-seed selection at the next level — the labels exist in the
    // target's children dir now, so when the new layer renders they
    // will be drawn as already selected
    const selection = this.resolve<any>('selection')
    if (selection?.clear && selection?.add) {
      selection.clear()
      for (const label of movedLabels) selection.add(label)
    }

    // navigate into the target — its children now include the moved tiles
    lineage?.explorerEnter?.(targetLabel)

    void new hypercomb().act()
  }

  /**
   * Commit a Ctrl-drag COPY: duplicate the dragged tile(s) as siblings at the
   * CURRENT level, landing at the hovered spiral slot. Exact copy — content
   * sigs preserved via flattenLayerTree, only the cell name is fresh (no-rename:
   * a copy is a new immutable name over the same content). Originals are
   * untouched, the viewport does not move (no explorerEnter), and there is no
   * confirmation: letting go fired this. ONE importTree cascade = one marker
   * per affected ancestor.
   */
  commitCopyAt = async (finalAxial: Axial, source: string): Promise<void> => {
    if (this.#activeSource !== source) return
    if (!this.#anchorAxial) { this.#reset(source); return }

    let didCommit = false
    try {
      didCommit = await this.#commitCopyUnsafe(finalAxial)
    } catch (err) {
      console.warn('[move] commitCopyAt failed:', err)
      this.emitEffect('move:preview', null)
      this.emitEffect('move:copy-drag', null)
    } finally {
      this.#copyMode = false
      this.#lastHoverAxial = null
      this.#reset(source)
    }
    if (didCommit) void new hypercomb().act()
  }

  async #commitCopyUnsafe(finalAxial: Axial): Promise<boolean> {
    const anchor = this.#anchorAxial
    if (!anchor) return false
    const movedLabels = [...this.#movedGroup.keys()]
    if (movedLabels.length === 0) { this.emitEffect('move:copy-drag', null); return false }

    const history = window.ioc.get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const committer = window.ioc.get<CopyCommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    const lineage = this.resolve<any>('lineage')
    if (!history || !committer || !lineage) { this.emitEffect('move:copy-drag', null); return false }

    // Copy commits at the current parent; refused while the history cursor is
    // rewound (scrub-back is view-only). Feedback, then decline — never half-run.
    const cursor = window.ioc.get<{ state?: { rewound?: boolean } }>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursor?.state?.rewound) {
      EffectBus.emit('toast:show', {
        type: 'info',
        title: 'Viewing history',
        message: 'Can’t copy while scrubbed back — return to the latest (Restore) to edit.',
      })
      this.emitEffect('move:copy-drag', null)
      return false
    }

    const parentSegments: readonly string[] = lineage.explorerSegments?.() ?? []
    const parentLayer = await this.#resolveCurrentParent(history, lineage, parentSegments)
    const existing = await childNamesOf(history, parentLayer)
    const taken = new Set(existing)

    // Target grid slot per dragged label — the drag delta carries the group
    // to where the user dropped, preserving its internal layout.
    const diff: Axial = { q: finalAxial.q - anchor.q, r: finalAxial.r - anchor.r }
    const placements = this.#computePlacements(diff)

    const treeUpdates: CopyTreeUpdate[] = []
    const freshNames: string[] = []

    for (const label of movedLabels) {
      // Resolve the source subtree the authoritative way — through the current
      // parent's children slot (warm; the dragged tile is on screen). Fall back
      // to the cell's own bag for safety.
      const viaParent = await childLayerOf(history, parentLayer, label)
      let srcLayer = viaParent?.layer ?? null
      if (!srcLayer) {
        const ownSig = await history.sign({ domain: lineage.domain, explorerSegments: () => [...parentSegments, label] })
        srcLayer = await history.currentLayerAt(ownSig)
      }
      if (!srcLayer) { console.warn('[move] copy source missing for', label); continue }

      const fresh = this.#uniqueCopyName(label, taken)
      taken.add(fresh)

      const entryUpdates = await flattenLayerTree(history, srcLayer, [...parentSegments, fresh])

      // Land the copy at the hovered spiral slot — fold its `index` into the
      // SAME re-home cascade (a post-commit write races the cascade). Only the
      // top node is retargeted; the subtree keeps its own indexes.
      const target = placements.get(label)
      const gridIndex = target ? this.#keyToIndex.get(axialKey(target.q, target.r)) : undefined
      if (gridIndex !== undefined) {
        const topKey = [...parentSegments, fresh].join('/')
        const top = entryUpdates.find(u => u.segments.join('/') === topKey)
        if (top) {
          const sig = await this.#propsWithIndex(top.layer, gridIndex)
          if (sig) top.layer = { ...top.layer, properties: [sig] }
        }
      }
      treeUpdates.push(...entryUpdates)
      freshNames.push(fresh)
    }

    if (freshNames.length === 0) { this.emitEffect('move:copy-drag', null); return false }

    EffectBus.emit('fs:changed', { segments: [...parentSegments] })
    // Eager visual mount; viaUpdate tells the committer's per-event listener to
    // skip queueing — the importTree below IS the atomic commit.
    for (const fresh of freshNames) {
      EffectBus.emit('cell:added', { cell: fresh, segments: [...parentSegments], viaUpdate: true })
    }

    // ONE cascade: the parent carries the full new children list (existing +
    // copies by name); each subtree node carries its own children by name.
    const nextChildren = [...existing, ...freshNames]
    await committer.importTree([
      { segments: [...parentSegments], layer: { ...(parentLayer ?? {}), children: nextChildren } },
      ...treeUpdates,
    ])

    this.emitEffect('move:copy-drag', null)
    this.emitEffect('move:preview', null)
    this.emitEffect('move:committed', { order: [] })
    return true
  }

  /** A fresh, collision-free sibling name for a copy. "<label> copy", then
   *  "<label> copy 2", … against the parent's existing child names. The copy is
   *  a NEW immutable cell (no-rename) carrying the SAME content sigs. */
  #uniqueCopyName(base: string, taken: ReadonlySet<string>): string {
    const first = `${base} copy`
    if (!taken.has(first)) return first
    let n = 2
    while (taken.has(`${base} copy ${n}`)) n++
    return `${base} copy ${n}`
  }

  /** Resolve the current parent layer robustly — resolveLayerAt walks the parent
   *  chain; the cursor fallback covers a cold currentLayerAt on the location the
   *  user is viewing (which IS the copy target). Mirrors clipboard's resolution. */
  async #resolveCurrentParent(history: PlacementHistory, lineage: { domain?: unknown }, segs: readonly string[]): Promise<PlacementLayer | null> {
    const viaChain = await resolveLayerAt(history, lineage.domain, segs)
    if (viaChain) return viaChain
    const cursor = window.ioc.get<{ currentLayerSig?: string }>('@diamondcoreprocessor.com/HistoryCursorService')
    const sig = cursor?.currentLayerSig
    if (sig) return await history.getLayerBySig(sig)
    return null
  }

  /** Build a props resource = the source tile's properties with `index`
   *  overridden, content-addressed the same way writeTilePropertiesAt does
   *  (sorted keys → JSON). Mirrors ClipboardWorker.#propsWithIndex so the
   *  copy's spiral slot lands inside the re-home cascade. */
  async #propsWithIndex(layer: unknown, index: number): Promise<string | null> {
    const store = window.ioc.get<CopyStoreLike>('@hypercomb.social/Store')
    if (!store?.putResource) return null
    const slot = (layer as { properties?: readonly unknown[] } | null | undefined)?.properties
    const existingSig = Array.isArray(slot) && slot.length > 0 ? slot[0] : undefined
    let props: Record<string, unknown> = {}
    if (typeof existingSig === 'string' && store.getResource) {
      try {
        const blob = await store.getResource(existingSig)
        if (blob) { const parsed = JSON.parse(await blob.text()); if (parsed && typeof parsed === 'object') props = parsed }
      } catch { /* fresh props */ }
    }
    const merged: Record<string, unknown> = { ...props, index }
    const canonical: Record<string, unknown> = {}
    for (const k of Object.keys(merged).sort()) canonical[k] = merged[k]
    try {
      return await store.putResource(new Blob([JSON.stringify(canonical)], { type: 'application/json' }))
    } catch { return null }
  }

  cancelMove = (source: string): void => {
    if (this.#activeSource !== source) return
    this.emitEffect('move:preview', null)
    if (this.#dropIntoLabel !== null) {
      this.#dropIntoLabel = null
      this.emitEffect('move:drop-into', null)
    }
    if (this.#copyMode) this.emitEffect('move:copy-drag', null)
    this.#dropIntoActive = false
    this.#copyMode = false
    this.#lastHoverAxial = null
    this.#reset(source)
  }

  // ── reorder names by index ──────────────────────────────

  #reorderNames(placements: Map<string, Axial>): string[] {
    // build a sparse array indexed by grid position (not dense cell index)
    // so buildCellsFromAxial can use moveNames[gridIndex] directly.
    // Use the drag snapshot during a drag (#dragLabels populated) so a
    // mid-drag render:cell-count cannot mutate the geometry under us.
    const axialSvc = this.resolve<any>('axial')
    const gridSize = axialSvc?.count ?? 0
    const labels = this.#dragLabels.length > 0 ? this.#dragLabels : this.#cellLabels
    const coords = this.#dragLabels.length > 0 ? this.#dragCoords : this.#cellCoords
    const names: string[] = new Array(Math.max(gridSize, labels.length)).fill('')

    // place each label at its grid index using stored coords
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i]
      if (!label) continue
      const coord = coords[i]
      if (!coord) continue
      const gridIndex = this.#keyToIndex.get(axialKey(coord.q, coord.r))
      if (gridIndex !== undefined) names[gridIndex] = label
    }

    // find max target index so we can extend the array if needed
    let maxIdx = names.length - 1
    for (const [, axial] of placements) {
      const targetKey = axialKey(axial.q, axial.r)
      const targetIndex = this.#keyToIndex.get(targetKey)
      if (targetIndex !== undefined && targetIndex > maxIdx) maxIdx = targetIndex
    }
    while (names.length <= maxIdx) names.push('')

    // clear original positions of all placed labels first
    const placedLabels = new Set(placements.keys())
    for (let i = 0; i < names.length; i++) {
      if (placedLabels.has(names[i])) names[i] = ''
    }

    // write each placed label to its target grid index
    for (const [label, axial] of placements) {
      const targetKey = axialKey(axial.q, axial.r)
      const targetIndex = this.#keyToIndex.get(targetKey)
      if (targetIndex !== undefined) {
        names[targetIndex] = label
      }
    }

    return names
  }

  // ── swap algorithm (from legacy computePlacements) ───────

  #computePlacements(diff: Axial): Map<string, Axial> {
    const placements = new Map<string, Axial>()
    if (this.#movedGroup.size === 0) return placements

    // 1) move all tiles in the group by diff
    for (const [label, fromAxial] of this.#movedGroup) {
      placements.set(label, {
        q: fromAxial.q + diff.q,
        r: fromAxial.r + diff.r,
      })
    }

    // 2) build destination→source map for the group (dest key → source axial)
    const groupDestToSource = new Map<string, Axial>()
    for (const [label, fromAxial] of this.#movedGroup) {
      const toAxial = placements.get(label)!
      groupDestToSource.set(axialKey(toAxial.q, toAxial.r), fromAxial)
    }

    // 3) swap displaced occupants — follow chain when source is claimed
    for (const [label] of this.#movedGroup) {
      const toAxial = placements.get(label)!
      const toKey = axialKey(toAxial.q, toAxial.r)
      const occupant = this.#occupancy.get(toKey)
      if (!occupant) continue
      if (this.#movedGroup.has(occupant)) continue

      // follow chain: if this source is a group destination, trace to the
      // end of the chain to find a truly vacated position
      let target = this.#movedGroup.get(label)!
      let targetKey = axialKey(target.q, target.r)
      while (groupDestToSource.has(targetKey)) {
        target = groupDestToSource.get(targetKey)!
        targetKey = axialKey(target.q, target.r)
      }

      placements.set(occupant, { q: target.q, r: target.r })
    }

    return placements
  }

  // ── command-driven move API (for command line [...]/move) ──

  #commandActive = false
  get moveCommandActive(): boolean { return this.#commandActive }

  /**
   * Begin a command-driven move with explicit labels (no pointer).
   * First label is the anchor.
   */
  beginCommandMove = (labels: string[]): void => {
    if (labels.length === 0) return

    // Auto-heal stuck state (see beginMove for the full rationale).
    if (this.#activeSource && (!this.#anchorAxial || this.#movedGroup.size === 0)) {
      this.#activeSource = null
      this.#anchorAxial = null
      this.#movedGroup.clear()
      this.#occupancy.clear()
      this.#labelToKey.clear()
      this.#keyToIndex.clear()
      this.#dragLabels = []
      this.#dragCoords = []
    }
    if (this.#activeSource) return // another move is active

    this.#activeSource = 'command'
    this.#commandActive = true

    const axialSvc = this.resolve<any>('axial')
    if (!axialSvc?.items) { this.#end('command'); this.#commandActive = false; return }

    // Snapshot for the duration of the command move.
    this.#dragLabels = [...this.#cellLabels]
    this.#dragCoords = this.#cellCoords.map(c => ({ q: c.q, r: c.r }))

    this.#occupancy.clear()
    this.#labelToKey.clear()
    this.#keyToIndex.clear()

    // full reverse map
    for (const [i, coord] of axialSvc.items) {
      const key = axialKey(coord.q, coord.r)
      this.#keyToIndex.set(key, i)
    }

    // occupancy — use the just-captured snapshot (works in pinned mode)
    for (let i = 0; i < this.#dragLabels.length; i++) {
      const label = this.#dragLabels[i]
      if (!label) continue
      const coord = this.#dragCoords[i] as Axial | undefined
      if (!coord) continue
      const key = axialKey(coord.q, coord.r)
      this.#occupancy.set(key, label)
      this.#labelToKey.set(label, key)
    }

    // build moved group from labels
    this.#movedGroup.clear()
    const anchorLabel = labels[0]
    let anchorSet = false

    for (const label of labels) {
      const key = this.#labelToKey.get(label)
      if (!key) continue
      const parts = key.split(',')
      const q = parseInt(parts[0], 10)
      const r = parseInt(parts[1], 10)
      this.#movedGroup.set(label, { q, r })
      if (label === anchorLabel && !anchorSet) {
        this.#anchorAxial = { q, r }
        anchorSet = true
      }
    }

    if (!anchorSet) {
      this.#reset('command')
      this.#commandActive = false
    }
  }

  /**
   * Update preview for a target axial index (from command line input).
   */
  updateCommandMove = (targetIndex: number): void => {
    if (this.#activeSource !== 'command') return
    if (!this.#anchorAxial) return

    const axialSvc = this.resolve<any>('axial')
    const targetCoord = axialSvc?.items?.get(targetIndex)
    if (!targetCoord) return

    const diff: Axial = {
      q: targetCoord.q - this.#anchorAxial.q,
      r: targetCoord.r - this.#anchorAxial.r,
    }

    const placements = this.#computePlacements(diff)
    const reordered = this.#reorderNames(placements)
    const movedLabels = new Set(this.#movedGroup.keys())

    this.emitEffect('move:preview', { names: reordered, movedLabels })
  }

  /**
   * Commit the command move at a specific target index.
   */
  commitCommandMoveAt = async (targetIndex: number): Promise<void> => {
    if (this.#activeSource !== 'command') return
    if (!this.#anchorAxial) { this.#resetCommand(); return }

    let didCommit = false
    try {
      const axialSvc = this.resolve<any>('axial')
      const targetCoord = axialSvc?.items?.get(targetIndex)
      if (!targetCoord) return

      const diff: Axial = {
        q: targetCoord.q - this.#anchorAxial.q,
        r: targetCoord.r - this.#anchorAxial.r,
      }

      if (diff.q !== 0 || diff.r !== 0) {
        const placements = this.#computePlacements(diff)
        await this.#commitPlacements(placements)
        didCommit = true
      }
    } catch (err) {
      console.warn('[move] commitCommandMoveAt failed:', err)
      this.emitEffect('move:preview', null)
    } finally {
      this.#resetCommand()
    }
    if (didCommit) void new hypercomb().act()
  }

  /**
   * Commit the command move to a specific label's position.
   */
  commitCommandMoveToLabel = async (targetLabel: string): Promise<void> => {
    const key = this.#labelToKey.get(targetLabel)
    if (!key) { this.#resetCommand(); return }
    const idx = this.#keyToIndex.get(key)
    if (idx === undefined) { this.#resetCommand(); return }
    await this.commitCommandMoveAt(idx)
  }

  /**
   * Cancel command move — clear preview and reset.
   */
  cancelCommandMove = (): void => {
    if (this.#activeSource !== 'command') return
    this.emitEffect('move:preview', null)
    this.#resetCommand()
  }

  #resetCommand(): void {
    this.#reset('command')
    this.#commandActive = false
  }

  // ── shared commit logic ────────────────────────────────
  //
  // The renderer reads each cell's `index` property to place it via
  // `axial.items.get(index)`. So the only authoritative write is the
  // per-cell index in #persistPinnedIndices below. The OrderProjection
  // call records a snapshot of the post-state for history/diff use; the
  // cell:reorder emit is a cache-invalidation signal only — show-cell's
  // handler MUST NOT renumber indices on receipt.

  async #commitPlacements(placements: Map<string, Axial>): Promise<void> {
    const denseOrder = this.#reorderNames(placements).filter(n => n !== '')

    const orderProjection = window.ioc.get<OrderProjection>('@diamondcoreprocessor.com/OrderProjection')
    if (orderProjection) {
      await orderProjection.reorder(denseOrder)
    }

    // Authoritative write: each placed tile's `index` property = its
    // grid index. Gaps are preserved. Render-time collision heal in
    // #orderByIndexPinned demotes any duplicate to the next free slot.
    await this.#persistPinnedIndices(placements)

    this.emitEffect('cell:reorder', { labels: denseOrder })
    this.emitEffect('move:preview', null)
    this.emitEffect('move:committed', { order: denseOrder })
  }

  async #persistPinnedIndices(placements: Map<string, Axial>): Promise<void> {
    // Layer-slot write: each placed tile's `index` property goes into the
    // tile's layer via the `properties` slot. No OPFS dir consulted or
    // minted — the lineage signature locates the tile's history bag, and
    // commitSlotSet replaces the slot's single sig with one pointing at
    // the new merged-properties resource. The cascade folds the new tile-
    // layer sig into each ancestor's `children` slot, so the index write
    // produces one undoable / time-travelable marker per ancestor.
    const lineage = this.resolve<any>('lineage')
    const parentSegments: readonly string[] = lineage?.explorerSegments?.() ?? []

    for (const [label, axial] of placements) {
      const gridIndex = this.#keyToIndex.get(axialKey(axial.q, axial.r))
      if (gridIndex === undefined) continue
      try {
        await writeTilePropertiesAt(parentSegments, label, { index: gridIndex })
      } catch (err) {
        console.warn('[move] failed to persist index for', label, err)
      }
    }
  }

  // ── reset ────────────────────────────────────────────────

  #reset(source: string): void {
    this.#anchorAxial = null
    this.#movedGroup.clear()
    this.#occupancy.clear()
    this.#labelToKey.clear()
    this.#keyToIndex.clear()
    this.#dragLabels = []
    this.#dragCoords = []
    this.#copyMode = false
    this.#end(source)
  }
}

const _move = new MoveDrone()
window.ioc.register('@diamondcoreprocessor.com/MoveDrone', _move)
