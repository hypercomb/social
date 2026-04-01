// hypercomb-shared/ui/toast/toast.component.ts
//
// Renders stacked toast notifications. Subscribes to ToastDrone state via
// fromRuntime(). No business logic — just rendering + forwarding actions.

import { Component, computed, type OnDestroy } from '@angular/core'
import { fromRuntime } from '../../core/from-runtime'
import { TranslatePipe } from '../../core/i18n.pipe'

import type { Toast } from
  '@hypercomb/essentials/diamondcoreprocessor.com/commands/toast.drone'

@Component({
  selector: 'hc-toast',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './toast.component.html',
  styleUrls: ['./toast.component.scss'],
})
export class ToastComponent implements OnDestroy {

  #drone: any

  private readonly state$ = fromRuntime(
    get('@diamondcoreprocessor.com/ToastDrone') as EventTarget,
    () => (this.#drone?.toasts ?? []) as readonly Toast[],
  )

  readonly toasts = computed(() => this.state$())
  readonly hasToasts = computed(() => this.state$().length > 0)

  constructor() {
    this.#drone = get('@diamondcoreprocessor.com/ToastDrone')
  }

  dismiss(id: number): void {
    this.#drone?.dismiss?.(id)
  }

  executeAction(id: number): void {
    this.#drone?.executeAction?.(id)
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
    this.#drone = undefined
  }
}
