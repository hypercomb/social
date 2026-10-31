// community-lens.spec.ts — the record layer of the lens, against faked hosts.
//
// Pinned here:
//   1. a signature under two words is a triangulation point and sorts first;
//   2. the same signature on two hosts is ONE point carrying both origins;
//   3. a host that is down, or answers with a page, is a gap, not an error;
//   4. only signatures are members (markers and index.html are left out);
//   5. only the word's signature is sent — the path is `/<sig>/`, nothing else;
//   6. words are capped, deduplicated by address, and an empty word is dropped.

import { describe, expect, it } from 'vitest'
import { LENS_MAX_WORDS, listingMembers, readLens, type LensDeps } from './community-lens.js'

const SIG = (seed: string): string => seed.repeat(64).slice(0, 64)

const ADDRESS: Record<string, string> = { jazz: SIG('a'), blues: SIG('b'), soul: SIG('c') }

/** hosts: url prefix -> { addressSig -> listing body | null }. */
const fake = (hosts: Record<string, Record<string, string | null>>, seen: string[] = []): LensDeps => ({
  address: async word => {
    if (!word.trim()) throw new RangeError('empty')
    return ADDRESS[word] ?? SIG(word.charCodeAt(0).toString(16).padEnd(1, '0')[0])
  },
  list: async url => {
    seen.push(url)
    const match = /^https?:\/\/([^/]+)\/([a-f0-9]{64})\/$/.exec(url)
    if (!match) return null
    const host = hosts[match[1]]
    if (!host) throw new Error('down')
    return host[match[2]] ?? null
  },
})

describe('listingMembers', () => {
  it('keeps signatures only', () => {
    expect(listingMembers(`0000\n${SIG('1')}\nindex.html\n${SIG('2')}\n`)).toEqual([SIG('1'), SIG('2')])
  })
  it('is null for a page or no body', () => {
    expect(listingMembers('<!doctype html>')).toBeNull()
    expect(listingMembers(null)).toBeNull()
  })
  it('is empty for an empty listing', () => {
    expect(listingMembers('')).toEqual([])
  })
})

describe('readLens', () => {
  it('ranks a signature under two words first, with every origin', async () => {
    const result = await readLens({
      hosts: ['one.example', 'two.example'],
      words: ['jazz', 'blues'],
      deps: fake({
        'one.example': { [SIG('a')]: `${SIG('1')}\n${SIG('2')}`, [SIG('b')]: SIG('1') },
        'two.example': { [SIG('a')]: SIG('1') },
      }),
    })
    expect(result.points[0]).toEqual({ sig: SIG('1'), words: ['blues', 'jazz'], origins: ['one.example', 'two.example'] })
    expect(result.points[1]).toEqual({ sig: SIG('2'), words: ['jazz'], origins: ['one.example'] })
    expect(result.points).toHaveLength(2)
  })

  it('treats a down host and a page answer as gaps', async () => {
    const result = await readLens({
      hosts: ['up.example', 'down.example', 'spa.example'],
      words: ['jazz'],
      deps: fake({ 'up.example': { [SIG('a')]: SIG('1') }, 'spa.example': { [SIG('a')]: '<html>' } }),
    })
    expect(result.points).toHaveLength(1)
    expect(result.answers.map(a => `${a.host}:${a.status}`)).toEqual([
      'down.example:gap', 'spa.example:gap', 'up.example:listed',
    ])
  })

  it('sends only the word signature as the path', async () => {
    const seen: string[] = []
    await readLens({ hosts: ['one.example'], words: ['jazz'], deps: fake({ 'one.example': {} }, seen) })
    expect(seen).toEqual([`https://one.example/${SIG('a')}/`])
  })

  it('reads a loopback host over http', async () => {
    const seen: string[] = []
    await readLens({ hosts: ['localhost:8443'], words: ['jazz'], deps: fake({ 'localhost:8443': {} }, seen) })
    expect(seen[0].startsWith('http://localhost:8443/')).toBe(true)
  })

  it('drops an empty word, dedupes by address, and caps the count', async () => {
    const seen: string[] = []
    const words = ['jazz', 'jazz', '  ', ...Array.from({ length: 20 }, (_, i) => String.fromCharCode(100 + i))]
    await readLens({ hosts: ['one.example'], words, deps: fake({ 'one.example': {} }, seen) })
    expect(seen.length).toBeLessThanOrEqual(LENS_MAX_WORDS)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('returns nothing for no hosts', async () => {
    const result = await readLens({ hosts: [], words: ['jazz'], deps: fake({}) })
    expect(result).toEqual({ points: [], answers: [] })
  })
})
