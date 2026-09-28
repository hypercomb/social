// tile-previews.spec.ts — LOOKS THAT ARE NOT YET TRUE, on their own. Marks:
// a hover lights who carries ANY; the bouquet in hand and a drag light who
// already wears ALL; drag outranks hover outranks armed; putting it away
// restores the baked values at the end of the fade. The editor's edit: shown
// on its tile, never repainted over a save, restored from the caches when
// it ends without one, and it — not the store — decides a hidden name.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MarkPreview, TilePreview, previewRgb, type MarkPreviewHost, type TilePreviewHost } from './tile-previews.js'

const TAGS: Record<string, string[]> = { garden: ['green', 'wild'], kitchen: ['warm'], library: ['green'] }

beforeEach(() => {
  let frame = 0
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { setTimeout(cb, 0); return ++frame })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => { vi.unstubAllGlobals() })

const markHost = () => {
  const flags = new Map<string, number>()
  const k: number[] = []
  const host: MarkPreviewHost & { flags: Map<string, number>; k: number[] } = {
    flags, k,
    pageLabels: () => Object.keys(TAGS),
    tagsFor: label => TAGS[label] ?? [],
    writeDivergence: valueFor => { for (const l of Object.keys(TAGS)) flags.set(l, valueFor(l, 0)); return true },
    geom: () => 'geom',
    shader: () => ({ setMarkPreview: v => { k.push(v) }, setMarkColor: () => {} }),
    breathe: () => {},
  }
  return host
}
const lit = (h: { flags: Map<string, number> }) => [...h.flags].filter(([, v]) => v === 3).map(([l]) => l).sort()
const frames = async (n: number) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)) }

describe('the mark preview', () => {
  it('a hover lights who carries ANY of the marks', () => {
    const h = markHost()
    new MarkPreview(h).hover(['green', 'warm'], '#00ff00')
    expect(lit(h)).toEqual(['garden', 'kitchen', 'library'])
  })

  it('the bouquet in hand lights who already wears ALL of it; a drag outranks both', () => {
    const h = markHost()
    const m = new MarkPreview(h)
    m.arm(true, ['green', 'wild'])
    expect(lit(h)).toEqual(['garden'])
    m.hover(['warm'])
    expect(lit(h)).toEqual(['kitchen'])
    m.drag(true, ['green'])
    expect(lit(h)).toEqual(['garden', 'library'])
    expect(m.asking).toBe(true)
  })

  it('puts the page back at the end of the fade, not before', async () => {
    const h = markHost()
    const m = new MarkPreview(h)
    m.hover(['warm'])
    await frames(12)
    expect(h.k.at(-1)).toBe(1)
    m.hover([])
    expect(lit(h)).toEqual(['kitchen'])
    await frames(12)
    expect(h.k.at(-1)).toBe(0)
    expect(lit(h)).toEqual([])
    m.dispose()
  })
})

describe('the tile editor\'s preview', () => {
  const PREVIEW_PIC = { sig: 'preview-pic', blob: new Blob(['p']) }
  const tileHost = () => {
    const painted: { label: string; image: string | null; border: number[]; hideText?: boolean }[] = []
    const uvOf = (sig: string) => ({ u0: sig.length, v0: 0, u1: 0, v1: 0 })
    const loaded = new Set<string>(['stored-pic'])
    const calls = { renders: 0 }
    const host: TilePreviewHost & { painted: typeof painted; calls: typeof calls } = {
      painted, calls,
      page: () => 'home',
      imageAtlas: () => ({ loadImage: async s => { loaded.add(s) }, getImageUV: s => loaded.has(s) ? uvOf(s) : null, setPinned: () => {} }),
      pageImageSigs: () => ['stored-pic'],
      flat: () => false,
      stored: () => ({ image: 'stored-pic', border: [0, 1, 0], hideText: false }),
      hasTile: label => label === 'kitchen',
      hidesName: (hideText, hasImage) => !!hideText && hasImage,
      paintFace: (label, uv, border, hideText) => {
        painted.push({ label, image: uv ? (uv.u0 === 'preview-pic'.length ? 'preview-pic' : 'stored-pic') : null, border, hideText })
        return true
      },
      requestRender: () => { calls.renders++ },
    }
    return host
  }

  it('paints the edit on its tile, decoded first, with the edit\'s rim', async () => {
    const h = tileHost()
    const p = new TilePreview(h)
    await p.apply({ label: 'kitchen', page: 'home', point: PREVIEW_PIC, border: '#ff0000', hideText: true })
    expect(h.painted.at(-1)).toEqual({ label: 'kitchen', image: 'preview-pic', border: previewRgb('#ff0000'), hideText: true })
    expect(p.sigs()).toEqual(['preview-pic'])
    expect(p.hiddenBy('kitchen')).toBe(true)
    expect(p.hiddenBy('garden')).toBeUndefined()
  })

  it('an edit for another page is not painted here', async () => {
    const h = tileHost()
    await new TilePreview(h).apply({ label: 'kitchen', page: 'elsewhere', point: PREVIEW_PIC })
    expect(h.painted).toEqual([])
  })

  it('ending without a save restores the tile from its caches', async () => {
    const h = tileHost()
    const p = new TilePreview(h)
    await p.apply({ label: 'kitchen', page: 'home', removed: true })
    await p.apply({ label: 'kitchen', clear: true })
    await frames(1)
    expect(h.painted.at(-1)).toEqual({ label: 'kitchen', image: 'stored-pic', border: [0, 1, 0], hideText: false })
  })

  it('ending after a save leaves the tile to the save\'s own render', async () => {
    const h = tileHost()
    const p = new TilePreview(h)
    await p.apply({ label: 'kitchen', page: 'home', removed: true })
    const before = h.painted.length
    p.saved('kitchen')
    await p.apply({ label: 'kitchen', clear: true })
    await frames(1)
    expect(h.painted).toHaveLength(before)
  })
})
