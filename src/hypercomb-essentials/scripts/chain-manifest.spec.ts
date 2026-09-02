// Contract for manifest version chaining (chain-manifest.ts) — the semantics
// deploy-azure.ps1 Phase 1 established, now shared by every deploy target.

import { describe, expect, it } from 'vitest'
import { chainManifest, chainScore, deployStamp, maxGeneration, orderedPackageSigs, type ContentManifest } from './chain-manifest.js'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)
const SIG_C = 'c'.repeat(64)
const NOW = new Date(2026, 7, 6, 12, 30, 45) // months are 0-based → Aug 6

const local = (sig: string, extra: Record<string, unknown> = {}): ContentManifest => ({
  packages: { [sig]: { layers: [SIG_C], bees: [], label: 'development', previous: null, ...extra } },
})

describe('chainManifest', () => {
  it('mints v1 against a fresh remote (no manifest at the target yet)', () => {
    const { manifest, generation, minted } = chainManifest(local(SIG_A), null, NOW)
    const head = manifest.packages[SIG_A]
    expect(minted).toBe(true)
    expect(generation).toBe(1)
    expect(head.generation).toBe(1)
    expect(head.previous).toBeNull()
    expect(head.at).toBe(deployStamp(NOW))
    expect(head.label).toBe('development')
  })

  it('chains a changed build as the next generation, head first, chain preserved', () => {
    const remote: ContentManifest = {
      packages: {
        [SIG_B]: { label: 'development', at: '2026-08-01T10:00:00', previous: null, generation: 1 },
      },
    }
    const { manifest, generation, minted } = chainManifest(local(SIG_A), remote, NOW)
    expect(minted).toBe(true)
    expect(generation).toBe(2)
    const head = manifest.packages[SIG_A]
    expect(head.previous).toBe(SIG_B)
    expect(head.at).toBe(deployStamp(NOW))
    // head is the FIRST key — the runtime loader reads the first entry as current
    expect(Object.keys(manifest.packages)).toEqual([SIG_A, SIG_B])
    // the superseded entry rides through untouched
    expect(manifest.packages[SIG_B].generation).toBe(1)
  })

  it('keeps the existing version on an identical re-deploy (never re-chains)', () => {
    const remote: ContentManifest = {
      packages: {
        [SIG_A]: { label: 'main', at: '2026-08-01T10:00:00', previous: SIG_B, generation: 4 },
        [SIG_B]: { label: 'main', at: '2026-07-01T10:00:00', previous: null, generation: 3 },
      },
    }
    const { manifest, generation, minted } = chainManifest(local(SIG_A), remote, NOW)
    expect(minted).toBe(false)
    expect(generation).toBe(4)
    const head = manifest.packages[SIG_A]
    expect(head.label).toBe('main')
    expect(head.at).toBe('2026-08-01T10:00:00')
    expect(head.previous).toBe(SIG_B)
    // local sig arrays win — the fresh build's arrays are the proven ones
    expect(head.layers).toEqual([SIG_C])
  })

  it('mints in place when the remote holds the same sig unminted (pre-chaining deploy)', () => {
    const remote: ContentManifest = {
      packages: { [SIG_A]: { label: 'development', previous: null } },
    }
    const { manifest, generation, minted } = chainManifest(local(SIG_A), remote, NOW)
    expect(minted).toBe(true)
    expect(generation).toBe(1)
    expect(manifest.packages[SIG_A].at).toBe(deployStamp(NOW))
  })

  it('continues numbering past legacy entries that carry no generation', () => {
    const remote: ContentManifest = {
      packages: {
        [SIG_B]: { label: 'old', at: '2026-06-01T10:00:00', previous: null },
        [SIG_C]: { label: 'older', at: '2026-05-01T10:00:00', previous: null },
      },
    }
    const { manifest, generation } = chainManifest(local(SIG_A), remote, NOW)
    // two legacy entries → the chain is 2 long → new head is v3
    expect(generation).toBe(3)
    // predecessor falls back to highest `at` when no generations exist
    expect(manifest.packages[SIG_A].previous).toBe(SIG_B)
    expect(Object.keys(manifest.packages)).toEqual([SIG_A, SIG_B, SIG_C])
  })

  it('predecessor is the highest generation, not the newest timestamp', () => {
    const remote: ContentManifest = {
      packages: {
        [SIG_B]: { at: '2026-08-05T10:00:00', generation: 1 },
        [SIG_C]: { at: '2026-08-01T10:00:00', generation: 2 },
      },
    }
    const { manifest } = chainManifest(local(SIG_A), remote, NOW)
    expect(manifest.packages[SIG_A].previous).toBe(SIG_C)
    expect(manifest.packages[SIG_A].generation).toBe(3)
  })

  it('defaults a missing label to genesis when minting', () => {
    const bare: ContentManifest = { packages: { [SIG_A]: { previous: null } } }
    const { manifest } = chainManifest(bare, null, NOW)
    expect(manifest.packages[SIG_A].label).toBe('genesis')
  })

  it('passes an empty local manifest through untouched', () => {
    const empty: ContentManifest = { packages: {} }
    const { manifest, generation, minted } = chainManifest(empty, null, NOW)
    expect(manifest).toBe(empty)
    expect(generation).toBe(0)
    expect(minted).toBe(false)
  })
})

describe('chainScore / maxGeneration', () => {
  it('ranks the deepest chain highest for authority selection', () => {
    const deep: ContentManifest = { packages: { [SIG_A]: { generation: 5 }, [SIG_B]: { generation: 4 } } }
    const shallow: ContentManifest = { packages: { [SIG_C]: { generation: 1 } } }
    expect(maxGeneration(deep)).toBe(5)
    expect(chainScore(deep)).toBeGreaterThan(chainScore(shallow))
    // generation dominates entry count — a 12-entry legacy pile never outranks v10
    const legacyPile: ContentManifest = {
      packages: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i).repeat(64).slice(0, 64), {}])),
    }
    const v10: ContentManifest = { packages: { [SIG_A]: { generation: 10 } } }
    expect(chainScore(v10)).toBeGreaterThan(chainScore(legacyPile))
    expect(chainScore(null)).toBe(0)
  })
})

// ── ship order ──────────────────────────────────────────────────────────────
// The `host:packages` pool is append-only and its head is found by bisecting
// on "is index i present". Both promises rest on this order being a stable
// PREFIX: index i must name the same package on every future ship.
describe('orderedPackageSigs', () => {

  it('is oldest first — the order a host appended them', () => {
    expect(orderedPackageSigs({
      packages: {
        [SIG_C]: { generation: 3 },
        [SIG_A]: { generation: 1 },
        [SIG_B]: { generation: 2 },
      },
    })).toEqual([SIG_A, SIG_B, SIG_C])
  })

  it('keeps the existing prefix when a ship appends', () => {
    const before = orderedPackageSigs({ packages: { [SIG_A]: { generation: 1 }, [SIG_B]: { generation: 2 } } })
    const after = orderedPackageSigs({
      packages: { [SIG_A]: { generation: 1 }, [SIG_B]: { generation: 2 }, [SIG_C]: { generation: 3 } },
    })

    expect(after.slice(0, before.length)).toEqual(before)
  })

  it('breaks ties on `at` for entries minted before the counter existed', () => {
    expect(orderedPackageSigs({
      packages: { [SIG_B]: { at: '2026-05-01T00:00:00' }, [SIG_A]: { at: '2026-01-01T00:00:00' } },
    })).toEqual([SIG_A, SIG_B])
  })

  it('ignores keys that are not signatures', () => {
    expect(orderedPackageSigs({ packages: { 'not-a-sig': {}, [SIG_A]: {} } } as ContentManifest)).toEqual([SIG_A])
  })

  it('renders an empty chain as an empty list', () => {
    expect(orderedPackageSigs({ packages: {} })).toEqual([])
  })
})
