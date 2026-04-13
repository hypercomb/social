// diamondcoreprocessor.com/commands/language.queen.ts

import { QueenBee, type I18nProvider, I18N_IOC_KEY } from '@hypercomb/core'

/**
 * /language — switch the UI locale.
 *
 * Syntax:
 *   /language en         — English
 *   /language ja         — Japanese
 *   /language zh         — Chinese (Simplified)
 *   /language es         — Spanish
 *   /language ar         — Arabic
 *   /language pt         — Portuguese
 *   /language fr         — French
 *   /language de         — German
 *   /language ko         — Korean
 *   /language ru         — Russian
 *   /language hi         — Hindi
 *   /language id         — Indonesian
 *   /language tr         — Turkish
 *   /language it         — Italian
 *   /language            — print current locale
 *
 * When an AI API key is configured, TranslationService passively listens
 * for locale:changed and auto-translates visible tile content via Claude,
 * caching each translation as a signature-addressed resource.
 */
export class LanguageQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'language'
  override readonly aliases = []
  override description = 'Switch the UI language (14 languages supported)'
  override descriptionKey = 'slash.language'

  override slashComplete(args: string): readonly string[] {
    const locales = ['en', 'ja', 'zh', 'es', 'ar', 'pt', 'fr', 'de', 'ko', 'ru', 'hi', 'id', 'tr', 'it']
    const q = args.toLowerCase().trim()
    if (!q) return locales
    return locales.filter(l => l.startsWith(q))
  }

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
  'japanese': 'ja',
  'cn': 'zh',
  'chinese': 'zh',
  'spanish': 'es',
  'arabic': 'ar',
  'portuguese': 'pt',
  'br': 'pt',
  'french': 'fr',
  'german': 'de',
  'korean': 'ko',
  'kr': 'ko',
  'russian': 'ru',
  'hindi': 'hi',
  'indonesian': 'id',
  'turkish': 'tr',
  'italian': 'it',
  'en-us': 'en',
}

const _language = new LanguageQueenBee()
window.ioc.register('@diamondcoreprocessor.com/LanguageQueenBee', _language)
