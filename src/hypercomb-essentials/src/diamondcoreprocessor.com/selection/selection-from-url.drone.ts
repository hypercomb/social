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

import { Drone, EffectBus } from '@hypercomb/core'

interface SelectionServiceLike {
  readonly selected: ReadonlySet<string>
  clear(): void
  add(label: string): void
}

interface NavigationLike {
  getSelections(): string[]
  hasBracketSelection(): boolean
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
  /** Last URL we synced from. New URL + non-empty bracket → auto-open
   *  the editor for the first selected. Tracking the URL prevents
   *  re-opening the editor when other events (save → tile:saved →
   *  cascade → navigate-without-URL-change) fire repeatedly. */
  #lastSyncedUrl: string | null = null
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

    // URL fingerprint — pathname + hash so we can detect genuinely-new
    // URLs and only auto-open the editor once per arrival at a
    // bracket-bearing URL.
    const url = window.location.pathname + window.location.hash
    const urlChanged = url !== this.#lastSyncedUrl
    this.#lastSyncedUrl = url

    const desired = new Set(navigation.getSelections())
    const current = selection.selected
    const hasBracket = navigation.hasBracketSelection()

    // Same set? Skip the SelectionService mutation — avoids redundant
    // notifications and any chance of feedback with the existing
    // SelectionService → URL writer. We still consider the auto-open
    // edit-trigger below: a deep link could land on a URL whose
    // bracket already matches SelectionService, but the editor still
    // needs to open because that's the URL's intent.
    let setsMatch = desired.size === current.size
    if (setsMatch) {
      for (const x of desired) {
        if (!current.has(x)) { setsMatch = false; break }
      }
    }

    if (!setsMatch) {
      this.#syncing = true
      try {
        selection.clear()
        for (const name of desired) selection.add(name)
      } finally {
        this.#syncing = false
      }
    }

    // Phase 2: auto-open the editor when a NEW URL arrives carrying a
    // path-bracket selection. The dashboard's links use this form, and
    // the user's intent on clicking such a link is "open this tile and
    // let me answer / read its notes." Hash-form selections (from tile
    // clicks) don't trigger this path — they don't have a bracket.
    if (urlChanged && hasBracket && desired.size > 0) {
      const first = [...desired][0]
      EffectBus.emit('tile:action', {
        action: 'edit',
        label: first,
        q: 0,
        r: 0,
        index: 0,
      })
    }
  }
}

const _selectionFromUrl = new SelectionFromUrlDrone()
window.ioc.register('@diamondcoreprocessor.com/SelectionFromUrlDrone', _selectionFromUrl)
