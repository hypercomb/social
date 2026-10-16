// sharing/hold.queen.spec.ts — a held link is the Hyperdex row's own, and a
// row taken off the collection is listed again by the next hold.
//
// The props model and the commit queue are faked at their seams: the property
// writer records what it was asked, and a small history answers membership
// from each page's children, the way the committer leaves them.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const props = vi.hoisted(() => ({
  own: new Map<string, Record<string, unknown>>(),
  writes: [] as { parent: string[]; cell: string; updates: Record<string, unknown>; options: unknown }[],
}))

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
})

vi.mock('../editor/tile-properties.js', () => ({
  TILE_PROPERTY_PINS: 'propertyPins',
  cellLocationSig: async (parent: readonly string[], cell: string) => [...parent, cell].join('/'),
  readTilePropsIndex: () => ({}),
  writeTilePropsIndex: () => {},
  readTilePropsSigAt: async () => undefined,
  readOwnTilePropertiesAt: async (parent: readonly string[], cell: string) => ({ ...(props.own.get([...parent, cell].join('/')) ?? {}) }),
  writeTilePropertiesAt: async (parent: readonly string[], cell: string, updates: Record<string, unknown>, options?: unknown) => {
    props.writes.push({ parent: [...parent], cell, updates, options })
    const key = [...parent, cell].join('/')
    props.own.set(key, { ...(props.own.get(key) ?? {}), ...updates })
  },
}))

vi.mock('./link-acts.js', async (original) => ({
  ...(await original<typeof import('./link-acts.js')>()),
  resolveLink: async (what: string) => ({
    kind: 'own',
    door: { name: what, segments: [what], lineageKey: what, zone: 'jwize.com', address: `https://${what}.jwize.com`, at: 1 },
  }),
}))

import { EffectBus } from '@hypercomb/core'
import { HoldQueenBee } from './hold.queen.js'

type Layer = { name?: string; children?: string[] }

/** Pages by route, children by head sig — a head sig is `<route>@<n>`. */
const hive = () => {
  const heads = new Map<string, Layer>()
  const bySig = new Map<string, Layer>()
  const sigOf = new Map<string, string>()
  let n = 0
  const put = (route: string, layer: Layer): string => {
    const sig = `${route}@${++n}`
    heads.set(route, layer); bySig.set(sig, layer); sigOf.set(route, sig)
    return sig
  }
  put('', { name: '', children: [] })
  const history = {
    sign: async (l: { explorerSegments: () => readonly string[] }) => l.explorerSegments().join('/'),
    currentLayerAt: async (route: string) => heads.get(route) ?? null,
    getLayerBySig: async (sig: string) => bySig.get(sig) ?? null,
    commitLayer: async () => { throw new Error('hold commits through the committer') },
  }
  const committer = {
    // a surviving head comes back as it is; a fresh one is minted
    update: vi.fn(async (segments: readonly string[], layer: Layer) => {
      const route = segments.join('/')
      return sigOf.get(route) ?? put(route, { name: layer.name, children: [] })
    }),
    commitChildrenDeltas: vi.fn(async (segments: readonly string[], changes: { appends?: readonly string[]; removes?: readonly { label?: string }[] }) => {
      const route = segments.join('/')
      const page = heads.get(route) ?? { name: segments[segments.length - 1], children: [] }
      let children = [...(page.children ?? [])]
      for (const r of changes.removes ?? []) children = children.filter(sig => bySig.get(sig)?.name !== r.label)
      children.push(...(changes.appends ?? []))
      return put(route, { ...page, children })
    }),
  }
  const names = (route: string): string[] => (heads.get(route)?.children ?? []).map(sig => bySig.get(sig)?.name ?? '?')
  return { history, committer, names, heads, put }
}

const run = (args: string) => (new HoldQueenBee() as unknown as { execute(a: string): Promise<void> }).execute(args)

const logs: string[] = []
EffectBus.on<{ message: string }>('activity:log', p => { if (p?.message) logs.push(p.message) })

let world: ReturnType<typeof hive>

beforeEach(async () => {
  props.own.clear()
  props.writes.length = 0
  logs.length = 0
  world = hive()
  // /sets stands at the root, as the collections entrance expects
  await world.committer.commitChildrenDeltas([], { appends: [await world.committer.update(['sets'], { name: 'sets' })] })
  ;(globalThis as unknown as { ioc: unknown }).ioc = {
    register: () => {},
    whenReady: () => {},
    get: (key: string) => key === '@diamondcoreprocessor.com/HistoryService' ? world.history
      : key === '@diamondcoreprocessor.com/LayerCommitter' ? world.committer
      : undefined,
  }
})

describe('hold', () => {
  it('writes the link only at the row — the root tile of that name is never touched', async () => {
    props.own.set('business-card', { small: { image: 'x' } })
    await run('business-card')
    expect(world.names('sets')).toEqual(['hyperdex'])
    expect(world.names('sets/hyperdex')).toEqual(['business-card'])
    expect(props.writes).toHaveLength(1)
    expect(props.writes[0]).toMatchObject({ parent: ['sets', 'hyperdex'], cell: 'business-card', options: { onlyHere: true } })
    expect(props.own.get('business-card')).toEqual({ small: { image: 'x' } })
  })

  it('makes its row even when the root tile of that name already links elsewhere', async () => {
    props.own.set('business-card', { link: 'https://elsewhere.example.org' })
    await run('business-card')
    expect(world.names('sets/hyperdex')).toEqual(['business-card'])
    expect(props.own.get('sets/hyperdex/business-card')?.['link']).toBe('https://business-card.jwize.com')
    expect(props.own.get('business-card')?.['link']).toBe('https://elsewhere.example.org')
  })

  it('refuses when the root tile of that name pins a different link, and writes nothing', async () => {
    props.own.set('business-card', { link: 'https://elsewhere.example.org', propertyPins: ['link'] })
    await run('business-card')
    expect(props.writes).toHaveLength(0)
    expect(world.names('sets/hyperdex')).toEqual([])
    expect(logs.at(-1)).toMatch(/locks its link/)
  })

  it('holding what is held changes nothing', async () => {
    await run('business-card')
    const appends = world.committer.commitChildrenDeltas.mock.calls.length
    await run('business-card')
    expect(world.committer.commitChildrenDeltas.mock.calls.length).toBe(appends)
    expect(props.writes).toHaveLength(1)
    expect(logs.at(-1)).toMatch(/already in your Hyperdex/)
  })

  it('lists a removed row again from its surviving head, once', async () => {
    await run('business-card')
    // remove only unlinks: the bag and its link survive
    await world.committer.commitChildrenDeltas(['sets', 'hyperdex'], { removes: [{ label: 'business-card' }] })
    expect(world.names('sets/hyperdex')).toEqual([])
    await run('business-card')
    expect(world.names('sets/hyperdex')).toEqual(['business-card'])
    await run('business-card')
    expect(world.names('sets/hyperdex')).toEqual(['business-card'])
  })

  it('lists a removed collection again rather than writing into an unlisted one', async () => {
    await run('business-card')
    await world.committer.commitChildrenDeltas(['sets'], { removes: [{ label: 'hyperdex' }] })
    await run('team')
    expect(world.names('sets')).toEqual(['hyperdex'])
    expect(world.names('sets/hyperdex')).toEqual(['business-card', 'team'])
  })

  it('re-holding a name after its collection was removed lists it once, from a stale child sig', async () => {
    await run('business-card')
    // the row's head moves on; /sets/hyperdex still holds its older sig
    world.put('sets/hyperdex/business-card', { name: 'business-card', children: [] })
    await world.committer.commitChildrenDeltas(['sets'], { removes: [{ label: 'hyperdex' }] })
    await run('business-card')
    expect(world.names('sets')).toEqual(['hyperdex'])
    expect(world.names('sets/hyperdex')).toEqual(['business-card'])
  })

  it('a surviving row that links elsewhere is not replaced when its collection comes back', async () => {
    await run('business-card')
    props.own.set('sets/hyperdex/business-card', { link: 'https://elsewhere.example.org' })
    await world.committer.commitChildrenDeltas(['sets'], { removes: [{ label: 'hyperdex' }] })
    const writes = props.writes.length
    await run('business-card')
    expect(props.writes).toHaveLength(writes)
    expect(props.own.get('sets/hyperdex/business-card')?.['link']).toBe('https://elsewhere.example.org')
    expect(logs.at(-1)).toMatch(/not replaced/)
  })

  it('appends nothing while a child of the collection cannot be read', async () => {
    await run('business-card')
    const page = world.heads.get('sets/hyperdex')!
    world.heads.set('sets/hyperdex', { ...page, children: [...(page.children ?? []), 'cold@0'] })
    const appends = world.committer.commitChildrenDeltas.mock.calls.length
    await run('team')
    expect(world.committer.commitChildrenDeltas.mock.calls.length).toBe(appends)
    expect(logs.at(-1)).toMatch(/not fully read yet/)
  })
})
