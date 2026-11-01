// comfy-desk/frame/frame.ts
//
// THE DRAWING IN THE MIDDLE: one picture, in the frame it was asked for. With
// nothing chosen it is the frame of the picture to come, at the size the knobs
// say. A part lights by the editor's vocabulary (`data-lit`), and everything
// drawn here is display: no pixel of it reaches the picture.

import { make, type Box, type FrameHandle, type FramePart, type FrameShown, type Lit, type RecipeRow } from '../parts.js'

const SVG = 'http://www.w3.org/2000/svg'

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG, tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  return node
}

/** The picture's box in the square stage: the whole side along its long edge. */
export const frameBox = (size: number, width: number, height: number): Box => {
  const ratio = width > 0 && height > 0 ? width / height : 1
  const w = Math.round(ratio >= 1 ? size : size * ratio)
  const h = Math.round(ratio >= 1 ? size / ratio : size)
  return { x: Math.round((size - w) / 2), y: Math.round((size - h) / 2), w, h }
}

/** The row whose region holds this point, in fractions of the frame. */
export const rowAt = (rows: readonly RecipeRow[], x: number, y: number): RecipeRow | null =>
  rows.find(row => row.region
    && x >= row.region.x && x <= row.region.x + row.region.w
    && y >= row.region.y && y <= row.region.y + row.region.h) ?? null

export const framePart: FramePart = {
  create(events, say): FrameHandle {
    const el = make('div', 'cd-figure')
    const picture = make('div', 'cd-picture')
    const image = make('img', 'cd-image')
    image.alt = ''
    image.draggable = false
    const blank = make('p', 'cd-blank', say('comfy.blank', 'The picture appears here'))
    const look = make('button', 'te-dg-ib cd-look-btn')
    look.type = 'button'
    look.title = say('comfy.look', 'See it up close')
    look.setAttribute('aria-label', look.title)
    const glyph = make('span', 'mat-sym', 'open_in_full')
    glyph.setAttribute('aria-hidden', 'true')
    look.append(glyph)
    look.addEventListener('click', event => { event.stopPropagation(); events.onLook() })
    const bar = make('div', 'cd-progress')
    const fill = make('div', 'cd-fill')
    bar.append(fill)
    const lit = svg('svg', { class: 'te-dg-lit', 'aria-hidden': 'true', focusable: 'false' })
    const size = make('span', 'cd-size')
    picture.append(image, blank, lit, look, bar)
    el.append(picture, size)

    let rows: readonly RecipeRow[] = []
    let over: string | null = null
    let frame: Box = { x: 0, y: 0, w: 0, h: 0 }
    const groups = new Map<string, SVGGElement>()

    const hit = (event: MouseEvent): RecipeRow | null => {
      const rect = picture.getBoundingClientRect()
      if (!rect.width || !rect.height) return null
      return rowAt(rows, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height)
    }
    picture.addEventListener('pointermove', event => {
      const row = hit(event)?.id ?? null
      if (row === over) return
      if (over) events.onLeave(over)
      over = row
      if (row) events.onEnter(row)
    })
    picture.addEventListener('pointerleave', () => {
      if (over) events.onLeave(over)
      over = null
    })
    picture.addEventListener('click', event => {
      const row = hit(event)
      if (row) events.onPick(row.id)
    })
    picture.addEventListener('dblclick', () => { if (image.src) events.onLook() })

    return {
      el,
      box: (side, shown) => frameBox(side, shown.width, shown.height),
      show(side: number, shown: FrameShown, next: readonly RecipeRow[]): void {
        rows = next
        frame = frameBox(side, shown.width, shown.height)
        el.style.width = el.style.height = `${side}px`
        picture.style.left = `${frame.x}px`
        picture.style.top = `${frame.y}px`
        picture.style.width = `${frame.w}px`
        picture.style.height = `${frame.h}px`
        if (shown.url) { if (image.getAttribute('src') !== shown.url) image.src = shown.url }
        else image.removeAttribute('src')
        image.hidden = look.hidden = !shown.url
        blank.hidden = !!shown.url || shown.busy
        picture.toggleAttribute('data-busy', shown.busy)
        bar.hidden = !shown.busy
        bar.toggleAttribute('data-unknown', shown.progress === null)
        fill.style.width = shown.progress === null ? '' : `${Math.round(Math.min(1, Math.max(0, shown.progress)) * 100)}%`
        size.textContent = `${shown.width} × ${shown.height}`
        size.style.left = `${frame.x}px`
        size.style.width = `${frame.w}px`
        size.style.top = `${frame.y + frame.h}px`

        lit.setAttribute('width', String(frame.w))
        lit.setAttribute('height', String(frame.h))
        lit.setAttribute('viewBox', `0 0 ${frame.w} ${frame.h}`)
        lit.replaceChildren()
        groups.clear()
        for (const row of next) {
          const box = row.region
          if (!box) continue
          const group = svg('g', { class: 'te-dg-litg' })
          const shape = {
            x: String(box.x * frame.w), y: String(box.y * frame.h),
            width: String(box.w * frame.w), height: String(box.h * frame.h),
          }
          group.append(svg('rect', { ...shape, class: 'te-dg-l te-dg-fill' }), svg('rect', { ...shape, class: 'te-dg-l te-dg-edge' }))
          lit.append(group)
          groups.set(row.id, group)
        }
      },
      light(state: ReadonlyMap<string, Lit>): void {
        for (const [id, group] of groups) {
          const level = state.get(id)
          if (level) group.dataset['lit'] = level
          else delete group.dataset['lit']
        }
        const edged = rows.find(row => row.edge && state.has(row.id))
        if (edged) picture.dataset['lit'] = state.get(edged.id)!
        else delete picture.dataset['lit']
      },
    }
  },
}
