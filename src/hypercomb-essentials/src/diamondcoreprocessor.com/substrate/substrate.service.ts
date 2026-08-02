// diamondcoreprocessor.com/substrate/substrate.service.ts
//
// SubstrateService — manages the image collection used as default
// backgrounds for cells that have no image of their own.
//
// Sources (unified abstraction):
//   layer   — a layer addressed by signature (bytes at the flat OPFS
//             root; the legacy `__layers__` dir is a read-fallback drain
//             source inside Store)
//   hive    — a content-tree path (cells with images); dirs resolve
//             root-first then through the legacy content roots
//   folder  — a live FileSystemDirectoryHandle persisted in IDB
//   url     — a remote bundle with manifest.json { images: string[] }
//
// Resolution cascade:
//   per-hive substrate (walk lineage, respect inherit=false)
//     → registry.activeId
//     → first builtin in registry
//     → none
//
// Storage (pools-of-meaning model):
//   sign('substrate:sources') pool, `registry` file → SubstrateRegistry JSON
//   sign('substrate:sources') pool, `<locationSig>` files → per-hive overrides
//   sign('substrate:references') pool, `<imageSig>` files → copied references
//   RETIRED (read-fallback, drained per record then removed):
//     the sign('substrate') pool
//     ({ substrate: path | null, 'substrate-inherit': boolean })
//   LEGACY (read-fallback only, drained by the detached scrub):
//     root OPFS `0000` → `substrate-registry` key
//     per-hive dir `0000` → `substrate` / `substrate-inherit` keys

import { EffectBus, SignatureService, type SubstrateSource, type SubstrateRegistry, EMPTY_SUBSTRATE_REGISTRY } from '@hypercomb/core'
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
import { readTilePropertiesAt, readTilePropsSigAt, writeTilePropertiesAt, cellLocationSig, readTilePropsIndex, writeTilePropsIndex, lookupTilePropsSig } from '../editor/tile-properties.js'

const PROPS_FILE = '0000'                    // legacy per-hive dir props (read-fallback)
const HIVE_KEY = 'substrate'                 // per-hive override (path string)
const INHERIT_KEY = 'substrate-inherit'      // per-hive barrier
const REGISTRY_KEY = 'substrate-registry'    // LEGACY root-0000 property (read-fallback)
const LEGACY_GLOBAL_KEY = 'substrate-global' // migrated into registry on load
const LEGACY_LS_GLOBAL = 'hc:substrate-global'

// Pools-of-meaning storage. Addresses are DERIVED — sha256 of the UTF-8
// bytes of the meaning — never a hardcoded hex and never a typed folder.
//
//   substrate:sources     the registry record + per-location override records
//                      (keyed by location sig)
//   substrate:references  ONE FILE PER COPIED REFERENCE, named by the image
//                      signature. The listing IS the collection: copying a
//                      reference in is the whole write, and the same image
//                      copied twice lands on the same filename.
//
// The two are SEPARATE pools on purpose. Override records are keyed by
// location sig — also 64 hex — so one pool could not tell an override from
// a reference by name, and the listing that resolves the collection would
// sweep the overrides in with the images.
const SOURCES_MEANING = 'substrate:sources'
const REFERENCES_MEANING = 'substrate:references'

// ── drain sources, newest first. Read-only, every one of them. ───────────
//
// `substrate` — RETIRED bare word. It hashes to the same directory as a root
// tile named `substrate` (sign(meaning) and sign(lineageKey) share the
// preimage), which is why it moved to the colon spellings above.
//
// `places:*` — SHORT-LIVED and never shipped: the surface was briefly renamed
// Places before that name went to the collections index instead. A dev build
// DID write a registry record there, and the bare-word drain had already
// removed the record it copied forward — so skipping this link would strand
// the sources of anyone who ran that build. Chained, not replaced.
//
// Deliberately NOT named `*_MEANING`: the doctrine ratchet scans that
// identifier shape for newly MINTED bare-word meanings, and these are being
// drained away rather than minted.
const RETIRED_SOURCE_POOLS = ['places:sources', 'substrate'] as const
const RETIRED_REFERENCE_POOLS = ['places:references'] as const
const REGISTRY_RECORD = 'registry'
const SIG_NAME_RE = /^[0-9a-f]{64}$/

// Built-in TILE background sets shipped with the app, seeded on first load.
// Each set is a url source whose baseUrl hosts manifest.json + PNGs:
//   • Photos   — the original photo bundle (the flat /substrate/ collection),
//                kept under its ORIGINAL id so existing registries resolve. The
//                default tile fill.
//   • Minimal / Geometric / Abstract / Nature — themed per-tile artwork; switch
//                with `/substrate set <name>`.
// (The steel/daylight/indigo/teal/ember gradient sets are CANVAS backgrounds
// now — see CanvasBackgroundService + /canvas — not tile sources.) Origin-
// absolute baseUrls so deep navigation paths don't break relative fetch.
// DEFAULT_SET_ID is the LEGACY id of the brief v2 tile default (Steel) — kept
// only so the one-time v3 migration can move those users back to Photos.
const DEFAULT_SET_ID = 'builtin:steel'
const PHOTOS_SET_ID = 'builtin:defaults'
// The participant's own references — the one source with no location to walk.
const REFERENCES_SET_ID = 'builtin:references'
// One-time migration marker: bumps when the shipped built-in set list changes
// in a way that should advance an unconfigured (ship-default) active source.
// v3: the themed sets moved to being CANVAS (screen) backgrounds — tiles default
// back to the Photos collection; per-tile themed backgrounds are a separate
// feature. The themed sets stay registered (selectable via /substrate set) but
// are no longer the tile default.
const SETS_VERSION_LS = 'hc:substrate-sets-v'
const SETS_VERSION = '3'

const BUILTIN_SETS: SubstrateSource[] = [
  { type: 'url', id: PHOTOS_SET_ID,             baseUrl: '/substrate/',                  label: 'Photos',    builtin: true },
  { type: 'url', id: 'builtin:theme-minimal',   baseUrl: '/substrate/theme-minimal/',    label: 'Minimal',   builtin: true },
  { type: 'url', id: 'builtin:theme-geometric', baseUrl: '/substrate/theme-geometric/',  label: 'Geometric', builtin: true },
  { type: 'url', id: 'builtin:theme-abstract',  baseUrl: '/substrate/theme-abstract/',   label: 'Abstract',  builtin: true },
  { type: 'url', id: 'builtin:theme-nature',    baseUrl: '/substrate/theme-nature/',     label: 'Nature',    builtin: true },
  // The five palette sets. Their tile rasters shipped in `public/substrate/`
  // but the sources had been dropped from this list, which orphaned them —
  // nothing could select the images. A background theme names one of these as
  // the tiles half of its look (see BackgroundThemeService). New builtins are
  // merged on every load, so this needs no SETS_VERSION bump: the version only
  // governs whether an UNCONFIGURED active source advances.
  { type: 'url', id: 'builtin:steel',    baseUrl: '/substrate/steel/',    label: 'Steel',    builtin: true },
  { type: 'url', id: 'builtin:daylight', baseUrl: '/substrate/daylight/', label: 'Daylight', builtin: true },
  { type: 'url', id: 'builtin:indigo',   baseUrl: '/substrate/indigo/',   label: 'Indigo',   builtin: true },
  { type: 'url', id: 'builtin:teal',     baseUrl: '/substrate/teal/',     label: 'Teal',     builtin: true },
  { type: 'url', id: 'builtin:ember',    baseUrl: '/substrate/ember/',    label: 'Ember',    builtin: true },
  // The participant's own collection — resolves from the references pool,
  // no walk. LAST on purpose: `resolve()` falls back to the FIRST builtin,
  // and a reference set nothing has been copied into yet is empty, which would
  // leave tiles with no substrate at all.
  { type: 'references', id: REFERENCES_SET_ID, label: 'References', builtin: true },
]

const get = (key: string) => (window as any).ioc?.get?.(key)

type StoreHandle = {
  opfsRoot: FileSystemDirectoryHandle
  /** The flat content root — IS the OPFS root now. Named tile dirs no
   *  longer live here; they linger in the legacy content roots below
   *  until the self-cleaning relocation drains them. */
  hypercombRoot: FileSystemDirectoryHandle
  /** Legacy content roots (`__hive__/`, `hypercomb.io/`) — optional,
   *  opened create:false by Store; the dir walkers below fall back
   *  through them while they exist. */
  legacyHive?: FileSystemDirectoryHandle
  legacyHypercombIo?: FileSystemDirectoryHandle
  /** Open (creating if needed) the sign(meaning) pool for a meaning. */
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
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

/**
 * Strip directory + extension from a source image name, leaving a short
 * lowercase token (e.g. `/substrate/night-rock.webp` → `night-rock`). This is
 * the name the /backgrounds queen lists and matches against.
 */
function friendlyImageName(name: string): string {
  const base = name.split('/').pop() ?? name
  return base.replace(/\.[^.]+$/, '').trim().toLowerCase()
}

export class SubstrateService extends EventTarget {
  #loaded = false
  #registry: SubstrateRegistry = EMPTY_SUBSTRATE_REGISTRY
  #resolved: ResolvedSource | null = null
  #propsPool: { imageSig: string; propsSig: string }[] = []
  // propsSig → times currently assigned across tiles. Drives balanced picking
  // so every image gets used once before any gets used twice.
  #usageCounts: Map<string, number> = new Map()
  // imageSig → friendly label (manifest filename / tile name / file name).
  // Rebuilt on every warm-up so the /backgrounds queen can name the pool.
  #imageNames: Map<string, string> = new Map()
  // Session-only availability switches: imageSigs the participant toggled OFF
  // this session via /backgrounds. NEVER persisted — not in the registry, the
  // layer, or localStorage — so it resets to all-on on reload and peers never
  // see it. The picker simply skips these images.
  #disabledImages: Set<string> = new Set()

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
    let fromLegacy = false
    // Canonical: the sign('substrate:sources') pool `registry` record. Legacy
    // read-fallback: the root `0000` props under `substrate-registry`.
    try {
      const rec = await this.#readPoolRecord(store, REGISTRY_RECORD)
      if (rec && Array.isArray((rec as any).sources)) {
        registry = rec as unknown as SubstrateRegistry
      }
    } catch { /* pool miss */ }
    if (!registry) {
      try {
        const props = await this.#readRootProps(store)
        const raw = props[REGISTRY_KEY]
        if (raw && typeof raw === 'object' && Array.isArray((raw as any).sources)) {
          registry = raw as SubstrateRegistry
          fromLegacy = true
        }
      } catch { /* no root props */ }
    }
    // Migrate a legacy-sourced registry into the pool, then scrub the
    // legacy root keys — self-cleaning, detached from any read path.
    if (registry && fromLegacy) {
      await this.#saveRegistry(registry)
      void this.#scrubLegacyRootRegistry(store)
    }

    if (!registry) {
      // First-ever load — seed with all built-in sets, Photos active (the
      // themed sets are now canvas backgrounds, not the tile default).
      registry = { sources: [...BUILTIN_SETS], activeId: PHOTOS_SET_ID }

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
          registry = { sources: [...BUILTIN_SETS, hiveSource], activeId: hiveSource.id }
        }
      } catch { /* ignore */ }

      try { localStorage.setItem(SETS_VERSION_LS, SETS_VERSION) } catch { /* ignore */ }
      await this.#saveRegistry(registry)
    } else {
      registry = await this.#mergeBuiltinSets(registry)
    }

    this.#registry = registry

    // Detached, off the boot path: absorb anything a short-lived spelling left
    // behind. Copy-forward only and idempotent, so a partial run finishes on
    // the next boot and a failure costs nothing.
    void this.#drainRetiredReferences(store)
  }

  /**
   * Reconcile an existing registry with the current built-in set list:
   * ensure every built-in set is present with its canonical label/baseUrl,
   * preserve user-added sources, and one-time reset an UNCONFIGURED active
   * source back to the Photos default — undoing the brief v2 ship that made the
   * Steel themed-set the tile default before those designs became canvas
   * backgrounds. A deliberate later choice is left untouched because the
   * version marker only fires once. Persists only when something changed.
   */
  async #mergeBuiltinSets(registry: SubstrateRegistry): Promise<SubstrateRegistry> {
    const userSources = registry.sources.filter(s => !s.builtin)
    const sources = [...BUILTIN_SETS, ...userSources]

    let activeId = registry.activeId
    let migrated = false
    try {
      if (localStorage.getItem(SETS_VERSION_LS) !== SETS_VERSION) {
        if (activeId === DEFAULT_SET_ID || activeId === null) activeId = PHOTOS_SET_ID
        localStorage.setItem(SETS_VERSION_LS, SETS_VERSION)
        migrated = true
      }
    } catch { /* localStorage unavailable — skip the one-time reset */ }

    // Heal a dangling active source — e.g. a retired gradient set that's no
    // longer a built-in and was never a user source. Substrate must always
    // resolve, so fall back to the Photos default.
    let healed = false
    if (activeId && !sources.some(s => s.id === activeId)) { activeId = PHOTOS_SET_ID; healed = true }

    const builtinsChanged = registry.sources.length !== sources.length
      || BUILTIN_SETS.some(b => {
        const ex = registry.sources.find(s => s.id === b.id)
        return !ex
          || ex.label !== b.label
          || (ex.type === 'url' && b.type === 'url' && ex.baseUrl !== b.baseUrl)
      })

    const next: SubstrateRegistry = { sources, activeId }
    if (migrated || builtinsChanged || healed) await this.#saveRegistry(next)
    return next
  }

  async #saveRegistry(next: SubstrateRegistry): Promise<void> {
    this.#registry = next
    const store = this.#store()
    if (!store) return
    try {
      // Registry lives in the sign('substrate:sources') pool `registry` record —
      // never the legacy root `0000` (which collides with the root sigbag
      // marker convention). The legacy keys are scrubbed on first migrate.
      await this.#writePoolRecord(store, REGISTRY_RECORD, next as unknown as Record<string, unknown>)
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
    if (!(await this.#writeOverride({ [HIVE_KEY]: path }))) return
    EffectBus.emit('substrate:changed', { scope: 'hive', path })
  }

  async clearHive(): Promise<void> {
    if (!(await this.#writeOverride({ [HIVE_KEY]: null }))) return
    EffectBus.emit('substrate:changed', { scope: 'hive', path: null })
  }

  async setInherit(inherit: boolean): Promise<void> {
    if (!(await this.#writeOverride({ [INHERIT_KEY]: inherit }))) return
    EffectBus.emit('substrate:changed', { scope: 'inherit', inherit })
  }

  /** Merge-write a per-hive override for the CURRENT location into the
   *  sign('substrate:sources') pool, keyed by that location's sig — never a
   *  per-hive dir `0000` (a legacy-tree write the new model forbids). The
   *  existing pool record (and, as a read-fallback, the legacy dir `0000`)
   *  seeds the merge so a partial update never drops the other key.
   *  Returns false when the store/location isn't resolvable yet. */
  async #writeOverride(patch: Record<string, unknown>): Promise<boolean> {
    const store = this.#store()
    if (!store) return false
    const segments = this.#lineage()?.explorerSegments?.() ?? []
    const locSig = await this.#locationSig(segments)
    if (!locSig) return false
    const existing = (await this.#readPoolRecord(store, locSig))
      ?? (await this.#legacyDirProps(store, segments))
      ?? {}
    await this.#writePoolRecord(store, locSig, { ...existing, ...patch })
    return true
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
      // Canonical: the sign('substrate:sources') pool record keyed by this
      // ancestor's location sig. Legacy read-fallback: the per-hive dir
      // `0000` (only present in the not-yet-drained content trees).
      let props: Record<string, unknown> | null = null
      const locSig = await this.#locationSig(segments)
      if (locSig) props = await this.#readPoolRecord(store, locSig)
      if (!props) props = await this.#legacyDirProps(store, segments)

      if (props) {
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
      }
      segments.pop()
    }
    return null
  }

  /** LEGACY read-fallback for a per-hive override: resolve the named
   *  segments path to its (still-undrained) content-tree dir and read the
   *  `0000` props file. Null when the dir/file is gone. */
  async #legacyDirProps(store: StoreHandle, segments: readonly string[]): Promise<Record<string, unknown> | null> {
    const dir = await this.#segmentsToDir(store, segments)
    if (!dir) return null
    const props = await this.#readProps(dir)
    return Object.keys(props).length > 0 ? props : null
  }

  // ────────────────────── copied references ──────────────────────
  //
  // A place is a SIGNATURE, not a copy. The bytes already sit at the OPFS
  // root under that sig, so copying a reference in writes an empty marker
  // named by the sig and nothing else — the same image referenced from two
  // collections is still stored once, and the pool listing IS the set.

  /** Every reference currently copied in. Unordered — a pool is a set. */
  async listReferences(): Promise<string[]> {
    const store = this.#store()
    if (!store) return []
    const pool = await this.#referencesPool(store)
    if (!pool) return []
    const sigs: string[] = []
    try {
      for await (const name of (pool as any).keys()) {
        if (SIG_NAME_RE.test(name)) sigs.push(name)
      }
    } catch { /* pool unreadable */ }
    return sigs
  }

  /** Copy a reference in. Idempotent — same sig, same filename. */
  async addReference(signature: string): Promise<boolean> {
    if (!SIG_NAME_RE.test(signature)) return false
    const store = this.#store()
    if (!store) return false
    const pool = await this.#referencesPool(store)
    if (!pool) return false
    try { await pool.getFileHandle(signature, { create: true }) } catch { return false }
    this.#invalidateResolvedReferences()
    EffectBus.emit('substrate:changed', { scope: 'references', signature })
    return true
  }

  /** Drop a reference. Removes the MARKER only — the image bytes at the
   *  root are content, possibly referenced from tiles or other
   *  collections, and are never touched here. */
  async removeReference(signature: string): Promise<boolean> {
    if (!SIG_NAME_RE.test(signature)) return false
    const store = this.#store()
    if (!store) return false
    const pool = await this.#referencesPool(store)
    if (!pool) return false
    try { await pool.removeEntry(signature) } catch { return false }
    this.#invalidateResolvedReferences()
    EffectBus.emit('substrate:changed', { scope: 'references', signature })
    return true
  }

  /** Copy a reference in for every image on the tiles at `path`.
   *  This is the "just copy references in there" gesture: it walks the same
   *  tiles a hive source would, but instead of BINDING to that path it
   *  takes the signatures and lets go — the collection keeps working after
   *  the page is renamed, re-homed, or deleted. Returns how many landed. */
  async copyReferencesFromHive(path: string): Promise<number> {
    const sigs = await this.#loadHiveImages(path)
    let copied = 0
    for (const sig of sigs) if (await this.addReference(sig)) copied++
    return copied
  }

  /** Force the next warm-up to re-list the pool when the reference set is what's
   *  currently resolved. Same drop `setActive` performs on a switch. */
  #invalidateResolvedReferences(): void {
    if (this.#resolved?.source.type !== 'references') return
    this.#resolved = null
    this.#propsPool = []
  }

  // ─────────────────── source resolvers (per type) ───────────────────

  async #loadSourceImages(source: SubstrateSource): Promise<string[]> {
    switch (source.type) {
      case 'hive':   return this.#loadHiveImages(source.path)
      case 'url':    return this.#loadUrlImages(source.baseUrl)
      case 'folder': return this.#loadFolderImages(source.handleId)
      case 'layer':  return this.#loadLayerImages(source.signature)
      case 'references': return this.#loadReferenceImages()
    }
  }

  /** References resolve with no walk at all — the pool listing IS the image
   *  set, and every member is already a root-addressed signature. */
  async #loadReferenceImages(): Promise<string[]> {
    const sigs = await this.listReferences()
    for (const sig of sigs) {
      if (!this.#imageNames.has(sig)) this.#imageNames.set(sig, sig.slice(0, 8))
    }
    return sigs
  }

  async #loadHiveImages(layerPath: string): Promise<string[]> {
    const store = this.#store()
    if (!store) return []
    const images: string[] = []
    const propsIndex = readTilePropsIndex()
    const pathSegments = layerPath.split('/').filter(Boolean)
    try {
      // Named tile dirs live in the (undrained) legacy content roots — the
      // union resolver walks root-first then the legacy roots.
      const dir = await this.#segmentsToDir(store, pathSegments)
      if (!dir) return images
      for await (const [name, handle] of (dir as any).entries()) {
        if (handle.kind !== 'directory') continue
        try {
          const propsSig = lookupTilePropsSig(propsIndex, await cellLocationSig(pathSegments, name), name)
          if (!propsSig) continue
          const blob = await store.getResource(propsSig)
          if (!blob) continue
          const props = JSON.parse(await blob.text())
          const sig = props?.small?.image ?? props?.flat?.small?.image
          if (typeof sig === 'string' && /^[0-9a-f]{64}$/.test(sig)) {
            this.#imageNames.set(sig, friendlyImageName(name))
            images.push(sig)
          }
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
        this.#imageNames.set(sig, friendlyImageName(name))
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
    for (const { name, blob } of files) {
      try {
        const sig = await store.putResource(blob)
        this.#imageNames.set(sig, friendlyImageName(name))
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

    // Names are re-derived from the source each warm-up; clear stale ones so a
    // source switch doesn't leave another source's labels in the map.
    this.#imageNames.clear()
    const images = await this.#loadSourceImages(source)
    this.#resolved = { source, images }

    await this.#preloadAtlas(images)
    await this.#fillPropsPool(images)
    // Reconcile canonical <-> index BOTH ways (idempotent): stamp index-only
    // images into the CANONICAL slot so they travel with the layer, AND seed
    // the local index from canonical so an imaged tile is never missing its
    // index entry on this device (adopted / synced / cross-device).
    //
    // DEFERRED off the boot/paint path: it walks the layer tree, so running it
    // inline warmed the ENTIRE hive into the layer cache and its OPFS churn
    // starved the user's first clicks. It self-skips when the hive is unchanged
    // (fingerprint gate), so most sessions do nothing; when it does run, idle
    // keeps it clear of first paint and first interaction.
    const runReconcile = (): void => { void this.reconcileCanonicalImageStamps() }
    if (typeof requestIdleCallback === 'function') requestIdleCallback(runReconcile, { timeout: 10000 })
    else setTimeout(runReconcile, 5000)
  }

  // (Removed: #migrateLegacySubstrateProps — a one-time pass that DELETED
  // legacy-format substrate index entries so applyToAllBlanks would re-pick a
  // new random image. It violated both invariants at once: it CLEARED index
  // entries (an imaged tile must never lack an index) and it CHANGED an image
  // already present (re-roll). The reconciler now heals any cleared entry from
  // canonical, and an old-format substrate pick simply stays as it is.)

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
  /**
   * The pool minus images toggled off this session (see #disabledImages).
   * Returns an empty array when every image is disabled — picks then return
   * null and tiles stay blank, honouring an explicit all-off.
   */
  #enabledPool(): { imageSig: string; propsSig: string }[] {
    if (this.#disabledImages.size === 0) return this.#propsPool
    return this.#propsPool.filter(e => !this.#disabledImages.has(e.imageSig))
  }

  #pickBalanced(excludePropsSig?: string): { imageSig: string; propsSig: string } | null {
    const enabled = this.#enabledPool()
    if (enabled.length === 0) return null
    // Reroll path passes the tile's previous propsSig so the picker can avoid
    // handing back the same image — but only if alternatives exist in the pool.
    const pool = excludePropsSig && enabled.length > 1
      ? enabled.filter(e => e.propsSig !== excludePropsSig)
      : enabled
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
    const pool = this.#enabledPool()
    if (pool.length === 0) return null
    return pool[Math.floor(Math.random() * pool.length)].imageSig
  }

  /** Deterministic per-label picker for display-time fallback rendering.
   *  Same label always returns the same image sig. Used by show-cell to
   *  show a substrate background on label-only tiles (those with props
   *  in the index but no `small.image`), without mutating the user's
   *  persistent props blob. */
  pickImageForLabel(label: string): string | null {
    const pool = this.#enabledPool()
    if (pool.length === 0) return null
    let hash = 5381
    for (let i = 0; i < label.length; i++) hash = ((hash << 5) + hash + label.charCodeAt(i)) | 0
    const idx = Math.abs(hash) % pool.length
    return pool[idx].imageSig
  }

  // ───────────── availability (session-only toggle) ─────────────
  //
  // View and flip which images in the current pool are available for
  // assignment. Lives entirely in memory (#disabledImages): never written to
  // the registry, the layer, or localStorage, so it resets to all-on on reload
  // and is invisible to peers. Backs the /backgrounds queen.

  /** Every image in the current pool, with a friendly name and on/off state.
   *  Deduped by image, sorted by name. */
  listImages(): { name: string; imageSig: string; enabled: boolean }[] {
    const seen = new Set<string>()
    const out: { name: string; imageSig: string; enabled: boolean }[] = []
    for (const { imageSig } of this.#propsPool) {
      if (seen.has(imageSig)) continue
      seen.add(imageSig)
      out.push({
        name: this.#imageNames.get(imageSig) ?? imageSig.slice(0, 8),
        imageSig,
        enabled: !this.#disabledImages.has(imageSig),
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Resolve a user-typed token to a pooled imageSig: exact name, then name
   *  prefix, then sig prefix. Null when nothing matches. */
  #resolveImage(token: string): string | null {
    const q = token.trim().toLowerCase()
    if (!q) return null
    const images = this.listImages()
    return images.find(i => i.name === q)?.imageSig
      ?? images.find(i => i.name.startsWith(q))?.imageSig
      ?? images.find(i => i.imageSig.startsWith(q))?.imageSig
      ?? null
  }

  /** The props signatures of every image in the CURRENT pool. This is the test
   *  for "the picture on this tile is one a substrate pool put there" — a tile
   *  wearing anything else is the participant's own and must never be
   *  overwritten. Callers hold the OUTGOING pool's sigs across a source switch
   *  so the picture the previous theme applied can be recognised. */
  get poolSigs(): readonly string[] { return this.#propsPool.map(p => p.propsSig) }

  /** Pin ONE image from the pool: every pick returns it, so a wall of tiles
   *  wears the same picture. Built on the same session-only enabled set as
   *  toggleImage — nothing is persisted, written to a layer, or seen by peers,
   *  and a reload returns the whole group. Null when the token matches
   *  nothing. */
  pinImage(token: string): { name: string } | null {
    const sig = this.#resolveImage(token)
    if (!sig) return null
    this.#disabledImages.clear()
    for (const image of this.listImages()) if (image.imageSig !== sig) this.#disabledImages.add(image.imageSig)
    return { name: this.#imageNames.get(sig) ?? sig.slice(0, 8) }
  }

  /** Undo a pin — the whole group is available again, so tiles vary. */
  unpinImages(): void { this.#disabledImages.clear() }

  /**
   * Re-dress tiles from the active pool, replacing ONLY pictures that a
   * substrate pool put there. `ownedSigs` names which pools may be replaced
   * (normally the outgoing pool plus the incoming one); a tile wearing anything
   * else — a picture the participant attached, anything from outside a theme
   * pack — keeps it. Returns the labels actually re-dressed.
   */
  async restyle(labels: string[], ownedSigs: ReadonlySet<string>): Promise<string[]> {
    if (labels.length === 0) return []
    const index = readTilePropsIndex()
    let cleared = 0
    for (const label of labels) {
      const key = await this.#indexKeyFor(label)
      const current = lookupTilePropsSig(index, key, label)
      if (!current || !ownedSigs.has(current)) continue
      this.#releaseUsage(current)
      delete index[key || label]
      if (index[label] === current) delete index[label]
      cleared++
    }
    if (cleared > 0) writeTilePropsIndex(index)
    return this.applyToAllBlanks(labels)
  }

  /**
   * Every tile label in the hive, from the LAYER tree — the same source the
   * swarm publishes from. Tiles are layer state and many have no OPFS
   * directory, so a directory walk misses them. Depth-capped like the stamp
   * pass; returns an empty list when history is not ready.
   */
  async allLabels(): Promise<string[]> {
    const history = get('@diamondcoreprocessor.com/HistoryService') as {
      sign?: (l: { explorerSegments?: () => readonly string[] }) => Promise<string>
      currentLayerAt?: (sig: string) => Promise<unknown>
      getLayerBySig?: (s: string) => Promise<{ name?: string } | null>
    } | undefined
    if (!history?.sign || !history?.currentLayerAt || !history?.getLayerBySig) return []

    const childNamesAt = async (segments: string[]): Promise<string[]> => {
      try {
        // Segments pass through RAW — the root bag signs as the EMPTY list.
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

    const out: string[] = []
    const walk = async (segments: string[]): Promise<void> => {
      if (segments.length > 8) return
      for (const name of await childNamesAt(segments)) {
        out.push(name)
        await walk([...segments, name])
      }
    }
    await walk([])
    return out
  }

  /** Toggle one image's availability (session-only). Returns the resolved
   *  name + new enabled state, or null when the token matches no pooled image. */
  toggleImage(token: string): { name: string; enabled: boolean } | null {
    const sig = this.#resolveImage(token)
    if (!sig) return null
    const wasDisabled = this.#disabledImages.has(sig)
    if (wasDisabled) this.#disabledImages.delete(sig)
    else this.#disabledImages.add(sig)
    return { name: this.#imageNames.get(sig) ?? sig.slice(0, 8), enabled: wasDisabled }
  }

  /** Reroll the visible tiles currently showing an image that's now toggled
   *  off, so a toggle-off is reflected immediately. Tiles on still-enabled
   *  images are left untouched. Returns the labels actually rerolled — callers
   *  should emit `substrate:rerolled` per label so show-cell invalidates caches. */
  async rerollDisabledOnVisible(labels: string[], segments?: readonly string[]): Promise<string[]> {
    if (this.#disabledImages.size === 0 || labels.length === 0) return []
    const disabledProps = new Set(
      this.#propsPool.filter(e => this.#disabledImages.has(e.imageSig)).map(e => e.propsSig),
    )
    if (disabledProps.size === 0) return []
    const index = readTilePropsIndex()
    const stale: string[] = []
    for (const label of labels) {
      const key = await this.#indexKeyFor(label, segments)
      const current = lookupTilePropsSig(index, key, label)
      if (current && disabledProps.has(current)) stale.push(label)
    }
    return this.rerollCells(stale, segments)
  }

  // ────────────────────── cell assignment API ──────────────────────
  //
  // Index entries are keyed by the tile's FULL-LINEAGE sig (the sigbag
  // key — see tile-properties.ts). Bare-label legacy entries are read
  // as fallback but writes and removals touch only the lineage-keyed
  // entry, so same-named tiles at other hive locations are never mixed.

  /** Full-lineage index key for `label` at `segments` (or the current
   *  location when omitted). '' when the history service isn't up yet —
   *  callers then degrade to the legacy bare-label key. */
  async #indexKeyFor(label: string, segments?: readonly string[]): Promise<string> {
    const segs = segments ?? this.#lineage()?.explorerSegments?.() ?? []
    return cellLocationSig([...segs], label)
  }

  /** FILL-IF-EMPTY guard against the CANONICAL store, not just the index.
   *  The localStorage index can lose a tile's entry (cleared storage, the
   *  legacy-format migration in #migrateLegacySubstrateProps) while the
   *  tile's layer `properties` slot still holds a real image. Such a tile is
   *  NOT blank — rolling a random pick over it would change an image that is
   *  already there. Returns true when the canonical slot already carries a
   *  small.image / flat.small.image. Cheap because callers only reach it on
   *  the rare index-miss path.
   *
   *  A COLD read counts as "has an image" — i.e. DON'T assign. A transient
   *  miss (services still registering, layer head not warmed, props bytes not
   *  pooled yet) is indistinguishable from a genuine blank by value alone,
   *  and getting it wrong is not symmetric: skipping leaves the tile blank for
   *  one more render pass (the next `render:cell-count` retries), while
   *  assigning writes a default into the local index that then OUTRANKS the
   *  tile's real image on every future render — the renderer resolves props
   *  through the index, so the default sticks until the user re-saves the tile
   *  through the editor. Wait for a resolved read instead of guessing. */
  async #hasCanonicalImage(label: string, segments?: readonly string[]): Promise<boolean> {
    const segs = segments ?? this.#lineage()?.explorerSegments?.() ?? []
    const stats: { cold?: boolean } = {}
    try {
      // `any` (not Record<string,…>) so the chained property access is allowed
      // under the Angular build's noPropertyAccessFromIndexSignature — same
      // shape as reconcileCanonicalImageStamps' imageOf helper.
      const props = await readTilePropertiesAt([...segs], label, stats) as any
      if (stats.cold) return true          // unresolved — never overwrite blind
      const img = props?.small?.image ?? props?.flat?.small?.image
      return typeof img === 'string' && /^[0-9a-f]{64}$/.test(img)
    } catch { return true }                // read threw — same reasoning
  }

  async applyToCell(label: string, segments?: readonly string[]): Promise<boolean> {
    if (this.#propsPool.length === 0) return false
    const key = await this.#indexKeyFor(label, segments)
    const index = readTilePropsIndex()
    if (lookupTilePropsSig(index, key, label)) return false
    // Not blank if the canonical slot already holds an image (index entry
    // merely lost) — never re-roll a present image (e.g. revert-remove re-add).
    if (await this.#hasCanonicalImage(label, segments)) return false
    const entry = this.#pickBalanced()
    if (!entry) return false
    index[key || label] = entry.propsSig
    writeTilePropsIndex(index)
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
  async rerollCells(labels: string[], segments?: readonly string[]): Promise<string[]> {
    if (this.#propsPool.length === 0 || labels.length === 0) return []
    const index = readTilePropsIndex()
    const rerolled: string[] = []
    for (const label of labels) {
      const key = await this.#indexKeyFor(label, segments)
      const current = lookupTilePropsSig(index, key, label)
      if (!current) continue
      this.#releaseUsage(current)
      delete index[key || label]
      const entry = this.#pickBalanced(current)
      if (!entry) break
      index[key || label] = entry.propsSig
      rerolled.push(label)
    }
    if (rerolled.length > 0) writeTilePropsIndex(index)
    return rerolled
  }

  async clearCell(label: string, segments?: readonly string[]): Promise<void> {
    const key = await this.#indexKeyFor(label, segments)
    const index = readTilePropsIndex()
    if (key && index[key] === undefined) {
      // No lineage-scoped assignment. Whatever the label resolves to is a
      // legacy SHARED entry — same-named tiles at other locations may
      // still render from it, so removal here must not touch it.
      return
    }
    this.#releaseUsage(index[key || label])
    delete index[key || label]
    writeTilePropsIndex(index)
  }

  async applyToAllBlanks(labels: string[], segments?: readonly string[]): Promise<string[]> {
    if (this.#propsPool.length === 0 || labels.length === 0) return []
    const index = readTilePropsIndex()
    const applied: string[] = []
    for (const label of labels) {
      const key = await this.#indexKeyFor(label, segments)
      if (lookupTilePropsSig(index, key, label)) continue
      // Canonical already holds an image (index entry lost) -> not blank.
      if (await this.#hasCanonicalImage(label, segments)) continue
      const entry = this.#pickBalanced()
      if (!entry) break
      index[key || label] = entry.propsSig
      applied.push(label)
    }
    if (applied.length > 0) writeTilePropsIndex(index)
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

    const index = readTilePropsIndex()
    const substrateSigs = new Set(this.#propsPool.map(p => p.propsSig))
    let cleared = 0
    for (const label of visibleLabels) {
      const key = await this.#indexKeyFor(label)
      const current = lookupTilePropsSig(index, key, label)
      if (current && substrateSigs.has(current)) {
        this.#releaseUsage(current)
        // Explicit refresh rerolls the visible view: drop the scoped entry,
        // and the legacy one too when that's where the pick lives — it's a
        // substrate-pool (random) image by the guard above, so same-named
        // tiles elsewhere just re-fill with a fresh random pick.
        delete index[key || label]
        if (index[label] === current) delete index[label]
        cleared++
      }
    }
    if (cleared > 0) writeTilePropsIndex(index)

    return (await this.applyToAllBlanks(visibleLabels)).length
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
      // Skip the whole-tree walk when nothing has changed since the last
      // COMPLETED reconcile. The pass is idempotent — re-walking hundreds of
      // tiles to stamp/heal NOTHING is pure boot cost, and it warms the entire
      // layer cache (the "why is the whole hive loaded / first click lags"
      // symptom). Fingerprint = lineage count (grows on adopt / sync /
      // first-commit) + a hash of the local props index (changes on any edit).
      // Those are the only inputs that can create new reconcile work, so a
      // matching fingerprint means there is provably nothing to do.
      const hashStr = (s: string): string => {
        let h = 5381
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
        return (h >>> 0).toString(36)
      }
      const fingerprintOf = (): string => {
        const hist = get('@diamondcoreprocessor.com/HistoryService') as { headIndexCount?: () => number } | undefined
        const idxRaw = localStorage.getItem('hc:tile-props-index') ?? '{}'
        // `v2` — the pass gained the default-entry heal (an index entry may now
        // be CORRECTED, not just filled). Hives that completed a v1 pass carry a
        // matching fingerprint and would skip forever, never healing the entries
        // v1 couldn't see; the prefix change buys exactly one re-walk each.
        return `v2:${hist?.headIndexCount?.() ?? 0}:${idxRaw.length}:${hashStr(idxRaw)}`
      }
      if (localStorage.getItem('hc:substrate-reconciled') === fingerprintOf()) {
        console.info('[substrate] stamp pass: skipped — hive unchanged since last reconcile')
        return 0
      }
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
          // The `0000` dir-file generation only survives in the legacy
          // content roots — resolve the tile dir through the union walker.
          const dir = await this.#segmentsToDir(store, segments)
          if (!dir) return null
          const cellDir = await dir.getDirectoryHandle(name, { create: false })
          const fh = await cellDir.getFileHandle('0000', { create: false })
          const parsed = JSON.parse(await (await fh.getFile()).text())
          return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
        } catch { return null }
      }

      let stamped = 0
      let walked = 0
      let matched = 0
      // canonical -> index seeds collected during the walk (location key ->
      // canonical propSig), merged into a fresh index at the end so the local
      // cache mirrors canonical for every imaged tile.
      const seeds = new Map<string, string>()
      const imageOf = (p: any): string | undefined => {
        const img = p?.small?.image ?? p?.flat?.small?.image
        return (typeof img === 'string' && /^[0-9a-f]{64}$/.test(img)) ? img : undefined
      }

      // Is this props resource a DEFAULT pick (substrate: true)? Memoised by
      // sig: tiles share pool props heavily, so the whole tree usually costs a
      // handful of reads. Current-pool membership answers most calls without
      // any read at all; picks made by an older pool fall through to the blob.
      // Unreadable ⇒ false (never treat an unknown as a default we may replace).
      const poolSigs = new Set(this.#propsPool.map(e => e.propsSig))
      const defaultPropsMemo = new Map<string, boolean>()
      const isDefaultProps = async (propsSig: string): Promise<boolean> => {
        if (poolSigs.has(propsSig)) return true
        const memo = defaultPropsMemo.get(propsSig)
        if (memo !== undefined) return memo
        let result = false
        try {
          const blob = await store.getResource(propsSig)
          if (blob) result = (JSON.parse(await blob.text()) as any)?.substrate === true
        } catch { result = false }
        defaultPropsMemo.set(propsSig, result)
        return result
      }

      const stampIfNeeded = async (segments: string[], name: string): Promise<void> => {
        walked++
        try {
          const canonical = await readTilePropertiesAt(segments, name) as any
          const canonicalImg = imageOf(canonical)
          const canonicalIsDefault = canonical?.substrate === true

          // CANONICAL -> INDEX heal — the index must NEVER be missing for an
          // imaged tile, and must never point at a DEFAULT while the tile owns
          // a real image. The renderer resolves props through the index alone,
          // so either divergence shows the wrong picture on the hex while the
          // editor (canonical-first) shows the right one — the "the default
          // overrode my image and I had to re-save to get it back" bug.
          //
          //   • no entry        → seed from canonical (adopted / synced /
          //                       cross-device tiles, or an entry a delete cleared)
          //   • default entry   → REPLACE with canonical when canonical is
          //                       intentional. Same priority rule the stamp pass
          //                       below applies to the canonical slot: intentional
          //                       beats default. An intentional index entry is
          //                       left alone — it legitimately differs from the
          //                       canonical sig (the editor writes pretty-printed
          //                       JSON, the canonical write sorts keys), so a
          //                       sig mismatch alone means nothing.
          //
          // Runs BEFORE the priority-rule early-return below, which would
          // otherwise skip exactly the tiles that need it.
          if (canonicalImg) {
            const healKey = await cellLocationSig(segments, name)
            const current = healKey ? index[healKey] : undefined
            if (healKey && !seeds.has(healKey) && (!current || await isDefaultProps(current))) {
              const propSig = await readTilePropsSigAt(segments, name)
              // Only overwrite an existing (default) entry when canonical is
              // itself intentional — a default replacing a default is churn.
              if (propSig && (!current || !canonicalIsDefault)) seeds.set(healKey, propSig)
            }
          }

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
          const propsSig = lookupTilePropsSig(index, await cellLocationSig(segments, name), name)
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
        // FALLBACK: legacy dir-backed tiles. The named tile dirs only ever
        // lived in the legacy content roots — walk those, NOT the flat OPFS
        // root (whose top-level dirs are now sig-named pools + lineage bags
        // that a name walk would misread as tiles). Skip any sig-named dir
        // (64-hex: a pool or bag) and the underscore/legacy drain sources at
        // every level so the stamp pass never recurses into non-tile dirs.
        const isTileDir = (name: string): boolean =>
          !SIG_NAME_RE.test(name) && !name.startsWith('__') && name !== 'hypercomb.io'
        const walkDirs = async (dir: FileSystemDirectoryHandle, segments: string[]): Promise<void> => {
          if (segments.length > 8) return
          for await (const [name, handle] of (dir as any).entries()) {
            if (handle.kind !== 'directory' || !isTileDir(name)) continue
            await stampIfNeeded(segments, name)
            await walkDirs(handle as FileSystemDirectoryHandle, [...segments, name])
          }
        }
        for (const root of [store.legacyHive, store.legacyHypercombIo]) {
          if (root) await walkDirs(root, [])
        }
      }

      // Always log the summary — the silent-0 case is exactly what made the
      // earlier failures (dir walk on a dir-less tree, too-early boot timer)
      // invisible. walked=0 means the tree walk found nothing (history not
      // ready or empty root); matched=0 with walked>0 means labels in the
      // tree don't match index keys.
      // Persist the canonical -> index seeds. Re-read fresh (other writers may
      // have run during the async walk) and add only still-missing keys, so a
      // concurrent write is never clobbered.
      let healed = 0
      if (seeds.size > 0) {
        const fresh = readTilePropsIndex()
        for (const [k, v] of seeds) {
          // Fill a missing entry, or replace one still holding the DEFAULT the
          // walk saw. Anything else written during the async walk is a newer,
          // deliberate assignment (an editor save, an attach) and is never
          // clobbered — hence the re-check against the CURRENT value rather
          // than a blind write.
          if (fresh[k] === v) continue
          if (!fresh[k] || (fresh[k] === index[k] && await isDefaultProps(fresh[k]))) {
            fresh[k] = v
            healed++
          }
        }
        if (healed > 0) writeTilePropsIndex(fresh)
      }
      console.info(`[substrate] stamp pass: index=${indexSize} walked=${walked} matched=${matched} stamped=${stamped} index-healed=${healed}`)
      // Completed — persist the post-pass fingerprint (recomputed AFTER the
      // index heal above) so an unchanged next boot skips the walk entirely.
      try { localStorage.setItem('hc:substrate-reconciled', fingerprintOf()) } catch { /* storage full — re-walk next time */ }
      return stamped
    } catch (err) { console.warn('[substrate] stamp pass failed', err); return 0 }
    finally { this.#stampRunning = false }
  }

  // ───────────────────────── OPFS helpers ─────────────────────────

  /** LEGACY per-hive dir props (`<dir>/0000`) — read-fallback only;
   *  nothing writes these anymore (overrides live in the pool). */
  async #readProps(dir: FileSystemDirectoryHandle): Promise<Record<string, any>> {
    try {
      const fh = await dir.getFileHandle(PROPS_FILE)
      const file = await fh.getFile()
      return JSON.parse(await file.text())
    } catch { return {} }
  }

  /** Open (creating) the pool for a meaning. Prefers Store.getPool; derives
   *  the address locally when the store predates it (essentials must not
   *  import shared, so the derivation is by convention: sha256 of the UTF-8
   *  bytes of the meaning). */
  async #poolFor(store: StoreHandle, meaning: string): Promise<FileSystemDirectoryHandle | null> {
    try {
      if (store.getPool) return await store.getPool(meaning)
      const sig = await SignatureService.sign(new TextEncoder().encode(meaning).buffer as ArrayBuffer)
      return await store.opfsRoot.getDirectoryHandle(sig, { create: true })
    } catch { return null }
  }

  /** The sign('substrate:sources') pool — registry + per-location overrides. */
  async #pool(store: StoreHandle): Promise<FileSystemDirectoryHandle | null> {
    return await this.#poolFor(store, SOURCES_MEANING)
  }

  /** The sign('substrate:references') pool — one file per copied reference. */
  async #referencesPool(store: StoreHandle): Promise<FileSystemDirectoryHandle | null> {
    return await this.#poolFor(store, REFERENCES_MEANING)
  }

  /** Open a RETIRED pool. `create: false` throughout — a drained pool must
   *  STAY gone; creating one would resurrect exactly what the move escaped. */
  async #retiredPool(store: StoreHandle, meaning: string): Promise<FileSystemDirectoryHandle | null> {
    try {
      const sig = await SignatureService.sign(
        new TextEncoder().encode(meaning).buffer as ArrayBuffer,
      )
      return await store.opfsRoot.getDirectoryHandle(sig, { create: false })
    } catch { return null }
  }

  async #readRecordFrom(
    dir: FileSystemDirectoryHandle | null,
    name: string,
  ): Promise<Record<string, unknown> | null> {
    if (!dir) return null
    try {
      const fh = await dir.getFileHandle(name, { create: false })
      const parsed = JSON.parse(await (await fh.getFile()).text())
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
    } catch { return null }
  }

  /** Read a record, draining the retired pools as it goes: the live address
   *  first, then each retired one in order — and a hit is copied forward,
   *  VERIFIED at the new address, and only then dropped. Per record, never a
   *  wipe; a failed verify simply leaves the old file where it is to be
   *  retried next boot. */
  async #readPoolRecord(store: StoreHandle, name: string): Promise<Record<string, unknown> | null> {
    const current = await this.#readRecordFrom(await this.#pool(store), name)
    if (current) return current

    for (const meaning of RETIRED_SOURCE_POOLS) {
      const retired = await this.#retiredPool(store, meaning)
      const stale = await this.#readRecordFrom(retired, name)
      if (!stale || !retired) continue

      await this.#writePoolRecord(store, name, stale)
      if (await this.#readRecordFrom(await this.#pool(store), name)) {
        try { await retired.removeEntry(name) } catch { /* retry next boot */ }
        void this.#dropRetiredPoolIfEmpty(store, meaning)
      }
      return stale
    }
    return null
  }

  /** Absorb any references left in a retired references pool, then drop it.
   *  Copy-forward only — `addReference` is idempotent, so a partial run
   *  simply finishes next boot. */
  async #drainRetiredReferences(store: StoreHandle): Promise<void> {
    for (const meaning of RETIRED_REFERENCE_POOLS) {
      const retired = await this.#retiredPool(store, meaning)
      if (!retired) continue
      const pool = await this.#referencesPool(store)
      if (!pool) return
      try {
        for await (const entry of (retired as any).keys()) {
          const sig = String(entry)
          if (!SIG_NAME_RE.test(sig)) continue
          await pool.getFileHandle(sig, { create: true })
          try { await retired.removeEntry(sig) } catch { /* retry next boot */ }
        }
      } catch { continue }
      void this.#dropRetiredPoolIfEmpty(store, meaning)
    }
  }

  /** Remove a retired pool's directory once nothing is left in it. Gated on
   *  emptiness — this is the ONLY removal the drain performs beyond the
   *  per-record ones above. */
  async #dropRetiredPoolIfEmpty(store: StoreHandle, meaning: string): Promise<void> {
    try {
      const retired = await this.#retiredPool(store, meaning)
      if (!retired) return
      for await (const _ of (retired as any).keys()) return   // still has members
      const sig = await SignatureService.sign(
        new TextEncoder().encode(meaning).buffer as ArrayBuffer,
      )
      await store.opfsRoot.removeEntry(sig)
    } catch { /* leave it — a stale empty dir costs nothing */ }
  }

  async #writePoolRecord(store: StoreHandle, name: string, record: Record<string, unknown>): Promise<void> {
    const pool = await this.#pool(store)
    if (!pool) return
    const fh = await pool.getFileHandle(name, { create: true })
    const writable = await fh.createWritable()
    await writable.write(JSON.stringify(record))
    await writable.close()
  }

  /** Location sig for a segments path — same canonical signing site the
   *  history bags use (empty segments = root, which the override walk
   *  never consults, so no ROOT_NAME special-case is needed here). */
  async #locationSig(segments: readonly string[]): Promise<string | null> {
    const history = get('@diamondcoreprocessor.com/HistoryService') as {
      sign?: (l: { explorerSegments?: () => readonly string[] }) => Promise<string>
    } | undefined
    if (!history?.sign) return null
    try { return await history.sign({ explorerSegments: () => [...segments] }) } catch { return null }
  }

  /** Resolve a NAMED segments path to its dir: the flat root first, then
   *  the legacy content roots (`__hive__/`, `hypercomb.io/`) — named
   *  tile dirs only exist in the legacy trees now, and the union rule
   *  says a partially-drained boot must still resolve them. */
  async #segmentsToDir(store: StoreHandle, segments: readonly string[]): Promise<FileSystemDirectoryHandle | null> {
    for (const root of [store.hypercombRoot, store.legacyHive, store.legacyHypercombIo]) {
      if (!root) continue
      try {
        let dir: FileSystemDirectoryHandle = root
        for (const seg of segments) dir = await dir.getDirectoryHandle(seg, { create: false })
        return dir
      } catch { /* not under this root — try the next */ }
    }
    return null
  }

  /** LEGACY root `0000` props — read-fallback for the registry until the
   *  scrub below retires the substrate keys from it. */
  async #readRootProps(store: StoreHandle): Promise<Record<string, unknown>> {
    try {
      const fh = await store.opfsRoot.getFileHandle(PROPS_FILE)
      const file = await fh.getFile()
      return JSON.parse(await file.text())
    } catch { return {} }
  }

  /** Self-cleaning scrub: once the registry lives in the pool, remove the
   *  substrate keys from the legacy root `0000` — and the file itself when
   *  nothing else remains in it (it may be shared with other root-props
   *  writers, or be a non-JSON marker — both are left untouched). Detached
   *  from every read path; best-effort. */
  async #scrubLegacyRootRegistry(store: StoreHandle): Promise<void> {
    try {
      const fh = await store.opfsRoot.getFileHandle(PROPS_FILE, { create: false })
      const parsed = JSON.parse(await (await fh.getFile()).text())
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return // not props — not ours
      const props = parsed as Record<string, unknown>
      if (!(REGISTRY_KEY in props) && !(LEGACY_GLOBAL_KEY in props)) return
      delete props[REGISTRY_KEY]
      delete props[LEGACY_GLOBAL_KEY]
      if (Object.keys(props).length === 0) {
        await store.opfsRoot.removeEntry(PROPS_FILE)
        return
      }
      const out = await store.opfsRoot.getFileHandle(PROPS_FILE, { create: true })
      const writable = await out.createWritable()
      try { await writable.write(JSON.stringify(props)) } finally { await writable.close() }
    } catch { /* absent or unreadable — nothing to scrub */ }
  }

  // ───────────────────────── IoC helpers ─────────────────────────

  #store(): StoreHandle | undefined { return get('@hypercomb.social/Store') }
  #lineage(): LineageHandle | undefined { return get('@hypercomb.social/Lineage') }
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
