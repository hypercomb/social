import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
})

const { harness } = await import('./harness.js')
const {
  EDITED_DEFAULT_NAME, harnessNoteText, harnessTexts, openHarnessTile, stopHarnessTiles, takeHarnessNotes,
} = await import('./harness-tiles.js')

const memoryStorage = () => {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
  }
}
const host = globalThis as { localStorage?: unknown }
beforeEach(() => { host.localStorage = memoryStorage() })
afterEach(() => { delete host.localStorage; stopHarnessTiles() })

type Note = { text: string; children?: Note[] }

/** A page with tiles, their notes, and what was said and opened. The tiles
 *  on the page and the notes at an address are kept APART, as the hive keeps
 *  them: a note can be there with no tile. */
const page = () => {
  const tiles = new Set<string>()
  const notes = new Map<string, Note[]>()
  const made: string[] = []
  const opened: string[] = []
  const said: { message: string; type: string }[] = []
  const key = (segments: readonly string[]) => segments.join('/')
  return {
    tiles, notes, made, opened, said,
    deps: {
      segments: () => ['workshop'],
      standsHere: async (parent: readonly string[], tile: string) => tiles.has(key([...parent, tile])),
      notesAt: async (segments: readonly string[]) => notes.get(key(segments)) ?? [],
      create: async (name: string) => { made.push(name); tiles.add(key(['workshop', name])) },
      addNote: async (parent: readonly string[], tile: string, text: string) => {
        const at = key([...parent, tile])
        notes.set(at, [...(notes.get(at) ?? []), { text }])
      },
      open: (tile: string) => { opened.push(tile) },
      say: (message: string, type: 'success' | 'warning') => { said.push({ message, type }) },
    },
  }
}

describe('a harness as a tile', () => {
  it('opens a record as a tile whose note is its JSON, once', async () => {
    await harness.seed()
    await harness.import({ kind: 'harness@1', name: 'quiet-reader', leg: { rounds: 4 } })
    const here = page()
    const record = harness.find('quiet-reader')!.record
    const opened = await openHarnessTile(record, here.deps)
    expect(opened).toMatchObject({ ok: true, tile: 'harness-quiet-reader', name: 'quiet-reader', made: true })
    expect(here.made).toEqual(['harness-quiet-reader'])
    expect(here.notes.get('workshop/harness-quiet-reader')?.[0].text).toBe(harnessNoteText(record))
    expect(here.opened).toEqual(['harness-quiet-reader'])

    // A second edit opens the tile as it stands: what is in it may be newer.
    await openHarnessTile(record, here.deps)
    expect(here.made).toEqual(['harness-quiet-reader'])
    expect(here.notes.get('workshop/harness-quiet-reader')).toHaveLength(1)
    expect(here.opened).toHaveLength(2)
  })

  it('opens the shipped default as a copy with a name of its own', async () => {
    await harness.seed()
    const here = page()
    const opened = await openHarnessTile(harness.find('default')!.record, here.deps)
    expect(opened).toMatchObject({ ok: true, tile: `harness-${EDITED_DEFAULT_NAME}`, name: EDITED_DEFAULT_NAME })
    expect(harness.find(EDITED_DEFAULT_NAME)?.record.leg.rounds).toBe(harness.find('default')!.record.leg.rounds)
  })

  it('says so when the notes are not loaded', async () => {
    await harness.seed()
    expect(await openHarnessTile(harness.active, null)).toEqual({ ok: false, error: 'the notes are not loaded' })
  })

  it('makes the tile when its notes are there but it is not on the page', async () => {
    await harness.seed()
    await harness.import({ kind: 'harness@1', name: 'outlived', leg: { rounds: 4 } })
    const here = page()
    const record = harness.find('outlived')!.record

    // Notes are shared by the word: another page's tile left them here.
    here.notes.set('workshop/harness-outlived', [{ text: harnessNoteText(record) }])
    const opened = await openHarnessTile(record, here.deps)
    expect(opened).toMatchObject({ ok: true, tile: 'harness-outlived', made: true })
    expect(here.made).toEqual(['harness-outlived'])
    expect(here.notes.get('workshop/harness-outlived')).toHaveLength(1)

    // Notes outlive a tile: removed from the page, it is made again.
    here.tiles.delete('workshop/harness-outlived')
    expect(await openHarnessTile(record, here.deps)).toMatchObject({ ok: true, made: true })
    expect(here.made).toEqual(['harness-outlived', 'harness-outlived'])
    expect(here.notes.get('workshop/harness-outlived')).toHaveLength(1)
  })

  it('a tile that stands without a record gets the note and is not made again', async () => {
    await harness.seed()
    await harness.import({ kind: 'harness@1', name: 'bare', leg: { rounds: 4 } })
    const here = page()
    here.tiles.add('workshop/harness-bare')
    const record = harness.find('bare')!.record
    expect(await openHarnessTile(record, here.deps)).toMatchObject({ ok: true, made: false })
    expect(here.made).toEqual([])
    expect(here.notes.get('workshop/harness-bare')?.[0].text).toBe(harnessNoteText(record))
  })

  it('a refused create is said, and no note is added for a tile that is not there', async () => {
    await harness.seed()
    await harness.import({ kind: 'harness@1', name: 'unmade', leg: { rounds: 4 } })
    const record = harness.find('unmade')!.record

    const past = page()
    past.deps.create = async () => { throw Object.assign(new Error('history cursor is rewound'), { name: 'RewoundCommitError' }) }
    const refused = await openHarnessTile(record, past.deps)
    expect(refused.ok).toBe(false)
    expect(refused).toMatchObject({ error: expect.stringContaining('viewing the past') })
    expect(past.notes.size).toBe(0)
    expect(past.opened).toEqual([])

    const broken = page()
    broken.deps.create = async () => { throw new Error('the command line is unavailable') }
    expect(await openHarnessTile(record, broken.deps)).toMatchObject({
      ok: false, error: expect.stringContaining('the command line is unavailable'),
    })
    expect(broken.notes.size).toBe(0)
    expect(broken.opened).toEqual([])
  })

  it('the note that stands keeps the name when the older copy is asked for again', async () => {
    await harness.seed()
    await harness.import({ kind: 'harness@1', name: 'steady', leg: { rounds: 4 } })
    const here = page()
    const asked = harness.find('steady')!.record
    const first = await openHarnessTile(asked, here.deps)
    here.notes.set('workshop/harness-steady', [{ text: harnessNoteText({ ...asked, leg: { ...asked.leg, rounds: 3 } }) }])
    await takeHarnessNotes(['workshop', 'harness-steady'], here.deps)

    // The copy first asked for is held, and older than the note: opening it
    // again opens the tile as it stands and leaves the name with the note.
    const again = await openHarnessTile(asked, here.deps)
    expect(again).toMatchObject({ ok: true, made: false })
    expect(first.ok && again.ok && again.sig !== first.sig).toBe(true)
    expect(harness.find('steady')?.record.leg.rounds).toBe(3)
    expect(here.notes.get('workshop/harness-steady')).toHaveLength(1)
  })
})

describe('an edited harness note', () => {
  it('finds a harness by its shape, nested or with curled quotes, and nothing else', () => {
    const curled = '{ “kind”: “harness@1”, “name”: “curly” }'
    const notes: Note[] = [
      { text: 'remember to tune the reads' },
      { text: '{"kind":"note","name":"not-one"}' },
      { text: 'a list', children: [{ text: '{"kind":"harness@1","name":"nested"}' }] },
      { text: curled },
    ]
    expect(harnessTexts(notes)).toEqual(['{"kind":"harness@1","name":"nested"}', curled])
  })

  it('brings the changed record in under its own signature, held, and says it once', async () => {
    await harness.seed()
    const here = page()
    const before = harness.activeSig
    here.notes.set('workshop/harness-careful', [{ text: JSON.stringify({ kind: 'harness@1', name: 'careful', leg: { rounds: 3 } }, null, 2) }])
    const taken = await takeHarnessNotes(['workshop', 'harness-careful'], here.deps)
    expect(taken.imported.map(entry => entry.name)).toEqual(['careful'])
    expect(harness.find('careful')?.record.leg.rounds).toBe(3)
    expect(harness.activeSig).toBe(before)
    expect(here.said).toHaveLength(1)
    expect(here.said[0]).toMatchObject({ type: 'success' })

    // The same bytes read again say nothing; an edit is a new record.
    await takeHarnessNotes(['workshop', 'harness-careful'], here.deps)
    expect(here.said).toHaveLength(1)
    here.notes.set('workshop/harness-careful', [{ text: JSON.stringify({ kind: 'harness@1', name: 'careful', leg: { rounds: 5 } }) }])
    const again = await takeHarnessNotes(['workshop', 'harness-careful'], here.deps)
    expect(again.imported).toHaveLength(1)
    expect(again.imported[0].sig).not.toBe(taken.imported[0].sig)
    expect(harness.find('careful')?.record.leg.rounds).toBe(5)
  })

  it('a note put back to what it read before is the named record again', async () => {
    await harness.seed()
    await harness.import({ kind: 'harness@1', name: 'put-back', leg: { rounds: 12 } })
    const here = page()
    const opened = await openHarnessTile(harness.find('put-back')!.record, here.deps)
    if (!opened.ok) throw new Error(opened.error)
    const at = `workshop/${opened.tile}`
    const original = here.notes.get(at)![0].text
    await takeHarnessNotes(['workshop', opened.tile], here.deps)
    expect(here.said).toEqual([])

    here.notes.set(at, [{ text: original.replace('"rounds": 12', '"rounds": 3') }])
    const edit = await takeHarnessNotes(['workshop', opened.tile], here.deps)
    expect(edit.imported).toHaveLength(1)
    expect(harness.find(opened.name)?.record.leg.rounds).toBe(3)
    expect(here.said).toHaveLength(1)

    // Reverted: nothing new is minted and nothing is said, but the name
    // answers what the note shows — not the edit it no longer holds.
    here.notes.set(at, [{ text: original }])
    const reverted = await takeHarnessNotes(['workshop', opened.tile], here.deps)
    expect(reverted.imported).toEqual([])
    expect(here.said).toHaveLength(1)
    expect(harness.find(opened.name)?.sig).toBe(opened.sig)
    expect(harness.find(opened.name)?.record.leg.rounds).toBe(12)
  })

  it('a save that did not touch the record leaves the name with the later save on another tile', async () => {
    await harness.seed()
    const here = page()
    const copy = (rounds: number) => JSON.stringify({ kind: 'harness@1', name: 'probe-two', leg: { rounds } })
    here.notes.set('first/harness-x', [{ text: copy(4) }])
    await takeHarnessNotes(['first', 'harness-x'], here.deps)
    here.notes.set('second/harness-x', [{ text: copy(6) }])
    await takeHarnessNotes(['second', 'harness-x'], here.deps)
    expect(harness.find('probe-two')?.record.leg.rounds).toBe(6)

    // A plain note beside the record is a save of the tile, not of the record.
    here.notes.set('first/harness-x', [{ text: copy(4) }, { text: 'remember to tune the reads' }])
    await takeHarnessNotes(['first', 'harness-x'], here.deps)
    expect(harness.find('probe-two')?.record.leg.rounds).toBe(6)

    // Changed and put back is: the text was not on the tile at its last read.
    here.notes.set('first/harness-x', [{ text: copy(5) }])
    await takeHarnessNotes(['first', 'harness-x'], here.deps)
    here.notes.set('second/harness-x', [{ text: copy(6) }, { text: 'still six' }])
    await takeHarnessNotes(['second', 'harness-x'], here.deps)
    expect(harness.find('probe-two')?.record.leg.rounds).toBe(5)
    here.notes.set('first/harness-x', [{ text: copy(4) }])
    await takeHarnessNotes(['first', 'harness-x'], here.deps)
    expect(harness.find('probe-two')?.record.leg.rounds).toBe(4)
  })

  it('opening the tile is a read of it: a later save beside its record does not take the name back', async () => {
    await harness.seed()
    await harness.import({ kind: 'harness@1', name: 'opened-first', leg: { rounds: 4 } })
    const here = page()
    const asked = harness.find('opened-first')!.record
    const opened = await openHarnessTile(asked, here.deps)
    if (!opened.ok) throw new Error(opened.error)
    await openHarnessTile(asked, here.deps)

    const elsewhere = JSON.stringify({ kind: 'harness@1', name: 'opened-first', leg: { rounds: 6 } })
    here.notes.set('elsewhere/harness-opened-first', [{ text: elsewhere }])
    await takeHarnessNotes(['elsewhere', 'harness-opened-first'], here.deps)
    expect(harness.find('opened-first')?.record.leg.rounds).toBe(6)

    const at = `workshop/${opened.tile}`
    here.notes.set(at, [...here.notes.get(at)!, { text: 'a thought, not a record' }])
    await takeHarnessNotes(['workshop', opened.tile], here.deps)
    expect(harness.find('opened-first')?.record.leg.rounds).toBe(6)
  })

  it('an older copy opened as a tile takes the name when its note lands', async () => {
    await harness.seed()
    const older = await harness.import({ kind: 'harness@1', name: 'asked-by-sig', leg: { rounds: 12 } })
    await harness.import({ kind: 'harness@1', name: 'asked-by-sig', leg: { rounds: 3 } })
    const here = page()
    const opened = await openHarnessTile(harness.find(older)!.record, here.deps)
    expect(opened).toMatchObject({ ok: true, sig: older, made: true })

    // The note being added is the save; the read it wakes names the record.
    await takeHarnessNotes(['workshop', 'harness-asked-by-sig'], here.deps)
    expect(harness.find('asked-by-sig')?.sig).toBe(older)
    expect(here.said).toEqual([])
  })

  it('answers the edit when the tile keeps an older copy of the same name below it', async () => {
    await harness.seed()
    const here = page()
    const copy = (rounds: number) => JSON.stringify({ kind: 'harness@1', name: 'kept', leg: { rounds } })
    here.notes.set('workshop/harness-kept', [{ text: copy(4) }, { text: copy(6) }])
    await takeHarnessNotes(['workshop', 'harness-kept'], here.deps)
    here.notes.set('workshop/harness-kept', [{ text: copy(5) }, { text: copy(6) }])
    await takeHarnessNotes(['workshop', 'harness-kept'], here.deps)
    expect(harness.find('kept')?.record.leg.rounds).toBe(5)
  })

  it('a refusal is said once, however often the tile is saved', async () => {
    await harness.seed()
    const here = page()
    here.notes.set('workshop/harness-loud', [{ text: '{"kind":"harness@1","name":"loud","review":{"auto":["write"]}}' }])
    expect((await takeHarnessNotes(['workshop', 'harness-loud'], here.deps)).refused).toHaveLength(1)
    expect((await takeHarnessNotes(['workshop', 'harness-loud'], here.deps)).refused).toHaveLength(1)
    expect(here.said).toHaveLength(1)
  })

  it('refuses a note that widens or does not parse, and says why', async () => {
    await harness.seed()
    const here = page()
    here.notes.set('workshop/harness-bold', [
      { text: '{"kind":"harness@1","name":"bold","review":{"auto":["do"]}}' },
      { text: '{"kind":"harness@1","name":"broken",' },
    ])
    const taken = await takeHarnessNotes(['workshop', 'harness-bold'], here.deps)
    expect(taken.imported).toEqual([])
    expect(taken.refused).toHaveLength(2)
    expect(here.said.every(entry => entry.type === 'warning')).toBe(true)
    expect(harness.find('bold')).toBeUndefined()
  })
})
