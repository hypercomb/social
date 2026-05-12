// diamondcoreprocessor.com/selection/url-bracket-opens-editor.drone.ts
//
// UX side-effect: when a NEW URL arrives carrying a path-bracket
// selection (`/parent/[name]`), open the tile editor for the first
// selected name. The selection itself is wired natively in
// SelectionService — it watches `navigate`/`popstate` and reconciles
// its set from the URL. This drone is the auto-open layer on top:
// dashboard links land the user in the editor with notes + Q&A
// already visible, instead of just leaving the tile pre-selected on
// the grid.
//
// Why a drone (and not part of SelectionService)?
//   - SelectionService is a pure data primitive — set of strings,
//     active item, events. It deliberately doesn't know about the
//     editor or any UI surface.
//   - Auto-opening the editor is a *behavior* triggered by a kind
//     of selection event (URL-bracket, not click). Bridging the
//     two via an EffectBus `tile:action` emit keeps the two
//     primitives orthogonal: the editor decides what to do, the
//     selection just is.
//   - Hash-form selection (from tile clicks) deliberately does NOT
//     trigger this — we only react to `navigate` / `popstate` AND
//     gate on `Navigation.hasBracketSelection()`.

import { Drone, EffectBus } from '@hypercomb/core'

interface SelectionServiceLike {
  readonly selected: ReadonlySet<string>
}

interface NavigationLike {
  hasBracketSelection(): boolean
}

interface IocLike {
  get<T>(key: string): T | undefined
}

export class UrlBracketOpensEditorDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description =
    'When a URL bracket selection (`/parent/[name]`) arrives, opens the tile editor for the first selected.'

  #bound = false
  /** Tracks the URL we last reacted to. Re-firing for the same URL
   *  (after save → cascade → synchronize → other internal events) would
   *  re-open the editor in a loop — guard with this. */
  #lastUrl: string | null = null
  readonly #onUrl = (): void => { this.#maybeOpen() }

  protected override heartbeat = async (): Promise<void> => {
    if (this.#bound) return
    this.#bound = true
    window.addEventListener('navigate', this.#onUrl)
    window.addEventListener('popstate', this.#onUrl)
    // Initial check covers deep-link load (URL was set before any
    // navigation event fired).
    this.#maybeOpen()
  }

  protected override dispose(): void {
    if (!this.#bound) return
    window.removeEventListener('navigate', this.#onUrl)
    window.removeEventListener('popstate', this.#onUrl)
    this.#bound = false
  }

  #maybeOpen(): void {
    const ioc = (window as { ioc?: IocLike }).ioc
    if (!ioc) return
    const navigation = ioc.get<NavigationLike>('@hypercomb.social/Navigation')
    const selection = ioc.get<SelectionServiceLike>('@diamondcoreprocessor.com/SelectionService')
    if (!navigation || !selection) return

    const url = window.location.pathname + window.location.hash
    const urlChanged = url !== this.#lastUrl
    this.#lastUrl = url

    if (!urlChanged) return
    if (!navigation.hasBracketSelection()) return
    if (selection.selected.size === 0) return

    const first = [...selection.selected][0]
    EffectBus.emit('tile:action', {
      action: 'edit',
      label: first,
      q: 0,
      r: 0,
      index: 0,
    })
  }
}

const _drone = new UrlBracketOpensEditorDrone()
window.ioc.register('@diamondcoreprocessor.com/UrlBracketOpensEditorDrone', _drone)
