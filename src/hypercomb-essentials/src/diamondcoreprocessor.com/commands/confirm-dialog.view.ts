// confirm-dialog.view.ts — the shell's one confirmation modal, as a
// framework-free custom element (everything-is-a-beehavior Phase 2: Angular
// panels leave the shell and ship as signed modules).
//
// A straight port of shared/ui/confirm-dialog: same surface name
// (hc-confirm-dialog), same order band (240), the same single effect in
// (`confirm:request`) and out (`confirm:response`), and the same Escape via
// `keymap:invoke`. The participant sees the same glass panel, delivered as a
// module instead of compiled into the shell.
//
// WHAT IT IS FOR. `requestConfirm()` (hypercomb-core/src/confirm.ts) is the
// ONLY way anything in the system asks a yes/no question. It mints an id,
// subscribes to `confirm:response` filtered on that id, and emits
// `confirm:request`. THIS surface is the other half of that promise: callers
// all over essentials — commands/remove-confirm.ts (every tile delete),
// history/prune.service.ts, link/link-drop.worker.ts, sharing/host.queen.ts,
// sharing/swarm-adopt.drone.ts, commands/builds.queen.ts,
// commands/restore.queen.ts, sharing/folder-sync.* — are sitting on an
// unresolved `await` until it answers. So the response shape is a hard
// contract: EXACTLY `{ id, confirmed }`, with the id echoed back verbatim,
// emitted exactly once per request. Drop it or reshape it and the caller
// hangs forever with no error anywhere.
//
// STRINGS COME FROM THE CALLER. Unlike every other converted panel, this one
// owns almost no text: `title`, `message` and `warning` are whatever the
// caller passed, and callers pass BOTH i18n keys ('confirm.delete-title') and
// literal prose (link-drop.worker.ts: `“${cell}” already links to …`). The
// Angular template ran all of it through the `| t` pipe, whose behaviour on a
// non-key is to hand the string straight back — so the port's `t()` mirrors
// the pipe exactly (resolve, else echo the input) rather than inventing a
// fallback. Only the two DEFAULT button labels are this surface's own keys.
//
// LIFECYCLE NOTE. The Angular template was one big `@if (open())`, so nothing
// existed in the DOM at rest. A registry-fed element is mounted ONCE at boot
// and stays, so the chrome is built DETACHED and attached only while a
// request is live — a modal that is merely `display:none` still answers
// `querySelector`, and a backdrop that flashes over the hive on boot is the
// worst possible regression for a surface whose whole job is "the ground is
// about to move, is that OK?".

import {
  EffectBus,
  I18N_IOC_KEY,
  type ConfirmRequest,
  type ConfirmResponse,
  type I18nProvider,
} from '@hypercomb/core'
import { CONFIRM_DIALOG_TRANSLATIONS } from './confirm-dialog.i18n.js'

const SURFACE_NAME = 'hc-confirm-dialog'

/** The cmd the escape cascade publishes on `keymap:invoke`. */
const ESCAPE_CMD = 'global.escape'

/** The two labels this surface owns, when the caller named none. Kept as the
 *  Angular template had them — `?? 'confirm.cancel'`, NULLISH, so a caller
 *  who deliberately passes an empty label still gets an empty label. */
const DEFAULT_CANCEL_KEY = 'confirm.cancel'
const DEFAULT_CONFIRM_KEY = 'confirm.delete'

// …and the two labels travel WITH the surface that owns them. The catalog
// split lifted exactly these two keys out of all 14 shell catalogs, so
// without this registration both buttons would fall back to hardcoded
// English in every language — the split would have quietly un-translated the
// only two words on the dialog. Every OTHER `confirm.*` key belongs to a
// CALLER (it arrives inside the request) and stays with its owner.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(CONFIRM_DIALOG_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

/**
 * The `| t` pipe's behaviour, exactly: `i18n?.t(key, params) ?? key`.
 *
 * Two things ride on the echo-the-input half. Callers may pass literal prose
 * instead of a key (link-drop.worker.ts, folder-sync.*, meeting-invite.join.ts
 * which pre-translates), and the i18n service returns an unknown key
 * unchanged — so prose passes through untouched, which is what the pipe did.
 * `fallback` is only for the two keys this surface owns; when it is omitted
 * the key itself is the answer, so a host with no i18n service reads the same
 * as the Angular original did.
 */
const t = (key: string, params?: Record<string, string | number>, fallback?: string): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key, params)
  if (value !== undefined && value !== key) return value
  if (fallback === undefined) return key
  if (!params) return fallback
  return fallback.replace(/\{(\w+)\}/g, (whole, token: string) =>
    token in params ? String(params[token]) : whole)
}

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + landing-badge precedent), so Angular's
// `:host` becomes the tag name and every other selector is prefixed with it —
// nothing leaks out of the dialog. SCSS nesting is flattened, the
// `@include tablet-only` / `@include phone-only` mixins are expanded to their
// literal queries from ui/_breakpoints.scss ($bp-tablet 600px, $bp-tablet-land
// 1024px so tablet-only tops out at 1023px, $bp-phone-max 599px), and the
// `var(--hc-…)` custom properties are left exactly as they were.
//
// The three keyframes are RENAMED with the tag prefix: a document-level sheet
// shares one global animation namespace, and `confirm-panel-enter` is far too
// plausible a name for something else to mint.
//
// Two z-indexes worth keeping the reasoning for: 100000 / 100001 sit above
// every piece of shell chrome (header 60000 is the highest) on purpose. This
// is the one surface that must be unreachable-around — a confirmation the
// participant can click past is not a confirmation.
const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .confirm-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.72);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);z-index:100000;animation:hc-confirm-dialog-backdrop-enter 200ms ease forwards}
${SURFACE_NAME} .confirm-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100001;width:min(90vw,22rem);display:flex;flex-direction:column;background:rgba(14,18,24,.92);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.08);border-radius:var(--hc-radius-floating);box-shadow:0 12px 48px rgba(0,0,0,.7);color:rgba(245,245,245,.85);font-family:var(--hc-mono);animation:hc-confirm-dialog-panel-enter 300ms cubic-bezier(.16,1,.3,1) forwards}
${SURFACE_NAME} .confirm-header{display:flex;align-items:center;justify-content:space-between;padding:.75rem 1rem .5rem;border-bottom:1px solid rgba(255,255,255,.06)}
${SURFACE_NAME} .confirm-header h3{font-size:.68rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#c8975a;margin:0}
${SURFACE_NAME} .confirm-close{display:flex;align-items:center;justify-content:center;width:1.5rem;height:1.5rem;background:none;border:none;border-radius:3px;color:rgba(245,245,245,.3);font-size:1rem;cursor:pointer;transition:color 150ms ease,background 150ms ease}
${SURFACE_NAME} .confirm-close:hover{color:whitesmoke;background:rgba(255,255,255,.08)}
${SURFACE_NAME} .confirm-body{padding:.75rem 1rem}
${SURFACE_NAME} .confirm-message{font-size:.78rem;color:rgba(245,245,245,.7);margin:0;line-height:1.5}
${SURFACE_NAME} .confirm-warning{font-size:.72rem;color:#ff5a5a;margin:.5rem 0 0;padding:.4rem .6rem;background:rgba(255,90,90,.08);border:1px solid rgba(255,90,90,.15);border-radius:4px;line-height:1.4}
${SURFACE_NAME} .confirm-actions{display:flex;justify-content:flex-end;gap:.5rem;padding:.5rem 1rem .75rem;border-top:1px solid rgba(255,255,255,.06)}
${SURFACE_NAME} .confirm-btn{font-family:var(--hc-mono);font-size:.68rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;padding:.4rem .9rem;border-radius:4px;border:1px solid rgba(255,255,255,.1);cursor:pointer;transition:background 150ms ease,color 150ms ease,border-color 150ms ease}
${SURFACE_NAME} .confirm-btn.cancel{background:rgba(255,255,255,.04);color:rgba(245,245,245,.5)}
${SURFACE_NAME} .confirm-btn.cancel:hover{background:rgba(255,255,255,.08);color:rgba(245,245,245,.8)}
${SURFACE_NAME} .confirm-btn.danger{background:rgba(255,90,90,.12);color:#ff5a5a;border-color:rgba(255,90,90,.2)}
${SURFACE_NAME} .confirm-btn.danger:hover{background:rgba(255,90,90,.22);color:#ff6b6b}
${SURFACE_NAME} .confirm-btn.danger:active{transform:scale(.97)}
@keyframes hc-confirm-dialog-backdrop-enter{from{opacity:0}to{opacity:1}}
@keyframes hc-confirm-dialog-panel-enter{from{opacity:0;transform:translate(-50%,-50%) scale(.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
@keyframes hc-confirm-dialog-panel-enter-phone{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}
@media (min-width:600px) and (max-width:1023px){
${SURFACE_NAME} .confirm-panel{width:min(85vw,24rem)}
${SURFACE_NAME} .confirm-close{width:2.2rem;height:2.2rem}
${SURFACE_NAME} .confirm-btn{padding:.5rem 1rem;font-size:.72rem}
}
@media (max-width:599px){
${SURFACE_NAME} .confirm-panel{top:auto;bottom:0;left:0;right:0;transform:none;width:100%;border-radius:var(--hc-radius-floating) var(--hc-radius-floating) 0 0;padding-bottom:var(--hc-safe-bottom,0px);animation:hc-confirm-dialog-panel-enter-phone 250ms cubic-bezier(.16,1,.3,1) forwards}
${SURFACE_NAME} .confirm-header{padding:.85rem 1rem .6rem}
${SURFACE_NAME} .confirm-header h3{font-size:.72rem}
${SURFACE_NAME} .confirm-close{width:2.5rem;height:2.5rem;font-size:1.1rem}
${SURFACE_NAME} .confirm-message{font-size:.82rem}
${SURFACE_NAME} .confirm-warning{font-size:.76rem}
${SURFACE_NAME} .confirm-actions{padding:.6rem 1rem .85rem}
${SURFACE_NAME} .confirm-btn{padding:.55rem 1.1rem;font-size:.74rem;min-height:2.5rem}
}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-confirm-dialog', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** The dialog's nodes, minted together in #build and kept for the element's
 *  whole life. Every one of them is a live node the participant may be
 *  interacting with, so they are moved in and out of the DOM, never rebuilt. */
type Chrome = {
  backdrop: HTMLDivElement
  panel: HTMLDivElement
  title: HTMLHeadingElement
  body: HTMLDivElement
  message: HTMLParagraphElement
  warning: HTMLParagraphElement
  cancel: HTMLButtonElement
  confirm: HTMLButtonElement
}

export class ConfirmDialogElement extends HTMLElement {

  /** Everything connectedCallback wired, torn down in one sweep. */
  #offs: Array<() => void> = []

  /** The live request, or null when nothing is being asked. The Angular
   *  original held this in a signal with `open = request() !== null`; here it
   *  is the single piece of state the whole surface renders from. */
  #request: ConfirmRequest | null = null

  /** Ids already answered. THE REPLAY GUARD, carried over verbatim from the
   *  Angular version: `EffectBus.on` hands a late subscriber the last value,
   *  so a surface that re-subscribes (registry churn, a disconnect/reconnect)
   *  would otherwise re-open a dialog whose caller has already been answered.
   *  Deliberately NOT cleared on disconnect — surviving the re-subscribe is
   *  the entire point. An unanswered request DOES come back on replay, which
   *  is correct: its caller is still awaiting. */
  #processedIds = new Set<string>()

  /** Chrome, built once and kept — all of it or none of it, so one null check
   *  covers the lot. Rebuilding these on every render would be safe for state
   *  (state lives here, not in the DOM) but would drop focus out from under
   *  anyone who has tabbed onto a button while the dialog is open — so the
   *  nodes persist and only their STRINGS are re-resolved (#paint), which is
   *  also exactly what the locale switch needs. */
  #chrome: Chrome | null = null

  /** `open()` in the Angular component. */
  get #open(): boolean { return this.#request !== null }

  connectedCallback(): void {
    installCss()
    this.#build()

    this.#offs.push(
      // Escape, exactly as the Angular version had it: NOT a keydown listener
      // of its own, but the escape cascade's `keymap:invoke` effect, so this
      // modal takes its turn in the one cascade tool-windows.ts owns instead
      // of racing it — and there is therefore NO window/document listener to
      // remove, capture-phase or otherwise.
      //
      // SUBSCRIBED BEFORE `confirm:request`, which is the one ordering that
      // differs from ngOnInit, deliberately. Both effects replay their last
      // value to a late subscriber. Take the request first and a stale
      // `global.escape` still sitting in last-value would land on a dialog
      // that had JUST been restored and answer `false` for a participant who
      // never saw it. Taking Escape first means its replay finds `#open`
      // false and does nothing, which is what a replayed keystroke should do.
      EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
        if (payload?.cmd === ESCAPE_CMD && this.#open) this.#dismiss()
      }),

      // Last-value replay means a late mount still receives a request that is
      // already outstanding — there is no catch-up to write here, only the
      // #processedIds guard against an ALREADY-ANSWERED one coming back.
      EffectBus.on<ConfirmRequest>('confirm:request', (req) => {
        if (!req || this.#processedIds.has(req.id)) return
        this.#request = req
        this.#render()
      }),

      // THE PIPE WAS IMPURE. The Angular template resolved every string
      // through `| t`, declared `pure: false`, so every change-detection tick
      // re-read them and `/language ja` re-labelled an OPEN dialog on the
      // spot. An element renders when it decides to — and this surface can sit
      // open indefinitely, since it is BLOCKING an await. Without this, a
      // locale switch would leave the participant staring at a modal whose two
      // buttons are the only way out, still in the previous language.
      EffectBus.on('locale:changed', () => this.#render()),
    )

    this.#render()
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    // Take the chrome out and drop it; #build remints it on reconnect. The
    // pending request is dropped too — replay hands it back on reconnect
    // (it is not in #processedIds, so it is still owed an answer).
    this.#chrome = null
    this.#request = null
    this.replaceChildren()
  }

  // ── chrome (built once, DETACHED) ────────────────────────────────────
  // Angular's `@if (open())` meant none of this existed in the DOM at rest,
  // and this surface is mounted at boot and never unmounted — so it is built
  // detached and #render attaches/detaches it. `appendChild` MOVES an existing
  // node, so the click listeners below are wired once and survive every
  // show/hide cycle.
  #build(): void {
    if (this.#chrome) return

    const backdrop = document.createElement('div')
    backdrop.className = 'confirm-backdrop'
    backdrop.addEventListener('click', () => this.#dismiss())

    const panel = document.createElement('div')
    panel.className = 'confirm-panel'
    panel.setAttribute('role', 'alertdialog')

    const header = document.createElement('header')
    header.className = 'confirm-header'
    const title = document.createElement('h3')
    const close = document.createElement('button')
    close.className = 'confirm-close'
    close.textContent = '×'   // &times;
    close.addEventListener('click', () => this.#dismiss())
    header.append(title, close)

    const body = document.createElement('div')
    body.className = 'confirm-body'
    const message = document.createElement('p')
    message.className = 'confirm-message'
    body.append(message)
    // The warning paragraph is the template's inner `@if (request()!.warning)`
    // — built here, attached to the body only while there IS one.
    const warning = document.createElement('p')
    warning.className = 'confirm-warning'

    const actions = document.createElement('footer')
    actions.className = 'confirm-actions'
    const cancel = document.createElement('button')
    cancel.className = 'confirm-btn cancel'
    cancel.addEventListener('click', () => this.#dismiss())
    const confirm = document.createElement('button')
    confirm.className = 'confirm-btn'
    confirm.addEventListener('click', () => this.#confirm())
    actions.append(cancel, confirm)

    panel.append(header, body, actions)

    this.#chrome = { backdrop, panel, title, body, message, warning, cancel, confirm }
  }

  // ── rendering (rebuild-on-change — state lives here, never in the DOM) ─
  #render(): void {
    const chrome = this.#chrome
    if (!chrome) return

    const req = this.#request
    // The template's own predicate — `@if (open())`, i.e. `request() !== null`
    // — kept in its POSITIVE direction. Do not re-derive it by negating some
    // other condition: this guard is the difference between a hidden modal and
    // a black backdrop over the whole hive with "undefined" written on it.
    if (!req) {
      // Nothing being asked: the chrome genuinely LEAVES the DOM, as `@if`
      // left it. `display:none` would still answer querySelector, and a
      // fixed full-screen backdrop that is only visually hidden is one
      // pointer-events slip away from eating every click on the hive.
      chrome.backdrop.remove()
      chrome.panel.remove()
      return
    }

    this.#paint(chrome, req)

    // Back in, if it was out — moving live nodes, never re-creating them, so
    // the four click listeners wired in #build stay attached.
    if (chrome.backdrop.parentNode !== this || chrome.panel.parentNode !== this) {
      this.replaceChildren(chrome.backdrop, chrome.panel)
    }
  }

  /** Re-resolve every string and re-evaluate the two conditionals. Split out
   *  because the locale switch needs exactly this and nothing else — the
   *  `#relabel()` the impure pipe used to give us for free. */
  #paint(chrome: Chrome, req: ConfirmRequest): void {
    const title = t(req.title)
    chrome.title.textContent = title
    // `[attr.aria-label]="request()!.title | t"` — the same resolved title.
    chrome.panel.setAttribute('aria-label', title)

    chrome.message.textContent = t(req.message, req.messageParams)

    // `@if (request()!.warning)` — a TRUTHY test on the caller's string, so an
    // empty warning shows no red box. Copied as-is rather than `!= null`.
    if (req.warning) {
      chrome.warning.textContent = t(req.warning, req.warningParams)
      if (chrome.warning.parentNode !== chrome.body) chrome.body.append(chrome.warning)
    } else {
      chrome.warning.remove()
      chrome.warning.textContent = ''
    }

    // `?? 'confirm.cancel'` — NULLISH, copied verbatim, not `||`. A caller
    // passing an empty label means an empty label; only null/undefined takes
    // the default. The English fallback rides only on OUR two keys — every
    // other string here belongs to the caller and is echoed, never invented.
    const cancelKey = req.cancelLabel ?? DEFAULT_CANCEL_KEY
    chrome.cancel.textContent = cancelKey === DEFAULT_CANCEL_KEY
      ? t(DEFAULT_CANCEL_KEY, undefined, 'Cancel')
      : t(cancelKey)

    const confirmKey = req.confirmLabel ?? DEFAULT_CONFIRM_KEY
    chrome.confirm.textContent = confirmKey === DEFAULT_CONFIRM_KEY
      ? t(DEFAULT_CONFIRM_KEY, undefined, 'Delete')
      : t(confirmKey)

    // `[class.danger]="request()!.danger !== false"` — DANGER IS THE DEFAULT,
    // and the test is `!== false`, not `?? true` and not truthiness. Only an
    // explicit `danger: false` takes the red off. Every caller that omits the
    // flag gets the red button, which is the behaviour the delete paths rely
    // on; re-deriving this by truthiness would silently de-red them all.
    chrome.confirm.classList.toggle('danger', req.danger !== false)
  }

  // ── the answer — the half of `requestConfirm`'s promise that lives here ──

  #confirm(): void { this.#respond(true) }

  #dismiss(): void { this.#respond(false) }

  /** The Angular `#respond`, and the whole reason this surface exists: the
   *  other end of `requestConfirm`'s promise. `{ id, confirmed }` EXACTLY —
   *  the id echoed verbatim, because `requestConfirm` filters on it and
   *  unsubscribes; anything else and the caller's `await` never returns.
   *
   *  `!req` is the original's own guard: a second click on a dialog that is
   *  already closing must not emit a second response for a resolved id.
   *  Marking the id processed first keeps the emit's own last-value replay
   *  from walking back in through our `confirm:request` subscription.
   *
   *  ONE ORDERING CHANGE from the original: `#request` is cleared BEFORE the
   *  emit rather than after. `EffectBus.emit` runs every `confirm:response`
   *  handler synchronously, so a handler that asks a NEW question in the same
   *  tick would have had it overwritten with null by the trailing clear —
   *  and that caller would await forever, the one failure this surface must
   *  never produce. Nothing observable differs otherwise. */
  #respond(confirmed: boolean): void {
    const req = this.#request
    if (!req) return
    this.#processedIds.add(req.id)
    this.#request = null
    EffectBus.emit<ConfirmResponse>('confirm:response', { id: req.id, confirmed })
    this.#render()
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
  customElements.define(SURFACE_NAME, ConfirmDialogElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/ConfirmDialogElement',
    element: SURFACE_NAME,
    order: 240,
  })
})
