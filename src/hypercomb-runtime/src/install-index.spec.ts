// install-index.spec.ts — the facts a visitor used to unpack a package for,
// derived once from the same bytes, read back only for the package they
// describe.

import { describe, expect, it } from 'vitest'
import { deriveInstallIndex, parseInstallIndex } from './install-index'

const PKG = 'a'.repeat(64)
const ATOM = 'b'.repeat(64)
const BUNDLE = 'c'.repeat(64)
const BEE = 'd'.repeat(64)

const files = new Map<string, string>([
  [ATOM, '// @hypercomb/essentials/presentation/tile-math\n// lazy\nimport { Drone } from "@hypercomb/core"\nexport const a = 1\n'],
  [BUNDLE, '// @hypercomb/essentials/sharing\nexport class LinkService {}\n'],
  [BEE, 'import { EffectBus, Drone } from "@hypercomb/core"\nimport { a } from "@hypercomb/essentials/presentation/tile-math"\nclass X { deps = { link: "@diamondcoreprocessor.com/LinkService" } }\n'],
])
const read = async (sig: string): Promise<Uint8Array | null> => {
  const text = files.get(sig)
  return text === undefined ? null : new TextEncoder().encode(text)
}

describe('install index', () => {
  it('derives aliases, atoms, bee claims and core names from the bytes', async () => {
    const index = await deriveInstallIndex(PKG, { bees: [BEE], dependencies: [ATOM, BUNDLE] }, read, 'e'.repeat(64))
    expect(index.aliases).toEqual({ [ATOM]: '@hypercomb/essentials/presentation/tile-math', [BUNDLE]: '@hypercomb/essentials/sharing' })
    expect(index.lazy).toEqual([ATOM])
    expect(index.beeDeps[BEE]).toEqual([ATOM, BUNDLE].sort())
    expect(index.coreImports).toEqual(['Drone', 'EffectBus'])
    expect(index.layersPack).toBe('e'.repeat(64))
  })

  it('reads back only for the package it describes', async () => {
    const index = await deriveInstallIndex(PKG, { bees: [BEE], dependencies: [ATOM, BUNDLE] }, read)
    const text = JSON.stringify(index)
    expect(parseInstallIndex(text, PKG)?.aliases[ATOM]).toBe('@hypercomb/essentials/presentation/tile-math')
    expect(parseInstallIndex(text, 'f'.repeat(64))).toBeNull()
    expect(parseInstallIndex('not json', PKG)).toBeNull()
    expect(parseInstallIndex(JSON.stringify({ package: PKG }), PKG)).toBeNull()
  })
})
