// guide/guide-overlay.view.ts
//
// <hc-guide-bee> — the guide bee as the cursor, and the dialog it drops after a waggle.
// The layer does not take the page's clicks. Only the dialog does. The drone
// defines this element when the guide starts; a dependency registers nothing.

import { kindLabel, type GuideDirections, type GuidePlace } from './guide-place.js'

export const GUIDE_SURFACE = 'hc-guide-bee'

export type GuideDialog = GuideDirections & {
  readonly place: GuidePlace
  readonly status: string
  readonly from: 'bee' | 'agent'
}

const BEE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" aria-hidden="true">
  <g data-wing="l">
    <path d="M78,92 C50,76 22,78 18,95 C16,110 44,108 70,100 C76,98 79,95 78,92 Z" fill="rgba(216,232,255,0.56)" stroke="#a7c2e2" stroke-width="1.2"/>
  </g>
  <g data-wing="r">
    <path d="M122,92 C150,76 178,78 182,95 C184,110 156,108 130,100 C124,98 121,95 122,92 Z" fill="rgba(216,232,255,0.56)" stroke="#a7c2e2" stroke-width="1.2"/>
  </g>
  <clipPath id="hc-guide-bee-body"><path d="M100,98 C129,98 142,115 142,134 C142,153 126,166 108,164 C90,162 58,153 58,132 C58,114 71,98 100,98 Z"/></clipPath>
  <g clip-path="url(#hc-guide-bee-body)">
    <rect x="50" y="95" width="100" height="80" fill="#f7b733"/>
    <path d="M57,118 Q100,128 143,118 L143,131 Q100,141 57,131 Z" fill="#2c1e10"/>
    <path d="M60,144 Q100,153 135,143 L134,155 Q100,164 64,155 Z" fill="#2c1e10"/>
  </g>
  <circle cx="100" cy="66" r="36" fill="#c58a38"/>
  <ellipse cx="85" cy="69" rx="8.5" ry="11.5" fill="#211710"/><circle cx="88" cy="63.5" r="3.1" fill="#fff"/>
  <ellipse cx="116" cy="67" rx="11" ry="14" fill="#211710"/><circle cx="120" cy="60.5" r="4" fill="#fff"/>
  <path d="M94,86 q9,7 18,1" fill="none" stroke="#3a2814" stroke-width="1.8" stroke-linecap="round"/>
</svg>`

const STYLE = `
:host {
  position: fixed;
  inset: 0;
  z-index: 100000;
  pointer-events: none;
  display: none;
  --g-accent: #d9a441;
  --g-ink: #eef2f5;
  --g-dim: #93a4b6;
  --g-panel: rgba(13, 15, 21, 0.96);
  --g-edge: rgba(255, 255, 255, 0.10);
  font-family: var(--hc-read, var(--hc-font, system-ui)), system-ui, sans-serif;
}
:host(.on) { display: block; }
.bee {
  position: absolute;
  left: 0;
  top: 0;
  width: 52px;
  height: 52px;
  margin: -34px 0 0 -26px;
  filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.35));
  will-change: transform;
}
.bee .sprite { display: block; width: 52px; height: 52px; transform-origin: 50% 62%; }
:host(.motion) .bee .sprite { animation: hc-guide-bob 0.7s ease-in-out infinite; }
:host(.motion.waggle) .bee .sprite { animation: hc-guide-waggle 0.42s ease-in-out infinite; }
@keyframes hc-guide-bob {
  0%, 100% { transform: rotate(-12deg); }
  50% { transform: rotate(10deg); }
}
@keyframes hc-guide-waggle {
  0% { transform: translate(0, 0) rotate(-18deg); }
  12% { transform: translate(16px, -9px) rotate(-4deg); }
  25% { transform: translate(26px, 0) rotate(14deg); }
  37% { transform: translate(16px, 9px) rotate(4deg); }
  50% { transform: translate(0, 0) rotate(-8deg); }
  62% { transform: translate(-16px, -9px) rotate(4deg); }
  75% { transform: translate(-26px, 0) rotate(-16deg); }
  87% { transform: translate(-16px, 9px) rotate(-4deg); }
  100% { transform: translate(0, 0) rotate(-18deg); }
}
.hint {
  position: absolute;
  max-width: 18rem;
  padding: 0.35rem 0.5rem;
  border-radius: var(--hc-radius-control, 2px);
  background: var(--g-panel);
  color: var(--g-ink);
  font-family: var(--hc-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.02em;
  line-height: 1.35;
  white-space: pre-line;
  opacity: 0;
}
.hint.show { opacity: 1; }
.ring {
  position: absolute;
  border: 1px solid var(--g-accent);
  border-radius: var(--hc-radius-card, 3px);
  box-shadow: inset 0 0 0 1px rgba(217, 164, 65, 0.25);
  display: none;
}
.ring.show { display: block; }
.dialog {
  position: absolute;
  width: min(22rem, calc(100vw - 24px));
  max-height: min(24rem, calc(100vh - 24px));
  overflow: auto;
  box-sizing: border-box;
  padding: 0.75rem 0.9rem 0.8rem;
  background: var(--g-panel);
  color: var(--g-ink);
  border: 1px solid var(--g-edge);
  border-left: 2px solid var(--g-accent);
  border-radius: var(--hc-radius-floating, 4px);
  box-shadow: 0 18px 54px rgba(0, 0, 0, 0.55);
  pointer-events: auto;
}
.chip {
  font-family: var(--hc-mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--g-dim);
}
.place { margin: 0.35rem 0 0; font-size: 15px; line-height: 1.35; }
.prompt { margin: 0.45rem 0 0; font-size: 13.5px; line-height: 1.5; }
.status { margin: 0.4rem 0 0; color: var(--g-dim); font-size: 12px; line-height: 1.4; }
.options { display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.7rem; }
.options button, .dismiss {
  font: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: var(--hc-radius-control, 2px);
}
.options button {
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--g-edge);
  background: transparent;
  color: var(--g-ink);
}
.options button:hover, .options button:focus-visible { border-color: var(--g-accent); outline: none; }
.dismiss {
  margin-top: 0.7rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--g-dim);
  font-family: var(--hc-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.04em;
}
.choices { position: absolute; inset: 0; pointer-events: none; }
.choices button {
  position: absolute;
  max-width: 11rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--g-edge);
  border-radius: var(--hc-radius-control, 2px);
  background: var(--g-panel);
  color: var(--g-ink);
  font: inherit;
  font-size: 13px;
  line-height: 1.35;
  text-align: center;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.choices button.on {
  border-color: var(--g-accent);
  box-shadow: 0 0 0 1px var(--g-accent);
}
`

export class GuideOverlayElement extends HTMLElement {
  onPick: ((option: string) => void) | null = null
  onDismiss: (() => void) | null = null

  readonly #bee = document.createElement('div')
  readonly #hint = document.createElement('div')
  readonly #ring = document.createElement('div')
  readonly #dialog = document.createElement('div')
  readonly #choices = document.createElement('div')
  #open = false
  #anchor = { x: 0, y: 0 }

  constructor() {
    super()
    const root = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = STYLE
    this.#bee.className = 'bee'
    this.#bee.innerHTML = `<div class="sprite">${BEE}</div>`
    this.#hint.className = 'hint'
    this.#ring.className = 'ring'
    this.#dialog.className = 'dialog'
    this.#dialog.setAttribute('role', 'dialog')
    this.#dialog.setAttribute('aria-label', 'Choices for this place')
    this.#dialog.hidden = true
    this.#choices.className = 'choices'
    this.#choices.hidden = true
    root.append(style, this.#ring, this.#bee, this.#hint, this.#choices, this.#dialog)
  }

  connectedCallback(): void {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    this.classList.toggle('motion', !reduced)
  }

  get dialogOpen(): boolean { return this.#open }

  arm(): void { this.classList.add('on') }

  disarm(): void {
    this.classList.remove('on')
    this.#open = false
    this.#dialog.hidden = true
    this.#dialog.replaceChildren()
    this.#ring.classList.remove('show')
    this.#hint.classList.remove('show')
    this.classList.remove('waggle')
    this.clearChoices()
  }

  /** Choices around the screen centre. The drag aims them; they do not take the pointer. */
  ringChoices(cx: number, cy: number, options: readonly string[], reach: number): void {
    this.#choices.replaceChildren()
    this.#choices.hidden = options.length === 0
    options.forEach((option, index) => {
      const angle = (index / options.length) * Math.PI * 2
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = option
      button.style.left = `${Math.round(cx + Math.cos(angle) * reach)}px`
      button.style.top = `${Math.round(cy + Math.sin(angle) * reach)}px`
      this.#choices.appendChild(button)
    })
  }

  /** Light the choice a drag is on. -1 lights none. */
  aimChoice(index: number): void {
    this.#choices.querySelectorAll('button').forEach((button, i) => {
      button.classList.toggle('on', i === index)
    })
  }

  clearChoices(): void {
    this.#choices.hidden = true
    this.#choices.replaceChildren()
  }

  /** Figure-8 in place. The drone starts it after the bee has waited on a tile. */
  waggle(on: boolean): void {
    if (on && !this.classList.contains('motion')) return
    this.classList.toggle('waggle', on)
  }

  follow(x: number, y: number): void {
    this.#bee.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
    this.#hint.style.transform = `translate3d(${Math.round(x + 28)}px, ${Math.round(y + 18)}px, 0)`
  }

  hint(text: string): void {
    const shown = text.trim()
    this.#hint.textContent = shown
    this.#hint.classList.toggle('show', shown.length > 0 && !this.#open)
  }

  ring(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'> | null): void {
    if (!rect || this.#open) {
      this.#ring.classList.remove('show')
      return
    }
    const pad = 4
    this.#ring.style.left = `${Math.round(rect.left - pad)}px`
    this.#ring.style.top = `${Math.round(rect.top - pad)}px`
    this.#ring.style.width = `${Math.round(rect.width + pad * 2)}px`
    this.#ring.style.height = `${Math.round(rect.height + pad * 2)}px`
    this.#ring.classList.add('show')
  }

  /** Drop the dialog where the bee waited. Later calls with the same anchor refresh the words. */
  show(dialog: GuideDialog): void {
    const moved = !this.#open || this.#anchor.x !== dialog.place.x || this.#anchor.y !== dialog.place.y
    this.#anchor = { x: dialog.place.x, y: dialog.place.y }
    this.#open = true
    this.#hint.classList.remove('show')
    this.#ring.classList.remove('show')
    this.#dialog.hidden = false
    this.#render(dialog)
    this.#place()
    if (moved) this.#dialog.querySelector('button')?.focus()
  }

  status(text: string): void {
    const node = this.#dialog.querySelector('.status')
    if (!(node instanceof HTMLElement)) return
    const shown = text.trim()
    node.textContent = shown
    node.hidden = shown.length === 0
  }

  #render(dialog: GuideDialog): void {
    this.#dialog.replaceChildren()
    const chip = document.createElement('div')
    chip.className = 'chip'
    chip.textContent = dialog.place.route
    const place = document.createElement('p')
    place.className = 'place'
    const called = dialog.place.name || dialog.place.heading || 'This place'
    const behaviors = dialog.place.behaviors ?? []
    place.textContent = dialog.place.kind === 'tile'
      ? (behaviors.length ? behaviors.join(' · ') : 'No beehavior yet')
      : `${kindLabel(dialog.place.kind)} · ${called}`
    const prompt = document.createElement('p')
    prompt.className = 'prompt'
    prompt.textContent = dialog.prompt
    const status = document.createElement('p')
    status.className = 'status'
    const shown = dialog.status.trim()
    status.textContent = shown
    status.hidden = shown.length === 0
    const options = document.createElement('div')
    options.className = 'options'
    for (const option of dialog.options) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = option
      button.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        this.onPick?.(option)
      })
      options.appendChild(button)
    }
    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.className = 'dismiss'
    dismiss.textContent = 'Dismiss'
    dismiss.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      this.dismiss()
    })
    this.#dialog.append(chip, place, prompt, options, status, dismiss)
  }

  dismiss(): void {
    this.#open = false
    this.#dialog.hidden = true
    this.#dialog.replaceChildren()
    this.onDismiss?.()
  }

  #place(): void {
    const box = this.#dialog
    box.style.left = '0px'
    box.style.top = '0px'
    const width = Math.min(352, box.offsetWidth || 320)
    const height = box.offsetHeight || 180
    const margin = 12
    let x = this.#anchor.x + 36
    if (x + width + margin > window.innerWidth) x = this.#anchor.x - 36 - width
    x = Math.max(margin, Math.min(x, window.innerWidth - width - margin))
    let y = this.#anchor.y - 12
    y = Math.max(margin, Math.min(y, window.innerHeight - height - margin))
    box.style.left = `${Math.round(x)}px`
    box.style.top = `${Math.round(y)}px`
  }
}
