import { describe, expect, it } from 'vitest'
import { factsOf, indexPageHtml, pageHref, whatIsMissing, wordPageHtml, type HowToFacts } from './howto-page.js'

const plain = (over: Partial<HowToFacts> = {}): HowToFacts => ({
  name: 'create',
  description: 'Make a tile here — the only way to create one in beehaviour mode',
  options: ['<name>', '<parent>/<child>'],
  examples: [{ input: '/create groceries', result: 'A tile "groceries" appears on this page' }],
  hidden: false,
  prototype: false,
  ...over,
})

describe('factsOf — what a word declares, read defensively', () => {
  it('keeps the description, options and examples, trimmed', () => {
    const f = factsOf({ name: ' create ', description: ' Make a tile ', options: [' <name> ', ''], examples: [{ input: ' /create a ', result: ' a tile ' }, { input: '', result: 'no input' }] })
    expect(f).toMatchObject({ name: 'create', description: 'Make a tile', options: ['<name>'], examples: [{ input: '/create a', result: 'a tile' }], hidden: false, prototype: false })
  })

  it('reads a machine grammar only when it has an example, and defaults its reach to editing', () => {
    expect(factsOf({ name: 'x', machine: { forms: '<tile>', example: '/remove drafts' } }).machine)
      .toEqual({ forms: '<tile>', example: '/remove drafts', bare: false, reach: 'editing', scope: '', consequence: '' })
    expect(factsOf({ name: 'x', machine: { forms: '<tile>' } }).machine).toBeUndefined()
  })

  it('survives garbage without throwing', () => {
    expect(() => factsOf({ name: 7, description: {}, options: 'nope', examples: [null, 3, { input: 4 }] })).not.toThrow()
    expect(factsOf({}).name).toBe('')
  })

  it('never reads an alias: those are the participant\'s own, and a published page is the world\'s', () => {
    const f = factsOf({ name: 'create', description: 'x'.repeat(30), aliases: ['mk'], examples: [{ input: 'create a', result: 'r' }] } as never)
    expect(JSON.stringify(f)).not.toContain('mk')
  })
})

describe('whatIsMissing — the rule a word cannot ship without', () => {
  it('is empty for a word with a sentence and an example', () => {
    expect(whatIsMissing(plain())).toEqual([])
  })

  it('names a description that is not a sentence, and a word with nothing to try', () => {
    expect(whatIsMissing(plain({ description: 'Tags' }))).toEqual(['a description of at least a sentence'])
    expect(whatIsMissing(plain({ examples: [] }))).toEqual(['at least one example'])
  })

  it('accepts a machine example in place of a worked one', () => {
    expect(whatIsMissing(plain({ examples: [], machine: { forms: '', example: '/x', bare: false, reach: 'editing', scope: '', consequence: '' } }))).toEqual([])
  })
})

describe('wordPageHtml — one page, self-contained', () => {
  const page = wordPageHtml(plain())

  it('is a whole document with the word as its title and no script', () => {
    expect(page.startsWith('<!doctype html>')).toBe(true)
    expect(page).toContain('<title>create · How to</title>')
    expect(page).toContain('<h1>create</h1>')
    expect(page).not.toContain('<script')
    expect(page).not.toMatch(/(?:src|href)="https?:/)
  })

  it('shows each example with what it does, and each form with the word in front', () => {
    expect(page).toContain('<code>/create groceries</code>')
    expect(page).toContain('A tile &quot;groceries&quot; appears on this page')
    expect(page).toContain('<code>create &lt;name&gt;</code>')
    expect(page).toContain('<code>create &lt;parent&gt;/&lt;child&gt;</code>')
  })

  it('links back to the index with a relative address', () => {
    expect(page).toContain('href="../"')
  })

  it('escapes everything a word declares', () => {
    const hostile = wordPageHtml(plain({ name: 'x"><img src=1>', description: '<script>alert(1)</script> and more words', examples: [{ input: '<b>', result: '& "q"' }] }))
    expect(hostile).not.toContain('<img')
    expect(hostile).not.toContain('<script>')
    expect(hostile).toContain('&lt;script&gt;')
    expect(hostile).toContain('&amp; &quot;q&quot;')
  })

  it('says when a word is typed in full or still in the workshop', () => {
    expect(wordPageHtml(plain({ hidden: true }))).toContain('Typed in full')
    expect(wordPageHtml(plain({ prototype: true }))).toContain('In the workshop')
    expect(page).not.toContain('class="stage"')
  })

  it('has a section for a model only when the word has a machine grammar', () => {
    expect(page).not.toContain('When a model says it')
    const withMachine = wordPageHtml(plain({ machine: { forms: '<name>', example: '/create roadmap', bare: false, reach: 'additive', scope: 'page', consequence: '' } }))
    expect(withMachine).toContain('When a model says it')
    expect(withMachine).toContain('<code>additive</code>')
    expect(withMachine).toContain('<code>/create roadmap</code>')
  })

  it('does not print a section for options it does not have', () => {
    expect(wordPageHtml(plain({ options: [] }))).not.toContain('<h2 id="forms">')
  })
})

describe('indexPageHtml — every word, A to Z', () => {
  const index = indexPageHtml([plain({ name: 'zoom' }), plain({ name: 'accent' }), plain({ name: 'arrange' }), plain({ name: '' })])

  it('lists words alphabetically under their letters and skips a nameless one', () => {
    expect(index.indexOf('>accent<')).toBeLessThan(index.indexOf('>arrange<'))
    expect(index.indexOf('>arrange<')).toBeLessThan(index.indexOf('>zoom<'))
    expect(index).toContain('3 words')
    expect(index).toContain('href="#l-A"')
    expect(index).toContain('href="#l-Z"')
  })

  it('links each word to its page by a relative address', () => {
    expect(index).toContain('href="accent/"')
    expect(index).toContain('href="zoom/"')
    expect(pageHref('use-live-relay')).toBe('use-live-relay/')
  })
})
