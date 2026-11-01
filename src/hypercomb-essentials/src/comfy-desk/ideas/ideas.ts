// comfy-desk/ideas/ideas.ts
//
// THE IDEAS AS TILES. Where the picture stands, a comb: the prompt so far at
// the centre and the directions it could take around it, in the hive's own
// rings. Rollover reads an idea; a click flies it to the centre and opens the
// quick menu round it, the six seats of the hive's flower. Shuffle sits down
// left. Everything here is DOM, because the desk covers the hive.

import { ringCells } from '../../guide/guide-place.js'
import { QUICK_MENU_RING, type QuickMenuDirection } from '../../quickmenu/quick-menu.types.js'
import { make, type Idea, type IdeaAction, type IdeasHandle, type IdeasPart, type IdeasShown, type Say } from '../parts.js'

/** Circumradius of one tile, px at 100% text. */
export const TILE_R = 58
const SIN60 = Math.sqrt(3) / 2

/** Centre of an axial cell, point-top, neighbours touching. */
export const cellCentre = (q: number, r: number, radius = TILE_R): { x: number; y: number } =>
  ({ x: Math.sqrt(3) * radius * (q + r / 2), y: 1.5 * radius * r })

/** The six seats round a tile, in the quick menu's order from due east. */
export const seatCentre = (direction: QuickMenuDirection, radius = TILE_R): { x: number; y: number } => {
  const index = QUICK_MENU_RING.indexOf(direction)
  if (index < 0) return { x: 0, y: 0 }
  const angle = (index * Math.PI) / 3
  const distance = Math.sqrt(3) * radius
  return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance }
}

/** Where each idea sits, ring by ring, and how far the comb reaches. */
export const boardLayout = (count: number, radius = TILE_R): { cells: { x: number; y: number }[]; reach: number } => {
  const cells = ringCells(count).map(cell => cellCentre(cell.q, cell.r, radius))
  const reach = cells.reduce((far, cell) => Math.max(far, Math.hypot(cell.x, cell.y)), 0) + radius
  return { cells, reach }
}

/** The quick menu on an idea. Shuffle is down left, as asked. */
export const SEATS: readonly { readonly direction: QuickMenuDirection; readonly action: IdeaAction; readonly icon: string; readonly key: string; readonly label: string }[] = [
  { direction: 'east', action: 'take', icon: 'arrow_forward', key: 'comfy.idea-take', label: 'go this way' },
  { direction: 'southeast', action: 'describe', icon: 'description', key: 'comfy.idea-describe', label: 'add a description' },
  { direction: 'southwest', action: 'shuffle', icon: 'shuffle', key: 'comfy.idea-shuffle', label: 'new ideas' },
  { direction: 'west', action: 'back', icon: 'close', key: 'comfy.idea-back', label: 'back to the ideas' },
  { direction: 'northwest', action: 'read', icon: 'menu_book', key: 'comfy.idea-read', label: 'read it' },
  { direction: 'northeast', action: 'visual', icon: 'palette', key: 'comfy.idea-visual', label: 'add visual objectives' },
]

const hexPoints = (radius: number): string =>
  Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 2
    return `${(radius + Math.cos(angle) * radius).toFixed(2)},${(radius + Math.sin(angle) * radius).toFixed(2)}`
  }).join(' ')

const hex = (radius: number): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', `0 0 ${radius * 2} ${radius * 2}`)
  svg.setAttribute('aria-hidden', 'true')
  const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
  polygon.setAttribute('points', hexPoints(radius))
  svg.append(polygon)
  return svg
}

class Ideas implements IdeasHandle {
  readonly el = make('div', 'cd-ideas')
  readonly #events: Parameters<IdeasPart['create']>[0]
  readonly #say: Say
  readonly #comb = make('div', 'cd-comb')
  readonly #reading = make('p', 'cd-idea-reading')
  readonly #source = make('p', 'cd-idea-source')
  #shown: IdeasShown | null = null

  constructor(events: Parameters<IdeasPart['create']>[0], say: Say) {
    this.#events = events
    this.#say = say
    this.#reading.setAttribute('aria-live', 'polite')
    this.el.append(this.#comb, this.#reading, this.#source)
    this.#comb.addEventListener('pointerleave', () => this.#events.onHover(null))
  }

  show(shown: IdeasShown): void {
    this.#shown = shown
    const radius = TILE_R
    const open = shown.open ? shown.ideas.find(idea => idea.id === shown.open) ?? null : null
    const tiles: HTMLElement[] = []
    let reach: number
    if (open) {
      tiles.push(this.#tile(open.title, open.text, { x: 0, y: 0 }, radius, 'idea', () => undefined, open.id))
      for (const seat of SEATS) {
        const at = seatCentre(seat.direction, radius)
        tiles.push(this.#tile(this.#say(seat.key, seat.label), '', at, radius, 'seat', () => this.#events.onAct(open.id, seat.action), seat.action, seat.icon))
      }
      reach = Math.sqrt(3) * radius + radius
    } else {
      const layout = boardLayout(shown.ideas.length, radius)
      tiles.push(this.#tile(shown.subject, '', { x: 0, y: 0 }, radius, 'subject', () => undefined, 'subject'))
      shown.ideas.forEach((idea, index) => {
        const at = layout.cells[index] ?? { x: 0, y: 0 }
        tiles.push(this.#tile(idea.title, idea.text, at, radius, 'idea', () => this.#events.onOpen(idea.id), idea.id))
      })
      reach = Math.max(layout.reach, radius * 2)
    }
    this.#comb.style.width = this.#comb.style.height = `${reach * 2}px`
    for (const tile of tiles) {
      tile.style.left = `${reach + Number(tile.dataset['x']) - radius * SIN60}px`
      tile.style.top = `${reach + Number(tile.dataset['y']) - radius}px`
    }
    this.#comb.replaceChildren(...tiles)
    this.#comb.toggleAttribute('data-busy', shown.busy)
    this.#comb.toggleAttribute('data-flower', !!open)
    const read = (shown.reading && shown.ideas.find(idea => idea.id === shown.reading)) || open
    this.#reading.textContent = read ? `${read.title} — ${read.text}` : (shown.busy ? this.#say('comfy.ideas-thinking', 'thinking about where this could go…') : this.#say('comfy.ideas-hint', 'Rest on an idea to read it. Click one to choose how it unfolds.'))
    this.#source.textContent = shown.source === 'words'
      ? this.#say('comfy.ideas-words', 'No agent answered, so these are common picture words.')
      : ''
  }

  dispose(): void { this.el.remove() }

  #tile(title: string, text: string, at: { x: number; y: number }, radius: number, kind: 'subject' | 'idea' | 'seat', act: () => void, id: string, icon = ''): HTMLElement {
    const tile = make('button', 'cd-hex')
    tile.type = 'button'
    tile.dataset['kind'] = kind
    tile.dataset['id'] = id
    tile.dataset['x'] = String(at.x)
    tile.dataset['y'] = String(at.y)
    tile.style.width = `${radius * SIN60 * 2}px`
    tile.style.height = `${radius * 2}px`
    if (text) tile.title = text
    if (kind === 'subject') tile.disabled = true
    tile.append(hex(radius))
    if (icon) {
      const glyph = make('span', 'mat-sym cd-hex-icon', icon)
      glyph.setAttribute('aria-hidden', 'true')
      tile.append(glyph)
    }
    tile.append(make('span', 'cd-hex-name', title))
    if (kind === 'idea') {
      tile.addEventListener('pointerenter', () => this.#events.onHover(id))
      tile.addEventListener('focus', () => this.#events.onHover(id))
    }
    if (kind === 'seat') {
      tile.setAttribute('aria-label', title)
      tile.addEventListener('pointerenter', () => { if (this.#shown?.open) this.#reading.textContent = title })
    }
    tile.addEventListener('click', act)
    return tile
  }
}

export const ideasPart: IdeasPart = {
  create: (events, say) => new Ideas(events, say),
}
