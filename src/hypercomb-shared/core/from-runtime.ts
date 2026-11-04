// hypercomb-shared/core/from-runtime.ts

import { DestroyRef, inject, signal, type Signal, type WritableSignal } from '@angular/core'

export type FromRuntimeOptions<T> = {
  /** When two readings are the same value and nobody need hear about it.
   *  `Object.is` by default; a getter that builds a fresh array on every read
   *  passes a structural compare here so an unchanged list never notifies. */
  equal?: (a: T, b: T) => boolean
  /** Whose life the listener shares. Left out, the injection context's
   *  DestroyRef when there is one (a component's field initializer), so a
   *  component that goes away takes its listener with it; `null` for a
   *  bridge meant to live as long as its target (a module-scope signal). */
  destroyRef?: DestroyRef | null
}

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
 * @param options  Equality and lifetime, see FromRuntimeOptions
 */
export function fromRuntime<T>(
  target: EventTarget | undefined | null,
  getter: () => T,
  event = 'change',
  options: FromRuntimeOptions<T> = {},
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
  // The signal's own equality is the guard: a reading equal to the last one
  // bumps no version and wakes no consumer.
  const s: WritableSignal<T> = signal(initial, { equal: options.equal ?? Object.is })
  if (target) {
    // Defer the signal update to a microtask so it lands AFTER any
    // in-flight Angular change-detection pass completes. Without this,
    // in zoneless mode a synchronous signal update during a runtime event
    // can flip a downstream impure-pipe value mid-pass (e.g. the i18n
    // `| t` pipe returning a key first then a translation) and trigger
    // NG0100 ExpressionChangedAfterItHasBeenChecked.
    //
    // ONE read per burst: a service that dispatches ten 'change' events in
    // one task used to cost ten deferred reads of the same value. The first
    // event schedules the read, the rest find it scheduled.
    let scheduled = false
    const onChange = (): void => {
      if (scheduled) return
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        s.set(getter())
      })
    }
    target.addEventListener(event, onChange)
    // The listener leaves with its owner. A bar, a panel or a header that is
    // destroyed and re-created (dock swaps, view mode changes) used to leave
    // every previous instance's listener on the service, each still reading
    // the getter of a component that was gone.
    const destroyRef = options.destroyRef === undefined ? currentDestroyRef() : options.destroyRef
    destroyRef?.onDestroy(() => target.removeEventListener(event, onChange))
  }
  return s.asReadonly()
}

/** The DestroyRef of the running injection context, or null outside one —
 *  `inject` throws there (NG0203), and a bridge made at module scope or from
 *  a plain function has no owner to follow. */
function currentDestroyRef(): DestroyRef | null {
  try { return inject(DestroyRef) } catch { return null }
}
