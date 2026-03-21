// hypercomb-shared/core/movement.service.ts

import type { Navigation } from './navigation'

// global get/register/list available via ioc.web.ts

export class MovementService extends EventTarget {

  // increments after navigation intent is committed
  #moved = 0

  public get moved(): number { return this.#moved }

  private get navigation(): Navigation { return get('@hypercomb.social/Navigation') as Navigation }

  // prevents overlapping commits
  private committing: Promise<void> | null = null

  // lets callers await the next commit (used by move)
  private waiters: Array<() => void> = []

  public constructor() {
    super()
    // follow browser back/forward
    window.addEventListener('popstate', () => { void this.commit() })

    // follow programmatic navigation (navigation.go/goRaw/etc dispatches this)
    window.addEventListener('navigate', () => { void this.commit() })
  }

  // ----------------------------------
  // relative movement
  // ----------------------------------

  public move = async (segment: string): Promise<void> => {
    const clean = segment.replace(/\s+/g, ' ').trim()
    if (!clean) return

    const segments = this.navigation.segmentsRaw()
    segments.push(clean)

    const done = this.waitForNextCommit()
    this.navigation.goRaw(segments)
    await done
  }

  // ----------------------------------
  // history
  // ----------------------------------

  public back = async (): Promise<void> => {
    const done = this.waitForNextCommit()
    window.history.back()
    await done
  }

  public forward = async (): Promise<void> => {
    const done = this.waitForNextCommit()
    window.history.forward()
    await done
  }

  // ----------------------------------
  // internal
  // ----------------------------------

  private readonly waitForNextCommit = (): Promise<void> => {
    return new Promise(resolve => { this.waiters.push(resolve) })
  }

  private readonly commit = async (): Promise<void> => {
    if (this.committing) {
      await this.committing
      return
    }

    // guard must be set before synchronous work so recursive calls (from
    // listeners triggered by dispatchEvent) are coalesced
    this.committing = Promise.resolve()

    // increment synchronously — Angular signals react immediately, preventing
    // stale breadcrumb labels between URL update and next microtask
    this.#moved = this.#moved + 1
    this.dispatchEvent(new CustomEvent('change'))

    const pending = this.waiters
    this.waiters = []
    for (const r of pending) r()

    try {
      await this.committing
    } finally {
      this.committing = null
    }
  }
}

register('@hypercomb.social/MovementService', new MovementService())
