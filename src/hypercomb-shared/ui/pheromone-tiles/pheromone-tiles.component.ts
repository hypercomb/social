// hypercomb-shared/ui/pheromone-tiles/pheromone-tiles.component.ts
//
// The on-tile pheromone card. While the Pheromones window is open, hovering a
// tile that carries keywords pops an ephemeral card of coloured chips BESIDE
// THE HEX — to its right, or its left when the viewport runs out — in one
// stable spot per tile, however the cursor wanders; the ⌖ in its header PINS
// it (draggable, per the shared pin stack) so the ×'s are easy to hit. An ×
// takes that keyword off that one tile. This is the surgical counterpart to
// the panel's bulk staged removal: "this tile, this keyword, gone."
//
// The pin used to be an icon on the tile's hover band. That band no longer
// shows while this window is open — it sat on top of this card and swallowed
// the press meant for the hive — so the pin moved onto the card.
//
// Composes PinnableHoverBase — the hover-peek → click-to-pin → drag stack the
// contact card uses — so all this component owns is the chip template and the
// remove action. PheromoneTilesDrone (essentials) feeds it `pheromone:hover-*`
// and services the × via `pheromone:remove-from-tile`. Colours come from the
// TagRegistry, exactly as the Pheromones panel resolves them, so a keyword
// reads the same colour on the tile as in the list.
//
// Shell UI — must NOT import essentials.

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { Component } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { PinnableHoverBase, type PinnablePanel } from '../pinnable/pinnable-hover.base'

interface PheromoneChip { name: string; color: string }
export interface PheromoneTileData {
  label: string
  segments: string[]
  chips: PheromoneChip[]
}

/** The tile's screen geometry, sent by PheromoneTilesDrone: hex centre +
 *  circumradius in client coordinates. */
type TileAnchor = { x: number; y: number; radius: number }
type HoverPayload = { label?: string; segments?: string[]; pheromones?: string[]; anchor?: TileAnchor | null }
type TagRegistryLike = { color(name: string): string }

const DEFAULT_CHIP = '#7eb6d6'
/** Small gap so the card lands beside the cursor, not under it — the fallback
 *  when no tile anchor arrived with the hover. */
const CURSOR_GAP = { x: 16, y: 12 }
/** Breathing room between the hex's edge and the card. */
const TILE_GAP = 18

@Component({
  selector: 'hc-pheromone-tiles',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './pheromone-tiles.component.html',
  styleUrls: ['./pheromone-tiles.component.scss'],
})
export class PheromoneTilesComponent extends PinnableHoverBase<PheromoneTileData> {

  protected get ns(): string { return 'pheromone' }
  protected get posKey(): string { return 'hc:pheromone-pins-pos' }
  protected override get panelWidth(): number { return 240 }
  // Chips belong to the page they were pinned on — hide on navigate-away, come
  // back on return. A pheromone session is a session; no refresh persistence.
  protected override get pageScoped(): boolean { return true }
  // Move a pinned card and it stays put — but hiding it forgets the spot, so
  // the next hover lands back at the tile-side default.
  protected override get stickyPositions(): boolean { return false }

  /** The hovered tile's screen geometry, from the drone. While it is known the
   *  card anchors to the TILE — one stable spot per hex — never the cursor. */
  #anchor: TileAnchor | null = null
  /** Chip count of the incoming card — feeds the height estimate that keeps
   *  the card vertically centred on the hex. */
  #chipCount = 1

  /** Last pointer position — the fallback anchor when no tile geometry came. */
  #mouse = { x: 24, y: 96 }
  #onMove = (e: PointerEvent): void => { this.#mouse = { x: e.clientX, y: e.clientY } }

  override ngOnInit(): void {
    super.ngOnInit()
    document.addEventListener('pointermove', this.#onMove, { passive: true })
  }

  override ngOnDestroy(): void {
    document.removeEventListener('pointermove', this.#onMove)
    super.ngOnDestroy()
  }

  /** Beside the hex: to its right, vertically centred — or to its left when
   *  the right side would run off the viewport. Falls back to the cursor only
   *  when the hover carried no tile geometry. */
  protected override anchorPos(): { x: number; y: number } {
    const a = this.#anchor
    if (!a) return { x: this.#mouse.x + CURSOR_GAP.x, y: this.#mouse.y + CURSOR_GAP.y }
    const rightX = a.x + a.radius + TILE_GAP
    const fitsRight = rightX + this.panelWidth <= window.innerWidth - 8
    const x = fitsRight ? rightX : a.x - a.radius - TILE_GAP - this.panelWidth
    return { x, y: a.y - this.#estimatedHeight() / 2 }
  }

  /** Rough card height from the chip count (~2 chips per row at this width) —
   *  only used to centre on the hex, so rough is fine. */
  #estimatedHeight(): number {
    return 58 + Math.ceil(Math.max(1, this.#chipCount) / 2) * 34
  }

  /** Leaving the card is what dismisses it (the drone deliberately does NOT
   *  drop it when the pointer leaves the tile — see PheromoneTilesDrone). Tell
   *  the drone so it forgets which tile is showing; otherwise its
   *  same-label de-dupe would refuse to re-open this tile's card next hover. */
  override onPeekLeave(panel: PinnablePanel<PheromoneTileData>): void {
    super.onPeekLeave(panel)
    if (panel.ephemeral) EffectBus.emit('pheromone:card-left', {})
  }

  protected override currentPageKey(): string {
    const lineage = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@hypercomb.social/Lineage') as { explorerSegments?: () => readonly string[] } | undefined
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean).join('/')
  }

  protected toPanel(payload: unknown): { key: string; data: PheromoneTileData } | null {
    const p = payload as HoverPayload | undefined
    if (!p?.label) return null
    const names = Array.isArray(p.pheromones) ? p.pheromones.filter(n => typeof n === 'string' && n) : []
    if (names.length === 0) return null
    if (p.anchor && typeof p.anchor.x === 'number') {
      this.#anchor = p.anchor
      this.#chipCount = names.length
    }
    const segments = Array.isArray(p.segments) ? p.segments.map(String) : []
    return {
      key: p.label,
      data: { label: p.label, segments, chips: names.map(name => ({ name, color: this.#colorOf(name) })) },
    }
  }

  /** Keep this card up. It used to be pinned by an icon on the tile's hover
   *  band, but that band stands down while the Pheromones window is open (it
   *  covered this very card), so the pin lives on the card itself. */
  pin(panel: PinnablePanel<PheromoneTileData>): void {
    this.pinPeek(panel)
  }

  /** Take one keyword off this one tile. Optimistically drops the chip so the
   *  card reacts instantly; the drone's `tags:changed` refresh confirms it (and
   *  hides the card if that was the last keyword). */
  remove(panel: PinnablePanel<PheromoneTileData>, chip: PheromoneChip): void {
    EffectBus.emit('pheromone:remove-from-tile', {
      label: panel.data.label,
      name: chip.name,
      segments: panel.data.segments,
    })
    const remaining = panel.data.chips.filter(c => c.name !== chip.name)
    if (remaining.length === 0) {
      if (panel.ephemeral) this.dismissPeek(); else this.closePanel(panel.id)
      return
    }
    this.updateData(panel.id, { ...panel.data, chips: remaining })
  }

  // (A `textOn` luma helper lived here while chips were colour-FILLED. The
  //  colour now belongs to the swatch square and the label sits on cold chrome,
  //  so per-chip contrast maths is no longer needed.)

  #colorOf(name: string): string {
    const registry = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@hypercomb.social/TagRegistry') as TagRegistryLike | undefined
    const c = registry?.color(name)
    if (c) return c
    try {
      const stored: Record<string, string> = JSON.parse(localStorage.getItem('hc:tag-colors') ?? '{}')
      if (stored[name]) return stored[name]
    } catch { /* fall through */ }
    return DEFAULT_CHIP
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-pheromone-tiles',
  owner: '@hypercomb.shared/PheromoneTilesComponent',
  component: PheromoneTilesComponent,
  order: 175,
})
