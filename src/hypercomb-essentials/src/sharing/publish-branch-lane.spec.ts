// publish-branch-lane.spec.ts — publishes from anywhere never run side by
// side (publish-lane.ts). A Publish panel press and a strip group publish
// both call publishBranch; with a slow seal, the second must not start
// sealing until the first has written its index.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveIndexResult, PutHiveResult } from './hive-pointer.js'

const HEAD = 'a'.repeat(64)
const PUBKEY = 'c'.repeat(64)
const BUNDLE = 'd'.repeat(64)

let roots: Record<string, string> = {}
let order: string[] = []

vi.mock('./hive-pointer.js', () => ({
  nip98Header: async () => 'Nostr test',
  fetchHiveIndex: async (): Promise<HiveIndexResult> =>
    ({ ok: true, manifest: { roots: { ...roots }, createdAt: 1_700_000_000, pubkey: PUBKEY } }),
  fetchHiveManifest: async () => ({ roots: { ...roots }, createdAt: 1_700_000_000, pubkey: PUBKEY }),
  putHiveManifest: async (_host: string, next: Record<string, string>): Promise<PutHiveResult> => {
    order.push(`index ${Object.keys(next).filter(k => !(k in roots)).join(',') || '(same)'}`)
    roots = { ...next }
    return { ok: true, pubkey: PUBKEY, createdAt: 1_700_000_000 }
  },
}))

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string): unknown => {
    if (key === '@hypercomb.social/Store') return { putResource: async () => BUNDLE }
    if (key === '@diamondcoreprocessor.com/HistoryService') {
      return {
        // A slow seal: the first branch takes longest, so side by side the
        // second would seal — and write — first.
        sealSubtree: async (segments: readonly string[]) => {
          order.push(`seal ${segments.join('/')}`)
          await new Promise(resolve => setTimeout(resolve, segments[0] === 'first' ? 40 : 1))
          return HEAD
        },
      }
    }
    if (key === '@diamondcoreprocessor.com/HostSyncService') {
      return {
        isEnabled: () => false,
        isPublicHostEnabled: () => true,
        publicHostDomain: () => 'host.example',
        enablePublicHost: () => void 0,
        markPublic: async () => void 0,
        drain: async () => void 0,
        reDrain: async () => void 0,
        isClosureAvailable: async () => true,
        ensureReceipt: async () => true,
        probeServed: async () => 'served' as const,
      }
    }
    if (key === '@diamondcoreprocessor.com/NostrSigner') return { getPublicKeyHex: async () => PUBKEY }
    return undefined
  },
}

const { publishBranch, setBranchDoors } = await import('./publish-branch.js')

beforeEach(() => {
  roots = {}
  order = []
  localStorage.clear()
})

describe('publishes never run side by side', () => {
  it('a second publish seals only after the first has written its index', async () => {
    const [a, b] = await Promise.all([publishBranch(['first']), publishBranch(['second'])])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    const firstIndex = order.findIndex(step => step.startsWith('index') && step.includes('first'))
    expect(firstIndex).toBeGreaterThan(-1)
    expect(order.indexOf('seal second')).toBeGreaterThan(firstIndex)
    // Both entries survive: neither publish wrote over the other.
    expect(Object.keys(roots).sort()).toEqual(['first', 'second'])
  })

  it('a publish that has to wait says so before anything else', async () => {
    const phases: string[] = []
    const ahead = publishBranch(['first'])
    const behind = publishBranch(['second'], { onProgress: p => phases.push(p.phase) })
    await Promise.all([ahead, behind])
    expect(phases[0]).toBe('queued')
    expect(phases).toContain('sealing')
  })

  it('an act that calls another inside the lane does not wait on itself', async () => {
    await publishBranch(['first'])
    // No doors at all is a withdrawal: setBranchDoors withdraws through the
    // unqueued body, inside its own turn.
    const out = await Promise.race([
      setBranchDoors(['first'], []),
      new Promise(resolve => setTimeout(() => resolve('stuck'), 2000)),
    ])
    expect(out).not.toBe('stuck')
  })
})
