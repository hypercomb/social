// diamond-core-processor/src/app/core/sig-info-cache.ts

import type { TreeNodeKind } from './tree-node'

const STORAGE_KEY = 'dcp.sigInfo'

/** Bounded so a participant who installs many domains over many months can't
 *  grow the record without limit. Well above a full multi-domain install
 *  (~250 modules per domain), and the trim is FIFO on the persisted order —
 *  losing an entry costs one re-derivation, nothing more. */
const MAX_ENTRIES = 4000

/** What a signature IS, derived from its bytes. `kind`/`className` for a bee;
 *  `namespace` (the first-line alias) and `depName` (the display name derived
 *  from it) for a dependency.
 *
 *  `depName` is deliberately its own field rather than a reuse of `className`:
 *  a record persisted by an earlier build holds the first class the regex hit,
 *  which is NOT what a dep is named by now. A new field means those entries
 *  simply lack it and re-derive once — no migration, no stale label. */
export interface SigInfo {
  kind?: TreeNodeKind
  className?: string | null
  namespace?: string
  depName?: string
}

type Stored = Record<string, { k?: string, c?: string | null, n?: string, d?: string }>

/**
 * DERIVED CACHE for signature-addressed facts.
 *
 * Every entry is a PURE DERIVATION OF IMMUTABLE BYTES, KEYED BY THE SIGNATURE
 * OF THOSE BYTES — the same contract the hive's optimize phase holds derived
 * records to. Content never changes under a signature, so an entry can never
 * go stale: there is no update, only derive-on-miss.
 *
 * It is NEVER LOAD-BEARING. Every read path must produce an identical result
 * with the cache empty, wiped, or unavailable — which is what makes it safe to
 * keep in localStorage, safe to drop, and safe to ignore when it fails.
 *
 * Why it exists: naming a bee means reading its whole compiled bundle out of
 * OPFS, decoding it, and regexing for the class declaration; naming a
 * dependency means the same for its first-line alias. Uncached, that is one
 * full bundle read per artifact PER RESOLVE — roughly a thousand decodes
 * across a multi-domain install, repeated every time the tree is rebuilt, to
 * recompute an answer that mathematically cannot have changed.
 */
export class SigInfoCache {

  #entries = new Map<string, SigInfo>()
  #loaded = false
  #dirty = false
  #flush: ReturnType<typeof setTimeout> | null = null

  get(sig: string): SigInfo | undefined {
    this.#load()
    return this.#entries.get(sig)
  }

  /** Record a derivation. Merges into any existing entry — a sig can be named
   *  by one path (class) and namespaced by another (alias comment). */
  set(sig: string, info: SigInfo): void {
    this.#load()
    const current = this.#entries.get(sig)
    // Re-inserting moves the key to the end, which is what makes the FIFO
    // trim below evict the least recently derived rather than an entry that
    // is still in active use.
    if (current) this.#entries.delete(sig)
    this.#entries.set(sig, { ...current, ...info })
    this.#dirty = true
    this.#schedule()
  }

  #load(): void {
    if (this.#loaded) return
    this.#loaded = true
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const stored = JSON.parse(raw) as Stored
      for (const [sig, v] of Object.entries(stored ?? {})) {
        if (!/^[a-f0-9]{64}$/i.test(sig)) continue
        this.#entries.set(sig.toLowerCase(), {
          kind: v?.k as TreeNodeKind | undefined,
          className: v?.c ?? undefined,
          namespace: v?.n ?? undefined,
          depName: v?.d ?? undefined,
        })
      }
    } catch {
      // Unreadable record — a derived cache is never load-bearing, so an
      // empty map is a complete and correct starting state.
      this.#entries.clear()
    }
  }

  /** Coalesce writes: a resolve derives hundreds of entries in a burst, and
   *  serialising the whole record per entry would cost more than the reads
   *  this saves. */
  #schedule(): void {
    if (this.#flush) return
    this.#flush = setTimeout(() => { this.#flush = null; this.persist() }, 250)
  }

  persist(): void {
    if (!this.#dirty) return
    this.#dirty = false
    try {
      // Trim from the front (oldest insertion) before writing.
      while (this.#entries.size > MAX_ENTRIES) {
        const oldest = this.#entries.keys().next()
        if (oldest.done) break
        this.#entries.delete(oldest.value)
      }
      const out: Stored = {}
      for (const [sig, info] of this.#entries) {
        const entry: Stored[string] = {}
        if (info.kind) entry.k = info.kind
        if (info.className !== undefined) entry.c = info.className
        if (info.namespace) entry.n = info.namespace
        if (info.depName) entry.d = info.depName
        out[sig] = entry
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out))
    } catch {
      // Quota or unavailable storage. The cache stays in memory for this
      // session and every read path still works without it.
    }
  }
}
