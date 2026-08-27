import { describe, it, expect } from 'vitest'
import { isMetaRecord, identityOf, entriesNeedingResolution, mintMetaRecord, type MetaRecord } from './meta-record.js'
import { isBareLayer } from './child-sig-guard.js'

const sigA = 'a'.repeat(64)
const sigB = 'b'.repeat(64)
const metaSig = 'c'.repeat(64)

describe('isMetaRecord — declaration, never shape-sniffing', () => {
  it('accepts a self-declared record', () => {
    expect(isMetaRecord({ meta: 1, layer: sigA })).toBe(true)
  })

  it('rejects a resource that merely looks like one', () => {
    // A resource is allowed to be JSON with any keys it likes. Without the
    // declaration it is content, full stop.
    expect(isMetaRecord({ layer: sigA, agent: sigB })).toBe(false)
  })

  it('rejects a declaration whose target is not a signature', () => {
    expect(isMetaRecord({ meta: 1, layer: 'notes' })).toBe(false)
  })

  it('accepts typed atomic payloads and rejects ambiguous envelopes', () => {
    expect(isMetaRecord({ meta: 1, resource: sigA })).toBe(true)
    expect(isMetaRecord({ meta: 1, layer: sigA, resource: sigB })).toBe(false)
  })

  it('rejects non-objects and arrays', () => {
    expect(isMetaRecord(null)).toBe(false)
    expect(isMetaRecord(sigA)).toBe(false)
    expect(isMetaRecord([{ meta: 1, layer: sigA }])).toBe(false)
  })
})

describe('identityOf — an entry stands for its target', () => {
  it('a bare entry is its own identity', () => {
    expect(identityOf(sigA)).toBe(sigA)
  })

  it('a promoted entry resolves to what it points at', () => {
    const resolved = new Map<string, MetaRecord>([[metaSig, { meta: 1, layer: sigA }]])
    expect(identityOf(metaSig, resolved)).toBe(sigA)
  })

  it('uses the declared atomic payload as identity too', () => {
    const resolved = new Map<string, MetaRecord>([[metaSig, { meta: 1, resource: sigA }]])
    expect(identityOf(metaSig, resolved)).toBe(sigA)
  })

  it('degrades to today’s behaviour when unresolved rather than throwing', () => {
    expect(identityOf(metaSig, new Map())).toBe(metaSig)
  })
})

describe('entriesNeedingResolution — cost is O(changes), not O(size)', () => {
  it('skips entries present on both sides', () => {
    // Shared entries are byte-identical by definition, so they cannot have
    // been promoted between the two snapshots.
    expect(entriesNeedingResolution([sigA, sigB], [sigA, sigB])).toEqual([])
  })

  it('returns only what differs', () => {
    const needed = entriesNeedingResolution([sigA, sigB], [sigA, metaSig])
    expect(new Set(needed)).toEqual(new Set([sigB, metaSig]))
  })
})

describe('invariant 3 — a meta record reads as LIVE, never a husk', () => {
  it('isBareLayer does not mistake a meta for a cold-mint husk', () => {
    // If this ever flips, child-sig-guard's cold-mint preserve reverts
    // promoted entries back to their prior sig and promotion silently
    // stops working.
    expect(isBareLayer(mintMetaRecord({ layer: sigA }))).toBe(false)
    expect(isBareLayer(mintMetaRecord({ layer: sigA, agent: sigB, relation: 'notes' }))).toBe(false)
  })
})

describe('mintMetaRecord — deterministic bytes', () => {
  it('same claims produce the same canonical JSON', () => {
    const one = mintMetaRecord({ layer: sigA, agent: sigB, relation: 'notes', at: 42 })
    const two = mintMetaRecord({ layer: sigA, at: 42, relation: 'notes', agent: sigB })
    expect(JSON.stringify(one)).toBe(JSON.stringify(two))
  })

  it('omits absent optionals rather than writing null', () => {
    expect(JSON.stringify(mintMetaRecord({ layer: sigA }))).toBe(JSON.stringify({ meta: 1, layer: sigA }))
  })

  it('drops an empty recipients list so unaddressed stays byte-identical', () => {
    const addressed = mintMetaRecord({ layer: sigA, recipients: [] })
    expect(addressed.recipients).toBeUndefined()
  })

  it('refuses a target that is not a signature', () => {
    expect(() => mintMetaRecord({ layer: 'notes' })).toThrow()
  })
})
