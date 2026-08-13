// hypercomb-shared/ui/docked-panel/hc-docked-panel.directive.ts
//
// hcDockedPanel — the shared "docked side panel" chrome: drag-to-resize +
// content-shrink, in ONE place so the docked toolwindows don't each hand-roll
// it. Stamp it on a left- or right-docked panel's root <aside>:
//
//   <aside class="files-panel" hcDockInset="right"
//          hcDockedPanel="files-viewer" dockSide="right"
//          [minWidth]="280" [maxWidth]="680" [defaultWidth]="340"> … </aside>
//
// It:
//   • injects a thin resize grip on the panel's INNER edge (opposite the dock
//     side) — drag it to resize; a steel hairline brightens on hover/drag,
//   • applies the width inline and PERSISTS it participant-local (localStorage,
//     keyed by the id) so the panel reopens at the size you left it,
//   • sets `--hc-panel-scale` on the host — the multiplier every panel's SCSS
//     sizes its body text off. It is DERIVED from the width (content shrinks as
//     the panel narrows, grows as it widens) only while the window's text size
//     is on AUTO; pick a size in the settings and the scale is PINNED there,
//     because text that swells just because you dragged a panel wider is text
//     you did not ask for. This is the only place the var is decided, so a
//     window that sizes itself does not get a second opinion. A
//     calc-multiplier, NOT `zoom`, to avoid softening glyphs under a panel's
//     backdrop-filter (documentation/zoomable-widgets.md),
//   • injects a SETTINGS gear into the panel's header — always visible, a hair
//     left of the close button — opening a small popover of per-window
//     settings. The first is the window's GROUP: a plain text field. Windows
//     whose group text MATCHES share attributes (the width and the text size);
//     a blank one is on its own. Nothing to create, name or delete — the text
//     is the whole model. The second is the TEXT SIZE itself, which is
//     therefore ONE setting per group: set it in any member and every member
//     takes it.
//
// A window that already sizes itself stamps it with `[ownsSize]="false"` and
// gets the settings half only — same gear, same group, its own size. That is
// how the notes strip joins a group without surrendering its edge handles.
// It still takes its place in the LANE: a window owning its width does not get
// to own its position, or two of them would sit on top of each other.
//
// It also puts the panel in its edge's LANE (dock-lanes.ts). An edge holds more
// than one window now — they stack inward from it in the order they were
// opened — and a window pushed out of a full lane is PARKED, not closed, so it
// keeps whatever it had staged. That is what makes gestures BETWEEN two tool
// windows possible at all (dragging a pheromone onto a note being the one that
// was already written on both ends and unreachable).
//
// Pairs with hcDockInset, whose ResizeObserver re-reports the reserved canvas
// inset as the width changes — so resizing keeps every on-screen tile beside
// the panel. Self-contained: the grip is built + styled imperatively (inline,
// bypassing view encapsulation) so no component needs a per-panel grip element
// in its template or SCSS. Shell UI — no essentials import.

import {
  Directive, ElementRef, EventEmitter, Input, Output, inject,
  type OnChanges, type OnDestroy, type OnInit, type SimpleChanges,
} from '@angular/core'
import { EffectBus } from '@hypercomb/core'

// The GROUP model — membership text and shared attributes — lives in
// panel-groups.ts. This file is the chrome that drives it.
import {
  type GroupAttrs, type GroupMember, STEEL, TEXT_SIZES,
  members, normalizeGroup, publishAttrs, readGroupAttrs, readMembership, writeMembership,
  readPairing, writePairing, readTextScale, writeTextScale,
} from './panel-groups'

// The LANE model — how many windows an edge holds and where each one sits.
// A side is no longer a single-window slot: it stacks inward from the edge,
// and a window pushed out of a full lane is PARKED, not closed. See
// dock-lanes.ts for why (a built-and-unreachable drag, and silent discard).
import {
  type LaneMember, type LaneSide,
  claimLane, laneHasRoom, layoutLane, releaseLane,
} from './dock-lanes'

// The session — how a window is put away while the hive is covered (the
// installer) and brought back on the way home. A docked window joins just by
// handing over its `park`/`unpark` pair; the directive only exists while the
// window is showing, so its own lifetime IS the "currently open" fact.
import { holdWindow, type WindowSession } from '../window-session'

const t = (key: string, fallback: string, params?: Record<string, unknown>): string => {
  const i18n = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@hypercomb.social/I18n') as
    { t(k: string, p?: Record<string, unknown>): string } | undefined
  return i18n?.t(key, params) ?? fallback
}

/** Every mounted docked panel — the chrome-side view of `members`, used to
 *  repaint gears and popovers when grouping changes anywhere. */
const live = new Set<HcDockedPanelDirective>()

/** A self-sizing window that holds its width in a SIGNAL rather than in the
 *  element's inline style. Such a window must be told, not written to — an
 *  inline width would be clobbered by the next change detection, and the
 *  window's own store would go on disagreeing with what is on screen. The
 *  component implements this and passes itself as `sizeOwner`. */
export interface PanelSizeOwner {
  /** Current width in px. */
  panelWidth(): number
  /** Take a width from the group — clamp and persist it as the window would
   *  for its own drag. */
  setPanelWidth(width: number): void
}

/** The gear's resting/hover colour. Bare glyph — no circle, no plate — standing
 *  ALWAYS, in every tool window's header, just left of its close button.
 *
 *  A real stylesheet, not inline style: `:hover` cannot be expressed inline, and
 *  the gear is created imperatively so a component's (emulated-encapsulation)
 *  SCSS never reaches it. The RESTING colour is per-window state (a grouped
 *  window's gear is steel, an ungrouped one dim), so the directive sets only the
 *  `--hc-gear` custom property inline and the sheet reads it — an inline
 *  `color` would outrank the `:hover` rule and kill the effect. It brightens on
 *  hover, while focused (keyboard reach) and while its popover is open.
 *
 *  It used to be hover-only. It is not any more: a control that is invisible
 *  until you happen to sweep the right band is a control nobody finds, and
 *  grouping is the one setting a window has. Dim-at-rest is the whole restraint
 *  — it sits below the close button's weight without disappearing. */
const GEAR_CSS = `
[data-hc-panel-settings] { color: var(--hc-gear, #6e8290); opacity: 1; pointer-events: auto; }
[data-hc-panel-settings]:hover,
[data-hc-panel-settings]:focus-visible,
[data-hc-panel-settings][aria-expanded='true'] { color: #cfe3ef; }
`

/** The slot reserved for the gear immediately before a header's close button:
 *  the 22px glyph plus a hair of air on each side, so it reads as its own
 *  control rather than a second glyph stuck to the close button. */
const GEAR_SLOT = 30

let gearCssInstalled = false

const installGearCss = (): void => {
  if (gearCssInstalled || typeof document === 'undefined') return
  gearCssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-panel-settings-css', '')
  style.textContent = GEAR_CSS
  document.head.appendChild(style)
}

@Directive({
  selector: '[hcDockedPanel]',
  standalone: true,
})
export class HcDockedPanelDirective implements OnInit, OnChanges, OnDestroy, GroupMember, LaneMember {

  /** Stable participant-local id → localStorage width key. */
  @Input('hcDockedPanel') id = ''
  /** Screen edge the panel docks against; the grip sits on the opposite edge. */
  @Input() dockSide: 'left' | 'right' = 'right'
  @Input() minWidth = 280
  @Input() maxWidth = 680
  @Input() defaultWidth = 360
  /** Content-scale clamp. Floor keeps text readable; ceiling stops a wide panel
   *  ballooning its content. Bounds the PICKED size too, so a panel with a
   *  tighter range is never asked for one it cannot render. */
  @Input() minScale = 0.82
  @Input() maxScale = 1.4
  /** Does this window's body size off `--hc-panel-scale`? True for every panel
   *  whose SCSS multiplies its root font by the var.
   *
   *  False for a window typeset in fixed rem/px (the notes strip), where the
   *  var reaches nothing — and there the text setting is left OUT of the gear
   *  entirely rather than offered as a control that does nothing. */
  @Input() scalesText = true
  /** Does this directive OWN the window's size? True for the panels that have
   *  no sizing of their own — it injects the grip, restores/persists the width
   *  and pins the panel beside the control bar.
   *
   *  False for a window that already sizes itself (the notes strip: its own
   *  edge handles, its own store, and a float mode this directive knows
   *  nothing about). Then the directive carries only the SETTINGS — the gear
   *  and the group — and touches the width solely to hand over what the group
   *  shares, leaving the window's own machinery to persist it. Without this a
   *  self-sizing window could not have a gear at all, and "all windows" would
   *  quietly mean "all windows except the one you write in". */
  @Input() ownsSize = true
  /** With `ownsSize` false: where the group's width is handed to, when the
   *  window keeps its width in a signal. Absent → the directive writes the
   *  element's inline width and leaves the window to persist it (the notes
   *  strip, which already observes its own box). */
  @Input() sizeOwner: PanelSizeOwner | null = null
  /** Optional controls-rail launcher owned by this window. When supplied, the
   *  common settings gear offers Add/Remove from controls and persists through
   *  the controls bar's participant-local preference map. */
  @Input() launcherControlId = ''
  /** A window this one brings up ALONGSIDE itself, because the two are halves
   *  of one gesture — the notes window and the pheromone panel being the pair
   *  that started this: a pheromone is dragged from one onto a row of the
   *  other, so opening notes with no pheromones in reach opens half a tool.
   *
   *  The id of the window to bring; `pairOpenEffect` is how to bring it. On by
   *  default, switched in this window's settings gear, and it only ever fills a
   *  FREE place in the lane — a convenience does not get to push out a window
   *  the participant opened themselves. Fires on open, so closing the pair
   *  leaves it closed. */
  @Input() pairWindow = ''
  /** The EffectBus name that opens `pairWindow`. Supplied rather than looked up
   *  because only the window itself knows what opening it means. */
  @Input() pairOpenEffect = ''
  /** The EffectBus name that closes `pairWindow`. Needed because a pairing that
   *  is CONDITIONAL (see `pairWhen`) has to be able to take the pair away again
   *  when the condition lapses — otherwise leaving the state that justified the
   *  pair strands it on screen. */
  @Input() pairCloseEffect = ''
  /** When the pairing applies. `null` (the default) = whenever this window is
   *  open. A window that is only half of the gesture in ONE of its modes binds
   *  its own condition here — the notes window pairs with the pheromone panel
   *  only while it is FULLSCREEN, because that is the mode whose desk yields
   *  room for a panel beside it. Flipping to false takes the pair away. */
  @Input() pairWhen: boolean | null = null
  /** Human name for the paired window in the settings switch. Falls back to the
   *  id, the way a group's membership line already labels its mates. */
  @Input() pairLabel = ''
  /** How this window is PUT AWAY and BROUGHT BACK when the hive is covered —
   *  entering the installer parks every showing window, leaving unparks them.
   *  Supplied by the window itself because only the window knows what "stop
   *  showing without forgetting" means for it (a `close()` usually also clears
   *  its content, which is exactly what a park must not do). Absent → the
   *  window simply doesn't take part. */
  @Input() hcSession: WindowSession | null = null
  /** Does this window take a place in its edge's LANE? True for a docked
   *  panel. Set false only while a surface is genuinely floating — a floating
   *  window positions itself, so it neither takes a place nor offsets anyone.
   *  Flipping it live is how the notes strip leaves and rejoins the rail. */
  @Input() set dockExclusive(value: boolean) {
    const next = value !== false
    if (next === this.#dockExclusive) return
    this.#dockExclusive = next
    if (!this.#initialized) return
    if (next) this.#scheduleLaneClaim()
    else { releaseLane(this); this.#clearLanePlacement() }
  }
  /** The owning component handles this through its normal close method, keeping
   * its signal, launcher state, and teardown path authoritative. */
  @Output() readonly hcDockedPanelClose = new EventEmitter<void>()

  readonly #el: HTMLElement = inject(ElementRef).nativeElement
  #grip: HTMLElement | null = null
  #line: HTMLElement | null = null
  #gearBtn: HTMLElement | null = null
  #popover: HTMLElement | null = null
  #group = ''
  /** The picked text scale, or `null` for auto (derive it from the width). */
  #text: number | null = null
  #width = 0
  #startX = 0
  #startWidth = 0
  #dragging = false
  #dockExclusive = true
  #initialized = false
  #claimQueued = false
  /** Distance from the docked edge, handed down by the lane. 0 = flush. */
  #laneOffset = 0
  /** Drops this window out of the "currently showing" set when it goes. */
  #releaseSession: (() => void) | null = null
  /** Only when `ownsSize` is false: watches the window's self-driven resize so
   *  its group mates track it, exactly as the grip does for owned panels. */
  #sizeWatch: ResizeObserver | null = null

  /** GroupMember — what this window contributes to, and takes from, its group. */
  get group(): string { return this.#group }
  /** The live width. A settings-only window may not have been measured yet when
   *  it joins a group, so ask its owner (or the element) rather than publishing
   *  0 and collapsing every mate. */
  attrs(): GroupAttrs {
    // `text: undefined` is deliberate, not an omission: publishing AUTO has to
    // clear a size the group was holding, and the key being present is how a
    // mate tells "the group says auto" from "the group has no opinion".
    const text = this.#text ?? undefined
    if (this.ownsSize) return { width: this.#width, text }
    return { width: this.sizeOwner?.panelWidth() || this.#width || this.#el.offsetWidth, text }
  }

  // ── LaneMember ─────────────────────────────────────────────────────
  /** Which edge this window takes a place on. */
  get laneSide(): LaneSide { return this.dockSide }

  /** What the next window inboard is offset by. Measured rather than trusted:
   *  a settings-only window may not have been sized yet when it joins, and
   *  publishing 0 would stack the two panels on top of each other. */
  laneWidth(): number {
    if (this.ownsSize) return this.#width || this.#el.offsetWidth
    return this.sizeOwner?.panelWidth() || this.#width || this.#el.offsetWidth
  }

  /** Sit this far in from the edge. Written as a `calc` over the controls-bar
   *  reservation rather than a resolved number, so a bar that docks, undocks
   *  or changes width keeps every window in the lane beside it with no
   *  re-layout — the same variable owned panels already lay out against. */
  placeInLane(offset: number): void {
    this.#laneOffset = Math.max(0, Math.round(offset))
    this.#position()
  }

  /** Pushed out of a full lane. PARK — the participant did not ask for this,
   *  so it must cost them nothing: the window stops showing and keeps its
   *  content, its scope, and anything it had staged. Only a window with no
   *  session of its own falls back to closing, which is the old behaviour and
   *  the only thing such a window can do. */
  evictFromLane(): void {
    if (!this.hcSession) { this.hcDockedPanelClose.emit(); return }
    try { this.hcSession.park() }
    catch (err) {
      console.error('[hc-docked-panel] park failed, closing instead:', err)
      this.hcDockedPanelClose.emit()
    }
  }

  ngOnInit(): void {
    live.add(this)
    members.add(this)
    this.#initialized = true
    // Showing, from now until this panel's element goes away.
    if (this.hcSession) this.#releaseSession = holdWindow(this.id, this.hcSession)
    // Take a place in this edge's lane. Deferred a microtask so the width set
    // below (or by the window's own first render) is what the lane measures.
    if (this.#dockExclusive) this.#scheduleLaneClaim()
    // Then bring the pair, if this window declares one. Queued AFTER the claim
    // (and separately from it, since a window that owns its own geometry takes
    // no place in the lane yet may still have a pair) so the room check sees
    // the lane this window is actually leaving behind.
    queueMicrotask(() => { if (live.has(this)) this.#openPairIfWanted() })
    this.#group = readMembership(this.id)
    // A grouped panel opens at its GROUP's width rather than its own remembered
    // one — that is what "shares attributes" has to mean for a window that
    // wasn't mounted when the group's width last changed.
    const groupAttrs = this.#group ? readGroupAttrs(this.#group) : {}
    const shared = groupAttrs.width
    // Same for the text size, except the window's own record already holds
    // whatever the group last handed it — so it opens at the right size with no
    // mate up, and the group's record only has to override a stale one.
    this.#text = ('text' in groupAttrs) ? (groupAttrs.text ?? null) : readTextScale(this.id)

    if (!this.ownsSize) {
      // Settings-only: the window keeps its own size and store. Take the
      // group's width if the group has one, then track what the window does
      // with its own edges so the mates follow. The scale is still ours to set
      // — a window sizing itself does not get to typeset itself as well, or a
      // group's text size would stop at its door.
      this.#installSettings()
      this.#applyScale()
      if (shared === undefined) { this.#watchSize(); return }
      // The window restores its OWN width as it first renders, so take the
      // group's over it a tick later — and stay unwatched until then, or that
      // restore would publish itself as the group's new width on the way past.
      // A timeout, not a frame: a window opened in a backgrounded tab must
      // still land on its group's width.
      setTimeout(() => {
        if (!live.has(this)) return          // closed before the tick
        this.adopt({ width: shared })
        this.#watchSize()
      })
      return
    }

    this.#width = (shared !== undefined) ? this.#clamp(shared) : this.#restoreWidth()
    this.#apply()
    this.#installGrip()
    this.#installSettings()
    // First member of an empty group defines its width.
    if (this.#group && shared === undefined) publishAttrs(this)
  }

  ngOnDestroy(): void {
    this.#initialized = false
    live.delete(this)
    members.delete(this)
    // Out of the lane — whoever is left slides outward to close the gap.
    releaseLane(this)
    // Closed, or parked — either way it is no longer showing. A parked window's
    // session lives on in the parked list, which is what brings it back.
    this.#releaseSession?.()
    this.#releaseSession = null
    this.#stopListeners()
    this.#closePopover()
    this.#sizeWatch?.disconnect()
    this.#sizeWatch = null
    this.#grip?.removeEventListener('pointerdown', this.#onDown)
    this.#gearBtn?.removeEventListener('click', this.#onGearClick)
  }

  /** Take a place in this edge's lane after the current Angular turn.
   *
   *  Deferred so sibling signal updates stay out of one another's initial
   *  change-detection pass, and so the width this window opens at is settled
   *  before the lane measures it — but still a microtask, so the placement
   *  lands before the browser paints and nothing is seen at the wrong offset.
   *
   *  Two surfaces becoming visible in the same turn now BOTH get a place
   *  (that is the point of a lane); only a third pushes the oldest out. */
  #scheduleLaneClaim(): void {
    if (this.#claimQueued) return
    this.#claimQueued = true
    queueMicrotask(() => {
      this.#claimQueued = false
      if (!this.#initialized || !this.#dockExclusive || !live.has(this)) return
      claimLane(this)
    })
  }

  /** Bring this window's declared pair up beside it.
   *
   *  Four guards, and each is a promise to the participant: only if the pair is
   *  switched ON, only while the condition that justifies it holds, only if it
   *  is not already up, and only into a place the lane actually has free — so a
   *  pairing fills an empty slot and never closes a window somebody opened on
   *  purpose. */
  #openPairIfWanted(): void {
    if (!this.pairWindow || !this.pairOpenEffect) return
    if (this.pairWhen === false) return
    if (!readPairing(this.id)) return
    for (const panel of live) if (panel.id === this.pairWindow) return
    if (!laneHasRoom(this.dockSide)) return
    EffectBus.emit(this.pairOpenEffect, undefined)
  }

  /** Take the pair away — the condition that justified it has lapsed. Only ever
   *  fired on that transition, so a pair the participant opened for their own
   *  reasons in some other mode is not swept up by it. */
  #closePair(): void {
    if (!this.pairWindow || !this.pairCloseEffect) return
    let up = false
    for (const panel of live) if (panel.id === this.pairWindow) up = true
    if (up) EffectBus.emit(this.pairCloseEffect, undefined)
  }

  /** React to the pairing CONDITION changing while the window is open: entering
   *  the mode brings the pair, leaving it takes the pair away. The window's
   *  mode is a signal on the component, so this arrives as an input change. */
  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['pairWhen']
    if (!change || change.firstChange || !this.#initialized) return
    if (change.currentValue === true) this.#openPairIfWanted()
    else if (change.previousValue === true) this.#closePair()
  }

  /** Re-measure the lane because THIS window's width changed — the window
   *  inboard of it has to move with its edge. Cheap and idempotent; safe to
   *  call from a drag's pointermove. */
  #relayoutLane(): void {
    if (this.#dockExclusive && this.#initialized) layoutLane(this.dockSide)
  }

  /** Hand the edge back to the window's own stylesheet. Called when it leaves
   *  the lane while still on screen (docked → floating): a lingering inline
   *  offset would displace a panel that is now positioning itself. */
  #clearLanePlacement(): void {
    this.#laneOffset = 0
    this.#el.style.removeProperty(this.dockSide)
    this.#el.style.removeProperty('--hc-lane-offset')
  }

  /** Self-sizing windows only: the window's own resize becomes the group's,
   *  exactly as the grip's drag does for a panel this directive sizes.
   *
   *  It reports the width the way it was GIVEN — the owner's number, or the
   *  element's border box when we wrote the inline style — never the observer's
   *  `contentRect`. A window whose measured box differs from its set width by
   *  so much as a border would otherwise publish that difference back, its
   *  mates would adopt it, measure their own, and the group would creep a
   *  couple of pixels wider on every hop. */
  #watchSize(): void {
    if (typeof ResizeObserver === 'undefined') return
    this.#sizeWatch = new ResizeObserver(() => {
      const w = this.sizeOwner ? this.sizeOwner.panelWidth() : this.#el.offsetWidth
      if (w <= 0 || w === this.#width) return
      this.#width = w
      // On auto, the window's own resize is what the text reads.
      this.#applyScale()
      // Whatever the window did to its own edges, the lane has to follow — the
      // window inboard of it sits at this width.
      this.#relayoutLane()
      // First measurement of an ungrouped window is just bookkeeping — there
      // is nobody to tell. A grouped one defines/updates the shared width.
      if (this.#group) publishAttrs(this)
    })
    this.#sizeWatch.observe(this.#el)
  }

  #key(): string { return `hc:docked-width:${this.id}` }

  #clamp(w: number): number {
    // Never wider than the room actually left for it, so the close button can't
    // be stranded off-screen — the viewport minus a gutter, minus whatever the
    // lane put between this window and its edge. Without the lane term the
    // inner window of a pair could be sized right off the far side.
    const vpMax = Math.max(this.minWidth, window.innerWidth - 24 - this.#laneOffset)
    return Math.round(Math.max(this.minWidth, Math.min(w, Math.min(this.maxWidth, vpMax))))
  }

  #restoreWidth(): number {
    try {
      const raw = localStorage.getItem(this.#key())
      const n = raw ? parseInt(raw, 10) : NaN
      if (Number.isFinite(n)) return this.#clamp(n)
    } catch { /* ignore */ }
    return this.#clamp(this.defaultWidth)
  }

  #apply(): void {
    this.#el.style.width = `${this.#width}px`
    this.#position()
    this.#applyScale()
  }

  /** THE decision about how big this window's text is, in one place.
   *
   *  Auto reads the width, which is the old behaviour and still the right
   *  default for a panel you drag between a strip and a reading column. A
   *  PICKED size ignores the width entirely — that is the whole point of
   *  picking one. Either way it lands on `--hc-panel-scale`, so no panel needs
   *  to know which of the two it is getting. */
  #applyScale(): void {
    const auto = this.#measuredWidth() / this.defaultWidth
    const scale = Math.min(this.maxScale, Math.max(this.minScale, this.#text ?? auto))
    this.#el.style.setProperty('--hc-panel-scale', String(scale))
  }

  /** The width the auto scale reads. A self-sizing window may not have been
   *  measured yet, so fall back through its owner and its box before the
   *  default — never 0, which would floor every panel on first paint. */
  #measuredWidth(): number {
    if (this.ownsSize) return this.#width || this.defaultWidth
    return this.sizeOwner?.panelWidth() || this.#width || this.#el.offsetWidth || this.defaultWidth
  }

  /** Where this window sits against its edge: beside the control bar, then in
   *  by whatever the lane gave it.
   *
   *  The bar is fixed to its edge and publishes what it occupies as
   *  `--hc-controls-<side>` (0 when it is free-floating, on the other edge, or
   *  on mobile), so a panel on the same edge starts just inboard of it. The
   *  lane offset is added on top — 0 for the window flush to the edge, the
   *  outer window's width for the one inboard of it.
   *
   *  Set inline because panels hardcode `right: 0` / `left: 0` in their own
   *  SCSS. Unlike the width, this applies to SELF-SIZING windows too: a window
   *  owning its width still does not get to own its place in the lane, or the
   *  two would overlap. */
  #position(): void {
    const side = this.dockSide
    this.#el.style[side] = `calc(var(--hc-controls-${side}, 0px) + ${this.#laneOffset}px)`
    this.#el.style.setProperty('--hc-lane-offset', `${this.#laneOffset}px`)
  }

  // ── grip ───────────────────────────────────────────────────────────
  #installGrip(): void {
    // Grip on the INNER edge: a right-docked panel resizes from its left edge,
    // a left-docked panel from its right edge.
    const inner = this.dockSide === 'right' ? 'left' : 'right'
    const grip = document.createElement('div')
    grip.setAttribute('data-hc-grip', '')
    grip.setAttribute('role', 'separator')
    grip.setAttribute('aria-orientation', 'vertical')
    Object.assign(grip.style, {
      position: 'absolute', top: '0', bottom: '0', [inner]: '0',
      width: '10px', cursor: 'ew-resize', zIndex: '6', touchAction: 'none',
    } as Partial<CSSStyleDeclaration>)

    const line = document.createElement('div')
    Object.assign(line.style, {
      position: 'absolute', top: '0', bottom: '0', [inner]: '0',
      width: '2px', background: `rgba(${STEEL}, 0)`, transition: 'background 0.12s ease',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>)
    grip.appendChild(line)

    grip.addEventListener('pointerenter', () => { if (!this.#dragging) this.#tintLine(0.6) })
    grip.addEventListener('pointerleave', () => { if (!this.#dragging) this.#tintLine(0) })
    grip.addEventListener('pointerdown', this.#onDown)

    this.#el.appendChild(grip)
    this.#grip = grip
    this.#line = line
  }

  #tintLine(alpha: number): void {
    if (this.#line) this.#line.style.background = `rgba(${STEEL}, ${alpha})`
  }

  // ── settings gear ──────────────────────────────────────────────────
  /** The settings affordance: a gear in the header band, immediately left of
   *  the close button — after the window's title and its own controls, never
   *  leading them. Close stays hard-right, where every window on the desktop
   *  keeps it; the directive's chrome tucks in beside it rather than pushing a
   *  panel's identity (icon + title) off the head of its own header, or
   *  displacing controls the window built itself.
   *
   *  It is pinned in a strip the directive RESERVES at the end of the header
   *  (see below) rather than dropped into the flex flow — a third flex child
   *  rearranges headers that distribute their own free space. Reserving the
   *  strip keeps it from overlapping anything, in this panel or any future one,
   *  with no per-panel styling: the old bottom-corner lock overlaid the
   *  feedback panel's Send button, and a shared directive must not inflict that
   *  on panels that know nothing about it. The header band is already a fixed
   *  shared height (_toolwindow.scss), so the gear lands at the same spot in
   *  every tool window. Panels whose root has no header get the gear pinned to
   *  the top corner opposite their close button instead.
   *
   *  Just the glyph — no circle, no plate — and it STANDS, always (see
   *  `GEAR_CSS`), a hair to the left of the close button. */
  #installSettings(): void {
    installGearCss()
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('data-hc-panel-settings', '')
    btn.setAttribute('aria-haspopup', 'dialog')
    btn.setAttribute('aria-expanded', 'false')
    Object.assign(btn.style, {
      width: '22px', height: '22px', padding: '0',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'transparent', border: 'none', borderRadius: '0',
      cursor: 'pointer', zIndex: '7', transition: 'color 0.12s ease',
    } as Partial<CSSStyleDeclaration>)

    const glyph = document.createElement('span')
    glyph.className = 'mat-sym'
    glyph.textContent = 'settings'
    glyph.style.fontSize = '15px'
    glyph.style.pointerEvents = 'none'
    btn.appendChild(glyph)
    btn.addEventListener('click', this.#onGearClick)

    // The header band, whichever element a window builds it from: most tool
    // windows use a real `<header>`, the notes strip a `.cv2-dragbar` div.
    // Both take the shared `tw.header` geometry, so the gear lands identically.
    const header = this.#el.querySelector(':scope > header, :scope > .cv2-dragbar') as HTMLElement | null
    if (header) {
      // Immediately LEFT of the close button, which stays hard-right where
      // every window on this desktop puts it.
      //
      // Out of the flex flow, which matters more than it looks: headers lay
      // their controls out in ways the directive cannot know, and several use
      // `justify-content: space-between`, where adding a child re-splits the
      // free space into one more gap and strands the close button mid-band. So
      // the gear takes no part in the flow — it is pinned, and its space is
      // reserved as a margin on the close button itself, which changes no
      // child count and moves the close button not at all (the margin only
      // eats free space the header was distributing anyway).
      //
      // The close button is the last thing every tool window's header renders,
      // so the last element child is the anchor. Its width is read once here;
      // the slot carries enough slack that a pixel of font drift is invisible.
      const style = getComputedStyle(header)
      if (style.position === 'static') header.style.position = 'relative'
      const pad = parseFloat(style.paddingRight) || 0
      const close = header.lastElementChild as HTMLElement | null
      let inset = pad
      if (close) {
        inset = pad + (close.offsetWidth || 22) + (GEAR_SLOT - 22) / 2
        close.style.marginLeft = `${GEAR_SLOT}px`
      }
      Object.assign(btn.style, {
        position: 'absolute', right: `${inset}px`, top: '50%', transform: 'translateY(-50%)',
      } as Partial<CSSStyleDeclaration>)
      header.appendChild(btn)
    } else {
      // No header to ride in: sit in the top corner on the panel's INNER edge,
      // which is the corner a close button never occupies.
      const inner = this.dockSide === 'right' ? 'left' : 'right'
      Object.assign(btn.style, { position: 'absolute', top: '10px', [inner]: '14px' } as Partial<CSSStyleDeclaration>)
      this.#el.appendChild(btn)
    }
    this.#gearBtn = btn
    this.#renderGearState()
  }

  #t(key: string, fallback: string, params?: Record<string, unknown>): string { return t(key, fallback, params) }

  /** Human label for this window in the group's membership line. The id is the
   *  only name the directive has — panels never tell it their title. */
  #label(): string {
    const base = this.id.replace(/-(viewer|panel|landing|strip)$/, '').replace(/-/g, ' ')
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : this.id
  }

  /** A grouped window's gear lights up, and says which group in its tooltip —
   *  so the header itself tells you the window travels with others, and the
   *  popover is only needed to CHANGE that. */
  #renderGearState(): void {
    const btn = this.#gearBtn
    if (!btn) return
    const group = this.#group
    // The RESTING colour only — as a custom property, so the sheet's `:hover`
    // rule still wins (an inline `color` would outrank it).
    btn.style.setProperty('--hc-gear', group ? `rgb(${STEEL})` : '#6e8290')
    btn.title = group
      ? this.#t('panel.settings.grouped', `Window settings — ${group}`, { group })
      : this.#t('panel.settings', 'Window settings')
  }

  #onGearClick = (event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    if (this.#popover) { this.#closePopover(); return }
    // One settings popover at a time across the whole docked column.
    for (const panel of live) panel.#closePopover()
    this.#openPopover()
  }

  // ── settings popover ───────────────────────────────────────────────
  #openPopover(): void {
    const pop = document.createElement('div')
    pop.setAttribute('data-hc-panel-settings-pop', '')
    pop.setAttribute('role', 'dialog')
    pop.setAttribute('aria-label', this.#t('panel.settings', 'Window settings'))
    const inner = this.dockSide === 'right' ? 'left' : 'right'
    Object.assign(pop.style, {
      position: 'absolute', top: '2.6rem', [inner]: '10px',
      width: 'min(248px, calc(100% - 20px))', boxSizing: 'border-box',
      padding: '0.6rem 0.7rem 0.7rem', zIndex: '9',
      background: 'rgba(12, 18, 24, 0.97)',
      border: `1px solid rgba(${STEEL}, 0.35)`, borderRadius: '6px',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
      font: '400 12px/1.45 system-ui, sans-serif', color: '#c8d6de',
    } as Partial<CSSStyleDeclaration>)
    pop.addEventListener('pointerdown', (e) => { e.stopPropagation() })

    pop.appendChild(this.#groupSection())
    if (this.scalesText) pop.appendChild(this.#textSection())
    if (this.pairWindow && this.pairOpenEffect) pop.appendChild(this.#pairSection())
    if (this.launcherControlId) pop.appendChild(this.#launcherSection())

    this.#el.appendChild(pop)
    this.#popover = pop
    this.#gearBtn?.setAttribute('aria-expanded', 'true')
    window.addEventListener('pointerdown', this.#onOutside, true)
    window.addEventListener('keydown', this.#onEscape, true)
  }

  #closePopover(): void {
    if (!this.#popover) return
    this.#popover.remove()
    this.#popover = null
    this.#gearBtn?.setAttribute('aria-expanded', 'false')
    window.removeEventListener('pointerdown', this.#onOutside, true)
    window.removeEventListener('keydown', this.#onEscape, true)
  }

  #onOutside = (event: PointerEvent): void => {
    const target = event.target as Node | null
    if (target && (this.#popover?.contains(target) || this.#gearBtn?.contains(target))) return
    this.#closePopover()
  }

  #onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.#popover) return
    event.stopPropagation()
    this.#closePopover()
    this.#gearBtn?.focus()
  }

  /** The GROUP setting: one text field. Type the same word in another window
   *  and the two travel together. Committed on Enter/blur (`change`) rather
   *  than per keystroke, so typing "team" doesn't briefly join "t". */
  #groupSection(): HTMLElement {
    const section = document.createElement('div')
    section.setAttribute('data-hc-setting', 'group')

    const label = document.createElement('div')
    label.textContent = this.#t('panel.group.label', 'Tool window group')
    Object.assign(label.style, {
      fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase',
      color: '#7f95a3', marginBottom: '0.45rem',
    } as Partial<CSSStyleDeclaration>)
    section.appendChild(label)

    const input = document.createElement('input')
    input.type = 'text'
    input.value = this.#group
    input.placeholder = this.#t('panel.group.placeholder', 'e.g. left rail')
    input.setAttribute('aria-label', this.#t('panel.group.label', 'Tool window group'))
    Object.assign(input.style, {
      width: '100%', boxSizing: 'border-box', height: '24px', padding: '0 0.4rem',
      font: 'inherit', color: '#c8d6de', background: 'rgba(255, 255, 255, 0.04)',
      border: `1px solid rgba(${STEEL}, 0.25)`, borderRadius: '4px',
    } as Partial<CSSStyleDeclaration>)
    input.addEventListener('change', () => { this.#setGroup(normalizeGroup(input.value)) })
    input.addEventListener('keydown', (e) => { e.stopPropagation() })
    section.appendChild(input)

    const hint = document.createElement('div')
    const mates = [...live].filter(p => p !== this && p.#group !== '' && p.#group === this.#group)
    const names = mates.map(p => p.#label()).join(', ')
    hint.textContent = !this.#group
      ? this.#t('panel.group.hint', 'Windows sharing this text share their width.')
      : mates.length
        ? this.#t('panel.group.shared', `Shared with ${names}`, { panels: names })
        : this.#t('panel.group.alone', 'No other open window is in this group yet.')
    Object.assign(hint.style, { marginTop: '0.5rem', fontSize: '11px', color: '#7f95a3' } as Partial<CSSStyleDeclaration>)
    section.appendChild(hint)

    return section
  }

  /** The TEXT SIZE setting: a short ladder of buttons, Auto first.
   *
   *  It sits directly under the group field because it IS a group setting when
   *  the window has a group — one size for the whole group, set from any member
   *  — and the window's own only when it has none. A ladder rather than a
   *  number: the participant is choosing how comfortable the reading is, not
   *  authoring a stylesheet.
   *
   *  AUTO is the old behaviour kept as a choice, not a default nobody can
   *  leave: the content scales with the window's width. Every other choice
   *  pins it, which is the complaint this section answers — a panel dragged
   *  wider to fit a long line should not also grow its type. */
  #textSection(): HTMLElement {
    const section = document.createElement('div')
    section.setAttribute('data-hc-setting', 'text')
    Object.assign(section.style, {
      marginTop: '0.7rem', paddingTop: '0.65rem',
      borderTop: `1px solid rgba(${STEEL}, 0.18)`,
    } as Partial<CSSStyleDeclaration>)

    const label = document.createElement('div')
    label.textContent = this.#t('panel.text.label', 'Text size')
    Object.assign(label.style, {
      fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase',
      color: '#7f95a3', marginBottom: '0.45rem',
    } as Partial<CSSStyleDeclaration>)
    section.appendChild(label)

    const row = document.createElement('div')
    Object.assign(row.style, { display: 'flex', flexWrap: 'wrap', gap: '0.3rem' } as Partial<CSSStyleDeclaration>)
    for (const size of TEXT_SIZES) {
      const btn = document.createElement('button')
      btn.type = 'button'
      const on = size.scale === this.#text
      btn.textContent = this.#t(`panel.text.${size.key}`, size.label)
      btn.setAttribute('aria-pressed', on ? 'true' : 'false')
      Object.assign(btn.style, {
        flex: '1 1 auto', minHeight: '24px', padding: '0.2rem 0.45rem',
        font: 'inherit', fontSize: '11px', cursor: 'pointer',
        color: on ? '#dcecf5' : '#c8d6de',
        background: on ? `rgba(${STEEL}, 0.22)` : 'rgba(255, 255, 255, 0.04)',
        border: `1px solid rgba(${STEEL}, ${on ? 0.55 : 0.25})`, borderRadius: '4px',
      } as Partial<CSSStyleDeclaration>)
      btn.addEventListener('click', () => { this.#setText(size.scale) })
      row.appendChild(btn)
    }
    section.appendChild(row)

    const hint = document.createElement('div')
    hint.textContent = this.#group
      ? this.#t('panel.text.hint.group', `One size for every window in ${this.#group}.`, { group: this.#group })
      : this.#t('panel.text.hint', 'Auto sizes the text with the window\'s width. A size holds it steady.')
    Object.assign(hint.style, { marginTop: '0.5rem', fontSize: '11px', color: '#7f95a3' } as Partial<CSSStyleDeclaration>)
    section.appendChild(hint)

    return section
  }

  /** Pick a text size (or `null` for auto). Kept on the window itself so it
   *  reopens at it, and published to the group so the group's other windows
   *  take it too — the setting reads as one per group because it is. */
  #setText(next: number | null): void {
    if (next === this.#text) return
    this.#text = next
    writeTextScale(this.id, next)
    this.#applyScale()
    if (this.#group) publishAttrs(this)
    this.#refreshPopover()
  }

  /** The PAIR setting: one switch, for the window that declares a pair.
   *
   *  Phrased as what it does rather than as a feature name — "Open Pheromones
   *  alongside" — because the participant is being asked about a habit, not
   *  about a mechanism. Switching it ON also brings the pair up right now if
   *  there is room: a setting that only takes effect next time is a setting you
   *  cannot tell you have changed. */
  #pairSection(): HTMLElement {
    const section = document.createElement('div')
    section.setAttribute('data-hc-setting', 'pair')
    Object.assign(section.style, {
      marginTop: '0.7rem', paddingTop: '0.65rem',
      borderTop: `1px solid rgba(${STEEL}, 0.18)`,
    } as Partial<CSSStyleDeclaration>)

    const name = this.pairLabel || this.pairWindow.replace(/-(viewer|panel|strip)$/, '').replace(/-/g, ' ')
    const row = document.createElement('label')
    Object.assign(row.style, {
      display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer',
    } as Partial<CSSStyleDeclaration>)

    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = readPairing(this.id)
    Object.assign(box.style, { margin: '0', accentColor: `rgb(${STEEL})`, cursor: 'pointer' } as Partial<CSSStyleDeclaration>)
    box.addEventListener('change', () => {
      writePairing(this.id, box.checked)
      if (box.checked) this.#openPairIfWanted()
    })

    const text = document.createElement('span')
    text.textContent = this.#t('panel.pair.open-alongside', `Open ${name} alongside`, { window: name })
    row.appendChild(box)
    row.appendChild(text)
    section.appendChild(row)

    const hint = document.createElement('div')
    hint.textContent = this.#t('panel.pair.hint', 'They are two halves of one gesture — a mark is dragged from one onto the other.')
    Object.assign(hint.style, { marginTop: '0.45rem', fontSize: '11px', color: '#7f95a3' } as Partial<CSSStyleDeclaration>)
    section.appendChild(hint)

    return section
  }

  /** Optional launcher setting. UI placement is window chrome, so every
   *  slash-first tool window gets the same participant-configurable path. */
  #launcherSection(): HTMLElement {
    const section = document.createElement('div')
    section.setAttribute('data-hc-setting', 'launcher')
    Object.assign(section.style, {
      marginTop: '0.7rem', paddingTop: '0.65rem',
      borderTop: `1px solid rgba(${STEEL}, 0.18)`,
    } as Partial<CSSStyleDeclaration>)

    const label = document.createElement('div')
    label.textContent = this.#t('panel.launcher.label', 'Controls shortcut')
    Object.assign(label.style, {
      fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase',
      color: '#7f95a3', marginBottom: '0.4rem',
    } as Partial<CSSStyleDeclaration>)
    section.appendChild(label)

    const button = document.createElement('button')
    button.type = 'button'
    const enabled = this.#launcherEnabled()
    button.textContent = enabled
      ? this.#t('panel.launcher.remove', 'Remove from controls')
      : this.#t('panel.launcher.add', 'Add to controls')
    Object.assign(button.style, {
      width: '100%', minHeight: '28px', padding: '0.25rem 0.5rem',
      font: 'inherit', color: '#c8d6de', cursor: 'pointer',
      background: enabled ? `rgba(${STEEL}, 0.16)` : 'rgba(255, 255, 255, 0.04)',
      border: `1px solid rgba(${STEEL}, 0.3)`, borderRadius: '4px',
    } as Partial<CSSStyleDeclaration>)
    button.addEventListener('click', () => {
      EffectBus.emit('controls:configure', {
        id: this.launcherControlId,
        enabled: !this.#launcherEnabled(),
      })
      this.#refreshPopover()
    })
    section.appendChild(button)
    return section
  }

  #launcherEnabled(): boolean {
    if (!this.launcherControlId) return false
    try {
      const map = JSON.parse(localStorage.getItem('hc:controls-enabled-map') ?? '{}') as Record<string, boolean>
      return map[this.launcherControlId] === true
    } catch { return false }
  }

  /** Repaint an open popover's group section — membership lines in OTHER
   *  windows' popovers go stale the moment this one changes slot. */
  #refreshPopover(): void {
    const pop = this.#popover
    if (!pop) return
    const old = pop.querySelector('[data-hc-setting="group"]')
    if (old) pop.replaceChild(this.#groupSection(), old)
    const text = pop.querySelector('[data-hc-setting="text"]')
    if (text) pop.replaceChild(this.#textSection(), text)
    const pair = pop.querySelector('[data-hc-setting="pair"]')
    if (pair) pop.replaceChild(this.#pairSection(), pair)
    const launcher = pop.querySelector('[data-hc-setting="launcher"]')
    if (launcher) pop.replaceChild(this.#launcherSection(), launcher)
  }

  // ── group membership ───────────────────────────────────────────────
  /** Join a group (or leave, with `''`). Text that a group already stands for
   *  hands this window its attributes; text nobody has used yet is DEFINED from
   *  this window. Attributes the group has no opinion on are left alone —
   *  joining for the width must not silently retypeset the window. */
  #setGroup(next: string): void {
    if (next === this.#group) return
    this.#group = next
    writeMembership(this.id, next)

    if (next) {
      const attrs = readGroupAttrs(next)
      if (Object.keys(attrs).length) this.adopt(attrs)
      else publishAttrs(this)
    }
    for (const panel of live) { panel.#renderGearState(); panel.#refreshPopover() }
  }

  /** GroupMember — take the group's shared attributes, each clamped to THIS
   *  window's own limits, so a panel that cannot go that wide sits at its limit
   *  rather than breaking layout. */
  adopt(attrs: GroupAttrs): void {
    // The KEY, not the value: a group that says auto still says something, and
    // it has to be able to take a pinned size back off its members.
    if ('text' in attrs) {
      const text = attrs.text ?? null
      if (text !== this.#text) {
        this.#text = text
        writeTextScale(this.id, text)
        this.#applyScale()
        this.#refreshPopover()
      }
    }
    if (attrs.width === undefined) return
    const next = this.#clamp(attrs.width)
    if (next === this.#width) return
    this.#width = next
    if (!this.ownsSize) {
      // Hand the width over and let the window's own machinery persist it —
      // writing our key too would leave two stores disagreeing about one
      // window. Then record what the window ACTUALLY became, so the resize we
      // just caused arrives at `#watchSize` as a width it already knows and is
      // not republished. (A flag cleared on a timer would not do: in a
      // backgrounded tab the timer never runs and the window stops sharing.)
      if (this.sizeOwner) {
        this.sizeOwner.setPanelWidth(next)
        this.#width = this.sizeOwner.panelWidth()
      } else {
        this.#el.style.width = `${next}px`
        this.#width = this.#el.offsetWidth || next
      }
      this.#relayoutLane()
      return
    }
    this.#apply()
    this.#relayoutLane()
    try { localStorage.setItem(this.#key(), String(next)) } catch { /* ignore */ }
  }

  #onDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    this.#dragging = true
    this.#startX = event.clientX
    this.#startWidth = this.#width
    this.#tintLine(0.85)
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch { /* best effort */ }
    window.addEventListener('pointermove', this.#onMove)
    window.addEventListener('pointerup', this.#onUp)
    window.addEventListener('pointercancel', this.#onUp)
  }

  #onMove = (event: PointerEvent): void => {
    if (!this.#dragging) return
    // Right-docked: dragging the left grip LEFT (clientX↓) widens. Left-docked:
    // dragging the right grip RIGHT widens. Mirror the delta accordingly.
    const dx = this.dockSide === 'right' ? (this.#startX - event.clientX) : (event.clientX - this.#startX)
    this.#width = this.#clamp(this.#startWidth + dx)
    this.#apply()
    // The window inboard rides this edge live, so the pair reads as one lane
    // being resized rather than two panels drifting apart.
    this.#relayoutLane()
    // Grouped: the other members track this drag live, so the grouping is
    // visible as you pull rather than snapping only on release.
    publishAttrs(this)
  }

  #onUp = (): void => {
    if (!this.#dragging) return
    this.#dragging = false
    this.#stopListeners()
    this.#tintLine(0)
    try { localStorage.setItem(this.#key(), String(this.#width)) } catch { /* ignore */ }
    publishAttrs(this)
  }

  #stopListeners(): void {
    window.removeEventListener('pointermove', this.#onMove)
    window.removeEventListener('pointerup', this.#onUp)
    window.removeEventListener('pointercancel', this.#onUp)
  }
}
