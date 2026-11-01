// keyboard-desk/callouts/callouts.ts
//
// TRAIT `callouts` — the labels on the drawing, as on the tile editor: one card
// for each thing the chosen key does, each with a leader down to the key.

import type { CalloutRow, CalloutsHandle, CalloutsPart, Say } from '../parts.js'

const SVG = 'http://www.w3.org/2000/svg'

const keysOf = (keys: readonly (readonly string[])[], say: Say): HTMLElement => {
  const out = document.createElement('span')
  out.className = 'kb-keys'
  keys.forEach((step, index) => {
    if (index) {
      const then = document.createElement('i')
      then.textContent = say('keyboard.then', 'then')
      out.append(then)
    }
    for (const part of step) {
      const key = document.createElement('kbd')
      key.textContent = part
      out.append(key)
    }
  })
  return out
}

export const calloutsPart: CalloutsPart = {
  create(events, say): CalloutsHandle {
    const el = document.createElement('div')
    el.className = 'kb-callouts'
    const leaders = document.createElementNS(SVG, 'svg')
    leaders.setAttribute('class', 'kb-leaders')
    leaders.setAttribute('aria-hidden', 'true')

    const card = (row: CalloutRow): HTMLElement => {
      const item = document.createElement('div')
      item.className = 'kb-callout'
      item.dataset['cmd'] = row.cmd
      item.toggleAttribute('data-mine', row.mine)
      item.addEventListener('pointerenter', () => events.onHover(row.cmd))
      item.addEventListener('pointerleave', () => events.onHover(null))
      const text = document.createElement('span')
      text.className = 'kb-callout-text'
      text.textContent = row.text
      item.append(keysOf(row.keys, say), text)
      if (!row.locked) {
        const off = document.createElement('button')
        off.type = 'button'
        off.className = 'kb-off'
        off.textContent = '×'
        off.title = say('keyboard.unbind', 'take off this key')
        off.setAttribute('aria-label', off.title)
        off.addEventListener('click', () => events.onUnbind(row.cmd))
        item.append(off)
      }
      return item
    }

    return {
      el,
      show(rows, anchor, over): void {
        el.replaceChildren(...rows.map(card))
        leaders.replaceChildren()
        if (leaders.parentElement !== over) over.prepend(leaders)
        if (!anchor) return
        const box = over.getBoundingClientRect()
        const key = anchor.getBoundingClientRect()
        const x = key.left + key.width / 2 - box.left
        const y = key.top + 3 - box.top
        for (const item of el.children) {
          const from = item.getBoundingClientRect()
          const startX = from.left + from.width / 2 - box.left
          const startY = from.bottom - box.top
          const line = document.createElementNS(SVG, 'path')
          line.setAttribute('d', `M${startX} ${startY}V${(startY + y) / 2}H${x}V${y}`)
          line.setAttribute('class', 'kb-leader')
          leaders.append(line)
        }
        if (rows.length) {
          const dot = document.createElementNS(SVG, 'circle')
          dot.setAttribute('cx', String(x))
          dot.setAttribute('cy', String(y))
          dot.setAttribute('r', '3')
          dot.setAttribute('class', 'kb-dot')
          leaders.append(dot)
        }
      },
    }
  },
}
