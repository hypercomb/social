// hypercomb-shared/ui/atomizer-bar/atomizer-sidebar.component.ts
//
// Property sidebar — appears when an atomizer is dropped on a valid target.
// Renders the discovered properties as editable controls (color pickers,
// sliders, text inputs, toggles, etc.). Editing a property calls
// atomizer.apply() in real time.

import {
  Component,
  computed,
  signal,
  type OnInit,
  type OnDestroy,
} from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import type { Atomizer, AtomizableTarget, AtomizerProperty } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

@Component({
  selector: 'hc-atomizer-sidebar',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './atomizer-sidebar.component.html',
  styleUrls: ['./atomizer-sidebar.component.scss'],
})
export class AtomizerSidebarComponent implements OnInit, OnDestroy {

  readonly visible = signal(false)
  readonly atomizer = signal<Atomizer | null>(null)
  readonly target = signal<AtomizableTarget | null>(null)
  readonly properties = signal<AtomizerProperty[]>([])

  // ── sidebar zoom (scales with viewport width) ─────────────
  // Baseline 0.75 at 1920px wide (75% of the previous fixed size).
  // Scales up linearly on larger monitors; clamped on small/huge screens.
  readonly #sidebarZoom = signal(this.#computeSidebarZoom())
  readonly sidebarZoom = this.#sidebarZoom.asReadonly()

  #computeSidebarZoom(): number {
    const ratio = window.innerWidth / 1920
    return Math.max(0.675, Math.min(ratio * 0.75, 1.2))
  }

  #onResize = (): void => {
    this.#sidebarZoom.set(this.#computeSidebarZoom())
  }

  /** Group properties by their group name */
  readonly groupedProperties = computed(() => {
    const props = this.properties()
    const groups = new Map<string, AtomizerProperty[]>()
    for (const prop of props) {
      const group = prop.group ?? 'general'
      const list = groups.get(group) ?? []
      list.push(prop)
      groups.set(group, list)
    }
    return [...groups.entries()]
  })

  #propertiesUnsub: (() => void) | null = null

  ngOnInit(): void {
    this.#propertiesUnsub = EffectBus.on<{
      atomizer: Atomizer
      target: AtomizableTarget
      properties: AtomizerProperty[]
    }>('atomizer:properties', ({ atomizer, target, properties }) => {
      this.atomizer.set(atomizer)
      this.target.set(target)
      this.properties.set(properties)
      this.visible.set(true)
    })

    window.addEventListener('resize', this.#onResize)
  }

  ngOnDestroy(): void {
    this.#propertiesUnsub?.()
    window.removeEventListener('resize', this.#onResize)
  }

  readonly close = (): void => {
    this.visible.set(false)
    this.atomizer.set(null)
    this.target.set(null)
    this.properties.set([])
  }

  readonly reset = (): void => {
    const a = this.atomizer()
    const t = this.target()
    if (!a || !t) return
    a.reset(t)
    // Re-discover to refresh values
    const refreshed = a.discover(t)
    this.properties.set(refreshed)
  }

  readonly onPropertyChange = (prop: AtomizerProperty, value: string | number | boolean): void => {
    const a = this.atomizer()
    const t = this.target()
    if (!a || !t) return

    // Update local state
    prop.value = value

    // Apply to the target in real time
    a.apply(t, prop.key, value)
  }

  readonly onInputChange = (prop: AtomizerProperty, event: Event): void => {
    const el = event.target as HTMLInputElement
    let value: string | number | boolean = el.value

    if (prop.type === 'number' || prop.type === 'range') {
      value = parseFloat(el.value) || 0
    } else if (prop.type === 'boolean') {
      value = el.checked
    }

    this.onPropertyChange(prop, value)
  }

  readonly onSelectChange = (prop: AtomizerProperty, event: Event): void => {
    const el = event.target as HTMLSelectElement
    this.onPropertyChange(prop, el.value)
  }
}
