// sharing/publish-arrival.spec.ts — a publish signs the branch's derived
// arrival plan into the same index write, where the index names none; a plan
// the publisher made by hand stays exactly as it is.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveIndexResult, PutHiveResult } from './hive-pointer.js'

const HEAD = 'a'.repeat(64)
const PUBKEY = 'c'.repeat(64)
const BUNDLE = 'd'.repeat(64)
const PLAN = 'e'.repeat(64)
const HAND_PLAN = 'f'.repeat(64)

type Put = { host: string; roots: Record<string, string> }

let indexRead: HiveIndexResult
let puts: Put[]
let marked: string[]
let stored: string[]
let derived: string[] | null

vi.mock('./hive-pointer.js', () => ({
  nip98Header: async () => 'Nostr test',
  fetchHiveIndex: async (): Promise<HiveIndexResult> => {
    const last = puts[puts.length - 1]
    return last ? { ok: true, manifest: { roots: last.roots, createdAt: 1_700_000_001, pubkey: PUBKEY } } : indexRead
  },
  putHiveManifest: async (host: string, roots: Record<string, string>): Promise<PutHiveResult> => {
    puts.push({ host, roots })
    return { ok: true, pubkey: PUBKEY, createdAt: 1_700_000_001 }
  },
}))
vi.mock('./community-hosts.js', () => ({ hostsOfBranch: async () => ['hypercomb.com'] }))
vi.mock('./arrival-derive.js', () => ({
  derivedArrival: async () => derived,
  derivedArrivalRecord: (keys: readonly string[]) => JSON.stringify({ arrive: [...keys], derived: true }),
}))

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string): unknown => {
    if (key === '@hypercomb.social/Store') {
      return {
        putResource: async (blob: Blob) => {
          const text = await new Promise<string>(resolve => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result ?? ''))
            reader.onerror = () => resolve('')
            reader.readAsText(blob)
          })
          if (!text.includes('"derived":true')) return BUNDLE
          stored.push(text)
          return PLAN
        },
      }
    }
    if (key === '@diamondcoreprocessor.com/HistoryService') return { sealSubtree: async () => HEAD }
    if (key === '@diamondcoreprocessor.com/HostSyncService') {
      return {
        isEnabled: () => false,
        isPublicHostEnabled: () => false,
        publicHostDomain: () => '',
        addPublishNodes: () => void 0,
        markPublic: async (sig: string) => { marked.push(sig) },
        drain: async () => void 0,
        isClosureAvailable: async () => true,
        ensureReceipt: async () => true,
        probeServed: async () => 'served' as const,
      }
    }
    if (key === '@diamondcoreprocessor.com/NostrSigner') return { getPublicKeyHex: async () => PUBKEY }
    return undefined
  },
}

const { publishBranch } = await import('./publish-branch.js')

beforeEach(() => {
  indexRead = { ok: false, reason: 'http', status: 404 }
  puts = []
  marked = []
  stored = []
  derived = ['@diamondcoreprocessor.com/SiteViewDrone', '@diamondcoreprocessor.com/ViewBee', '@diamondcoreprocessor.com/WebsiteQueenBee']
})

describe('a publish carries the derived arrival', () => {
  it('names the plan in the same signed write, and puts its record on the host', async () => {
    const result = await publishBranch(['jaime-weise'])
    expect(result.ok).toBe(true)
    expect(puts).toHaveLength(1)
    expect(puts[0]!.roots['jaime-weise']).toBe(HEAD)
    expect(puts[0]!.roots['plan:jaime-weise']).toBe(PLAN)
    expect(marked).toContain(PLAN)
    expect(JSON.parse(stored.find(t => t.includes('"derived"'))!)).toEqual({ arrive: derived, derived: true })
  })

  it('a plan made by hand stays — nothing is derived over it', async () => {
    indexRead = { ok: true, manifest: { roots: { 'plan:jaime-weise': HAND_PLAN }, createdAt: 1_700_000_000, pubkey: PUBKEY } }
    await publishBranch(['jaime-weise'])
    expect(puts[0]!.roots['plan:jaime-weise']).toBe(HAND_PLAN)
    expect(marked).not.toContain(PLAN)
  })

  it('no derived arrival: no plan is named', async () => {
    derived = null
    await publishBranch(['notes'])
    expect(Object.keys(puts[0]!.roots).some(k => k.startsWith('plan:'))).toBe(false)
  })
})
