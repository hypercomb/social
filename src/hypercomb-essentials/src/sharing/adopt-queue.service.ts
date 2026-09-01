// AdoptQueueService — the durable work-list behind a multi-tile adopt.
//
// The rule this exists to keep: "get all the signatures FIRST, then adopt
// them passively in the background, continuously from first to last, until
// the number adopted equals the number asked for — and survive a refresh."
//
// Why a queue at all. The old multi-adopt resolved each pick to a branch
// INSIDE the fold loop, off the live peer cache. Every fold commits and
// re-renders, which invalidates that cache, so the tail of a big selection
// resolved to null and was dropped without a word. The signatures are only
// reliably knowable at CLICK time, while the peer entries are still warm —
// so we snapshot every one of them up front and never consult the cache
// again. A signature is a permanent handle: once we hold it, the content is
// fetchable from any host that serves it, today or after ten reloads.
//
// Why it persists. An adopt the participant watched start is OWED. The
// deferred-fold ladder already persisted single folds (hc:pending-folds) but
// gave up after three rungs and deleted the intent — a peer mid-upload, a
// host briefly down, or a reload at the wrong moment silently cancelled the
// rest of the batch. This queue never gives up on its own: it backs off to a
// slow heartbeat and keeps trying for as long as the entry is there, because
// "if the server is up and you have access to the files you can still get
// them" must hold across sessions.
//
// Scope: participant-local INTENT, not content and not truth — the same
// class as hc:pending-folds and hc:last-folded, so it lives in localStorage
// beside them rather than minting a pool of meaning. Nothing in the hive
// references it, and losing it costs a re-click, never data.

const QUEUE_KEY = 'hc:adopt-queue'
const SIG_RE = /^[a-f0-9]{64}$/

/** One owed fold. `sig` is the merkle handle captured at click time; `at` +
 *  `label` say where it lands. `batch` groups the picks of a single gesture
 *  so the behaviours hand-off can wait for the LAST one. */
export interface AdoptQueueEntry {
  sig: string
  label: string
  at: string[]
  domain?: string
  batch: string
  /** Failed attempts so far — indexes the backoff ladder. */
  tries: number
  /** Epoch ms before which this entry must not be retried. */
  nextAt: number
}

/** Backoff for an entry that couldn't land yet. The last rung REPEATS
 *  forever: a queue that gives up is the bug this replaces. Slow enough
 *  (5 min) that an unreachable branch costs nothing to keep owed. */
const BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 300_000] as const

/** Identity of an owed fold: the branch signature at a placement. The
 *  signature is fixed-width hex, so a plain separator is unambiguous —
 *  deliberately NOT a control byte (a raw NUL in source is invisible to
 *  every editor and gets silently stripped by tooling; see the doctrine
 *  ratchet that forbids them). */
const keyOf = (sig: string, at: readonly string[]): string =>
  `${String(sig).toLowerCase()}/${[...at].join('/')}`

export class AdoptQueueService extends EventTarget {

  /** Every owed entry, in the order it was asked for. First-to-last is the
   *  participant's order and we never reorder it — only skip entries whose
   *  backoff hasn't elapsed. */
  #entries: AdoptQueueEntry[] = []

  constructor() {
    super()
    this.#entries = this.#load()
  }

  get entries(): readonly AdoptQueueEntry[] { return this.#entries }

  /** Owed entries, total. Zero = the queue is satisfied. */
  get remaining(): number { return this.#entries.length }

  /** Owed entries of one batch — drives "3 of 11" progress and tells the
   *  behaviours hand-off when a gesture is fully landed. */
  remainingIn(batch: string): number {
    return this.#entries.filter(e => e.batch === batch).length
  }

  /** Stage a whole gesture at once. Deduped by sig+at (re-clicking a pick
   *  already owed must not double it), order preserved, appended after
   *  anything already owed. Returns the entries actually added. */
  enqueueAll(
    picks: readonly { sig: string; label: string; at: readonly string[]; domain?: string }[],
    batch: string,
  ): AdoptQueueEntry[] {
    const added: AdoptQueueEntry[] = []
    for (const p of picks) {
      const sig = String(p.sig ?? '').trim().toLowerCase()
      const label = String(p.label ?? '').trim()
      if (!SIG_RE.test(sig) || !label) continue
      const at = (Array.isArray(p.at) ? p.at : []).map(s => String(s ?? '').trim()).filter(Boolean)
      const key = keyOf(sig, at)
      if (this.#entries.some(e => keyOf(e.sig, e.at) === key)) continue
      const entry: AdoptQueueEntry = { sig, label, at, domain: p.domain, batch, tries: 0, nextAt: 0 }
      this.#entries.push(entry)
      added.push(entry)
    }
    if (added.length > 0) this.#flush()
    return added
  }

  /** The next entry due for an attempt, in ask order. Null when the queue is
   *  empty OR everything left is still backing off. */
  next(now = Date.now()): AdoptQueueEntry | null {
    return this.#entries.find(e => e.nextAt <= now) ?? null
  }

  /** Ms until the earliest backing-off entry comes due. Null when the queue
   *  is empty; 0 when something is due right now. */
  waitMs(now = Date.now()): number | null {
    if (this.#entries.length === 0) return null
    const soonest = Math.min(...this.#entries.map(e => e.nextAt))
    return Math.max(0, soonest - now)
  }

  /** The entry landed (committed or already present) — drop it. */
  complete(sig: string, at: readonly string[]): void {
    const key = keyOf(sig, at)
    const before = this.#entries.length
    this.#entries = this.#entries.filter(e => keyOf(e.sig, e.at) !== key)
    if (this.#entries.length !== before) this.#flush()
  }

  /** The attempt didn't land. The entry STAYS owed and backs off — the last
   *  rung repeats, so this can never silently drop an adopt. */
  defer(sig: string, at: readonly string[], now = Date.now()): void {
    const key = keyOf(sig, at)
    const entry = this.#entries.find(e => keyOf(e.sig, e.at) === key)
    if (!entry) return
    const rung = Math.min(entry.tries, BACKOFF_MS.length - 1)
    entry.tries += 1
    entry.nextAt = now + BACKOFF_MS[rung]
    this.#flush()
  }

  /** Abandon everything owed (the participant's own "stop asking"). */
  clear(): void {
    if (this.#entries.length === 0) return
    this.#entries = []
    this.#flush()
  }

  #load(): AdoptQueueEntry[] {
    try {
      const raw = localStorage.getItem(QUEUE_KEY)
      const arr = raw ? JSON.parse(raw) : []
      if (!Array.isArray(arr)) return []
      return arr.filter((e: unknown): e is AdoptQueueEntry => {
        const c = e as AdoptQueueEntry
        return !!c
          && SIG_RE.test(String(c.sig ?? '').toLowerCase())
          && typeof c.label === 'string' && c.label.length > 0
          && Array.isArray(c.at)
      }).map((e: AdoptQueueEntry) => ({
        ...e,
        sig: e.sig.toLowerCase(),
        at: e.at.map(s => String(s ?? '')),
        batch: String(e.batch ?? 'resumed'),
        tries: Number.isFinite(e.tries) ? e.tries : 0,
        // A resumed entry is due IMMEDIATELY: the reload is itself the wait,
        // and the participant is looking at a hive that owes them tiles.
        nextAt: 0,
      }))
    } catch { return [] }
  }

  #flush(): void {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(this.#entries)) }
    catch { /* no localStorage — the queue degrades to session-only */ }
    this.dispatchEvent(new CustomEvent('change'))
  }
}

const _adoptQueue = new AdoptQueueService()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/AdoptQueueService',
  _adoptQueue,
)

export { _adoptQueue }
