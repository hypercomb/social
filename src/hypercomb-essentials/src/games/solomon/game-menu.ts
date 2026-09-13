/** The game's own menu: a settings screen over the Solomon's Key star, its
 *  options a locked hive of hexagon tiles. The options are data — the shell
 *  reads them from a standard layer (`SolomonTileSurface.ensureMenu`), one tile
 *  per option — so this file only draws what it is handed and reports picks. */

export type MenuAction = 'continue' | 'items' | 'island' | 'saves' | 'sound' | 'fullscreen' | 'designer' | 'close'

export const MENU_ACTIONS: readonly MenuAction[] = ['continue', 'items', 'island', 'saves', 'sound', 'fullscreen', 'designer', 'close']

/** One option. The tile's name is its label; a tile that names no known
 *  action is still shown, locked and inert. */
export interface MenuOption { readonly name: string; readonly action: MenuAction | null }

export const DEFAULT_MENU: readonly MenuOption[] = [
  { name: 'Continue', action: 'continue' },
  { name: 'Items', action: 'items' },
  { name: 'Island', action: 'island' },
  { name: 'Saves', action: 'saves' },
  { name: 'Sound', action: 'sound' },
  { name: 'Full screen', action: 'fullscreen' },
  { name: 'Designer', action: 'designer' },
  { name: 'Close', action: 'close' },
]

export const isMenuAction = (value: unknown): value is MenuAction =>
  typeof value === 'string' && (MENU_ACTIONS as readonly string[]).includes(value)

/** The rows of a honeycomb holding `count` tiles: neighbouring rows differ by
 *  one, so every row sits half a tile over from the next. */
export function menuRows(count: number): number[] {
  if (count <= 0) return []
  const wide = Math.max(2, Math.ceil(Math.sqrt(count)))
  if (count <= wide) return [count]
  const build = (first: number): number[] => {
    const rows: number[] = []
    let size = first, left = count
    while (left > 0) {
      rows.push(Math.min(size, left))
      left -= size
      size = size === wide ? wide - 1 : wide
    }
    return rows
  }
  const endsFull = (rows: number[], first: number): boolean => {
    const other = first === wide ? wide - 1 : wide
    return rows.at(-1) === (rows.length % 2 === 1 ? first : other)
  }
  const wideFirst = build(wide)
  if (endsFull(wideFirst, wide)) return wideFirst
  const narrowFirst = build(wide - 1)
  return endsFull(narrowFirst, wide - 1) ? narrowFirst : wideFirst
}

export interface GameMenuHooks {
  choose(option: MenuOption): void
  /** A few words under a tile's name — the sound tile's "on", say. */
  detail?(option: MenuOption): string
  /** Come back out of the menu. Without it the menu just closes. */
  back?(): void
}

const SVG = 'http://www.w3.org/2000/svg'

function sigil(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'sol-menu-sigil')
  svg.setAttribute('viewBox', '0 0 200 200')
  svg.setAttribute('aria-hidden', 'true')
  for (const r of [94, 86]) {
    const circle = document.createElementNS(SVG, 'circle')
    circle.setAttribute('cx', '100'); circle.setAttribute('cy', '100'); circle.setAttribute('r', String(r))
    svg.append(circle)
  }
  for (const points of [
    '100,14 174.48,143 25.52,143',
    '100,186 25.52,57 174.48,57',
    '149.65,100 124.83,143 75.17,143 50.35,100 75.17,57 124.83,57',
  ]) {
    const polygon = document.createElementNS(SVG, 'polygon')
    polygon.setAttribute('points', points)
    svg.append(polygon)
  }
  return svg
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag)
  result.className = className
  if (text) result.textContent = text
  return result
}

export class GameMenu {
  readonly element: HTMLDivElement
  readonly #hooks: GameMenuHooks
  readonly #hive: HTMLDivElement
  #options: readonly MenuOption[] = DEFAULT_MENU
  #tiles: HTMLButtonElement[] = []
  #places: { readonly row: number; readonly x: number }[] = []

  constructor(host: HTMLElement, hooks: GameMenuHooks, status: readonly HTMLElement[] = []) {
    this.#hooks = hooks
    this.element = node('div', 'sol-menu')
    this.element.hidden = true
    this.element.setAttribute('role', 'dialog')
    this.element.setAttribute('aria-modal', 'true')
    this.element.setAttribute('aria-label', 'Solomon’s Key menu')
    const panel = node('div', 'sol-menu-panel')
    const header = node('div', 'sol-menu-status')
    header.append(...status)
    this.#hive = node('div', 'sol-menu-hive')
    this.#hive.setAttribute('role', 'group')
    this.#hive.setAttribute('aria-label', 'Menu options')
    this.#hive.dataset['locked'] = 'true'
    panel.append(node('span', 'sol-menu-mark', '✡'), node('h2', 'sol-menu-title', 'Solomon’s Key'), header, this.#hive)
    this.element.append(sigil(), panel)
    // Moves like a hive: a left click on a tile goes in, a left click on the
    // space around the tiles comes back out (the right button is the shell's).
    this.element.addEventListener('click', event => {
      if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea')) return
      if (this.#hooks.back) this.#hooks.back()
      else this.close()
    })
    host.append(this.element)
  }

  get isOpen(): boolean { return !this.element.hidden }

  setOptions(options: readonly MenuOption[]): void {
    this.#options = options
    this.refresh()
  }

  open(): void {
    this.#render()
    this.element.hidden = false
    ;(this.#tiles.find(tile => !tile.disabled) ?? this.#tiles[0])?.focus({ preventScroll: true })
  }

  close(): void { this.element.hidden = true }

  /** Redraws an open menu — an option's detail changed — keeping focus on the same tile. */
  refresh(): void {
    if (!this.isOpen) return
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.['name']
    this.#render()
    this.#tiles.find(tile => tile.dataset['name'] === focused)?.focus({ preventScroll: true })
  }

  /** A key pressed while the menu is open; true when it was the menu's to use. */
  key(key: string): boolean {
    if (!this.isOpen) return false
    if (key === 'escape') { this.close(); return true }
    if (key === 'enter' || key === ' ') {
      const tile = this.#tiles.find(candidate => candidate === document.activeElement)
      if (tile && !tile.disabled) tile.click()
      return true
    }
    if (!['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's'].includes(key)) return false
    this.#move(key)
    return true
  }

  dispose(): void { this.element.remove() }

  #move(key: string): void {
    const count = this.#tiles.length
    if (!count) return
    const index = Math.max(0, this.#tiles.findIndex(tile => tile === document.activeElement))
    const here = this.#places[index]!
    let next = index
    if (key === 'arrowleft' || key === 'a') next = (index - 1 + count) % count
    else if (key === 'arrowright' || key === 'd') next = (index + 1) % count
    else {
      const row = here.row + (key === 'arrowup' || key === 'w' ? -1 : 1)
      let nearest = Infinity
      this.#places.forEach((place, candidate) => {
        const distance = Math.abs(place.x - here.x)
        if (place.row === row && distance < nearest) { nearest = distance; next = candidate }
      })
    }
    this.#tiles[next]?.focus({ preventScroll: true })
  }

  #render(): void {
    this.#hive.replaceChildren()
    this.#tiles = []
    this.#places = []
    let index = 0
    menuRows(this.#options.length).forEach((size, row) => {
      const line = node('div', 'sol-menu-row')
      for (let col = 0; col < size; col++) {
        const option = this.#options[index++]!
        const tile = node('button', 'sol-menu-tile')
        tile.type = 'button'
        tile.dataset['name'] = option.name
        if (option.action) tile.dataset['action'] = option.action
        tile.disabled = option.action === null
        const words = this.#hooks.detail?.(option) ?? ''
        tile.append(node('span', 'sol-menu-tile-name', option.name), node('span', 'sol-menu-tile-detail', words))
        tile.setAttribute('aria-label', words ? `${option.name}, ${words}` : option.name)
        tile.addEventListener('click', () => { if (option.action) this.#hooks.choose(option) })
        line.append(tile)
        this.#tiles.push(tile)
        this.#places.push({ row, x: col - (size - 1) / 2 })
      }
      this.#hive.append(line)
    })
  }
}

export const GAME_MENU_CSS = `
.sol-menu{position:absolute;inset:0;z-index:40;display:flex;overflow:auto;color:#f3e6c4;background:radial-gradient(ellipse at 50% 38%,#24375e 0%,#101a33 55%,#070b18 100%)}
.sol-menu[hidden]{display:none}
.sol-menu::before{content:'';position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(1.5px 1.5px at 12% 18%,#fff9 50%,transparent 52%),radial-gradient(1px 1px at 30% 72%,#fff7 50%,transparent 52%),radial-gradient(1.5px 1.5px at 58% 12%,#fffa 50%,transparent 52%),radial-gradient(1px 1px at 76% 64%,#fff8 50%,transparent 52%),radial-gradient(1.5px 1.5px at 88% 30%,#fff9 50%,transparent 52%),radial-gradient(1px 1px at 44% 88%,#fff6 50%,transparent 52%),radial-gradient(1px 1px at 8% 80%,#fff7 50%,transparent 52%),radial-gradient(1.5px 1.5px at 94% 86%,#fff8 50%,transparent 52%)}
.sol-menu-sigil{position:absolute;left:50%;top:50%;width:min(94vmin,780px);height:min(94vmin,780px);transform:translate(-50%,-50%);opacity:.2;pointer-events:none}
.sol-menu-sigil circle,.sol-menu-sigil polygon{fill:none;stroke:#e9c46a;stroke-width:1.1}
.sol-menu-panel{position:relative;margin:auto;display:flex;flex-direction:column;align-items:center;gap:10px;padding:28px 20px}
.sol-menu-mark{font-size:22px;color:#f2d38a;text-shadow:0 0 14px #f2d38a88}
.sol-menu-title{margin:0;font:600 clamp(26px,4.2vw,40px)/1.1 Georgia,'Times New Roman',serif;letter-spacing:.06em;color:#f2d38a;text-shadow:0 2px 14px #000a}
.sol-menu-status{display:flex;flex-direction:column;align-items:center;gap:5px;min-height:18px;font-size:12px;color:#c9d3e8}
.sol-menu-hive{--hex-w:clamp(84px,min(12vw,19vh),136px);--hex-h:calc(var(--hex-w) * 1.1547);display:flex;flex-direction:column;align-items:center;margin-top:14px}
.sol-menu-row{display:flex;gap:6px}
.sol-menu-row+.sol-menu-row{margin-top:calc(var(--hex-h) * -.25 + 5px)}
.sol-menu-tile{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:var(--hex-w);height:var(--hex-h);border:0;padding:0;color:#f6ead0;cursor:pointer;background:linear-gradient(160deg,#f0cf7a,#8f6f27);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);transition:transform .12s ease,filter .12s ease}
.sol-menu-tile::before{content:'';position:absolute;inset:3px;clip-path:inherit;background:radial-gradient(ellipse at 50% 30%,#2e4270,#162241 70%);transition:background .12s ease}
.sol-menu-tile>span{position:relative}
.sol-menu-tile-name{font:600 14px/1.2 Georgia,'Times New Roman',serif;letter-spacing:.02em}
.sol-menu-tile-detail{font-size:10.5px;color:#d6c38e}
.sol-menu-tile-detail:empty{display:none}
.sol-menu-tile:hover,.sol-menu-tile:focus-visible{transform:scale(1.06);filter:brightness(1.15);outline:none}
.sol-menu-tile:hover::before,.sol-menu-tile:focus-visible::before{background:radial-gradient(ellipse at 50% 30%,#44619e,#1d2c52 70%)}
.sol-menu-tile:disabled{cursor:default;transform:none;filter:saturate(.15) brightness(.65)}
@media(prefers-reduced-motion:reduce){.sol-menu-tile,.sol-menu-tile::before{transition:none}}
`
