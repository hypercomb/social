import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { DEFAULT_HARNESS, harness, harnessBytes, parseHarness } from './harness.js'
import { publishHarness, syncHarnessesFrom } from './harness-network.js'
import { membersOf } from '../sharing/published-pools.js'

const memoryStorage = () => {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
  }
}
const host = globalThis as { localStorage?: unknown }
beforeEach(() => { host.localStorage = memoryStorage() })
afterEach(() => { delete host.localStorage })

describe('a harness offered to a host', () => {
  it('puts the canonical bytes, ships them, and stamps agent:harness under the participant\'s key', async () => {
    const record = parseHarness({ kind: 'harness@1', name: 'quiet-reader', leg: { rounds: 4 } })
    const acts: string[] = []
    const done = await publishHarness('hosts.example', record, {
      put: async (text, type) => { acts.push(`put ${type} ${text.length}`); return await SignatureService.sign(harnessBytes(record)) },
      publish: async (h, sigs) => { acts.push(`publish ${h} ${sigs.length}`); return { ok: true } },
      stamp: async (h, key, sig) => { acts.push(`stamp ${h} ${key} ${sig.slice(0, 6)}`); return { ok: true } },
    })
    expect(done.ok).toBe(true)
    expect(acts[0]).toMatch(/^put application\/json \d+$/)
    expect(acts[1]).toBe('publish hosts.example 1')
    expect(acts[2]).toMatch(/^stamp hosts.example agent:harness [0-9a-f]{6}$/)
  })

  it('a refused stamp is the word back', async () => {
    const done = await publishHarness('h', DEFAULT_HARNESS, {
      put: async () => 'a'.repeat(64), publish: async () => ({ ok: true }), stamp: async () => ({ ok: false, reason: 'not an operator' }),
    })
    expect(done).toEqual({ ok: false, error: 'not an operator' })
  })
})

describe('harnesses synced from a host', () => {
  it('reads a worker listing (one signature per line) or a JSON index alike', () => {
    expect(membersOf(`${'a'.repeat(64)}\n${'b'.repeat(64)}\n`)).toEqual(['a'.repeat(64), 'b'.repeat(64)])
    expect(membersOf({ members: ['c'.repeat(64)] })).toEqual(['c'.repeat(64)])
    expect(membersOf('not a listing')).toEqual([])
  })

  it('brings verified records in, held, and drops forged or unreadable members', async () => {
    const quiet = parseHarness({ kind: 'harness@1', name: 'quiet-reader', leg: { rounds: 4 } })
    const bytes = harnessBytes(quiet)
    const sig = await SignatureService.sign(bytes)
    const forged = 'f'.repeat(64)
    const pool = await (await import('@hypercomb/core')).registerPoolMeaning('agent:harness')
    const served = new Map<string, Response | (() => Response)>([
      [`https://hosts.example/${pool}`, () => new Response(`${sig}\n${forged}\n`, { status: 200 })],
      [`https://hosts.example/${sig}`, () => new Response(bytes, { status: 200 })],
      [`https://hosts.example/${forged}`, () => new Response(new TextEncoder().encode('{"kind":"harness@1","name":"evil"}'), { status: 200 })],
    ])
    const fetchFn = (async (url: string) => {
      const answer = served.get(url)
      return typeof answer === 'function' ? answer() : answer ?? new Response('', { status: 404 })
    }) as unknown as typeof fetch
    const before = harness.active.name
    const result = await syncHarnessesFrom('https://hosts.example', fetchFn)
    expect(result.answered).toBe(true)
    expect(result.imported).toEqual([{ sig, name: 'quiet-reader' }])
    expect(result.dropped).toBe(1)
    expect(harness.find('quiet-reader')?.sig).toBe(sig)
    expect(harness.active.name).toBe(before)
  })

  it('a host with no listing answers nothing, quietly', async () => {
    const fetchFn = (async () => new Response('', { status: 404 })) as unknown as typeof fetch
    expect(await syncHarnessesFrom('https://silent.example', fetchFn)).toMatchObject({ answered: false, imported: [], dropped: 0 })
  })
})
