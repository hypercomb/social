// The meta layer of a code file (bee-meta.ts): what the layer's own docs say a bee is,
// the words a participant gives it instead, and the document that keeps them.

import { describe, expect, it } from 'vitest'
import {
  BEE_META_MEANING, beeDocsOf, beeWords, normalizeMeta, publishedName, readBeeMeta, writeBeeMeta,
  type BeeDoc, type MetaStore,
} from './bee-meta.js'

const sig = (n: number): string => String(n).repeat(64).slice(0, 64)

describe('what a layer says its bees are', () => {
  const layer = JSON.stringify({
    name: 'assistant',
    cells: [],
    bees: [`${sig(1)}.js`, `${sig(2)}.js`],
    dependencies: [],
    docs: {
      bees: {
        [sig(1)]: { className: 'AgentLogActionDrone', kind: 'drone', description: 'agent-window icon  on tiles', listens: ['tile:action', 7, 'x'], emits: ['agent:open'], command: null, aliases: [] },
        [sig(2)]: { className: 'ConversationQueen', kind: 'queen', command: 'conversation', aliases: ['talk'] },
        'not-a-signature': { className: 'Nothing' },
        [sig(3)]: 'not an object',
      },
    },
  })

  it('reads each bee by bare signature, tolerantly', () => {
    const docs = beeDocsOf(layer)
    expect([...docs.keys()]).toEqual([sig(1), sig(2)])
    expect(docs.get(sig(1))).toEqual({
      className: 'AgentLogActionDrone',
      kind: 'drone',
      // whitespace collapses, a non-string listener is dropped, a null command is nothing
      description: 'agent-window icon on tiles',
      listens: ['tile:action', 'x'],
      emits: ['agent:open'],
      command: '',
      aliases: [],
    })
    expect(docs.get(sig(2))).toMatchObject({ className: 'ConversationQueen', kind: 'queen', command: 'conversation', aliases: ['talk'], description: '' })
  })

  it('reads nothing from a layer that has no docs, is not JSON, or has them in the wrong shape', () => {
    expect(beeDocsOf(JSON.stringify({ name: 'old', bees: [`${sig(1)}.js`] })).size).toBe(0)
    expect(beeDocsOf('not json {').size).toBe(0)
    expect(beeDocsOf(JSON.stringify({ docs: { bees: [] } })).size).toBe(0)
    expect(beeDocsOf(JSON.stringify({ docs: { bees: 'x' } })).size).toBe(0)
    expect(beeDocsOf('').size).toBe(0)
  })
})

describe('the two voices of a file, the participant winning field by field', () => {
  const doc: BeeDoc = { className: 'OrganizeDrone', kind: 'drone', description: 'sorts a layer into groups', listens: [], emits: [], command: '', aliases: [] }

  it('is called what the build recorded, then what its first line says, then its signature', () => {
    expect(publishedName({ sig: sig(1), doc })).toBe('OrganizeDrone')
    expect(publishedName({ sig: sig(1), fileName: 'src/assistant/organize.drone.ts' })).toBe('organize.drone.ts')
    expect(publishedName({ sig: sig(1), fileName: '@hypercomb/essentials/games/solomon' })).toBe('solomon')
    expect(publishedName({ sig: sig(1) })).toBe(sig(1).slice(0, 12))
    // The build's own class beats a path, which is only the file it came from.
    expect(publishedName({ sig: sig(1), doc, fileName: 'src/x.ts' })).toBe('OrganizeDrone')
  })

  it('lets a participant name a file and keep what it says of itself, or the other way round', () => {
    expect(beeWords({ sig: sig(1), doc })).toEqual({ name: 'OrganizeDrone', description: 'sorts a layer into groups', kind: 'drone', yoursName: false, yoursDescription: false })
    expect(beeWords({ sig: sig(1), doc, meta: { name: 'Sorter' } }))
      .toEqual({ name: 'Sorter', description: 'sorts a layer into groups', kind: 'drone', yoursName: true, yoursDescription: false })
    expect(beeWords({ sig: sig(1), doc, meta: { description: 'groups tiles by what they share' } }))
      .toEqual({ name: 'OrganizeDrone', description: 'groups tiles by what they share', kind: 'drone', yoursName: false, yoursDescription: true })
    // A file with no docs is still describable: the words are all the participant's.
    expect(beeWords({ sig: sig(1), meta: { name: 'Mine', description: 'Mine too' } }))
      .toEqual({ name: 'Mine', description: 'Mine too', kind: '', yoursName: true, yoursDescription: true })
  })

  it('keeps a name to one line and both to a bounded length, and an empty field is not a field', () => {
    expect(normalizeMeta({ name: '  a \n  b\t c ', description: '' })).toEqual({ name: 'a b c' })
    expect(normalizeMeta({ name: 'x'.repeat(200) }).name?.length).toBe(80)
    expect(normalizeMeta({ description: 'y'.repeat(900) }).description?.length).toBe(600)
    expect(normalizeMeta({ name: 5, description: null })).toEqual({})
    expect(normalizeMeta(null)).toEqual({})
    expect(normalizeMeta([])).toEqual({})
    expect(normalizeMeta(undefined)).toEqual({})
  })
})

/** A store that holds documents the way the pool does: one list of versions per sub-key. */
const fakeStore = (options: { pool?: boolean } = {}) => {
  const pool = {} as FileSystemDirectoryHandle
  const versions = new Map<string, ArrayBuffer[]>()
  const calls = { open: 0, mint: 0, writes: [] as { subKey: string | undefined; keep: string | undefined }[] }
  const store: MetaStore = {
    openPool: async meaning => { calls.open++; expect(meaning).toBe(BEE_META_MEANING); return options.pool === false ? null : pool },
    getPool: async meaning => { calls.mint++; expect(meaning).toBe(BEE_META_MEANING); return pool },
    getPoolDoc: async (_pool, subKey) => versions.get(subKey ?? '')?.at(-1) ?? null,
    putPoolDoc: async (_pool, bytes, subKey, opts) => {
      calls.writes.push({ subKey, keep: opts?.keep })
      const list = opts?.keep === 'current' ? [] : versions.get(subKey ?? '') ?? []
      list.push(bytes)
      versions.set(subKey ?? '', list)
      return 'a'.repeat(64)
    },
  }
  return { store, versions, calls }
}
const decode = (bytes: ArrayBuffer | undefined): unknown => JSON.parse(new TextDecoder().decode(bytes))

describe('the document that keeps a participant\'s words', () => {
  it('is one document per file signature in the pool of bee meta', async () => {
    expect(BEE_META_MEANING).toBe('meta:bees')
    const { store, calls } = fakeStore()
    expect(await writeBeeMeta(sig(1), { name: 'Sorter', description: 'groups tiles' }, store)).toBe(true)
    expect(calls.writes).toEqual([{ subKey: sig(1), keep: undefined }])
    expect(await readBeeMeta(sig(1), store)).toEqual({ name: 'Sorter', description: 'groups tiles' })
    // Another file has none, and a `.js` name reaches the same document as the bare signature.
    expect(await readBeeMeta(sig(2), store)).toEqual({})
    expect(await readBeeMeta(`${sig(1)}.js`, store)).toEqual({ name: 'Sorter', description: 'groups tiles' })
  })

  it('keeps every earlier version, because describing is a save a person chose', async () => {
    const { store, versions, calls } = fakeStore()
    await writeBeeMeta(sig(1), { name: 'First' }, store)
    await writeBeeMeta(sig(1), { name: 'Second', description: 'and more' }, store)
    // Never `keep: 'current'`, which recycles the slot: that is for software's own writes.
    expect(calls.writes.every(write => write.keep === undefined)).toBe(true)
    expect(versions.get(sig(1))?.length).toBe(2)
    expect((await readBeeMeta(sig(1), store))).toEqual({ name: 'Second', description: 'and more' })
    expect(decode(versions.get(sig(1))?.[0])).toEqual({ v: 1, name: 'First' })
  })

  it('hands the published words back by writing an empty version, and the history stays', async () => {
    const { store, versions } = fakeStore()
    await writeBeeMeta(sig(1), { name: 'Mine' }, store)
    expect(await writeBeeMeta(sig(1), {}, store)).toBe(true)
    expect(await readBeeMeta(sig(1), store)).toEqual({})
    expect(versions.get(sig(1))?.length).toBe(2)
    expect(decode(versions.get(sig(1))?.[1])).toEqual({ v: 1 })
  })

  it('writes the same words as the same bytes, whatever order they were given in', async () => {
    const a = fakeStore()
    const b = fakeStore()
    await writeBeeMeta(sig(1), { name: 'N', description: 'D' }, a.store)
    await writeBeeMeta(sig(1), { description: 'D', name: 'N' }, b.store)
    expect(new TextDecoder().decode(a.versions.get(sig(1))?.[0])).toBe(new TextDecoder().decode(b.versions.get(sig(1))?.[0]))
  })

  it('never mints the pool to read, and reads nothing from a pool that is not there', async () => {
    const { store, calls } = fakeStore({ pool: false })
    expect(await readBeeMeta(sig(1), store)).toEqual({})
    expect(calls.open).toBe(1)
    expect(calls.mint).toBe(0)
  })

  it('treats a record it cannot read, of another version, or with wrong words as no words', async () => {
    const put = async (record: string): Promise<MetaStore> => {
      const { store } = fakeStore()
      await store.putPoolDoc!({} as FileSystemDirectoryHandle, new TextEncoder().encode(record).buffer as ArrayBuffer, sig(1))
      return store
    }
    expect(await readBeeMeta(sig(1), await put('{not json'))).toEqual({})
    expect(await readBeeMeta(sig(1), await put(JSON.stringify({ v: 2, name: 'Future' })))).toEqual({})
    expect(await readBeeMeta(sig(1), await put(JSON.stringify({ v: 1, name: 7, description: ['x'] })))).toEqual({})
    expect(await readBeeMeta(sig(1), await put(JSON.stringify({ v: 1, name: 'Fine' })))).toEqual({ name: 'Fine' })
  })

  it('refuses what is not a file, and answers false rather than throwing when the store cannot save', async () => {
    const { store, calls } = fakeStore()
    expect(await writeBeeMeta('not-a-sig', { name: 'x' }, store)).toBe(false)
    expect(await readBeeMeta('not-a-sig', store)).toEqual({})
    expect(calls.mint + calls.open + calls.writes.length).toBe(0)
    expect(await writeBeeMeta(sig(1), { name: 'x' }, undefined)).toBe(false)
    expect(await writeBeeMeta(sig(1), { name: 'x' }, {})).toBe(false)
    const broken: MetaStore = { getPool: async () => { throw new Error('opfs gone') }, putPoolDoc: async () => null }
    expect(await writeBeeMeta(sig(1), { name: 'x' }, broken)).toBe(false)
    expect(await readBeeMeta(sig(1), broken)).toEqual({})
  })
})
