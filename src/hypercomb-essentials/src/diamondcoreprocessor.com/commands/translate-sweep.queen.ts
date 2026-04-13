// diamondcoreprocessor.com/commands/translate-sweep.queen.ts

import { QueenBee } from '@hypercomb/core'
import type { TranslationService } from './translation.service.js'

/**
 * /translate-sweep — batch-translate all tile labels and content to target locale(s).
 *
 * Syntax:
 *   /translate-sweep                 — dry-run estimate for current locale
 *   /translate-sweep ja              — dry-run estimate for Japanese
 *   /translate-sweep ja --go         — actually run the sweep for Japanese
 *   /translate-sweep all             — dry-run for all supported locales
 *   /translate-sweep all --go        — run for all supported locales
 *
 * Dry-run is the default. The sweep dedupes by signature, skips trivial strings
 * (numeric, URLs, emoji-only), batches 40 strings per API call, and uses
 * prompt caching — so repeat runs cost nothing for already-translated content.
 */
export class TranslateSweepQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'translate-sweep'
  override readonly aliases = ['translate']
  override description = 'Batch-translate all tiles (dry-run by default; add --go to execute)'
  override descriptionKey = 'slash.translate-sweep'

  override slashComplete(args: string): readonly string[] {
    const locales = ['en', 'ja', 'zh', 'es', 'ar', 'pt', 'fr', 'de', 'ko', 'ru', 'hi', 'id', 'tr', 'it', 'all']
    const parts = args.split(/\s+/).filter(Boolean)
    const last = parts[parts.length - 1]?.toLowerCase() ?? ''

    if (parts.length >= 1 && locales.includes(parts[0]?.toLowerCase() ?? '')) {
      if (parts.length === 1) return ['--go']
      if (last === '-' || last.startsWith('--')) {
        return ['--go'].filter(s => s.startsWith(last))
      }
    }

    if (!last) return locales
    return locales.filter(l => l.startsWith(last))
  }

  protected async execute(args: string): Promise<void> {
    const svc = get('@diamondcoreprocessor.com/TranslationService') as TranslationService | undefined
    if (!svc) {
      console.warn('[/translate-sweep] TranslationService unavailable')
      return
    }

    const tokens = args.trim().split(/\s+/).filter(Boolean)
    const go = tokens.includes('--go')
    const positional = tokens.filter((t) => t !== '--go')
    const target = positional[0] ?? ''

    const i18n = get('@hypercomb.social/I18n') as { locale: string } | undefined
    const locales = target === 'all'
      ? SUPPORTED_LOCALES
      : [target || i18n?.locale || 'en']

    if (!go) {
      console.log('[/translate-sweep] dry-run — pass --go to execute')
      for (const locale of locales) {
        const est = await svc.estimate(locale)
        console.log(
          `  ${locale.padEnd(3)}  unique=${est.uniqueStrings}  cached=${est.cached}  skipped=${est.skipped}  `
          + `to-translate=${est.toTranslate}  batches=${est.batches}  `
          + `~tokens in/out=${est.estimatedInputTokens}/${est.estimatedOutputTokens}`,
        )
      }
      return
    }

    for (const locale of locales) {
      console.log(`[/translate-sweep] running for ${locale}…`)
      await svc.translateTiles(locale)
      console.log(`[/translate-sweep] finished ${locale}`)
    }
  }
}

const SUPPORTED_LOCALES = [
  'en', 'ja', 'zh', 'es', 'ar', 'pt', 'fr', 'de',
  'ko', 'ru', 'hi', 'id', 'tr', 'it',
]

const _sweep = new TranslateSweepQueenBee()
window.ioc.register('@diamondcoreprocessor.com/TranslateSweepQueenBee', _sweep)
