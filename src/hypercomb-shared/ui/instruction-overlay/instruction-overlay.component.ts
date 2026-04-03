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

    const results: ResolvedAnchor[] = []
    for (const anchor of anchors) {
      const el = document.querySelector(`[data-instruction="${anchor.selector}"]`)
      if (!el) {
        results.push({ anchor, x: 0, y: 0, targetX: 0, targetY: 0, found: false })
        continue
      }
      const rect = el.getBoundingClientRect()
      const targetX = rect.left + rect.width / 2
      const targetY = rect.top + rect.height / 2

      // offset label based on placement
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

      results.push({ anchor, x, y, targetX, targetY, found: true })
    }

    // simple collision avoidance: push overlapping labels apart vertically
    results.sort((a, b) => a.y - b.y)
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1]
      const curr = results[i]
      if (curr.found && prev.found && Math.abs(curr.y - prev.y) < 28 && Math.abs(curr.x - prev.x) < 120) {
        curr.y = prev.y + 28
      }
    }

    this.resolved.set(results)
  }
}
