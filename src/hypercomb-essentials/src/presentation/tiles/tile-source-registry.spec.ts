// tile-source-registry.spec.ts — what the union keeps, and what it collapses.
//
// The registry is where a same-named tile from two participants used to
// die: keyed by (kind, name), the second publisher lost the race and was
// dropped before the renderer could stack them. These pin the identity
// rule so it can't quietly regress back.

import { describe, it, expect, beforeEach } from 'vitest'

;(globalThis as any).window = { ioc: { register: () => {} } }

const { TileSourceRegistry } = await import('./tile-source-registry.js')
import type { TileEntry } from './tile-source.types.js'

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)
const LOC = { segments: ['notes'], dir: null }

const peer = (name: string, pubkey: string, peerIndex?: number): TileEntry =>
  ({ name, kind: 'peer', source: { peerPubkey: pubkey, ...(peerIndex !== undefined ? { peerIndex } : {}) } })

const opfs = (name: string): TileEntry => ({ name, kind: 'opfs', source: {} })

describe('TileSourceRegistry union', () => {

  let registry: InstanceType<typeof TileSourceRegistry>

  beforeEach(() => { registry = new TileSourceRegistry() })

  it('keeps one entry per publisher for a name several peers hold', async () => {
    registry.register(async () => [peer('alpha', ALICE, 3), peer('alpha', BOB, 7)])
    const out = await registry.resolve(LOC)
    expect(out.map(e => e.source.peerPubkey)).toEqual([ALICE, BOB])
    expect(out.map(e => e.source.peerIndex)).toEqual([3, 7])
  })

  it('still collapses one publisher republishing a name', async () => {
    registry.register(async () => [peer('alpha', BOB, 7), peer('alpha', BOB, 9)])
    const out = await registry.resolve(LOC)
    expect(out).toHaveLength(1)
    expect(out[0]?.source.peerIndex).toBe(7)
  })

  it('collapses non-peer kinds by name, as before', async () => {
    registry.register(async () => [opfs('alpha'), opfs('alpha')])
    expect(await registry.resolve(LOC)).toHaveLength(1)
  })

  it('keeps the same name across different kinds', async () => {
    registry.register(async () => [opfs('alpha'), peer('alpha', ALICE)])
    const out = await registry.resolve(LOC)
    expect(out.map(e => e.kind)).toEqual(['opfs', 'peer'])
  })

  it('reports a name once however many publishers hold it', async () => {
    registry.register(async () => [peer('alpha', ALICE), peer('alpha', BOB), peer('beta', BOB)])
    expect([...await registry.resolveNames(LOC)]).toEqual(['alpha', 'beta'])
  })

  it('survives a source that throws', async () => {
    registry.register(async () => { throw new Error('source down') })
    registry.register(async () => [peer('alpha', ALICE)])
    expect(await registry.resolve(LOC)).toHaveLength(1)
  })
})
