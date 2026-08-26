// hypercomb-shared/core/usage-tracker.ts
//
// Local, per-participant usage-timing framework. Records how heavily each TILE
// (by its own location sig) is met — INTERACTION count + recency-decayed DWELL
// — and exposes a ranking so the preloader warms the tiles a participant
// actually uses FIRST (so they brighten out of the readiness shade first).
//
// Every increment is queued write-ahead (synchronous, local) and only leaves
// the queue once the pool write confirms, so a count is never lost to a crash,
// a kill, or a reload inside the persist debounce.
//
// LOCAL ONLY. Like the clipboard, this is participant-local behaviour: never
// shared, never written to history, never in the mesh. It is NOT a derived
// cache (it cannot be rebuilt from layers) and must never be minted in the
// optimize phase — it is behavioural state, written from navigation.
//
// Timing hooks Lineage 'change' (the settled current sig), the same signal the
// neighbourhood warm handler uses. Dwell PAUSES while the tab is hidden, so a
// backgrounded tab (or Chrome intensive throttling) can't inflate it.
//
// Consumers resolve this via window.ioc.get(USAGE_IOC_KEY) and use the
// UsageRanker contract from @hypercomb/core; absence collapses to un-ranked.

// (moved down from hypercomb-shared in the everything-is-a-beehavior
// Phase 1 — its contract, UsageRanker + USAGE_IOC_KEY, always lived in core)
import type { UsageRanker } from '@hypercomb/core'

/** The slices of Lineage / Store this needs — reached through IoC. */
type LineageLike = EventTarget & { currentSig(): Promise<string> }
type StoreLike = {
  getPool(meaning: string): Promise<unknown>
  putPoolDoc(pool: unknown, bytes: ArrayBuffer, subkey: string): Promise<unknown>
  getPoolDoc(pool: unknown, subkey: string): Promise<ArrayBuffer | null | undefined>
}

// Pool meaning carries a colon so it can never collide with a location's
// lineage bag (lineageKey folds every non-alphanumeric to '-', so a ':' is
// unproducible by any tile/page slug). See CLAUDE.md pools-of-meaning rules.
const USAGE_MEANING = 'usage:dwell'
const USAGE_SUBKEY = 'v1'

// WRITE-AHEAD QUEUE. The pool doc is written debounced + async (OPFS shares one
// queue with the render path, so it must never be synchronous on the hot path).
// Every increment therefore lands FIRST in this synchronous local queue as a
// DELTA, and is only subtracted once the pool write has actually succeeded. A
// crash, a kill, or a reload mid-debounce loses nothing: the queue is read back
// at construction and merged on top of the persisted doc.
const PENDING_KEY = 'hc:usage-pending'

const SIG_RE = /^[0-9a-f]{64}$/
const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000   // 14 days — stale trails fade
const VISIT_BIAS_MS = 500                        // each visit ≈ 0.5s of dwell, so frequent-but-brief still ranks
const MAX_DWELL_PER_VISIT_MS = 10 * 60 * 1000    // backstop: an idle-open tile can't dominate
const PERSIST_DEBOUNCE_MS = 5000
const MAX_RECORDS = 4000                          // bound the persisted blob (evict lowest-weight)

// visits, decayed dwell ms, last-visit epoch ms
type UsageRecord = { c: number; d: number; t: number }

export class UsageTracker extends EventTarget implements UsageRanker {
  #records = new Map<string, UsageRecord>()
  #pending = new Map<string, UsageRecord>()   // write-ahead deltas not yet in the pool doc
  #currentSig = ''
  #enteredAt = 0                 // Date.now() when the current timer started; 0 = paused
  #store: StoreLike | undefined
  #persistTimer: ReturnType<typeof setTimeout> | null = null
  #loaded = false                // gate persist until the initial load has merged

  constructor() {
    super()
    // Recover the previous session's un-flushed increments BEFORE anything can
    // record a new one — they seed #records, and stay queued on disk until a
    // pool write actually succeeds.
    this.#loadPending()
    // Resolve deps via IoC — robust to barrel order. Both register in the
    // shared/core barrel; whenReady fires immediately if already present.
    window.ioc?.whenReady?.('@hypercomb.social/Store', (s: unknown) => {
      this.#store = s as StoreLike
      void this.#load()
    })
    window.ioc?.whenReady?.('@hypercomb.social/Lineage', (lin: unknown) => {
      const lineage = lin as LineageLike
      lineage.addEventListener('change', () => { void this.#onChange(lineage) })
      void this.#onChange(lineage)   // stamp the boot location
    })
    // Pause/resume dwell with tab visibility; flush on hide.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { this.#pause(); void this.#persistNow() }
        else this.#resume()
      })
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => { this.#pause(); void this.#persistNow() })
    }
  }

  // ── UsageRanker contract ────────────────────────────────────────────
  weight(sig: string): number {
    const rec = this.#records.get(sig)
    if (!rec) return 0
    return this.#decayTo(rec, Date.now()) + rec.c * VISIT_BIAS_MS
  }

  rank(sigs: readonly string[]): string[] {
    // Stable sort by weight desc; equal/unseen keep original order (index tiebreak).
    return sigs
      .map((sig, i) => ({ sig, i, w: this.weight(sig) }))
      .sort((a, b) => (b.w - a.w) || (a.i - b.i))
      .map(x => x.sig)
  }

  interactions(sig: string): number {
    return this.#records.get(sig)?.c ?? 0
  }

  /** Count an interaction with a tile — TILE LEVEL, keyed by the tile's own
   *  location sig. Called when a tile is met (entered/opened), so the count
   *  reflects intent even when the navigation that follows is slow, blocked,
   *  or abandoned; a visit that does settle is counted once by #onChange.
   *  Queued write-ahead, so an increment survives a crash before the flush. */
  bump(sig: string, n = 1): void {
    if (!SIG_RE.test(sig) || !(n > 0)) return
    const now = Date.now()
    const rec = this.#records.get(sig) ?? { c: 0, d: 0, t: now }
    rec.d = this.#decayTo(rec, now)
    rec.c += n
    rec.t = now
    this.#records.set(sig, rec)
    this.#queue(sig, n, 0, now)
    this.#schedulePersist()
    this.dispatchEvent(new CustomEvent('change'))
  }

  // ── dwell timing ────────────────────────────────────────────────────
  async #onChange(lineage: LineageLike): Promise<void> {
    let sig = ''
    try { sig = await lineage.currentSig() } catch { return }
    if (!SIG_RE.test(sig) || sig === this.#currentSig) return
    this.#closeOut()                     // accrue the previous location's dwell
    this.#currentSig = sig
    const now = Date.now()
    const rec = this.#records.get(sig) ?? { c: 0, d: 0, t: now }
    rec.d = this.#decayTo(rec, now)      // decay stale dwell to now before this visit
    rec.c += 1
    rec.t = now
    this.#records.set(sig, rec)
    this.#queue(sig, 1, 0, now)
    this.#enteredAt = now
    this.#schedulePersist()
    this.dispatchEvent(new CustomEvent('change'))
  }

  #closeOut(): void {
    if (!this.#currentSig || this.#enteredAt === 0) return
    const dwell = Math.min(Date.now() - this.#enteredAt, MAX_DWELL_PER_VISIT_MS)
    if (dwell > 0) this.#accrue(this.#currentSig, dwell)
    this.#enteredAt = 0
  }

  #accrue(sig: string, dwellMs: number): void {
    const now = Date.now()
    const rec = this.#records.get(sig) ?? { c: 0, d: 0, t: now }
    rec.d = this.#decayTo(rec, now) + dwellMs
    rec.t = now
    this.#records.set(sig, rec)
    this.#queue(sig, 0, dwellMs, now)
    this.#schedulePersist()
  }

  #pause(): void { this.#closeOut() }
  #resume(): void { if (this.#currentSig && this.#enteredAt === 0) this.#enteredAt = Date.now() }

  #decayTo(rec: UsageRecord, now: number): number {
    const age = now - rec.t
    if (age <= 0) return rec.d
    return rec.d * Math.pow(0.5, age / HALF_LIFE_MS)
  }

  // ── write-ahead queue (synchronous, crash-durable) ───────────────────
  /** Append a delta to the queue and write it out immediately. Increments are
   *  rare (a navigation, a tile entry, a dwell close-out), so a synchronous
   *  local write here costs nothing and buys "never lost". */
  #queue(sig: string, dc: number, dd: number, now: number): void {
    const cur = this.#pending.get(sig) ?? { c: 0, d: 0, t: now }
    cur.c += dc
    cur.d += dd
    cur.t = now
    this.#pending.set(sig, cur)
    this.#writePending()
  }

  #writePending(): void {
    try {
      if (this.#pending.size === 0) { localStorage.removeItem(PENDING_KEY); return }
      if (this.#pending.size > MAX_RECORDS) {
        // Bound the queue the same way the doc is bounded: keep the heaviest.
        const kept = [...this.#pending.entries()]
          .sort((a, b) => (b[1].c - a[1].c) || (b[1].d - a[1].d))
          .slice(0, MAX_RECORDS)
        this.#pending = new Map(kept)
      }
      const out: Record<string, UsageRecord> = {}
      for (const [sig, rec] of this.#pending) out[sig] = rec
      localStorage.setItem(PENDING_KEY, JSON.stringify(out))
    } catch { /* storage full / unavailable — the pool doc is still the path home */ }
  }

  /** Read the queue back at construction: these are increments that were
   *  recorded but never confirmed into the pool doc. They seed the in-memory
   *  records and STAY queued until a write succeeds. */
  #loadPending(): void {
    try {
      const raw = localStorage.getItem(PENDING_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Record<string, unknown>
      for (const [sig, val] of Object.entries(parsed ?? {})) {
        const rec = val as UsageRecord
        if (!SIG_RE.test(sig) || !rec ||
          typeof rec.c !== 'number' || typeof rec.d !== 'number' || typeof rec.t !== 'number') continue
        this.#pending.set(sig, { c: rec.c, d: rec.d, t: rec.t })
        this.#records.set(sig, { c: rec.c, d: rec.d, t: rec.t })
      }
    } catch { /* unreadable queue — fall back to the pool doc alone */ }
  }

  /** Subtract what a successful write actually carried, so increments recorded
   *  DURING the write stay queued rather than being silently dropped. */
  #settle(flushed: Map<string, UsageRecord>): void {
    for (const [sig, done] of flushed) {
      const cur = this.#pending.get(sig)
      if (!cur) continue
      cur.c -= done.c
      cur.d -= done.d
      if (cur.c <= 0 && cur.d <= 0) this.#pending.delete(sig)
    }
    this.#writePending()
  }

  // ── persistence (local-only pool of meaning) ────────────────────────
  #schedulePersist(): void {
    if (this.#persistTimer) return
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = null
      void this.#persistNow()
    }, PERSIST_DEBOUNCE_MS)
  }

  async #persistNow(): Promise<void> {
    if (!this.#store || !this.#loaded) return   // never clobber before the initial load merges
    try {
      const pool = await this.#store.getPool(USAGE_MEANING)
      if (!pool) return
      // Snapshot the queue BEFORE the write: what this doc carries is exactly
      // what may leave the queue afterwards.
      const inFlight = new Map<string, UsageRecord>()
      for (const [sig, rec] of this.#pending) inFlight.set(sig, { ...rec })
      const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, records: this.#topRecords() }))
      await this.#store.putPoolDoc(pool, bytes.buffer as ArrayBuffer, USAGE_SUBKEY)
      this.#settle(inFlight)
    } catch { /* local telemetry — non-fatal; the queue keeps the increments */ }
  }

  #topRecords(): Record<string, UsageRecord> {
    // Bound the blob: keep the highest-weight MAX_RECORDS (also trims memory).
    let entries = [...this.#records.entries()]
    if (entries.length > MAX_RECORDS) {
      entries = entries
        .sort((a, b) => this.weight(b[0]) - this.weight(a[0]))
        .slice(0, MAX_RECORDS)
      this.#records = new Map(entries)
    }
    const out: Record<string, UsageRecord> = {}
    for (const [sig, rec] of entries) out[sig] = rec
    return out
  }

  async #load(): Promise<void> {
    try {
      const pool = await this.#store!.getPool(USAGE_MEANING)
      const buf = await this.#store!.getPoolDoc(pool ?? undefined, USAGE_SUBKEY)
      if (buf) {
        const parsed = JSON.parse(new TextDecoder().decode(buf)) as {
          v?: number; records?: Record<string, unknown>
        }
        const now = Date.now()
        for (const [sig, raw] of Object.entries(parsed?.records ?? {})) {
          const rec = raw as UsageRecord
          if (!SIG_RE.test(sig) || !rec ||
            typeof rec.c !== 'number' || typeof rec.d !== 'number' || typeof rec.t !== 'number') continue
          const cur = this.#records.get(sig)
          if (!cur) { this.#records.set(sig, rec); continue }
          // Merge persisted history with visits recorded since boot: sum visit
          // counts and decayed dwell (both decayed to now), keep the latest t.
          cur.c += rec.c
          cur.d = this.#decayTo(cur, now) + this.#decayTo(rec, now)
          cur.t = Math.max(cur.t, rec.t)
        }
      }
    } catch { /* non-fatal */ }
    this.#loaded = true
    // Recovered queue from a previous session — fold it into the doc now, so a
    // participant who never navigates again still keeps yesterday's counts.
    if (this.#pending.size > 0) this.#schedulePersist()
  }
}

export const usageTracker = new UsageTracker()

/** Re-assert into the LIVE IoC map (the llm-provider-registry lesson). */
export const ensureUsageTrackerRegistered = (): void => {
  if (!window.ioc?.has?.('@hypercomb.social/UsageTracker')) {
    window.ioc?.register?.('@hypercomb.social/UsageTracker', usageTracker)
  }
}
ensureUsageTrackerRegistered()
