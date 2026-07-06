// hypercomb-shared/core/tag-registry.ts
// Master tag list — content-addressed resource (sig-named file at the
// flat OPFS root, via Store.putResource), with the current sig pointer
// kept as the `tags-master` record in the sign('registry') pool. The
// pointer's legacy home — a plain `0000` props file at the OPFS root —
// is read-fallback only: at the unified root that filename collides
// with the sigbag-marker namespace, so writes moved to the pool.
//
// In-memory map populated on first load, mutated via add/remove,
// persisted by writing a new resource blob and updating the pointer.

import { EffectBus, SignatureService } from '@hypercomb/core'

type TagEntry = { color?: string; enabled?: boolean; accent?: string }
type TagMap = Record<string, TagEntry>

/** Legacy pointer file at the OPFS root — read-fallback only. */
const LEGACY_PROPS_FILE = '0000'
const MASTER_KEY = 'tags-master'
/** Pool of meaning holding the registry pointer records (`tags-master`,
 *  `names-master`). Address = sign('registry'), derived by Store. */
const REGISTRY_MEANING = 'registry'

export class TagRegistry extends EventTarget {

  #tags: TagMap = {}
  #loaded = false
  #loading: Promise<void> | null = null

  /** All tag entries. */
  get all(): TagMap { return this.#tags }

  /** All tag names (for intellisense). */
  get names(): string[] { return Object.keys(this.#tags) }

  /** Get a tag entry. */
  get(name: string): TagEntry | undefined { return this.#tags[name] }

  /** Get color for a tag. */
  color(name: string): string { return this.#tags[name]?.color ?? '' }

  /** Whether a tag is enabled (defaults to true if not set). */
  enabled(name: string): boolean { return this.#tags[name]?.enabled !== false }

  /** Get accent preset name for a tag (e.g. 'glacier', 'bloom'). */
  accent(name: string): string | undefined { return this.#tags[name]?.accent }

  /** Set accent preset name for a tag. Pass undefined to clear. */
  async setAccent(name: string, accent: string | undefined): Promise<void> {
    await this.ensureLoaded()
    const existing = this.#tags[name]
    if (!existing) {
      this.#tags[name] = { accent, enabled: true }
    } else {
      this.#tags[name] = { ...existing, accent }
    }
    await this.#save()
  }

  /** Ensure loaded — call before reading. Returns immediately if already loaded. */
  async ensureLoaded(): Promise<void> {
    if (this.#loaded) return
    if (this.#loading) return this.#loading
    this.#loading = this.#load()
    await this.#loading
    this.#loading = null
    // Announce the first load so reactive readers (tag intellisense) that
    // captured an empty `names` at boot re-read the now-populated list. `#load`
    // itself is silent; without this, the master list never surfaces until a
    // tag is mutated (the first thing that dispatches 'change').
    this.dispatchEvent(new Event('change'))
    EffectBus.emit('tags:registry', { tags: this.#tags })
  }

  /** Add or update a tag in the master list. */
  async add(name: string, color?: string): Promise<void> {
    await this.ensureLoaded()
    const existing = this.#tags[name]
    this.#tags[name] = { color: color ?? existing?.color, enabled: existing?.enabled ?? true }
    await this.#save()
  }

  /** Remove a tag from the master list entirely (GC). */
  async remove(name: string): Promise<void> {
    await this.ensureLoaded()
    if (!(name in this.#tags)) return
    delete this.#tags[name]
    await this.#save()
  }

  /** Toggle a tag's enabled state. */
  async toggle(name: string, enabled: boolean): Promise<void> {
    await this.ensureLoaded()
    if (!(name in this.#tags)) return
    this.#tags[name] = { ...this.#tags[name], enabled }
    await this.#save()
  }

  // ── persistence (content-addressed resource + sign('registry') pool pointer) ──

  async #load(): Promise<void> {
    try {
      const store = this.#store()
      if (!store) return

      const sig = await this.#readPointer(store)
      if (!sig) {
        // No master list yet — try migrating from legacy hc:tag-colors
        this.#migrateFromLegacy()
        this.#loaded = true
        return
      }

      const blob = await store.getResource(sig)
      if (!blob) { this.#loaded = true; return }

      this.#tags = JSON.parse(await blob.text())
    } catch { /* first load or corrupted — start fresh */ }
    this.#loaded = true
  }

  async #save(): Promise<void> {
    try {
      const store = this.#store()
      if (!store) return

      const json = JSON.stringify(this.#tags)
      const blob = new Blob([json], { type: 'application/json' })
      const sig = await store.putResource(blob)

      await this.#writePointer(store, sig)

      // Also keep localStorage in sync for fast reads by controls bar
      localStorage.setItem('hc:tag-colors', JSON.stringify(
        Object.fromEntries(Object.entries(this.#tags).map(([k, v]) => [k, v.color ?? '']))
      ))
    } catch { /* OPFS write failed — in-memory state still valid */ }

    this.dispatchEvent(new Event('change'))
    EffectBus.emit('tags:registry', { tags: this.#tags })
  }

  /** Migrate from legacy hc:tag-colors localStorage to master list. */
  #migrateFromLegacy(): void {
    try {
      const legacy: Record<string, string> = JSON.parse(localStorage.getItem('hc:tag-colors') ?? '{}')
      for (const [name, color] of Object.entries(legacy)) {
        if (name && typeof color === 'string') {
          this.#tags[name] = { color: color || undefined, enabled: true }
        }
      }
    } catch { /* no legacy data */ }
  }

  // ── pointer record (sign('registry') pool; legacy root 0000 read-fallback) ──

  async #readPointer(store: any): Promise<string | null> {
    // Canonical: the `tags-master` record in the sign('registry') pool.
    try {
      const pool = await store.getPool?.(REGISTRY_MEANING)
      if (pool) {
        const fh = await pool.getFileHandle(MASTER_KEY)
        const sig = (await (await fh.getFile()).text()).trim()
        if (sig) return sig
      }
    } catch { /* no pool record yet — fall back */ }
    // Legacy fallback: the pointer used to ride a plain `0000` props file
    // at the OPFS root. Read-only; the next #save rehomes the pointer
    // into the pool. The stale 0000 key is deliberately left untouched —
    // rewriting that contested file is exactly what this stops.
    try {
      const root = store.opfsRoot as FileSystemDirectoryHandle
      const fh = await root.getFileHandle(LEGACY_PROPS_FILE)
      const props = JSON.parse(await (await fh.getFile()).text())
      const sig = props?.[MASTER_KEY]
      if (typeof sig === 'string' && sig) return sig
    } catch { /* no legacy pointer either */ }
    return null
  }

  async #writePointer(store: any, sig: string): Promise<void> {
    const pool = await store.getPool?.(REGISTRY_MEANING)
    if (!pool) throw new Error('registry pool unavailable')
    const fh = await pool.getFileHandle(MASTER_KEY, { create: true })
    const writable = await fh.createWritable()
    try { await writable.write(sig) } finally { await writable.close() }
  }

  #store(): any {
    return (window as any).ioc?.get?.('@hypercomb.social/Store')
  }
}

register('@hypercomb.social/TagRegistry', new TagRegistry())
