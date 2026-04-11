// hypercomb-shared/ui/instruction-overlay/instruction-overlay.component.ts
//
// Renders instruction annotations as floating labels anchored to UI elements.
// Two modes:
//   1. Normal: shows non-hidden labels with dismiss buttons and leader lines
//   2. Catalog (Ctrl+Click): shows ALL instructions, hidden ones dimmed, click to toggle
//
// Subscribes to InstructionDrone via fromRuntime(). Positions update via rAF loop.

import { Component, computed, signal, type OnDestroy } from '@angular/core'
import { fromRuntime } from '../../core/from-runtime'
import { TranslatePipe } from '../../core/i18n.pipe'
import { EffectBus } from '@hypercomb/core'
import type { InstructionAnchor } from '@hypercomb/core'
import type { InstructionState } from
  '@hypercomb/essentials/diamondcoreprocessor.com/instructions/instruction.drone'

interface ResolvedAnchor {
  anchor: InstructionAnchor
  x: number
  y: number
  targetX: number
  targetY: number
  found: boolean
}

@Component({
  selector: 'hc-instruction-overlay',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './instruction-overlay.component.html',
  styleUrls: ['./instruction-overlay.component.scss'],
})
export class InstructionOverlayComponent implements OnDestroy {

  #drone: any
  #rafId = 0

  private readonly state$ = fromRuntime(
    get('@diamondcoreprocessor.com/InstructionDrone') as EventTarget,
    () => (this.#drone?.state ?? { visible: false, catalogOpen: false, manifestSig: null, manifest: null, settingsSig: null, settings: null }) as InstructionState,
  )

  readonly visible = computed(() => this.state$().visible)
  readonly catalogOpen = computed(() => this.state$().catalogOpen)
  readonly manifest = computed(() => this.state$().manifest)
  readonly settings = computed(() => this.state$().settings)

  readonly resolved = signal<ResolvedAnchor[]>([])

  readonly activeAnchors = computed(() => {
    const hidden = new Set(this.settings()?.hidden ?? [])
    return this.resolved().filter(r => r.found && !hidden.has(r.anchor.selector))
  })

  readonly allAnchors = computed(() => {
    const m = this.manifest()
    if (!m) return [] as InstructionAnchor[]
    return m.sets.flatMap(s => s.anchors)
  })

  readonly catalogGroups = computed(() => {
    const m = this.manifest()
    if (!m) return []
    return m.sets
  })

  constructor() {
    this.#drone = get('@diamondcoreprocessor.com/InstructionDrone')
    this.#startPositionLoop()
  }

  ngOnDestroy(): void {
    if (this.#rafId) cancelAnimationFrame(this.#rafId)
  }

  isHidden(selector: string): boolean {
    return this.settings()?.hidden?.includes(selector) ?? false
  }

  dismiss(selector: string): void {
    EffectBus.emit('instruction:dismiss', { selector })
  }

  restoreItem(selector: string): void {
    EffectBus.emit('instruction:restore-item', { selector })
  }

  toggleItem(selector: string): void {
    if (this.isHidden(selector)) {
      this.restoreItem(selector)
    } else {
      this.dismiss(selector)
    }
  }

  closeCatalog(): void {
    EffectBus.emit('instruction:toggle', { visible: false })
  }

  // ─── position tracking ────────────────────────────────

  #startPositionLoop(): void {
    const tick = () => {
      if (this.visible()) {
        this.#updatePositions()
      }
      this.#rafId = requestAnimationFrame(tick)
    }
    this.#rafId = requestAnimationFrame(tick)
  }

  #updatePositions(): void {
    const anchors = this.allAnchors()
    if (!anchors.length) { this.resolved.set([]); return }

    const hidden = new Set(this.settings()?.hidden ?? [])

    // Measure previously rendered labels by selector so collision resolution
    // can use each label's true width. Falls back to an estimate on the first
    // frame before labels have mounted.
    const measured = new Map<string, { width: number, height: number }>()
    document.querySelectorAll<HTMLElement>('.instruction-label[data-selector]').forEach(el => {
      const selector = el.dataset['selector']
      if (!selector) return
      const r = el.getBoundingClientRect()
      measured.set(selector, { width: r.width, height: r.height })
    })

    const results: ResolvedAnchor[] = []
    const placedBoxes: Array<{ left: number, top: number, right: number, bottom: number }> = []

    for (const anchor of anchors) {
      const el = document.querySelector(`[data-instruction="${anchor.selector}"]`)
      if (!el || hidden.has(anchor.selector)) {
        results.push({ anchor, x: 0, y: 0, targetX: 0, targetY: 0, found: !!el })
        continue
      }
      const rect = el.getBoundingClientRect()
      const targetX = rect.left + rect.width / 2
      const targetY = rect.top + rect.height / 2

      // initial label position based on placement
      let x = targetX
      let y = targetY
      const offset = 40
      switch (anchor.placement) {
        case 'top':    y = rect.top - offset; break
        case 'bottom': y = rect.bottom + offset; break
        case 'left':   x = rect.left - offset; y = targetY; break
        case 'right':  x = rect.right + offset; y = targetY; break
        default: y = rect.top - offset; break
      }

      const size = measured.get(anchor.selector) ?? { width: 160, height: 26 }
      const gap = 8

      // Iteratively push the label until it no longer overlaps any previously
      // placed label. Direction of push depends on the label's placement so
      // labels extend outward from the row of anchors rather than crowding it.
      let box = this.#labelBox(x, y, size.width, size.height, anchor.placement)
      for (let pass = 0; pass < 40; pass++) {
        let collided = false
        for (const q of placedBoxes) {
          if (!this.#boxesOverlap(box, q)) continue
          collided = true
          switch (anchor.placement) {
            case 'bottom':
              y = q.bottom + gap
              break
            case 'left':
            case 'right':
              y = q.bottom + gap + size.height / 2
              break
            case 'top':
            default:
              // for 'top', y represents the label's bottom edge
              y = q.top - gap
              break
          }
          box = this.#labelBox(x, y, size.width, size.height, anchor.placement)
        }
        if (!collided) break
      }

      placedBoxes.push(box)
      results.push({ anchor, x, y, targetX, targetY, found: true })
    }

    this.resolved.set(results)
  }

  #labelBox(
    x: number,
    y: number,
    w: number,
    h: number,
    placement: InstructionAnchor['placement'],
  ): { left: number, top: number, right: number, bottom: number } {
    switch (placement) {
      case 'bottom':
        return { left: x - w / 2, top: y, right: x + w / 2, bottom: y + h }
      case 'left':
        return { left: x - w, top: y - h / 2, right: x, bottom: y + h / 2 }
      case 'right':
        return { left: x, top: y - h / 2, right: x + w, bottom: y + h / 2 }
      case 'top':
      default:
        return { left: x - w / 2, top: y - h, right: x + w / 2, bottom: y }
    }
  }

  #boxesOverlap(
    a: { left: number, top: number, right: number, bottom: number },
    b: { left: number, top: number, right: number, bottom: number },
  ): boolean {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  }
}
