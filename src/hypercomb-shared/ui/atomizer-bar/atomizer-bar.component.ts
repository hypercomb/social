// hypercomb-shared/ui/atomizer-bar/atomizer-bar.component.ts
//
// Vertical floating toolbar showing registered atomizers as draggable icons.
// Drag an atomizer onto any matching control to break it apart and expose
// its configurable properties in a sidebar.

import {
  Component,
  computed,
  signal,
  type OnInit,
  type OnDestroy,
} from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import type { Atomizer } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

const get = (key: string) => (globalThis as any).ioc?.get(key)

@Component({
  selector: 'hc-atomizer-bar',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './atomizer-bar.component.html',
  styleUrls: ['./atomizer-bar.component.scss'],
})
export class AtomizerBarComponent implements OnInit, OnDestroy {

  // ── state ──────────────────────────────────────────────

  /** Whether the atomizer bar is visible */
  readonly visible = signal(false)

  /** Registered atomizers available in the toolbar */
  readonly atomizers = signal<Atomizer[]>([])

  /** Currently dragging atomizer (null if not dragging) */
  readonly dragging = signal<Atomizer | null>(null)

  /** Whether the current drag is over a valid drop target */
  readonly overValidTarget = signal(false)

  /** Active atomizer (one that's been dropped and is showing properties) */
  readonly activeAtomizer = signal<Atomizer | null>(null)

  readonly atomizerCount = computed(() => this.atomizers().length)

  // ── lifecycle ──────────────────────────────────────────

  #toggleUnsub: (() => void) | null = null
  #registerUnsub: (() => void) | null = null
  #dropResultUnsub: (() => void) | null = null

  ngOnInit(): void {
    // Toggle bar visibility
    this.#toggleUnsub = EffectBus.on<{ active: boolean }>(
      'atomizer-bar:toggle',
      ({ active }) => this.visible.set(active),
    )

    // Listen for atomizer registrations
    this.#registerUnsub = EffectBus.on<{ atomizer: Atomizer }>(
      'atomizer:registered',
      ({ atomizer }) => {
        this.atomizers.update(list => {
          // Avoid duplicates
          if (list.some(a => a.atomizerId === atomizer.atomizerId)) return list
          return [...list, atomizer]
        })
      },
    )

    // Listen for successful drop results
    this.#dropResultUnsub = EffectBus.on<{ atomizer: Atomizer }>(
      'atomizer:dropped',
      ({ atomizer }) => {
        this.activeAtomizer.set(atomizer)
      },
    )
  }

  ngOnDestroy(): void {
    this.#toggleUnsub?.()
    this.#registerUnsub?.()
    this.#dropResultUnsub?.()
  }

  // ── actions ────────────────────────────────────────────

  readonly toggle = (): void => {
    this.visible.update(v => !v)
  }

  readonly close = (): void => {
    this.visible.set(false)
    this.activeAtomizer.set(null)
    EffectBus.emit('atomizer-bar:toggle', { active: false })
  }

  // ── drag handling ──────────────────────────────────────

  readonly onDragStart = (event: DragEvent, atomizer: Atomizer): void => {
    if (!event.dataTransfer) return

    event.dataTransfer.setData('application/x-atomizer-id', atomizer.atomizerId)
    event.dataTransfer.effectAllowed = 'copy'
    this.dragging.set(atomizer)

    // Notify the system so drop targets can highlight
    EffectBus.emit('atomizer:drag-start', {
      atomizerId: atomizer.atomizerId,
      targetTypes: atomizer.targetTypes,
    })
  }

  readonly onDragEnd = (_event: DragEvent): void => {
    this.dragging.set(null)
    this.overValidTarget.set(false)
    EffectBus.emit('atomizer:drag-end', {})
  }
}
