// guide/guide-overlay.view.ts
//
// <hc-guide-bee> — the guide bee as the cursor, and the board that stands
// beside the tile once the bee has danced. The layer does not take the page's
// clicks until the tile is on its way to the middle: from then the shield
// takes them, so nothing reaches the hive behind the ideas. The drone defines
// this element when the guide starts; a dependency registers nothing.

import { drawsAsGlyph } from '../commands/material-glyph.js'
import type { GuideBoardBox, GuideIdea } from './guide-place.js'

export const GUIDE_SURFACE = 'hc-guide-bee'

export type GuideBoardMode = 'tiles' | 'list'

export type GuideBoard = {
  readonly route: string
  readonly name: string
  readonly reading: string
  readonly ideas: readonly GuideIdea[]
  readonly chosen: ReadonlySet<string>
  readonly mode: GuideBoardMode
  readonly box: GuideBoardBox
}

type I18nLike = { t?: (key: string, params?: Record<string, string | number>) => string }

const say = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  let value: string | undefined
  try { value = window.ioc.get<I18nLike>('@hypercomb.social/I18n')?.t?.(key, params) }
  catch { /* no catalog here */ }
  return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
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
:host(.seated) .bee { display: none; }
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
.shield { position: absolute; inset: 0; pointer-events: auto; cursor: default; }
.shield[hidden] { display: none; }
.shield.over { cursor: pointer; }
.label {
  position: absolute;
  left: 0;
  top: 0;
  max-width: 16rem;
  padding: 0.3rem 0.55rem;
  border: 1px solid var(--g-edge);
  border-radius: var(--hc-radius-control, 2px);
  background: var(--g-panel);
  color: var(--g-ink);
  font-size: 0.8125rem;
  line-height: 1.35;
  opacity: 0;
  pointer-events: none;
}
.label.show { opacity: 1; }
.board {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: calc(100vh - 136px);
  padding: 1.1rem 1.25rem 1rem;
  color: var(--g-ink);
  background: linear-gradient(180deg, rgba(217, 164, 65, 0.05), transparent 5rem), var(--g-panel);
  border: 1px solid rgba(217, 164, 65, 0.42);
  border-radius: var(--hc-radius-floating, 4px);
  outline: 1px solid rgba(255, 255, 255, 0.07);
  outline-offset: 3px;
  box-shadow: 0 18px 54px rgba(0, 0, 0, 0.55);
  pointer-events: auto;
}
.board[hidden] { display: none; }
.board::before {
  content: '';
  position: absolute;
  inset: 5px;
  pointer-events: none;
  --tick: linear-gradient(var(--g-accent), var(--g-accent));
  background:
    var(--tick) 0 0 / 16px 1px no-repeat, var(--tick) 0 0 / 1px 16px no-repeat,
    var(--tick) 100% 0 / 16px 1px no-repeat, var(--tick) 100% 0 / 1px 16px no-repeat,
    var(--tick) 0 100% / 16px 1px no-repeat, var(--tick) 0 100% / 1px 16px no-repeat,
    var(--tick) 100% 100% / 16px 1px no-repeat, var(--tick) 100% 100% / 1px 16px no-repeat;
}
.top { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; }
.route {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--hc-mono, ui-monospace, monospace);
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--g-dim);
}
.modes { display: flex; flex: none; gap: 0.6rem; }
.word {
  padding: 0;
  border: 0;
  background: none;
  color: var(--g-dim);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}
.word:hover, .word:focus-visible { color: var(--g-ink); outline: none; text-decoration: underline; }
.word.on { color: var(--g-accent); }
.name { margin: 0.5rem 0 0; font-size: 1.0625rem; font-weight: 600; line-height: 1.3; }
.reading { margin: 0.35rem 0 0; color: var(--g-dim); font-size: 0.8125rem; line-height: 1.45; }
.rule {
  flex: none;
  height: 1px;
  margin: 0.8rem 0 0.35rem;
  background: linear-gradient(90deg, rgba(217, 164, 65, 0.5), rgba(255, 255, 255, 0.06));
}
.items {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  scrollbar-width: thin;
}
.item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  box-sizing: border-box;
  width: 100%;
  padding: 0.42rem 0.25rem;
  border: 0;
  border-left: 2px solid transparent;
  background: none;
  color: var(--g-ink);
  font: inherit;
  font-size: 0.875rem;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
}
.item:hover, .item:focus-visible { background: rgba(255, 255, 255, 0.05); outline: none; }
.item.on { border-left-color: var(--g-accent); color: var(--g-accent); }
.glyph {
  flex: none;
  width: 1.25rem;
  overflow: hidden;
  font-family: 'Material Symbols Outlined';
  font-size: 1.125rem;
  line-height: 1;
  text-align: center;
  color: var(--g-dim);
}
.item.on .glyph { color: var(--g-accent); }
.empty { padding: 0.42rem 0.25rem; color: var(--g-dim); font-size: 0.8125rem; }
.foot { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 1rem; margin-top: 0.8rem; }
.accept {
  padding: 0.4rem 1rem;
  border: 1px solid var(--g-accent);
  border-radius: var(--hc-radius-control, 2px);
  background: rgba(217, 164, 65, 0.14);
  color: var(--g-ink);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}
.accept:hover:not(:disabled), .accept:focus-visible { background: rgba(217, 164, 65, 0.26); outline: none; }
.accept:disabled { border-color: var(--g-edge); background: none; color: var(--g-dim); cursor: default; }
`

export class GuideOverlayElement extends HTMLElement {
  onAim: ((x: number, y: number) => void) | null = null
  onPress: ((x: number, y: number) => void) | null = null
  onToggle: ((id: string) => void) | null = null
  onMode: ((mode: GuideBoardMode) => void) | null = null
  onAccept: (() => void) | null = null
  onClose: (() => void) | null = null

  readonly #bee = document.createElement('div')
  readonly #hint = document.createElement('div')
  readonly #shield = document.createElement('div')
  readonly #label = document.createElement('div')
  readonly #board = document.createElement('div')

  constructor() {
    super()
    const root = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = STYLE
    this.#bee.className = 'bee'
    this.#bee.innerHTML = `<div class="sprite">${BEE}</div>`
    this.#hint.className = 'hint'
    this.#shield.className = 'shield'
    this.#shield.hidden = true
    this.#shield.addEventListener('pointermove', event => this.onAim?.(event.clientX, event.clientY))
    this.#shield.addEventListener('pointerleave', () => this.onAim?.(-1, -1))
    this.#shield.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      this.onPress?.(event.clientX, event.clientY)
    })
    this.#label.className = 'label'
    this.#board.className = 'board'
    this.#board.hidden = true
    this.#board.setAttribute('role', 'dialog')
    root.append(style, this.#shield, this.#bee, this.#hint, this.#label, this.#board)
  }

  connectedCallback(): void {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    this.classList.toggle('motion', !reduced)
  }

  get boardOpen(): boolean { return !this.#board.hidden }

  arm(): void { this.classList.add('on') }

  disarm(): void {
    this.classList.remove('on')
    this.#hint.classList.remove('show')
    this.classList.remove('waggle')
    this.unseat()
  }

  /** The tile is leaving for the middle: the shield takes the hive's pointer. */
  shield(): void {
    this.#hint.classList.remove('show')
    this.#shield.hidden = false
  }

  /** The tile has landed. Placement is not asked for here, so the real cursor comes back. */
  seat(): void {
    this.classList.add('seated')
    this.waggle(false)
  }

  /** The board and label go; the shield holds until the flight home has landed. */
  leave(): void {
    this.#board.hidden = true
    this.#board.replaceChildren()
    this.label('', 0, 0)
  }

  /** Back to the bee over the hive. */
  unseat(): void {
    this.leave()
    this.classList.remove('seated')
    this.#shield.hidden = true
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
    this.#hint.classList.toggle('show', shown.length > 0)
  }

  /** Name the tile under the pointer, just above it. Empty text takes it away. */
  label(text: string, x: number, y: number): void {
    const shown = text.trim()
    this.#label.textContent = shown
    this.#label.classList.toggle('show', shown.length > 0)
    this.#shield.classList.toggle('over', shown.length > 0)
    if (!shown) return
    const width = this.#label.offsetWidth
    const height = this.#label.offsetHeight
    const left = Math.max(8, Math.min(x - width / 2, window.innerWidth - width - 8))
    this.#label.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(Math.max(8, y - height - 6))}px, 0)`
  }

  /** Draw the board. Beside the tiles it lists what is chosen; as a list it holds every idea. */
  board(view: GuideBoard): void {
    const scrolled = this.#board.querySelector('.items')?.scrollTop ?? 0
    this.#board.replaceChildren(this.#top(view), ...this.#heading(view), this.#list(view), this.#foot(view))
    this.#board.hidden = false
    this.#board.setAttribute('aria-label', view.name)
    const box = view.box
    this.#board.style.left = `${Math.round(box.left)}px`
    this.#board.style.width = `${Math.round(box.width)}px`
    this.#board.style.top = `${Math.round(box.top ?? box.middle ?? 0)}px`
    this.#board.style.height = box.height === undefined ? '' : `${Math.round(box.height)}px`
    this.#board.style.transform = box.height === undefined ? 'translateY(-50%)' : ''
    const items = this.#board.querySelector('.items')
    if (items) items.scrollTop = scrolled
  }

  #top(view: GuideBoard): HTMLElement {
    const top = document.createElement('div')
    top.className = 'top'
    const route = document.createElement('span')
    route.className = 'route'
    route.textContent = view.route
    const modes = document.createElement('span')
    modes.className = 'modes'
    const mode = (value: GuideBoardMode, text: string): HTMLButtonElement => {
      const word = this.#word(text, () => this.onMode?.(value))
      word.classList.toggle('on', view.mode === value)
      word.setAttribute('aria-pressed', String(view.mode === value))
      return word
    }
    modes.append(mode('tiles', say('guide.tiles', 'Tiles')), mode('list', say('guide.list', 'List')))
    top.append(route, modes)
    return top
  }

  #heading(view: GuideBoard): HTMLElement[] {
    const name = document.createElement('p')
    name.className = 'name'
    name.textContent = view.name
    const rule = document.createElement('div')
    rule.className = 'rule'
    if (!view.reading) return [name, rule]
    const reading = document.createElement('p')
    reading.className = 'reading'
    reading.textContent = view.reading
    return [name, reading, rule]
  }

  #list(view: GuideBoard): HTMLElement {
    const list = document.createElement('ul')
    list.className = 'items'
    const shown = view.mode === 'list' ? view.ideas : view.ideas.filter(idea => view.chosen.has(idea.id))
    if (shown.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'empty'
      empty.textContent = say('guide.pick', 'Pick what you want done.')
      list.appendChild(empty)
      return list
    }
    for (const idea of shown) {
      const on = view.chosen.has(idea.id)
      const row = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      button.className = on ? 'item on' : 'item'
      button.setAttribute('aria-pressed', String(on))
      const glyph = document.createElement('span')
      glyph.className = 'glyph'
      glyph.setAttribute('aria-hidden', 'true')
      glyph.textContent = on ? 'check' : drawsAsGlyph(idea.icon) === false ? '' : idea.icon
      const text = document.createElement('span')
      text.textContent = idea.label
      button.append(glyph, text)
      button.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        this.onToggle?.(idea.id)
      })
      row.appendChild(button)
      list.appendChild(row)
    }
    return list
  }

  #foot(view: GuideBoard): HTMLElement {
    const foot = document.createElement('div')
    foot.className = 'foot'
    const count = view.chosen.size
    const accept = document.createElement('button')
    accept.type = 'button'
    accept.className = 'accept'
    accept.disabled = count === 0
    accept.textContent = count > 0 ? say('guide.acceptCount', 'Accept {count}', { count }) : say('guide.accept', 'Accept')
    accept.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      this.onAccept?.()
    })
    foot.append(accept, this.#word(say('guide.close', 'Close'), () => this.onClose?.()))
    return foot
  }

  #word(text: string, act: () => void): HTMLButtonElement {
    const word = document.createElement('button')
    word.type = 'button'
    word.className = 'word'
    word.textContent = text
    word.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      act()
    })
    return word
  }
}
