// sequence/frame.service.ts
//
// FrameService — which pattern governs this location, and where we have
// scrolled to inside it.
//
// Structurally a twin of SequenceService, and deliberately so: same palette /
// resource / resolver split, same hot-map discipline. The difference is what
// the answer is FOR. A sequence answers "where does the NEXT tile land"; a
// frame answers "where does EVERY tile sit, right now" — so its resolver is
// read once per render pass by show-cell rather than once per creation, and it
// must be synchronous for the same reason (a geometry build cannot await).
//
//   • Palette — named patterns, cached in localStorage. Seeded with the
//     built-ins so `/frame honeycomb` works on a cold hive. Participant-local
//     convenience; the canonical copy is the content-addressed resource.
//
//   • Resolver — walks the lineage upward to the nearest `layout:frame`
//     decoration, exactly like the sequence resolver. Kept hot two ways:
//     live off `decorations:changed` (so a freshly bound frame governs
//     immediately, commit-independent) and hydrated off `render:cell-count`
//     (so frames bound in a prior session are picked up on navigation).
//
//   • Offset — where the tiles have been dragged to within the frame. Runtime
//     and participant-local, keyed by location: a viewing position, not
//     content. Never committed, never inherited by a peer. Clamped against
//     the live tile count so a scroll can never run off into empty slots.
//
// SEPARATE BUNDLES, ONE INSTANCE: every bee that imports this file gets its
// own inlined copy of the module (the lesson lane-viewport-mode paid for), so
// module scope is not shared. Consumers must resolve the service through
// `window.ioc` — which IS shared — and never import the class to read state.
// The offset additionally rides EffectBus so a copy in another bundle can
// mirror it without a round-trip through IoC.

import { EffectBus } from '@hypercomb/core'
import {
  BUILTIN_PATTERNS,
  maxOffset,
  parsePattern,
  patternCapacity,
  patternRecord,
  patternRows,
  patternStride,
  scrollOrder,
  type AxialLike,
  type PatternDefinition,
} from './pattern.js'
import {
  FRAME_TARGET_KIND,
  listFrameTargetHere,
  removeFrameTarget,
  writeFrameTarget,
} from './frame-target.js'

const PALETTE_KEY = 'hc:patterns'

/** Emitted when the tiles move through the frame. Carries the location so a
 *  listener bundled separately can tell whose scroll it is. */
export const FRAME_OFFSET_EFFECT = 'frame:offset'
/** Emitted when a frame is bound or released — the render must re-place. */
export const FRAME_CHANGED_EFFECT = 'frame:changed'

/** NUL — the one character a tile name can never carry, so a joined path key
 *  is unambiguous. DERIVED, never written as a raw byte: a literal control
 *  byte in source survives no round trip through tooling (doctrine.spec.ts),
 *  and this file was already being read as binary because of it. Same idiom as
 *  view.bee's SEGMENT_SEPARATOR and enrollment's SEP. */
const SEGMENT_SEPARATOR = String.fromCharCode(0)
const keyOf = (segs: readonly string[]): string => segs.join(SEGMENT_SEPARATOR)

type StoreLike = {
  putResource(blob: Blob): Promise<string>
  getResource(sig: string): Promise<Blob | null>
}
type LineageLike = { explorerSegments?: () => readonly string[] }

/** A named pattern in the participant's palette. */
export interface PatternSet {
  readonly name: string
  /** Resource sig of the `{ kind:'pattern', … }` record. */
  readonly sig: string
  readonly pattern: PatternDefinition
}

/** Everything a render pass needs to place tiles, precomputed once per
 *  pattern. `order` is the scroll order; `stride` the tiles per step. */
export interface ActiveFrame {
  readonly name: string
  readonly pattern: PatternDefinition
  readonly order: readonly AxialLike[]
  readonly stride: number
  readonly capacity: number
  readonly rows: number
}

export class FrameService extends EventTarget {
  /** name → saved pattern (the participant's palette). */
  #palette = new Map<string, PatternSet>()
  /** pattern resource sig → parsed pattern (resolve cache). */
  #bySig = new Map<string, PatternDefinition>()
  /** joined-segments → the frame bound AT that location. */
  #boxes = new Map<string, ActiveFrame>()
  /** decoration sig → joined-segments key (so removeSig can subtract). */
  #sigKey = new Map<string, string>()
  /** hydration guard — keys already walked from committed layers. */
  #checked = new Set<string>()
  /** joined-segments → scroll offset in steps. Runtime only. */
  #offsets = new Map<string, number>()
  /** joined-segments → how many tiles the location holds, noted by the render
   *  pass. The scroll ceiling needs the TOTAL, and a framed render only paints
   *  the tiles currently on-frame — so the count cannot be inferred from what
   *  is on screen, and `render:cell-count` reports the painted number. */
  #counts = new Map<string, number>()
  /** Derived-frame cache so a render pass does not re-sort every pattern. */
  #frameBySig = new Map<string, ActiveFrame>()

  constructor() {
    super()
    this.#restore()
    this.#seedBuiltins()
    EffectBus.on('render:cell-count', () => this.#hydrate())
    EffectBus.on('decorations:changed', (p) => { void this.#onDecorations(p as never) })
  }

  // ── palette ───────────────────────────────────────────────────

  /** Saved pattern names, sorted — drives `/frame` autocomplete. */
  list(): string[] {
    return [...this.#palette.keys()].sort((a, b) => a.localeCompare(b))
  }

  get(name: string): PatternSet | null {
    return this.#palette.get(name) ?? null
  }

  /** Save (or overwrite) a named pattern as a content-addressed resource.
   *  Returns the resource sig. Identical patterns dedup to one sig, so two
   *  participants who draw the same shape are bound to the same resource. */
  async save(pattern: PatternDefinition): Promise<string> {
    const store = window.ioc.get<StoreLike>('@hypercomb.social/Store')
    if (!store?.putResource) throw new Error('[FrameService] Store / putResource unavailable')
    const blob = new Blob([JSON.stringify(patternRecord(pattern))], { type: 'application/json' })
    const sig = await store.putResource(blob)
    this.#palette.set(pattern.name, { name: pattern.name, sig, pattern })
    this.#bySig.set(sig, pattern)
    this.#persist()
    this.dispatchEvent(new CustomEvent('change'))
    return sig
  }

  /** Frame a branch with a saved pattern. Cascades to every descendant.
   *  Primes the resolver immediately so the very next render places through
   *  it, without waiting for the `decorations:changed` round-trip. */
  async applyTo(segments: readonly string[], name: string): Promise<boolean> {
    let set = this.#palette.get(name)
    if (!set) return false
    // A built-in seeded from code has no resource behind it until it is first
    // used. Mint it now, so what the branch points at is real content.
    if (!set.sig) {
      const sig = await this.save(set.pattern)
      set = { ...set, sig }
    }
    const segs = this.#clean(segments)
    await writeFrameTarget(segs, name, set.sig)
    this.#boxes.set(keyOf(segs), this.#frameFor(name, set.pattern, set.sig))
    this.#offsets.delete(keyOf(segs))
    this.#announce()
    return true
  }

  /** Release the frame declared AT this location. */
  async clearAt(segments: readonly string[]): Promise<boolean> {
    const segs = this.#clean(segments)
    const found = await listFrameTargetHere(segs)
    if (!found.length) return false
    for (const f of found) {
      removeFrameTarget(f.sig, segs)
      this.#sigKey.delete(f.sig)
    }
    this.#boxes.delete(keyOf(segs))
    this.#offsets.delete(keyOf(segs))
    this.#announce()
    return true
  }

  // ── resolver (read by show-cell's placement) ──────────────────

  /** The frame governing `segments` — nearest binding on self or an ancestor
   *  — or null. Synchronous, so a geometry build can ask it directly. */
  activeFrameFor(segments: readonly string[]): ActiveFrame | null {
    const segs = this.#clean(segments)
    for (let depth = segs.length; depth >= 0; depth--) {
      const frame = this.#boxes.get(keyOf(segs.slice(0, depth)))
      if (frame) return frame
    }
    return null
  }

  /** True when this location is read through a frame — the one question pan,
   *  zoom and move ask before deciding whether the viewport is theirs. */
  isFramed(segments: readonly string[]): boolean {
    return this.activeFrameFor(segments) !== null
  }

  // ── scrolling the tiles through the frame ─────────────────────

  /** Tell the service how many tiles this location holds. Called by the
   *  render pass, which is the only thing that knows the total. */
  noteTileCount(segments: readonly string[], count: number): void {
    this.#counts.set(keyOf(this.#clean(segments)), Math.max(0, Math.trunc(count)))
  }

  /** How many tiles this location holds, as last noted by the render pass. */
  tileCountFor(segments: readonly string[]): number {
    return this.#counts.get(keyOf(this.#clean(segments))) ?? 0
  }

  /** Current scroll offset, in steps, at this location. */
  offsetFor(segments: readonly string[]): number {
    return this.#offsets.get(keyOf(this.#clean(segments))) ?? 0
  }

  /** The offset a render should USE — the stored one, clamped to what the
   *  live tile count can still show. Pure: deleting tiles must not leave a
   *  page scrolled into empty slots, but a read is not the place to write. */
  clampedOffsetFor(segments: readonly string[], tileCount?: number): number {
    const frame = this.activeFrameFor(segments)
    if (!frame) return 0
    const segs = this.#clean(segments)
    const count = tileCount ?? this.#counts.get(keyOf(segs)) ?? 0
    const ceiling = maxOffset(frame.capacity, frame.stride, count)
    return Math.min(ceiling, Math.max(0, this.offsetFor(segs)))
  }

  /** Move the tiles through the frame by `steps` (positive scrolls forward —
   *  later tiles come in at the leading edge). Clamped to the tile count, so
   *  the frame never scrolls past the last tile or before the first. Returns
   *  the offset actually reached. */
  scrollBy(segments: readonly string[], steps: number, tileCount?: number): number {
    return this.setOffset(segments, this.offsetFor(segments) + Math.trunc(steps), tileCount)
  }

  setOffset(segments: readonly string[], offset: number, tileCount?: number): number {
    const frame = this.activeFrameFor(segments)
    if (!frame) return 0
    const segs = this.#clean(segments)
    const key = keyOf(segs)
    const count = tileCount ?? this.#counts.get(key) ?? 0
    const ceiling = maxOffset(frame.capacity, frame.stride, count)
    const next = Math.min(ceiling, Math.max(0, Math.trunc(offset)))
    if ((this.#offsets.get(key) ?? 0) === next) return next
    this.#offsets.set(key, next)
    try {
      EffectBus.emit(FRAME_OFFSET_EFFECT, { segments: segs, offset: next })
    } catch { /* no bus (unit context) — the map is still authoritative */ }
    this.dispatchEvent(new CustomEvent('change'))
    return next
  }

  // ── internals ─────────────────────────────────────────────────

  #clean(segments: readonly string[]): string[] {
    return segments.map(s => String(s ?? '').trim()).filter(Boolean)
  }

  #frameFor(name: string, pattern: PatternDefinition, sig: string): ActiveFrame {
    const cached = this.#frameBySig.get(sig)
    if (cached) return cached
    const frame: ActiveFrame = {
      name,
      pattern,
      order: scrollOrder(pattern),
      stride: patternStride(pattern),
      capacity: patternCapacity(pattern),
      rows: patternRows(pattern),
    }
    this.#frameBySig.set(sig, frame)
    return frame
  }

  #announce(): void {
    try {
      EffectBus.emit(FRAME_CHANGED_EFFECT, {})
    } catch { /* no bus — direct listeners still get the change event */ }
    this.dispatchEvent(new CustomEvent('change'))
  }

  async #onDecorations(p?: { segments?: readonly string[]; op?: string; sig?: string }): Promise<void> {
    if (!p?.segments || !p?.sig || !p?.op) return
    const key = keyOf(this.#clean(p.segments.map(String)))
    if (p.op === 'append') {
      const rec = await this.#fetchRecord(p.sig)
      if (rec?.kind !== FRAME_TARGET_KIND) return
      const patternSig = rec.payload?.patternSig
      const pattern = await this.#patternForSig(patternSig)
      if (!pattern || !patternSig) return
      this.#boxes.set(key, this.#frameFor(rec.payload?.name ?? pattern.name, pattern, patternSig))
      this.#sigKey.set(p.sig, key)
      this.#announce()
    } else if (p.op === 'removeSig') {
      const k = this.#sigKey.get(p.sig)
      if (k === undefined) return
      this.#sigKey.delete(p.sig)
      if (![...this.#sigKey.values()].includes(k)) {
        this.#boxes.delete(k)
        this.#offsets.delete(k)
      }
      this.#announce()
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
      const found = await listFrameTargetHere(sub)
      if (!found.length) return
      const patternSig = found[0].record.payload?.patternSig
      const pattern = await this.#patternForSig(patternSig)
      if (!pattern || !patternSig) return
      this.#boxes.set(key, this.#frameFor(found[0].record.payload?.name ?? pattern.name, pattern, patternSig))
      for (const f of found) this.#sigKey.set(f.sig, key)
      this.#announce()
    } catch {
      this.#checked.delete(key) // transient read error — allow a retry
    }
  }

  async #patternForSig(sig?: string): Promise<PatternDefinition | null> {
    if (!sig) return null
    const cached = this.#bySig.get(sig)
    if (cached) return cached
    const store = window.ioc.get<StoreLike>('@hypercomb.social/Store')
    if (!store?.getResource) return null
    try {
      const blob = await store.getResource(sig)
      if (!blob) return null
      const pattern = parsePattern(JSON.parse(await blob.text()))
      if (pattern) this.#bySig.set(sig, pattern)
      return pattern
    } catch {
      return null
    }
  }

  async #fetchRecord(sig: string): Promise<{ kind?: string; payload?: FrameRecordPayload } | null> {
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
    return this.#clean(lineage?.explorerSegments?.() ?? [])
  }

  /** Built-ins join the palette with no sig — `applyTo` mints the resource on
   *  first use. A saved pattern of the same name always wins: once the
   *  participant has edited `honeycomb`, theirs is the one that binds. */
  #seedBuiltins(): void {
    for (const b of BUILTIN_PATTERNS) {
      if (this.#palette.has(b.build().name)) continue
      const pattern = b.build()
      this.#palette.set(pattern.name, { name: pattern.name, sig: '', pattern })
    }
  }

  #restore(): void {
    try {
      const raw = localStorage.getItem(PALETTE_KEY)
      if (!raw) return
      const obj = JSON.parse(raw) as Record<string, { sig?: unknown; pattern?: unknown }>
      if (!obj || typeof obj !== 'object') return
      for (const [name, v] of Object.entries(obj)) {
        const pattern = parsePattern(v?.pattern)
        if (!pattern || typeof v.sig !== 'string') continue
        this.#palette.set(name, { name, sig: v.sig, pattern })
        this.#bySig.set(v.sig, pattern)
      }
    } catch {
      /* tolerate corrupt state */
    }
  }

  #persist(): void {
    const obj: Record<string, { sig: string; pattern: unknown }> = {}
    for (const [name, set] of this.#palette) {
      if (!set.sig) continue   // built-in not yet minted — nothing to remember
      obj[name] = { sig: set.sig, pattern: patternRecord(set.pattern) }
    }
    try {
      localStorage.setItem(PALETTE_KEY, JSON.stringify(obj))
    } catch {
      /* ignore quota / disabled storage */
    }
  }
}

interface FrameRecordPayload {
  name?: string
  patternSig?: string
}

const _frameService = new FrameService()
window.ioc.register('@FrameService', _frameService)
