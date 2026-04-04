// diamondcoreprocessor.com/input/move/move.drone.ts
import { Drone, EffectBus, hypercomb } from '@hypercomb/core'
import type { HostReadyPayload } from '../presentation/tiles/pixi-host.worker.js'
import type { Axial } from '../navigation/hex-detector.js'
import type { LayoutService } from './layout.service.js'
import type { LayerTransferService } from './layer-transfer.service.js'
import { writeCellProperties } from '../editor/tile-properties.js'

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
  startDwell: (label: string) => void
  cancelDwell: () => void
  readonly isDwelling: boolean
  readonly branchLabels: ReadonlySet<string>
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
  #cellLabels: string[] = []
  #cellCoords: Axial[] = []
  #cellCount = 0

  // ── layer dwell state ────────────────────────────────────
  #branchLabels = new Set<string>()
  #dwellLabel: string | null = null
  #dwellTimer: ReturnType<typeof setTimeout> | null = null
  #dwellStart = 0
  #dwellRaf = 0
  #droppedThrough = false
  #pendingDragLabel: string | null = null
  #pendingSource: string | null = null

  get moveActive(): boolean { return this.#moveActive }
  get isDwelling(): boolean { return this.#dwellLabel !== null }
  get branchLabels(): ReadonlySet<string> { return this.#branchLabels }

  labelAtAxial = (axial: Axial): string | null => {
    for (let i = 0; i < this.#cellLabels.length; i++) {
      const coord = this.#cellCoords[i]
      if (coord && coord.q === axial.q && coord.r === axial.r) {
        return this.#cellLabels[i] ?? null
      }
    }
    return null
  }

  protected override deps = {
    desktopMove: '@diamondcoreprocessor.com/DesktopMoveInput',
    touchMove: '@diamondcoreprocessor.com/TouchMoveInput',
    detector: '@diamondcoreprocessor.com/HexDetector',
    axial: '@diamondcoreprocessor.com/AxialService',
    layout: '@diamondcoreprocessor.com/LayoutService',
    lineage: '@hypercomb.social/Lineage',
    selection: '@diamondcoreprocessor.com/SelectionService',
    transfer: '@diamondcoreprocessor.com/LayerTransferService',
  }

  protected override listens = ['render:host-ready', 'render:cell-count', 'render:mesh-offset', 'controls:action']
  protected override emits = ['move:preview', 'move:committed', 'move:mode', 'cell:reorder', 'move:layer-dwell']

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
      // always update branch labels (needed for dwell detection)
      this.#branchLabels = new Set(payload.branchLabels ?? [])

      // auto-resume drag after drop-through navigation
      if (this.#pendingDragLabel && payload.labels.includes(this.#pendingDragLabel)) {
        this.#cellCount = payload.count
        this.#cellLabels = payload.labels
        this.#cellCoords = payload.coords ?? []
        this.#autoResumeDrag()
        return
      }

      // freeze snapshot only during pointer drags — command moves rebuild on label changes
      if (this.#activeSource && this.#activeSource !== 'command') return
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
    if (!this.#moveActive) return false
    if (!this.#begin(source)) return false

    const anchorKey = axialKey(anchorAxial.q, anchorAxial.r)

    // build occupancy snapshot from current cell labels
    const axialSvc = this.resolve<any>('axial')
    if (!axialSvc?.items) { this.#end(source); return false }

    this.#occupancy.clear()
    this.#labelToKey.clear()
    this.#keyToIndex.clear()

    // full reverse map: every axial position → index (enables landing anywhere)
    for (const [i, coord] of axialSvc.items) {
      const key = axialKey(coord.q, coord.r)
      this.#keyToIndex.set(key, i)
    }

    // occupancy + label reverse map for occupied cells only
    // use stored coords from render:cell-count (matches labels 1:1, works in pinned mode)
    for (let i = 0; i < this.#cellLabels.length; i++) {
      const label = this.#cellLabels[i]
      if (!label) continue
      const coord = this.#cellCoords[i] as Axial | undefined
      if (!coord) continue
      const key = axialKey(coord.q, coord.r)
      this.#occupancy.set(key, label)
      this.#labelToKey.set(label, key)
    }

    // anchor must be on an occupied tile
    const anchorLabel = this.#occupancy.get(anchorKey)
    if (!anchorLabel) {
      this.#end(source)
      return false
    }

    // determine moved group: selection (if anchor is selected) or just the anchor
    const selection = this.resolve<any>('selection')
    const selected = selection?.selected as ReadonlySet<string> | undefined

    this.#movedGroup.clear()
    if (selected && selected.size > 0) {
      if (!selected.has(anchorLabel)) {
        this.#end(source)
        return false
      }
      for (let i = 0; i < this.#cellLabels.length; i++) {
        const label = this.#cellLabels[i]
        if (!label) continue
        const coord = this.#cellCoords[i] as Axial | undefined
        if (!coord) continue
        if (selected.has(label)) {
          this.#movedGroup.set(label, { q: coord.q, r: coord.r })
        }
      }
    } else {
      this.#movedGroup.set(anchorLabel, { q: anchorAxial.q, r: anchorAxial.r })
    }

    console.log('[move] beginMove', { anchorLabel, selectedLabels: selected ? [...selected] : [], movedGroupSize: this.#movedGroup.size, movedLabels: [...this.#movedGroup.keys()], cellCount: this.#cellCount, cellLabelsLen: this.#cellLabels.length, cellLabels: [...this.#cellLabels] })

    this.#anchorAxial = anchorAxial
    return true
  }

  updateMove = (hoverAxial: Axial, source: string): void => {
    if (this.#activeSource !== source) return
    if (!this.#anchorAxial) return

    if (this.#droppedThrough) {
      // insert-push mode: tiles shift to make room
      const insertOrder = this.#computeInsertPlacements(hoverAxial)
      const movedLabels = new Set(this.#movedGroup.keys())
      // build sparse array indexed by grid position for the preview
      const axialSvc = this.resolve<any>('axial')
      const gridSize = axialSvc?.count ?? 0
      const names: string[] = new Array(Math.max(gridSize, insertOrder.length)).fill('')
      for (let i = 0; i < insertOrder.length; i++) {
        if (insertOrder[i]) names[i] = insertOrder[i]
      }
      this.emitEffect('move:preview', { names, movedLabels })
      return
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

  commitMoveAt = async (finalAxial: Axial, source: string): Promise<void> => {
    if (this.#activeSource !== source) return
    this.cancelDwell()
    if (!this.#anchorAxial) { this.#reset(source); return }

    if (this.#droppedThrough) {
      // insert-push commit: write dense order directly
      const insertOrder = this.#computeInsertPlacements(finalAxial).filter(n => n !== '')
      this.emitEffect('cell:reorder', { labels: insertOrder })

      const lineage = this.resolve<any>('lineage')
      const layout = this.resolve<LayoutService>('layout')
      if (layout && lineage?.explorerDir) {
        const dir = await lineage.explorerDir()
        if (dir) await layout.write(dir, insertOrder)
      }

      this.emitEffect('move:preview', null)
      this.emitEffect('move:committed', { order: insertOrder })
      this.#droppedThrough = false
      this.#reset(source)
      void new hypercomb().act()
      return
    }

    const diff: Axial = {
      q: finalAxial.q - this.#anchorAxial.q,
      r: finalAxial.r - this.#anchorAxial.r,
    }

    // skip if no movement
    if (diff.q === 0 && diff.r === 0) { this.#reset(source); return }

    const placements = this.#computePlacements(diff)
    await this.#commitPlacements(placements)
    this.#reset(source)
    void new hypercomb().act()
  }

  cancelMove = (source: string): void => {
    if (this.#activeSource !== source) return
    this.cancelDwell()
    this.#droppedThrough = false
    this.emitEffect('move:preview', null)
    this.#reset(source)
  }

  // ── reorder names by index ──────────────────────────────

  #reorderNames(placements: Map<string, Axial>): string[] {
    // build a sparse array indexed by grid position (not dense cell index)
    // so buildCellsFromAxial can use moveNames[gridIndex] directly
    const axialSvc = this.resolve<any>('axial')
    const gridSize = axialSvc?.count ?? 0
    const names: string[] = new Array(Math.max(gridSize, this.#cellLabels.length)).fill('')

    // place each label at its grid index using stored coords
    for (let i = 0; i < this.#cellLabels.length; i++) {
      const label = this.#cellLabels[i]
      if (!label) continue
      const coord = this.#cellCoords[i]
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

  // ── command-driven move API (for command line /select[...]/move) ──

  #commandActive = false
  get moveCommandActive(): boolean { return this.#commandActive }

  /**
   * Begin a command-driven move with explicit labels (no pointer).
   * First label is the anchor.
   */
  beginCommandMove = (labels: string[]): void => {
    if (labels.length === 0) return
    if (this.#activeSource) return // another move is active

    this.#activeSource = 'command'
    this.#commandActive = true

    const axialSvc = this.resolve<any>('axial')
    if (!axialSvc?.items) { this.#end('command'); this.#commandActive = false; return }

    this.#occupancy.clear()
    this.#labelToKey.clear()
    this.#keyToIndex.clear()

    // full reverse map
    for (const [i, coord] of axialSvc.items) {
      const key = axialKey(coord.q, coord.r)
      this.#keyToIndex.set(key, i)
    }

    // occupancy — use stored coords from render:cell-count (works in pinned mode)
    for (let i = 0; i < this.#cellLabels.length; i++) {
      const label = this.#cellLabels[i]
      if (!label) continue
      const coord = this.#cellCoords[i] as Axial | undefined
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

    const axialSvc = this.resolve<any>('axial')
    const targetCoord = axialSvc?.items?.get(targetIndex)
    if (!targetCoord) { this.#resetCommand(); return }

    const diff: Axial = {
      q: targetCoord.q - this.#anchorAxial.q,
      r: targetCoord.r - this.#anchorAxial.r,
    }

    if (diff.q === 0 && diff.r === 0) { this.#resetCommand(); return }

    const placements = this.#computePlacements(diff)
    await this.#commitPlacements(placements)
    this.#resetCommand()
    void new hypercomb().act()
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

  // ── layer dwell (Ctrl + hover on branch tile) ─────────────

  readonly #dwellMs = 750

  startDwell = (label: string): void => {
    if (!this.#activeSource) return
    if (!this.#branchLabels.has(label)) return
    if (this.#movedGroup.has(label)) return // can't drop into yourself
    if (this.#dwellLabel === label) return  // already dwelling on this tile

    this.cancelDwell()
    this.#dwellLabel = label
    this.#dwellStart = performance.now()

    // smooth progress updates via rAF
    const tick = (): void => {
      if (!this.#dwellLabel) return
      const elapsed = performance.now() - this.#dwellStart
      const progress = Math.min(elapsed / this.#dwellMs, 1)
      this.emitEffect('move:layer-dwell', { label: this.#dwellLabel, progress })
      if (progress < 1) {
        this.#dwellRaf = requestAnimationFrame(tick)
      }
    }
    this.#dwellRaf = requestAnimationFrame(tick)

    this.#dwellTimer = setTimeout(() => {
      this.#dwellTimer = null
      cancelAnimationFrame(this.#dwellRaf)
      this.#dwellRaf = 0
      // emit final 100% before drop
      this.emitEffect('move:layer-dwell', { label: this.#dwellLabel!, progress: 1 })
      void this.#dropThrough()
    }, this.#dwellMs)
  }

  cancelDwell = (): void => {
    if (this.#dwellTimer) {
      clearTimeout(this.#dwellTimer)
      this.#dwellTimer = null
    }
    if (this.#dwellRaf) {
      cancelAnimationFrame(this.#dwellRaf)
      this.#dwellRaf = 0
    }
    if (this.#dwellLabel) {
      this.#dwellLabel = null
      this.emitEffect('move:layer-dwell', null)
    }
  }

  // ── drop through into child layer ────────────────────────

  async #dropThrough(): Promise<void> {
    const targetLabel = this.#dwellLabel
    if (!targetLabel) return

    const source = this.#activeSource
    if (!source) return

    const lineage = this.resolve<any>('lineage')
    const transfer = this.resolve<LayerTransferService>('transfer')
    if (!lineage || !transfer) return

    const sourceDir = lineage.explorerDir ? await lineage.explorerDir() : null
    if (!sourceDir) return

    // get target layer directory
    let targetLayerDir: FileSystemDirectoryHandle
    try {
      targetLayerDir = await sourceDir.getDirectoryHandle(targetLabel, { create: false })
    } catch { return }

    // transfer each moved tile into the target layer
    const movedLabels = [...this.#movedGroup.keys()]
    for (const label of movedLabels) {
      try {
        await transfer.transfer(sourceDir, targetLayerDir, label)
      } catch (err) {
        console.warn('[move] drop-through transfer failed for', label, err)
      }
    }

    // emit cell:removed for each tile leaving the current layer
    for (const label of movedLabels) {
      EffectBus.emit('cell:removed', { cell: label })
    }

    // clear dwell and preview state
    this.#dwellLabel = null
    this.emitEffect('move:layer-dwell', null)
    this.emitEffect('move:preview', null)

    // set up pending drag for auto-resume after navigation
    this.#pendingDragLabel = movedLabels[0] ?? null
    this.#pendingSource = source
    this.#droppedThrough = true

    // reset current drag state (will be rebuilt in new layer)
    this.#anchorAxial = null
    this.#movedGroup.clear()
    this.#occupancy.clear()
    this.#labelToKey.clear()
    this.#keyToIndex.clear()

    // navigate into the target layer
    lineage.explorerEnter(targetLabel)

    // processor will pulse from lineage change → render:cell-count fires → #autoResumeDrag
  }

  // ── auto-resume drag after navigation ─────────────────────

  #autoResumeDrag(): void {
    const label = this.#pendingDragLabel
    const source = this.#pendingSource
    this.#pendingDragLabel = null
    this.#pendingSource = null

    if (!label || !source) return

    // find the transferred tile in the new layout
    const idx = this.#cellLabels.indexOf(label)
    if (idx < 0) return
    const coord = this.#cellCoords[idx]
    if (!coord) return

    // ensure move mode stays active and source is set
    this.#moveActive = true
    this.#activeSource = source

    // rebuild occupancy maps for the new layer
    const axialSvc = this.resolve<any>('axial')
    if (!axialSvc?.items) return

    this.#occupancy.clear()
    this.#labelToKey.clear()
    this.#keyToIndex.clear()

    for (const [i, c] of axialSvc.items) {
      this.#keyToIndex.set(axialKey(c.q, c.r), i)
    }

    for (let i = 0; i < this.#cellLabels.length; i++) {
      const l = this.#cellLabels[i]
      if (!l) continue
      const c = this.#cellCoords[i] as Axial | undefined
      if (!c) continue
      const key = axialKey(c.q, c.r)
      this.#occupancy.set(key, l)
      this.#labelToKey.set(l, key)
    }

    // set up the moved group with the transferred tile
    this.#movedGroup.clear()
    this.#movedGroup.set(label, { q: coord.q, r: coord.r })
    this.#anchorAxial = { q: coord.q, r: coord.r }

    // emit cell:added for the new layer's history
    EffectBus.emit('cell:added', { cell: label })

    this.emitEffect('move:mode', { active: true })
  }

  // ── insert-push reorder (used after drop-through) ─────────

  #computeInsertPlacements(hoverAxial: Axial): string[] {
    if (this.#movedGroup.size === 0) return [...this.#cellLabels]

    const movedLabels = new Set(this.#movedGroup.keys())

    // dense order without the moved tiles
    const denseWithout = this.#cellLabels.filter(l => l && !movedLabels.has(l))

    // find insertion index: position of the tile currently at hoverAxial
    const hoverKey = axialKey(hoverAxial.q, hoverAxial.r)
    const hoverLabel = this.#occupancy.get(hoverKey)
    let insertIdx = denseWithout.length // default: append at end
    if (hoverLabel) {
      const pos = denseWithout.indexOf(hoverLabel)
      if (pos >= 0) insertIdx = pos
    }

    // insert moved tiles at position
    const movedList = [...movedLabels]
    const result = [...denseWithout]
    result.splice(insertIdx, 0, ...movedList)

    return result
  }

  // ── shared commit logic (pinned vs dense) ────────────────

  async #commitPlacements(placements: Map<string, Axial>): Promise<void> {
    const lineage = this.resolve<any>('lineage')
    const locationKey = String(lineage?.explorerLabel?.() ?? '/')
    const layoutMode = localStorage.getItem(`hc:layout-mode:${locationKey}`) === 'pinned' ? 'pinned' : 'dense'

    if (layoutMode === 'pinned') {
      const dir = lineage?.explorerDir ? await lineage.explorerDir() : null
      if (dir) {
        for (const [label, axial] of placements) {
          const targetKey = axialKey(axial.q, axial.r)
          const targetIndex = this.#keyToIndex.get(targetKey)
          if (targetIndex === undefined) continue
          try {
            const cellDir = await dir.getDirectoryHandle(label, { create: false })
            await writeCellProperties(cellDir, { index: targetIndex, offset: 0 })
          } catch { /* cell dir missing */ }
        }
      }
    } else {
      const denseOrder = this.#reorderNames(placements).filter(n => n !== '')
      this.emitEffect('cell:reorder', { labels: denseOrder })

      const layout = this.resolve<LayoutService>('layout')
      if (layout && lineage?.explorerDir) {
        const dir = await lineage.explorerDir()
        if (dir) await layout.write(dir, denseOrder)
      }
    }

    this.emitEffect('move:preview', null)
    this.emitEffect('move:committed', {
      order: layoutMode === 'pinned'
        ? [...placements.keys()]
        : this.#reorderNames(placements).filter(n => n !== ''),
    })
  }

  // ── reset ────────────────────────────────────────────────

  #reset(source: string): void {
    this.cancelDwell()
    this.#anchorAxial = null
    this.#movedGroup.clear()
    this.#occupancy.clear()
    this.#labelToKey.clear()
    this.#keyToIndex.clear()
    this.#pendingDragLabel = null
    this.#pendingSource = null
    this.#end(source)
  }
}

const _move = new MoveDrone()
window.ioc.register('@diamondcoreprocessor.com/MoveDrone', _move)
