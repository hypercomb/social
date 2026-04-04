// diamondcoreprocessor.com/commands/translation.service.ts
//
// AI-powered translation with signature-addressed caching.
// Translates text content via Claude, stores the translation as a resource,
// and caches the mapping (originalSig:locale → translatedSig) so future
// lookups are instant — no AI call needed.

import { EffectBus, SignatureService } from '@hypercomb/core'
import { callAnthropic, getApiKey, MODELS } from '../assistant/llm-api.js'

const CACHE_KEY = 'hc:translation-cache'
const PROPS_INDEX_KEY = 'hc:tile-props-index'

type StoreLike = {
  putResource: (blob: Blob) => Promise<string>
  getResource: (sig: string) => Promise<Blob | null>
}

type TranslationCache = Record<string, string>

/**
 * Manages AI translations of content-addressed resources.
 *
 * Each translation is itself a resource — its signature can be used
 * as a starting point for further AI operations without re-translating.
 */
export class TranslationService extends EventTarget {

  #cache: TranslationCache
  #translating = false

  constructor() {
    super()
    this.#cache = this.#loadCache()

    // Passively listen for locale changes — auto-translate when API key is present
    EffectBus.on('locale:changed', (payload: { locale: string }) => {
      if (!this.#translating && getApiKey()) {
        void this.translateTiles(payload.locale)
      }
    })
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

    // Check cache
    const cacheKey = `${originalSig}:${targetLocale}`
    const cached = this.#cache[cacheKey]
    if (cached) {
      // Verify the cached resource still exists
      const existing = await store.getResource(cached)
      if (existing) return cached
    }

    // Call AI to translate
    const translated = await this.#callTranslation(text, targetLocale, apiKey)
    if (!translated) return null

    // Store as resource → signature
    const blob = new Blob([translated], { type: 'text/plain' })
    const translatedSig = await store.putResource(blob)

    // Cache the mapping
    this.#cache[cacheKey] = translatedSig
    this.#saveCache()

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
    const cacheKey = `${originalSig}:${targetLocale}`
    const cached = this.#cache[cacheKey]
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
  lookup(originalSig: string, targetLocale: string): string | null {
    return this.#cache[`${originalSig}:${targetLocale}`] ?? null
  }

  /**
   * Translate all visible tile labels and content to the target locale.
   * Updates tile properties with translation signatures.
   * Emits 'translation:progress' and 'translation:complete' effects.
   */
  async translateTiles(targetLocale: string): Promise<void> {
    if (this.#translating) return
    this.#translating = true

    try {
      const apiKey = getApiKey()
      if (!apiKey) {
        EffectBus.emit('llm:api-key-required', {})
        return
      }

      const store = get('@hypercomb.social/Store') as StoreLike | undefined
      if (!store) return

      const propsIndex: Record<string, string> = JSON.parse(
        localStorage.getItem(PROPS_INDEX_KEY) ?? '{}'
      )

      const tileNames = Object.keys(propsIndex)
      if (!tileNames.length) return

      // Signal all tiles as translating — show-cell applies heat glow
      EffectBus.emit('translation:tile-start', { labels: tileNames, locale: targetLocale })

      let done = 0

      for (const tileName of tileNames) {
        const propsSig = propsIndex[tileName]
        if (!propsSig) {
          done++
          EffectBus.emit('translation:tile-done', { label: tileName })
          continue
        }

        const propsBlob = await store.getResource(propsSig)
        if (!propsBlob) {
          done++
          EffectBus.emit('translation:tile-done', { label: tileName })
          continue
        }

        let props: Record<string, any>
        try {
          props = JSON.parse(await propsBlob.text())
        } catch {
          done++
          EffectBus.emit('translation:tile-done', { label: tileName })
          continue
        }

        let changed = false

        // Translate the tile label (directory name → human-readable translation)
        const labelSig = await this.translate(tileName, targetLocale)
        if (labelSig) {
          if (!props['translations']) props['translations'] = {}
          if (!props['translations'][targetLocale]) props['translations'][targetLocale] = {}
          props['translations'][targetLocale].labelSig = labelSig
          changed = true
        }

        // Translate contentSig if present
        if (props['contentSig']) {
          const contentTransSig = await this.translateResource(props['contentSig'], targetLocale)
          if (contentTransSig) {
            if (!props['translations']) props['translations'] = {}
            if (!props['translations'][targetLocale]) props['translations'][targetLocale] = {}
            props['translations'][targetLocale].contentSig = contentTransSig
            changed = true
          }
        }

        // Write updated properties back
        if (changed) {
          const updatedBlob = new Blob(
            [JSON.stringify(props, null, 2)],
            { type: 'application/json' },
          )
          const newPropsSig = await store.putResource(updatedBlob)
          propsIndex[tileName] = newPropsSig
        }

        done++
        // Clear heat on this tile — translation finished
        EffectBus.emit('translation:tile-done', { label: tileName })
      }

      // Persist updated index
      localStorage.setItem(PROPS_INDEX_KEY, JSON.stringify(propsIndex))

      EffectBus.emit('translation:complete', { locale: targetLocale, translated: done })
      this.dispatchEvent(new CustomEvent('change'))
    } finally {
      this.#translating = false
    }
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

  #loadCache(): TranslationCache {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}')
    } catch {
      return {}
    }
  }

  #saveCache(): void {
    localStorage.setItem(CACHE_KEY, JSON.stringify(this.#cache))
  }
}

const _translation = new TranslationService()
window.ioc.register('@diamondcoreprocessor.com/TranslationService', _translation)
