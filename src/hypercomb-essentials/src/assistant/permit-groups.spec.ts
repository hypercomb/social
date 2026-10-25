// assistant/permit-groups.spec.ts
//
// Permission groups (documentation/permission-groups.md): what runs on arrival
// is said per actor. This proves the rule — facts pick groups, every picked
// group must run the kind, nothing widens by being in two groups or by being
// dropped — and the document's life: seeded from the old device keys, never
// writing them, closed while the pool is read, kept across a restart, and an
// older build keeping what it does not know.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { DocumentStoreLike } from '../preferences/participant-document.js'

const g = globalThis as { window?: { ioc?: unknown } }
g.window ??= {}
g.window.ioc ??= { register: () => {}, get: () => undefined, whenReady: () => {} }
const {
  PermitGroupsStore, PERMIT_KINDS, PERMIT_MODES, decide, parsePermit, groupNameProblem, EVERYONE, HELD,
} = await import('./permit-groups.js')
const { EXECUTION_KINDS, EXECUTION_MODES } = await import('./execution-queue.js')

const settle = async (): Promise<void> => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0)) }
const bytes = (v: unknown): ArrayBuffer => new TextEncoder().encode(JSON.stringify(v)).buffer as ArrayBuffer
const decodeDoc = (b: ArrayBuffer): unknown => JSON.parse(new TextDecoder().decode(b))

/** A store fake: pools exist once written; one document per pool. */
const fakeStore = (seed?: unknown) => {
  const docs = new Map<string, ArrayBuffer>(seed === undefined ? [] : [['permit:groups', bytes(seed)]])
  const handle = (m: string) => ({ name: m } as unknown as FileSystemDirectoryHandle)
  const resources: Blob[] = []
  const store: DocumentStoreLike & { docs: Map<string, ArrayBuffer>; resources: Blob[]; putResource: (b: Blob) => Promise<string> } = {
    docs, resources,
    initialize: async () => {},
    openPool: async m => docs.has(m) ? handle(m) : null,
    getPool: async m => handle(m),
    getPoolDoc: async pool => docs.get(pool!.name) ?? null,
    putPoolDoc: async (pool, b) => { docs.set(pool.name, b); return 'f'.repeat(64) },
    putResource: async (blob: Blob) => { resources.push(blob); return 'e'.repeat(64) },
  }
  return store
}

/** A Store that arrives when the spec says so. */
const arrival = () => {
  let fire: ((s: DocumentStoreLike) => void) | null = null
  return { whenStore: (ready: (s: DocumentStoreLike) => void) => { fire = ready }, arrive: (s: DocumentStoreLike) => fire?.(s) }
}

const detached = () => new PermitGroupsStore({ whenStore: () => {} })
const hermes = { convoId: 'c1', providerId: 'hermes-local', model: 'hermes-4' }

beforeEach(() => localStorage.clear())

describe('the rule', () => {
  it('keeps the queue\'s kinds and modes', () => {
    expect(PERMIT_KINDS).toEqual(EXECUTION_KINDS)
    expect(PERMIT_MODES).toEqual(EXECUTION_MODES)
  })

  it('judges by everyone when no group names the row', () => {
    const permit = detached()
    for (const kind of PERMIT_KINDS) expect(permit.decide(kind, hermes)).toEqual({ run: true, groups: [EVERYONE] })
  })

  it('a provider in a group of its own is judged by that group alone', async () => {
    const permit = detached()
    expect((await permit.addMember('hermes', 'provider', 'hermes-local')).ok).toBe(true)
    expect(permit.decide('additive', hermes)).toEqual({ run: false, groups: ['hermes'] })
    permit.setPolicy('hermes', 'auto', ['read'])
    expect(permit.decide('read', hermes).run).toBe(true)
    expect(permit.decide('additive', hermes).run).toBe(false)
    // Anyone else still runs by everyone.
    expect(permit.decide('additive', { ...hermes, providerId: 'openrouter', model: 'x' }).groups).toEqual([EVERYONE])
  })

  it('two groups never add up to more than either', async () => {
    const permit = detached()
    await permit.addMember('wide', 'conversation', 'c1')
    permit.setPolicy('wide', 'everything')
    await permit.addMember('narrow', 'provider', 'hermes-local')
    permit.setPolicy('narrow', 'auto', ['read'])
    expect(permit.decide('read', hermes)).toEqual({ run: true, groups: ['wide', 'narrow'] })
    expect(permit.decide('editing', hermes).run).toBe(false)
  })

  it('matches without regard to case, and only the facet named', async () => {
    const permit = detached()
    await permit.addMember('hermes', 'model', 'Hermes-4')
    expect(permit.decide('read', { model: 'hermes-4' }).groups).toEqual(['hermes'])
    expect(permit.decide('read', { providerId: 'hermes-4' }).groups).toEqual([EVERYONE])
  })

  it('is pure: the same document and row give the same verdict', () => {
    const doc = parsePermit({ kind: 'permit@1', groups: [{ name: 'g', mode: 'auto', auto: ['read'], members: [{ actor: 'a'.repeat(64), facet: 'provider', label: 'p' }] }] })!
    expect(decide(doc, 'read', { providerId: 'p' })).toEqual(decide(doc, 'read', { providerId: 'p' }))
    expect(decide(doc, 'read', { providerId: 'p' })).toEqual({ run: true, groups: ['g'] })
  })
})

describe('edits', () => {
  it('a new group starts manual', async () => {
    const permit = detached()
    const made = await permit.addMember('quiet', 'provider', 'p')
    expect(made.ok && made.group).toMatchObject({ name: 'quiet', mode: 'manual', auto: [] })
  })

  it('an actor sits in one group', async () => {
    const permit = detached()
    await permit.addMember('a', 'provider', 'p')
    await permit.addMember('b', 'provider', 'p')
    expect(permit.group('a')?.members).toEqual([])
    expect(permit.groupOf('provider', 'p')?.name).toBe('b')
  })

  it('a dropped actor is held, runs nothing by itself, and is released only from held', async () => {
    const permit = detached()
    await permit.addMember('hermes', 'provider', 'hermes-local')
    permit.setPolicy('hermes', 'everything')
    expect(permit.drop('hermes', 'hermes-local').ok).toBe(true)
    expect(permit.groupOf('provider', 'hermes-local')?.name).toBe(HELD)
    for (const kind of PERMIT_KINDS) expect(permit.decide(kind, hermes).run).toBe(false)
    // Adding it elsewhere does not release it.
    const again = await permit.addMember('other', 'provider', 'hermes-local')
    expect(again.ok).toBe(false)
    expect(permit.drop(HELD, 'hermes-local').ok).toBe(true)
    expect(permit.decide('read', hermes)).toEqual({ run: true, groups: [EVERYONE] })
  })

  it('dissolving holds the members; the built-ins stay', async () => {
    const permit = detached()
    await permit.addMember('hermes', 'provider', 'hermes-local')
    expect(permit.dissolve('hermes').ok).toBe(true)
    expect(permit.group('hermes')).toBeUndefined()
    expect(permit.groupOf('provider', 'hermes-local')?.name).toBe(HELD)
    expect(permit.dissolve(EVERYONE).ok).toBe(false)
    expect(permit.dissolve(HELD).ok).toBe(false)
  })

  it('refuses what would widen or confuse', async () => {
    const permit = detached()
    expect((await permit.addMember(EVERYONE, 'provider', 'p')).ok).toBe(false)
    expect(permit.setPolicy(HELD, 'everything').ok).toBe(false)
    expect(groupNameProblem('trusted')).not.toBeNull()
    expect(groupNameProblem('read')).not.toBeNull()
    expect(groupNameProblem('Hermes')).not.toBeNull()
    expect(groupNameProblem('hermes')).toBeNull()
  })

  it('mints the actor atom silently by signature', async () => {
    const r = arrival()
    const store = fakeStore()
    const permit = new PermitGroupsStore({ whenStore: r.whenStore })
    r.arrive(store)
    await settle()
    const made = await permit.addMember('hermes', 'provider', 'hermes-local')
    const atom = JSON.stringify({ actor: 1, provider: 'hermes-local' })
    expect(made.ok && made.group.members[0]?.actor).toBe(createHash('sha256').update(atom).digest('hex'))
    expect(store.resources).toHaveLength(1)
    expect(store.resources[0]).toMatchObject({ size: atom.length, type: 'application/json' })
  })
})

describe('the document', () => {
  it('seeds everyone from the old device keys and never writes them', async () => {
    localStorage.setItem('hc:execution:mode', 'auto')
    localStorage.setItem('hc:execution:auto', JSON.stringify(['read', 'additive']))
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const permit = detached()
    expect(permit.group(EVERYONE)).toMatchObject({ mode: 'auto', auto: ['read', 'additive'] })
    permit.setPolicy(EVERYONE, 'manual')
    await permit.addMember('hermes', 'provider', 'p')
    expect(write).not.toHaveBeenCalled()
    write.mockRestore()
    expect(localStorage.getItem('hc:execution:mode')).toBe('auto')
  })

  it('fails closed while the pool is read, then decides', async () => {
    const r = arrival()
    const permit = new PermitGroupsStore({ whenStore: r.whenStore })
    expect(permit.decide('read', hermes).run).toBe(true)
    r.arrive(fakeStore({ kind: 'permit@1', groups: [{ name: 'hermes', mode: 'manual', auto: [], members: [{ actor: 'a'.repeat(64), facet: 'provider', label: 'hermes-local' }] }] }))
    expect(permit.reading).toBe(true)
    expect(permit.decide('read', hermes)).toMatchObject({ run: false, waiting: true })
    await settle()
    expect(permit.reading).toBe(false)
    expect(permit.decide('read', hermes)).toEqual({ run: false, groups: ['hermes'] })
  })

  it('is kept across a restart', async () => {
    const store = fakeStore()
    const first = arrival()
    const permit = new PermitGroupsStore({ whenStore: first.whenStore })
    first.arrive(store)
    await settle()
    await permit.addMember('hermes', 'provider', 'hermes-local')
    permit.setPolicy('hermes', 'auto', ['read'])
    await settle()
    const second = arrival()
    const restarted = new PermitGroupsStore({ whenStore: second.whenStore })
    second.arrive(store)
    await settle()
    expect(restarted.group('hermes')).toMatchObject({ mode: 'auto', auto: ['read'] })
    expect(restarted.decide('read', hermes).run).toBe(true)
  })

  it('an older build keeps what it does not know, and never widens held', () => {
    const doc = parsePermit({
      kind: 'permit@1',
      groups: [
        { name: 'trusted', mode: 'everything', auto: [], members: [{ actor: 'b'.repeat(64), facet: 'conversation', label: 'c9' }] },
        { name: 'org', mode: 'auto', auto: ['read'], members: [{ actor: 'c'.repeat(64), facet: 'code', label: 'managers' }] },
        { name: HELD, mode: 'everything', auto: ['read'], members: [] },
        { name: EVERYONE, mode: 'auto', auto: ['read'], members: [{ actor: 'd'.repeat(64), facet: 'provider', label: 'x' }] },
      ],
    })!
    expect(doc.groups.map(group => group.name)).toEqual(['trusted', 'org', HELD, EVERYONE])
    expect(doc.groups.find(group => group.name === 'org')?.members[0]?.facet).toBe('code')
    expect(doc.groups.find(group => group.name === HELD)).toMatchObject({ mode: 'manual', auto: [] })
    expect(doc.groups.find(group => group.name === EVERYONE)?.members).toEqual([])
    // A facet this build does not match never picks a group.
    expect(decide(doc, 'read', { convoId: 'managers' }).groups).toEqual([EVERYONE])
  })

  it('refuses bytes that are not a permit document', () => {
    expect(parsePermit(null)).toBeNull()
    expect(parsePermit({ kind: 'other', groups: [] })).toBeNull()
    expect(parsePermit({ kind: 'permit@1' })).toBeNull()
    expect(parsePermit({ kind: 'permit@1', groups: [] })!.groups.map(group => group.name)).toEqual([EVERYONE, HELD])
  })

  it('writes the document whole, kind and groups', async () => {
    const store = fakeStore()
    const r = arrival()
    const permit = new PermitGroupsStore({ whenStore: r.whenStore })
    r.arrive(store)
    await settle()
    permit.setPolicy(EVERYONE, 'manual')
    await settle()
    const written = decodeDoc(store.docs.get('permit:groups')!) as { kind: string; groups: { name: string; mode: string }[] }
    expect(written.kind).toBe('permit@1')
    expect(written.groups.find(group => group.name === EVERYONE)?.mode).toBe('manual')
  })
})
