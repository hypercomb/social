// Giving a tile a name: the title decoration written by `setTitle`.
//
// The name is the tile's reading in one language and never its address. These
// specs pin the three ways a rename used to go missing: two overlapping writes
// left two records (the heading read the first, the hive the last), a sibling
// that already read the same way was found by a slow sequential scan, and a
// title written under one locale key was looked up under another.

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Slot = Array<{ sig: string; record: { kind: string; payload: { text?: Record<string, string> } } }>

const world = vi.hoisted(() => ({
  slots: new Map<string, unknown[]>(),
  indexed: new Map<string, string>(),
  seq: 0,
  siblings: [] as string[],
  readsInFlight: 0,
  maxReadsInFlight: 0,
}))

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = { get: () => undefined, register: () => {}, whenReady: () => {} }
})

vi.mock('./decoration-manifest.js', () => ({
  listDecorations: vi.fn(async ({ segments }: { segments: readonly string[] }) => {
    world.readsInFlight++
    world.maxReadsInFlight = Math.max(world.maxReadsInFlight, world.readsInFlight)
    await new Promise(resolve => setTimeout(resolve, 2))
    world.readsInFlight--
    return [...((world.slots.get(segments.join('/')) ?? []) as Slot)]
  }),
  writeDecoration: vi.fn(async ({ segments, payload, kind }: { segments: readonly string[]; payload: { text?: Record<string, string> }; kind: string }) => {
    // A slow write is what lets a second call read the old slot.
    await new Promise(resolve => setTimeout(resolve, 5))
    const key = segments.join('/')
    const sig = `sig-${++world.seq}`
    world.slots.set(key, [...(world.slots.get(key) ?? []), { sig, record: { kind, payload } }])
    return sig
  }),
  removeDecoration: vi.fn(({ sig, segments }: { sig: string; segments: readonly string[] }) => {
    const key = segments.join('/')
    world.slots.set(key, ((world.slots.get(key) ?? []) as Slot).filter(entry => entry.sig !== sig))
  }),
}))

vi.mock('./decoration-kind-index.js', () => ({
  TAG_DECORATION_KIND: 'tag',
  TITLE_DECORATION_KIND: 'title',
  tagSigFor: () => undefined,
  activeTitleLocale: () => 'en',
  titleForSegments: (segments: readonly string[], locale: string) =>
    world.indexed.get(`${segments.join('/')}|${locale}`) ?? '',
}))

import { DecorationService } from './decoration.service.js'

const history = (names: string[]) => ({
  sign: async () => 'parent-sig',
  currentLayerAt: async () => ({ children: names.map(name => `layer-${name}`) }),
  getLayerBySig: async (sig: string) => ({ name: sig.replace('layer-', '') }),
})

const records = (segments: string[]): Slot => (world.slots.get(segments.join('/')) ?? []) as Slot

beforeEach(() => {
  world.slots.clear()
  world.indexed.clear()
  world.seq = 0
  world.readsInFlight = 0
  world.maxReadsInFlight = 0
  ;(window as unknown as { ioc: { get: (key: string) => unknown } }).ioc.get = (key: string) =>
    key === '@diamondcoreprocessor.com/HistoryService' ? history(world.siblings) : undefined
  world.siblings = []
})

describe('setTitle', () => {
  it('writes one record and reports it', async () => {
    const decorations = new DecorationService()
    expect(await decorations.setTitle(['bravo'], 'Second Reading')).toBe('set')
    expect(records(['bravo'])).toHaveLength(1)
    expect(records(['bravo'])[0].record.payload.text).toEqual({ en: 'Second Reading' })
  })

  it('keeps ONE record when two writes overlap, and the last one wins', async () => {
    const decorations = new DecorationService()
    await Promise.all([
      decorations.setTitle(['bravo'], 'Race A'),
      decorations.setTitle(['bravo'], 'Race B'),
    ])
    const slot = records(['bravo'])
    expect(slot).toHaveLength(1)
    expect(slot[0].record.payload.text).toEqual({ en: 'Race B' })
    expect(await decorations.titleOf(['bravo'])).toBe('Race B')
  })

  it('does not let two siblings take the same words at once', async () => {
    world.siblings = ['alpha', 'bravo']
    const decorations = new DecorationService()
    const [first, second] = await Promise.all([
      decorations.setTitle(['alpha'], 'Jazz'),
      decorations.setTitle(['bravo'], 'jazz'),
    ])
    // The second runs after the first has landed, so it sees the clash.
    world.indexed.set('alpha|en', 'Jazz')
    expect(first).toBe('set')
    expect(second).toBe('duplicate')
    expect(records(['alpha'])).toHaveLength(1)
  })

  it('keeps the other languages when one is retitled', async () => {
    const decorations = new DecorationService()
    await decorations.setTitle(['bravo'], 'Jazz', 'en')
    await decorations.setTitle(['bravo'], 'ジャズ', 'ja')
    const slot = records(['bravo'])
    expect(slot).toHaveLength(1)
    expect(slot[0].record.payload.text).toEqual({ en: 'Jazz', ja: 'ジャズ' })
  })

  it('is a no-op when the words are unchanged', async () => {
    const decorations = new DecorationService()
    await decorations.setTitle(['bravo'], 'Jazz')
    expect(await decorations.setTitle(['bravo'], '  Jazz ')).toBe('noop')
    expect(records(['bravo'])).toHaveLength(1)
  })

  it('clears a language and drops the record once none is left', async () => {
    const decorations = new DecorationService()
    await decorations.setTitle(['bravo'], 'Jazz')
    expect(await decorations.setTitle(['bravo'], '')).toBe('cleared')
    expect(records(['bravo'])).toHaveLength(0)
  })

  it('a failed write does not wedge the lane for the next one', async () => {
    const decorations = new DecorationService()
    const manifest = await import('./decoration-manifest.js')
    vi.mocked(manifest.writeDecoration).mockRejectedValueOnce(new Error('disk said no'))
    await expect(decorations.setTitle(['bravo'], 'First')).rejects.toThrow('disk said no')
    expect(await decorations.setTitle(['bravo'], 'Second')).toBe('set')
  })
})

describe('duplicateTitle', () => {
  it('names the sibling that already reads that way, ignoring case', async () => {
    world.siblings = ['alpha', 'bravo', 'charlie']
    world.indexed.set('alpha|en', 'Jazz')
    const decorations = new DecorationService()
    expect(await decorations.duplicateTitle(['charlie'], ' jazz ')).toEqual({ reading: 'Jazz', address: 'alpha' })
    expect(await decorations.setTitle(['charlie'], 'JAZZ')).toBe('duplicate')
  })

  it('counts a sibling simply NAMED the same', async () => {
    world.siblings = ['jazz', 'charlie']
    const decorations = new DecorationService()
    expect(await decorations.duplicateTitle(['charlie'], 'Jazz')).toEqual({ reading: 'jazz', address: 'jazz' })
  })

  it('never calls an empty title a duplicate', async () => {
    world.siblings = ['alpha']
    const decorations = new DecorationService()
    expect(await decorations.duplicateTitle(['charlie'], '   ')).toBeNull()
  })

  it('answers from the index without reading a sibling that has a title', async () => {
    world.siblings = ['alpha', 'bravo', 'charlie']
    world.indexed.set('alpha|en', 'One')
    world.indexed.set('bravo|en', 'Two')
    const manifest = await import('./decoration-manifest.js')
    vi.mocked(manifest.listDecorations).mockClear()
    const decorations = new DecorationService()
    await decorations.duplicateTitle(['charlie'], 'Three')
    expect(manifest.listDecorations).not.toHaveBeenCalled()
  })

  it('reads the siblings the index has not walked all at once', async () => {
    world.siblings = ['a', 'b', 'c', 'd', 'e', 'target']
    const decorations = new DecorationService()
    await decorations.duplicateTitle(['target'], 'Nothing like it')
    expect(world.maxReadsInFlight).toBeGreaterThan(1)
  })
})

describe('reading', () => {
  it('readingAt is the title, or the address when there is none', () => {
    const decorations = new DecorationService()
    world.indexed.set('a/b|en', 'Bee')
    expect(decorations.readingAt(['a', 'b'])).toBe('Bee')
    expect(decorations.readingAt(['a', 'c'])).toBe('c')
    expect(decorations.readingAt([])).toBe('')
  })

  it('titleOf reads the newest record, as the hive index does', async () => {
    world.slots.set('bravo', [
      { sig: 'old', record: { kind: 'title', payload: { text: { en: 'Old' } } } },
      { sig: 'new', record: { kind: 'title', payload: { text: { en: 'New' } } } },
    ])
    expect(await new DecorationService().titleOf(['bravo'])).toBe('New')
  })
})
