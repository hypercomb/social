// context-groups.spec.ts — the set is content, the group is identity.
//
// THE QUESTION THIS PINS DOWN: what happens when two groups end up holding
// exactly the same tiles? They share a SET SIGNATURE — so the request they
// compose is byte-identical and dedupes — and they remain TWO GROUPS with two
// labels, because a group's identity was never derived from its contents.
//
// It also freezes the difference between the two acts, which look the same on
// screen and are not: starting a new group over the same tiles mints a new
// IDENTITY; adding a tile to a group changes its CONTENT.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = {
  doc: null as ArrayBuffer | null,
  getPool: async () => ({}),
  getPoolDoc: async () => store.doc,
  putPoolDoc: async (_pool: unknown, bytes: ArrayBuffer) => { store.doc = bytes; return 'ok' },
}

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g['get'] = (key: string) => (key === '@hypercomb.social/Store' ? store : undefined)
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => {}, get: () => undefined, whenReady: () => {}, onRegister: () => () => {},
  }
})

const {
  startGroup, addToGroup, removeFromGroup, renameGroup, listGroups, setSignature, groupsHolding,
} = await import('./context-groups.js')

const sig = (n: number): string => String(n).padStart(64, '0')
const tile = (n: number, name: string) => ({ path: '/' + name, name, sig: sig(n) })

describe('a context group', () => {
  beforeEach(() => { store.doc = null })

  it('two groups over the SAME tiles share a set signature and stay two groups', async () => {
    const members = [tile(1, 'sea'), tile(2, 'forest')]
    const first = await startGroup('the coastline', members)
    const second = await startGroup('the walk home', members)

    expect(first!.id).not.toBe(second!.id)
    expect(first!.label).not.toBe(second!.label)
    // …and the payload they compose is byte-identical, which is the point:
    // the same closure dedupes and caches instead of being read twice.
    expect(await setSignature(first!.members)).toBe(await setSignature(second!.members))
    expect((await listGroups()).length).toBe(2)
  })

  it('the set signature ignores the order tiles were added in', async () => {
    const forward = await setSignature([tile(1, 'sea'), tile(2, 'forest')])
    const backward = await setSignature([tile(2, 'forest'), tile(1, 'sea')])
    expect(forward).toBe(backward)
    expect(forward).toMatch(/^[0-9a-f]{64}$/)
  })

  it('a tile listed twice counts once', async () => {
    const once = await setSignature([tile(1, 'sea')])
    const twice = await setSignature([tile(1, 'sea'), tile(1, 'sea')])
    expect(twice).toBe(once)
  })

  it('STARTING a group is a new identity; ADDING is new content on the same one', async () => {
    const group = await startGroup('the coastline', [tile(1, 'sea')])
    const before = await setSignature(group!.members)

    // adding: same id, same label, different set
    const grown = await addToGroup(group!.id, tile(2, 'forest'))
    expect(grown!.id).toBe(group!.id)
    expect(grown!.label).toBe('the coastline')
    expect(await setSignature(grown!.members)).not.toBe(before)

    // starting: same members, brand new identity
    const sibling = await startGroup('somewhere else', grown!.members)
    expect(sibling!.id).not.toBe(grown!.id)
    expect(await setSignature(sibling!.members)).toBe(await setSignature(grown!.members))
  })

  it('a tile can belong to several groups at once and still be its own subject', async () => {
    const a = await startGroup('the coastline', [tile(1, 'sea'), tile(2, 'forest')])
    const b = await startGroup('wet places', [tile(1, 'sea'), tile(3, 'river')])

    const holding = groupsHolding(await listGroups(), '/sea')
    expect(holding.map(g => g.label).sort()).toEqual(['the coastline', 'wet places'])
    // Belonging to two groups says nothing about the tile's own conversation:
    // no group owns a tile, they only name it.
    expect(a!.id).not.toBe(b!.id)
  })

  it('renaming keeps the identity and the set', async () => {
    const group = await startGroup('draft name', [tile(1, 'sea')])
    const renamed = await renameGroup(group!.id, 'the coastline')
    expect(renamed!.id).toBe(group!.id)
    expect(renamed!.label).toBe('the coastline')
    expect(await setSignature(renamed!.members)).toBe(await setSignature(group!.members))
  })

  it('removing the last member leaves the group, with nothing to carry', async () => {
    const group = await startGroup('the coastline', [tile(1, 'sea')])
    const emptied = await removeFromGroup(group!.id, '/sea')
    expect(emptied!.members).toEqual([])
    expect(await setSignature(emptied!.members)).toBe('')
  })
})
