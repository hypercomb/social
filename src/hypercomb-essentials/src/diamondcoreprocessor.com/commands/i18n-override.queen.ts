// diamondcoreprocessor.com/commands/i18n-override.queen.ts
//
// Savvy-user override layer for UI translations.
// Reads/writes /overrides/i18n.json in OPFS — the same file the runtime
// initializer consumes on boot. Shape:
//   { "<locale>": { "<key>": "<value>", ... }, ... }
//
// Usage:
//   /i18n-override ja editor.save  保存する         — set ja override for editor.save
//   /i18n-override en editor.save  Save            — set en override
//   /i18n-override ja editor.save                  — remove ja override for editor.save
//   /i18n-override                                 — print the full override layer
//   /i18n-override reset                           — wipe all overrides
//   /i18n-override reset ja                        — wipe all overrides for ja

import { QueenBee, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

const OVERRIDES_PATH = 'overrides/i18n.json'

type OverrideLayer = Record<string, Record<string, string>>

export class I18nOverrideQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'i18n-override'
  override readonly aliases = []
  override description = 'Override any UI translation (savvy users)'
  override descriptionKey = 'slash.i18n-override'

  override slashComplete(args: string): readonly string[] {
    const parts = args.split(/\s+/)
    const locales = ['en', 'ja', 'zh', 'es', 'ar', 'pt', 'fr', 'de', 'ko', 'ru', 'hi', 'id', 'tr', 'it']
    const first = parts[0]?.toLowerCase() ?? ''

    if (parts.length <= 1) {
      const all = ['reset', ...locales]
      if (!first) return all
      return all.filter(s => s.startsWith(first))
    }

    if (first === 'reset' && parts.length === 2) {
      const q = (parts[1] ?? '').toLowerCase()
      if (!q) return locales
      return locales.filter(l => l.startsWith(q))
    }

    return []
  }

  protected async execute(args: string): Promise<void> {
    const trimmed = args.trim()

    if (!trimmed) {
      const layer = await this.#read()
      console.log('[i18n-override]', JSON.stringify(layer, null, 2))
      return
    }

    if (trimmed === 'reset') {
      await this.#write({})
      console.log('[i18n-override] cleared all overrides (reload to apply)')
      return
    }

    const resetMatch = trimmed.match(/^reset\s+(\S+)$/)
    if (resetMatch) {
      const locale = resetMatch[1]!
      const layer = await this.#read()
      delete layer[locale]
      await this.#write(layer)
      console.log(`[i18n-override] cleared overrides for locale "${locale}" (reload to apply)`)
      return
    }

    // Normal form: <locale> <key> [value...]
    const parts = trimmed.split(/\s+/)
    if (parts.length < 2) {
      console.warn('[i18n-override] usage: /i18n-override <locale> <key> [value]')
      return
    }

    const locale = parts[0]!
    const key = parts[1]!
    const value = parts.slice(2).join(' ').trim()

    const layer = await this.#read()

    if (!value) {
      // No value → remove the key from this locale's overrides
      if (layer[locale]) {
        delete layer[locale]![key]
        if (!Object.keys(layer[locale]!).length) delete layer[locale]
      }
      await this.#write(layer)
      console.log(`[i18n-override] removed ${locale}:${key} — reload to see the change`)
      return
    }

    layer[locale] ??= {}
    layer[locale]![key] = value
    await this.#write(layer)
    this.#applyLive(locale, layer[locale]!)
    console.log(`[i18n-override] set ${locale}:${key} = "${value}"`)
  }

  async #read(): Promise<OverrideLayer> {
    try {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle('overrides', { create: false })
      const handle = await dir.getFileHandle('i18n.json', { create: false })
      const file = await handle.getFile()
      return JSON.parse(await file.text()) as OverrideLayer
    } catch {
      return {}
    }
  }

  async #write(layer: OverrideLayer): Promise<void> {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle('overrides', { create: true })
    const handle = await dir.getFileHandle('i18n.json', { create: true })
    const writable = await handle.createWritable()
    await writable.write(JSON.stringify(layer, null, 2))
    await writable.close()
  }

  #applyLive(locale: string, catalog: Record<string, string>): void {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    if (!i18n) return
    // Re-register the full locale layer so removed keys stop shadowing.
    i18n.registerOverrides('app', locale, catalog)
  }
}

const _i18nOverride = new I18nOverrideQueenBee()
window.ioc.register('@diamondcoreprocessor.com/I18nOverrideQueenBee', _i18nOverride)
