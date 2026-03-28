// hypercomb-shared/core/i18n.signal.ts
//
// Signal-based i18n helper for Angular component classes.
// Re-evaluates automatically when the locale changes.
//
// Usage:
//   readonly greeting = ti18n('activity.added', { seed: 'hello' })
//   // in template: {{ greeting() }}

import type { Signal } from '@angular/core'
import type { I18nProvider } from '@hypercomb/core'
import { fromRuntime } from './from-runtime'
import { LocalizationService } from './i18n.service'

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
