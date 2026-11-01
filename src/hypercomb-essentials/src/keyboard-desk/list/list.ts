// keyboard-desk/list/list.ts
//
// TRAIT `list` — the list down the left, read like the hive's tile list: a square
// face, a name, and a walk. The top level is the groups; a group opens to its
// behaviours; the find box searches all of them.

import type { ListHandle, ListPart, ShownBehaviour } from '../parts.js'

const row = (name: string, trailing: string): HTMLButtonElement => {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'kb-row'
  const face = document.createElement('span')
  face.className = 'kb-row-face'
  face.textContent = (name[0] ?? '').toUpperCase()
  const label = document.createElement('span')
  label.className = 'kb-row-name'
  label.textContent = name
  const end = document.createElement('span')
  end.className = 'kb-row-end'
  end.textContent = trailing
  btn.append(face, label, end)
  return btn
}

export const listPart: ListPart = {
  create(events, say): ListHandle {
    const el = document.createElement('nav')
    el.className = 'kb-list'
    el.setAttribute('aria-label', say('keyboard.behaviours', 'behaviours'))

    const head = document.createElement('div')
    head.className = 'kb-list-head'
    const back = document.createElement('button')
    back.type = 'button'
    back.className = 'kb-back'
    back.textContent = '‹'
    back.setAttribute('aria-label', say('keyboard.back', 'back to the groups'))
    const title = document.createElement('span')
    title.className = 'kb-list-title'
    head.append(back, title)

    const find = document.createElement('input')
    find.className = 'kb-find'
    find.type = 'search'
    find.placeholder = say('keyboard.find', 'find a behaviour')
    find.setAttribute('aria-label', find.placeholder)

    const rows = document.createElement('div')
    rows.className = 'kb-rows'
    rows.setAttribute('data-consumes-wheel', '')
    el.append(head, find, rows)

    let group: string | null = null
    let shown: readonly ShownBehaviour[] = []

    const paint = (): void => {
      const query = find.value.trim().toLowerCase()
      back.hidden = group === null
      title.textContent = group ?? say('keyboard.behaviours', 'behaviours')

      if (group === null && !query) {
        const counts = new Map<string, number>()
        for (const { behaviour } of shown) counts.set(behaviour.group, (counts.get(behaviour.group) ?? 0) + 1)
        rows.replaceChildren(...[...counts].map(([name, count]) => {
          const btn = row(name, String(count))
          btn.dataset['group'] = name
          btn.addEventListener('click', () => { group = name; paint() })
          return btn
        }))
        return
      }

      const here = shown.filter(({ behaviour }) => query
        ? behaviour.name.toLowerCase().includes(query) || behaviour.description.toLowerCase().includes(query)
        : behaviour.group === group)
      rows.replaceChildren(...here.map(item => {
        const btn = row(item.behaviour.name, item.keys.join(' '))
        btn.dataset['behaviour'] = item.behaviour.id
        btn.title = item.behaviour.description
        btn.disabled = item.behaviour.locked
        btn.toggleAttribute('data-chosen', item.chosen)
        btn.addEventListener('click', () => events.onPick(item.behaviour))
        btn.addEventListener('pointerenter', () => events.onHover(item.behaviour))
        btn.addEventListener('pointerleave', () => events.onHover(null))
        return btn
      }))
    }

    back.addEventListener('click', () => { group = null; paint() })
    find.addEventListener('input', paint)

    return {
      el,
      show(tiles): void {
        shown = tiles
        paint()
      },
    }
  },
}
