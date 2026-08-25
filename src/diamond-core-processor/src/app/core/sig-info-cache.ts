// diamond-core-processor/src/app/core/sig-info-cache.ts

import type { TreeNodeKind } from './tree-node'

const STORAGE_KEY = 'dcp.sigInfo'

/**
 * DERIVATION VERSION — bump whenever the code that DERIVES these facts
 * changes its answer for bytes it has already seen.
 *
 * The bytes under a signature are immutable; the function reading them is not.
 * A persisted entry is only valid for the derivation that produced it, so the
 * cache key is really (signature, derivation version) — the version stamp is
 * how the second half gets carried.
 *
 * v2 — 2026-08-25: the class NAME (and the source file name) now declare an
 * artifact's role, not just its extends clause, and the best-declared class in
 * a bundle wins rather than the first. Every v1 entry for an artifact that was
 * previously unnameable — or named after an inlined helper — is a wrong answer
 * that would otherwise outlive the fix in every participant's localStorage.
 */
const DERIVATION_VERSION = 2

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
 *  simply lack it and re-derive once — no migration, no stale label. (That was
 *  this problem solved one field at a time; DERIVATION_VERSION now solves it
 *  for the whole record, and is the right lever for any future change.) */
export interface SigInfo {
  kind?: TreeNodeKind
  className?: string | null
  namespace?: string
  depName?: string
  sourcePath?: string | null
}

type StoredEntry = { k?: string, c?: string | null, n?: string, d?: string, s?: string | null }
type Stored = { v?: number, e?: Record<string, StoredEntry> }

/**
 * DERIVED CACHE for signature-addressed facts.
 *
 * Every entry is a PURE DERIVATION OF IMMUTABLE BYTES, KEYED BY THE SIGNATURE
 * OF THOSE BYTES — the same contract the hive's optimize phase holds derived
 * records to. Content never changes under a signature, so an entry is stable
 * for as long as the code that derived it is: there is no update, only
 * derive-on-miss, plus a wholesale drop when DERIVATION_VERSION moves.
 *
 * That second half is not a detail. A wrong name persisted here survives every
 * reload AND every rebuild, so without the version stamp a fix to the naming
 * code appears to do nothing — the fix runs, and the cache answers first.
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
      // A record from an older derivation is not a record of anything the
      // current code would say. Drop it whole — re-deriving is the cheap,
      // always-correct option, and this is the ONLY thing standing between a
      // naming fix and a participant who never sees it.
      if (stored?.v !== DERIVATION_VERSION) {
        localStorage.removeItem(STORAGE_KEY)
        return
      }
      for (const [sig, v] of Object.entries(stored.e ?? {})) {
        if (!/^[a-f0-9]{64}$/i.test(sig)) continue
        this.#entries.set(sig.toLowerCase(), {
          kind: v?.k as TreeNodeKind | undefined,
          className: v?.c ?? undefined,
          namespace: v?.n ?? undefined,
          depName: v?.d ?? undefined,
          sourcePath: v?.s ?? undefined,
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
      const e: Record<string, StoredEntry> = {}
      for (const [sig, info] of this.#entries) {
        const entry: StoredEntry = {}
        if (info.kind) entry.k = info.kind
        if (info.className !== undefined) entry.c = info.className
        if (info.namespace) entry.n = info.namespace
        if (info.depName) entry.d = info.depName
        if (info.sourcePath !== undefined) entry.s = info.sourcePath
        e[sig] = entry
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: DERIVATION_VERSION, e }))
    } catch {
      // Quota or unavailable storage. The cache stays in memory for this
      // session and every read path still works without it.
    }
  }
}
