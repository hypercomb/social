// hypercomb-shared/ui/toast/toast.component.ts
//
// Renders stacked toast notifications from ToastDrone's state. No business
// logic — just rendering + forwarding actions.
//
// BOUND WHEN THE DRONE ARRIVES. The web shell loads ToastDrone with the bees,
// about a second AFTER this component is built; a lookup made only in the
// constructor found nothing there and never listened again, so the live shell
// showed no toast at all while the drone held them (found 2026-10-23 by the
// live session-start check). The dev shell imports the drone first, which hid it.

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { Component, computed, signal, type OnDestroy } from '@angular/core'
import { TranslatePipe } from '../../core/i18n.pipe'

import type { Toast } from
  '@hypercomb/essentials/commands/toast.drone'

const TOAST_DRONE_KEY = '@diamondcoreprocessor.com/ToastDrone'

@Component({
  selector: 'hc-toast',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './toast.component.html',
  styleUrls: ['./toast.component.scss'],
})
export class ToastComponent implements OnDestroy {

  #drone: any
  #release: (() => void) | undefined
  #destroyed = false
  readonly #state = signal<readonly Toast[]>([])

  readonly toasts = computed(() => this.#state())
  readonly hasToasts = computed(() => this.#state().length > 0)

  constructor() {
    window.ioc.whenReady<EventTarget>(TOAST_DRONE_KEY, drone => this.#attach(drone))
  }

  #attach(drone: EventTarget): void {
    if (this.#destroyed || !drone?.addEventListener || this.#drone) return
    this.#drone = drone
    const read = (): void => this.#state.set((this.#drone?.toasts ?? []) as readonly Toast[])
    // A microtask, as fromRuntime does: the update lands after any change
    // detection pass in flight, never inside it (NG0100).
    const onChange = (): void => queueMicrotask(read)
    drone.addEventListener('change', onChange)
    this.#release = () => drone.removeEventListener('change', onChange)
    read()
  }

  dismiss(id: number): void {
    this.#drone?.dismiss?.(id)
  }

  executeAction(id: number): void {
    this.#drone?.executeAction?.(id)
  }

  /** Multi-action variant. Mounted via the toast's `actions` array. */
  executeActionAt(id: number, index: number): void {
    this.#drone?.executeActionAt?.(id, index)
  }

  typeIcon(type: string): string {
    switch (type) {
      case 'tip':     return '\u2728'  // sparkles
      case 'success': return '\u2713'  // check
      case 'warning': return '\u26A0'  // warning
      default:        return '\u2139'  // info circle
    }
  }

  ngOnDestroy(): void {
    this.#destroyed = true
    this.#release?.()
    this.#drone = undefined
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-toast',
  owner: '@hypercomb.shared/ToastComponent',
  component: ToastComponent,
  order: 320,
})
