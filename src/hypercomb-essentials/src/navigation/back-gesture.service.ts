// navigation/back-gesture.service.ts
//
// THE HYPERCOMB WAY OF MOVING: left click goes IN, right click comes BACK OUT.
//
// On the hexagon canvas that has always been true (tile-overlay's
// right-button-down → `#navigateBack`). Everywhere else the browser's own
// context menu was still answering the right button — right-click a welcome
// page, a website page, a hierarchical panel, and you got "Reload / View page
// source" instead of the way out. A view is not a web page to the participant;
// it is a place they walked into, and the gesture that got them in has to have
// an opposite.
//
// This module is the ONE place that decides what the right button means, so
// the answer is the same on every surface:
//
//   1. A HOVERED SCOPE wins first — a surface that registered `within` and is
//      under the pointer. The innermost one wins, so a panel nested in a view
//      backs out of the panel, not the view.
//   2. Otherwise the TOP OPEN VIEW answers, read from ModeRegistry's
//      `view:active` owner stack (last owner in = top of the stack). This is
//      why a registration is keyed by the SAME owner string the view enters
//      the mode with: the entry is live exactly while the view is up, so it
//      can be registered once at heartbeat and never touched again.
//   3. Otherwise any registration whose own `active()` says it is holding the
//      surface (clipboard mode is the first — it covers the page without
//      being a view), most recent first.
//   4. Otherwise the LINEAGE comes back one step — the same TRUE BACK the
//      canvas does (`Navigation.back()` retraces pages actually visited, so a
//      root-hop into a collection returns to the page it was opened from, not
//      to the structural parent). This is what makes every hierarchical menu
//      work with no wiring at all: its rows walk the lineage in, so the
//      gesture walks the lineage out.
//
// TWO THINGS ARE LEFT TO THE BROWSER, deliberately: a right-click on an
// editable field, and a right-click on selected text. Those are the only
// context menus in the shell anyone actually wants — paste, copy, spellcheck —
// and neither is a navigation. Everything else in the hive belongs to the hive.
//
// It listens in the BUBBLE phase and stands down on `event.defaultPrevented`,
// which is what keeps it composable with the per-surface capture handlers that
// already exist (the canvas, tile-view, tree-view, slides, site-view, the game
// overlays): if one of them already claimed the gesture, this never runs. New
// surfaces should register here rather than binding their own listener.
//
// IoC key: @diamondcoreprocessor.com/BackGesture

/** One surface's answer to "come back out". */
export type BackGestureEntry = {
  /** Stable id. For a view, use the SAME string it passes to
   *  `ModeRegistry.enter('view:active', …)` — that is what makes the entry
   *  live only while the view is on screen. Re-registering an owner replaces
   *  its entry and moves it to the top of the stack. */
  owner: string
  /** Come back out. Called synchronously; the native menu is already gone. */
  back: () => void
  /** Optional element scope — the entry only answers while the pointer is
   *  inside it. Innermost match wins. */
  within?: () => Element | null | undefined
  /** Optional liveness for surfaces that are neither a view nor an element
   *  (a page-covering mode). Checked for every entry that declares it. */
  active?: () => boolean
}

type Ioc = { get<T>(key: string): T | undefined }
const ioc = <T>(key: string): T | undefined =>
  (globalThis as { ioc?: Ioc }).ioc?.get<T>(key)

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

/** Is the participant right-clicking something they can type in? Their menu,
 *  not ours. */
const isEditable = (target: Element | null): boolean => !!target?.closest?.(EDITABLE)

/** Is there live selected text under the pointer? Then the menu they want is
 *  Copy. A collapsed caret is not a selection. */
const hasSelectedText = (target: Element | null): boolean => {
  const selection = globalThis.getSelection?.()
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return false
  const anchor = selection.anchorNode
  const node = anchor?.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as Element | null)
  return !!node && !!target && (node.contains(target) || target.contains(node))
}

/** How deep in the document an element sits — used to pick the INNERMOST
 *  hovered scope when several nest. */
const depthOf = (el: Element): number => {
  let depth = 0
  for (let node: Element | null = el; node; node = node.parentElement) depth++
  return depth
}

export class BackGesture {
  /** Insertion-ordered: iterated in reverse when "most recent" is the rule. */
  #entries = new Map<string, BackGestureEntry>()

  constructor() {
    window.addEventListener('contextmenu', this.#onContextMenu)
  }

  /** Register a surface's way out. Returns the unregister. */
  register = (entry: BackGestureEntry): (() => void) => {
    this.#entries.delete(entry.owner)
    this.#entries.set(entry.owner, entry)
    return () => { if (this.#entries.get(entry.owner) === entry) this.#entries.delete(entry.owner) }
  }

  /** Owners currently registered, oldest first (introspection / debugging). */
  owners = (): readonly string[] => [...this.#entries.keys()]

  /** Stop answering the right button. The shell holds one of these forever;
   *  this exists so a test can stand an instance up and take it down again
   *  without a previous instance's listener claiming the next one's events. */
  dispose = (): void => {
    window.removeEventListener('contextmenu', this.#onContextMenu)
    this.#entries.clear()
  }

  /** Who would answer a right-click over `target` right now, and how. Split
   *  out from the handler so it can be reasoned about (and tested) without an
   *  event. `null` = nothing is registered for it; the lineage answers. */
  resolve = (target: Element | null): BackGestureEntry | null => {
    // 1. Innermost hovered scope.
    let hovered: BackGestureEntry | null = null
    let hoveredDepth = -1
    for (const entry of this.#entries.values()) {
      if (!entry.within) continue
      if (entry.active && !entry.active()) continue
      const el = entry.within()
      if (!el || !target || !el.contains(target)) continue
      const depth = depthOf(el)
      if (depth > hoveredDepth) { hovered = entry; hoveredDepth = depth }
    }
    if (hovered) return hovered

    // 2. Top of the open-view stack. Backing out of a view that is the
    //    ARRIVAL FACE of the place we stand on is a NAVIGATE, not a peel —
    //    the face belongs to the place, so the way out is the way back,
    //    and the destination's face opens per ITS mark (a navigate is a
    //    navigate; the view is a default or not). A view the participant
    //    opened themselves keeps its registered close-to-hexagons.
    const modes = ioc<{ ownersOf(mode: string): readonly string[] }>('@diamondcoreprocessor.com/ModeRegistry')
    const viewOwners = modes?.ownersOf('view:active') ?? []
    for (let i = viewOwners.length - 1; i >= 0; i--) {
      const entry = this.#entries.get(viewOwners[i])
      if (!entry || entry.within) continue
      if (entry.active && !entry.active()) continue
      return { ...entry, back: () => this.backOutOfView(entry.back) }
    }

    // 3. A page-covering mode that is not a view (clipboard), most recent first.
    for (const entry of [...this.#entries.values()].reverse()) {
      if (entry.within || !entry.active) continue
      if (entry.active()) return entry
    }
    return null
  }

  /** THE ONE RULE for backing out of a render view — every right-click
   *  path funnels here, whether it arrived through this registry or a
   *  view's own capture handler: an ARRIVAL FACE backs out by NAVIGATING
   *  (lineage back; at the root there is nowhere to go and the face
   *  holds — the × and Escape remain the way out there), a view the
   *  participant opened peels to hexagons via its own `peel`. */
  backOutOfView = (peel: () => void): void => {
    const viewBee = ioc<{ isArrivalSurface?(): boolean }>('@diamondcoreprocessor.com/ViewBee')
    if (viewBee?.isArrivalSurface?.()) this.#lineageBack()
    else peel()
  }

  /** The default answer: the hive comes back one step. Identical to the canvas
   *  gesture — history-true back, with the hive root as a floor. */
  #lineageBack = (): void => {
    const lineage = ioc<{ explorerSegments?(): readonly string[]; explorerUp?(): void }>('@hypercomb.social/Lineage')
    const segments = lineage?.explorerSegments?.() ?? []
    if (segments.length === 0) return   // nothing to come back from at the root
    const navigation = ioc<{ back?(): void }>('@hypercomb.social/Navigation')
    if (navigation?.back) navigation.back()
    else lineage?.explorerUp?.()
  }

  #onContextMenu = (event: MouseEvent): void => {
    // Someone closer to the surface already answered (a view's own capture
    // handler, the canvas, an InputGate claim). Never act twice.
    if (event.defaultPrevented) return
    // Ctrl / Cmd is the selection modifier here, never navigation.
    if (event.ctrlKey || event.metaKey) return
    const target = event.target instanceof Element ? event.target : null
    if (isEditable(target) || hasSelectedText(target)) return

    // The gesture belongs to the hive from here on, whatever it resolves to —
    // the browser menu never appears over the shell's own surfaces.
    event.preventDefault()
    const entry = this.resolve(target)
    if (entry) entry.back()
    else this.#lineageBack()
  }
}

const _backGesture = new BackGesture()
window.ioc.register('@diamondcoreprocessor.com/BackGesture', _backGesture)
