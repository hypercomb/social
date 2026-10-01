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

/** A page with tiles, their notes, and what was said and opened. */
const page = () => {
  const notes = new Map<string, Note[]>()
  const made: string[] = []
  const opened: string[] = []
  const said: { message: string; type: string }[] = []
  const key = (segments: readonly string[]) => segments.join('/')
  return {
    notes, made, opened, said,
    deps: {
      segments: () => ['workshop'],
      notesAt: async (segments: readonly string[]) => notes.get(key(segments)) ?? [],
      create: async (name: string) => { made.push(name) },
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
