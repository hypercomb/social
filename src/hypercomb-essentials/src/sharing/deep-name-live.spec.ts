// deep-name-live.spec.ts — a nested place's own name is linked only once it
// has answered, and a name that has not is not asked again and again.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { askDeepName, deepNameLive, forgetDeepNamesForTests } from './deep-name-live.js'
import { deepNameHost } from './zone-door.js'

const HOST = 'hyperdex.knowledge.jwize.com'

describe('a nested place\'s own name', () => {
  it('is the route read leaf first, under the zone', () => {
    expect(deepNameHost('jwize.com', 'knowledge/hyperdex')).toBe(HOST)
    expect(deepNameHost('JWIZE.com', 'knowledge/hyperdex/part')).toBe(`part.${HOST}`)
  })

  it('is nothing for a top-level place, a loopback zone, or a key that is not DNS labels', () => {
    expect(deepNameHost('jwize.com', 'knowledge')).toBe('')
    expect(deepNameHost('localhost:4250', 'knowledge/hyperdex')).toBe('')
    expect(deepNameHost('jwize.com', 'Knowledge/hyperdex')).toBe('')
    expect(deepNameHost('jwize.com', 'knowledge/my notes')).toBe('')
    expect(deepNameHost('jwize.com', 'knowledge/')).toBe('')
    expect(deepNameHost('jwize.com', Array.from({ length: 30 }, () => 'abcdefghij').join('/'))).toBe('')
  })
})

describe('whether a deep name answers yet', () => {
  beforeEach(() => forgetDeepNamesForTests())

  it('is unknown until asked, and stays answered once it answers', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response(''))
    expect(deepNameLive(HOST)).toBe(false)
    expect(await askDeepName(HOST, { fetch: fetchImpl as unknown as typeof fetch })).toBe(true)
    expect(deepNameLive(HOST)).toBe(true)
    expect(await askDeepName(HOST, { fetch: fetchImpl as unknown as typeof fetch })).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`https://${HOST}/`)
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ mode: 'no-cors', credentials: 'omit', cache: 'no-store' })
  })

  it('asks a name that failed once a minute at most, and one request serves every caller', async () => {
    let clock = 1_000_000
    const now = (): number => clock
    const fetchImpl = vi.fn(async () => { throw new TypeError('handshake failed') })
    const deps = { fetch: fetchImpl as unknown as typeof fetch, now }
    const both = await Promise.all([askDeepName(HOST, deps), askDeepName(HOST, deps)])
    expect(both).toEqual([false, false])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    clock += 30_000
    expect(await askDeepName(HOST, deps)).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    clock += 31_000
    expect(await askDeepName(HOST, deps)).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(deepNameLive(HOST)).toBe(false)
  })
})
