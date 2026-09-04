// substrate/substrate-registry.spec.ts
//
// The substrate registry is the current DOCUMENT of its own pool — never a
// member named `registry` inside another pool. SubstrateService is 2,300 lines
// of live OPFS and image work, so this is a mechanical guard on the two
// methods that own the record.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { poolKindOfMeaning } from '@hypercomb/core'

const src = readFileSync(join(process.cwd(), 'hypercomb-essentials', 'src', 'substrate', 'substrate.service.ts'), 'utf8')
const body = (name: string): string => {
  const start = src.indexOf(`async ${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  return src.slice(start, src.indexOf('\n  }\n', start))
}

describe('the substrate registry record', () => {
  it('lives in a DOCUMENT pool of its own, seeded as such', () => {
    expect(src.includes("const REGISTRY_MEANING = 'substrate:registry'")).toBe(true)
    expect(poolKindOfMeaning('substrate:registry')?.kind).toBe('document')
  })

  it('is written only as that document — the `registry` member is never written again', () => {
    const save = body('#saveRegistry')
    expect(save.includes('store.putPoolDoc(pool, bytes)')).toBe(true)
    expect(save.includes('#writePoolRecord(store, REGISTRY_RECORD')).toBe(false)
  })

  it('is read from the document first, and the old member only as a fallback', () => {
    const load = body('#loadRegistry')
    const doc = load.indexOf('store.getPoolDoc')
    const legacy = load.indexOf('#readPoolRecord(store, REGISTRY_RECORD)')
    expect(doc).toBeGreaterThan(-1)
    expect(legacy).toBeGreaterThan(doc)
  })
})
