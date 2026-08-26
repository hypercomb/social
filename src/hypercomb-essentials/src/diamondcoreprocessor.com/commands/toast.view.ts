// toast.view.ts — the transient notification stack, as a framework-free
// custom element (everything-is-a-beehavior Phase 2: Angular panels leave the
// shell and ship as signed modules).
//
// A straight port of shared/ui/toast: same surface name (hc-toast), same order
// band (320), same four type accents, same auto-dismiss timings — because the
// TIMINGS were never here. toast.drone.ts owns the queue, the durations, the
// MAX_VISIBLE cap and the 280ms removal delay; this file has only ever been
// the pane of glass in front of it. The participant sees the identical strip.
//
// THE LEAK THIS PORT RETIRES. The Angular component imported its row type as
//   `import type { Toast } from '@hypercomb/essentials/…/commands/toast.drone'`
// — a shared → essentials compile-time import, i.e. the dependency direction
// backwards. It only survived because it was type-only (erased before it could
// become a real edge). The element lives NEXT DOOR to the drone, so the same
// type is now an ordinary sibling import and the violation is simply gone.
//
// WHAT REPLACED fromRuntime(). The component bridged the drone's EventTarget
// into an Angular signal and read `drone.toasts` on every 'change'. There is
// no fromRuntime outside Angular, and there does not need to be: `#emit()`
// dispatches 'change' AND emits `toast:state` on the EffectBus in the same
// call, and the bus REPLAYS its last value to a late subscriber — which the
// EventTarget cannot. So the element listens to the effect only. Listening to
// both would render every change twice for no gain. The drone itself is
// resolved LAZILY at call time (it may register after this element mounts,
// and a click is always later than either), never captured in a field.
//
// Its one string ships WITH it and registers under the 'app' namespace, so the
// key resolves exactly as before — the Phase 2 catalog split, another slice.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { Toast, ToastAction, ToastDrone } from './toast.drone.js'
import { TOAST_TRANSLATIONS } from './toast.i18n.js'

const SURFACE_NAME = 'hc-toast'
const DRONE_KEY = '@diamondcoreprocessor.com/ToastDrone'

/** What `ToastDrone.#emit()` publishes on every queue change. */
type ToastStatePayload = { toasts?: readonly Toast[] }

// Same contract as the shell pipe, minus the interpolation branch: this panel
// resolves exactly ONE key and it takes no params. The fallback is the English
// catalog text, so a bare host with no i18n service reads identically.
const t = (key: string, fallback: string): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key)
  return value && value !== key ? value : fallback
}


window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(TOAST_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

/** The four accents, verbatim from the component. `default` covers 'info'
 *  AND anything a foreign emitter invents — same as the original switch. */
const typeIcon = (type: string): string => {
  switch (type) {
    case 'tip':     return '\u2728'  // sparkles
    case 'success': return '\u2713'  // check
    case 'warning': return '\u26A0'  // warning
    default:        return '\u2139'  // info circle
  }
}

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is prefixed
// with it — nothing can leak out of the stack, and the shells' own
// `hc-toast { display: none !important }` suppressions (styles.scss intro +
// covered modes, app.scss intro-active) still win over the host rule and still
// hide the whole subtree, fixed-position stack included.
//
// Two expansions worth naming:
//   - The `@each $type, $accent in $types` loop becomes its four literal
//     blocks; `rgba($accent, …)` becomes the literal rgb triplet.
//   - `@include phone-only` / `@include tablet-only` become their literal
//     queries from _breakpoints.scss (599px, and 600px–1023px: the mixin is
//     `$bp-tablet-land - 1`).
// The keyframes name is namespaced (`hc-toast-enter`) because a
// document-level sheet shares ONE global animation namespace.
//
// The top offset is left exactly as written — it clears the page chrome AND
// the breadcrumb docked under it, the same anchor calc `.breadcrumb-top` uses,
// so a toast never lands on the crumb at any header size. var(--hc-*) custom
// properties are untouched by the expansion.
const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .toast-stack{position:fixed;top:calc(max(calc(2.75rem * var(--hc-header-zoom,1.0)),calc(var(--hc-header-bottom,0px) + 0.35rem)) + 1.5rem);right:.75rem;z-index:100010;display:flex;flex-direction:column;gap:.4rem;max-width:min(32rem,calc(100vw - 1.5rem));pointer-events:none}
${SURFACE_NAME} .toast-item{display:flex;flex-direction:row;align-items:center;gap:.45rem;padding:.25rem .55rem;pointer-events:auto;white-space:nowrap;overflow:hidden;background:rgba(6,9,14,.82);backdrop-filter:blur(14px) saturate(.9);-webkit-backdrop-filter:blur(14px) saturate(.9);border:1px solid rgba(255,255,255,.08);border-left-width:2px;border-radius:4px;box-shadow:0 2px 14px rgba(0,0,0,.55);font-family:var(--hc-mono);font-size:.7rem;line-height:1.5;color:rgba(245,245,245,.9);animation:hc-toast-enter 220ms ease-out forwards;transition:opacity 200ms ease,transform 200ms ease}
${SURFACE_NAME} .toast-item.fading{opacity:0;transform:translateX(.75rem)}
${SURFACE_NAME} .toast-item[data-type='info']{border-left-color:#4da6ff}
${SURFACE_NAME} .toast-item[data-type='info'] .toast-icon{color:#4da6ff}
${SURFACE_NAME} .toast-item[data-type='info'] .toast-title{color:#4da6ff}
${SURFACE_NAME} .toast-item[data-type='info'] .toast-action{color:#4da6ff;border-color:rgba(77,166,255,.3)}
${SURFACE_NAME} .toast-item[data-type='info'] .toast-action:hover{background:rgba(77,166,255,.1)}
${SURFACE_NAME} .toast-item[data-type='success']{border-left-color:#34d399}
${SURFACE_NAME} .toast-item[data-type='success'] .toast-icon{color:#34d399}
${SURFACE_NAME} .toast-item[data-type='success'] .toast-title{color:#34d399}
${SURFACE_NAME} .toast-item[data-type='success'] .toast-action{color:#34d399;border-color:rgba(52,211,153,.3)}
${SURFACE_NAME} .toast-item[data-type='success'] .toast-action:hover{background:rgba(52,211,153,.1)}
${SURFACE_NAME} .toast-item[data-type='tip']{border-left-color:#c8975a}
${SURFACE_NAME} .toast-item[data-type='tip'] .toast-icon{color:#c8975a}
${SURFACE_NAME} .toast-item[data-type='tip'] .toast-title{color:#c8975a}
${SURFACE_NAME} .toast-item[data-type='tip'] .toast-action{color:#c8975a;border-color:rgba(200,151,90,.3)}
${SURFACE_NAME} .toast-item[data-type='tip'] .toast-action:hover{background:rgba(200,151,90,.1)}
${SURFACE_NAME} .toast-item[data-type='warning']{border-left-color:#f59e0b}
${SURFACE_NAME} .toast-item[data-type='warning'] .toast-icon{color:#f59e0b}
${SURFACE_NAME} .toast-item[data-type='warning'] .toast-title{color:#f59e0b}
${SURFACE_NAME} .toast-item[data-type='warning'] .toast-action{color:#f59e0b;border-color:rgba(245,158,11,.3)}
${SURFACE_NAME} .toast-item[data-type='warning'] .toast-action:hover{background:rgba(245,158,11,.1)}
${SURFACE_NAME} .toast-icon{flex-shrink:0;font-size:.72rem;line-height:1}
${SURFACE_NAME} .toast-title{flex-shrink:0;font-weight:600;letter-spacing:.04em;text-transform:uppercase;font-size:.62rem}
${SURFACE_NAME} .toast-message{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;color:rgba(245,245,245,.82)}
${SURFACE_NAME} .toast-action{flex-shrink:0;background:none;border:1px solid;border-radius:3px;padding:.1rem .4rem;font-family:inherit;font-size:.6rem;font-weight:600;letter-spacing:.03em;cursor:pointer;transition:background 120ms ease;white-space:nowrap}
${SURFACE_NAME} .toast-actions{display:flex;align-items:center;gap:.25rem;flex-shrink:0}
${SURFACE_NAME} .toast-combo-btn{flex-shrink:0;border-radius:999px;padding:.18rem .65rem;font-family:inherit;font-size:.62rem;font-weight:600;letter-spacing:.03em;cursor:pointer;transition:background 120ms ease,color 120ms ease,box-shadow 120ms ease;white-space:nowrap}
${SURFACE_NAME} .toast-combo-btn.primary{background:var(--md-primary,#7eb6d6);color:var(--md-on-primary,#0a0a0a);border:1px solid var(--md-primary,#7eb6d6);box-shadow:0 0 5px rgba(126,182,214,.35)}
${SURFACE_NAME} .toast-combo-btn.primary:hover{filter:brightness(1.1);box-shadow:0 0 8px rgba(126,182,214,.55)}
${SURFACE_NAME} .toast-combo-btn.secondary{background:transparent;color:rgba(245,245,245,.75);border:1px solid transparent}
${SURFACE_NAME} .toast-combo-btn.secondary:hover{background:rgba(245,245,245,.06);color:rgba(245,245,245,.95)}
${SURFACE_NAME} .toast-dismiss{flex-shrink:0;display:flex;align-items:center;justify-content:center;width:1rem;height:1rem;background:none;border:none;border-radius:2px;color:rgba(245,245,245,.25);font-size:.85rem;cursor:pointer;transition:color 120ms ease,background 120ms ease}
${SURFACE_NAME} .toast-dismiss:hover{color:rgba(245,245,245,.6);background:rgba(255,255,255,.06)}
@keyframes hc-toast-enter{from{opacity:0;transform:translateX(.75rem)}to{opacity:1;transform:translateX(0)}}
@media (max-width:599px){
${SURFACE_NAME} .toast-stack{top:auto;bottom:calc(4rem + var(--hc-safe-bottom,0px));right:.5rem;left:.5rem;max-width:none}
${SURFACE_NAME} .toast-item{padding:.35rem .65rem;font-size:.74rem}
${SURFACE_NAME} .toast-dismiss{width:1.5rem;height:1.5rem;font-size:1rem}
}
@media (min-width:600px) and (max-width:1023px){
${SURFACE_NAME} .toast-stack{max-width:28rem}
${SURFACE_NAME} .toast-dismiss{width:1.4rem;height:1.4rem}
}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-toast', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** One live strip. Held across renders — see `#render` for why. */
type Row = {
  /** The `.toast-item` element. */
  el: HTMLElement
  /** The dismiss button, kept so `#relabel()` can re-resolve its aria-label
   *  on a locale switch without rebuilding — and destroying — the row. */
  dismiss: HTMLButtonElement
}

export class ToastElement extends HTMLElement {

  #offs: Array<() => void> = []
  #toasts: readonly Toast[] = []

  /** The `@if (hasToasts())` wrapper. Built once and kept; ATTACHED only
   *  while something is showing (see `#render`). */
  #stack: HTMLElement | null = null

  /** id → the live strip showing it.
   *
   *  NOT A RECONCILER — the sanctioned per-panel `Map<key, element>` the
   *  plan names for "genuinely live rows", and toast is the definition of
   *  one. Rebuild-on-change is the house pattern and it is safe wherever
   *  the DOM holds no state; here the DOM holds ANIMATION state. Every
   *  `.toast-item` runs `hc-toast-enter` on insertion, so recreating the
   *  list on every change would re-slide all four bystanders each time a
   *  fifth toast arrives and each time one auto-dismisses — a strobe, every
   *  few seconds, which is exactly what this surface must not do. Angular's
   *  `@for … track toast.id` kept the nodes; so does this. Nothing else
   *  about a toast ever changes after it is shown (the drone only ever
   *  flips `fading`), so a row's children are built once and never diffed. */
  #rows = new Map<number, Row>()

  /** Resolved at CALL time, never captured: the drone may register after
   *  this element mounts, and a click is always later than either. */
  #drone(): ToastDrone | undefined {
    return window.ioc?.get?.(DRONE_KEY) as ToastDrone | undefined
  }

  connectedCallback(): void {
    installCss()
    this.#build()
    // Last-value replay means a late mount receives the current queue —
    // there is no catch-up to write here. (And when nothing has ever been
    // shown there is no last value at all, so the stack stays out of the
    // DOM: a registry-fed surface must never flash on boot.)
    this.#offs.push(
      EffectBus.on<ToastStatePayload>('toast:state', payload => this.#accept(payload)),
      // THE PIPE WAS IMPURE. The Angular original resolved the dismiss
      // aria-label through the `t` pipe, declared `pure: false`, so every
      // change-detection tick re-read it and `/language ja` re-labelled the
      // OPEN toasts on the spot. An element renders when it decides to, and
      // this one deliberately does NOT rebuild live rows — so the locale
      // switch gets a #relabel() that re-resolves the string in place,
      // leaving every strip's animation and identity untouched.
      EffectBus.on('locale:changed', () => this.#relabel()),
    )
    this.#render()
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    this.#rows.clear()
    this.#stack?.remove()
    this.#stack = null
    this.#toasts = []
    this.replaceChildren()
  }

  // ── state ────────────────────────────────────────────────────────────
  #accept(payload?: ToastStatePayload): void {
    // Read the list off the drone this element also ACTS on, exactly as the
    // component's fromRuntime() projection did (`() => drone?.toasts ?? []`),
    // so the rows painted and the ids dismissed can never come from two
    // different instances. `#emit()` sends that same array, so the payload is
    // an identical fallback for the window where the effect has replayed but
    // IoC has not handed the instance over yet.
    this.#toasts = this.#drone()?.toasts ?? payload?.toasts ?? []
    this.#render()
  }

  // ── chrome (built once) ──────────────────────────────────────────────
  #build(): void {
    if (this.#stack) return
    const stack = document.createElement('div')
    stack.className = 'toast-stack'
    stack.setAttribute('role', 'status')
    stack.setAttribute('aria-live', 'polite')
    // Built DETACHED. `#render` attaches it when a toast is showing and takes
    // it back out when the last one goes — so the stack is absent from the
    // DOM at rest, exactly as the Angular `@if` left it, with no transient
    // attach on the way through mount.
    this.#stack = stack
  }

  // ── rendering ────────────────────────────────────────────────────────
  #render(): void {
    const stack = this.#stack
    if (!stack) return

    const list = this.#toasts

    // `!(list.length > 0)`, NOT `list.length <= 0` — the polarity is
    // load-bearing. The Angular original showed the stack on
    // `(state$()?.length ?? 0) > 0`; negating the comparison inverts the
    // answer for any non-numeric length a foreign `toast:state` emitter
    // might carry (both forms are false for NaN, so the negated guard falls
    // THROUGH and paints an empty stack). Keep the original direction.
    if (!(list.length > 0)) {
      // Nothing showing: @if MEANS DETACH. Angular removed the wrapper from
      // the DOM entirely, and a stack that is merely display:none still
      // answers querySelector — a contract an acceptance driver may assert
      // on. Drop the rows too: a toast that has left the queue is gone for
      // good (ids never repeat — the drone counts up forever), so there is
      // nothing here worth keeping alive.
      this.#rows.clear()
      stack.replaceChildren()
      stack.remove()
      return
    }

    // Departed rows leave FIRST, so the placement walk below never has to
    // step over a corpse — and therefore never moves a survivor.
    const alive = new Set(list.map(toast => toast.id))
    for (const [id, row] of this.#rows) {
      if (alive.has(id)) continue
      row.el.remove()
      this.#rows.delete(id)
    }

    // Back in, if it was out. Moving a live node, never re-creating it —
    // appendChild MOVES an existing child.
    if (stack.parentNode !== this) this.appendChild(stack)

    // Place every toast in data order (newest first — the drone prepends).
    // The anchor walk SKIPS a row already sitting where it belongs, which is
    // the whole point: re-inserting an element restarts its CSS animation,
    // so a blind append-everything loop would re-run `hc-toast-enter` on the
    // survivors. Only genuinely out-of-place nodes are touched, and
    // `insertBefore` moves them rather than rebuilding them.
    let anchor: ChildNode | null = stack.firstChild
    for (const toast of list) {
      const row = this.#rows.get(toast.id) ?? this.#buildRow(toast)
      this.#rows.set(toast.id, row)
      // The only field the drone ever mutates after show time.
      row.el.classList.toggle('fading', !!toast.fading)
      if (anchor === row.el) { anchor = row.el.nextSibling; continue }
      stack.insertBefore(row.el, anchor)
    }
  }

  /** One strip, built once. Detached — `#render` places it. */
  #buildRow(toast: Toast): Row {
    const el = document.createElement('div')
    el.className = 'toast-item'
    // Drives the four accent blocks in the sheet, as `[attr.data-type]` did.
    el.setAttribute('data-type', String(toast.type))

    const icon = document.createElement('span')
    icon.className = 'toast-icon'
    icon.textContent = typeIcon(toast.type)
    el.appendChild(icon)

    // Truthy tests copied verbatim from the template's `@if`s — never
    // re-derived by negation.
    if (toast.title) {
      const title = document.createElement('span')
      title.className = 'toast-title'
      title.textContent = toast.title
      el.appendChild(title)
    }

    const message = document.createElement('span')
    message.className = 'toast-message'
    message.textContent = toast.message
    el.appendChild(message)

    // Legacy single action. The optional call is the original's
    // (`this.#drone?.executeAction?.(id)`) — kept, so a stubbed drone is as
    // inert here as it was there.
    if (toast.actionLabel) {
      const action = document.createElement('button')
      action.type = 'button'
      action.className = 'toast-action'
      action.textContent = toast.actionLabel
      action.addEventListener('click', () => { this.#drone()?.executeAction?.(toast.id) })
      el.appendChild(action)
    }

    // Multi-action combo (the subscribe-request consent's Accept / No thanks).
    // `?.length` rather than `.length`: same truthy polarity, and a malformed
    // foreign payload with no `actions` array hides the group instead of
    // throwing inside the render loop.
    if (toast.actions?.length) {
      const group = document.createElement('div')
      group.className = 'toast-actions'
      group.setAttribute('role', 'group')
      toast.actions.forEach((action: ToastAction, index: number) => {
        const button = document.createElement('button')
        button.type = 'button'
        // `[class.primary]` / `[class.secondary]` — one or the other, always.
        button.className = action.kind === 'primary'
          ? 'toast-combo-btn primary'
          : 'toast-combo-btn secondary'
        button.textContent = action.label
        // The index is captured at BUILD time, which is show time — the same
        // ordering `executeActionAt` documents, and the actions array is
        // frozen for the life of a toast.
        button.addEventListener('click', () => {
          this.#drone()?.executeActionAt?.(toast.id, index)
        })
        group.appendChild(button)
      })
      el.appendChild(group)
    }

    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.className = 'toast-dismiss'
    dismiss.textContent = '\u00D7'  // &times;
    dismiss.setAttribute('aria-label', t('toast.dismiss', 'Dismiss'))
    dismiss.addEventListener('click', () => { this.#drone()?.dismiss?.(toast.id) })
    el.appendChild(dismiss)

    return { el, dismiss }
  }

  /** Re-resolve the one string written at build time. Rows are deliberately
   *  not rebuilt (see `#rows`), so without this a stack that is already up
   *  keeps its previous-locale dismiss label until every toast has expired. */
  #relabel(): void {
    const label = t('toast.dismiss', 'Dismiss')
    for (const row of this.#rows.values()) row.dismiss.setAttribute('aria-label', label)
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
  customElements.define(SURFACE_NAME, ToastElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/ToastElement',
    element: SURFACE_NAME,
    order: 320,
  })
})
