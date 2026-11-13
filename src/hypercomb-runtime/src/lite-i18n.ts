// hypercomb-runtime/src/lite-i18n.ts
//
// THE `| t` PIPE, LITE — for templates built with lite-template.ts. Angular's
// TranslatePipe (hypercomb-shared/core/i18n.pipe.ts) answers
// `i18n.t(key, params, namespace) ?? key` and re-reads it when the catalog's
// version moves; this does the same, reading the version through a lite
// signal, so a view that shows words is refreshed when the locale flips or a
// catalog lands — and moves a microtask after the service's 'change' event,
// as fromRuntime does, never inside the pass that wrote the catalog.

import type { I18nProvider } from '@hypercomb/core'
import { signal, type WritableSignal } from './lite-signals'

type Localization = I18nProvider & EventTarget & { readonly version: number }

const I18N_KEY = '@hypercomb.social/I18n'
const service = (): Localization | undefined =>
  (globalThis as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(I18N_KEY) as Localization | undefined

let version$: WritableSignal<number> | undefined

/** The catalog's version, as a signal (0 until the service is registered; the next read tries again). */
export function catalogVersion(): number {
  if (!version$) {
    const i18n = service()
    if (!i18n) return 0
    const v = version$ = signal(i18n.version)
    i18n.addEventListener('change', () => queueMicrotask(() => v.set(i18n.version)))
  }
  return version$()
}

/** `'key' | t : params : namespace` */
export function t(key: string, params?: Record<string, string | number>, namespace?: string): string {
  catalogVersion()
  return service()?.t(key, params, namespace) ?? key
}
