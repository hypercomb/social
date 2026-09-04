// hypercomb-shared/core/name-registry.ts
//
// Named references — give a friendly handle to a lineage path or a raw
// signature so slash commands can autocomplete against something other
// than 64-char hex strings and nested paths. "Branches" in the tile
// sense: a portable pointer to a location or a content-addressed blob.
//
// Persistence mirrors TagRegistry: the full map is ONE document in the
// `registry:names` document pool (registry-document.ts — the record is
// its own address, replaced whole on every edit). The two older homes, the
// `names-master` pointer in the bare-word `registry` pool and the root
// `0000` props file before it, are read-fallback only. In-memory cache is
// eager-loaded on first read so slashComplete() (which is synchronous) can
// return matching names without awaiting OPFS.

import { EffectBus } from '@hypercomb/core'
import { readRegistryDocument, writeRegistryDocument } from './registry-document.js'

export type NameTarget =
  | { kind: 'lineage'; path: readonly string[] }
  | { kind: 'signature'; signature: string }

export type NameEntry = {
  target: NameTarget
  createdAt: number
  note?: string
}

type NameMap = Record<string, NameEntry>

/** The legacy pointer's member name in the old `registry` pool — read only. */
const LEGACY_MASTER_KEY = 'names-master'
/** The document pool holding this participant's name map (registry-document.ts). */
const NAMES_REGISTRY_MEANING = 'registry:names'

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

      const names = await readRegistryDocument<NameMap>(store, NAMES_REGISTRY_MEANING, LEGACY_MASTER_KEY)
      if (!names) { this.#loaded = true; return }
      this.#names = names
    } catch { /* first load or corrupted — start fresh */ }
    this.#loaded = true
    EffectBus.emit('names:registry', { names: this.#names })
  }

  async #save(): Promise<void> {
    try {
      const store = this.#store()
      if (!store) return

      await writeRegistryDocument(store, NAMES_REGISTRY_MEANING, this.#names)
    } catch { /* OPFS write failed — in-memory state still valid */ }

    this.dispatchEvent(new Event('change'))
    EffectBus.emit('names:registry', { names: this.#names })
  }

  #store(): any {
    return (window as any).ioc?.get?.('@hypercomb.social/Store')
  }
}

register('@hypercomb.social/NameRegistry', new NameRegistry())
