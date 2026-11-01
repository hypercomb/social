// keyboard-desk/keycap/keycap.ts
//
// TRAIT `keycap` — one key on the board: what is printed on it, and what it does
// in the layer showing. Placed by percent of the board, so the board's width is
// the only length here.

import type { BoardPart, Cap, CapPaint, KeycapPart } from '../parts.js'

export const keycapPart: KeycapPart = {
  create(cap: Cap, board: BoardPart): HTMLElement {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'kb-cap'
    el.dataset['cap'] = cap.id
    if (cap.modifier) el.dataset['modifier'] = cap.modifier
    el.style.left = `${(cap.x / board.width) * 100}%`
    el.style.top = `${(cap.y / board.height) * 100}%`
    el.style.width = `${(cap.w / board.width) * 100}%`
    el.style.height = `${(cap.h / board.height) * 100}%`
    const face = document.createElement('span')
    face.className = 'kb-face'
    const label = document.createElement('span')
    label.className = 'kb-label'
    label.textContent = cap.label
    const legend = document.createElement('span')
    legend.className = 'kb-legend'
    face.append(label, legend)
    el.append(face)
    return el
  },

  paint(el: HTMLElement, cap: Cap, state: CapPaint): void {
    const legend = el.querySelector<HTMLElement>('.kb-legend')
    const name = state.legend && !state.legend.shadowed ? state.name : ''
    if (legend && legend.textContent !== name) legend.textContent = name
    const bound = state.legend ? (state.legend.mine ? 'mine' : state.legend.fit) : ''
    el.toggleAttribute('data-selected', state.selected)
    el.toggleAttribute('data-lit', state.lit)
    el.toggleAttribute('data-down', state.down)
    if (bound) el.dataset['bound'] = bound
    else delete el.dataset['bound']
    el.setAttribute('aria-pressed', String(cap.modifier ? state.down : state.selected))
    el.setAttribute('aria-label', name ? `${cap.label}: ${name}` : cap.label)
    el.title = name
  },
}
