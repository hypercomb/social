// pheromones/pheromone-deposits.spec.ts
//
// Signing, storage layout, and read-back — in isolation from the intake
// gate (that merge is covered by intake-filter.spec.ts's double and
// intake-filter-seam.spec.ts's end-to-end run against this real module).
//
// The store here is a real recursive in-memory directory tree (files +
// nested directories + `entries()`), because this module's whole point is
// the nested bucket layout — a flat sig-keyed fake, like the one
// pheromone-marks.spec.ts would use, cannot exercise it.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g['get'] = (key: string) => (window as any).__ioc?.[key]
  g['register'] = () => { /* noop */ }
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: (key: string) => (window as any).__ioc?.[key],
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
  // jsdom's Blob has no `text()`; every real browser has. Both the store
  // double and the module under test read resources with it.
  const proto = Blob.prototype as unknown as { text?: () => Promise<string> }
  if (typeof proto.text !== 'function') {
    proto.text = function (this: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(reader.error)
        reader.readAsText(this)
      })
    }
  }
})

type FakeFile = {
  kind: 'file'
  getFile(): Promise<{ text(): Promise<string> }>
  createWritable(): Promise<{ write(d: unknown): Promise<void>; close(): Promise<void> }>
}
type FakeDir = {
  kind: 'directory'
  files: Map<string, string>
  dirs: Map<string, FakeDir>
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FakeFile>
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FakeDir>
  entries(): AsyncGenerator<[string, { kind: 'file' | 'directory' }]>
}

const notFound = (name: string): Error =>
  typeof DOMException !== 'undefined'
    ? new DOMException(`${name} not found`, 'NotFoundError')
    : Object.assign(new Error(`${name} not found`), { name: 'NotFoundError' })

const makeDir = (): FakeDir => {
  const files = new Map<string, string>()
  const dirs = new Map<string, FakeDir>()
  const handle: FakeDir = {
    kind: 'directory',
    files,
    dirs,
    getFileHandle: async (name, opts) => {
      if (!files.has(name) && !opts?.create) throw notFound(name)
      if (!files.has(name)) files.set(name, '')
      return {
        kind: 'file' as const,
        getFile: async () => ({ text: async () => files.get(name) ?? '' }),
        createWritable: async () => ({
          write: async (d: unknown) => { files.set(name, String(d)) },
          close: async () => { /* committed on write */ },
        }),
      }
    },
    getDirectoryHandle: async (name, opts) => {
      let held = dirs.get(name)
      if (!held) {
        if (!opts?.create) throw notFound(name)
        held = makeDir()
        dirs.set(name, held)
      }
      return held
    },
    async *entries() {
      for (const [name, sub] of dirs) yield [name, sub] as [string, FakeDir]
      for (const name of files.keys()) {
        yield [name, {
          kind: 'file' as const,
          getFile: async () => ({ text: async () => files.get(name) ?? '' }),
          createWritable: async () => ({ write: async () => { /* unused */ }, close: async () => { /* unused */ } }),
        }] as [string, FakeFile]
      }
    },
  }
  return handle
}

const sign = async (text: string): Promise<string> =>
  await SignatureService.sign(new TextEncoder().encode(text).buffer as ArrayBuffer)

const makeStore = () => {
  const resources = new Map<string, string>()
  const pools = new Map<string, FakeDir>()
  return {
    resources,
    pools,
    putResource: async (blob: Blob) => {
      const text = await blob.text()
      const s = await sign(text)
      resources.set(s, text)
      return s
    },
    getResource: async (s: string) => (resources.has(s) ? new Blob([resources.get(s)!]) : null),
    getPool: async (meaning: string): Promise<FakeDir> => {
      let held = pools.get(meaning)
      if (!held) { held = makeDir(); pools.set(meaning, held) }
      return held
    },
    openPool: async (meaning: string): Promise<FakeDir | null> => pools.get(meaning) ?? null,
  }
}

let store: ReturnType<typeof makeStore>

const { NostrSigner } = await import('../sharing/nostr-signer.js')
const {
  mintDeposit, depositKindsOf, depositKindsKnown, depositPreimage, PHEROMONE_DEPOSIT_KIND, forgetDeposits,
  knownPheromoneKinds,
} = await import('./pheromone-deposits.js')

const setIoc = (withSigner: boolean): void => {
  ;(window as any).__ioc = {
    '@hypercomb.social/Store': store,
    ...(withSigner ? { '@diamondcoreprocessor.com/NostrSigner': new NostrSigner() } : {}),
  }
}

let counter = 0
const freshTarget = async (): Promise<string> => await sign(`content-${++counter}`)

beforeEach(() => {
  store = makeStore()
  setIoc(true)
})

describe('pheromone deposits', () => {
  it('mints a deposit and reads its kind back', async () => {
    const target = await freshTarget()
    const result = await mintDeposit(target, 'cigars')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.deposit.target).toBe(target)
      expect(result.deposit.kind).toBe('cigars')
      expect(result.deposit.depositor).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(await depositKindsOf(target)).toEqual(['cigars'])
  })

  it('updates the sync cache immediately on mint — no read required', async () => {
    const target = await freshTarget()
    expect(depositKindsKnown(target)).toBeUndefined()
    await mintDeposit(target, 'cigars')
    expect(depositKindsKnown(target)).toEqual(['cigars'])
  })

  it('two deposits from the same author on the same target both land', async () => {
    const target = await freshTarget()
    await mintDeposit(target, 'cigars')
    await mintDeposit(target, 'travel')
    expect([...(await depositKindsOf(target))].sort()).toEqual(['cigars', 'travel'])
  })

  it('numbers this author\'s markers sequentially inside one target bucket', async () => {
    const target = await freshTarget()
    const first = await mintDeposit(target, 'a')
    const second = await mintDeposit(target, 'b')
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok) return

    const pool = await store.getPool('pheromones:deposits')
    const targetBucket = await pool.getDirectoryHandle(target)
    const authorBucket = await targetBucket.getDirectoryHandle(first.deposit.depositor)
    const markers: string[] = []
    for await (const [name, handle] of authorBucket.entries()) {
      if (handle.kind === 'file') markers.push(name)
    }
    expect(markers.sort()).toEqual(['00000000', '00000001'])
  })

  it('a never-marked target reads as an empty, landed answer', async () => {
    const target = await freshTarget()
    expect(await depositKindsOf(target)).toEqual([])
    expect(depositKindsKnown(target)).toEqual([])
  })

  it('refuses a malformed target', async () => {
    const result = await mintDeposit('not-a-signature', 'cigars')
    expect(result.ok).toBe(false)
  })

  it('refuses an empty or invalid kind', async () => {
    const target = await freshTarget()
    const result = await mintDeposit(target, '   ')
    expect(result.ok).toBe(false)
  })

  it('refuses to mint with no signer available', async () => {
    setIoc(false)
    const target = await freshTarget()
    const result = await mintDeposit(target, 'cigars')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no signer')
  })

  it('two different depositors on the same target both surface, unioned', async () => {
    const target = await freshTarget()
    await mintDeposit(target, 'mine')

    // A second, independently-keyed depositor — bypassing mintDeposit's
    // single cached identity the way a peer's arrival would. A future sync
    // path would write this AND call forgetDeposits; this test does the same
    // by hand, which is exactly the contract `forgetDeposits` documents.
    const { generateSecretKey, getPublicKey, finalizeEvent } = await import('nostr-tools')
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const at = Math.floor(Date.now() / 1000)
    const evt = finalizeEvent(
      { kind: PHEROMONE_DEPOSIT_KIND, created_at: at, tags: [['d', target], ['k', 'theirs']], content: depositPreimage(target, 'theirs', pubkey, at) },
      sk,
    )
    const recordSig = await store.putResource(new Blob([JSON.stringify(evt)]))
    const pool = await store.getPool('pheromones:deposits')
    const targetBucket = await pool.getDirectoryHandle(target, { create: true })
    const authorBucket = await targetBucket.getDirectoryHandle(pubkey, { create: true })
    const marker = await authorBucket.getFileHandle('00000000', { create: true })
    const w = await marker.createWritable()
    try { await w.write(recordSig) } finally { await w.close() }
    forgetDeposits(target)

    expect([...(await depositKindsOf(target))].sort()).toEqual(['mine', 'theirs'])
  })

  it('a marker whose bucket name does not match the signed pubkey is rejected', async () => {
    const target = await freshTarget()
    const { generateSecretKey, getPublicKey, finalizeEvent } = await import('nostr-tools')
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const at = Math.floor(Date.now() / 1000)
    const evt = finalizeEvent(
      { kind: PHEROMONE_DEPOSIT_KIND, created_at: at, tags: [['d', target], ['k', 'spoofed']], content: depositPreimage(target, 'spoofed', pubkey, at) },
      sk,
    )
    const recordSig = await store.putResource(new Blob([JSON.stringify(evt)]))
    const pool = await store.getPool('pheromones:deposits')
    const targetBucket = await pool.getDirectoryHandle(target, { create: true })
    // Filed under a DIFFERENT pubkey's bucket than the one that actually signed it.
    const wrongBucket = await targetBucket.getDirectoryHandle('b'.repeat(64), { create: true })
    const marker = await wrongBucket.getFileHandle('00000000', { create: true })
    const w = await marker.createWritable()
    try { await w.write(recordSig) } finally { await w.close() }

    expect(await depositKindsOf(target)).toEqual([])
  })

  describe('the declared vocabulary — what kinds could I turn on', () => {
    it('a minted deposit registers its kind in the vocabulary', async () => {
      const target = await freshTarget()
      await mintDeposit(target, 'cigars')
      expect(await knownPheromoneKinds()).toEqual(['cigars'])
    })

    it('the same kind minted on different targets registers once', async () => {
      const a = await freshTarget()
      const b = await freshTarget()
      await mintDeposit(a, 'cigars')
      await mintDeposit(b, 'cigars')
      expect(await knownPheromoneKinds()).toEqual(['cigars'])
    })

    it('several distinct kinds all surface, sorted', async () => {
      const target = await freshTarget()
      await mintDeposit(target, 'travel')
      await mintDeposit(target, 'cigars')
      expect(await knownPheromoneKinds()).toEqual(['cigars', 'travel'])
    })

    it('an untouched hive has no vocabulary yet', async () => {
      expect(await knownPheromoneKinds()).toEqual([])
    })

    it('a vocabulary write failure never fails the deposit itself', async () => {
      // Only the vocabulary pool refuses; the deposit's own pool is untouched.
      let namesPoolRequested = false
      const realGetPool = store.getPool.bind(store)
      store.getPool = (async (meaning: string) => {
        if (meaning === 'pheromones:names') { namesPoolRequested = true; throw new Error('quota exceeded') }
        return realGetPool(meaning)
      }) as typeof store.getPool

      const target = await freshTarget()
      const result = await mintDeposit(target, 'cigars')
      expect(result.ok).toBe(true)
      expect(namesPoolRequested).toBe(true)
      // The vocabulary write failed, so the kind never registered — this is
      // the tradeoff `knownPheromoneKinds` accepts for never blocking a mint.
      expect(await depositKindsOf(target)).toEqual(['cigars'])
    })
  })
})
