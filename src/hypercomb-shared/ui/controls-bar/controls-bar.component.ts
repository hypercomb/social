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
import type { RecentPortal, RecentPortalsStore } from '../../core/recent-portals.store'
import { clearLaneWithUndo } from '../docked-panel/dock-lanes'
import { isWindowShowing } from '../window-session'
import { showHiveRoot } from '../../core/home-root'
import type { RoomStore } from '../../core/room-store'
import type { SecretStore } from '../../core/secret-store'
import type { InstallMonitor } from '../../core/install-monitor'
import { VoiceInputService } from '../../core/voice-input.service'
import { secretTag } from '@hypercomb/core'

const PILL_POS_KEY = 'hc:controls-pill-pos'
const ENABLED_MAP_KEY = 'hc:controls-enabled-map'
/** The participant's own order for the rail — a full permutation of control
 *  ids, written the first time one is dragged into a new position. Absent (or
 *  empty) means the registry order below stands. Ids the stored order never saw
 *  (controls added after it was written) are placed beside the registry
 *  neighbour they were authored next to — see #orderedRegistry — so a new
 *  control still lands where its author put it instead of at the far end. */
const ORDER_KEY = 'hc:controls-order'
/** Bumped when a default flip has to reclaim ids a legacy FULL map froze.
 *  Rev 1: the magnifiers came off the rail (bab6045d), but every map written
 *  before that carried `zoom-in`/`zoom-out: true`, so the flip never reached
 *  anyone who had ever opened edit mode — the icons kept coming back. */
const ENABLED_REV_KEY = 'hc:controls-enabled-rev'
const ENABLED_REV = 1
const RECLAIMED_BY_REV: Record<number, readonly string[]> = {
  1: ['zoom-in', 'zoom-out'],
}
/** Page keys (lineage paths) whose viewport is pinned. The pin is per LAYER. */
const PINNED_PAGES_KEY = 'hc:pinned-pages'
/** Partial pins — per-page exceptions the fit flyout sets. Size-pinned pages
 *  keep their zoom when a fit runs (only recentre); position-pinned pages keep
 *  their centre (only rescale). Both at once holds the whole viewport against
 *  fits WITHOUT the full pin's input lock. */
const PINNED_SIZE_PAGES_KEY = 'hc:pinned-size-pages'
const PINNED_POSITION_PAGES_KEY = 'hc:pinned-position-pages'
/** Pages the participant has framed BY HAND (a zoom or pan gesture made while
 *  global fit was on). Global fit never touches these again — a viewport you
 *  set yourself is remembered, always. Same per-page key model as the pins,
 *  persisted for the same reason: the framing has to survive walking away. */
const HAND_FRAMED_PAGES_KEY = 'hc:hand-framed-pages'

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
  visibleWhen: 'always' | 'voiceSupported' | 'public' | 'hasSelection'
}

const CONTROL_REGISTRY: readonly ControlItem[] = [
  { id: 'back',         label: 'controls.back',         action: 'goBack',             visibleWhen: 'always' },
  // Portals sits DIRECTLY after the installer: both are ways OUT of the current
  // page — DCP into other domains, Portals into the collections index — so they
  // read as one pair at the head of the rail, before the viewport controls.
  // Navigates to the `sets/` layer, where each tile is a reference set (see
  // documentation/entrances-and-sets.md). Not among the header aggregates — it
  // manages referenced hives on different roots; it is not a launch group.
  { id: 'pools',        label: 'collections-landing.title', action: 'openPools',      visibleWhen: 'always' },
  // NO CHAT ENTRY. This bar is how-you-SEE — fit, zoom, pin, fullscreen,
  // orientation — and talking is not one of those; the assistant sits on the
  // command line beside the box you type into (command-shell's
  // chat-toggle-btn), reachable from anywhere with `c`. Leaving a registry
  // entry here would put a second opener on a bar that no longer owns the
  // act, in a place that says nothing about what it does.
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
  { id: 'sequences',    label: 'sequence.library',          action: 'openSequences',    visibleWhen: 'always' },
  // The publish differential — what the world is serving, next to what has
  // changed here since. Slash-first (`/publish`), so like `sequences` it stays
  // off the rail until the participant enables it from inside its own window.
  { id: 'publish',      label: 'controls.publish',      action: 'togglePublish',      visibleWhen: 'always' },
  // THREE WINDOWS THAT DECLARED A LAUNCHER AND HAD NOWHERE TO LAND.
  // `hcDockedPanel`'s settings gear offers "Add to controls" for any window
  // carrying a `launcherControlId`, and writes `hc:controls-enabled-map[<id>]`.
  // hosts, comfy and aliases all declared one — with no entry here the map was
  // written, the switch read as ON, and nothing ever appeared on the rail. Off
  // by default like sequences and publish: the window's own gear is what puts
  // it there.
  { id: 'hosts',        label: 'hosts.title',           action: 'toggleHosts',        visibleWhen: 'always' },
  { id: 'comfy',        label: 'comfy.title',           action: 'openComfy',          visibleWhen: 'always' },
  { id: 'aliases',      label: 'aliases.title',         action: 'openAliases',        visibleWhen: 'always' },
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
  // The clipboard icon opens the window — and the window is a SWAP now (click a
  // tile on the hive and it lands there), so it is worth opening on an empty
  // clipboard too. That makes it an ordinary rail icon rather than a
  // state-gated one: no `clipboardHasItems`, just the enable switch every other
  // control has. It defaults MUTED (see DEFAULT_ENABLED_MAP) — turn it on in
  // edit mode if you want it — and carries the held count as its badge.
  { id: 'clipboard',    label: 'controls.clipboard',    action: 'toggleClipboard',    visibleWhen: 'always' },
  { id: 'voice',        label: 'controls.voice',        action: 'toggleVoice',        visibleWhen: 'voiceSupported' },
  // 'room' (the location icon) is gone from the bar — the location dialog now
  // pops as the JOIN step when the participant flips solo → public (see
  // toggleMeshPublic below): configure where, press start, you're in the swarm.
  { id: 'bees',         label: 'controls.toggle-bees',  action: 'toggleBees',         visibleWhen: 'public' },
  // 'feedback' is gone from the bar — the bottom-right document cluster's
  // feedback toggle (edit-actions, left of the rotate icon) opens the
  // combined panel (inbox list + share form) now.
]

// First-time defaults: items the previous primary-row had on stay enabled,
// items the previous expand-row had become muted (grayed). Once a user toggles
// anything in edit mode the persisted map takes over.
const DEFAULT_ENABLED_MAP: Record<string, boolean> = {
  // The magnifiers default OFF: the wheel owns zoom, and their verbs live in
  // the fit flyout now. Edit mode re-enables them for trackpad-less setups.
  'back': true, 'fit': true, 'zoom-out': false, 'zoom-in': false, 'pin': true, 'fullscreen': true,
  'text-only': false,
  'pools': true,
  'chat': false,
  'sequences': false,
  'publish': false,
  'hosts': false,
  'comfy': false,
  'aliases': false,
  // Selection verbs default ON (they only appear while a selection exists;
  // the retired floating menu was the old primary path).
  'promote-to-parent': true,
  // Clipboard defaults OFF: it is no longer state-gated, so leaving it on would
  // put a permanent icon on every rail. Enable it in edit mode. Copy/cut still
  // pop the window open on their own — this icon is the way BACK in.
  'clipboard': false, 'voice': false, 'bees': false,
}

/** Only the entries that DIFFER from the current default. Storing the whole map
 *  froze every control at whatever the default was the day it was written, so a
 *  later default flip could never reach an existing user — an id the user never
 *  touched still won over the new value. Persist overrides, and anything absent
 *  follows the current default forever. */
function overridesOf(map: Record<string, boolean>): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const [id, on] of Object.entries(map)) {
    if ((DEFAULT_ENABLED_MAP[id] ?? true) !== on) out[id] = on
  }
  return out
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

  /** True in the MOBILE experience — MobileModeService's verdict (a coarse
   *  pointer AND a phone-shaped viewport, or the `/mobile on|off` override),
   *  read from its last-value-replayed `mobile:mode` effect. The bar used to
   *  keep its own media query, so `/mobile on` on a desktop switched on the
   *  select pill, the rails and the deck while the bar stayed a desktop rail,
   *  and a narrow desktop window showed the phone bar over a hive that had
   *  none of them. One definition, and the chrome cannot disagree with it. */
  readonly isMobile = signal(false)
  /** True when device is in landscape orientation AND mobile. */
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
  /** The icon rows above the bar (right of the rail in landscape). Five to a
   *  row, and it WRAPS — a sixth control starts a second row above the first,
   *  so the stack grows up from the bar and the bottom row never squeezes. */
  readonly viewRowOpen = signal(false)
  /** Controls currently in the row. Five per row; the lift below follows it, so
   *  adding a control here is the whole change — nothing else measures. */
  readonly #viewRowCount = 4
  /** How far anything floating above the bar must lift to clear the view row.
   *  Published as a CSS variable so body-appended chrome (the select pill)
   *  moves with it without a second event contract. One row is 4.6rem; each
   *  further row adds its own height plus the gap. */
  #setViewRowLift = (open: boolean): void => {
    const rows = Math.max(1, Math.ceil(this.#viewRowCount / 5))
    const lift = open ? `${(4.6 + (rows - 1) * 3.4).toFixed(2)}rem` : '0px'
    document.documentElement.style.setProperty('--hc-mobile-row-lift', lift)
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
  #landscapeQuery: MediaQueryList | null = null
  #mobileModeUnsub: (() => void) | null = null
  /** The mobile verdict BEFORE the service's replay lands (in the web shell
   *  essentials arrive from OPFS after this component mounts): the stamp the
   *  service leaves on <html>, else the service itself if it is already up. */
  #seedMobile(): boolean {
    const stamped = document.documentElement.getAttribute('data-hc-mobile')
    if (stamped === 'on') return true
    if (stamped === 'off') return false
    return !!(get('@diamondcoreprocessor.com/MobileMode') as { active?: boolean } | undefined)?.active
  }
  #setMobile = (active: boolean): void => {
    this.isMobile.set(active)
    this.isLandscape.set((this.#landscapeQuery?.matches ?? false) && active)
    this.#syncInputVisibility()
    this.#publishKeyboardInset()
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
  // 'browsing' is the only mode left — the retired atomize surface was the
  // second variant, and the template still switches on this signal.
  #mode = signal<'browsing'>('browsing')
  #clipboardItems = signal<string[]>([])
  #roomOpen = signal(false)
  #beesVisible = signal(localStorage.getItem('hc:bees-visible') === 'true')
  #agentsVisible = signal(localStorage.getItem('hc:agents-visible') !== 'false')
  #showHidden = signal(localStorage.getItem('hc:show-hidden') === '1')
  // Fit button is a two-state switch:
  //  - 'off'    (white): regular click performs a one-shot fit; nothing sticks
  //  - 'global' (green): every layer auto-fits on navigation, everywhere,
  //                      until it is turned off from this same button.
  // While the switch is on, ARRIVING anywhere fits — but only on pages you
  // have never framed yourself. Manually zooming/panning does NOT turn the
  // switch off; it hands that ONE page to you permanently (`#handFramedPages`,
  // persisted), because a viewport you set by hand is remembered, always. Walk
  // away and return and your framing is still there — global fit keeps owning
  // every page you never touched. Clicking fit on a page gives it back to the
  // switch; flipping the switch on again forgets every hand framing at once.
  // Pinned pages (`#pinnedPages`) are exempt for the same reason.
  #fitMode = signal<'off' | 'global'>(
    localStorage.getItem('hc:fit-mode') === 'global' || localStorage.getItem('hc:fit-locked') === '1'
      ? 'global'
      : 'off',
  )
  // Pages whose viewport the participant set by hand. Written on the first
  // pan/zoom gesture made there while global fit is on, and NEVER cleared by
  // arriving — that per-visit reset was the "sometimes the zoom is lost, it
  // just zooms out" report: the framing persisted in the viewport pool, then
  // the next arrival fitted straight over it.
  #handFramedPages = signal<ReadonlySet<string>>(this.#restorePageSet(HAND_FRAMED_PAGES_KEY))
  #fitLockedSnapshot: { scale: number; cx: number; cy: number; dx: number; dy: number } | null = null

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
  #pinnedPages = signal<ReadonlySet<string>>(this.#restorePageSet(PINNED_PAGES_KEY))

  // Partial pins (fit flyout): pages whose SIZE or POSITION is held against
  // fits. Same per-page key model as the full pin, without the input lock.
  #pinnedSizePages = signal<ReadonlySet<string>>(this.#restorePageSet(PINNED_SIZE_PAGES_KEY))
  #pinnedPositionPages = signal<ReadonlySet<string>>(this.#restorePageSet(PINNED_POSITION_PAGES_KEY))

  #restorePageSet(key: string): ReadonlySet<string> {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return new Set()
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? new Set(arr) : new Set()
    } catch {
      return new Set()
    }
  }

  #persistPageSet(key: string, set: ReadonlySet<string>): void {
    try {
      localStorage.setItem(key, JSON.stringify([...set]))
    } catch { /* ignore */ }
  }
  #clipboardAvailable = signal(false)
  // Whether the side panel is currently open. Mirrors the panel's own
  // `clipboard:open` state event so the toolbar button can both toggle it
  // and light up while it's showing.
  #clipboardPanelOpen = signal(false)
  // Whether the chat window is showing — its `chat:window-state` announcement,
  // so the launcher lights while the default view is up.
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

  // ── single-row layout with edit-mode toggling ──────────────
  // Replaces the previous multi-row + expand/collapse split. All items
  // render on one line in CONTROL_REGISTRY order; muted (disabled-by-user)
  // items appear grayed and are no-ops in normal mode. The chevron at
  // the end of the row toggles edit mode — while editing, every click
  // flips an item's enabled state instead of running its action.
  #enabledMap = signal<Record<string, boolean>>(this.#restoreEnabledMap())
  #editMode = signal(false)
  /** The participant's order, or [] while the registry order stands. */
  #order = signal<string[]>(this.#restoreOrder())

  /** CONTROL_REGISTRY laid out in the participant's order. Controls the stored
   *  order never saw are inserted after their nearest preceding registry
   *  sibling, so an order written today does not exile every control added
   *  tomorrow to the end of the rail. */
  readonly #orderedRegistry = computed((): ControlItem[] => {
    const order = this.#order()
    if (!order.length) return [...CONTROL_REGISTRY]
    const byId = new Map(CONTROL_REGISTRY.map(ctrl => [ctrl.id, ctrl] as const))
    const out: ControlItem[] = []
    const placed = new Set<string>()
    for (const id of order) {
      const ctrl = byId.get(id)
      if (ctrl && !placed.has(id)) { out.push(ctrl); placed.add(id) }
    }
    for (let i = 0; i < CONTROL_REGISTRY.length; i++) {
      const ctrl = CONTROL_REGISTRY[i]
      if (placed.has(ctrl.id)) continue
      let at = out.length
      for (let j = i - 1; j >= 0; j--) {
        const idx = out.findIndex(o => o.id === CONTROL_REGISTRY[j].id)
        if (idx >= 0) { at = idx + 1; break }
      }
      out.splice(at, 0, ctrl)
      placed.add(ctrl.id)
    }
    return out
  })

  /** Flat list of every visible control, in the participant's order. */
  readonly visibleControls = computed((): ControlItem[] =>
    this.#orderedRegistry().filter(ctrl => this.#isControlVisible(ctrl))
  )

  #restoreOrder(): string[] {
    try {
      const raw = localStorage.getItem(ORDER_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : []
    } catch { return [] }
  }

  #persistOrder(): void {
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(this.#orderedRegistry().map(c => c.id)))
    } catch { /* ignore */ }
  }

  /** The scrollable icon set: every visible control EXCEPT back. Back is a
   *  structural footer action (rendered separately, pinned to the bottom of
   *  the rail) so it stays reachable no matter how long the icon list grows
   *  and is never user-mutable in edit mode. */
  readonly railControls = computed((): ControlItem[] => {
    // On the left dock, pin is lifted into a structural position — drop its
    // registry entry here so it cannot render twice. Every other dock/layout
    // keeps the customizable entries inline in the list.
    const onLeftRail = this.#dockSide() === 'left' && !this.isMobile()
    return this.visibleControls().filter(ctrl =>
      ctrl.id !== 'back' && !(onLeftRail && ctrl.id === 'pin'),
    )
  })

  readonly editMode = this.#editMode.asReadonly()

  readonly toggleEditMode = (): void => {
    this.#editMode.update(v => !v)
  }

  // ── reorder (edit mode) ──────────────────────────────────
  //
  // Managing the rail is two verbs, not one: a click flips a control on or
  // off, a DRAG moves it. The drag only exists while edit mode is on — the
  // same gate the toggle already lives behind — so an ordinary press on a
  // live rail is untouched. The list reorders live under the pointer (the
  // dragged icon takes the slot it is over), and the trailing click is
  // swallowed so a move never also toggles what it moved.

  /** Id of the control currently being dragged, or null. */
  readonly reorderId = signal<string | null>(null)
  #reorderPointerId: number | null = null
  #reorderStartX = 0
  #reorderStartY = 0
  #reorderPassedSlop = false

  /** Pointerdown on a rail icon. In edit mode it arms a reorder drag; the rest
   *  of the time it is the icon-protocol long-press it always was. */
  readonly onCtrlPointerDown = (ctrl: ControlItem, event: PointerEvent): void => {
    if (!this.#editMode()) { this.onIconPressDown(); return }
    if (event.button !== 0 && event.pointerType === 'mouse') return
    this.#reorderPointerId = event.pointerId
    this.#reorderStartX = event.clientX
    this.#reorderStartY = event.clientY
    this.#reorderPassedSlop = false
    this.reorderId.set(null)
    this.#pendingReorderId = ctrl.id
    window.addEventListener('pointermove', this.#onReorderMove)
    window.addEventListener('pointerup', this.#onReorderEnd)
    window.addEventListener('pointercancel', this.#onReorderEnd)
  }

  #pendingReorderId: string | null = null

  #onReorderMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#reorderPointerId || !this.#pendingReorderId) return
    if (!this.#reorderPassedSlop) {
      const dx = event.clientX - this.#reorderStartX
      const dy = event.clientY - this.#reorderStartY
      if (Math.hypot(dx, dy) < DRAG_SLOP_PX) return
      this.#reorderPassedSlop = true
      this.reorderId.set(this.#pendingReorderId)
    }
    event.preventDefault()
    const over = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
    const targetId = over?.closest?.('[data-ctrl-id]')?.getAttribute('data-ctrl-id')
    if (!targetId || targetId === this.#pendingReorderId) return
    // Only the scrollable rail participates — the footer's back button and the
    // left rail's fixed pin/home/tour are structural, not part of the set.
    if (!this.railControls().some(c => c.id === targetId)) return
    this.#moveControl(this.#pendingReorderId, targetId)
  }

  /** Lift `dragId` out of the order and drop it into `targetId`'s slot. */
  #moveControl(dragId: string, targetId: string): void {
    const ids = this.#orderedRegistry().map(c => c.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0 || from === to) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    this.#order.set(ids)
  }

  #onReorderEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.#reorderPointerId) return
    window.removeEventListener('pointermove', this.#onReorderMove)
    window.removeEventListener('pointerup', this.#onReorderEnd)
    window.removeEventListener('pointercancel', this.#onReorderEnd)
    this.#reorderPointerId = null
    this.#pendingReorderId = null
    this.reorderId.set(null)
    if (!this.#reorderPassedSlop) return
    this.#reorderPassedSlop = false
    this.#persistOrder()
    // The click this release produces belongs to the move, not to the toggle.
    this.#swallowNextClick = true
    setTimeout(() => { this.#swallowNextClick = false }, 0)
  }

  /** Put the rail back in registry order. Reachable from the edit-mode
   *  chevron's context menu — a permutation you can't undo is a trap. */
  readonly resetOrder = (): void => {
    this.#order.set([])
    try { localStorage.removeItem(ORDER_KEY) } catch { /* ignore */ }
  }

  /** Right-click the edit chevron while editing → back to registry order. */
  readonly onEditToggleContext = (event: Event): void => {
    if (!this.#editMode()) return
    event.preventDefault()
    this.resetOrder()
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
    fitOrCenter: (e) => this.fitOrCenter(e!),
    zoomOut: () => this.zoomOut(),
    zoomIn: () => this.zoomIn(),
    togglePin: () => this.togglePin(),
    toggleFullscreen: () => this.toggleFullscreen(),
    toggleShowHidden: () => this.toggleShowHidden(),
    toggleTextOnly: () => this.toggleTextOnly(),
    openPools: () => this.openPools(),
    toggleChat: () => EffectBus.emit('chat:toggle', {}),
    openSequences: () => EffectBus.emit('sequence:view-open', {}),
    togglePublish: () => EffectBus.emit('publish:view-toggle', {}),
    toggleHosts: () => EffectBus.emit('hosts:view-toggle', {}),
    // comfy and aliases have no toggle effect — only open/close, which their
    // own close buttons already own. Opening an open window is a no-op.
    openComfy: () => EffectBus.emit('comfy:open', {}),
    openAliases: () => EffectBus.emit('aliases:open', {}),
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
      // Not a map pin: Portals is a way OUT of this page into another root,
      // the same act as the installer beside it.
      case 'pools':        return 'nearby'
      case 'chat':         return 'chat'
      case 'sequences':    return 'schema'
      case 'publish':      return 'cloud_upload'
      // All three already ship in the icon subset (scripts/icon-names.cjs reads
      // this file), so they cost no new glyph. A name that is NOT in the subset
      // renders BLANK and says nothing about it — check before inventing one.
      case 'hosts':        return 'dns'
      case 'comfy':        return 'palette'
      // NOT `label` — the pheromone panel's button already wears it, and two
      // rail icons with the same glyph are two controls nobody can tell apart.
      case 'aliases':      return 'tag'
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
    if ((ctrl.id === 'sequences' || ctrl.id === 'publish')
      && !this.#editMode() && !this.isEnabled(ctrl)) return false
    // In edit mode the user is picking which icons should be active — show
    // candidates that are normally state-gated so they can be toggled even
    // when their state isn't currently met (no selection).
    if (this.#editMode() && ctrl.visibleWhen === 'hasSelection') return true
    // A pinned layer is frozen — the viewport controls come off the bar so
    // there is literally nothing left to drag or zoom with. Edit mode keeps
    // them visible so the rail can still be configured from a pinned page.
    if (!this.#editMode() && VIEWPORT_CONTROLS.has(ctrl.id) && this.pinnedHere()) return false
    switch (ctrl.visibleWhen) {
      case 'always': return true
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
        // Only genuine overrides are stored, so an untouched control inherits
        // the CURRENT default — that is what lets a default flip land on an
        // existing user. Legacy full maps predate that; #reclaimDefaults strips
        // the ids a flip has since taken back.
        return { ...DEFAULT_ENABLED_MAP, ...this.#reclaimDefaults(parsed) }
      }
    } catch { /* ignore */ }
    return { ...DEFAULT_ENABLED_MAP }
  }

  /** One-time sweep per rev: drop the ids a default flip reclaimed from a map
   *  written before it, rewrite the map as overrides-only, and record the rev.
   *  Runs from a field initializer, so it must not touch `#enabledMap`. */
  #reclaimDefaults(parsed: Record<string, boolean>): Record<string, boolean> {
    let seen = 0
    try { seen = Number(localStorage.getItem(ENABLED_REV_KEY)) || 0 } catch { /* ignore */ }
    if (seen >= ENABLED_REV) return parsed
    const swept = { ...parsed }
    for (let rev = seen + 1; rev <= ENABLED_REV; rev++) {
      for (const id of RECLAIMED_BY_REV[rev] ?? []) delete swept[id]
    }
    try {
      localStorage.setItem(ENABLED_MAP_KEY, JSON.stringify(overridesOf(swept)))
      localStorage.setItem(ENABLED_REV_KEY, String(ENABLED_REV))
    } catch { /* ignore */ }
    return swept
  }

  #persistEnabledMap(): void {
    try {
      localStorage.setItem(ENABLED_MAP_KEY, JSON.stringify(overridesOf(this.#enabledMap())))
      localStorage.setItem(ENABLED_REV_KEY, String(ENABLED_REV))
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
  #keepsControlsUnsub: (() => void) | null = null
  #keepsControls = signal(false)
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
    if (!secret) return 'rgba(var(--hc-chrome-ink), var(--hc-ink-a-faint))'
    const provider = get('@hypercomb.social/SecretStrengthProvider') as { evaluate: (s: string) => number } | undefined
    const score = provider?.evaluate(secret) ?? 0.5
    const hue = Math.round(160 + score * 30)
    return `hsl(${hue} 65% var(--hc-shield-l, 50%))`
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

  /** Partial pins for THIS layer — the fit flyout's pin-size / pin-position. */
  readonly pinnedSizeHere = computed(() => {
    this.#moved$()
    return this.#pinnedSizePages().has(this.#currentPageKey())
  })
  readonly pinnedPositionHere = computed(() => {
    this.#moved$()
    return this.#pinnedPositionPages().has(this.#currentPageKey())
  })

  /** The hold every fit must respect on this page. Handed to the zoom drone
   *  as its `fitHold` provider, so fits that originate inside the drone
   *  (resize refits) honour the pins too. */
  #fitHoldNow(): 'none' | 'scale' | 'position' | 'both' {
    const size = this.pinnedSizeHere()
    const position = this.pinnedPositionHere()
    return size && position ? 'both' : size ? 'scale' : position ? 'position' : 'none'
  }

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
    this.#persistPageSet(PINNED_PAGES_KEY, next)
  }

  /** Effective button state — drives color: white/green. The switch reads the
   *  same on every page: a per-page exception suppresses the fit there, it does
   *  not turn the switch off. */
  readonly fitButtonState = computed<'off' | 'global'>(() => this.#fitMode())
  /** True when the global fit switch is on. */
  readonly fitLocked = computed(() => this.#fitMode() === 'global')
  /** True when global fit should actually drive THIS page: the switch is on,
   *  the page has never been framed by hand, and it is not pinned. */
  readonly fitAppliesHere = computed(() => {
    // Track navigation so this recomputes when the user moves between layers.
    this.#moved$()
    if (this.#fitMode() !== 'global') return false
    const key = this.#currentPageKey()
    if (this.#handFramedPages().has(key)) return false
    return !this.#pinnedPages().has(key)
  })
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

  /** The three reaches in cycle order — the expanded strip's toggle walks this
   *  list. Same ids and glyphs as the pheromone panel — one vocabulary for
   *  reach, wherever you meet it. */
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

  /** Step to the next reach and wrap — local → children → global → local. The
   *  expanded strip's three-stage toggle, same walk as the lane ladder. */
  readonly cycleTagScope = (): void => {
    const opts = this.tagScopeOptions
    const at = opts.findIndex(o => o.id === this.#tagScope())
    this.setTagScope(opts[(at + 1) % opts.length].id)
  }

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

  /** VIEWS — the layer deck: a sheet of big plates for this layer's views,
   *  the creations offered here, and the how-you-see controls (rung,
   *  fullscreen, pheromones, pin, undo/redo, library) that the pop-up view
   *  row used to hold behind an unlabeled chevron. The deck is a drone-owned
   *  shell surface that listens for this; the bar only asks. */
  readonly openViews = (): void => {
    EffectBus.emit('layer:deck-open', {})
  }

  /** SHARE — the publish sheet for the current page (publish, links, community
   *  hosts). Took the fit disc's slot: on a phone the rails own the fit, and
   *  sharing what you made is the act a phone has to reach in one press. */
  readonly openShare = (): void => {
    EffectBus.emit('publish:view-toggle', {})
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

  /** Point at a crumb and the hive shows WHICH TILES CARRY THAT MARK — the
   *  carriers light in the mark's own colour, everything else recedes. The
   *  exact inverse of `tag-hovered` above (hover a TILE, its marks light up
   *  here), so the strip now answers in both directions. A look only: nothing
   *  is filtered until the crumb is clicked. Same effect the pheromone panel's
   *  rows emit — one behaviour, wherever a mark is shown. */
  readonly previewTag = (event: PointerEvent, name: string): void => {
    // Mouse only — touch fires pointerenter on tap with no pointerleave to
    // follow, which would strand the hive in a preview it cannot leave.
    if (event.pointerType !== 'mouse') return
    EffectBus.emit('tags:preview', { marks: [name], color: this.tagColor(name) })
  }

  readonly endTagPreview = (): void => {
    EffectBus.emit('tags:preview', { marks: [] })
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
  // A view covering the canvas puts this bar away — that is what a takeover
  // means. But a view can also cover the canvas and LEAVE THE BAR ITS EDGE:
  // the chat window lays itself out against the same reservation every docked
  // toolwindow does (`--hc-controls-<side>`), so there is a bar-shaped strip it
  // never paints on. Hiding the bar there took away every control on it for as
  // long as a conversation was open, and left only the bar's own edge line
  // showing — a stray rule down the side of the window with nothing beside it.
  //
  // So the view says which kind it is, by holding `view:keeps-controls`
  // (owner-counted, same as `view:active`). Nothing here knows any window's
  // name; a view that leaves room keeps the bar, and any that does not still
  // takes the screen whole.
  readonly visible = computed(() =>
    !this.#touchDragging() && (!this.#viewActive() || this.#keepsControls()))

  /** THE BAR HIDES UNDER A VIEW ON A PHONE. `.faded` only DIMS (and is put
   *  back to full opacity on touch, where it stood for the idle fade that has
   *  no hover to recover from), so on a phone the bar stayed painted and
   *  tappable at z 60000 over every takeover — the close-up, the slides — at
   *  59988–59990, with its discs live on top of somebody's page. A view that
   *  holds `view:keeps-controls` has laid itself out beside the bar and keeps
   *  it. */
  readonly viewHidden = computed(() =>
    this.isMobile() && this.#viewActive() && !this.#keepsControls())

  /** Kept on screen WHILE a view covers the canvas — the bar is standing beside
   *  a window that reserved its edge, not on the bare hive. Its own band
   *  (59999–60003) sits under the docked-window band (100002+), which is right
   *  when the bar is chrome ON the canvas and wrong here: the rail is visible
   *  and pressable, but anything it opens anchored to itself would render
   *  behind the very window it is standing beside. Lifted only for as long as
   *  that is true. */
  readonly overView = computed(() => this.#viewActive() && this.#keepsControls())
  readonly roomOpen = this.#roomOpen.asReadonly()
  readonly beesVisible = this.#beesVisible.asReadonly()
  readonly agentsVisible = this.#agentsVisible.asReadonly()
  readonly showHidden = this.#showHidden.asReadonly()
  readonly voiceActive = signal(false)
  readonly voiceSupported = VoiceInputService.supported()

  // ── lifecycle ───────────────────────────────────────────

  #fitLockedUnsub: (() => void) | null = null
  #zoomManualUnsub: (() => void) | null = null
  #zoomFitUnsub: (() => void) | null = null
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
  #tutorialsOpenUnsub: (() => void) | null = null
  #meshModalUnsub: (() => void) | null = null
  #lanesUnsub: (() => void) | null = null
  #meshJoinUnsub: (() => void) | null = null
  #swarmZoneUnsub: (() => void) | null = null
  #lockBumpUnsub: (() => void) | null = null
  #iconEditUnsub: (() => void) | null = null
  #configureControlUnsub: (() => void) | null = null
  #onIconOverride = (): void => this.iconRev.update(v => v + 1)

  ngOnInit(): void {
    // Host-level capture guard so a drag-scroll's trailing click never
    // reaches an icon. On the host (not the list) because the list is
    // created and destroyed by the mode/dock branches.
    this.#installClickSwallow()

    // Participant chrome, restored before the renderer mounts. EffectBus
    // replays this value to a late AgentBeeDrone, so boot never flashes agents
    // that the participant has chosen to hide.
    EffectBus.emit('render:set-agents-visible', { visible: this.#agentsVisible() })

    // Hand the zoom drone this page's partial-pin hold, so every fit path —
    // including resize refits that originate inside the drone — respects
    // pin-size / pin-position without threading the value per call.
    ;(window as any).ioc?.whenReady?.('@diamondcoreprocessor.com/ZoomDrone', (zoom: any) => {
      zoom.fitHold = (): 'none' | 'scale' | 'position' | 'both' => this.#fitHoldNow()
    })

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

    // The swarm reports that it is public but has nowhere to publish — it
    // composes its sig from (path, room, secret) and declines without both.
    // Left alone this is invisible: relay socket up, swarm chrome on, no
    // peers, ever. Say it and reopen the selector on the missing field.
    // Edge-triggered by the drone, so a participant who dismisses it is not
    // nagged; it speaks again only after the zone goes good and bad again.
    this.#swarmZoneUnsub = EffectBus.on<{ hasRoom?: boolean; hasSecret?: boolean }>(
      'swarm:zone-incomplete',
      ({ hasRoom }) => {
        EffectBus.emit('toast:show', {
          type: 'error',
          title: 'swarm',
          message: hasRoom
            ? 'This swarm has no secret, so nothing can reach it. Set one to join.'
            : 'This swarm has no location, so nothing can reach it. Pick one to join.',
        })
        EffectBus.emit('mesh:open-modal', { join: true })
      },
    )

    this.#inputVisibleMirrorUnsub = EffectBus.on<{ visible: boolean; mobile: boolean }>(
      'mobile:input-visible',
      ({ visible, mobile }) => this.inputVisible.set(mobile ? visible : true),
    )

    // ── ONE definition of mobile ──
    // MobileModeService (essentials) decides: a coarse pointer AND a
    // phone-shaped viewport (≤599px wide, or ≤449px tall — a phone on its side
    // is wide but short), or the `/mobile on|off` override. Mobile collapses
    // the command line in landscape and shows the mobile control strip — a
    // bottom bar in portrait, a LEFT-edge rail in landscape. The effect is
    // last-value-replayed, so a bar mounting after the service still reads the
    // current verdict; the seed covers the web shell, where the service
    // arrives from OPFS after this component does. Orientation stays a media
    // query — it is a fact about the device, not a mode.
    this.#landscapeQuery = window.matchMedia('(orientation: landscape)')
    this.#landscapeQuery.addEventListener('change', this.#landscapeHandler)
    this.#setMobile(this.#seedMobile())
    this.#mobileModeUnsub = EffectBus.on<{ active?: boolean }>('mobile:mode', ({ active }) => {
      this.#setMobile(!!active)
    })

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
      if (this.fitAppliesHere()) this.#disableFitLockedPreservingCurrent()
    })

    // An explicit fit hands the page back to the global fit switch: you asked
    // for the fitted framing, so there is nothing of yours left to protect.
    // Transient, so a fresh mount never replays an old fit and silently drops
    // a hand framing.
    this.#zoomFitUnsub = EffectBus.on('viewport:fit', () => {
      if (this.#fitMode() !== 'global') return
      this.#markHandFramed(this.#currentPageKey(), false)
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

    // The bee lights while the tutorials window is showing — the window
    // announces itself, the same bar/panel pair every other icon uses.
    this.#tutorialsOpenUnsub = EffectBus.on<{ open?: boolean }>('tutorials:state', ({ open }) => {
      this.tutorialsOpen.set(!!open)
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

    this.#keepsControlsUnsub = EffectBus.on<{ active: boolean }>('view:keeps-controls', ({ active }) => {
      this.#keepsControls.set(active)
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

    // emit initial show-hidden state so drones pick it up
    if (this.#showHidden()) {
      EffectBus.emit('visibility:show-hidden', { active: true })
    }

    // fit-locked: install the navigation listener if the switch is on. The
    // listener handles suspend/resume per-page on each navigation. Boot-arm it:
    // the page the session opens on never emits `navigate`, so without this the
    // first page of every session came up unfitted while the switch read green.
    if (this.#fitMode() === 'global') this.#enableFitLocked(true)
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
   *  `--hc-controls-left` / `--hc-controls-right` / `--hc-controls-bottom`,
   *  plus the left rail's top edge as `--hc-controls-left-top`.
   *
   *  The bar is the ANCHOR: it stays fixed to its edge and docked toolwindows
   *  lay out against it (hcDockedPanel reads these), so a panel opens BESIDE
   *  the bar instead of over it. Only a SIDE-DOCKED bar reserves — a
   *  free-floating pill can be dragged anywhere, so reserving an edge for it
   *  would strand a permanent gap. Mobile's portrait strip owns no SIDE — it
   *  owns the bottom, and its landscape rail owns the left. */
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
    let bottom = 0
    let leftTop = ''
    // THE PORTRAIT PHONE BAR IS A BOTTOM DOCK. It publishes how far up the
    // screen its top edge sits, so every sheet, the toast stack and the select
    // pill can stand ON it instead of guessing its height (the sheets guessed
    // zero and covered the discs; the pill guessed 6.2rem). Layout box, not
    // the visual rect — the stage animates a transform (see below). The
    // number is measured from the viewport's bottom, so it already contains
    // the safe inset and the bar's own gap: consumers max() it against the
    // inset, they do not add the two.
    if (stage && this.isMobile() && !this.isLandscape() && stage.offsetHeight > 0) {
      bottom = Math.max(0, window.innerHeight - stage.offsetTop)
    }
    // THE LANDSCAPE PHONE RAIL IS A LEFT DOCK. The bar publishes zero edges on
    // phones because its portrait strip owns no side — but in landscape it IS
    // a column down the left edge, and everything that keeps clear of a dock
    // (the strip's fit, a sheet's inboard edge) must know how wide it is, or
    // the first rail of hexagons is painted under the buttons.
    if (stage && this.isMobile() && this.isLandscape()) {
      const w = stage.offsetWidth
      if (w > 0) left = Math.max(0, stage.offsetLeft + w)
    } else if (stage && side && !this.isMobile()) {
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
    root.style.setProperty('--hc-controls-bottom', `${Math.round(bottom)}px`)
    // Removed, not zeroed: panels fall back to their OWN top through the var's
    // fallback value, which a `0px` would override.
    if (leftTop) root.style.setProperty('--hc-controls-left-top', leftTop)
    else root.style.removeProperty('--hc-controls-left-top')
    this.#paintControlsEdge(side, left, right, stage?.offsetTop ?? 0)

    // SAY THAT THE BAR HAS MOVED.
    //
    // Every docked tool window positions itself with a `calc()` over the two
    // variables just published, so re-docking the bar SLIDES every one of them
    // — same size, new place. A ResizeObserver reports size and nothing else,
    // so each panel went on reserving the edge it measured at its old
    // position: with the bar widened under it, a left-docked panel's true
    // right edge moved from 375px to 481px while its reservation stayed at
    // 375, and it covered 106px of the surface beside it.
    //
    // TRANSIENT, because this is a request and not a state. Replaying it to a
    // panel that opens later would ask it to measure a second time for no
    // reason — mounting already does that.
    EffectBus.emitTransient('viewport:inset-poll', {})
  }

  // ── THE BAR'S OWN EDGE, WHICH NOTHING GETS TO COVER ─────────────────
  //
  // A docked bar closes itself against the canvas with a 1px border on its
  // inner side, and that line kept disappearing the moment anything opened
  // beside it. The border belongs to the rail, so it paints in the BAR's
  // stacking context (z-index 59999) — and a tool window docking flush against
  // it paints at 100002, with a drop shadow tens of pixels wide. The window
  // never covers the bar's BOX (it starts at the reservation this same measure
  // publishes), but its shadow washes straight over that one pixel, and a 1px
  // line under a 60px blur is gone.
  //
  // Raising the whole bar over the panels would fix it and break more: things
  // are meant to be able to cover the bar (a takeover, a modal). So only the
  // LINE is lifted — one fixed, pointer-transparent pixel at the bar's inner
  // edge, above the docked-window band. It is the bar's edge, drawn where
  // nothing can put anything on top of it.
  //
  // Body-level rather than a pseudo-element for exactly that reason: a child
  // of the rail shares the rail's stacking context and would be painted over
  // with it.
  #edgeLine: HTMLDivElement | null = null

  #paintControlsEdge(side: 'left' | 'right' | null, left: number, right: number, top: number): void {
    // Undocked, mobile, or torn down: no edge to draw. The floating pill closes
    // itself with its own border on all four sides and reserves nothing.
    // Nothing measured yet is the same as nothing docked: a line at -1px is a
    // line off the screen, and one drawn before the rail has a width would sit
    // wherever the fallback put it.
    const edge = side === 'left' ? left : right
    if (!side || this.isMobile() || edge <= 0) {
      this.#edgeLine?.remove()
      this.#edgeLine = null
      return
    }
    const line = this.#edgeLine ?? document.createElement('div')
    if (!this.#edgeLine) {
      line.className = 'hc-controls-edge'
      line.setAttribute('aria-hidden', 'true')
      line.style.cssText =
        'position:fixed;width:1px;pointer-events:none;z-index:100003;' +
        'background:color-mix(in srgb, var(--md-outline-variant) 70%, transparent);'
      document.body.appendChild(line)
      this.#edgeLine = line
    }
    // The rail starts below the header and runs to the bottom; the same top the
    // reservation publishes, so the line and the panels beside it agree.
    line.style.top = `${Math.round(Math.max(0, top))}px`
    line.style.bottom = '0'
    if (side === 'left') {
      line.style.left = `${Math.round(left) - 1}px`
      line.style.right = 'auto'
    } else {
      line.style.right = `${Math.round(right) - 1}px`
      line.style.left = 'auto'
    }
  }

  /** Re-measure whenever the bar changes edge (or mobile flips) — a dock swap
   *  moves the pill without necessarily resizing it, so the ResizeObserver
   *  below can't see it. Field initializer: `effect()` needs an injection
   *  context, which ngAfterViewInit is not. */
  #controlsEdgeSync = effect(() => {
    this.#dockSide()
    this.isMobile()
    this.isLandscape()
    queueMicrotask(this.#measureControlsEdge)
  })

  #observeControlsEdge(): void {
    // The ResizeObserver is attached inside the measure itself, so it always
    // follows the CURRENT stage element rather than the one that existed here.
    window.addEventListener('resize', this.#measureControlsEdge)
    window.visualViewport?.addEventListener('resize', this.#publishKeyboardInset)
    window.visualViewport?.addEventListener('scroll', this.#publishKeyboardInset)
    this.#publishKeyboardInset()
    this.#measureControlsEdge()
  }

  /** THE SOFT KEYBOARD. iOS does not resize the layout viewport when the
   *  keyboard rises — `innerHeight` stays put, `position: fixed; bottom: 0`
   *  stays put, and the keyboard simply covers the bar, GO and every sheet.
   *  What shrinks is the VISUAL viewport, so its height (and its scroll
   *  offset, which the keyboard also moves) says how much of the bottom is
   *  gone. Published as `--hc-keyboard-inset`; the bar's own `bottom` reads it
   *  (max()ed with the safe inset), and because that moves the bar's top
   *  edge, `--hc-controls-bottom` is re-measured once layout has it. Android
   *  resizes the layout viewport instead, so the number is ~0 there and the
   *  fixed bar already moves. Off mobile it is 0px: a desktop pinch-zoom also
   *  shrinks the visual viewport, and the bar must not chase that. */
  #keyboardInset = -1
  #publishKeyboardInset = (): void => {
    const vv = window.visualViewport
    let inset = 0
    if (vv && this.isMobile()) {
      inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
    }
    if (inset === this.#keyboardInset) return
    this.#keyboardInset = inset
    document.documentElement.style.setProperty('--hc-keyboard-inset', `${inset}px`)
    requestAnimationFrame(this.#measureControlsEdge)
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
      // REMOVED, NOT LEFT BEHIND, when the header is not there. A landscape
      // phone hides the header (`display: none`, _header-bar.scss) and its
      // rect collapses to zero; refusing to write zero used to leave the
      // PORTRAIT value standing, so the landscape rail and every anchored
      // surface started 90–130px down the screen under a header that was not
      // painted. `--hc-header-anchor` falls back to its nominal height.
      const hidden = bottom <= 0 || getComputedStyle(header).display === 'none'
      if (hidden) document.documentElement.style.removeProperty('--hc-header-bottom')
      else document.documentElement.style.setProperty('--hc-header-bottom', `${bottom}px`)
    }
    measure()
    this.#headerObserver = new ResizeObserver(measure)
    this.#headerObserver.observe(header)
  }

  ngOnDestroy(): void {
    // The pickers' window listeners are capture-phase and live only while
    // open — closing releases them. (The tour picker is not among them any
    // more: it is a tool window, which tears itself down.)
    this.closeFitMenu()
    this.closeHomeMenu()
    // Never leave the gate locked behind a torn-down bar — the pin would be
    // unreleasable (the only button that releases it went away with us).
    this.gate?.removeEventListener?.('change', this.#onGateChange)
    if (this.gate?.lockedBy?.(PIN_OWNER)) this.gate.unlock(PIN_OWNER)
    this.#inputVisibleMirrorUnsub?.()
    this.#mobileModeUnsub?.()
    this.#landscapeQuery?.removeEventListener('change', this.#landscapeHandler)
    this.#headerObserver?.disconnect()
    this.#controlsObserver?.disconnect()
    window.removeEventListener('resize', this.#measureControlsEdge)
    window.visualViewport?.removeEventListener('resize', this.#publishKeyboardInset)
    window.visualViewport?.removeEventListener('scroll', this.#publishKeyboardInset)
    // Release the reservation — a torn-down bar occupies no edge.
    document.documentElement.style.setProperty('--hc-controls-left', '0px')
    document.documentElement.style.setProperty('--hc-controls-right', '0px')
    document.documentElement.style.setProperty('--hc-controls-bottom', '0px')
    document.documentElement.style.removeProperty('--hc-controls-left-top')
    document.documentElement.style.removeProperty('--hc-keyboard-inset')
    this.#edgeLine?.remove()
    this.#edgeLine = null
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
    this.#zoomFitUnsub?.()
    this.#clipboardUnsub?.()
    this.#selectionUnsub?.()
    this.#hoverCrumbUnsub?.()
    this.#moveModeUnsub?.()
    this.#layoutModeUnsub?.()
    this.#touchDraggingUnsub?.()
    this.#viewActiveUnsub?.()
    this.#keepsControlsUnsub?.()
    this.#beesUnsub?.()
    this.#voiceActiveUnsub?.()
    this.#showHiddenUnsub?.()
    this.#textOnlyUnsub?.()
    this.#clipboardAvailableUnsub?.()
    this.#clipboardOpenUnsub?.()
    this.#tutorialsOpenUnsub?.()
    this.#tagsUnsub?.()
    this.#tagFilterUnsub?.()
    this.#hoverTagsUnsub?.()
    this.#meshModalUnsub?.()
    this.#meshJoinUnsub?.()
    this.#swarmZoneUnsub?.()
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
    // BACK CLOSES THE SHEET FIRST. On a phone a tool window is a sheet over
    // the hive with no Escape key to take it away, and Back is the one
    // control a phone reaches for; so before it walks the lineage it does
    // what Escape's sweep does — parks every showing window (parked, not
    // closed, so the cascade's put-back still works). Anything showing means
    // the press is spent here. Desktop keeps Back for the lineage: it has
    // Escape, and its rail's Back has never meant "close the panel".
    if (this.isMobile() && this.#putAwayToolWindows()) return
    performance.mark('hypercomb:back:trigger')
    void this.movement.back()
  }

  /** `@hypercomb.social/ToolWindows.putAwayAll()` returns the put-back when
   *  anything was showing and null otherwise; any truthy return means the
   *  screen just changed. Resolved by key: the facade lives in core and
   *  registers itself. */
  #putAwayToolWindows(): boolean {
    try {
      const tw = get('@hypercomb.social/ToolWindows') as { putAwayAll?: () => unknown } | undefined
      return !!tw?.putAwayAll?.()
    } catch {
      return false
    }
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

  // ── home is the portal you marked ─────────────────────
  //
  // Home used to mean the domain root, unconditionally. It now means THE PORTAL
  // MARKED AS HOME in the Portals toolwindow — the thing you are actually
  // working on, which you went through a portal to reach. The root is what
  // everything hangs off, not a place worth landing on over and over; making
  // the portal home is what lets the rest of the hive stay out of sight.
  //
  // Marked, never inferred: home does not follow where you walk, so looking at
  // something else cannot cost you your home. It survives a refresh, because
  // the focus is the point and a reload must not cost you it either.
  //
  // Ctrl/⌘+click marks the place you are standing as Home. Repeating the
  // gesture there releases it. The one-slot mark is persisted by
  // RecentPortalsStore, so this is both a toggle and sticky across reloads.

  private get recentPortals(): RecentPortalsStore | undefined {
    return get('@hypercomb.social/RecentPortalsStore') as RecentPortalsStore | undefined
  }

  #portals$ = fromRuntime(
    get('@hypercomb.social/RecentPortalsStore') as EventTarget,
    () => this.recentPortals?.value ?? [],
  )

  /** The portal Home flies to — the one MARKED as home in the Portals
   *  toolwindow, or `undefined` while none is marked (Home means the hive root
   *  then, exactly as it always did). Never inferred from where you have been. */
  readonly homePortal = computed<RecentPortal | undefined>(
    () => { this.#portals$(); return this.recentPortals?.home },
  )

  readonly isPinnedPortal = (entry: RecentPortal): boolean =>
    !!this.recentPortals?.isPinned(entry.segments)

  /** What the button says it will do — the portal's own name, so the tooltip
   *  names the thing rather than the mechanism. */
  readonly homeLabel = computed<string>(() => {
    const portal = this.homePortal()
    if (!portal) return ''
    return portal.label || '/' + portal.segments.join('/')
  })

  /** Home. Plain click flies to the marked location (hive root until one is
   *  marked). Ctrl/⌘+click toggles the CURRENT location as Home. Home-setting
   *  belongs on the global control because it works at every lineage, not only
   *  for rows which happen to be listed in the Portals window. */
  readonly goHome = (event?: MouseEvent): void => {
    if (event && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      event.stopPropagation()
      this.closeHomeMenu()
      const segments = this.navigation.segmentsRaw()
      if (segments.length === 0) {
        // The unmarked state already means the hive root; Ctrl+clicking Home at
        // root therefore releases any saved override instead of persisting a
        // redundant empty-path pin.
        this.recentPortals?.unpin()
      } else {
        this.recentPortals?.togglePin(segments[segments.length - 1], segments)
      }
      return
    }
    this.closeHomeMenu()
    // Ask for the ROOT, never for the home's address. The root resolves to
    // whatever is marked as home (home-redirect.ts), so this button, the
    // leading breadcrumb crumb and a cold load of `/` are one behaviour rather
    // than three that have to be kept agreeing.
    this.navigateTo([])
  }

  // ── the recent-portals picker ─────────────────────────

  readonly homeMenuOpen = signal(false)
  readonly homeMenuPos = signal<{ x: number; y: number; flip: boolean }>({ x: 0, y: 0, flip: false })
  readonly homeEntries = signal<readonly RecentPortal[]>([])

  #openHomeMenu(event: MouseEvent): void {
    const entries = this.recentPortals?.value ?? []
    if (entries.length === 0) {
      // Nothing walked yet — there is no list to show, so honour the plain
      // meaning rather than opening an empty menu.
      this.navigateTo([])
      return
    }
    this.homeEntries.set(entries)

    // Fixed positioning off the button's own rect, for the same reason the tour
    // picker does it: the rail is a scrolling, overflow-hidden box that would
    // clip a menu rendered inside it.
    const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect()
    const width = 248
    const x = rect ? rect.right + 10 : 12
    const flip = x + width > window.innerWidth - 8
    const maxHeight = Math.min(window.innerHeight * 0.7, 520)
    const menuX = flip ? Math.max(8, (rect?.left ?? 12) - width - 10) : x
    this.homeMenuPos.set({
      x: menuX,
      y: Math.min(Math.max(8, rect?.top ?? 12), Math.max(8, window.innerHeight - maxHeight - 8)),
      flip,
    })
    this.#clearLaneForMenu(menuX)
    this.homeMenuOpen.set(true)
    window.addEventListener('pointerdown', this.#onHomeMenuOutside, true)
    window.addEventListener('keydown', this.#onHomeMenuKey, true)
  }

  /** An anchored rail interface is about to open at `x` — put away the tool
   *  windows docked on that SAME side, so it never opens under (or over) a
   *  panel. Same-side only, and a PARK, never a close (dock-lanes.clearLane):
   *  the shell made this decision, so it costs the participant nothing, and
   *  reopening a window from the rail restores whatever it held. */
  #clearLaneForMenu(x: number): void {
    // Spend any undo still outstanding before taking a new one — two menus in a
    // row must not strand the first menu's windows.
    this.#laneRestore?.()
    this.#laneRestore = clearLaneWithUndo(x < window.innerWidth / 2 ? 'left' : 'right', isWindowShowing)
  }

  /** The undo for the windows this bar's last anchored menu put away. A borrow
   *  with no return is just keeping what you took: the menu closing is when the
   *  edge goes back. Spent-once, and it skips any window the participant has
   *  reopened by hand in the meantime. */
  #laneRestore: (() => void) | null = null

  /** Give the edge back. First line of every menu-close handler. */
  #restoreLane(): void {
    const undo = this.#laneRestore
    this.#laneRestore = null
    undo?.()
  }

  readonly closeHomeMenu = (): void => {
    this.#restoreLane()
    if (!this.homeMenuOpen()) return
    this.homeMenuOpen.set(false)
    window.removeEventListener('pointerdown', this.#onHomeMenuOutside, true)
    window.removeEventListener('keydown', this.#onHomeMenuKey, true)
  }

  /** Travel to somewhere you were. This does NOT re-home — jumping back to a
   *  place you passed through is looking around, not deciding, and only the
   *  Portals toolwindow's mark decides. It does move the row to the front of
   *  the recent list, because you have just been there again. */
  readonly pickHomePortal = (entry: RecentPortal): void => {
    this.closeHomeMenu()
    this.recentPortals?.record(entry.label, entry.segments)
    this.navigateTo([...entry.segments])
  }

  /** Put a portal down. Dropping the current one hands Home to the next most
   *  recent — this is how a finished piece of work stops being your home. */
  readonly forgetHomePortal = (entry: RecentPortal, event?: MouseEvent): void => {
    event?.stopPropagation()
    this.recentPortals?.remove(entry.segments)
    const left = this.recentPortals?.value ?? []
    this.homeEntries.set(left)
    if (left.length === 0) this.closeHomeMenu()
  }

  /** The hive root ITSELF, not what stands in for it. Always the last row:
   *  marking a portal as home makes `/` resolve to that portal, so this is the
   *  one way back to the bare root — it suspends the substitution for as long
   *  as you stay there. */
  readonly goHiveRoot = (): void => {
    this.closeHomeMenu()
    showHiveRoot()
    this.navigateTo([])
  }

  readonly homePortalPath = (entry: RecentPortal): string =>
    entry.segments.length ? '/' + entry.segments.join('/') : '/'

  readonly #onHomeMenuOutside = (event: PointerEvent): void => {
    const target = event.target as HTMLElement | null
    if (target?.closest?.('.home-menu, .rail-home')) return
    this.closeHomeMenu()
  }

  readonly #onHomeMenuKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    // Take Escape before the global cascade — the menu is the innermost thing
    // open, so it is what Escape must close.
    event.stopPropagation()
    event.preventDefault()
    this.closeHomeMenu()
  }

  /** THE BEE OPENS THE ROSTER.
   *
   *  It used to fly the starter course on a plain click and open a
   *  fixed-position course flyout on Ctrl+click — two doors onto one feature,
   *  and the only one that listed the courses was the one nobody found. The
   *  roster is a tool window now (hc-tutorials-window), which is the same
   *  thing `/tutorial` opens, so the icon and the command are one path again.
   *  Its first row is Continue: one more click still flies. */
  readonly startTutorial = (): void => {
    EffectBus.emit('tutorials:toggle', {})
  }

  /** Lit while the tutorials window is showing — the window announces itself
   *  (`tutorials:state`), the same shape every other panel/bar pair uses. */
  readonly tutorialsOpen = signal(false)

  // ── fit flyout ────────────────────────────────────────
  //
  // Right-click on the rail's fit button. The fit's second-order controls —
  // the global fit switch (previously Ctrl+click only, invisible), the
  // per-page pin-size / pin-position holds, and the step-zoom verbs the
  // magnifiers used to spend two rail slots on — live here, attached to the
  // object they modify. Same fixed-position pattern as the tour menu: the
  // rail scrolls and clips, so the menu renders outside it.

  readonly fitMenuOpen = signal(false)
  readonly fitMenuPos = signal<{ x: number; y: number }>({ x: 0, y: 0 })

  readonly onCtrlContext = (ctrl: ControlItem, event: MouseEvent): void => {
    if (ctrl.id !== 'fit' || this.#editMode()) return
    event.preventDefault()
    event.stopPropagation()
    this.#openFitMenuAt(event.currentTarget as HTMLElement | null)
  }

  /** The caret on the fit button. Right-click was the only way in, which is an
   *  unguessable gesture — and the step-zoom verbs live behind it now that the
   *  magnifiers are off the rail, so there has to be something to aim at.
   *  Left-click toggles the menu WITHOUT running the fit. */
  readonly onFitCaretClick = (event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    if (this.#editMode()) return
    if (this.fitMenuOpen()) { this.closeFitMenu(); return }
    this.#openFitMenuAt(event.currentTarget as HTMLElement | null)
  }

  /** Places the flyout beside the fit BUTTON — the caret is a corner of it, so
   *  anchor off the button either way and the menu lands in one place. */
  #openFitMenuAt(anchor: HTMLElement | null): void {
    const button = (anchor?.closest?.('.ctl-btn') as HTMLElement | null) ?? anchor
    const rect = button?.getBoundingClientRect()
    const width = 208
    const height = 240
    const x = rect ? rect.right + 10 : 12
    const flip = x + width > window.innerWidth - 8
    const menuX = flip ? Math.max(8, (rect?.left ?? 12) - width - 10) : x
    this.fitMenuPos.set({
      x: menuX,
      y: Math.min(Math.max(8, rect?.top ?? 12), Math.max(8, window.innerHeight - height - 8)),
    })
    this.#clearLaneForMenu(menuX)
    this.fitMenuOpen.set(true)
    window.addEventListener('pointerdown', this.#onFitMenuOutside, true)
    window.addEventListener('keydown', this.#onFitMenuKey, true)
  }

  readonly closeFitMenu = (): void => {
    this.#restoreLane()
    if (!this.fitMenuOpen()) return
    this.fitMenuOpen.set(false)
    window.removeEventListener('pointerdown', this.#onFitMenuOutside, true)
    window.removeEventListener('keydown', this.#onFitMenuKey, true)
  }

  readonly #onFitMenuOutside = (event: PointerEvent): void => {
    const target = event.target as HTMLElement | null
    // The caret is excluded so it can TOGGLE — otherwise this pointerdown
    // closed the menu and the trailing click reopened it, reading as dead.
    if (target?.closest?.('.fit-menu, .fit-caret')) return
    this.closeFitMenu()
  }

  readonly #onFitMenuKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    event.preventDefault()
    this.closeFitMenu()
  }

  /** One-shot fit from the flyout — same verb as a plain click on the button;
   *  the drone's fitHold provider makes it respect this page's pins. */
  readonly fitNow = (): void => {
    this.closeFitMenu()
    this.zoom?.zoomToFit?.(false, 'user')
  }

  /** The global fit switch, from the flyout. Stays open so the row's state
   *  change (the green check) is visible where it was flipped. */
  readonly toggleGlobalFit = (): void => {
    this.#cycleFitMode()
  }

  // ── view actions ──────────────────────────────────────

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
   * - Ctrl/Meta+click: flip the global fit switch on ↔ off.
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

  /** Flip the global fit switch. */
  #cycleFitMode(): void {
    if (this.#fitMode() === 'global') this.#clearFit()
    else this.#enterGlobalFit()
  }

  #enterGlobalFit(): void {
    this.#fitLockedSnapshot = this.#captureViewport()
    this.#fitMode.set('global')
    localStorage.setItem('hc:fit-mode', 'global')
    // Flipping the switch ON is the one gesture that means "fit everything":
    // it releases every page held back by a hand framing, this one included.
    // (Pins are untouched — those are a stronger, explicit hold.)
    this.#setHandFramedPages(new Set())
    this.#enableFitLocked()
    // A pinned page keeps its frozen viewport — the fit starts on the next
    // page you walk to. Both partial pins together hold the whole viewport
    // the same way.
    if (!this.fitAppliesHere() || this.#fitHoldNow() === 'both') return
    const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
    vp?.suspend?.()
    // Open the settle window too, so render passes right after the flip keep
    // refitting while the page's bounds settle.
    this.#fitArmedUntil = performance.now() + this.#FIT_ARM_MS
    this.zoom?.zoomToFit?.()
  }

  #clearFit(): void {
    this.#fitMode.set('off')
    localStorage.setItem('hc:fit-mode', 'off')
    // Hand framings are kept: they only gate global fit, and the switch can
    // come back on. Flipping it on is what clears them.
    const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
    vp?.resume?.()
    this.#fitLockedUnsub?.()
    this.#fitLockedUnsub = null
    this.#restoreViewport()
  }

  /** The arm is STICKY: set by navigation (or boot) and held until a fit
   *  actually RUNS — not until a clock runs out. The old fixed 1500ms window
   *  from `navigate` was a deadline, and every arrival whose first paint
   *  landed later (cold OPFS load, a big layer, a website-mode render whose
   *  hexagon fit bails, an empty layer that fills in) missed it and never
   *  fitted — the "not always full everywhere" conditions. After the first
   *  successful fit the sticky arm hands over to a ROLLING settle window:
   *  each further fit inside it extends it, so bounds that settle over many
   *  passes keep refitting no matter how long the whole settle takes. */
  #fitArmedSticky = false
  #fitArmedUntil = 0
  #FIT_ARM_MS = 1500
  /** The page key `arrived` last SETTLED — fitted, or found exempt. Arriving
   *  somewhere else is an arrival no matter which event announced it, so this
   *  is what makes the fit independent of event ORDER. Back-navigation emits
   *  its paints BEFORE the `navigate` that arms them (verified: two
   *  `render:cell-count` at the destination, then `navigate`), so an
   *  arm-only gate bailed on every one of them and the page was never refit —
   *  it kept whatever stale snapshot the viewport store held, which is the
   *  "it shrinks when I click back" report. Forward navigation armed first and
   *  worked, which is why this only ever showed on the way back. */
  #lastSettledPageKey: string | null = null

  #enableFitLocked(bootArm = false): void {
    if (this.#fitLockedUnsub) return
    // Boot: the FIRST page of a session gets no `navigate` event — the app
    // simply arrives — so enabling at install arms directly.
    this.#fitArmedSticky = bootArm

    // ARRIVING is what fits — and there is no single arrival event. The slow
    // render path ends in `navigation:guard-end`, but the back-nav FAST path
    // (a layer you have already visited) returns before that emit and only
    // announces itself with `render:cell-count`. Listening to guard-end alone
    // is why global fit did nothing on any revisited layer. So: navigation
    // ARMS the fit (and forgets the previous page's hand-adjustment), and
    // whichever paint signal lands while it is armed performs it.
    //
    // The arm is what keeps this from firing on tile add/remove:
    // `render:cell-count` fires there too, but nothing armed it.
    const arm = (): void => {
      // Deliberately does NOT forget a hand framing: `#handFramedPages` is the
      // page's own setting now, and arriving is not a request to lose it.
      this.#fitArmedSticky = true
      this.#fitArmedUntil = 0
    }
    const arrived = (): void => {
      const now = performance.now()
      // A page key we have not settled yet IS an arrival, whether or not the
      // arm got here first. This is the ordering-independent half of the gate:
      // back-nav paints land before its `navigate`, so waiting to be armed
      // meant never fitting on the way back. It still cannot fire on tile
      // add/remove — those paint the SAME key we already settled, so only the
      // arm (or the rolling settle window) can fit there, exactly as before.
      const pageKey = this.#currentPageKey()
      const isArrival = pageKey !== this.#lastSettledPageKey
      if (!isArrival && !this.#fitArmedSticky && now > this.#fitArmedUntil) return
      const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
      // Suspend persistence while auto-fitting so the fitted viewport doesn't
      // overwrite the page's saved viewport; resume on pages that are not
      // auto-fitted (pinned) so manual adjustments there persist normally.
      // Size + position both pinned = the whole viewport is the user's:
      // treat it like a full pin (persistence stays live, no fit).
      if (this.fitAppliesHere() && this.#fitHoldNow() !== 'both') {
        // Spend the arm ONLY if the fit actually ran. zoomToFit bails (now
        // reporting false) when the renderer/ZoomDrone isn't up yet, when the
        // mesh has no bounds, or when the safe area is degenerate — and
        // `this.zoom` is a live IoC lookup that is simply undefined before the
        // drone registers. EffectBus.on replays the last value to a new
        // subscriber, so on boot this handler fires the moment it subscribes,
        // often before any of that is ready: spending the arm there left the
        // switch reading pinned while the page was never fitted. Keeping the
        // arm sticky means the next paint retries until one succeeds.
        vp?.suspend?.()
        const fitted = this.zoom?.zoomToFit?.(true) === true
        if (fitted) {
          this.#fitArmedSticky = false
          this.#fitArmedUntil = now + this.#FIT_ARM_MS
          // Settled: this key is no longer an arrival, so later paints here
          // (a tile added, a bounds settle) fall back to the arm / rolling
          // window and cannot surprise-fit.
          this.#lastSettledPageKey = pageKey
        } else {
          // Nothing was fitted, so nothing can have overwritten the saved
          // viewport — don't leave persistence suspended on the way out.
          // Deliberately NOT settled: the next paint must retry, which is the
          // same reason the arm stays sticky here.
          vp?.resume?.()
        }
      } else {
        // Exempt page (pinned / hand-framed) — disarm so a later tile add
        // here can't surprise-fit, and let edits persist. Settled too: the
        // page was handled, it just wanted no fit.
        this.#fitArmedSticky = false
        this.#fitArmedUntil = 0
        this.#lastSettledPageKey = pageKey
        vp?.resume?.()
      }
    }

    // While the switch drives this page, a viewport resize (window resize,
    // fullscreen toggle, dock/undock) must refit too: the auto-fit is written
    // with persistence SUSPENDED, so the saved snapshot never carries
    // `fit:true` and the drone's own resize-refit path does not fire — one
    // resize used to leave the page un-fitted until the next navigation.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const onResize = (): void => {
      if (resizeTimer !== null) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        if (!this.fitAppliesHere() || this.#fitHoldNow() === 'both') return
        const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
        vp?.suspend?.()
        // Same rule as `arrived`: a bailed fit overwrote nothing, so it must
        // not leave persistence suspended behind it.
        if (this.zoom?.zoomToFit?.(true) !== true) vp?.resume?.()
      }, 150)
    }

    // The WINDOW is not the only thing that changes the framing, and listening
    // to it alone is why a page could be left sized for a viewport it is no
    // longer in — content small and pushed into a corner, the "it reset to be
    // smaller after I dropped a link" report. Two ways it happens with no
    // window `resize` at all:
    //   - the drawing surface changes: a panel reserving a column, the shell
    //     re-laying out. pixi-host already reconciles the CANVAS against its
    //     host for exactly this reason (resyncToHost) — but it only recentres
    //     the stage, so the renderer reports the new surface while the fit
    //     keeps the scale it computed for the old one.
    //   - only the CHROME moves: the header grows a row (a drop arms the
    //     command line), the controls rail docks or undocks. The surface is
    //     unchanged, so even a canvas observer would not fire, yet the safe
    //     area zoomToFit measures against has moved.
    // So reconcile on the same terms zoomToFit uses: sample the surface AND
    // the chrome, refit only when that signature actually changes. Same shape
    // and cadence as resyncToHost, which had to learn this lesson first.
    const frameSignature = (): string => {
      const box = this.zoom?.canvas?.getBoundingClientRect?.()
        ?? document.querySelector('canvas')?.getBoundingClientRect()
      const rootStyle = getComputedStyle(document.documentElement)
      const headerBottom = document.querySelector('.header-bar')?.getBoundingClientRect().bottom ?? 0
      return [
        Math.round(box?.width ?? 0), Math.round(box?.height ?? 0),
        Math.round(box?.left ?? 0), Math.round(box?.top ?? 0),
        Math.round(Number.parseFloat(rootStyle.getPropertyValue('--hc-controls-left')) || 0),
        Math.round(Number.parseFloat(rootStyle.getPropertyValue('--hc-controls-right')) || 0),
        Math.round(headerBottom),
      ].join(':')
    }
    // A collapsed surface is never a framing — pixi-host refuses to follow the
    // host to 0×0 for the same reason. Ignoring it here keeps a transient
    // zero-size layout from spending a refit on a viewport nothing is in.
    const liveFrame = (): string | null => {
      const sig = frameSignature()
      return sig.startsWith('0:0:') ? null : sig
    }
    let lastFrame = liveFrame()
    const frameTimer = setInterval(() => {
      const next = liveFrame()
      if (next === null || next === lastFrame) return
      lastFrame = next
      onResize()
    }, 250)

    window.addEventListener('navigate', arm)
    window.addEventListener('resize', onResize)
    const offGuard = EffectBus.on('navigation:guard-end', arrived)
    const offCount = EffectBus.on('render:cell-count', arrived)
    this.#fitLockedUnsub = (): void => {
      window.removeEventListener('navigate', arm)
      window.removeEventListener('resize', onResize)
      if (resizeTimer !== null) { clearTimeout(resizeTimer); resizeTimer = null }
      clearInterval(frameTimer)
      offGuard()
      offCount()
      this.#fitArmedUntil = 0
      this.#fitArmedSticky = false
      // Switching off forgets where we had settled, so flipping back on
      // treats the page you are standing on as an arrival and fits it.
      this.#lastSettledPageKey = null
    }
  }

  /**
   * Manual zoom/pan holds the fit off for the rest of THIS visit, so a resize
   * can't yank back the view you just dialled in. The switch stays on: walk
   * anywhere (or come back here) and that layer fits again.
   */
  #disableFitLockedPreservingCurrent(): void {
    if (this.#fitMode() !== 'global') return

    // The page is the participant's from here on — persisted, so returning to
    // it later restores their framing instead of re-fitting over it.
    this.#markHandFramed(this.#currentPageKey(), true)
    this.#fitLockedSnapshot = null

    // Resume persistence so the user's manual adjustment saves for this page.
    const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
    vp?.resume?.()
  }

  /** Add / remove a page from the hand-framed set (persisted). */
  #markHandFramed(key: string, framed: boolean): void {
    const current = this.#handFramedPages()
    if (current.has(key) === framed) return
    const next = new Set(current)
    if (framed) next.add(key)
    else next.delete(key)
    this.#setHandFramedPages(next)
  }

  #setHandFramedPages(next: ReadonlySet<string>): void {
    this.#handFramedPages.set(next)
    this.#persistPageSet(HAND_FRAMED_PAGES_KEY, next)
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

    // persist restored state — 'user', or the default 'auto' leaves it in the
    // in-memory mirror only and turning the switch off never actually saves
    // the viewport it just put back.
    const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
    vp?.setZoom?.(snap.scale, snap.cx, snap.cy, false, 'user')
    vp?.setPan?.(snap.dx, snap.dy, 'user')
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
    this.#persistPageSet(PINNED_PAGES_KEY, next)
  }

  /** Partial-pin toggles (fit flyout). Per-page exceptions a fit respects —
   *  no input lock, so the page stays fully interactive. */
  readonly togglePinSize = (): void => {
    const key = this.#currentPageKey()
    const next = new Set(this.#pinnedSizePages())
    if (next.has(key)) next.delete(key)
    else next.add(key)
    this.#pinnedSizePages.set(next)
    this.#persistPageSet(PINNED_SIZE_PAGES_KEY, next)
  }

  readonly togglePinPosition = (): void => {
    const key = this.#currentPageKey()
    const next = new Set(this.#pinnedPositionPages())
    if (next.has(key)) next.delete(key)
    else next.add(key)
    this.#pinnedPositionPages.set(next)
    this.#persistPageSet(PINNED_POSITION_PAGES_KEY, next)
  }

  // The magnifiers ARE a gesture — 'user' explicitly, because the third
  // argument is the viewport SOURCE now. It used to be an undeclared
  // `'controls-bar'` tag that the drone ignored; read as a source it would
  // have quietly demoted these two buttons to non-gestures (no
  // `viewport:manual`, no persisted zoom).
  readonly zoomIn = (): void => {
    if (this.#locked()) return
    const center = this.#viewportCenter()
    this.zoom?.zoomByFactor?.(1.25, center, 'user')
  }

  readonly zoomOut = (): void => {
    if (this.#locked()) return
    const center = this.#viewportCenter()
    this.zoom?.zoomByFactor?.(0.8, center, 'user')
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

  /** Mobile center-button double-tap: flip the fit switch (same as ctrl+click). */
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
    // on a cold read; ghost cleanup now happens only on restore.) An EMPTY
    // clipboard opens too: the window is a swap, so an empty one is where the
    // next tile you click on the hive will land.
    //
    // Open the non-navigating clipboard SIDE PANEL. The current page stays
    // fully rendered and interactive behind it — no `'clipboard'` mode, no
    // `clipboard:view` page-replacement, no viewport snapshot/restore dance.
    // The panel (hc-clipboard-panel) lists the captured tiles and places
    // them onto THIS page in place.
    EffectBus.emit('clipboard:panel', { visible: true })
  }

  // ── bees ────────────────────────────────────────────

  readonly toggleBees = (): void => {
    const next = !this.#beesVisible()
    this.#beesVisible.set(next)
    localStorage.setItem('hc:bees-visible', String(next))
    EffectBus.emit('render:set-bees-visible', { visible: next })
  }

  readonly toggleAgents = (): void => {
    const next = !this.#agentsVisible()
    this.#agentsVisible.set(next)
    localStorage.setItem('hc:agents-visible', String(next))
    EffectBus.emit('render:set-agents-visible', { visible: next })
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
    // While editing, a drag on the list belongs to the icon being reordered —
    // scrolling it out from under the pointer at the same time would fight the
    // move. The wheel still scrolls the rail.
    if (this.#editMode()) return
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
    // IN LANDSCAPE RAILS A LEFTWARD DRAG IS THE STRIP SCROLL. The rails run
    // left↔right there and the finger may only travel that way, so an edge
    // swipe would pan the strip AND walk the lineage back in one gesture.
    // The Back disc and the hardware button remain the way back.
    if (this.lanesActive() && this.isLandscape()) return
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
