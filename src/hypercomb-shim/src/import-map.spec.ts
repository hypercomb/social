// import-map.spec.ts — THE BAG, REMEMBERED BY ITS NAME. A dependency bag's
// directory is named by the signature of its entries, so its parsed entries
// are kept under that name: the next boot that finds the same bag reads none
// of its files, and a new bag (a new name) is read afresh.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@hypercomb/runtime/store', () => ({
  Store: { DEPENDENCIES_MEANING: 'dependencies', poolSignature: async () => 'd'.repeat(64) },
}))

import { resolveImportMap } from './import-map'

const sig = (c: string): string => c.repeat(64)
let bagReads = 0

const file = (name: string, text: string) => ({
  kind: 'file' as const, name,
  getFile: async () => { bagReads++; return { text: async () => text } as unknown as File },
})

const dir = (name: string, children: Array<{ kind: 'file' | 'directory'; name: string }>) => ({
  kind: 'directory' as const, name,
  async *entries() { for (const child of children) yield [child.name, child] as const },
  getFileHandle: async (n: string) => {
    const hit = children.find(child => child.name === n && child.kind === 'file')
    if (!hit) throw new Error('absent')
    return hit
  },
})

const world = (bagName: string) => {
  const leaves = [['@scope/a', sig('a')], ['@scope/b', sig('b')]]
  const bag = dir(bagName, leaves.map(([alias, s], i) => file(String(i).padStart(8, '0'), `${alias}\n${s}`)))
  const flat = leaves.map(([, s]) => ({ kind: 'file' as const, name: `${s}.js` }))
  const store = { initialize: async () => {}, opfsAvailable: true, dependencies: dir('pool', [bag, ...flat]), legacyDependencies: undefined }
  ;(window as any).ioc = { get: () => store }
}

describe('resolveImportMap', () => {
  // A page the worker controls: its map points at /opfs/ (an uncontrolled
  // page mints blob URLs instead — uncontrolled-page.spec.ts).
  beforeEach(() => {
    localStorage.clear(); bagReads = 0
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: {} } })
  })

  it('reads a bag once, then maps it from its name alone', async () => {
    world(sig('1'))
    const first = await resolveImportMap()
    expect(first['@scope/a']).toBe(`/opfs/${sig('d')}/${sig('a')}`)
    expect(bagReads).toBe(2)

    bagReads = 0
    const second = await resolveImportMap()
    expect(second).toEqual(first)
    expect(bagReads).toBe(0)
  })

  it('reads a new bag afresh and keeps only that one', async () => {
    world(sig('1'))
    await resolveImportMap()
    world(sig('2'))
    bagReads = 0
    await resolveImportMap()
    expect(bagReads).toBe(2)
    expect(Object.keys(localStorage).filter(k => k.startsWith('hc:bag:'))).toEqual([`hc:bag:${sig('2')}`])
  })
})
