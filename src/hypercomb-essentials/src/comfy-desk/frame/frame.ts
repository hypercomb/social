// comfy-desk/frame/frame.ts
//
// THE DRAWING IN THE MIDDLE: one picture, in the frame it was asked for. The
// frame takes the picture's own shape, and with nothing chosen it is the frame
// of the picture to come, at the size the knobs say, with the words in hand
// read inside it. A part lights by the editor's vocabulary (`data-lit`), the
// width is marked under it the way the editor marks a capture, and everything
// drawn here is display: no pixel of it reaches the picture.

import { make, type Box, type FrameHandle, type FramePart, type FrameShown, type Lit, type RecipeRow } from '../parts.js'

const SVG = 'http://www.w3.org/2000/svg'

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG, tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  return node
}

/** The largest box of the picture's shape that fits the room. */
export const fitBox = (room: { readonly w: number; readonly h: number }, width: number, height: number): { w: number; h: number } => {
  const ratio = width > 0 && height > 0 ? width / height : 1
  let w = Math.max(1, Math.round(room.w))
  let h = Math.max(1, Math.round(w / ratio))
  if (h > room.h) {
    h = Math.max(1, Math.round(room.h))
    w = Math.max(1, Math.round(h * ratio))
  }
  return { w, h }
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
    const words = make('p', 'cd-words-preview')
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
    // The editor's own dimension mark: a bracket under the picture with its size.
    const dim = make('div', 'te-dg-dim cd-dim')
    dim.setAttribute('aria-hidden', 'true')
    const size = make('span')
    dim.append(size)
    picture.append(image, words, lit, look, bar)
    el.append(picture, dim)

    let rows: readonly RecipeRow[] = []
    let over: string | null = null
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
      show(box: Box, shown: FrameShown, next: readonly RecipeRow[]): void {
        rows = next
        el.style.width = `${box.w}px`
        el.style.height = `${box.h}px`
        if (shown.url) { if (image.getAttribute('src') !== shown.url) image.src = shown.url }
        else image.removeAttribute('src')
        image.hidden = look.hidden = !shown.url
        picture.toggleAttribute('data-empty', !shown.url)
        words.hidden = !!shown.url
        words.textContent = shown.words.trim() || shown.placeholder
        words.toggleAttribute('data-ghost', !shown.words.trim())
        picture.toggleAttribute('data-busy', shown.busy)
        bar.hidden = !shown.busy
        bar.toggleAttribute('data-unknown', shown.progress === null)
        fill.style.width = shown.progress === null ? '' : `${Math.round(Math.min(1, Math.max(0, shown.progress)) * 100)}%`
        size.textContent = `${shown.width} × ${shown.height}`

        lit.setAttribute('width', String(box.w))
        lit.setAttribute('height', String(box.h))
        lit.setAttribute('viewBox', `0 0 ${box.w} ${box.h}`)
        lit.replaceChildren()
        groups.clear()
        for (const row of next) {
          const region = row.region
          if (!region) continue
          const group = svg('g', { class: 'te-dg-litg' })
          const shape = {
            x: String(region.x * box.w), y: String(region.y * box.h),
            width: String(region.w * box.w), height: String(region.h * box.h),
          }
          // A faint wash: a region of a picture is a large shape, and the full
          // wash the editor puts on a rim would cover the picture it points at.
          group.append(
            svg('rect', { ...shape, class: 'te-dg-l te-dg-fill', 'data-faint': '' }),
            svg('rect', { ...shape, class: 'te-dg-l te-dg-edge' }),
          )
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
