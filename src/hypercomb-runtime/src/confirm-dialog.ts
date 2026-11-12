// hypercomb-runtime/src/confirm-dialog.ts
//
// <hc-confirm-dialog> — THE CONSENT DIALOG, with no Angular (debugger-chat.md,
// "The port, in order", step 1). Every act that waits on a yes (publish,
// remove, prune, keys) asks through core's `requestConfirm`: it emits
// `confirm:request` and waits for `confirm:response` with the same id. The
// dialog was an Angular component in the shell, so on a page with no Angular
// (a debugger subdomain) those acts waited forever. This is the same dialog,
// ported: the same tag, the same look, the same answers, and the Angular copy
// is gone.
//
// IT IS THE HOST'S, NOT A PACKAGE'S. Every host imports this module (web and
// dev in main.ts, the shim in its main.ts), and it mounts itself. A shell is
// deployed before the packages its participants hold, and a package already
// in a browser stays until the next revision: a dialog that came with a
// package would leave a new shell over an older package with nobody to answer
// a single yes. The shell always carried its own dialog, so it still does.
//
// Two parts. `ConfirmDesk` holds the questions: the one on screen, the ones
// waiting behind it, and the answer each caller is owed. `ConfirmDialogElement`
// draws whatever the desk holds. `mountConfirmDialog` starts the desk, defines
// the tag and adds it to the ShellSurfaceRegistry; it runs once, on import.
//
// All words are drawn as text, never markup.

import { EffectBus, I18N_IOC_KEY, type ConfirmRequest, type ConfirmResponse, type I18nProvider } from '@hypercomb/core'

export const CONFIRM_DIALOG_SURFACE = 'hc-confirm-dialog'
export const CONFIRM_DIALOG_OWNER = '@hypercomb.social/ConfirmDialog'
const REGISTRY_KEY = '@hypercomb.social/ShellSurfaceRegistry'
const STYLE_ID = 'hc-confirm-dialog-style'

/** The words, as the shell's `t` pipe gives them: the key when nothing answers. */
const t = (key: string, params?: Record<string, string | number>): string => {
  const i18n = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  return i18n?.t(key, params) ?? key
}

/**
 * The questions. Every request is asked in its turn and every caller gets an
 * answer: a second request used to replace the first, and the first caller's
 * promise never settled — a publish waited forever on a dialog nobody could
 * see again (2026-10-23). Says `change` when the question on screen changes.
 */
export class ConfirmDesk extends EventTarget {
  /** A request moved up from the queue lands in the same panel under the same
   *  pointer: it answers nothing until this long has passed, so a double-click
   *  or a held key never answers a question nobody has read. */
  static readonly ARM_MS = 400

  #request: ConfirmRequest | null = null
  /** Requests waiting behind the one on screen. */
  #waiting: ConfirmRequest[] = []
  #processedIds = new Set<string>()
  #armedAt = 0
  #optedOut = false
  #off: (() => void)[] = []

  get request(): ConfirmRequest | null { return this.#request }
  get open(): boolean { return this.#request !== null }

  /** The "don't ask again" box. Counts only on a confirm: a cancel never mutes
   *  a question, and the box starts clear for every question. */
  get optedOut(): boolean { return this.#optedOut }
  set optedOut(value: boolean) { this.#optedOut = !!value }

  /** Listen for questions, and for Escape. Once. */
  start(): void {
    if (this.#off.length) return
    this.#off.push(EffectBus.on<ConfirmRequest>('confirm:request', req => {
      if (!req?.id) return
      // Last-value replay hands back a request already answered.
      if (this.#processedIds.has(req.id)) return
      if (this.#request?.id === req.id || this.#waiting.some(w => w.id === req.id)) return
      if (this.#request) { this.#waiting.push(req); return }
      this.#show(req)
    }))
    this.#off.push(EffectBus.on<{ cmd: string }>('keymap:invoke', payload => {
      if (payload?.cmd === 'global.escape' && this.open) this.dismiss()
    }))
  }

  stop(): void {
    for (const off of this.#off.splice(0)) off()
  }

  readonly confirm = (): void => { this.#respond(true) }
  readonly dismiss = (): void => { this.#respond(false) }

  #respond(confirmed: boolean): void {
    const req = this.#request
    if (!req) return
    if (performance.now() < this.#armedAt) return
    this.#processedIds.add(req.id)
    EffectBus.emit<ConfirmResponse>('confirm:response', {
      id: req.id, confirmed, ...(confirmed && req.optOut && this.#optedOut ? { optedOut: true } : {}),
    })
    this.#optedOut = false
    // The next one waiting is asked in its turn — every caller gets an answer.
    const next = this.#waiting.shift() ?? null
    if (next) this.#armedAt = performance.now() + ConfirmDesk.ARM_MS
    this.#show(next)
  }

  #show(req: ConfirmRequest | null): void {
    this.#request = req
    this.dispatchEvent(new CustomEvent('change'))
  }
}

/** The panel's parts, made once while a question is open and filled for each
 *  question, so a question moved up from the queue lands in the same panel
 *  (no second entrance animation, as the Angular `@if` kept its DOM). */
interface Panel {
  backdrop: HTMLDivElement
  panel: HTMLDivElement
  title: HTMLHeadingElement
  message: HTMLParagraphElement
  warning: HTMLParagraphElement
  hint: HTMLParagraphElement
  optOut: HTMLLabelElement
  optOutBox: HTMLInputElement
  optOutText: HTMLSpanElement
  cancel: HTMLButtonElement
  ok: HTMLButtonElement
}

// A host with no DOM (a CLI, a build, a test world without one) imports this
// module too: the element class must not be evaluated against a missing base.
const ElementBase: typeof HTMLElement = typeof HTMLElement === 'undefined'
  ? (class {} as unknown as typeof HTMLElement)
  : HTMLElement

export class ConfirmDialogElement extends ElementBase {
  /** The desk this element draws, set by `mountConfirmDialog` before the tag is defined. */
  static desk: ConfirmDesk | null = null

  #panel: Panel | null = null
  #desk: ConfirmDesk | null = null
  #i18n: EventTarget | null = null
  readonly #redraw = (): void => { this.#render() }

  connectedCallback(): void {
    ensureStyles()
    this.#desk = ConfirmDialogElement.desk
    this.#desk?.addEventListener('change', this.#redraw)
    // New words (a locale switch, a catalog that landed) redraw the open question.
    const i18n = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(I18N_IOC_KEY)
    this.#i18n = i18n instanceof EventTarget ? i18n : null
    this.#i18n?.addEventListener('change', this.#redraw)
    this.#render()
  }

  disconnectedCallback(): void {
    this.#desk?.removeEventListener('change', this.#redraw)
    this.#i18n?.removeEventListener('change', this.#redraw)
    this.#desk = null
    this.#i18n = null
  }

  #render(): void {
    const req = this.#desk?.request ?? null
    if (!req) {
      this.#panel = null
      this.replaceChildren()
      return
    }
    const p = this.#panel ?? this.#build()
    const title = t(req.title)
    p.panel.setAttribute('aria-label', title)
    p.title.textContent = title
    p.message.textContent = t(req.message, req.messageParams)
    p.warning.hidden = !req.warning
    p.warning.textContent = req.warning ? t(req.warning, req.warningParams) : ''
    p.hint.hidden = !req.hint
    p.hint.textContent = req.hint ? t(req.hint, req.hintParams) : ''
    p.optOut.hidden = !req.optOut
    p.optOutText.textContent = req.optOut ? t(req.optOut) : ''
    p.optOutBox.checked = !!this.#desk?.optedOut
    p.cancel.textContent = t(req.cancelLabel ?? 'confirm.cancel')
    p.ok.textContent = t(req.confirmLabel ?? 'confirm.delete')
    p.ok.classList.toggle('danger', req.danger !== false)
  }

  #build(): Panel {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] => {
      const node = document.createElement(tag)
      if (className) node.className = className
      return node
    }
    const dismiss = (): void => { this.#desk?.dismiss() }

    const backdrop = el('div', 'confirm-backdrop')
    backdrop.addEventListener('click', dismiss)

    const panel = el('div', 'confirm-panel')
    panel.setAttribute('role', 'alertdialog')

    const header = el('header', 'confirm-header')
    const title = el('h3')
    const close = el('button', 'confirm-close')
    close.type = 'button'
    close.textContent = '×'
    close.addEventListener('click', dismiss)
    header.append(title, close)

    const body = el('div', 'confirm-body')
    const message = el('p', 'confirm-message')
    const warning = el('p', 'confirm-warning')
    const hint = el('p', 'confirm-hint')
    const optOut = el('label', 'confirm-optout')
    const optOutBox = el('input')
    optOutBox.type = 'checkbox'
    optOutBox.addEventListener('change', () => { if (this.#desk) this.#desk.optedOut = optOutBox.checked })
    const optOutText = el('span')
    optOut.append(optOutBox, optOutText)
    body.append(message, warning, hint, optOut)

    const actions = el('footer', 'confirm-actions')
    const cancel = el('button', 'confirm-btn cancel')
    cancel.type = 'button'
    cancel.addEventListener('click', dismiss)
    const ok = el('button', 'confirm-btn')
    ok.type = 'button'
    ok.addEventListener('click', () => { this.#desk?.confirm() })
    actions.append(cancel, ok)

    panel.append(header, body, actions)
    this.replaceChildren(backdrop, panel)
    this.#panel = { backdrop, panel, title, message, warning, hint, optOut, optOutBox, optOutText, cancel, ok }
    return this.#panel
  }
}

// THE SAME LOOK, carried over from the Angular component's stylesheet as Sass
// compiled it (tool window `floating-panel`, accent #c8975a), with every rule
// scoped under the tag: the component's styles were encapsulated, and a bare
// `.confirm-btn` here would reach any other panel's button of that name.
// Breakpoints: tablet 600–1023px, phone ≤599px (_breakpoints.scss).
function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  const T = CONFIRM_DIALOG_SURFACE
  style.textContent = `
${T} { display: contents; }
${T} [hidden] { display: none !important; }
${T} .confirm-backdrop {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.72);
  -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
  z-index: 100000; animation: hc-confirm-backdrop-enter 200ms ease forwards;
}
${T} .confirm-panel { --acc: 200, 151, 90; }
:is([data-theme=light], [data-theme=honey], [data-theme=bloom], [data-theme=sherbet]) ${T} .confirm-panel { --acc: 116, 81, 39; }
@media (prefers-color-scheme: light) {
  :root:not([data-theme]) ${T} .confirm-panel { --acc: 116, 81, 39; }
}
${T} .confirm-panel {
  --hc-window-accent: rgb(var(--acc));
  --hc-window-accent-quiet: rgb(var(--acc));
  --hc-window-wash: rgba(var(--acc), 0.10);
  --hc-window-wash-strong: rgba(var(--acc), 0.20);
  --hc-window-edge: rgba(var(--acc), 0.28);
  --hc-window-edge-firm: rgba(var(--acc), 0.62);
  --hc-window-on-accent: rgb(var(--hc-panel-pane));
  --hc-window-radius-control: 2px;
  --hc-window-radius-card: 3px;
  --hc-window-radius-floating: 4px;
  background: rgba(var(--hc-panel-pane), 0.98);
  border: 1px solid rgba(var(--acc), 0.38);
  border-radius: 4px;
  box-shadow: 0 18px 54px rgba(var(--hc-panel-shadow), 0.55), inset 0 1px rgba(var(--hc-panel-sheen), 0.03);
  font-family: var(--hc-mono, system-ui);
  color: var(--hc-panel-text);
  outline: none;
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 100001; width: min(90vw, 22rem);
  display: flex; flex-direction: column;
  -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
  animation: hc-confirm-panel-enter 300ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
${T} .confirm-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.75rem 1rem 0.5rem; border-bottom: 1px solid var(--hc-window-line);
}
${T} .confirm-header h3 {
  font-size: 0.68rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--hc-window-accent); margin: 0;
}
${T} .confirm-close {
  display: flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem;
  background: none; border: none; border-radius: 3px; color: var(--hc-window-ink-quiet);
  font-size: 1rem; cursor: pointer; transition: color 150ms ease, background 150ms ease;
}
${T} .confirm-close:hover { color: var(--hc-window-ink-loud); background: var(--hc-window-tint-strong); }
${T} .confirm-body { padding: 0.75rem 1rem; }
${T} .confirm-message { font-size: 0.78rem; color: var(--hc-window-ink-quiet); margin: 0; line-height: 1.5; }
${T} .confirm-warning {
  font-size: 0.72rem; color: var(--hc-status-alert); margin: 0.5rem 0 0; padding: 0.4rem 0.6rem;
  background: color-mix(in srgb, var(--hc-status-alert) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--hc-status-alert) 15%, transparent);
  border-radius: 4px; line-height: 1.4;
}
${T} .confirm-hint { font-size: 0.72rem; color: var(--hc-window-ink-quiet); margin: 0.5rem 0 0; line-height: 1.45; }
${T} .confirm-optout {
  display: flex; align-items: center; gap: 0.45rem; margin: 0.65rem 0 0; font-size: 0.7rem;
  color: var(--hc-window-ink-quiet); cursor: pointer; -webkit-user-select: none; user-select: none;
}
${T} .confirm-optout input { margin: 0; accent-color: var(--hc-window-accent); cursor: pointer; }
${T} .confirm-actions {
  display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.5rem 1rem 0.75rem;
  border-top: 1px solid var(--hc-window-line);
}
${T} .confirm-btn {
  font-family: var(--hc-mono); font-size: 0.68rem; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; padding: 0.4rem 0.9rem; border-radius: 4px;
  border: 1px solid var(--hc-window-line); cursor: pointer;
  transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
}
${T} .confirm-btn.cancel { background: var(--hc-window-tint); color: var(--hc-window-ink-quiet); }
${T} .confirm-btn.cancel:hover { background: var(--hc-window-tint-strong); color: var(--hc-window-ink-plain); }
${T} .confirm-btn.danger {
  background: color-mix(in srgb, var(--hc-status-alert) 12%, transparent);
  color: var(--hc-status-alert);
  border-color: color-mix(in srgb, var(--hc-status-alert) 20%, transparent);
}
${T} .confirm-btn.danger:hover {
  background: color-mix(in srgb, var(--hc-status-alert) 22%, transparent);
  border-color: color-mix(in srgb, var(--hc-status-alert) 40%, transparent);
}
${T} .confirm-btn.danger:active { transform: scale(0.97); }
@keyframes hc-confirm-backdrop-enter { from { opacity: 0; } to { opacity: 1; } }
@keyframes hc-confirm-panel-enter {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
@keyframes hc-confirm-panel-enter-phone {
  from { opacity: 0; transform: translateY(100%); }
  to { opacity: 1; transform: translateY(0); }
}
@media (min-width: 600px) and (max-width: 1023px) {
  ${T} .confirm-panel { width: min(85vw, 24rem); }
  ${T} .confirm-close { width: 2.2rem; height: 2.2rem; }
  ${T} .confirm-btn { padding: 0.5rem 1rem; font-size: 0.72rem; }
}
@media (max-width: 599px) {
  ${T} .confirm-panel {
    top: auto; bottom: 0; left: 0; right: 0; transform: none; width: 100%;
    border-radius: var(--hc-radius-floating) var(--hc-radius-floating) 0 0;
    padding-bottom: var(--hc-safe-bottom, env(safe-area-inset-bottom, 0px));
    animation: hc-confirm-panel-enter-phone 250ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  ${T} .confirm-header { padding: 0.85rem 1rem 0.6rem; }
  ${T} .confirm-header h3 { font-size: 0.72rem; }
  ${T} .confirm-close { width: 2.5rem; height: 2.5rem; font-size: 1.1rem; }
  ${T} .confirm-message { font-size: 0.82rem; }
  ${T} .confirm-warning { font-size: 0.76rem; }
  ${T} .confirm-actions { padding: 0.6rem 1rem 0.85rem; }
  ${T} .confirm-btn { padding: 0.55rem 1.1rem; font-size: 0.74rem; min-height: 2.5rem; }
}
`
  document.head.appendChild(style)
}

type RegistryLike = {
  add(surface: { name: string; owner?: string; element?: string; order?: number; host?: boolean }): void
  all?: () => readonly { name?: string }[]
}

/**
 * Start the desk, define the tag, and put the surface in the shell. Once per
 * page, however many times it is called and however many copies of this
 * module a page holds: the desk is kept on the class the defined tag uses, so
 * a second copy finds the first one's desk instead of starting its own.
 */
export function mountConfirmDialog(): void {
  if (typeof window === 'undefined' || typeof customElements === 'undefined') return
  const defined = customElements.get(CONFIRM_DIALOG_SURFACE) as typeof ConfirmDialogElement | undefined
  const element = defined ?? ConfirmDialogElement
  if (!element.desk) {
    const desk = new ConfirmDesk()
    desk.start()
    element.desk = desk
  }
  if (!defined) customElements.define(CONFIRM_DIALOG_SURFACE, ConfirmDialogElement)
  const ioc = (window as { ioc?: { whenReady?: <T>(key: string, cb: (value: T) => void) => void } }).ioc
  ioc?.whenReady?.<RegistryLike>(REGISTRY_KEY, registry => {
    if (registry.all?.().some(surface => surface?.name === CONFIRM_DIALOG_SURFACE)) return
    // Order 240: where the Angular dialog stood, above the panels it asks for.
    // `host`: it is mounted with no package at all, so a cold origin must not
    // read it as a live package (the shim's front door waits on that test).
    registry.add({ name: CONFIRM_DIALOG_SURFACE, owner: CONFIRM_DIALOG_OWNER, element: CONFIRM_DIALOG_SURFACE, order: 240, host: true })
  })
}

mountConfirmDialog()
