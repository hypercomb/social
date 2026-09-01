// assistant/receipt.ts
//
// OUTCOME RECEIPT — an operation cannot silently do less than it claimed.
//
// A batch act touches N things and, in practice, does fewer. Tiles are
// skipped, refused, already done, or unreadable. Each of those is a legitimate
// outcome; what is NOT legitimate is reporting only the successes, because
// "broke apart 3 tiles" on a layer of 8 reads as completion rather than as a
// shortfall with five explanations behind it.
//
// This session produced four hand-written tally blocks in three files, and one
// of them was wrong — a boolean return made a foreach count "queued" and
// "skipped" identically, so the toast showed a number with no way to learn why
// it was smaller than the layer. The reporting has to come from the same place
// as the counting, or the two drift.
//
// The rule this enforces: EVERY item is accounted for. `landed + Σskipped`
// equals the number attempted, and the summary names the reasons in the same
// breath as the count. A receipt with no reasons and a shortfall is a bug in
// the caller, not a formatting choice.

/** One reason an item did not land. Free-form on purpose: the acts that use
 *  this know their own vocabulary ('has-children', 'ancestor-busy'), and a
 *  closed enum here would just get widened by every new caller. */
export type SkipReason = string

export interface Receipt {
  /** How many items the act set out to handle. */
  readonly attempted: number
  /** How many actually landed. */
  readonly landed: number
  /** Why the rest did not — reason → count. Ordered by insertion. */
  readonly skipped: ReadonlyMap<SkipReason, number>
  /** True when nothing was left unexplained. */
  readonly complete: boolean
}

/** Accumulates outcomes so the count and the explanation cannot diverge. */
export class ReceiptBuilder {
  #attempted = 0
  #landed = 0
  readonly #skipped = new Map<SkipReason, number>()

  /** Record an item that succeeded. */
  landed(): void {
    this.#attempted++
    this.#landed++
  }

  /** Record an item that did not, and WHY. The reason is mandatory — a skip
   *  without one is exactly the silent shortfall this type exists to stop. */
  skipped(reason: SkipReason): void {
    this.#attempted++
    const key = String(reason || 'unknown').trim() || 'unknown'
    this.#skipped.set(key, (this.#skipped.get(key) ?? 0) + 1)
  }

  build(): Receipt {
    let accounted = this.#landed
    for (const n of this.#skipped.values()) accounted += n
    return {
      attempted: this.#attempted,
      landed: this.#landed,
      skipped: new Map(this.#skipped),
      // A receipt whose parts do not sum has lost track of an item — surface
      // that rather than printing a tidy number over a gap.
      complete: accounted === this.#attempted,
    }
  }
}

/** Human phrasing for the skips, e.g. "3 already had children, 1 already queued".
 *  `labels` maps a reason to its wording; an unmapped reason prints raw rather
 *  than being dropped, because a reason nobody phrased is still a reason. */
export const describeSkips = (
  receipt: Receipt,
  labels: Readonly<Record<string, (n: number) => string>> = {},
): string =>
  [...receipt.skipped.entries()]
    .map(([reason, n]) => (labels[reason] ? labels[reason](n) : `${n} ${reason}`))
    .join(', ')

/** One line for a toast. Never claims completion it cannot back: when nothing
 *  landed it leads with that, and it always carries the reasons. */
export const describeReceipt = (
  receipt: Receipt,
  verb: string,
  noun: string,
  labels?: Readonly<Record<string, (n: number) => string>>,
): string => {
  const skips = describeSkips(receipt, labels)
  const plural = (n: number) => (n === 1 ? '' : 's')

  if (receipt.landed === 0) {
    return `Nothing ${verb}${skips ? ` — ${skips}` : ''}.`
  }
  return `${verb} ${receipt.landed} ${noun}${plural(receipt.landed)}`
    + (skips ? ` (${skips})` : '')
    + (receipt.complete ? '' : ' — some items were not accounted for')
}
