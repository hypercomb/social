// hypercomb-shared/core/from-runtime.ts

import { signal, type Signal, type WritableSignal } from '@angular/core'

/**
 * Bridges an EventTarget property to an Angular Signal.
 *
 * Runtime services (Store, Lineage, ScriptPreloader, etc.) use EventTarget +
 * CustomEvent for change notification so they stay framework-agnostic.
 * Angular components that need reactive updates call fromRuntime() once to
 * create a Signal that auto-updates when the source dispatches 'change'.
 *
 * @param target   The EventTarget instance (the runtime service)
 * @param getter   A function that reads the current value from the service
 * @param event    The event name to listen for (default: 'change')
 */
export function fromRuntime<T>(
  target: EventTarget | undefined | null,
  getter: () => T,
  event = 'change'
): Signal<T> {
  const initial = target ? getter() : undefined as T
  const s: WritableSignal<T> = signal(initial)
  if (target) {
    target.addEventListener(event, () => s.set(getter()))
  }
  return s.asReadonly()
}
