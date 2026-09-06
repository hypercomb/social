// sharing/adopt-descendants.spec.ts — the walk steps THROUGH an envelope.

import { describe, expect, it } from 'vitest'
import { mintMetaEnvelope } from '@hypercomb/core'
import { adoptDescendantsOf } from './adopt-descendants.js'

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64)

describe('adoptDescendantsOf', () => {
  it('a child slot of plain signatures is walked as layers', () => {
    expect(adoptDescendantsOf({ name: 'x', children: [A, B] })).toEqual({ layers: [A, B], resources: [] })
  })

  it('cells win over layers win over children — the first slot that holds anything', () => {
    expect(adoptDescendantsOf({ cells: [A], layers: [B], children: [C] }).layers).toEqual([A])
    expect(adoptDescendantsOf({ layers: [B], children: [C] }).layers).toEqual([B])
  })

  it('a LAYER envelope is stepped through to the layer it names — the bug that left every child unresolved', () => {
    const envelope = mintMetaEnvelope({ layer: A, relation: 'children', slot: 3 }) as unknown as Record<string, unknown>
    expect(adoptDescendantsOf(envelope)).toEqual({ layers: [A], resources: [] })
  })

  it('a RESOURCE envelope is a leaf for the resource phase, never walked as a layer', () => {
    const envelope = mintMetaEnvelope({ resource: B, relation: 'notes', slot: 0 }) as unknown as Record<string, unknown>
    expect(adoptDescendantsOf(envelope)).toEqual({ layers: [], resources: [B] })
  })

  it('an envelope naming something that is not a signature goes nowhere', () => {
    expect(adoptDescendantsOf({ meta: 1, layer: 'not-a-sig', relation: 'children' })).toEqual({ layers: [], resources: [] })
  })
})
