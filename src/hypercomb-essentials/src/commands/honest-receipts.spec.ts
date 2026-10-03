// commands/honest-receipts.spec.ts — A WORD THAT DID NOTHING MUST NOT RESOLVE CLEAN.
//
// Every behaviour executor is `Promise<void>`, so DID-NOT-THROW is the only
// success signal a receipt can carry (core remote-submit.types.ts). The surface
// audit (item 5) found half the machine vocabulary resolving on delivery or on
// a no-op: `/paste` of an empty clipboard, `/hide` with nothing listening,
// `/remove` of a name the page never held, `/keyword` whose write failed — and
// the receipt read "ran" each time. Each now throws when nothing happened, and
// resolves when something did. (At the keyboard the throw is an activity line,
// not a crash: command-line.component.ts `#behaviourDidNotRun`.)

import { describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const held = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { held.set(key, value) },
  get: (key: string) => held.get(key),
  list: () => [...held.keys()],
  whenReady: () => void 0,
  onRegister: () => void 0,
}
// The ambient `get` the shell installs (ioc.web), which some modules call bare.
;(globalThis as unknown as { get: (key: string) => unknown }).get = (key: string) => held.get(key)
const ioc = (window as unknown as { ioc: { register(key: string, value: unknown): void } }).ioc
const set = (key: string, value: unknown): void => ioc.register(key, value)

const { removeTilesAt } = await import('./remove-tiles.js')
const { HideQueenBee } = await import('../presentation/tiles/hide.queen.js')
const { UndoQueenBee } = await import('../history/undo.queen.js')
const { CopyQueenBee, CutQueenBee, PasteQueenBee } = await import('../clipboard/clipboard.queen.js')
const { KeywordQueenBee } = await import('./keyword.queen.js')

describe('/remove', () => {
  // One page holding two tiles, readable the way removeTilesAt resolves it.
  const page = (commitAnswer: string) => {
    const layers: Record<string, { name: string }> = { s1: { name: 'drafts' }, s2: { name: 'notes' } }
    const commits: unknown[] = []
    set('@hypercomb.social/Lineage', { explorerSegments: () => [], domain: 'hive' })
    set('@diamondcoreprocessor.com/HistoryService', {
      sign: async () => 'here',
      currentLayerAt: async () => ({ children: ['s1', 's2'] }),
      getLayerBySig: async (sig: string) => layers[sig] ?? null,
    })
    set('@diamondcoreprocessor.com/LayerCommitter', {
      update: async (_segments: unknown, layer: unknown) => { commits.push(layer); return commitAnswer },
    })
    return commits
  }

  it('answers false — and commits nothing — for a name the page does not hold', async () => {
    const commits = page('newsig')
    expect(await removeTilesAt([], ['nobody'])).toBe(false)
    expect(commits).toEqual([])
  })

  it('answers false when the commit is refused', async () => {
    page('')
    expect(await removeTilesAt([], ['drafts'])).toBe(false)
  })

  it('answers true when the tile really left', async () => {
    const commits = page('newsig')
    expect(await removeTilesAt([], ['drafts'])).toBe(true)
    expect(commits).toEqual([{ children: ['s2'] }])
  })
})

describe('/hide', () => {
  it('throws when nothing was hidden', async () => {
    // No tile surface is listening for `tile:action`, so no hide is accepted.
    await expect(new HideQueenBee().invoke('drafts')).rejects.toThrow('nothing was hidden')
  })

  it('resolves when the surface hid the tile', async () => {
    const off = EffectBus.on<{ accept?: () => void; complete?: () => void }>('tile:action', payload => {
      payload.accept?.(); payload.complete?.()
    })
    try { await expect(new HideQueenBee().invoke('drafts')).resolves.toBeUndefined() } finally { off() }
  })
})

describe('/undo', () => {
  it('throws when there was nothing left to step', async () => {
    set('@diamondcoreprocessor.com/HistoryCursorService', { state: { position: 0 }, undo: async () => {}, redo: async () => {} })
    await expect(new UndoQueenBee().invoke('')).rejects.toThrow('nothing left to step')
  })

  it('resolves when the cursor moved', async () => {
    const cursor = { state: { position: 3 }, undo: async () => { cursor.state = { position: cursor.state.position - 1 } }, redo: async () => {} }
    set('@diamondcoreprocessor.com/HistoryCursorService', cursor)
    await expect(new UndoQueenBee().invoke('2')).resolves.toBeUndefined()
    expect(cursor.state.position).toBe(1)
  })
})

describe('/copy, /cut, /paste', () => {
  const pageHolds = (...tiles: string[]): void => set('@hypercomb.social/CellSuggestionProvider', { suggestions: () => tiles })
  const clipboardHolds = (empty: boolean): void => set('@diamondcoreprocessor.com/ClipboardService', { isEmpty: empty, items: [] })
  set('@diamondcoreprocessor.com/SelectionService', { selected: new Set(), add() {}, clear() {} })

  it('a name the page does not hold is nothing to take', async () => {
    pageHolds('drafts', 'notes')
    await expect(new CopyQueenBee().invoke('ghost')).rejects.toThrow('no tile named "ghost" on this page')
    await expect(new CutQueenBee().invoke('[drafts, ghost]')).rejects.toThrow('no tile named "ghost" on this page')
  })

  it('an empty clipboard is nothing to place', async () => {
    clipboardHolds(true)
    await expect(new PasteQueenBee().invoke('')).rejects.toThrow('the clipboard is holding nothing')
  })

  it('with no worker listening, nothing will happen — and it says so by failing', async () => {
    pageHolds('drafts')
    await expect(new CopyQueenBee().invoke('drafts')).rejects.toThrow('the clipboard is not ready yet')
  })

  it('a worker that completes with an error fails the word', async () => {
    clipboardHolds(false)
    const off = EffectBus.on<{ action?: string; accept?: () => void; complete?: (error?: unknown) => void }>('controls:action', payload => {
      payload.accept?.(); payload.complete?.(new Error('paste — nothing was placed here'))
    })
    try { await expect(new PasteQueenBee().invoke('')).rejects.toThrow('nothing was placed') } finally { off() }
  })

  it('and resolves when the worker did the work', async () => {
    pageHolds('drafts')
    const off = EffectBus.on<{ accept?: () => void; complete?: () => void }>('controls:action', payload => {
      payload.accept?.(); payload.complete?.()
    })
    try { await expect(new CopyQueenBee().invoke('Drafts')).resolves.toBeUndefined() } finally { off() }
  })
})

describe('/keyword', () => {
  set('@hypercomb.social/TagRegistry', { ensureLoaded: async () => {}, add: async () => {} })

  it('a named tile with no way to write tags is not tagged — and says so', async () => {
    held.delete('@diamondcoreprocessor.com/DecorationService')
    await expect(new KeywordQueenBee().invoke('roadmap = urgent')).rejects.toThrow('"roadmap" was not tagged')
  })

  it('a write that failed is named, not warned away', async () => {
    set('@diamondcoreprocessor.com/DecorationService', {
      addTag: async () => { throw new Error('disk full') },
      removeTag: async () => {},
    })
    await expect(new KeywordQueenBee().invoke('roadmap = urgent')).rejects.toThrow('not written: urgent on "roadmap"')
  })

  it('resolves when the tag landed', async () => {
    const written: string[] = []
    set('@diamondcoreprocessor.com/DecorationService', {
      addTag: async (_segments: unknown, tag: string) => { written.push(tag); return 'sig' },
      removeTag: async () => {},
    })
    await expect(new KeywordQueenBee().invoke('roadmap = urgent')).resolves.toBeUndefined()
    expect(written).toEqual(['urgent'])
  })
})
