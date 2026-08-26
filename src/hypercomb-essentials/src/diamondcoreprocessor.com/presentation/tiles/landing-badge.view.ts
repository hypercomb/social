// landing-badge.view.ts — THE THING ON TOP, the visible half of quiet
// landing, as a framework-free custom element (everything-is-a-beehavior
// Phase 2: Angular panels leave the shell and ship as signed modules).
//
// A straight port of shared/ui/landing-badge: same surface name
// (hc-landing-badge), same order band (345), same single effect in
// (`landing:pending`) and same single effect out (`landing:apply`) — the
// participant sees the same pill, delivered as a module instead of compiled
// into the shell.
//
// WHAT IT IS FOR. When the bridge answers an ask raised from a tile, the
// payload lands in the hive immediately: layer minted, note on the cell,
// resource in the pool. The REPAINT is what waits (show-cell.drone.ts
// #quietLanding), so a drained batch of twenty writes doesn't strobe the
// surface somebody is still working in. This pill is how they find out. It
// says how many changes are waiting and where, and tapping it is the ONLY
// thing that releases the held paint — no idle timer, no auto-apply on
// navigation. The participant decides when the ground moves.
//
// The whole pill is the release: one target, no hunting for a button.
//
// LIFECYCLE NOTE. The Angular version wrapped its markup in `@if (visible())`,
// so the element only existed while something was owed. A registry-fed
// element is mounted ONCE at boot and stays, so visibility is a class on the
// host (`.open`, the sequence-viewer pattern) and the host starts hidden —
// a badge that flashes on boot would read as an alarm, which is the one
// thing this surface must never be.
//
// Its strings ship WITH it (landing-badge.i18n.ts, extracted from all 14
// shell catalogs) and register under the 'app' namespace, so every key
// resolves exactly as before — the Phase 2 catalog split, another slice.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { LANDING_BADGE_TRANSLATIONS } from './landing-badge.i18n.js'

const SURFACE_NAME = 'hc-landing-badge'

type LandingPendingPayload = {
  /** Writes that landed unseen. Zero means nothing is owed — hide. */
  count?: number
  /** Explorer label of the layer they landed on, for "…on /dolphin". */
  where?: string
}

// Same contract as the shell pipe: params drive both pluralization
// (`key.one` / `key.other`, chosen on params.count by the i18n service) and
// `{token}` interpolation. The fallback is the English catalog text, and it
// interpolates the same tokens so a bare host with no i18n reads identically.
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key, params)
  if (value && value !== key) return value
  if (!params) return fallback
  return fallback.replace(/\{(\w+)\}/g, (whole, token: string) =>
    token in params ? String(params[token]) : whole)
}

// The badge's strings travel with it — registered as soon as the i18n
// service is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(LANDING_BADGE_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is
// prefixed with it — nothing can leak out of the badge.
//
// Two positions worth keeping the reasoning for:
//   - TOP is one step below the preview banner, so the two never overlap
//     when a visitor is previewing a hive AND the bridge is writing into it.
//   - Z-INDEX 59992: #pixi-host reparents to <body> at 59989 with a
//     pointer-events:auto canvas inside, which would eat the tap that is
//     this badge's entire reason to exist. Sit above it, still below every
//     piece of shell chrome (edit-actions 59995, controls bars 59999,
//     header 60000), and one above the preview banner (59991), the surface
//     directly over it.
// The keyframes name is namespaced (`hc-landing-badge-pulse`) because a
// document-level sheet shares one global animation namespace.
const CSS = `
${SURFACE_NAME}{position:fixed;top:max(calc(2.5rem * var(--hc-header-zoom,1) + 4.9rem),calc(var(--hc-header-anchor) + 4.57rem));left:50%;transform:translateX(-50%);z-index:59992;pointer-events:none;display:none;max-width:86vw}
${SURFACE_NAME}.open{display:block}
@media (pointer:coarse){${SURFACE_NAME}{top:max(calc(3.5rem * var(--hc-header-zoom,1) + 4.9rem),calc(var(--hc-header-anchor) + 5.57rem))}}
${SURFACE_NAME} .landing-badge{display:flex;align-items:center;gap:.5rem;padding:.3rem .65rem;background:color-mix(in srgb,var(--md-surface-c-low,#1a1a1a) 78%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(245,245,245,.1);border-radius:999px;pointer-events:auto;white-space:nowrap;font-size:.8rem;font-family:inherit;color:rgba(245,245,245,.85);cursor:pointer;transition:background 120ms ease,border-color 120ms ease}
${SURFACE_NAME} .landing-badge:hover{border-color:rgba(226,183,94,.45);background:color-mix(in srgb,var(--md-surface-c-low,#1a1a1a) 86%,transparent)}
${SURFACE_NAME} .dot{width:.45rem;height:.45rem;border-radius:50%;background:#e2b75e;box-shadow:0 0 6px rgba(226,183,94,.7);animation:hc-landing-badge-pulse 2.2s ease-in-out infinite}
@keyframes hc-landing-badge-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){${SURFACE_NAME} .dot{animation:none}}
${SURFACE_NAME} .count{font-weight:600}
${SURFACE_NAME} .where{color:rgba(245,245,245,.45);font-size:.72rem;overflow:hidden;text-overflow:ellipsis;max-width:22vw}
${SURFACE_NAME} .show{border:1px solid rgba(226,183,94,.5);border-radius:999px;padding:.18rem .7rem;font-size:.74rem;color:#e2b75e}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-landing-badge', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class LandingBadgeElement extends HTMLElement {

  #offs: Array<() => void> = []
  #state: LandingPendingPayload | null = null
  /** The tap target. Built once and kept — replacing it would drop focus
   *  mid-keyboard-use, and it is the only interactive thing here. Its
   *  CHILDREN rebuild on every payload (the house pattern: state lives in
   *  the effect, so rebuilding the labels is always safe). */
  #button: HTMLButtonElement | null = null

  get #count(): number { return Math.max(0, Number(this.#state?.count ?? 0)) }

  /** Root reads as "/" — no point naming it, the badge is already there. */
  get #where(): string {
    const raw = String(this.#state?.where ?? '').trim()
    return raw && raw !== '/' ? raw : ''
  }

  connectedCallback(): void {
    installCss()
    this.#build()
    // Last-value replay means a late mount still receives the current
    // pending count — there is no catch-up to write here.
    this.#offs.push(
      EffectBus.on<LandingPendingPayload>('landing:pending', (payload) => {
        this.#state = payload ?? null
        this.#render()
      }),
      // THE PIPE WAS IMPURE. The Angular original resolved its strings through
      // the `t` pipe, declared `pure: false`, so every change-detection tick
      // re-read them and `/language ja` re-labelled an OPEN badge on the spot.
      // An element renders when it decides to, so the locale switch has to be
      // a reason to render — otherwise a badge that is already up keeps its
      // old-locale text and aria-label until the next pending count happens
      // to arrive. (controls-bar does the same thing for its breadcrumb.)
      EffectBus.on('locale:changed', () => this.#render()),
    )
    this.#render()
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    this.#button = null
    this.replaceChildren()
    this.classList.remove('open')
  }

  // ── chrome (built once) ──────────────────────────────────────────────
  #build(): void {
    if (this.#button) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'landing-badge'
    // The ONE release. The renderer clears the badge by publishing count 0
    // on the pass this triggers — nothing to reset here.
    button.addEventListener('click', () => { EffectBus.emit('landing:apply', {}) })
    // Built DETACHED. `#render` attaches it when something is owed and takes
    // it back out when nothing is — so the pill is absent from the DOM at
    // rest, exactly as the Angular `@if` left it, with no transient attach
    // on the way through mount.
    this.#button = button
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ──
  #render(): void {
    const button = this.#button
    if (!button) return

    const count = this.#count
    // `!(count > 0)`, NOT `count <= 0` — the polarity is load-bearing. The
    // Angular original showed the pill on `count() > 0`, which is FALSE for a
    // NaN count (a foreign emitter sending a non-numeric count showed
    // nothing). Negating to `<= 0` is also false for NaN, so the guard would
    // fall through and paint "NaN changes are waiting". Keep the original
    // direction and NaN stays hidden.
    if (!(count > 0)) {
      // Nothing owed: fold away and TAKE THE PILL OUT OF THE DOM. Angular's
      // `@if` removed the element entirely, and the feature's own acceptance
      // driver asserts exactly that (`drive-quiet-landing.cjs`: the badge is
      // absent before anything lands). Detaching rather than rebuilding keeps
      // the button — and its click listener, the one release — alive:
      // `replaceChildren` MOVES an existing node back in.
      this.classList.remove('open')
      button.replaceChildren()
      button.remove()
      return
    }
    // Back in, if it was out. Moving a live node, never re-creating it.
    if (button.parentNode !== this) this.replaceChildren(button)

    button.setAttribute('aria-label',
      t('landing.aria', 'Show the changes that landed while you were working'))

    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.setAttribute('aria-hidden', 'true')

    const pending = document.createElement('span')
    pending.className = 'count'
    pending.textContent = count === 1
      ? t('landing.pending', '1 change is waiting', { count })
      : t('landing.pending', '{count} changes are waiting', { count })

    const parts: HTMLElement[] = [dot, pending]

    const where = this.#where
    if (where) {
      const label = document.createElement('span')
      label.className = 'where'
      label.textContent = t('landing.where', 'on {where}', { where })
      parts.push(label)
    }

    const show = document.createElement('span')
    show.className = 'show'
    show.textContent = t('landing.show', 'Show')
    parts.push(show)

    button.replaceChildren(...parts)
    this.classList.add('open')
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  if (!customElements.get(SURFACE_NAME)) {
    customElements.define(SURFACE_NAME, LandingBadgeElement)
  }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/LandingBadgeElement',
    element: SURFACE_NAME,
    order: 345,
  })
})
