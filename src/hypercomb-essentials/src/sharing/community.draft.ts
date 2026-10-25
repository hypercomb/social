// sharing/community.draft.ts
//
// The showcase being edited, with undo and redo (jwize 2026-10-25: "any editable community should
// include undo/redo"). Pure: it holds records, and a change is a new record, so undoing a switch
// lands back on the very record it left. Nothing here signs or sends anything.

import type { Showcase } from './showcase-record.js'

export class CommunityDraft {
  #past: Showcase[] = []
  #future: Showcase[] = []
  #now: Showcase

  constructor(initial: Showcase) { this.#now = initial }

  get current(): Showcase { return this.#now }
  get canUndo(): boolean { return this.#past.length > 0 }
  get canRedo(): boolean { return this.#future.length > 0 }

  /** A change: kept for undo, and the redo it leaves behind is gone. A change that changes nothing is not kept. */
  apply(next: Showcase): void {
    if (next === this.#now) return
    this.#past.push(this.#now)
    this.#future = []
    this.#now = next
  }

  undo(): boolean {
    const back = this.#past.pop()
    if (!back) return false
    this.#future.push(this.#now)
    this.#now = back
    return true
  }

  redo(): boolean {
    const forward = this.#future.pop()
    if (!forward) return false
    this.#past.push(this.#now)
    this.#now = forward
    return true
  }
}
