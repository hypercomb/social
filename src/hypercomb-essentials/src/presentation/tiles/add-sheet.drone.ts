// presentation/tiles/add-sheet.drone.ts
//
// THE ADD SHEET — the phone's one way to make something here.
//
// Five doors that already existed, in five different places (the command
// line's strip, the layer deck's plates, the mic on the rail, a URL pasted
// into the prompt), folded into ONE sheet the bar's Add disc opens
// (documentation/mobile-one-column.md §2.3):
//
//   name it     → `command:submit {text}` — the command line's own executor,
//                 so a URL is a link, `/x` is a command, a word is a tile,
//                 and a reserved word is refused. Enter adds and KEEPS the
//                 sheet up (Enter = complete + send).
//   take a photo→ `camera:capture-open` (hc-camera-capture; closes first)
//   library     → a hidden multi-file input → ImagePasteWorker
//                 .createTileFromImage, the shutter's own seam
//   paste a link→ the clipboard, read inside the tap; a URL is submitted,
//                 anything else lands in the field with a word about it
//   say it      → VoiceInputService; the interim words show in the field,
//                 release submits through the command line as it always did
//
// IT IS CHROME: never `view:active`, phone-only by the one definition of a
// phone, closes on backdrop / Escape / hardware BACK (one synthetic history
// entry) / the deck opening / a view taking the screen. It reports
// `add:sheet-state {open}` so the bar's disc is lit exactly while it is up.
//
// CONTRIBUTED THE DOCTRINE WAY: a framework-free custom element added to the
// ShellSurfaceRegistry over IoC — never a tag in either app.html.

import { Drone, EffectBus, I18N_IOC_KEY, isReservedPoolWord, type I18nProvider } from '@hypercomb/core'
import { MOBILE_MODE_EFFECT, MOBILE_MODE_IOC_KEY } from '../../preferences/mobile-pheromones.js'

export const ADD_SHEET_SURFACE = 'hc-add-sheet'
export const ADD_SHEET_KEY = '@diamondcoreprocessor.com/AddSheetDrone'
/** The layer deck's level: a sheet the bar opened sits over the bar. */
const SHEET_Z = 100003
const BACKDROP = 'rgba(0,0,0,0.42)'
const STYLE_ID = 'hc-add-sheet-css'
const URL_RE = /^(https?:\/\/\S+|www\.\S+\.\S+)$/i

type LineageShape = { explorerSegments?: () => readonly string[] }
type ModesShape = { isActive?: (mode: string) => boolean }
type ImagePasteShape = { createTileFromImage?: (blob: Blob) => Promise<void> }
type VoiceShape = { toggle?: () => void; stop?: () => void; readonly active?: boolean }

export class AddSheetElement extends HTMLElement {
  connectedCallback(): void {
    this.style.cssText = `position:fixed;inset:0;z-index:${SHEET_Z};display:none;pointer-events:none;`
    this.setAttribute('data-hc-add-sheet', '')
    window.ioc?.get?.<AddSheetDrone>(ADD_SHEET_KEY)?.attach(this)
  }

  disconnectedCallback(): void {
    window.ioc?.get?.<AddSheetDrone>(ADD_SHEET_KEY)?.detach(this)
  }
}

export class AddSheetDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  protected override deps = { lineage: '@hypercomb.social/Lineage' }
  protected override listens = [
    'add:sheet-open', 'add:sheet-close', 'layer:deck-open', MOBILE_MODE_EFFECT, 'view:active',
    'voice:active', 'voice:interim',
  ]
  protected override emits = [
    'add:sheet-state', 'command:submit', 'command:create-cells', 'link:intake',
    'camera:capture-open', 'layer:deck-close',
  ]

  #registered = false
  #bound = false
  #element: HTMLElement | null = null
  #open = false
  #historyTrap = false
  #fileInput: HTMLInputElement | null = null
  #field: HTMLInputElement | null = null
  #hint: HTMLElement | null = null
  #listening = false

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#registered) {
      window.ioc.register(ADD_SHEET_KEY, this)
      this.#registered = true
    }
    if (this.#bound) return
    this.#bound = true

    this.onEffect('add:sheet-open', () => { this.#open ? this.close() : this.open() })
    this.onEffect('add:sheet-close', () => this.close())
    // One sheet at a time: the deck coming up puts this one away.
    this.onEffect('layer:deck-open', () => this.close())
    this.onEffect<{ active?: boolean }>(MOBILE_MODE_EFFECT, payload => {
      if (payload?.active === false) this.close()
    })
    this.onEffect<{ active?: boolean }>('view:active', payload => {
      if (payload?.active === true) this.close()
    })
    this.onEffect<{ active?: boolean }>('voice:active', payload => {
      this.#listening = payload?.active === true
      if (!this.#listening && this.#field) this.#field.value = ''
      if (this.#open) this.#renderVoice()
    })
    this.onEffect<{ text?: string }>('voice:interim', payload => {
      if (this.#open && this.#listening && this.#field) this.#field.value = String(payload?.text ?? '')
    })

    window.addEventListener('keydown', this.#onKeyDown, true)
    window.addEventListener('popstate', this.#onPopState)
  }

  attach(el: HTMLElement): void {
    this.#element = el
    if (this.#open) this.#render()
  }

  detach(el: HTMLElement): void {
    if (this.#element === el) this.#element = null
  }

  get open_(): boolean { return this.#open }

  open(): void {
    if (this.#open) return
    if (!this.#mobile()) return
    const modes = window.ioc?.get?.<ModesShape>('@diamondcoreprocessor.com/ModeRegistry')
    if (modes?.isActive?.('view:active')) return
    const el = this.#element ?? (document.querySelector(ADD_SHEET_SURFACE) as HTMLElement | null)
    if (!el) return
    this.#element = el
    this.#open = true
    EffectBus.emit('layer:deck-close', {})
    this.#render()
    try {
      window.history.pushState({ hcAddSheet: true }, '')
      this.#historyTrap = true
    } catch { /* history unavailable */ }
    EffectBus.emit('add:sheet-state', { open: true })
    // Focus inside the tap that opened us: that is what raises the keyboard.
    this.#field?.focus()
  }

  close(): void {
    if (!this.#open) return
    this.#open = false
    const el = this.#element
    if (el) {
      el.replaceChildren()
      el.style.display = 'none'
      el.style.pointerEvents = 'none'
    }
    this.#field = null
    this.#hint = null
    if (this.#historyTrap) {
      this.#historyTrap = false
      try { window.history.back() } catch { /* noop */ }
    }
    EffectBus.emit('add:sheet-state', { open: false })
  }

  #onPopState = (): void => {
    if (!this.#open) return
    this.#historyTrap = false
    this.close()
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (!this.#open || e.key !== 'Escape') return
    e.preventDefault()
    this.close()
  }

  // ── DOM ────────────────────────────────────────────────────

  #render(): void {
    const el = this.#element
    if (!el || !this.#open) return
    installAddSheetCss()
    el.replaceChildren()
    el.style.display = 'block'
    el.style.pointerEvents = 'auto'

    const backdrop = document.createElement('div')
    backdrop.dataset['role'] = 'backdrop'
    backdrop.style.cssText = `position:absolute;inset:0;background:${BACKDROP};`
    backdrop.addEventListener('click', () => this.close())
    el.appendChild(backdrop)

    const sheet = document.createElement('div')
    sheet.dataset['role'] = 'add-sheet'
    sheet.setAttribute('data-consumes-wheel', '')
    sheet.setAttribute('role', 'dialog')
    sheet.setAttribute('aria-label', this.#t('add-sheet.title', 'Add to'))

    const grip = document.createElement('div')
    grip.className = 'hc-as-grip'
    sheet.appendChild(grip)

    const heading = document.createElement('div')
    heading.className = 'hc-as-heading'
    const title = document.createElement('span')
    title.textContent = this.#t('add-sheet.title', 'Add to')
    const here = document.createElement('span')
    here.className = 'hc-as-here'
    const segments = this.#segments()
    here.textContent = segments[segments.length - 1] ?? this.#t('layer-list.root', 'your hive')
    heading.append(title, here)
    sheet.appendChild(heading)

    // ── name it ──
    const form = document.createElement('form')
    form.className = 'hc-as-form'
    form.addEventListener('submit', e => { e.preventDefault(); this.#submit() })
    const field = document.createElement('input')
    field.type = 'text'
    field.dataset['action'] = 'name'
    field.className = 'hc-as-field'
    field.placeholder = this.#t('add-sheet.name', 'name it…')
    field.autocomplete = 'off'
    field.autocapitalize = 'none'
    field.enterKeyHint = 'done'
    field.addEventListener('input', () => this.#say(''))
    const go = document.createElement('button')
    go.type = 'submit'
    go.dataset['action'] = 'submit'
    go.className = 'hc-as-go'
    go.textContent = this.#t('add-sheet.submit', 'Add')
    form.append(field, go)
    sheet.appendChild(form)
    this.#field = field

    const hint = document.createElement('div')
    hint.className = 'hc-as-hint'
    hint.dataset['role'] = 'add-hint'
    sheet.appendChild(hint)
    this.#hint = hint

    // ── the doors ──
    sheet.appendChild(this.#door('camera', 'photo_camera', 'add-sheet.camera', 'Take a photo', () => {
      this.close()
      EffectBus.emit('camera:capture-open', {})
    }))
    sheet.appendChild(this.#door('library', 'add_photo_alternate', 'add-sheet.library', 'Photo library', () => this.#pickFromLibrary()))
    sheet.appendChild(this.#door('link', 'link', 'add-sheet.link', 'Paste a link', () => { void this.#pasteLink() }))
    sheet.appendChild(this.#door('voice', 'mic', 'add-sheet.voice', 'Say it', () => this.#toggleVoice()))

    el.appendChild(sheet)
    this.#renderVoice()
  }

  #door(action: string, glyph: string, key: string, fallback: string, run: () => void): HTMLElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'hc-as-door'
    b.dataset['action'] = action
    const i = document.createElement('span')
    i.className = 'mat-sym hc-as-glyph'
    i.setAttribute('aria-hidden', 'true')
    i.textContent = glyph
    const label = document.createElement('span')
    label.className = 'hc-as-label'
    label.textContent = this.#t(key, fallback)
    b.append(i, label)
    b.addEventListener('click', run)
    return b
  }

  /** The voice door says which way it goes: idle names the act, listening
   *  says so and that a tap finishes. */
  #renderVoice(): void {
    const door = this.#element?.querySelector<HTMLElement>('[data-action="voice"]')
    if (!door) return
    door.classList.toggle('is-live', this.#listening)
    const label = door.querySelector<HTMLElement>('.hc-as-label')
    if (label) {
      label.textContent = this.#listening
        ? this.#t('add-sheet.listening', 'Listening… tap to finish')
        : this.#t('add-sheet.voice', 'Say it')
    }
  }

  #say(text: string): void {
    if (this.#hint) this.#hint.textContent = text
  }

  // ── the doors ──────────────────────────────────────────────

  /** What the field holds decides the door — never the command line's
   *  standing stance (in command stance a bare word becomes `/word`, which
   *  is no command; the sheet must add a tile whatever stance the prompt
   *  was left in). A URL is a link; `/x` is a command; a word is a tile
   *  through the create queen's own door, reserved words refused in place. */
  #submit(): void {
    const text = (this.#field?.value ?? '').trim()
    if (!text) return
    if (URL_RE.test(text)) {
      EffectBus.emit('link:intake', { url: text })
    } else if (text.startsWith('/')) {
      EffectBus.emit('command:submit', { text })
    } else {
      const reserved = text.split('/').map(p => p.trim()).find(p => isReservedPoolWord(p))
      if (reserved) {
        this.#say(this.#t('add-sheet.reserved', `"${reserved}" is a reserved word — choose another name`).replace('{name}', reserved))
        return
      }
      let accepted = false
      EffectBus.emitTransient('command:create-cells', {
        name: text,
        accept: () => { accepted = true },
        complete: (error?: unknown) => {
          if (error !== undefined) this.#say(this.#t('add-sheet.refused', 'That could not be added here'))
        },
      })
      if (!accepted) {
        this.#say(this.#t('add-sheet.refused', 'That could not be added here'))
        return
      }
    }
    this.#say('')
    if (this.#field) {
      this.#field.value = ''
      this.#field.focus()
    }
  }

  async #pasteLink(): Promise<void> {
    let text = ''
    try { text = (await navigator.clipboard?.readText?.() ?? '').trim() } catch { text = '' }
    if (URL_RE.test(text)) {
      EffectBus.emit('link:intake', { url: text })
      this.#say('')
      return
    }
    if (this.#field) {
      this.#field.value = text.length > 0 && text.length <= 80 ? text : ''
      this.#field.focus()
    }
    this.#say(this.#t('add-sheet.not-a-link', 'The clipboard had no link — type a name instead'))
  }

  #toggleVoice(): void {
    const voice = window.ioc?.get?.<VoiceShape>('@hypercomb.social/VoiceInputService')
    voice?.toggle?.()
  }

  /** A hidden file input, made once, clicked from the door's own tap (the
   *  gesture a browser requires). Every picked image goes through the same
   *  seam the camera shutter uses. */
  #pickFromLibrary(): void {
    let input = this.#fileInput
    if (!input || !input.isConnected) {
      input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*,video/*'
      input.multiple = true
      input.setAttribute('data-hc-add-sheet-library', '')
      input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;'
      input.addEventListener('change', () => {
        const files = Array.from(input!.files ?? [])
        input!.value = ''
        this.close()
        void this.#intake(files)
      })
      document.body.appendChild(input)
      this.#fileInput = input
    }
    input.click()
  }

  async #intake(files: File[]): Promise<void> {
    const paste = window.ioc?.get?.<ImagePasteShape>('@diamondcoreprocessor.com/ImagePasteWorker')
    if (!paste?.createTileFromImage) return
    for (const file of files) {
      // A video is accepted by the picker so a mixed selection is not
      // refused at the door, but it has no tile-making path here yet.
      if (!file.type.startsWith('image/')) {
        console.warn('[add-sheet] library: no tile path for', file.type, file.name)
        continue
      }
      try { await paste.createTileFromImage(file) } catch (err) {
        console.warn('[add-sheet] library: could not make a tile from', file.name, err)
      }
    }
  }

  // ── reads ──────────────────────────────────────────────────

  #segments(): string[] {
    try {
      const lineage = this.resolve<LineageShape>('lineage')
      return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    } catch { return [] }
  }

  #mobile(): boolean {
    try {
      return window.ioc?.get?.<{ active?: boolean }>(MOBILE_MODE_IOC_KEY)?.active === true
    } catch { return false }
  }

  #t(key: string, fallback: string): string {
    if (!key) return fallback
    try {
      const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
      const text = i18n?.t(key)
      return text && text !== key ? text : fallback
    } catch { return fallback }
  }
}

/** One stylesheet, installed once, scoped to the surface's tag. The chrome's
 *  own tokens, so the sheet follows the theme the list and the bar follow. */
export function installAddSheetCss(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  const S = ADD_SHEET_SURFACE
  style.textContent = `
${S} [data-role="add-sheet"]{position:absolute;left:var(--hc-controls-left,0px);right:var(--hc-controls-right,0px);bottom:max(var(--hc-controls-bottom,0px),env(safe-area-inset-bottom,0px));max-height:min(70vh,32rem);overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;box-sizing:border-box;background:rgb(var(--hc-chrome-glass,250,251,253));color:rgba(var(--hc-chrome-ink,26,33,48),var(--hc-ink-a-plain,0.92));border-top:1px solid rgba(var(--hc-chrome-rule,62,74,94),0.34);border-radius:var(--hc-radius-floating,4px) var(--hc-radius-floating,4px) 0 0;padding:0.5rem max(0.9rem,env(safe-area-inset-right,0px)) 1rem max(0.9rem,env(safe-area-inset-left,0px));display:flex;flex-direction:column;gap:0.35rem;font-family:var(--hc-read,var(--hc-font,system-ui,sans-serif));font-size:1rem;box-shadow:0 -8px 30px rgba(0,0,0,0.18);}
${S} .hc-as-grip{width:2.4rem;height:4px;margin:0 auto 0.6rem;background:rgba(var(--hc-chrome-rule,62,74,94),0.4);}
${S} .hc-as-heading{display:flex;align-items:baseline;gap:0.45rem;font-weight:600;font-size:1.05rem;margin-bottom:0.4rem;min-width:0;}
${S} .hc-as-here{color:rgba(var(--hc-chrome-accent,20,96,180),0.95);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
${S} .hc-as-form{display:grid;grid-template-columns:1fr auto;gap:0.5rem;align-items:stretch;}
${S} .hc-as-field{min-height:2.9rem;box-sizing:border-box;padding:0 0.9rem;font:inherit;font-size:1.05rem;color:inherit;background:rgba(var(--hc-chrome-rule,62,74,94),0.08);border:1.5px solid rgba(var(--hc-chrome-rule,62,74,94),0.34);border-radius:var(--hc-radius-floating,4px);outline:none;min-width:0;}
${S} .hc-as-field:focus{border-color:rgba(var(--hc-chrome-accent,20,96,180),0.8);}
${S} .hc-as-go{appearance:none;border:0;min-width:4rem;padding:0 1rem;font:inherit;font-weight:600;color:rgb(var(--hc-chrome-glass,250,251,253));background:rgba(var(--hc-chrome-accent,20,96,180),0.95);border-radius:var(--hc-radius-floating,4px);cursor:pointer;}
${S} .hc-as-hint{min-height:1.2em;font-size:0.82rem;color:rgba(var(--hc-chrome-ink,26,33,48),var(--hc-ink-a-quiet,0.62));padding:0 0.2rem;}
${S} .hc-as-door{appearance:none;border:0;border-top:1px solid rgba(var(--hc-chrome-rule,62,74,94),0.16);background:none;color:inherit;font:inherit;font-size:1rem;display:grid;grid-template-columns:2.2rem 1fr;align-items:center;gap:0.6rem;min-height:3.1rem;padding:0 0.2rem;text-align:left;cursor:pointer;}
${S} .hc-as-door:active{background:rgba(var(--hc-chrome-accent,20,96,180),0.08);}
${S} .hc-as-door.is-live{color:rgba(var(--hc-chrome-accent,20,96,180),0.95);font-weight:600;}
${S} .hc-as-glyph{font-size:1.5rem;line-height:1;text-align:center;color:rgba(var(--hc-chrome-accent,20,96,180),0.9);}
`
  document.head.appendChild(style)
}

const _addSheet = new AddSheetDrone()
window.ioc.register(ADD_SHEET_KEY, _addSheet)

window.ioc.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  if (!customElements.get(ADD_SHEET_SURFACE)) {
    customElements.define(ADD_SHEET_SURFACE, AddSheetElement)
  }
  try {
    registry.add({
      name: ADD_SHEET_SURFACE,
      owner: ADD_SHEET_KEY,
      element: ADD_SHEET_SURFACE,
      order: 710,
    })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})
