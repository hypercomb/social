// The name field's memory: what was typed, what is stored, what the write said.
//
// These pin the ways a name used to vanish: commit only on blur (a removed
// field never blurs), a Save that could not be refused, a refusal that arrived
// after the panel was gone, and a late write landing on the wrong tile.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TileTitle, type TitleDecorations } from './tile-title.js'

type Outcome = 'set' | 'cleared' | 'noop' | 'duplicate'

const world = {
  titles: new Map<string, string>(),
  taken: new Map<string, string>(),
  setTitle: vi.fn(),
  delay: 0,
  fail: false,
}

const decorations: TitleDecorations = {
  titleOf: async segments => world.titles.get(segments.join('/')) ?? '',
  setTitle: async (segments, text): Promise<Outcome> => {
    world.setTitle(segments.join('/'), text)
    if (world.delay) await new Promise(resolve => setTimeout(resolve, world.delay))
    if (world.fail) throw new Error('disk said no')
    const clash = world.taken.get(text.toLowerCase())
    if (text && clash) return 'duplicate'
    const key = segments.join('/')
    if ((world.titles.get(key) ?? '') === text) return 'noop'
    if (text) world.titles.set(key, text)
    else world.titles.delete(key)
    return text ? 'set' : 'cleared'
  },
  duplicateTitle: async (_segments, text) => {
    const reading = world.taken.get(text.toLowerCase())
    return reading ? { reading, address: `${reading.toLowerCase()}-tile` } : null
  },
}

const toast = vi.fn()
const make = (): TileTitle => new TileTitle({
  decorations: () => decorations,
  toast,
  t: (_key, fallback, params) => fallback.replace(/\{(\w+)\}/g, (whole, name) => String(params?.[name] ?? whole)),
})

beforeEach(() => {
  world.titles.clear()
  world.taken.clear()
  world.setTitle.mockClear()
  world.delay = 0
  world.fail = false
  toast.mockClear()
})

describe('loading', () => {
  it('reads the stored name and shows it as the draft', async () => {
    world.titles.set('page/alpha', 'Alpha One')
    const title = make()
    await title.load(['page', 'alpha'])
    expect(title.stored).toBe('Alpha One')
    expect(title.draft).toBe('Alpha One')
    expect(title.address).toBe('alpha')
    expect(title.dirty).toBe(false)
  })

  it('a tile with no name reads as its address', async () => {
    const title = make()
    await title.load(['page', 'alpha'])
    expect(title.draft).toBe('')
    expect(title.reading).toBe('alpha')
  })

  it('typing before the read lands wins over the stored name', async () => {
    world.titles.set('page/alpha', 'Stored')
    const title = make()
    const loading = title.load(['page', 'alpha'])
    title.edit('Typed')
    await loading
    expect(title.stored).toBe('Stored')
    expect(title.draft).toBe('Typed')
  })

  it('loading the same tile again changes nothing', async () => {
    const title = make()
    await title.load(['page', 'alpha'])
    title.edit('Half typed')
    await title.load(['page', 'alpha'])
    expect(title.draft).toBe('Half typed')
  })
})

describe('committing', () => {
  it('writes the typed name and remembers it', async () => {
    const title = make()
    await title.load(['page', 'alpha'])
    title.edit('  Second Reading ')
    expect(title.dirty).toBe(true)

    expect(await title.commit()).toBe('set')

    expect(world.setTitle).toHaveBeenCalledWith('page/alpha', 'Second Reading')
    expect(title.stored).toBe('Second Reading')
    expect(title.status).toEqual({ state: 'saved' })
    expect(title.dirty).toBe(false)
  })

  it('writes nothing when nothing changed', async () => {
    world.titles.set('page/alpha', 'Same')
    const title = make()
    await title.load(['page', 'alpha'])
    expect(await title.commit()).toBe('noop')
    expect(world.setTitle).not.toHaveBeenCalled()
  })

  it('clearing the field clears the reading', async () => {
    world.titles.set('page/alpha', 'Was Named')
    const title = make()
    await title.load(['page', 'alpha'])
    title.edit('')
    expect(await title.commit()).toBe('cleared')
    expect(title.stored).toBe('')
    expect(title.reading).toBe('alpha')
  })

  it('a name a sibling already has is refused, and says who has it', async () => {
    world.taken.set('jazz', 'Jazz')
    const title = make()
    await title.load(['page', 'alpha'])
    title.edit('jazz')

    expect(await title.commit()).toBe('duplicate')

    expect(title.status).toEqual({ state: 'refused', sibling: 'Jazz', siblingAddress: 'jazz-tile' })
    expect(title.stored).toBe('')
    // the unwritten name is still an unsaved change
    expect(title.dirty).toBe(true)
  })

  it('typing again clears the refusal', async () => {
    world.taken.set('jazz', 'Jazz')
    const title = make()
    await title.load(['page', 'alpha'])
    title.edit('jazz')
    await title.commit()
    title.edit('jazz band')
    expect(title.status).toEqual({ state: 'idle' })
  })

  it('a failed write is reported, not swallowed', async () => {
    world.fail = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const title = make()
    await title.load(['page', 'alpha'])
    title.edit('Anything')
    expect(await title.commit()).toBe('error')
    expect(title.status).toEqual({ state: 'failed' })
    expect(title.dirty).toBe(true)
    warn.mockRestore()
  })

  it('Escape puts the stored name back', async () => {
    world.titles.set('page/alpha', 'Stored')
    const title = make()
    await title.load(['page', 'alpha'])
    title.edit('Oops')
    title.revert()
    expect(title.draft).toBe('Stored')
    expect(title.dirty).toBe(false)
  })
})

describe('flush — what Save and a tile switch await', () => {
  it('resolves with the refusal so the caller can stay open', async () => {
    world.taken.set('jazz', 'Jazz')
    const title = make()
    await title.load(['page', 'alpha'])
    title.edit('jazz')
    expect(await title.flush()).toBe('duplicate')
    // asking again is refused again — the refusal does not become a pass
    expect(await title.flush()).toBe('duplicate')
    expect(title.dirty).toBe(true)
  })

  it('resolves ok when nothing is owed', async () => {
    const title = make()
    await title.load(['page', 'alpha'])
    expect(await title.flush()).toBe('ok')
    expect(world.setTitle).not.toHaveBeenCalled()
  })

  it('resolves error when the write failed', async () => {
    world.fail = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const title = make()
    await title.load(['page', 'alpha'])
    title.edit('Anything')
    expect(await title.flush()).toBe('error')
    warn.mockRestore()
  })

  it('waits for a write already on its way', async () => {
    world.delay = 20
    const title = make()
    await title.load(['page', 'alpha'])
    title.edit('First')
    void title.commit()
    expect(title.saving).toBe(true)
    expect(title.dirty).toBe(true)
    title.edit('Second')
    expect(await title.flush()).toBe('ok')
    expect(title.stored).toBe('Second')
    expect(title.saving).toBe(false)
  })
})

describe('typing past a slow write', () => {
  it('collapses overlapping commits into the latest text', async () => {
    world.delay = 15
    const title = make()
    await title.load(['page', 'alpha'])
    title.edit('A')
    const first = title.commit()
    title.edit('B')
    const second = title.commit()
    title.edit('C')
    const third = title.commit()
    await Promise.all([first, second, third])

    expect(world.titles.get('page/alpha')).toBe('C')
    expect(title.stored).toBe('C')
    // never two writes at once: each waited for the one before
    const written = world.setTitle.mock.calls.map(call => call[1])
    expect(written[written.length - 1]).toBe('C')
  })
})

describe('moving on', () => {
  it('writes an unsaved name for the tile it belongs to when another is loaded', async () => {
    const title = make()
    await title.load(['page', 'alpha'])
    title.edit('Kept For Alpha')

    await title.load(['page', 'bravo'])
    await vi.waitFor(() => expect(world.titles.get('page/alpha')).toBe('Kept For Alpha'))

    expect(world.titles.has('page/bravo')).toBe(false)
    expect(title.address).toBe('bravo')
    expect(title.draft).toBe('')
  })

  it('says so aloud when the name left behind is refused', async () => {
    world.taken.set('jazz', 'Jazz')
    const title = make()
    await title.load(['page', 'alpha'])
    title.edit('jazz')

    await title.load(['page', 'bravo'])
    await vi.waitFor(() => expect(toast).toHaveBeenCalled())

    expect(toast.mock.calls[0][0]).toContain('Jazz')
    expect(toast.mock.calls[0][1]).toBe('warning')
    // and the new tile's own field is untouched by it
    expect(title.status).toEqual({ state: 'idle' })
  })

  it('a late result for the tile left never touches the tile now loaded', async () => {
    world.delay = 20
    const title = make()
    await title.load(['page', 'alpha'])
    title.edit('Slow')
    void title.commit()
    await title.load(['page', 'bravo'])
    title.edit('Bravo Name')
    await title.flush()
    await vi.waitFor(() => expect(world.titles.get('page/alpha')).toBe('Slow'))
    expect(title.stored).toBe('Bravo Name')
    expect(world.titles.get('page/bravo')).toBe('Bravo Name')
  })

  it('dispose writes what is owed and lets go', async () => {
    const title = make()
    await title.load(['page', 'alpha'])
    title.edit('On The Way Out')
    title.dispose()
    await vi.waitFor(() => expect(world.titles.get('page/alpha')).toBe('On The Way Out'))
    expect(title.segments).toEqual([])
  })

  it('dispose with nothing owed writes nothing', async () => {
    const title = make()
    await title.load(['page', 'alpha'])
    title.dispose()
    expect(world.setTitle).not.toHaveBeenCalled()
  })
})

describe('review fixes', () => {
  it('reads the next tile’s stored name only after the write for the tile just left has landed', async () => {
    const log: string[] = []
    const ordered: TitleDecorations = {
      titleOf: async segments => { log.push(`read ${segments.join('/')}`); return '' },
      setTitle: async segments => {
        log.push(`write ${segments.join('/')}`)
        await new Promise(resolve => setTimeout(resolve, 30))
        log.push(`wrote ${segments.join('/')}`)
        return 'set'
      },
      duplicateTitle: async () => null,
    }
    const title = new TileTitle({ decorations: () => ordered, toast, t: (_key, fallback) => fallback })
    await title.load(['page', 'alpha'])
    title.edit('Left Behind')
    log.length = 0

    await title.load(['page', 'bravo'])

    expect(log).toEqual(['write page/alpha', 'wrote page/alpha', 'read page/bravo'])
  })

  it('says a refusal once when the blur-commit and the detach-commit both meet it', async () => {
    world.taken.set('jazz', 'Jazz')
    world.delay = 20
    const title = make()
    await title.load(['page', 'alpha'])
    title.edit('jazz')
    void title.commit()
    title.dispose()
    await vi.waitFor(() => expect(toast).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(toast).toHaveBeenCalledTimes(1)
  })
})
