// hypercomb-shared/ui/controls-bar/controls-bar.component.ts
// Floating contextual controls pill — minimal by default, mode-adaptive.

import {
  Component,
  computed,
  effect,
  ElementRef,
  EventEmitter,
  inject,
  input,
  Output,
  signal,
  type AfterViewInit,
  type OnInit,
  type OnDestroy,
} from '@angular/core'
import { fromRuntime } from '../../core/from-runtime'
import { TranslatePipe } from '../../core/i18n.pipe'
import type { Navigation } from '../../core/navigation'
import type { MovementService } from '../../core/movement.service'
import { EffectBus, consumePointerGesture } from '@hypercomb/core'
import { iconOverrides } from '../../core/icon-override.store'
import { iconEditMode, LONG_PRESS_MS } from '../../core/icon-edit.service'
import type { RoomStore } from '../../core/room-store'
import type { SecretStore } from '../../core/secret-store'
import type { InstallMonitor } from '../../core/install-monitor'
import { VoiceInputService } from '../../core/voice-input.service'
import { secretTag } from './secret-words'

const PILL_POS_KEY = 'hc:controls-pill-pos'
const ENABLED_MAP_KEY = 'hc:controls-enabled-map'
/** Page keys (lineage paths) whose viewport is pinned. The pin is per LAYER. */
const PINNED_PAGES_KEY = 'hc:pinned-pages'

/** Owner token for the InputGate lock a pinned layer holds. */
const PIN_OWNER = 'pin'

/** Controls that move the viewport. Hidden while the current layer is pinned —
 *  a frozen page offers no way to drag or zoom, not even a disabled one. The
 *  pin button itself is never in this set, so the pin is always releasable. */
const VIEWPORT_CONTROLS: ReadonlySet<string> = new Set(['fit', 'zoom-in', 'zoom-out'])

/** How long the pin button pulses after a pan/zoom attempt on a pinned view. */
const LOCK_BUMP_MS = 900

/** Pointer travel that turns a press on the rail from a click into a scroll.
 *  Past this the gesture belongs to the list and the icon under the pointer
 *  must not fire on release. */
const DRAG_SLOP_PX = 5

// ── control registry ──────────────────────────────────────
//
// Each control has an id, a localization key for its label, the action
// name dispatched on click, and a visibility predicate. Icons are
// resolved by id via iconSymbol() (returns a Material Symbols Outlined
// glyph name). No per-control icon field — the icon mapping is owned
// by the component, not the registry.

interface ControlItem {
  id: string
  label: string
  action: string
  visibleWhen: 'always' | 'clipboardHasItems' | 'voiceSupported' | 'public' | 'hasSelection'
}

const CONTROL_REGISTRY: readonly ControlItem[] = [
  { id: 'back',         label: 'controls.back',         action: 'goBack',             visibleWhen: 'always' },
  { id: 'dcp',          label: 'controls.dcp',          action: 'openDcp',            visibleWhen: 'always' },
  { id: 'fit',          label: 'controls.fit-content',  action: 'fitOrCenter',        visibleWhen: 'always' },
  { id: 'zoom-out',     label: 'controls.zoom-out',     action: 'zoomOut',            visibleWhen: 'always' },
  { id: 'zoom-in',      label: 'controls.zoom-in',      action: 'zoomIn',             visibleWhen: 'always' },
  { id: 'pin',          label: 'controls.pin',          action: 'togglePin',          visibleWhen: 'always' },
  { id: 'fullscreen',   label: 'controls.fullscreen',   action: 'toggleFullscreen',   visibleWhen: 'always' },
  // 'show-hidden' (the eye) is off the bar — hiding and revealing is a tile
  // verb, reached from the tile's own icons; the shell only restores the
  // persisted `hc:show-hidden` state at boot (see the initial emit below).
  // 'world-mode' (the world-view share toggle) moved to the header's
  // mesh-header — it now lives beside the solo/swarm icon and only shows in
  // swarm mode (see MeshHeaderComponent).
  { id: 'text-only',    label: 'controls.text-only',    action: 'toggleTextOnly',     visibleWhen: 'always' },
  // 'notes' moved to the command-line header (the post-it toggle at the right
  // of the input) — notes ride along with every page, so their switch lives in
  // the top chrome now, not here.
  // Pools of Meaning — the reference feature's portal (one-state, like DCP):
  // navigates to the `sets/` layer, where each tile is a reference set (see
  // documentation/entrances-and-sets.md). Lives HERE on the control bar, not
  // among the header aggregates — it manages referenced hives on different
  // roots; it is not a launch group.
  { id: 'pools',        label: 'collections-landing.title', action: 'openPools',        visibleWhen: 'always' },
  { id: 'sequences',    label: 'sequence.library',          action: 'openSequences',    visibleWhen: 'always' },
  // Selection verbs — the floating vertical selection menu is retired
  // (documentation/selection-tool-windows.md); one-shot verbs live here on the
  // registry (user-toggleable like every control) while windowed responses
  // live in each behavior's own tool window. Same `controls:action` bus either
  // way, so the essentials drones that answer are unchanged.
  //
  // cut / copy / remove / move are NOT on the bar — they are tile verbs and
  // ride the tile's own hover icons, the edit-actions strip and the keyboard.
  // The `controls:action` emitters below stay: those surfaces use them.
  { id: 'promote-to-parent', label: 'selection.promote-to-parent', action: 'promoteToParent', visibleWhen: 'hasSelection' },
  // World-mode bulk privacy (make-public / make-branch-public) is off the bar
  // too — privacy is set on the tile, not from the shell rail. The header's
  // world-mode toggle is untouched.
  // The clipboard icon is the way back into the side panel once it's been
  // closed — it appears whenever the clipboard holds something and toggles the
  // panel. (Auto-open on copy/cut alone left no way to reopen.)
  { id: 'clipboard',    label: 'controls.clipboard',    action: 'toggleClipboard',    visibleWhen: 'clipboardHasItems' },
  { id: 'voice',        label: 'controls.voice',        action: 'toggleVoice',        visibleWhen: 'voiceSupported' },
  // 'room' (the location icon) is gone from the bar — the location dialog now
  // pops as the JOIN step when the participant flips solo → public (see
  // toggleMeshPublic below): configure where, press start, you're in the swarm.
  { id: 'bees',         label: 'controls.toggle-bees',  action: 'toggleBees',         visibleWhen: 'public' },
  // 'feedback' is gone from the bar — the command-line header's feedback
  // toggle opens the combined panel (inbox list + share form) now.
]

// First-time defaults: items the previous primary-row had on stay enabled,
// items the previous expand-row had become muted (grayed). Once a user toggles
// anything in edit mode the persisted map takes over.
const DEFAULT_ENABLED_MAP: Record<string, boolean> = {
  'back': true, 'dcp': true, 'fit': true, 'zoom-out': true, 'zoom-in': true, 'pin': true, 'fullscreen': true,
  'text-only': false,
  'pools': true,
  'sequences': false,
  // Selection verbs default ON (they only appear while a selection exists;
  // the retired floating menu was the old primary path).
  'promote-to-parent': true,
  'clipboard': true, 'voice': false, 'bees': false,
}

@Component({
  selector: 'hc-controls-bar',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './controls-bar.component.html',
  styleUrls: ['./controls-bar.component.scss'],
})
export class ControlsBarComponent implements OnInit, AfterViewInit, OnDestroy {

  #host = inject(ElementRef<HTMLElement>)

  // ── inputs ────────────────────────────────────────────────

  readonly meshPublic = input<boolean | null>(false)
  @Output() meshToggled = new EventEmitter<void>()

  // ── IoC resolution ──────────────────────────────────────

  private get navigation(): Navigation {
    return get('@hypercomb.social/Navigation') as Navigation
  }
  private get movement(): MovementService {
    return get('@hypercomb.social/MovementService') as MovementService
  }
  private get zoom(): any {
    return get('@diamondcoreprocessor.com/ZoomDrone')
  }
  private get pixiHost(): any {
    return get('@diamondcoreprocessor.com/PixiHostWorker')
  }
  private get roomStore(): RoomStore | undefined {
    return get('@hypercomb.social/RoomStore') as RoomStore | undefined
  }
  private get secretStore(): SecretStore | undefined {
    return get('@hypercomb.social/SecretStore') as SecretStore | undefined
  }
  private get gate(): any {
    return get('@diamondcoreprocessor.com/InputGate')
  }

  // ── reactive state ──────────────────────────────────────

  #moved$ = fromRuntime(
    get('@hypercomb.social/MovementService') as EventTarget,
    () => this.movement.moved,
  )
  /** Bumped when a title lands or the locale changes, so the breadcrumb
   *  re-resolves. The index it reads is a plain Map, not reactive. */
  #titleTick = signal(0)
  #titleTickUnsub: (() => void) | null = null
  #localeTickUnsub: (() => void) | null = null
  #room$ = fromRuntime(
    get('@hypercomb.social/RoomStore') as EventTarget,
    () => this.roomStore?.value ?? '',
  )
  #secret$ = fromRuntime(
    get('@hypercomb.social/SecretStore') as EventTarget,
    () => this.secretStore?.value ?? '',
  )
  #locale$ = fromRuntime(
    get('@hypercomb.social/I18n') as EventTarget | undefined,
    () => (get('@hypercomb.social/I18n') as { locale?: string } | undefined)?.locale ?? 'en',
  )

  // ── background sync indicator ──
  private get installMonitor(): InstallMonitor | undefined {
    return get('@hypercomb.social/InstallMonitor') as InstallMonitor | undefined
  }
  readonly installState = fromRuntime(
    get('@hypercomb.social/InstallMonitor') as EventTarget,
    () => this.installMonitor?.state ?? 'idle',
  )
  readonly installChangedFiles = fromRuntime(
    get('@hypercomb.social/InstallMonitor') as EventTarget,
    () => this.installMonitor?.changedFiles ?? 0,
  )

  #idle = signal(false)
  #hovered = signal(false)
  // Derive lock state from the gate itself rather than maintaining a local
  // copy. The gate is shared with the editor (which lock/unlocks across
  // open/close), so a local signal would silently desync — leaving the
  // visual button stuck in the wrong state and making toggle clicks behave
  // inversely after the editor cycles.
  #locked = fromRuntime(
    get('@diamondcoreprocessor.com/InputGate') as EventTarget | undefined,
    () => (get('@diamondcoreprocessor.com/InputGate') as { locked?: boolean } | undefined)?.locked ?? false,
  )

  // ── locked-attempt pulse on the pin button ─────────────
  //
  // When a pan or zoom gesture is rejected because input is locked, the
  // InputGate emits `input:locked-attempt` (throttled). We pulse the pin
  // button to tell the user *why* the viewport didn't move — most often
  // because they pinned it themselves with this very button. Covers both
  // pan (touch/spacebar via gate.claim()) and zoom (wheel/pinch).
  readonly #lockBump = signal(false)
  readonly lockBump = this.#lockBump.asReadonly()
  #lockBumpTimer: ReturnType<typeof setTimeout> | null = null

  #flashLockBump = (): void => {
    // Un-idle the pill so the pulse is actually on screen.
    this.#onActivity()
    this.#lockBump.set(true)
    if (this.#lockBumpTimer) clearTimeout(this.#lockBumpTimer)
    this.#lockBumpTimer = setTimeout(() => {
      this.#lockBump.set(false)
      this.#lockBumpTimer = null
    }, LOCK_BUMP_MS)
  }

  // ── power key state (ctrl / shift / alt held) ──────────
  readonly powerKey = signal<'ctrl' | 'shift' | 'alt' | null>(null)

  /** True when viewport is phone-shaped (small in either dimension). */
  readonly isMobile = signal(false)
  /** True when device is in landscape orientation AND mobile-sized. */
  readonly isLandscape = signal(false)
  /** Whether the command-line input is currently revealed on mobile. */
  readonly inputVisible = signal(false)
  /** True while the document is in fullscreen. The mobile bar's fullscreen
   *  button reads it to flip its glyph — a toggle that always shows the same
   *  icon can't say which way it will go. */
  readonly isFullscreen = signal(false)
  /** The legibility ladder: how many lanes of hexagons the phone is reading
   *  at (3 scan · 2 browse · 1 read), and whether lane mode owns the
   *  viewport at all. Published by SequenceCycleDrone on `lanes:changed`. */
  readonly laneCount = signal(3)
  readonly lanesActive = signal(false)
  /** The five-icon view row above the bar (right of the rail in landscape). */
  readonly viewRowOpen = signal(false)
  /** How far anything floating above the bar must lift to clear the view row.
   *  Published as a CSS variable so body-appended chrome (the select pill)
   *  moves with it without a second event contract. */
  #setViewRowLift = (open: boolean): void => {
    document.documentElement.style.setProperty('--hc-mobile-row-lift', open ? '4.6rem' : '0px')
  }
  #viewRowAway = (event: Event): void => {
    if (!this.viewRowOpen()) return
    const target = event.target as HTMLElement | null
    // The row itself and the button that opened it own their own taps.
    if (target?.closest?.('.mobile-view-row, .view-row-btn')) return
    this.closeViewRow()
  }
  readonly toggleViewRow = (event?: Event): void => {
    event?.stopPropagation?.()
    const next = !this.viewRowOpen()
    this.viewRowOpen.set(next)
    this.#setViewRowLift(next)
    EffectBus.emit('mobile:view-row', { open: next })
  }
  readonly closeViewRow = (): void => {
    if (!this.viewRowOpen()) return
    this.viewRowOpen.set(false)
    this.#setViewRowLift(false)
    EffectBus.emit('mobile:view-row', { open: false })
  }
  /** Rotate the grid: point-top ⇄ flat-top. In lane mode the lanes own the
   *  orientation (they turn with the device), so this is the manual override
   *  for the free viewport. */
  readonly rotateHexes = (): void => {
    EffectBus.emit('keymap:invoke', { cmd: 'render.toggleOrientation' })
  }
  /** Walk the ordinary arrangements (Rectangle, Flowers, saved sets) — the
   *  same `a` cycle the desktop has, which touch could not reach. */
  readonly cycleArrangement = (): void => {
    EffectBus.emit('keymap:invoke', { cmd: 'sequence.cycle' })
  }
  #fullscreenHandler = (): void => { this.isFullscreen.set(!!document.fullscreenElement) }
  #mobileQuery: MediaQueryList | null = null
  #landscapeQuery: MediaQueryList | null = null
  #mobileHandler = (e: MediaQueryListEvent) => {
    this.isMobile.set(e.matches)
    this.isLandscape.set((this.#landscapeQuery?.matches ?? false) && e.matches)
    this.#syncInputVisibility()
  }
  #landscapeHandler = (e: MediaQueryListEvent) => {
    this.isLandscape.set(e.matches && this.isMobile())
    this.#syncInputVisibility()
  }
  #syncInputVisibility = (): void => {
    // Desktop AND portrait phones always show the command line — portrait
    // pins it as the top prompt surface. Only landscape phones collapse
    // it; the sidebar's keyboard button reveals it on demand.
    // `focus: false` — a sync must never steal focus or pop the keyboard.
    if (this.isMobile() && this.isLandscape()) {
      // Never collapse an input the user is actively typing in. The soft
      // keyboard's viewport resize can flip the (orientation)/(max-height)
      // queries mid-type — collapsing on that flip yanked the command line
      // away the moment it was used (the mic-tap "flash"). A rotation
      // while typing keeps the input up for the same reason; GO or the
      // keyboard toggle collapses it once the user is done.
      const el = document.activeElement as HTMLElement | null
      const editing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (editing && this.inputVisible()) return
      this.inputVisible.set(false)
      EffectBus.emit('mobile:input-visible', { visible: false, mobile: true, focus: false })
    } else {
      this.inputVisible.set(true)
      EffectBus.emit('mobile:input-visible', { visible: true, mobile: this.isMobile(), focus: false })
    }
  }
  /** Landscape sidebar keyboard button: reveal ⇄ collapse the command
   * line. Revealing omits `focus` so the shell focuses and the native
   * keyboard rises inside the user gesture. */
  readonly toggleInput = (): void => {
    const next = !this.inputVisible()
    this.inputVisible.set(next)
    EffectBus.emit('mobile:input-visible', { visible: next, mobile: this.isMobile() })
  }
  // The bar is not the only emitter — GO, the mic reveal, the tutorial and
  // the empty-hex long-press all move visibility on the same effect. Mirror
  // every emission into the signal so the keyboard button's lit state stays
  // truthful. Set-only (no re-emit), so this cannot loop.
  #inputVisibleMirrorUnsub?: () => void
  #utility = signal(localStorage.getItem('hc:utility-expanded') !== 'false')
  #moveMode = signal(false)
  #mode = signal<'browsing' | 'atomize'>('browsing')
  #clipboardItems = signal<string[]>([])
  #roomOpen = signal(false)
  #beesVisible = signal(localStorage.getItem('hc:bees-visible') === 'true')
  #showHidden = signal(localStorage.getItem('hc:show-hidden') === '1')
  // Fit button has three states:
  //  - 'off'    (white): regular click performs a one-shot fit; no pin
  //  - 'global' (green): every layer auto-fits on navigation
  //  - 'page'   (blue):  only the current page auto-fits; others untouched
  // `#fitMode` is the global toggle; `#fitPinnedPages` stores the set of
  // page keys (lineage path) that are page-pinned. The effective button
  // state is derived from both signals + current navigation path.
  #fitMode = signal<'off' | 'global'>(
    localStorage.getItem('hc:fit-mode') === 'global' || localStorage.getItem('hc:fit-locked') === '1'
      ? 'global'
      : 'off',
  )
  #fitPinnedPages = signal<ReadonlySet<string>>(this.#restoreFitPinnedPages())
  // Pages where global-fit is suppressed because the user manually adjusted
  // the viewport there. Only meaningful while #fitMode === 'global'.
  #fitDisabledPages = signal<ReadonlySet<string>>(this.#restoreFitDisabledPages())
  #fitLockedSnapshot: { scale: number; cx: number; cy: number; dx: number; dy: number } | null = null

  #restoreFitPinnedPages(): ReadonlySet<string> {
    try {
      const raw = localStorage.getItem('hc:fit-pinned-pages')
      if (!raw) return new Set()
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? new Set(arr) : new Set()
    } catch {
      return new Set()
    }
  }

  #persistFitPinnedPages(set: ReadonlySet<string>): void {
    localStorage.setItem('hc:fit-pinned-pages', JSON.stringify([...set]))
  }

  #restoreFitDisabledPages(): ReadonlySet<string> {
    try {
      const raw = localStorage.getItem('hc:fit-disabled-pages')
      if (!raw) return new Set()
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? new Set(arr) : new Set()
    } catch {
      return new Set()
    }
  }

  #persistFitDisabledPages(set: ReadonlySet<string>): void {
    localStorage.setItem('hc:fit-disabled-pages', JSON.stringify([...set]))
  }

  #currentPageKey(): string {
    return this.navigation.segmentsRaw().join('/')
  }

  // ── viewport pin — a per-layer setting ────────────────────
  //
  // The pin freezes the viewport (no pan, no zoom) and belongs to the LAYER
  // it was set on, not to the session: pin a page, walk away, come back and
  // it is still frozen — while every other page stays free. The set of pinned
  // page keys (lineage path, same key as the fit pins) is persisted; the
  // shared InputGate lock is derived from it on every navigation (#pinSync).
  #pinnedPages = signal<ReadonlySet<string>>(this.#restorePinnedPages())

  #restorePinnedPages(): ReadonlySet<string> {
    try {
      const raw = localStorage.getItem(PINNED_PAGES_KEY)
      if (!raw) return new Set()
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? new Set(arr) : new Set()
    } catch {
      return new Set()
    }
  }

  #persistPinnedPages(set: ReadonlySet<string>): void {
    try {
      localStorage.setItem(PINNED_PAGES_KEY, JSON.stringify([...set]))
    } catch { /* ignore */ }
  }
  #clipboardAvailable = signal(false)
  // Whether the side panel is currently open. Mirrors the panel's own
  // `clipboard:open` state event so the toolbar button can both toggle it
  // and light up while it's showing.
  #clipboardPanelOpen = signal(false)
  #hasSelection = signal(false)
  #textOnly = signal(false)
  #layoutPinned = signal(false)
  #tags = signal<{ name: string; count: number }[]>([])
  #activeTagFilters = signal<Set<string>>(new Set())
  // Filter scope — how wide a tag filter reaches. Non-sticky: resets to 'local'
  // every session (never persisted), so filtering defaults to the current page.
  #tagScope = signal<'local' | 'children' | 'global'>('local')
  // Bottom strip opened out to every tag on multiple rows. STICKY, unlike the
  // reach: this is a workspace preference (how much room the pheromones get),
  // not a filter state, so a hive that lives on its tags stays opened out.
  #tagsExpanded = signal(localStorage.getItem('hc:tags-expanded') === '1')
  #hoveredTags = signal<Set<string>>(new Set())
  /** Tile under the pointer, or null. Read by the breadcrumb — see the
   *  `tile:hover` subscription for why it has to be shown there. */
  readonly hoveredCell = computed(() => this.#hoveredCell())
  #hoveredCell = signal<string | null>(null)
  readonly addressHover = signal(false)
  #atomizeTarget = signal('')
  #atomizeStrategy = signal('')
  #atomizeAtomCount = signal(0)

  // ── single-row layout with edit-mode toggling ──────────────
  // Replaces the previous multi-row + expand/collapse split. All items
  // render on one line in CONTROL_REGISTRY order; muted (disabled-by-user)
  // items appear grayed and are no-ops in normal mode. The chevron at
  // the end of the row toggles edit mode — while editing, every click
  // flips an item's enabled state instead of running its action.
  #enabledMap = signal<Record<string, boolean>>(this.#restoreEnabledMap())
  #editMode = signal(false)

  /** Flat list of every visible control, in registry order. */
  readonly visibleControls = computed((): ControlItem[] =>
    CONTROL_REGISTRY.filter(ctrl => this.#isControlVisible(ctrl))
  )

  /** The scrollable icon set: every visible control EXCEPT back. Back is a
   *  structural footer action (rendered separately, pinned to the bottom of
   *  the rail) so it stays reachable no matter how long the icon list grows
   *  and is never user-mutable in edit mode. */
  readonly railControls = computed((): ControlItem[] => {
    // On the left dock, pin is lifted out of the scrollable list and rendered
    // as a fixed action at the very top (above home) — drop it here so it
    // isn't duplicated. Every other dock/layout keeps pin inline in the list.
    const onLeftRail = this.#dockSide() === 'left' && !this.isMobile()
    return this.visibleControls().filter(ctrl =>
      ctrl.id !== 'back' && !(onLeftRail && ctrl.id === 'pin'),
    )
  })

  readonly editMode = this.#editMode.asReadonly()

  readonly toggleEditMode = (): void => {
    this.#editMode.update(v => !v)
  }

  // ── universal icon protocol ──────────────────────────────
  /** True while reskin (jiggle) mode is on — drives the wiggle class. */
  readonly iconEditOn = signal(false)
  /** Bumped on every override change so `iconSymbol` re-resolves in the view. */
  readonly iconRev = signal(0)
  #suppressIconClick = false
  #iconPressTimer: ReturnType<typeof setTimeout> | null = null

  /** Long-press a control icon → enter icon edit mode (without picking it). */
  readonly onIconPressDown = (): void => {
    this.#clearIconPress()
    this.#suppressIconClick = false
    this.#iconPressTimer = setTimeout(() => {
      this.#iconPressTimer = null
      this.#suppressIconClick = true
      iconEditMode.enter()
    }, LONG_PRESS_MS)
  }
  readonly onIconPressUp = (): void => { this.#clearIconPress() }
  #clearIconPress(): void { if (this.#iconPressTimer) { clearTimeout(this.#iconPressTimer); this.#iconPressTimer = null } }

  readonly isEnabled = (ctrl: ControlItem): boolean => {
    const map = this.#enabledMap()
    return map[ctrl.id] ?? DEFAULT_ENABLED_MAP[ctrl.id] ?? true
  }

  /** Mode-aware click router. Edit mode toggles enabled state; normal
   *  mode runs the action only if the item is enabled — muted items
   *  no-op so the user has to enter edit mode to activate them. */
  readonly onCtrlClick = (ctrl: ControlItem, event: MouseEvent): void => {
    // Icon protocol: a long-press just entered edit mode — swallow its trailing
    // click; a tap while editing reskins this control instead of running it.
    if (this.#suppressIconClick) { this.#suppressIconClick = false; return }
    if (iconEditMode.on) { void iconEditMode.requestPick('control:' + ctrl.id); return }
    if (this.#editMode()) {
      this.#enabledMap.update(m => ({ ...m, [ctrl.id]: !this.isEnabled(ctrl) }))
      this.#persistEnabledMap()
      return
    }
    if (!this.isEnabled(ctrl)) return
    this.#actions[ctrl.action]?.(event)
  }

  /** Action dispatch map — routes control actions to existing methods. */
  readonly #actions: Record<string, (e?: MouseEvent) => void> = {
    goBack: () => this.goBack(),
    openDcp: () => this.openDcp(),
    fitOrCenter: (e) => this.fitOrCenter(e!),
    zoomOut: () => this.zoomOut(),
    zoomIn: () => this.zoomIn(),
    togglePin: () => this.togglePin(),
    toggleFullscreen: () => this.toggleFullscreen(),
    toggleShowHidden: () => this.toggleShowHidden(),
    toggleTextOnly: () => this.toggleTextOnly(),
    openPools: () => this.openPools(),
    openSequences: () => EffectBus.emit('sequence:view-open', {}),
    cut: () => this.cut(),
    copy: () => this.copy(),
    remove: () => this.remove(),
    moveItem: () => this.moveItem(),
    promoteToParent: () => this.promoteToParent(),
    makePublic: () => this.makePublic(),
    makeBranchPublic: () => this.makeBranchPublic(),
    toggleClipboard: () => this.toggleClipboard(),
    toggleVoice: () => this.toggleVoice(),
    toggleBees: () => this.toggleBees(),
  }

  readonly runAction = (action: string, event: MouseEvent): void => {
    this.#actions[action]?.(event)
  }

  readonly isActive = (ctrl: ControlItem): boolean => {
    switch (ctrl.id) {
      case 'clipboard': return this.#clipboardPanelOpen()
      case 'pin': return this.pinnedHere()
      case 'fit': return this.fitLocked()
      case 'text-only': return this.#textOnly()
      case 'bees': return this.#beesVisible()
      case 'voice': return this.voiceActive()
      default: return false
    }
  }

  /** Material Symbols name for each control id. Used by the desktop
   *  control row to render Material Symbols instead of the custom
   *  'hypercomb-icons' font glyphs. Stateful controls (pin, show-hidden,
   *  text-only, voice, bees) read distinctly via the FILL axis (.filled)
   *  rather than a separate glyph.
   *  Returns an empty string for unknown ids so the template falls back
   *  to the legacy glyph rendering. */
  /** Public glyph resolver — the author default (below) with the participant's
   *  icon-protocol override layered on top. Touches `iconRev` so a reskin
   *  re-renders. */
  readonly iconSymbol = (ctrl: ControlItem): string => {
    this.iconRev()   // CD dependency: re-resolve when an override changes
    return iconOverrides.glyph('control:' + ctrl.id, this.#rawIconSymbol(ctrl))
  }

  readonly #rawIconSymbol = (ctrl: ControlItem): string => {
    switch (ctrl.id) {
      case 'back':         return 'arrow_back'
      case 'dcp':          return 'dashboard_customize'
      case 'fit':          return 'center_focus_strong'
      // zoom_in/zoom_out is the lens-style magnifying glass (circle +
      // handle). Visually off-centre by default because the handle
      // extends bottom-right of the lens — the .zoom-btn class in
      // controls-bar.component.scss bumps the icon size and translates
      // it so the lens lands roughly on the button's geometric centre.
      case 'zoom-out':     return 'zoom_out'
      case 'zoom-in':      return 'zoom_in'
      case 'pin':          return 'push_pin'
      case 'fullscreen':   return 'fullscreen'
      case 'text-only':    return this.textOnly() ? 'text_fields' : 'subject'
      case 'pools':        return 'place'
      case 'sequences':    return 'schema'
      case 'promote-to-parent': return 'arrow_upward'
      case 'clipboard':    return 'content_paste'
      case 'voice':        return 'mic'
      case 'bees':         return 'hub'
      default:             return ''
    }
  }

  readonly badgeValue = (ctrl: ControlItem): number => {
    if (ctrl.id === 'clipboard') return this.clipboardCount()
    return 0
  }

  #isControlVisible(ctrl: ControlItem): boolean {
    // Optional tool-window launchers are slash-first. They do not occupy the
    // normal rail until enabled from inside their window.
    if (ctrl.id === 'sequences' && !this.#editMode() && !this.isEnabled(ctrl)) return false
    // In edit mode the user is picking which icons should be active — show
    // candidates that are normally state-gated so they can be toggled even
    // when their state isn't currently met (empty clipboard, no selection).
    if (this.#editMode() && (ctrl.visibleWhen === 'clipboardHasItems'
      || ctrl.visibleWhen === 'hasSelection')) return true
    // A pinned layer is frozen — the viewport controls come off the bar so
    // there is literally nothing left to drag or zoom with. Edit mode keeps
    // them visible so the rail can still be configured from a pinned page.
    if (!this.#editMode() && VIEWPORT_CONTROLS.has(ctrl.id) && this.pinnedHere()) return false
    switch (ctrl.visibleWhen) {
      case 'always': return true
      case 'clipboardHasItems': return this.#clipboardAvailable() && this.clipboardCount() > 0
      case 'voiceSupported': return this.voiceSupported
      case 'public': return !!this.meshPublic()
      case 'hasSelection': return this.#hasSelection()
      // world:mode is the mesh-header's world toggle, a distinct broadcast
      // from the solo/swarm meshPublic input.
      default: return true
    }
  }

  #restoreEnabledMap(): Record<string, boolean> {
    try {
      const raw = localStorage.getItem(ENABLED_MAP_KEY)
      if (!raw) return { ...DEFAULT_ENABLED_MAP }
      const parsed = JSON.parse(raw) as Record<string, boolean>
      if (typeof parsed === 'object' && parsed !== null) {
        // merge with defaults so newly-added controls inherit a sane initial state
        return { ...DEFAULT_ENABLED_MAP, ...parsed }
      }
    } catch { /* ignore */ }
    return { ...DEFAULT_ENABLED_MAP }
  }

  #persistEnabledMap(): void {
    try {
      localStorage.setItem(ENABLED_MAP_KEY, JSON.stringify(this.#enabledMap()))
    } catch { /* ignore */ }
  }

  // ── pill zoom (scales with viewport width) ────────────────
  // Baseline 1.0 at 1920px and above (large monitors stay at 1×).
  // Small screens floor at 0.9. 13" laptop band (1367–2559px) gets a
  // 1.15× bump to match the header zoom in `_header-bar.scss` — keeps
  // top + bottom chrome visually paired. Mobile uses a separate
  // floating-icon layout that ignores this zoom.
  readonly #pillZoom = signal(this.#computePillZoom())
  readonly pillZoom = this.#pillZoom.asReadonly()

  #computePillZoom(): number {
    const w = window.innerWidth
    const ratio = w / 1920
    const base = Math.max(0.9, Math.min(ratio, 1))
    const laptopBand = w >= 1367 && w <= 2559 ? 1.15 : 1
    return base * laptopBand
  }

  // ── pill position (drag-to-move; no resize) ───────────────
  // null = use default CSS positioning (bottom-center). Once dragged,
  // we switch to explicit left/top and persist across sessions.
  readonly #pillPos = signal<{ x: number; y: number } | null>(null)
  readonly pillPos = this.#pillPos.asReadonly()
  readonly #pillDragging = signal(false)
  readonly pillDragging = this.#pillDragging.asReadonly()
  // ── side-dock state ──────────────────────────────────────
  // null            → free floating (horizontal pill at explicit coords)
  // 'left' / 'right'→ locked to that edge as a vertical toolbar.
  // Drag the grip into a side's snap zone to dock; drag back out (past a
  // wider exit zone, for hysteresis) to detach. The default (no persisted
  // position) is the left-edge dock; dropping a detached pill with any part
  // offscreen resets it to that same left-dock default. Initialized to null
  // here; #restorePillPos() applies the left default once the DOM is ready.
  readonly #dockSide = signal<'left' | 'right' | null>(null)
  readonly dockSide = this.#dockSide.asReadonly()
  readonly #SNAP_ZONE = 72
  #pillDragOffsetX = 0
  #pillDragOffsetY = 0
  #pillPointerId: number | null = null
  #pillStageEl: HTMLElement | null = null
  // Live header-height probe. Header-anchored offsets (the breadcrumb, etc.)
  // dock at a static `calc(<base> * --hc-header-zoom)`, which assumes the bar
  // renders exactly `~2.83rem × zoom` tall. On some devices (high-DPI / narrow
  // viewports like the Surface) the header renders TALLER than that, so the
  // static offset lets the breadcrumb ride up under the bar. We measure the
  // real header bottom into `--hc-header-bottom`; the CSS docks at
  // `max(static, measured)` so this can only push offsets DOWN, never up.
  #headerObserver: ResizeObserver | null = null
  // Live probe of the edge the docked control bar occupies, published as
  // `--hc-controls-<side>` so docked toolwindows sit beside the bar.
  #controlsObserver: ResizeObserver | null = null
  /** The `.pill-stage` the observer is currently attached to, so a re-created
   *  element is re-observed instead of measured while detached. */
  #observedStage: HTMLElement | null = null
  // Pill stays anchored to the bottom of the viewport. We track the
  // distance from the top of the pill to the bottom of the viewport
  // (`fromBottom`) and recompute y on every window resize so the pill
  // doesn't drift over tile content when the viewport grows or shrinks
  // (rotation, fullscreen, devtools, mobile address bar collapse).
  #pillFromBottom: number | null = null

  #viewportCenter = (): { x: number; y: number } => {
    const rootStyle = getComputedStyle(document.documentElement)
    const left = Number.parseFloat(rootStyle.getPropertyValue('--hc-controls-left')) || 0
    const right = Number.parseFloat(rootStyle.getPropertyValue('--hc-controls-right')) || 0
    return {
      x: left + (window.innerWidth - left - right) / 2,
      y: window.innerHeight / 2,
    }
  }

  #idleTimer: ReturnType<typeof setTimeout> | null = null
  #moveModeUnsub: (() => void) | null = null
  #touchDraggingUnsub: (() => void) | null = null
  #touchDragging = signal(false)
  #viewActiveUnsub: (() => void) | null = null
  #viewActive = signal(false)
  readonly #IDLE_DELAY = 3000

  // ── swipe-to-go-back gesture ────────────────────────────
  #swipeStartX = 0
  #swipeStartY = 0
  #swipeActive = false
  readonly #SWIPE_THRESHOLD = 80     // px to trigger back
  readonly #SWIPE_EDGE_ZONE = 40     // px from right edge to start
  readonly #SWIPE_ANGLE_MAX = 30     // max degrees from horizontal
  readonly swipeIndicatorActive = signal(false)

  // ── computed ────────────────────────────────────────────

  readonly spaceName = computed(() => {
    this.#moved$()
    return this.#room$()
  })

  /** Each segment of the lineage path, with the slice needed to navigate there. */
  readonly pathSegments = computed(() => {
    this.#moved$()
    this.#titleTick()
    const segs = this.navigation.segmentsRaw()
    const decorations = get('@diamondcoreprocessor.com/DecorationService') as
      { titleSlugAt?: (segments: readonly string[], locale?: string) => string } | undefined
    return segs.map((name, i) => {
      const target = segs.slice(0, i + 1)
      return {
        /** What the crumb READS: the tile's title canonicalized as a path
         *  segment, else its own name. Display only — `target` below stays the
         *  raw address, so a retitled tile still navigates to where it lives. */
        name: decorations?.titleSlugAt?.(target) || name,
        /** all segments up to and including this one */
        target,
        /** true for the last (leaf) segment */
        leaf: i === segs.length - 1,
      }
    })
  })

  readonly midPath = computed(() => {
    const segs = this.pathSegments()
    if (segs.length <= 1) return ''
    return segs.slice(0, -1).map(s => s.name).join(' / ')
  })

  readonly leafSegment = computed(() => {
    const segs = this.pathSegments()
    return segs.length > 0 ? segs[segs.length - 1].name : ''
  })

  readonly prefixPath = computed(() => {
    const parts: string[] = []
    const space = this.spaceName()
    if (space) parts.push(space)
    const mid = this.midPath()
    if (mid) parts.push(mid)
    const leaf = this.leafSegment()
    if (leaf) parts.push(leaf)
    return parts.join(' / ')
  })

  readonly secretWords = computed(() => {
    // The word pair is a human-verifiable reflection of the mesh FILTER.
    // It hashes the EXACT SAME STRING the mesh requests use today —
    // `lineage \0 room \0 secret` (no domain) — so two peers comparing
    // their two words confirm they share the same place AND the same
    // secret, i.e. they're on the same channel. See SwarmDrone
    // (#syncForCurrentLineage / composeSigForSegments), which signs this
    // same string into the channel sig. Keep this string byte-identical
    // to the swarm's: same trim, same NUL separators, same lineage.
    const secret = this.#secret$().trim()
    const room = this.#room$().trim()
    const lineage = this.#lineageKey()
    if (!lineage && !room && !secret) return ''
    return secretTag(`${lineage}\0${room}\0${secret}`, this.#locale$())
  })

  readonly hasSecret = computed(() => !!this.#secret$().trim())

  readonly shieldColor = computed(() => {
    const secret = this.#secret$().trim()
    if (!secret) return 'rgba(245, 245, 245, 0.35)'
    const provider = get('@hypercomb.social/SecretStrengthProvider') as { evaluate: (s: string) => number } | undefined
    const score = provider?.evaluate(secret) ?? 0.5
    const hue = Math.round(160 + score * 30)
    return `hsl(${hue}, 65%, 50%)`
  })

  readonly hasPrefixPath = computed(() => this.prefixPath().length > 0)

  /** Active domain for breadcrumb display */
  readonly activeDomain = computed(() => {
    return window.location.hostname || 'hypercomb.io'
  })

  /**
   * Lineage path key — the navigation path, derived byte-identically to
   * the swarm's lineageKey (#syncForCurrentLineage): trim each segment,
   * drop empties, join with '/'. Two peers at the same lineage derive the
   * same value regardless of room or secret. Feeds the secret-words crumb.
   */
  readonly #lineageKey = computed(() => {
    this.#moved$()
    return this.navigation.segmentsRaw()
      .map(s => String(s ?? '').trim())
      .filter(s => s.length > 0)
      .join('/')
  })

  readonly canGoBack = computed(() => {
    this.#moved$()
    return this.navigation.segmentsRaw().length > 0
  })

  readonly locked = this.#locked

  /** True when THIS layer is pinned. Re-reads on navigation, so walking off a
   *  pinned page reads as unpinned the moment the location changes. */
  readonly pinnedHere = computed(() => {
    this.#moved$()
    return this.#pinnedPages().has(this.#currentPageKey())
  })

  /** Whether `#pinSync` has actually taken the lock. Guards the reconciliation
   *  below from firing before the effect's first run (a gate change during
   *  boot would otherwise read as "someone dropped our lock"). */
  #pinHeld = false

  /** Hold the InputGate lock exactly while the current layer is pinned. This is
   *  the ONLY writer of the 'pin' lock: navigating away releases it, arriving on
   *  a pinned layer re-takes it. Locks held by other owners (editor, palette)
   *  are untouched. */
  #pinSync = effect(() => {
    const pinned = this.pinnedHere()
    if (pinned) this.gate?.lock?.(PIN_OWNER)
    else if (this.gate?.lockedBy?.(PIN_OWNER)) this.gate.unlock(PIN_OWNER)
    this.#pinHeld = pinned
  })

  /** Gate released our pin from outside (the Escape cascade's `clear()`) —
   *  unpin the layer so the stored setting matches what the viewport does. */
  #onGateChange = (): void => {
    if (!this.#pinHeld || !this.pinnedHere()) return
    if (this.gate?.lockedBy?.(PIN_OWNER)) return
    this.#pinHeld = false
    const key = this.#currentPageKey()
    const next = new Set(this.#pinnedPages())
    next.delete(key)
    this.#pinnedPages.set(next)
    this.#persistPinnedPages(next)
  }

  /** Effective button state — drives color: white/green/blue. */
  readonly fitButtonState = computed<'off' | 'global' | 'page'>(() => {
    // Track navigation so this recomputes when the user moves between layers.
    this.#moved$()
    const key = this.#currentPageKey()
    if (this.#fitPinnedPages().has(key)) return 'page'
    if (this.#fitMode() === 'global' && !this.#fitDisabledPages().has(key)) return 'global'
    return 'off'
  })
  /** True when any fit lock is active for the current page (global or page-pinned). */
  readonly fitLocked = computed(() => this.fitButtonState() !== 'off')
  readonly mode = this.#mode.asReadonly()
  readonly utility = this.#utility.asReadonly()
  readonly clipboardItems = this.#clipboardItems.asReadonly()
  readonly clipboardCount = computed(() => this.#clipboardItems().length)
  readonly clipboardAvailable = this.#clipboardAvailable.asReadonly()
  readonly moveMode = this.#moveMode.asReadonly()
  readonly hasSelection = this.#hasSelection.asReadonly()
  readonly textOnly = this.#textOnly.asReadonly()
  readonly layoutPinned = this.#layoutPinned.asReadonly()
  readonly tags = this.#tags.asReadonly()

  readonly tagScope = this.#tagScope.asReadonly()
  readonly tagsExpanded = this.#tagsExpanded.asReadonly()

  /** The three reaches, in order, for the expanded strip's scope row. Same ids
   *  and glyphs as the pheromone panel — one vocabulary for reach, wherever
   *  you meet it. */
  readonly tagScopeOptions: readonly { id: 'local' | 'children' | 'global'; icon: string }[] = [
    { id: 'local', icon: 'blur_on' },
    { id: 'children', icon: 'account_tree' },
    { id: 'global', icon: 'public' },
  ]

  /** Material Symbol for the scope cycle button — a glyph per reach, so the
   *  control reads as a control and never as a tag. page → children → global. */
  readonly scopeIcon = computed(() => {
    switch (this.#tagScope()) {
      case 'children': return 'account_tree'
      case 'global': return 'public'
      default: return 'blur_on'
    }
  })

  /** Open the strip out to every tag on as many rows as it takes, or fold it
   *  back to the single row. Persisted — see `#tagsExpanded`. */
  readonly toggleTagsExpanded = (): void => {
    const next = !this.#tagsExpanded()
    this.#tagsExpanded.set(next)
    localStorage.setItem('hc:tags-expanded', next ? '1' : '0')
  }

  readonly isTagScope = (id: 'local' | 'children' | 'global'): boolean => this.#tagScope() === id

  /** Set the reach from the expanded strip. Always re-broadcasts `tags:filter`
   *  carrying the CURRENT filter set — a live filter must re-scan at the new
   *  width, and with nothing filtered the emit is what keeps the panel and the
   *  readout glyph in step. Mirrors the panel's own `setScope`. */
  readonly setTagScope = (id: 'local' | 'children' | 'global'): void => {
    if (this.#tagScope() === id) return
    this.#tagScope.set(id)
    EffectBus.emit('tags:filter', { active: [...this.#activeTagFilters()], scope: id })
  }


  /** Open the pheromone panel. This icon used to CYCLE the reach in place —
   *  three states behind one glyph, explained only by a tooltip, so the reach
   *  was effectively invisible. The panel names each reach and says what it
   *  does; the glyph here stays as a readout of the current one. */
  readonly openPheromones = (): void => {
    EffectBus.emit('tags:view-open', undefined)
  }

  /** Open the full-screen viewfinder (hc-camera-capture). The shutter there
   *  creates a tile from the frame — the bar only asks for the camera. */
  readonly openCamera = (): void => {
    EffectBus.emit('camera:capture-open', undefined)
  }

  /** The lane button is the phone's zoom. Tap walks the ladder toward
   *  reading (3 → 2 → 1) and wraps back to scan at the end, so one thumb
   *  reaches every rung without a second control. Off ⇒ the first tap
   *  engages lanes at the remembered rung rather than stepping past it. */
  readonly stepLanes = (): void => {
    if (!this.lanesActive()) {
      EffectBus.emit('lanes:set', { lanes: this.laneCount() })
      return
    }
    EffectBus.emit('lanes:set', { lanes: this.laneCount() <= 1 ? 3 : this.laneCount() - 1 })
  }

  /** Long-press releases the lane viewport — free pan and zoom back. */
  readonly releaseLanes = (): void => {
    EffectBus.emit('lanes:off', {})
  }

  /** Pools of Meaning — just SHOW the collections window. Deliberately does NOT
   *  navigate: the panel's first purpose is dragging collection references onto
   *  the page you are already standing on, so sending you to `/sets` would take
   *  away the very surface you meant to drop them on. Clicking a row still opens
   *  that collection (to manage it), and the panel offers its way back. */
  readonly openPools = (): void => {
    EffectBus.emit('aggregate:view-toggle', { id: 'collections' })
  }

  readonly isTagFilterActive = (name: string): boolean => {
    return this.#activeTagFilters().has(name)
  }

  readonly toggleTagFilter = (name: string): void => {
    this.#activeTagFilters.update(set => {
      const next = new Set(set)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      // Emit filter to ShowHoneycombWorker — scope decides page/children/global reach
      EffectBus.emit('tags:filter', { active: [...next], scope: this.#tagScope() })
      return next
    })
  }

  readonly isTagHovered = (name: string): boolean => {
    return this.#hoveredTags().has(name)
  }

  readonly tagColor = (name: string): string => {
    const registry = get('@hypercomb.social/TagRegistry') as { color: (n: string) => string } | undefined
    const color = registry?.color(name)
    if (color) return color
    // fallback to localStorage for first render before registry loads
    try {
      const stored: Record<string, string> = JSON.parse(localStorage.getItem('hc:tag-colors') ?? '{}')
      if (stored[name]) return stored[name]
    } catch { /* fall through */ }
    // deterministic vibrant color from tag name — no grays
    return tagNameToColor(name)
  }
  readonly visible = computed(() => !this.#touchDragging() && !this.#viewActive())
  readonly roomOpen = this.#roomOpen.asReadonly()
  readonly beesVisible = this.#beesVisible.asReadonly()
  readonly showHidden = this.#showHidden.asReadonly()
  readonly voiceActive = signal(false)
  readonly voiceSupported = VoiceInputService.supported()
  readonly atomizeTarget = this.#atomizeTarget.asReadonly()
  readonly atomizeStrategy = this.#atomizeStrategy.asReadonly()
  readonly atomizeAtomCount = this.#atomizeAtomCount.asReadonly()

  // ── lifecycle ───────────────────────────────────────────

  #fitLockedUnsub: (() => void) | null = null
  #zoomManualUnsub: (() => void) | null = null
  #clipboardUnsub: (() => void) | null = null
  #selectionUnsub: (() => void) | null = null
  #hoverCrumbUnsub: (() => void) | null = null
  #layoutModeUnsub: (() => void) | null = null
  #beesUnsub: (() => void) | null = null
  #tagsUnsub: (() => void) | null = null
  #tagFilterUnsub: (() => void) | null = null
  #hoverTagsUnsub: (() => void) | null = null
  #voiceActiveUnsub: (() => void) | null = null
  #showHiddenUnsub: (() => void) | null = null
  #textOnlyUnsub: (() => void) | null = null
  #clipboardAvailableUnsub: (() => void) | null = null
  #clipboardOpenUnsub: (() => void) | null = null
  #atomizeModeUnsub: (() => void) | null = null
  #atomizeAtomsUnsub: (() => void) | null = null
  #atomizeStrategyUnsub: (() => void) | null = null
  #meshModalUnsub: (() => void) | null = null
  #lanesUnsub: (() => void) | null = null
  #meshJoinUnsub: (() => void) | null = null
  #lockBumpUnsub: (() => void) | null = null
  #iconEditUnsub: (() => void) | null = null
  #configureControlUnsub: (() => void) | null = null
  #onIconOverride = (): void => this.iconRev.update(v => v + 1)

  ngOnInit(): void {
    // Host-level capture guard so a drag-scroll's trailing click never
    // reaches an icon. On the host (not the list) because the list is
    // created and destroyed by the mode/dock branches.
    this.#installClickSwallow()

    // Pulse the pin button when a pan/zoom is rejected because input is
    // locked. Transient (no replay) so a fresh mount never bumps.
    this.#lockBumpUnsub = EffectBus.on('input:locked-attempt', this.#flashLockBump)

    // The Escape cascade force-clears the gate as last-resort recovery. On a
    // pinned layer that IS the release gesture, so fold it back into the
    // per-layer setting — otherwise the button would read pinned while the
    // viewport moved freely.
    this.gate?.addEventListener?.('change', this.#onGateChange)

    // Icon protocol: reflect edit mode (jiggle) + re-resolve glyphs on reskin.
    this.#iconEditUnsub = EffectBus.on<{ on?: boolean }>('icon:edit-mode', ({ on }) => this.iconEditOn.set(!!on))
    this.#configureControlUnsub = EffectBus.on<{ id?: string; enabled?: boolean }>(
      'controls:configure',
      ({ id, enabled }) => {
        if (!id || typeof enabled !== 'boolean') return
        this.#enabledMap.update(m => ({ ...m, [id]: enabled }))
        this.#persistEnabledMap()
      },
    )
    iconOverrides.addEventListener('change', this.#onIconOverride)

    this.#meshModalUnsub = EffectBus.on<{ open: boolean }>('mesh:modal-open', ({ open }) => {
      this.#roomOpen.set(!!open)
    })

    // Last-value replay: the bar reads the ladder even when it mounts after
    // the rung was set (a rotation rebuilds this component, the rung does
    // not change with it).
    this.#lanesUnsub = EffectBus.on<{ active?: boolean; lanes?: number }>(
      'lanes:changed',
      ({ active, lanes }) => {
        this.lanesActive.set(!!active)
        if (Number.isFinite(lanes)) this.laneCount.set(Math.min(3, Math.max(1, Number(lanes))))
      },
    )

    // Breadcrumb readings are resolved synchronously from the decoration index,
    // which fills in asynchronously — and they are per-locale. Both events have
    // to re-run the crumb computation or the trail keeps showing raw addresses
    // after a retitle, or the previous language after a switch.
    this.#titleTickUnsub = EffectBus.on('title:indexed', () => this.#titleTick.update(n => n + 1))
    this.#localeTickUnsub = EffectBus.on('locale:changed', () => this.#titleTick.update(n => n + 1))

    // The location dialog's "start" confirmed (join mode) — flip to public
    // now that the where/secret are set. Idempotent: already public → no-op.
    this.#meshJoinUnsub = EffectBus.on('mesh:join', () => {
      if (!this.meshPublic()) this.meshToggled.emit()
    })

    // ── mobile detection via matchMedia ──
    // A phone is small in EITHER dimension: ≤599px WIDE (portrait) OR ≤449px
    // TALL (landscape — a phone on its side is wide but short). Both collapse
    // the command line and show the mobile control strip — a bottom bar in
    // portrait, a right-edge sidebar in landscape. Tablets/laptops/desktops
    // exceed both thresholds and keep the full desktop shell. (A very short
    // desktop window also reads as mobile — an acceptable edge.)
    this.#inputVisibleMirrorUnsub = EffectBus.on<{ visible: boolean; mobile: boolean }>(
      'mobile:input-visible',
      ({ visible, mobile }) => this.inputVisible.set(mobile ? visible : true),
    )

    this.#mobileQuery = window.matchMedia('(max-width: 599px), (max-height: 449px)')
    this.isMobile.set(this.#mobileQuery.matches)
    this.#mobileQuery.addEventListener('change', this.#mobileHandler)

    this.#landscapeQuery = window.matchMedia('(orientation: landscape)')
    this.isLandscape.set(this.#landscapeQuery.matches && this.isMobile())
    this.#landscapeQuery.addEventListener('change', this.#landscapeHandler)

    this.#syncInputVisibility()

    this.isFullscreen.set(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', this.#fullscreenHandler)

    this.#restorePillPos()

    window.addEventListener('resize', this.#onResize)
    window.addEventListener('pointermove', this.#onActivity)
    window.addEventListener('pointerdown', this.#onActivity)
    // Capture phase: a tap on the canvas is consumed by the renderer's own
    // handlers, so a bubbling listener would never see it and the row would
    // only ever close from its own button.
    window.addEventListener('pointerdown', this.#viewRowAway, true)
    window.addEventListener('keydown', this.#onActivity)
    window.addEventListener('navigate', this.#onActivity)
    this.#resetIdleTimer()

    // power key tracking
    window.addEventListener('keydown', this.#onPowerKeyDown)
    window.addEventListener('keyup', this.#onPowerKeyUp)
    window.addEventListener('blur', this.#onPowerKeyReset)

    // swipe-to-go-back gesture (mobile only, passive for scroll perf)
    window.addEventListener('touchstart', this.#onSwipeStart, { passive: true })
    window.addEventListener('touchmove', this.#onSwipeMove, { passive: true })
    window.addEventListener('touchend', this.#onSwipeEnd, { passive: true })

    this.#zoomManualUnsub = EffectBus.on('viewport:manual', () => {
      if (this.fitLocked()) this.#disableFitLockedPreservingCurrent()
    })

    this.#clipboardAvailableUnsub = EffectBus.on<{ available: boolean }>('clipboard:available', (payload) => {
      this.#clipboardAvailable.set(payload?.available ?? false)
    })

    this.#selectionUnsub = EffectBus.on<{ selected?: string[] }>('selection:changed', (payload) => {
      this.#hasSelection.set((payload?.selected?.length ?? 0) > 0)
    })

    // The name of the tile under the pointer, tacked onto the breadcrumb.
    // Hovering a tile REPLACES its name with the action icons (the band is the
    // menu now — hex-sdf.shader.ts), so without this there is nothing on screen
    // telling you which tile you are about to act on. `label` is null over an
    // empty hex and over chrome, which clears the crumb.
    this.#hoverCrumbUnsub = EffectBus.on<{ label?: string | null }>('tile:hover', (payload) => {
      this.#hoveredCell.set(payload?.label ?? null)
    })

    // Clipboard contents drive only the toolbar badge count now — the
    // side panel (hc-clipboard-panel) owns its own open/close lifecycle.
    this.#clipboardUnsub = EffectBus.on<{ items?: { label: string }[] }>('clipboard:changed', (payload) => {
      const items = payload?.items ?? []
      this.#clipboardItems.set(items.map(item => item.label))
    })

    // Mirror the panel's open state (it emits `clipboard:open` from its
    // single visibility chokepoint) so the toolbar button toggles correctly
    // and shows an active highlight while the panel is open. Last-value
    // replayed, so a late mount reflects the current panel state.
    this.#clipboardOpenUnsub = EffectBus.on<{ open?: boolean }>('clipboard:open', ({ open }) => {
      this.#clipboardPanelOpen.set(!!open)
    })

    this.#moveModeUnsub = EffectBus.on<{ active: boolean }>('move:mode', ({ active }) => {
      this.#moveMode.set(active)
    })

    this.#beesUnsub = EffectBus.on<{ visible: boolean }>('render:set-bees-visible', ({ visible }) => {
      this.#beesVisible.set(visible)
    })

    // layout mode is always dense on boot; /swirl re-applies the spiral

    this.#layoutModeUnsub = EffectBus.on<{ mode: string }>('layout:mode', ({ mode }) => {
      this.#layoutPinned.set(mode === 'pinned')
    })

    this.#touchDraggingUnsub = EffectBus.on<{ active: boolean }>('touch:dragging', ({ active }) => {
      this.#touchDragging.set(active)
    })

    this.#viewActiveUnsub = EffectBus.on<{ active: boolean }>('view:active', ({ active }) => {
      this.#viewActive.set(active)
    })

    this.#tagsUnsub = EffectBus.on<{ tags: { name: string; count: number }[] }>('render:tags', ({ tags }) => {
      // sort by hue so tags form a rainbow gradient
      const sorted = [...tags].sort((a, b) => extractHue(this.tagColor(a.name)) - extractHue(this.tagColor(b.name)))
      this.#tags.set(sorted)
    })

    // Mirror the filter — the pheromone panel can change the active set AND the
    // reach, and this bar must follow. Without this the bar kept its own stale
    // copy and the next pill click re-emitted it, silently reverting whatever
    // the panel had just set (the same way a filter set straight on the bus is
    // reverted). Sticky, so the bar hydrates on subscribe.
    this.#tagFilterUnsub = EffectBus.on<{ active: string[]; scope?: 'local' | 'children' | 'global' }>('tags:filter', (p) => {
      this.#activeTagFilters.set(new Set(Array.isArray(p?.active) ? p.active : []))
      if (p?.scope) this.#tagScope.set(p.scope)
    })

    this.#hoverTagsUnsub = EffectBus.on<{ tags: string[] }>('tile:hover-tags', ({ tags }) => {
      this.#hoveredTags.set(new Set(tags))
    })

    this.#voiceActiveUnsub = EffectBus.on<{ active: boolean }>('voice:active', ({ active }) => {
      this.voiceActive.set(active)
    })

    this.#showHiddenUnsub = EffectBus.on<{ active: boolean }>('visibility:show-hidden', ({ active }) => {
      this.#showHidden.set(active)
    })

    this.#textOnlyUnsub = EffectBus.on<{ textOnly: boolean }>('render:set-text-only', ({ textOnly }) => {
      this.#textOnly.set(textOnly)
    })

    this.#atomizeModeUnsub = EffectBus.on<{ active: boolean; target: string; strategy: string }>(
      'atomize:mode',
      ({ active, target, strategy }) => {
        if (active) {
          this.#mode.set('atomize')
          this.#atomizeTarget.set(target)
          this.#atomizeStrategy.set(strategy)
        } else {
          this.#mode.set('browsing')
          this.#atomizeTarget.set('')
          this.#atomizeStrategy.set('')
          this.#atomizeAtomCount.set(0)
        }
      },
    )

    this.#atomizeAtomsUnsub = EffectBus.on<{ atoms: unknown[]; target: string }>(
      'atomize:atoms',
      ({ atoms }) => {
        this.#atomizeAtomCount.set(atoms.length)
      },
    )

    this.#atomizeStrategyUnsub = EffectBus.on<{ strategy: string }>(
      'atomize:strategy-changed',
      ({ strategy }) => {
        this.#atomizeStrategy.set(strategy)
      },
    )

    // emit initial show-hidden state so drones pick it up
    if (this.#showHidden()) {
      EffectBus.emit('visibility:show-hidden', { active: true })
    }

    // fit-locked: install the navigation listener if any fit pin exists.
    // The listener handles suspend/resume per-page on each navigation.
    if (this.#fitMode() === 'global' || this.#fitPinnedPages().size > 0) {
      this.#enableFitLocked()
    }
  }

  ngAfterViewInit(): void {
    // Cache the stage element now that it is in the DOM. Re-validate any
    // free position restored from localStorage against the actual pill
    // size: if it no longer fully fits the viewport (it shrank since the
    // last session), fall back to the left-dock default. Docked pills
    // are CSS-positioned on the edge, so they need no re-validation here.
    this.#pillStageEl = this.#host.nativeElement.querySelector('.pill-stage')
    if (!this.#dockSide()) {
      const pos = this.#pillPos()
      if (pos && !this.#fitsOnScreen(pos.x, pos.y)) this.#resetToDefault()
    }
    this.#observeHeaderHeight()
    this.#observeControlsEdge()
  }

  /** Publish how much of a screen edge the control bar occupies, into
   *  `--hc-controls-left` / `--hc-controls-right`, plus the left rail's top edge
   *  as `--hc-controls-left-top`.
   *
   *  The bar is the ANCHOR: it stays fixed to its edge and docked toolwindows
   *  lay out against it (hcDockedPanel reads these), so a panel opens BESIDE
   *  the bar instead of over it. Only a SIDE-DOCKED bar reserves — a
   *  free-floating pill can be dragged anywhere, so reserving an edge for it
   *  would strand a permanent gap, and mobile's bottom strip owns no side. */
  readonly #measureControlsEdge = (): void => {
    // Re-resolve the stage EVERY time rather than trusting a cached reference.
    // Angular re-creates `.pill-stage` (dock/mobile class swaps, re-render), and
    // a detached node reports a 0×0 box — which would silently drop the
    // reservation and let a panel slide straight under the bar.
    const stage = this.#host.nativeElement.querySelector('.pill-stage') as HTMLElement | null
    if (stage && stage !== this.#observedStage) {
      this.#controlsObserver?.disconnect()
      this.#observedStage = stage
      if (typeof ResizeObserver !== 'undefined') {
        this.#controlsObserver = new ResizeObserver(this.#measureControlsEdge)
        this.#controlsObserver.observe(stage)
      }
    }
    const side = this.#dockSide()
    let left = 0
    let right = 0
    let leftTop = ''
    if (stage && side && !this.isMobile()) {
      // The LAYOUT box (offsetLeft/Width/Top), never getBoundingClientRect().
      //
      // `.pill-stage` animates `transform` over 200ms, and its undocked base
      // rule is `left: 50%; transform: translateX(-50%)`. Measured from the
      // visual rect, a bar that has just docked left reports its right edge at
      // HALF the rail width (the centring translate is still in flight, or has
      // not started at all when we measure in a microtask) — so we reserved
      // ~30px for a 60px rail and the panel sat ON the bar. A transform change
      // fires no ResizeObserver either, so nothing ever corrected it.
      // `offsetLeft`/`offsetWidth` ignore transforms and are correct the instant
      // the dock class lands: both docked states place themselves horizontally
      // with plain `left` / `right` (only the vertical centring is a transform).
      const w = stage.offsetWidth
      if (w > 0) {
        // Reserve up to the bar's INNER edge — robust to the pill floating a
        // gap off the edge (dock-right sits at 0.6rem) rather than flush.
        if (side === 'left') {
          left = Math.max(0, stage.offsetLeft + w)
          // The rail starts below the header (its own `top`, which shifts with
          // the header zoom and on touch). Publish it so a left-docked panel
          // aligns flush with the rail's top edge instead of hardcoding the
          // same offsets a second time and drifting out of step with it.
          leftTop = `${Math.round(Math.max(0, stage.offsetTop))}px`
        } else {
          right = Math.max(0, window.innerWidth - stage.offsetLeft)
        }
      }
    }
    const root = document.documentElement
    root.style.setProperty('--hc-controls-left', `${Math.round(left)}px`)
    root.style.setProperty('--hc-controls-right', `${Math.round(right)}px`)
    // Removed, not zeroed: panels fall back to their OWN top through the var's
    // fallback value, which a `0px` would override.
    if (leftTop) root.style.setProperty('--hc-controls-left-top', leftTop)
    else root.style.removeProperty('--hc-controls-left-top')
  }

  /** Re-measure whenever the bar changes edge (or mobile flips) — a dock swap
   *  moves the pill without necessarily resizing it, so the ResizeObserver
   *  below can't see it. Field initializer: `effect()` needs an injection
   *  context, which ngAfterViewInit is not. */
  #controlsEdgeSync = effect(() => {
    this.#dockSide()
    this.isMobile()
    queueMicrotask(this.#measureControlsEdge)
  })

  #observeControlsEdge(): void {
    // The ResizeObserver is attached inside the measure itself, so it always
    // follows the CURRENT stage element rather than the one that existed here.
    window.addEventListener('resize', this.#measureControlsEdge)
    this.#measureControlsEdge()
  }

  /** Publish the live header-bar bottom edge into `--hc-header-bottom` so the
   *  breadcrumb (and any other header-anchored offset) can dock at
   *  `max(static, measured)` and never ride up under a taller-than-expected
   *  header. `.header-bar` is a shell sibling (app.html), shared by web + dev. */
  #observeHeaderHeight(attempt = 0): void {
    if (typeof ResizeObserver === 'undefined') return
    const header = document.querySelector('.header-bar') as HTMLElement | null
    if (!header) {
      // The header is a SIBLING component and may not be in the DOM yet when
      // the control bar's view initializes. Bailing here used to be permanent,
      // which left `--hc-header-bottom` unset for the whole session and every
      // anchored surface silently on its static fallback. Retry a few frames.
      if (attempt < 30) requestAnimationFrame(() => this.#observeHeaderHeight(attempt + 1))
      return
    }
    const measure = (): void => {
      // getBoundingClientRect, NOT offsetHeight: `.header-bar` carries a CSS
      // `zoom` (--hc-header-zoom, 1.15 by default in the 13" width band), and
      // offsetHeight reports the UNZOOMED box — 45px where the real bottom edge
      // is 51.7px. Anchored panels position in viewport pixels, so the rect is
      // the only measure that can be compared against them.
      const bottom = header.getBoundingClientRect().bottom
      if (bottom > 0) document.documentElement.style.setProperty('--hc-header-bottom', `${bottom}px`)
    }
    measure()
    this.#headerObserver = new ResizeObserver(measure)
    this.#headerObserver.observe(header)
  }

  ngOnDestroy(): void {
    // The picker's window listeners are capture-phase and live only while it
    // is open — closing releases them.
    this.closeTourMenu()
    // Never leave the gate locked behind a torn-down bar — the pin would be
    // unreleasable (the only button that releases it went away with us).
    this.gate?.removeEventListener?.('change', this.#onGateChange)
    if (this.gate?.lockedBy?.(PIN_OWNER)) this.gate.unlock(PIN_OWNER)
    this.#inputVisibleMirrorUnsub?.()
    this.#mobileQuery?.removeEventListener('change', this.#mobileHandler)
    this.#landscapeQuery?.removeEventListener('change', this.#landscapeHandler)
    this.#headerObserver?.disconnect()
    this.#controlsObserver?.disconnect()
    window.removeEventListener('resize', this.#measureControlsEdge)
    // Release the reservation — a torn-down bar occupies no edge.
    document.documentElement.style.setProperty('--hc-controls-left', '0px')
    document.documentElement.style.setProperty('--hc-controls-right', '0px')
    document.documentElement.style.removeProperty('--hc-controls-left-top')
    window.removeEventListener('resize', this.#onResize)
    document.removeEventListener('fullscreenchange', this.#fullscreenHandler)
    window.removeEventListener('pointermove', this.#onActivity)
    window.removeEventListener('pointerdown', this.#onActivity)
    window.removeEventListener('keydown', this.#onActivity)
    window.removeEventListener('navigate', this.#onActivity)
    window.removeEventListener('touchstart', this.#onSwipeStart)
    window.removeEventListener('touchmove', this.#onSwipeMove)
    window.removeEventListener('touchend', this.#onSwipeEnd)
    window.removeEventListener('pointermove', this.#onPillDragMove)
    window.removeEventListener('pointerup', this.#onPillDragEnd)
    if (this.#idleTimer) clearTimeout(this.#idleTimer)
    window.removeEventListener('pointerdown', this.#viewRowAway, true)
    this.#fitLockedUnsub?.()
    this.#lanesUnsub?.()
    this.#zoomManualUnsub?.()
    this.#clipboardUnsub?.()
    this.#selectionUnsub?.()
    this.#hoverCrumbUnsub?.()
    this.#moveModeUnsub?.()
    this.#layoutModeUnsub?.()
    this.#touchDraggingUnsub?.()
    this.#viewActiveUnsub?.()
    this.#beesUnsub?.()
    this.#voiceActiveUnsub?.()
    this.#showHiddenUnsub?.()
    this.#textOnlyUnsub?.()
    this.#clipboardAvailableUnsub?.()
    this.#clipboardOpenUnsub?.()
    this.#tagsUnsub?.()
    this.#tagFilterUnsub?.()
    this.#hoverTagsUnsub?.()
    this.#atomizeModeUnsub?.()
    this.#atomizeAtomsUnsub?.()
    this.#atomizeStrategyUnsub?.()
    this.#meshModalUnsub?.()
    this.#meshJoinUnsub?.()
    this.#lockBumpUnsub?.()
    this.#iconEditUnsub?.()
    this.#configureControlUnsub?.()
    this.#titleTickUnsub?.()
    this.#localeTickUnsub?.()
    iconOverrides.removeEventListener('change', this.#onIconOverride)
    this.#clearIconPress()
    this.#detachListDrag()   // in case we're torn down mid drag-scroll
    if (this.#lockBumpTimer) clearTimeout(this.#lockBumpTimer)
    window.removeEventListener('keydown', this.#onPowerKeyDown)
    window.removeEventListener('keyup', this.#onPowerKeyUp)
    window.removeEventListener('blur', this.#onPowerKeyReset)
  }

  // ── navigation actions ────────────────────────────────

  readonly goBack = (): void => {
    performance.mark('hypercomb:back:trigger')
    void this.movement.back()
  }

  // Mobile back button fires on pointerdown to save the press duration (~50–150ms)
  // over waiting for the synthesized click. `#backHandledOnDown` swallows the
  // click that would otherwise double-back. Desktop keeps `(click)` because its
  // back button is a cdkDrag target — firing early would race with the drag.
  #backHandledOnDown = false

  readonly onBackPointerDown = (event: PointerEvent): void => {
    if (!this.canGoBack()) return
    if (event.button !== undefined && event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    // Swallow the trailing pointermove / pointerup / click for this finger so
    // a tile that lands under it after navigation can't be activated.
    consumePointerGesture(event.pointerId)
    this.#backHandledOnDown = true
    this.goBack()
  }

  readonly onBackClick = (): void => {
    if (this.#backHandledOnDown) {
      this.#backHandledOnDown = false
      return
    }
    this.goBack()
  }

  readonly navigateTo = (segments: string[]): void => {
    this.navigation.goRaw(segments)
  }

  /** Home: jump to the root of the tree (empty segment path) — the domain
   *  root, i.e. hypercomb.io's home. Same target as clicking the leading
   *  domain crumb. Pinned to the top of the left-docked rail. */
  readonly goHome = (): void => {
    this.navigateTo([])
  }

  /** Start the guided beeing tour — the same entry point /tutorial uses, so
   *  the rail's bee and the slash behaviour run one identical tour. The drone
   *  ignores a second start while one is already running.
   *
   *  CTRL (or ⌘) + click opens the COURSE PICKER instead: the tour is four
   *  courses now (starter, then beginner → intermediate → expert), and the
   *  deeper ones need a way in that isn't typing a slash command. Plain click
   *  keeps meaning "just show me" — the starter tour, unchanged. */
  readonly startTutorial = (event?: MouseEvent): void => {
    if (event && (event.ctrlKey || event.metaKey)) {
      this.#openTourMenu(event)
      return
    }
    this.closeTourMenu()
    EffectBus.emit('tutorial:start', {})
  }

  // ── the course picker ─────────────────────────────────
  //
  // Fed by the tutorial's OWN lesson registry over IoC (never imported — a
  // shell surface must not depend on essentials), so the list is whatever
  // courses this build actually ships: a level with no lessons is not offered,
  // and a module that registers its own lessons shows up here for free.

  readonly tourMenuOpen = signal(false)
  readonly tourMenuPos = signal<{ x: number; y: number; flip: boolean }>({ x: 0, y: 0, flip: false })
  readonly tourCourses = signal<{ level: string; label: string; count: number }[]>([])

  #openTourMenu(event: MouseEvent): void {
    const registry = get<{ levels?: () => string[]; course?: (l: string) => unknown[] }>(
      '@diamondcoreprocessor.com/TutorialLessonRegistry')
    const levels = registry?.levels?.() ?? []
    if (levels.length === 0) {
      // No roster (the tutorial module isn't loaded) — fall back to the tour
      // rather than opening an empty menu.
      EffectBus.emit('tutorial:start', {})
      return
    }
    this.tourCourses.set(levels.map(level => ({
      level,
      label: this.#tourLabel(level),
      count: registry?.course?.(level)?.length ?? 0,
    })))

    // Fixed positioning off the button's own rect: the rail is a scrolling,
    // overflow-hidden box, so a menu rendered inside it would be clipped.
    const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect()
    const width = 232
    const x = rect ? rect.right + 10 : 12
    const flip = x + width > window.innerWidth - 8
    this.tourMenuPos.set({
      x: flip ? Math.max(8, (rect?.left ?? 12) - width - 10) : x,
      y: Math.min(Math.max(8, rect?.top ?? 12), Math.max(8, window.innerHeight - 260)),
      flip,
    })
    this.tourMenuOpen.set(true)
    window.addEventListener('pointerdown', this.#onTourMenuOutside, true)
    window.addEventListener('keydown', this.#onTourMenuKey, true)
  }

  readonly closeTourMenu = (): void => {
    if (!this.tourMenuOpen()) return
    this.tourMenuOpen.set(false)
    window.removeEventListener('pointerdown', this.#onTourMenuOutside, true)
    window.removeEventListener('keydown', this.#onTourMenuKey, true)
  }

  /** Fly the picked course. Same effect the slash behaviour raises, so the
   *  picker and `/tutorial <level>` are one path. */
  readonly pickTour = (level: string): void => {
    this.closeTourMenu()
    EffectBus.emit('tutorial:start', { level })
  }

  #tourLabel(level: string): string {
    const fallback: Record<string, string> = {
      starter: 'Starter tour', beginner: 'Beginner',
      intermediate: 'Intermediate', expert: 'Expert',
    }
    const key = `tutorial.level.${level}`
    const i18n = get<{ t?: (k: string) => string }>('@hypercomb.social/I18n')
    const resolved = i18n?.t?.(key)
    return resolved && resolved !== key ? resolved : (fallback[level] ?? level)
  }

  readonly #onTourMenuOutside = (event: PointerEvent): void => {
    const target = event.target as HTMLElement | null
    if (target?.closest?.('.tour-menu, .rail-tutorial')) return
    this.closeTourMenu()
  }

  readonly #onTourMenuKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    // Take Escape before the global cascade — the menu is the innermost thing
    // open, so it is what Escape must close.
    event.stopPropagation()
    event.preventDefault()
    this.closeTourMenu()
  }

  // ── view actions ──────────────────────────────────────

  readonly openDcp = (): void => {
    window.dispatchEvent(new CustomEvent('portal:open', { detail: { target: 'dcp' } }))
  }

  readonly centerView = (): void => {
    const host = this.pixiHost
    const container = host?.container
    const app = host?.app
    if (!container || !app) return

    // bounding box of all content in container's local space
    const bounds = container.getLocalBounds()
    const cx = bounds.x + bounds.width * 0.5
    const cy = bounds.y + bounds.height * 0.5

    // Offset the container so its content lands at the centre of the usable
    // viewport. A side-docked controls rail publishes the edge space it owns;
    // floating/mobile controls publish zero.
    const scale = container.scale?.x ?? 1
    const stageScale = app.stage.scale?.x || 1
    const usableCenter = this.#viewportCenter()

    // Keep the stage at the true screen centre (the persistence model's
    // zero-pan origin) and express the safe-area shift in container space.
    const s = app.renderer.screen
    app.stage.position.set(s.width * 0.5, s.height * 0.5)
    container.position.set(
      (usableCenter.x - s.width * 0.5) / stageScale - cx * scale,
      (usableCenter.y - s.height * 0.5) / stageScale - cy * scale,
    )

    // persist viewport state
    const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
    vp?.setZoom?.(scale, container.position.x, container.position.y)
    vp?.setPan?.(0, 0)
  }

  /**
   * Fit button click.
   * - Plain click: zoom-to-fit, persisted as a user gesture so the fit
   *   (fit:true) survives refresh and refits to the new viewport size.
   * - Ctrl/Meta+click: cycle state off → global → page → off.
   */
  readonly fitOrCenter = (event: MouseEvent): void => {
    if (event.ctrlKey || event.metaKey) {
      this.#cycleFitMode()
    } else {
      this.zoom?.zoomToFit?.(false, 'user')
    }
  }

  readonly fitContent = (): void => {
    this.zoom?.zoomToFit?.()
  }

  /** Advance the fit button through its three states. */
  #cycleFitMode(): void {
    const state = this.fitButtonState()
    if (state === 'off') {
      this.#enterGlobalFit()
    } else if (state === 'global') {
      this.#enterPageFit()
    } else {
      this.#clearFit()
    }
  }

  #enterGlobalFit(): void {
    this.#fitLockedSnapshot = this.#captureViewport()
    this.#fitMode.set('global')
    localStorage.setItem('hc:fit-mode', 'global')
    // Re-entering global fit clears any per-page exceptions.
    if (this.#fitDisabledPages().size > 0) {
      this.#fitDisabledPages.set(new Set())
      this.#persistFitDisabledPages(new Set())
    }
    const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
    vp?.suspend?.()
    this.zoom?.zoomToFit?.()
    this.#enableFitLocked()
  }

  #enterPageFit(): void {
    // Leaving global: let per-layer persistence resume, then pin current page.
    const wasGlobal = this.#fitMode() === 'global'
    if (wasGlobal) {
      this.#fitMode.set('off')
      localStorage.setItem('hc:fit-mode', 'off')
      // disabled-pages set is only meaningful under global — clear it.
      if (this.#fitDisabledPages().size > 0) {
        this.#fitDisabledPages.set(new Set())
        this.#persistFitDisabledPages(new Set())
      }
      const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
      vp?.resume?.()
    }
    const key = this.#currentPageKey()
    const next = new Set(this.#fitPinnedPages())
    next.add(key)
    this.#fitPinnedPages.set(next)
    this.#persistFitPinnedPages(next)
    this.zoom?.zoomToFit?.()
    // Keep the navigation:guard-end listener installed so return visits fit.
    this.#enableFitLocked()
  }

  #clearFit(): void {
    const wasGlobal = this.#fitMode() === 'global'
    this.#fitMode.set('off')
    localStorage.setItem('hc:fit-mode', 'off')
    // disabled-pages set is only meaningful under global — clear it.
    if (wasGlobal && this.#fitDisabledPages().size > 0) {
      this.#fitDisabledPages.set(new Set())
      this.#persistFitDisabledPages(new Set())
    }
    // Remove current page from pin set if present.
    const key = this.#currentPageKey()
    if (this.#fitPinnedPages().has(key)) {
      const next = new Set(this.#fitPinnedPages())
      next.delete(key)
      this.#fitPinnedPages.set(next)
      this.#persistFitPinnedPages(next)
    }
    const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
    if (wasGlobal) vp?.resume?.()
    // If no page pins remain anywhere, tear down the listener.
    if (this.#fitPinnedPages().size === 0 && this.#fitMode() === 'off') {
      this.#fitLockedUnsub?.()
      this.#fitLockedUnsub = null
    }
    if (wasGlobal) this.#restoreViewport()
  }

  #enableFitLocked(): void {
    if (this.#fitLockedUnsub) return
    // navigation:guard-end fires after all tiles are positioned and layer is visible.
    // Suspend persistence while auto-fitting so the fitted viewport doesn't
    // overwrite the saved per-page viewport; resume on pages that are not
    // auto-fitted so manual adjustments there persist normally.
    const unsub = EffectBus.on('navigation:guard-end', () => {
      const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
      if (this.fitLocked()) {
        vp?.suspend?.()
        this.zoom?.zoomToFit?.(true)
      } else {
        vp?.resume?.()
      }
    })
    this.#fitLockedUnsub = unsub
  }

  /**
   * Manual zoom/pan on the current page turns off its fit-lock only.
   * Other pages' pins (global or page-specific) stay intact.
   */
  #disableFitLockedPreservingCurrent(): void {
    const state = this.fitButtonState()
    if (state === 'off') return

    const key = this.#currentPageKey()
    if (state === 'page') {
      const next = new Set(this.#fitPinnedPages())
      next.delete(key)
      this.#fitPinnedPages.set(next)
      this.#persistFitPinnedPages(next)
    } else if (state === 'global') {
      // Keep global on for other pages; record this page as an exception.
      const next = new Set(this.#fitDisabledPages())
      next.add(key)
      this.#fitDisabledPages.set(next)
      this.#persistFitDisabledPages(next)
    }

    this.#fitLockedSnapshot = null

    // Resume persistence so the user's manual adjustment saves for this page.
    const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
    vp?.resume?.()

    // If nothing is pinned anywhere, tear down the navigation listener.
    if (this.#fitMode() === 'off' && this.#fitPinnedPages().size === 0) {
      this.#fitLockedUnsub?.()
      this.#fitLockedUnsub = null
    }
  }

  #captureViewport(): { scale: number; cx: number; cy: number; dx: number; dy: number } | null {
    const host = this.pixiHost
    const container = host?.container
    const app = host?.app
    if (!container || !app) return null
    const s = app.renderer.screen
    return {
      scale: container.scale?.x ?? 1,
      cx: container.position.x,
      cy: container.position.y,
      dx: app.stage.position.x - s.width * 0.5,
      dy: app.stage.position.y - s.height * 0.5,
    }
  }

  #restoreViewport(): void {
    const snap = this.#fitLockedSnapshot
    if (!snap) return
    this.#fitLockedSnapshot = null

    const host = this.pixiHost
    const container = host?.container
    const app = host?.app
    if (!container || !app) return

    const s = app.renderer.screen
    container.scale.set(snap.scale)
    container.position.set(snap.cx, snap.cy)
    app.stage.position.set(s.width * 0.5 + snap.dx, s.height * 0.5 + snap.dy)

    // persist restored state
    const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
    vp?.setZoom?.(snap.scale, snap.cx, snap.cy)
    vp?.setPan?.(snap.dx, snap.dy)
  }

  readonly togglePin = (): void => {
    // The pin is a per-LAYER setting: the click flips THIS page's membership
    // in the pinned set and `#pinSync` derives the InputGate lock from it. We
    // never read the gate's combined state here — an overlay (editor, notes
    // strip) holding its own lock would otherwise make the toggle look stuck.
    const key = this.#currentPageKey()
    const next = new Set(this.#pinnedPages())
    if (next.has(key)) next.delete(key)
    else next.add(key)
    this.#pinnedPages.set(next)
    this.#persistPinnedPages(next)
  }

  readonly zoomIn = (): void => {
    if (this.#locked()) return
    const center = this.#viewportCenter()
    this.zoom?.zoomByFactor?.(1.25, center, 'controls-bar')
    this.zoom?.end?.('controls-bar')
  }

  readonly zoomOut = (): void => {
    if (this.#locked()) return
    const center = this.#viewportCenter()
    this.zoom?.zoomByFactor?.(0.8, center, 'controls-bar')
    this.zoom?.end?.('controls-bar')
  }

  readonly toggleFullscreen = (): void => {
    // The window resize handler maintains the pill's bottom-anchor on
    // fullscreen change, but resize can lag fullscreenchange on some
    // browsers. We capture the current bottom-anchor and re-apply it
    // explicitly when fullscreen settles as belt-and-braces.
    const pos = this.#pillPos()
    const fromBottom = pos
      ? (this.#pillFromBottom ?? (window.innerHeight - pos.y))
      : null

    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void document.documentElement.requestFullscreen()
    }

    if (fromBottom !== null && pos) {
      const adjust = (): void => {
        document.removeEventListener('fullscreenchange', adjust)
        this.#pillFromBottom = fromBottom
        const adjusted = this.#clampPillPos(pos.x, window.innerHeight - fromBottom)
        this.#pillPos.set(adjusted)
        try {
          localStorage.setItem(
            PILL_POS_KEY,
            JSON.stringify({ x: adjusted.x, fromBottom }),
          )
        } catch { /* ignore */ }
      }
      document.addEventListener('fullscreenchange', adjust)
    }
  }

  /** Mobile center-button double-tap: cycle fit mode (same as ctrl+click). */
  readonly lockFit = (): void => {
    this.#cycleFitMode()
  }

  // ── push-to-talk (mobile mic button) ─────────────────────

  private get voiceService(): VoiceInputService | undefined {
    return get('@hypercomb.social/VoiceInputService') as VoiceInputService | undefined
  }

  /** Pointerdown on mic: start recording. */
  readonly startVoice = (event: PointerEvent): void => {
    ;(event.target as HTMLElement)?.setPointerCapture?.(event.pointerId)
    this.voiceService?.start()
  }

  /** Pointerup/leave on mic: stop. VoiceInputService emits voice:submit
   * which the command-line listens for and turns into a tile. */
  readonly stopVoice = (): void => {
    this.voiceService?.stop()
  }

  // The mobile mic button moved OFF this bar and into the command line — the
  // words it dictates land in that text box, so the control belongs beside it,
  // and the bar slot it freed went to fit ("centre the screen"). The
  // `mobile:mic:press` / `:release` state machine it drove is unchanged; the
  // command line now emits it directly. See command-line.component.

  // ── utility actions (emit effects for drones) ─────────

  readonly cut = (): void => {
    EffectBus.emit('controls:action', { action: 'cut' })
  }

  readonly copy = (): void => {
    EffectBus.emit('controls:action', { action: 'copy' })
  }

  readonly remove = (): void => {
    EffectBus.emit('controls:action', { action: 'remove' })
  }

  readonly moveItem = (): void => {
    EffectBus.emit('controls:action', { action: 'move' })
  }

  /** Promote the selected tiles one level up — move.drone answers. */
  readonly promoteToParent = (): void => {
    EffectBus.emit('controls:action', { action: 'promote-to-parent' })
  }

  /** Bulk privacy on the selection (world mode) — tile-actions.drone answers. */
  readonly makePublic = (): void => {
    EffectBus.emit('controls:action', { action: 'make-public' })
  }

  readonly makeBranchPublic = (): void => {
    EffectBus.emit('controls:action', { action: 'make-branch-public' })
  }

  readonly toggleTextOnly = (): void => {
    const next = !this.#textOnly()
    this.#textOnly.set(next)
    EffectBus.emit('render:set-text-only', { textOnly: next })
  }

  readonly toggleLayout = (): void => {
    // Dense/spiral layout has been phased out — pinned is the only
    // mode. Toggle is a no-op kept for action-map compatibility.
  }

  readonly toggleMeshPublic = (): void => {
    // Going PUBLIC routes through the location dialog first: pop it in JOIN
    // mode (primary button reads "start"); the actual flip happens on
    // confirm via the 'mesh:join' effect below — configure where, start,
    // you're in the swarm. Going PRIVATE stays one click.
    if (!this.meshPublic()) {
      EffectBus.emit('mesh:open-modal', { join: true })
      return
    }
    this.meshToggled.emit()
  }

  readonly toggleClipboard = async (): Promise<void> => {
    if (!this.#clipboardAvailable()) return

    // Already open → just close it. No validate/isEmpty dance needed to
    // hide the panel, and skipping it keeps the close instant.
    if (this.#clipboardPanelOpen()) {
      EffectBus.emit('clipboard:panel', { visible: false })
      return
    }

    // Opening must NEVER mutate the clipboard — viewing your items can't lose
    // them. (The old `validate()` ghost-sweep on open could drop live entries
    // on a cold read; ghost cleanup now happens only on restore.) Just bail if
    // there's genuinely nothing to show.
    const clipSvc = get('@diamondcoreprocessor.com/ClipboardService') as
      { items?: { label: string; sourceSegments: readonly string[] }[]; operation?: 'cut' | 'copy'; isEmpty?: boolean } | undefined
    if (clipSvc?.isEmpty) return

    // Open the non-navigating clipboard SIDE PANEL. The current page stays
    // fully rendered and interactive behind it — no `'clipboard'` mode, no
    // `clipboard:view` page-replacement, no viewport snapshot/restore dance.
    // The panel (hc-clipboard-panel) lists the captured tiles and places
    // them onto THIS page in place.
    EffectBus.emit('clipboard:panel', { visible: true })
  }

  // ── atomize ──────────────────────────────────────────

  readonly STRATEGY_NAMES = ['shatter', 'orbital', 'blueprint', 'cascade', 'particle'] as const

  readonly setAtomizeStrategy = (strategy: string): void => {
    EffectBus.emit('atomize:set-strategy', { strategy })
  }

  readonly closeAtomize = (): void => {
    EffectBus.emit('atomize:close', {})
    this.#mode.set('browsing')
  }

  readonly reassemble = (): void => {
    this.closeAtomize()
  }

  // ── bees ────────────────────────────────────────────

  readonly toggleBees = (): void => {
    const next = !this.#beesVisible()
    this.#beesVisible.set(next)
    localStorage.setItem('hc:bees-visible', String(next))
    EffectBus.emit('render:set-bees-visible', { visible: next })
  }

  // ── show hidden items ────────────────────────────────

  readonly toggleShowHidden = (): void => {
    const next = !this.#showHidden()
    this.#showHidden.set(next)
    localStorage.setItem('hc:show-hidden', next ? '1' : '0')
    EffectBus.emit('visibility:show-hidden', { active: next })
  }


  // ── voice ────────────────────────────────────────────

  readonly toggleVoice = (): void => {
    const svc = get('@hypercomb.social/VoiceInputService') as { toggle?: () => void } | undefined
    svc?.toggle?.()
  }

  // ── room ────────────────────────────────────────────
  // (the location icon is gone — the dialog opens via toggleMeshPublic's
  // join flow; see above)

  // ── hover / idle ──────────────────────────────────────

  readonly onBarEnter = (): void => { this.#hovered.set(true) }
  readonly onBarLeave = (): void => { this.#hovered.set(false) }

  // ── wheel ─────────────────────────────────────────────
  // The whole bar is [data-consumes-wheel], so the wheel never reaches the
  // hive while the pointer is over it. Inside the icon list the browser
  // scrolls natively and this does nothing; over the grip or the pinned
  // footer there is nothing to scroll natively, so forward the delta to the
  // list — the bar reads as ONE scroll surface rather than a scrollable
  // middle with dead ends.
  readonly onBarWheel = (event: WheelEvent): void => {
    const bar = event.currentTarget as HTMLElement | null
    const list = bar?.querySelector('.controls-row')
    if (!list || !(event.target instanceof Node)) return
    if (list.contains(event.target)) return          // native scroll handles it
    if (list.scrollHeight <= list.clientHeight) return
    list.scrollBy(0, event.deltaY)
    event.preventDefault()
  }

  // ── drag-to-scroll ────────────────────────────────────
  // Press anywhere in the icon list — including ON an icon — and drag to
  // scroll it, the same movement the wheel makes. Past DRAG_SLOP_PX the
  // gesture has committed to scrolling, so the icon under the pointer must
  // NOT fire when the button comes back up; #swallowNextClick eats the
  // trailing click in the capture phase (see #installClickSwallow), which
  // covers every button in the list rather than each handler opting in.
  //
  // Mouse and pen only: a touch drag already scrolls the box natively, and
  // running both would scroll it twice per pixel.
  readonly dragScrolling = signal(false)
  #dragList: HTMLElement | null = null
  #dragPointerId: number | null = null
  #dragStartY = 0
  #dragStartScroll = 0
  #dragPassedSlop = false
  #swallowNextClick = false

  readonly onListDragStart = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' || event.button !== 0) return
    const list = event.currentTarget as HTMLElement | null
    if (!list || list.scrollHeight <= list.clientHeight) return
    this.#swallowNextClick = false
    this.#dragList = list
    this.#dragPointerId = event.pointerId
    this.#dragStartY = event.clientY
    this.#dragStartScroll = list.scrollTop
    this.#dragPassedSlop = false
    window.addEventListener('pointermove', this.#onListDragMove)
    window.addEventListener('pointerup', this.#onListDragEnd)
    window.addEventListener('pointercancel', this.#onListDragEnd)
  }

  #onListDragMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#dragPointerId || !this.#dragList) return
    const dy = event.clientY - this.#dragStartY
    if (!this.#dragPassedSlop) {
      if (Math.abs(dy) < DRAG_SLOP_PX) return
      this.#dragPassedSlop = true
      this.dragScrolling.set(true)
      // A drag is not a long-press — cancel the icon-edit timer it started.
      this.#clearIconPress()
    }
    // Content follows the pointer: drag up → later icons come into view.
    this.#dragList.scrollTop = this.#dragStartScroll - dy
  }

  #detachListDrag(): void {
    window.removeEventListener('pointermove', this.#onListDragMove)
    window.removeEventListener('pointerup', this.#onListDragEnd)
    window.removeEventListener('pointercancel', this.#onListDragEnd)
  }

  #onListDragEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.#dragPointerId) return
    this.#detachListDrag()
    this.#dragPointerId = null
    this.#dragList = null
    this.dragScrolling.set(false)
    if (!this.#dragPassedSlop) return
    this.#dragPassedSlop = false
    // The click generated by this release belongs to the scroll. It arrives
    // in the same task, so clear the flag on the next tick — otherwise a
    // release that produces no click at all would eat a later real one.
    this.#swallowNextClick = true
    setTimeout(() => { this.#swallowNextClick = false }, 0)
  }

  /** Capture-phase guard on the host: kills the click that trails a
   *  drag-scroll before it reaches any button underneath. */
  #installClickSwallow(): void {
    this.#host.nativeElement.addEventListener('click', (event: Event) => {
      if (!this.#swallowNextClick) return
      this.#swallowNextClick = false
      event.stopPropagation()
      event.preventDefault()
    }, { capture: true })
  }

  // ── swipe-to-go-back (right-to-left from right edge) ──

  #onSwipeStart = (e: TouchEvent): void => {
    if (!this.isMobile() || !this.canGoBack()) return
    const touch = e.touches[0]
    // only start from the right 40px edge of the screen
    if (touch.clientX < window.innerWidth - this.#SWIPE_EDGE_ZONE) return
    this.#swipeStartX = touch.clientX
    this.#swipeStartY = touch.clientY
    this.#swipeActive = true
  }

  #onSwipeMove = (e: TouchEvent): void => {
    if (!this.#swipeActive) return
    const touch = e.touches[0]
    const dx = this.#swipeStartX - touch.clientX  // positive = left swipe
    const dy = Math.abs(touch.clientY - this.#swipeStartY)

    // check angle — must be mostly horizontal
    const angle = Math.atan2(dy, Math.abs(dx)) * (180 / Math.PI)
    if (angle > this.#SWIPE_ANGLE_MAX) {
      this.#swipeActive = false
      this.swipeIndicatorActive.set(false)
      return
    }

    // show indicator when swiping left past 20px
    this.swipeIndicatorActive.set(dx > 20)
  }

  #onSwipeEnd = (e: TouchEvent): void => {
    if (!this.#swipeActive) {
      this.swipeIndicatorActive.set(false)
      return
    }

    const touch = e.changedTouches[0]
    const dx = this.#swipeStartX - touch.clientX

    this.#swipeActive = false
    this.swipeIndicatorActive.set(false)

    if (dx >= this.#SWIPE_THRESHOLD && this.canGoBack()) {
      this.goBack()
    }
  }

  // ── internal ────────────────────────────────────────────

  #onResize = (): void => {
    // A side-docked pill is CSS-centered on its edge (and height-capped with
    // an internal scroll), so it survives any resize untouched. For a free
    // pill, keep it anchored to the bottom of the viewport: when innerHeight
    // changes (rotation, fullscreen, devtools, mobile address bar), recompute
    // y from #pillFromBottom so it doesn't drift over the tile render area.
    // If the recomputed rect no longer fully fits, reset to the left dock.
    if (!this.#dockSide()) {
      const pos = this.#pillPos()
      if (pos) {
        const fromBottom = this.#pillFromBottom ?? (window.innerHeight - pos.y)
        this.#pillFromBottom = fromBottom
        const newY = window.innerHeight - fromBottom
        if (this.#fitsOnScreen(pos.x, newY)) {
          this.#pillPos.set({ x: pos.x, y: newY })
        } else {
          this.#resetToDefault()
        }
      }
    }
    // recompute pill zoom for new viewport width
    this.#pillZoom.set(this.#computePillZoom())
  }

  // ── pill drag-to-move ─────────────────────────────────────

  readonly onPillDragStart = (e: PointerEvent): void => {
    e.preventDefault()
    const stage = (e.currentTarget as HTMLElement)?.closest('.pill-stage') as HTMLElement | null
    if (!stage) return
    this.#pillStageEl = stage
    const rect = stage.getBoundingClientRect()
    // Start from current visual position (whether default or persisted).
    const startX = rect.left
    const startY = rect.top
    this.#pillDragOffsetX = e.clientX - startX
    this.#pillDragOffsetY = e.clientY - startY
    this.#pillPointerId = e.pointerId
    this.#pillDragging.set(true)
    // Commit to explicit coords on first move so the transform override
    // (translateX(-50%)) no longer fights us.
    this.#pillPos.set({ x: startX, y: startY })
    window.addEventListener('pointermove', this.#onPillDragMove)
    window.addEventListener('pointerup', this.#onPillDragEnd)
  }

  #onPillDragMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.#pillPointerId) return
    const prevSide = this.#dockSide()
    const side = this.#detectDockSide(e.clientX)
    if (side !== prevSide) {
      this.#dockSide.set(side)
      if (side === null) {
        // Undocking: re-anchor the grab point to the grip so the pill
        // re-flows horizontally under the cursor instead of jumping.
        this.#pillDragOffsetX = 24
        this.#pillDragOffsetY = 18
      }
    }
    if (side === null) {
      // Free-follow the pointer. Intentionally unclamped — the pill may be
      // dragged partly offscreen; on release an offscreen pill resets to
      // the left-dock default (see #onPillDragEnd).
      this.#pillPos.set({
        x: e.clientX - this.#pillDragOffsetX,
        y: e.clientY - this.#pillDragOffsetY,
      })
    }
  }

  #onPillDragEnd = (e: PointerEvent): void => {
    if (e.pointerId !== this.#pillPointerId) return
    this.#pillPointerId = null
    this.#pillDragging.set(false)

    const side = this.#dockSide()
    if (side) {
      // Locked to an edge as a vertical toolbar.
      this.#persistDock(side)
    } else {
      const pos = this.#pillPos()
      if (pos && this.#fitsOnScreen(pos.x, pos.y)) {
        // Free-floating, fully on-screen. Lock in the bottom-anchor distance
        // so subsequent resizes keep it the same height above the bottom.
        this.#pillFromBottom = window.innerHeight - pos.y
        this.#persistFree(pos)
      } else {
        // Any part offscreen → snap back to the left-dock default.
        this.#resetToDefault()
      }
    }

    window.removeEventListener('pointermove', this.#onPillDragMove)
    window.removeEventListener('pointerup', this.#onPillDragEnd)
  }

  /**
   * Which edge (if any) the pointer is currently over, for side-docking.
   * Hysteresis: once docked you must drag past a wider `exit` band to
   * detach, so the pill doesn't flicker between vertical/horizontal when
   * the cursor hovers the boundary.
   */
  #detectDockSide(clientX: number): 'left' | 'right' | null {
    const w = window.innerWidth
    const enter = this.#SNAP_ZONE
    const exit = this.#SNAP_ZONE + 48
    const cur = this.#dockSide()
    if (cur === 'left')  return clientX <= exit ? 'left' : (clientX >= w - enter ? 'right' : null)
    if (cur === 'right') return clientX >= w - exit ? 'right' : (clientX <= enter ? 'left' : null)
    if (clientX <= enter) return 'left'
    if (clientX >= w - enter) return 'right'
    return null
  }

  /** True when the pill at (x, y) sits fully within the viewport. */
  #fitsOnScreen(x: number, y: number): boolean {
    if (!this.#pillStageEl) {
      this.#pillStageEl = this.#host.nativeElement.querySelector('.pill-stage')
    }
    const w = this.#pillStageEl?.offsetWidth ?? 0
    const h = this.#pillStageEl?.offsetHeight ?? 0
    return x >= 0 && y >= 0 && x + w <= window.innerWidth && y + h <= window.innerHeight
  }

  #persistDock(side: 'left' | 'right'): void {
    // Docked pills are CSS-positioned; clear the free coords so the px
    // bindings switch off and the .dock-* rules take over.
    this.#pillPos.set(null)
    this.#pillFromBottom = null
    try {
      localStorage.setItem(PILL_POS_KEY, JSON.stringify({ dock: side }))
    } catch { /* ignore */ }
  }

  #persistFree(pos: { x: number; y: number }): void {
    try {
      localStorage.setItem(
        PILL_POS_KEY,
        JSON.stringify({ x: pos.x, fromBottom: this.#pillFromBottom }),
      )
    } catch { /* ignore */ }
  }

  #resetToDefault(): void {
    // The default is the left-edge dock (a full-height rail that always fits),
    // so reset lands there rather than the old center-bottom float.
    this.#dockSide.set('left')
    this.#pillPos.set(null)
    this.#pillFromBottom = null
    try { localStorage.removeItem(PILL_POS_KEY) } catch { /* ignore */ }
  }

  #clampPillPos(x: number, y: number): { x: number; y: number } {
    // Lazily resolve the stage element so clamping is accurate even
    // before the first drag (window resize, localStorage restore).
    if (!this.#pillStageEl) {
      this.#pillStageEl = this.#host.nativeElement.querySelector('.pill-stage')
    }
    const w = this.#pillStageEl?.offsetWidth ?? 0
    const h = this.#pillStageEl?.offsetHeight ?? 0
    const maxX = Math.max(0, window.innerWidth - w)
    const maxY = Math.max(0, window.innerHeight - h)
    return {
      x: Math.max(0, Math.min(x, maxX)),
      y: Math.max(0, Math.min(y, maxY)),
    }
  }

  #restorePillPos(): void {
    try {
      const raw = localStorage.getItem(PILL_POS_KEY)
      // No persisted position → default to the left-edge dock on desktop.
      // The template gates dockSide on !isMobile(), so the mobile floating
      // strip is unaffected. Once the user drags the pill anywhere, the
      // persisted position takes over on subsequent loads.
      if (!raw) {
        this.#dockSide.set('left')
        return
      }
      const parsed = JSON.parse(raw) as { x?: number; y?: number; fromBottom?: number; dock?: 'left' | 'right' }
      // Docked to a side — CSS positions the vertical toolbar on the edge,
      // so no free coords are needed.
      if (parsed?.dock === 'left' || parsed?.dock === 'right') {
        this.#dockSide.set(parsed.dock)
        return
      }
      if (typeof parsed?.x !== 'number') return
      // New format: {x, fromBottom} — recompute y against the current
      // viewport so cross-session resizes don't leave the pill stranded.
      if (typeof parsed.fromBottom === 'number') {
        this.#pillFromBottom = parsed.fromBottom
        this.#pillPos.set({ x: parsed.x, y: window.innerHeight - parsed.fromBottom })
        return
      }
      // Legacy format: {x, y} (absolute top). Use as-is and seed the
      // bottom-anchor from current viewport for subsequent resizes.
      if (typeof parsed.y === 'number') {
        this.#pillFromBottom = window.innerHeight - parsed.y
        this.#pillPos.set({ x: parsed.x, y: parsed.y })
      }
    } catch { /* ignore */ }
  }

  #onActivity = (): void => {
    this.#idle.set(false)
    this.#resetIdleTimer()
  }

  #resetIdleTimer = (): void => {
    if (this.#idleTimer) clearTimeout(this.#idleTimer)
    this.#idleTimer = setTimeout(() => this.#idle.set(true), this.#IDLE_DELAY)
  }

  // ── power key tracking ────────────────────────────────

  #onPowerKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Control' || e.key === 'Meta') this.powerKey.set('ctrl')
    else if (e.key === 'Shift') this.powerKey.set('shift')
    else if (e.key === 'Alt') this.powerKey.set('alt')
  }

  #onPowerKeyUp = (e: KeyboardEvent): void => {
    const k = this.powerKey()
    if ((k === 'ctrl' && (e.key === 'Control' || e.key === 'Meta'))
      || (k === 'shift' && e.key === 'Shift')
      || (k === 'alt' && e.key === 'Alt')) {
      this.powerKey.set(null)
    }
  }

  #onPowerKeyReset = (): void => { this.powerKey.set(null) }
}

/** Deterministic vibrant HSL color from a tag name — avoids grays. */
function tagNameToColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  const hue = ((hash >>> 0) % 360)
  return `hsl(${hue}, 70%, 65%)`
}

/** Extract hue (0-360) from any CSS color string for sorting. */
function extractHue(color: string): number {
  // fast path: hsl(H, ...)
  const hslMatch = color.match(/hsl\(\s*(\d+)/)
  if (hslMatch) return parseInt(hslMatch[1], 10)

  // rgb(...) or hex → convert to hue
  let r = 0, g = 0, b = 0
  const rgbMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgbMatch) {
    r = parseInt(rgbMatch[1], 10) / 255
    g = parseInt(rgbMatch[2], 10) / 255
    b = parseInt(rgbMatch[3], 10) / 255
  } else if (color.startsWith('#')) {
    const hex = color.length === 4
      ? color[1] + color[1] + color[2] + color[2] + color[3] + color[3]
      : color.slice(1, 7)
    r = parseInt(hex.slice(0, 2), 16) / 255
    g = parseInt(hex.slice(2, 4), 16) / 255
    b = parseInt(hex.slice(4, 6), 16) / 255
  } else {
    return 0
  }

  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  let h = 0
  if (max === r) h = ((g - b) / d + 6) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return Math.round(h * 60)
}
