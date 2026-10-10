// sharing/published-address.spec.ts — where a published address stands now, checked against its signed index.
import { describe, it, expect } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { readAddressHead, doorUrlOf, readFromHost } from './published-address.js'
import type { HiveIndexResult } from './hive-pointer.js'

const s = (c: string) => c.repeat(64)
const HEAD = s('a'), OLD = s('b'), KEY = s('c')
const HOST = 'jaime-weise.hypercomb.com'
const locationOf = (host: string) => SignatureService.sign(new TextEncoder().encode(host).buffer as ArrayBuffer)

const fakeFetch = (files: Record<string, string | number>) => (async (input: RequestInfo | URL) => {
  const v = files[String(input)]
  if (typeof v === 'number') return new Response('', { status: v })
  if (v === undefined) return new Response('', { status: 404 })
  return new Response(v, { status: 200 })
}) as typeof fetch

const doorOf = async (record: Record<string, unknown>, markers = ['00000001']) => {
  const base = `https://${HOST}/content/${await locationOf(HOST)}/`
  const files: Record<string, string> = { [base]: markers.join('\n') }
  for (const m of markers) files[base + m] = JSON.stringify(m === markers.at(-1) ? record : { ...record, layer: OLD })
  return fakeFetch(files)
}
const index = (roots: Record<string, string>, extra: Record<string, unknown> = {}): (() => Promise<HiveIndexResult>) =>
  async () => ({ ok: true, manifest: { roots, createdAt: 1700000000, pubkey: KEY, ...extra } })

describe('doorUrlOf — only a door\'s own address', () => {
  it('takes a host root, typed with or without its scheme', () => {
    expect(doorUrlOf('jaime-weise.hypercomb.com')?.host).toBe(HOST)
    expect(doorUrlOf('https://jaime-weise.hypercomb.com/')?.host).toBe(HOST)
  })
  it('refuses a path, plain http away from this machine, and other schemes', () => {
    expect(doorUrlOf('https://hypercomb.com/jaime-weise')).toBeNull()
    expect(doorUrlOf('http://jaime-weise.hypercomb.com/')).toBeNull()
    expect(doorUrlOf('javascript:alert(1)')).toBeNull()
    expect(doorUrlOf('')).toBeNull()
  })
})

describe('readAddressHead — the head an address serves, when its publisher signed it', () => {
  const record = { layer: HEAD, pubkey: KEY, lineage: 'jaime-weise', title: 'Jaime Weise' }

  it('reads the newest marker and checks it against the signed index', async () => {
    const got = await readAddressHead(HOST, { fetch: await doorOf(record, ['00000001', '00000002']), index: index({ 'jaime-weise': HEAD }) })
    expect(got).toEqual({ head: HEAD, pubkey: KEY, lineage: 'jaime-weise', title: 'Jaime Weise', host: HOST, publishedAt: 1700000000 })
  })

  it('refuses a head the signed index does not name', async () => {
    const got = await readAddressHead(HOST, { fetch: await doorOf(record), index: index({ 'jaime-weise': OLD }) })
    expect(got).toEqual({ error: 'unverified' })
  })

  it('refuses an address the index does not bind to the lineage', async () => {
    const other = { ...record, lineage: 'someone-else' }
    expect(await readAddressHead(HOST, { fetch: await doorOf(other), index: index({ 'someone-else': HEAD }) })).toEqual({ error: 'unverified' })
    expect(await readAddressHead(HOST, { fetch: await doorOf(record), index: index({ 'jaime-weise': HEAD }, { addresses: { [HOST]: 'other' } }) })).toEqual({ error: 'unverified' })
  })

  it('refuses an address on a zone the lineage has no door on, and takes one it has', async () => {
    expect(await readAddressHead(HOST, { fetch: await doorOf(record), index: index({ 'jaime-weise': HEAD }, { doors: { 'jaime-weise': ['example.org'] } }) })).toEqual({ error: 'unverified' })
    const got = await readAddressHead(HOST, { fetch: await doorOf(record), index: index({ 'jaime-weise': HEAD }, { doors: { 'jaime-weise': ['hypercomb.com'] } }) })
    expect('head' in got && got.head).toBe(HEAD)
  })

  it('takes an own address the index signs for the lineage', async () => {
    const own = { ...record, lineage: 'cards/jaime' }
    const got = await readAddressHead(HOST, { fetch: await doorOf(own), index: index({ 'cards/jaime': HEAD }, { addresses: { [HOST]: 'cards/jaime' } }) })
    expect('head' in got && got.lineage).toBe('cards/jaime')
  })

  it('refuses when the index does not verify', async () => {
    const forged = async (): Promise<HiveIndexResult> => ({ ok: false, reason: 'forged' })
    expect(await readAddressHead(HOST, { fetch: await doorOf(record), index: forged })).toEqual({ error: 'unverified' })
  })

  it('says no door when the host keeps no record for the address', async () => {
    expect(await readAddressHead(HOST, { fetch: fakeFetch({}), index: index({}) })).toEqual({ error: 'no-door' })
  })

  it('says unreachable when the host cannot be read', async () => {
    const down = (async () => { throw new TypeError('network') }) as unknown as typeof fetch
    expect(await readAddressHead(HOST, { fetch: down, index: index({}) })).toEqual({ error: 'unreachable' })
  })

  it('is not an address when it is a path', async () => {
    expect(await readAddressHead('https://hypercomb.com/jaime-weise')).toEqual({ error: 'not-an-address' })
  })
})

describe('readFromHost — bytes from the card\'s own host, checked against their name', () => {
  it('returns bytes whose signature matches, and nothing when it does not', async () => {
    const bytes = new TextEncoder().encode('{"n":"Jaime"}')
    const sig = await SignatureService.sign(bytes.slice().buffer as ArrayBuffer)
    const right = fakeFetch({ [`https://${HOST}/${sig}`]: '{"n":"Jaime"}' })
    expect(new TextDecoder().decode((await readFromHost(HOST, sig, { fetch: right }))!)).toBe('{"n":"Jaime"}')
    const wrong = fakeFetch({ [`https://${HOST}/${sig}`]: '{"n":"Someone else"}' })
    expect(await readFromHost(HOST, sig, { fetch: wrong })).toBeNull()
  })
})
