// hypercomb-shared/core/usage-tracker.ts
//
// Local, per-participant usage-timing framework. Records how heavily each
// location (lineage sig) is visited — visit COUNT + recency-decayed DWELL —
// and exposes a ranking so the preloader warms the tiles a participant
// actually uses FIRST (so they brighten out of the readiness shade first).
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

import type { UsageRanker } from '@hypercomb/core'
import type { Lineage } from './lineage'
import type { Store } from './store'

// Pool meaning carries a colon so it can never collide with a location's
// lineage bag (lineageKey folds every non-alphanumeric to '-', so a ':' is
// unproducible by any tile/page slug). See CLAUDE.md pools-of-meaning rules.
const USAGE_MEANING = 'usage:dwell'
const USAGE_SUBKEY = 'v1'

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
  #currentSig = ''
  #enteredAt = 0                 // Date.now() when the current timer started; 0 = paused
  #store: Store | undefined
  #persistTimer: ReturnType<typeof setTimeout> | null = null
  #loaded = false                // gate persist until the initial load has merged

  constructor() {
    super()
    // Resolve deps via IoC — robust to barrel order. Both register in the
    // shared/core barrel; whenReady fires immediately if already present.
    window.ioc?.whenReady?.('@hypercomb.social/Store', (s: unknown) => {
      this.#store = s as Store
      void this.#load()
    })
    window.ioc?.whenReady?.('@hypercomb.social/Lineage', (lin: unknown) => {
      const lineage = lin as Lineage
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

  // ── dwell timing ────────────────────────────────────────────────────
  async #onChange(lineage: Lineage): Promise<void> {
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
    this.#schedulePersist()
  }

  #pause(): void { this.#closeOut() }
  #resume(): void { if (this.#currentSig && this.#enteredAt === 0) this.#enteredAt = Date.now() }

  #decayTo(rec: UsageRecord, now: number): number {
    const age = now - rec.t
    if (age <= 0) return rec.d
    return rec.d * Math.pow(0.5, age / HALF_LIFE_MS)
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
      const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, records: this.#topRecords() }))
      await this.#store.putPoolDoc(pool, bytes.buffer as ArrayBuffer, USAGE_SUBKEY)
    } catch { /* local telemetry — non-fatal */ }
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
  }
}

register('@hypercomb.social/UsageTracker', new UsageTracker())
