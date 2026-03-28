// hypercomb-shared/core/i18n.pipe.ts
//
// Angular pipe for template localization.
// Usage:  {{ 'key' | t }}   or   {{ 'key' | t: { count: 5 } }}

import { Pipe, type PipeTransform } from '@angular/core'
import type { I18nProvider } from '@hypercomb/core'

@Pipe({ name: 't', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  transform(key: string, params?: Record<string, string | number>, namespace?: string): string {
    const i18n = get('@hypercomb.social/I18n') as I18nProvider | undefined
    return i18n?.t(key, params, namespace) ?? key
  }
}
