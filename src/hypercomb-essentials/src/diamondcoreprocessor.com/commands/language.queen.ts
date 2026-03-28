// diamondcoreprocessor.com/commands/language.queen.ts

import { QueenBee, type I18nProvider, I18N_IOC_KEY } from '@hypercomb/core'

/**
 * /language — switch the UI locale.
 *
 * Syntax:
 *   /language en         — English
 *   /language en-us      — English (US)
 *   /language ja         — Japanese
 *   /language jp         — Japanese (alias)
 *   /language            — print current locale
 */
export class LanguageQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'language'
  override readonly aliases = ['lang', 'locale']
  override description = 'Switch the UI language — /language en, /language ja'

  protected execute(args: string): void {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    if (!i18n) {
      console.warn('[/language] Localization service not available')
      return
    }

    const requested = args.trim().toLowerCase()

    if (!requested) {
      console.log(`[/language] Current locale: ${i18n.locale}`)
      return
    }

    const locale = LOCALE_ALIASES[requested] ?? requested
    i18n.setLocale(locale)
    console.log(`[/language] Locale set to: ${locale}`)
  }
}

/** Map common aliases to canonical locale codes. */
const LOCALE_ALIASES: Record<string, string> = {
  'jp': 'ja',
  'en-us': 'en',
}

const _language = new LanguageQueenBee()
window.ioc.register('@diamondcoreprocessor.com/LanguageQueenBee', _language)
