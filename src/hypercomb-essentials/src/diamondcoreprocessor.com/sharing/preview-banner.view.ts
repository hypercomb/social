// preview-banner.view.ts — the "adopt for review" strip as a framework-free
// custom element (everything-is-a-beehavior Phase 2: Angular panels leave the
// shell and arrive as signed modules).
//
// A straight port of shared/ui/preview-banner: same surface name, same order
// band in the shell-surface registry, same effect in (`preview:mode`) and the
// same two effects out (`hive:adopt-accept` / `hive:adopt-dismiss`) — the
// visitor sees the same strip, delivered from the module that owns the state
// it names (sharing/hive-visit.drone.ts, right beside this file).
//
// What the strip IS: while a preview is active the visitor browses a FOREIGN
// branch rendered from a session-only virtual head — nothing is written,
// commits are refused, a refresh forgets it. This strip names that state and
// carries the ONLY two exits: Adopt (fold it into your hive — the one real
// adopt gesture) and Dismiss (walk away, nothing kept).
//
// Not a docked panel: it extends HTMLElement directly and positions itself
// fixed, top-centre, exactly as the Angular :host did.
//
// Driven entirely by `preview:mode`. The Angular version used @if, so the
// element existed only while visible; a registry-fed element is mounted ONCE
// and stays, so visibility is a class (`.open`) and the children are built
// and cleared on show/hide. It starts hidden and only opens when the effect
// says active === true — EffectBus last-value replay means a late mount still
// receives the current value, so there is no catch-up logic here.
//
// Its strings ship WITH it (preview-banner.i18n.ts) and register under the
// 'app' namespace, so every key resolves exactly as before.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { PREVIEW_BANNER_TRANSLATIONS } from './preview-banner.i18n.js'

const SURFACE_NAME = 'hc-preview-banner'

type PreviewModePayload = {
  active?: boolean
  label?: string
  pubkey?: string
  hosts?: readonly string[]
  tiles?: number
}

/** {token} interpolation for the FALLBACK text — the live provider does its
 *  own; this only runs when i18n is absent or the key is unresolved. */
const fill = (template: string, params?: Record<string, string | number>): string =>
  params
    ? template.replace(/\{(\w+)\}/g, (whole, token: string) => {
      const value = params[token]
      return value !== undefined ? String(value) : whole
    })
    : template

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key, params)
  return value && value !== key ? value : fill(fallback, params)
}

// The strip's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(PREVIEW_BANNER_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// `:host` became the tag name; every other selector is prefixed with it so
// nothing leaks (there is no shadow DOM here — the tutorial-overlay and
// sequence-viewer precedent). The keyframes are renamed with the surface
// prefix because @keyframes names are global in every encapsulation mode.
//
// Quiet top-center strip, same chrome family as the presence banner: frosted
// dark pill, no motion beyond one soft pulse dot. The two buttons are the
// whole point — keep them unmistakable but cold.
//
// z-index note (unchanged from the SCSS): #pixi-host reparents itself to
// <body> at z-index 59989 with a pointer-events:auto <canvas> inside
// (pixi-host.worker.ts) — anything below that still PAINTS (the canvas is
// transparent) but has every click eaten, which left Adopt and Dismiss (the
// banner's only two exits) dead. Sit one step above the canvas, still below
// every piece of shell chrome (edit-actions 59995, controls/hint bars 59999,
// header bar 60000) so the old "chrome covers the banner" order is unchanged.
// One above the presence strip (59990), same as the old 56-over-55.
const CSS = `
${SURFACE_NAME}{position:fixed;top:max(calc(2.5rem * var(--hc-header-zoom,1) + 2.6rem),calc(var(--hc-header-anchor) + 2.27rem));left:50%;transform:translateX(-50%);z-index:59991;pointer-events:none;display:none;max-width:86vw}
${SURFACE_NAME}.open{display:block}
@media (pointer: coarse){${SURFACE_NAME}{top:max(calc(3.5rem * var(--hc-header-zoom,1) + 2.6rem),calc(var(--hc-header-anchor) + 3.27rem))}}
${SURFACE_NAME} .preview-banner{display:flex;align-items:center;gap:.5rem;padding:.3rem .65rem;background:color-mix(in srgb,var(--md-surface-c-low,#1a1a1a) 78%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(245,245,245,.1);border-radius:999px;pointer-events:auto;white-space:nowrap;font-size:.8rem;color:rgba(245,245,245,.85)}
${SURFACE_NAME} .pulse{width:.45rem;height:.45rem;border-radius:50%;background:#6fd39a;box-shadow:0 0 6px rgba(111,211,154,.7);animation:hc-preview-banner-pulse 2.2s ease-in-out infinite}
@keyframes hc-preview-banner-pulse{0%,100%{opacity:1}50%{opacity:.35}}
${SURFACE_NAME} .title{text-transform:uppercase;letter-spacing:.06em;font-size:.68rem;color:rgba(245,245,245,.55)}
${SURFACE_NAME} .name{font-weight:600;overflow:hidden;text-overflow:ellipsis;max-width:22vw}
${SURFACE_NAME} .meta{color:rgba(245,245,245,.45);font-size:.72rem}
${SURFACE_NAME} button{border:1px solid rgba(245,245,245,.14);border-radius:999px;padding:.18rem .7rem;font-size:.74rem;cursor:pointer;background:transparent;color:rgba(245,245,245,.85);transition:background 120ms ease,border-color 120ms ease}
${SURFACE_NAME} button:hover{background:rgba(245,245,245,.08)}
${SURFACE_NAME} .adopt{border-color:rgba(111,211,154,.5);color:#6fd39a}
${SURFACE_NAME} .adopt:hover{background:rgba(111,211,154,.12)}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-preview-banner', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class PreviewBannerElement extends HTMLElement {

  #state: PreviewModePayload | null = null
  #offs: Array<() => void> = []

  connectedCallback(): void {
    installCss()
    this.#offs.push(
      EffectBus.on<PreviewModePayload>('preview:mode', (payload) => {
        this.#state = payload ?? null
        this.#render()
      }),
      // THE PIPE WAS IMPURE. The Angular original resolved its strings through
      // the `t` pipe, declared `pure: false`, so every change-detection tick
      // re-read them and `/language ja` flipped an OPEN strip on the spot —
      // including Adopt and Dismiss, which are the preview's only two exits.
      // An element renders when it decides to, so the locale switch has to be
      // a reason to render. (controls-bar does the same for its breadcrumb.)
      EffectBus.on('locale:changed', () => this.#render()),
    )
    // Hidden until the effect says otherwise — a surface that flashes on boot
    // is a regression. (Replay delivers the live value immediately if there
    // already is one.)
    this.#render()
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
  }

  // ── rendering (rebuild on change — the house pattern; the state lives in
  // the drone, so throwing the DOM away and rebuilding is always safe) ─────
  #render(): void {
    const state = this.#state
    const visible = state?.active === true

    // The only thing a rebuild would destroy is focus, and this surface
    // re-renders WHILE VISIBLE in two real cases: a locale switch (above),
    // and a `preview:mode` re-emit that updates the strip in place. Tab onto
    // Adopt, switch language, and without this the focus would land back on
    // <body> — one keystroke from the exit, holding nothing. Snapshot which
    // button had it, restore it afterwards.
    //
    // (It does NOT fire on the declined-fold path: that emits active:false
    // first, which detaches the focused button before the restoring render
    // ever runs. Nothing to carry there, in this version or the Angular one.)
    const focused = document.activeElement
    const refocus = visible && focused instanceof HTMLElement && this.contains(focused)
      ? (focused.classList.contains('adopt') ? 'adopt' : focused.classList.contains('dismiss') ? 'dismiss' : '')
      : ''

    this.replaceChildren()
    this.classList.toggle('open', visible)
    if (!visible) return

    const label = String(state?.label ?? '')
    const tiles = Number(state?.tiles ?? 0)
    // Publisher shorthand — the pubkey's first 8 hex chars. Enough to tell
    // publishers apart; the full key is in the link they opened.
    const publisher = String(state?.pubkey ?? '').slice(0, 8)

    const banner = document.createElement('div')
    banner.className = 'preview-banner'
    banner.setAttribute('role', 'status')

    const pulse = document.createElement('span')
    pulse.className = 'pulse'
    pulse.setAttribute('aria-hidden', 'true')

    const title = document.createElement('span')
    title.className = 'title'
    title.textContent = t('preview.banner.title', 'Previewing')

    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = label

    const from = document.createElement('span')
    from.className = 'meta'
    from.textContent = t('preview.banner.from', 'from {publisher}', { publisher })

    banner.append(pulse, title, name, from)

    if (tiles > 0) {
      const count = document.createElement('span')
      count.className = 'meta'
      // Plural key: the provider resolves .one/.other from `count`; the
      // fallback picks the same branch by hand.
      count.textContent = t(
        'preview.banner.tiles',
        tiles === 1 ? '{count} tile' : '{count} tiles',
        { count: tiles },
      )
      banner.appendChild(count)
    }

    const adopt = document.createElement('button')
    adopt.type = 'button'
    adopt.className = 'adopt'
    adopt.textContent = t('preview.adopt', 'Adopt')
    adopt.addEventListener('click', () => { EffectBus.emit('hive:adopt-accept', {}) })

    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.className = 'dismiss'
    dismiss.textContent = t('preview.dismiss', 'Dismiss')
    dismiss.addEventListener('click', () => { EffectBus.emit('hive:adopt-dismiss', {}) })

    banner.append(adopt, dismiss)
    this.appendChild(banner)

    if (refocus === 'adopt') adopt.focus()
    else if (refocus === 'dismiss') dismiss.focus()
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host
// with no ShellSurfaceRegistry (diamond-core-processor mounts this tag
// directly in its own template) still needs the tag to be a real element
// rather than an inert unknown one — so the define cannot wait on the
// registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, PreviewBannerElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/PreviewBannerElement',
    element: SURFACE_NAME,
    order: 340,
  })
})
