// hypercomb-shared/core/tag-registry.ts
// Master tag list — content-addressed resource in __resources__/,
// sig pointer stored in OPFS root 0000 properties.
//
// In-memory map populated on first load, mutated via add/remove,
// persisted by writing a new resource blob and updating the root sig.

import { EffectBus, SignatureService } from '@hypercomb/core'

type TagEntry = { color?: string; enabled?: boolean }
type TagMap = Record<string, TagEntry>

const PROPS_FILE = '0000'
const MASTER_KEY = 'tags-master'

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

  /** Ensure loaded — call before reading. Returns immediately if already loaded. */
  async ensureLoaded(): Promise<void> {
    if (this.#loaded) return
    if (this.#loading) return this.#loading
    this.#loading = this.#load()
    await this.#loading
    this.#loading = null
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

  // ── persistence (content-addressed resource + root 0000 sig pointer) ──

  async #load(): Promise<void> {
    try {
      const store = this.#store()
      if (!store) return

      const rootProps = await this.#readRootProps(store)
      const sig = rootProps[MASTER_KEY]
      if (typeof sig !== 'string' || !sig) {
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

      await this.#writeRootProps(store, { [MASTER_KEY]: sig })

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

  // ── root 0000 helpers ──

  async #readRootProps(store: any): Promise<Record<string, unknown>> {
    try {
      const root = store.opfsRoot as FileSystemDirectoryHandle
      const fh = await root.getFileHandle(PROPS_FILE)
      const file = await fh.getFile()
      return JSON.parse(await file.text())
    } catch {
      return {}
    }
  }

  async #writeRootProps(store: any, updates: Record<string, unknown>): Promise<void> {
    const root = store.opfsRoot as FileSystemDirectoryHandle
    const existing = await this.#readRootProps(store)
    const merged = { ...existing, ...updates }
    const fh = await root.getFileHandle(PROPS_FILE, { create: true })
    const writable = await fh.createWritable()
    await writable.write(JSON.stringify(merged))
    await writable.close()
  }

  #store(): any {
    return (window as any).ioc?.get?.('@hypercomb.social/Store')
  }
}

register('@hypercomb.social/TagRegistry', new TagRegistry())
