// diamondcoreprocessor.com/commands/i18n-override.queen.ts
//
// Savvy-user override layer for UI translations.
// Reads/writes `i18n.json` in the sign('overrides') POOL OF MEANING at the
// OPFS root (dir named sha256 of the meaning, derived below — never a
// human-named folder), the same file the runtime initializer consumes on
// boot. The legacy non-signed `overrides/` dir is a read-fallback/drain
// source: Store's boot absorb migrates it into the pool and removes it.
// Shape:
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

// The override layer is a CONTENT-ADDRESSED document in the sign('overrides')
// document pool (Store.putPoolDoc/getPoolDoc): the member is named by
// sign(its bytes), never a human filename. The legacy non-signed
// `overrides/i18n.json` is a read-fallback/drain source — Store's boot absorb
// content-addresses it into the pool and removes it.
const LEGACY_OVERRIDES_DIR = 'overrides'
const OVERRIDES_FILE = 'i18n.json'

type OverrideLayer = Record<string, Record<string, string>>

type StoreDocApi = {
  overrides?: FileSystemDirectoryHandle
  getPoolDoc: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
  putPoolDoc: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string) => Promise<string | null>
}

export class I18nOverrideQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'i18n-override'
  override readonly aliases = []
  override description = 'Override any UI translation (savvy users)'
  override descriptionKey = 'slash.i18n-override'
  override options = ['<locale> <key> <value>', '<locale> <key>', 'reset', 'reset <locale>']
  override examples = [
    { input: '/i18n-override ja editor.save 保存する', result: 'Sets the ja override for editor.save' },
    { input: '/i18n-override reset ja', result: 'Clears all ja overrides (reload to apply)' },
  ]

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

  // Pool is authoritative (writes + reset land there); the legacy
  // `overrides/` dir is the not-yet-drained fallback. Order: pool →
  // legacy → pool AGAIN. The final re-read closes the boot-absorb race —
  // Store's content-addressing absorb writes the pool member BEFORE
  // deleting the legacy file, so if the first pool read missed and legacy
  // then vanished mid-read, the copy has landed and the re-read finds it.
  // First-hit (not merge) so a reset — `{}` written to the pool — wins
  // over stale legacy instead of resurrecting it. Empty only when absent
  // in every read.
  async #read(): Promise<OverrideLayer> {
    const store = get('@hypercomb.social/Store') as StoreDocApi | undefined
    const readPool = async (): Promise<OverrideLayer | null> => {
      if (!store?.overrides) return null
      const buf = await store.getPoolDoc(store.overrides)
      if (!buf) return null
      try { return JSON.parse(new TextDecoder().decode(buf)) as OverrideLayer } catch { return null }
    }
    return (await readPool()) ?? (await this.#readLegacy()) ?? (await readPool()) ?? {}
  }

  async #readLegacy(): Promise<OverrideLayer | null> {
    try {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(LEGACY_OVERRIDES_DIR, { create: false })
      const handle = await dir.getFileHandle(OVERRIDES_FILE, { create: false })
      return JSON.parse(await (await handle.getFile()).text()) as OverrideLayer
    } catch { return null }
  }

  async #write(layer: OverrideLayer): Promise<void> {
    const store = get('@hypercomb.social/Store') as StoreDocApi | undefined
    if (!store?.overrides) return
    const bytes = new TextEncoder().encode(JSON.stringify(layer, null, 2)).buffer as ArrayBuffer
    await store.putPoolDoc(store.overrides, bytes)
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
