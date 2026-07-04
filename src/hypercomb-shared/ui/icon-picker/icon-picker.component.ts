// hypercomb-shared/ui/icon-picker/icon-picker.component.ts
//
// The icon-hive picker — the "choose an icon" chooser for the universal icon
// protocol. Opens on `icon:pick-request { id }` (emitted when a participating
// icon is tapped in edit mode), shows a searchable honeycomb of Material icons,
// and on click saves the pick as that element's override (IconOverrideStore),
// which every surface re-resolves live.
//
// Rendered as a DOM honeycomb modal (hexagon-clipped tiles) — same hive look +
// click-to-choose UX, self-contained as a chooser. A canvas-integrated Pixi
// version could replace this later behind the same `icon:pick-request` effect.

import { Component, OnDestroy, computed, signal } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { iconOverrides } from '../../core/icon-override.store'
import { MATERIAL_ICON_NAMES } from './material-icon-names'

@Component({
  selector: 'hc-icon-picker',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './icon-picker.component.html',
  styleUrls: ['./icon-picker.component.scss'],
})
export class IconPickerComponent implements OnDestroy {
  readonly open = signal(false)
  readonly filter = signal('')
  readonly total = MATERIAL_ICON_NAMES.length
  readonly icons = computed(() => {
    const f = this.filter().trim().toLowerCase()
    return f ? MATERIAL_ICON_NAMES.filter(n => n.includes(f)) : MATERIAL_ICON_NAMES
  })

  #pendingId: string | null = null
  #unsub: (() => void) | null = null

  constructor() {
    this.#unsub = EffectBus.on<{ id?: string }>('icon:pick-request', ({ id }) => {
      if (!id) return
      this.#pendingId = id
      this.filter.set('')
      this.open.set(true)
      EffectBus.emit('icon:picker-open', { open: true })
      // Capture-phase so our Escape closes the picker BEFORE the edit-mode
      // Escape handler (which would otherwise also exit edit mode).
      document.addEventListener('keydown', this.#onKey, true)
    })
  }

  ngOnDestroy(): void {
    this.#unsub?.()
    document.removeEventListener('keydown', this.#onKey, true)
  }

  onFilter(e: Event): void {
    this.filter.set((e.target as HTMLInputElement)?.value ?? '')
  }

  clearFilter(el?: HTMLInputElement): void {
    this.filter.set('')
    el?.focus()
  }

  choose(name: string): void {
    if (this.#pendingId) iconOverrides.set(this.#pendingId, name)
    this.close()
  }

  close(): void {
    if (!this.open()) return
    this.open.set(false)
    this.#pendingId = null
    EffectBus.emit('icon:picker-open', { open: false })
    document.removeEventListener('keydown', this.#onKey, true)
  }

  #onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopImmediatePropagation()
      e.preventDefault()
      this.close()
    }
  }
}
