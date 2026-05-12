// diamondcoreprocessor.com/selection/selection-from-url.drone.ts
//
// Bridges URL → SelectionService. The Navigation service in
// hypercomb-shared/core recognizes both the legacy hash form
// (`#name` / `#(a,b,c)`) and the new path-bracket form
// (`/parent/[a,b,c]`) when computing `getSelections()`. This drone
// listens to window-level navigation events and pushes the parsed
// selection list into the per-cell SelectionService, so:
//
//   - deep-link URLs like `/dolphin/[model]` open with `model` selected
//   - dashboard links of the same shape trigger the right tiles
//   - browser back/forward keeps tile selection in sync with the URL
//
// Reverse direction (clicks → URL) is owned by the existing
// tile-selection / hash-writing path; this drone only reads.

import { Drone } from '@hypercomb/core'

interface SelectionServiceLike {
  readonly selected: ReadonlySet<string>
  clear(): void
  add(label: string): void
}

interface NavigationLike {
  getSelections(): string[]
}

interface IocLike {
  get<T>(key: string): T | undefined
}

export class SelectionFromUrlDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description =
    'Bridges window URL (path-bracket + hash selection forms) into the SelectionService.'

  #bound = false
  #syncing = false
  readonly #sync = (): void => { this.#syncFromUrl() }

  protected override heartbeat = async (): Promise<void> => {
    if (this.#bound) return
    this.#bound = true

    // Only listen to actual URL changes ('navigate' = go/replace/back-forward,
    // 'popstate' = browser back-forward). The 'selection' event also fires when
    // the legacy hash writer runs (from tile clicks), which would feedback-loop:
    // a click adds 'practice' to SelectionService, hash writer fires 'selection',
    // this drone reads getSelections() (path bracket takes precedence and still
    // says just 'model'), and resets SelectionService back to 'model' alone —
    // reverting the click. The 'navigate' / 'popstate' set covers genuine URL
    // mutations without that feedback path.
    window.addEventListener('navigate', this.#sync)
    window.addEventListener('popstate', this.#sync)

    // Initial sync — handles deep-link load where the URL already
    // carries a `[...]` bracket before any navigation event fires.
    // Services may not be registered yet on the very first call; the
    // event listeners cover later opportunities.
    this.#syncFromUrl()
  }

  protected override dispose(): void {
    if (!this.#bound) return
    window.removeEventListener('navigate', this.#sync)
    window.removeEventListener('popstate', this.#sync)
    this.#bound = false
  }

  #syncFromUrl(): void {
    if (this.#syncing) return
    const ioc = (window as { ioc?: IocLike }).ioc
    if (!ioc) return
    const navigation = ioc.get<NavigationLike>('@hypercomb.social/Navigation')
    const selection = ioc.get<SelectionServiceLike>('@diamondcoreprocessor.com/SelectionService')
    if (!navigation || !selection) return

    const desired = new Set(navigation.getSelections())
    const current = selection.selected

    // Same set? Skip — avoids redundant notifications and any chance
    // of feedback with the SelectionService → URL writer.
    if (desired.size === current.size) {
      let same = true
      for (const x of desired) {
        if (!current.has(x)) { same = false; break }
      }
      if (same) return
    }

    this.#syncing = true
    try {
      selection.clear()
      for (const name of desired) selection.add(name)
    } finally {
      this.#syncing = false
    }
  }
}

const _selectionFromUrl = new SelectionFromUrlDrone()
window.ioc.register('@diamondcoreprocessor.com/SelectionFromUrlDrone', _selectionFromUrl)
