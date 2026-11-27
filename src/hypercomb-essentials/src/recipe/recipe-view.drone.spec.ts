// recipe-view.drone.spec.ts: the recipe view against a hive made of fakes.
//
// Real: the page, the picker, the recipe store and the template pool, so a
// save here is a save the strict readers accept and a kept template is kept by
// bytes that hash to its name. Faked: the hive's services behind IoC, the
// decoration writer, and the network (what a domain offers, and the room's
// host: sharing with a room and taking an entry back are recorded and answered
// here; recipe-entries.spec.ts is where they meet a host).
//
// THE WORD'S FILE IS LOADED WITH THE DESK (recipe.queen.ts), as a hive loads
// it: she is awake whether or not the desk is, and taking a recipe back from
// the room when its tile is unlit is hers.
//
// THE FAKE HIVE WRAPS WHAT A SLOT NAMES, as the real one does (L2): the
// committer is handed the recipe's signature and the layer it leaves holds the
// signature of a meta envelope { meta: 1, resource, relation }; only the
// store's resolved reads follow that hop.
//
// The page is the real one, wrapped: what the drone hands it (the list, the
// address, the bulb's words) is kept so it can be read and pressed here without
// leaning on the page's own markup, which recipe-page.spec.ts pins.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { VisualBeeRegistry } from '../commands/visual-bee-registry.js'
import { SAVE_DEBOUNCE_MS } from '../document/document-edit.js'
import { DOMAIN_SHELF_WANTED, LIGHTS_CHANGED, SOURCES_CHANGED, SOURCES_COUNTED, SOURCES_QUERY } from '../pools/lights-contract.js'
import { poolContributions } from '../pools/pool-contributions.js'
import { isCellPublic, isIndividuallyPublic, setBranchPublic, setCellPublic } from '../presentation/tiles/tile-public.js'
import { VIEW_SPAWN_EFFECT } from '../presentation/tiles/view-spawn.js'
import { RECIPE_OPEN_FOR_TILE, RECIPE_SLOT, RECIPE_VIEW } from './recipe-slot.js'
import { parseRecipeTemplate, recipeBytes, recipeTemplateBytes, type RecipeDocument, type RecipeTemplateDocument } from './recipe-template.js'
import { recipeReadingFloor, recipeSettingBytes, type RecipeSettingDocument } from './recipe-setting.js'

type BackEntry = { owner: string; back: () => void }
type DroneShape = { pulse(grammar: string): Promise<void>; markDisposed(): void }
type Row = { label: string; hasRecipe: boolean; current: boolean }
type Shared = { lit: boolean; words: string; tone?: string }
/** What the drone hands the page beyond the recipe itself. */
type Desk = {
  address?: string
  tiles?: Row[]
  shared?: Shared
  onPickTile?(label: string): void
  onToggleShared?(): void
  onBrowse?(): void
}
type RoomAnswer = { ok: true; host: string } | { ok: false; reason: string; live?: true }

const fakes = vi.hoisted(() => ({
  decorate: vi.fn(async () => 'decoration'),
  offers: new Map<string, unknown[]>(),
  asked: [] as string[],
}))

/** The page as the drone last made it, and everything it was told afterwards. */
const desk = vi.hoisted(() => ({
  options: null as unknown,
  tiles: [] as unknown[],
  shared: [] as unknown[],
  address: [] as string[],
}))

/** The room's host, as far as the drone meets it: what was asked, and what it answers. */
const room = vi.hoisted(() => ({
  shared: [] as string[],
  retracted: [] as string[],
  answer: { ok: true, host: 'class.example' } as unknown,
  /** What the host answers when an entry is taken back. */
  retractAnswer: { ok: true, host: 'class.example' } as unknown,
  /** While set, a share waits on it: the host has not answered yet. */
  gate: null as Promise<void> | null,
}))

vi.mock('../commands/decoration-manifest.js', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  replaceDecoration: fakes.decorate,
}))
vi.mock('./recipe-pool.js', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findCommunityRecipeTemplates: async (hosts: readonly string[]) => {
    fakes.asked.push(...hosts)
    return fakes.offers.get(hosts[0]) ?? []
  },
}))

/** The hosts this hive follows, as the Table control is told them, and what they offer of table sets. */
const tables = vi.hoisted(() => ({
  zones: [] as string[],
  off: [] as string[],
  offers: [] as unknown[],
  asked: [] as string[][],
}))
vi.mock('../pools/pool-sources.js', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  followedZones: async () => [...tables.zones],
  readSourcesOff: async () => [...tables.off],
}))
vi.mock('./recipe-setting-pool.js', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findCommunityRecipeSettings: async (hosts: readonly string[]) => {
    tables.asked.push([...hosts])
    return tables.offers
  },
}))

vi.mock('./recipe-page.js', async importOriginal => {
  const real = await importOriginal<Record<string, unknown>>()
  const make = real['recipePage'] as (options: unknown) => Record<string, unknown>
  return {
    ...real,
    recipePage: (options: unknown) => {
      const handle = make(options)
      desk.options = options
      const told = <T>(seen: T[], name: string) => {
        const own = handle[name] as ((value: T) => void) | undefined
        return (value: T): void => { seen.push(value); own?.call(handle, value) }
      }
      return Object.assign(handle, {
        setTiles: told(desk.tiles, 'setTiles'),
        setShared: told(desk.shared, 'setShared'),
        setAddress: told(desk.address, 'setAddress'),
      })
    },
  }
})
vi.mock('./recipe-entries.js', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  shareRecipeWithRoom: async (segments: readonly string[]) => {
    room.shared.push(segments.join('/'))
    if (room.gate) await room.gate
    return room.answer
  },
  retractRecipeFromRoom: async (segments: readonly string[]) => {
    room.retracted.push(segments.join('/'))
    return room.retractAnswer
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

const slots = { register: vi.fn() }
services['@diamondcoreprocessor.com/LayerSlotRegistry'] = slots

const { RecipeViewDrone } = await import('./recipe-view.drone.js')
// The word's file, awake beside the desk for every test here.
services['@diamondcoreprocessor.com/VisualBeeRegistry'] = new VisualBeeRegistry()
await import('./recipe.queen.js')

const HOST = '#hc-recipe-view-host'
const hex = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
const sha = async (bytes: Uint8Array): Promise<string> => hex(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))

/** jsdom's Blob has no `arrayBuffer()`; a FileReader reads it. */
const bytesOf = (blob: Blob): Promise<Uint8Array> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error)
  reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
  reader.readAsArrayBuffer(blob)
})

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

const SOUP: RecipeDocument = { values: { story: { kind: 'text', text: 'Sundays, always too much.' } } }
const BREAD: RecipeDocument = { values: { story: { kind: 'text', text: 'Three days, mostly waiting.' } } }
const ROOM_CHANGED = 'mesh:public-changed'
const THEIRS: RecipeTemplateDocument = {
  name: 'Supper club',
  description: 'What goes on the table.',
  sections: [{ key: 'story', kind: 'text', label: 'The story' }, { key: 'steps', kind: 'steps', label: 'Method' }],
}

describe('the recipe view', () => {
  let drone: DroneShape | null
  let mode: ViewModeStub
  let lineage: LineageStub
  let backEntry: BackEntry | null
  let dropBack: ReturnType<typeof vi.fn>
  let enter: ReturnType<typeof vi.fn>
  let exit: ReturnType<typeof vi.fn>
  /** Every write, in the order it was asked. */
  let log: string[]
  let heap: Map<string, Uint8Array>
  let layers: Map<string, Record<string, unknown>>
  /** A page's children, by the signature its layer lists them under. */
  let children: Map<string, Record<string, unknown>>
  /** Every commit, with the layer as the committer was HANDED it: the slot names the recipe itself. */
  let commits: { segments: string[]; layer: Record<string, unknown> }[]
  let lists: string[][]
  let heard: { effect: string; payload: unknown }[]
  let unhear: (() => void)[]

  const keyOf = (segments: readonly string[]): string => `at:${segments.join('/')}`
  const hold = async (bytes: Uint8Array): Promise<string> => {
    const sig = await sha(bytes)
    heap.set(sig, bytes)
    return sig
  }
  const blobOf = (sig: string): Blob | null => {
    const bytes = heap.get(sig)
    return bytes ? ({ size: bytes.length, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer }) as unknown as Blob : null
  }
  /** What the store's resolved reads answer: the bytes named, or the bytes a meta envelope names. */
  const through = (sig: string): Blob | null => {
    const bytes = heap.get(sig)
    if (!bytes) return null
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { meta?: unknown; resource?: unknown }
      if (parsed.meta === 1 && typeof parsed.resource === 'string') return blobOf(parsed.resource)
    } catch { /* not an envelope: the bytes as they are */ }
    return blobOf(sig)
  }
  const envelope = (sig: string): Promise<string> =>
    hold(new TextEncoder().encode(JSON.stringify({ meta: 1, resource: sig, relation: RECIPE_SLOT })))
  /** A tile as a real hive keeps it: when it holds a recipe, its slot names the envelope, never the recipe. */
  const tile = async (segments: string[], name: string, doc?: RecipeDocument): Promise<void> => {
    layers.set(keyOf(segments), { name, ...(doc ? { [RECIPE_SLOT]: [await envelope(await hold(recipeBytes(doc)))] } : {}) })
  }
  /** A page's own layer: its children by signature, each a layer that carries its name. */
  const pageOf = (segments: string[], named: string[]): void => {
    layers.set(keyOf(segments), {
      name: segments[segments.length - 1] ?? '',
      children: named.map(name => {
        const sig = `child:${segments.join('/')}/${name}`
        children.set(sig, { name })
        return sig
      }),
    })
  }
  const host = (): HTMLElement | null => document.querySelector<HTMLElement>(HOST)
  const title = (): string => document.querySelector(`${HOST} .hc-recipe-title`)?.textContent ?? ''
  /** What the drone handed the page it last made. */
  const asked = (): Desk => (desk.options ?? {}) as Desk
  const lastOf = <T>(seen: unknown[]): T | undefined => seen[seen.length - 1] as T | undefined
  const story = (): HTMLTextAreaElement =>
    document.querySelector<HTMLTextAreaElement>(`${HOST} .hc-recipe-card[data-key="story"] textarea`) as HTMLTextAreaElement
  const type = (words: string): void => {
    const field = story()
    field.value = words
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const status = (): string => document.querySelector(`${HOST} .hc-recipe-status`)?.textContent ?? ''
  const menu = (words: string): HTMLButtonElement | undefined =>
    [...document.querySelectorAll<HTMLButtonElement>(`${HOST} .hc-recipe-menu button`)].find(each => each.textContent === words)
  const heardOn = (effect: string): unknown[] => heard.filter(one => one.effect === effect).map(one => one.payload)

  const open = async (segments: string[] = ['kitchen', 'soup']): Promise<void> => {
    drone = new RecipeViewDrone() as unknown as DroneShape
    await drone.pulse('')
    EffectBus.emit(RECIPE_OPEN_FOR_TILE, { view: RECIPE_VIEW, segments, at: Date.now() })
    await until(() => host() !== null, 'the page mounts')
  }

  beforeEach(() => {
    document.querySelector(HOST)?.remove()
    mode = new ViewModeStub()
    lineage = new LineageStub()
    backEntry = null
    dropBack = vi.fn()
    enter = vi.fn()
    exit = vi.fn()
    log = []
    heap = new Map()
    layers = new Map()
    children = new Map()
    commits = []
    localStorage.clear()
    desk.options = null
    desk.tiles.length = 0
    desk.shared.length = 0
    desk.address.length = 0
    room.shared.length = 0
    room.retracted.length = 0
    room.answer = { ok: true, host: 'class.example' } satisfies RoomAnswer
    room.retractAnswer = { ok: true, host: 'class.example' } satisfies RoomAnswer
    room.gate = null
    lists = []
    heard = []
    fakes.decorate.mockClear()
    fakes.offers.clear()
    fakes.asked.length = 0
    drone = null

    let list: ArrayBuffer | null = null
    const pool = { keys: async function* () { yield* [] as string[] } }
    services['@hypercomb.social/ViewMode'] = mode
    services['@hypercomb.social/Lineage'] = lineage
    services['@hypercomb.social/Store'] = {
      putResource: async (blob: Blob) => {
        const sig = await hold(await bytesOf(blob))
        log.push(`put:${sig}`)
        return sig
      },
      getResource: async (sig: string) => through(sig),
      getResourceResolvedLocal: async (sig: string) => through(sig),
      getResourceLocal: async (sig: string) => blobOf(sig),
      getPool: async () => pool,
      openPool: async () => (list ? pool : null),
      getPoolDoc: async () => list,
      putPoolDoc: async (_pool: object, bytes: ArrayBuffer) => {
        list = bytes
        const members = (JSON.parse(new TextDecoder().decode(bytes)) as { members: string[] }).members
        lists.push(members)
        log.push(`list:${members.join(',')}`)
        return 'list'
      },
    }
    services['@diamondcoreprocessor.com/HistoryService'] = {
      sign: async (at: { explorerSegments?: () => readonly string[] }) => keyOf(at.explorerSegments?.() ?? []),
      currentLayerAt: async (key: string) => layers.get(key) ?? null,
      getLayerBySig: async (sig: string) => children.get(sig) ?? null,
    }
    services['@diamondcoreprocessor.com/LayerCommitter'] = {
      update: async (segments: readonly string[], layer: Record<string, unknown>) => {
        commits.push({ segments: [...segments], layer: { ...layer } })
        log.push('commit')
        const slot = layer[RECIPE_SLOT]
        const wrapped = Array.isArray(slot) ? { [RECIPE_SLOT]: await Promise.all(slot.map(sig => envelope(String(sig)))) } : {}
        layers.set(keyOf(segments), { ...layers.get(keyOf(segments)), ...layer, ...wrapped })
        return 'layer'
      },
    }
    // The room this tab meets in, once it joins.
    services['@hypercomb.social/RoomStore'] = { value: 'class 4b' }
    services['@hypercomb.social/SecretStore'] = { value: 'chalk' }
    services['@diamondcoreprocessor.com/NostrMeshDrone'] = { swarmHost: () => 'class.example' }
    services['@diamondcoreprocessor.com/ModeRegistry'] = { enter, exit }
    services['@diamondcoreprocessor.com/BackGesture'] = {
      register: vi.fn((entry: BackEntry) => { backEntry = entry; return dropBack }),
      backOutOfView: (peel: () => void) => peel(),
    }

    // Subscribed before anything is sent, so only this test's own traffic is heard.
    let replay = true
    unhear = [DOMAIN_SHELF_WANTED, SOURCES_QUERY, SOURCES_COUNTED, 'keymap:hold', 'keymap:release'].map(effect =>
      EffectBus.on(effect, payload => { if (!replay) heard.push({ effect, payload }) }))
    replay = false
  })

  afterEach(async () => {
    mode.setMode('hexagons')
    await wait(20)
    drone?.markDisposed()
    drone = null
    for (const off of unhear) off()
    document.querySelector(HOST)?.remove()
    // Nothing a later test subscribes to may be answered by this one's last word.
    EffectBus.emit(RECIPE_OPEN_FOR_TILE, { view: 'none', segments: [] })
    EffectBus.emit(VIEW_SPAWN_EFFECT, { view: 'none', mode: '', segments: [] })
    EffectBus.emit(SOURCES_CHANGED, { zones: [], all: [], query: '' })
    EffectBus.emit(ROOM_CHANGED, { public: false })
  })

  it('declares its slot, and mounts the tile\'s recipe where the tile editor sits when a tile is opened', async () => {
    await tile(['kitchen', 'soup'], 'Onion soup', SOUP)
    await open()

    expect(slots.register).toHaveBeenCalledWith({ slot: RECIPE_SLOT, triggers: [] })
    expect(mode.mode).toBe(RECIPE_VIEW)
    expect(document.querySelector(`${HOST} .hc-recipe-title`)?.textContent).toBe('Onion soup')
    expect(story().value).toBe('Sundays, always too much.')
    // The first built-in layout stands in for a recipe that names none.
    expect(document.querySelector(`${HOST} .hc-recipe-template`)?.textContent).toContain('Family recipe')

    // The desk has its own header: its top is the safe edge or a band reserved off the top, never the
    // shell header's anchor, which is an empty band while the view hides that header. The shell's rail
    // stays outside on the left, and it stacks where the tile editor does.
    const style = host()?.getAttribute('style') ?? ''
    expect(style).toContain('top:max(var(--hc-inset-top,0px),var(--hc-safe-top,0px));')
    expect(style).not.toContain('--hc-header-anchor')
    expect(style).toContain('left:var(--hc-controls-left,var(--hc-inset-left,0px));')
    expect(style).toContain('right:max(var(--hc-inset-right,0px),var(--hc-controls-right,0px));')
    expect(style).toContain('bottom:calc(max(var(--hc-controls-bottom,0px),var(--hc-safe-bottom,0px)) + var(--hc-mobile-row-lift,0px));')
    expect(style).toContain('z-index:60001;')
    expect(host()?.hasAttribute('data-consumes-wheel')).toBe(true)
    expect(host()?.parentElement).toBe(document.body)
    expect(enter).toHaveBeenCalledWith('view:active', 'recipe-view')
    expect(backEntry).toMatchObject({ owner: 'recipe-view' })
    expect(heardOn('keymap:hold')).toEqual([{ reason: 'recipe-view' }])
    // Opening wrote nothing.
    expect(log).toEqual([])
  })

  it('opens the tile the cook stands in when the mode is entered by another door', async () => {
    lineage.at = ['kitchen', 'bread']
    layers.set(keyOf(['kitchen', 'bread']), { name: 'Bread' })
    drone = new RecipeViewDrone() as unknown as DroneShape
    await drone.pulse('')
    mode.setMode(RECIPE_VIEW)
    await until(() => host() !== null, 'the page mounts')
    expect(document.querySelector(`${HOST} .hc-recipe-title`)?.textContent).toBe('Bread')
  })

  it('ignores a stamped open that the bus replays long after the press', async () => {
    drone = new RecipeViewDrone() as unknown as DroneShape
    EffectBus.emit(RECIPE_OPEN_FOR_TILE, { view: RECIPE_VIEW, segments: ['kitchen', 'soup'], at: Date.now() - 60_000 })
    await drone.pulse('')
    await wait(30)
    expect(mode.mode).toBe('hexagons')
    expect(host()).toBeNull()
  })

  it('saves an edit once after the pause, names the layout it was written through, and never saves what did not change', async () => {
    layers.set(keyOf(['kitchen', 'soup']), { name: 'Onion soup' })
    await open()

    type('Nan made it on Sundays.')
    await wait(SAVE_DEBOUNCE_MS / 4)
    expect(commits).toHaveLength(0)
    await until(() => commits.length === 1, 'the pause saves')
    await until(() => status() === 'Saved', 'the page says so')

    const saved = commits[0]
    expect(saved.segments).toEqual(['kitchen', 'soup'])
    expect(saved.layer['name']).toBe('Onion soup')
    const recipeSig = (saved.layer[RECIPE_SLOT] as string[])[0]
    const doc = JSON.parse(new TextDecoder().decode(heap.get(recipeSig))) as { template: string; values: Record<string, unknown> }
    expect(doc.values['story']).toEqual({ kind: 'text', text: 'Nan made it on Sundays.' })
    // The layout was held before the recipe named it, so the name resolves.
    const layout = await parseRecipeTemplate(heap.get(doc.template) as Uint8Array, doc.template)
    expect(layout.ok && layout.template.name).toBe('Family recipe')
    expect(log.indexOf(`put:${doc.template}`)).toBeLessThan(log.indexOf('commit'))
    // The layer the commit left names an envelope, never the recipe, and the recipe reads back through it.
    const kept = (layers.get(keyOf(['kitchen', 'soup'])) as Record<string, string[]>)[RECIPE_SLOT]
    expect(kept).toHaveLength(1)
    expect(kept[0]).not.toBe(recipeSig)
    expect(JSON.parse(new TextDecoder().decode(heap.get(kept[0])))).toEqual({ meta: 1, resource: recipeSig, relation: RECIPE_SLOT })
    // The first recipe on a tile lights its mark.
    expect(fakes.decorate).toHaveBeenCalledTimes(1)

    // The same words again are not a change.
    type('Nan made it on Sundays.')
    await wait(SAVE_DEBOUNCE_MS + 200)
    expect(commits).toHaveLength(1)
  })

  it('keeps a domain\'s template by its own bytes before the recipe is shown through it', async () => {
    // The maker's spelling is not this hive's: only their bytes hash to their name.
    const canonical = new TextDecoder().decode(recipeTemplateBytes(THEIRS))
    const bytes = new TextEncoder().encode(`${canonical}\n`)
    const sig = await sha(bytes)
    const parsed = await parseRecipeTemplate(bytes, sig)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    fakes.offers.set('friends.example', [{ sig, template: parsed.template, bytes, host: 'friends.example', hosts: ['friends.example'], pubkey: 'f'.repeat(64) }])
    layers.set(keyOf(['kitchen', 'soup']), { name: 'Onion soup' })
    await open()

    document.querySelector<HTMLButtonElement>(`${HOST} .hc-recipe-template`)?.click()
    expect(document.querySelector(`${HOST} .hc-recipe-picker`)).not.toBeNull()
    expect(heardOn(DOMAIN_SHELF_WANTED)).toEqual([{ owner: 'recipe-picker', wanted: true }])
    // Nothing of a domain is here before the shelf says which domains are on.
    expect(fakes.asked).toEqual([])

    EffectBus.emit(SOURCES_CHANGED, { zones: ['friends.example'], all: ['friends.example', 'off.example'], query: '' })
    const entry = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(`${HOST} .hc-recipe-picker-entry[data-sig="${sig}"]`)
    await until(() => entry() !== null, 'the offer is listed')
    expect(fakes.asked).toEqual(['friends.example'])
    expect(entry()?.closest('section')?.querySelector('h3')?.textContent).toBe('friends.example')
    expect(heardOn(SOURCES_COUNTED)).toContainEqual({ meaning: 'recipe:template', counts: { 'friends.example': 1 } })
    // Listed, and still kept nowhere.
    expect(heap.has(sig)).toBe(false)
    expect(log).toEqual([])

    entry()?.click()
    await until(() => commits.length === 1, 'the recipe names the layout')

    // Their bytes, byte for byte, on the cook's list, before the recipe named them.
    expect(Array.from(heap.get(sig) ?? [])).toEqual(Array.from(bytes))
    expect(lists).toEqual([[sig]])
    expect(log.indexOf(`put:${sig}`)).toBeGreaterThanOrEqual(0)
    expect(log.indexOf(`put:${sig}`)).toBeLessThan(log.indexOf(`list:${sig}`))
    expect(log.indexOf(`list:${sig}`)).toBeLessThan(log.indexOf('commit'))
    const recipeSig = (commits[0].layer[RECIPE_SLOT] as string[])[0]
    expect((JSON.parse(new TextDecoder().decode(heap.get(recipeSig))) as { template: string }).template).toBe(sig)
    expect(document.querySelector(`${HOST} .hc-recipe-template`)?.textContent).toContain('Supper club')

    // The pick closed the picker and let the shelf go.
    expect(document.querySelector('.hc-recipe-picker')).toBeNull()
    expect(heardOn(DOMAIN_SHELF_WANTED)).toEqual([{ owner: 'recipe-picker', wanted: true }, { owner: 'recipe-picker', wanted: false }])
  })

  it('asks for the domain shelf while the picker is open, shares its search, and lets the shelf go on close', async () => {
    layers.set(keyOf(['kitchen', 'soup']), { name: 'Onion soup' })
    await open()
    expect(heardOn(DOMAIN_SHELF_WANTED)).toEqual([])

    document.querySelector<HTMLButtonElement>(`${HOST} .hc-recipe-template`)?.click()
    expect(heardOn(DOMAIN_SHELF_WANTED)).toEqual([{ owner: 'recipe-picker', wanted: true }])
    const groups = (): string[] => [...document.querySelectorAll(`${HOST} .hc-recipe-picker-group h3`)].map(node => node.textContent ?? '')
    expect(groups()).toEqual(['Built in'])

    const search = document.querySelector<HTMLInputElement>(`${HOST} .hc-recipe-picker input[type="search"]`) as HTMLInputElement
    search.value = 'Week'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    expect(heardOn(SOURCES_QUERY)).toEqual([{ query: 'Week' }])
    // Words typed in the shelf's own field reach the picker's.
    EffectBus.emit(SOURCES_CHANGED, { zones: [], all: [], query: 'tasting' })
    expect(search.value).toBe('tasting')

    document.querySelector<HTMLButtonElement>(`${HOST} .hc-recipe-picker .hc-recipe-tool`)?.click()
    expect(document.querySelector('.hc-recipe-picker')).toBeNull()
    expect(heardOn(DOMAIN_SHELF_WANTED)).toEqual([{ owner: 'recipe-picker', wanted: true }, { owner: 'recipe-picker', wanted: false }])
    // The page is still up: only the picker closed.
    expect(host()).not.toBeNull()
    expect(mode.mode).toBe(RECIPE_VIEW)
  })

  it('gives focus back to the template button when the picker closes', async () => {
    layers.set(keyOf(['kitchen', 'soup']), { name: 'Onion soup' })
    await open()
    const opener = document.querySelector<HTMLButtonElement>(`${HOST} .hc-recipe-template`) as HTMLButtonElement
    opener.focus()
    opener.click()
    const search = document.querySelector<HTMLInputElement>(`${HOST} .hc-recipe-picker input[type="search"]`) as HTMLInputElement
    expect(document.activeElement).toBe(search)
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(document.querySelector('.hc-recipe-picker')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('saves the unfinished words on close, takes the page down and returns to the hexagons', async () => {
    layers.set(keyOf(['kitchen', 'soup']), { name: 'Onion soup' })
    await open()
    type('Written a moment before leaving.')

    document.querySelector<HTMLButtonElement>(`${HOST} [aria-label="Close the recipe"]`)?.click()
    await until(() => mode.mode === 'hexagons', 'the view leaves')

    expect(commits).toHaveLength(1)
    expect(host()).toBeNull()
    expect(exit).toHaveBeenCalledWith('view:active', 'recipe-view')
    expect(heardOn('keymap:release')).toEqual([{ reason: 'recipe-view' }])
    // The pause that was pending does not save a second time.
    await wait(SAVE_DEBOUNCE_MS + 200)
    expect(commits).toHaveLength(1)
  })

  it('leaves by the back gesture, releasing the shelf when the picker was the last thing open', async () => {
    layers.set(keyOf(['kitchen', 'soup']), { name: 'Onion soup' })
    await open()
    document.querySelector<HTMLButtonElement>(`${HOST} .hc-recipe-template`)?.click()

    // One step back takes the picker off; the next leaves the page.
    backEntry?.back()
    expect(document.querySelector('.hc-recipe-picker')).toBeNull()
    expect(heardOn(DOMAIN_SHELF_WANTED)).toEqual([{ owner: 'recipe-picker', wanted: true }, { owner: 'recipe-picker', wanted: false }])
    expect(mode.mode).toBe(RECIPE_VIEW)
    backEntry?.back()
    await until(() => mode.mode === 'hexagons', 'the view leaves')
    expect(host()).toBeNull()
  })

  it('cleans up the same way when the mode is left by another route', async () => {
    layers.set(keyOf(['kitchen', 'soup']), { name: 'Onion soup' })
    await open()
    document.querySelector<HTMLButtonElement>(`${HOST} .hc-recipe-template`)?.click()
    type('Left through another door.')

    mode.setMode('tree')
    await until(() => host() === null, 'the page comes down')

    expect(commits).toHaveLength(1)
    expect(exit).toHaveBeenCalledWith('view:active', 'recipe-view')
    expect(heardOn(DOMAIN_SHELF_WANTED)).toEqual([{ owner: 'recipe-picker', wanted: true }, { owner: 'recipe-picker', wanted: false }])
    expect(heardOn('keymap:release')).toEqual([{ reason: 'recipe-view' }])
    // A flip onto another view is a change of face: nobody is sent to the hexagons.
    expect(mode.mode).toBe('tree')
  })

  it('comes back out onto the surface it was opened from', async () => {
    layers.set(keyOf(['kitchen', 'soup']), { name: 'Onion soup' })
    drone = new RecipeViewDrone() as unknown as DroneShape
    await drone.pulse('')
    mode.setMode('tree')
    EffectBus.emit(VIEW_SPAWN_EFFECT, { view: RECIPE_VIEW, mode: 'tree', segments: ['kitchen'], at: Date.now() })
    EffectBus.emit(RECIPE_OPEN_FOR_TILE, { view: RECIPE_VIEW, segments: ['kitchen', 'soup'], at: Date.now() })
    await until(() => host() !== null, 'the page mounts')

    backEntry?.back()
    await until(() => host() === null, 'the page comes down')
    expect(mode.mode).toBe('tree')
  })

  it('leaves for the hexagons when the cook walks onto a tile that holds no recipe', async () => {
    layers.set(keyOf(['kitchen', 'soup']), { name: 'Onion soup' })
    layers.set(keyOf(['garden']), { name: 'Garden' })
    await open()
    lineage.walk(['garden'])
    await until(() => mode.mode === 'hexagons', 'the view leaves')
    expect(host()).toBeNull()
  })

  it('gives a tile whose recipe does not read the read-along only, and saves nothing over it', async () => {
    layers.set(keyOf(['kitchen', 'soup']), { name: 'Onion soup', [RECIPE_SLOT]: ['a'.repeat(64)] })
    await open()
    expect(status()).toBe('This recipe could not be opened: its bytes are not held here')
    expect(document.querySelector(`${HOST} textarea`)).toBeNull()
    // The read-along says so too, and why, where the recipe would be: never that nothing is written.
    const sheet = document.querySelector<HTMLElement>(`${HOST} .hc-recipe-page`)
    expect(sheet?.dataset['page']).toBe('unreadable')
    expect(sheet?.querySelector('.hc-recipe-unreadable-why')?.textContent).toBe('its bytes are not held here')
    expect(sheet?.textContent).not.toContain('Nothing is written here yet.')

    document.querySelector<HTMLButtonElement>(`${HOST} [aria-label="Close the recipe"]`)?.click()
    await until(() => mode.mode === 'hexagons', 'the view leaves')
    expect(log).toEqual([])
  })

  it('holds an arranged layout once per pause, and the recipe names it', async () => {
    layers.set(keyOf(['kitchen', 'soup']), { name: 'Onion soup' })
    await open()
    menu('Arrange')?.click()
    const name = document.querySelector<HTMLInputElement>(`${HOST} [data-at="name"]`) as HTMLInputElement
    // Every keystroke of a rename is a layout of its own: only the one the pause finds is held.
    for (const words of ['S', 'Su', 'Sunday soup']) {
      name.value = words
      name.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await until(() => commits.length === 1, 'the pause saves')

    const puts = log.filter(line => line.startsWith('put:')).map(line => line.slice(4))
    expect(puts).toHaveLength(2)
    const layout = await parseRecipeTemplate(heap.get(puts[0]) as Uint8Array, puts[0])
    expect(layout.ok && layout.template.name).toBe('Sunday soup')
    const recipeSig = (commits[0].layer[RECIPE_SLOT] as string[])[0]
    expect(recipeSig).toBe(puts[1])
    expect((JSON.parse(new TextDecoder().decode(heap.get(recipeSig))) as { template: string }).template).toBe(puts[0])
    // Held, and not on the cook's list: arranging is not keeping.
    expect(lists).toEqual([])
  })

  it('keeps the layout on the cook\'s list when asked, and says so', async () => {
    layers.set(keyOf(['kitchen', 'soup']), { name: 'Onion soup' })
    await open()
    menu('Keep as a template')?.click()
    await until(() => status() === 'Kept as a template', 'the page says so')
    expect(lists).toHaveLength(1)
    const kept = await parseRecipeTemplate(heap.get(lists[0][0]) as Uint8Array, lists[0][0])
    expect(kept.ok && kept.template.name).toBe('Family recipe')
    // Keeping a layout is not saving a recipe.
    expect(commits).toHaveLength(0)
  })

  it('offers the tile editor for a tile of the page the cook stands on, after saving and leaving', async () => {
    layers.set(keyOf(['kitchen', 'soup']), { name: 'Onion soup' })
    const asked: unknown[] = []
    let replay = true
    const off = EffectBus.on('tile:action', payload => { if (!replay) asked.push(payload) })
    replay = false
    await open()
    type('Saved before the editor opens.')
    menu('Edit tile')?.click()
    await until(() => asked.length === 1, 'the editor is asked for')
    off()
    expect(asked).toEqual([{ action: 'edit', label: 'soup', q: 0, r: 0, index: 0 }])
    expect(commits).toHaveLength(1)
    expect(mode.mode).toBe('hexagons')
    expect(host()).toBeNull()
  })

  it('does not offer the tile editor for the tile the cook is standing in', async () => {
    lineage.at = ['kitchen', 'soup']
    layers.set(keyOf(['kitchen', 'soup']), { name: 'Onion soup' })
    await open()
    expect(menu('Edit tile')).toBeUndefined()
    expect(menu('Arrange')).not.toBeUndefined()
  })

  it('answers Escape on the page and from anywhere that is not a field of its own', async () => {
    layers.set(keyOf(['kitchen', 'soup']), { name: 'Onion soup' })
    await open()
    const escape = (target: EventTarget): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, composed: true })
      target.dispatchEvent(event)
      return event
    }

    // A field outside the page keeps its own Escape.
    const field = document.body.appendChild(document.createElement('input'))
    expect(escape(field).defaultPrevented).toBe(false)
    await wait(20)
    expect(mode.mode).toBe(RECIPE_VIEW)
    field.remove()

    // Anything else outside the page is a way out.
    const plate = document.body.appendChild(document.createElement('button'))
    expect(escape(plate).defaultPrevented).toBe(true)
    await until(() => mode.mode === 'hexagons', 'the view leaves')
    plate.remove()
    expect(host()).toBeNull()

    // On the page itself the page answers, and it closes the same way.
    EffectBus.emit(RECIPE_OPEN_FOR_TILE, { view: RECIPE_VIEW, segments: ['kitchen', 'soup'], at: Date.now() })
    await until(() => host() !== null, 'the page mounts again')
    escape(story())
    await until(() => mode.mode === 'hexagons', 'the view leaves')
    expect(host()).toBeNull()
  })

  it('gives a visitor the read-along only: no saves, no shelf, no bulb, nothing held for a layout looked through', async () => {
    await tile(['kitchen', 'soup'], 'Onion soup', SOUP)
    document.documentElement.dataset['hypercombMode'] = 'visitor'
    try {
      await open()
      expect(document.querySelector(`${HOST} textarea`)).toBeNull()
      // A visitor's hive is not theirs to light, and a published page follows no one.
      expect(asked().shared).toBeUndefined()
      expect(asked().onToggleShared).toBeUndefined()
      expect(asked().onBrowse).toBeUndefined()
      expect(menu('Arrange')).toBeUndefined()
      expect(menu('Keep as a template')).toBeUndefined()

      document.querySelector<HTMLButtonElement>(`${HOST} .hc-recipe-template`)?.click()
      EffectBus.emit(SOURCES_CHANGED, { zones: ['friends.example'], all: ['friends.example'], query: '' })
      await wait(20)
      expect(heardOn(DOMAIN_SHELF_WANTED)).toEqual([])
      expect(fakes.asked).toEqual([])

      const weeknight = [...document.querySelectorAll<HTMLButtonElement>(`${HOST} .hc-recipe-picker-entry`)]
        .find(entry => entry.textContent?.includes('Weeknight'))
      weeknight?.click()
      expect(document.querySelector('.hc-recipe-picker')).toBeNull()
      expect(document.querySelector(`${HOST} .hc-recipe-template`)?.textContent).toContain('Weeknight')
      await wait(SAVE_DEBOUNCE_MS + 200)
      expect(log).toEqual([])
    } finally {
      delete document.documentElement.dataset['hypercombMode']
    }
  })

  it('unregisters its way back when disposed', async () => {
    layers.set(keyOf(['kitchen', 'soup']), { name: 'Onion soup' })
    await open()
    drone?.markDisposed()
    drone = null
    expect(dropBack).toHaveBeenCalledTimes(1)
    expect(host()).toBeNull()
  })

  describe('the desk: the list, the bulb, the room and Browse', () => {
    /** A page of three tiles: two hold a recipe, one holds none. */
    const kitchen = async (): Promise<void> => {
      pageOf(['kitchen'], ['soup', 'bread', 'salad'])
      await tile(['kitchen', 'soup'], 'soup', SOUP)
      await tile(['kitchen', 'bread'], 'bread', BREAD)
      await tile(['kitchen', 'salad'], 'salad')
    }
    const light = (label: string, on = true): void => {
      setCellPublic('/kitchen', label, on)
      EffectBus.emit(LIGHTS_CHANGED, { cell: label, location: '/kitchen', public: on })
    }
    const join = (): void => EffectBus.emit(ROOM_CHANGED, { public: true })
    const words = (): string | undefined => lastOf<Shared>(desk.shared)?.words

    it('gives the page its address and the tiles of the page the recipe\'s tile sits on, the open one marked', async () => {
      await kitchen()
      await open()
      expect(asked().address).toBe('/kitchen/soup')
      // The first paint: names and marks, with no read per tile. None wears a mark in this hive.
      expect(asked().tiles).toEqual([
        { label: 'soup', hasRecipe: true, current: true },
        { label: 'bread', hasRecipe: false, current: false },
        { label: 'salad', hasRecipe: false, current: false },
      ])
      // Then each unmarked tile's own layer says whether it holds a recipe.
      await until(() => desk.tiles.length > 0, 'the list is read')
      expect(lastOf<Row[]>(desk.tiles)).toEqual([
        { label: 'soup', hasRecipe: true, current: true },
        { label: 'bread', hasRecipe: true, current: false },
        { label: 'salad', hasRecipe: false, current: false },
      ])
      expect(log).toEqual([])
    })

    it('lists the open tile alone when its page cannot be read', async () => {
      await tile(['kitchen', 'soup'], 'soup', SOUP)
      await open()
      expect(asked().tiles).toEqual([{ label: 'soup', hasRecipe: true, current: true }])
    })

    it('shows another tile\'s recipe on the same desk when its row is chosen, after saving what was written', async () => {
      await kitchen()
      await open()
      const before = host()
      type('Changed just before the bread.')
      asked().onPickTile?.('bread')
      await until(() => title() === 'bread', 'the bread is on the desk')

      // Saved first, on the tile it was written on.
      expect(commits.map(commit => commit.segments)).toEqual([['kitchen', 'soup']])
      expect(story().value).toBe('Three days, mostly waiting.')
      expect(lastOf<string>(desk.address)).toBe('/kitchen/bread')
      expect(lastOf<Row[]>(desk.tiles)).toEqual([
        { label: 'soup', hasRecipe: true, current: false },
        { label: 'bread', hasRecipe: true, current: true },
        { label: 'salad', hasRecipe: false, current: false },
      ])
      // The same desk: nothing was torn down, and the mode never changed.
      expect(host()).toBe(before)
      expect(mode.mode).toBe(RECIPE_VIEW)
      expect(enter).toHaveBeenCalledTimes(1)
      expect(exit).not.toHaveBeenCalled()
      expect(heardOn('keymap:hold')).toHaveLength(1)
      expect(heardOn('keymap:release')).toEqual([])
      // The pause that was pending does not save the bread as the soup, nor anything again.
      await wait(SAVE_DEBOUNCE_MS + 200)
      expect(commits).toHaveLength(1)

      // A tile with no recipe opens empty in the first built-in layout, and nothing is saved until an edit.
      asked().onPickTile?.('salad')
      await until(() => title() === 'salad', 'the salad is on the desk')
      expect(story().value).toBe('')
      expect(document.querySelector(`${HOST} .hc-recipe-template`)?.textContent).toContain('Family recipe')
      await wait(SAVE_DEBOUNCE_MS + 200)
      expect(commits).toHaveLength(1)
      type('Leaves, mostly.')
      await until(() => commits.length === 2, 'the pause saves')
      expect(commits[1].segments).toEqual(['kitchen', 'salad'])
      await until(() => lastOf<Row[]>(desk.tiles)?.[2]?.hasRecipe === true, 'the list says the salad holds a recipe now')

      // A later open is of the tile on the desk, not the one first opened.
      asked().onPickTile?.('soup')
      await until(() => title() === 'soup', 'the soup is back on the desk')
      expect(story().value).toBe('Changed just before the bread.')
      expect(lastOf<Row[]>(desk.tiles)).toEqual([
        { label: 'soup', hasRecipe: true, current: true },
        { label: 'bread', hasRecipe: true, current: false },
        { label: 'salad', hasRecipe: true, current: false },
      ])
    })

    it('says where the recipe is offered: only you, your pools when you publish, or the room', async () => {
      await kitchen()
      await open()
      expect(asked().shared).toEqual({ lit: false, words: 'Only you' })

      // Lit on the grid: the bulb follows. Outside a room nothing is sent anywhere.
      light('soup')
      expect(lastOf(desk.shared)).toEqual({ lit: true, words: 'On: left in your pools when you publish' })
      expect(room.shared).toEqual([])

      // The tab joins a room: a lit recipe is an entry there, first on its way, then kept.
      join()
      expect(lastOf(desk.shared)).toEqual({ lit: true, words: 'Sharing with class 4b…' })
      await until(() => lastOf<Shared>(desk.shared)?.tone === 'good', 'the host kept the entry')
      expect(lastOf(desk.shared)).toEqual({ lit: true, tone: 'good', words: 'Shared with class 4b \u00b7 class.example' })
      expect(room.shared).toEqual(['kitchen/soup'])

      // The membership said again is no reason to send again.
      join()
      await wait(30)
      expect(room.shared).toEqual(['kitchen/soup'])
      // Another room is owed the entry anew: what the first room's host answered says nothing about it.
      ;(services['@hypercomb.social/RoomStore'] as { value: string }).value = 'class 5a'
      join()
      expect(lastOf(desk.shared)).toEqual({ lit: true, words: 'Sharing with class 5a…' })
      await until(() => words() === 'Shared with class 5a \u00b7 class.example', 'the other room keeps it')
      expect(room.shared).toEqual(['kitchen/soup', 'kitchen/soup'])

      // The tab leaves: back to what a publish would do, and nothing more is sent.
      EffectBus.emit(ROOM_CHANGED, { public: false })
      expect(lastOf(desk.shared)).toEqual({ lit: true, words: 'On: left in your pools when you publish' })
      type('Written outside any room.')
      await until(() => commits.length === 1, 'the pause saves')
      await wait(30)
      expect(room.shared).toEqual(['kitchen/soup', 'kitchen/soup'])
      expect(room.retracted).toEqual([])
    })

    it('says a host that keeps entries only for its own people beside the bulb, and any other refusal in the status line', async () => {
      await kitchen()
      setCellPublic('/kitchen', 'soup', true)
      join()
      room.answer = { ok: false, live: true, reason: 'class.example keeps entries only for its own people. Your entry is shared live while you are here.' } satisfies RoomAnswer
      await open()
      // Opened lit, in a room: on its way before the host has answered.
      expect(asked().shared).toEqual({ lit: true, words: 'Sharing with class 4b…' })
      await until(() => lastOf<Shared>(desk.shared)?.tone === 'warn', 'the host refused the key')
      expect(lastOf(desk.shared)).toEqual({ lit: true, tone: 'warn', words: 'Shared live with class 4b. class.example keeps entries only for its own people' })
      expect(status()).toBe('')

      room.answer = { ok: false, reason: 'class.example did not answer. The entry was not kept there.' } satisfies RoomAnswer
      type('Now with leeks.')
      await until(() => status() === 'class.example did not answer. The entry was not kept there.', 'the reason is said')
      expect(lastOf(desk.shared)).toEqual({ lit: true, words: 'Sharing with class 4b…' })
      expect(room.shared).toEqual(['kitchen/soup', 'kitchen/soup'])
    })

    it('shares a lit recipe once per save, one at a time, never an empty one and never an unlit one', async () => {
      await kitchen()
      setCellPublic('/kitchen', 'salad', true)
      join()
      await open(['kitchen', 'salad'])
      // Lit, in a room, and saying nothing yet: there is nothing to share.
      expect(asked().shared).toEqual({ lit: true, words: 'On: shared with class 4b once you write something' })
      await wait(30)
      expect(room.shared).toEqual([])

      let answer = (): void => undefined
      room.gate = new Promise<void>(resolve => { answer = resolve })
      type('Leaves.')
      await until(() => commits.length === 1, 'the pause saves')
      await until(() => room.shared.length === 1, 'the save is shared')
      // A second save lands while the host has not answered the first: it waits its turn.
      type('Leaves, and a lemon.')
      await until(() => commits.length === 2, 'the pause saves again')
      await wait(30)
      expect(room.shared).toEqual(['kitchen/salad'])
      room.gate = null
      answer()
      await until(() => room.shared.length === 2, 'the second save is shared')
      await until(() => words() === 'Shared with class 4b \u00b7 class.example', 'the host kept it')
      // The same words again are neither a save nor a share.
      type('Leaves, and a lemon.')
      await wait(SAVE_DEBOUNCE_MS + 200)
      expect(commits).toHaveLength(2)
      expect(room.shared).toEqual(['kitchen/salad', 'kitchen/salad'])

      // The soup is not lit: its saves go nowhere.
      asked().onPickTile?.('soup')
      await until(() => title() === 'soup', 'the soup is on the desk')
      expect(lastOf(desk.shared)).toEqual({ lit: false, words: 'Only you' })
      type('Nobody else reads this.')
      await until(() => commits.length === 3, 'the pause saves')
      await wait(50)
      expect(room.shared).toEqual(['kitchen/salad', 'kitchen/salad'])
      expect(room.retracted).toEqual([])
    })

    it('does not send again what the host already keeps when the tile comes back onto the desk', async () => {
      await kitchen()
      setCellPublic('/kitchen', 'soup', true)
      join()
      await open()
      await until(() => words() === 'Shared with class 4b \u00b7 class.example', 'the host kept it')
      asked().onPickTile?.('bread')
      await until(() => title() === 'bread', 'the bread is on the desk')
      asked().onPickTile?.('soup')
      await until(() => title() === 'soup', 'the soup is back')
      await wait(30)
      expect(room.shared).toEqual(['kitchen/soup'])
      expect(words()).toBe('Shared with class 4b \u00b7 class.example')
    })

    it('takes the entry back once when its recipe is emptied, and once when its tile is unlit by the bulb', async () => {
      await kitchen()
      setCellPublic('/kitchen', 'soup', true)
      join()
      await open()
      await until(() => room.shared.length === 1, 'the open recipe is shared')

      // Emptied: there is nothing left to offer.
      type('')
      await until(() => commits.length === 1, 'the pause saves')
      await until(() => room.retracted.length === 1, 'the entry is taken back')
      expect(room.retracted).toEqual(['kitchen/soup'])
      expect(words()).toBe('On: shared with class 4b once you write something')

      // Written again, then unlit by the bulb.
      type('Back again.')
      await until(() => room.shared.length === 2, 'it is shared again')
      await until(() => words() === 'Shared with class 4b \u00b7 class.example', 'the host kept it')
      asked().onToggleShared?.()
      expect(isCellPublic('/kitchen', 'soup')).toBe(false)
      expect(lastOf(desk.shared)).toEqual({ lit: false, words: 'Only you' })
      await until(() => room.retracted.length === 2, 'the entry is taken back')
      // Once: the word's file takes back what is unlit, and the desk sends no take-back of its own for it.
      await wait(60)
      expect(room.retracted).toEqual(['kitchen/soup', 'kitchen/soup'])
      // Unlit, its saves are nobody else's.
      type('Mine alone.')
      await until(() => commits.length === 3, 'the pause saves')
      await wait(50)
      expect(room.shared).toHaveLength(2)
    })

    it('lights a tile of the page the cook stands on through the tile actions drone, and never twice', async () => {
      await kitchen()
      await open()
      // The drone that owns the marks on the page being looked at: it claims the press and flips the mark.
      const pressed: unknown[] = []
      let replay = true
      const off = EffectBus.on<{ action: string; label: string; accept?: () => void }>('tile:action', payload => {
        if (replay) return
        pressed.push({ action: payload.action, label: payload.label })
        payload.accept?.()
        light(payload.label, !isIndividuallyPublic('/kitchen', payload.label))
      })
      replay = false
      asked().onToggleShared?.()
      expect(pressed).toEqual([{ action: 'make-public', label: 'soup' }])
      expect(isIndividuallyPublic('/kitchen', 'soup')).toBe(true)
      expect(lastOf(desk.shared)).toEqual({ lit: true, words: 'On: left in your pools when you publish' })
      asked().onToggleShared?.()
      expect(isIndividuallyPublic('/kitchen', 'soup')).toBe(false)
      expect(lastOf(desk.shared)).toEqual({ lit: false, words: 'Only you' })
      off()
      // A press is a command: a later listener is never handed an old one.
      const replayed: unknown[] = []
      EffectBus.on('tile:action', payload => { replayed.push(payload) })()
      expect(replayed.filter(payload => (payload as { action?: string })?.action === 'make-public')).toEqual([])
    })

    it('lights a tile by its route, with the same announcement, when it is not on the page the cook stands on', async () => {
      await kitchen()
      lineage.at = ['kitchen', 'soup']
      const pressed: unknown[] = []
      const changed: unknown[] = []
      let replay = true
      const offs = [
        EffectBus.on('tile:action', payload => { if (!replay) pressed.push(payload) }),
        EffectBus.on(LIGHTS_CHANGED, payload => { if (!replay) changed.push(payload) }),
      ]
      replay = false
      await open()
      expect(asked().shared).toEqual({ lit: false, words: 'Only you' })

      asked().onToggleShared?.()
      expect(pressed).toEqual([])
      expect(isIndividuallyPublic('/kitchen', 'soup')).toBe(true)
      expect(changed).toEqual([{ cell: 'soup', location: '/kitchen', public: true }])
      expect(lastOf(desk.shared)).toEqual({ lit: true, words: 'On: left in your pools when you publish' })

      asked().onToggleShared?.()
      expect(isCellPublic('/kitchen', 'soup')).toBe(false)
      expect(changed).toEqual([
        { cell: 'soup', location: '/kitchen', public: true },
        { cell: 'soup', location: '/kitchen', public: false },
      ])
      for (const off of offs) off()
    })

    it('says so when a branch above the tile is what lights it, and changes no mark', async () => {
      await kitchen()
      setBranchPublic('/', 'kitchen', true)
      await open()
      expect(asked().shared).toEqual({ lit: true, words: 'On: left in your pools when you publish' })
      asked().onToggleShared?.()
      expect(status()).toBe('This tile is on because a branch above it is on. Turn that branch off to stop offering it.')
      expect(isCellPublic('/kitchen', 'soup')).toBe(true)
      expect(isIndividuallyPublic('/kitchen', 'soup')).toBe(false)
    })

    it('Browse saves, says the way back and enters the catalogue, and coming back shows the same recipe', async () => {
      await kitchen()
      const spawns: unknown[] = []
      let replay = true
      const off = EffectBus.on(VIEW_SPAWN_EFFECT, payload => { if (!replay) spawns.push(payload) })
      replay = false
      await open()
      type('Written before browsing.')
      const pressedAt = Date.now()
      asked().onBrowse?.()
      await until(() => mode.mode === 'catalogue', 'the catalogue takes over')
      off()

      expect(commits).toHaveLength(1)
      expect(spawns).toHaveLength(1)
      expect(spawns[0]).toMatchObject({ view: 'catalogue', mode: RECIPE_VIEW, segments: ['kitchen'] })
      expect((spawns[0] as { at: number }).at).toBeGreaterThanOrEqual(pressedAt)
      await until(() => host() === null, 'the desk comes down')
      expect(exit).toHaveBeenCalledWith('view:active', 'recipe-view')

      // The catalogue's way out names the hexagons, and its spawn puts this view back in the same breath.
      mode.setMode('hexagons')
      mode.setMode(RECIPE_VIEW)
      await until(() => host() !== null, 'the desk is back')
      // The tile that was on the desk, not the place the cook stands.
      expect(title()).toBe('soup')
      expect(story().value).toBe('Written before browsing.')
    })

    it('forgets the browsed recipe when the catalogue was left for somewhere else', async () => {
      await kitchen()
      await open()
      asked().onBrowse?.()
      await until(() => mode.mode === 'catalogue', 'the catalogue takes over')
      mode.setMode('hexagons')
      await wait(20)
      // Entered again by another door: the tile the cook stands in, as ever.
      mode.setMode(RECIPE_VIEW)
      await until(() => host() !== null, 'the desk mounts')
      expect(title()).toBe('kitchen')
    })

    describe('a tile unlit in a room: its recipe is taken back, the desk up or not', () => {
      const KEPT = 'Shared with class 4b · class.example'
      const HISTORY = '@diamondcoreprocessor.com/HistoryService'
      /** Long enough for a take-back that should not happen to have happened. */
      const settled = (): Promise<void> => wait(80)
      /** A branch root's own mark, changed the way the tile actions drone changes it. */
      const branch = (on: boolean): void => {
        setBranchPublic('/', 'kitchen', on)
        EffectBus.emit(LIGHTS_CHANGED, { cell: 'kitchen', location: '/', public: on, branch: true })
      }

      it('takes it back when the tile is unlit from the grid with the desk closed', async () => {
        await kitchen()
        setCellPublic('/kitchen', 'soup', true)
        join()
        await open()
        await until(() => words() === KEPT, 'the host kept it')
        mode.setMode('hexagons')
        await until(() => host() === null, 'the desk comes down')

        light('soup', false)
        await until(() => room.retracted.length === 1, 'the entry is taken back')
        await settled()
        expect(room.retracted).toEqual(['kitchen/soup'])
      })

      it('takes it back when another tile is on the desk, and shares it anew once it is lit again', async () => {
        await kitchen()
        setCellPublic('/kitchen', 'soup', true)
        join()
        await open()
        await until(() => words() === KEPT, 'the host kept it')
        asked().onPickTile?.('bread')
        await until(() => title() === 'bread', 'the bread is on the desk')

        light('soup', false)
        await until(() => room.retracted.length === 1, 'the entry is taken back')
        await settled()
        expect(room.retracted).toEqual(['kitchen/soup'])

        // What the host said of the soup no longer holds: lit again and back on the desk, it is owed anew.
        light('soup')
        asked().onPickTile?.('soup')
        await until(() => title() === 'soup', 'the soup is back')
        await until(() => room.shared.length === 2, 'it is shared again')
        expect(room.shared).toEqual(['kitchen/soup', 'kitchen/soup'])
      })

      it('takes it back after a reload, with no record of having shared it, and sends nothing for a tile that holds no recipe', async () => {
        await kitchen()
        setCellPublic('/kitchen', 'soup', true)
        setCellPublic('/kitchen', 'salad', true)
        join()
        // No desk has been up in this session: nothing here remembers a share.
        light('salad', false)
        await settled()
        expect(room.retracted).toEqual([])

        light('soup', false)
        await until(() => room.retracted.length === 1, 'the entry is taken back')
        await settled()
        expect(room.retracted).toEqual(['kitchen/soup'])
        expect(room.shared).toEqual([])
      })

      it('leaves a tile a lit branch above still lights, and takes back the recipes under a branch that goes dark', async () => {
        await kitchen()
        setCellPublic('/kitchen', 'soup', true)
        join()
        branch(true)
        await settled()
        expect(room.retracted).toEqual([])

        // The soup's own mark goes off: the branch above still lights it.
        light('soup', false)
        await settled()
        expect(isCellPublic('/kitchen', 'soup')).toBe(true)
        expect(room.retracted).toEqual([])

        // The branch goes dark. The bread keeps a light of its own, and the salad holds no recipe.
        setCellPublic('/kitchen', 'bread', true)
        branch(false)
        await until(() => room.retracted.length === 1, 'the soup is taken back')
        await settled()
        expect(room.retracted).toEqual(['kitchen/soup'])
      })

      it('takes back what a branch narrowed to its own tile no longer lights', async () => {
        await kitchen()
        setBranchPublic('/', 'kitchen', true)
        join()
        // The tap on a branch root (tile-actions, make-public): the branch goes, the tile alone stays lit,
        // and the announcement says public.
        setBranchPublic('/', 'kitchen', false)
        setCellPublic('/', 'kitchen', true)
        EffectBus.emit(LIGHTS_CHANGED, { cell: 'kitchen', location: '/', public: true })
        await until(() => room.retracted.length === 2, 'the recipes under it are taken back')
        await settled()
        expect([...room.retracted].sort()).toEqual(['kitchen/bread', 'kitchen/soup'])
      })

      it('reads nothing and sends nothing outside a room, or on a shell that only reads', async () => {
        await kitchen()
        setCellPublic('/kitchen', 'soup', true)
        const history = services[HISTORY] as Record<string, (...args: never[]) => Promise<unknown>>
        let reads = 0
        services[HISTORY] = Object.fromEntries(Object.entries(history).map(([name, ask]) =>
          [name, (...args: never[]) => { reads++; return ask(...args) }]))

        light('soup', false)
        await settled()
        expect(reads).toBe(0)
        expect(room.retracted).toEqual([])

        // In a room, on a published page's visitor shell: a visitor takes nothing back.
        setCellPublic('/kitchen', 'soup', true)
        join()
        document.documentElement.dataset['hypercombMode'] = 'visitor'
        try {
          light('soup', false)
          await settled()
        } finally {
          delete document.documentElement.dataset['hypercombMode']
        }
        expect(reads).toBe(0)
        expect(room.retracted).toEqual([])
      })

      it('never sends a share that was waiting its turn when the light went off, and takes back one that was on its way', async () => {
        await kitchen()
        setCellPublic('/kitchen', 'soup', true)
        setCellPublic('/kitchen', 'bread', true)
        join()
        let answer = (): void => undefined
        room.gate = new Promise<void>(resolve => { answer = resolve })
        await open()
        await until(() => room.shared.length === 1, 'the soup is on its way')
        asked().onPickTile?.('bread')
        await until(() => title() === 'bread', 'the bread is on the desk, waiting its turn')

        light('bread', false)
        light('soup', false)
        await until(() => room.retracted.length === 2, 'both are taken back')
        expect([...room.retracted].sort()).toEqual(['kitchen/bread', 'kitchen/soup'])

        // The host answers the soup now: it landed after the take-back, so the desk that sent it takes it back.
        room.gate = null
        answer()
        await until(() => room.retracted.length === 3, 'the late entry is taken back')
        await settled()
        expect(room.retracted[2]).toBe('kitchen/soup')
        // The bread was never sent.
        expect(room.shared).toEqual(['kitchen/soup'])
        expect(lastOf(desk.shared)).toEqual({ lit: false, words: 'Only you' })
      })

      it('says so when the room does not take it back', async () => {
        await kitchen()
        setCellPublic('/kitchen', 'soup', true)
        join()
        room.retractAnswer = { ok: false, reason: 'class.example did not answer. The entry was not kept there.' } satisfies RoomAnswer
        const said: unknown[] = []
        let replay = true
        const off = EffectBus.on('activity:log', payload => { if (!replay) said.push(payload) })
        replay = false

        light('soup', false)
        await until(() => said.length === 1, 'the refusal is said')
        off()
        expect(said).toEqual([{
          message: 'Could not take the recipe back from the room: class.example did not answer. The entry was not kept there.',
          icon: 'menu_book',
        }])
      })
    })
  })

  describe('the table the desk sits on', () => {
    type Choice = { sig: string; name: string; from: 'kept' | 'community'; host?: string }
    type Table = { open?(): void; choose(choice: Choice | null): void; add(files: readonly File[]): void; remove?(choice: Choice): void }
    const tableOf = (): Table => (desk.options as { table?: Table }).table as Table
    const settingOf = (): { sig: string } | null | undefined => (desk.options as { setting?: { sig: string } | null }).setting
    const page = (): HTMLElement | null => document.querySelector<HTMLElement>(`${HOST} .hc-recipe`)
    const png = (words: string): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode(words)])
    const ASH = recipeReadingFloor([[646.1, 206.4], [1007.1, 438.0], [1139.0, 306.0], [781.5, 87.6]])

    /** One document a pool, as the real store keeps them: the template list, the kept sets, and the desk's choice each in its own. */
    let docs: Map<string, ArrayBuffer>
    const read = (meaning: string): unknown => {
      const bytes = docs.get(meaning)
      return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null
    }
    const remember = (meaning: string, value: unknown): void => {
      docs.set(meaning, new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer)
    }

    beforeEach(() => {
      docs = new Map()
      tables.zones = []
      tables.off = []
      tables.offers = []
      tables.asked = []
      const poolOf = (meaning: string) => ({ name: meaning, keys: async function* () { if (docs.has(meaning)) yield 'f'.repeat(64) } })
      services['@hypercomb.social/Store'] = {
        ...(services['@hypercomb.social/Store'] as Record<string, unknown>),
        getPool: async (meaning: string) => poolOf(meaning),
        openPool: async (meaning: string) => (docs.has(meaning) ? poolOf(meaning) : null),
        getPoolDoc: async (pool: { name: string }) => docs.get(pool.name) ?? null,
        putPoolDoc: async (pool: { name: string }, bytes: ArrayBuffer) => {
          docs.set(pool.name, bytes)
          log.push(`doc:${pool.name}`)
          return 'doc'
        },
      }
    })

    /** A set whose pictures this hive holds, kept or not. */
    const aSet = async (name = 'Slate, one plate'): Promise<{ sig: string; doc: RecipeSettingDocument; pictures: string[] }> => {
      const pictures = await Promise.all([`${name} table`, `${name} ash`, `${name} utensils`].map(words => hold(png(words))))
      const doc: RecipeSettingDocument = {
        name, size: [1800, 1200], table: pictures[0], utensils: pictures[2],
        plates: [{ id: 'ash', glaze: 'ash', layer: pictures[1], floor: ASH, centre: [889.7, 255.6] }],
      }
      return { sig: await hold(recipeSettingBytes(doc)), doc, pictures }
    }

    it('opens on the set this hive remembered when every picture of it is here', async () => {
      const set = await aSet()
      remember('recipe:desk', { setting: set.sig })
      await tile(['kitchen', 'soup'], 'Onion soup', SOUP)
      await open()
      expect(settingOf()?.sig).toBe(set.sig)
      expect(page()?.hasAttribute('data-set')).toBe(true)
      // Opening on it wrote nothing.
      expect(log).toEqual([])
    })

    it('opens on the drawn plate when a picture of the remembered set is not here', async () => {
      const set = await aSet()
      remember('recipe:desk', { setting: set.sig })
      heap.delete(set.pictures[1])
      await tile(['kitchen', 'soup'], 'Onion soup', SOUP)
      await open()
      expect(settingOf()).toBeNull()
      expect(page()?.hasAttribute('data-set')).toBe(false)
    })

    it('choosing a kept set lays it and remembers it through the store; the drawn plate is remembered as none', async () => {
      const set = await aSet()
      await tile(['kitchen', 'soup'], 'Onion soup', SOUP)
      await open()
      expect(settingOf()).toBeNull()
      tableOf().choose({ sig: set.sig, name: set.doc.name, from: 'kept' })
      await until(() => page()?.hasAttribute('data-set') === true, 'the desk sits on the set')
      await until(() => (read('recipe:desk') as { setting?: unknown } | null)?.setting === set.sig, 'the choice is remembered')
      tableOf().choose(null)
      await until(() => page()?.hasAttribute('data-set') === false, 'the drawn plate is back')
      await until(() => (read('recipe:desk') as { setting?: unknown } | null)?.setting === null, 'none is remembered')
      // Nothing was ever written to raw storage.
      expect(localStorage.length).toBe(0)
    })

    it('will not lay a kept set whose pictures are not all here, and says why', async () => {
      const set = await aSet()
      heap.delete(set.pictures[0])
      await tile(['kitchen', 'soup'], 'Onion soup', SOUP)
      await open()
      tableOf().choose({ sig: set.sig, name: set.doc.name, from: 'kept' })
      await until(() => status() !== '', 'the desk says why')
      expect(status()).toBe('Could not lay that table set: its pictures are not all held here')
      expect(page()?.hasAttribute('data-set')).toBe(false)
      expect(docs.has('recipe:desk')).toBe(false)
    })

    it('"Add a table set" brings a render in, keeps it, lays it and says so; a refusal is said in one sentence', async () => {
      await tile(['kitchen', 'soup'], 'Onion soup', SOUP)
      await open()
      const render = {
        size_px: [1800, 1200],
        layers: { setting: 'setting.png', table: 'table.png', utensils: 'utensils.png' },
        plates: [{ id: 'ash', glaze: 'ash', layer: 'plate-ash.png', floor_corners_px: [[646.1, 206.4], [1007.1, 438.0], [1139.0, 306.0], [781.5, 87.6]], floor_centre_px: [889.7, 255.6] }],
      }
      const json = new File([JSON.stringify(render)], 'setting.json', { type: 'application/json' })
      const pictures = ['table.png', 'plate-ash.png', 'utensils.png'].map(name => new File([png(name).slice().buffer as ArrayBuffer], name, { type: 'image/png' }))

      tableOf().add([json, pictures[0], pictures[2]])
      await until(() => status().startsWith('Could not add'), 'the refusal is said')
      expect(status()).toBe('Could not add the table set: plate-ash.png is missing: choose it together with setting.json.')
      expect(docs.has('recipe:setting')).toBe(false)

      tableOf().add([json, ...pictures])
      await until(() => status() === 'Table set added', 'the set is added')
      const kept = (read('recipe:setting') as { members: string[] }).members
      expect(kept).toHaveLength(1)
      expect((read('recipe:desk') as { setting: string }).setting).toBe(kept[0])
      expect(page()?.hasAttribute('data-set')).toBe(true)
    })

    it('the open Table control lists the kept sets and what the followed domains that are on offer', async () => {
      const kept = await aSet('Slate, one plate')
      remember('recipe:setting', { meaning: 'recipe:setting', members: [kept.sig] })
      const theirs = await aSet('Cedar, one plate')
      tables.zones = ['friend.example', 'off.example']
      tables.off = ['off.example']
      tables.offers = [{ sig: theirs.sig, setting: { ...theirs.doc, sig: theirs.sig }, bytes: recipeSettingBytes(theirs.doc), host: 'friend.example', hosts: ['friend.example'], pubkey: 'a'.repeat(64) }]
      await tile(['kitchen', 'soup'], 'Onion soup', SOUP)
      await open()
      document.querySelector<HTMLButtonElement>(`${HOST} .hc-recipe-table`)?.click()
      const items = (): string[] => [...document.querySelectorAll<HTMLElement>(`${HOST} .hc-recipe-table-menu button:not(.hc-recipe-table-forget)`)].map(each => each.textContent ?? '')
      await until(() => items().includes('Cedar, one platefriend.example'), 'the domain\'s set is listed')
      expect(items()).toEqual(['Slate, one plate', 'Cedar, one platefriend.example', 'Add a table set', 'The drawn plate'])
      // Only a kept set can be taken off the list.
      expect([...document.querySelectorAll(`${HOST} .hc-recipe-table-forget`)].map(each => each.getAttribute('aria-label'))).toEqual(['Take Slate, one plate off your table sets'])
      // Only the domains that are on were asked.
      expect(tables.asked).toEqual([['friend.example']])
      // Pressing the domain's set keeps it, with its pictures, and lays it.
      ;[...document.querySelectorAll<HTMLButtonElement>(`${HOST} .hc-recipe-table-menu button`)].find(each => each.textContent === 'Cedar, one platefriend.example')?.click()
      await until(() => (read('recipe:desk') as { setting?: unknown } | null)?.setting === theirs.sig, 'the domain\'s set is laid')
      expect((read('recipe:setting') as { members: string[] }).members).toEqual([kept.sig, theirs.sig])
      expect(status()).toBe('Table set kept')
    })

    it("a kept set's remove press takes it off the list, and the desk it sat on is laid on the drawn plate", async () => {
      const slate = await aSet('Slate, one plate')
      const cedar = await aSet('Cedar, one plate')
      remember('recipe:setting', { meaning: 'recipe:setting', members: [slate.sig, cedar.sig] })
      remember('recipe:desk', { setting: slate.sig })
      await tile(['kitchen', 'soup'], 'Onion soup', SOUP)
      await open()
      expect(page()?.hasAttribute('data-set')).toBe(true)
      const remove = tableOf().remove
      expect(remove).toBeTypeOf('function')
      // Another set first: the desk stays where it is.
      remove?.({ sig: cedar.sig, name: cedar.doc.name, from: 'kept' })
      await until(() => status() === 'Cedar, one plate is off your table sets', 'the set is taken off')
      expect((read('recipe:setting') as { members: string[] }).members).toEqual([slate.sig])
      expect(page()?.hasAttribute('data-set')).toBe(true)
      // The set the desk sits on: off the list, and the drawn plate is laid and remembered.
      remove?.({ sig: slate.sig, name: slate.doc.name, from: 'kept' })
      await until(() => status() === 'Slate, one plate is off your table sets', 'the chosen set is taken off')
      expect((read('recipe:setting') as { members: string[] }).members).toEqual([])
      expect(page()?.hasAttribute('data-set')).toBe(false)
      expect((read('recipe:desk') as { setting?: unknown }).setting).toBeNull()
      // Its bytes and pictures stay: taking off the list hides, it never deletes (H4).
      expect(heap.has(slate.sig) && slate.pictures.every(sig => heap.has(sig))).toBe(true)
    })

    it('a visitor gets no Table control', async () => {
      await tile(['kitchen', 'soup'], 'Onion soup', SOUP)
      document.documentElement.dataset['hypercombMode'] = 'visitor'
      try {
        await open()
        expect(tableOf()).toBeUndefined()
        expect(document.querySelector(`${HOST} .hc-recipe-table`)).toBeNull()
      } finally {
        delete document.documentElement.dataset['hypercombMode']
      }
    })
  })

  describe('the word recipe', () => {
    type QueenShape = { invoke(args: string): Promise<void> }
    const queen = (): QueenShape => registered['@diamondcoreprocessor.com/RecipeQueenBee'] as QueenShape

    it('registers the view, with the slot that lights it and a mark of its own', () => {
      const registry = services['@diamondcoreprocessor.com/VisualBeeRegistry'] as InstanceType<typeof VisualBeeRegistry>
      expect(registry.get(RECIPE_VIEW)).toMatchObject({
        view: 'recipe',
        slashCommand: '/recipe',
        slot: RECIPE_SLOT,
        decorationKind: 'visual:recipe:card',
        scope: 'node',
        behavior: 'render',
        toggleIcon: 'menu_book',
        labelKey: 'view.recipe',
        descriptionKey: 'view.recipe.description',
        queenKey: '@diamondcoreprocessor.com/RecipeQueenBee',
        opensOnTileClick: true,
        pheromones: ['platform:desktop', 'platform:mobile'],
      })
    })

    it('says what a lit recipe tile leaves in the pools: its template, and itself as an entry', () => {
      const meanings = poolContributions().map(one => one.meaning)
      expect(meanings).toContain('recipe:template')
      expect(meanings).toContain('recipe:entry')
    })

    it('opens the one selected tile, and leaving comes back where the word was said', async () => {
      layers.set(keyOf(['kitchen', 'soup']), { name: 'Onion soup' })
      services['@diamondcoreprocessor.com/SelectionService'] = { selected: new Set(['soup']) }
      drone = new RecipeViewDrone() as unknown as DroneShape
      await drone.pulse('')
      mode.setMode('tree')

      await queen().invoke('')
      await until(() => host() !== null, 'the page mounts')
      expect(document.querySelector(`${HOST} .hc-recipe-title`)?.textContent).toBe('Onion soup')
      // The cook did not move: the recipe opened over the place they stand.
      expect(lineage.at).toEqual(['kitchen'])

      backEntry?.back()
      await until(() => host() === null, 'the page comes down')
      expect(mode.mode).toBe('tree')
    })

    it('reaches a view that was asleep when the word was said, way back included', async () => {
      layers.set(keyOf(['kitchen', 'soup']), { name: 'Onion soup' })
      services['@diamondcoreprocessor.com/SelectionService'] = { selected: new Set(['soup']) }
      mode.setMode('tree')
      await queen().invoke('')
      expect(host()).toBeNull()

      // The loader wakes the bee on that press; the bus replays it to her.
      drone = new RecipeViewDrone() as unknown as DroneShape
      await drone.pulse('')
      await until(() => host() !== null, 'the page mounts')
      expect(document.querySelector(`${HOST} .hc-recipe-title`)?.textContent).toBe('Onion soup')

      backEntry?.back()
      await until(() => host() === null, 'the page comes down')
      expect(mode.mode).toBe('tree')
    })

    it('opens the place the cook stands in when no single tile is selected', async () => {
      lineage.at = ['kitchen', 'bread']
      layers.set(keyOf(['kitchen', 'bread']), { name: 'Bread' })
      services['@diamondcoreprocessor.com/SelectionService'] = { selected: new Set() }
      drone = new RecipeViewDrone() as unknown as DroneShape
      await drone.pulse('')
      await queen().invoke('')
      await until(() => host() !== null, 'the page mounts')
      expect(document.querySelector(`${HOST} .hc-recipe-title`)?.textContent).toBe('Bread')
    })

    it('says to select a tile or step into one at the hive root, and opens nothing', async () => {
      lineage.at = []
      services['@diamondcoreprocessor.com/SelectionService'] = { selected: new Set() }
      const said: unknown[] = []
      let replay = true
      const off = EffectBus.on('activity:log', payload => { if (!replay) said.push(payload) })
      replay = false
      drone = new RecipeViewDrone() as unknown as DroneShape
      await drone.pulse('')

      await queen().invoke('')
      await wait(30)
      off()
      expect(said).toEqual([{ message: 'Select a tile or step into one first: a recipe lives on a tile.', icon: 'menu_book' }])
      expect(mode.mode).toBe('hexagons')
      expect(host()).toBeNull()
    })
  })
})
