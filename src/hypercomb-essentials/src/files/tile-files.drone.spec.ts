// files/tile-files.drone.spec.ts — a model's write block makes a file on a
// tile: the tile's page, or a text file by name. The decoration writes, the
// store and the hive are faked at their seams; what is asserted is which
// records a write replaces and where a page goes.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'

// jsdom's Blob cannot be read back as text; the store reads every file that way.
;(globalThis as unknown as { Blob: unknown }).Blob = NodeBlob

type Record_ = { sig: string; record: { kind: string; payload: Record<string, unknown> } }

const fake = vi.hoisted(() => ({
  decorations: new Map<string, Record_[]>(),
  removed: [] as string[],
  written: [] as { kind: string; segments: string[]; payload: Record<string, unknown> }[],
  bytes: new Map<string, string>(),
  tree: new Map<string, string[]>(),
  layers: new Map<string, Record<string, unknown>>(),
  slotSets: [] as { segments: string[]; slot: string; sigs: string[] }[],
  bound: [] as string[][],
  page: new Map<string, string>(),
  services: new Map<string, unknown>(),
}))

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = {
    register: () => {},
    get: (key: string) => fake.services.get(key),
    whenReady: () => {},
  }
})

vi.mock('../commands/website-binding.js', () => ({
  ensureWebsiteBoundAt: async (segments: string[]) => { fake.bound.push([...segments]) },
}))

vi.mock('../commands/decoration-manifest.js', () => ({
  listDecorations: async ({ kind, segments }: { kind: string; segments: string[] }) =>
    (fake.decorations.get(segments.join('/')) ?? []).filter(d => d.record.kind === kind),
  removeDecorationAndWait: async ({ sig, segments }: { sig: string; segments: string[] }) => {
    fake.removed.push(sig)
    const key = segments.join('/')
    fake.decorations.set(key, (fake.decorations.get(key) ?? []).filter(d => d.sig !== sig))
  },
  writeDecoration: async (opts: { kind: string; segments: string[]; payload: Record<string, unknown> }) => {
    fake.written.push({ kind: opts.kind, segments: [...opts.segments], payload: opts.payload })
    return 'd'.repeat(64)
  },
}))

const sha = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

fake.services.set('@hypercomb.social/Store', {
  putResource: async (blob: Blob) => { const text = await blob.text(); const sig = await sha(text); fake.bytes.set(sig, text); return sig },
  getResource: async (sig: string) => fake.bytes.has(sig) ? new Blob([fake.bytes.get(sig)!]) : null,
})
fake.services.set('@diamondcoreprocessor.com/HypercombHiveTreeReader', {
  readNode: async (segments: string[]) => ({ ok: true, children: (fake.tree.get(segments.join('/')) ?? []).map(name => ({ name })) }),
})
fake.services.set('@diamondcoreprocessor.com/HistoryService', {
  sign: async (lineage: { explorerSegments: () => string[] }) => lineage.explorerSegments().join('/'),
  currentLayerAt: async (sig: string) => fake.layers.get(sig) ?? null,
})
fake.services.set('@diamondcoreprocessor.com/LayerCommitter', {
  commitSlotSet: async (segments: string[], slot: string, sigs: string[]) => { fake.slotSets.push({ segments: [...segments], slot, sigs: [...sigs] }) },
})
fake.services.set('@diamondcoreprocessor.com/SiteViewDrone', {
  resolvePageSig: async (segments: string[]) => fake.page.get(segments.join('/')) ?? null,
})

const { TileFilesDrone } = await import('./tile-files.drone.js')

beforeEach(() => {
  for (const key of ['decorations', 'bytes', 'tree', 'layers', 'page'] as const) fake[key].clear()
  fake.removed.length = 0
  fake.written.length = 0
  fake.slotSets.length = 0
  fake.bound.length = 0
  fake.tree.set('', ['Proposal'])
  fake.tree.set('Proposal', ['plan'])
})

describe('a file on a tile', () => {
  it('creates a text file attachment on the tile the route names, spelled as the hive spells it', async () => {
    const files = new TileFilesDrone()
    const done = await files.write({ route: ['proposal'], kind: 'file', name: 'notes.md' }, '# Notes')
    expect(done).toMatchObject({ ok: true, tile: ['Proposal'], created: true, unchanged: false })
    expect(fake.written).toEqual([{
      kind: 'files:attachment', segments: ['Proposal'],
      payload: { name: 'notes.md', mime: 'text/markdown', size: 7, sig: await sha('# Notes') },
    }])
  })

  it('replaces the file of the same name and leaves the others', async () => {
    fake.decorations.set('Proposal', [
      { sig: 'a'.repeat(64), record: { kind: 'files:attachment', payload: { name: 'Notes.md', sig: '1'.repeat(64) } } },
      { sig: 'b'.repeat(64), record: { kind: 'files:attachment', payload: { name: 'other.md', sig: '2'.repeat(64) } } },
    ])
    const done = await new TileFilesDrone().write({ route: ['Proposal'], kind: 'file', name: 'notes.md' }, 'new')
    expect(done).toMatchObject({ ok: true, created: false })
    expect(fake.removed).toEqual(['a'.repeat(64)])
  })

  it('refuses a tile that does not exist, a file that is not text, and an empty file', async () => {
    const files = new TileFilesDrone()
    expect(await files.write({ route: ['Proposal', 'budget'], kind: 'file', name: 'x.md' }, 'x'))
      .toMatchObject({ ok: false, error: expect.stringContaining('no tile at /Proposal/budget') })
    expect(await files.write({ route: ['Proposal'], kind: 'file', name: 'deck.pdf' }, 'x'))
      .toMatchObject({ ok: false, error: expect.stringContaining('not a text file') })
    expect(await files.write({ route: ['Proposal'], kind: 'file', name: 'x.md' }, '  '))
      .toMatchObject({ ok: false, error: 'the file would be empty' })
    expect(fake.written).toEqual([])
  })
})

describe('a tile\'s page', () => {
  it('replaces the page decoration and keeps what it said about itself', async () => {
    fake.page.set('Proposal/plan', '9'.repeat(64))
    fake.decorations.set('Proposal/plan', [
      { sig: 'c'.repeat(64), record: { kind: 'visual:website:page', payload: { htmlSig: '9'.repeat(64), label: 'The work', order: 0 } } },
    ])
    const done = await new TileFilesDrone().write({ route: ['proposal', 'plan'], kind: 'page' }, '<h1>Plan</h1>')
    expect(done).toMatchObject({ ok: true, tile: ['Proposal', 'plan'], created: false })
    expect(fake.removed).toEqual(['c'.repeat(64)])
    expect(fake.written[0]).toMatchObject({ kind: 'visual:website:page', payload: { label: 'The work', htmlSig: await sha('<h1>Plan</h1>') } })
  })

  it('writes into the website slot when the page lives there, since that slot wins', async () => {
    fake.layers.set('Proposal/plan', { website: ['8'.repeat(64)] })
    fake.page.set('Proposal/plan', '8'.repeat(64))
    await new TileFilesDrone().write({ route: ['Proposal', 'plan'], kind: 'page' }, '<p>v2</p>')
    expect(fake.slotSets).toEqual([{ segments: ['Proposal', 'plan'], slot: 'website', sigs: ['8'.repeat(64), await sha('<p>v2</p>')] }])
    expect(fake.written).toEqual([])
  })

  // 2026-10-25: a model's page was written, and the website view dropped back to
  // hexagons on it — the hive binds the website behaviour to the tiles that hold
  // sites, and a write did not bind its tile the way /website page does.
  it('binds the website behaviour to the tile it writes a page on, whichever way the page is kept', async () => {
    await new TileFilesDrone().write({ route: ['Proposal', 'plan'], kind: 'page' }, '<p>one</p>')
    expect(fake.bound).toEqual([['Proposal', 'plan']])
    fake.layers.set('Proposal/plan', { website: ['8'.repeat(64)] })
    fake.page.set('Proposal/plan', '8'.repeat(64))
    await new TileFilesDrone().write({ route: ['Proposal', 'plan'], kind: 'page' }, '<p>two</p>')
    expect(fake.bound).toEqual([['Proposal', 'plan'], ['Proposal', 'plan']])
  })

  it('does not bind for a page that changed nothing, or for a text file', async () => {
    fake.page.set('Proposal/plan', await sha('<p>same</p>'))
    await new TileFilesDrone().write({ route: ['Proposal', 'plan'], kind: 'page' }, '<p>same</p>')
    await new TileFilesDrone().write({ route: ['Proposal'], kind: 'file', name: 'notes.md' }, '# Notes')
    expect(fake.bound).toEqual([])
  })

  it('changes nothing when the page already holds that text', async () => {
    fake.page.set('Proposal/plan', await sha('<p>same</p>'))
    expect(await new TileFilesDrone().write({ route: ['Proposal', 'plan'], kind: 'page' }, '<p>same</p>')).toMatchObject({ ok: true, unchanged: true })
    expect(fake.written).toEqual([])
  })

  it('reads the page as it is now, or null when there is none', async () => {
    const files = new TileFilesDrone()
    expect(await files.read({ route: ['Proposal', 'plan'], kind: 'page' })).toEqual({ ok: true, tile: ['Proposal', 'plan'], text: null })
    const sig = await sha('<p>now</p>')
    fake.bytes.set(sig, '<p>now</p>')
    fake.page.set('Proposal/plan', sig)
    expect(await files.read({ route: ['Proposal', 'plan'], kind: 'page' })).toEqual({ ok: true, tile: ['Proposal', 'plan'], text: '<p>now</p>', sig })
  })
})
