// diamondcoreprocessor.com/selection/select-mode.drone.ts
//
// SELECT MODE — picking tiles with a finger.
//
// ── The hole this fills ───────────────────────────────────────────────
//
// A pointer says "pick this one" by holding ctrl. A finger has no
// modifiers, and on touch a press on a branch tile navigates on
// POINTERDOWN — the view changes before any hold can mature, and the
// consumed pointer kills every hold timer watching it. The result was
// that nothing on a phone could select a tile at all: no marking a set,
// no bulk remove, no clipboard, no bracket form.
//
// SampleSwarmDrone already solved this shape for peer tiles — arm a mode,
// stop navigating, turn taps into toggles. This is that same mode with the
// swarm taken out of it: general picking, on any page, over any tiles.
//
// ── Selection is the substrate ────────────────────────────────────────
//
// This mints no picked-set of its own. Tiles land in the ordinary
// SelectionService, so they ring on the canvas with the visuals that
// already exist and every verb that reads a selection — pheromones, the
// command line's bracket form, remove, the clipboard — sees the same set.
// The only thing this adds is a way for a FINGER to build one.
//
// ── Where the options live ────────────────────────────────────────────
//
// Once tiles are picked, the seven-hexagon ring is the menu: `selection`
// is a registered vocabulary like any other, so the verbs are data and
// nothing here branches on a feature name. The pill's Options button is
// the touch door onto the same ring the gesture summons.
//
// ── Why a pill and not a bar icon ─────────────────────────────────────
//
// The mobile control bar is deliberately capped, and the root ring's
// seven slots are spoken for. A pill costs no permanent chrome: it is
// only on mobile and only on the hexagons surface.
//
// ── ONE picker, always there ──────────────────────────────────────────
//
// It used to stand down whenever peer tiles were on screen, handing the
// job to the swarm's own pill — so in a swarm, the place you most want
// to pick things, the general picker vanished. And it used to hide
// itself on a page that had not reported any tiles yet. Between the two,
// "select" was a control that came and went. It does not any more: on
// mobile the pill is ALWAYS up, and KEEPING peer tiles is just another
// verb it offers once the picked set contains somebody else's tile
// (SampleSwarmDrone still owns the keeping — this only asks it).
//
// ── It is BUILT ONCE ──────────────────────────────────────────────────
//
// The pill used to be torn down and re-created on every `selection:changed`
// and every render. A tap on a phone is pointerdown → (re-render destroys
// the button) → pointerup on nothing → NO CLICK. That is why picking
// "worked sometimes": each pick destroyed the control you were pressing.
// The host and its buttons are now built once and UPDATED in place.

import { Drone, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { MOBILE_MODE_EFFECT, MOBILE_MODE_IOC_KEY } from '../preferences/mobile-pheromones.js'

const SELECTION_KEY = '@diamondcoreprocessor.com/SelectionService'
const QUICK_MENU_INPUT_KEY = '@diamondcoreprocessor.com/QuickMenuInput'
const SAMPLE_SWARM_KEY = '@diamondcoreprocessor.com/SampleSwarmDrone'

/** The ring that opens over a picked set. Registered in QuickMenuRegistry. */
export const SELECTION_MENU = 'selection'

const STEEL = 'rgba(126,182,214,0.92)'
/** Thumb-target floor — the same one the fullscreen tile view uses. */
const TAP = '2.9rem'
/** Above the reparented Pixi CANVAS, which is the thing that actually has to
 *  be cleared: #pixi-host moves itself to <body> at z-index 59989 with a
 *  pointer-events:auto <canvas> inside (pixi-host.worker.ts). The old 59000
 *  read as "above every canvas-level surface" but was 989 SHORT of the canvas
 *  itself — the pill painted correctly and every tap on it (including Done)
 *  landed on the canvas.
 *
 *  Going above 59988 is safe even though the fullscreen takeovers sit there:
 *  they announce themselves with `view:active`, which this drone listens to
 *  and reconciles the pill away on (#reconcile), and which also hides
 *  #pixi-host — so nothing here can paint over a takeover.
 *
 *  Still below every piece of shell chrome (edit-actions 59995, controls/hint
 *  bars 59999, header bar 60000). Shared with the sample-swarm pill, which
 *  occupies the same slot and is mutually exclusive with this one. */
const PILL_Z = 59992

type SelectionShape = {
  selected: ReadonlySet<string>
  add(label: string): void
  clear(): void
}
type QuickMenuLike = { open(name?: string): boolean }
type MobileModeLike = { active?: boolean }
/** The swarm picker, asked to keep the peer tiles in the current selection. */
type SampleSwarmLike = { keepSelected(labels: readonly string[]): void }

/** The pill's buttons, held so they can be updated instead of rebuilt. */
type PillParts = {
  host: HTMLDivElement
  primary: HTMLButtonElement
  keep: HTMLButtonElement
  options: HTMLButtonElement
  done: HTMLButtonElement
}

export class SelectModeDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Pick tiles with a finger, then act on the set from the selection ring.'

  protected override deps = {}
  protected override listens = ['render:cell-count', 'selection:changed', 'sample:mode', 'view:active', 'adopt:done', MOBILE_MODE_EFFECT]
  protected override emits = ['select:mode']

  #registered = false
  #bound = false
  /** The pill, built once (see the file header) — never re-created. */
  #parts: PillParts | null = null
  /** The viewport frame that says "you are picking". */
  #frame: HTMLDivElement | null = null

  #armed = false
  #mobile = false
  /** Every label on screen right now — what `select all` means here. */
  #labels: string[] = []
  /** Peer-published labels on screen — the ones that can be KEPT. */
  #external: string[] = []
  #selected: string[] = []
  /** The swarm picker is armed — its mode already suppresses navigation, so
   *  arming a second one would only confuse the disarm paths. */
  #sampling = false
  /** A full-surface view owns the viewport — the pill has no business over it. */
  #viewActive = false

  get armed(): boolean { return this.#armed }

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#registered) {
      window.ioc.register('@diamondcoreprocessor.com/SelectModeDrone', this)
      this.#registered = true
    }
    if (this.#bound) return
    this.#bound = true

    this.#mobile = !!(window.ioc?.get?.(MOBILE_MODE_IOC_KEY) as MobileModeLike | undefined)?.active

    this.onEffect<{ labels?: unknown; externalLabels?: unknown }>('render:cell-count', payload => {
      this.#labels = toLabels(payload?.labels)
      this.#external = toLabels(payload?.externalLabels)
      this.#reconcile()
    })

    this.onEffect<{ selected?: unknown }>('selection:changed', payload => {
      this.#selected = toLabels(payload?.selected)
      this.#reconcile()
    })

    this.onEffect<{ active?: boolean }>('sample:mode', payload => {
      this.#sampling = !!payload?.active
      // Both modes suppress navigation identically; one of them is enough.
      if (this.#sampling && this.#armed) this.disarm()
      else this.#reconcile()
    })

    this.onEffect<{ active?: boolean }>(MOBILE_MODE_EFFECT, payload => {
      this.#mobile = !!payload?.active
      this.#reconcile()
    })

    // A full-surface view (a tile's own screen, a website, a deck) has taken
    // the viewport. The pill is body-appended, so the chrome-hiding that
    // takeover performs does not reach it — stand down explicitly, or it
    // floats over somebody's page.
    this.onEffect<{ active?: boolean }>('view:active', payload => {
      this.#viewActive = !!payload?.active
      this.#reconcile()
    })

    // Leaving the page ends the picking. A picked set is only meaningful
    // where it was picked — navigation clears the selection anyway, and an
    // armed mode surviving the move would silently keep taps from entering.
    this.onEffect('navigation:guard-start', () => this.disarm())

    // Keeping peer tiles is the end of that picking session — the fold
    // re-renders and the set it was built from is now yours.
    this.onEffect('adopt:done', () => this.disarm())

    // Ring verbs. `select:done` is the centre slot (the way out costs no
    // travel); `select:all` is the one verb a picked set has that no other
    // surface offers.
    this.onEffect('select:done', () => {
      this.#selection()?.clear()
      this.disarm()
    })
    this.onEffect('select:all', () => {
      const selection = this.#selection()
      if (!selection) return
      this.arm()
      for (const label of this.#labels) selection.add(label)
    })

    this.#reconcile()
  }

  // ── mode ──────────────────────────────────────────────────────────

  arm(): void {
    if (this.#armed) return
    this.#armed = true
    this.emitEffect('select:mode', { active: true })
    this.#reconcile()
  }

  disarm(): void {
    if (!this.#armed) return
    this.#armed = false
    this.emitEffect('select:mode', { active: false })
    this.#reconcile()
  }

  toggle(): void {
    if (this.#armed) {
      this.#selection()?.clear()
      this.disarm()
    } else {
      this.arm()
    }
  }

  /** Open the selection ring. Sticky — aim by direction, tap to fire. */
  openOptions(): boolean {
    return !!window.ioc?.get?.<QuickMenuLike>(QUICK_MENU_INPUT_KEY)?.open(SELECTION_MENU)
  }

  // ── pill ──────────────────────────────────────────────────────────

  /** Whether the pill belongs on screen at all. On mobile: ALWAYS — a picker
   *  that comes and goes is a picker you cannot rely on, and "is there
   *  anything here to pick" is a question the pill itself answers better than
   *  its own absence does. Off mobile it shows only while armed, because a
   *  pointer picks with ctrl and needs no invitation — but an armed mode with
   *  no visible way out would be a trap. */
  #wanted(): boolean {
    if (this.#viewActive) return false
    if (this.#armed) return true
    // The swarm's own picker is armed and owns the gesture; two pills would
    // claim there are two selections.
    if (this.#sampling) return false
    return this.#mobile
  }

  /** Peer-published tiles in the picked set — what "keep" would act on. Only
   *  somebody else's tile can be kept; your own are already yours. */
  #keepable(): string[] {
    const peers = new Set(this.#external)
    return this.#selected.filter(label => peers.has(label))
  }

  #reconcile(): void {
    if (!this.#wanted()) { this.#teardown(); return }
    this.#update()
  }

  #teardown(): void {
    this.#parts?.host.remove()
    this.#parts = null
    this.#frame?.remove()
    this.#frame = null
  }

  /** Build the pill ONCE. Every later change is a text/visibility update on
   *  these same nodes — see the file header: rebuilding under a finger is
   *  what made picking unreliable. */
  #build(): PillParts {
    const host = document.createElement('div')
    host.id = 'hc-select-pill'
    // Above the mobile control bar, clear of the home indicator. Centred so
    // it reads as a statement about the page rather than another bar control.
    host.style.cssText =
      `position:fixed;left:50%;transform:translateX(-50%);z-index:${PILL_Z};` +
      // --hc-mobile-row-lift is published by the controls bar while its view
      // row is up: the pill rises with the row and drops back when it closes,
      // so the two never stack on the same band of screen.
      'bottom:calc(6.2rem + var(--hc-mobile-row-lift, 0px) + env(safe-area-inset-bottom,0px));' +
      'display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.5rem;' +
      'border-radius:2rem;background:rgba(12,17,24,0.92);backdrop-filter:blur(10px);' +
      'border:1px solid rgba(126,182,214,0.35);box-shadow:0 10px 30px rgba(0,0,0,0.45);' +
      'font-family:inherit;pointer-events:auto;max-width:94vw;'

    // The primary slot carries the whole idle→armed→picked story: it is the
    // Select invitation, then the "tap the tiles" hint, then the count. One
    // button in one place, so nothing moves under the finger between states.
    const primary = this.#button(() => {
      if (!this.#armed) { this.arm(); return }
      if (this.#selected.length > 0) this.openOptions()
    })
    const keep = this.#button(() => {
      const keepable = this.#keepable()
      if (keepable.length === 0) return
      const swarm = window.ioc?.get?.(SAMPLE_SWARM_KEY) as SampleSwarmLike | undefined
      swarm?.keepSelected?.(keepable)
    })
    const options = this.#button(() => this.openOptions())
    const done = this.#button(() => {
      this.#selection()?.clear()
      this.disarm()
    })

    host.append(primary, keep, options, done)
    document.body.appendChild(host)
    return { host, primary, keep, options, done }
  }

  #update(): void {
    const parts = this.#parts ?? (this.#parts = this.#build())
    const count = this.#selected.length
    const keepable = this.#keepable().length

    if (!this.#armed) {
      this.#face(parts.primary, this.#t('select.start', 'Select'), 'select_all', false, false)
      this.#show(parts.keep, false)
      this.#show(parts.options, false)
      this.#show(parts.done, false)
    } else {
      this.#face(
        parts.primary,
        count === 0
          ? this.#t('select.hint', 'Tap the tiles you want')
          : this.#t('select.picked', `${count} picked`, { count }),
        count === 0 ? 'touch_app' : 'check_circle',
        count > 0,
        count === 0,
      )
      // KEEP is the swarm verb, folded in rather than given a second pill:
      // picking somebody else's tile and picking your own are the same
      // gesture, so they belong to the same control.
      this.#show(parts.keep, keepable > 0)
      if (keepable > 0) {
        this.#face(parts.keep, this.#t('swarm.sample.keep', `Keep ${keepable}`, { count: keepable }), 'download', true, false)
      }
      this.#show(parts.options, count > 0)
      if (count > 0) this.#face(parts.options, this.#t('select.options', 'Options'), 'more_horiz', false, false)
      this.#show(parts.done, true)
      this.#face(parts.done, this.#t('select.done', 'Done'), 'close', false, false)
    }

    this.#paintFrame()
  }

  /** The armed cue you cannot miss: a steel frame drawn around the whole
   *  viewport while picking is on. Jaime, on the old experience: "it's really
   *  horrible still — maybe you tint the screen". A ring rather than a tint,
   *  because a tint over the hive would fight the tiles' own colours, and a
   *  static ring rather than a pulse — the chrome stays cold. Nothing here is
   *  clickable; it only says which mode you are in. */
  #paintFrame(): void {
    if (!this.#armed) {
      this.#frame?.remove()
      this.#frame = null
      return
    }
    if (this.#frame) return
    const frame = document.createElement('div')
    frame.id = 'hc-select-frame'
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText =
      `position:fixed;inset:0;z-index:${PILL_Z - 1};pointer-events:none;` +
      `border:2px solid ${STEEL};` +
      'box-shadow:inset 0 0 0 1px rgba(126,182,214,0.25), inset 0 0 34px rgba(126,182,214,0.13);'
    document.body.appendChild(frame)
    this.#frame = frame
  }

  /** A pill button, created empty. `#face` fills it in; the nodes never
   *  change identity, so a press is never interrupted by a re-render. */
  #button(onTap: () => void): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    const icon = document.createElement('span')
    icon.dataset['role'] = 'glyph'
    icon.style.cssText = "font-family:'Material Symbols Outlined';font-size:1.15rem;line-height:1;"
    const span = document.createElement('span')
    span.dataset['role'] = 'text'
    btn.append(icon, span)
    btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onTap() })
    return btn
  }

  /** Set a button's text, glyph and emphasis. */
  #face(btn: HTMLButtonElement, text: string, glyph: string, accent: boolean, inert: boolean): void {
    btn.style.cssText =
      `min-height:${TAP};padding:0 0.95rem;border-radius:2rem;cursor:pointer;` +
      // Without nowrap the longest label ("Tap the tiles you want") wraps at
      // phone width and the pill grows to nearly double height — a fat slab
      // over the canvas instead of a thin bar above the controls.
      'display:inline-flex;align-items:center;gap:0.45rem;white-space:nowrap;font:inherit;font-size:0.92rem;font-weight:600;' +
      `background:${accent ? STEEL : 'transparent'};color:${accent ? '#04121b' : 'rgba(232,240,246,0.9)'};` +
      `border:1px solid ${accent ? 'transparent' : 'rgba(255,255,255,0.14)'};` +
      `opacity:${inert ? 0.55 : 1};`
    const glyphEl = btn.querySelector('[data-role="glyph"]') as HTMLElement | null
    const textEl = btn.querySelector('[data-role="text"]') as HTMLElement | null
    if (glyphEl) glyphEl.textContent = glyph
    if (textEl) textEl.textContent = text
  }

  #show(btn: HTMLButtonElement, on: boolean): void {
    btn.style.display = on ? 'inline-flex' : 'none'
  }

  #selection(): SelectionShape | undefined {
    try { return window.ioc?.get?.(SELECTION_KEY) as SelectionShape | undefined } catch { return undefined }
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    try {
      const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
      const v = i18n?.t(key, params)
      return v && v !== key ? v : fallback
    } catch { return fallback }
  }
}

function toLabels(value: unknown): string[] {
  return Array.isArray(value) ? value.map(v => String(v)).filter(Boolean) : []
}

const _selectMode = new SelectModeDrone()
window.ioc.register('@diamondcoreprocessor.com/SelectModeDrone', _selectMode)
