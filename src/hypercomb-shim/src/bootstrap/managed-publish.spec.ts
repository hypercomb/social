// hypercomb-shim/src/bootstrap/managed-publish.spec.ts — a managed site door publishes one root with its own
// listed key, at the zone root whose store the site reads.
//
// One store answers at two names, as R2 does for *.jwize.com: the WRITE host (the zone root, which takes
// signed writes) and the SITE door (which serves the same bytes and the same index, and refuses every write).
// A third host — a STRANGER — serves an index of its own. The desktop is the publisher's own key: it signs the
// index and writes the invite. The page is this browser.

import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { firstKeyList, keyListTemplate, nextKeyList, verifyKeyListChain, type SignedKeyList } from '@hypercomb/core'
import { allowInvite, dropInvite } from './device-invite'
import { readDeviceBinding } from './device-binding'
import { deviceSigner } from './device-key'
import { closureChildren, MANAGED_PUBLISH_KEY, managedPublish, planClosure, registerManagedPublish, type ClosureKind } from './managed-publish'
import { forgetManageRecordForTests, type ManageRecord } from './manage-record'
import { decorationClosureSigs, nestedResourceSigs } from '../../../hypercomb-essentials/src/sharing/decoration-closure'

const WRITES = 'pluginthematrix.example'
const SITE = 'business-card.jwize.example'
const STRANGER = 'stranger.example'
const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
const utf8 = (text: string) => new TextEncoder().encode(text)
const sha = async (data: Uint8Array | string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256',
  (typeof data === 'string' ? utf8(data) : data) as BufferSource)))

const desktopSecret = generateSecretKey()
const anchor = getPublicKey(desktopSecret)

/** The store, its two names, and a stranger beside them. */
const world = () => {
  const atoms = new Map<string, Uint8Array>()
  let chain: SignedKeyList[] | null = null
  let index: Record<string, unknown> | null = null
  let strangerIndex: Record<string, unknown> | null = null
  const puts: string[] = []
  const fetcher = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input)
    const method = init.method ?? 'GET'
    const [lists, indexes] = await Promise.all([sha('keys:lists'), sha('hive:indexes')])
    if (url.host === STRANGER) {
      if (method !== 'GET' && method !== 'HEAD') { puts.push(`stranger:${url.pathname}`); return new Response('', { status: 200 }) }
      if (url.pathname === `/${indexes}/${anchor}`) return strangerIndex ? new Response(JSON.stringify(strangerIndex)) : new Response('', { status: 404 })
      return new Response('', { status: 404 })
    }
    if (url.host !== WRITES && url.host !== SITE) return new Response('', { status: 404 })
    // The site door is read-only, for everyone (worker.js, above every route).
    if (url.host === SITE && method !== 'GET' && method !== 'HEAD') {
      puts.push(`site:${url.pathname}`)
      return new Response('published Core hosts are read-only', { status: 405 })
    }
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
    if (method === 'HEAD') return new Response(null, { status: atoms.has(sig) ? 200 : (url.search === '?held' ? 204 : 404) })
    if (method === 'PUT') {
      if (actingAs(auth()) !== anchor) return new Response('', { status: 403 })
      const bytes = new Uint8Array(init.body as ArrayBuffer)
      if (await sha(bytes) !== sig) return new Response('', { status: 400 })
      atoms.set(sig, bytes)
      puts.push(`atom:${sig}`)
      return new Response('', { status: 200 })
    }
    return atoms.has(sig) ? new Response(atoms.get(sig)!.slice()) : new Response('', { status: 404 })
  })
  const sign = (content: Record<string, unknown>, at = Math.floor(Date.now() / 1000) - 60) =>
    finalizeEvent({ kind: 30564, created_at: at, tags: [], content: JSON.stringify(content) }, desktopSecret) as unknown as Record<string, unknown>
  return {
    fetcher, puts, atoms,
    get index() { return index },
    set index(next) { index = next },
    /** The desktop writes the first list and an invite, and hands back the secret. */
    invite: (until: number) => {
      const first = finalizeEvent(keyListTemplate(firstKeyList(anchor), until - 600) as never, desktopSecret) as unknown as SignedKeyList
      const secret = generateSecretKey()
      const next = nextKeyList(firstKeyList(anchor), first.id, { op: 'invite', pubkey: getPublicKey(secret), until }, until - 600)!
      chain = [first, finalizeEvent(keyListTemplate(next, until - 600) as never, desktopSecret) as unknown as SignedKeyList]
      return hex(secret)
    },
    /** The desktop publishes its index: the card and everything else it keeps. */
    publish: (content: Record<string, unknown>, at?: number) => { index = sign(content, at) },
    /** A stranger serves an index of the anchor's that the site does not read. */
    stranger: (content: Record<string, unknown>) => { strangerIndex = sign(content, Math.floor(Date.now() / 1000) - 3600) },
  }
}

/** This browser's own store: the binding pool, and the atoms the copy holds. */
const browserStore = (held: Map<string, Uint8Array>) => {
  const docs = new Map<FileSystemDirectoryHandle, ArrayBuffer>()
  const pools = new Map<string, FileSystemDirectoryHandle>()
  return {
    getPool: async (meaning: string) => pools.get(meaning) ?? (pools.set(meaning, { name: meaning } as FileSystemDirectoryHandle), pools.get(meaning)!),
    getPoolDoc: async (pool?: FileSystemDirectoryHandle) => (pool ? docs.get(pool) ?? null : null),
    putPoolDoc: async (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer) => { docs.set(pool, bytes); return 'ok' },
    getLayerPoolBytes: async (sig: string) => held.get(sig) ?? null,
    getResourceLocal: async (sig: string) => held.has(sig) ? ({ arrayBuffer: async () => held.get(sig)!.slice().buffer } as unknown as Blob) : null,
  }
}

const OLD_HEAD = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

/** The card as this browser holds it after an edit: a new head over a child the host already holds. */
const editedCard = async (held: Map<string, Uint8Array>, hostAtoms: Map<string, Uint8Array>) => {
  const put = async (text: string | Uint8Array, into = held) => { const bytes = typeof text === 'string' ? utf8(text) : text; const sig = await sha(bytes); into.set(sig, bytes); return sig }
  const child = await put(JSON.stringify({ name: 'contact' }), hostAtoms)
  const picture = await put(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))
  const portrait = await put(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]))
  const page = await put(`<!doctype html><img src="resource:${picture}">`)
  const decoration = await put(JSON.stringify({ kind: 'visual:website:page', payload: { order: 0, htmlSig: page } }))
  const details = await put(JSON.stringify({ name: 'Jaime', imageSig: portrait, groupSig: 'c'.repeat(64) }))
  const head = await put(JSON.stringify({ name: 'business-card', children: [child], decorations: [decoration], properties: [details] }))
  return { head, child, picture, portrait, page, decoration, details }
}

const record = (over: Partial<ManageRecord> = {}): ManageRecord =>
  ({ lineage: 'business-card', title: 'Business card', publisher: anchor, head: OLD_HEAD, writes: WRITES, ...over })

describe('a managed site door publishes one root with its own listed key', () => {
  let place: ReturnType<typeof world>
  let held: Map<string, Uint8Array>
  beforeEach(() => {
    localStorage.clear()
    dropInvite()
    place = world()
    held = new Map()
    vi.stubGlobal('fetch', place.fetcher)
    const store = browserStore(held)
    ;(window as unknown as { ioc: unknown }).ioc = { get: (key: string) => (key === '@hypercomb.social/Store' ? store : undefined) }
  })
  afterEach(() => { vi.unstubAllGlobals() })

  const content = () => ({ v: 1, roots: { 'business-card': OLD_HEAD, other: OTHER }, doors: { 'business-card': ['jwize.example'] }, offerings: { kept: true } })
  const accept = async () => {
    const now = Math.floor(Date.now() / 1000)
    const secret = place.invite(now + 600)
    return allowInvite({ host: WRITES, anchor, secret }, SITE, now)
  }
  const publisher = (over: Partial<ManageRecord> = {}) => managedPublish({ record: () => record(over), siteDoor: () => SITE, pause: async () => {} })

  it('puts up what the host lacks, then changes only that root, signed by this browser for the publisher', async () => {
    place.publish(content())
    expect((await accept()).ok).toBe(true)
    const card = await editedCard(held, place.atoms)
    const before = place.index!
    const result = await publisher().publishRoot('business-card', card.head)
    expect(result).toMatchObject({ ok: true, head: card.head, changed: true, uploaded: 6 })
    // Signatures only, and only what the host lacked: the child it held stays as it was.
    const uploaded = place.puts.filter(p => p.startsWith('atom:')).map(p => p.slice(5))
    expect(new Set(uploaded)).toEqual(new Set([card.head, card.decoration, card.page, card.picture, card.details, card.portrait]))
    // Parts before what names them: the head goes up last.
    expect(uploaded.at(-1)).toBe(card.head)
    const after = place.index!
    expect(after['pubkey']).toBe(deviceSigner(false)!.pubkey)
    expect(after['tags']).toEqual([['anchor', anchor], ['prev', before['id']]])
    // ONLY that root changed; every other field rode through.
    const next = JSON.parse(String(after['content']))
    expect(next).toEqual({ ...content(), roots: { 'business-card': card.head, other: OTHER } })
    // Nothing was ever written at the site door.
    expect(place.puts.filter(p => p.startsWith('site:'))).toEqual([])
  })

  it('refuses when the write host does not serve the index this site reads, and writes nothing anywhere', async () => {
    place.publish(content())
    await accept()
    const card = await editedCard(held, place.atoms)
    place.stranger({ v: 1, roots: { 'business-card': OLD_HEAD } })
    const puts = place.puts.length
    const result = await publisher({ writes: STRANGER }).publishRoot('business-card', card.head)
    expect(result).toMatchObject({ ok: false, error: `${STRANGER} does not serve the index ${SITE} reads; nothing was written` })
    // The key list may be offered there (it is public, and proves itself); no part and no index is.
    const lists = await sha('keys:lists')
    expect(place.puts.slice(puts).filter(p => !p.includes(lists))).toEqual([])
    expect(place.index!['pubkey']).toBe(anchor)
  })

  it('refuses a write host whose index is not the one the site door serves, even when it takes the key list', async () => {
    place.publish(content())
    await accept()
    const card = await editedCard(held, place.atoms)
    // The site door reads a newer event than the write host holds: two stores, not one.
    const real = place.fetcher.getMockImplementation()!
    const indexes = await sha('hive:indexes')
    const older = place.index!
    place.publish(content(), Math.floor(Date.now() / 1000) - 30)
    const newer = place.index!
    place.fetcher.mockImplementation(async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      if (url.pathname === `/${indexes}/${anchor}` && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify(url.host === WRITES ? older : newer))
      }
      return real(input, init)
    })
    const result = await publisher().publishRoot('business-card', card.head)
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(`${WRITES} does not serve the index ${SITE} reads`) })
    expect(place.puts.filter(p => p.startsWith('atom:') || p === 'index')).toEqual([])
  })

  it('publishes only by the owner’s own tap: with no live gesture it refuses and asks nothing of any host', async () => {
    // jwize: "AI can't publish on the community but it can make changes" — code
    // the AI wrote can reach this service through ioc, but it carries no gesture.
    place.publish(content())
    await accept()
    place.fetcher.mockClear()                       // the key's own setup asked the host; the publish must not
    const noHand = managedPublish({ record: () => record(), siteDoor: () => SITE, pause: async () => {}, hand: () => false })
    const result = await noHand.publishRoot('business-card', 'd'.repeat(64))
    expect(result).toEqual({ ok: false, error: 'publishing takes your own tap' })
    expect(place.fetcher).not.toHaveBeenCalled()
  })

  it('says how to get a key when this browser holds none, and asks nothing of any host', async () => {
    place.publish(content())
    const result = await publisher().publishRoot('business-card', 'd'.repeat(64))
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(`keys allow ${SITE}`) })
    expect(place.fetcher).not.toHaveBeenCalled()
  })

  it('refuses a version whose parts are held neither here nor on the host', async () => {
    place.publish(content())
    await accept()
    const lost = 'e'.repeat(64)
    const bytes = utf8(JSON.stringify({ name: 'business-card', children: [lost] }))
    const head = await sha(bytes)
    held.set(head, bytes)
    const result = await publisher().publishRoot('business-card', head)
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('held neither in this browser nor on') })
    expect(place.puts.filter(p => p.startsWith('atom:') || p === 'index')).toEqual([])
  })

  it('signs nothing when the index already names that head', async () => {
    place.publish(content())
    await accept()
    const puts = place.puts.length
    expect(await publisher().publishRoot('business-card', OLD_HEAD)).toMatchObject({ ok: true, head: OLD_HEAD, changed: false })
    expect(place.puts.length).toBe(puts)
  })

  it('reads again and signs again when another place wrote in between, keeping that change', async () => {
    place.publish(content())
    await accept()
    const card = await editedCard(held, place.atoms)
    const real = place.fetcher.getMockImplementation()!
    const indexes = await sha('hive:indexes')
    let once = true
    place.fetcher.mockImplementation(async (input: string, init?: RequestInit) => {
      if (once && init?.method === 'PUT' && new URL(input).pathname === `/${indexes}/${anchor}`) {
        once = false
        // The desktop publishes another root between this page's read and its write.
        place.publish({ ...content(), roots: { ...content().roots, other: 'f'.repeat(64) } }, Math.floor(Date.now() / 1000) - 10)
      }
      return real(input, init)
    })
    expect(await publisher().publishRoot('business-card', card.head)).toMatchObject({ ok: true, changed: true })
    expect(JSON.parse(String(place.index!['content'])).roots).toEqual({ 'business-card': card.head, other: 'f'.repeat(64) })
  })

  it('refuses this site\'s publish for another anchor\'s key, and a page that is not a managed site door', async () => {
    place.publish(content())
    await accept()
    const elsewhere = getPublicKey(generateSecretKey())
    expect(await publisher({ publisher: elsewhere }).publishRoot('business-card', OLD_HEAD))
      .toMatchObject({ ok: false, error: expect.stringContaining('this browser publishes for') })
    expect(await managedPublish({ record: () => null }).publishRoot('business-card', OLD_HEAD))
      .toMatchObject({ ok: false, error: 'this page is not a managed site door' })
    expect(await publisher().publishRoot('business-card', 'not-a-sig')).toMatchObject({ ok: false })
    expect((await readDeviceBinding())?.anchor).toBe(anchor)
  })

  it('is lent through ioc on a managed page only', () => {
    const registered = new Map<string, unknown>()
    ;(window as unknown as { ioc: unknown }).ioc = { get: (key: string) => registered.get(key), register: (key: string, value: unknown) => registered.set(key, value) }
    forgetManageRecordForTests()
    registerManagedPublish()
    expect(registered.has(MANAGED_PUBLISH_KEY)).toBe(false)
    const script = document.createElement('script')
    script.id = 'hc-manage'
    script.type = 'application/json'
    script.textContent = JSON.stringify(record())
    document.head.append(script)
    forgetManageRecordForTests()          // the live page is read once; a spec reads it anew
    try {
      registerManagedPublish()
      expect(typeof (registered.get(MANAGED_PUBLISH_KEY) as { publishRoot?: unknown })?.publishRoot).toBe('function')
    } finally { script.remove(); forgetManageRecordForTests() }
  })
})

describe('the closure is the one the hive pushes', () => {
  const kinds = (pairs: Array<[string, ClosureKind]>) => pairs.map(([sig]) => sig).sort()
  const sig = (ch: string) => ch.repeat(64)

  it('follows a decoration\'s declared parts as the hive does', async () => {
    const page = utf8(`<link href="resource:${sig('1')}/chrome.css"><img src="${sig('2')}">`)
    const pages = new Map([[sig('9'), page]])
    for (const record of [
      { kind: 'visual:website:page', payload: { htmlSig: sig('9') } },
      { kind: 'files:attachment', refs: [sig('3'), sig('4')] },
      { kind: 'reference', payload: { requiredBouquet: sig('5'), targetSig: sig('6') } },
      { kind: 'group', refs: [sig('7')] },
      { kind: 'creation', refs: [sig('8')] },
    ]) {
      const bytes = utf8(JSON.stringify(record))
      const ours = closureChildren('resource', bytes)
      // The page body is walked as its own step: its embedded parts come from it, as the hive's hop reads them.
      const expanded = ours.flatMap(([child, kind]) => kind === 'page' ? [child, ...kinds(closureChildren('page', pages.get(child)!))] : [child])
      expect(expanded.sort()).toEqual((await decorationClosureSigs(bytes, async s => pages.get(s) ?? null)).sort())
    }
  })

  it('mines a data blob as the hive does, never through a referent field, and a signed event not at all', () => {
    for (const record of [
      { name: 'Jaime', imageSig: sig('1'), small: { image: sig('2') }, link: `/@resource/${sig('3')}`, groupSig: sig('4'), prev: sig('5') },
      { succession: 1, members: [sig('1'), sig('2')], prev: sig('3'), signer: sig('4') },
      { kind: 30564, content: sig('1') },
    ]) {
      const bytes = utf8(JSON.stringify(record))
      expect(kinds(closureChildren('resource', bytes))).toEqual(nestedResourceSigs(bytes).sort())
    }
  })

  it('walks a layer\'s slots, and its envelopes, but never its code', () => {
    const layer = utf8(JSON.stringify({ name: 'x', children: [sig('1')], cells: [sig('2')], decorations: [sig('3')], bees: [sig('4')], dependencies: [sig('5')], title: sig('6') }))
    expect(closureChildren('layer', layer)).toEqual([[sig('1'), 'layer'], [sig('2'), 'layer'], [sig('3'), 'resource']])
    expect(closureChildren('layer', utf8(JSON.stringify({ meta: 1, layer: sig('7') })))).toEqual([[sig('7'), 'layer']])
    expect(closureChildren('layer', utf8(JSON.stringify({ meta: 1, bee: sig('8') })))).toEqual([])
    expect(closureChildren('leaf', layer)).toEqual([])
  })

  it('stops at what the host holds, and lists leaves first', async () => {
    const held = new Map<string, Uint8Array>()
    const put = async (text: string) => { const bytes = utf8(text); const s = await sha(bytes); held.set(s, bytes); return s }
    const deep = await put('{"name":"deep"}')
    const known = sig('d')
    const mid = await put(JSON.stringify({ name: 'mid', children: [deep] }))
    const root = await put(JSON.stringify({ name: 'root', children: [mid, known] }))
    vi.stubGlobal('fetch', vi.fn(async (input: string) => new Response(null, { status: new URL(input).pathname === `/${known}` ? 200 : 204 })))
    try {
      const plan = await planClosure(root, async s => held.get(s) ?? null, WRITES)
      expect(plan.put.map(atom => atom.sig)).toEqual([deep, mid, root])
      expect(plan.held).toBe(1)
      expect(plan.missing).toEqual([])
    } finally { vi.unstubAllGlobals() }
  })
})
