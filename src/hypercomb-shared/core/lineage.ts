// hypercomb-shared/core/lineage.ts
// synchronize is dispatched only by the processor — lineage fires 'change' on itself

import { type LayerV2, computeLineageSig } from '@hypercomb/core'
import type { Navigation } from './navigation'
import type { Store } from './store'

// global get/register/list available via ioc.web.ts

export class Lineage extends EventTarget {

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  #store(): Store { return get('@hypercomb.social/Store') as Store }
  #navigation(): Navigation { return get('@hypercomb.social/Navigation') as Navigation }

  // -------------------------------------------------
  // domain context (reserved for later)
  // -------------------------------------------------

  #activeDomain = 'hypercomb.io'

  public domain = (): string => this.#activeDomain

  // -------------------------------------------------
  // explorer path (domain-relative)
  // -------------------------------------------------

  #explorerPath: string[] = []
  public explorerSegments = (): readonly string[] => this.#explorerPath

  public explorerEnter = (name: string): void => {
    const seg = (name ?? '').trim()
    if (!seg || seg === '.' || seg === '..') return

    this.#explorerPath = [...this.#explorerPath, seg]
    this.#invalidate()

    try {
      this.#navigation().goRaw(this.#explorerPath)
    } catch {
      this.#dispatchNavigateFallback()
    }
  }

  public explorerUp = (): void => {
    if (this.#explorerPath.length === 0) return
    this.#explorerPath = this.#explorerPath.slice(0, -1)
    this.#invalidate()

    try {
      this.#navigation().goRaw(this.#explorerPath)
    } catch {
      this.#dispatchNavigateFallback()
    }
  }

  public showDomainRoot = (): void => {
    this.#explorerPath = []
    this.#invalidate()

    try {
      this.#navigation().goRaw([])
    } catch {
      this.#dispatchNavigateFallback()
    }
  }

  public explorerLabel = (): string => {
    return '/' + this.#explorerPath.join('/')
  }

  // -------------------------------------------------
  // layer-based resolution (replaces folder-based)
  // -------------------------------------------------

  /**
   * Get the current layer from the live cache.
   */
  public currentLayer = (): LayerV2 | null => {
    const store = this.#store()
    // synchronous: lineage sig is deterministic from segments,
    // but computing it is async. Use the cached lookup.
    for (const [, layer] of store.liveCache) {
      // match by comparing lineage sig — we precompute on invalidation
      if (this.#currentLineageSig && layer.lineage === this.#currentLineageSig) {
        return layer
      }
    }
    return null
  }

  /**
   * Compute the lineage signature for the current explorer segments.
   */
  public lineageSignature = async (): Promise<string> => {
    return computeLineageSig(this.#explorerPath)
  }

  // -------------------------------------------------
  // status
  // -------------------------------------------------

  #ready = false
  #materialized = true
  #missing: readonly string[] = []
  #fsRevision = 0
  #currentLineageSig: string | null = null

  public get ready(): boolean { return this.#ready }

  /** Whether a layer exists in the live cache for the current lineage. */
  public get materialized(): boolean { return this.#materialized }
  public get missing(): readonly string[] { return this.#missing }

  public changed = (): number => this.#fsRevision

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public constructor() {
    super()
    window.addEventListener('navigate', this.#followLocation)
    window.addEventListener('popstate', this.#followLocation)

    this.#followLocation()

    this.#ready = true
    this.dispatchEvent(new CustomEvent('change'))
  }

  public initialize = async (): Promise<void> => {
    this.#activeDomain = 'hypercomb.io'
    this.#followLocation()
    await this.#updateLineageSig()
    this.#ready = true
    this.dispatchEvent(new CustomEvent('change'))
  }

  // -------------------------------------------------
  // internal
  // -------------------------------------------------

  readonly #invalidate = (): void => {
    this.#fsRevision = this.#fsRevision + 1
    this.#updateLineageSig().catch(() => {})
    this.dispatchEvent(new CustomEvent('change'))
  }

  readonly #updateLineageSig = async (): Promise<void> => {
    this.#currentLineageSig = await computeLineageSig(this.#explorerPath)

    const store = this.#store()
    const layer = store.getLayer(this.#currentLineageSig)
    this.#materialized = layer !== null
    this.#missing = layer ? [] : this.#explorerPath
  }

  readonly #followLocation = (): void => {
    try {
      const next = this.#navigation().segmentsRaw()

      if (this.#sameSegments(this.#explorerPath, next)) return

      this.#explorerPath = next
      this.#invalidate()
    } catch {
      // ignore until nav is ready
    }
  }

  readonly #sameSegments = (a: readonly string[], b: readonly string[]): boolean => {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if ((a[i] ?? '') !== (b[i] ?? '')) return false
    }
    return true
  }

  readonly #dispatchNavigateFallback = (): void => {
    try {
      window.dispatchEvent(new Event('navigate'))
    } catch {
      // ignore
    }
  }
}

register('@hypercomb.social/Lineage', new Lineage())
