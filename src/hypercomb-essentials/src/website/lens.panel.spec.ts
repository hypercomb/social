// website/lens.panel.spec.ts
import { describe, expect, it } from 'vitest'
import { readPanel, sourceText } from './lens.panel.js'
import type { Site, Trace, TraceOp } from './lens.trace.js'
import type { LensLine } from './lens.model.js'

const URL = 'http://localhost/chunk-PANEL.js'
const CODE = [
  '  #head() {',
  '    const head = document.createElement("header");',
  '    head.className = "hc-brood-head";',
  '    const close = document.createElement("button");',
  '    close.textContent = "×";',
  '    close.addEventListener("click", () => this.close());',
  '    head.appendChild(close);',
  '    return head;',
  '  }',
  '  #body() {',
  '    const body = document.createElement("div");',
  '    for (const record of this.#roster) body.appendChild(this.#row(record));',
  '    if (this.#report) {',
  '      body.appendChild(this.#pre());',
  '    }',
  '    return body;',
  '  }',
  '  #row(record) {',
  '    const row = document.createElement("article");',
  '    row.className = `row${record.on ? " is-on" : ""}`;',
  '    row.textContent = label(record);',
  '    row.style.paddingLeft = `${record.depth}rem`;',
  '    return row;',
  '  }',
  '  #pre() { const pre = document.createElement("pre"); pre.textContent = this.#report; return pre }',
].join('\n')

/** The site of `needle` on a 1-based line, as a stack would name it. */
const site = (line: number, needle: string, fn = ''): Site => {
  const text = CODE.split('\n')[line - 1]
  const column = text.indexOf(needle)
  if (column < 0) throw new Error(`no ${needle} on line ${line}`)
  return { url: URL, line, column: column + 1, fn }
}

const said = (line: LensLine): string => `${'  '.repeat(line.depth)}${line.spans.map(span => span.text).join('')}`

function panel(): { root: Element; trace: Trace } {
  const ops = new Map<Node, TraceOp[]>()
  const placed = new Map<Node, Site | null>()
  const make = (tag: string, list: TraceOp[]): HTMLElement => {
    const el = document.createElement(tag)
    ops.set(el, list)
    return el
  }

  const root = document.createElement('div')
  root.className = 'panel'

  const head = make('header', [{ kind: 'create', site: site(2, 'createElement') }, { kind: 'set', name: 'className', site: site(3, '=') }])
  head.className = 'hc-brood-head'
  const close = make('button', [
    { kind: 'create', site: site(4, 'createElement') },
    { kind: 'set', name: 'textContent', site: site(5, '=') },
    { kind: 'listen', name: 'click', site: site(6, 'addEventListener') },
  ])
  close.textContent = '×'
  head.appendChild(close)
  placed.set(close, site(7, 'appendChild'))

  const body = make('div', [{ kind: 'create', site: site(11, 'createElement') }])
  for (const record of [{ on: true, text: 'one', depth: 1 }, { on: false, text: 'two', depth: 2 }]) {
    const row = make('article', [
      { kind: 'create', site: site(19, 'createElement') },
      { kind: 'set', name: 'className', site: site(20, '=') },
      { kind: 'set', name: 'textContent', site: site(21, '=') },
      { kind: 'style', name: 'paddingLeft', site: site(22, '=') },
    ])
    row.className = record.on ? 'row is-on' : 'row'
    row.textContent = record.text
    row.style.paddingLeft = `${record.depth}rem`
    body.appendChild(row)
    placed.set(row, site(12, 'appendChild'))
  }
  const pre = make('pre', [{ kind: 'create', site: site(25, 'createElement') }, { kind: 'set', name: 'textContent', site: site(25, '= this.#report') }])
  pre.textContent = 'the review'
  body.appendChild(pre)
  placed.set(pre, site(14, 'appendChild'))

  root.append(head, body)
  return { root, trace: { ops, placed } }
}

describe('readPanel', () => {
  it('says a panel drawn by code as a template, with loops and conditions from the code', () => {
    const { root, trace } = panel()
    const read = readPanel(root, trace, url => (url === URL ? sourceText(CODE) : undefined))
    expect(read.lines.map(said)).toEqual([
      '<div class="panel">',
      '  <header class="hc-brood-head">',
      '    <button (click)="this.close()">×</button>',
      '  </header>',
      '  <div>',
      '    @for (const record of this.#roster) {',
      '      ↳ this.#row(record)',
      '      <article class="row" [class.is-on]="record.on" [style.padding-left]="`${record.depth}rem`">{{ label(record) }}</article>',
      '      … and 1 more like it, made by the same lines',
      '    }',
      '    @if (this.#report) {',
      '      ↳ this.#pre()',
      '      <pre>{{ this.#report }}</pre>',
      '    }',
      '  </div>',
      '</div>',
    ])
    expect(read.facts).toEqual({ elements: 6, bindings: 4, listeners: 1, loops: 1, conditions: 1, unread: 0 })
  })

  it('keeps each line\'s node, so the two sides can point at each other', () => {
    const { root, trace } = panel()
    const read = readPanel(root, trace, () => sourceText(CODE))
    expect(read.nodes).toHaveLength(read.lines.length)
    expect(read.nodes[0]).toBe(root)
    expect(read.nodes[5]).toBeNull()
  })

  it('says a binding\'s code and place when pointed at', () => {
    const { root, trace } = panel()
    const read = readPanel(root, trace, () => sourceText(CODE))
    const value = read.lines[7].spans.find(span => span.text === '"record.on"')
    expect(value?.note).toBe('row.className = `row${record.on ? " is-on" : ""}`\nchunk-PANEL.js:20')
  })

  it('splits a class into its fixed words and what changes', () => {
    const { root, trace } = panel()
    const row = root.querySelector('article')!
    const list = trace.ops.get(row) as TraceOp[]
    list[1] = { kind: 'set', name: 'className', site: site(20, '=') }
    const code = CODE.replace('`row${record.on ? " is-on" : ""}`', '`row is-${record.level}${record.on ? " is-on" : ""}`')
    const read = readPanel(root, trace, () => sourceText(code))
    expect(said(read.lines[7])).toContain('<article class="row" [class.is-on]="record.on" [class]="`is-${record.level}`"')
  })

  it('says what it produced when the code cannot be read', () => {
    const { root, trace } = panel()
    const read = readPanel(root, trace, () => undefined)
    expect(read.lines.map(said)[1]).toBe('  <header class="hc-brood-head">')
    expect(read.facts.unread).toBeGreaterThan(0)
  })
})
