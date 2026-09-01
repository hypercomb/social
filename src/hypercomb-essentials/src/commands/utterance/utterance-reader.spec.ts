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
