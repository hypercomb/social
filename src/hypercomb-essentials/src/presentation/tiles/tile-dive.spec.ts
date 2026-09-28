// tile-dive.spec.ts — ANOTHER LAYER'S TILES, PAINTED IN PLACE, on their own.
// A generation lands whole (every picture decoded first); the page's mesh
// is hidden, never torn down; pins cover page and dive; a newer paint wins
// over a slower one; ending it gives the page back exactly.
import { describe, expect, it, vi } from 'vitest'

vi.mock('pixi.js', () => ({
  Mesh: class { visible = true; position = { set: (x: number, y: number) => { this.at = [x, y] } }; at: number[] = []; geometry: unknown; shader: unknown; constructor(o: { geometry: unknown; shader: unknown }) { this.geometry = o.geometry; this.shader = o.shader } destroy() {} },
  Texture: { WHITE: {} },
}))

import { TileDive, type DiveCell, type DiveHost } from './tile-dive.js'

const cell = (label: string, over: Partial<DiveCell> = {}): DiveCell => ({ q: 0, r: 0, label, hasBranch: false, hideText: false, portal: false, ...over })

const hostWith = (over: Partial<DiveHost> = {}) => {
  const children: unknown[] = []
  const page = { visible: true, position: { x: 7, y: 9 } }
  const pins = { labels: [] as string[], images: [] as string[] }
  const loaded = new Set<string>()
  const calls = { emitted: [] as [string, unknown][], hovered: [] as number[], renders: 0, built: [] as { labels: string[]; reveal: string | null; portals: string[] }[] }
  const host: DiveHost & { page: typeof page; pins: typeof pins; loaded: Set<string>; calls: typeof calls; children: unknown[] } = {
    page, pins, loaded, calls, children,
    layer: () => ({ addChild: (c: unknown) => { children.push(c) }, removeChild: (c: unknown) => { children.splice(children.indexOf(c), 1) } }) as any,
    pageMesh: () => page,
    shader: () => ({ shader: {}, setHoveredIndex: i => { calls.hovered.push(i) } }),
    labelAtlas: () => ({ setPinned: l => { pins.labels = l }, getLabelUV: () => ({}) }),
    imageAtlas: () => ({ setPinned: s => { pins.images = s }, hasImage: s => loaded.has(s), hasFailed: () => false, loadImage: async s => { loaded.add(s) } }),
    decode: async () => new Blob(['px']),
    pageLabels: () => ['garden'],
    pageImageSigs: () => ['page-img'],
    pageCount: () => 1,
    pageHoverIndex: () => 0,
    pendingLabel: '…',
    build: (cells, foreign) => { calls.built.push({ labels: cells.map(c => c.label), reveal: foreign.reveal, portals: [...foreign.portals] }); return { destroy: () => {} } as any },
    hidesName: (hideText, hasImage) => !!hideText && hasImage,
    emit: (effect, payload) => { calls.emitted.push([effect, payload]) },
    requestRender: () => { calls.renders++ },
    ...over,
  }
  return host
}

describe('a dive', () => {
  it('lands whole: pictures decoded, the page hidden, pins covering both', async () => {
    const host = hostWith()
    const dive = new TileDive(host)
    await dive.paint([cell('oven', { imageSig: 'dive-img' }), cell('door', { portal: true })])
    expect(host.loaded.has('dive-img')).toBe(true)
    expect(dive.active).toBe(true)
    expect(host.page.visible).toBe(false)
    expect(host.pins.labels).toEqual(['garden', 'oven', 'door', '…'])
    expect(host.pins.images).toEqual(['page-img', 'dive-img'])
    expect(host.calls.built.at(-1)).toEqual({ labels: ['oven', 'door'], reveal: null, portals: ['door'] })
    expect(host.children).toHaveLength(1)
    expect(host.calls.emitted.at(-1)).toEqual(['render:dive-painted', { count: 2 }])
  })

  it('a newer paint wins over one still decoding', async () => {
    let release: () => void = () => {}
    const slow = new Promise<void>(r => { release = r })
    const host = hostWith({ decode: async sig => { if (sig === 'slow') await slow; return new Blob(['px']) } })
    const dive = new TileDive(host)
    const first = dive.paint([cell('old', { imageSig: 'slow' })])
    await dive.paint([cell('new')])
    release(); await first
    expect(host.calls.built.at(-1)!.labels).toEqual(['new'])
  })

  it('hovering a picture-only tile repacks it with its name revealed', async () => {
    const host = hostWith()
    const dive = new TileDive(host)
    host.loaded.add('img')
    await dive.paint([cell('oven', { imageSig: 'img', hideText: true })])
    const builds = host.calls.built.length
    dive.hover('oven')
    expect(host.calls.built.length).toBe(builds + 1)
    expect(host.calls.built.at(-1)!.reveal).toBe('oven')
    expect(host.calls.hovered.at(-1)).toBe(0)
  })

  it('ending it gives the page back — mesh, pins, hover — and paints what waited', async () => {
    const host = hostWith()
    const dive = new TileDive(host)
    await dive.paint([cell('oven')])
    dive.clear()
    expect(dive.active).toBe(false)
    expect(host.page.visible).toBe(true)
    expect(host.children).toHaveLength(0)
    expect(host.pins.labels).toEqual(['garden', '…'])
    expect(host.pins.images).toEqual(['page-img'])
    expect(host.calls.hovered.at(-1)).toBe(0)
    expect(host.calls.renders).toBe(1)
    // Safe to call twice; announced even when nothing was up.
    dive.clear()
    expect(host.calls.renders).toBe(1)
    expect(host.calls.emitted.at(-1)).toEqual(['render:dive-painted', { count: 0 }])
  })
})
