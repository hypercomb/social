// The code theme (code-theme.ts): the tokenizer a host's source is read through, and the
// DCP installer's palette it wears.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CODE_PALETTE, codeClass, codeLanguage, codeThemeCss, tokenizeCode, type CodeKind, type CodeLanguage } from './code-theme.js'

// A fragment is told what it is: detection reads whole files, and these are lines.
const line = (text: string, index = 0, language: CodeLanguage = 'js'): { text: string; kind: CodeKind }[] => tokenizeCode(text, language)[index]!
/** `kind:text` for each token that is not plain space, to read a line at a glance. */
const read = (text: string, index = 0, language: CodeLanguage = 'js'): string[] =>
  line(text, index, language).filter(token => token.text.trim()).map(token => `${token.kind}:${token.text.trim()}`)

describe('which language a source is', () => {
  it('knows JSON, JavaScript and prose apart', () => {
    expect(codeLanguage('{"name":"assistant","bees":[]}')).toBe('json')
    expect(codeLanguage('[\n  "a",\n  "b"\n]')).toBe('json')
    expect(codeLanguage('// @hypercomb/essentials/x\nexport class A {}')).toBe('js')
    expect(codeLanguage('import { a } from "b"')).toBe('js')
    expect(codeLanguage('(function () { return 1 })()')).toBe('js')
    expect(codeLanguage('{ const a = 1 }')).toBe('js')
    expect(codeLanguage('a note about a thing, nothing more')).toBe('plain')
    expect(codeLanguage('')).toBe('plain')
  })
})

describe('reading JavaScript', () => {
  it('gives a line back exactly, whatever it holds', () => {
    for (const source of [
      'export class OrganizeDrone extends Drone { #n = 0x1F; run() { return /a[/]b/gi.test(`x${y}z`) } }',
      "const s = 'it\\'s' + \"a\\\"b\"; // trailing",
      '  \t  ',
      '',
      'unclosed "string',
      'a = b / c / d',
      '@@@ ### $$$ ???',
    ]) {
      const tokens = tokenizeCode(source, 'js')
      expect(tokens.map(row => row.map(token => token.text).join('')).join('\n')).toBe(source)
    }
  })

  it('wears the hues: keyword, name, function, type, string, number, comment, punctuation', () => {
    expect(read('export const total = count(1.5e3, "a") + Math.max(2, 0xff) // sum', 0)).toEqual([
      'kw:export', 'kw:const', 'plain:total', 'punc:=', 'fn:count', 'punc:(', 'num:1.5e3', 'punc:,', 'str:"a"', 'punc:)',
      'punc:+', 'type:Math', 'punc:.', 'fn:max', 'punc:(', 'num:2', 'punc:,', 'num:0xff', 'punc:)', 'comment:// sum',
    ])
  })

  it('leaves an ordinary name plain, even when it is a word other languages reserve', () => {
    expect(read('const from = type + get')).toEqual(['kw:const', 'plain:from', 'punc:=', 'plain:type', 'punc:+', 'plain:get'])
    // A property is never a keyword.
    expect(read('x.default.delete()')).toEqual(['plain:x', 'punc:.', 'plain:default', 'punc:.', 'fn:delete', 'punc:()'])
  })

  it('tells a regular expression from a division', () => {
    expect(read('return /ab+c/g.test(s)')[1]).toBe('str:/ab+c/g')
    expect(read('const r = /[/]x/i')).toContain('str:/[/]x/i')
    expect(read('a = b / c / d').filter(token => token.startsWith('str'))).toEqual([])
    expect(read('(a + b) / 2')).toEqual(['punc:(', 'plain:a', 'punc:+', 'plain:b', 'punc:)', 'punc:/', 'num:2'])
  })

  it('carries a block comment across lines, and ends it', () => {
    const rows = tokenizeCode('a /* one\ntwo\nthree */ b', 'js')
    expect(rows[0]!.at(-1)).toEqual({ text: '/* one', kind: 'comment' })
    expect(rows[1]).toEqual([{ text: 'two', kind: 'comment' }])
    expect(rows[2]).toEqual([{ text: 'three */', kind: 'comment' }, { text: ' b', kind: 'plain' }])
  })

  it('carries a template literal across lines and drops into code for each ${ }', () => {
    const rows = tokenizeCode('const a = `one ${x + 1}\ntwo ${ {k: 1}.k } three`;\nlet b', 'js')
    const trimmed = (index: number): string[] => rows[index]!.filter(token => token.text.trim()).map(token => `${token.kind}:${token.text.trim()}`)
    expect(trimmed(0)).toEqual(['kw:const', 'plain:a', 'punc:=', 'str:`one', 'punc:${', 'plain:x', 'punc:+', 'num:1', 'punc:}'])
    // The second line is still inside the template; its hole holds an object, and the closing brace is the hole's, not the object's.
    expect(trimmed(1)).toEqual(['str:two', 'punc:${', 'punc:{', 'plain:k', 'punc::', 'num:1', 'punc:}.', 'plain:k', 'punc:}', 'str:three`', 'punc:;'])
    // After the template the third line is code again.
    expect(rows[2]![0]).toEqual({ text: 'let', kind: 'kw' })
  })

  it('never lets one bad line spoil the next, and never throws on anything', () => {
    expect(() => tokenizeCode('`unclosed ${ (((\n"also\n/* never closed', 'js')).not.toThrow()
    let seed = 7
    const next = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff)
    const alphabet = '`${}()/*"\'\\\n abc09.-<>=;,'
    for (let round = 0; round < 200; round++) {
      let source = ''
      for (let i = 0; i < 60; i++) source += alphabet[next() % alphabet.length]
      const rows = tokenizeCode(source, 'js')
      expect(rows.map(row => row.map(token => token.text).join('')).join('\n')).toBe(source)
    }
  })

  it('does not paint a minified line: a line past the limit is plain, and the next is read afresh', () => {
    const long = 'a'.repeat(5000)
    const rows = tokenizeCode(`${long}\nconst x = 1`, 'js')
    expect(rows[0]).toEqual([{ text: long, kind: 'plain' }])
    expect(rows[1]![0]).toEqual({ text: 'const', kind: 'kw' })
  })
})

describe('reading JSON', () => {
  it('colours a key as a name and a value as what it is', () => {
    expect(read('  "docs": { "bees": ["ab", 12, true, null, -3.5e2] }', 0, 'json')).toEqual([
      'type:"docs"', 'punc::', 'punc:{', 'type:"bees"', 'punc::', 'punc:[', 'str:"ab"', 'punc:,', 'num:12', 'punc:,',
      'kw:true', 'punc:,', 'kw:null', 'punc:,', 'num:-3.5e2', 'punc:]', 'punc:}',
    ])
  })

  it('keeps an escaped quote inside its string', () => {
    expect(read('{"a":"he said \\"hi\\""}', 0, 'json')).toContain('str:"he said \\"hi\\""')
  })

  it('draws plain text as plain text', () => {
    expect(tokenizeCode('just some words\n\nmore')).toEqual([
      [{ text: 'just some words', kind: 'plain' }], [], [{ text: 'more', kind: 'plain' }],
    ])
  })
})

describe('the palette', () => {
  const css = codeThemeCss('.surface')

  it('is the DCP installer\'s, dark and light, each hue once', () => {
    // dcp-installer-visual-spec.md §1.2 (dark) and §1.3 (light).
    expect(CODE_PALETTE.bg).toEqual(['#0d1016', '#fbfcfe'])
    expect(CODE_PALETTE.kw).toEqual(['#b3a4ea', '#5b46a8'])
    expect(CODE_PALETTE.str).toEqual(['#a8c98a', '#4f7333'])
    expect(CODE_PALETTE.num).toEqual(['#e3c07a', '#8a6218'])
    expect(CODE_PALETTE.fn).toEqual(['#8fb4e8', '#2f5c96'])
    expect(CODE_PALETTE.type).toEqual(['#6fc9c0', '#1e7a70'])
    expect(CODE_PALETTE.comment).toEqual(['#6b7488', '#7b8698'])
    expect(CODE_PALETTE.punc).toEqual(['#a8b2c4', '#4a5468'])
    expect(CODE_PALETTE.del).toEqual(['#ec7365', '#b83a2c'])
    for (const key of Object.keys(CODE_PALETTE)) {
      expect(css, key).toContain(`--code-${key}:light-dark(${(CODE_PALETTE as Record<string, readonly string[]>)[key]![1]},${(CODE_PALETTE as Record<string, readonly string[]>)[key]![0]});`)
    }
  })

  it('follows the theme\'s own scheme rather than keeping a switch of its own', () => {
    expect(css).toContain('color-scheme:var(--md-color-scheme,dark)')
    expect(css).not.toMatch(/prefers-color-scheme/)
  })

  it('is scoped to its surface, and gives every kind a class', () => {
    for (const rule of css.split('\n').filter(entry => entry.includes('{'))) expect(rule.startsWith('.surface .hd-codebox')).toBe(true)
    for (const kind of ['kw', 'str', 'num', 'fn', 'type', 'comment', 'punc', 'del'] as const) {
      expect(css).toContain(`.${codeClass(kind)}{color:var(--code-${kind});`)
    }
    expect(codeClass('kw')).toBe('tk-kw')
  })

  it('imports nothing: a module reaches no other tier', () => {
    const source = readFileSync(join(__dirname, 'code-theme.ts'), 'utf8')
    expect([...source.matchAll(/^import .*$/gm)]).toEqual([])
  })
})
