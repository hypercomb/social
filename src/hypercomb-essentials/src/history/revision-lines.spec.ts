// revision-lines.spec.ts — named revisions and the steps under each name:
// the build records read as lines, and the three acts (save, open, discard)
// run against the real builds slot over one small tile.

import { beforeEach, describe, expect, it } from 'vitest'

const registrations = new Map<string, unknown>()
const ioc = {
  register: (key: string, value: unknown) => registrations.set(key, value),
  get: (key: string) => registrations.get(key),
}
;(globalThis as unknown as { window: unknown }).window = { ioc }
;(globalThis as unknown as { ioc: unknown }).ioc = ioc

const { SignatureService } = await import('@hypercomb/core')
const { readBuildsAt } = await import('./builds-slot.js')
const {
  currentLine, discardChanges, lineAt, openRevision, readRevisions, revisionLines, saveRevision, stepOf,
} = await import('./revision-lines.js')

const sig = (n: number): string => n.toString(16).padStart(64, '0')
const record = (label: string, seal: number, at: number) => ({ seal: sig(seal), label, at })

describe('the build records, read as lines', () => {
  const records = [
    record('red theme', 1, 100), record('red theme', 2, 200),
    record('blue theme', 3, 300), record('Red Theme', 2, 400),
  ]

  it('groups the records that share a name, each a step, the line last touched first', () => {
    const lines = revisionLines(records)
    expect(lines.map(line => [line.name, line.steps.map(step => step.seal), line.at])).toEqual([
      ['Red Theme', [sig(1), sig(2)], 400],
      ['blue theme', [sig(3)], 300],
    ])
  })

  it('a revision opened again moves its line and adds no step', () => {
    const lines = revisionLines(records)
    expect(lines[0]!.steps).toHaveLength(2)
    expect(stepOf(lines, records[3]!)).toBe(2)
    expect(stepOf(lines, record('blue theme', 3, 0))).toBe(1)
    expect(stepOf(lines, record('green', 9, 0))).toBe(0)
  })

  it('the newest record names the line in hand', () => {
    expect(currentLine(records)).toBe('Red Theme')
    expect(currentLine(records.slice(0, 3))).toBe('blue theme')
    expect(currentLine([])).toBe('')
  })

  it('says which line was in hand at a moment, and gives the first line everything before it', () => {
    expect(lineAt(records, 50)).toBe('red theme')
    expect(lineAt(records, 250)).toBe('red theme')
    expect(lineAt(records, 300)).toBe('blue theme')
    expect(lineAt(records, 399)).toBe('blue theme')
    expect(lineAt(records, 9_999)).toBe('Red Theme')
    expect(lineAt([], 5)).toBe('')
  })
})

// ── one tile, with the services the builds slot asks for ────────────────────

type Layer = Record<string, unknown> & { name: string }
const HERE = ['card']
let live: Layer
let layers: Map<string, Layer>
let resources: Map<string, string>

const sign = async (value: unknown): Promise<string> =>
  SignatureService.sign(new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer)

/** What the card "holds": one content slot, changed to make an edit. */
const edit = (page: number): void => { live = { ...live, website: [sig(page)] } }
const page = (): unknown => (live['website'] as string[])[0]

beforeEach(() => {
  live = { name: 'card', website: [sig(0xa1)] }
  layers = new Map()
  resources = new Map()
  registrations.clear()
  registrations.set('@diamondcoreprocessor.com/HistoryService', {
    sign: async () => 'loc',
    currentLayerAt: async () => live,
    sealSubtree: async () => { const seal = await sign(live); layers.set(seal, { ...live }); return seal },
    getLayerBySig: async (seal: string) => layers.get(seal) ?? null,
    latestMarkerSigFor: async () => sign(live),
    commitLayer: async (_loc: string, layer: Layer) => { live = { ...layer }; return sign(live) },
  })
  registrations.set('@hypercomb.social/Store', {
    // The test environment's Blob has no text(): read it with a FileReader,
    // and hand back the one method the slot calls.
    putResource: async (blob: Blob) => {
      const text = await new Promise<string>(resolve => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.readAsText(blob)
      })
      const at = await sign(text)
      resources.set(at, text)
      return at
    },
    getResource: async (at: string) => resources.has(at) ? { text: async () => resources.get(at)! } : null,
  })
  registrations.set('@diamondcoreprocessor.com/LayerCommitter', {
    commitSlotAppend: async (_segments: readonly string[], slot: string, at: string) => {
      live = { ...live, [slot]: [...((live[slot] as string[] | undefined) ?? []), at] }
    },
  })
})

const names = async (): Promise<string[]> => (await readBuildsAt(HERE)).map(entry => entry.label)

describe('saving', () => {
  it('needs a name the first time, and only then', async () => {
    expect(await saveRevision(HERE)).toMatchObject({ ok: false, needsName: true })
    expect(await saveRevision(HERE, 'red theme')).toMatchObject({ ok: true, name: 'red theme', step: 1, unchanged: false })
    edit(0xa2)
    expect(await saveRevision(HERE)).toMatchObject({ ok: true, name: 'red theme', step: 2 })
    expect(await names()).toEqual(['red theme', 'red theme'])
  })

  it('records nothing when nothing changed', async () => {
    await saveRevision(HERE, 'red theme')
    expect(await saveRevision(HERE)).toMatchObject({ ok: true, name: 'red theme', step: 1, unchanged: true })
    expect(await names()).toEqual(['red theme'])
  })

  it('a new name starts a new line, from an unchanged card too', async () => {
    await saveRevision(HERE, 'red theme')
    expect(await saveRevision(HERE, 'blue theme')).toMatchObject({ ok: true, name: 'blue theme', step: 1, unchanged: false })
    edit(0xb1)
    expect(await saveRevision(HERE)).toMatchObject({ ok: true, name: 'blue theme', step: 2 })
    const state = await readRevisions(HERE)
    expect(state.current).toBe('blue theme')
    expect(state.lines.map(line => [line.name, line.steps.length])).toEqual([['blue theme', 2], ['red theme', 1]])
  })

  it('knows when the card holds changes no step does', async () => {
    expect((await readRevisions(HERE)).dirty).toBe(false)
    await saveRevision(HERE, 'red theme')
    expect((await readRevisions(HERE)).dirty).toBe(false)
    edit(0xa2)
    expect((await readRevisions(HERE)).dirty).toBe(true)
  })
})

describe('opening another revision', () => {
  it('saves the card as it stands first, as a step of the line being left', async () => {
    await saveRevision(HERE, 'red theme')
    const red = (await readBuildsAt(HERE))[0]!
    edit(0xb1)
    await saveRevision(HERE, 'blue theme')
    edit(0xb2)                                    // unsaved work on blue

    expect(await openRevision(HERE, red)).toMatchObject({ ok: true, name: 'red theme' })
    expect(page()).toBe(sig(0xa1))
    const state = await readRevisions(HERE)
    expect(state.current).toBe('red theme')
    expect(state.dirty).toBe(false)
    // blue kept the unsaved work as its second step; red gained no step.
    expect(state.lines.map(line => [line.name, line.steps.length])).toEqual([['red theme', 1], ['blue theme', 2]])

    const blue = state.lines[1]!.steps.at(-1)!
    await openRevision(HERE, blue)
    expect(page()).toBe(sig(0xb2))
    expect((await readRevisions(HERE)).current).toBe('blue theme')
  })

  it('keeps every revision in the list when an older one is opened', async () => {
    await saveRevision(HERE, 'red theme')
    const red = (await readBuildsAt(HERE))[0]!
    edit(0xb1)
    await saveRevision(HERE, 'blue theme')
    await openRevision(HERE, red)
    expect((await readRevisions(HERE)).lines.map(line => line.name).sort()).toEqual(['blue theme', 'red theme'])
  })

  it('an earlier step of the same line can be opened, and work goes on from it', async () => {
    await saveRevision(HERE, 'red theme')
    const first = (await readBuildsAt(HERE))[0]!
    edit(0xa2)
    await saveRevision(HERE)
    await openRevision(HERE, first)
    expect(page()).toBe(sig(0xa1))
    edit(0xa3)
    expect(await saveRevision(HERE)).toMatchObject({ ok: true, name: 'red theme', step: 3 })
  })

  it('opens nothing over work that could not be saved', async () => {
    await saveRevision(HERE, 'red theme')
    const red = (await readBuildsAt(HERE))[0]!
    edit(0xa2)
    const history = registrations.get('@diamondcoreprocessor.com/HistoryService') as { sealSubtree: () => Promise<string | null> }
    history.sealSubtree = async () => null
    expect(await openRevision(HERE, red)).toMatchObject({ ok: false })
    expect(page()).toBe(sig(0xa2))
  })

  it('says so when the revision is not held here', async () => {
    await saveRevision(HERE, 'red theme')
    expect(await openRevision(HERE, { seal: sig(0xdead), label: 'gone' })).toEqual({ ok: false, error: 'that revision is not held on this device' })
    expect((await readRevisions(HERE)).current).toBe('red theme')
  })
})

describe('discarding', () => {
  it('goes back to the last step saved, and saves nothing', async () => {
    await saveRevision(HERE, 'red theme')
    edit(0xa2)
    await saveRevision(HERE)
    edit(0xa9)
    expect(await discardChanges(HERE)).toMatchObject({ ok: true, name: 'red theme' })
    expect(page()).toBe(sig(0xa2))
    const state = await readRevisions(HERE)
    expect(state.dirty).toBe(false)
    expect(state.lines.map(line => [line.name, line.steps.length])).toEqual([['red theme', 2]])
  })

  it('has nothing to go back to before the first save', async () => {
    expect(await discardChanges(HERE)).toMatchObject({ ok: false })
  })
})
