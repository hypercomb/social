import { describe, expect, it } from 'vitest'
import { canonical, hashArguments, poolAddress, sha256Hex } from './intelligence-canonical.js'
import { keepIntelligence, recallIntelligence } from './intelligence-lookup.js'
import type { DirectoryHandle } from './intelligence-folder.js'

/** The test's folder writer: straight into the fake directory. */
const put = async (dir: DirectoryHandle, name: string, bytes: Uint8Array): Promise<void> => {
  (dir as unknown as { put(name: string, bytes: Uint8Array): void }).put(name, bytes)
}

const SYNTHESIA = '002335a75f57d40ee55d0e528c953034d1c794d72a5e3da4d35d0913fda8460f'

const file = (text: string) => ({
  getFile: async () => ({ text: async () => text }),
})

const writableRoot = async () => {
  const buckets = new Map<string, Map<string, Uint8Array>>()
  const asDir = (bucket: Map<string, Uint8Array>): DirectoryHandle => ({
    kind: 'directory',
    async *entries() {
      if (bucket === rootBucket) {
        for (const name of buckets.keys()) yield [name, { kind: 'directory' }] as [string, { kind: string }]
        return
      }
      for (const name of bucket.keys()) yield [name, { kind: 'file' }] as [string, { kind: string }]
    },
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      const nested = buckets.get(name)
      if (!nested) {
        if (!options?.create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' })
        const created = new Map<string, Uint8Array>()
        buckets.set(name, created)
        return asDir(created)
      }
      return asDir(nested)
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!bucket.has(name)) {
        if (!options?.create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' })
        bucket.set(name, new Uint8Array())
      }
      return {
        getFile: async () => ({
          text: async () => new TextDecoder().decode(bucket.get(name) ?? new Uint8Array()),
          arrayBuffer: async () => {
            const bytes = bucket.get(name) ?? new Uint8Array()
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
          },
        }),
      }
    },
    put(name: string, bytes: Uint8Array) { bucket.set(name, bytes) },
  }) as unknown as DirectoryHandle
  const rootBucket = new Map<string, Uint8Array>()
  const group = new Map<string, Uint8Array>([[
    'group.json',
    new TextEncoder().encode('{"kind":"intelligence-group","name":"lineage-of-science","problem":"proofs"}\n'),
  ]])
  buckets.set('lineage-of-science', group)
  return { root: asDir(rootBucket), buckets }
}

const directory = (entries: Record<string, unknown>): DirectoryHandle => {
  const handle = {
    kind: 'directory',
    async *entries() {
      for (const [name, value] of Object.entries(entries)) yield [name, value] as [string, { kind: string }]
    },
    async getDirectoryHandle(name: string) {
      const child = entries[name]
      if (!child || typeof child === 'string') throw Object.assign(new Error('missing'), { name: 'NotFoundError' })
      return child as DirectoryHandle
    },
    async getFileHandle(name: string) {
      const child = entries[name]
      if (typeof child !== 'string') throw Object.assign(new Error('missing'), { name: 'NotFoundError' })
      return file(child)
    },
  }
  return handle as unknown as DirectoryHandle
}

describe('intelligence lookup', () => {
  it('hashes arguments the way the disk trial does', async () => {
    expect(canonical({ name: 'synthesia' })).toBe('{"name":"synthesia"}')
    expect(await hashArguments({ name: 'synthesia' })).toBe(SYNTHESIA)
  })

  it('speaks the host bytes for the answer signature, and stays quiet when the member is absent', async () => {
    const args = { name: 'synthesia' }
    const hash = await hashArguments(args)
    const answer = 'the public proof\n'
    const answerBytes = new TextEncoder().encode(answer)
    const answerHash = await sha256Hex(answerBytes)
    const calls: string[] = []
    const fetch = (async (url: string) => {
      calls.push(url)
      return new Response(answerBytes)
    }) as typeof globalThis.fetch
    const poolName = await poolAddress('lineage-of-science')
    const root = directory({
      'lineage-of-science': directory({
        'group.json': '{\n  "kind": "intelligence-group",\n  "name": "lineage-of-science",\n  "problem": "proofs"\n}\n',
      }),
      [poolName]: directory({ [hash]: `jwize.com\n${answerHash}\n` }),
    })
    expect(await recallIntelligence(args, { root: null, fetch })).toBeNull()
    expect(calls).toEqual([])
    expect(await recallIntelligence(args, { root, fetch })).toBe(answer)
    expect(calls).toEqual([`https://jwize.com/${answerHash}`])
    expect(answerHash).not.toBe(hash)
  })

  it('speaks a finished answer from the folder and does not call a host', async () => {
    const made = await writableRoot()
    const args = { provider: 'anthropic', model: 'haiku', messages: [{ role: 'user', content: '2+2' }] }
    const calls: string[] = []
    const fetch = (async (url: string) => {
      calls.push(url)
      return new Response('no')
    }) as typeof globalThis.fetch
    await keepIntelligence(args, '4', made.root, put)
    expect(await recallIntelligence(args, { root: made.root, fetch, write: put })).toBe('4')
    expect(calls).toEqual([])
  })

  it('refuses a body that does not hash to the member name', async () => {
    const hash = await hashArguments({ name: 'synthesia' })
    const poolName = await (await import('./intelligence-canonical.js')).poolAddress('lineage-of-science')
    const root = directory({
      'lineage-of-science': directory({
        'group.json': '{"kind":"intelligence-group","name":"lineage-of-science","problem":"proofs"}\n',
      }),
      [poolName]: directory({ [hash]: 'jwize.com\n' }),
    })
    const fetch = (async () => new Response('other bytes')) as typeof globalThis.fetch
    expect(await recallIntelligence({ name: 'synthesia' }, { root, fetch })).toBeNull()
  })
})
