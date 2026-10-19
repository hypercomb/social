import { describe, expect, it } from 'vitest'
import {
  EMPTY_DOC, addCategory, categoryDocJson, countUnder, fileNote, filedNotes, flattenCategories, mergeOutline,
  parseOutline, readCategoryDoc, removeCategory, renameCategory, roomCategories, unfileNote,
} from './note-categories.js'
import { jevSortInput, jevSortQuestions, jevSortResult } from '../assistant/jev-sort.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')

describe('the category tree of a tile\'s notes', () => {
  it('adds categories by name, one per folded word on a level', () => {
    let { doc, path } = addCategory(EMPTY_DOC, [], 'Energy')
    expect(path).toEqual([0])
    const again = addCategory(doc, [], ' energy ')
    expect(again.path).toEqual([0])
    expect(again.doc).toBe(doc)
    ;({ doc, path } = addCategory(doc, [0], 'Krebs cycle'))
    expect(path).toEqual([0, 0])
    expect(flattenCategories(doc).map(c => c.label)).toEqual(['Energy', 'Energy › Krebs cycle'])
  })

  it('files a note in one place, and moving it takes it out of the last', () => {
    let doc = mergeOutline(EMPTY_DOC, [{ name: 'Energy', children: [{ name: 'Krebs', children: [] }] }, { name: 'Cells', children: [] }])
    doc = fileNote(doc, [0, 0], sig(1))
    expect(filedNotes(doc).get(sig(1))).toEqual([0, 0])
    doc = fileNote(doc, [1], sig(1))
    expect(filedNotes(doc).get(sig(1))).toEqual([1])
    expect(doc.categories[0].children[0].notes).toEqual([])
    doc = unfileNote(doc, sig(1))
    expect(filedNotes(doc).size).toBe(0)
  })

  it('refuses a note that is not a signature, and a path that is not there', () => {
    const doc = mergeOutline(EMPTY_DOC, [{ name: 'A', children: [] }])
    expect(fileNote(doc, [0], 'nope')).toBe(doc)
    expect(fileNote(doc, [3], sig(2))).toBe(doc)
  })

  it('removing a category unfiles its notes and loses none of them', () => {
    let doc = mergeOutline(EMPTY_DOC, [{ name: 'A', children: [{ name: 'B', children: [] }] }])
    doc = fileNote(doc, [0, 0], sig(3))
    doc = removeCategory(doc, [0])
    expect(doc.categories).toEqual([])
    expect(filedNotes(doc).size).toBe(0)
  })

  it('a suggestion only adds: what is filed stays filed', () => {
    let doc = mergeOutline(EMPTY_DOC, [{ name: 'Energy', children: [] }])
    doc = fileNote(doc, [0], sig(4))
    doc = mergeOutline(doc, [{ name: 'energy', children: [{ name: 'ATP', children: [] }] }, { name: 'Genetics', children: [] }])
    expect(flattenCategories(doc).map(c => c.label)).toEqual(['Energy', 'Energy › ATP', 'Genetics'])
    expect(filedNotes(doc).get(sig(4))).toEqual([0])
  })

  it('rename refuses a sibling\'s name', () => {
    const doc = mergeOutline(EMPTY_DOC, [{ name: 'A', children: [] }, { name: 'B', children: [] }])
    expect(renameCategory(doc, [1], 'a')).toBe(doc)
    expect(renameCategory(doc, [1], 'C').categories[1].name).toBe('C')
  })

  it('canonical bytes survive a round trip and sign the same', () => {
    let doc = mergeOutline(EMPTY_DOC, [{ name: 'X', children: [{ name: 'Y', children: [] }] }])
    doc = fileNote(doc, [0, 0], sig(5))
    const json = categoryDocJson(doc)
    expect(categoryDocJson(readCategoryDoc(JSON.parse(json))!)).toBe(json)
  })

  it('reads a document tolerantly: bad notes dropped, twins merged, a note filed once', () => {
    const doc = readCategoryDoc({
      categories: [
        { name: 'A', notes: [sig(6), 'junk'], children: [] },
        { name: 'a', notes: [sig(6), sig(7)] },
        { notes: [] },
      ],
    })!
    expect(doc.categories.length).toBe(1)
    expect(doc.categories[0].notes).toEqual([sig(6), sig(7)])
    expect(readCategoryDoc({})).toBeNull()
  })

  it('counts a branch by the notes still on the tile', () => {
    let doc = mergeOutline(EMPTY_DOC, [{ name: 'A', children: [{ name: 'B', children: [] }] }])
    doc = fileNote(doc, [0], sig(8))
    doc = fileNote(doc, [0, 0], sig(9))
    doc = fileNote(doc, [0, 0], sig(10))
    expect(countUnder(doc.categories[0], new Set([sig(8), sig(9)]))).toBe(2)
  })

  it('parses an AI\'s outline as JSON, fenced JSON, or an indented list', () => {
    expect(parseOutline('[{"name":"Energy","children":[{"name":"ATP"}]},"Cells"]')).toEqual([
      { name: 'Energy', children: [{ name: 'ATP', children: [] }] }, { name: 'Cells', children: [] },
    ])
    expect(parseOutline('Here you go:\n```json\n{"categories":[{"title":"A"}]}\n```')).toEqual([{ name: 'A', children: [] }])
    expect(parseOutline('- Energy\n  - **ATP**\n  - Krebs\n- Cells')).toEqual([
      { name: 'Energy', children: [{ name: 'ATP', children: [] }, { name: 'Krebs', children: [] }] },
      { name: 'Cells', children: [] },
    ])
    expect(parseOutline('no outline here')).toEqual([])
  })

  it('the room counts a category by how many people hold it', () => {
    const mine = mergeOutline(EMPTY_DOC, [{ name: 'Energy', children: [] }])
    const peers = [
      { pubkey: 'p1', doc: mergeOutline(EMPTY_DOC, [{ name: 'energy', children: [] }, { name: 'Genetics', children: [] }]) },
      { pubkey: 'p2', doc: mergeOutline(EMPTY_DOC, [{ name: 'Genetics', children: [] }, { name: 'Energy', children: [] }]) },
      { pubkey: 'p3', doc: mergeOutline(EMPTY_DOC, [{ name: 'Genetics', children: [{ name: 'DNA', children: [] }] }]) },
    ]
    expect(roomCategories(mine, peers)).toEqual([
      { key: 'energy', name: 'Energy', holders: 3, mine: true },
      { key: 'genetics', name: 'Genetics', holders: 3, mine: false },
    ])
    expect(roomCategories(mine, peers, ['genetics'])).toEqual([{ key: 'dna', name: 'DNA', holders: 1, mine: false }])
  })
})

describe('Jev sorts notes into categories', () => {
  const input = jevSortInput({ notes: ['ATP is made in mitochondria', 'DNA is a double helix', 'the room is cold'], categories: ['Energy', 'Genetics'] })

  it('asks one choice per note over the shared labels', () => {
    const q = jevSortQuestions(input)
    expect(Object.keys(q)).toEqual(['n0', 'n1', 'n2'])
    expect(q['n0'].criteria).toEqual({ c0: 'Energy', c1: 'Genetics', none: expect.any(String) })
    expect(q['n1'].instructions).toContain('DNA is a double helix')
  })

  it('files only what Jev is sure of', () => {
    const r = jevSortResult({ answers: {
      n0: { type: 'choice', choice: 'c0', confidence: 0.9 },
      n1: { type: 'choice', choice: 'c1', confidence: 0.4 },
      n2: { type: 'choice', choice: 'none', confidence: 0.95 },
    } }, input)
    expect(r.placed).toEqual([0, -1, -1])
  })

  it('refuses an empty or oversized batch', () => {
    expect(() => jevSortInput({ notes: [], categories: ['A'] })).toThrow()
    expect(() => jevSortInput({ notes: ['x'], categories: [] })).toThrow()
  })
})
