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
// only on mobile, only on the hexagons surface, and it stands down
// entirely when the swarm's own picker is on screen — that pill is the
// picker where there are peer tiles, and two of them would be a lie
// about there being two selections.

import { Drone, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { MOBILE_MODE_EFFECT, MOBILE_MODE_IOC_KEY } from '../preferences/mobile-pheromones.js'

const SELECTION_KEY = '@diamondcoreprocessor.com/SelectionService'
const QUICK_MENU_INPUT_KEY = '@diamondcoreprocessor.com/QuickMenuInput'

/** The ring that opens over a picked set. Registered in QuickMenuRegistry. */
export const SELECTION_MENU = 'selection'

const STEEL = 'rgba(126,182,214,0.92)'
/** Thumb-target floor — the same one the fullscreen tile view uses. */
const TAP = '2.9rem'

type SelectionShape = {
  selected: ReadonlySet<string>
  add(label: string): void
  clear(): void
}
type QuickMenuLike = { open(name?: string): boolean }
type MobileModeLike = { active?: boolean }

export class SelectModeDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Pick tiles with a finger, then act on the set from the selection ring.'

  protected override deps = {}
  protected override listens = ['render:cell-count', 'selection:changed', 'sample:mode', MOBILE_MODE_EFFECT]
  protected override emits = ['select:mode']

  #registered = false
  #bound = false
  #host: HTMLDivElement | null = null

  #armed = false
  #mobile = false
  /** Every label on screen right now — what `select all` means here. */
  #labels: string[] = []
  /** Peer-published labels on screen. While there are any, the swarm's own
   *  picker owns the pill and this one stands down. */
  #external: string[] = []
  #selected: string[] = []
  /** The swarm picker is armed — its mode already suppresses navigation, so
   *  arming a second one would only confuse the disarm paths. */
  #sampling = false

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

    // Leaving the page ends the picking. A picked set is only meaningful
    // where it was picked — navigation clears the selection anyway, and an
    // armed mode surviving the move would silently keep taps from entering.
    this.onEffect('navigation:guard-start', () => this.disarm())

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

  /** Whether the pill belongs on screen at all. Armed always shows — a mode
   *  with no visible way out is a trap — but the idle invitation is mobile
   *  only, and never while the swarm's picker is up. */
  #wanted(): boolean {
    if (this.#armed) return true
    if (!this.#mobile) return false
    if (this.#sampling || this.#external.length > 0) return false
    return this.#labels.length > 0
  }

  #reconcile(): void {
    if (!this.#wanted()) { this.#teardown(); return }
    this.#render()
  }

  #teardown(): void {
    this.#host?.remove()
    this.#host = null
  }

  #render(): void {
    this.#teardown()

    const host = document.createElement('div')
    host.id = 'hc-select-pill'
    // Above the mobile control bar, clear of the home indicator. Centred so
    // it reads as a statement about the page rather than another bar control.
    host.style.cssText =
      'position:fixed;left:50%;transform:translateX(-50%);z-index:1400;' +
      'bottom:calc(6.2rem + env(safe-area-inset-bottom,0px));' +
      'display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.5rem;' +
      'border-radius:2rem;background:rgba(12,17,24,0.92);backdrop-filter:blur(10px);' +
      'border:1px solid rgba(126,182,214,0.35);box-shadow:0 10px 30px rgba(0,0,0,0.45);' +
      'font-family:inherit;pointer-events:auto;'

    if (!this.#armed) {
      host.appendChild(this.#button(
        this.#t('select.start', 'Select'),
        'select_all',
        false,
        () => this.arm(),
      ))
    } else {
      const count = this.#selected.length
      host.appendChild(this.#button(
        count === 0
          ? this.#t('select.hint', 'Tap the tiles you want')
          : this.#t('select.picked', `${count} picked`, { count }),
        count === 0 ? 'touch_app' : 'check_circle',
        count > 0,
        () => { if (count > 0) this.openOptions() },
        count === 0,
      ))
      if (count > 0) {
        host.appendChild(this.#button(
          this.#t('select.options', 'Options'),
          'more_horiz',
          false,
          () => this.openOptions(),
        ))
      }
      host.appendChild(this.#button(this.#t('select.done', 'Done'), 'close', false, () => {
        this.#selection()?.clear()
        this.disarm()
      }))
    }

    document.body.appendChild(host)
    this.#host = host
  }

  #button(text: string, glyph: string, accent: boolean, onTap: () => void, inert = false): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.style.cssText =
      `min-height:${TAP};padding:0 0.95rem;border-radius:2rem;cursor:pointer;` +
      'display:inline-flex;align-items:center;gap:0.45rem;font:inherit;font-size:0.92rem;font-weight:600;' +
      `background:${accent ? STEEL : 'transparent'};color:${accent ? '#04121b' : 'rgba(232,240,246,0.9)'};` +
      `border:1px solid ${accent ? 'transparent' : 'rgba(255,255,255,0.14)'};` +
      `opacity:${inert ? 0.55 : 1};`
    const icon = document.createElement('span')
    icon.textContent = glyph
    icon.style.cssText = "font-family:'Material Symbols Outlined';font-size:1.15rem;line-height:1;"
    btn.appendChild(icon)
    const span = document.createElement('span')
    span.textContent = text
    btn.appendChild(span)
    btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onTap() })
    return btn
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
