// preferences/mobile-mode.service.ts
//
// MobileModeService — the single source of truth for "are we in the mobile
// (viewer) experience?". See documentation/mobile-experience-plan.md §5.
//
// Mode is active when the device auto-detects as a phone — a coarse pointer
// AND a phone-width viewport — UNLESS a manual override is set. `/mobile on`
// forces it on (so desktop can test the gate without device emulation),
// `/mobile off` forces it off, `/mobile auto` clears the override. The
// override persists in localStorage; auto-detection wins when unset.
//
// The gate in show-cell reads `.active` synchronously at render time and
// subscribes to the `mobile:mode` EffectBus channel for live changes.

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

  constructor() {
    super()
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this.#coarse = window.matchMedia('(pointer: coarse)')
      // Phone-shaped in EITHER dimension: narrow (portrait) OR short (landscape
      // — a phone on its side is wide but short). Matches the controls-bar's
      // mobile detection so the gate and the mobile chrome agree.
      this.#narrow = window.matchMedia('(max-width: 599px), (max-height: 449px)')
      const onChange = () => this.#recompute()
      this.#coarse.addEventListener('change', onChange)
      this.#narrow.addEventListener('change', onChange)
    }
    this.#active = this.#compute()
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

  #recompute(): void {
    const next = this.#compute()
    if (next === this.#active) return
    this.#active = next
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
