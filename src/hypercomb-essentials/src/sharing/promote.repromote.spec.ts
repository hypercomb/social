// promote.repromote.spec.ts — A REPUBLISH OPTIMIZES ITSELF (2026-11-16).
//
// A promotion names the head it was made for. games and camelflage, live in
// the jwize.com community, were published again and read as not promoted:
// nothing promoted the new head, and no button may ask anyone to (jwize
// 2026-11-13, "these things are done automatically"). After a publish, every
// zone whose live showcase names the creation promotes the new head once that
// zone's visitors are handed it, exactly as going live does.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { repromoteInCommunity, type CommunityPromotion } from './promote.js'

const OWN = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const HEAD = 'c'.repeat(64)
const OLD = 'd'.repeat(64)

const deps = (showcases: Record<string, { pubkey: string; lineage: string }[] | null>, zones = Object.keys(showcases)) => {
  const promoted: string[] = []
  return {
    promoted,
    deps: {
      zones: async () => zones,
      pubkey: async () => OWN,
      showcase: async (zone: string) => {
        const items = showcases[zone]
        if (items === undefined) throw new Error('unreadable')
        return items === null ? null : { items }
      },
      visible: async () => HEAD,
      sleep: async () => {},
      promote: async (zone: string, lineage: string): Promise<CommunityPromotion> => {
        promoted.push(`${zone}:${lineage}`)
        return { ok: true, promoted: true }
      },
    },
  }
}

describe('a republished creation is promoted again where it is live', () => {
  it('promotes it on every zone whose live showcase names it as this key\'s', async () => {
    const { promoted, deps: d } = deps({
      'jwize.com': [{ pubkey: OWN, lineage: 'games' }],
      'pointblanksolutions.ca': [{ pubkey: OWN, lineage: 'games' }, { pubkey: OWN, lineage: 'dylan' }],
    })
    const done = await repromoteInCommunity('games', ['games'], HEAD, d)
    expect(promoted).toEqual(['jwize.com:games', 'pointblanksolutions.ca:games'])
    expect(done.map(r => r.zone)).toEqual(['jwize.com', 'pointblanksolutions.ca'])
  })

  it('leaves a zone alone where it is not live, or live under someone else\'s key', async () => {
    const { promoted, deps: d } = deps({
      'jwize.com': [{ pubkey: OTHER, lineage: 'games' }],
      'hypercomb.com': [{ pubkey: OWN, lineage: 'dylan' }],
      'pluginthematrix.com': null,
    })
    expect(await repromoteInCommunity('games', ['games'], HEAD, d)).toEqual([])
    expect(promoted).toEqual([])
  })

  it('a zone whose showcase cannot be read is passed over, and the rest still go; a zone named twice is asked once', async () => {
    const { promoted, deps: d } = deps({ 'jwize.com': [{ pubkey: OWN, lineage: 'games' }] }, ['broken.example', 'jwize.com', 'JWIZE.com', ''])
    await repromoteInCommunity('games', ['games'], HEAD, d)
    expect(promoted).toEqual(['jwize.com:games'])
  })

  it('waits until the zone hands visitors the new head: promoted earlier, the old head would be read and nothing done', async () => {
    const { promoted, deps: d } = deps({ 'jwize.com': [{ pubkey: OWN, lineage: 'games' }] })
    const answers: (string | null)[] = [OLD, OLD, '', HEAD]
    const waits: number[] = []
    await repromoteInCommunity('games', ['games'], HEAD, {
      ...d,
      visible: async () => answers.length ? answers.shift()! : HEAD,
      sleep: async ms => { waits.push(ms) },
    })
    expect(promoted).toEqual(['jwize.com:games'])
    expect(waits).toHaveLength(3)
    expect(waits[1]!).toBeGreaterThan(waits[0]!)
  })

  it('says so, and promotes nothing, when the new head never reaches the zone', async () => {
    const { promoted, deps: d } = deps({ 'jwize.com': [{ pubkey: OWN, lineage: 'games' }] })
    const done = await repromoteInCommunity('games', ['games'], HEAD, { ...d, visible: async () => OLD })
    expect(promoted).toEqual([])
    expect(done).toEqual([{ zone: 'jwize.com', result: { ok: false, reason: 'jwize.com does not hand visitors the new games yet' } }])
  })

  it('says a refusal and never throws', async () => {
    const { deps: d } = deps({ 'jwize.com': [{ pubkey: OWN, lineage: 'games' }] })
    const done = await repromoteInCommunity('games', ['games'], HEAD, {
      ...d, promote: async () => { throw new Error('host refused') },
    })
    expect(done).toEqual([{ zone: 'jwize.com', result: { ok: false, reason: 'host refused' } }])
  })

  it('does nothing without a key or a head', async () => {
    const { promoted, deps: d } = deps({ 'jwize.com': [{ pubkey: OWN, lineage: 'games' }] })
    expect(await repromoteInCommunity('games', ['games'], HEAD, { ...d, pubkey: async () => '' })).toEqual([])
    expect(await repromoteInCommunity('games', ['games'], 'not-a-head', d)).toEqual([])
    expect(promoted).toEqual([])
  })

  it('runs one at a time: a second waits for the first', async () => {
    const order: string[] = []
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const slow = repromoteInCommunity('games', ['games'], HEAD, {
      ...deps({ 'jwize.com': [{ pubkey: OWN, lineage: 'games' }] }).deps,
      promote: async () => { order.push('games:start'); await gate; order.push('games:end'); return { ok: true, promoted: true } },
    })
    const next = repromoteInCommunity('dylan', ['dylan'], HEAD, {
      ...deps({ 'jwize.com': [{ pubkey: OWN, lineage: 'dylan' }] }).deps,
      promote: async () => { order.push('dylan'); return { ok: true, promoted: true } },
    })
    await new Promise(resolve => setTimeout(resolve, 5))
    release()
    await Promise.all([slow, next])
    expect(order).toEqual(['games:start', 'games:end', 'dylan'])
  })

  it('a run that never ends holds the queue only until its hold runs out', async () => {
    const order: string[] = []
    void repromoteInCommunity('games', ['games'], HEAD, {
      ...deps({ 'jwize.com': [{ pubkey: OWN, lineage: 'games' }] }).deps,
      holdMs: 10,
      promote: () => { order.push('games:hung'); return new Promise<CommunityPromotion>(() => {}) },
    })
    await repromoteInCommunity('dylan', ['dylan'], HEAD, {
      ...deps({ 'jwize.com': [{ pubkey: OWN, lineage: 'dylan' }] }).deps,
      promote: async () => { order.push('dylan'); return { ok: true, promoted: true } },
    })
    expect(order).toEqual(['games:hung', 'dylan'])
  })

  it('every publish asks for it with the head it published, once the publish stands, outside the lane', () => {
    const source = readFileSync(join(process.cwd(), 'hypercomb-essentials', 'src', 'sharing', 'publish-branch.ts'), 'utf8')
    const wrapper = source.slice(source.indexOf('export function publishBranch('), source.indexOf('/** Withdraw a branch from the index'))
    expect(wrapper).toMatch(/inPublishLane\(\(\) => publishBranchNow\(\.\.\.args\)[^\n]*\)\.then\(result => \{/)
    expect(wrapper).toContain('if (result.ok) void repromoteAfter(result.lineageKey, args[0], result.sealed)')
    expect(wrapper).toContain("await import('./promote.js')")
  })

  it('looks beyond the branch\'s own marks: the community\'s domains and the named public host', () => {
    const source = readFileSync(join(process.cwd(), 'hypercomb-essentials', 'src', 'sharing', 'promote.ts'), 'utf8')
    const zones = source.slice(source.indexOf('const communityZones'), source.indexOf('/**', source.indexOf('const communityZones')))
    expect(zones).toContain('hosts.hostsOfBranch(segments)')
    expect(zones).toContain('hosts.listCommunityHosts()')
    expect(zones).toContain('publicHostDomain')
  })
})
