// device-owner.live.spec.ts — the phone's invite and promote against a REAL host
// (documentation/phone-showcase-signing.md, "Proving it"). device-owner.spec.ts
// keeps the worker's rules in a fake; this one asks the worker itself, so the
// rules the phone is written against are the rules a host enforces.
//
// Skipped unless HC_LIVE_HOST names a host to write to. Run it against a local
// worker, never a production zone — every run writes a fresh anchor's key list,
// index and showcase:
//
//   cd hypercomb-relay/blossom-worker && npx wrangler dev --local --port 8787
//   HC_LIVE_HOST=localhost:8787 npx vitest run hypercomb-shim/src/bootstrap/device-owner.live.spec.ts   (from src/)

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { firstKeyList, keyListTemplate, nextKeyList, nip98Authorization, nip98Template, type SignedKeyList } from '@hypercomb/core'
import { allowInvite, captureDeviceInvite, heldInvite, readKeyChain } from './device-invite'
import { readDeviceBinding } from './device-binding'
import { deviceOwner } from './device-owner'
import { readOwnerIndex, readShowcaseAtom, readZoneOwners, showcaseBytes, showcaseKey, zoneOrigin, type ShowcaseRecord } from './showcase-record'

const HOST = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env['HC_LIVE_HOST'] ?? ''
const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
const sha = async (data: Uint8Array | string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256',
  (typeof data === 'string' ? new TextEncoder().encode(data) : data) as BufferSource)))

const memoryStore = () => {
  const docs = new Map<FileSystemDirectoryHandle, ArrayBuffer>()
  const pools = new Map<string, FileSystemDirectoryHandle>()
  return {
    getPool: async (meaning: string) => pools.get(meaning) ?? (pools.set(meaning, { name: meaning } as FileSystemDirectoryHandle), pools.get(meaning)!),
    getPoolDoc: async (pool?: FileSystemDirectoryHandle) => (pool ? docs.get(pool) ?? null : null),
    putPoolDoc: async (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer) => { docs.set(pool, bytes); return 'ok' },
  }
}

describe.skipIf(!HOST)(`live: a phone takes its owner's invite on ${HOST || 'a host'}, then promotes from its own key`, () => {
  // A fresh owner every run: the host keeps what earlier runs wrote.
  const desktop = generateSecretKey()
  const anchor = getPublicKey(desktop)
  const origin = zoneOrigin(HOST)
  const now = () => Math.floor(Date.now() / 1000)
  let inviteSecret = ''

  /** The desktop's own signed PUT, as the hive makes it. */
  const put = async (url: string, body: string | Uint8Array, payload?: boolean) => {
    const auth = nip98Authorization(finalizeEvent(nip98Template(url, 'PUT', now(), payload ? await sha(body) : undefined) as never, desktop) as never)
    return fetch(url, { method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : body.slice().buffer as ArrayBuffer })
  }

  beforeAll(async () => {
    localStorage.clear()
    const store = memoryStore()
    ;(window as unknown as { ioc: unknown }).ioc = { get: (key: string) => (key === '@hypercomb.social/Store' ? store : undefined) }

    // `keys allow <zone>` on the desktop: list 0, then the invite.
    const at = now() - 5
    const first = finalizeEvent(keyListTemplate(firstKeyList(anchor, 'desktop'), at) as never, desktop) as unknown as SignedKeyList
    const secret = generateSecretKey()
    inviteSecret = hex(secret)
    const invited = nextKeyList(firstKeyList(anchor, 'desktop'), first.id, { op: 'invite', pubkey: getPublicKey(secret), until: now() + 600 })!
    const chain = [first, finalizeEvent(keyListTemplate(invited, at) as never, desktop) as unknown as SignedKeyList]
    const lists = await sha('keys:lists')
    const listed = await put(`${origin}/${lists}/${anchor}`, JSON.stringify(chain), true)
    expect(listed.ok, `list PUT ${listed.status} ${listed.headers.get('X-Reason') ?? ''}`).toBe(true)

    // The desktop has published: camelflage in the showcase, dylan and camelflage open here.
    const record: ShowcaseRecord = { zone: HOST, items: [{ pubkey: anchor, lineage: 'camelflage' }], domains: [] }
    const bytes = showcaseBytes(record)
    const sig = await sha(bytes)
    const atom = await put(`${origin}/${sig}`, bytes)
    expect(atom.ok, `atom PUT ${atom.status} ${atom.headers.get('X-Reason') ?? ''}`).toBe(true)
    const index = finalizeEvent({ kind: 30564, created_at: now() - 5, tags: [],
      content: JSON.stringify({ v: 1, roots: { [showcaseKey(HOST)]: sig }, doors: { dylan: [HOST], camelflage: [HOST] } }) }, desktop)
    const indexed = await put(`${origin}/${await sha('hive:indexes')}/${anchor}`, JSON.stringify(index), true)
    expect(indexed.ok, `index PUT ${indexed.status} ${indexed.headers.get('X-Reason') ?? ''}`).toBe(true)
  })
  afterAll(() => { localStorage.clear() })

  it('Allow puts this browser on the list the host keeps, and records the anchor', async () => {
    captureDeviceInvite({ hash: `#invite=${HOST}/${anchor}/${inviteSecret}`, pathname: '/', search: '' }, { replaceState: () => {} })
    expect(await allowInvite(heldInvite()!, 'phone')).toEqual({ ok: true, anchor })
    const device = getPublicKey(Uint8Array.from(localStorage.getItem('hc:nostr:secret-key')!.match(/../g)!.map(p => parseInt(p, 16))))
    const chain = await readKeyChain(HOST, anchor)
    expect(chain && chain !== 'none' && chain.keys).toEqual([anchor, device])
    expect(chain && chain !== 'none' && chain.head.invites).toEqual([])
    expect((await readDeviceBinding())?.anchor).toBe(anchor)
  })

  it('the same invite does not take a second browser', async () => {
    const mine = localStorage.getItem('hc:nostr:secret-key')
    localStorage.clear()
    expect(await allowInvite({ host: HOST, anchor, secret: inviteSecret }, 'thief')).toMatchObject({ ok: false, reason: expect.stringContaining('already used') })
    expect(localStorage.getItem('hc:nostr:secret-key')).toBeNull()
    localStorage.setItem('hc:nostr:secret-key', mine!)
  })

  it('a tap promotes: the host takes the record and the index the phone signs for the anchor', async () => {
    const owner = deviceOwner(HOST)
    expect(await owner.hello()).toBe(anchor)
    const before = await readOwnerIndex(HOST, anchor)
    expect(before && before !== 'missing' && before.event['pubkey']).toBe(anchor)
    expect(await owner.toggle({ zone: HOST, pubkey: anchor, lineage: 'dylan', on: true })).toEqual({ ok: true, changed: true })

    // What every visitor's front door reads back.
    const after = await readOwnerIndex(HOST, anchor)
    if (!after || after === 'missing' || !before || before === 'missing') throw new Error('the index did not read back')
    expect(after.event['pubkey']).not.toBe(anchor)
    expect(after.event['tags']).toEqual([['anchor', anchor], ['prev', before.event['id']]])
    expect(after.content).toMatchObject({ v: 1, doors: { dylan: [HOST], camelflage: [HOST] } })
    const showcase = await readShowcaseAtom(HOST, String((after.content['roots'] as Record<string, string>)[showcaseKey(HOST)]))
    expect(showcase?.items.map(item => item.lineage).sort()).toEqual(['camelflage', 'dylan'])
    const owners = await readZoneOwners(HOST, [anchor])
    expect(owners.showcase?.items.map(item => item.lineage).sort()).toEqual(['camelflage', 'dylan'])
  })

  it('a stale index is refused with 409, and a second tap reads fresh and goes through', async () => {
    const read = await readOwnerIndex(HOST, anchor)
    if (!read || read === 'missing') throw new Error('no index')
    // The desktop writes in between: the phone's next write must name the new head, not the old one.
    const desktopWrite = finalizeEvent({ kind: 30564, created_at: Number(read.event['created_at']) + 1, tags: [], content: JSON.stringify(read.content) }, desktop)
    expect((await put(`${origin}/${await sha('hive:indexes')}/${anchor}`, JSON.stringify(desktopWrite), true)).ok).toBe(true)

    const device = Uint8Array.from(localStorage.getItem('hc:nostr:secret-key')!.match(/../g)!.map(p => parseInt(p, 16)))
    const url = `${origin}/${await sha('hive:indexes')}/${anchor}`
    const stale = finalizeEvent({ kind: 30564, created_at: Number(desktopWrite.created_at) + 1, tags: [['anchor', anchor], ['prev', String(read.event['id'])]], content: JSON.stringify(read.content) }, device)
    const body = JSON.stringify(stale)
    const auth = nip98Authorization(finalizeEvent(nip98Template(url, 'PUT', now(), await sha(body), [['anchor', anchor]]) as never, device) as never)
    expect((await fetch(url, { method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body })).status).toBe(409)

    expect(await deviceOwner(HOST).toggle({ zone: HOST, pubkey: anchor, lineage: 'dylan', on: false })).toEqual({ ok: true, changed: true })
    const owners = await readZoneOwners(HOST, [anchor])
    expect(owners.showcase?.items.map(item => item.lineage)).toEqual(['camelflage'])
  })
})
