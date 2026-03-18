// hypercomb-essentials/src/diamondcoreprocessor.com/input/move/move.drone.ts
// Authoritative move coordinator. Owns drag state, swap algorithm, persistence.
// Move mode must be toggled on (via controls:action or move:mode effect) before
// drag input is accepted.

import { Drone, EffectBus } from '@hypercomb/core'
import type { HostReadyPayload } from '../../pixi/pixi-host.drone.js'
import type { Axial } from '../hex-detector.js'
import type { LayoutService } from '../../core/layout/layout.service.js'

type CellCountPayload = { count: number; labels: string[] }
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
}

function axialKey(q: number, r: number): string {
  return `${q},${r}`
}

export class MoveDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'authoritative move coordinator'

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
  #cellCount = 0

  get moveActive(): boolean { return this.#moveActive }

  protected override deps = {
    desktopMove: '@diamondcoreprocessor.com/DesktopMoveInput',
    touchMove: '@diamondcoreprocessor.com/TouchMoveInput',
    detector: '@diamondcoreprocessor.com/HexDetector',
    axial: '@diamondcoreprocessor.com/AxialService',
    layout: '@diamondcoreprocessor.com/LayoutService',
    lineage: '@hypercomb.social/Lineage',
    selection: '@diamondcoreprocessor.com/SelectionService',
  }

  protected override listens = ['render:host-ready', 'render:cell-count', 'render:mesh-offset', 'controls:action']
  protected override emits = ['move:preview', 'move:committed', 'move:mode']

  protected override heartbeat = async (): Promise<void> => {
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
      if (this.#activeSource) return // freeze snapshot during active drag
      this.#cellCount = payload.count
      this.#cellLabels = payload.labels
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
    for (let i = 0; i < this.#cellCount; i++) {
      const coord = axialSvc.items.get(i) as Axial | undefined
      const label = this.#cellLabels[i]
      if (!coord || !label) break
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
    if (selected && selected.size > 0 && selected.has(anchorLabel)) {
      // move the whole selection
      for (let i = 0; i < this.#cellCount; i++) {
        const coord = axialSvc.items.get(i) as Axial | undefined
        const label = this.#cellLabels[i]
        if (!coord || !label) break
        if (selected.has(label)) {
          this.#movedGroup.set(label, { q: coord.q, r: coord.r })
        }
      }
    } else {
      // single tile
      this.#movedGroup.set(anchorLabel, { q: anchorAxial.q, r: anchorAxial.r })
    }

    this.#anchorAxial = anchorAxial
    return true
  }

  updateMove = (hoverAxial: Axial, source: string): void => {
    if (this.#activeSource !== source) return
    if (!this.#anchorAxial) return

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
    if (!this.#anchorAxial) { this.#reset(source); return }

    const diff: Axial = {
      q: finalAxial.q - this.#anchorAxial.q,
      r: finalAxial.r - this.#anchorAxial.r,
    }

    // skip if no movement
    if (diff.q === 0 && diff.r === 0) { this.#reset(source); return }

    const placements = this.#computePlacements(diff)
    const newOrder = this.#reorderNames(placements)

    // persist
    const layout = this.resolve<LayoutService>('layout')
    const lineage = this.resolve<any>('lineage')
    if (layout && lineage?.explorerDir) {
      const dir = await lineage.explorerDir()
      if (dir) await layout.write(dir, newOrder)
    }

    // clear preview
    this.emitEffect('move:preview', null)
    this.emitEffect('move:committed', { order: newOrder })

    this.#reset(source)

    // trigger re-render
    window.dispatchEvent(new Event('synchronize'))
  }

  cancelMove = (source: string): void => {
    if (this.#activeSource !== source) return
    this.emitEffect('move:preview', null)
    this.#reset(source)
  }

  // ── reorder names by index ──────────────────────────────

  #reorderNames(placements: Map<string, Axial>): string[] {
    // start with original label order
    const names = [...this.#cellLabels]

    // find max target index so we can extend the array if needed
    let maxIdx = names.length - 1
    for (const [, axial] of placements) {
      const targetKey = axialKey(axial.q, axial.r)
      const targetIndex = this.#keyToIndex.get(targetKey)
      if (targetIndex !== undefined && targetIndex > maxIdx) maxIdx = targetIndex
    }
    // extend array with empty strings for out-of-range positions
    while (names.length <= maxIdx) names.push('')

    // clear original positions of all placed labels first
    const placedLabels = new Set(placements.keys())
    for (let i = 0; i < names.length; i++) {
      if (placedLabels.has(names[i])) names[i] = ''
    }

    // write each placed label to its target index
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

  // ── reset ────────────────────────────────────────────────

  #reset(source: string): void {
    this.#anchorAxial = null
    this.#movedGroup.clear()
    this.#occupancy.clear()
    this.#labelToKey.clear()
    this.#keyToIndex.clear()
    this.#end(source)
  }
}

const _move = new MoveDrone()
window.ioc.register('@diamondcoreprocessor.com/MoveDrone', _move)
