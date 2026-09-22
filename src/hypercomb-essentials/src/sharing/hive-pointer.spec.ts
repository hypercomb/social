// hive-pointer.spec.ts — setHiveRoot's safety rules (the extracted
// fetch-verify-merge-PUT step of publishBranch). Collaborators injected;
// no network, no IoC.

import { describe, expect, it } from 'vitest'
import { clearHiveRoot, ownHiveRoot, setHiveRoot, type HiveIndexResult, type PutHiveResult } from './hive-pointer.js'

const PUB = 'a'.repeat(64)
const SIG = 'b'.repeat(64)
const OTHER = 'c'.repeat(64)
const HOST = 'content.example.com'

type PutCall = { host: string; roots: Record<string, string>; replaces?: number }

const harness = (read: HiveIndexResult) => {
  const puts: PutCall[] = []
  const deps = {
    publicKey: async () => PUB,
    fetchIndex: async (): Promise<HiveIndexResult> => read,
    putManifest: async (host: string, roots: Record<string, string>, _doors?: unknown, replaces?: number): Promise<PutHiveResult> => {
      puts.push({ host, roots, ...(replaces ? { replaces } : {}) })
      return { ok: true, pubkey: PUB, createdAt: 1700000000 }
    },
  }
  return { deps, puts }
}

const verified = (roots: Record<string, string>): HiveIndexResult =>
  ({ ok: true, manifest: { roots, createdAt: 1600000000, pubkey: PUB } })

describe('setHiveRoot', () => {

  it('merges exactly one key into the verified roots — others untouched', async () => {
    const { deps, puts } = harness(verified({ arkanoid: OTHER }))
    const result = await setHiveRoot(HOST, 'install:essentials', SIG, deps)
    expect(result.ok).toBe(true)
    expect(puts).toHaveLength(1)
    expect(puts[0].roots).toEqual({ arkanoid: OTHER, 'install:essentials': SIG })
  })

  it('treats a 404 as the sanctioned empty baseline', async () => {
    const { deps, puts } = harness({ ok: false, reason: 'http', status: 404 })
    const result = await setHiveRoot(HOST, 'install:essentials', SIG, deps)
    expect(result.ok).toBe(true)
    expect(puts[0].roots).toEqual({ 'install:essentials': SIG })
  })

  it('REFUSES to write over an index it cannot see — unreachable, malformed, forged', async () => {
    for (const reason of ['unreachable', 'malformed', 'forged'] as const) {
      const { deps, puts } = harness({ ok: false, reason })
      const result = await setHiveRoot(HOST, 'install:essentials', SIG, deps)
      expect(result.ok).toBe(false)
      expect(result.reason).toBe(`index-unsafe: ${reason}`)
      expect(puts).toHaveLength(0)
    }
  })

  it('no-ops without re-signing when the root already holds the sig', async () => {
    const { deps, puts } = harness(verified({ 'install:essentials': SIG }))
    const result = await setHiveRoot(HOST, 'install:essentials', SIG, deps)
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('unchanged')
    expect(puts).toHaveLength(0)
  })

  it('refuses a malformed sig and a missing signer before touching the network', async () => {
    const { deps } = harness(verified({}))
    expect((await setHiveRoot(HOST, 'install:essentials', 'nope', deps)).reason).toBe('sig is not a 64-hex signature')
    expect((await setHiveRoot(HOST, 'install:essentials', SIG, { ...deps, publicKey: async () => null })).reason).toBe('no signer')
  })
})

describe('clearHiveRoot — a sandbox withdrawn is unreachable, never deleted', () => {
  it('takes exactly one key out of the verified roots, and leaves the rest', async () => {
    const { deps, puts } = harness(verified({ 'install:try-fresh': SIG, 'install:essentials': OTHER, arkanoid: OTHER }))
    const result = await clearHiveRoot(HOST, 'install:try-fresh', deps)
    expect(result).toMatchObject({ ok: true, sig: SIG })
    expect(puts).toEqual([{ host: HOST, roots: { 'install:essentials': OTHER, arkanoid: OTHER }, replaces: 1600000000 }])
  })
  it('no-ops on an absent key, and refuses an index it cannot trust', async () => {
    const absent = harness(verified({ arkanoid: OTHER }))
    expect((await clearHiveRoot(HOST, 'install:try-fresh', absent.deps)).reason).toBe('unchanged')
    expect(absent.puts).toEqual([])
    const forged = harness({ ok: false, reason: 'forged' } as HiveIndexResult)
    expect((await clearHiveRoot(HOST, 'install:try-fresh', forged.deps)).ok).toBe(false)
    expect(forged.puts).toEqual([])
  })
  it('ownHiveRoot reads one verified root, or null', async () => {
    const { deps } = harness(verified({ 'install:try-fresh': SIG }))
    expect(await ownHiveRoot(HOST, 'install:try-fresh', deps)).toBe(SIG)
    expect(await ownHiveRoot(HOST, 'install:try-other', deps)).toBeNull()
  })
})

describe('two writes in one second', () => {
  it('every write names the index it replaces, so the next one is stamped newer', async () => {
    const { deps, puts } = harness(verified({ 'install:try-fresh': SIG }))
    await setHiveRoot(HOST, 'install:essentials', SIG, deps)
    await clearHiveRoot(HOST, 'install:try-fresh', deps)
    expect(puts.map(put => put.replaces)).toEqual([1600000000, 1600000000])
  })
})
