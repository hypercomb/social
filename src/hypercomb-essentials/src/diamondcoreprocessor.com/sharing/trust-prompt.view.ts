// trust-prompt.view.ts — THE ACTIVATION TRUST GATE'S FACE, as a
// framework-free custom element (everything-is-a-beehavior Phase 2: Angular
// panels leave the shell and arrive as signed modules).
//
// A straight port of shared/ui/trust-prompt: same surface name
// (hc-trust-prompt), same order band (270), same single effect in
// (`trust:check`, the TRUST_CHECK constant in core), no effects out — the
// answer travels back through the REQUEST'S OWN CALLBACK, not the bus.
//
// WHAT IT IS FOR. Adoption is downloading bytes and is always safe.
// ACTIVATION — letting adopted code execute — is what carries risk, because a
// bee that registers in IoC has the participant's whole tree. When somebody
// enables code from a domain that is not in their trusted community,
// TrustService.check (sharing/trust-service.ts, right beside this file) emits
// `trust:check` and PARKS ON A PROMISE. This prompt is the only thing that
// settles it.
//
// THEREFORE: EVERY EXIT PATH ANSWERS EXACTLY ONCE. Four ways out — the
// backdrop (deny), and the three buttons — all funnel through #resolve, which
// pops the head before it can be answered a second time. An exit that answers
// twice double-activates; an exit that never answers hangs the enable forever
// (the caller's `await` simply never returns). The decision VALUES are copied
// from the Angular original verbatim, not inferred from the button labels:
//
//   deny          → { allow: false, addToCommunity: false }
//   allow once    → { allow: true,  addToCommunity: false }
//   allow always  → { allow: true,  addToCommunity: true  }
//
// (allow-once vs allow-always is the difference between TrustService's
// session-only Set and a write into `hc:community:domains` — the service reads
// `addToCommunity`, so the flag IS the persistence, and swapping the two would
// silently make "allow this time" permanent.)
//
// THE QUEUE. Back-to-back checks stack; only the head is on screen, and
// resolving advances to the next. Every caller keeps waiting until its own
// request reaches the head and gets answered.
//
// LIFECYCLE NOTE. The Angular version wrapped everything in `@if (visible())`,
// so backdrop and panel did not EXIST while nothing was pending. A registry-fed
// element is mounted ONCE at boot and stays, so the nodes are built once and
// genuinely detached (`replaceChildren()`) when there is nothing to ask — a
// modal that is merely `display:none` still answers querySelector, and a
// full-screen backdrop that is merely transparent would eat every click on the
// hive. It starts hidden and only opens when a request arrives.
//
// Its strings ship WITH it (inlined below, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice.

import {
  EffectBus,
  I18N_IOC_KEY,
  TRUST_CHECK,
  type I18nProvider,
  type TrustCheckRequest,
  type TrustDecision,
} from '@hypercomb/core'
import { TRUST_PROMPT_TRANSLATIONS } from './trust-prompt.i18n.js'

const SURFACE_NAME = 'hc-trust-prompt'


/** {token} interpolation for the FALLBACK text — the live provider does its
 *  own; this only runs when i18n is absent or the key is unresolved. */
const fill = (template: string, params?: Record<string, string | number>): string =>
  params
    ? template.replace(/\{(\w+)\}/g, (whole, token: string) => {
      const value = params[token]
      return value !== undefined ? String(value) : whole
    })
    : template

// Same contract as the shell pipe: params drive both pluralization
// (`key.one` / `key.other`, chosen on params.count by the i18n service) and
// `{token}` interpolation. The fallback is the English catalog text, and it
// interpolates the same tokens so a bare host with no i18n reads identically.
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key, params)
  return value && value !== key ? value : fill(fallback, params)
}

// The prompt's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(TRUST_PROMPT_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay / sequence-viewer / landing-badge
// precedent), so Angular's `:host` becomes the tag name and every other
// selector is prefixed with it — nothing leaks out of the prompt.
//
// The z-index reasoning is the SCSS's own, kept verbatim because it is
// load-bearing: #pixi-host reparents itself to <body> at z-index 59989 with a
// pointer-events:auto <canvas> inside (pixi-host.worker.ts). Anything below
// that still PAINTS (the canvas is transparent) but has every click eaten —
// and because the caller's promise only settles on a decision, an unclickable
// trust prompt hangs the activation it gates FOREVER. This is a modal, not a
// full-surface takeover, so it rides the modal tier the other dialogs use
// (confirm-dialog / mesh-modal: 100000/100001) rather than suppressing the
// canvas; the hive stays visible behind the translucent backdrop.
//
// Both @keyframes are renamed with the surface prefix: a document-level sheet
// shares ONE global animation namespace, and `fade-in` / `panel-in` are names
// half the shell would like to own.
//
// `.trust-prompt-summary strong` is inert today (the summary is interpolated
// text, so no <strong> is ever minted) — carried over unchanged so the port
// alters nothing, and so a catalog that grows markup support keeps the mono
// treatment on the domain.
const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .trust-prompt-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000;animation:hc-trust-prompt-fade-in .15s ease}
${SURFACE_NAME} .trust-prompt-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(420px,calc(100vw - 32px));background:#fff;border-radius:4px;box-shadow:0 18px 60px rgba(0,0,0,.22),0 0 0 1px rgba(0,0,0,.06);z-index:100001;animation:hc-trust-prompt-panel-in .18s ease}
@keyframes hc-trust-prompt-fade-in{from{opacity:0}to{opacity:1}}
@keyframes hc-trust-prompt-panel-in{from{opacity:0;transform:translate(-50%,-45%)}to{opacity:1;transform:translate(-50%,-50%)}}
${SURFACE_NAME} .trust-prompt-header{padding:16px 20px 8px}
${SURFACE_NAME} .trust-prompt-header h3{margin:0;font-size:14px;font-weight:700;color:#1a1a1a;letter-spacing:.01em}
${SURFACE_NAME} .trust-prompt-body{padding:4px 20px 16px;color:#2a2a2a}
${SURFACE_NAME} .trust-prompt-summary,${SURFACE_NAME} .trust-prompt-additional,${SURFACE_NAME} .trust-prompt-warning{margin:0 0 10px;font-size:13px;line-height:1.5}
${SURFACE_NAME} .trust-prompt-summary strong{font-family:var(--hc-mono,monospace)}
${SURFACE_NAME} .trust-prompt-warning{margin-top:14px;padding:10px 12px;background:rgba(220,60,0,.06);border-left:3px solid rgba(220,60,0,.5);font-size:12px;color:#6a2a00;border-radius:2px}
${SURFACE_NAME} .trust-prompt-actions{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px 16px;border-top:1px solid rgba(0,0,0,.06)}
${SURFACE_NAME} .trust-prompt-btn{padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;border-radius:3px;border:1px solid transparent;transition:background .12s,border-color .12s,color .12s}
${SURFACE_NAME} .trust-prompt-btn.deny{background:#f3f3f3;color:#555;border-color:rgba(0,0,0,.08)}
${SURFACE_NAME} .trust-prompt-btn.deny:hover{background:#eaeaea;color:#222}
${SURFACE_NAME} .trust-prompt-btn.allow-once{background:#fff;color:#1a1a1a;border-color:rgba(0,0,0,.18)}
${SURFACE_NAME} .trust-prompt-btn.allow-once:hover{background:#fafafa}
${SURFACE_NAME} .trust-prompt-btn.allow-always{background:#1a1a1a;color:#fff;border-color:#1a1a1a}
${SURFACE_NAME} .trust-prompt-btn.allow-always:hover{background:#333}
@media (max-width:600px){${SURFACE_NAME} .trust-prompt-actions{flex-direction:column-reverse}${SURFACE_NAME} .trust-prompt-btn{width:100%;padding:12px 16px;font-size:14px;min-height:44px}}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-trust-prompt', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class TrustPromptElement extends HTMLElement {

  #offs: Array<() => void> = []

  /** Queue of pending check requests. Only the head is shown; subsequent
   *  requests wait their turn. Each entry holds the onResult callback, so
   *  resolving the head advances the queue. */
  #queue: TrustCheckRequest[] = []

  /** Every request this element has ever taken in. `trust:check` is emitted
   *  with EffectBus.emit (NOT emitTransient), so the bus keeps it as the
   *  last value and REPLAYS it to any late subscriber — including this
   *  element re-subscribing after the shell-surfaces host MOVES it (a move is
   *  a disconnect + connect). Without this guard a move would re-queue a
   *  request that was already answered and call its onResult a second time,
   *  which is a double activation of code the participant allowed once.
   *  Identity, not contents: the service mints a fresh object per check. */
  #seen = new WeakSet<TrustCheckRequest>()

  // The chrome, built ONCE and kept. Angular's `@if` meant these nodes did not
  // exist while nothing was pending; here they are built detached and moved in
  // and out of the DOM, so the listeners on the three buttons and the backdrop
  // survive every show/hide (appendChild MOVES an existing node).
  #backdrop: HTMLDivElement | null = null
  #panel: HTMLDivElement | null = null
  #title: HTMLHeadingElement | null = null
  #body: HTMLDivElement | null = null
  #summary: HTMLParagraphElement | null = null
  #additional: HTMLParagraphElement | null = null
  #warning: HTMLParagraphElement | null = null
  #denyButton: HTMLButtonElement | null = null
  #allowOnceButton: HTMLButtonElement | null = null
  #allowAlwaysButton: HTMLButtonElement | null = null

  // ── the computed shape, copied from the Angular signals ─────────────────
  get #active(): TrustCheckRequest | null { return this.#queue[0] ?? null }
  get #visible(): boolean { return this.#active !== null }
  get #domains(): string[] { return this.#active?.domains ?? [] }
  get #primaryDomain(): string { return this.#domains[0] ?? '' }
  get #additionalCount(): number { return Math.max(0, this.#domains.length - 1) }

  connectedCallback(): void {
    installCss()
    this.#build()
    this.#offs.push(
      EffectBus.on<TrustCheckRequest>(TRUST_CHECK, (req) => {
        // Defensive: a malformed request (missing onResult) is dropped silently
        // rather than blocking the queue. Verbatim from the Angular original —
        // a request with no callback can never be answered, so queueing it
        // would wedge every request behind it.
        if (!req || typeof req.onResult !== 'function') return
        // Replay of something already taken in (see #seen) — not a new ask.
        if (this.#seen.has(req)) return
        this.#seen.add(req)
        this.#queue.push(req)
        this.#render()
      }),
      // THE PIPE WAS IMPURE. The Angular original resolved its strings through
      // the `t` pipe, declared `pure: false`, so every change-detection tick
      // re-read them and `/language ja` re-labelled an OPEN prompt on the spot
      // — including the three buttons, which is the whole decision. An element
      // renders when it decides to, so the locale switch has to be a reason to
      // render, or a prompt already up keeps its old-locale wording (and its
      // aria-label) until the queue happens to move.
      EffectBus.on('locale:changed', () => this.#render()),
    )
    // Hidden until a request arrives — a modal that flashes on boot is a
    // regression. (Replay delivers a live request immediately if one is
    // already pending, so there is no catch-up to write.)
    this.#render()
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    // The QUEUE deliberately survives. Disconnection here is almost always the
    // shell-surfaces host MOVING this node to keep DOM order equal to registry
    // order — and dropping a pending request would leave its caller awaiting a
    // promise that can never settle. Reconnect rebuilds nothing (the nodes are
    // kept) and re-renders the same head. If the surface is genuinely removed,
    // the pending caller hangs exactly as it did with the Angular component.
  }

  // ── chrome (built once, detached) ────────────────────────────────────────
  #build(): void {
    if (this.#panel) return

    const backdrop = document.createElement('div')
    backdrop.className = 'trust-prompt-backdrop'
    // (click)="deny()" — the backdrop is a real exit, not a decoration. It
    // answers with the SAME decision the deny button sends, so dismissing is
    // never "maybe": untrusted code stays inert.
    backdrop.addEventListener('click', () => { this.#deny() })

    const panel = document.createElement('div')
    panel.className = 'trust-prompt-panel'
    panel.setAttribute('role', 'dialog')

    const header = document.createElement('header')
    header.className = 'trust-prompt-header'
    const title = document.createElement('h3')
    header.appendChild(title)

    const body = document.createElement('div')
    body.className = 'trust-prompt-body'
    const summary = document.createElement('p')
    summary.className = 'trust-prompt-summary'
    const additional = document.createElement('p')
    additional.className = 'trust-prompt-additional'
    const warning = document.createElement('p')
    warning.className = 'trust-prompt-warning'
    // `additional` is left OUT: the template's inner `@if` put it in the DOM
    // only when the count was above zero. #render inserts it before the
    // warning when it is owed and takes it back out when it is not.
    body.append(summary, warning)

    const actions = document.createElement('footer')
    actions.className = 'trust-prompt-actions'

    const denyButton = document.createElement('button')
    denyButton.type = 'button'
    denyButton.className = 'trust-prompt-btn deny'
    denyButton.addEventListener('click', () => { this.#deny() })

    const allowOnceButton = document.createElement('button')
    allowOnceButton.type = 'button'
    allowOnceButton.className = 'trust-prompt-btn allow-once'
    allowOnceButton.addEventListener('click', () => { this.#allowOnce() })

    const allowAlwaysButton = document.createElement('button')
    allowAlwaysButton.type = 'button'
    allowAlwaysButton.className = 'trust-prompt-btn allow-always'
    allowAlwaysButton.addEventListener('click', () => { this.#allowAlways() })

    // Deny first in the DOM, exactly as the template ordered them: the safe
    // choice is the one the keyboard reaches first, and on narrow screens the
    // column-reverse rule puts it at the bottom of the stack.
    actions.append(denyButton, allowOnceButton, allowAlwaysButton)
    panel.append(header, body, actions)

    this.#backdrop = backdrop
    this.#panel = panel
    this.#title = title
    this.#body = body
    this.#summary = summary
    this.#additional = additional
    this.#warning = warning
    this.#denyButton = denyButton
    this.#allowOnceButton = allowOnceButton
    this.#allowAlwaysButton = allowAlwaysButton
  }

  // ── the three answers (values copied from the original, verbatim) ────────
  #allowOnce = (): void => {
    this.#resolve({ allow: true, addToCommunity: false })
  }

  #allowAlways = (): void => {
    this.#resolve({ allow: true, addToCommunity: true })
  }

  #deny = (): void => {
    this.#resolve({ allow: false, addToCommunity: false })
  }

  /** The ONE place a decision leaves this surface. Guarded on the head, and
   *  the head is popped immediately afterwards, so no exit path can answer the
   *  same request twice — and a click that lands with an empty queue (a stray
   *  second click, a detached node still in an event queue) answers nobody. */
  #resolve = (decision: TrustDecision): void => {
    const active = this.#active
    if (!active) return
    try { active.onResult(decision) }
    catch (e) { console.warn('[trust-prompt] onResult threw', e) }
    // Pop the head; the next pending request (if any) becomes active.
    this.#queue = this.#queue.slice(1)
    this.#render()
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ─────
  // The SKELETON is stable and only its text is re-resolved: the panel must
  // survive the queue advancing (request 2 slides into the same dialog, which
  // is what the Angular `@if (visible())` did — it never re-ran between two
  // pending requests) and must survive a locale switch without dropping the
  // focused button, which would leave a keyboard user one keystroke from an
  // exit while holding nothing.
  #render(): void {
    const panel = this.#panel
    const backdrop = this.#backdrop
    if (!panel || !backdrop) return

    // Original: `visible = active() !== null`. Copied, not re-derived — the
    // negated form (`if (!active) …`) is the same here, but the house rule is
    // to carry the predicate over as written and branch on it.
    const visible = this.#visible
    if (!visible) {
      // Nothing pending: the modal genuinely LEAVES THE DOM, as `@if` left it.
      // A backdrop that is only `display:none` still answers querySelector; a
      // backdrop that is only transparent covers the whole hive and eats every
      // click. Detaching keeps the nodes (and their listeners) alive —
      // `replaceChildren()` moves them out, `append` moves them back.
      this.replaceChildren()
      return
    }

    if (backdrop.parentNode !== this || panel.parentNode !== this) {
      this.replaceChildren(backdrop, panel)
    }

    const titleText = t('trust-prompt.title', 'allow code from this source?')
    if (this.#title) this.#title.textContent = titleText
    // [attr.aria-label]="'trust-prompt.title' | t" — same key, same string.
    panel.setAttribute('aria-label', titleText)

    if (this.#summary) {
      this.#summary.textContent = t(
        'trust-prompt.summary',
        "you're about to activate code from {domain}, which doesn't meet your trusted criteria.",
        { domain: this.#primaryDomain },
      )
    }

    if (this.#warning) {
      this.#warning.textContent = t(
        'trust-prompt.warning',
        'code from untrusted sources runs with the same access as code you wrote. only allow if you trust this source.',
      )
    }

    // Original: `@if (additionalCount() > 0)`. Kept in that direction — a
    // count that is not a number (a foreign emitter sending a non-array
    // `domains`) makes this NaN, and `NaN > 0` is false, so the line stays
    // out. Negating to `<= 0` is ALSO false for NaN, which would fall through
    // and paint "and NaN other source(s)".
    const additionalCount = this.#additionalCount
    const additional = this.#additional
    if (additional) {
      if (additionalCount > 0) {
        additional.textContent = t(
          'trust-prompt.additional',
          'and {count} other source(s).',
          { count: additionalCount },
        )
        if (additional.parentNode !== this.#body) {
          this.#body?.insertBefore(additional, this.#warning)
        }
      } else {
        additional.remove()
      }
    }

    if (this.#denyButton) this.#denyButton.textContent = t('trust-prompt.deny', 'deny')
    if (this.#allowOnceButton) this.#allowOnceButton.textContent = t('trust-prompt.allow-once', 'allow this time')
    if (this.#allowAlwaysButton) this.#allowAlwaysButton.textContent = t('trust-prompt.allow-always', 'always allow this source')
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
  customElements.define(SURFACE_NAME, TrustPromptElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/TrustPromptElement',
    element: SURFACE_NAME,
    order: 270,
  })
})
