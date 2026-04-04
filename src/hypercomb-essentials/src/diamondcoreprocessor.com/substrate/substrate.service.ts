// diamondcoreprocessor.com/substrate/substrate.service.ts
//
// SubstrateService — manages the image collection used as default
// backgrounds for cells that have no image of their own.
//
// Storage:
//   Global  → root OPFS 0000 property `substrate-global` (layer signature)
//   Per-hive → cell 0000 property `substrate` (layer signature)
//   Suppress → cell 0000 property `substrate-inherit` = false (blocks children)
//
// Resolution cascade: per-hive (walk up lineage) → global → none.

import { EffectBus } from '@hypercomb/core'

const PROPS_FILE = '0000'
const GLOBAL_KEY = 'substrate-global'
const HIVE_KEY = 'substrate'
const INHERIT_KEY = 'substrate-inherit'
const STORAGE_KEY = 'hc:substrate-global'
const RESOLVED_KEY = 'hc:substrate-resolved'

const get = (key: string) => (window as any).ioc?.get?.(key)

type StoreHandle = {
  opfsRoot: FileSystemDirectoryHandle
  hypercombRoot: FileSystemDirectoryHandle
  getResource: (sig: string) => Promise<Blob | null>
}

type LineageHandle = {
  explorerDir: () => Promise<FileSystemDirectoryHandle | null>
  explorerSegments: () => readonly string[]
}

export class SubstrateService extends EventTarget {
  #loaded = false
  #globalSignature: string | null = null
  #imageCache = new Map<string, string[]>() // layerSig → image sigs

  // ── public API ──

  get globalSignature(): string | null { return this.#globalSignature }

  async ensureLoaded(): Promise<void> {
    if (this.#loaded) return
    await this.#loadGlobal()
    this.#loaded = true
  }

  /** Set the global substrate layer signature. */
  async setGlobal(layerSignature: string): Promise<void> {
    this.#globalSignature = layerSignature
    localStorage.setItem(STORAGE_KEY, layerSignature)
    await this.#saveGlobal(layerSignature)
    this.#imageCache.delete(layerSignature) // force refresh
    EffectBus.emit('substrate:changed', { scope: 'global', signature: layerSignature })
  }

  /** Clear the global substrate. */
  async clearGlobal(): Promise<void> {
    this.#globalSignature = null
    this.#resolvedCache = null
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(RESOLVED_KEY)
    await this.#saveGlobal(null)
    EffectBus.emit('substrate:changed', { scope: 'global', signature: null })
  }

  /** Set per-hive substrate on the current explorer directory. */
  async setHive(layerSignature: string): Promise<void> {
    const dir = await this.#explorerDir()
    if (!dir) return
    await this.#writeProps(dir, { [HIVE_KEY]: layerSignature })
    this.#imageCache.delete(layerSignature)
    EffectBus.emit('substrate:changed', { scope: 'hive', signature: layerSignature })
  }

  /** Clear per-hive substrate override. */
  async clearHive(): Promise<void> {
    const dir = await this.#explorerDir()
    if (!dir) return
    await this.#writeProps(dir, { [HIVE_KEY]: null })
    this.#resolvedCache = null
    localStorage.removeItem(RESOLVED_KEY)
    EffectBus.emit('substrate:changed', { scope: 'hive', signature: null })
  }

  /** Suppress child overrides — only global applies under this hive. */
  async setInherit(inherit: boolean): Promise<void> {
    const dir = await this.#explorerDir()
    if (!dir) return
    await this.#writeProps(dir, { [INHERIT_KEY]: inherit })
    EffectBus.emit('substrate:changed', { scope: 'inherit', inherit })
  }

  /**
   * Resolve the effective substrate layer signature for the current location.
   * Walks up from current hive checking for per-hive overrides, respecting
   * inherit=false barriers. Falls back to global.
   */
  async resolve(): Promise<string | null> {
    await this.ensureLoaded()

    const store = this.#store()
    if (!store) return this.#globalSignature

    const lineage = this.#lineage()
    if (!lineage) return this.#globalSignature

    const segments = [...lineage.explorerSegments()]

    // Walk from current depth up to root, checking each hive's 0000
    while (segments.length > 0) {
      try {
        let dir: FileSystemDirectoryHandle = store.hypercombRoot
        for (const seg of segments) {
          dir = await dir.getDirectoryHandle(seg)
        }
        const props = await this.#readProps(dir)

        // If this hive says don't inherit, stop and use global
        if (props[INHERIT_KEY] === false) return this.#globalSignature

        // If this hive has a substrate, use it
        const sig = props[HIVE_KEY]
        if (typeof sig === 'string' && sig.length > 0) return sig
      } catch { /* directory doesn't exist or no props — continue up */ }

      segments.pop()
    }

    return this.#globalSignature
  }

  /**
   * Pick a random image signature from the resolved substrate layer.
   * Reads the tile images within that hive and caches them.
   */
  async pickRandomImage(): Promise<string | null> {
    const layerSignature = await this.resolve()
    if (!layerSignature) return null

    const images = await this.#collectImages(layerSignature)
    if (images.length === 0) return null

    return images[Math.floor(Math.random() * images.length)]
  }

  /** Preload all substrate images into the image atlas for instant rendering. */
  async preloadImages(): Promise<void> {
    const layerSignature = await this.resolve()
    if (!layerSignature) return

    const images = await this.#collectImages(layerSignature)
    if (images.length === 0) return

    const store = this.#store()
    if (!store) return

    const showCell = get('@diamondcoreprocessor.com/ShowCellDrone') as
      { imageAtlas: { hasImage: (sig: string) => boolean; hasFailed: (sig: string) => boolean; loadImage: (sig: string, blob: Blob) => Promise<import('../presentation/grid/hex-image.atlas.js').ImageUV | null> } | null } | undefined
    if (!showCell?.imageAtlas) return

    for (const sig of images) {
      if (showCell.imageAtlas.hasImage(sig) || showCell.imageAtlas.hasFailed(sig)) continue
      try {
        const blob = await store.getResource(sig)
        if (blob) await showCell.imageAtlas.loadImage(sig, blob)
      } catch { /* skip failed loads */ }
    }
  }

  /**
   * Synchronous pick — returns a pre-resolved image sig from cache.
   * Returns null if substrate is not loaded or pool is empty.
   */
  pickRandomImageSync(): string | null {
    // Use cached resolved path
    const path = this.#resolvedCache
    if (!path) return null

    const images = this.#imageCache.get(path)
    if (!images || images.length === 0) return null

    return images[Math.floor(Math.random() * images.length)]
  }

  #resolvedCache: string | null = null

  /** Warm up: resolve + collect + preload so sync picks are instant. */
  async warmUp(): Promise<void> {
    this.#resolvedCache = await this.resolve()

    // Persist resolved path so it survives reload
    if (this.#resolvedCache) {
      localStorage.setItem(RESOLVED_KEY, this.#resolvedCache)
    }

    // Fall back to last known resolved path if resolve() returned null
    // (e.g. Lineage not ready yet at startup)
    if (!this.#resolvedCache) {
      this.#resolvedCache = localStorage.getItem(RESOLVED_KEY)
    }

    if (!this.#resolvedCache) return
    await this.#collectImages(this.#resolvedCache)
    await this.preloadImages()
    await this.#fillPropsPool()
  }

  // ── pre-generated props pool ──

  #propsPool: { imageSig: string; propsSig: string }[] = []

  async #fillPropsPool(): Promise<void> {
    const store = this.#store()
    if (!store) return

    const path = this.#resolvedCache
    if (!path) return

    const images = this.#imageCache.get(path)
    if (!images || images.length === 0) return

    // Pre-generate props resources — one per unique image (deduped by content)
    const byImage = new Map<string, string>()
    this.#propsPool = []
    for (const imageSig of images) {
      if (byImage.has(imageSig)) {
        this.#propsPool.push({ imageSig, propsSig: byImage.get(imageSig)! })
        continue
      }
      try {
        const props = { small: { image: imageSig }, substrate: true }
        const json = JSON.stringify(props, null, 2)
        const blob = new Blob([json], { type: 'application/json' })
        const propsSig = await (store as any).putResource(blob)
        byImage.set(imageSig, propsSig)
        this.#propsPool.push({ imageSig, propsSig })
      } catch { /* skip */ }
    }

    // Pad pool to at least 50 entries by cycling through source images
    const minPool = 50
    if (this.#propsPool.length > 0 && this.#propsPool.length < minPool) {
      const base = [...this.#propsPool]
      while (this.#propsPool.length < minPool) {
        this.#propsPool.push(base[this.#propsPool.length % base.length])
      }
    }
  }

  /**
   * Synchronously assign a substrate image to a cell.
   * Writes to the props index (localStorage) immediately — no async work.
   * Returns true if an image was assigned.
   */
  /**
   * Assign a substrate image to a cell that has NO props at all.
   * Skips any cell that already has an entry in the props index.
   * Returns true if an image was assigned.
   */
  applyToCell(label: string): boolean {
    if (this.#propsPool.length === 0) return false

    const indexKey = 'hc:tile-props-index'
    const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')

    // Already has props (substrate or user-edited) — don't touch
    if (index[label]) return false

    const entry = this.#propsPool[Math.floor(Math.random() * this.#propsPool.length)]
    index[label] = entry.propsSig
    localStorage.setItem(indexKey, JSON.stringify(index))

    return true
  }

  /**
   * Re-roll a single cell's substrate image.
   * Clears its current props entry and assigns a new random one from the pool.
   * Returns true if a new image was assigned.
   */
  rerollCell(label: string): boolean {
    if (this.#propsPool.length === 0) return false

    const indexKey = 'hc:tile-props-index'
    const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')

    // Remove current entry so we can assign a fresh one
    delete index[label]

    const entry = this.#propsPool[Math.floor(Math.random() * this.#propsPool.length)]
    index[label] = entry.propsSig
    localStorage.setItem(indexKey, JSON.stringify(index))

    return true
  }

  /** Remove a cell from the props index (call on cell:removed). */
  clearCell(label: string): void {
    const indexKey = 'hc:tile-props-index'
    const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
    delete index[label]
    localStorage.setItem(indexKey, JSON.stringify(index))
  }

  /**
   * Apply substrate images to blank tiles (tiles with no props entry).
   * Only called with noImageLabels — tiles the renderer confirms have no image.
   * Never re-rolls existing assignments.
   */
  applyToAllBlanks(labels: string[]): string[] {
    if (this.#propsPool.length === 0 || labels.length === 0) return []

    const indexKey = 'hc:tile-props-index'
    const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
    const applied: string[] = []

    for (const label of labels) {
      if (index[label]) continue // already has props — skip

      const entry = this.#propsPool[Math.floor(Math.random() * this.#propsPool.length)]
      index[label] = entry.propsSig
      applied.push(label)
    }

    if (applied.length > 0) {
      localStorage.setItem(indexKey, JSON.stringify(index))
    }

    return applied
  }

  /**
   * Re-roll all substrate-assigned tiles with fresh random images.
   * Clears substrate entries from the props index, re-warms the pool,
   * then re-applies to all blanks on the next render cycle.
   * Returns the number of tiles refreshed.
   */
  async refresh(visibleLabels: string[]): Promise<number> {
    if (this.#propsPool.length === 0) return 0

    const indexKey = 'hc:tile-props-index'
    const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
    const substrateSigs = new Set(this.#propsPool.map(p => p.propsSig))

    // Clear all substrate-assigned entries
    let cleared = 0
    for (const label of visibleLabels) {
      if (index[label] && substrateSigs.has(index[label])) {
        delete index[label]
        cleared++
      }
    }

    if (cleared > 0) {
      localStorage.setItem(indexKey, JSON.stringify(index))
    }

    // Re-warm pool (may pick up new images if substrate source changed)
    this.invalidateCache()
    await this.warmUp()

    // Re-apply to all now-blank tiles
    const applied = this.applyToAllBlanks(visibleLabels)

    return applied.length
  }

  // ── private: image collection ──

  async #collectImages(layerPath: string): Promise<string[]> {
    if (this.#imageCache.has(layerPath)) return this.#imageCache.get(layerPath)!

    const store = this.#store()
    if (!store) return []

    const images: string[] = []
    const propsIndex: Record<string, string> = JSON.parse(localStorage.getItem('hc:tile-props-index') ?? '{}')

    try {
      let dir: FileSystemDirectoryHandle = store.hypercombRoot
      const segments = layerPath.split('/').filter(Boolean)
      for (const seg of segments) {
        dir = await dir.getDirectoryHandle(seg)
      }

      for await (const [name, handle] of (dir as any).entries()) {
        if (handle.kind !== 'directory') continue
        try {
          // Read image sig from content-addressed props (same source as show-cell)
          const propsSig = propsIndex[name]
          if (propsSig) {
            const blob = await store.getResource(propsSig)
            if (blob) {
              const props = JSON.parse(await blob.text())
              const sig = props?.small?.image ?? props?.flat?.small?.image
              if (typeof sig === 'string' && /^[0-9a-f]{64}$/.test(sig)) {
                images.push(sig)
              }
            }
          }
        } catch { /* skip cells without images */ }
      }
    } catch { /* substrate hive not found */ }

    this.#imageCache.set(layerPath, images)
    return images
  }

  /** Invalidate the image cache for a given layer (or all). */
  invalidateCache(layerPath?: string): void {
    if (layerPath) this.#imageCache.delete(layerPath)
    else this.#imageCache.clear()
  }

  // ── private: global persistence (root 0000) ──

  async #loadGlobal(): Promise<void> {
    // Fast path: localStorage cache
    const cached = localStorage.getItem(STORAGE_KEY)
    if (cached) this.#globalSignature = cached

    try {
      const store = this.#store()
      if (!store) return
      const props = await this.#readRootProps(store)
      const sig = props[GLOBAL_KEY]
      if (typeof sig === 'string' && sig.length > 0) {
        this.#globalSignature = sig
        localStorage.setItem(STORAGE_KEY, sig)
      }
    } catch { /* no root props */ }
  }

  async #saveGlobal(signature: string | null): Promise<void> {
    try {
      const store = this.#store()
      if (!store) return
      await this.#writeRootProps(store, { [GLOBAL_KEY]: signature })
    } catch { /* store not ready */ }
  }

  // ── private: OPFS helpers ──

  async #readProps(dir: FileSystemDirectoryHandle): Promise<Record<string, any>> {
    try {
      const fh = await dir.getFileHandle(PROPS_FILE)
      const file = await fh.getFile()
      return JSON.parse(await file.text())
    } catch {
      return {}
    }
  }

  async #writeProps(dir: FileSystemDirectoryHandle, updates: Record<string, unknown>): Promise<void> {
    const existing = await this.#readProps(dir)
    const merged = { ...existing, ...updates }
    const fh = await dir.getFileHandle(PROPS_FILE, { create: true })
    const writable = await fh.createWritable()
    await writable.write(JSON.stringify(merged))
    await writable.close()
  }

  async #readRootProps(store: StoreHandle): Promise<Record<string, unknown>> {
    try {
      const fh = await store.opfsRoot.getFileHandle(PROPS_FILE)
      const file = await fh.getFile()
      return JSON.parse(await file.text())
    } catch {
      return {}
    }
  }

  async #writeRootProps(store: StoreHandle, updates: Record<string, unknown>): Promise<void> {
    const existing = await this.#readRootProps(store)
    const merged = { ...existing, ...updates }
    const fh = await store.opfsRoot.getFileHandle(PROPS_FILE, { create: true })
    const writable = await fh.createWritable()
    await writable.write(JSON.stringify(merged))
    await writable.close()
  }

  // ── private: IoC resolution ──

  #store(): StoreHandle | undefined {
    return get('@hypercomb.social/Store')
  }

  #lineage(): LineageHandle | undefined {
    return get('@hypercomb.social/Lineage')
  }

  async #explorerDir(): Promise<FileSystemDirectoryHandle | null> {
    return this.#lineage()?.explorerDir() ?? null
  }
}

window.ioc.register('@diamondcoreprocessor.com/SubstrateService', new SubstrateService())
