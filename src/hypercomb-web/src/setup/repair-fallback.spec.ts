// repair-fallback.spec.ts — a repair that misses because the head moved is an
// update notice when the installed package still boots; a wipe otherwise.
import { describe, expect, it } from 'vitest'
import { repairFallback, stillBoots, type MovedHead, type RepairFallbackInput } from './repair-fallback'

const s = (c: string): string => c.repeat(64)
const BEES = ['1', '2', '3', '4', '5', '6', '7', '8'].map(s)
const CRITICAL = [BEES[0]!, BEES[1]!, BEES[2]!]
const INSTALLED = s('a')
const HEAD = s('b')

const input = (over: Partial<RepairFallbackInput> = {}, head: MovedHead | null = { packageSig: HEAD, zone: 'hypercomb.com', source: 'channel' }): RepairFallbackInput => ({
  installed: INSTALLED,
  bees: BEES,
  missingBees: [BEES[7]!],
  missingDeps: [],
  critical: CRITICAL,
  zones: ['friend.example', 'hypercomb.com'],
  head: async () => head,
  ...over,
})

describe('stillBoots — can the installed package run without what is missing', () => {
  it('yes when only a few non-critical bees are missing', () => {
    expect(stillBoots(BEES, [BEES[6]!, BEES[7]!], [], CRITICAL)).toBe(true)
  })
  it('no for any missing dependency — an import-map hole can take every bee down', () => {
    expect(stillBoots(BEES, [], [s('d')], CRITICAL)).toBe(false)
  })
  it('no when a render-critical bee is missing, or none are learned for this package', () => {
    expect(stillBoots(BEES, [BEES[0]!], [], CRITICAL)).toBe(false)
    expect(stillBoots(BEES, [BEES[7]!], [], null)).toBe(false)
  })
  it('no when more than a quarter of the bees are missing', () => {
    expect(stillBoots(BEES, BEES.slice(5), [], CRITICAL)).toBe(false)
  })
})

describe('repairFallback — offer the update, or wipe as before', () => {
  it('offers the moved head from a host the repair asked', async () => {
    expect(await repairFallback(input())).toEqual({ kind: 'offer', packageSig: HEAD, source: 'channel', zone: 'hypercomb.com' })
  })

  it('a package door offers its own root', async () => {
    const got = await repairFallback(input({ zones: ['try-x.hypercomb.com'] }, { packageSig: HEAD, zone: 'try-x.hypercomb.com', source: 'door' }))
    expect(got).toMatchObject({ kind: 'offer', source: 'door', packageSig: HEAD })
  })

  it('wipes when the head is the installed package — the misses are real holes', async () => {
    expect((await repairFallback(input({}, { packageSig: INSTALLED, zone: 'hypercomb.com', source: 'channel' }))).kind).toBe('wipe')
  })

  it('wipes when no head can be read, or reading it throws', async () => {
    expect((await repairFallback(input({}, null))).kind).toBe('wipe')
    expect((await repairFallback(input({ head: async () => { throw new Error('offline') } }))).kind).toBe('wipe')
  })

  it('wipes when the head was read from a host the repair did not ask', async () => {
    expect((await repairFallback(input({ zones: ['friend.example'] }))).kind).toBe('wipe')
  })

  it('wipes when the installed package cannot boot, without asking for the head', async () => {
    let asked = false
    const got = await repairFallback(input({ missingDeps: [s('d')], head: async () => { asked = true; return null } }))
    expect(got.kind).toBe('wipe')
    expect(asked).toBe(false)
  })

  it('wipes when nothing is installed', async () => {
    expect((await repairFallback(input({ installed: null }))).kind).toBe('wipe')
  })
})
