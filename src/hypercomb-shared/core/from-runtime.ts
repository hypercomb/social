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
  // Run the getter even when the target service is missing — getters are
  // written null-safe by convention (`this.#svc?.value ?? fallback`), so
  // they supply their own fallback shape ([] / '' / default). Initializing
  // to bare `undefined` instead handed every consumer a permanently
  // undefined signal (no listener ever attaches without a target), which
  // is how toast.component's `state$().length` crashed on a shell whose
  // drone never registered. try/catch keeps the old behavior for getters
  // that genuinely can't run without the service.
  let initial: T
  try { initial = getter() } catch { initial = undefined as T }
  const s: WritableSignal<T> = signal(initial)
  if (target) {
    // Defer the signal update to a microtask so it lands AFTER any
    // in-flight Angular change-detection pass completes. Without this,
    // in zoneless mode a synchronous signal update during a runtime event
    // can flip a downstream impure-pipe value mid-pass (e.g. the i18n
    // `| t` pipe returning a key first then a translation) and trigger
    // NG0100 ExpressionChangedAfterItHasBeenChecked.
    target.addEventListener(event, () => {
      queueMicrotask(() => s.set(getter()))
    })
  }
  return s.asReadonly()
}
