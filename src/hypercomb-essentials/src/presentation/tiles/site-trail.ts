// presentation/tiles/site-trail.ts
//
// THE PATH A READER TOOK THROUGH A SITE, SO BACK CAN WALK IT.
//
// Every page a reader opens inside a site is a visit, the same as stepping
// into a tile: back returns to the page before it, one page per press, and
// only back from the page the site was entered on leaves the website (jwize,
// 2026-11-03: "the back button needs to walk the path you took ... when going
// back it doesn't exit the website except for the root").
//
// The site moves the explorer with `explorerReplace`, so the browser's own
// history never grows while a site is read; the path lives here instead, in
// the view, for as long as the site is on screen. A new site session starts
// an empty trail.

const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((s, i) => s === b[i])

export class SiteTrail {
  #steps: string[][] = []

  /** The trail keeps at most this many pages; the oldest go first. */
  constructor(readonly limit = 200) {}

  /** How many pages back can still walk to. */
  get length(): number { return this.#steps.length }

  /** The reader left `from` for `to`: remember where they were. Staying on
   *  the same page is not a visit. */
  left(from: readonly string[], to: readonly string[]): void {
    if (same(from, to)) return
    this.#steps.push([...from])
    if (this.#steps.length > this.limit) this.#steps.splice(0, this.#steps.length - this.limit)
  }

  /** The page back goes to, taken off the trail; null when the reader is on
   *  the page the site was entered on. */
  back(): readonly string[] | null {
    return this.#steps.pop() ?? null
  }

  /** A new site session: nothing to walk back to yet. */
  clear(): void { this.#steps = [] }
}
