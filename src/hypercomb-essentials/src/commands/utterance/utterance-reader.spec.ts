// utterance-reader.spec.ts — the reading is deterministic, or it is nothing.
//
// Pure-core tests over readUtterance with a fixed lexicon: no IoC, no drone,
// no hive. The wired UtteranceReader only adds census + colors on top.

import { describe, expect, it } from 'vitest'
import { readUtterance, type UtteranceLexiconEntry } from './utterance-reading.js'

const LEXICON: readonly UtteranceLexiconEntry[] = [
  { name: 'help', description: 'Show reference' },
  { name: 'spotlight', description: 'Light a tile until found' },
  { name: 'record', description: 'AI meeting recording' },
  { name: 'fit', description: 'Zoom to fit' },
  { name: 'images', description: 'Room pictures for a tile' },
  { name: 'lightbox', aliases: ['gallery', 'images'], description: 'Picture lightbox' },
  { name: 'flatten', hidden: true, description: 'Collapse history (destructive, typed in full)' },
  { name: 'save', lineStart: true, description: 'Save as <name> — a sub-word of layout save' },
]

const roles = (text: string) =>
  readUtterance(text, LEXICON).spans.map(s => `${s.text}:${s.role}`).join(' ')

describe('readUtterance', () => {
  it('a single known word is an action with no args', () => {
    const r = readUtterance('help', LEXICON)
    expect(r.actions).toEqual([{ command: 'help', args: '' }])
    expect(r.ambiguous).toBe(false)
  })

  it('words after an action are its argument text, verbatim', () => {
    const r = readUtterance('spotlight the snacks tile', LEXICON)
    expect(r.actions).toEqual([{ command: 'spotlight', args: 'the snacks tile' }])
    expect(roles('spotlight the snacks tile')).toBe(
      'spotlight:action the:argument snacks:argument tile:argument')
  })

  it('two actions execute in word order; the connective before the second is residue', () => {
    const r = readUtterance('spotlight the snacks tile and record', LEXICON)
    expect(r.actions).toEqual([
      { command: 'spotlight', args: 'the snacks tile' },
      { command: 'record', args: '' },
    ])
    expect(roles('spotlight the snacks tile and record')).toContain('and:residue')
  })

  it('a connective inside argument text is kept — only the one before an action is residue', () => {
    const r = readUtterance('spotlight meeting with sam and ana', LEXICON)
    expect(r.actions).toEqual([{ command: 'spotlight', args: 'meeting with sam and ana' }])
  })

  it('words before the first action are residue, thrown away', () => {
    const r = readUtterance('hey please spotlight snacks', LEXICON)
    expect(r.actions).toEqual([{ command: 'spotlight', args: 'snacks' }])
    expect(roles('hey please spotlight snacks')).toBe(
      'hey:residue please:residue spotlight:action snacks:argument')
  })

  it('a word claimed by two behaviours is an ambiguity — nothing guesses', () => {
    const r = readUtterance('show me the images', LEXICON)
    expect(r.ambiguous).toBe(true)
    expect(r.actions).toEqual([])
    const amb = r.spans.find(s => s.role === 'ambiguity')!
    expect(amb.text).toBe('images')
    expect(amb.candidates!.map(c => c.name).sort()).toEqual(['images', 'lightbox'])
  })

  it('a pinned resolution turns the ambiguity into that action', () => {
    const text = 'show me the images'
    const first = readUtterance(text, LEXICON)
    const amb = first.spans.find(s => s.role === 'ambiguity')!
    const r = readUtterance(text, LEXICON, new Map([[amb.start, 'lightbox']]))
    expect(r.ambiguous).toBe(false)
    expect(r.actions).toEqual([{ command: 'lightbox', args: '' }])
  })

  it('pure filler reads as residue with nothing to run', () => {
    const r = readUtterance('nothing to see over here', LEXICON)
    expect(r.hasAction).toBe(false)
    expect(r.spans.every(s => s.role === 'residue')).toBe(true)
  })

  it('hidden behaviours never light from prose', () => {
    const r = readUtterance('flatten everything now', LEXICON)
    expect(r.hasAction).toBe(false)
  })

  // jwize, 2026-10-16: "I don't see save as" — listed, but a sub-word elsewhere.
  it('a line-start word never lights from prose either — first-word dispatch runs it', () => {
    expect(readUtterance('please save the layout', LEXICON).hasAction).toBe(false)
    expect(readUtterance('help then save', LEXICON).actions).toEqual([{ command: 'help', args: 'then save' }])
  })

  it('span offsets index the original text exactly', () => {
    const text = '  spotlight   snacks '
    const r = readUtterance(text, LEXICON)
    for (const s of r.spans) expect(text.slice(s.start, s.end)).toBe(s.text)
  })

  it('matching is case-insensitive; the span keeps the typed casing', () => {
    const r = readUtterance('Spotlight Snacks', LEXICON)
    expect(r.actions).toEqual([{ command: 'spotlight', args: 'Snacks' }])
    expect(r.spans[0].text).toBe('Spotlight')
  })

  it('punctuation glued to a word never defeats it — the core matches, the mark excludes the glyph', () => {
    const r = readUtterance('help?', LEXICON)
    expect(r.actions).toEqual([{ command: 'help', args: '' }])
    expect(r.spans[0].text).toBe('help')      // the '?' stays outside the lit span
  })

  it('a terminal period does not drop the trailing action', () => {
    const r = readUtterance('spotlight the snacks, then record.', LEXICON)
    expect(r.actions).toEqual([
      { command: 'spotlight', args: 'the snacks' },
      { command: 'record', args: '' },
    ])
  })

  it("a comma'd connective is still a connective", () => {
    const r = readUtterance('spotlight snacks and, record', LEXICON)
    expect(r.actions.map(a => a.command)).toEqual(['spotlight', 'record'])
  })

  it('hyphenated behaviour names keep their hyphen through the core trim', () => {
    const lex = [...LEXICON, { name: 'push-to-talk', description: 'hold to speak' }]
    const r = readUtterance('push-to-talk.', lex)
    expect(r.actions).toEqual([{ command: 'push-to-talk', args: '' }])
  })

  it('a token that is pure punctuation stays whole — and rides verbatim into the args', () => {
    const r = readUtterance('spotlight — snacks', LEXICON)
    expect(r.actions).toEqual([{ command: 'spotlight', args: '— snacks' }])
    expect(r.spans[1].text).toBe('—')
  })
})

// A WINDOW OPENS ONLY FROM ITS OWN DOOR (jwize, 2026-10-16: "window pop up in
// response to other things. This is bad in most scenarios especially the
// behaviors"). A word an action owns — the rest of the line for a rawArgs
// word, a form it documents, the name in its slot — is its argument, never a
// second behaviour that opens its own window beside it.
const OWNED: readonly UtteranceLexiconEntry[] = [
  { name: 'vocabulary', options: ['publish', 'withdraw'] },
  { name: 'publish' },
  { name: 'tree', options: ['<name>', '<64-hex signature>', '/path/to/tile', 'insight <name>', 'insights', 'rings <n>', 'off'] },
  { name: 'docs' },
  { name: 'create', options: ['<name>', '<parent>/<child>'] },
  { name: 'go', rawArgs: true, options: ['<tile>', '<path>/<tile>', '/<path>', '..', '/'] },
  { name: 'meeting', options: ['join', 'leave', 'cascade', 'cascade:19'] },
  { name: 'join', rawArgs: true },
  { name: 'comfy', rawArgs: true, options: ['<prompt>', 'host', 'models', 'reroll'] },
  { name: 'models', rawArgs: true },
  { name: 'select', options: ['on', 'off', 'all', 'none', 'options', 'menu'] },
  { name: 'menu', options: ['<name>', 'list'] },
  { name: 'ask', rawArgs: true, options: ['<question>', 'host <domain>'] },
  { name: 'opus', rawArgs: true },
  { name: 'providers' },
  // copy's real forms (clipboard.queen.ts) — it HAS a <tile> slot.
  { name: 'copy', options: ['<tile>', '[<tile>, <tile>, ...]', ''] },
  { name: 'paste' },
  { name: 'record' },
]
const run = (text: string) => readUtterance(text, OWNED).actions

describe('readUtterance — an action keeps its own words', () => {
  it('a word one of its forms names is its argument: vocabulary publish', () => {
    expect(run('vocabulary publish')).toEqual([{ command: 'vocabulary', args: 'publish' }])
  })

  it('a behaviour word in a <slot> is the name it fills: tree docs', () => {
    expect(run('tree docs')).toEqual([{ command: 'tree', args: 'docs' }])
  })

  it('create docs then go docs — each word names the tile, no docs window', () => {
    expect(run('create docs then go docs')).toEqual([
      { command: 'create', args: 'docs' },
      { command: 'go', args: 'docs' },
    ])
  })

  it('meeting join is the meeting form, not the join word', () => {
    expect(run('meeting join')).toEqual([{ command: 'meeting', args: 'join' }])
  })

  it('comfy models is the checkpoints, not the models window', () => {
    expect(run('comfy models')).toEqual([{ command: 'comfy', args: 'models' }])
  })

  it('select menu is the selection ring, not the menu word', () => {
    expect(run('select menu')).toEqual([{ command: 'select', args: 'menu' }])
  })

  it('a rawArgs word keeps the rest of the line even after leading filler', () => {
    const r = readUtterance('please ask how do I publish my files', OWNED)
    expect(r.actions).toEqual([{ command: 'ask', args: 'how do I publish my files' }])
    expect(r.spans.find(s => s.text === 'publish')!.role).toBe('argument')
  })

  it('a model word keeps its question: opus which providers are cheapest', () => {
    expect(run('opus which providers are cheapest')).toEqual([
      { command: 'opus', args: 'which providers are cheapest' },
    ])
  })

  it('a rawArgs word later on the line still takes the rest', () => {
    expect(run('copy then ask why')).toEqual([
      { command: 'copy', args: '' },
      { command: 'ask', args: 'why' },
    ])
  })

  // Chaining stays through a connective: two genuine words on one line both
  // run, in order. Without one, a word with a <slot> takes the next word as
  // the name it fills (the rule that keeps `tree docs` from opening docs), so
  // `copy paste` copies the tile named paste. Say `copy then paste`.
  it('two genuine words still chain — copy then paste', () => {
    expect(run('copy then paste')).toEqual([
      { command: 'copy', args: '' },
      { command: 'paste', args: '' },
    ])
    expect(run('copy paste')).toEqual([{ command: 'copy', args: 'paste' }])
  })

  it('a word that is not one of its forms is still an action: select copy', () => {
    expect(run('select copy').map(a => a.command)).toEqual(['select', 'copy'])
  })

  it('only the word directly after is claimed — the next word chains again', () => {
    expect(run('meeting join then copy')).toEqual([
      { command: 'meeting', args: 'join' },
      { command: 'copy', args: '' },
    ])
  })

  it('a connective is never a slot filler: tree and record runs both', () => {
    expect(run('tree and record')).toEqual([
      { command: 'tree', args: '' },
      { command: 'record', args: '' },
    ])
  })
})
