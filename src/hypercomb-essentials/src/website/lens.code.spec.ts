// website/lens.code.spec.ts
import { describe, expect, it } from 'vitest'
import {
  decodeEscapes, enclosingFlow, handlerOf, literalOf, shortCall, maskCode, offsetOf, readStatement, splitArgs, statementAt, stripFlow,
  templateParts, toggledWord,
} from './lens.code.js'

// The brood panel's row, as its bee runs it (the compiled text keeps the source's shape).
const CODE = `  #row(record) {
    const row = document.createElement("article");
    const accepted = record.ruling?.verdict === "accepted";
    row.className = \`hc-brood-row\${accepted ? " is-accepted" : ""}\`;
    const name = document.createElement("div");
    name.textContent = broodLabel(record);
    row.appendChild(name);
    // a comment with a { brace and a ; semicolon
    const report = this.#reports.get(record.sig);
    if (report !== void 0) {
      const text = document.createElement("pre");
      text.textContent = report;
      row.appendChild(text);
    }
    acts.appendChild(this.#act("Accept", record, async () => {
      await acceptByHand(record);
    }, true));
    lede.textContent = this.#roster.length === 1
      ? "One automaton is held here."
      : \`\${this.#roster.length} automatons are held here.\`;
    for (const record of this.#roster) body.appendChild(this.#row(record));
    return row;
  }`

/** The 1-based line and column of the first `needle` in CODE. */
const at = (needle: string): number => {
  const offset = CODE.indexOf(needle)
  if (offset < 0) throw new Error(`no ${needle}`)
  const before = CODE.slice(0, offset).split('\n')
  return offsetOf(CODE, before.length, before[before.length - 1].length + 1)
}
const masked = maskCode(CODE)
const statement = (needle: string): string => statementAt(CODE, masked, at(needle)).text

describe('maskCode', () => {
  it('blanks strings, template text and comments, keeps template code and the length', () => {
    const src = 'a = "x;{" + `t ${b + "(" } u` // c {'
    const out = maskCode(src)
    expect(out).toHaveLength(src.length)
    expect(out.slice(4, 9)).toBe('"   "')
    expect(out).toContain('`  ${b + " " }  `')
    const comment = src.indexOf('//')
    expect(out.slice(comment)).toBe(' '.repeat(src.length - comment))
  })
})

describe('statementAt', () => {
  it('reads the statement around a column, from either end of it', () => {
    expect(statement('= document.createElement("article")')).toBe('const row = document.createElement("article")')
    expect(statement('className = `')).toBe('row.className = `hc-brood-row${accepted ? " is-accepted" : ""}`')
  })

  it('carries a statement across lines that go on', () => {
    expect(statement('lede.textContent')).toBe('lede.textContent = this.#roster.length === 1\n      ? "One automaton is held here."\n      : `${this.#roster.length} automatons are held here.`')
  })

  it('takes a statement inside a block, and a call whose arguments hold a function', () => {
    expect(statement('text.textContent')).toBe('text.textContent = report')
    expect(statement('acts.appendChild')).toContain('acts.appendChild(this.#act("Accept", record, async () => {')
    expect(statement('acts.appendChild')).toMatch(/true\)\)$/)
  })

  it('keeps a flow header written on the line above its statement', () => {
    const src = '    body.appendChild(lede);\n    for (const record of this.#roster)\n      body.appendChild(this.#row(record));\n'
    const text = statementAt(src, maskCode(src), src.indexOf('appendChild(this')).text
    expect(stripFlow(text)).toEqual({ flows: [{ kind: 'for', head: 'const record of this.#roster' }], rest: 'body.appendChild(this.#row(record))' })
  })

  it('ignores braces and semicolons in comments', () => {
    expect(statement('const report')).toBe('const report = this.#reports.get(record.sig)')
  })
})

describe('the flow a statement runs under', () => {
  it('finds the block conditions around a statement, up to its function', () => {
    const offset = at('row.appendChild(text)')
    expect(enclosingFlow(CODE, masked, offset)).toEqual([{ kind: 'if', head: 'report !== void 0' }])
    expect(enclosingFlow(CODE, masked, at('row.appendChild(name)'))).toEqual([])
  })

  it('takes a loop written in front of a statement off it', () => {
    const { flows, rest } = stripFlow(statement('body.appendChild(this.#row'))
    expect(flows).toEqual([{ kind: 'for', head: 'const record of this.#roster' }])
    expect(rest).toBe('body.appendChild(this.#row(record))')
  })
})

describe('readStatement', () => {
  it('reads an assignment, a call and anything else', () => {
    expect(readStatement('const row = document.createElement("article")')).toEqual({ kind: 'assign', target: 'row', value: 'document.createElement("article")' })
    expect(readStatement('word.disabled = !!this.#busy')).toEqual({ kind: 'assign', target: 'word.disabled', value: '!!this.#busy' })
    expect(readStatement('close.addEventListener("click", () => this.close())')).toEqual({
      kind: 'call', target: 'close', method: 'addEventListener', args: ['"click"', '() => this.close()'],
    })
    expect(readStatement('a === b')).toEqual({ kind: 'other', text: 'a === b' })
  })

  it('splits arguments at their own commas only', () => {
    expect(splitArgs('"a,b", f(1, 2), `x${y, z}`')).toEqual(['"a,b"', 'f(1, 2)', '`x${y, z}`'])
  })
})

describe('values', () => {
  it('knows a plain literal from an expression', () => {
    expect(literalOf('"hc-brood-head"')).toBe('hc-brood-head')
    expect(literalOf("'×'")).toBe('×')
    expect(literalOf('`plain`')).toBe('plain')
    expect(literalOf('`a${b}`')).toBeNull()
    expect(literalOf('broodLabel(record)')).toBeNull()
    expect(literalOf('"\\xD7"')).toBe('×')
    expect(decodeEscapes('`${label}\\u2026`')).toBe('`${label}…`')
  })

  it('reads a template into text and expressions, and a toggled word', () => {
    expect(templateParts('`hc-brood-row${accepted ? " is-accepted" : ""}`')).toEqual([
      { text: 'hc-brood-row' }, { expr: 'accepted ? " is-accepted" : ""' },
    ])
    expect(toggledWord('accepted ? " is-accepted" : ""')).toEqual({ word: 'is-accepted', when: 'accepted' })
    expect(toggledWord('busy ? "" : " ready"')).toEqual({ word: 'ready', when: '!(busy)' })
    expect(toggledWord('level')).toBeNull()
  })

  it('says a listener by what it does', () => {
    expect(handlerOf('() => this.close()')).toBe('this.close()')
    expect(handlerOf('(event) => { event.stopPropagation(); }')).toBe('event.stopPropagation()')
    expect(handlerOf('() => {\n  if (busy)\n    return;\n  run();\n  draw();\n}')).toBe('{ if (busy) return; run(); draw() }')
    expect(handlerOf('this.#onKey')).toBe('this.#onKey')
  })

  it('says a call short, its function bodies folded', () => {
    expect(shortCall('this.#act("Accept", record, async () => {\n  await acceptByHand(record);\n}, true)')).toBe('this.#act("Accept", record, async () => {…}, true)')
  })
})
