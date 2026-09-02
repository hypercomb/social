// preferences/mobile-mode.service.ts
//
// MobileModeService — the single source of truth for "are we in the mobile
// (viewer) experience?". See documentation/mobile-experience-plan.md §5 and
// documentation/mobile-rails-projection.md §9.
//
// Mode is active when the device auto-detects as a phone — a coarse pointer
// AND a phone-width viewport — UNLESS a manual override is set. `/mobile on`
// forces it on (so desktop can test the gate without device emulation),
// `/mobile off` forces it off, `/mobile auto` clears the override. The
// override persists in localStorage; auto-detection wins when unset.
//
// The gate in show-cell reads `.active` synchronously at render time and
// subscribes to the `mobile:mode` EffectBus channel for live changes.
//
// ONE DEFINITION OF MOBILE. The decision is also STAMPED on <html> —
// `data-hc-mobile="on|off"` and `data-hc-orientation="portrait|landscape"` —
// so a stylesheet keys on `:root[data-hc-mobile='on']` instead of keeping its
// own copy of the media query, and `/mobile on|off` drives the chrome, the
// pill, the rails and the deck together: they can never disagree. The
// orientation rides along because the rails turn with the device and the
// chrome turns with the rails. The `mobile:mode` effect is unchanged.

import { EffectBus } from '@hypercomb/core'
import {
  MOBILE_MODE_KEY,
  MOBILE_MODE_IOC_KEY,
  MOBILE_MODE_EFFECT,
} from './mobile-pheromones.js'

export type MobileOverride = 'on' | 'off' | 'auto'

export class MobileModeService extends EventTarget {
  #active = false
  #coarse?: MediaQueryList
  #narrow?: MediaQueryList
  #orientation?: MediaQueryList

  constructor() {
    super()
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this.#coarse = window.matchMedia('(pointer: coarse)')
      // Phone-shaped in EITHER dimension: narrow (portrait) OR short (landscape
      // — a phone on its side is wide but short). Matches the controls-bar's
      // mobile detection so the gate and the mobile chrome agree.
      this.#narrow = window.matchMedia('(max-width: 599px), (max-height: 449px)')
      this.#orientation = window.matchMedia('(orientation: landscape)')
      const onChange = () => this.#recompute()
      this.#coarse.addEventListener('change', onChange)
      this.#narrow.addEventListener('change', onChange)
      this.#orientation.addEventListener('change', () => this.#stamp())
    }
    this.#active = this.#compute()
    this.#stamp()
  }

  /** Whether the mobile viewer experience is currently active. */
  get active(): boolean {
    return this.#active
  }

  /** The current override, or `'auto'` when none is set. */
  get override(): MobileOverride {
    return this.#override() ?? 'auto'
  }

  #override(): 'on' | 'off' | null {
    try {
      const v = localStorage.getItem(MOBILE_MODE_KEY)
      return v === 'on' || v === 'off' ? v : null
    } catch {
      return null
    }
  }

  #auto(): boolean {
    return !!(this.#coarse?.matches && this.#narrow?.matches)
  }

  #compute(): boolean {
    const ov = this.#override()
    return ov ? ov === 'on' : this.#auto()
  }

  /** Which way the screen is long. Squares count as portrait — the same
   *  reading `laneStripHorizontal()` takes from the viewport. */
  #landscape(): boolean {
    if (this.#orientation) return this.#orientation.matches
    return typeof window !== 'undefined' && window.innerWidth > window.innerHeight
  }

  /** Write the decision where a stylesheet can read it. */
  #stamp(): void {
    const root = typeof document !== 'undefined' ? document.documentElement : null
    if (!root) return
    // Bracket access: the Angular dev build compiles essentials with
    // noPropertyAccessFromIndexSignature, and dot access on DOMStringMap is a
    // TS4111 that stops the whole shell from building.
    root.dataset['hcMobile'] = this.#active ? 'on' : 'off'
    root.dataset['hcOrientation'] = this.#landscape() ? 'landscape' : 'portrait'
  }

  #recompute(): void {
    const next = this.#compute()
    const changed = next !== this.#active
    this.#active = next
    this.#stamp()
    if (!changed) return
    this.dispatchEvent(new CustomEvent('change', { detail: { active: next } }))
    try {
      EffectBus.emit(MOBILE_MODE_EFFECT, { active: next })
    } catch {
      /* EffectBus unavailable — getter still authoritative */
    }
  }

  /** Set the manual override. `'auto'` clears it and returns to detection. */
  setOverride(mode: MobileOverride): void {
    try {
      if (mode === 'auto') localStorage.removeItem(MOBILE_MODE_KEY)
      else localStorage.setItem(MOBILE_MODE_KEY, mode)
    } catch {
      /* private mode / storage disabled — override just won't persist */
    }
    this.#recompute()
  }
}

// ── registration ────────────────────────────────────────
const _mobileMode = new MobileModeService()
window.ioc.register(MOBILE_MODE_IOC_KEY, _mobileMode)
// Seed the channel so late subscribers (the gate) read the current state
// even before the first change. EffectBus replays the last value.
try {
  EffectBus.emit(MOBILE_MODE_EFFECT, { active: _mobileMode.active })
} catch {
  /* ignore */
}
