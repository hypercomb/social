// presentation/confirm/confirm.view.ts
//
// THE QUESTION BEFORE A DELETE. One request at a time (the rest wait their
// turn): a title, the message, a warning when the act reaches further than
// the tile named, and two words — cancel, or the act. Every answer goes back
// on the bus as `confirm:response`, so the asker's promise (core confirm.ts)
// settles whichever way the question was closed: the act, the cancel, the ×,
// the backdrop, Escape, or the cascade sweeping the screen clear.
//
// ── AN ELEMENT ON THE BASE LAYER ────────────────────────────────────────
//
// A framework-free custom element added to the ShellSurfaceRegistry over IoC,
// the first of shared's Angular panels ported into the package. It mounts the
// tool window's base layer (core/panels/tool-window.ts) floating, and adds
// only its slice: the backdrop, the words, the two acts. The base layer gives
// it the chrome, the theme, the phone sheet and the session, so Escape reaches
// it through the one policy (tool-windows.ts) and never a listener of its own.
//
// A DEPENDENCY: it exports the element and never registers it. The bee
// (confirm.drone.ts) defines it on the first request and adds the surface.

import { EffectBus, mountToolWindow, translateOr, type ConfirmRequest, type ConfirmResponse, type ToolWindow } from '@hypercomb/core'

export const CONFIRM_SURFACE = 'hc-confirm-dialog'
export const CONFIRM_OWNER = '@diamondcoreprocessor.com/ConfirmView'
export const CONFIRM_REQUEST = 'confirm:request'
export const CONFIRM_RESPONSE = 'confirm:response'
const STYLE_ID = 'hc-confirm-styles'
const WINDOW_ID = 'confirm'
const ACCENT_RGB = [200, 151, 90] as const

type Params = Record<string, string | number>

/** The words, with what they say when no catalog is here (the pure host
 *  publishes none): the plural forms are chosen on `count`, as the catalogs'
 *  `.one` / `.other` keys are. */
const WORDS: Record<string, string | { one: string; other: string }> = {
  'confirm.delete-title': 'Confirm Delete',
  'confirm.delete-message': 'Are you sure you want to delete "{name}"?',
  'confirm.delete-children-warning': 'This item contains children that will also be permanently deleted.',
  'confirm.remove-message': { one: 'Delete "{name}" and the tiles nested inside it?', other: 'Delete {count} selected tiles and the tiles nested inside them?' },
  'confirm.remove-children': { one: 'Plus {count} tile nested beneath — explore removed tiles any time in history.', other: 'Plus {count} tiles nested beneath — explore removed tiles any time in history.' },
  'confirm.delete': 'Delete',
  'confirm.cancel': 'Cancel',
}

/** A request's words may be catalog keys (the callers' usual) or already the
 *  words themselves (a bee that translated for its own domain). */
export const say = (key: string, params?: Params): string => {
  const known = WORDS[key]
  const fallback = typeof known === 'string' ? known : known ? (params?.['count'] === 1 ? known.one : known.other) : key
  return translateOr(key, fallback, params)
}

const ensureStyles = (): void => {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  // The modal tier the dialogs share (mesh-modal, trust-prompt: 100000 and
  // 100001); the base layer's own z-index puts the window above the backdrop.
  style.textContent = `
.hc-confirm-backdrop { position: fixed; inset: 0; z-index: 100001; background: rgba(0, 0, 0, 0.72); backdrop-filter: blur(4px); animation: hc-confirm-fade 200ms ease forwards; }
.hc-tw.hc-confirm { top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(90vw, 22rem); animation: hc-confirm-enter 300ms cubic-bezier(0.16, 1, 0.3, 1) forwards; }
.hc-tw.hc-confirm .hc-tw-body { padding: 0.75rem 1rem 0.75rem; }
.hc-confirm-message { margin: 0; font-size: 0.78rem; line-height: 1.5; color: var(--hc-window-ink-quiet); }
.hc-confirm-warning { margin: 0.5rem 0 0; padding: 0.4rem 0.6rem; font-size: 0.72rem; line-height: 1.4; color: var(--hc-status-alert); border-radius: var(--hc-radius-card, 3px);
  background: color-mix(in srgb, var(--hc-status-alert) 8%, transparent); border: 1px solid color-mix(in srgb, var(--hc-status-alert) 15%, transparent); }
.hc-confirm-acts { display: flex; justify-content: flex-end; gap: 0.5rem; margin: 0.75rem -1rem -0.75rem; padding: 0.5rem 1rem 0.75rem; border-top: 1px solid var(--hc-window-edge); }
.hc-confirm-acts .hc-tw-button { font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; font-size: 0.68rem; padding: 0.4rem 0.9rem; }
.hc-confirm-acts .is-danger { color: var(--hc-status-alert); background: color-mix(in srgb, var(--hc-status-alert) 12%, transparent); border-color: color-mix(in srgb, var(--hc-status-alert) 20%, transparent); }
.hc-confirm-acts .is-danger:hover { background: color-mix(in srgb, var(--hc-status-alert) 22%, transparent); border-color: color-mix(in srgb, var(--hc-status-alert) 40%, transparent); }
.hc-confirm-acts .is-danger:active { transform: scale(0.97); }
@keyframes hc-confirm-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes hc-confirm-enter { from { opacity: 0; transform: translate(-50%, -50%) scale(0.96) } to { opacity: 1; transform: translate(-50%, -50%) scale(1) } }
@media (max-width: 600px) {
  .hc-tw.hc-confirm { top: auto; bottom: 0; left: 0; right: 0; transform: none; width: 100%; border-radius: var(--hc-radius-floating, 4px) var(--hc-radius-floating, 4px) 0 0; padding-bottom: var(--hc-safe-bottom, 0px); animation: hc-confirm-rise 250ms cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .hc-confirm-acts .hc-tw-button { padding: 0.55rem 1.1rem; font-size: 0.74rem; min-height: 2.5rem; }
}
@keyframes hc-confirm-rise { from { opacity: 0; transform: translateY(100%) } to { opacity: 1; transform: translateY(0) } }
`
  document.head.appendChild(style)
}

export class ConfirmElement extends HTMLElement {
  #window: ToolWindow | null = null
  #backdrop: HTMLElement | null = null
  #queue: ConfirmRequest[] = []
  #answered = new Set<string>()
  #cleanup: Array<() => void> = []

  connectedCallback(): void {
    ensureStyles()
    this.#cleanup.push(EffectBus.on<ConfirmRequest>(CONFIRM_REQUEST, request => this.ask(request)))
  }

  disconnectedCallback(): void {
    for (const off of this.#cleanup) off()
    this.#cleanup = []
    // Taken off the screen with a question open: the asker is answered, never
    // left waiting on a dialog that no longer exists.
    while (this.#queue.length) this.#respond(false)
  }

  /** Put a question in line; the first in line is shown. A request answered
   *  before (the bus replays its last value to a late listener) is not asked
   *  again. */
  ask(request: ConfirmRequest | null | undefined): void {
    if (!request?.id || this.#answered.has(request.id) || this.#queue.some(held => held.id === request.id)) return
    this.#queue.push(request)
    if (this.#queue.length === 1) this.#show()
  }

  get open$(): boolean { return !!this.#window }
  get request$(): ConfirmRequest | null { return this.#queue[0] ?? null }

  confirm(): void { this.#respond(true) }
  dismiss(): void { this.#respond(false) }

  #show(): void {
    const request = this.#queue[0]
    if (!request) return
    const title = say(request.title)
    if (!this.#window) {
      this.#backdrop = document.createElement('div')
      this.#backdrop.className = 'hc-confirm-backdrop'
      this.#backdrop.addEventListener('click', () => this.dismiss())
      this.appendChild(this.#backdrop)
      this.#window = mountToolWindow(this, {
        id: WINDOW_ID,
        title,
        accent: ACCENT_RGB,
        placement: 'floating',
        className: 'hc-confirm',
        // Escape inside the dialog is the cancel; so is the sweep that puts
        // every window away — a question cannot wait off screen.
        dismiss: () => { this.dismiss(); return true },
        onPark: () => this.dismiss(),
        onClose: () => this.dismiss(),
      })
      this.#window.root.setAttribute('role', 'alertdialog')
    } else {
      this.#window.setTitle(title)
    }
    this.#window.body.replaceChildren(this.#body(request))
    // The focus comes in with the question, so Escape finds the window.
    this.#window.body.querySelector<HTMLButtonElement>('.hc-confirm-cancel')?.focus()
  }

  #hide(): void {
    this.#window?.dispose()
    this.#window = null
    this.#backdrop?.remove()
    this.#backdrop = null
  }

  #respond(confirmed: boolean): void {
    const request = this.#queue.shift()
    if (!request) return
    this.#answered.add(request.id)
    EffectBus.emit<ConfirmResponse>(CONFIRM_RESPONSE, { id: request.id, confirmed })
    if (this.#queue.length) this.#show()
    else this.#hide()
  }

  #body(request: ConfirmRequest): HTMLElement {
    const body = document.createElement('div')
    body.className = 'hc-confirm-content'

    const message = document.createElement('p')
    message.className = 'hc-confirm-message'
    message.textContent = say(request.message, request.messageParams)
    body.appendChild(message)

    if (request.warning) {
      const warning = document.createElement('p')
      warning.className = 'hc-confirm-warning'
      warning.textContent = say(request.warning, request.warningParams)
      body.appendChild(warning)
    }

    const acts = document.createElement('div')
    acts.className = 'hc-confirm-acts'
    acts.appendChild(this.#act(say(request.cancelLabel ?? 'confirm.cancel'), 'hc-confirm-cancel', () => this.dismiss()))
    acts.appendChild(this.#act(say(request.confirmLabel ?? 'confirm.delete'), `hc-confirm-act${request.danger === false ? '' : ' is-danger'}`, () => this.confirm()))
    body.appendChild(acts)
    return body
  }

  #act(label: string, className: string, run: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `hc-tw-button ${className}`
    button.textContent = label
    button.addEventListener('click', run)
    return button
  }
}
