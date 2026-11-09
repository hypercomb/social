// A pool's listing is asked one quiet way: with `?held`, once, and a host that
// said "no pool here" is not asked again for a while.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { askPoolListing, forgetPoolMisses, readPoolListing } from './pool-listing.js'

const POOL = 'a'.repeat(64)
const MEMBER = 'b'.repeat(64)

const answer = (status: number, body: string | null = null, type = 'text/plain; charset=utf-8'): Response =>
  new Response(body, { status, headers: { 'content-type': type } })

describe('pool listing', () => {
  let asked: string[]
  let reply: (url: string) => Response | Promise<Response>

  beforeEach(() => {
    forgetPoolMisses()
    asked = []
    reply = () => answer(200, '')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { asked.push(String(url)); return reply(String(url)) }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('asks with ?held and reads a listing', async () => {
    reply = () => answer(200, `${MEMBER}\n`)
    expect(await readPoolListing('https://host.example', POOL)).toBe(`${MEMBER}\n`)
    expect(asked).toEqual([`https://host.example/${POOL}/?held`])
  })

  it('an empty listing is a listing, not a miss', async () => {
    expect(await askPoolListing('https://host.example', POOL)).toEqual({ state: 'listed', text: '' })
  })

  it.each([204, 404, 410])('a %i is "no pool here", remembered: the host is not asked again', async status => {
    reply = () => answer(status)
    expect(await askPoolListing('https://host.example', POOL)).toEqual({ state: 'absent' })
    expect(await askPoolListing('https://host.example', POOL)).toEqual({ state: 'absent' })
    expect(await readPoolListing('https://host.example', POOL)).toBeNull()
    expect(asked).toHaveLength(1)
  })

  it('a miss is per host and per address', async () => {
    reply = () => answer(204)
    await askPoolListing('https://one.example', POOL)
    await askPoolListing('https://two.example', POOL)
    await askPoolListing('https://one.example', MEMBER)
    expect(asked).toHaveLength(3)
  })

  it('fresh asks again, and a listing that answers forgets the miss', async () => {
    reply = () => answer(404)
    await askPoolListing('https://host.example', POOL)
    reply = () => answer(200, `${MEMBER}\n`)
    expect((await askPoolListing('https://host.example', POOL, { fresh: true })).state).toBe('listed')
    expect((await askPoolListing('https://host.example', POOL)).state).toBe('listed')
    expect(asked).toHaveLength(3)
  })

  it('a host that does not answer is silent and is asked again', async () => {
    reply = () => { throw new TypeError('Failed to fetch') }
    expect(await askPoolListing('https://host.example', POOL)).toEqual({ state: 'silent' })
    reply = () => answer(500)
    expect(await askPoolListing('https://host.example', POOL)).toEqual({ state: 'silent' })
    expect(asked).toHaveLength(2)
  })

  it('a page where a listing should be is not a listing', async () => {
    reply = () => answer(200, '<!doctype html><html></html>', 'text/html')
    expect(await readPoolListing('https://host.example', POOL)).toBeNull()
  })

  it('the same question in flight is asked once', async () => {
    let release!: (r: Response) => void
    reply = () => new Promise<Response>(resolve => { release = resolve })
    const first = askPoolListing('https://host.example', POOL)
    const second = askPoolListing('https://host.example', POOL)
    await Promise.resolve()
    release(answer(200, `${MEMBER}\n`))
    expect(await first).toEqual(await second)
    expect(asked).toHaveLength(1)
  })
})
