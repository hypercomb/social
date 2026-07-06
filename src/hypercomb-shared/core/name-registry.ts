// hypercomb-shared/core/name-registry.ts
//
// Named references — give a friendly handle to a lineage path or a raw
// signature so slash commands can autocomplete against something other
// than 64-char hex strings and nested paths. "Branches" in the tile
// sense: a portable pointer to a location or a content-addressed blob.
//
// Persistence mirrors TagRegistry: the full map lives as a single JSON
// resource (sig-named file at the flat OPFS root, via Store.putResource);
// the sig pointer is the `names-master` record in the sign('registry')
// pool. The pointer's legacy home — the root `0000` props file — is
// read-fallback only (that filename collides with sigbag markers at the
// unified root). In-memory cache is eager-loaded on first read so
// slashComplete() (which is synchronous) can return matching names
// without awaiting OPFS.

import { EffectBus } from '@hypercomb/core'

export type NameTarget =
  | { kind: 'lineage'; path: readonly string[] }
  | { kind: 'signature'; signature: string }

export type NameEntry = {
  target: NameTarget
  createdAt: number
  note?: string
}

type NameMap = Record<string, NameEntry>

/** Legacy pointer file at the OPFS root — read-fallback only. */
const LEGACY_PROPS_FILE = '0000'
const MASTER_KEY = 'names-master'
/** Pool of meaning holding the registry pointer records — shared with
 *  TagRegistry by convention (same derived address, distinct records). */
const REGISTRY_MEANING = 'registry'

export class NameRegistry extends EventTarget {
  #names: NameMap = {}
  #loaded = false
  #loading: Promise<void> | null = null

  /** Full map. Call ensureLoaded() first if you need OPFS-backed state. */
  get all(): NameMap { return this.#names }

  /** Name list for autocomplete. */
  get names(): string[] { return Object.keys(this.#names).sort() }

  get(name: string): NameEntry | undefined { return this.#names[name] }

  /** Names starting with a prefix (case-insensitive). For slashComplete. */
  matching(prefix: string): string[] {
    const p = prefix.toLowerCase()
    return this.names.filter(n => n.toLowerCase().startsWith(p))
  }

  async ensureLoaded(): Promise<void> {
    if (this.#loaded) return
    if (this.#loading) return this.#loading
    this.#loading = this.#load()
    await this.#loading
    this.#loading = null
  }

  async setLineage(name: string, path: readonly string[], note?: string): Promise<void> {
    await this.ensureLoaded()
    this.#names[name] = {
      target: { kind: 'lineage', path: [...path] },
      createdAt: Date.now(),
      note,
    }
    await this.#save()
  }

  async setSignature(name: string, signature: string, note?: string): Promise<void> {
    await this.ensureLoaded()
    this.#names[name] = {
      target: { kind: 'signature', signature },
      createdAt: Date.now(),
      note,
    }
    await this.#save()
  }

  async remove(name: string): Promise<boolean> {
    await this.ensureLoaded()
    if (!(name in this.#names)) return false
    delete this.#names[name]
    await this.#save()
    return true
  }

  // ── persistence ───────────────────────────────────────────────────

  async #load(): Promise<void> {
    try {
      const store = this.#store()
      if (!store) return

      const sig = await this.#readPointer(store)
      if (!sig) { this.#loaded = true; return }

      const blob = await store.getResource(sig)
      if (!blob) { this.#loaded = true; return }

      this.#names = JSON.parse(await blob.text())
    } catch { /* first load or corrupted — start fresh */ }
    this.#loaded = true
    EffectBus.emit('names:registry', { names: this.#names })
  }

  async #save(): Promise<void> {
    try {
      const store = this.#store()
      if (!store) return

      const json = JSON.stringify(this.#names)
      const blob = new Blob([json], { type: 'application/json' })
      const sig = await store.putResource(blob)

      await this.#writePointer(store, sig)
    } catch { /* OPFS write failed — in-memory state still valid */ }

    this.dispatchEvent(new Event('change'))
    EffectBus.emit('names:registry', { names: this.#names })
  }

  // pointer record: sign('registry') pool; legacy root 0000 read-fallback
  // (see TagRegistry — identical shape, distinct record name).

  async #readPointer(store: any): Promise<string | null> {
    try {
      const pool = await store.getPool?.(REGISTRY_MEANING)
      if (pool) {
        const fh = await pool.getFileHandle(MASTER_KEY)
        const sig = (await (await fh.getFile()).text()).trim()
        if (sig) return sig
      }
    } catch { /* no pool record yet — fall back */ }
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

register('@hypercomb.social/NameRegistry', new NameRegistry())
