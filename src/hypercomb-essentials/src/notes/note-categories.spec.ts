import { describe, expect, it } from 'vitest'
import {
  EMPTY_DOC, addCategory, addPerson, categoryDocJson, clearPerson, countUnder, exploreGroups, fileNote, filedNotes, flattenCategories, mergeOutline,
  parseOutline, placeNames, placeToGo, readCategoryDoc, readPlaceLine, removeCategory, removePerson, renameCategory, roomCategories, unfileNote,
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

  it('adds a person to any group and to many, and a note still has one place', () => {
    let doc = mergeOutline(EMPTY_DOC, [{ name: 'Energy', children: [] }, { name: 'Cells', children: [] }])
    expect(categoryDocJson(doc)).not.toContain('people')
    const once = addPerson(doc, [0], 'self')
    expect(addPerson(once, [0], 'self')).toBe(once)
    expect(addPerson(once, [0], 'nope')).toBe(once)
    doc = addPerson(once, [1], 'self')
    doc = addPerson(doc, [1], sig(4))
    expect(doc.categories[0].people).toEqual(['self'])
    expect(doc.categories[1].people).toEqual(['self', sig(4)])
    const round = readCategoryDoc(JSON.parse(categoryDocJson(doc)))
    expect(round?.categories[0].people).toEqual(['self'])
    expect(round?.categories[1].people).toEqual(['self', sig(4)])
    doc = removePerson(doc, [1], 'self')
    expect(doc.categories[0].people).toEqual(['self'])
    expect(doc.categories[1].people).toEqual([sig(4)])
    doc = clearPerson(doc, 'self')
    expect(doc.categories[0].people ?? []).toEqual([])
    expect(doc.categories[1].people).toEqual([sig(4)])
    doc = fileNote(doc, [0], sig(1))
    doc = fileNote(doc, [1], sig(1))
    expect(filedNotes(doc).get(sig(1))).toEqual([1])
    expect(doc.categories[1].people).toEqual([sig(4)])
  })

  it('walks groups in tree order, a child apart from its parent, unsorted last', () => {
    let doc = mergeOutline(EMPTY_DOC, [
      { name: 'Energy', children: [{ name: 'Krebs', children: [] }] },
      { name: 'Cells', children: [] },
    ])
    doc = fileNote(doc, [0], sig(1))
    doc = fileNote(doc, [0, 0], sig(2))
    const notes = [
      { id: sig(1), text: 'mitochondria' },
      { id: sig(2), text: 'cycle' },
      { id: sig(3), text: 'not filed' },
    ]
    expect(exploreGroups(doc, notes)).toEqual([
      { key: '0', name: 'Energy', notes: ['mitochondria'] },
      { key: '0.0', name: 'Krebs', notes: ['cycle'] },
      { key: '1', name: 'Cells', notes: [] },
      { key: 'unsorted', name: 'Unsorted', notes: ['not filed'] },
    ])
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

describe('categories settle by count', () => {
  const tree = (...names: (string | [string, string[]])[]) => mergeOutline(EMPTY_DOC, names.map(n => typeof n === 'string'
    ? { name: n, children: [] }
    : { name: n[0], children: n[1].map(c => ({ name: c, children: [] })) }))

  it('needs two holders, and half the room', async () => {
    const { settleThreshold } = await import('./note-categories.js')
    expect(settleThreshold(1)).toBe(2)
    expect(settleThreshold(3)).toBe(2)
    expect(settleThreshold(4)).toBe(2)
    expect(settleThreshold(5)).toBe(3)
    expect(settleThreshold(10)).toBe(5)
  })

  it('a category enough people hold settles, nested as the room holds it', async () => {
    const { settledOutline } = await import('./note-categories.js')
    const mine = tree(['Energy', ['ATP']], 'Cells')
    const peers = [
      { pubkey: 'p1', doc: tree(['energy', ['ATP', 'Krebs']]) },
      { pubkey: 'p2', doc: tree(['Energy', ['Krebs']], 'Genetics') },
      { pubkey: 'p3', doc: tree('Genetics') },
    ]
    // 4 people: two holders settle.
    expect(settledOutline(mine, peers, 4)).toEqual([
      { name: 'Energy', children: [{ name: 'ATP', children: [] }, { name: 'Krebs', children: [] }] },
      { name: 'Genetics', children: [] },
    ])
    // 8 people: four holders needed — only Energy (three) does not make it.
    expect(settledOutline(mine, peers, 8)).toEqual([])
  })
})

describe('a command line places a note', () => {
  const place = (raw: string) => readPlaceLine(raw)

  it('files a line where you are, and a slash steps in', () => {
    expect(place('')).toBeNull()
    expect(place('   ')).toBeNull()
    expect(place('atp')).toEqual({ absolute: false, root: false, categories: [], note: 'atp' })
    expect(place('energy/atp')).toEqual({ absolute: false, root: false, categories: ['energy'], note: 'atp' })
    expect(place('a/b/note')).toEqual({ absolute: false, root: false, categories: ['a', 'b'], note: 'note' })
    expect(place('energy/')).toEqual({ absolute: false, root: false, categories: ['energy'], note: null })
    expect(place('energy/atp/')).toEqual({ absolute: false, root: false, categories: ['energy', 'atp'], note: null })
    expect(place('/')).toEqual({ absolute: true, root: true, categories: [], note: null })
    expect(place('/atp')).toEqual({ absolute: true, root: true, categories: [], note: 'atp' })
    expect(place('/energy/atp')).toEqual({ absolute: true, root: false, categories: ['energy'], note: 'atp' })
    expect(place('a//b')).toEqual({ absolute: false, root: false, categories: [], note: 'a/b' })
    expect(place('a///b')).toEqual({ absolute: false, root: false, categories: ['a/'], note: 'b' })
    expect(place('cost 1//2/')).toEqual({ absolute: false, root: false, categories: ['cost 1/2'], note: null })
    expect(place('hello//')).toEqual({ absolute: false, root: false, categories: [], note: 'hello/' })
    expect(place('//')).toEqual({ absolute: false, root: false, categories: [], note: '/' })
    expect(place(' energy / atp ')).toEqual({ absolute: false, root: false, categories: ['energy'], note: 'atp' })
  })

  it('escape finishes the line as a place', () => {
    expect(placeToGo(place('energy/atp')!)).toEqual({ absolute: false, root: false, categories: ['energy', 'atp'], note: null })
    expect(placeToGo(place('energy/')!)).toEqual(place('energy/'))
    expect(placeToGo(place('/')!)).toEqual(place('/'))
    expect(placeToGo(place('a//b')!)).toEqual({ absolute: false, root: false, categories: ['a/b'], note: null })
  })

  it('stops when the tree cannot go deeper and keeps the last category that worked', () => {
    const { doc, path } = placeNames(EMPTY_DOC, [], ['a', 'b', 'c', 'd'])
    expect(path).toEqual([0, 0, 0])
    expect(flattenCategories(doc).map(c => c.name)).toEqual(['a', 'b', 'c'])
    const again = placeNames(doc, [], ['a', 'b'])
    expect(again.path).toEqual([0, 0])
    expect(again.doc).toBe(doc)
  })
})

describe('asking an agent to look through the groups', () => {
  it('does not call out when no AI may read the notes', async () => {
    const { NoteCategories } = await import('./note-categories.service.js')
    const cats = new NoteCategories()
    const outcome = await cats.explore('lecture', [{ id: sig(1), text: 'mitochondria' }], 'what is here')
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('no-ai')
  })
})
