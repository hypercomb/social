// navigation/view-back.ts
//
// THE HARDWARE BACK BUTTON LEAVES A VIEW.
//
// On a phone the way out of a full-screen view is the BACK button — there is
// no Escape key and no right button. Until now only the tile close-up
// (tile-view) answered it: it pushes one synthetic history entry when it opens
// and closes itself when that entry pops. Every other view — slides, the
// scroller, postit, square-tile, publications, brief, game, lounge, document,
// website — left the button to the browser, and the browser's answer is to
// move the LINEAGE under the open surface: the hive walked back a page while
// the view stayed up, and the on-screen back disc is hidden under
// `view:active`, so there was no second chance.
//
// This module generalises the close-up's trap to every view, keyed on the one
// fact every view already publishes — `view:active`, owner-counted by the
// ModeRegistry:
//
//   • `view:active` 0 → 1: push ONE synthetic entry `{ hcView: owner }`. The
//     entry is the trap. The URL does not change, so Navigation and Lineage
//     see nothing, exactly as with the close-up.
//   • popstate while a view is up: that pop consumed the trap. Route it
//     through BackGesture as a right-click would — the TOP owner's registered
//     way out, or a peel to hexagons for a view that never registered
//     (slides, the scroller); an ARRIVAL FACE navigates, which is
//     BackGesture's rule, not ours. Then, once the close has had its chance
//     (REARM_MS), re-arm if any owner remains: a nested owner underneath, or a
//     view that closed nothing. ONE trap per stack, never one per owner — the
//     mode broadcasts only on 0 ↔ 1, so a nested owner is never announced, and
//     one entry re-armed per press covers the whole stack.
//   • `view:active` 1 → 0 while the trap is armed: the view closed by another
//     path (×, Escape, a lineage move). Drop the entry with `history.back()`,
//     but only while it is still the top of the stack (`history.state.hcView`
//     is ours) — a foreign entry pushed above it is never popped — and the pop
//     we issue is recognised and ignored when it lands.
//
// The close-up keeps its own trap (it also SUSPENDS under surfaces it opened
// and takes the screen back on BACK); while it is open this module stands
// down entirely, so a press is never answered twice.
//
// Imported for its side-effect once via the side-effects barrel; the singleton
// is reachable through IoC for introspection.
//
// IoC key: @diamondcoreprocessor.com/ViewBack

import { EffectBus } from '@hypercomb/core'

/** The slice of `window.history` this module touches — a seam for the spec. */
export type HistoryLike = {
  readonly state: unknown
  pushState(state: unknown, unused: string): void
  back(): void
}

type ModePayload = { active?: boolean; owner?: string }
type BackGestureLike = {
  resolve?: (
    target: Element | null,
    options?: { unregisteredView?: 'lineage' | 'peel' },
  ) => { back: () => void } | null
  backOutOfView?: (peel: () => void) => void
}
type ModeRegistryLike = {
  isActive?: (mode: string) => boolean
  ownersOf?: (mode: string) => readonly string[]
}

/** A closing view tears down on its own schedule (a ViewMode change, then an
 *  async reconcile), so the re-arm waits this long before asking who is still
 *  up. Also long enough for the lineage traversal an ARRIVAL FACE issues to
 *  land first: a push that raced `history.back()` would make that traversal
 *  return to the page it left, and the face would never come down. */
export const REARM_MS = 250

const VIEW_ACTIVE = 'view:active'
const CLOSE_UP_OWNER = 'tile-view'

type Ioc = { get<T>(key: string): T | undefined }
const ioc = <T>(key: string): T | undefined =>
  (globalThis as { ioc?: Ioc }).ioc?.get<T>(key)

export class ViewBack {
  #history: HistoryLike
  #target: EventTarget
  /** Mirror of the replayed `view:active` aggregate. */
  #active = false
  /** Our synthetic entry is the top of the history stack. */
  #armed = false
  /** We issued `history.back()` to drop our own entry; ignore its landing. */
  #popping = false
  #rearmTimer: ReturnType<typeof setTimeout> | null = null
  #unsubscribe: () => void

  constructor(history: HistoryLike = window.history, target: EventTarget = window) {
    this.#history = history
    this.#target = target
    this.#target.addEventListener('popstate', this.#onPopState)
    this.#unsubscribe = EffectBus.on<ModePayload>(VIEW_ACTIVE, this.#onActive)
  }

  /** Is the trap up — our entry on top of the history stack? */
  get armed(): boolean { return this.#armed }

  /** Stand down: for a spec that stands an instance up and takes it down. */
  dispose = (): void => {
    this.#target.removeEventListener('popstate', this.#onPopState)
    this.#unsubscribe()
    this.#cancelRearm()
  }

  #onActive = (payload: ModePayload): void => {
    const active = payload?.active === true
    this.#active = active
    if (active) { this.#arm(); return }
    this.#cancelRearm()
    if (!this.#armed) return
    // The view closed by another path — ×, Escape, a lineage move. Leave the
    // stack exactly as we found it, but never pop an entry that is not ours.
    this.#armed = false
    if (!this.#stateIsOurs()) return
    this.#popping = true
    try { this.#history.back() } catch { this.#popping = false }
  }

  #onPopState = (): void => {
    if (this.#popping) {
      this.#popping = false
      // A view came up between our back() and its landing, and the pop took
      // the entry just pushed for it. Push it again.
      if (this.#active && this.#armed && !this.#stateIsOurs()) {
        this.#armed = false
        this.#arm()
      }
      return
    }
    if (!this.#active || this.#closeUpOwnsBack()) return
    if (!this.#armed) {
      // No trap was up for this press — a second press inside REARM_MS, or
      // the traversal an arrival face issued — so the page under the view
      // moved. Whoever is still up gets a trap once things settle.
      this.#scheduleRearm()
      return
    }
    // This pop consumed our entry: the press means "leave the view".
    this.#armed = false
    this.#back()
    this.#scheduleRearm()
  }

  #arm = (): void => {
    this.#cancelRearm()
    if (this.#armed || this.#closeUpOwnsBack()) return
    try {
      this.#history.pushState({ hcView: this.#topOwner() }, '')
      this.#armed = true
    } catch {
      /* history unavailable — Escape, × and the exit chips remain */
    }
  }

  /** The same answer a right-click gets, for the top open view — with a view
   *  that never registered peeling to hexagons instead of falling through to
   *  the lineage (a view that is up is the thing to leave). */
  #back = (): void => {
    const gesture = ioc<BackGestureLike>('@diamondcoreprocessor.com/BackGesture')
    const peel = (): void => {
      ioc<{ setMode?: (mode: string) => void }>('@hypercomb.social/ViewMode')?.setMode?.('hexagons')
    }
    const entry = gesture?.resolve?.(null, { unregisteredView: 'peel' })
    if (entry) entry.back()
    else if (gesture?.backOutOfView) gesture.backOutOfView(peel)
    else peel()
  }

  #scheduleRearm = (): void => {
    this.#cancelRearm()
    this.#rearmTimer = setTimeout(() => {
      this.#rearmTimer = null
      const modes = ioc<ModeRegistryLike>('@diamondcoreprocessor.com/ModeRegistry')
      const up = modes?.isActive ? modes.isActive(VIEW_ACTIVE) : this.#active
      if (up && !this.#armed) this.#arm()
    }, REARM_MS)
  }

  #cancelRearm = (): void => {
    if (this.#rearmTimer === null) return
    clearTimeout(this.#rearmTimer)
    this.#rearmTimer = null
  }

  #owners = (): readonly string[] =>
    ioc<ModeRegistryLike>('@diamondcoreprocessor.com/ModeRegistry')?.ownersOf?.(VIEW_ACTIVE) ?? []

  #topOwner = (): string => this.#owners().at(-1) ?? 'view'

  /** The close-up traps BACK itself, suspended or not. */
  #closeUpOwnsBack = (): boolean =>
    ioc<{ open_?: boolean }>('@diamondcoreprocessor.com/TileViewDrone')?.open_ === true
    || this.#owners().includes(CLOSE_UP_OWNER)

  #stateIsOurs = (): boolean => {
    const state = this.#history.state as { hcView?: unknown } | null | undefined
    return typeof state?.hcView === 'string'
  }
}

const _viewBack = new ViewBack()
window.ioc.register('@diamondcoreprocessor.com/ViewBack', _viewBack)
