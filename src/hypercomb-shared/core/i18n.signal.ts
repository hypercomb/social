// hypercomb-shared/core/i18n.signal.ts
//
// Signal-based i18n helpers for Angular component classes.
//
//   readonly greeting = ti18n('activity.added', { cell: 'hello' })
//   // in template: {{ greeting() }}
//
// and the catalog's version as ONE signal for the whole shell, which the `| t`
// pipe reads so a view that shows words is marked for refresh exactly when a
// word can have changed (see i18n.pipe.ts).

import type { Signal } from '@angular/core'
import type { I18nProvider } from '@hypercomb/core'
import { fromRuntime } from './from-runtime'
import { LocalizationService } from '@hypercomb/runtime/i18n.service'

export function ti18n(
  key: string,
  params?: Record<string, string | number>,
  namespace?: string,
): Signal<string> {
  const i18n = get('@hypercomb.social/I18n') as (LocalizationService & I18nProvider) | undefined
  return fromRuntime(
    i18n,
    () => i18n?.t(key, params, namespace) ?? key,
    'change',
  )
}

let version$: Signal<number> | undefined

/** The catalog's version (LocalizationService.version) read through a signal.
 *
 *  One signal, made on first read and kept for the shell's lifetime: every
 *  `| t` binding reads it, so every view that shows words is a consumer of it
 *  and is refreshed — only those views, only then — when the locale flips or a
 *  catalog lands. It moves in the microtask after the service's 'change'
 *  event (fromRuntime's own deferral), never inside the pass that wrote the
 *  catalog: the same rule the service's deferred dispatch keeps, so a boot
 *  that registers catalogs mid-render never trips NG0100.
 *
 *  Before the service is registered there is nothing to listen to; 0 is
 *  returned and the next read tries again. */
export function catalogVersion(): number {
  if (!version$) {
    const i18n = get('@hypercomb.social/I18n') as LocalizationService | undefined
    if (!i18n) return 0
    version$ = fromRuntime(i18n, () => i18n.version, 'change')
  }
  return version$()
}
