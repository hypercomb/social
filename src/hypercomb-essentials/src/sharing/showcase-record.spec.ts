// sharing/showcase-record.spec.ts — one domain's showcase, as the hive writes it
// and as the front door reads it.

import { describe, expect, it } from 'vitest'
import { parseShowcase, showcaseBytes, showcaseKey, showcases, toggleDomain, toggleItem, type Showcase } from './showcase-record'

const key = (char: string): string => char.repeat(64)
const empty: Showcase = { zone: 'hypercomb.com', items: [], domains: [] }
const dylan = { pubkey: key('a'), lineage: 'dylan' }
const games = { pubkey: key('b'), lineage: 'games' }

// The shim is read at runtime, never imported by a module: the front door
// must take the hive's bytes for exactly the showcase the hive meant.
const SHIM_RECORD = '../../../hypercomb-shim/src/bootstrap/showcase-record'

describe('showcase — a switch is a record', () => {
  it('turns a creation on, and the same switch turns it off', () => {
    const on = toggleItem(empty, dylan)
    expect(showcases(on, dylan)).toBe(true)
    expect(showcases(toggleItem(on, dylan), dylan)).toBe(false)
  })

  it('shows everything on a domain shown in full', () => {
    const all = toggleDomain(empty, 'jwize.com')
    expect(showcases(all, games, ['jwize.com'])).toBe(true)
    expect(showcases(all, games, ['cafesociety.buzz'])).toBe(false)
    expect(toggleDomain(all, 'jwize.com').domains).toEqual([])
  })

  it('writes the same bytes for the same choice, whatever order it was made in — undo lands on the same signature', () => {
    const one = toggleItem(toggleItem(toggleDomain(empty, 'jwize.com'), games), dylan)
    const other = toggleDomain(toggleItem(toggleItem(empty, dylan), games), 'jwize.com')
    expect(new TextDecoder().decode(showcaseBytes(one))).toBe(new TextDecoder().decode(showcaseBytes(other)))
    // On, off, on again: back to the very bytes it left.
    const back = toggleItem(toggleItem(one, dylan), dylan)
    expect(new TextDecoder().decode(showcaseBytes(back))).toBe(new TextDecoder().decode(showcaseBytes(one)))
  })

  it('is read back by the front door as exactly the showcase the hive wrote', async () => {
    const shim = await import(/* @vite-ignore */ SHIM_RECORD) as { parseShowcase: (raw: unknown, zone: string) => unknown }
    const written = toggleDomain(toggleItem(empty, dylan), 'jwize.com')
    const raw = JSON.parse(new TextDecoder().decode(showcaseBytes(written)))
    expect(shim.parseShowcase(raw, 'hypercomb.com')).toEqual(parseShowcase(raw, 'hypercomb.com'))
    expect(parseShowcase(raw, 'hypercomb.com')).toEqual({ zone: 'hypercomb.com', items: [dylan], domains: ['jwize.com'] })
    expect(showcaseKey('hypercomb.com')).toBe('showcase:hypercomb.com')
  })
})
