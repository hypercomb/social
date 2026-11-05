// glossary-tiles.spec.ts — the glossary laid out as tiles, and a term answered
// from its tile with no model asked. Every term gets a tile, every name is its
// own (notes are read by word) and safe to create, the same glossary always
// lays the same tiles, saying it twice adds nothing, and the answer comes from
// the hive first and from the shipped glossary only when no tile stands.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isSystemDirectoryName } from '@hypercomb/core'
import { glossarySource, matchGlossary, parseGlossary, termKeys } from './glossary.js'
import { GLOSSARY_SOURCE } from './glossary.generated.js'
import {
  answerGlossary, glossaryTilePlan, makeGlossaryTiles, sectionTileName, termTileCandidates, termTileName,
  type GlossaryTileDeps,
} from './glossary-tiles.js'

const file = resolve(__dirname, '../../../documentation/glossary.md')
const markdown = existsSync(file) ? readFileSync(file, 'utf8') : ''
const sections = parseGlossary(markdown)
const terms = sections.flatMap(section => section.terms)

const world = (segments: readonly string[] = ['page']) => {
  const notes = new Map<string, string[]>()
  const created: string[] = []
  const deps: GlossaryTileDeps = {
    segments: () => segments,
    create: async path => { created.push(path) },
    notesAt: async at => (notes.get(at.join('/')) ?? []).map(text => ({ text })),
    addNote: async (parent, tile, text) => {
      const key = [...parent, tile].join('/')
      notes.set(key, [...(notes.get(key) ?? []), text])
    },
  }
  return { deps, created, notes }
}

describe('the glossary', () => {
  it('reads every term heading of glossary.md, in order, under its section', () => {
    const headings = [...markdown.replace(/\r\n?/g, '\n').matchAll(/^###\s+(.+?)\s*$/gm)].map(m => m[1])
    expect(headings.length).toBeGreaterThan(50)
    expect(terms.map(term => term.term)).toEqual(headings)
    expect(sections.map(section => section.title)).toEqual(['metaphor layer', 'foundational terms', 'architecture layer', 'cross-reference'])
    expect(terms.find(term => term.term === 'signature')).toMatchObject({ section: 'foundational terms' })
    expect(terms.every(term => term.definition.length > 0)).toBe(true)
  })

  it('the baked module is the document, in step', () => {
    expect(GLOSSARY_SOURCE).toBe(glossarySource(markdown))
    expect(parseGlossary(GLOSSARY_SOURCE)).toEqual(sections)
  })

  it('a retired typed-folder spelling is baked as a quoted name, so the ratchet stays tight', () => {
    expect(glossarySource('no separate `__history__`, `__roots__`, or x')).toBe('no separate "history" folder, "roots" folder, or x')
    expect(GLOSSARY_SOURCE).not.toMatch(/__[a-z][a-z0-9_-]*__/)
    expect(terms.find(term => term.term.startsWith('history bag'))!.definition).toContain('"history" folder')
  })

  it('a term answers to its heading, its heading without parentheses, and what the parentheses say', () => {
    expect(termKeys('history bag (sigbag)')).toEqual(['history-bag-sigbag', 'history-bag', 'sigbag'])
    expect(termKeys('link / unlink')).toEqual(['link-unlink', 'link', 'unlink'])
    expect(termKeys('@hypercomb/core')).toEqual(['hypercomb-core'])
  })

  it('a word names its terms; a plural names its singular; otherwise the terms that hold it are offered', () => {
    expect(matchGlossary(sections, 'bee').exact.map(term => term.term)).toEqual(['bee', 'bee (architecture)'])
    expect(matchGlossary(sections, 'Sigbag').exact.map(term => term.term)).toEqual(['history bag (sigbag)'])
    expect(matchGlossary(sections, 'core').exact.map(term => term.term)).toEqual(['core (the mitochondria)'])
    expect(matchGlossary(sections, 'layers').exact.map(term => term.term)).toEqual(['layer'])
    const capsule = matchGlossary(sections, 'capsule')
    expect(capsule.exact).toEqual([])
    expect(capsule.near.map(term => term.term)).toContain('trail capsule (formerly "dna")')
    expect(matchGlossary(sections, '   ')).toEqual({ exact: [], near: [] })
  })
})

describe('the plan', () => {
  it('lays a glossary tile, a tile per section, and a tile per term, parents first', () => {
    const plan = glossaryTilePlan(sections)
    expect(plan[0]).toEqual({ path: ['glossary'] })
    expect(plan).toHaveLength(1 + sections.length + terms.length)
    plan.forEach((entry, at) => {
      if (entry.path.length > 1) expect(plan.slice(0, at).some(earlier => earlier.path.join('/') === entry.path.slice(0, -1).join('/'))).toBe(true)
    })
  })

  it('gives every term a tile that carries the term and its definition as its note', () => {
    const plan = glossaryTilePlan(sections)
    for (const term of terms) {
      const entry = plan.find(candidate => candidate.term === term.term)
      expect(entry, term.term).toBeDefined()
      expect(entry!.path).toEqual(['glossary', sectionTileName({ title: term.section }), termTileName(term.term)])
      expect(entry!.note).toBe(`${term.term}: ${term.definition}`)
    }
    const signature = plan.find(entry => entry.term === 'signature')!
    expect(signature.path).toEqual(['glossary', 'glossary-foundational-terms', 'glossary-signature'])
    expect(signature.note).toContain('sha-256 hash')
  })

  it('names every tile to be its own: unique across the whole glossary, slug-safe, never a system name', () => {
    const plan = glossaryTilePlan(sections)
    const names = plan.map(entry => entry.path[entry.path.length - 1]!)
    expect(new Set(names).size).toBe(names.length)
    expect(names.every(name => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))).toBe(true)
    expect(names.filter(name => isSystemDirectoryName(name))).toEqual([])
    // Why the glossary's own word leads: the bare term would be refused.
    expect(isSystemDirectoryName('clipboard')).toBe(true)
    expect(names).toContain('glossary-clipboard')
  })

  it('is deterministic: the same glossary lays the same tiles, from the document or the baked module', () => {
    expect(JSON.stringify(glossaryTilePlan(parseGlossary(markdown)))).toBe(JSON.stringify(glossaryTilePlan(sections)))
    expect(glossaryTilePlan(parseGlossary(GLOSSARY_SOURCE))).toEqual(glossaryTilePlan(sections))
  })

  it('tells two terms that come out alike apart by a number, in the glossary\'s order', () => {
    const twin = parseGlossary('## one\n### link / unlink\nfirst.\n### link unlink\nsecond.\n### link-unlink\nthird.')
    const names = glossaryTilePlan(twin).filter(entry => entry.term).map(entry => entry.path[2])
    expect(names).toEqual(['glossary-link-unlink', 'glossary-link-unlink-2', 'glossary-link-unlink-3'])
  })
})

describe('laying it out', () => {
  it('creates every tile and notes every term and every section\'s prose', async () => {
    const w = world()
    const outcome = await makeGlossaryTiles(sections, w.deps)
    const noted = glossaryTilePlan(sections).filter(entry => entry.note !== undefined).length
    expect(noted).toBe(terms.length + sections.filter(section => section.intro).length)
    expect(outcome).toEqual({ ok: true, made: noted, kept: 0 })
    expect(w.created[0]).toBe('glossary')
    expect(w.created).toHaveLength(1 + sections.length + terms.length)
    expect([...w.notes.keys()].every(key => key.startsWith('page/glossary/glossary-'))).toBe(true)
  })

  it('says nothing twice: a term that already carries its note is left alone', async () => {
    const w = world()
    await makeGlossaryTiles(sections, w.deps)
    const again = await makeGlossaryTiles(sections, w.deps)
    expect(again).toMatchObject({ ok: true, made: 0 })
    expect([...w.notes.values()].every(list => list.length === 1)).toBe(true)
  })

  it('stops at a refused create and says why', async () => {
    const w = world()
    const rewound: GlossaryTileDeps = { ...w.deps, create: async () => { throw Object.assign(new Error('x'), { name: 'RewoundCommitError' }) } }
    expect(await makeGlossaryTiles(sections, rewound)).toEqual({ ok: false, reason: 'rewound' })
    const refused: GlossaryTileDeps = { ...w.deps, create: async () => { throw new Error('no room') } }
    expect(await makeGlossaryTiles(sections, refused)).toEqual({ ok: false, reason: 'refused', path: 'glossary', detail: 'no room' })
    expect(await makeGlossaryTiles(sections, null)).toEqual({ ok: false, reason: 'unloaded' })
  })
})

describe('answering a term', () => {
  it('looks on this page, then every page above it, then the root', () => {
    expect(termTileCandidates(['a', 'b'], ['glossary', 's', 't'])).toEqual([
      ['a', 'b', 'glossary', 's', 't'], ['a', 'glossary', 's', 't'], ['glossary', 's', 't'],
    ])
  })

  it('answers from the term\'s tile where it was laid, and from a page below it', async () => {
    const w = world(['page'])
    await makeGlossaryTiles(sections, w.deps)
    const reply = await answerGlossary(sections, 'sigbag', w.deps)
    expect(reply.answers).toHaveLength(1)
    expect(reply.answers[0]).toMatchObject({
      term: 'history bag (sigbag)',
      from: 'tile',
      at: ['page', 'glossary', 'glossary-foundational-terms', 'glossary-history-bag-sigbag'],
    })
    expect(reply.answers[0]!.notes[0]).toMatch(/^history bag \(sigbag\): an append-only sequence/)

    const below = await answerGlossary(sections, 'sigbag', { ...w.deps, segments: () => ['page', 'deeper', 'still'] })
    expect(below.answers[0]).toMatchObject({ from: 'tile', at: ['page', 'glossary', 'glossary-foundational-terms', 'glossary-history-bag-sigbag'] })
  })

  it('says what the tile says now, the participant\'s own notes included', async () => {
    const w = world([])
    await makeGlossaryTiles(sections, w.deps)
    await w.deps.addNote(['glossary', 'glossary-metaphor-layer'], 'glossary-hive', 'in our hive: the whole tree on this machine')
    const reply = await answerGlossary(sections, 'hive', w.deps)
    expect(reply.answers[0]!.from).toBe('tile')
    expect(reply.answers[0]!.notes).toHaveLength(2)
    expect(reply.answers[0]!.notes[1]).toBe('in our hive: the whole tree on this machine')
  })

  it('answers from the shipped glossary when no tile stands, and when the notes are not loaded', async () => {
    const w = world(['elsewhere'])
    const reply = await answerGlossary(sections, 'bee', w.deps)
    expect(reply.answers.map(answer => [answer.term, answer.from])).toEqual([['bee', 'glossary'], ['bee (architecture)', 'glossary']])
    expect(reply.answers[0]!.notes[0]).toMatch(/^bee: a participant in the hive/)
    expect((await answerGlossary(sections, 'drone', null)).answers[0]).toMatchObject({ term: 'drone', from: 'glossary' })
  })

  it('offers the terms that hold a word no term is named by', async () => {
    const reply = await answerGlossary(sections, 'capsule', world().deps)
    expect(reply.answers).toEqual([])
    expect(reply.near).toContain('trail capsule (formerly "dna")')
    expect((await answerGlossary(sections, 'zebra', null))).toEqual({ answers: [], near: [] })
  })
})
