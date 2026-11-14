// hypercomb-shim/src/bootstrap/device-owner.spec.ts — a phone takes its owner's invite and promotes a tile.
//
// One fake host stands in for the zone: it keeps an anchor's key list, the anchor's signed index (refusing a
// write whose `prev` is not the index it holds, as the worker does), and atoms by their hash. The desktop is the
// anchor's own key, writing the first list and an invite; the phone is this browser.

import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { firstKeyList, keyListTemplate, nextKeyList, verifyKeyListChain, type SignedKeyList } from '@hypercomb/core'
import { allowInvite, captureDeviceInvite, heldInvite } from './device-invite'
import { readDeviceBinding } from './device-binding'
import { deviceOwner, eitherOwner } from './device-owner'
import { readZoneOwners, showcaseBytes as shimBytes, type ShowcaseRecord } from './showcase-record'
import { showcaseBytes as hiveBytes } from '../../../hypercomb-essentials/src/sharing/showcase-record'

const ZONE = 'jwize.com'
const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
const sha = async (data: Uint8Array | string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256',
  (typeof data === 'string' ? new TextEncoder().encode(data) : data) as BufferSource)))

const desktopSecret = generateSecretKey()
const anchor = getPublicKey(desktopSecret)

/** The zone: what it holds, and what it refuses. */
const host = () => {
  const atoms = new Map<string, Uint8Array>()
  let chain: SignedKeyList[] | null = null
  let index: Record<string, unknown> | null = null
  const puts: string[] = []
  const fetcher = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input)
    const method = init.method ?? 'GET'
    const [lists, indexes] = await Promise.all([sha('keys:lists'), sha('hive:indexes')])
    const auth = (): Record<string, unknown> | null => {
      const header = String((init.headers as Record<string, string> | undefined)?.['Authorization'] ?? '')
      if (!header.startsWith('Nostr ')) return null
      const event = JSON.parse(decodeURIComponent(escape(atob(header.slice(6))))) as Record<string, unknown>
      return verifyEvent(event as never) ? event : null
    }
    const actingAs = (event: Record<string, unknown> | null): string => {
      if (!event) return ''
      const tag = (event['tags'] as string[][]).find(t => t[0] === 'anchor')?.[1]
      if (!tag || tag === event['pubkey']) return String(event['pubkey'])
      const keys = chain ? verifyKeyListChain(tag, chain, e => verifyEvent(structuredClone(e) as never)) : null
      return keys?.ok && keys.keys.includes(String(event['pubkey'])) ? tag : ''
    }
    if (url.pathname === `/${lists}/${anchor}`) {
      if (method === 'GET') return chain ? new Response(JSON.stringify(chain)) : new Response('', { status: 404 })
      const offered = JSON.parse(String(init.body)) as SignedKeyList[]
      const verdict = verifyKeyListChain(anchor, offered, e => verifyEvent(structuredClone(e) as never))
      if (!auth() || !verdict.ok || !verdict.keys.includes(String(auth()!['pubkey']))) return new Response('', { status: 403 })
      chain = offered
      puts.push('list')
      return new Response('', { status: 200 })
    }
    if (url.pathname === `/${indexes}/${anchor}`) {
      if (method === 'GET') return index ? new Response(JSON.stringify(index)) : new Response('', { status: 404 })
      if (actingAs(auth()) !== anchor) return new Response('', { status: 403 })
      const event = JSON.parse(String(init.body)) as Record<string, unknown>
      const prev = (event['tags'] as string[][]).find(t => t[0] === 'prev')?.[1]
      if (index && prev !== index['id']) return new Response('', { status: 409 })
      index = event
      puts.push('index')
      return new Response('', { status: 200 })
    }
    const sig = url.pathname.slice(1)
    if (method === 'HEAD') return new Response(null, { status: atoms.has(sig) ? 200 : 404 })
    if (method === 'PUT') {
      if (actingAs(auth()) !== anchor) return new Response('', { status: 403 })
      const bytes = new Uint8Array(init.body as ArrayBuffer)
      if (await sha(bytes) !== sig) return new Response('', { status: 400 })
      atoms.set(sig, bytes)
      puts.push('atom')
      return new Response('', { status: 200 })
    }
    return atoms.has(sig) ? new Response(atoms.get(sig)!.slice()) : new Response('', { status: 404 })
  })
  return {
    fetcher, puts,
    get index() { return index },
    /** The desktop writes the first list and an invite, and hands back the secret. */
    invite: (until: number) => {
      const first = finalizeEvent(keyListTemplate(firstKeyList(anchor), until - 600) as never, desktopSecret) as unknown as SignedKeyList
      const secret = generateSecretKey()
      const next = nextKeyList(firstKeyList(anchor), first.id, { op: 'invite', pubkey: getPublicKey(secret), until }, until - 600)!
      chain = [first, finalizeEvent(keyListTemplate(next, until - 600) as never, desktopSecret) as unknown as SignedKeyList]
      return hex(secret)
    },
    /** The desktop publishes the anchor's index: dylan opens on the zone, with the showcase it names. */
    publish: async (record: ShowcaseRecord | null) => {
      const roots: Record<string, string> = {}
      // dylan's published head: one readable layer, which going live minifies.
      const layer = new TextEncoder().encode(JSON.stringify({ name: 'dylan', cells: [] }, null, 2))
      const head = await sha(layer)
      atoms.set(head, layer)
      roots['dylan'] = head
      if (record) {
        const bytes = shimBytes(record)
        const sig = await sha(bytes)
        atoms.set(sig, bytes)
        roots[`showcase:${ZONE}`] = sig
      }
      index = finalizeEvent({ kind: 30564, created_at: Math.floor(Date.now() / 1000) - 60, tags: [],
        content: JSON.stringify({ v: 1, roots, doors: { dylan: [ZONE], camelflage: [ZONE] }, offerings: { kept: true } }) }, desktopSecret) as unknown as Record<string, unknown>
    },
  }
}

const memoryStore = () => {
  const docs = new Map<FileSystemDirectoryHandle, ArrayBuffer>()
  const pools = new Map<string, FileSystemDirectoryHandle>()
  return {
    getPool: async (meaning: string) => pools.get(meaning) ?? (pools.set(meaning, { name: meaning } as FileSystemDirectoryHandle), pools.get(meaning)!),
    getPoolDoc: async (pool?: FileSystemDirectoryHandle) => (pool ? docs.get(pool) ?? null : null),
    putPoolDoc: async (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer) => { docs.set(pool, bytes); return 'ok' },
  }
}

describe('a phone takes its owner\'s invite, then promotes from its own key', () => {
  let zone: ReturnType<typeof host>
  beforeEach(() => {
    localStorage.clear()
    zone = host()
    vi.stubGlobal('fetch', zone.fetcher)
    const store = memoryStore()
    ;(window as unknown as { ioc: unknown }).ioc = { get: (key: string) => (key === '@hypercomb.social/Store' ? store : undefined) }
  })
  afterEach(() => { vi.unstubAllGlobals() })

  const accept = async () => {
    const now = Math.floor(Date.now() / 1000)
    const secret = zone.invite(now + 600)
    const replaced: string[] = []
    captureDeviceInvite({ hash: `#invite=${ZONE}/${anchor}/${secret}`, pathname: '/', search: '' }, { replaceState: (_s, _t, url) => replaced.push(url) })
    expect(replaced).toEqual(['/'])
    const parts = heldInvite()!
    expect(parts).toEqual({ host: ZONE, anchor, secret })
    return allowInvite(parts, 'phone', now)
  }

  it('holds an invite it lands on, spends it only on Allow, and records the anchor', async () => {
    expect(localStorage.getItem('hc:nostr:secret-key')).toBeNull()
    const allowed = await accept()
    expect(allowed).toEqual({ ok: true, anchor })
    expect(heldInvite()).toBeNull()
    expect((await readDeviceBinding())?.anchor).toBe(anchor)
    expect(localStorage.getItem('hc:nostr:secret-key')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses an invite that ran out, and one already spent', async () => {
    const now = Math.floor(Date.now() / 1000)
    const secret = zone.invite(now + 600)
    captureDeviceInvite({ hash: `#invite=${ZONE}/${anchor}/${secret}`, pathname: '/', search: '' }, { replaceState: () => {} })
    expect(await allowInvite(heldInvite()!, 'phone', now + 601)).toMatchObject({ ok: false, reason: expect.stringContaining('run out') })
    expect(await allowInvite({ host: ZONE, anchor, secret: hex(generateSecretKey()) }, 'phone', now)).toMatchObject({ ok: false, reason: expect.stringContaining('already used') })
    // An invite that would not take it leaves no key behind.
    expect(localStorage.getItem('hc:nostr:secret-key')).toBeNull()
  })

  it('is a visitor until it has taken an invite', async () => {
    expect(await deviceOwner(ZONE).hello()).toBe('')
  })

  it('promotes a tile: the record goes up, the index is signed by the phone for the anchor, and every reader takes it', async () => {
    await zone.publish({ zone: ZONE, items: [{ pubkey: anchor, lineage: 'camelflage' }], domains: [] })
    await accept()
    const owner = deviceOwner(ZONE)
    expect(await owner.hello()).toBe(anchor)
    const before = zone.index!
    expect(await owner.toggle({ zone: ZONE, pubkey: anchor, lineage: 'dylan', on: true })).toEqual({ ok: true, changed: true })
    const after = zone.index!
    // Going live optimized it (jwize 2026-11-13: "turn on some items (the minification)"): the promotion is named in
    // the same index write, for the head the index names, with the readable head left where it was.
    const roots = (JSON.parse(String(after['content'])) as { roots: Record<string, string> }).roots
    expect(roots['dylan']).toMatch(/^[0-9a-f]{64}$/)
    const record = JSON.parse(await (await fetch(`https://${ZONE}/${roots['promoted:dylan']}`)).text()) as Record<string, unknown>
    expect(record).toMatchObject({ v: 1, kind: 'promote', head: roots['dylan'], arrival: null, derivation: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(after['pubkey']).not.toBe(anchor)
    expect(after['tags']).toEqual([['anchor', anchor], ['prev', before['id']]])
    // Every other field of the index is carried through.
    expect(JSON.parse(String(after['content']))).toMatchObject({ v: 1, doors: { dylan: [ZONE] }, offerings: { kept: true } })
    const read = await readZoneOwners(ZONE, [anchor])
    expect(read.reached).toBe(true)
    expect(read.showcase?.items).toEqual([{ pubkey: anchor, lineage: 'camelflage' }, { pubkey: anchor, lineage: 'dylan' }])
    // Asked again, nothing changes and nothing is signed.
    const puts = zone.puts.length
    expect(await owner.toggle({ zone: ZONE, pubkey: anchor, lineage: 'dylan', on: true })).toEqual({ ok: true, changed: false })
    expect(zone.puts.length).toBe(puts)
  })

  it('takes a tile off a page that had no record: the rest of what is published stays', async () => {
    await zone.publish(null)
    await accept()
    const owner = deviceOwner(ZONE)
    await owner.hello()
    expect(await owner.toggle({ zone: ZONE, pubkey: anchor, lineage: 'dylan', on: false })).toEqual({ ok: true, changed: true })
    expect((await readZoneOwners(ZONE, [anchor])).showcase?.items).toEqual([{ pubkey: anchor, lineage: 'camelflage' }])
  })

  it('signs the look a visitor is shown, and a page with no record keeps what it publishes', async () => {
    await zone.publish({ zone: ZONE, items: [{ pubkey: anchor, lineage: 'camelflage' }], domains: [] })
    await accept()
    const owner = deviceOwner(ZONE)
    await owner.hello()
    expect(await owner.view!({ zone: ZONE, view: 'list' })).toEqual({ ok: true, changed: true })
    const read = await readZoneOwners(ZONE, [anchor])
    expect(read.showcase?.view).toBe('list')
    expect(read.showcase?.items).toEqual([{ pubkey: anchor, lineage: 'camelflage' }])
    // Asked again, nothing is signed; hexagons takes the view away; a name that is no view is refused.
    const puts = zone.puts.length
    expect(await owner.view!({ zone: ZONE, view: 'list' })).toEqual({ ok: true, changed: false })
    expect(zone.puts.length).toBe(puts)
    expect(await owner.view!({ zone: ZONE, view: 'cube' })).toEqual({ ok: false, reason: 'bad request' })
    expect(await owner.view!({ zone: ZONE, view: 'hex' })).toEqual({ ok: true, changed: true })
    expect((await readZoneOwners(ZONE, [anchor])).showcase?.view).toBeUndefined()
  })

  it('reads again and retries once when the index moved underneath', async () => {
    await zone.publish({ zone: ZONE, items: [], domains: [] })
    await accept()
    const owner = deviceOwner(ZONE)
    await owner.hello()
    // The desktop writes between the phone's read and its write.
    const real = zone.fetcher.getMockImplementation()!
    let once = true
    zone.fetcher.mockImplementation(async (input: string, init?: RequestInit) => {
      if (once && init?.method === 'PUT' && String(init.headers && (init.headers as Record<string, string>)['Content-Type']) === 'application/json'
        && !input.includes(await sha('keys:lists'))) {
        once = false
        await zone.publish({ zone: ZONE, items: [], domains: [] })
      }
      return real(input, init)
    })
    expect(await owner.toggle({ zone: ZONE, pubkey: anchor, lineage: 'dylan', on: true })).toEqual({ ok: true, changed: true })
    expect((await readZoneOwners(ZONE, [anchor])).showcase?.items).toEqual([{ pubkey: anchor, lineage: 'dylan' }])
  })

  it('lets the hive beside the page answer first, and falls back to this browser\'s key', async () => {
    const hive = { hello: vi.fn(async () => 'h'.repeat(64)), toggle: vi.fn(async () => ({ ok: true as const, changed: true })) }
    const phone = { hello: vi.fn(async () => anchor), toggle: vi.fn(async () => ({ ok: true as const, changed: false })) }
    const both = eitherOwner(hive, phone)!
    expect(await both.hello()).toBe('h'.repeat(64))
    await both.toggle({ zone: ZONE, pubkey: anchor, lineage: 'dylan', on: true })
    expect(hive.toggle).toHaveBeenCalled()
    expect(phone.toggle).not.toHaveBeenCalled()
    const alone = eitherOwner({ hello: async () => '', toggle: hive.toggle }, phone)!
    expect(await alone.hello()).toBe(anchor)
    expect(eitherOwner(null, null)).toBeNull()
  })
})

describe('the record\'s bytes', () => {
  it('are the same bytes the hive signs, so one record has one signature', () => {
    const record: ShowcaseRecord = {
      zone: ZONE, view: 'launcher', domains: ['b.example', 'a.example'],
      items: [{ pubkey: 'b'.repeat(64), lineage: 'zeta' }, { pubkey: 'a'.repeat(64), lineage: 'alpha' }, { pubkey: 'a'.repeat(64), lineage: 'alpha' }],
      communities: [{ name: 'Games', items: [{ pubkey: 'a'.repeat(64), lineage: 'alpha' }], domains: [], view: 'list' }],
    }
    expect(new TextDecoder().decode(shimBytes(record))).toBe(new TextDecoder().decode(hiveBytes(record)))
  })
})
