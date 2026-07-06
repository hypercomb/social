// diamondcoreprocessor.com/sequence/sequence.service.ts
//
// SequenceService owns drop-target sequences end to end:
//
//   • Palette — named sets the participant has authored. localStorage cache
//     of `name → { sig, indexes }`. Drives `/sequence` autocomplete and lets
//     the editor re-open a set for editing. Participant-local convenience;
//     the canonical, shareable copy is the content-addressed resource.
//
//   • Sets — each saved set is a resource `{ kind:'sequence', name, indexes }`
//     stored as a sig file at the flat OPFS root (legacy `__resources__/` is a
//     read-fallback) — the "file that has a bunch of indexes". Content-
//     addressed so identical sets dedup and peers can resolve them.
//
//   • Resolver — answers, synchronously, "which sequence governs new tiles at
//     THIS location?" by walking the lineage upward to the nearest
//     `sequence:target` decoration (here or an ancestor — cascading,
//     top-down, position→leaf). show-cell's pinned placement calls
//     nextFreeIndex() at creation time, which can't await, so the resolved
//     index lists are kept hot in memory — mirroring DropboxService /
//     decoration-kind-index:
//       • live: `decorations:changed` carries the decoration sig; we fetch
//         the record + its set resource and update the map. Commit-
//         independent, so a freshly applied sequence governs immediately.
//       • hydration: on `render:cell-count` we walk the current lineage and
//         populate the map from committed layers (sequences applied in a
//         prior session).

import { EffectBus } from '@hypercomb/core'
import {
  listSequenceTargetHere,
  writeSequenceTarget,
  SEQUENCE_TARGET_KIND,
} from './sequence-target.js'

const PALETTE_KEY = 'hc:sequences'

const keyOf = (segs: readonly string[]): string => segs.join(' ')

type StoreLike = {
  putResource(blob: Blob): Promise<string>
  getResource(sig: string): Promise<Blob | null>
}
type LineageLike = { explorerSegments?: () => readonly string[] }

/** A named drop-target sequence. */
export interface SequenceSet {
  readonly name: string
  /** Resource sig of the `{ kind:'sequence', name, indexes }` blob. */
  readonly sig: string
  /** Ordered hex-spiral indexes new tiles fill, first → last. */
  readonly indexes: number[]
}

export class SequenceService extends EventTarget {
  /** name → saved set (the participant's palette). */
  #palette = new Map<string, SequenceSet>()
  /** set resource sig → indexes (resolve cache, dedups fetches). */
  #bySig = new Map<string, number[]>()
  /** joined-segments → indexes (a sequence is bound at this location). */
  #boxes = new Map<string, number[]>()
  /** decoration sig → joined-segments key (so removeSig can subtract). */
  #sigKey = new Map<string, string>()
  /** hydration guard — keys already walked from committed layers. */
  #checked = new Set<string>()

  constructor() {
    super()
    this.#restore()
    EffectBus.on('render:cell-count', () => this.#hydrate())
    EffectBus.on('decorations:changed', (p) => { void this.#onDecorations(p as never) })
  }

  // ── palette ───────────────────────────────────────────────────

  /** Saved set names, sorted — drives `/sequence` autocomplete. */
  list(): string[] {
    return [...this.#palette.keys()].sort((a, b) => a.localeCompare(b))
  }

  /** A saved set by name, or null. */
  get(name: string): SequenceSet | null {
    return this.#palette.get(name) ?? null
  }

  /** Save (or overwrite) a named set as a content-addressed resource and
   *  remember it in the palette. Returns the set resource sig. */
  async save(name: string, indexes: readonly number[]): Promise<string> {
    const clean = indexes
      .filter(i => Number.isFinite(i) && i >= 0)
      .map(i => Math.floor(i))
    const store = window.ioc.get<StoreLike>('@hypercomb.social/Store')
    if (!store?.putResource) throw new Error('[SequenceService] Store / putResource unavailable')

    const record = { kind: 'sequence', name, indexes: clean }
    const blob = new Blob([JSON.stringify(record)], { type: 'application/json' })
    const sig = await store.putResource(blob)

    const set: SequenceSet = { name, sig, indexes: clean }
    this.#palette.set(name, set)
    this.#bySig.set(sig, clean)
    this.#persist()
    this.dispatchEvent(new CustomEvent('change'))
    return sig
  }

  /** Bind a saved set to a branch (cascading, position→leaf). Primes the
   *  resolver immediately so a tile created right after lands correctly,
   *  without waiting for the `decorations:changed` round-trip. */
  async applyTo(segments: readonly string[], name: string): Promise<void> {
    const set = this.#palette.get(name)
    if (!set) return
    const segs = segments.map(s => String(s ?? '').trim()).filter(Boolean)
    await writeSequenceTarget(segs, name, set.sig)
    this.#boxes.set(keyOf(segs), set.indexes)
  }

  // ── resolver (read by show-cell's pinned placement) ───────────

  /** The indexes of the sequence governing `segments` — nearest binding on
   *  self or an ancestor — or null. Synchronous. */
  activeIndexesFor(segments: readonly string[]): number[] | null {
    const segs = segments.map(s => String(s ?? '').trim()).filter(Boolean)
    for (let depth = segs.length; depth >= 0; depth--) {
      const idx = this.#boxes.get(keyOf(segs.slice(0, depth)))
      if (idx && idx.length) return idx
    }
    return null
  }

  /** First sequence index that is still free, in sequence order, or
   *  undefined when no sequence is bound / the sequence is exhausted. */
  nextFreeIndex(segments: readonly string[], isFree: (i: number) => boolean): number | undefined {
    const idx = this.activeIndexesFor(segments)
    if (!idx) return undefined
    for (const i of idx) if (isFree(i)) return i
    return undefined
  }

  // ── internals ─────────────────────────────────────────────────

  async #onDecorations(p?: { segments?: readonly string[]; op?: string; sig?: string }): Promise<void> {
    if (!p?.segments || !p?.sig || !p?.op) return
    const key = keyOf(p.segments.map(String))
    if (p.op === 'append') {
      const rec = await this.#fetchRecord(p.sig)
      if (rec?.kind !== SEQUENCE_TARGET_KIND) return
      const indexes = await this.#indexesForSig(rec.payload?.sequenceSig)
      if (indexes) {
        this.#boxes.set(key, indexes)
        this.#sigKey.set(p.sig, key)
      }
    } else if (p.op === 'removeSig') {
      const k = this.#sigKey.get(p.sig)
      if (k !== undefined) {
        this.#sigKey.delete(p.sig)
        if (![...this.#sigKey.values()].includes(k)) this.#boxes.delete(k)
      }
    }
  }

  #hydrate(): void {
    const segs = this.#currentSegments()
    for (let depth = segs.length; depth >= 0; depth--) {
      const sub = segs.slice(0, depth)
      const key = keyOf(sub)
      if (this.#checked.has(key)) continue
      this.#checked.add(key)
      void this.#hydrateKey(sub, key)
    }
  }

  async #hydrateKey(sub: string[], key: string): Promise<void> {
    try {
      const found = await listSequenceTargetHere(sub)
      if (!found.length) return
      const indexes = await this.#indexesForSig(found[0].record.payload?.sequenceSig)
      if (indexes) {
        this.#boxes.set(key, indexes)
        for (const f of found) this.#sigKey.set(f.sig, key)
      }
    } catch {
      this.#checked.delete(key) // transient read error — allow a retry
    }
  }

  /** Resolve a set resource sig → its indexes (cached). */
  async #indexesForSig(sig?: string): Promise<number[] | null> {
    if (!sig) return null
    const cached = this.#bySig.get(sig)
    if (cached) return cached
    const store = window.ioc.get<StoreLike>('@hypercomb.social/Store')
    if (!store?.getResource) return null
    try {
      const blob = await store.getResource(sig)
      if (!blob) return null
      const parsed = JSON.parse(await blob.text()) as { indexes?: unknown }
      const idx = Array.isArray(parsed?.indexes)
        ? parsed.indexes.filter((n): n is number => Number.isFinite(n)).map(n => Math.floor(n))
        : null
      if (idx) this.#bySig.set(sig, idx)
      return idx
    } catch {
      return null
    }
  }

  async #fetchRecord(sig: string): Promise<{ kind?: string; payload?: { sequenceSig?: string } } | null> {
    const store = window.ioc.get<StoreLike>('@hypercomb.social/Store')
    if (!store?.getResource) return null
    try {
      const blob = await store.getResource(sig)
      return blob ? JSON.parse(await blob.text()) : null
    } catch {
      return null
    }
  }

  #currentSegments(): string[] {
    const lineage = window.ioc.get<LineageLike>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  #restore(): void {
    try {
      const raw = localStorage.getItem(PALETTE_KEY)
      if (!raw) return
      const obj = JSON.parse(raw) as Record<string, { sig?: unknown; indexes?: unknown }>
      if (!obj || typeof obj !== 'object') return
      for (const [name, v] of Object.entries(obj)) {
        if (v && typeof v.sig === 'string' && Array.isArray(v.indexes)) {
          const indexes = v.indexes.filter((n): n is number => Number.isFinite(n)).map(n => Math.floor(n))
          this.#palette.set(name, { name, sig: v.sig, indexes })
          this.#bySig.set(v.sig, indexes)
        }
      }
    } catch {
      /* tolerate corrupt state */
    }
  }

  #persist(): void {
    const obj: Record<string, { sig: string; indexes: number[] }> = {}
    for (const [name, set] of this.#palette) obj[name] = { sig: set.sig, indexes: set.indexes }
    try {
      localStorage.setItem(PALETTE_KEY, JSON.stringify(obj))
    } catch {
      /* ignore quota / disabled storage */
    }
  }
}

const _sequenceService = new SequenceService()
window.ioc.register('@diamondcoreprocessor.com/SequenceService', _sequenceService)
