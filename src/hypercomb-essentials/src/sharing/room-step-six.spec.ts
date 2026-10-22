import { describe, expect, it } from 'vitest'
import { applyAsks, cleanAsks, readAsks, roomAsks, sortAsks } from './room-asks.js'
import { fetchTakeBundle, normalizeHome, parseTake, takeBundle, takeClosure, takeLinkText } from './take-home.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')
const sha = async (bytes: Uint8Array): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))].map(b => b.toString(16).padStart(2, '0')).join('')

describe('what a room asks', () => {
  it('reads the asks slot folded, de-duplicated, shapes only', () => {
    expect(readAsks({ asks: ['Notes', '/keep-alive', 'notes', 'not a word!', 7] })).toEqual(['notes', 'keep-alive'])
    expect(readAsks({})).toEqual([])
    expect(cleanAsks(Array.from({ length: 20 }, (_, i) => `w${i}`)).length).toBe(12)
  })

  it('edits: add, drop with ~, clear with =', () => {
    expect(applyAsks(['notes'], 'keep-alive, notes')).toEqual(['notes', 'keep-alive'])
    expect(applyAsks(['notes', 'keep-alive'], '~ notes')).toEqual(['keep-alive'])
    expect(applyAsks(['notes'], '=')).toEqual([])
  })

  it('reads the host\'s template first, else every shared tile', async () => {
    const layers: Record<string, unknown> = { [sig(1)]: { asks: ['notes'] }, [sig(2)]: { asks: ['keep-alive'] } }
    const read = async (s: string) => layers[s] ?? null
    expect(await roomAsks([{ name: 'a', layerSig: sig(1), template: true }, { name: 'b', layerSig: sig(2) }], read)).toEqual(['notes'])
    expect(await roomAsks([{ name: 'a', layerSig: sig(1) }, { name: 'b', layerSig: sig(2) }], read)).toEqual(['notes', 'keep-alive'])
    expect(await roomAsks([{ name: 'a', layerSig: 'nope' }], read)).toEqual([])
  })

  it('sorts what this shell has from what it lacks', () => {
    expect(sortAsks(['notes', 'keep-alive', 'zzz'], w => w !== 'zzz')).toEqual({ have: ['notes', 'keep-alive'], lack: ['zzz'] })
  })
})

describe('take home', () => {
  it('a home address becomes an origin — https, or http on loopback', () => {
    expect(normalizeHome('hypercomb.io')).toBe('https://hypercomb.io')
    expect(normalizeHome('https://jwize.com/some/path')).toBe('https://jwize.com')
    expect(normalizeHome('localhost:4250')).toBe('http://localhost:4250')
    expect(normalizeHome('http://jwize.com')).toBe('')
    expect(normalizeHome('')).toBe('')
  })

  it('the link round-trips', () => {
    const text = takeLinkText('https://hypercomb.io', sig(9), 'hypercomb.com')
    expect(text).toBe(`https://hypercomb.io/#take=${sig(9)}@hypercomb.com`)
    expect(parseTake(text.slice(text.indexOf('#')))).toEqual({ sig: sig(9), host: 'hypercomb.com' })
    expect(parseTake('#take=nope@x')).toBeNull()
    expect(parseTake(`#take=${sig(9)}`)).toBeNull()
  })

  it('the closure is every name the tile holds bytes for, from its head down', async () => {
    const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))
    const held: Record<string, Uint8Array> = {
      [sig(1)]: enc({ name: 'lecture', children: [sig(2)], notes: [sig(3)], lineage: sig(99) }),
      [sig(2)]: enc({ name: 'child', children: [] }),
      [sig(3)]: enc({ meta: 1, resource: sig(4), relation: 'notes' }),
      [sig(4)]: enc({ note: 'hello', children: [] }),
    }
    const closure = await takeClosure(sig(1), async (s) => held[s] ?? null)
    expect(closure.sort()).toEqual([sig(1), sig(2), sig(3), sig(4)].sort())
  })

  it('reads the bundle back only when its bytes hash to its name', async () => {
    const bundle = takeBundle('lecture', sig(1), 'hypercomb.com', sig(7), 1)
    const bytes = new TextEncoder().encode(JSON.stringify(bundle))
    const name = await sha(bytes)
    const serve = (body: Uint8Array) => (async () => new Response(body.slice().buffer as ArrayBuffer)) as unknown as typeof fetch
    expect((await fetchTakeBundle(name, 'hypercomb.com', serve(bytes)))?.rootSig).toBe(sig(1))
    expect(await fetchTakeBundle(name, 'hypercomb.com', serve(new TextEncoder().encode('{"tampered":1}')))).toBeNull()
  })
})
