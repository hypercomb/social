// comfy-desk/shelf/shelf.ts
//
// THE LIST ON THE LEFT: what has been made. It stands where the tile editor's
// tile list stands and reads the same way. A row shows that picture on the
// stage. Nothing here lands on a tile, and hiding is the only way off the list
// (documentation/hide-first-delete-second.md); what was hidden waits in the fold
// at the foot. Faces load as they scroll in, because a face is the whole picture.

import { make, type Asset, type Say, type ShelfHandle, type ShelfPart, type ShelfRow } from '../parts.js'

class Shelf implements ShelfHandle {
  readonly el = make('div', 'cd-shelf')
  readonly #events: Parameters<ShelfPart['create']>[0]
  readonly #rows = make('div', 'cd-rows')
  readonly #fresh = make('button', 'cd-row cd-row-fresh')
  readonly #find = make('input', 'cd-find')
  readonly #folder = make('div', 'cd-folder-strip')
  readonly #hidden = make('details', 'cd-hidden')
  readonly #say: Say
  readonly #urls = new Map<string, string>()
  #observer: IntersectionObserver | null = null
  #last: readonly ShelfRow[] = []

  constructor(events: Parameters<ShelfPart['create']>[0], say: Say) {
    this.#events = events
    this.#say = say
    const head = make('div', 'cd-list-head')
    head.append(make('span', 'cd-list-title', say('comfy.assets', 'assets')))

    this.#find.type = 'search'
    this.#find.placeholder = say('comfy.find-assets', 'find')
    this.#find.setAttribute('aria-label', this.#find.placeholder)
    this.#find.addEventListener('input', () => this.#paint())

    this.#fresh.type = 'button'
    const face = make('span', 'cd-row-face mat-sym', 'add')
    face.setAttribute('aria-hidden', 'true')
    this.#fresh.append(face, make('span', 'cd-row-name', say('comfy.new-picture', 'new picture')))
    this.#fresh.addEventListener('click', () => events.onPick(null))

    this.#hidden.hidden = true
    if (typeof IntersectionObserver !== 'undefined') {
      this.#observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          this.#observer?.unobserve(entry.target)
          void this.#face(entry.target as HTMLImageElement)
        }
      }, { root: this.#rows })
    }
    this.el.append(head, this.#find, this.#fresh, this.#rows, this.#folder, this.#hidden)
  }

  show(rows: readonly ShelfRow[], fresh: boolean): void {
    this.#last = rows
    this.#fresh.toggleAttribute('data-chosen', fresh)
    this.#paint()
  }

  folder(pictures: readonly { readonly url: string; readonly filename: string; readonly size: number }[]): void {
    this.#folder.replaceChildren(...pictures.map((picture, index) => {
      const button = make('button', 'cd-thumb')
      button.type = 'button'
      button.title = `${picture.filename} — ${(picture.size / (1024 * 1024)).toFixed(1)} MB`
      const image = make('img')
      image.src = picture.url
      image.alt = picture.filename
      button.append(image)
      button.addEventListener('click', () => this.#events.onKeep(index))
      return button
    }))
  }

  hidden(rows: readonly { readonly sig: string; readonly label: string }[]): void {
    this.#hidden.hidden = !rows.length
    const summary = make('summary', '', `${this.#say('comfy.put-away', 'put away')} (${rows.length})`)
    this.#hidden.replaceChildren(summary, ...rows.map(row => {
      const line = make('div', 'cd-hidden-row')
      const back = make('button', 'te-dg-word', this.#say('comfy.bring-back', 'bring back'))
      back.type = 'button'
      back.addEventListener('click', () => this.#events.onReveal(row.sig))
      line.append(make('span', 'cd-row-name', row.label), back)
      return line
    }))
  }

  dispose(): void {
    this.#observer?.disconnect()
    this.#observer = null
    for (const url of this.#urls.values()) { try { URL.revokeObjectURL(url) } catch { /* already gone */ } }
    this.#urls.clear()
  }

  #paint(): void {
    const query = this.#find.value.trim().toLowerCase()
    const rows = query
      ? this.#last.filter(({ asset }) => [this.#events.nameOf(asset), asset.record.positive ?? ''].join(' ').toLowerCase().includes(query))
      : this.#last
    this.#observer?.disconnect()
    this.#rows.replaceChildren(...rows.map(row => this.#row(row)))
  }

  #row({ asset, chosen }: ShelfRow): HTMLElement {
    const name = this.#events.nameOf(asset)
    const line = make('div', 'cd-row-line')
    const row = make('button', 'cd-row')
    row.type = 'button'
    row.title = asset.record.positive ?? name
    if (chosen) row.dataset['chosen'] = ''
    row.addEventListener('click', () => this.#events.onPick(asset))
    const face = make('img', 'cd-row-face')
    face.alt = ''
    face.dataset['sig'] = asset.sig
    const held = this.#urls.get(asset.sig)
    if (held) face.src = held
    else if (this.#observer) this.#observer.observe(face)
    else void this.#face(face)
    row.append(face, make('span', 'cd-row-name', name))

    const hide = this.#hide(asset)
    line.append(row, hide)
    return line
  }

  #hide(asset: Asset): HTMLButtonElement {
    const label = this.#say('comfy.hide-asset', 'put away')
    const button = make('button', 'te-dg-ib cd-row-hide')
    button.type = 'button'
    button.title = label
    button.setAttribute('aria-label', label)
    const glyph = make('span', 'mat-sym', 'visibility_off')
    glyph.setAttribute('aria-hidden', 'true')
    button.append(glyph)
    button.addEventListener('click', () => this.#events.onHide(asset))
    return button
  }

  async #face(face: HTMLImageElement): Promise<void> {
    const sig = face.dataset['sig'] ?? ''
    const url = this.#urls.get(sig) ?? await this.#events.urlOf(sig)
    if (!url) return
    this.#urls.set(sig, url)
    face.src = url
  }
}

export const shelfPart: ShelfPart = {
  create: (events, say) => new Shelf(events, say),
}
