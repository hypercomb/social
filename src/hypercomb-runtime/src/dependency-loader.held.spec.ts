// A held dependency draft is never imported by the DependencyLoader
// (held-dependencies.ts): the pool scan never queues it, and a map that names
// it anyway (stale, or an older shell's) meets the backstop.

import { beforeAll, describe, expect, it } from 'vitest'
import { flagInBrood } from '@hypercomb/core'

const services = new Map<string, unknown>()
const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

const TRUNK = 'd'.repeat(64)
const DRAFT = 'e'.repeat(64)
const BYTES: Record<string, Uint8Array> = {
  [TRUNK]: encode('// @hypercomb/essentials/commands\nexport const v = 1\n'),
  [DRAFT]: encode('// @hypercomb/essentials/commands\nexport const v = 2\n'),
}
const asked: string[] = []
const file = (sig: string) => ({
  kind: 'file',
  getFile: async () => ({ slice: () => ({ arrayBuffer: async () => BYTES[sig].buffer }) }),
})

let loader: {
  load(): Promise<void>
  loadedSignatures: readonly string[]
  failedSignatures: readonly string[]
}

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>
  g['register'] = (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) }
  g['get'] = (key: string) => services.get(key)
  services.set('@hypercomb.social/Store', {
    opfsAvailable: true,
    // The draft is listed first: before the gate, the scan queued both.
    dependencies: { entries: async function* () { yield [`${DRAFT}.js`, file(DRAFT)]; yield [`${TRUNK}.js`, file(TRUNK)] } },
    legacyDependencies: null,
    getDependencyBytes: async (sig: string) => { asked.push(sig); return BYTES[sig] ?? null },
  })
  await flagInBrood(DRAFT, { by: 'scan', reason: 'a draft of a dependency' }, { kind: 'own' })
  await import('./dependency-loader')
  loader = services.get('@hypercomb.social/DependencyLoader') as typeof loader
})

const attempted = (): string[] => [...loader.loadedSignatures, ...loader.failedSignatures]

describe('the dependency loader and held drafts', () => {
  it('a map that names a held draft meets the backstop: never read, never imported', async () => {
    ;(globalThis as Record<string, unknown>)['__hypercombAliasMap'] = new Map([
      ['@hypercomb/essentials/commands', DRAFT],
    ])
    await loader.load()
    expect(attempted()).not.toContain(DRAFT)
    expect(asked).not.toContain(DRAFT)
  })

  it('an empty map from a bag whose every leaf is held stands: no pool scan, nothing imported', async () => {
    // The pool's other file for the namespace is the previous trunk's (or a
    // stale copy): the trunk's bees were never built against it.
    const g = globalThis as Record<string, unknown>
    g['__hypercombAliasMap'] = new Map()
    g['__hypercombHeldAliases'] = new Set(['@hypercomb/essentials/commands'])
    await loader.load()
    expect(attempted()).toEqual([])
    expect(asked).toEqual([])
    delete g['__hypercombHeldAliases']
  })

  it('the pool scan with no map queues the trunk only', async () => {
    delete (globalThis as Record<string, unknown>)['__hypercombAliasMap']
    await loader.load()
    // A blob import cannot run under Node, so the trunk lands in failed —
    // what matters is that it was tried and the draft was not.
    expect(attempted()).toContain(`${TRUNK}.js`)
    expect(attempted().some(sig => sig.startsWith(DRAFT))).toBe(false)
    expect(asked).not.toContain(DRAFT)
  })
})
