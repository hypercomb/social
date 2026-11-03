// The layout word: a tile's list of trait words, kept as one version of its
// layer, shows only the children those words name (living-presentation.md,
// "The layout behaviour"). Pinned here:
//   1. the parser takes exactly layout, on, off, from /<tile>;
//   2. a layout leaves out every child its words do not name (by the trait
//      fold), and keeps them otherwise untouched;
//   3. `layout on` keeps the markers' words in order as one resource, and its
//      record names that signature; a switch writes the new record and retires
//      the old one;
//   4. `layout from /<tile>` takes the same signature, so one list serves both;
//   5. `layout on` with no markers refuses, and the grid's claim leaves out only
//      what a layout that is on does not name.

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Entry = { sig: string; record: { kind: string; payload: unknown } }

const world = vi.hoisted(() => ({
  slots: new Map<string, Entry[]>(),
  resources: new Map<string, string>(),
  children: new Map<string, string[]>(),
  here: ['presentation', 'simple'] as string[],
  said: [] as string[],
  claims: [] as ((name: string, segments: readonly string[]) => boolean)[],
  seq: 0,
}))

vi.hoisted(() => {
  const store = {
    putResource: async (blob: Blob) => {
      const text = await new Promise<string>(resolve => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsText(blob) })
      const sig = Array.from(text).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, '0').repeat(8)
      world.resources.set(sig, text)
      return sig
    },
    getResource: async (sig: string) => (world.resources.has(sig) ? { text: async () => world.resources.get(sig)! } : null),
  }
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => (key === '@hypercomb.social/Store' ? store : undefined),
    register: () => {},
    whenReady: () => {},
  }
})

vi.mock('./decoration-manifest.js', () => ({
  listDecorations: vi.fn(async ({ kind, segments }: { kind: string; segments: readonly string[] }) =>
    (world.slots.get(segments.join('/')) ?? []).filter(e => e.record.kind === kind)),
  writeDecoration: vi.fn(async ({ kind, segments, payload }: { kind: string; segments: readonly string[]; payload: unknown }) => {
    const key = segments.join('/')
    const sig = `rec-${++world.seq}`
    world.slots.set(key, [...(world.slots.get(key) ?? []), { sig, record: { kind, payload } }])
    return sig
  }),
  removeDecorationAndWait: vi.fn(async ({ sig, segments }: { sig: string; segments: readonly string[] }) => {
    const key = segments.join('/')
    world.slots.set(key, (world.slots.get(key) ?? []).filter(e => e.sig !== sig))
  }),
}))

vi.mock('./trait-read.js', () => ({
  standing: () => [...world.here],
  say: (message: string) => { world.said.push(message) },
  childNamesAt: async (segments: readonly string[]) => [...(world.children.get(segments.join('/')) ?? [])],
}))

vi.mock('./decoration-kind-index.js', () => ({
  claimPresence: (fn: (name: string, segments: readonly string[]) => boolean) => { world.claims.push(fn) },
}))

import { EffectBus, TRAIT_WANT_KIND } from '@hypercomb/core'
import { LAYOUT_KIND, currentLayout, layoutNames, leftOut, parseLayoutArgs } from './layout.js'
import { LayoutQueenBee } from './layout.queen.js'
import './layout-view.drone.js'

const markers = (route: string, words: string[]) => {
  world.slots.set(route, [...(world.slots.get(route) ?? []), ...words.map((word, i) => ({ sig: `want-${route}-${i}`, record: { kind: TRAIT_WANT_KIND, payload: { word } } }))])
}
const layoutsAt = (route: string) => (world.slots.get(route) ?? []).filter(e => e.record.kind === LAYOUT_KIND)
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  world.slots.clear()
  world.children.clear()
  world.said = []
  world.here = ['presentation', 'simple']
})

describe('the layout rules', () => {
  it('parses exactly layout, on, off and from /<tile>', () => {
    expect(parseLayoutArgs('')).toEqual({ verb: 'show' })
    expect(parseLayoutArgs('on')).toEqual({ verb: 'on' })
    expect(parseLayoutArgs(' OFF ')).toEqual({ verb: 'off' })
    expect(parseLayoutArgs('from /presentation/simple')).toEqual({ verb: 'from', route: ['presentation', 'simple'] })
    expect('error' in parseLayoutArgs('from presentation')).toBe(true)
    expect('error' in parseLayoutArgs('from /a/../b')).toBe(true)
    expect('error' in parseLayoutArgs('on now')).toBe(true)
  })

  it('leaves out only the children its words do not name, by the trait fold', () => {
    expect(leftOut(['Primitive', 'act', 'marker', 'opening'], ['primitive', 'act', 'opening'])).toEqual(['marker'])
    expect(leftOut(['a', 'b'], [])).toEqual(['a', 'b'])
    expect(layoutNames(['act', ' ', 'Act', 'opening'])).toEqual(['act', 'opening'])
  })

  it('reads the newest record as the layout', () => {
    const sig = 'a'.repeat(64)
    expect(currentLayout([{ record: { payload: { on: true, names: sig } } }, { record: { payload: { on: false } } }])).toEqual({ on: false })
    expect(currentLayout([{ record: { payload: { on: true, names: sig } } }])).toEqual({ on: true, names: sig })
    expect(currentLayout([])).toBeNull()
  })
})

describe('the layout word', () => {
  it('turns on with the markers in order, as one list by signature, and off again', async () => {
    markers('presentation/simple', ['primitive', 'act', 'opening'])
    world.children.set('presentation/simple', ['primitive', 'act', 'opening', 'marker'])
    await new LayoutQueenBee().invoke('on')
    const [on] = layoutsAt('presentation/simple')
    const payload = on!.record.payload as { on: boolean; names: string }
    expect(payload.on).toBe(true)
    expect(JSON.parse(world.resources.get(payload.names)!)).toEqual(['primitive', 'act', 'opening'])
    expect(world.said.at(-1)).toContain('Left out: marker')

    await new LayoutQueenBee().invoke('off')
    const records = layoutsAt('presentation/simple')
    expect(records).toHaveLength(1)
    expect(records[0]!.record.payload).toEqual({ on: false })
  })

  it('takes another tile\'s layout by the same signature', async () => {
    markers('presentation/simple', ['primitive', 'act'])
    await new LayoutQueenBee().invoke('on')
    const source = (layoutsAt('presentation/simple')[0]!.record.payload as { names: string }).names
    world.here = ['presentation', 'organized']
    await new LayoutQueenBee().invoke('from /presentation/simple')
    expect((layoutsAt('presentation/organized')[0]!.record.payload as { names: string }).names).toBe(source)
  })

  it('refuses to turn on without markers', async () => {
    await new LayoutQueenBee().invoke('on')
    expect(layoutsAt('presentation/simple')).toHaveLength(0)
    expect(world.said.at(-1)).toMatch(/no trait markers/)
  })

  it('tells the grid to leave out what a layout that is on does not name', async () => {
    world.here = ['grid', 'page']
    markers('grid/page', ['primitive', 'act'])
    await new LayoutQueenBee().invoke('on')
    EffectBus.emit('layout:changed', { segments: ['grid', 'page'] })
    await flush(); await flush(); await flush()
    const claim = world.claims[0]!
    expect(claim('marker', ['grid', 'page'])).toBe(true)
    expect(claim('Primitive', ['grid', 'page'])).toBe(false)
    expect(claim('marker', ['grid', 'other'])).toBe(false)

    await new LayoutQueenBee().invoke('off')
    EffectBus.emit('layout:changed', { segments: ['grid', 'page'] })
    await flush(); await flush(); await flush()
    expect(claim('marker', ['grid', 'page'])).toBe(false)
  })
})
