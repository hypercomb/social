// community-host-groups.spec.ts — the NAMED GROUPS OF HOSTS the Publish drilldown
// opens as one (jwize 2026-11-04). The answers are pure; the store is stubbed
// with a document pool the way the Store keeps one, so a save, a replace and a
// remove run through the same read-then-write the hosts drone drives.

import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'

// The module reads the Store off `window.ioc` as it is called.
const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  whenReady: () => void 0,
}

const {
  HOST_GROUPS_POOL,
  HOST_GROUP_NAME_MAX,
  hostGroupKey,
  hostGroupName,
  listHostGroups,
  normalizeHostGroup,
  removeHostGroup,
  saveHostGroup,
  withHostGroup,
} = await import('./community-hosts.js')

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('a group is a name and the domains it holds', () => {
  it('keeps the name as one short line, and the same group however it was typed', () => {
    expect(hostGroupName('  Launch    week \n')).toBe('Launch week')
    expect(hostGroupName('x'.repeat(HOST_GROUP_NAME_MAX + 20))).toHaveLength(HOST_GROUP_NAME_MAX)
    expect(hostGroupKey('Launch week')).toBe(hostGroupKey('  launch  WEEK '))
    expect(hostGroupName(undefined)).toBe('')
  })

  it('folds each domain the way a host does, once, in the order given — and refuses what holds nothing', () => {
    expect(normalizeHostGroup('Pair', ['JWIZE.com', 'https://hypercomb.com/', 'jwize.com', 'not a host']))
      .toEqual({ name: 'Pair', zones: ['jwize.com', 'hypercomb.com'] })
    expect(normalizeHostGroup('', ['jwize.com'])).toBeNull()
    expect(normalizeHostGroup('Empty', [])).toBeNull()
    expect(normalizeHostGroup('Typos', ['nope', ''])).toBeNull()
    expect(normalizeHostGroup('Not a list', 'jwize.com')).toBeNull()
  })

  it('saves under a name already held by replacing that group where it stood', () => {
    const a = { name: 'A', zones: ['a.com'] }
    const b = { name: 'B', zones: ['b.com'] }
    const c = { name: 'C', zones: ['c.com'] }
    const next = withHostGroup([a, b, c], 'b', { name: 'b', zones: ['b.com', 'bb.com'] })
    expect(next.map(g => g.name)).toEqual(['A', 'b', 'C'])
    expect(next[1].zones).toEqual(['b.com', 'bb.com'])
    // a new name goes last
    expect(withHostGroup([a], 'D', { name: 'D', zones: ['d.com'] }).map(g => g.name)).toEqual(['A', 'D'])
    // forgetting leaves the rest alone
    expect(withHostGroup([a, b, c], ' c ', null).map(g => g.name)).toEqual(['A', 'B'])
  })
})

describe('the groups are one current document in their own pool', () => {
  // A document pool as the Store keeps one: putPoolDoc replaces the current
  // record, getPoolDoc reads it back.
  let current: ArrayBuffer | null
  let writes: number

  beforeEach(() => {
    current = null
    writes = 0
    const pool = { name: 'pool' } as unknown as FileSystemDirectoryHandle
    services.set('@hypercomb.social/Store', {
      initialize: async () => undefined,
      getPool: async (meaning: string) => (meaning === HOST_GROUPS_POOL ? pool : null),
      putPoolDoc: async (_pool: unknown, bytes: ArrayBuffer) => { current = bytes; writes++; return 'sig' },
      getPoolDoc: async () => current,
    })
  })

  it('lists nothing before anything is saved', async () => {
    expect(await listHostGroups()).toEqual([])
  })

  it('saves, lists in the order made, replaces by name, and removes by name', async () => {
    expect(await saveHostGroup('Cigar sites', ['jwize.com', 'revolucionstyle.com'])).toEqual({ name: 'Cigar sites', zones: ['jwize.com', 'revolucionstyle.com'] })
    await saveHostGroup('Everything', ['hypercomb.com', 'jwize.com', 'revolucionstyle.com'])
    expect((await listHostGroups()).map(g => g.name)).toEqual(['Cigar sites', 'Everything'])

    // the same name, spelled another way, is the same group: replaced in place
    await saveHostGroup('cigar  SITES', ['jwize.com'])
    const after = await listHostGroups()
    expect(after.map(g => g.name)).toEqual(['cigar SITES', 'Everything'])
    expect(after[0].zones).toEqual(['jwize.com'])

    expect(await removeHostGroup('EVERYTHING')).toBe(true)
    expect((await listHostGroups()).map(g => g.name)).toEqual(['cigar SITES'])
    // forgetting what is not there writes nothing
    const written = writes
    expect(await removeHostGroup('nope')).toBe(false)
    expect(writes).toBe(written)
  })

  it('writes nothing for a group that would hold nothing', async () => {
    expect(await saveHostGroup('', ['jwize.com'])).toBeNull()
    expect(await saveHostGroup('Empty', ['not a host'])).toBeNull()
    expect(writes).toBe(0)
  })

  it('reads a damaged record as no groups, and skips an entry that holds nothing', async () => {
    current = new TextEncoder().encode('{not json').buffer as ArrayBuffer
    expect(await listHostGroups()).toEqual([])
    current = new TextEncoder().encode(JSON.stringify({ groups: [
      { name: 'Good', zones: ['jwize.com'] }, { name: '', zones: ['jwize.com'] }, { name: 'Bad', zones: ['nope'] }, { name: 'good', zones: ['hypercomb.com'] },
    ] })).buffer as ArrayBuffer
    expect((await listHostGroups()).map(g => g.name)).toEqual(['Good'])
  })

  it('is declared as a document, beside the hosts it names — never a member of the hosts pool', () => {
    expect(read('../../../hypercomb-core/src/core/pool-registry.ts')).toMatch(/'community:hosts',[\s\S]{0,260}'community:host-groups',/)
    expect(read('../../../hypercomb-core/src/core/pool-kinds.ts')).toMatch(/\['community:host-groups', 'document'\]/)
    expect(HOST_GROUPS_POOL).toBe('community:host-groups')
  })
})
