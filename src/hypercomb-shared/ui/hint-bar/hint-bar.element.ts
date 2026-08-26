// Framework-free intellisense breadcrumb bar embedded by command-line.
// The shell owns the option state; this element only renders it and emits a
// DOM `pick` event whose detail is the chosen item.

const ELEMENT_NAME = 'hc-hint-bar'

const CSS = `
${ELEMENT_NAME}{display:contents}
${ELEMENT_NAME} .hint-bar{position:fixed;top:max(calc(3.75rem * var(--hc-header-zoom,1)),calc(var(--hc-header-anchor) + 1.42rem));left:.6rem;z-index:59999;display:flex;flex-wrap:nowrap;align-items:center;gap:.25rem;max-width:18rem;overflow:hidden;font-family:var(--hc-mono);pointer-events:auto;transition:opacity 200ms ease}
${ELEMENT_NAME} .hint-crumb{font-size:.5rem;white-space:nowrap;padding:.05rem .45rem;border:.5px solid rgba(200,200,200,.3);border-radius:1px;background:none;color:rgba(200,200,200,.35);cursor:pointer;font-family:inherit;transition:opacity 150ms ease,color 150ms ease,border-color 150ms ease}
${ELEMENT_NAME} .hint-crumb:hover{color:rgba(245,245,245,.8);border-color:rgba(200,200,200,.6)}
${ELEMENT_NAME} .hint-dot{display:inline-block;width:.45em;height:.45em;border-radius:50%;margin-right:.3em;vertical-align:middle}
${ELEMENT_NAME} .hint-matched{color:rgba(200,200,200,.8);border-color:rgba(200,200,200,.5)}
${ELEMENT_NAME} .hint-chosen{color:rgba(77,166,255,.9);border-color:rgba(77,166,255,.5);background:rgba(77,166,255,.06)}
@media(max-width:599px){${ELEMENT_NAME} .hint-bar{left:.8rem;max-width:calc(50vw - 1rem)}${ELEMENT_NAME} .hint-crumb{font-size:.8rem;padding:.08rem .55rem}}
@media(min-width:600px) and (max-width:1023px){${ELEMENT_NAME} .hint-crumb{font-size:.7rem}}
@media(min-width:2560px){${ELEMENT_NAME} .hint-bar{max-width:28rem}}
@media(min-width:3440px){${ELEMENT_NAME} .hint-bar{max-width:36rem}${ELEMENT_NAME} .hint-crumb{font-size:.56rem}}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled || typeof document === 'undefined') return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-hint-bar', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

const asStrings = (value: readonly string[] | null | undefined): readonly string[] =>
  Array.isArray(value) ? value.map(String) : []

export class HintBarElement extends HTMLElement {
  #items: readonly string[] = []
  #filter = ''
  #chosen: ReadonlySet<string> = new Set()
  #colorMap: ReadonlyMap<string, string> = new Map()

  connectedCallback(): void {
    installCss()
    this.#render()
  }

  get items(): readonly string[] { return this.#items }
  set items(value: readonly string[]) {
    this.#items = asStrings(value)
    this.#render()
  }

  get filter(): string { return this.#filter }
  set filter(value: string) {
    this.#filter = String(value ?? '')
    this.#render()
  }

  get chosen(): ReadonlySet<string> { return this.#chosen }
  set chosen(value: ReadonlySet<string>) {
    this.#chosen = value instanceof Set ? value : new Set()
    this.#render()
  }

  get colorMap(): ReadonlyMap<string, string> { return this.#colorMap }
  set colorMap(value: ReadonlyMap<string, string>) {
    this.#colorMap = value instanceof Map ? value : new Map()
    this.#render()
  }

  #render(): void {
    if (!this.isConnected) return
    if (this.#items.length === 0) {
      this.replaceChildren()
      return
    }

    const filter = this.#filter.toLowerCase()
    const bar = document.createElement('div')
    bar.className = 'hint-bar'
    for (const item of this.#items) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'hint-crumb'
      if (!filter || item.toLowerCase().startsWith(filter)) button.classList.add('hint-matched')
      if (this.#chosen.has(item)) button.classList.add('hint-chosen')

      const color = this.#colorMap.get(item) ?? ''
      if (color) {
        button.style.borderColor = color
        const dot = document.createElement('span')
        dot.className = 'hint-dot'
        dot.style.background = color
        button.appendChild(dot)
      }
      button.append(document.createTextNode(item))
      button.addEventListener('mousedown', event => {
        event.preventDefault()
        this.dispatchEvent(new CustomEvent<string>('pick', { detail: item, bubbles: true }))
      })
      bar.appendChild(button)
    }
    this.replaceChildren(bar)
  }
}

if (typeof customElements !== 'undefined' && !customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, HintBarElement)
}
