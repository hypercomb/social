// An atom is never imported by the DependencyLoader (atomic-modules-plan.md,
// step 4). It registers nothing, so it has no reason to load at boot, and a
// blob import would be a second instance beside the one every importer
// reaches through the import map.

import { beforeAll, describe, expect, it } from 'vitest'

const services = new Map<string, unknown>()
const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

const ATOM = 'a'.repeat(64)
const BUNDLE = 'b'.repeat(64)
const BYTES: Record<string, Uint8Array> = {
  [ATOM]: encode('// @hypercomb/essentials/games/juice\n// lazy — an atom: it loads through the import map when something imports it\nexport const x = 1\n'),
  [BUNDLE]: encode('// @hypercomb/essentials/commands\nexport const y = 2\n'),
}

let loader: {
  load(): Promise<void>
  loadedSignatures: readonly string[]
  failedSignatures: readonly string[]
}
let isLazyDependency: (bytes: Uint8Array) => boolean

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>
  g['register'] = (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) }
  g['get'] = (key: string) => services.get(key)
  services.set('@hypercomb.social/Store', {
    opfsAvailable: true,
    getDependencyBytes: async (sig: string) => BYTES[sig] ?? null,
  })
  g['__hypercombAliasMap'] = new Map([
    ['@hypercomb/essentials/games/juice', ATOM],
    ['@hypercomb/essentials/commands', BUNDLE],
  ])
  const mod = await import('./dependency-loader')
  isLazyDependency = mod.isLazyDependency
  loader = services.get('@hypercomb.social/DependencyLoader') as typeof loader
})

describe('the dependency loader and atoms', () => {
  it('reads the marker from line 2 only', () => {
    expect(isLazyDependency(BYTES[ATOM])).toBe(true)
    expect(isLazyDependency(BYTES[BUNDLE])).toBe(false)
    expect(isLazyDependency(encode('// lazy\n// @x/y\n'))).toBe(false)
  })

  it('never imports an atom, and still attempts every namespace bundle', async () => {
    await loader.load()
    // The bundle was attempted (a blob import cannot run under Node, so it
    // lands in failed — what matters is that it was tried).
    expect([...loader.loadedSignatures, ...loader.failedSignatures]).toContain(BUNDLE)
    // The atom was neither imported nor failed: it was left to the import map.
    expect(loader.loadedSignatures).not.toContain(ATOM)
    expect(loader.failedSignatures).not.toContain(ATOM)
  })
})
