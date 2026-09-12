// The ONE reveal dialog for everything attained — a relic piece, a chest's
// items, a place found, a scrap of knowledge, an ability, or (new, M2) one of
// the labyrinth's stance/weapons/spells. Never a modal that swallows the
// screen: a small corner card, matching the standing rule that a reading is
// "recorded" — shown beside the game, not instead of it. E, Escape, and a
// click on the × all close it; there is never a second dismiss control
// (M3). The shell decides WHEN to close it (its own non-fallthrough E/Escape
// chain); this class only ever closes because `close()` was called, directly
// or by a click on its own × button.

import { playGainReveal, drawItem, type GainArt, type TreasureKind } from './island-treasure.js'

export interface GainItem { readonly id: string; readonly name: string; readonly kind: TreasureKind }

export interface GainRequest {
  readonly id: string
  readonly eyebrow: string
  readonly title: string
  readonly words: string
  readonly art: GainArt
  readonly items?: readonly GainItem[]
  readonly fresh: boolean
  readonly slot?: { readonly board: string; readonly slot: string }
}

export interface GainHooks {
  seen(id: string): boolean
  markSeen(ids: readonly string[]): void
  board(board: string): { readonly title: string; readonly slots: readonly { readonly id: string; readonly filled: boolean }[] } | null
  closed(): void
}

const el = (tag: string, className = '', text = ''): HTMLElement => {
  const result = document.createElement(tag)
  result.className = className
  result.textContent = text
  return result
}

const ICON_SIZE = 30

/** A small `drawItem`-scale icon, centred on a canvas of `ICON_SIZE` px. */
function drawIcon(canvas: HTMLCanvasElement, kind: TreasureKind): void {
  let ctx: CanvasRenderingContext2D | null = null
  try { ctx = canvas.getContext('2d') } catch { ctx = null }
  if (!ctx) return
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
  canvas.width = ICON_SIZE * dpr
  canvas.height = ICON_SIZE * dpr
  ctx.setTransform(dpr, 0, 0, dpr, ICON_SIZE / 2 * dpr, ICON_SIZE / 2 * dpr + 3)
  drawItem(ctx, kind)
}

/** Every kind of reveal — a relic piece, a chest's items, a place, a scrap of
 *  knowledge, an ability, or a labyrinth skill (M2) — through the same one
 *  corner card. No case here special-cases `'skill'`: `island-treasure.ts`'s
 *  `playGainReveal` already dispatches the whole `GainArt` union, including
 *  the new case, so this class never imports `drawSkill` directly. */
export class GainScreen {
  readonly #hooks: GainHooks
  readonly #card: HTMLElement
  readonly #canvas = document.createElement('canvas')
  readonly #eyebrow: HTMLElement
  readonly #title: HTMLElement
  readonly #words: HTMLElement
  readonly #items: HTMLElement
  readonly #board: HTMLElement
  readonly #close: HTMLButtonElement
  readonly #queue: GainRequest[] = []
  #current: GainRequest | null = null
  #stopReveal: (() => void) | null = null

  constructor(host: HTMLElement, hooks: GainHooks) {
    this.#hooks = hooks
    this.#card = el('section', 'sol-gain')
    this.#card.setAttribute('role', 'dialog')
    this.#card.setAttribute('aria-modal', 'true')
    this.#card.tabIndex = -1
    this.#card.hidden = true
    this.#canvas.className = 'sol-gain-canvas'
    this.#canvas.setAttribute('aria-hidden', 'true')
    const stage = el('div', 'sol-gain-stage')
    stage.append(this.#canvas)
    this.#close = document.createElement('button')
    this.#close.type = 'button'
    this.#close.className = 'sol-gain-close'
    this.#close.setAttribute('aria-label', 'Close')
    this.#close.textContent = '×'
    this.#close.addEventListener('click', () => this.close())
    this.#eyebrow = el('p', 'sol-gain-eyebrow')
    this.#title = el('h2', 'sol-gain-title')
    this.#words = el('p', 'sol-gain-words')
    this.#items = el('ul', 'sol-gain-items')
    this.#board = el('div', 'sol-gain-board')
    this.#card.append(this.#close, stage, this.#eyebrow, this.#title, this.#words, this.#items, this.#board)
    this.#card.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return
      event.preventDefault()
      this.#close.focus()
    })
    host.append(this.#card)
  }

  get isOpen(): boolean { return this.#current !== null }
  get pending(): number { return this.#queue.length }

  show(request: GainRequest): void {
    if (this.#current?.id === request.id) return
    if (this.#hooks.seen(request.id)) return
    if (this.#current) {
      if (!this.#queue.some(queued => queued.id === request.id)) this.#queue.push(request)
      return
    }
    this.#present(request)
  }

  close(): void {
    if (!this.#current) return
    this.#stopReveal?.()
    this.#stopReveal = null
    this.#card.hidden = true
    this.#current = null
    this.#hooks.closed()
    const next = this.#queue.shift()
    if (next) this.#present(next)
  }

  dispose(): void {
    this.#stopReveal?.()
    this.#queue.length = 0
    this.#current = null
    this.#card.remove()
  }

  #present(request: GainRequest): void {
    this.#current = request
    // markSeen fires before the scene plays, so an interrupted reveal never
    // replays on the next load (M2/(2) A5.4's markSeen-before-scene rule).
    this.#hooks.markSeen([request.id])
    this.#card.setAttribute('aria-label', request.title)
    this.#eyebrow.textContent = request.eyebrow
    this.#title.textContent = request.title
    this.#words.textContent = request.words
    this.#items.replaceChildren()
    this.#items.hidden = !request.items?.length
    for (const item of request.items ?? []) {
      const row = el('li', 'sol-gain-item')
      const icon = document.createElement('canvas')
      icon.className = 'sol-gain-item-icon'
      row.append(icon, el('span', '', item.name))
      this.#items.append(row)
      drawIcon(icon, item.kind)
    }
    this.#renderBoard(request)
    this.#card.hidden = false
    this.#close.focus({ preventScroll: true })
    const animate = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let ctx: CanvasRenderingContext2D | null = null
    try { ctx = this.#canvas.getContext('2d') } catch { ctx = null }
    if (ctx) {
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
      this.#canvas.width = 240 * dpr
      this.#canvas.height = 130 * dpr
      this.#stopReveal = playGainReveal(ctx, request.art, animate)
    } else {
      this.#stopReveal = null
    }
  }

  #renderBoard(request: GainRequest): void {
    const slot = request.slot
    const board = slot ? this.#hooks.board(slot.board) : null
    this.#board.replaceChildren()
    this.#board.hidden = !board
    if (!board || !slot) return
    const filled = board.slots.filter(s => s.filled).length
    this.#board.append(el('p', 'sol-gain-board-title', `${board.title} · ${filled}/${board.slots.length}`))
    const dots = el('div', 'sol-gain-dots')
    for (const s of board.slots) {
      const dot = el('span', 'sol-gain-dot')
      if (s.filled) dot.classList.add('is-filled')
      if (s.id === slot.slot) dot.classList.add('is-fresh')
      dots.append(dot)
    }
    this.#board.append(dots)
  }
}

export const GAIN_CSS = `
.sol-gain{position:fixed;right:18px;bottom:18px;z-index:45;width:min(320px,calc(100% - 36px));background:#f6f0df;color:#29394a;border:1px solid #fceac5;border-radius:14px;padding:16px 18px;box-shadow:0 20px 60px #051425a0;animation:solGainIn .22s ease}
.sol-gain *{box-sizing:border-box}
.sol-gain-close{position:absolute;top:8px;right:8px;width:26px;height:26px;line-height:1;border:0;border-radius:8px;background:#e5dcc0;color:#29394a;font-size:16px;cursor:pointer}
.sol-gain-close:hover{background:#d8cba6}
.sol-gain-close:focus-visible{outline:2px solid #b98a2e;outline-offset:2px}
.sol-gain-stage{width:100%;aspect-ratio:240/130;margin-bottom:6px}
.sol-gain-canvas{width:100%;height:100%;display:block}
.sol-gain-eyebrow{margin:0;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#8a6a2e;font-weight:700}
.sol-gain-title{margin:2px 0 4px;font-size:17px}
.sol-gain-words{margin:0;font-size:12.5px;line-height:1.55;color:#4a5568}
.sol-gain-items{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:5px}
.sol-gain-item{display:flex;align-items:center;gap:8px;font-size:12px}
.sol-gain-item-icon{width:24px;height:24px;flex:none}
.sol-gain-board{margin-top:10px;border-top:1px solid #e6d9b0;padding-top:8px}
.sol-gain-board-title{margin:0 0 5px;font-size:11px;color:#706048}
.sol-gain-dots{display:flex;flex-wrap:wrap;gap:5px}
.sol-gain-dot{width:9px;height:9px;border-radius:50%;background:#e5dcc0;border:1px solid #cbb984}
.sol-gain-dot.is-filled{background:#c7aa63;border-color:#a4813a}
.sol-gain-dot.is-fresh{animation:solGainDotIn .4s ease}
@keyframes solGainDotIn{from{transform:scale(0)}70%{transform:scale(1.35)}to{transform:scale(1)}}
@keyframes solGainIn{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
@media(prefers-reduced-motion:reduce){.sol-gain{animation:none}.sol-gain-dot.is-fresh{animation:none}}
@media(max-width:480px){.sol-gain{right:10px;bottom:10px;left:10px;width:auto}}
`
