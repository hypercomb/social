// hive-author.spec.ts — a hive is cut from what ran, checked against its
// package, and minted under the signature of its own bytes.

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { beeClassesOfDocs } from './arrival-plan'
import { cutHive, mintHive, saveHive, validateHive } from './hive-author'
import { parseHive } from './hive'

const sig = (c: string): string => c.repeat(64)

const docs = {
  bees: {
    [sig('a')]: { className: 'SiteViewDrone', deps: { link: '@x.com/LinkService', store: '@hypercomb.social/Store' } },
    [sig('b')]: { className: 'LinkService' },
    [sig('c')]: { className: 'ChatDrone', deps: { link: '@x.com/LinkService' } },
    [sig('d')]: { className: 'GameDrone' },
  },
}
const classes = new Map(beeClassesOfDocs(docs))
const all = new Set([sig('a'), sig('b'), sig('c'), sig('d')])
const base = { name: 'site', package: sig('1'), core: sig('2') }

describe('cutHive', () => {
  it('names the faces: observed classes no other observed class reads', () => {
    const draft = cutHive({ observed: [sig('a'), sig('b'), sig('c')], classes, packageBees: all, ...base })
    expect(draft.arrival).toEqual(['ChatDrone', 'SiteViewDrone'])
    expect(draft.depth).toBe(1)
  })

  it('ignores observed signatures the package does not carry', () => {
    const draft = cutHive({ observed: [sig('a'), sig('f')], classes, packageBees: all, ...base })
    expect(draft.arrival).toEqual(['SiteViewDrone'])
  })

  it('a cut round-trips: it parses as a hive and resolves to what ran', () => {
    const draft = cutHive({ observed: [sig('a'), sig('b')], classes, packageBees: all, ...base })
    expect(parseHive(draft)?.arrival).toEqual(['SiteViewDrone'])
  })
})

describe('validateHive', () => {
  const draft = (extra: Record<string, unknown> = {}) => ({ ...cutHive({ observed: [sig('a')], classes, packageBees: all, ...base }), ...extra })

  it('passes a good hive, noting a need no package class answers', () => {
    const problems = validateHive(draft(), classes, all)
    expect(problems.filter(p => p.severity === 'error')).toEqual([])
    expect(problems).toContainEqual({ severity: 'note', kind: 'unresolved-need', face: 'SiteViewDrone', need: '@hypercomb.social/Store' })
  })

  it('errors on a face the package does not carry', () => {
    expect(validateHive(draft({ arrival: ['SiteViewDrone', 'ArcadeDrone'] }), classes, all))
      .toContainEqual({ severity: 'error', kind: 'missing-face', name: 'ArcadeDrone' })
  })

  it('errors on a hive that resolves to no bee, and on something that is no hive', () => {
    expect(validateHive(draft({ arrival: ['ArcadeDrone'] }), classes, all)).toContainEqual({ severity: 'error', kind: 'empty' })
    expect(validateHive({ arrival: [] }, classes, all)).toEqual([{ severity: 'error', kind: 'not-a-hive' }])
  })
})

describe('mintHive and saveHive', () => {
  const draft = cutHive({ observed: [sig('a'), sig('b')], classes, packageBees: all, ...base })

  it('names the canonical bytes by their signature, whatever the key order', async () => {
    const minted = (await mintHive(draft, classes, all))!
    expect(minted.sig).toBe(createHash('sha256').update(minted.bytes).digest('hex'))
    const shuffled = Object.fromEntries(Object.entries(draft).reverse()) as typeof draft
    expect((await mintHive(shuffled, classes, all))!.sig).toBe(minted.sig)
  })

  it('mints nothing invalid', async () => {
    expect(await mintHive({ ...draft, arrival: ['ArcadeDrone'] }, classes, all)).toBeNull()
  })

  it('saves under its own signature, and refuses a store that names it otherwise', async () => {
    const minted = (await mintHive(draft, classes, all))!
    const kept: string[] = []
    const read = (blob: Blob): Promise<string> => new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(blob)
    })
    const honest = { putResource: async (blob: Blob) => { kept.push(await read(blob)); return minted.sig } }
    expect(await saveHive(honest, minted)).toBe(minted.sig)
    expect(JSON.parse(kept[0]!).arrival).toEqual(['SiteViewDrone'])
    await expect(saveHive({ putResource: async () => sig('9') }, minted)).rejects.toThrow('expected')
  })
})
