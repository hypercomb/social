// comfy-desk/shelf/shelf.ts
//
// THE LIST ON THE LEFT: what has been made, as a contact sheet. It stands where
// the tile editor's tile list stands; its rows are faces, because a picture is
// its own best name. A face shows that picture on the stage. Nothing here lands
// on a tile, and hiding is the only way off the sheet
// (documentation/hide-first-delete-second.md); what was hidden waits in the
// fold at the foot. Faces load as they scroll in, because a face is the whole
// picture.

import { make, type Asset, type Say, type ShelfHandle, type ShelfPart, type ShelfRow } from '../parts.js'

class Shelf implements ShelfHandle {
  readonly el = make('div', 'cd-shelf')
  readonly #events: Parameters<ShelfPart['create']>[0]
  readonly #rows = make('div', 'cd-rows')
  readonly #fresh = make('button', 'cd-cell cd-cell-fresh')
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
    this.#fresh.title = say('comfy.new-picture', 'new picture')
    const face = make('span', 'cd-face cd-face-fresh')
    const plus = make('span', 'mat-sym', 'add')
    plus.setAttribute('aria-hidden', 'true')
    face.append(plus)
    this.#fresh.append(face, make('span', 'cd-cell-name', say('comfy.new-picture', 'new picture')))
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
    this.el.append(head, this.#find, this.#rows, this.#folder, this.#hidden)
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
      line.append(make('span', 'cd-cell-name', row.label), back)
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
    this.#rows.replaceChildren(this.#fresh, ...rows.map(row => this.#cell(row)))
  }

  #cell({ asset, chosen }: ShelfRow): HTMLElement {
    const name = this.#events.nameOf(asset)
    const cell = make('div', 'cd-cell-wrap')
    const button = make('button', 'cd-cell cd-row')
    button.type = 'button'
    button.title = asset.record.positive ?? name
    if (chosen) button.dataset['chosen'] = ''
    button.addEventListener('click', () => this.#events.onPick(asset))
    const face = make('img', 'cd-face cd-row-face')
    face.alt = ''
    face.dataset['sig'] = asset.sig
    const held = this.#urls.get(asset.sig)
    if (held) face.src = held
    else if (this.#observer) this.#observer.observe(face)
    else void this.#face(face)
    button.append(face, make('span', 'cd-cell-name', name))
    cell.append(button, this.#hide(asset))
    return cell
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
