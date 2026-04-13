// diamondcoreprocessor.com/commands/translation.service.ts
//
// AI-powered translation with signature-addressed caching.
// Translates text content via Claude, stores the translation as a resource,
// and caches the mapping (originalSig:locale → translatedSig) so future
// lookups are instant — no AI call needed.

import { EffectBus, SignatureService, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { callAnthropic, callAnthropicBatch, getApiKey, MODELS } from '../assistant/llm-api.js'

// Translation cache: per-locale JSON files in OPFS at /translations/<locale>.json.
// localStorage is NOT used — it doesn't scale past a few MB and doesn't belong
// holding bulk language data. The OPFS files are plain bytes: editable, shareable,
// signable, and user-accessible via any OPFS tool. Shape per file:
//   { "<sourceSig>": "<translatedSig>", ... }
const PROPS_INDEX_KEY = 'hc:tile-props-index'
const TRANSLATIONS_DIR = 'translations'
const BATCH_SIZE = 40

type StoreLike = {
  putResource: (blob: Blob) => Promise<string>
  getResource: (sig: string) => Promise<Blob | null>
}

type LocaleMap = Record<string, string> // sourceSig → translatedSig for one locale

export type SweepEstimate = {
  locale: string
  uniqueStrings: number
  cached: number
  skipped: number
  toTranslate: number
  batches: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
}

/**
 * Manages AI translations of content-addressed resources.
 *
 * Each translation is itself a resource — its signature can be used
 * as a starting point for further AI operations without re-translating.
 */
export class TranslationService extends EventTarget {

  // In-memory mirror of per-locale OPFS files, lazy-loaded on first access.
  #cache = new Map<string, LocaleMap>()
  #translating = false

  constructor() {
    super()

    // On locale change: hydrate cached translations into i18n immediately (free),
    // then run a sweep for anything missing if an API key is configured.
    EffectBus.on('locale:changed', (payload: { locale: string }) => {
      void (async () => {
        await this.hydrateCatalog(payload.locale)
        if (!this.#translating && getApiKey()) {
          void this.translateTiles(payload.locale)
        }
      })()
    })

    // Hydrate current locale on boot so returning users see cached labels without API calls.
    // whenReady waits for both the I18n service and the Store to be registered, so we
    // avoid a race where hydration sees either as undefined.
    window.ioc.whenReady(I18N_IOC_KEY, (i18n: I18nProvider) => {
      window.ioc.whenReady('@hypercomb.social/Store', () => {
        void (async () => {
          await this.#migrateLegacyLocalStorageCache()
          await this.hydrateCatalog(i18n.locale)
        })()
      })
    })
  }

  // One-time migration: the old implementation stored a flat `<sourceSig>:<locale>`
  // → `<translatedSig>` map in localStorage. Fold it into per-locale OPFS files
  // and remove the localStorage key. Safe to run repeatedly — no-op after first pass.
  async #migrateLegacyLocalStorageCache(): Promise<void> {
    const legacy = localStorage.getItem('hc:translation-cache')
    if (!legacy) return
    try {
      const parsed = JSON.parse(legacy) as Record<string, string>
      const byLocale = new Map<string, Record<string, string>>()
      for (const [key, sig] of Object.entries(parsed)) {
        const lastColon = key.lastIndexOf(':')
        if (lastColon < 0) continue
        const sourceSig = key.slice(0, lastColon)
        const locale = key.slice(lastColon + 1)
        if (!byLocale.has(locale)) byLocale.set(locale, {})
        byLocale.get(locale)![sourceSig] = sig
      }
      for (const [locale, entries] of byLocale) {
        const map = await this.#cacheFor(locale)
        Object.assign(map, entries)
        await this.#persistLocale(locale)
      }
    } catch { /* malformed legacy cache — drop it */ }
    localStorage.removeItem('hc:translation-cache')
  }

  // ── public API ─────────────────────────────────────

  /**
   * Translate a text string to the target locale.
   * Returns the signature of the translated resource.
   *
   * If a cached translation exists, returns immediately without an AI call.
   */
  async translate(text: string, targetLocale: string): Promise<string | null> {
    const apiKey = getApiKey()
    if (!apiKey) return null

    const store = get('@hypercomb.social/Store') as StoreLike | undefined
    if (!store) return null

    // Compute signature of the original text for cache lookup
    const originalBytes = new TextEncoder().encode(text)
    const originalSig = await SignatureService.sign(originalBytes.buffer as ArrayBuffer)

    // Check cache (OPFS-backed, per-locale)
    const map = await this.#cacheFor(targetLocale)
    const cached = map[originalSig]
    if (cached) {
      const existing = await store.getResource(cached)
      if (existing) return cached
    }

    // Call AI to translate
    const translated = await this.#callTranslation(text, targetLocale, apiKey)
    if (!translated) return null

    // Store as resource → signature
    const blob = new Blob([translated], { type: 'text/plain' })
    const translatedSig = await store.putResource(blob)

    // Cache the mapping in OPFS
    map[originalSig] = translatedSig
    await this.#persistLocale(targetLocale)

    return translatedSig
  }

  /**
   * Translate a resource by its signature.
   * Returns the signature of the translated resource.
   */
  async translateResource(originalSig: string, targetLocale: string): Promise<string | null> {
    const store = get('@hypercomb.social/Store') as StoreLike | undefined
    if (!store) return null

    // Check cache first
    const map = await this.#cacheFor(targetLocale)
    const cached = map[originalSig]
    if (cached) {
      const existing = await store.getResource(cached)
      if (existing) return cached
    }

    // Load original content
    const blob = await store.getResource(originalSig)
    if (!blob) return null

    const text = await blob.text()
    if (!text.trim()) return null

    return this.translate(text, targetLocale)
  }

  /**
   * Look up a cached translation signature without triggering an AI call.
   * Returns null if no cached translation exists.
   */
  async lookup(originalSig: string, targetLocale: string): Promise<string | null> {
    const map = await this.#cacheFor(targetLocale)
    return map[originalSig] ?? null
  }

  /**
   * Translate all visible tile labels and content to the target locale.
   * Batches API calls, skips already-cached pairs, filters trivial strings.
   * Emits 'translation:tile-start/done/complete' effects for UI heat glow.
   */
  async translateTiles(targetLocale: string): Promise<void> {
    await this.#runSweep(targetLocale, { dryRun: false })
  }

  /**
   * Estimate a sweep without making any API calls.
   * Returns counts and token estimates so the user can confirm before spending credits.
   */
  async estimate(targetLocale: string): Promise<SweepEstimate> {
    const plan = await this.#planSweep(targetLocale)
    const charCount = plan.toTranslate.reduce((n, s) => n + s.length, 0)
    return {
      locale: targetLocale,
      uniqueStrings: plan.uniqueStrings,
      cached: plan.cachedCount,
      skipped: plan.skippedCount,
      toTranslate: plan.toTranslate.length,
      batches: Math.ceil(plan.toTranslate.length / BATCH_SIZE),
      estimatedInputTokens: Math.ceil(charCount / 3) + 120,
      estimatedOutputTokens: Math.ceil(charCount / 3) + plan.toTranslate.length * 4,
    }
  }

  /**
   * Rehydrate the i18n catalog from cached translations for the given locale.
   * Call at app startup (or on locale change) so cached labels display without API calls.
   */
  async hydrateCatalog(targetLocale: string): Promise<void> {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    const store = get('@hypercomb.social/Store') as StoreLike | undefined
    if (!i18n || !store) return

    const propsIndex: Record<string, string> = JSON.parse(
      localStorage.getItem(PROPS_INDEX_KEY) ?? '{}',
    )
    const catalog: Record<string, string> = {}

    for (const tileName of Object.keys(propsIndex)) {
      const labelSig = await this.#cachedLabelSig(tileName, targetLocale)
      if (!labelSig) continue
      const blob = await store.getResource(labelSig)
      if (!blob) continue
      catalog[`cell.${tileName}`] = (await blob.text()).trim()
    }

    if (Object.keys(catalog).length) {
      i18n.registerTranslations('app', targetLocale, catalog)
      if (i18n.locale === targetLocale) {
        EffectBus.emit('labels:invalidated', { locale: targetLocale })
      }
    }
  }

  // ── sweep internals ─────────────────────────────────

  async #runSweep(targetLocale: string, opts: { dryRun: boolean }): Promise<void> {
    if (this.#translating) return
    this.#translating = true

    try {
      const store = get('@hypercomb.social/Store') as StoreLike | undefined
      const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
      if (!store) return

      const plan = await this.#planSweep(targetLocale)
      if (!plan.tileNames.length) return

      if (opts.dryRun) {
        console.log('[translation] dry-run plan', {
          locale: targetLocale,
          unique: plan.uniqueStrings,
          cached: plan.cachedCount,
          skipped: plan.skippedCount,
          toTranslate: plan.toTranslate.length,
          batches: Math.ceil(plan.toTranslate.length / BATCH_SIZE),
        })
        return
      }

      const apiKey = getApiKey()
      if (!apiKey && plan.toTranslate.length) {
        EffectBus.emit('llm:api-key-required', {})
        return
      }

      EffectBus.emit('translation:tile-start', { labels: plan.tileNames, locale: targetLocale })

      const batchCount = Math.ceil(plan.toTranslate.length / BATCH_SIZE)
      if (plan.toTranslate.length) {
        console.log(
          `[translation] sweep ${targetLocale}: ${plan.toTranslate.length} strings `
          + `in ${batchCount} batch(es) (${plan.cachedCount} cached, ${plan.skippedCount} skipped)`,
        )
      } else {
        console.log(
          `[translation] sweep ${targetLocale}: nothing to translate `
          + `(${plan.cachedCount} cached, ${plan.skippedCount} skipped)`,
        )
      }

      // 1. Run batched API calls for the to-translate list
      const translatedBySource: Record<string, string> = {}
      for (let i = 0; i < plan.toTranslate.length; i += BATCH_SIZE) {
        const batch = plan.toTranslate.slice(i, i + BATCH_SIZE)
        let results: string[] | null = null
        try {
          results = await callAnthropicBatch(MODELS['haiku']!, targetLocale, batch, apiKey!)
        } catch (err) {
          console.warn(`[translation] batch ${i}-${i + batch.length} failed:`, err)
          continue
        }
        if (!results) {
          console.warn(
            `[translation] batch ${i}-${i + batch.length} unparseable — falling back to per-string`,
          )
          for (const source of batch) {
            try {
              const single = await callAnthropic(
                MODELS['haiku']!,
                'Translate the user\'s text. Return ONLY the translated text — no quotes, no explanations.',
                `Translate to ${targetLocale}:\n\n${source}`,
                apiKey!,
                512,
              )
              if (single?.trim()) translatedBySource[source] = single.trim()
            } catch (err) {
              console.warn(`[translation] per-string fallback failed for "${source}":`, err)
            }
          }
          continue
        }
        for (let j = 0; j < batch.length; j++) {
          const translated = results[j]
          if (typeof translated === 'string' && translated.length) {
            translatedBySource[batch[j]!] = translated
          }
        }
      }

      // 2. Persist each translation as a resource, write cache, build catalog
      const catalog: Record<string, string> = {}
      const map = await this.#cacheFor(targetLocale)
      for (const [source, translated] of Object.entries(translatedBySource)) {
        const sourceSig = await this.#signString(source)
        const blob = new Blob([translated], { type: 'text/plain' })
        const translatedSig = await store.putResource(blob)
        map[sourceSig] = translatedSig
      }
      await this.#persistLocale(targetLocale)

      // 3. Walk tiles: attach translations[locale].labelSig / contentSig, update props index
      const propsIndex: Record<string, string> = JSON.parse(
        localStorage.getItem(PROPS_INDEX_KEY) ?? '{}',
      )

      for (const tileName of plan.tileNames) {
        const propsSig = propsIndex[tileName]
        if (!propsSig) {
          EffectBus.emit('translation:tile-done', { label: tileName })
          continue
        }

        const propsBlob = await store.getResource(propsSig)
        if (!propsBlob) {
          EffectBus.emit('translation:tile-done', { label: tileName })
          continue
        }

        let props: Record<string, any>
        try {
          props = JSON.parse(await propsBlob.text())
        } catch {
          EffectBus.emit('translation:tile-done', { label: tileName })
          continue
        }

        let changed = false

        // Label translation
        const labelSig = await this.#cachedLabelSig(tileName, targetLocale)
        if (labelSig) {
          props['translations'] ??= {}
          props['translations'][targetLocale] ??= {}
          if (props['translations'][targetLocale].labelSig !== labelSig) {
            props['translations'][targetLocale].labelSig = labelSig
            changed = true
          }
          // Populate i18n catalog live for resolveCell()
          const labelBlob = await store.getResource(labelSig)
          if (labelBlob) catalog[`cell.${tileName}`] = (await labelBlob.text()).trim()
        }

        // Content translation — use the cache via translateResource (single call, already deduped above)
        if (props['contentSig']) {
          const contentSig = props['contentSig']
          const contentTransSig = this.lookup(contentSig, targetLocale)
            ?? (await this.translateResource(contentSig, targetLocale))
          if (contentTransSig) {
            props['translations'] ??= {}
            props['translations'][targetLocale] ??= {}
            if (props['translations'][targetLocale].contentSig !== contentTransSig) {
              props['translations'][targetLocale].contentSig = contentTransSig
              changed = true
            }
          }
        }

        if (changed) {
          const updatedBlob = new Blob(
            [JSON.stringify(props, null, 2)],
            { type: 'application/json' },
          )
          propsIndex[tileName] = await store.putResource(updatedBlob)
        }

        EffectBus.emit('translation:tile-done', { label: tileName })
      }

      localStorage.setItem(PROPS_INDEX_KEY, JSON.stringify(propsIndex))

      if (i18n && Object.keys(catalog).length) {
        i18n.registerTranslations('app', targetLocale, catalog)
        if (i18n.locale === targetLocale) {
          EffectBus.emit('labels:invalidated', { locale: targetLocale })
        }
      }

      EffectBus.emit('translation:complete', {
        locale: targetLocale,
        translated: plan.toTranslate.length,
      })
      this.dispatchEvent(new CustomEvent('change'))
    } finally {
      this.#translating = false
    }
  }

  async #planSweep(targetLocale: string): Promise<{
    tileNames: string[]
    uniqueStrings: number
    cachedCount: number
    skippedCount: number
    toTranslate: string[]
  }> {
    const store = get('@hypercomb.social/Store') as StoreLike | undefined
    const propsIndex: Record<string, string> = JSON.parse(
      localStorage.getItem(PROPS_INDEX_KEY) ?? '{}',
    )
    // Walk lineage's explorer directory — every actual tile, not just ones with saved props.
    const tileNames = await this.#enumerateTileNames(propsIndex)

    // Collect unique source strings: tile labels + tile contents (dereferenced via contentSig).
    const sources = new Set<string>()
    for (const tileName of tileNames) sources.add(tileName)

    if (store) {
      for (const tileName of tileNames) {
        const propsSig = propsIndex[tileName]
        if (!propsSig) continue
        const blob = await store.getResource(propsSig)
        if (!blob) continue
        try {
          const props = JSON.parse(await blob.text()) as Record<string, any>
          const contentSig = props['contentSig']
          if (typeof contentSig === 'string') {
            const contentBlob = await store.getResource(contentSig)
            if (contentBlob) {
              const text = (await contentBlob.text()).trim()
              if (text) sources.add(text)
            }
          }
        } catch { /* skip malformed */ }
      }
    }

    let cachedCount = 0
    let skippedCount = 0
    const toTranslate: string[] = []
    const map = await this.#cacheFor(targetLocale)

    for (const source of sources) {
      if (shouldSkipForTranslation(source, targetLocale)) { skippedCount++; continue }
      const sig = await this.#signString(source)
      if (map[sig]) { cachedCount++; continue }
      toTranslate.push(source)
    }

    return {
      tileNames,
      uniqueStrings: sources.size,
      cachedCount,
      skippedCount,
      toTranslate,
    }
  }

  async #enumerateTileNames(propsIndex: Record<string, string>): Promise<string[]> {
    const names = new Set<string>(Object.keys(propsIndex))

    const lineage = get('@hypercomb.social/Lineage') as
      { explorerDir?: () => Promise<FileSystemDirectoryHandle | null> } | undefined

    const dir = lineage?.explorerDir ? await lineage.explorerDir() : null
    if (dir) {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') names.add(name)
      }
    }

    return Array.from(names)
  }

  async #cachedLabelSig(tileName: string, locale: string): Promise<string | null> {
    const sig = await this.#signString(tileName)
    const map = await this.#cacheFor(locale)
    return map[sig] ?? null
  }

  async #cacheFor(locale: string): Promise<LocaleMap> {
    let m = this.#cache.get(locale)
    if (m) return m
    try {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(TRANSLATIONS_DIR, { create: false })
      const handle = await dir.getFileHandle(`${locale}.json`, { create: false })
      const file = await handle.getFile()
      m = JSON.parse(await file.text()) as LocaleMap
    } catch {
      m = {}
    }
    this.#cache.set(locale, m)
    return m
  }

  async #persistLocale(locale: string): Promise<void> {
    const m = this.#cache.get(locale) ?? {}
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(TRANSLATIONS_DIR, { create: true })
    const handle = await dir.getFileHandle(`${locale}.json`, { create: true })
    const writable = await handle.createWritable()
    await writable.write(JSON.stringify(m, null, 2))
    await writable.close()
  }

  async #signString(text: string): Promise<string> {
    const bytes = new TextEncoder().encode(text)
    return SignatureService.sign(bytes.buffer as ArrayBuffer)
  }

  // ── internals ──────────────────────────────────────

  async #callTranslation(text: string, targetLocale: string, apiKey: string): Promise<string | null> {
    const systemPrompt = [
      'You are a translation engine. Translate the user\'s text to the target language.',
      'Return ONLY the translated text — no explanations, no quotes, no formatting.',
      'Preserve the original tone, meaning, and any technical terms.',
      'If the text is already in the target language, return it unchanged.',
    ].join(' ')

    const userMessage = `Translate to ${targetLocale}:\n\n${text}`

    try {
      return await callAnthropic(
        MODELS['haiku'],
        systemPrompt,
        userMessage,
        apiKey,
        2048,
      )
    } catch (err) {
      console.warn('[translation] AI call failed:', err)
      return null
    }
  }

}

const _translation = new TranslationService()
window.ioc.register('@diamondcoreprocessor.com/TranslationService', _translation)

// ── skip filters ─────────────────────────────────────
// Free rejections: strings not worth an API call.

const URL_PATTERN = /^(https?:\/\/|ftp:\/\/|mailto:|tel:)/i
const NUMERIC_PATTERN = /^[\s\d.,:+\-/()$€¥%]+$/
// Match any letter character in any script — if none, string is symbol/emoji-only.
const HAS_LETTER = /\p{L}/u

export function shouldSkipForTranslation(text: string, _targetLocale: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 2) return true
  if (NUMERIC_PATTERN.test(trimmed)) return true
  if (URL_PATTERN.test(trimmed)) return true
  if (!HAS_LETTER.test(trimmed)) return true
  return false
}
