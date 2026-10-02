// version-pools.spec.ts — the minimal build's history, held in the browser.
// What a host serves at /<sign(meaning)>/ is taken file by file, kept only if
// it hashes to its name; revisions list newest first with their signatures
// checked; what is already held is not fetched again.

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import {
  BUILD_SIGNATURE_KIND, BUILDS_MEANING, SIGNATURES_MEANING, pullVersionPools, signaturePreimage, versionRevisions, type PoolIo,
} from './version-pools.js'

const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
const enc = (value: unknown): Uint8Array => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value))

const memory = (): PoolIo & { pools: Map<string, Map<string, Uint8Array>> } => {
  const pools = new Map<string, Map<string, Uint8Array>>()
  const pool = (meaning: string) => pools.get(meaning) ?? pools.set(meaning, new Map()).get(meaning)!
  return {
    pools,
    names: async meaning => [...pool(meaning).keys()],
    read: async (meaning, name) => pool(meaning).get(name) ?? null,
    write: async (meaning, name, bytes) => { pool(meaning).set(name, bytes) },
  }
}

/** A host serving both pools at its root: name → bytes per meaning. */
const host = (served: Record<string, Map<string, Uint8Array>>, tamper = new Set<string>()) => {
  const fetched: string[] = []
  const get = (async (input: string) => {
    const url = new URL(input)
    const [pool, name] = url.pathname.split('/').filter(Boolean)
    const meaning = Object.keys(served).find(m => sha(m) === pool)
    if (!meaning || url.pathname.startsWith('/content/')) return new Response('', { status: 404 })
    if (!name) return new Response([...served[meaning]!.keys()].join('\n') + '\n')
    fetched.push(name)
    const bytes = served[meaning]!.get(name)
    if (!bytes) return new Response('', { status: 404 })
    return new Response((tamper.has(name) ? enc('not these bytes') : bytes) as unknown as BodyInit)
  }) as unknown as typeof fetch
  return { get, fetched }
}

const revision = (version: string, parent: string | null, extra: Record<string, unknown> = {}) =>
  enc({ name: 'build', label: 'host', version, parent, install: 'i'.repeat(64), tree: 't'.repeat(64), ...extra })

describe('the version pools in the browser', () => {
  it('takes what a host serves, verified, and lists the revisions newest first with their signatures', async () => {
    const older = revision('2026.10.2.1', null)
    const newer = revision('2026.10.2.2', sha(older), { workspace: 'w'.repeat(64) })
    const story = enc({ name: 'story', label: 'host', description: 'the host', at: '2026-10-02T00:00:00Z' })
    const key = generateSecretKey()
    const signature = (sig: string, version: string, role = 'author') => enc(finalizeEvent({
      kind: BUILD_SIGNATURE_KIND, created_at: 1_790_000_000, tags: [['b', sig], ['r', role]], content: signaturePreimage(sig, version, role),
    }, key))
    const signed = signature(sha(newer), '2026.10.2.2')
    // A signature whose content claims another version: it does not count.
    const wrong = signature(sha(older), '2026.10.2.9', 'reviewer')
    const builds = new Map([[sha(older), older], [sha(newer), newer], [sha(story), story]])
    const signatures = new Map([[sha(signed), signed], [sha(wrong), wrong]])
    const { get } = host({ [BUILDS_MEANING]: builds, [SIGNATURES_MEANING]: signatures })
    const io = memory()

    const report = await pullVersionPools('http://origin.test', io, get)
    expect(report).toEqual({ host: 'http://origin.test', answered: true, taken: 5, refused: 0, held: 0 })

    const listed = await versionRevisions(io)
    expect(listed.map(r => r.version)).toEqual(['2026.10.2.2', '2026.10.2.1'])
    expect(listed[0]).toMatchObject({ sig: sha(newer), label: 'host', parent: sha(older), parts: ['install', 'tree', 'workspace'] })
    expect(listed[0]!.signers).toEqual([{ role: 'author', pubkey: getPublicKey(key), ok: true }])
    expect(listed[1]!.signers).toEqual([{ role: 'reviewer', pubkey: getPublicKey(key), ok: false }])
  })

  it('refuses a file that is not what it is named, and fetches nothing it already holds', async () => {
    const a = revision('2026.10.2.1', null), b = revision('2026.10.2.2', null)
    const builds = new Map([[sha(a), a], [sha(b), b]])
    const io = memory()
    const first = host({ [BUILDS_MEANING]: builds, [SIGNATURES_MEANING]: new Map() }, new Set([sha(b)]))
    expect(await pullVersionPools('origin.test', io, first.get)).toMatchObject({ answered: true, taken: 1, refused: 1 })
    expect([...io.pools.get(BUILDS_MEANING)!.keys()]).toEqual([sha(a)])

    const second = host({ [BUILDS_MEANING]: builds, [SIGNATURES_MEANING]: new Map() })
    expect(await pullVersionPools('origin.test', io, second.get)).toMatchObject({ taken: 1, refused: 0, held: 1 })
    expect(second.fetched).toEqual([sha(b)])
  })

  it('says when a host serves no version pools', async () => {
    const get = (async () => new Response('', { status: 404 })) as unknown as typeof fetch
    expect(await pullVersionPools('nowhere.test', memory(), get)).toEqual({ host: 'nowhere.test', answered: false, taken: 0, refused: 0, held: 0 })
  })
})
