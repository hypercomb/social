// recipe-catalogue-view.posts.spec.ts: a pool the leader opened for posts, as
// one more source in the catalogue view, with Hide and Show again beside each
// poster. The leader's side (reading the pools, writing the hidden list) and
// the gathering are faked; the list, the view and the bus are real.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { SOURCES_CHANGED, SOURCES_NODES } from '../pools/lights-contract.js'
import type { PoolNode } from '../pools/pool-node.js'

const KEY_ANA = 'a'.repeat(64)
const KEY_BEN = 'b'.repeat(64)
const POOL = 'c'.repeat(64)
const TEMPLATE = 'd'.repeat(64)

const fakes = vi.hoisted(() => ({
  sources: vi.fn(),
  hide: vi.fn(),
  posted: vi.fn(),
}))

vi.mock('../pools/open-entries-leader.js', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readOpenedSources: fakes.sources,
}))
vi.mock('../pools/open-entries-flows.js', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setEntryHidden: fakes.hide,
}))
vi.mock('./recipe-entries.js', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findRecipeEntries: async () => [],
  postedRecipeOffers: fakes.posted,
}))
vi.mock('../pools/room-entries.js', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  roomStanding: () => ({ joined: false, host: '', room: '' }),
}))

const services: Record<string, unknown> = {}
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { services[key] = value },
  get: (key: string) => services[key],
  has: (key: string) => key in services,
  whenReady: (key: string, then: (value: unknown) => void) => { if (services[key]) then(services[key]) },
}
;(globalThis as unknown as { ioc: unknown }).ioc = window.ioc

const { RecipeCatalogueViewDrone } = await import('./recipe-catalogue-view.drone.js')

const HOST = '#hc-recipe-catalogue-host'
class ViewModeStub extends EventTarget {
  mode = 'hexagons'
  setMode(next: string): void { if (next !== this.mode) { this.mode = next; this.dispatchEvent(new Event('change')) } }
}

const until = async (ready: () => boolean, words: string, ms = 3000): Promise<void> => {
  const end = Date.now() + ms
  while (!ready()) {
    if (Date.now() > end) throw new Error(`never happened: ${words}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

type Row = { signer: string; label: string; title: string; page: string }
const rowOf = (signer: string, label: string, title: string, page = title.length.toString(16).padStart(2, '0').repeat(32)): Row => ({ signer, label, title, page })
/** One opened pool as the leader's side reads it. */
const source = (rows: Row[], hiddenKeys: string[] = [], hiddenPages: string[] = []) => ({
  pool: POOL, record: 'e'.repeat(64), host: 'example.com', page: 'https://example.com', title: 'Tuesday class',
  meaning: 'recipe:entry', template: TEMPLATE,
  read: {
    reached: true, state: 'open', rows, over: false, offset: 0, said: '',
    hidden: hiddenKeys.length || hiddenPages.length
      ? { named: 'f'.repeat(64), list: { keys: hiddenKeys.map(key => `k:${key}`), pages: hiddenPages } }
      : { named: null, list: null },
  },
})
/** The offers the real reader would make: one a row, under the poster's node, carrying the poster's entry page. */
const offersOf = (rows: Row[]) => rows.map((row) => {
  const node: PoolNode = { kind: 'participant', id: row.signer, name: row.label }
  const sig = row.title.length.toString(16).padStart(2, '0').repeat(32)
  return {
    sig, entry: { sig, name: row.title, recipe: sig }, node, nodes: [node], host: 'https://example.com', at: 1,
    posted: { member: sig, bytes: new Uint8Array(), pool: POOL, host: 'https://example.com', template: TEMPLATE, lines: [{ signer: row.signer, page: row.page }] },
  }
})

describe('a pool opened for posts in the catalogue', () => {
  let mode: ViewModeStub
  let drone: { pulse(grammar: string): Promise<void>; markDisposed(): void } | null = null
  let people: unknown[] = []
  let offPeople: () => void = () => undefined

  const names = (): string[] => [...document.querySelectorAll(`${HOST} .hc-recipe-catalogue-name`)].map(each => each.textContent ?? '')
  const heads = (): string[] => [...document.querySelectorAll(`${HOST} .hc-recipe-catalogue-from-name`)].map(each => each.textContent ?? '')
  const press = (words: string): HTMLButtonElement | undefined =>
    [...document.querySelectorAll<HTMLButtonElement>(`${HOST} .hc-recipe-catalogue-node-action`)].find(each => each.textContent === words)
  const note = (): string => document.querySelector(`${HOST} .hc-recipe-catalogue-note`)?.textContent ?? ''

  const open = async (): Promise<void> => {
    drone = new RecipeCatalogueViewDrone() as unknown as typeof drone
    await drone!.pulse('')
    mode.setMode('catalogue')
    await until(() => document.querySelector(HOST) !== null, 'the catalogue mounts')
  }

  beforeEach(() => {
    document.querySelector(HOST)?.remove()
    delete (globalThis as { __HC_READONLY__?: boolean }).__HC_READONLY__
    mode = new ViewModeStub()
    services['@hypercomb.social/ViewMode'] = mode
    services['@hypercomb.social/Lineage'] = { explorerSegments: () => ['kitchen'] }
    services['@diamondcoreprocessor.com/ModeRegistry'] = { enter: () => undefined, exit: () => undefined }
    fakes.sources.mockReset()
    fakes.hide.mockReset().mockResolvedValue({ ok: true, list: { keys: [], pages: [] }, sig: null })
    fakes.posted.mockReset().mockImplementation(async (rows: Row[]) => offersOf(rows))
    people = []
    let replay = true
    offPeople = EffectBus.on(SOURCES_NODES, payload => { if (!replay) people.push(payload) })
    replay = false
  })

  afterEach(async () => {
    mode.setMode('hexagons')
    await new Promise(resolve => setTimeout(resolve, 10))
    drone?.markDisposed()
    drone = null
    offPeople()
    document.querySelector(HOST)?.remove()
    EffectBus.emit(SOURCES_CHANGED, { zones: [], all: [], query: '' })
  })

  it('draws the pool\'s rows under the people who posted them, read with the pool\'s template, and tells the shelf who they are', async () => {
    fakes.sources.mockResolvedValue([source([rowOf(KEY_ANA, 'Ana', 'Sunday soup'), rowOf(KEY_BEN, 'Ben', 'Rye bread')])])
    await open()
    await until(() => names().length === 2, 'the posted rows arrive')
    expect(heads().sort()).toEqual(['Ana', 'Ben'])
    expect(fakes.posted.mock.calls[0]?.[1]).toEqual({ pool: POOL, host: 'https://example.com', template: TEMPLATE })
    expect(note()).toMatch(/your pool open for posts/)
    const last = people.at(-1) as { nodes: PoolNode[] }
    expect(last.nodes.map(node => node.id).sort()).toEqual([KEY_ANA, KEY_BEN])
  })

  it('hides a poster with the leader\'s own list, then reads the pool again and offers Show again', async () => {
    fakes.sources.mockResolvedValueOnce([source([rowOf(KEY_ANA, 'Ana', 'Sunday soup'), rowOf(KEY_BEN, 'Ben', 'Rye bread')])])
    await open()
    await until(() => names().length === 2, 'the posted rows arrive')
    expect(press('Hide')).toBeDefined()
    fakes.sources.mockResolvedValue([source([rowOf(KEY_BEN, 'Ben', 'Rye bread')], [KEY_ANA])])
    const hideAna = [...document.querySelectorAll<HTMLButtonElement>(`${HOST} .hc-recipe-catalogue-node-action`)]
      .find(each => each.dataset['node'] === `participant:${KEY_ANA}`)
    hideAna?.click()
    await until(() => !!press('Show again'), 'Show again is offered')
    expect(fakes.hide).toHaveBeenCalledWith({ host: 'example.com', pool: POOL, line: { key: KEY_ANA }, hide: true, page: 'https://example.com' }, expect.anything())
    expect(names()).toEqual(['Rye bread'])
    // The hidden poster keeps the name they typed, in a group of its own.
    expect(heads()).toContain('Ana')
    fakes.sources.mockResolvedValue([source([rowOf(KEY_ANA, 'Ana', 'Sunday soup'), rowOf(KEY_BEN, 'Ben', 'Rye bread')])])
    press('Show again')?.click()
    await until(() => names().length === 2, 'the poster shows again')
    expect(fakes.hide).toHaveBeenLastCalledWith({ host: 'example.com', pool: POOL, line: { key: KEY_ANA }, hide: false, page: 'https://example.com' }, expect.anything())
  })

  it('hides one entry of a poster, not the poster, and shows it again', async () => {
    const soup = rowOf(KEY_ANA, 'Ana', 'Sunday soup')
    const stew = rowOf(KEY_ANA, 'Ana', 'Stew')
    fakes.sources.mockResolvedValueOnce([source([soup, stew, rowOf(KEY_BEN, 'Ben', 'Rye bread')])])
    await open()
    await until(() => names().length === 3, 'the posted rows arrive')
    const entryPress = (words: string, sig?: string): HTMLButtonElement | undefined =>
      [...document.querySelectorAll<HTMLButtonElement>(`${HOST} .hc-recipe-catalogue-row-action`)]
        .find(each => each.textContent === words && (sig === undefined || each.dataset['sig'] === sig))
    const soupSig = offersOf([soup])[0]!.sig
    expect(entryPress('Hide this entry', soupSig)).toBeDefined()
    fakes.sources.mockResolvedValue([source([stew, rowOf(KEY_BEN, 'Ben', 'Rye bread')], [], [`${KEY_ANA}:${soup.page}`])])
    entryPress('Hide this entry', soupSig)?.click()
    await until(() => names().length === 2, 'the entry is hidden')
    expect(fakes.hide).toHaveBeenCalledWith({ host: 'example.com', pool: POOL, line: { key: KEY_ANA, page: soup.page }, hide: true, page: 'https://example.com' }, expect.anything())
    // The poster still shows, with their other entry; the hidden one says so, with Show again beside it.
    expect(names().sort()).toEqual(['Rye bread', 'Stew'])
    const held = document.querySelector(`${HOST} section[data-held="${KEY_ANA}:${soup.page}"]`)
    expect(held?.textContent).toContain('One entry, "Sunday soup", is hidden')
    fakes.sources.mockResolvedValue([source([soup, stew, rowOf(KEY_BEN, 'Ben', 'Rye bread')])])
    held?.querySelector<HTMLButtonElement>('button')?.click()
    await until(() => names().length === 3, 'the entry shows again')
    expect(fakes.hide).toHaveBeenLastCalledWith({ host: 'example.com', pool: POOL, line: { key: KEY_ANA, page: soup.page }, hide: false, page: 'https://example.com' }, expect.anything())
  })

  it('says the leader\'s list could not be read, and draws nothing from that pool', async () => {
    const unread = source([])
    fakes.sources.mockResolvedValue([{ ...unread, read: { ...unread.read, why: 'hidden-unread', hidden: { named: 'f'.repeat(64), list: null } } }])
    await open()
    await until(() => /list of hidden entries/.test(note()), 'the refusal is said')
    expect(names()).toEqual([])
  })

  it('reads no pool of the leader\'s in a shell that only reads, and offers no Hide there', async () => {
    ;(globalThis as { __HC_READONLY__?: boolean }).__HC_READONLY__ = true
    fakes.sources.mockResolvedValue([source([rowOf(KEY_ANA, 'Ana', 'Sunday soup')])])
    await open()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(fakes.sources).not.toHaveBeenCalled()
    expect(press('Hide')).toBeUndefined()
  })
})
