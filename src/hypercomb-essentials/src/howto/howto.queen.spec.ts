import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    services: new Map<string, unknown>(),
    /** children held per page, keyed by the page's path */
    children: new Map<string, string[]>(),
    /** the page signature each tile wears, keyed by the tile's path */
    worn: new Map<string, string>(),
    acts: 0,
    dressed: [] as { segments: string[]; htmlSig: string }[],
    navigated: [] as string[][],
    said: [] as string[],
    bodies: [] as string[],
    saved: new Set<string>(),
    defaultView: new Map<string, string>(),
    defaultWrites: 0,
    /** how many tiles the committer silently drops (a rewound or previewing hive) */
    drops: false,
  }
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: (key: string, value: unknown) => { state.services.set(key, value) },
    get: (key: string) => state.services.get(key),
    has: (key: string) => state.services.has(key),
    list: () => [],
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
  return state
})

vi.mock('@hypercomb/core', async (original) => ({
  ...(await original<typeof import('@hypercomb/core')>()),
  hypercomb: class { async act(): Promise<void> { h.acts++ } },
}))
vi.mock('../commands/decoration-manifest.js', () => ({
  listDecorations: async ({ segments }: { segments: string[] }) => {
    const sig = h.worn.get(segments.join('/'))
    return sig ? [{ sig: 'decoration', record: { payload: { htmlSig: sig } } }] : []
  },
  replaceDecoration: async (opts: { segments: string[]; payload: { htmlSig: string } }) => {
    h.worn.set(opts.segments.join('/'), opts.payload.htmlSig)
    h.dressed.push({ segments: [...opts.segments], htmlSig: opts.payload.htmlSig })
    return 'decoration'
  },
}))
vi.mock('../history/saved-roots.js', () => ({
  savedRoots: () => ({ ready: async () => { /* ready */ }, isSaved: (name: string) => h.saved.has(name) }),
}))
vi.mock('../commands/view-default.js', () => ({
  defaultViewAt: async (segments: string[]) => h.defaultView.get(segments.join('/')) ?? '',
  writeDefaultView: async (segments: string[], view: string) => { h.defaultWrites++; h.defaultView.set(segments.join('/'), view); return 'decoration' },
}))
vi.mock('../history/layer-placement.js', () => ({
  readChildrenStrict: async (_history: unknown, _domain: unknown, segments: string[]) => {
    const held = h.children.get(segments.join('/'))
    return held ? held.map(name => ({ name })) : null
  },
}))
vi.mock('../sharing/decoration-closure.js', () => ({ extractPageRefSigs: () => [] }))
vi.mock('../sharing/authored-sigs.js', () => ({ markAuthored: () => { /* noop */ } }))

import { EffectBus } from '@hypercomb/core'
import { HowToQueenBee } from './howto.queen.js'
import { HOWTO_ROOT } from './howto-page.js'

const word = (name: string) => ({ name, description: `${name} does one thing, in a sentence`, examples: [{ input: name, result: 'it happens' }] })
const words = (n: number) => Array.from({ length: n }, (_, i) => word(`w${String(i).padStart(3, '0')}`))

const blobText = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error)
  reader.readAsText(blob)
})

/** A signature for a body: the spec only needs equal bodies to give equal signatures. */
const fakeSig = async (blob: Blob): Promise<string> => {
  const text = await blobText(blob)
  let a = 0
  for (const ch of text) a = (a * 31 + ch.charCodeAt(0)) >>> 0
  return a.toString(16).padStart(8, '0').repeat(8)
}

beforeEach(() => {
  h.services.clear(); h.children.clear(); h.worn.clear()
  h.acts = 0; h.dressed = []; h.navigated = []; h.said = []; h.bodies = []
  h.saved.clear(); h.defaultView.clear(); h.defaultWrites = 0; h.drops = false
  h.services.set('@hypercomb.social/Store', { putResource: async (blob: Blob) => { h.bodies.push(await blobText(blob)); return fakeSig(blob) } })
  h.services.set('@diamondcoreprocessor.com/HistoryService', {})
  h.services.set('@hypercomb.social/Lineage', { domain: 'test.example' })
  h.services.set('@hypercomb.social/Navigation', { goRaw: (s: string[]) => { h.navigated.push([...s]) } })
  h.services.set('@diamondcoreprocessor.com/LayerCommitter', { settled: async () => { /* settled */ } })
})

// The bus outlives each test: listen once, record into whatever the test reset.
EffectBus.on('cell:added', (p: { cell: string; segments: string[] }) => {
  if (h.drops) return
  const key = p.segments.join('/')
  h.children.set(key, [...(h.children.get(key) ?? []), p.cell])
})
EffectBus.on('activity:log', (p: { message: string }) => { h.said.push(p.message) })

const withWords = (list: ReturnType<typeof words>): void => {
  h.services.set('@diamondcoreprocessor.com/SlashBehaviourDrone', { entries: () => list })
}

describe('howto — lay the how-to site', () => {
  it('lays the root tile, then a tile and a page for every word, then walks into it', async () => {
    withWords(words(3))
    await new HowToQueenBee().invoke('')
    expect(h.children.get('')).toEqual([HOWTO_ROOT])
    expect(h.children.get(HOWTO_ROOT)).toEqual(['w000', 'w001', 'w002'])
    // the index on the root tile, and one page per word
    expect(h.dressed.map(d => d.segments.join('/')).sort()).toEqual(['how', 'how/w000', 'how/w001', 'how/w002'])
    expect(h.navigated).toEqual([[HOWTO_ROOT]])
    expect(h.said.some(m => m.includes('4 pages'))).toBe(true)
  })

  it('lays tiles in rounds so the committer settles between them', async () => {
    withWords(words(60))
    await new HowToQueenBee().invoke('')
    // one round for the root, then 25 + 25 + 10 for the words
    expect(h.acts).toBe(4)
    expect(h.children.get(HOWTO_ROOT)).toHaveLength(60)
  })

  it('is idempotent: said again, it lays nothing new and writes no page again', async () => {
    withWords(words(3))
    const queen = new HowToQueenBee()
    await queen.invoke('')
    const tiles = h.children.get(HOWTO_ROOT)!.length
    const writes = h.dressed.length
    await queen.invoke('')
    expect(h.children.get(HOWTO_ROOT)).toHaveLength(tiles)
    expect(h.dressed).toHaveLength(writes)
    expect(h.navigated).toEqual([[HOWTO_ROOT], [HOWTO_ROOT]])
  })

  it('adds only a new word, and rewrites only a page whose word changed', async () => {
    withWords(words(3))
    const queen = new HowToQueenBee()
    await queen.invoke('')
    h.dressed = []
    const next = words(4)
    next[1] = { ...next[1]!, examples: [{ input: 'w001 again', result: 'a new example' }] }
    withWords(next)
    await queen.invoke('')
    expect(h.children.get(HOWTO_ROOT)).toEqual(['w000', 'w001', 'w002', 'w003'])
    // the index (it lists a new word), the changed word, the new word — not the untouched ones
    expect(h.dressed.map(d => d.segments.join('/')).sort()).toEqual(['how', 'how/w001', 'how/w003'])
  })

  it('walks to a word\'s page when one is named, and refuses a word that does not exist', async () => {
    withWords(words(3))
    const queen = new HowToQueenBee()
    await queen.invoke('w002')
    expect(h.navigated).toEqual([[HOWTO_ROOT, 'w002']])
    h.children.clear(); h.worn.clear(); h.navigated = []; h.said = []
    await queen.invoke('nothing-by-that-name')
    expect(h.children.size).toBe(0)
    expect(h.navigated).toEqual([])
    expect(h.said.some(m => m.includes('no word "nothing-by-that-name"'))).toBe(true)
  })

  it('says so, and lays nothing, when the hive lists no words or cannot keep pages', async () => {
    withWords([])
    await new HowToQueenBee().invoke('')
    expect(h.children.size).toBe(0)
    withWords(words(2))
    h.services.set('@hypercomb.social/Store', {})
    await new HowToQueenBee().invoke('')
    expect(h.children.size).toBe(0)
    expect(h.said.some(m => m.includes('not ready to keep pages'))).toBe(true)
  })

  it('wakes every sleeping word before it reads the census, so no page is made from a stand-in', async () => {
    // a sleeper is listed by name and one line only; waking her swaps in everything she declares
    const asleep = new Set(['w000', 'w001'])
    const full = words(2)
    h.services.set('@diamondcoreprocessor.com/SlashBehaviourDrone', {
      entries: () => full.map(w => asleep.has(w.name) ? { name: w.name, description: 'a stand-in line, nothing more to say' } : w),
    })
    h.services.set('@hypercomb.social/ScriptPreloader', { wakeWord: async (word: string) => { asleep.delete(word) } })
    await new HowToQueenBee().invoke('')
    expect(asleep.size).toBe(0)
    // both pages were dressed from the woken facts: the example is on the page, not the stand-in's lack of one
    expect(h.bodies.filter(b => b.includes('it happens'))).toHaveLength(2)
  })

  it('opens the site as its pages: the root tile gets the website view, once', async () => {
    withWords(words(2))
    const queen = new HowToQueenBee()
    await queen.invoke('')
    expect(h.defaultView.get(HOWTO_ROOT)).toBe('website')
    expect(h.defaultWrites).toBe(1)
    await queen.invoke('')
    expect(h.defaultWrites).toBe(1)
  })

  it('refuses, and lays nothing, while you are looking at the past or a preview is open', async () => {
    withWords(words(3))
    h.services.set('@diamondcoreprocessor.com/HistoryCursorService', { state: { rewound: true } })
    await new HowToQueenBee().invoke('')
    expect(h.children.size).toBe(0)
    expect(h.bodies).toEqual([])
    expect(h.said.some(m => m.includes('looking at the past'))).toBe(true)
    h.said = []
    h.services.set('@diamondcoreprocessor.com/HistoryCursorService', { state: { rewound: false } })
    h.services.set('@diamondcoreprocessor.com/HistoryService', { previewActive: true })
    await new HowToQueenBee().invoke('')
    expect(h.children.size).toBe(0)
    expect(h.said.some(m => m.includes('looking at the past'))).toBe(true)
  })

  it('refuses the name `how` when it is already a saved root — it is the same bag as the tile', async () => {
    withWords(words(3))
    h.saved.add(HOWTO_ROOT)
    await new HowToQueenBee().invoke('')
    expect(h.children.size).toBe(0)
    expect(h.said.some(m => m.includes('already a saved root'))).toBe(true)
  })

  it('says so, and does not report success, when the committer drops the tiles', async () => {
    withWords(words(3))
    h.drops = true
    await new HowToQueenBee().invoke('')
    expect(h.dressed).toEqual([])
    expect(h.navigated).toEqual([])
    expect(h.said.some(m => m.includes('tiles landed'))).toBe(true)
    expect(h.said.some(m => m.includes('is laid'))).toBe(false)
  })

  it('makes no page for a word that exists only because of this machine', async () => {
    withWords([...words(2), { ...word('only-here'), local: true } as never])
    await new HowToQueenBee().invoke('')
    expect(h.children.get(HOWTO_ROOT)).toEqual(['w000', 'w001'])
  })

  it('does not run twice at once', async () => {
    withWords(words(3))
    const queen = new HowToQueenBee()
    await Promise.all([queen.invoke(''), queen.invoke('')])
    expect(h.said.some(m => m.includes('already laying'))).toBe(true)
    expect(h.children.get(HOWTO_ROOT)).toEqual(['w000', 'w001', 'w002'])
  })
})
