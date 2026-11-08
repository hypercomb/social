// mail/cue.ts
//
// THE WINDOW SAYS WHAT IT IS DOING. jwize, 2026-11-06: "the info shows up late
// so we need some cue to see that is happening." Mail is slow by nature here:
// every row's metadata is one ask of the signer, a message is fetched and
// decrypted before it can be read, and a send waits on Cloudflare. A window
// that sits blank through that reads as a window that is broken. These are the
// small timing pieces the window builds its cues from. Pure: no DOM, no
// network, no storage, and every clock is injectable so a spec can drive it.
//
// ── A POLL IS BOUNDED ───────────────────────────────────────────────────────
//
// The unread cue asks the host every so often. It asks only while the page is
// visible (a hidden tab learns nothing it needs), never overlaps itself (the
// next wait starts when a check ends, so a slow host is never asked twice at
// once), and stops for good after a few failures in a row — a host that is
// down is not asked every 90 seconds for the rest of the day.
//
// ── A DRAFT SAVES WHEN THE TYPING PAUSES ────────────────────────────────────
//
// Every keystroke restarts the wait; the save runs once the participant stops.
// `flush()` saves now (on close, on Back) so leaving never loses the words.

export const POLL_EVERY_MS = 90_000
export const POLL_MAX_ERRORS = 2
export const DRAFT_SAVE_MS = 2_000

/** setTimeout/clearTimeout, injectable. */
export interface Timers {
  set(run: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface PollerOptions {
  readonly everyMs: number
  /** Failures in a row before the poll stops itself. */
  readonly maxErrors?: number
  /** Is anyone looking? A tick while this is false asks nothing. */
  readonly visible: () => boolean
  /** One check. A throw counts as a failure. */
  readonly check: () => Promise<void>
  readonly timers?: Timers
  /** Told once, when the poll stops itself after too many failures. */
  readonly onGiveUp?: () => void
}

export type TickOutcome = 'stopped' | 'skipped' | 'checked' | 'failed'

export class Poller {
  readonly #options: PollerOptions
  readonly #timers: Timers
  #handle: unknown = null
  #running = false
  #busy = false
  #errors = 0

  constructor(options: PollerOptions) {
    this.#options = options
    this.#timers = options.timers ?? realTimers
  }

  get running(): boolean { return this.#running }
  /** Failures in a row so far. */
  get errors(): number { return this.#errors }

  /** Starts waiting; the first check comes after one interval. */
  start(): void {
    if (this.#running) return
    this.#running = true
    this.#errors = 0
    this.#schedule()
  }

  stop(): void {
    this.#running = false
    if (this.#handle !== null) this.#timers.clear(this.#handle)
    this.#handle = null
  }

  /** One check now, under the same rules a timed one follows. */
  async tick(): Promise<TickOutcome> {
    if (!this.#running) return 'stopped'
    let visible = false
    try { visible = this.#options.visible() } catch { visible = false }
    if (this.#busy || !visible) return 'skipped'
    this.#busy = true
    try {
      await this.#options.check()
      this.#errors = 0
      return 'checked'
    } catch {
      this.#errors++
      if (this.#errors >= (this.#options.maxErrors ?? POLL_MAX_ERRORS)) {
        this.stop()
        try { this.#options.onGiveUp?.() } catch { /* the poll is stopped either way */ }
      }
      return 'failed'
    } finally {
      this.#busy = false
    }
  }

  #schedule(): void {
    this.#handle = this.#timers.set(() => {
      this.#handle = null
      void this.tick().finally(() => { if (this.#running && this.#handle === null) this.#schedule() })
    }, this.#options.everyMs)
  }
}

/** Runs `act` once calls stop coming for `ms`. */
export class Debounced {
  readonly #act: () => void | Promise<void>
  readonly #ms: number
  readonly #timers: Timers
  #handle: unknown = null

  constructor(act: () => void | Promise<void>, ms: number, timers: Timers = realTimers) {
    this.#act = act
    this.#ms = ms
    this.#timers = timers
  }

  get pending(): boolean { return this.#handle !== null }

  /** (Re)starts the wait. */
  call(): void {
    if (this.#handle !== null) this.#timers.clear(this.#handle)
    this.#handle = this.#timers.set(() => { this.#handle = null; void this.#run() }, this.#ms)
  }

  /** Runs now if a run is waiting; resolves when it is done. */
  async flush(): Promise<void> {
    if (this.#handle === null) return
    this.#timers.clear(this.#handle)
    this.#handle = null
    await this.#run()
  }

  cancel(): void {
    if (this.#handle !== null) this.#timers.clear(this.#handle)
    this.#handle = null
  }

  async #run(): Promise<void> {
    try { await this.#act() } catch { /* the act reports its own failure */ }
  }
}

/** How far a load has got, as a share 0..1; null while the total is not known. */
export const progressShare = (progress: { readonly opened: number; readonly total: number } | null | undefined): number | null =>
  progress && progress.total > 0 ? Math.min(1, Math.max(0, progress.opened / progress.total)) : null

/** A size people read: KB below a megabyte (never "0 KB"), MB with one place above. */
export function sizeLabel(bytes: number): string {
  const n = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  const mb = n / (1024 * 1024)
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`
}
