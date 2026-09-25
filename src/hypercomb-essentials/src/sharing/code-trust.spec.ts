// code-trust.spec.ts — one consent, one pool: the trust:code pool is the
// truth, hc:community:domains the synchronous cache every gate reads, and the
// host directory's old list drains in once.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CODE_TRUST_CACHE_KEY, reconcileCodeTrust, trustCode, trustedCodeDomains, untrustCode } from './code-trust.js'

/** A directory handle over a Map: enough of OPFS for one flat pool. */
const fakePool = () => {
  const files = new Map<string, string>()
  const dir = {
    files,
    getFileHandle: async (name: string, opts?: { create?: boolean }) => {
      if (!files.has(name) && !opts?.create) throw new DOMException('absent', 'NotFoundError')
      if (!files.has(name)) files.set(name, '')
      return {
        kind: 'file',
        getFile: async () => ({ text: async () => files.get(name) ?? '' }),
        createWritable: async () => {
          let text = ''
          return { write: async (part: ArrayBuffer) => { text += new TextDecoder().decode(part) }, close: async () => { files.set(name, text) } }
        },
      }
    },
    removeEntry: async (name: string) => { if (!files.delete(name)) throw new DOMException('absent', 'NotFoundError') },
    async *[Symbol.asyncIterator]() {
      for (const name of [...files.keys()]) yield [name, { kind: 'file', getFile: async () => ({ text: async () => files.get(name) ?? '' }) }]
    },
  }
  return dir
}

let pool: ReturnType<typeof fakePool> | null
const ioc = (window as unknown as { ioc?: unknown })

beforeEach(() => {
  localStorage.clear()
  pool = fakePool()
  ioc.ioc = { get: (key: string) => key === '@hypercomb.social/Store' ? { getPool: async () => pool } : undefined }
})
afterEach(() => { delete ioc.ioc })

const domainsInPool = async (): Promise<string[]> =>
  [...pool!.files.values()].map(text => (JSON.parse(text) as { domain: string }).domain).sort()

describe('code trust', () => {
  it('writes the cache at once and the pool record after', async () => {
    const trusting = trustCode('https://Example.com/')
    expect(trustedCodeDomains().has('example.com')).toBe(true)
    await trusting
    expect(await domainsInPool()).toEqual(['example.com'])
  })

  it('withdraws from both, and a reconcile does not bring it back', async () => {
    await trustCode('example.com')
    expect(await untrustCode('example.com')).toBe(true)
    await reconcileCodeTrust()
    expect(trustedCodeDomains().has('example.com')).toBe(false)
    expect(await domainsInPool()).toEqual([])
  })

  it('changes nothing when the pool is not there to withdraw from', async () => {
    await trustCode('example.com')
    pool = null
    expect(await untrustCode('example.com')).toBe(false)
    expect(trustedCodeDomains().has('example.com')).toBe(true)
  })

  it('unions the pool and the cache, and drains the host directory list once', async () => {
    await trustCode('in-pool.com')
    localStorage.setItem(CODE_TRUST_CACHE_KEY, JSON.stringify(['cache-only.com']))
    localStorage.setItem('hc:hosts:code-trusted', JSON.stringify(['from-hosts.com']))
    expect(await reconcileCodeTrust()).toBe(3)
    expect([...trustedCodeDomains()].sort()).toEqual(['cache-only.com', 'from-hosts.com', 'in-pool.com'])
    expect(await domainsInPool()).toEqual(['cache-only.com', 'from-hosts.com', 'in-pool.com'])
    expect(localStorage.getItem('hc:hosts:code-trusted')).toBeNull()
  })

  it('a cleared browser gets its consents back from the pool', async () => {
    await trustCode('example.com')
    localStorage.clear()
    await reconcileCodeTrust()
    expect(trustedCodeDomains().has('example.com')).toBe(true)
  })
})
