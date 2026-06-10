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
// Folder helpers live in this namespace — see folder-handles.ts header for why
// essentials must NOT import from @hypercomb/shared. Pulling shared into a
// module bundle drags in Angular component code, which fails JIT in the
// browser, which kills every bee in the namespace dep, which is exactly why
// the default substrate images stopped showing on web.
import {
  linkFolder as linkFolderHandle,
  getHandle as getFolderHandle,
  removeHandle as removeFolderHandle,
  queryPermission as queryFolderPermission,
  requestPermission as requestFolderPermission,
  readImagesFromHandle,
  isFolderAccessSupported,
} from './folder-handles.js'
import { readTilePropertiesAt, writeTilePropertiesAt } from '../editor/tile-properties.js'

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
  // propsSig → times currently assigned across tiles. Drives balanced picking
  // so every image gets used once before any gets used twice.
  #usageCounts: Map<string, number> = new Map()

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
    // Reconcile the label-index image assignments into the CANONICAL props
    // (background; idempotent) — without this the association only exists in
    // this browser's localStorage and adopted/synced copies render imageless.
    void this.reconcileCanonicalImageStamps()
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

    // Pool holds one entry per unique image. The balanced picker cycles
    // through entries by least-used count, so padding to a minimum size is
    // unnecessary — we'd just be adding duplicates the picker would then
    // have to work around.
    this.#propsPool = pool
    this.#seedUsageCounts()
  }

  /**
   * Rebuild per-entry usage counts from the current tile-props-index. Keeps
   * the balanced picker honest across reloads and source switches: tiles
   * already assigned to an image count against that image so we don't hand
   * the same one out again until every other image has caught up.
   */
  #seedUsageCounts(): void {
    this.#usageCounts = new Map(this.#propsPool.map(entry => [entry.propsSig, 0]))
    try {
      const index: Record<string, string> = JSON.parse(localStorage.getItem('hc:tile-props-index') ?? '{}')
      for (const propsSig of Object.values(index)) {
        if (typeof propsSig !== 'string') continue
        if (!this.#usageCounts.has(propsSig)) continue
        this.#usageCounts.set(propsSig, (this.#usageCounts.get(propsSig) ?? 0) + 1)
      }
    } catch { /* index unreadable — start from zero */ }
  }

  /**
   * Pick a pool entry from those with the lowest current usage count, then
   * increment. Random tie-breaks among least-used entries keep output
   * unpredictable without breaking the even distribution.
   */
  #pickBalanced(excludePropsSig?: string): { imageSig: string; propsSig: string } | null {
    if (this.#propsPool.length === 0) return null
    // Reroll path passes the tile's previous propsSig so the picker can avoid
    // handing back the same image — but only if alternatives exist in the pool.
    const pool = excludePropsSig && this.#propsPool.length > 1
      ? this.#propsPool.filter(e => e.propsSig !== excludePropsSig)
      : this.#propsPool
    let min = Infinity
    for (const entry of pool) {
      const count = this.#usageCounts.get(entry.propsSig) ?? 0
      if (count < min) min = count
    }
    const candidates = pool.filter(e => (this.#usageCounts.get(e.propsSig) ?? 0) === min)
    const chosen = candidates[Math.floor(Math.random() * candidates.length)]
    this.#usageCounts.set(chosen.propsSig, (this.#usageCounts.get(chosen.propsSig) ?? 0) + 1)
    return chosen
  }

  /** Decrement the usage count for a propsSig being released from a tile. */
  #releaseUsage(propsSig: string | undefined): void {
    if (!propsSig) return
    const current = this.#usageCounts.get(propsSig)
    if (current === undefined) return
    this.#usageCounts.set(propsSig, Math.max(0, current - 1))
  }

  pickRandomImageSync(): string | null {
    if (this.#propsPool.length === 0) return null
    return this.#propsPool[Math.floor(Math.random() * this.#propsPool.length)].imageSig
  }

  /** Deterministic per-label picker for display-time fallback rendering.
   *  Same label always returns the same image sig. Used by show-cell to
   *  show a substrate background on label-only tiles (those with props
   *  in the index but no `small.image`), without mutating the user's
   *  persistent props blob. */
  pickImageForLabel(label: string): string | null {
    if (this.#propsPool.length === 0) return null
    let hash = 5381
    for (let i = 0; i < label.length; i++) hash = ((hash << 5) + hash + label.charCodeAt(i)) | 0
    const idx = Math.abs(hash) % this.#propsPool.length
    return this.#propsPool[idx].imageSig
  }

  // ────────────────────── cell assignment API ──────────────────────

  applyToCell(label: string): boolean {
    if (this.#propsPool.length === 0) return false
    const indexKey = 'hc:tile-props-index'
    const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
    if (index[label]) return false
    const entry = this.#pickBalanced()
    if (!entry) return false
    index[label] = entry.propsSig
    localStorage.setItem(indexKey, JSON.stringify(index))
    return true
  }

  rerollCell(label: string): boolean {
    if (this.#propsPool.length === 0) return false
    const indexKey = 'hc:tile-props-index'
    const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
    const previous = index[label]
    this.#releaseUsage(previous)
    delete index[label]
    const entry = this.#pickBalanced(previous)
    if (!entry) return false
    index[label] = entry.propsSig
    localStorage.setItem(indexKey, JSON.stringify(index))
    return true
  }

  /**
   * Reroll every label passed in. Callers are responsible for filtering
   * to substrate-only tiles (via the `hasSubstrate` flag from render data).
   * Each label gets a fresh pick from the current pool. Labels with no
   * existing entry in the props index are skipped (they were never assigned).
   * Returns the labels that were actually rerolled — callers should emit
   * `substrate:rerolled` per returned label so show-cell can invalidate caches.
   */
  rerollCells(labels: string[]): string[] {
    if (this.#propsPool.length === 0 || labels.length === 0) return []
    const indexKey = 'hc:tile-props-index'
    const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
    const rerolled: string[] = []
    for (const label of labels) {
      const current = index[label]
      if (!current) continue
      this.#releaseUsage(current)
      delete index[label]
      const entry = this.#pickBalanced(current)
      if (!entry) break
      index[label] = entry.propsSig
      rerolled.push(label)
    }
    if (rerolled.length > 0) localStorage.setItem(indexKey, JSON.stringify(index))
    return rerolled
  }

  clearCell(label: string): void {
    const indexKey = 'hc:tile-props-index'
    const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
    this.#releaseUsage(index[label])
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
      const entry = this.#pickBalanced()
      if (!entry) break
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
      const current = index[label]
      if (current && substrateSigs.has(current)) {
        this.#releaseUsage(current)
        delete index[label]
        cleared++
      }
    }
    if (cleared > 0) localStorage.setItem(indexKey, JSON.stringify(index))

    return this.applyToAllBlanks(visibleLabels).length
  }

  // ───────────── canonical image stamping (reconciler) ─────────────
  //
  // The assignment API above writes ONLY the participant-local label index
  // (`hc:tile-props-index`). The tile's CANONICAL layer (`properties` slot)
  // never learns about the image — so an adopted/synced copy of the tree
  // renders label-only tiles: the bytes exist, but the association lives in
  // one browser's localStorage. This reconciler closes that gap: walk the
  // hive tree, and for every tile whose label has an index assignment but
  // whose canonical props lack an image key, stamp `small.image` /
  // `flat.small.image` into the canonical props via writeTilePropertiesAt
  // (content-addressed + committed through the LayerCommitter cascade, so
  // it travels with the tree). Idempotent: already-stamped tiles are
  // skipped, identical content dedups in the committer.

  #stampRunning = false

  /** Stamp index-assigned images into canonical props for every tile in the
   *  tree. Walks the LAYER tree (layer-as-primitive — tiles need no OPFS
   *  dir), falling back to the hypercomb.io/ dir walk when the history
   *  service isn't available. Returns the number stamped; idempotent. */
  async reconcileCanonicalImageStamps(): Promise<number> {
    if (this.#stampRunning) return 0
    this.#stampRunning = true
    try {
      const store = this.#store()
      if (!store) { console.info('[substrate] stamp pass: store not ready'); return 0 }
      const index: Record<string, string> = JSON.parse(localStorage.getItem('hc:tile-props-index') ?? '{}')
      const indexSize = Object.keys(index).length

      // Legacy dir-file 0000 source: the OLDEST props generation lives as a
      // `0000` FILE inside the tile's hypercomb.io/ directory. Tiles whose
      // images render from there are in NEITHER the canonical layer slot NOR
      // the label index — the host shows them fine (the editor/render
      // fallback chain reads the dir file) while every witness/adopt sees
      // nothing. Resolve the tile's dir lazily from the segments path.
      const dirPropsFor = async (segments: string[], name: string): Promise<Record<string, unknown> | null> => {
        try {
          if (!store.hypercombRoot) return null
          let dir: FileSystemDirectoryHandle = store.hypercombRoot
          for (const seg of segments) dir = await dir.getDirectoryHandle(seg, { create: false })
          const cellDir = await dir.getDirectoryHandle(name, { create: false })
          const fh = await cellDir.getFileHandle('0000', { create: false })
          const parsed = JSON.parse(await (await fh.getFile()).text())
          return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
        } catch { return null }
      }

      let stamped = 0
      let walked = 0
      let matched = 0
      const imageOf = (p: any): string | undefined => {
        const img = p?.small?.image ?? p?.flat?.small?.image
        return (typeof img === 'string' && /^[0-9a-f]{64}$/.test(img)) ? img : undefined
      }

      const stampIfNeeded = async (segments: string[], name: string): Promise<void> => {
        walked++
        try {
          const canonical = await readTilePropertiesAt(segments, name) as any
          const canonicalImg = imageOf(canonical)
          const canonicalIsDefault = canonical?.substrate === true

          // PRIORITY RULE — intentional beats default, defaults never
          // overwrite anything:
          //   1. Canonical INTENTIONAL image → untouchable. Done.
          //   2. Gather candidates from the pre-canonical generations
          //      (label index, legacy dir-file 0000) and split by intent:
          //      `substrate: true` marks a default pick; its absence marks a
          //      user-supplied image (resource-attach / tile-editor never
          //      set the flag).
          //   3. An INTENTIONAL candidate stamps over an empty slot AND over
          //      a substrate-default canonical (upgrading a tile an earlier
          //      pass default-stamped).
          //   4. A DEFAULT candidate only ever fills an EMPTY slot.
          if (canonicalImg && !canonicalIsDefault) return

          let fromIndex: any = null
          const propsSig = index[name]
          if (typeof propsSig === 'string' && /^[0-9a-f]{64}$/.test(propsSig)) {
            const blob = await store.getResource(propsSig)
            if (blob) { try { fromIndex = JSON.parse(await blob.text()) } catch { fromIndex = null } }
          }
          const fromDir = await dirPropsFor(segments, name)

          const candidates = [fromIndex, fromDir].filter(p => imageOf(p))
          const intentional = candidates.find(p => p?.substrate !== true)
          const defaultPick = candidates.find(p => p?.substrate === true)
          const source = intentional ?? (canonicalImg ? null : defaultPick)
          if (!source) return
          matched++

          await writeTilePropertiesAt(segments, name, {
            ...(source?.small?.image ? { small: { image: source.small.image } } : {}),
            ...(source?.flat?.small?.image ? { flat: { small: { image: source.flat.small.image } } } : {}),
            // Carry the default marker ONLY for default picks, and clear it
            // when an intentional image replaces one — the reroll affordance
            // must not appear on a user-supplied image.
            substrate: source?.substrate === true ? true : undefined,
          })
          stamped++
        } catch { /* one tile must not stop the pass */ }
      }

      // PRIMARY: walk the layer tree — the same source the swarm publishes
      // from. Tiles are layer-state; many have NO OPFS directory, so a dir
      // walk silently misses them (the original bug: 0 stamped on a tree
      // that renders fine).
      const history = get('@diamondcoreprocessor.com/HistoryService') as {
        sign?: (l: { explorerSegments?: () => readonly string[] }) => Promise<string>
        currentLayerAt?: (sig: string) => Promise<unknown>
        getLayerBySig?: (s: string) => Promise<{ name?: string } | null>
      } | undefined

      if (history?.sign && history?.currentLayerAt && history?.getLayerBySig) {
        const childNamesAt = async (segments: string[]): Promise<string[]> => {
          try {
            // Segments pass through RAW — the root bag signs as the EMPTY
            // list (sig e3b0c442…, the hash of ''), matching how show-cell /
            // the swarm sign locations. (viewport-store's ROOT_NAME='/'
            // convention names a DIFFERENT, empty decoy bag — substituting it
            // here made the walk read 0 children at root, forever.)
            const sig = await history.sign!({ explorerSegments: () => [...segments] })
            if (!sig) return []
            const layer = await history.currentLayerAt!(sig) as { children?: readonly unknown[] } | null
            const sigs = Array.isArray(layer?.children) ? layer!.children! : []
            const names = await Promise.all(sigs.map(async (cs) => {
              try { return (await history.getLayerBySig!(String(cs ?? '')))?.name ?? null }
              catch { return null }
            }))
            return names.filter((n): n is string => typeof n === 'string' && n.length > 0)
          } catch { return [] }
        }
        const walkLayers = async (segments: string[]): Promise<void> => {
          if (segments.length > 8) return
          for (const name of await childNamesAt(segments)) {
            await stampIfNeeded(segments, name)
            await walkLayers([...segments, name])
          }
        }
        await walkLayers([])
      } else if (store.hypercombRoot) {
        // FALLBACK: legacy dir-backed tiles.
        const walkDirs = async (dir: FileSystemDirectoryHandle, segments: string[]): Promise<void> => {
          if (segments.length > 8) return
          for await (const [name, handle] of (dir as any).entries()) {
            if (handle.kind !== 'directory' || name.startsWith('__')) continue
            await stampIfNeeded(segments, name)
            await walkDirs(handle as FileSystemDirectoryHandle, [...segments, name])
          }
        }
        await walkDirs(store.hypercombRoot, [])
      }

      // Always log the summary — the silent-0 case is exactly what made the
      // earlier failures (dir walk on a dir-less tree, too-early boot timer)
      // invisible. walked=0 means the tree walk found nothing (history not
      // ready or empty root); matched=0 with walked>0 means labels in the
      // tree don't match index keys.
      console.info(`[substrate] stamp pass: index=${indexSize} walked=${walked} matched=${matched} stamped=${stamped}`)
      return stamped
    } catch (err) { console.warn('[substrate] stamp pass failed', err); return 0 }
    finally { this.#stampRunning = false }
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

const _substrateService = new SubstrateService()
window.ioc.register('@diamondcoreprocessor.com/SubstrateService', _substrateService)

// BOOT-TIME RECONCILE — stamps label-index image assignments into the
// canonical 0000 so the tile's image travels everywhere its layer does:
// the swarm publish inlines canonical props (readTilePropertiesAt), stamping
// fires cell:0000-changed, and SwarmDrone's existing listener republishes —
// so the witness sees the EXACT image + position the host renders, and
// adopts carry both.
//
// RETRY SCHEDULE, not a one-shot: a single 15s timer raced the hive boot
// (install/preload can exceed it) — if History/Store/bags weren't ready the
// pass no-opped silently and never ran again that session. Each attempt
// logs its summary; retries stop early once a pass actually stamps, and the
// passes are idempotent so overlapping schedules are harmless.
{
  const delays = [15_000, 45_000, 120_000, 300_000]
  let done = false
  for (const d of delays) {
    setTimeout(() => {
      if (done) return
      void _substrateService.reconcileCanonicalImageStamps().then(n => { if (n > 0) done = true })
    }, d)
  }
}
