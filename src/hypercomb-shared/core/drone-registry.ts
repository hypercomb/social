// hypercomb-shared/core/drone-registry.ts
//
// Tracks which drones (and their supporting services) are present in IoC.
// UI components query this to gate their own rendering — when a backing
// drone is disabled in DCP, its bee never loads, never self-registers,
// and components depending on it render empty.
//
// Backed by ioc.has() + ioc.onRegister(). Dispatches 'change' on every
// new registration so Angular signals via fromRuntime() update reactively.

import { DestroyRef, inject, signal, type Signal, type WritableSignal } from '@angular/core'

export class DroneRegistry extends EventTarget {

  constructor() {
    super()
    window.ioc.onRegister(() => {
      this.dispatchEvent(new CustomEvent('change'))
    })
  }

  has(...keys: string[]): boolean {
    for (const key of keys) {
      if (!window.ioc.has(key)) return false
    }
    return true
  }

  /**
   * Reactive ready signal. Must be called inside an Angular injection
   * context (component field initializer or constructor) so the listener
   * is cleaned up when the component is destroyed.
   */
  ready(...keys: string[]): Signal<boolean> {
    const s: WritableSignal<boolean> = signal(this.has(...keys))
    const listener = () => {
      const next = this.has(...keys)
      if (next !== s()) s.set(next)
    }
    this.addEventListener('change', listener)
    const destroyRef = inject(DestroyRef, { optional: true })
    destroyRef?.onDestroy(() => this.removeEventListener('change', listener))
    return s.asReadonly()
  }
}

register('@hypercomb.social/DroneRegistry', new DroneRegistry())
