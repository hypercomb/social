// tile-landing.ts — THE WRITE LANDS, THE PAINT WAITS. A branch of the tile
// renderer (documentation/tile-renderer-tree.md): quiet landing.
//
// A background writer — the bridge answering an ask raised from a tile —
// lands its payload as TRUTH the moment it arrives: the layer is minted, the
// note is on the cell, the resource is in the pool. What it must NOT do is
// pull the surface out from under the participant. A drained ask writes a
// dozen notes in one burst, and a dozen full re-walks is a dozen flickers on
// a hive somebody is still working in.
//
// So the WRITE lands and the PAINT waits. `landing:quiet` brackets the
// writer's burst (the producer owns the depth count and the settle delay, so
// a burst is ONE window); every render request inside the window is counted
// instead of run, and the count goes out on `landing:pending` for the badge
// to show. The participant taps it when they are ready — `landing:apply` —
// and that tap is the only release.
//
// Held is not dropped, and never lost: the renderer arms a forced pass when a
// hold is spent, so whenever the pass finally runs it survives the
// unchanged-page fast path. And a render that happens for any other reason
// (they panned, they walked into a layer, they edited something) has already
// shown them what landed, so it spends the count on the way through — the
// badge means "there is something you have not seen yet", never "there is
// something unwritten".

/** A WRITE'S CONSEQUENCES ARRIVE AS A CHAIN, NOT AN EVENT. The producer's
 *  window covers the write itself; what follows is the commit flushing its
 *  marker, then the readiness repaint as each new tile's visual resolves,
 *  then the optimize tick — measured at 8ms, 36ms, 204ms, 353ms, 407ms,
 *  659ms, 929ms after one three-tile burst, from SEVEN different call sites.
 *  No settle delay on the producer covers that, and tagging the callers is a
 *  losing game: the chain reaches requestRender through paths that look
 *  exactly like a participant's. So the renderer measures the chain instead
 *  of guessing at it: while paints keep being held, the landing is still
 *  landing; once nothing has been held for this long, the chain is done and
 *  the next paint belongs to the participant. */
const CASCADE_QUIET_MS = 1500

export interface LandingHost {
  /** Where the participant stands (the lineage's label). */
  where(): string
  emit(effect: string, payload: unknown): void
}

/** What a render request should do now. `spend`: run, and force the pass —
 *  the held change is at the same location, so the unchanged-page fast path
 *  would otherwise return having done nothing and the badge would clear over
 *  a surface that never moved. */
export type LandingVerdict = 'hold' | 'spend' | 'run'

export class QuietLanding {
  #quiet = false
  #held = 0
  /** Location the hold happened at. A pass at a DIFFERENT location is the
   *  participant walking somewhere — that must always paint, and seeing the
   *  new page spends the badge. */
  #heldAt: string | null = null
  /** When the last pass was held (see CASCADE_QUIET_MS). */
  #lastHeldAt = 0
  /** WRITES landed during the window, as counted by the producer — the only
   *  honest number to show a person. Held renders are not writes: a burst of
   *  twelve notes coalesces into far fewer paints, so counting paints would
   *  under-report, and a producer that writes nothing but touches the layer
   *  would over-report. Survives the window closing (the badge outlives the
   *  burst); cleared only when a real paint shows them. */
  #writes = 0

  constructor(private readonly host: LandingHost) {}

  /** Paints are being held. */
  get holding(): boolean { return this.#held > 0 }

  /** A render was requested. Held while the producer's window is open —
   *  whatever caused the pass, a bridge `add` arrives through `cell:added`,
   *  not only synchronize — and afterwards for as long as that write is still
   *  cascading at a location the participant has not left. Not held: this
   *  pass is about to show them whatever landed, so the badge is spent. */
  admit(now = Date.now()): LandingVerdict {
    const cascading = this.#held > 0
      && this.#heldAt === this.host.where()
      && (now - this.#lastHeldAt) < CASCADE_QUIET_MS
    if (this.#quiet || cascading) {
      if (this.#held === 0) this.#heldAt = this.host.where()
      this.#held++
      this.#lastHeldAt = now
      this.#publish()
      return 'hold'
    }
    if (this.#held > 0) {
      this.#held = 0
      this.#writes = 0
      this.#heldAt = null
      this.#publish()
      return 'spend'
    }
    return 'run'
  }

  /** `landing:quiet` — the producer opened or closed its window. This side is
   *  a plain on/off: the DEPTH count and the settle delay belong to the
   *  producer, the only thing that knows a burst is a burst. The producer's
   *  tally is carried while the window is OPEN only: the close emit reports
   *  zero, and adopting that would wipe a badge still owed. */
  quiet(active: boolean, writes: number): void {
    this.#quiet = active
    if (this.#quiet && writes > 0) this.#writes = writes
  }

  /** `landing:apply` — the badge was tapped. True when something was held:
   *  the renderer then runs a forced pass. Guarded on the held count so the
   *  bus's last-value replay can't fire a stray forced paint at boot. */
  apply(): boolean {
    if (this.#held <= 0) return false
    this.#quiet = false
    return true
  }

  /** Publish the unseen-change count for the landing badge. */
  #publish(): void {
    this.host.emit('landing:pending', {
      count: this.#held > 0 ? (this.#writes || this.#held) : 0,
      where: this.host.where(),
    })
  }
}
