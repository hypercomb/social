// presentation/tiles/show-cell.paint.ts — the paint ledger (single-paint.md, V1–V5, V7)
//
// One dirty set, one drain, and a record of what every slot was last painted
// with. The ledger is the DECISION half of "rendering never repeats": given the
// slot plans of the cells on the page, it says which slots are written and
// which buffers are pushed. It never touches a buffer itself — the drone's
// writer does that, under the ledger's instruction — so the decision runs
// under vitest with fake cells while the GPU writes stay in the drone.
//
//   paintKey(cell) = its slot plan: per attribute, the values the writer would
//   put into that cell's slice of that buffer. Same plan, same pixels (V1). A
//   slot is rewritten only for the attributes whose values differ from what
//   was last written there; a label whose whole plan is unchanged is skipped,
//   and when that label was named by a handler (not a full pass) the skip is
//   reported once per label — a repaint under an unchanged key is a defect,
//   not a cost (V7).
//
//   dirty(label)     — a handler names what changed (V2, V5).
//   dirtyAll(reason) — the page: a location or layout-mode change (V2).
//   drain(plans)     — once per frame: writes the dirty (or, when full, every)
//                      slot whose plan changed, then pushes each touched buffer
//                      once (V3, V4). A full drain still skips unchanged plans.

/** Per attribute, the values one cell's slice of that buffer takes. */
export type SlotPlan = Readonly<Record<string, readonly number[]>>

export type PaintAudit = {
  /** Drains that ran (a drain that wrote nothing still counts). */
  drains: number
  /** Slots written — a cell with at least one changed attribute. */
  slots: number
  /** Drains that pushed (one push per drain, V4). */
  pushes: number
  /** Attribute buffers uploaded across all pushes. */
  bufferUpdates: number
  /** Dirty or full-pass cells whose plan was unchanged and were skipped. */
  skipped: number
  /** Explicitly dirtied labels found unchanged — each one names a handler
   *  that asked for a paint it did not need. */
  unchangedRequests: number
  /** Slots written, by the reason of the drain that wrote them. */
  byReason: Record<string, number>
}

export type DrainReport = {
  full: boolean
  reason: string
  written: string[]
  skipped: number
  touched: string[]
  pushed: boolean
  /** Explicitly dirtied labels whose plan had not changed. */
  unchanged: string[]
}

export type DrainOptions = {
  /** A FULL drain: every cell on the page is re-planned (a location or
   *  layout-mode change, or a page-level request). Consumes the pending
   *  full reason. Without it, only the dirty labels are considered. */
  full?: boolean
  /** Labels left for a later drain (their loads are still in flight); they
   *  stay dirty. */
  skip?: ReadonlySet<string>
  /** Drain these labels only (an animation's frame); the rest stay dirty. */
  only?: Iterable<string>
}

const sameValues = (a: readonly number[] | undefined, b: readonly number[]): boolean => {
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export const emptyAudit = (): PaintAudit => ({
  drains: 0, slots: 0, pushes: 0, bufferUpdates: 0, skipped: 0, unchangedRequests: 0, byReason: {},
})

export class PaintLedger {
  /** label → why it was dirtied (the first reason wins; it names the handler). */
  readonly #dirty = new Map<string, string>()
  /** The reason of a pending full drain, or null. */
  #full: string | null = null
  /** label → the plan last written into its slot. */
  readonly #painted = new Map<string, SlotPlan>()
  /** Labels already reported for an unchanged-key request (once per label). */
  readonly #warned = new Set<string>()
  readonly #warn: ((label: string, why: string) => void) | null
  readonly audit: PaintAudit = emptyAudit()

  constructor(warn?: (label: string, why: string) => void) {
    this.#warn = warn ?? null
  }

  /** A handler names the cells that changed. */
  dirty(labels: string | Iterable<string>, why = 'dirty'): void {
    if (typeof labels === 'string') {
      if (labels && !this.#dirty.has(labels)) this.#dirty.set(labels, why)
      return
    }
    for (const label of labels) if (label && !this.#dirty.has(label)) this.#dirty.set(label, why)
  }

  /** The page changed: a location or a layout-mode change (V2). */
  dirtyAll(reason: string): void {
    if (this.#full === null) this.#full = reason
  }

  /** Cells are waiting to be drained. A pending FULL reason is not pending
   *  work here — the full pass owns it (see `full`). */
  get pending(): boolean { return this.#dirty.size > 0 }
  /** The reason of a pending full pass, or null. */
  get full(): string | null { return this.#full }
  /** The full pass found the page converged: nothing to re-plan. */
  settle(): void { this.#full = null }
  get dirtyLabels(): string[] { return [...this.#dirty.keys()] }
  isDirty(label: string): boolean { return this.#dirty.has(label) }
  painted(label: string): SlotPlan | undefined { return this.#painted.get(label) }
  get paintedCount(): number { return this.#painted.size }

  /** A cell left the page: its slot is nobody's. */
  forget(label: string): void {
    this.#painted.delete(label)
    this.#dirty.delete(label)
  }

  /** The buffers were replaced (new size or order): nothing is painted, and
   *  whatever was dirty is covered by the fresh write that follows. */
  reset(): void {
    this.#painted.clear()
    this.#dirty.clear()
    this.#full = null
  }

  /** A fresh buffer's slot was written wholesale (no diff possible). */
  adopt(label: string, plan: SlotPlan): void {
    this.#painted.set(label, plan)
  }

  /** Fresh buffers were built and every slot written once: adopt them all
   *  and count the build as one push of `buffers` uploads. */
  adoptAll(entries: Iterable<readonly [string, SlotPlan]>, reason: string, buffers: number): void {
    this.#dirty.clear()
    this.#full = null
    let n = 0
    for (const [label, plan] of entries) { this.#painted.set(label, plan); n++ }
    this.audit.drains++
    this.audit.slots += n
    if (n > 0) {
      this.audit.pushes++
      this.audit.bufferUpdates += buffers
      this.audit.byReason[reason] = (this.audit.byReason[reason] ?? 0) + n
    }
  }

  /** A single attribute changed under an animation (a heat step): record it
   *  as painted so the next plan diff does not write it again. */
  note(label: string, attr: string, values: readonly number[]): boolean {
    const prev = this.#painted.get(label)
    if (!prev) return false
    if (sameValues(prev[attr], values)) return false
    this.#painted.set(label, { ...prev, [attr]: values })
    return true
  }

  /**
   * THE DECISION. `plans` are the cells on the page with their current slot
   * plans; `write` puts one attribute's values into one cell's slice; `push`
   * uploads the named buffers, once. Returns what was written, for the audit
   * and the specs.
   */
  drain(
    plans: ReadonlyMap<string, SlotPlan>,
    write: (label: string, attr: string, values: readonly number[]) => void,
    push: (attrs: readonly string[]) => void,
    options: DrainOptions = {},
  ): DrainReport {
    const full = options.full === true
    const reason = full ? (this.#full ?? 'full') : (options.only !== undefined ? 'frame' : 'dirty')
    const skip = options.skip
    const labels: string[] = []
    if (options.only !== undefined) {
      for (const label of options.only) if (this.#dirty.has(label)) labels.push(label)
    } else if (full) {
      for (const label of plans.keys()) labels.push(label)
    } else {
      for (const label of this.#dirty.keys()) labels.push(label)
    }

    const written: string[] = []
    const unchanged: string[] = []
    const touched = new Set<string>()
    let skipped = 0

    for (const label of labels) {
      if (skip?.has(label)) continue
      const plan = plans.get(label)
      const explicit = this.#dirty.get(label)
      this.#dirty.delete(label)
      // Not on this page: nothing to write (an arrival for a tile shown
      // elsewhere, a save made on another page).
      if (!plan) continue
      const prev = this.#painted.get(label)
      let any = false
      for (const attr in plan) {
        const values = plan[attr]
        if (prev && sameValues(prev[attr], values)) continue
        write(label, attr, values)
        touched.add(attr)
        any = true
      }
      if (any) {
        written.push(label)
        this.#painted.set(label, plan)
        continue
      }
      skipped++
      if (!full && explicit !== undefined) {
        unchanged.push(label)
        if (this.#warn && !this.#warned.has(label)) {
          this.#warned.add(label)
          this.#warn(label, explicit)
        }
      }
    }

    if (full) {
      for (const label of [...this.#painted.keys()]) if (!plans.has(label)) this.#painted.delete(label)
      this.#full = null
    }

    const touchedList = [...touched]
    const pushed = touchedList.length > 0
    if (pushed) {
      push(touchedList)
      this.audit.pushes++
      this.audit.bufferUpdates += touchedList.length
    }
    this.audit.drains++
    this.audit.slots += written.length
    this.audit.skipped += skipped
    this.audit.unchangedRequests += unchanged.length
    if (written.length) this.audit.byReason[reason] = (this.audit.byReason[reason] ?? 0) + written.length

    return { full, reason, written, skipped, touched: touchedList, pushed, unchanged }
  }
}
