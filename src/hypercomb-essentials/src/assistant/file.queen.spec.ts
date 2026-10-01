import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

type Filed = { parent: readonly string[]; tile: string; text: string }
const filed: Filed[] = []
let page: string[] = ['workshop']
/** The hive, as the tiles each route holds. */
let tree: Record<string, string[]> = {}

vi.hoisted(() => {
  ;(globalThis as unknown as { window: { ioc?: unknown } }).window.ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
    list: () => [],
  }
})

const notesService = {
  addAtSegments: async (parent: readonly string[], tile: string, text: string) => { filed.push({ parent: [...parent], tile, text }) },
}
const services: Record<string, unknown> = {
  '@hypercomb.social/Lineage': { explorerSegments: () => page },
  '@diamondcoreprocessor.com/NotesService': notesService,
}

const { HIVE_TREE_READER_IOC_KEY } = await import('./hive-tree-reader.js')
services[HIVE_TREE_READER_IOC_KEY] = {
  readNode: async (segments: readonly string[]) => ({ ok: true, children: (tree[segments.join('/')] ?? []).map(name => ({ name })) }),
}
;(window as unknown as { ioc: { get(key: string): unknown } }).ioc.get = (key: string) => services[key]

const { FileQueenBee } = await import('./file.queen.js')
type Runnable = { execute(args: string): Promise<void> }
const queen = (): Runnable => new FileQueenBee() as unknown as Runnable

const toasts: string[] = []
EffectBus.on<{ message?: string }>('toast:show', payload => { toasts.push(String(payload?.message ?? '')) })

beforeEach(() => {
  filed.length = 0
  toasts.length = 0
  page = ['workshop']
  tree = { '': ['workshop', 'dolphin'], workshop: ['printers', 'Roadmap', 'suppliers'], dolphin: ['coaching', 'members'] }
  services['@diamondcoreprocessor.com/NotesService'] = notesService
})

describe('file on <tile>: <text>', () => {
  it('puts the text alone on the tile that was named, whatever its case', async () => {
    await queen().execute('on printers: call the company about toner')
    await queen().execute('On roadmap:   ship the notes word')
    expect(filed).toEqual([
      { parent: ['workshop'], tile: 'printers', text: 'call the company about toner' },
      { parent: ['workshop'], tile: 'Roadmap', text: 'ship the notes word' },
    ])
    expect(toasts.at(-1)).toContain('Roadmap')
  })

  it('keeps a text that has its own colons and lines', async () => {
    await queen().execute('on suppliers: Charter s.2(d): the freedom to join with others\nand to act together')
    expect(filed[0]).toEqual({ parent: ['workshop'], tile: 'suppliers', text: 'Charter s.2(d): the freedom to join with others\nand to act together' })
  })

  it('a name no tile here wears is not a place: the whole line is filed here, as written', async () => {
    await queen().execute('on tuesday: call the printer company')
    expect(filed).toEqual([{ parent: [], tile: 'workshop', text: 'on tuesday: call the printer company' }])
  })

  it('a plain note still goes here when Jev is not asked', async () => {
    await queen().execute('call the printer company about toner')
    expect(filed).toEqual([{ parent: [], tile: 'workshop', text: 'call the printer company about toner' }])
  })
})

describe('file on /<route>: <text>', () => {
  it('reaches a tile off this page, by its route', async () => {
    await queen().execute('on /dolphin/Coaching: pressure-tests the practice')
    await queen().execute('on /workshop: a note on the page itself, said by route')
    expect(filed).toEqual([
      { parent: ['dolphin'], tile: 'coaching', text: 'pressure-tests the practice' },
      { parent: [], tile: 'workshop', text: 'a note on the page itself, said by route' },
    ])
  })

  it('refuses a route that names no tile, aloud, and files nothing anywhere', async () => {
    await expect(queen().execute('on /dolphin/governance-board: who decides')).rejects.toThrow('there is no tile at /dolphin/governance-board')
    expect(filed).toEqual([])
    expect(toasts.at(-1)).toContain('/dolphin/governance-board')
  })
})

describe('a note that could not be filed', () => {
  it('throws at the root, where there is no tile to hold it', async () => {
    page = []
    tree = { '': [] }
    await expect(queen().execute('call the printer company')).rejects.toThrow('there is no tile here')
    expect(filed).toEqual([])
  })

  it('throws when the notes are not loaded', async () => {
    delete services['@diamondcoreprocessor.com/NotesService']
    await expect(queen().execute('on printers: x')).rejects.toThrow('notes are not available')
  })

  it('says the wider ring it reaches', () => {
    expect(new FileQueenBee().machine).toMatchObject({ reach: 'additive', scope: 'hive' })
  })
})
