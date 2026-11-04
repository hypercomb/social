// world-models/entrance.view.ts
//
// <hc-world-models> — the entrance page. A framework-free element. The drone
// adds it to the shell surface registry; this file defines it. It starts
// hidden. /world-models shows it.
//
// The page draws the five open traits and an invitation. It does not collect
// anything, does not call out, and does not listen for Escape. The keymap
// cascade parks it with every other window.

import { EffectBus, I18N_IOC_KEY, holdWindow, type I18nProvider, type WindowSession } from '@hypercomb/core'
import {
  WORLD_MODEL_COPY,
  WORLD_MODEL_NAMESPACE,
  WORLD_MODEL_TRAITS,
  WORLD_MODELS_SURFACE,
  WORLD_MODELS_WINDOW,
} from './world-models.words.js'

const GATE = '@diamondcoreprocessor.com/InputGate'
const BACK = '@diamondcoreprocessor.com/BackGesture'
const OWNER = 'world-models'

type Gate = { lock(owner: string): void; unlock(owner: string): void }
type Back = { register(entry: { owner: string; back: () => void; active?: () => boolean }): () => void }

const wordOf = (trait: (typeof WORLD_MODEL_TRAITS)[number]): string =>
  typeof trait === 'string' ? trait : trait.word

const say = (key: string): string => {
  const i18n = (globalThis as { ioc?: { get?: (key: string) => I18nProvider | undefined } }).ioc
    ?.get?.(I18N_IOC_KEY)
  const translated = i18n?.t(key, undefined, WORLD_MODEL_NAMESPACE)
  if (!translated || translated === key) return WORLD_MODEL_COPY[key] ?? key
  return translated
}

let page: WorldModelsEntrance | null = null
let waiting = false

export class WorldModelsEntrance extends HTMLElement {
  #session: WindowSession
  #releaseHold: (() => void) | null = null
  #releaseBack: (() => void) | null = null

  constructor() {
    super()
    this.#session = {
      park: () => this.#away(),
      unpark: () => this.show(),
      close: () => this.#away(),
    }
  }

  connectedCallback(): void {
    if (page && page !== this) return
    page = this
    this.tabIndex = -1
    this.setAttribute('role', 'dialog')
    this.setAttribute('aria-modal', 'true')
    this.setAttribute('aria-labelledby', 'wm-title')
    if (!this.querySelector('.wm-page')) this.#build()
    this.#away()
    if (waiting) {
      waiting = false
      this.show()
    }
  }

  disconnectedCallback(): void {
    if (page === this) page = null
    this.#releaseBack?.()
    this.#releaseBack = null
    this.#dropHold()
    this.#gate(false)
  }

  /** Show the entrance. The queen's effect and a parked window's return both land here. */
  show(): void {
    this.#fill()
    this.classList.add('wm-open')
    this.removeAttribute('hidden')
    this.#gate(true)
    this.#grabHold()
    if (!this.#releaseBack) {
      const back = (globalThis as { ioc?: { get?: (key: string) => Back | undefined } }).ioc?.get?.(BACK)
      this.#releaseBack = back?.register({
        owner: OWNER,
        active: () => this.classList.contains('wm-open'),
        back: () => { this.#session.close?.() },
      }) ?? null
    }
    this.focus()
  }

  #build(): void {
    const style = document.createElement('style')
    style.textContent = PAGE_CSS

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'wm-close'
    close.addEventListener('click', () => this.#session.close?.())

    const title = document.createElement('h1')
    title.id = 'wm-title'
    title.className = 'wm-title'

    const lead = document.createElement('p')
    lead.className = 'wm-lead'

    const seats = document.createElement('ul')
    seats.className = 'wm-seats'
    for (const trait of WORLD_MODEL_TRAITS) {
      const word = wordOf(trait)
      const item = document.createElement('li')
      item.className = 'wm-seat'
      const hex = document.createElement('div')
      hex.className = 'wm-hex'
      const inner = document.createElement('div')
      inner.className = 'wm-hex-in'
      const name = document.createElement('span')
      name.className = 'wm-word'
      name.textContent = word
      const state = document.createElement('span')
      state.className = 'wm-state'
      inner.append(name, state)
      hex.append(inner)
      const line = document.createElement('p')
      line.className = 'wm-line'
      line.dataset['seat'] = word
      item.append(hex, line)
      seats.append(item)
    }

    const invitation = document.createElement('p')
    invitation.className = 'wm-invite'

    const sheet = document.createElement('div')
    sheet.className = 'wm-page'
    sheet.setAttribute('data-consumes-wheel', '')
    sheet.append(close, title, lead, seats, invitation)
    this.append(style, sheet)
  }

  #fill(): void {
    const close = this.querySelector('.wm-close')
    if (close) close.textContent = say('world-models.close')
    const title = this.querySelector('.wm-title')
    if (title) title.textContent = say('world-models.title')
    const lead = this.querySelector('.wm-lead')
    if (lead) lead.textContent = say('world-models.lead')
    const invitation = this.querySelector('.wm-invite')
    if (invitation) invitation.textContent = say('world-models.invitation')
    for (const state of this.querySelectorAll('.wm-state')) state.textContent = say('world-models.unfilled')
    for (const line of this.querySelectorAll<HTMLElement>('.wm-line')) {
      const word = line.dataset['seat'] ?? ''
      line.textContent = say(`world-models.seat.${word}`)
    }
  }

  #away(): void {
    this.classList.remove('wm-open')
    this.setAttribute('hidden', '')
    this.#gate(false)
    this.#releaseBack?.()
    this.#releaseBack = null
    this.#dropHold()
  }

  #grabHold(): void {
    if (this.#releaseHold) return
    this.#releaseHold = holdWindow(WORLD_MODELS_WINDOW, this.#session, () => this)
  }

  #dropHold(): void {
    this.#releaseHold?.()
    this.#releaseHold = null
  }

  #gate(hold: boolean): void {
    const gate = (globalThis as { ioc?: { get?: (key: string) => Gate | undefined } }).ioc?.get?.(GATE)
    if (hold) gate?.lock(OWNER)
    else gate?.unlock(OWNER)
  }
}

EffectBus.on('world-models:open', () => {
  if (page) page.show()
  else waiting = true
})

if (typeof customElements !== 'undefined' && !customElements.get(WORLD_MODELS_SURFACE)) {
  customElements.define(WORLD_MODELS_SURFACE, WorldModelsEntrance)
}

const PAGE_CSS = `
${WORLD_MODELS_SURFACE}{display:none;}
${WORLD_MODELS_SURFACE}.wm-open{
  display:block;position:fixed;inset:0;z-index:100002;
  background:var(--md-surface,#0e141c);color:var(--md-on-surface,#e7edf5);
  font:inherit;overflow:auto;
}
${WORLD_MODELS_SURFACE} .wm-page{
  box-sizing:border-box;min-height:100%;
  max-width:52rem;margin:0 auto;
  padding:4.5rem 1.5rem 5.5rem;
}
${WORLD_MODELS_SURFACE} .wm-close{
  position:fixed;top:1rem;right:1rem;
  font:inherit;font-size:0.95rem;
  color:var(--md-on-surface,#e7edf5);
  background:var(--md-surface-c,#1a2330);
  border:1px solid var(--md-outline,rgba(231,237,245,0.2));
  border-radius:var(--md-shape-full,999px);
  padding:0.4rem 0.9rem;cursor:pointer;
}
${WORLD_MODELS_SURFACE} .wm-title{
  margin:0 0 0.6rem;font-size:2.25rem;font-weight:500;letter-spacing:-0.02em;
}
${WORLD_MODELS_SURFACE} .wm-lead{
  margin:0 0 2.2rem;max-width:36rem;font-size:1.2rem;line-height:1.45;
  color:var(--md-on-surface-var,#b7c3d4);
}
${WORLD_MODELS_SURFACE} .wm-seats{
  list-style:none;margin:0;padding:0;
  display:grid;grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr));
  gap:1.6rem 1rem;
}
${WORLD_MODELS_SURFACE} .wm-seat{display:flex;flex-direction:column;align-items:center;text-align:center;gap:0.75rem;}
${WORLD_MODELS_SURFACE} .wm-hex{
  width:7.5rem;height:8.25rem;
  background:var(--md-outline,rgba(231,237,245,0.45));
  clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
  display:grid;place-items:center;
}
${WORLD_MODELS_SURFACE} .wm-hex-in{
  width:calc(100% - 3px);height:calc(100% - 3px);
  background:var(--md-surface,#0e141c);
  clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.25rem;
  padding:0 0.7rem;
}
${WORLD_MODELS_SURFACE} .wm-word{font-size:0.78rem;line-height:1.2;}
${WORLD_MODELS_SURFACE} .wm-state{
  font-size:0.68rem;letter-spacing:0.08em;text-transform:uppercase;
  color:var(--md-on-surface-var,#b7c3d4);
}
${WORLD_MODELS_SURFACE} .wm-line{
  margin:0;font-size:0.92rem;line-height:1.4;
  color:var(--md-on-surface-var,#b7c3d4);
}
${WORLD_MODELS_SURFACE} .wm-invite{
  margin:2.4rem 0 0;max-width:36rem;font-size:1.05rem;line-height:1.5;
}
`
