// hypercomb-shared/core/tag-registry.ts
// Master tag list — ONE document in the `registry:tags` document pool
// (registry-document.ts — the record is its own address, replaced whole on
// every edit). The two older homes, the `tags-master` pointer in the
// bare-word `registry` pool and the root `0000` props file before it,
// are read-fallback only.
//
// In-memory map populated on first load, mutated via add/remove,
// persisted by writing the document again.

import { EffectBus, SignatureService, registerCommandRoot, type CommandMember } from '@hypercomb/core'
import { readRegistryDocument, writeRegistryDocument } from './registry-document.js'

type TagEntry = { color?: string; enabled?: boolean; accent?: string }
type TagMap = Record<string, TagEntry>

/** The legacy pointer's member name in the old `registry` pool — read only. */
const LEGACY_MASTER_KEY = 'tags-master'
/** The document pool holding this participant's tag map (registry-document.ts). */
const TAGS_REGISTRY_MEANING = 'registry:tags'

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

  // ── persistence (one document in the registry:tags pool) ──

  async #load(): Promise<void> {
    try {
      const store = this.#store()
      if (!store) return

      const tags = await readRegistryDocument<TagMap>(store, TAGS_REGISTRY_MEANING, LEGACY_MASTER_KEY)
      if (!tags) {
        // No master list yet — try migrating from legacy hc:tag-colors
        this.#migrateFromLegacy()
        this.#loaded = true
        return
      }
      this.#tags = tags
    } catch { /* first load or corrupted — start fresh */ }
    this.#loaded = true
  }

  async #save(): Promise<void> {
    try {
      const store = this.#store()
      if (!store) return

      await writeRegistryDocument(store, TAGS_REGISTRY_MEANING, this.#tags)

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

  #store(): any {
    return (window as any).ioc?.get?.('@hypercomb.social/Store')
  }
}

register('@hypercomb.social/TagRegistry', new TagRegistry())

// ── the `tags` command object ────────────────────────────────────────
//
// The MARK-BACKED half of the command-object protocol, and the reason the
// protocol allows two membership sources at all. These members are not a list
// anyone wrote: they ARE the tag pool's contents, so minting a tag anywhere
// grows this object with no code. Each member carries its own colour as the
// swatch, which is the same channel a background theme fills with a whole
// picture — the dropdown does not know or care which it is looking at.
//
// Ranking is popularity (how many tiles carry the tag) with alphabetical ties,
// the ordering the tag modes already used. `members` is synchronous because the
// registry is already in memory; a cold registry answers empty and this object
// refreshes when it loads, exactly like every other consumer.
registerCommandRoot('tags', {
  members(path: readonly string[]): readonly CommandMember[] {
    // Tags do not nest: a tag has no members, so anything walked into is a leaf.
    if (path.length > 0) return []
    const registry = (window as any).ioc?.get?.('@hypercomb.social/TagRegistry') as TagRegistry | undefined
    const metrics = (window as any).ioc?.get?.('@diamondcoreprocessor.com/OverlapMetrics') as
      { tagCount(name: string): number } | undefined
    const names = registry?.names ?? []
    return [...names]
      .sort((a, b) => (metrics?.tagCount(b) ?? 0) - (metrics?.tagCount(a) ?? 0) || a.localeCompare(b))
      .map(name => {
        const count = metrics?.tagCount(name) ?? 0
        return {
          name,
          swatch: registry?.color(name) || undefined,
          description: count ? `${count} tile${count === 1 ? '' : 's'}` : undefined,
          leaf: true,
        }
      })
  },
})
