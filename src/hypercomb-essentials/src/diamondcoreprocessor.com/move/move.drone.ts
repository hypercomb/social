// diamondcoreprocessor.com/input/move/move.drone.ts
import { Drone, EffectBus, hypercomb, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { HostReadyPayload } from '../presentation/tiles/pixi-host.worker.js'
import type { Axial } from '../navigation/hex-detector.js'
import type { OrderProjection } from '../history/order-projection.js'
import { writeTilePropertiesAt, readTilePropsIndex, writeTilePropsIndex, cellLocationSig } from '../editor/tile-properties.js'
import { childNamesOfStrict, childLayerOf, resolveLayerAt, flattenLayerTree } from '../history/layer-placement.js'
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
  }

  protected override listens = ['render:host-ready', 'render:cell-count', 'render:mesh-offset', 'controls:action', 'tile:action']
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
      else if (payload.action === 'promote-to-parent') {
        const selection = this.resolve<any>('selection')
        const labels = selection?.selected ? [...selection.selected] : []
        if (labels.length > 0) void this.commitPromoteToParent(labels)
      }
    })
    // Kebab promote owns its tile:action directly (like swarm-adopt's 'adopt', so
    // it stays out of tile-actions HANDLED_ACTIONS) — promotes the ONE clicked tile.
    this.onEffect<{ action: string; label?: string }>('tile:action', (payload) => {
      if (!ready) return
      if (payload.action === 'promote-to-parent' && payload.label) {
        void this.commitPromoteToParent([payload.label])
      }
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

    const history = window.ioc.get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const committer = window.ioc.get<CopyCommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    const lineage = this.resolve<any>('lineage')
    if (!history || !committer || !lineage) { this.cancelMove(source); return }

    // Refuse while the history cursor is rewound (scrub-back is view-only) — the
    // same guard copy/reorder use. Feedback, then decline; never half-run.
    const cursor = window.ioc.get<{ state?: { rewound?: boolean } }>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursor?.state?.rewound) {
      const i18nMove = window.ioc.get<I18nProvider>(I18N_IOC_KEY)
      EffectBus.emit('toast:show', {
        type: 'info',
        title: i18nMove?.t('move.rewound.title') ?? 'Viewing history',
        message: i18nMove?.t('move.rewound.message') ?? "Can’t move while scrubbed back — return to the latest (Restore) to edit.",
      })
      this.cancelMove(source)
      return
    }

    const sourceSegments: readonly string[] = lineage.explorerSegments?.() ?? []
    const sourceParent = await this.#resolveCurrentParent(history, lineage, sourceSegments)
    const sourceStrict = await childNamesOfStrict(history, sourceParent)
    const sourceChildren = sourceStrict.names

    // SAFETY: a MOVE re-SETs BOTH parents' children lists — so we must only
    // commit when the source parent resolved, EVERY child sig resolved (a cold
    // sibling silently missing from the list would be wiped by the SET even
    // though it was never dragged), and the parent actually holds every dragged
    // tile. Abort (no data loss) instead.
    if (!sourceParent || sourceStrict.coldMiss || !movedLabels.every(l => sourceChildren.includes(l))) {
      console.warn('[move] drop-into aborted — source parent/children unresolved or cold', { movedLabels, sourceChildren, coldMiss: sourceStrict.coldMiss })
      this.cancelMove(source)
      return
    }

    // The target tile becomes a parent: resolve its layer (warm, via the source
    // parent's slot) and its existing children so we APPEND, never clobber.
    // Same strictness: the target's children are re-SET below, so a cold child
    // of the target must also abort rather than vanish.
    const targetViaParent = await childLayerOf(history, sourceParent, targetLabel)
    const targetLayer = targetViaParent?.layer ?? null
    const targetStrict = await childNamesOfStrict(history, targetLayer)
    const targetChildren = targetStrict.names
    if (!targetLayer || targetStrict.coldMiss) {
      console.warn('[move] drop-into aborted — target layer/children unresolved or cold', { targetLabel, coldMiss: targetStrict.coldMiss })
      this.cancelMove(source)
      return
    }
    const targetParentSegments = [...sourceSegments, targetLabel]

    // Suck-into-tile animation up front (purely visual); the importTree below is
    // the authoritative MOVE.
    this.emitEffect('move:drop-into-commit', { label: targetLabel, dragged: [...movedLabels] })

    // Re-home each dragged subtree UNDER the target, keeping its own name — this
    // is a MOVE, not a copy (no fresh name). flattenLayerTree preserves every
    // content sig; the SAME primitive copy / adopt / clipboard-paste use.
    const treeUpdates: CopyTreeUpdate[] = []
    const landed: string[] = []
    let nextIndex = targetChildren.length

    for (const label of movedLabels) {
      const viaParent = await childLayerOf(history, sourceParent, label)
      let srcLayer = viaParent?.layer ?? null
      if (!srcLayer) {
        const ownSig = await history.sign({ domain: lineage.domain, explorerSegments: () => [...sourceSegments, label] })
        srcLayer = await history.currentLayerAt(ownSig)
      }
      if (!srcLayer) { console.warn('[move] drop-into source missing for', label); continue }

      const entryUpdates = await flattenLayerTree(history, srcLayer, [...targetParentSegments, label])

      // Land after the target's existing children — fold the index into the SAME
      // cascade (a post-commit write races it; see the clipboard paste-target fix).
      const topKey = [...targetParentSegments, label].join('/')
      const top = entryUpdates.find(u => u.segments.join('/') === topKey)
      if (top) {
        const sig = await this.#propsWithIndex(top.layer, nextIndex)
        if (sig) top.layer = { ...top.layer, properties: [sig] }
      }
      treeUpdates.push(...entryUpdates)
      landed.push(label)
      nextIndex++
    }

    if (landed.length === 0) { this.cancelMove(source); return }

    const landedSet = new Set(landed)
    const newSourceChildren = sourceChildren.filter(c => !landedSet.has(c))
    const newTargetChildren = [...targetChildren, ...landed]

    EffectBus.emit('fs:changed', { segments: [...sourceSegments] })

    // Seed the participant-local render index (hc:tile-props-index) for the moved
    // tiles at their NEW location under the target. show-cell resolves a local
    // tile's image ONLY through this index — without the seed a re-homed tile
    // renders BLANK until a reload heals it. Same gap + fix as clipboard paste
    // and swarm-adopt. FILL-IF-EMPTY (never disturb an existing image).
    try {
      const index = readTilePropsIndex()
      let seeded = false
      for (const u of treeUpdates) {
        const props = (u.layer as { properties?: unknown }).properties
        const propSig = Array.isArray(props) && typeof props[0] === 'string' ? props[0] : undefined
        if (!propSig || !/^[0-9a-f]{64}$/.test(propSig)) continue
        const segs = u.segments
        if (segs.length === 0) continue
        const key = await cellLocationSig(segs.slice(0, -1), segs[segs.length - 1])
        if (!key || index[key]) continue
        index[key] = propSig
        seeded = true
      }
      if (seeded) writeTilePropsIndex(index)
    } catch (err) {
      console.warn('[move] props-index seed skipped', err)
    }

    // ONE atomic cascade: the source parent DROPS the moved names from its
    // children, the target GAINS them, and each subtree is re-homed under the
    // target. Because the source parent's new children list excludes the moved
    // names, this is a true MOVE — the tiles can never linger as copies.
    await committer.importTree([
      { segments: [...sourceSegments], layer: { ...sourceParent, children: newSourceChildren } },
      { segments: [...targetParentSegments], layer: { ...(targetLayer ?? {}), children: newTargetChildren } },
      ...treeUpdates,
    ])

    // The moved cells leave THIS level (now children of the target). Carry the
    // source segments explicitly — the awaited commit means a segment-less emit
    // could bind the removal to wherever the user navigated mid-commit.
    for (const label of landed) {
      EffectBus.emit('cell:removed', { cell: label, segments: [...sourceSegments] })
    }

    // Stay at the current level — the moved tiles simply vanish into the target
    // ("you won't see them anymore"). No navigation; clear the now-gone tiles
    // from the selection.
    const selection = this.resolve<any>('selection')
    selection?.clear?.()

    this.emitEffect('move:preview', null)
    this.emitEffect('move:drop-into', null)
    this.emitEffect('move:committed', { order: [] })

    this.#dropIntoActive = false
    this.#dropIntoLabel = null
    this.#lastHoverAxial = null
    this.#reset(source)

    void new hypercomb().act()
  }

  /**
   * Promote tiles UP one level — re-home them from the CURRENT location into its
   * PARENT, as siblings of the current location's own tile (the inverse of
   * drop-into). No-op at the root (no parent). ONE atomic importTree, the same
   * re-home primitive as drop-into / clipboard paste, and it seeds the render
   * index so the promoted tiles aren't blank at their new location. Driven from
   * the selection menu (whole selection) and the tile kebab (one label).
   */
  commitPromoteToParent = async (labels: readonly string[]): Promise<void> => {
    const moved = [...new Set(labels)].filter(Boolean)
    if (moved.length === 0) return

    const history = window.ioc.get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const committer = window.ioc.get<CopyCommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    const lineage = this.resolve<any>('lineage')
    if (!history || !committer || !lineage) return

    const sourceSegments: readonly string[] = lineage.explorerSegments?.() ?? []
    if (sourceSegments.length === 0) {
      const i18n0 = window.ioc.get<I18nProvider>(I18N_IOC_KEY)
      EffectBus.emit('toast:show', { type: 'info', title: i18n0?.t('move.promote.at-root.title') ?? 'Already at the top', message: i18n0?.t('move.promote.at-root.message') ?? 'These tiles are at the root — there is no parent to promote to.' })
      return
    }
    const parentSegments = sourceSegments.slice(0, -1)

    const cursor = window.ioc.get<{ state?: { rewound?: boolean } }>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursor?.state?.rewound) {
      const i18n1 = window.ioc.get<I18nProvider>(I18N_IOC_KEY)
      EffectBus.emit('toast:show', { type: 'info', title: i18n1?.t('move.promote.rewound.title') ?? 'Viewing history', message: i18n1?.t('move.promote.rewound.message') ?? "Can't move while scrubbed back — return to the latest (Restore) to edit." })
      return
    }

    try {
      const sourceParent = await this.#resolveCurrentParent(history, lineage, sourceSegments)
      const sourceStrict = await childNamesOfStrict(history, sourceParent)
      const sourceChildren = sourceStrict.names
      // SAFETY: a MOVE re-SETs both parents' children — only commit when the
      // source resolved, EVERY child sig resolved (a cold sibling missing from
      // the list would be wiped by the SET), and the source actually holds the
      // tiles.
      if (!sourceParent || sourceStrict.coldMiss || !moved.every(l => sourceChildren.includes(l))) {
        console.warn('[move] promote aborted — source unresolved or cold', { moved, sourceChildren, coldMiss: sourceStrict.coldMiss })
        return
      }

      // Same strictness for the destination: its children are re-SET below,
      // and a null dest layer would SET a slot-less layer over the parent.
      const destParent = await resolveLayerAt(history, lineage.domain, parentSegments)
      const destStrict = await childNamesOfStrict(history, destParent)
      const destChildren = destStrict.names
      if (!destParent || destStrict.coldMiss) {
        console.warn('[move] promote aborted — destination parent unresolved or cold', { parentSegments, coldMiss: destStrict.coldMiss })
        return
      }
      const destTaken = new Set(destChildren)

      const treeUpdates: CopyTreeUpdate[] = []
      const landed: string[] = []
      let nextIndex = destChildren.length

      for (const label of moved) {
        // Names are immutable identity — never collide a promoted tile with an
        // existing sibling at the parent. Skip (don't clobber) on a name clash.
        if (destTaken.has(label)) { console.warn('[move] promote skipped — name exists at parent', label); continue }
        const viaParent = await childLayerOf(history, sourceParent, label)
        let srcLayer = viaParent?.layer ?? null
        if (!srcLayer) {
          const ownSig = await history.sign({ domain: lineage.domain, explorerSegments: () => [...sourceSegments, label] })
          srcLayer = await history.currentLayerAt(ownSig)
        }
        if (!srcLayer) { console.warn('[move] promote source missing for', label); continue }

        const entryUpdates = await flattenLayerTree(history, srcLayer, [...parentSegments, label])
        const topKey = [...parentSegments, label].join('/')
        const top = entryUpdates.find(u => u.segments.join('/') === topKey)
        if (top) {
          const sig = await this.#propsWithIndex(top.layer, nextIndex)
          if (sig) top.layer = { ...top.layer, properties: [sig] }
        }
        treeUpdates.push(...entryUpdates)
        landed.push(label)
        destTaken.add(label)
        nextIndex++
      }

      if (landed.length === 0) return

      const landedSet = new Set(landed)
      const newSourceChildren = sourceChildren.filter(c => !landedSet.has(c))
      const newDestChildren = [...destChildren, ...landed]

      EffectBus.emit('fs:changed', { segments: [...sourceSegments] })

      // Seed the render index for the promoted tiles at their NEW (parent)
      // location — same gap/fix as drop-into and clipboard paste.
      try {
        const index = readTilePropsIndex()
        let seeded = false
        for (const u of treeUpdates) {
          const props = (u.layer as { properties?: unknown }).properties
          const propSig = Array.isArray(props) && typeof props[0] === 'string' ? props[0] : undefined
          if (!propSig || !/^[0-9a-f]{64}$/.test(propSig)) continue
          const segs = u.segments
          if (segs.length === 0) continue
          const key = await cellLocationSig(segs.slice(0, -1), segs[segs.length - 1])
          if (!key || index[key]) continue
          index[key] = propSig
          seeded = true
        }
        if (seeded) writeTilePropsIndex(index)
      } catch (err) {
        console.warn('[move] promote props-index seed skipped', err)
      }

      // ONE atomic cascade: the current location DROPS the promoted names, the
      // parent GAINS them, and each subtree is re-homed under the parent.
      await committer.importTree([
        { segments: [...sourceSegments], layer: { ...sourceParent, children: newSourceChildren } },
        { segments: [...parentSegments], layer: { ...(destParent ?? {}), children: newDestChildren } },
        ...treeUpdates,
      ])

      // The promoted cells leave THIS level (they're at the parent now). Carry
      // the source segments explicitly.
      for (const label of landed) {
        EffectBus.emit('cell:removed', { cell: label, segments: [...sourceSegments] })
      }

      const selection = this.resolve<any>('selection')
      selection?.clear?.()
      this.emitEffect('move:committed', { order: [] })
      void new hypercomb().act()
    } catch (err) {
      console.warn('[move] commitPromoteToParent failed:', err)
    }
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
  commitCopyAt = async (_finalAxial: Axial, source: string): Promise<void> => {
    // Copy-on-drag is REMOVED. A duplicate would mint a same-content tile with an
    // auto-generated name, but in Hypercomb the NAME is the immutable identity —
    // a copy is only meaningful if you choose the new name up front (drop the
    // icon into the command line like an image drop and type it). The drag
    // gesture is MOVE / drop-into ONLY. This path must NEVER produce a copy: if
    // anything ever reaches it, surface an error and cancel — no silent duplicate.
    // (#commitCopyUnsafe is kept, unused, as the reference for the future
    // named-duplicate flow.)
    console.error('[move] commitCopyAt reached but copy-on-drag is removed — cancelled, no copy made')
    this.cancelMove(source)
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
      const i18nCopy = window.ioc.get<I18nProvider>(I18N_IOC_KEY)
      EffectBus.emit('toast:show', {
        type: 'info',
        title: i18nCopy?.t('copy.rewound.title') ?? 'Viewing history',
        message: i18nCopy?.t('copy.rewound.message') ?? "Can’t copy while scrubbed back — return to the latest (Restore) to edit.",
      })
      this.emitEffect('move:copy-drag', null)
      return false
    }

    const parentSegments: readonly string[] = lineage.explorerSegments?.() ?? []
    const parentLayer = await this.#resolveCurrentParent(history, lineage, parentSegments)
    // STRICT: the commit below SETs the parent's children to existing +
    // copies — a cold sibling missing from `existing` (or a null parent,
    // which would SET a slot-less layer) would be permanently wiped.
    const existingStrict = await childNamesOfStrict(history, parentLayer)
    const existing = existingStrict.names
    if (!parentLayer || existingStrict.coldMiss) {
      console.warn('[move] copy aborted — parent/children unresolved or cold', { coldMiss: existingStrict.coldMiss })
      this.emitEffect('move:copy-drag', null)
      return false
    }
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
        if (!blob) return null // props COLD — a rewrite would STRIP the image; keep the original slot
        { const parsed = JSON.parse(await blob.text()); if (parsed && typeof parsed === 'object') props = parsed }
      } catch { return null } // unreadable props — never mint a stripped replacement
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
