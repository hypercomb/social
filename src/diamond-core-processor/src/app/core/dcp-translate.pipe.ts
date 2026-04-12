// dcp-translate.pipe.ts — Angular pipe for DCP template localization
//
// Uses the same IoC-based pattern as the shared TranslatePipe.
// Reads from window.ioc via the standard I18N_IOC_KEY.

import { Pipe, type PipeTransform } from '@angular/core'
import { I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

@Pipe({ name: 't', standalone: true, pure: false })
export class DcpTranslatePipe implements PipeTransform {
  transform(key: string, params?: Record<string, string | number>, namespace?: string): string {
    const i18n = (window as any).ioc?.get(I18N_IOC_KEY) as I18nProvider | undefined
    return i18n?.t(key, params, namespace) ?? key
  }
}
