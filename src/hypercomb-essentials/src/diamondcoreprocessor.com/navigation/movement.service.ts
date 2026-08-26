// movement.service.ts (moved down from hypercomb-shared in the
// everything-is-a-beehavior Phase 1 — contract in core movement.types.ts;
// rides the navigation bundle via panning.drone). Announces every committed
// navigation on EffectBus so chrome re-renders instance-free.

import { EffectBus, MOVEMENT_SERVICE_KEY, MOVEMENT_CHANGED, type MovementProvider } from '@hypercomb/core'

/** The slice of Navigation this needs — reached through IoC, never an import. */
type NavigationLike = { segmentsRaw(): string[]; goRaw(segments: string[]): void }

export class MovementService extends EventTarget implements MovementProvider {

  // increments after navigation intent is committed
  #moved = 0

  public get moved(): number { return this.#moved }

  private get navigation(): NavigationLike { return window.ioc?.get?.('@hypercomb.social/Navigation') as NavigationLike }

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
    performance.mark('hypercomb:back:movement-start')
    const done = this.waitForNextCommit()
    window.history.back()
    await done
    performance.mark('hypercomb:back:movement-end')
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
    EffectBus.emit(MOVEMENT_CHANGED, { moved: this.#moved })

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

export const movementService = new MovementService()
EffectBus.emit(MOVEMENT_CHANGED, { moved: movementService.moved })

/** Re-assert into the LIVE IoC map (the llm-provider-registry lesson). */
export const ensureMovementServiceRegistered = (): void => {
  if (!window.ioc?.has?.(MOVEMENT_SERVICE_KEY)) {
    window.ioc?.register?.(MOVEMENT_SERVICE_KEY, movementService)
  }
}
ensureMovementServiceRegistered()
