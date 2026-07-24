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

import { registerShellSurface } from '../../core/shell-surface-registry'
import { Component, OnDestroy, computed, signal } from '@angular/core'
import {
  EffectBus,
  ICON_PICKER_OPEN,
  ICON_PICK_REQUEST,
  ICON_PICK_RESULT,
  type IconPickRequest,
  type IconPickResult,
} from '@hypercomb/core'
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

  /** Chooser heading when the requester supplied one. Null = the default
   *  i18n title. Lets a window say what it is choosing an icon FOR. */
  readonly title = signal<string | null>(null)

  /** The request currently on screen, or null when the chooser is closed.
   *  Held whole (not as loose fields) so settling it is one atomic step. */
  #pending: IconPickRequest | null = null
  /** Tokens already settled — a replayed request (the request event carries
   *  a last value, so a chooser that remounts would see the last one again)
   *  must not reopen a chooser the user already dismissed. */
  readonly #settled = new Set<string>()
  #unsub: (() => void) | null = null

  constructor() {
    this.#unsub = EffectBus.on<IconPickRequest>(ICON_PICK_REQUEST, (req) => {
      const id = req?.id
      if (!id) return
      if (req.token && this.#settled.has(req.token)) return   // replayed, already answered
      // A second request while one is open supersedes it — settle the first
      // as cancelled so its awaiter never hangs.
      this.#settle(null)
      this.#pending = req
      this.filter.set(typeof req.filter === 'string' ? req.filter : '')
      this.title.set(typeof req.title === 'string' && req.title.trim() ? req.title : null)
      this.open.set(true)
      EffectBus.emit(ICON_PICKER_OPEN, { open: true })
      // Capture-phase so our Escape closes the picker BEFORE the edit-mode
      // Escape handler (which would otherwise also exit edit mode).
      document.addEventListener('keydown', this.#onKey, true)
    })
  }

  ngOnDestroy(): void {
    this.#settle(null)          // never strand an awaiting caller
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
    this.#settle(name)
    this.close()
  }

  close(): void {
    if (!this.open()) return
    this.#settle(null)          // closing without a pick IS a cancellation
    this.open.set(false)
    this.title.set(null)
    EffectBus.emit(ICON_PICKER_OPEN, { open: false })
    document.removeEventListener('keydown', this.#onKey, true)
  }

  /** Answer the outstanding request exactly once. `name` null = cancelled.
   *  In write-through mode (the default) the pick also lands in the icon
   *  override store, which is what makes every surface re-resolve live.
   *
   *  Emitted TRANSIENTLY: a completion signal stored as EffectBus's last
   *  value would replay into the next request's listener and settle it
   *  before the chooser even opened. */
  #settle(name: string | null): void {
    const req = this.#pending
    if (!req) return
    this.#pending = null
    if (req.token) this.#settled.add(req.token)
    if (name && req.store !== false) iconOverrides.set(req.id, name)
    EffectBus.emitTransient<IconPickResult>(ICON_PICK_RESULT, { id: req.id, token: req.token, name })
  }

  #onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopImmediatePropagation()
      e.preventDefault()
      this.close()
    }
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-icon-picker',
  owner: '@hypercomb.shared/IconPickerComponent',
  component: IconPickerComponent,
  order: 250,
})
