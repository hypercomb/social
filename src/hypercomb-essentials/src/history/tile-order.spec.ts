import { beforeEach, describe, expect, it } from 'vitest'

const registrations = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: { get: (key: string) => registrations.get(key) },
}

const {
  applyOrderChanges, hasOrderChanges, nextOrderSig, parseOrder, readOrderAt,
  registerSeatChooser, seatFor, serializeOrder,
} = await import('./tile-order.js')

/** jsdom's Blob has no text(); FileReader it has. */
const textOf = (blob: Blob): Promise<string> => new Promise(resolve => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.readAsText(blob)
})

/** A store keyed by the bytes themselves — enough to tell one resource from another. */
const store = () => {
  const blobs = new Map<string, string>()
  return {
    blobs,
    getResource: async (sig: string) => blobs.has(sig) ? { text: async () => blobs.get(sig)! } as unknown as Blob : null,
    putResource: async (blob: Blob) => {
      const text = await textOf(blob)
      const sig = `sig:${text}`
      blobs.set(sig, text)
      return sig
    },
  }
}

describe('an order is the page’s claim about where its tiles sit', () => {
  it('parses only whole non-negative seats, and refuses bytes that are not an order', () => {
    expect([...parseOrder('{"a":0,"b":3,"c":-1,"d":1.5,"e":"2"}')!]).toEqual([['a', 0], ['b', 3]])
    expect(parseOrder('[1,2]')).toBeNull()
    expect(parseOrder('not json')).toBeNull()
  })

  it('serializes with sorted keys, so the same seats are the same signature', () => {
    expect(serializeOrder(new Map([['b', 1], ['a', 0]]))).toBe('{"a":0,"b":1}')
  })

  it('removes before it sets, and ignores a seat that is not a seat', () => {
    const next = applyOrderChanges(new Map([['a', 0], ['b', 1]]), { remove: ['a'], set: { a: 5, c: -2 } })
    expect([...next]).toEqual([['b', 1], ['a', 5]])
    expect(hasOrderChanges({})).toBe(false)
    expect(hasOrderChanges({ remove: ['a'] })).toBe(true)
  })
})

describe('nextOrderSig — the committer’s step', () => {
  it('builds on the current order and writes one new resource', async () => {
    const s = store()
    const first = await nextOrderSig(undefined, { set: { a: 0 } }, s)
    const second = await nextOrderSig(first!, { set: { b: 4 } }, s)
    expect(s.blobs.get(second!)).toBe('{"a":0,"b":4}')
  })

  it('answers null when no seat is left, so the slot is dropped', async () => {
    const s = store()
    const only = await nextOrderSig(undefined, { set: { a: 0 } }, s)
    expect(await nextOrderSig(only!, { remove: ['a'] }, s)).toBeNull()
  })

  it('skips — never rebuilds from nothing — when the current order cannot be read', async () => {
    const s = store()
    expect(await nextOrderSig('sig:gone', { set: { a: 0 } }, s)).toBeUndefined()
    expect(s.blobs.size).toBe(0)
  })
})

describe('readOrderAt', () => {
  beforeEach(() => registrations.clear())

  it('reads the seats from the page’s live head', async () => {
    const s = store()
    const ref = await s.putResource(new Blob(['{"desk":2,"inbox":0}']))
    registrations.set('@hypercomb.social/Store', s)
    registrations.set('@diamondcoreprocessor.com/HistoryService', {
      sign: async (l: { explorerSegments: () => readonly string[] }) => `loc:${l.explorerSegments().join('/')}`,
      currentLayerAt: async (loc: string) => loc === 'loc:work' ? { name: 'work', order: [ref] } : null,
    })
    const stats = { cold: false }
    expect([...await readOrderAt(['work'], stats)]).toEqual([['desk', 2], ['inbox', 0]])
    expect(stats.cold).toBe(false)
    expect((await readOrderAt(['elsewhere'])).size).toBe(0)
  })

  it('says cold when the head names an order whose bytes are not here yet', async () => {
    registrations.set('@hypercomb.social/Store', store())
    registrations.set('@diamondcoreprocessor.com/HistoryService', {
      sign: async () => 'loc',
      currentLayerAt: async () => ({ order: ['sig:not-here'] }),
    })
    const stats = { cold: false }
    expect((await readOrderAt([], stats)).size).toBe(0)
    expect(stats.cold).toBe(true)
  })

  it('says cold before the services exist', async () => {
    const stats = { cold: false }
    await readOrderAt([], stats)
    expect(stats.cold).toBe(true)
  })
})

describe('the seat of a tile about to be linked', () => {
  it('asks the registered chooser, and answers nothing without one', () => {
    registerSeatChooser(null)
    expect(seatFor(['work'], 'desk')).toBeUndefined()
    registerSeatChooser((segments, name) => segments[0] === 'work' && name === 'desk' ? 7 : undefined)
    expect(seatFor(['work'], 'desk')).toBe(7)
    expect(seatFor(['home'], 'desk')).toBeUndefined()
    registerSeatChooser(() => -1)
    expect(seatFor([], 'x')).toBeUndefined()
    registerSeatChooser(null)
  })
})
