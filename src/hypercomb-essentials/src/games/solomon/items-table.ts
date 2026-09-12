// The ONE Items panel — a Journal replacement listing pieces, items, scraps
// of knowledge and abilities, places found, and tasks/contributions, opened
// by `I` (2)'s A6. Every row comes from the ONE `attainments.ts` registry —
// `itemsBoards()` for anything with a physical board and slots (pieces,
// items, knowledge, places, tasks, contributions), `attainmentsOf()` for the
// handful of kinds that have no board at all (abilities; and, new here,
// weapons and spells — M2/M4). There is no second derivation anywhere in
// this file: a row's art, title, words and use-verb always come from the
// same `AttainmentDef` every other surface reads.

import type { StoryFacts } from './story-when.js'
import {
  ATTAINMENTS, attainmentById, attainmentsOf, heldAttainments, itemsBoards, itemsProgress, useVerb,
  type AttainmentArt, type AttainmentDef, type ItemsBoardView, type UseContext,
} from './attainments.js'
import { drawItem, drawPiece, drawSkill, type TreasureKind } from './island-treasure.js'
import { drawPlace } from './island-places.js'

export interface ItemsTableHooks {
  /** Read fresh on every open/refresh — never cached across calls, since Rule-2
   *  restore hydration can finish after this panel is already mounted (M15). */
  facts(): StoryFacts
  context(): UseContext
  /** One row's use verb was clicked. The shell resolves it (`useAttainment`)
   *  and dispatches the result — this panel never decides what "Equip"
   *  actually does. */
  use(id: string): void
  closed(): void
}

export type ItemsTab = 'pieces' | 'items' | 'knowledge' | 'places' | 'tasks'
const TABS: readonly { readonly id: ItemsTab; readonly label: string; readonly boardKinds: readonly ItemsBoardView['kind'][] }[] = [
  { id: 'pieces', label: 'Pieces', boardKinds: ['relics'] },
  { id: 'items', label: 'Items', boardKinds: ['items'] },
  { id: 'knowledge', label: 'Knowledge', boardKinds: ['knowledge'] },
  { id: 'places', label: 'Places', boardKinds: ['places'] },
  { id: 'tasks', label: 'Tasks', boardKinds: ['tasks', 'contributions'] },
]

const TREASURE_KINDS = new Set<TreasureKind>(['note', 'gem', 'coins', 'feather', 'key', 'great-key', 'map', 'lodestone', 'lantern'])
const LOOK_GLYPHS: Readonly<Record<string, string>> = { socket: '○', task: '✓', plot: '▶', memory: '☾' }

const el = (tag: string, className = '', text = ''): HTMLElement => {
  const result = document.createElement(tag)
  result.className = className
  result.textContent = text
  return result
}

const ICON_SIZE = 28

function iconContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  let ctx: CanvasRenderingContext2D | null = null
  try { ctx = canvas.getContext('2d') } catch { ctx = null }
  if (!ctx) return null
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
  canvas.width = ICON_SIZE * dpr
  canvas.height = ICON_SIZE * dpr
  return ctx
}

/** A small ink medallion carrying one glyph — every look this file draws
 *  that has no dedicated art (an abstract slot look, or a hidden '?'). */
function drawGlyphIcon(ctx: CanvasRenderingContext2D, glyph: string): void {
  ctx.beginPath()
  ctx.arc(0, 0, 12, 0, Math.PI * 2)
  ctx.fillStyle = '#2a2144'
  ctx.fill()
  ctx.strokeStyle = '#1c1230'
  ctx.lineWidth = 1.2
  ctx.stroke()
  ctx.fillStyle = '#f0cc62'
  ctx.font = '700 14px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(glyph, 0, 1)
}

function drawPlaceholderIcon(canvas: HTMLCanvasElement): void {
  const ctx = iconContext(canvas)
  if (!ctx) return
  ctx.translate(ICON_SIZE / 2, ICON_SIZE / 2)
  drawGlyphIcon(ctx, '?')
}

/** A row's real art, straight off its `AttainmentDef` — the same union every
 *  other surface (the gain screen, the reveal) already paints. */
function drawDefIcon(canvas: HTMLCanvasElement, art: AttainmentArt): void {
  const ctx = iconContext(canvas)
  if (!ctx) return
  if (art.kind === 'place') { drawPlace(ctx, art.sprite, null); return }
  ctx.translate(ICON_SIZE / 2, ICON_SIZE / 2 + 3)
  if (art.kind === 'item') drawItem(ctx, art.item)
  else if (art.kind === 'piece') drawPiece(ctx, art.piece, art.point ?? 0)
  else if (art.kind === 'skill') drawSkill(ctx, art.skill, 0)
  else drawGlyphIcon(ctx, art.glyph)
}

/** A board slot's `look` — used for a not-yet-filled row (shown dimmer) and
 *  for the fully hidden '?' placeholder. */
function drawLookIcon(canvas: HTMLCanvasElement, look: string, dim: boolean): void {
  const ctx = iconContext(canvas)
  if (!ctx) return
  ctx.save()
  if (dim) ctx.globalAlpha = 0.5
  if (look === 'place') { drawPlace(ctx, 'sign', null); ctx.restore(); return }
  ctx.translate(ICON_SIZE / 2, ICON_SIZE / 2 + 3)
  if (TREASURE_KINDS.has(look as TreasureKind)) drawItem(ctx, look as TreasureKind)
  else if (look === 'triangle' || look === 'hexagon' || look === 'star') drawPiece(ctx, look)
  else drawGlyphIcon(ctx, LOOK_GLYPHS[look] ?? '?')
  ctx.restore()
}

function useButton(def: AttainmentDef, context: UseContext, onUse: (id: string) => void): HTMLElement | null {
  const verb = useVerb(def, context)
  if (!verb) return null
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'sol-items-use'
  button.textContent = verb
  button.addEventListener('click', () => onUse(def.id))
  return button
}

/** One row for a held attainment with no board of its own — abilities, and
 *  (M4) weapons/spells when they are NOT in the Weapons & Spells group's own
 *  renderer (kept separate only because that group also renders a fixed
 *  silhouette copy per kind for the ones not yet held; see `weaponsSpellsRow`). */
function plainRow(def: AttainmentDef, context: UseContext, onUse: (id: string) => void): HTMLElement {
  const row = el('li', 'sol-items-row')
  row.dataset.id = def.id
  const icon = document.createElement('canvas')
  icon.className = 'sol-items-art'
  row.append(icon)
  drawDefIcon(icon, def.art)
  row.append(el('strong', '', def.title), el('span', '', def.words))
  const button = useButton(def, context, onUse)
  if (button) row.append(button)
  return row
}

function weaponsSpellsRow(def: AttainmentDef, held: boolean, context: UseContext, onUse: (id: string) => void): HTMLElement {
  const row = el('li', 'sol-items-row')
  row.dataset.id = def.id
  const icon = document.createElement('canvas')
  icon.className = 'sol-items-art'
  row.append(icon)
  if (!held) {
    row.classList.add('is-silhouette')
    drawPlaceholderIcon(icon)
    row.append(el('strong', '', def.kind === 'weapon' ? 'A weapon — not yet found' : 'A spell — not yet found'))
    return row
  }
  drawDefIcon(icon, def.art)
  row.append(el('strong', '', def.title), el('span', '', def.words))
  const button = useButton(def, context, onUse)
  if (button) row.append(button)
  else row.append(el('span', 'sol-items-equipped', 'Equipped'))
  return row
}

function slotRow(slot: ItemsBoardView['slots'][number]): HTMLElement {
  const row = el('li', 'sol-items-row')
  const icon = document.createElement('canvas')
  icon.className = 'sol-items-art'
  row.append(icon)
  if (slot.filled && slot.attainment) {
    row.dataset.id = slot.attainment
    const def = attainmentById(slot.attainment)
    if (def) {
      drawDefIcon(icon, def.art)
      row.append(el('strong', '', def.title), el('span', '', def.words))
      return row
    }
  }
  row.dataset.id = slot.id
  row.classList.add('is-silhouette')
  if (slot.shown) {
    drawLookIcon(icon, slot.look, true)
    row.append(el('strong', '', slot.name), el('span', '', slot.hint ?? ''))
  } else {
    drawPlaceholderIcon(icon)
    row.append(el('strong', '', '?'))
  }
  return row
}

/** Every board of one kind, each its own `h3` + row list — the shared
 *  renderer behind four of the five tabs' board content (Pieces/Items minus
 *  its Weapons & Spells group/Places/Tasks). */
function renderBoards(container: HTMLElement, boards: readonly ItemsBoardView[], kinds: readonly ItemsBoardView['kind'][]): void {
  for (const board of boards) {
    if (!kinds.includes(board.kind)) continue
    container.append(el('h3', '', board.title))
    const list = el('ul', 'sol-items-group')
    for (const slot of board.slots) list.append(slotRow(slot))
    container.append(list)
  }
}

/** Every kind of reveal/progress row, in one panel, tabbed by `AttainmentKind`
 *  family. Weapons/spells (M2) surface only here, inside the Items tab's own
 *  "Weapons & Spells" group (M4) — never a second panel, never a second `I`. */
export class ItemsTable {
  readonly #hooks: ItemsTableHooks
  readonly #backdrop: HTMLElement
  readonly #panel: HTMLElement
  readonly #tabs = new Map<ItemsTab, HTMLButtonElement>()
  readonly #progress: HTMLElement
  readonly #sections = new Map<ItemsTab, HTMLElement>()
  readonly #close: HTMLButtonElement
  #tab: ItemsTab = 'pieces'

  constructor(host: HTMLElement, hooks: ItemsTableHooks) {
    this.#hooks = hooks
    this.#backdrop = el('div', 'sol-items')
    this.#backdrop.hidden = true
    this.#panel = el('section', 'sol-items-panel')
    this.#panel.setAttribute('role', 'dialog')
    this.#panel.setAttribute('aria-modal', 'true')
    this.#panel.setAttribute('aria-label', 'Items')
    this.#panel.tabIndex = -1
    const header = el('div', 'sol-items-header')
    header.append(el('h2', '', 'Items'))
    this.#progress = el('span', 'sol-items-progress')
    header.append(this.#progress)
    this.#close = document.createElement('button')
    this.#close.type = 'button'
    this.#close.className = 'sol-items-close'
    this.#close.title = 'Close (I)'
    this.#close.setAttribute('aria-label', 'Close items')
    this.#close.textContent = '×'
    this.#close.addEventListener('click', () => this.close())
    header.append(this.#close)
    const tabBar = el('div', 'sol-items-tabs')
    for (const spec of TABS) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'sol-items-tab'
      button.textContent = spec.label
      button.dataset.tab = spec.id
      button.addEventListener('click', () => this.show(spec.id))
      tabBar.append(button)
      this.#tabs.set(spec.id, button)
    }
    const body = el('div', 'sol-items-body')
    for (const spec of TABS) {
      const section = el('div', 'sol-items-section')
      section.dataset.tab = spec.id
      section.hidden = true
      body.append(section)
      this.#sections.set(spec.id, section)
    }
    this.#panel.append(header, tabBar, body)
    this.#panel.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return
      const focusable = [...this.#tabs.values(), this.#close]
      const index = focusable.indexOf(document.activeElement as HTMLButtonElement)
      event.preventDefault()
      const next = event.shiftKey
        ? focusable[(index <= 0 ? focusable.length : index) - 1]!
        : focusable[(index + 1) % focusable.length]!
      next.focus()
    })
    this.#backdrop.append(this.#panel)
    host.append(this.#backdrop)
  }

  get isOpen(): boolean { return !this.#backdrop.hidden }
  get tab(): ItemsTab { return this.#tab }

  show(tab?: ItemsTab): void {
    if (tab) this.#tab = tab
    this.#backdrop.hidden = false
    this.#render()
    this.#close.focus({ preventScroll: true })
  }

  /** Re-renders the open panel in place — after an Equip, or once Rule-2
   *  restore hydration finishes and facts change under it (M15). A no-op
   *  while closed. */
  refresh(): void { if (this.isOpen) this.#render() }

  close(): void {
    if (!this.isOpen) return
    this.#backdrop.hidden = true
    this.#hooks.closed()
  }

  dispose(): void { this.#backdrop.remove() }

  #render(): void {
    const facts = this.#hooks.facts()
    const context = this.#hooks.context()
    const boards = itemsBoards(facts)
    const progress = itemsProgress(boards)
    this.#progress.textContent = `${progress.filled}/${progress.shown} found`
    for (const [id, button] of this.#tabs) button.classList.toggle('is-active', id === this.#tab)
    for (const [id, section] of this.#sections) {
      const active = id === this.#tab
      section.hidden = !active
      if (!active) continue
      section.replaceChildren()
      const onUse = (attainmentId: string): void => this.#hooks.use(attainmentId)
      if (id === 'items') this.#renderItemsTab(section, facts, boards, context, onUse)
      else if (id === 'knowledge') this.#renderKnowledgeTab(section, facts, boards, context, onUse)
      else renderBoards(section, boards, TABS.find(spec => spec.id === id)!.boardKinds)
    }
  }

  #renderItemsTab(section: HTMLElement, facts: StoryFacts, boards: readonly ItemsBoardView[], context: UseContext, onUse: (id: string) => void): void {
    // `attainmentsOf` (like `heldAttainments`) only ever returns HELD rows —
    // right for every other tab, wrong here, since a weapon/spell not yet
    // held still needs its silhouette row (M4). The registry order comes
    // straight off the shared `ATTAINMENTS` table; held state is still the
    // same `heldAttainments` derivation everything else uses — never a
    // second mechanism, just read at the point that needs both halves.
    const held = new Set(heldAttainments(facts).map(def => def.id))
    section.append(el('h3', '', 'Weapons & Spells'))
    const group = el('ul', 'sol-items-group')
    for (const def of ATTAINMENTS) {
      if (def.kind !== 'weapon' && def.kind !== 'spell') continue
      group.append(weaponsSpellsRow(def, held.has(def.id), context, onUse))
    }
    section.append(group)
    renderBoards(section, boards, ['items'])
  }

  #renderKnowledgeTab(section: HTMLElement, facts: StoryFacts, boards: readonly ItemsBoardView[], context: UseContext, onUse: (id: string) => void): void {
    renderBoards(section, boards, ['knowledge'])
    // Abilities have no board of their own (§3.8.1) and, unlike weapons and
    // spells, show no silhouette while unearned — `attainmentsOf` (held-only)
    // is exactly right here.
    const abilities = attainmentsOf('ability', facts)
    if (!abilities.length) return
    section.append(el('h3', '', 'Abilities'))
    const group = el('ul', 'sol-items-group')
    for (const def of abilities) group.append(plainRow(def, context, onUse))
    section.append(group)
  }
}

export const ITEMS_CSS = `
.sol-items{position:absolute;inset:0;z-index:20;display:grid;place-items:center;background:#071624b8;padding:20px}
.sol-items *{box-sizing:border-box}
.sol-items-panel{position:relative;width:min(100%,720px);max-height:100%;overflow:auto;background:#f6f0df;color:#29394a;border:1px solid #fceac5;border-radius:16px;padding:20px 26px 26px;box-shadow:0 25px 80px #05142588}
.sol-items-header{display:flex;align-items:baseline;gap:10px;margin-bottom:10px}
.sol-items-header h2{margin:0;font-size:20px}
.sol-items-progress{margin-left:auto;font-size:12px;color:#8a6a2e;font-variant-numeric:tabular-nums}
.sol-items-close{width:26px;height:26px;line-height:1;border:0;border-radius:8px;background:#e5dcc0;color:#29394a;font-size:16px;cursor:pointer}
.sol-items-close:hover{background:#d8cba6}
.sol-items-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;border-bottom:1px solid #e6d9b0;padding-bottom:10px}
.sol-items-tab{border:1px solid #cbb984;border-radius:7px;background:#fbf6e8;color:#29394a;padding:6px 12px;font-size:12px;cursor:pointer}
.sol-items-tab.is-active{background:#264b60;border-color:#264b60;color:#fff}
.sol-items-section h3{margin:18px 0 7px;color:#706048;font-size:14px}
.sol-items-section h3:first-child{margin-top:0}
.sol-items-group{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.sol-items-row{display:flex;align-items:center;gap:10px;padding:6px 4px;border-radius:8px}
.sol-items-row strong{display:block;font-size:13px}
.sol-items-row span{display:block;font-size:11.5px;color:#5a6b7c}
.sol-items-row.is-silhouette{opacity:.65}
.sol-items-row.is-silhouette strong,.sol-items-row.is-silhouette span{color:#8a94a0}
.sol-items-art{width:${ICON_SIZE}px;height:${ICON_SIZE}px;flex:none}
.sol-items-use{margin-left:auto;flex:none;border:1px solid #879d9755;border-radius:7px;padding:6px 10px;background:#36564e;color:#fff;font-size:11px;cursor:pointer}
.sol-items-equipped{margin-left:auto;flex:none;font-size:11px;color:#706048}
@media(max-width:640px){.sol-items{padding:8px}.sol-items-panel{padding:14px 16px 18px}}
`
