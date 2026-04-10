// diamondcoreprocessor.com/substrate/substrate.service.ts
//
// SubstrateService — manages the image collection used as default
// backgrounds for cells that have no image of their own.
//
// Sources (unified abstraction):
//   layer   — a layer package in OPFS __layers__/<domain>/<sig>
//   hive    — a directory path under hypercomb.io/ (cells with images)
//   folder  — a live FileSystemDirectoryHandle persisted in IDB
//   url     — a remote bundle with manifest.json { images: string[] }
//
// Resolution cascade:
//   per-hive substrate (walk lineage, respect inherit=false)
//     → registry.activeId
//     → first builtin in registry
//     → none
//
// Storage:
//   Root OPFS 0000 → `substrate-registry` (SubstrateRegistry JSON)
//   Per-hive 0000  → `substrate` (hive path, legacy property name)
//   Per-hive 0000  → `substrate-inherit` = false (barrier)

import { EffectBus, type SubstrateSource, type SubstrateRegistry, EMPTY_SUBSTRATE_REGISTRY } from '@hypercomb/core'
import {
  linkFolder as linkFolderHandle,
  getHandle as getFolderHandle,
  removeHandle as removeFolderHandle,
  queryPermission as queryFolderPermission,
  requestPermission as requestFolderPermission,
  readImagesFromHandle,
  isFolderAccessSupported,
} from '@hypercomb/shared'

const PROPS_FILE = '0000'
const HIVE_KEY = 'substrate'                 // per-hive override (path string)
const INHERIT_KEY = 'substrate-inherit'      // per-hive barrier
const REGISTRY_KEY = 'substrate-registry'    // root OPFS 0000 property
const LEGACY_GLOBAL_KEY = 'substrate-global' // migrated into registry on load
const LEGACY_LS_GLOBAL = 'hc:substrate-global'

// Default bundled URL source shipped with the app. Seeded on first load.
// Origin-absolute path so deep navigation paths don't break relative fetch.
const BUILTIN_DEFAULTS: SubstrateSource = {
  type: 'url',
  id: 'builtin:defaults',
  baseUrl: '/substrate/',
  label: 'Hypercomb defaults',
  builtin: true,
}

const get = (key: string) => (window as any).ioc?.get?.(key)

type StoreHandle = {
  opfsRoot: FileSystemDirectoryHandle
  hypercombRoot: FileSystemDirectoryHandle
  layers: FileSystemDirectoryHandle
  getResource: (sig: string) => Promise<Blob | null>
  putResource: (blob: Blob) => Promise<string>
  domainLayersDirectory?: (domain: string, create?: boolean) => Promise<FileSystemDirectoryHandle>
}

type LineageHandle = {
  explorerDir: () => Promise<FileSystemDirectoryHandle | null>
  explorerSegments: () => readonly string[]
}

type ResolvedSource = {
  source: SubstrateSource
  images: string[]       // image signatures
}

// Distributive Omit so each branch of the union keeps its own fields.
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never
type SourceInput = DistributiveOmit<SubstrateSource, 'id'> & { id?: string }

/**
 * Cover-fit a source image into a target box (w × h) and return a webp blob.
 * Used by the substrate pool to pre-render both hex-orientation aspect ratios
 * so the renderer can show a correctly-shaped tile per orientation without
 * stretching a single source image into the wrong-shaped quad.
 */
async function renderToHexBox(blob: Blob, w: number, h: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const useOffscreen = typeof OffscreenCanvas !== 'undefined'
    const canvas: OffscreenCanvas | HTMLCanvasElement = useOffscreen
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h })
    const ctx = (canvas as any).getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!ctx) throw new Error('2d context unavailable')

    const scale = Math.max(w / bitmap.width, h / bitmap.height) // cover
    const scaledW = bitmap.width * scale
    const scaledH = bitmap.height * scale
    const x = (w - scaledW) / 2
    const y = (h - scaledH) / 2
    ctx.drawImage(bitmap, x, y, scaledW, scaledH)

    if (useOffscreen && 'convertToBlob' in canvas) {
      return await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/webp' })
    }
    return await new Promise<Blob>((resolve, reject) =>
      (canvas as HTMLCanvasElement).toBlob(
        b => b ? resolve(b) : reject(new Error('toBlob failed')),
        'image/webp',
      )
    )
  } finally {
    bitmap.close()
  }
}

export class SubstrateService extends EventTarget {
  #loaded = false
  #registry: SubstrateRegistry = EMPTY_SUBSTRATE_REGISTRY
  #resolved: ResolvedSource | null = null
  #propsPool: { imageSig: string; propsSig: string }[] = []

  // ───────────────────────── registry ─────────────────────────

  get registry(): SubstrateRegistry { return this.#registry }
  get activeSource(): SubstrateSource | null {
    return this.#registry.sources.find(s => s.id === this.#registry.activeId) ?? null
  }
  get resolvedSource(): SubstrateSource | null { return this.#resolved?.source ?? null }
  get resolvedImageCount(): number { return this.#resolved?.images.length ?? 0 }

  async ensureLoaded(): Promise<void> {
    if (this.#loaded) return
    await this.#loadRegistry()
    this.#loaded = true
  }

  async #loadRegistry(): Promise<void> {
    const store = this.#store()
    if (!store) return
    let registry: SubstrateRegistry | null = null
    try {
      const props = await this.#readRootProps(store)
      const raw = props[REGISTRY_KEY]
      if (raw && typeof raw === 'object' && Array.isArray((raw as any).sources)) {
        registry = raw as SubstrateRegistry
      }
    } catch { /* no root props */ }

    if (!registry) {
      // First-ever load — seed with builtin defaults (active).
      registry = { sources: [BUILTIN_DEFAULTS], activeId: BUILTIN_DEFAULTS.id }

      // Migrate legacy substrate-global if present.
      try {
        const props = await this.#readRootProps(store)
        const legacy = props[LEGACY_GLOBAL_KEY] ?? localStorage.getItem(LEGACY_LS_GLOBAL)
        if (typeof legacy === 'string' && legacy.length > 0) {
          const hiveSource: SubstrateSource = {
            type: 'hive',
            id: `hive:${legacy}`,
            path: legacy,
            label: legacy,
          }
          registry = { sources: [BUILTIN_DEFAULTS, hiveSource], activeId: hiveSource.id }
        }
      } catch { /* ignore */ }

      await this.#saveRegistry(registry)
    } else {
      // Ensure builtin defaults are always present (forward compat).
      if (!registry.sources.some(s => s.id === BUILTIN_DEFAULTS.id)) {
        registry = { sources: [BUILTIN_DEFAULTS, ...registry.sources], activeId: registry.activeId }
        await this.#saveRegistry(registry)
      }
    }

    this.#registry = registry
  }

  async #saveRegistry(next: SubstrateRegistry): Promise<void> {
    this.#registry = next
    const store = this.#store()
    if (!store) return
    try {
      await this.#writeRootProps(store, { [REGISTRY_KEY]: next })
    } catch { /* store not ready */ }
  }

  listSources(): readonly SubstrateSource[] { return this.#registry.sources }

  async addSource(source: SourceInput, setActive = true): Promise<SubstrateSource> {
    await this.ensureLoaded()
    const id = source.id ?? `${source.type}:${crypto.randomUUID()}`
    const full = { ...source, id } as SubstrateSource
    const sources = [...this.#registry.sources, full]
    const activeId = setActive ? full.id : this.#registry.activeId
    await this.#saveRegistry({ sources, activeId })
    EffectBus.emit('substrate:changed', { scope: 'registry', sourceId: full.id })
    return full
  }

  async removeSource(id: string): Promise<void> {
    await this.ensureLoaded()
    const target = this.#registry.sources.find(s => s.id === id)
    if (!target || target.builtin) return
    if (target.type === 'folder') {
      await removeFolderHandle(target.handleId)
    }
    const sources = this.#registry.sources.filter(s => s.id !== id)
    const activeId = this.#registry.activeId === id ? null : this.#registry.activeId
    await this.#saveRegistry({ sources, activeId })
    EffectBus.emit('substrate:changed', { scope: 'registry', sourceId: id })
  }

  async setActive(id: string | null): Promise<void> {
    await this.ensureLoaded()
    if (id !== null && !this.#registry.sources.some(s => s.id === id)) return
    await this.#saveRegistry({ sources: this.#registry.sources, activeId: id })
    this.#resolved = null
    this.#propsPool = []
    EffectBus.emit('substrate:changed', { scope: 'active', sourceId: id })
  }

  async renameSource(id: string, label: string): Promise<void> {
    await this.ensureLoaded()
    const sources = this.#registry.sources.map(s => s.id === id ? { ...s, label } as SubstrateSource : s)
    await this.#saveRegistry({ sources, activeId: this.#registry.activeId })
  }

  /** Prompt the user for a local folder and register it as a new source. */
  async linkLocalFolder(): Promise<SubstrateSource | null> {
    if (!isFolderAccessSupported()) return null
    const entry = await linkFolderHandle()
    if (!entry) return null
    return this.addSource({
      type: 'folder',
      handleId: entry.id,
      label: entry.label,
    }, true)
  }

  /** Add a hive source for the given path (e.g. from `/substrate here`). */
  async addHiveSource(path: string, label?: string): Promise<SubstrateSource> {
    // Reuse existing hive source if same path already registered.
    const existing = this.#registry.sources.find(s => s.type === 'hive' && s.path === path)
    if (existing) {
      await this.setActive(existing.id)
      return existing
    }
    return this.addSource({ type: 'hive', path, label: label ?? path }, true)
  }

  // ─────────────────────── per-hive overrides ───────────────────────

  async setHive(path: string): Promise<void> {
    const dir = await this.#explorerDir()
    if (!dir) return
    await this.#writeProps(dir, { [HIVE_KEY]: path })
    EffectBus.emit('substrate:changed', { scope: 'hive', path })
  }

  async clearHive(): Promise<void> {
    const dir = await this.#explorerDir()
    if (!dir) return
    await this.#writeProps(dir, { [HIVE_KEY]: null })
    EffectBus.emit('substrate:changed', { scope: 'hive', path: null })
  }

  async setInherit(inherit: boolean): Promise<void> {
    const dir = await this.#explorerDir()
    if (!dir) return
    await this.#writeProps(dir, { [INHERIT_KEY]: inherit })
    EffectBus.emit('substrate:changed', { scope: 'inherit', inherit })
  }

  // ───────────────────────── resolution ─────────────────────────

  /**
   * Resolve the active substrate source for the current location.
   * Walks per-hive overrides first, falls back to registry.activeId,
   * then to the first builtin source.
   */
  async resolve(): Promise<SubstrateSource | null> {
    await this.ensureLoaded()

    // 1. Per-hive override walk
    const hiveOverride = await this.#resolveHiveOverride()
    if (hiveOverride) return hiveOverride

    // 2. Registry active
    const active = this.activeSource
    if (active) return active

    // 3. First builtin fallback (if any)
    return this.#registry.sources.find(s => s.builtin) ?? null
  }

  async #resolveHiveOverride(): Promise<SubstrateSource | null> {
    const store = this.#store()
    if (!store) return null
    const lineage = this.#lineage()
    if (!lineage) return null

    const segments = [...lineage.explorerSegments()]
    while (segments.length > 0) {
      try {
        let dir: FileSystemDirectoryHandle = store.hypercombRoot
        for (const seg of segments) dir = await dir.getDirectoryHandle(seg)
        const props = await this.#readProps(dir)

        if (props[INHERIT_KEY] === false) return null // barrier → fall through to registry

        const path = props[HIVE_KEY]
        if (typeof path === 'string' && path.length > 0) {
          return {
            type: 'hive',
            id: `hive:override:${path}`,
            path,
            label: path,
          }
        }
      } catch { /* missing dir / props */ }
      segments.pop()
    }
    return null
  }

  // ─────────────────── source resolvers (per type) ───────────────────

  async #loadSourceImages(source: SubstrateSource): Promise<string[]> {
    switch (source.type) {
      case 'hive':   return this.#loadHiveImages(source.path)
      case 'url':    return this.#loadUrlImages(source.baseUrl)
      case 'folder': return this.#loadFolderImages(source.handleId)
      case 'layer':  return this.#loadLayerImages(source.signature)
    }
  }

  async #loadHiveImages(layerPath: string): Promise<string[]> {
    const store = this.#store()
    if (!store) return []
    const images: string[] = []
    const propsIndex: Record<string, string> = JSON.parse(localStorage.getItem('hc:tile-props-index') ?? '{}')
    try {
      let dir: FileSystemDirectoryHandle = store.hypercombRoot
      for (const seg of layerPath.split('/').filter(Boolean)) {
        dir = await dir.getDirectoryHandle(seg)
      }
      for await (const [name, handle] of (dir as any).entries()) {
        if (handle.kind !== 'directory') continue
        try {
          const propsSig = propsIndex[name]
          if (!propsSig) continue
          const blob = await store.getResource(propsSig)
          if (!blob) continue
          const props = JSON.parse(await blob.text())
          const sig = props?.small?.image ?? props?.flat?.small?.image
          if (typeof sig === 'string' && /^[0-9a-f]{64}$/.test(sig)) images.push(sig)
        } catch { /* skip */ }
      }
    } catch { /* hive missing */ }
    return images
  }

  async #loadUrlImages(baseUrl: string): Promise<string[]> {
    const store = this.#store()
    if (!store) return []
    let manifest: { images?: string[] }
    try {
      const res = await fetch(`${baseUrl}manifest.json`, { cache: 'force-cache' })
      if (!res.ok) return []
      manifest = await res.json()
    } catch { return [] }
    const names = manifest.images ?? []
    const sigs: string[] = []
    for (const name of names) {
      try {
        const r = await fetch(`${baseUrl}${name}`, { cache: 'force-cache' })
        if (!r.ok) continue
        const blob = await r.blob()
        const sig = await store.putResource(blob)
        sigs.push(sig)
      } catch { /* skip */ }
    }
    return sigs
  }

  async #loadFolderImages(handleId: string): Promise<string[]> {
    const store = this.#store()
    if (!store) return []
    const entry = await getFolderHandle(handleId)
    if (!entry) return []
    const permission = await queryFolderPermission(entry.handle)
    if (permission !== 'granted') {
      EffectBus.emit('substrate:folder-permission', { handleId, permission })
      return []
    }
    const files = await readImagesFromHandle(entry.handle)
    const sigs: string[] = []
    for (const { blob } of files) {
      try {
        const sig = await store.putResource(blob)
        sigs.push(sig)
      } catch { /* skip */ }
    }
    return sigs
  }

  async #loadLayerImages(_layerSignature: string): Promise<string[]> {
    // v1: layer-as-substrate resolution is stubbed. Substrate layer packages
    // require a manifest format that lists resource signatures for images —
    // deferred with the layer creation flow. Returning empty means the
    // source shows in the registry but contributes no images yet.
    return []
  }

  /**
   * Request permission for a folder source from a user gesture.
   * Call this from a click handler in the organizer UI.
   */
  async requestFolderAccess(handleId: string): Promise<'granted' | 'denied' | 'prompt'> {
    const entry = await getFolderHandle(handleId)
    if (!entry) return 'denied'
    return requestFolderPermission(entry.handle)
  }

  // ─────────────────────── warm-up & picking ───────────────────────

  /** Resolve active source, fetch images, preload atlas, build props pool. */
  async warmUp(): Promise<void> {
    await this.ensureLoaded()
    const source = await this.resolve()
    if (!source) {
      this.#resolved = null
      this.#propsPool = []
      return
    }

    const images = await this.#loadSourceImages(source)
    this.#resolved = { source, images }

    await this.#preloadAtlas(images)
    await this.#fillPropsPool(images)
    void this.#migrateLegacySubstrateProps()
  }

  /**
   * One-time cleanup: existing substrate-applied tiles in localStorage point
   * to old-format props (no `flat.small.image`). Detect and remove those
   * entries so the next render reports them as blank and applyToAllBlanks
   * gives them a fresh pool entry containing both orientation variants.
   */
  async #migrateLegacySubstrateProps(): Promise<void> {
    const FLAG = 'hc:substrate-flat-format-v1'
    if (localStorage.getItem(FLAG) === 'true') return
    const store = this.#store()
    if (!store) return

    try {
      const indexKey = 'hc:tile-props-index'
      const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
      const seenSigs = new Map<string, boolean>() // propsSig → isLegacySubstrate
      let changed = false

      for (const [label, propsSig] of Object.entries(index)) {
        if (typeof propsSig !== 'string' || !propsSig) continue
        let legacy = seenSigs.get(propsSig)
        if (legacy === undefined) {
          try {
            const blob = await store.getResource(propsSig)
            if (!blob) { seenSigs.set(propsSig, false); continue }
            const parsed = JSON.parse(await blob.text())
            legacy = parsed?.substrate === true && !parsed?.flat?.small?.image
          } catch {
            legacy = false
          }
          seenSigs.set(propsSig, !!legacy)
        }
        if (legacy) {
          delete index[label]
          changed = true
        }
      }

      if (changed) localStorage.setItem(indexKey, JSON.stringify(index))
      localStorage.setItem(FLAG, 'true')
    } catch { /* migration is best-effort */ }
  }

  async #preloadAtlas(images: string[]): Promise<void> {
    if (images.length === 0) return
    const store = this.#store()
    if (!store) return
    const showCell = get('@diamondcoreprocessor.com/ShowCellDrone') as
      { imageAtlas: { hasImage: (sig: string) => boolean; hasFailed: (sig: string) => boolean; loadImage: (sig: string, blob: Blob) => Promise<unknown> } | null } | undefined
    const atlas = showCell?.imageAtlas
    if (!atlas) return
    for (const sig of images) {
      if (atlas.hasImage(sig) || atlas.hasFailed(sig)) continue
      try {
        const blob = await store.getResource(sig)
        if (blob) await atlas.loadImage(sig, blob)
      } catch { /* skip */ }
    }
  }

  async #fillPropsPool(images: string[]): Promise<void> {
    const store = this.#store()
    const settings = get('@diamondcoreprocessor.com/Settings') as
      { hexWidth(o: 'point-top' | 'flat-top'): number; hexHeight(o: 'point-top' | 'flat-top'): number } | undefined
    if (!store || !settings || images.length === 0) { this.#propsPool = []; return }

    // Pre-render every source image into both orientation aspect ratios so
    // toggling between point-top and flat-top shows a correctly-shaped tile.
    // Same two-images process the tile editor uses on save — just propagated
    // via the substrate pool instead of the editor canvas.
    const pointW = Math.round(settings.hexWidth('point-top'))
    const pointH = Math.round(settings.hexHeight('point-top'))
    const flatW = Math.round(settings.hexWidth('flat-top'))
    const flatH = Math.round(settings.hexHeight('flat-top'))

    const byImage = new Map<string, string>()
    const pool: { imageSig: string; propsSig: string }[] = []
    for (const imageSig of images) {
      if (byImage.has(imageSig)) {
        pool.push({ imageSig, propsSig: byImage.get(imageSig)! })
        continue
      }
      try {
        const sourceBlob = await store.getResource(imageSig)
        if (!sourceBlob) continue

        const pointBlob = await renderToHexBox(sourceBlob, pointW, pointH)
        const flatBlob = await renderToHexBox(sourceBlob, flatW, flatH)
        const pointSig = await store.putResource(pointBlob)
        const flatSig = await store.putResource(flatBlob)

        const props = {
          small: { image: pointSig },
          flat: { small: { image: flatSig } },
          substrate: true,
        }
        const blob = new Blob([JSON.stringify(props, null, 2)], { type: 'application/json' })
        const propsSig = await store.putResource(blob)
        byImage.set(imageSig, propsSig)
        pool.push({ imageSig, propsSig })
      } catch { /* skip */ }
    }

    // Pad to minimum pool size by cycling.
    const MIN_POOL = 50
    if (pool.length > 0 && pool.length < MIN_POOL) {
      const base = [...pool]
      while (pool.length < MIN_POOL) pool.push(base[pool.length % base.length])
    }
    this.#propsPool = pool
  }

  pickRandomImageSync(): string | null {
    if (this.#propsPool.length === 0) return null
    return this.#propsPool[Math.floor(Math.random() * this.#propsPool.length)].imageSig
  }

  // ────────────────────── cell assignment API ──────────────────────

  applyToCell(label: string): boolean {
    if (this.#propsPool.length === 0) return false
    const indexKey = 'hc:tile-props-index'
    const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
    if (index[label]) return false
    const entry = this.#propsPool[Math.floor(Math.random() * this.#propsPool.length)]
    index[label] = entry.propsSig
    localStorage.setItem(indexKey, JSON.stringify(index))
    return true
  }

  rerollCell(label: string): boolean {
    if (this.#propsPool.length === 0) return false
    const indexKey = 'hc:tile-props-index'
    const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
    delete index[label]
    const entry = this.#propsPool[Math.floor(Math.random() * this.#propsPool.length)]
    index[label] = entry.propsSig
    localStorage.setItem(indexKey, JSON.stringify(index))
    return true
  }

  clearCell(label: string): void {
    const indexKey = 'hc:tile-props-index'
    const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
    delete index[label]
    localStorage.setItem(indexKey, JSON.stringify(index))
  }

  applyToAllBlanks(labels: string[]): string[] {
    if (this.#propsPool.length === 0 || labels.length === 0) return []
    const indexKey = 'hc:tile-props-index'
    const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
    const applied: string[] = []
    for (const label of labels) {
      if (index[label]) continue
      const entry = this.#propsPool[Math.floor(Math.random() * this.#propsPool.length)]
      index[label] = entry.propsSig
      applied.push(label)
    }
    if (applied.length > 0) localStorage.setItem(indexKey, JSON.stringify(index))
    return applied
  }

  /**
   * Reroll every substrate-assigned tile with a fresh pick from the current
   * pool. Optionally re-runs warm-up first (e.g. after a linked folder got
   * new files). Returns the count of tiles reassigned.
   */
  async refresh(visibleLabels: string[], rewarm = true): Promise<number> {
    if (rewarm) await this.warmUp()
    if (this.#propsPool.length === 0) return 0

    const indexKey = 'hc:tile-props-index'
    const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
    const substrateSigs = new Set(this.#propsPool.map(p => p.propsSig))
    let cleared = 0
    for (const label of visibleLabels) {
      if (index[label] && substrateSigs.has(index[label])) {
        delete index[label]
        cleared++
      }
    }
    if (cleared > 0) localStorage.setItem(indexKey, JSON.stringify(index))

    return this.applyToAllBlanks(visibleLabels).length
  }

  // ───────────────────────── OPFS helpers ─────────────────────────

  async #readProps(dir: FileSystemDirectoryHandle): Promise<Record<string, any>> {
    try {
      const fh = await dir.getFileHandle(PROPS_FILE)
      const file = await fh.getFile()
      return JSON.parse(await file.text())
    } catch { return {} }
  }

  async #writeProps(dir: FileSystemDirectoryHandle, updates: Record<string, unknown>): Promise<void> {
    const existing = await this.#readProps(dir)
    const merged: Record<string, unknown> = { ...existing, ...updates }
    for (const k of Object.keys(updates)) if (merged[k] === null) delete merged[k]
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
    } catch { return {} }
  }

  async #writeRootProps(store: StoreHandle, updates: Record<string, unknown>): Promise<void> {
    const existing = await this.#readRootProps(store)
    const merged = { ...existing, ...updates }
    const fh = await store.opfsRoot.getFileHandle(PROPS_FILE, { create: true })
    const writable = await fh.createWritable()
    await writable.write(JSON.stringify(merged))
    await writable.close()
  }

  // ───────────────────────── IoC helpers ─────────────────────────

  #store(): StoreHandle | undefined { return get('@hypercomb.social/Store') }
  #lineage(): LineageHandle | undefined { return get('@hypercomb.social/Lineage') }
  async #explorerDir(): Promise<FileSystemDirectoryHandle | null> {
    return this.#lineage()?.explorerDir() ?? null
  }
}

window.ioc.register('@diamondcoreprocessor.com/SubstrateService', new SubstrateService())
