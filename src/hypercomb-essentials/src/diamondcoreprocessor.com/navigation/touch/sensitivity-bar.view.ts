// diamondcoreprocessor.com/navigation/touch/sensitivity-bar.view.ts
//
// <hc-sensitivity-bar> — the vertical touch-sensitivity indicator at the left
// screen edge, as a framework-free custom element (everything-is-a-beehavior
// Phase 2: Angular panels leave the shell and ship as signed modules).
//
// A straight port of shared/ui/sensitivity-bar: same surface name, same order
// band (280) in the shell-surface registry, same single effect
// ('touch:sensitivity-bar'), same log-scale fill arithmetic, same fade
// timings. The participant sees the identical bar — it now travels with the
// gesture coordinator that FEEDS it (touch-gesture.coordinator.ts emits the
// effect from this very folder) instead of being compiled into the shell.
//
// It carries no strings, so no i18n catalog ships with it.
//
// Shape notes:
//   - Registry-fed surfaces mount ONCE and stay, so the Angular `@if
//     (visible())` becomes a class on the host: the tag is display:none until
//     a payload says otherwise. It must never flash on boot.
//   - No shadow DOM (the sequence-viewer precedent): the styles are expanded
//     to plain CSS in a module-scope string, installed once into
//     document.head, with the TAG NAME standing in for Angular's `:host` and
//     prefixing every other selector so nothing leaks.
//   - The tree is three fixed nodes, so there is nothing to rebuild: the
//     chrome is built once in connectedCallback and each payload writes the
//     fill height and toggles classes. (No reconciler anywhere — by doctrine.)

import { EffectBus } from '@hypercomb/core'

const SURFACE_NAME = 'hc-sensitivity-bar'

/** The coordinator's payload — value in 0.25..4.0, plus lock and show flags. */
type SensitivityPayload = { value: number; locked: boolean; visible: boolean }

// ── the styles the Angular component carried, expanded to plain CSS ───────
// `:host` → the tag name (it keeps the fixed positioning AND the
// pointer-events:none that lets every gesture pass straight through the bar).
// The @if wrapper is gone, so the tag itself is the visibility switch.
const CSS = `
${SURFACE_NAME}{position:fixed;left:8px;top:50%;transform:translateY(-50%);z-index:9999;pointer-events:none;display:none}
${SURFACE_NAME}.visible{display:block}
${SURFACE_NAME} .sensitivity-bar{display:flex;flex-direction:column;align-items:center;gap:4px;opacity:.8;transition:opacity 300ms ease}
${SURFACE_NAME} .sensitivity-bar.fading{opacity:0;transition:opacity 1000ms ease}
${SURFACE_NAME} .track{position:relative;width:4px;height:120px;overflow:hidden;border-radius:2px;background:rgba(255,255,255,.15)}
${SURFACE_NAME} .fill{position:absolute;bottom:0;left:0;right:0;border-radius:2px;background:rgba(77,166,255,.7);transition:height 50ms ease}
${SURFACE_NAME} .lock-icon{font-size:10px;font-weight:bold;font-family:var(--hc-mono);color:rgba(255,166,77,.8)}
${SURFACE_NAME} .lock-icon.hidden{display:none}
${SURFACE_NAME} .locked .fill{background:rgba(255,166,77,.7)}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-sensitivity-bar', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class SensitivityBarElement extends HTMLElement {

  #bar: HTMLElement | null = null
  #fill: HTMLElement | null = null
  #lock: HTMLElement | null = null

  #offs: Array<() => void> = []
  #hideTimer: ReturnType<typeof setTimeout> | null = null

  connectedCallback(): void {
    installCss()
    if (!this.#bar) this.#render()
    this.#offs.push(
      EffectBus.on<SensitivityPayload>('touch:sensitivity-bar', payload => this.#apply(payload)),
    )
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    this.#clearTimers()
  }

  // ── chrome (built once — three fixed nodes, nothing to reconcile) ───────
  #render(): void {
    const bar = document.createElement('div')
    bar.className = 'sensitivity-bar'

    const track = document.createElement('div')
    track.className = 'track'
    const fill = document.createElement('div')
    fill.className = 'fill'
    track.appendChild(fill)

    // The Angular version created the lock glyph under `@if (locked())`; the
    // hidden class is the same thing — display:none keeps it out of the flex
    // flow, so the 4px gap does not open above an absent icon.
    const lock = document.createElement('div')
    lock.className = 'lock-icon hidden'
    lock.textContent = 'L'

    bar.append(track, lock)
    this.append(bar)

    this.#bar = bar
    this.#fill = fill
    this.#lock = lock
  }

  // ── the one effect that drives everything ──────────────────────────────
  // EffectBus replays the last value, so a late mount catches up on its own —
  // no catch-up logic here, and none wanted.
  #apply({ value, locked, visible: show }: SensitivityPayload): void {
    const bar = this.#bar
    if (!bar) return

    bar.classList.toggle('locked', locked)
    this.#lock?.classList.toggle('hidden', !locked)

    // map 0.25..4.0 (log scale) to 0..100%
    // ln(0.25)/ln(4) = -1, ln(4)/ln(4) = 1 → range [-1, 1] → [0, 100]
    const logNorm = Math.log(value) / Math.log(4) // -1 to 1
    const pct = Math.max(0, Math.min(100, (logNorm + 1) * 50))
    if (this.#fill) this.#fill.style.height = `${pct}%`

    if (show) {
      // Showing cancels any pending fade — the gesture came back.
      this.#clearTimers()
      this.classList.add('visible')
      bar.classList.remove('fading')
    } else {
      // start fade-out
      bar.classList.add('fading')
      // The FIRST hide sets the clock: repeat hide payloads during the fade
      // must not push the disappearance further out (the Angular version
      // overwrote its timer handle but the original timeout still fired, so
      // keeping the pending one reproduces the timing exactly — with only one
      // handle to clear on disconnect).
      if (this.#hideTimer === null) {
        this.#hideTimer = setTimeout(() => {
          this.#hideTimer = null
          this.classList.remove('visible')
          bar.classList.remove('fading')
        }, 1000)
      }
    }
  }

  #clearTimers(): void {
    if (this.#hideTimer !== null) { clearTimeout(this.#hideTimer); this.#hideTimer = null }
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  if (!customElements.get(SURFACE_NAME)) {
    customElements.define(SURFACE_NAME, SensitivityBarElement)
  }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/SensitivityBarElement',
    element: SURFACE_NAME,
    order: 280,
  })
})
