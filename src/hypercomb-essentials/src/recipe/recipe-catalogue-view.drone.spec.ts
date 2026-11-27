// recipe-catalogue-view.drone.spec.ts: the catalogue view and its two ways in, against a hive made of fakes.
//
// Real: the list (recipe-catalogue.ts), the spawn rule and the bus. Faked: the
// hive's services behind IoC, the gathering and keeping (recipe-entries.ts:
// the network and the store), the room, the processor's pass, and the recipe
// page, which is stood in for by a recorder so this file pins what the view
// ASKS of the page and never how the page draws it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { DOMAIN_SHELF_WANTED, SOURCES_CHANGED, SOURCES_COUNTED, SOURCES_NODES, SOURCES_QUERY } from '../pools/lights-contract.js'
import type { PoolNode } from '../pools/pool-node.js'
import { VIEW_SPAWN_EFFECT } from '../presentation/tiles/view-spawn.js'
import { zoneDoor } from '../sharing/zone-door.js'

type BackEntry = { owner: string; back: () => void }
type DroneShape = { pulse(grammar: string): Promise<void>; markDisposed(): void }
type Offer = { sig: string; entry: { sig: string; name: string; recipe: string; cover?: string }; node: PoolNode; nodes: PoolNode[]; host: string; at?: number }
type PageOptions = {
  title: string
  mode?: string
  readOnly?: boolean
  template: { name: string }
  recipe: { template?: string; values: Record<string, unknown> }
  pictureUrl(sig: string): string
  onClose(): void
  onPickTemplate?(): void
  primaryAction?: { label: string; onPress(): void }
}
type FakePage = { options: PageOptions; element: HTMLElement; statuses: [string, string | undefined][]; disposed: boolean }

const fakes = vi.hoisted(() => ({
  byZone: new Map<string, unknown[]>(),
  room: [] as unknown[],
  asked: [] as { zones: string[]; room: boolean }[],
  open: vi.fn(),
  take: vi.fn(),
  act: vi.fn(async () => undefined),
  standing: { joined: false, host: '', room: '' },
  pages: [] as unknown[],
}))

vi.mock('@hypercomb/core', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hypercomb: class { act = fakes.act },
}))
vi.mock('./recipe-entries.js', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findRecipeEntries: async (sources: { zones: readonly string[]; room?: boolean }) => {
    fakes.asked.push({ zones: [...sources.zones], room: sources.room === true })
    return [...sources.zones.flatMap(zone => fakes.byZone.get(zone) ?? []), ...(sources.room === true ? fakes.room : [])]
  },
  openRecipeEntry: fakes.open,
  takeRecipeHome: fakes.take,
}))
vi.mock('../pools/room-entries.js', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  roomStanding: () => fakes.standing,
}))
vi.mock('./recipe-page.js', () => ({
  recipePage: (options: PageOptions) => {
    const element = document.createElement('section')
    element.className = 'fake-recipe-page'
    const page: FakePage = { options, element, statuses: [], disposed: false }
    fakes.pages.push(page)
    return {
      element,
      setStatus: (words: string, tone?: string) => { page.statuses.push([words, tone]) },
      dispose: () => { page.disposed = true; element.remove() },
    }
  },
}))

const registered: Record<string, unknown> = {}
const services: Record<string, unknown> = {}
const lookup = (key: string): unknown => registered[key] ?? services[key]

;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registered[key] = value },
  get: lookup,
  has: (key: string) => key in registered || key in services,
  whenReady: (key: string, then: (value: unknown) => void) => { if (lookup(key)) then(lookup(key)) },
}
;(globalThis as unknown as { ioc: unknown }).ioc = window.ioc

const { RecipeCatalogueViewDrone } = await import('./recipe-catalogue-view.drone.js')
const { RecipeCatalogueQueenBee, watchRecipeCatalogueFace } = await import('./recipe-catalogue.queen.js')

const VIEW = 'catalogue'
const OWNER = 'recipe-catalogue'
const HOST = '#hc-recipe-catalogue-host'
const CELLS = 'render:cell-count'
const DOOR = zoneDoor(location.host)

const until = async (ready: () => boolean, words: string, ms = 3000): Promise<void> => {
  const end = Date.now() + ms
  while (!ready()) {
    if (Date.now() > end) throw new Error(`never happened: ${words}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

class ViewModeStub extends EventTarget {
  mode = 'hexagons'
  setMode(next: string): void {
    if (next === this.mode) return
    this.mode = next
    this.dispatchEvent(new Event('change'))
  }
}

class LineageStub extends EventTarget {
  at: string[] = ['kitchen']
  explorerSegments = (): readonly string[] => this.at
  walk(to: string[]): void {
    this.at = to
    this.dispatchEvent(new Event('change'))
  }
}

const domain = (zone: string): PoolNode => ({ kind: 'domain', id: zone })
const ANA: PoolNode = { kind: 'participant', id: 'ana-key', name: 'Ana Lopez' }
const offer = (sig: string, name: string, nodes: PoolNode[], more: { cover?: string; at?: number } = {}): Offer => ({
  sig,
  entry: { sig, name, recipe: `recipe-of-${sig}`, ...(more.cover ? { cover: more.cover } : {}) },
  node: nodes[0] as PoolNode,
  nodes,
  host: nodes[0]?.id ?? '',
  ...(more.at !== undefined ? { at: more.at } : {}),
})
const SOUP = offer('soup', 'Onion soup', [domain('a.example')], { cover: 'soup-cover' })
const BREAD = offer('bread', 'Rye bread', [domain('b.example')])
const STEW = offer('stew', 'Bean stew', [ANA], { at: 20 })
const openedSoup = {
  ok: true,
  recipe: { sig: 'recipe-of-soup', values: { story: { kind: 'text', text: 'Sundays.' } } },
  template: null,
  pictures: new Map<string, Uint8Array>([['soup-cover', new Uint8Array([1, 2, 3])]]),
  bytes: { recipe: new Uint8Array([9]) },
}

describe('the catalogue view', () => {
  let drone: DroneShape | null
  let mode: ViewModeStub
  let lineage: LineageStub
  let backEntry: BackEntry | null
  let enter: ReturnType<typeof vi.fn>
  let exit: ReturnType<typeof vi.fn>
  let heard: { effect: string; payload: unknown }[]
  let unhear: (() => void)[]
  let made: string[]
  let revoked: string[]

  const host = (): HTMLElement | null => document.querySelector<HTMLElement>(HOST)
  const cards = (): string[] => [...document.querySelectorAll(`${HOST} .hc-recipe-catalogue-name`)].map(each => each.textContent ?? '')
  const groups = (): string[] => [...document.querySelectorAll(`${HOST} .hc-recipe-catalogue-from-name`)].map(each => each.textContent ?? '')
  const card = (name: string): HTMLButtonElement =>
    [...document.querySelectorAll<HTMLButtonElement>(`${HOST} .hc-recipe-catalogue-card`)].find(each => each.textContent?.includes(name)) as HTMLButtonElement
  const title = (): string => document.querySelector(`${HOST} .hc-recipe-catalogue-title`)?.textContent ?? ''
  const note = (): string => document.querySelector(`${HOST} .hc-recipe-catalogue-note`)?.textContent ?? ''
  const closeButton = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(`${HOST} .hc-recipe-catalogue-bar .hc-recipe-tool`)
  const search = (): HTMLInputElement => document.querySelector<HTMLInputElement>(`${HOST} .hc-recipe-catalogue-search`) as HTMLInputElement
  const heardOn = (effect: string): unknown[] => heard.filter(one => one.effect === effect).map(one => one.payload)
  const pages = (): FakePage[] => fakes.pages as FakePage[]
  const escape = (from: EventTarget = document.body): void => {
    from.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  }
  const sources = (zones: string[], more: { query?: string; nodes?: PoolNode[] } = {}): void => {
    EffectBus.emit(SOURCES_CHANGED, { zones, all: ['a.example', 'b.example'], query: more.query ?? '', ...(more.nodes ? { nodes: more.nodes } : {}) })
  }

  const open = async (): Promise<void> => {
    drone = new RecipeCatalogueViewDrone() as unknown as DroneShape
    await drone.pulse('')
    mode.setMode(VIEW)
    await until(() => host() !== null, 'the catalogue mounts')
  }

  beforeEach(() => {
    document.querySelector(HOST)?.remove()
    delete document.documentElement.dataset['hypercombMode']
    delete (globalThis as { __HC_READONLY__?: boolean }).__HC_READONLY__
    mode = new ViewModeStub()
    lineage = new LineageStub()
    backEntry = null
    enter = vi.fn()
    exit = vi.fn()
    heard = []
    made = []
    revoked = []
    drone = null
    fakes.byZone.clear()
    fakes.byZone.set('a.example', [SOUP])
    fakes.byZone.set('b.example', [BREAD])
    fakes.byZone.set(DOOR, [offer('pie', 'Plum pie', [domain(DOOR)])])
    fakes.room = [STEW]
    fakes.asked.length = 0
    fakes.pages.length = 0
    fakes.standing = { joined: false, host: '', room: '' }
    fakes.open.mockReset().mockResolvedValue(openedSoup)
    fakes.take.mockReset().mockResolvedValue({ ok: true, segments: ['kitchen', 'onion-soup'] })
    fakes.act.mockClear()
    ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = () => { made.push(`blob:${made.length + 1}`); return made[made.length - 1] }
    ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = (url: string) => { revoked.push(url) }

    services['@hypercomb.social/ViewMode'] = mode
    services['@hypercomb.social/Lineage'] = lineage
    services['@diamondcoreprocessor.com/ModeRegistry'] = { enter, exit }
    services['@diamondcoreprocessor.com/BackGesture'] = {
      register: vi.fn((entry: BackEntry) => { backEntry = entry; return () => undefined }),
      backOutOfView: (peel: () => void) => peel(),
    }

    // Subscribed before anything is sent, so only this test's own traffic is heard.
    let replay = true
    unhear = [DOMAIN_SHELF_WANTED, SOURCES_QUERY, SOURCES_COUNTED, SOURCES_NODES, 'keymap:hold', 'keymap:release', 'activity:log'].map(effect =>
      EffectBus.on(effect, payload => { if (!replay) heard.push({ effect, payload }) }))
    replay = false
  })

  afterEach(async () => {
    mode.setMode('hexagons')
    await wait(10)
    drone?.markDisposed()
    drone = null
    for (const off of unhear) off()
    document.querySelector(HOST)?.remove()
    delete document.documentElement.dataset['hypercombMode']
    // Nothing a later test subscribes to may be answered by this one's last word.
    EffectBus.emit(VIEW_SPAWN_EFFECT, { view: 'none', mode: '', segments: [] })
    EffectBus.emit(SOURCES_CHANGED, { zones: [], all: [], query: '' })
    EffectBus.emit(CELLS, { count: 0 })
  })

  describe('in a hive', () => {
    it('lists what the switched-on zones and the room offer, under the header, with the shelf asked into view', async () => {
      fakes.standing = { joined: true, host: 'meet.example', room: 'marble cove' }
      sources(['a.example'])
      await open()
      await until(() => cards().length === 2, 'the rows arrive')

      expect(title()).toBe('Recipes from your nodes')
      expect(note()).toBe('From 1 domain and the room marble cove')
      expect(cards().sort()).toEqual(['Bean stew', 'Onion soup'])
      expect(groups()).toEqual(['Ana Lopez', 'a.example'])
      // Only the zone that is on was asked, and the room once.
      expect(fakes.asked).toEqual(expect.arrayContaining([{ zones: ['a.example'], room: false }, { zones: [], room: true }]))
      expect(fakes.asked.some(one => one.zones.includes('b.example'))).toBe(false)

      const style = host()?.getAttribute('style') ?? ''
      expect(style).toContain('top:max(var(--hc-inset-top,0px),var(--hc-safe-top,0px))')
      expect(style).toContain('left:var(--hc-controls-left,var(--hc-inset-left,0px))')
      expect(style).toContain('right:max(var(--hc-inset-right,0px),var(--hc-controls-right,0px))')
      expect(host()?.hasAttribute('data-consumes-wheel')).toBe(true)
      expect(host()?.parentElement).toBe(document.body)
      expect(enter).toHaveBeenCalledWith('view:active', OWNER)
      expect(backEntry).toMatchObject({ owner: OWNER })
      expect(heardOn('keymap:hold')).toEqual([{ reason: OWNER }])
      expect(heardOn(DOMAIN_SHELF_WANTED)).toEqual([{ owner: OWNER, wanted: true }])
      // In a hive there is a way back, and the keys start inside the list.
      expect(closeButton()).not.toBeNull()
      expect(host()?.contains(document.activeElement)).toBe(true)
    })

    it('tells the shelf who was found in the room and how many rows each domain offers, and takes both back on the way out', async () => {
      fakes.standing = { joined: true, host: 'meet.example', room: 'marble cove' }
      sources(['a.example'])
      await open()
      await until(() => cards().length === 2, 'the rows arrive')

      expect(heardOn(SOURCES_NODES)).toEqual([{ nodes: [ANA] }])
      expect(heardOn(SOURCES_COUNTED)).toEqual([{ meaning: 'recipe:entry', counts: { 'a.example': 1 } }])

      mode.setMode('hexagons')
      await until(() => host() === null, 'the view comes down')
      expect(heardOn(DOMAIN_SHELF_WANTED)).toEqual([{ owner: OWNER, wanted: true }, { owner: OWNER, wanted: false }])
      expect(heardOn(SOURCES_NODES).pop()).toEqual({ nodes: [] })
      expect(heardOn(SOURCES_COUNTED).pop()).toEqual({ meaning: 'recipe:entry', counts: {} })
      expect(heardOn('keymap:release')).toEqual([{ reason: OWNER }])
      expect(exit).toHaveBeenCalledWith('view:active', OWNER)
    })

    it('asks a zone once for the life of the view, and shows only the zones that are on', async () => {
      sources(['a.example'])
      await open()
      await until(() => cards().length === 1, 'the first zone answers')

      sources(['a.example', 'b.example'])
      await until(() => cards().length === 2, 'the second zone answers')
      expect(note()).toBe('From 2 domains')

      sources(['b.example'])
      await until(() => cards().join() === 'Rye bread', 'the zone switched off shows nothing')
      sources(['a.example', 'b.example'])
      await until(() => cards().length === 2, 'and is back at once')
      expect(fakes.asked.filter(one => one.zones.includes('a.example'))).toHaveLength(1)
      expect(fakes.asked.filter(one => one.zones.includes('b.example'))).toHaveLength(1)
    })

    it('narrows to the nodes the shelf says are on', async () => {
      fakes.standing = { joined: true, host: 'meet.example', room: 'marble cove' }
      sources(['a.example'])
      await open()
      await until(() => cards().length === 2, 'the rows arrive')

      sources(['a.example'], { nodes: [domain('a.example')] })
      await until(() => cards().join() === 'Onion soup', 'the participant switched off shows nothing')
      sources(['a.example'], { nodes: [domain('a.example'), ANA] })
      await until(() => cards().length === 2, 'and is back')
    })

    it('keeps one search with the shelf, both ways', async () => {
      sources(['a.example', 'b.example'])
      await open()
      await until(() => cards().length === 2, 'the rows arrive')

      search().value = 'Rye'
      search().dispatchEvent(new Event('input', { bubbles: true }))
      expect(heardOn(SOURCES_QUERY)).toEqual([{ query: 'Rye' }])
      expect(cards()).toEqual(['Rye bread'])
      // The shelf says the same words back in its own form: the field keeps what was typed.
      sources(['a.example', 'b.example'], { query: 'rye' })
      expect(search().value).toBe('Rye')

      // Words typed in the shelf land in the field here.
      sources(['a.example', 'b.example'], { query: 'onion' })
      expect(search().value).toBe('onion')
      expect(cards()).toEqual(['Onion soup'])
    })

    it('says where to look when nothing is switched on and no room is joined', async () => {
      sources([])
      await open()
      expect(note()).toBe('Switch a domain on in the shelf, or join a room, to see what is offered.')
      expect(fakes.asked).toEqual([])
    })
  })

  describe('opening a row', () => {
    const openSoup = async (): Promise<FakePage> => {
      sources(['a.example'])
      await open()
      await until(() => cards().length === 1, 'the row arrives')
      card('Onion soup').focus()
      card('Onion soup').click()
      await until(() => pages().length === 1, 'the recipe opens')
      return pages()[0] as FakePage
    }

    it('mounts a read-only page over the list, shown through the first built-in layout when the recipe names none', async () => {
      const page = await openSoup()

      expect(fakes.open).toHaveBeenCalledTimes(1)
      expect(fakes.open.mock.calls[0]?.[0]).toMatchObject({ sig: 'soup', nodes: [domain('a.example')] })
      expect(page.options).toMatchObject({ title: 'Onion soup', readOnly: true, mode: 'read' })
      expect(page.options.template.name).toBe('Family recipe')
      expect(page.options.recipe.values).toEqual(openedSoup.recipe.values)
      // A recipe that is only read here has no other layout to choose: the page is handed no chooser, so it draws no button for one.
      expect(page.options.onPickTemplate).toBeUndefined()
      // Mounted after the list inside the same host, so it is on top, and the list stands aside.
      expect(host()?.lastElementChild).toBe(page.element)
      expect((document.querySelector(`${HOST} .hc-recipe-catalogue`) as HTMLElement).inert).toBe(true)
      expect(host()?.contains(document.activeElement)).toBe(false)
      // A picture is shown from bytes that are here, and the list gains the cover that arrived.
      expect(page.options.pictureUrl('soup-cover')).toMatch(/^blob:/)
      expect(page.options.pictureUrl('not-arrived')).toBe('')
      await until(() => document.querySelector(`${HOST} .hc-recipe-catalogue-cover img`) !== null, 'the cover shows in the list')
    })

    it('offers Bring it to my hive, which keeps the recipe as a tile where the reader stands and names it', async () => {
      const page = await openSoup()
      expect(page.options.primaryAction?.label).toBe('Bring it to my hive')

      page.options.primaryAction?.onPress()
      await until(() => page.statuses.some(([, tone]) => tone === 'good'), 'the page says it is kept')

      expect(fakes.take).toHaveBeenCalledTimes(1)
      const [offered, opened, target] = fakes.take.mock.calls[0] as [Offer, unknown, string[]]
      expect(offered.sig).toBe('soup')
      expect(opened).toBe(openedSoup)
      expect(target).toEqual(['kitchen'])
      expect(page.statuses.pop()).toEqual(['Kept in your hive as onion-soup', 'good'])
      expect(heardOn('activity:log')).toEqual([{ message: 'Kept in your hive as onion-soup' }])
      // One pass of the processor lets the grid paint the new tile.
      expect(fakes.act).toHaveBeenCalledTimes(1)

      // A second press never makes a second tile.
      page.options.primaryAction?.onPress()
      await wait(10)
      expect(fakes.take).toHaveBeenCalledTimes(1)
      expect(page.statuses.pop()).toEqual(['Already in your hive as onion-soup', 'plain'])
    })

    it('says why in the page when the recipe could not be kept', async () => {
      fakes.take.mockResolvedValue({ ok: false, reason: 'This page could not be read, so no tile was made.' })
      const page = await openSoup()
      page.options.primaryAction?.onPress()
      await until(() => page.statuses.some(([, tone]) => tone === 'bad'), 'the page says why')
      expect(page.statuses.pop()).toEqual(['This page could not be read, so no tile was made.', 'bad'])
      expect(fakes.act).not.toHaveBeenCalled()
    })

    it('closes back onto the card it was opened from, and lets its pictures go', async () => {
      const page = await openSoup()
      page.options.onClose()

      expect(page.disposed).toBe(true)
      expect(host()?.contains(page.element)).toBe(false)
      expect((document.querySelector(`${HOST} .hc-recipe-catalogue`) as HTMLElement).inert).toBe(false)
      expect(document.activeElement).toBe(card('Onion soup'))
      // The page's own address is let go. The cover the list now shows is kept until the view leaves.
      expect(revoked).toHaveLength(1)
      mode.setMode('hexagons')
      await until(() => host() === null, 'the view comes down')
      expect(revoked.sort()).toEqual([...made].sort())
    })

    it('says why in the list when a row will not open', async () => {
      fakes.open.mockResolvedValue({ ok: false, reason: 'The recipe did not arrive from a.example.' })
      sources(['a.example'])
      await open()
      await until(() => cards().length === 1, 'the row arrives')
      card('Onion soup').click()
      await until(() => note() === 'The recipe did not arrive from a.example.', 'the list says why')
      expect(pages()).toHaveLength(0)
    })

    it('offers no bring-home in a hive opened read-only', async () => {
      ;(globalThis as { __HC_READONLY__?: boolean }).__HC_READONLY__ = true
      const page = await openSoup()
      expect(page.options.readOnly).toBe(true)
      expect(page.options.primaryAction).toBeUndefined()
    })
  })

  describe('on a published door', () => {
    beforeEach(() => {
      document.documentElement.dataset['hypercombMode'] = 'visitor'
      fakes.standing = { joined: true, host: 'meet.example', room: 'marble cove' }
    })

    it('lists what is published at this address and nothing else, with no shelf and no Close', async () => {
      sources(['a.example'])
      await open()
      await until(() => cards().length === 1, 'the row arrives')

      expect(title()).toBe(DOOR)
      expect(note()).toBe('Published here')
      expect(cards()).toEqual(['Plum pie'])
      expect(groups()).toEqual([DOOR])
      expect(fakes.asked).toEqual([{ zones: [DOOR], room: false }])
      expect(closeButton()).toBeNull()
      expect(heardOn(DOMAIN_SHELF_WANTED)).toEqual([])
      expect(heardOn(SOURCES_NODES)).toEqual([])
      expect(heardOn(SOURCES_COUNTED)).toEqual([])

      // Its own search still narrows, and tells no shelf.
      search().value = 'nothing like it'
      search().dispatchEvent(new Event('input', { bubbles: true }))
      expect(cards()).toEqual([])
      expect(heardOn(SOURCES_QUERY)).toEqual([])
    })

    it('holds the face when there is nothing under it: Escape and the back gesture go nowhere', async () => {
      await open()
      escape()
      backEntry?.back()
      expect(mode.mode).toBe(VIEW)
      expect(host()).not.toBeNull()
    })

    it('offers a Close once the page under it holds tiles', async () => {
      await open()
      expect(closeButton()).toBeNull()
      EffectBus.emit(CELLS, { count: 3 })
      expect(closeButton()).not.toBeNull()
      closeButton()?.click()
      expect(mode.mode).toBe('hexagons')
      expect(host()).toBeNull()
    })

    it('opens a row to read and never offers to bring it home', async () => {
      await open()
      await until(() => cards().length === 1, 'the row arrives')
      card('Plum pie').click()
      await until(() => pages().length === 1, 'the recipe opens')
      const page = pages()[0] as FakePage
      expect(page.options).toMatchObject({ title: 'Plum pie', readOnly: true, mode: 'read' })
      expect(page.options.primaryAction).toBeUndefined()
    })
  })

  describe('leaving', () => {
    it('comes back to the surface it was opened from', async () => {
      drone = new RecipeCatalogueViewDrone() as unknown as DroneShape
      await drone.pulse('')
      mode.setMode('recipe')
      EffectBus.emit(VIEW_SPAWN_EFFECT, { view: VIEW, mode: 'recipe', segments: ['kitchen'], at: Date.now() })
      mode.setMode(VIEW)
      await until(() => host() !== null, 'the catalogue mounts')

      escape()
      expect(host()).toBeNull()
      expect(mode.mode).toBe('recipe')
    })

    it('hears the spawn by replay when the mode is what woke it, and ignores a stale one', async () => {
      EffectBus.emit(VIEW_SPAWN_EFFECT, { view: VIEW, mode: 'recipe', segments: ['kitchen'], at: Date.now() })
      mode.setMode(VIEW)
      drone = new RecipeCatalogueViewDrone() as unknown as DroneShape
      await drone.pulse('')
      await until(() => host() !== null, 'the catalogue mounts')
      escape()
      expect(mode.mode).toBe('recipe')

      drone.markDisposed()
      EffectBus.emit(VIEW_SPAWN_EFFECT, { view: VIEW, mode: 'recipe', segments: ['kitchen'], at: Date.now() - 60_000 })
      mode.setMode(VIEW)
      drone = new RecipeCatalogueViewDrone() as unknown as DroneShape
      await drone.pulse('')
      await until(() => host() !== null, 'the catalogue mounts again')
      escape()
      expect(mode.mode).toBe('hexagons')
    })

    it('stays on the hexagons when the reader walked while it was up', async () => {
      EffectBus.emit(VIEW_SPAWN_EFFECT, { view: VIEW, mode: 'recipe', segments: ['kitchen'], at: Date.now() })
      await open()
      lineage.walk(['kitchen', 'bread'])
      closeButton()?.click()
      expect(host()).toBeNull()
      expect(mode.mode).toBe('hexagons')
    })

    it('steps back one thing at a time: the opened recipe, then the catalogue', async () => {
      sources(['a.example'])
      await open()
      await until(() => cards().length === 1, 'the row arrives')
      card('Onion soup').click()
      await until(() => pages().length === 1, 'the recipe opens')

      // With a recipe open, a key from nowhere is the page's own to answer.
      escape()
      expect(pages()[0]?.disposed).toBe(false)
      backEntry?.back()
      expect(pages()[0]?.disposed).toBe(true)
      expect(mode.mode).toBe(VIEW)
      backEntry?.back()
      expect(mode.mode).toBe('hexagons')
      expect(host()).toBeNull()
    })

    it('leaves a field elsewhere its own Escape', async () => {
      await open()
      const field = document.createElement('input')
      document.body.append(field)
      escape(field)
      expect(mode.mode).toBe(VIEW)
      field.remove()
    })
  })
})

describe('the word catalogue', () => {
  it('says where the reader stood, then enters the view', async () => {
    const mode = new ViewModeStub()
    const lineage = new LineageStub()
    services['@hypercomb.social/ViewMode'] = mode
    services['@hypercomb.social/Lineage'] = lineage
    mode.setMode('recipe')
    const said: unknown[] = []
    const order: string[] = []
    let replay = true
    const off = EffectBus.on(VIEW_SPAWN_EFFECT, spawn => { if (!replay) { said.push(spawn); order.push('spawn') } })
    replay = false
    mode.addEventListener('change', () => order.push(`mode:${mode.mode}`))

    const queen = new RecipeCatalogueQueenBee() as unknown as { command: string; description: string; examples: unknown[]; invoke(args: string): Promise<void> }
    expect(queen.command).toBe('catalogue')
    expect(queen.description.length).toBeGreaterThanOrEqual(20)
    expect(queen.examples.length).toBeGreaterThan(0)
    await queen.invoke('')

    expect(said).toHaveLength(1)
    expect(said[0]).toMatchObject({ view: VIEW, mode: 'recipe', segments: ['kitchen'] })
    expect(typeof (said[0] as { at?: unknown }).at).toBe('number')
    expect(order).toEqual(['spawn', `mode:${VIEW}`])

    // Asked again from inside the view, it says nothing: the way back stays the first one.
    await queen.invoke('')
    expect(said).toHaveLength(1)
    off()
    mode.setMode('hexagons')
    EffectBus.emit(VIEW_SPAWN_EFFECT, { view: 'none', mode: '', segments: [] })
  })
})

describe('the default face of a published door', () => {
  let visitor: boolean
  let mode: string
  let at: string[]
  let offered: boolean
  let asked: string[]
  let walked: () => void
  let stop: () => void

  const watch = (): void => {
    stop = watchRecipeCatalogueFace({
      visitor: () => visitor,
      mode: () => mode,
      enter: next => { mode = next },
      here: () => at,
      onWalk: told => { walked = told; return () => undefined },
      zone: () => 'door.example',
      offers: async zone => { asked.push(zone); return offered },
    })
  }
  const arrive = (view = '', segments: string[] = [], held = false): void => {
    EffectBus.emit('view:arrival', { segments, view, ...(held ? { held: true } : {}) })
  }
  const walk = (to: string[]): void => { at = to; walked() }
  /** The grid's last word for the page under the view: settled, with this many tiles. */
  const tiles = (count: number): void => { EffectBus.emit('render:cell-count', { count, settled: true }) }

  beforeEach(() => {
    visitor = true
    mode = 'hexagons'
    at = []
    offered = true
    asked = []
    walked = () => undefined
    stop = () => undefined
    // No verdict and no count from an earlier test stands as this one's.
    EffectBus.emit('view:arrival', { segments: ['elsewhere'], view: '' })
    EffectBus.emit('render:cell-count', { count: 1, settled: true })
  })

  afterEach(() => { stop() })

  it('enters the catalogue at the root of a door that settled with no tiles, names no view of its own, and offers an entry', async () => {
    watch()
    arrive()
    await wait(5)
    // The verdict alone decides nothing: the root has not been seen empty yet.
    expect(asked).toEqual([])
    expect(mode).toBe('hexagons')
    tiles(0)
    await wait(5)
    expect(asked).toEqual(['door.example'])
    expect(mode).toBe('catalogue')
  })

  it('leaves a door whose root holds tiles of its own on its hexagons, and never asks its host', async () => {
    watch()
    tiles(3)
    arrive()
    await wait(5)
    expect(asked).toEqual([])
    expect(mode).toBe('hexagons')
  })

  it('never takes the surface from tiles that arrived while the host was asked', async () => {
    watch()
    tiles(0)
    arrive()
    tiles(2)
    await wait(5)
    expect(asked).toEqual(['door.example'])
    expect(mode).toBe('hexagons')
  })

  it('never acts inside a hive', async () => {
    visitor = false
    watch()
    arrive()
    await wait(5)
    expect(asked).toEqual([])
    expect(mode).toBe('hexagons')
  })

  it('leaves a place that names a view of its own alone, and never asks its host', async () => {
    watch()
    arrive('website')
    await wait(5)
    expect(asked).toEqual([])
    expect(mode).toBe('hexagons')
  })

  it('stays on the hexagons when the host offers no entry', async () => {
    offered = false
    watch()
    tiles(0)
    arrive()
    await wait(5)
    expect(asked).toEqual(['door.example'])
    expect(mode).toBe('hexagons')
  })

  it('acts only at the root, and not for a site moving between its own pages', async () => {
    watch()
    arrive('', ['recipes'])
    arrive('', [], true)
    at = ['recipes']
    arrive()
    await wait(5)
    expect(asked).toEqual([])
    expect(mode).toBe('hexagons')
  })

  it('never takes the surface from a view that came up while the host was asked', async () => {
    watch()
    tiles(0)
    arrive()
    mode = 'slides'
    await wait(5)
    expect(asked).toEqual(['door.example'])
    expect(mode).toBe('slides')
  })

  it('steps aside when the place names its own view after the face went up', async () => {
    watch()
    tiles(0)
    await wait(5)
    expect(mode).toBe('catalogue')
    arrive('website')
    expect(mode).toBe('website')
  })

  it('takes a root for bare only once the grid settled empty, with a verdict or without one', async () => {
    watch()
    EffectBus.emit('render:cell-count', { count: 0 })
    await wait(5)
    expect(asked).toEqual([])
    // No verdict came (a root with no layer to read): the settled empty grid is enough.
    tiles(0)
    await wait(5)
    expect(mode).toBe('catalogue')
  })

  it('does not put back a visitor who left, until they arrive at the root again, and asks the host once', async () => {
    watch()
    tiles(0)
    arrive()
    await wait(5)
    expect(mode).toBe('catalogue')

    // The same arrival, said again with the root still empty, is not answered twice.
    mode = 'hexagons'
    tiles(0)
    arrive()
    await wait(5)
    expect(mode).toBe('hexagons')

    // A new arrival is judged anew: the root must be seen empty again.
    walk(['recipes'])
    walk([])
    arrive()
    await wait(5)
    expect(mode).toBe('hexagons')
    tiles(0)
    await wait(5)
    expect(mode).toBe('catalogue')
    expect(asked).toEqual(['door.example'])
  })

  it('does not let the root\'s face ride along when the visitor walks on', async () => {
    watch()
    tiles(0)
    arrive()
    await wait(5)
    expect(mode).toBe('catalogue')
    walk(['recipes'])
    expect(mode).toBe('hexagons')
  })
})
