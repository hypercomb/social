// sharing/image-queue.ts
//
// THE WALL, ONE TILE AT A TIME. With many tiles selected, "look for images"
// is not one wall with every tile's pictures mixed together — nobody could
// tell whose picture was whose. It is the same wall, opened for each tile in
// turn: choose a picture or skip, and it moves on to the next one.
//
// This is only the bookkeeping, kept pure so it can be read and tested apart
// from the Pixi wall that uses it: which tiles, in what order, which are done
// (chosen OR skipped — both are an answer), and which one the wall is on now.
// The state it hands out is exactly the `images:queue` payload, so a surface
// marking rows done (the selection shelf) reads the same words the wall does.

/** The `images:queue` payload. `current` null with `labels` empty means the
 *  queue has ended; `done` and `segments` are kept so the last word stands. */
export type ImageQueueState = {
  segments: string[]
  labels: string[]
  done: string[]
  current: string | null
}

export class ImageQueue {
  #segments: string[] = []
  #labels: string[] = []
  #done: string[] = []
  #current: string | null = null

  /** True while there is a tile the wall is (or is about to be) open for. */
  get running(): boolean { return this.#current !== null }
  get current(): string | null { return this.#current }
  get segments(): readonly string[] { return this.#segments }

  /** Begin a queue. Names are trimmed and each counts once, in the order given
   *  (selection order). Returns the first tile, or null when there are none. */
  start(labels: readonly string[], segments: readonly string[]): string | null {
    const seen = new Set<string>()
    this.#labels = []
    for (const raw of labels) {
      const label = String(raw ?? '').trim()
      if (!label || seen.has(label)) continue
      seen.add(label)
      this.#labels.push(label)
    }
    this.#segments = segments.map(s => String(s ?? '').trim()).filter(Boolean)
    this.#done = []
    this.#current = this.#labels[0] ?? null
    return this.#current
  }

  /** The tile on the wall is answered (a picture chosen, or skipped). Returns
   *  the next one still waiting, or null when that was the last — the queue
   *  has then ended. */
  advance(): string | null {
    if (this.#current === null) return null
    if (!this.#done.includes(this.#current)) this.#done.push(this.#current)
    this.#current = this.#labels.find(label => !this.#done.includes(label)) ?? null
    if (this.#current === null) this.#labels = []
    return this.#current
  }

  /** Stop where it stands. The tiles already answered stay answered. */
  end(): void {
    this.#current = null
    this.#labels = []
  }

  /** Where the wall is in the queue: 1-based, of how many. */
  position(): { index: number; total: number } {
    const index = this.#current === null ? 0 : this.#labels.indexOf(this.#current) + 1
    return { index, total: this.#labels.length }
  }

  /** The next tile after the current one, for the skip control's caption. */
  peekNext(): string | null {
    if (this.#current === null) return null
    return this.#labels.find(label => label !== this.#current && !this.#done.includes(label)) ?? null
  }

  state(): ImageQueueState {
    return {
      segments: [...this.#segments],
      labels: [...this.#labels],
      done: [...this.#done],
      current: this.#current,
    }
  }
}
