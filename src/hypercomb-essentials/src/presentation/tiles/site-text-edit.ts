// presentation/tiles/site-text-edit.ts
//
// EDIT A WEBSITE'S WORDS WHERE YOU READ THEM (jwize 2026-11-12: "For all
// websites that we deploy if we have the publish key can we make it so we can
// edit the text inline (no html)" … "allow clicking the text and popup the
// input in a nice formatted input something like the style on the notes
// input").
//
// The page's holder turns on the pencil beside the site's exit button; every
// piece of text then answers a click with a small input over it, styled as the
// notes line is. Enter saves, Shift+Enter is a new line, Escape (or a click
// away) cancels. Plain text only: what is typed replaces one text node's words
// and nothing else, so no markup is ever written or lost.
//
// THE EDIT LANDS IN THE AUTHORED PAGE, never in the live DOM. The live page has
// run its scripts; serializing it would bake whatever they drew. So each text
// is addressed by where it sits in the AUTHORED document — the element's place
// among the body's elements in document order, and the text's place among that
// element's text nodes — and the save re-parses the authored page, finds the
// same node, checks it still says what the reader saw, and replaces only its
// words. A text the page's own script wrote (no match in the authored page) is
// refused rather than guessed at.
//
// The new page is a new resource; the tile points at it (files/page-commit.ts),
// so the old words are one undo away and publishing carries the new ones.

/** Where one text sits in the authored page. */
export type TextSlot = {
  /** The element's index among `body.querySelectorAll('*')`, document order. */
  readonly element: number
  /** The text's index among that element's Text child nodes. */
  readonly text: number
  /** What the reader saw there. */
  readonly value: string
}

const MEANINGFUL = /\S/

/** The Text children of an element, in order. */
const textChildren = (el: Element): Text[] =>
  Array.from(el.childNodes).filter((n): n is Text => n.nodeType === 3)

/** Replace the words of one text in the authored page. Returns the new page,
 *  or null when the slot does not name that text any more (or never did — a
 *  text the page's script wrote). Leading and trailing whitespace of the
 *  authored text is kept, so the page's layout does not shift. */
export function replaceTextInPage(authored: string, slot: TextSlot, next: string): string | null {
  const doc = new DOMParser().parseFromString(authored, 'text/html')
  const el = doc.body?.querySelectorAll('*')[slot.element]
  const node = el ? textChildren(el)[slot.text] : undefined
  if (!node || node.data !== slot.value) return null
  const lead = /^\s*/.exec(node.data)?.[0] ?? ''
  const trail = /\s*$/.exec(node.data)?.[0] ?? ''
  const words = next.trim()
  if (!words) return null
  node.data = lead + words + trail
  const doctype = /^\s*(<!doctype[^>]*>)/i.exec(authored)?.[1]
  return (doctype ? doctype + '\n' : '') + doc.documentElement.outerHTML
}

/** The authored element order of a freshly parsed page: element → index. Taken
 *  from the parse BEFORE anything moves a node, and keyed by the very nodes
 *  that are moved into the live host, so a click can be traced back. */
export function authoredOrder(parsed: Document): WeakMap<Element, number> {
  const order = new WeakMap<Element, number>()
  Array.from(parsed.body?.querySelectorAll('*') ?? []).forEach((el, i) => order.set(el, i))
  return order
}

const STYLE_ID = 'hc-site-text-edit-style'
const STYLE = `
#hc-site-text-edit-toggle{position:fixed;z-index:2147483600;width:2.25rem;height:2.25rem;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(12,17,24,.82);border:1px solid rgba(126,182,214,.42);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);box-shadow:0 2px 10px rgba(0,0,0,.45);color:#cfe2ee;cursor:pointer;font-family:'Material Symbols Outlined';font-size:1.1rem;line-height:1;padding:0;opacity:.38;transition:opacity .16s ease,background .16s ease}
#hc-site-text-edit-toggle:hover,#hc-site-text-edit-toggle:focus-visible{opacity:1;background:rgba(20,29,40,.94)}
#hc-site-text-edit-toggle[aria-pressed="true"]{opacity:1;background:rgba(20,29,40,.94);border-color:rgba(126,182,214,.95);color:#7eb6d6}
.hc-site-text-edit-mark{position:fixed;z-index:2147483500;pointer-events:none;border:1px dashed rgba(126,182,214,.85);border-radius:2px;background:rgba(126,182,214,.06);display:none}
.hc-site-text-edit{position:fixed;z-index:2147483601;box-sizing:border-box;padding:8px;background:rgba(12,17,24,.96);border:1px solid rgba(126,182,214,.18);border-radius:3px;box-shadow:0 8px 28px rgba(0,0,0,.5);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.hc-site-text-edit textarea{display:block;width:100%;box-sizing:border-box;min-height:2.5rem;max-height:40vh;padding:9px 12px;resize:none;overflow:auto;font-family:var(--hc-notes-face,system-ui,sans-serif);font-size:14.5px;line-height:1.45;color:#dce7ef;background:rgba(126,182,214,.06);border:1px solid rgba(126,182,214,.25);border-radius:var(--hc-radius-control,2px);outline:none}
.hc-site-text-edit textarea:focus{border-color:rgba(126,182,214,.7)}
.hc-site-text-edit textarea::placeholder{color:rgba(220,231,239,.45)}
.hc-site-text-edit textarea[disabled]{opacity:.6}
.hc-site-text-edit p{margin:6px 2px 0;font:12px/1.3 system-ui,sans-serif;color:rgba(207,226,238,.55)}
`

export type SiteTextEditorOptions = {
  readonly host: HTMLElement
  readonly order: WeakMap<Element, number>
  /** Edit mode carries across page mounts (a save remounts the page). */
  readonly editing: () => boolean
  readonly setEditing: (on: boolean) => void
  /** Why this text cannot be edited, or null when it can — asked as the input
   *  opens, so the reader learns it before typing, not after. */
  readonly refusal: (slot: TextSlot) => string | null
  readonly save: (slot: TextSlot, next: string) => Promise<string | null>
  readonly t: (key: string, fallback: string) => string
  /** The line under the input: what Enter does here (saves, or offers). */
  readonly hint: string
}

/** The pencil, the hover mark and the input for one mounted page. */
export class SiteTextEditor {
  readonly #o: SiteTextEditorOptions
  readonly #toggle: HTMLButtonElement
  readonly #mark: HTMLDivElement
  #popup: { root: HTMLDivElement; area: HTMLTextAreaElement; target: Element; close: () => void } | null = null

  constructor(options: SiteTextEditorOptions) {
    this.#o = options
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = STYLE
      document.head.appendChild(style)
    }
    this.#toggle = document.createElement('button')
    this.#toggle.id = 'hc-site-text-edit-toggle'
    this.#toggle.type = 'button'
    this.#toggle.addEventListener('click', () => this.#o.setEditing(!this.#o.editing()))
    document.body.appendChild(this.#toggle)
    this.#mark = document.createElement('div')
    this.#mark.className = 'hc-site-text-edit-mark'
    document.body.appendChild(this.#mark)
    window.addEventListener('click', this.#onClick, true)
    options.host.addEventListener('pointermove', this.#onHover)
    options.host.addEventListener('pointerleave', this.#hideMark)
    options.host.addEventListener('scroll', this.#onScroll, { passive: true })
    this.refresh()
  }

  /** Redraw for the current edit mode. */
  refresh(): void {
    const on = this.#o.editing()
    this.#toggle.textContent = on ? 'check' : 'edit'
    this.#toggle.setAttribute('aria-pressed', on ? 'true' : 'false')
    const label = on
      ? this.#o.t('site-edit.done', 'Done editing text')
      : this.#o.t('site-edit.start', 'Edit this page\'s text')
    this.#toggle.title = label
    this.#toggle.setAttribute('aria-label', label)
    this.#o.host.style.cursor = on ? 'text' : ''
    if (!on) { this.#hideMark(); this.#closePopup() }
  }

  /** Seat the pencil above the exit button, at the same right edge. */
  place(right: string): void {
    this.#toggle.style.right = right
    this.#toggle.style.bottom = 'calc(3.5rem + env(safe-area-inset-bottom, 0px))'
  }

  dispose(): void {
    window.removeEventListener('click', this.#onClick, true)
    this.#o.host.removeEventListener('pointermove', this.#onHover)
    this.#o.host.removeEventListener('pointerleave', this.#hideMark)
    this.#o.host.removeEventListener('scroll', this.#onScroll)
    this.#o.host.style.cursor = ''
    this.#closePopup()
    this.#toggle.remove()
    this.#mark.remove()
  }

  /** The nearest authored element under `node` that holds words of its own. */
  #editableFrom(node: Node | null): Element | null {
    let el: Element | null = node instanceof Element ? node : node?.parentElement ?? null
    while (el && el !== this.#o.host) {
      if (this.#o.order.has(el) && textChildren(el).some(t => MEANINGFUL.test(t.data))) return el
      el = el.parentElement
    }
    return null
  }

  readonly #onHover = (e: PointerEvent): void => {
    if (!this.#o.editing() || this.#popup) return this.#hideMark()
    const el = this.#editableFrom(e.target as Node)
    if (!el) return this.#hideMark()
    const r = el.getBoundingClientRect()
    Object.assign(this.#mark.style, {
      display: 'block', left: `${r.left - 3}px`, top: `${r.top - 3}px`,
      width: `${r.width + 6}px`, height: `${r.height + 6}px`,
    })
  }

  readonly #hideMark = (): void => { this.#mark.style.display = 'none' }

  readonly #onScroll = (): void => {
    this.#hideMark()
    if (this.#popup) this.#position(this.#popup.root, this.#popup.target)
  }

  readonly #onClick = (e: MouseEvent): void => {
    if (!this.#o.editing() || e.button !== 0) return
    const target = e.target as Node | null
    if (!target || !this.#o.host.contains(target)) return
    const el = this.#editableFrom(target)
    if (!el) return
    const node = this.#textAt(el, e.clientX, e.clientY)
    if (!node) return
    // The click is the edit's, not the page's: a link under it does not
    // navigate and the page's own handlers never hear it.
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    this.#open(el, node)
  }

  /** The text node the pointer is on: the caret's node when it is one of this
   *  element's own words, else the one whose box holds the point, else the
   *  only one there is. */
  #textAt(el: Element, x: number, y: number): Text | null {
    const own = textChildren(el).filter(t => MEANINGFUL.test(t.data))
    const d = document as Document & {
      caretPositionFromPoint?(x: number, y: number): { offsetNode: Node } | null
      caretRangeFromPoint?(x: number, y: number): Range | null
    }
    const caret = d.caretPositionFromPoint?.(x, y)?.offsetNode ?? d.caretRangeFromPoint?.(x, y)?.startContainer ?? null
    if (caret && own.includes(caret as Text)) return caret as Text
    for (const t of own) {
      const range = document.createRange()
      range.selectNodeContents(t)
      for (const r of Array.from(range.getClientRects())) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return t
      }
    }
    return own.length === 1 ? own[0] : null
  }

  #open(el: Element, node: Text): void {
    this.#closePopup()
    this.#hideMark()
    const slot: TextSlot = {
      element: this.#o.order.get(el)!,
      text: textChildren(el).indexOf(node),
      value: node.data,
    }
    const root = document.createElement('div')
    root.className = 'hc-site-text-edit'
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-label', this.#o.t('site-edit.start', 'Edit this page\'s text'))
    const area = document.createElement('textarea')
    // Escape is this field's own (escape-cascade.ts): it cancels the edit and
    // never closes the website around it.
    area.setAttribute('data-escape-local', '')
    area.rows = 1
    area.spellcheck = true
    area.value = node.data.trim().replace(/\s+/g, ' ')
    area.placeholder = this.#o.t('site-edit.placeholder', 'Write the new words')
    const hint = document.createElement('p')
    hint.textContent = this.#o.hint
    root.append(area, hint)
    document.body.appendChild(root)
    const refused = this.#o.refusal(slot)
    if (refused) {
      area.readOnly = true
      hint.textContent = refused
    }

    const grow = (): void => {
      area.style.height = 'auto'
      area.style.height = `${area.scrollHeight + 2}px`
    }
    const onAway = (ev: PointerEvent): void => {
      if (!root.contains(ev.target as Node)) close()
    }
    const close = (): void => {
      window.removeEventListener('pointerdown', onAway, true)
      root.remove()
      if (this.#popup?.root === root) this.#popup = null
    }
    const commit = async (): Promise<void> => {
      const next = area.value
      if (refused || !next.trim() || next.trim() === node.data.trim().replace(/\s+/g, ' ')) return close()
      area.disabled = true
      const failed = await this.#o.save(slot, next).catch((err: unknown) => String((err as Error)?.message ?? err))
      if (failed) {
        area.disabled = false
        hint.textContent = failed
        area.focus()
        return
      }
      close()
    }
    area.addEventListener('input', grow)
    area.addEventListener('keydown', ev => {
      ev.stopPropagation()
      if (ev.key === 'Escape') { ev.preventDefault(); close(); return }
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); void commit() }
    })
    window.addEventListener('pointerdown', onAway, true)
    this.#popup = { root, area, target: el, close }
    this.#position(root, el)
    grow()
    area.focus()
    area.select()
  }

  /** Under the text when there is room, above it when there is not, never off
   *  the screen; at least as wide as a comfortable line. */
  #position(root: HTMLElement, target: Element): void {
    const r = target.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(Math.max(r.width + 16, 320), 720, vw - 32)
    const left = Math.min(Math.max(16, r.left - 8), vw - width - 16)
    root.style.width = `${width}px`
    root.style.left = `${left}px`
    const height = root.offsetHeight || 90
    const below = r.bottom + 8
    root.style.top = `${below + height <= vh - 8 ? below : Math.max(8, r.top - height - 8)}px`
  }

  #closePopup(): void {
    this.#popup?.close()
    this.#popup = null
  }
}
