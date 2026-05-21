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
 * @param targetOrKey  Either the EventTarget instance directly, or an IoC
 *                     key string. When a string is passed, fromRuntime first
 *                     tries `ioc.get(key)`; if the target isn't registered
 *                     yet, it subscribes via `ioc.whenReady` and attaches the
 *                     listener once the target arrives. Existing
 *                     `get(...) as EventTarget` callers keep working — they
 *                     hit the EventTarget overload.
 * @param getter   A function that reads the current value from the service
 * @param event    The event name to listen for (default: 'change')
 */
export function fromRuntime<T>(
  targetOrKey: EventTarget | string | undefined | null,
  getter: () => T,
  event = 'change'
): Signal<T> {
  // Defer the signal update to a microtask so it lands AFTER any
  // in-flight Angular change-detection pass completes. Without this,
  // in zoneless mode a synchronous signal update during a runtime event
  // can flip a downstream impure-pipe value mid-pass (e.g. the i18n
  // `| t` pipe returning a key first then a translation) and trigger
  // NG0100 ExpressionChangedAfterItHasBeenChecked.
  const s: WritableSignal<T> = signal(undefined as T)

  const attach = (target: EventTarget): void => {
    target.addEventListener(event, () => {
      queueMicrotask(() => s.set(getter()))
    })
    // Sync the initial value from the now-attached target. Done in a
    // microtask so it doesn't conflict with the construction-time getter
    // call below.
    queueMicrotask(() => s.set(getter()))
  }

  if (typeof targetOrKey === 'string') {
    // String overload: lazy-resolve through IoC so signals stay live even
    // when the target hasn't registered yet at construction time. Without
    // this, a component instantiated before its backing service registers
    // would get a permanently-stuck signal that never updates.
    const ioc = window.ioc
    const existing = ioc?.get<EventTarget>(targetOrKey)
    if (existing) {
      s.set(getter())
      attach(existing)
    } else {
      // Wait for the target to register, then bind. Initial signal value
      // stays at undefined until then (matches the prior behavior for
      // targetOrKey === undefined callers).
      ioc?.whenReady?.(targetOrKey, (value: unknown) => {
        if (value && typeof (value as EventTarget).addEventListener === 'function') {
          attach(value as EventTarget)
        }
      })
    }
  } else if (targetOrKey) {
    s.set(getter())
    attach(targetOrKey)
  }
  // else: targetOrKey is null/undefined — signal stays at undefined, no listener attached.

  return s.asReadonly()
}
