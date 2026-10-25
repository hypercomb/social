// sharing/key-list.client.spec.ts — the client's acts on the key list, against a
// fake host that holds chains by the rule the worker does (core's
// acceptKeyListChain, real signatures) and keeps the NIP-98 signer of each write.
// Keys are real secp256k1, fixed by seed; no network, no IoC.

import { describe, expect, it } from 'vitest'
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import {
  KEY_LIST_MEANING, acceptKeyListChain, isListedKey, readKeyList, registerPoolMeaning, type SignedKeyList,
} from '@hypercomb/core'
import {
  acceptInvite, allowAnother, anchorServes, anchorTagFor, anchoredTags, captureInvite, carryKeyChain, clearPendingInvite,
  fetchKeyChain, forgetKeyReads, inviteLink, keyChainUrl, listKeys, listedKeys, parseInvite, pendingInvite,
  prepareAnchorHosts, publisherKeyHex, putKeyChain, removeKey, INVITE_SECONDS,
  type AnchorBindingLike, type KeyListDeps, type KeySigner,
} from './key-list.client.js'

const POOL = await registerPoolMeaning(KEY_LIST_MEANING)
const T0 = 1_790_000_000

const secretOf = (n: number): Uint8Array => new Uint8Array(32).fill(n)

/** One place: a real key, a signer over it, and its own binding. */
const place = (n: number, clock: { now: number }) => {
  const sk = secretOf(n)
  const pubkey = getPublicKey(sk)
  let anchor: string | null = null
  let sources: readonly string[] = []
  const binding: AnchorBindingLike = {
    anchor: () => anchor,
    sources: () => sources,
    bind: (a, s) => { anchor = a; sources = s },
    unbind: () => { anchor = null; sources = [] },
  }
  const signer: KeySigner = {
    signEvent: async evt => finalizeEvent(evt, sk) as unknown as Record<string, unknown>,
    getPublicKeyHex: async () => pubkey,
    knownPublicKeyHex: async () => pubkey,
  }
  return { sk, pubkey, binding, signer, clock, bound: () => anchor }
}
type Place = ReturnType<typeof place>

/** Hosts that answer GET/PUT of a chain as the worker does. */
const hosts = (clock: { now: number }) => {
  const chains = new Map<string, SignedKeyList[]>()
  const writers: { host: string; signer: string }[] = []
  const verify = (e: SignedKeyList): boolean => { try { return verifyEvent(structuredClone(e) as never) } catch { return false } }
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const m = new RegExp(`^/${POOL}/([0-9a-f]{64})$`).exec(url.pathname)
    if (!m) return new Response('no route', { status: 404 })
    const id = `${url.host}|${m[1]}`
    if (url.host.startsWith('down.')) throw new TypeError('network down')
    if (!init?.method || init.method === 'GET') {
      const held = chains.get(id)
      return held ? Response.json(held) : new Response('none', { status: 404 })
    }
    const header = new Headers(init.headers).get('authorization') ?? ''
    const auth = JSON.parse(decodeURIComponent(escape(atob(header.replace(/^Nostr /, ''))))) as { pubkey: string; tags: string[][] }
    const offered = JSON.parse(String(init.body)) as SignedKeyList[]
    if (!offered.some(e => { const list = readKeyList(e); return !!list && isListedKey(list, auth.pubkey) })) {
      return new Response('', { status: 403, headers: { 'X-Reason': 'only a key the chain names may carry it here' } })
    }
    const held = chains.get(id) ?? []
    const verdict = acceptKeyListChain(m[1], held, offered, verify, clock.now)
    if (!verdict.ok) return new Response('', { status: verdict.reason === 'fork' ? 409 : 400, headers: { 'X-Reason': `${verdict.reason} at ${verdict.at}` } })
    writers.push({ host: url.host, signer: auth.pubkey })
    chains.set(id, offered)
    return new Response('held', { status: held.length ? 200 : 201 })
  }) as typeof globalThis.fetch
  return { chains, writers, fetch }
}

const depsFor = (p: Place, h: ReturnType<typeof hosts>, extra: Partial<KeyListDeps> = {}): KeyListDeps => ({
  fetch: h.fetch,
  signer: () => p.signer,
  binding: () => p.binding,
  now: () => p.clock.now,
  newSecret: () => secretOf(99),
  ...extra,
})

const ONE = 'one.example'
const TWO = 'two.example'

describe('invite text', () => {
  const parts = { host: 'one.example', anchor: 'a'.repeat(64), secret: 'b'.repeat(64) }

  it('a link carries its secret in the fragment and reads back whole', () => {
    const link = inviteLink('Where.Example/', parts)
    expect(link).toBe(`https://where.example/#invite=one.example/${parts.anchor}/${parts.secret}`)
    expect(parseInvite(link)).toEqual(parts)
    expect(new URL(link).search).toBe('')
  })

  it('reads a fragment, an invite= pair, a bare triple and a link in prose', () => {
    const triple = `one.example/${parts.anchor}/${parts.secret}`
    expect(parseInvite(`#invite=${triple}`)).toEqual(parts)
    expect(parseInvite(`invite=${triple}`)).toEqual(parts)
    expect(parseInvite(triple)).toEqual(parts)
    expect(parseInvite(`here you go: https://x.example/#invite=${triple} thanks`)).toEqual(parts)
    expect(inviteLink('localhost:4250', parts).startsWith('http://localhost:4250/')).toBe(true)
  })

  it('refuses anything that is not a host, an anchor and a secret', () => {
    for (const text of ['', 'invite=one.example/short/short', `invite=one.example/${'g'.repeat(64)}/${parts.secret}`,
      `one.example/${parts.anchor}`, `one.example/${parts.anchor}/${parts.secret}0`, 'hello']) {
      expect(parseInvite(text), text).toBeNull()
    }
  })

  it('a link that lands is held and taken out of the address; it is never spent', () => {
    const calls: unknown[][] = []
    const loc = { hash: `#invite=one.example/${parts.anchor}/${parts.secret}`, pathname: '/room', search: '?a=1' }
    expect(captureInvite(loc, { replaceState: (...args) => { calls.push(args) } })).toEqual(parts)
    expect(calls).toEqual([[null, '', '/room?a=1']])
    expect(pendingInvite()).toEqual(parts)
    clearPendingInvite()
    expect(pendingInvite()).toBeNull()
    expect(captureInvite({ hash: '#swarm=x', pathname: '/', search: '' }, { replaceState: () => { throw new Error('untouched') } })).toBeNull()
  })
})

describe('reading a chain', () => {
  it('says why a host gave none', async () => {
    const clock = { now: T0 }
    const h = hosts(clock)
    const a = place(1, clock)
    expect(await fetchKeyChain(ONE, a.pubkey, depsFor(a, h))).toEqual({ ok: false, reason: 'none', status: 404 })
    expect(await fetchKeyChain('down.example', a.pubkey, depsFor(a, h))).toEqual({ ok: false, reason: 'unreachable' })
    expect(await fetchKeyChain(ONE, 'nope', depsFor(a, h))).toEqual({ ok: false, reason: 'malformed' })
    const teapot = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch
    expect(await fetchKeyChain(ONE, a.pubkey, depsFor(a, h, { fetch: teapot }))).toEqual({ ok: false, reason: 'http', status: 500 })
    const notChain = (async () => Response.json({ not: 'a chain' })) as unknown as typeof fetch
    expect(await fetchKeyChain(ONE, a.pubkey, depsFor(a, h, { fetch: notChain }))).toEqual({ ok: false, reason: 'malformed' })
  })

  it('a host cannot substitute a chain that does not verify', async () => {
    const clock = { now: T0 }
    const h = hosts(clock)
    const a = place(1, clock)
    const stranger = place(2, clock)
    expect((await allowAnother([ONE], {}, depsFor(a, h))).ok).toBe(true)
    const chain = h.chains.get(`${ONE}|${a.pubkey}`)!
    const forged = [{ ...chain[0] }, { ...chain[1], content: chain[1].content.replace(/"invites":\[[^\]]*\]/, '"invites":[]') }]
    const lying = (async () => Response.json(forged)) as unknown as typeof fetch
    const read = await fetchKeyChain(ONE, a.pubkey, depsFor(stranger, h, { fetch: lying }))
    expect(read.ok).toBe(false)
    expect(read.ok === false && read.reason).toBe('refused')
  })

  it('the chain URL is the member of sign(keys:lists) named by the anchor, and plain http on loopback', async () => {
    expect(await keyChainUrl('https://One.Example/', 'a'.repeat(64))).toBe(`https://one.example/${POOL}/${'a'.repeat(64)}`)
    expect((await keyChainUrl('localhost:4250', 'a'.repeat(64))).startsWith('http://localhost:4250/')).toBe(true)
  })

  it('a write needs a signer, and says what the host said', async () => {
    const clock = { now: T0 }
    const h = hosts(clock)
    const a = place(1, clock)
    expect(await putKeyChain(ONE, a.pubkey, [], depsFor(a, h, { signer: () => undefined }))).toEqual({ ok: false, reason: 'no signer' })
    const refused = await putKeyChain(ONE, a.pubkey, [], depsFor(a, h))
    expect(refused.ok).toBe(false)
    expect(refused.ok === false && refused.status).toBe(403)
  })
})

describe('whose index is mine', () => {
  it('is the key itself, until an anchor is taken', async () => {
    const clock = { now: T0 }
    const h = hosts(clock)
    const a = place(1, clock)
    const b = place(2, clock)
    expect(await publisherKeyHex({}, depsFor(a, h))).toBe(a.pubkey)
    b.binding.bind!(a.pubkey, [ONE])
    expect(await publisherKeyHex({}, depsFor(b, h))).toBe(a.pubkey)
    expect(await publisherKeyHex({ known: true }, depsFor(b, h))).toBe(a.pubkey)
    expect(await publisherKeyHex({}, depsFor(b, h, { signer: () => undefined }))).toBe('')
    expect(await publisherKeyHex({}, depsFor(b, h, { signer: () => ({ signEvent: a.signer.signEvent, getPublicKeyHex: async () => null }) }))).toBe('')
    expect(await publisherKeyHex({}, { signer: () => a.signer, binding: () => undefined })).toBe(a.pubkey)
  })

  it('an index written for an anchor is tagged for it and names the one it replaces', () => {
    const anchor = 'a'.repeat(64)
    const own = 'b'.repeat(64)
    expect(anchoredTags(anchor, own, 'c'.repeat(64))).toEqual([['anchor', anchor], ['prev', 'c'.repeat(64)]])
    expect(anchoredTags(anchor, own)).toEqual([['anchor', anchor]])
    expect(anchoredTags(anchor, own, 'not-an-id')).toEqual([['anchor', anchor]])
    expect(anchoredTags(own, own, 'c'.repeat(64))).toEqual([])
    expect(anchoredTags('', own)).toEqual([])
  })
})

describe('let another place publish for you', () => {
  const setup = () => {
    const clock = { now: T0 }
    const h = hosts(clock)
    const a = place(1, clock)
    const b = place(2, clock)
    forgetKeyReads()
    return { clock, h, a, b }
  }

  it('begins the list on the first allow, writes it to every host, and hands back a link', async () => {
    const { h, a } = setup()
    const allowed = await allowAnother([ONE, TWO], { where: 'b.example', label: 'laptop' }, depsFor(a, h))
    expect(allowed.ok).toBe(true)
    if (!allowed.ok) return
    expect(allowed.held.sort()).toEqual([ONE, TWO])
    expect(allowed.until).toBe(T0 + INVITE_SECONDS)
    expect(h.chains.get(`${ONE}|${a.pubkey}`)).toHaveLength(2)
    expect(h.chains.get(`${TWO}|${a.pubkey}`)).toHaveLength(2)
    const parts = parseInvite(allowed.link)!
    expect(allowed.link.startsWith('https://b.example/#invite=')).toBe(true)
    expect(parts.anchor).toBe(a.pubkey)
    expect(parts.secret).toBe(Buffer.from(secretOf(99)).toString('hex'))
    // The anchor's own key opened the list, and the list names it with its label.
    const first = readKeyList(h.chains.get(`${ONE}|${a.pubkey}`)![0])!
    expect(first.keys).toEqual([{ pubkey: a.pubkey, label: 'laptop' }])
    expect(readKeyList(h.chains.get(`${ONE}|${a.pubkey}`)![1])!.invites).toEqual([{ pubkey: getPublicKey(secretOf(99)), until: T0 + INVITE_SECONDS }])
  })

  it('another place takes the invite with its OWN key: the list names it, the secret is spent', async () => {
    const { h, a, b } = setup()
    const allowed = await allowAnother([ONE], {}, depsFor(a, h))
    if (!allowed.ok) throw new Error('allow failed')
    b.clock.now = T0 + 120
    const accepted = await acceptInvite(allowed.link, { label: 'b.example' }, depsFor(b, h))
    expect(accepted).toEqual({ ok: true, anchor: a.pubkey, host: ONE, label: 'b.example' })
    expect(b.bound()).toBe(a.pubkey)
    const head = readKeyList(h.chains.get(`${ONE}|${a.pubkey}`)!.at(-1)!)!
    expect(head.keys).toEqual([{ pubkey: a.pubkey }, { pubkey: b.pubkey, label: 'b.example' }])
    expect(head.invites).toEqual([])
    // The host was written to by the new place under its own key, never the anchor's.
    expect(h.writers.at(-1)).toEqual({ host: ONE, signer: b.pubkey })
    // Taking it again changes nothing, and a spent invite is unknown.
    expect((await acceptInvite(allowed.link, {}, depsFor(b, h))).ok && true).toBe(true)
    const c = place(3, b.clock)
    expect(await acceptInvite(allowed.link, {}, depsFor(c, h))).toEqual({ ok: false, reason: 'unknown-invite' })
    // …and the place now publishes for the anchor.
    expect(await publisherKeyHex({}, depsFor(b, h))).toBe(a.pubkey)
  })

  it('refuses an invite after it ends, from the anchor itself, with no list, or at a host that is down', async () => {
    const { h, a, b } = setup()
    const allowed = await allowAnother([ONE], {}, depsFor(a, h))
    if (!allowed.ok) throw new Error('allow failed')
    b.clock.now = T0 + INVITE_SECONDS + 1
    expect(await acceptInvite(allowed.link, {}, depsFor(b, h))).toEqual({ ok: false, reason: 'expired' })
    expect(b.bound()).toBeNull()
    expect(await acceptInvite(allowed.link, {}, depsFor(a, h))).toEqual({ ok: false, reason: 'own-anchor' })
    const parts = parseInvite(allowed.link)!
    expect(await acceptInvite(`invite=${TWO}/${parts.anchor}/${parts.secret}`, {}, depsFor(b, h))).toEqual({ ok: false, reason: 'no-list' })
    expect(await acceptInvite(`invite=down.example/${parts.anchor}/${parts.secret}`, {}, depsFor(b, h))).toEqual({ ok: false, reason: 'unreachable' })
    expect(await acceptInvite('not an invite', {}, depsFor(b, h))).toEqual({ ok: false, reason: 'no-invite' })
    expect(await acceptInvite(allowed.link, {}, depsFor(b, h, { signer: () => undefined }))).toEqual({ ok: false, reason: 'no-signer' })
    // A secret that is not the invite's key: the list does not know it.
    expect(await acceptInvite(`invite=${ONE}/${parts.anchor}/${'7'.repeat(64)}`, {}, depsFor(b, h))).toEqual({ ok: false, reason: 'unknown-invite' })
  })

  it('an acceptance is dated within the invite however far this place\'s clock has run', async () => {
    const { h, a, b } = setup()
    const allowed = await allowAnother([ONE], {}, depsFor(a, h))
    if (!allowed.ok) throw new Error('allow failed')
    // The host's clock says there is a minute left; the new place's clock is an hour ahead.
    const host = hosts({ now: T0 + INVITE_SECONDS - 60 })
    for (const [k, v] of h.chains) host.chains.set(k, v)
    b.clock.now = T0 + 3600
    expect((await acceptInvite(allowed.link, {}, depsFor(b, host, { now: () => T0 + INVITE_SECONDS - 60 }))).ok).toBe(true)
    expect(host.chains.get(`${ONE}|${a.pubkey}`)!.at(-1)!.created_at).toBeLessThanOrEqual(T0 + INVITE_SECONDS)
  })

  it('only a place on the list can let another in', async () => {
    const { h, a, b } = setup()
    const allowed = await allowAnother([ONE], {}, depsFor(a, h))
    if (!allowed.ok) throw new Error('allow failed')
    // b is bound to a's anchor but was never listed.
    b.binding.bind!(a.pubkey, [ONE])
    expect(await allowAnother([ONE], {}, depsFor(b, h))).toEqual({ ok: false, reason: 'not-listed' })
    expect(await allowAnother([], {}, depsFor(a, h))).toEqual({ ok: false, reason: 'no-host' })
    expect(await allowAnother([ONE], {}, depsFor(a, h, { signer: () => undefined }))).toEqual({ ok: false, reason: 'no-signer' })
    expect(await allowAnother(['down.example'], {}, depsFor(a, h))).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('a listed place lets a third in, and lists who publishes', async () => {
    const { clock, h, a, b } = setup()
    const first = await allowAnother([ONE], {}, depsFor(a, h))
    if (!first.ok) throw new Error('allow failed')
    await acceptInvite(first.link, { label: 'b.example' }, depsFor(b, h))
    clock.now += 30
    const c = place(3, clock)
    const second = await allowAnother([ONE], { where: 'c.example' }, depsFor(b, h, { newSecret: () => secretOf(98) }))
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.anchor).toBe(a.pubkey)
    expect((await acceptInvite(second.link, { label: 'c.example' }, depsFor(c, h))).ok).toBe(true)
    const listing = await listKeys([ONE], depsFor(c, h))
    expect(listing?.anchor).toBe(a.pubkey)
    expect(listing?.keys.map(k => [k.label ?? '', k.you, k.anchor])).toEqual([['', false, true], ['b.example', false, false], ['c.example', true, false]])
    expect(listing?.invites).toBe(0)
    expect(await listKeys([TWO], depsFor(c, h))).toBeNull()
  })
})

describe('carrying the chain to another host', () => {
  it('a place that took an invite at one host carries the list to the others before it publishes there', async () => {
    const clock = { now: T0 }
    const h = hosts(clock)
    const a = place(1, clock)
    const b = place(2, clock)
    forgetKeyReads()
    const allowed = await allowAnother([ONE], {}, depsFor(a, h))
    if (!allowed.ok) throw new Error('allow failed')
    await acceptInvite(allowed.link, { label: 'b.example' }, depsFor(b, h))
    expect(anchorServes(TWO)).toBe(false)
    expect(anchorTagFor(`https://${TWO}/x`, b.pubkey, depsFor(b, h))).toBeNull()

    expect(await carryKeyChain(TWO, depsFor(b, h))).toBe('carried')
    expect(h.chains.get(`${TWO}|${a.pubkey}`)).toHaveLength(3)
    expect(anchorServes(TWO)).toBe(true)
    expect(anchorTagFor(`https://${TWO}/x`, b.pubkey, depsFor(b, h))).toEqual(['anchor', a.pubkey])
    expect(await carryKeyChain(TWO, depsFor(b, h))).toBe('held')
    expect(anchorTagFor(`https://${TWO}/x`, a.pubkey, depsFor(a, h))).toBeNull()
    expect(anchorTagFor('not a url', b.pubkey, depsFor(b, h))).toBeNull()
  })

  it('does nothing for a place that is its own anchor, and says so when no host names it', async () => {
    const clock = { now: T0 }
    const h = hosts(clock)
    const a = place(1, clock)
    const b = place(2, clock)
    expect(await carryKeyChain(ONE, depsFor(a, h))).toBe('unbound')
    await prepareAnchorHosts([ONE, TWO], depsFor(a, h))
    expect(h.chains.size).toBe(0)
    b.binding.bind!(a.pubkey, ['elsewhere.example'])
    expect(await carryKeyChain(ONE, depsFor(b, h))).toBe('unlisted')
    expect(await carryKeyChain('down.example', depsFor(b, h))).toBe('unreachable')
  })

  it('a reader asks a host which keys an anchor lists, once, and remembers a "none"', async () => {
    const clock = { now: T0 }
    const h = hosts(clock)
    const a = place(1, clock)
    const b = place(2, clock)
    forgetKeyReads()
    const allowed = await allowAnother([ONE], {}, depsFor(a, h))
    if (!allowed.ok) throw new Error('allow failed')
    await acceptInvite(allowed.link, {}, depsFor(b, h))
    let asked = 0
    const counting = ((input: RequestInfo | URL, init?: RequestInit) => { asked++; return h.fetch(input, init) }) as typeof fetch
    expect([...(await listedKeys(ONE, a.pubkey, depsFor(a, h, { fetch: counting })))!].sort()).toEqual([a.pubkey, b.pubkey].sort())
    await listedKeys(ONE, a.pubkey, depsFor(a, h, { fetch: counting }))
    expect(asked).toBe(1)
    expect(await listedKeys(TWO, a.pubkey, depsFor(a, h))).toBeNull()
  })
})

describe('take a place off', () => {
  const twoPlaces = async () => {
    const clock = { now: T0 }
    const h = hosts(clock)
    const a = place(1, clock)
    const b = place(2, clock)
    forgetKeyReads()
    const allowed = await allowAnother([ONE, TWO], {}, depsFor(a, h))
    if (!allowed.ok) throw new Error('allow failed')
    await acceptInvite(allowed.link, { label: 'desktop' }, depsFor(b, h))
    await carryKeyChain(TWO, depsFor(b, h))
    clock.now += 60
    return { clock, h, a, b }
  }

  it('by label: every host learns it, and the host refuses what that key signs from then on', async () => {
    const { h, a, b } = await twoPlaces()
    const resigned: string[] = []
    const off = await removeKey([ONE, TWO], 'desktop', { resign: async host => { resigned.push(host) } }, depsFor(a, h))
    expect(off.ok).toBe(true)
    if (!off.ok) return
    expect(off.removed).toEqual({ pubkey: b.pubkey, label: 'desktop' })
    expect(off.ownRemoved).toBe(false)
    expect(off.held.sort()).toEqual([ONE, TWO])
    expect(resigned.sort()).toEqual([ONE, TWO])
    for (const host of [ONE, TWO]) {
      expect(readKeyList(h.chains.get(`${host}|${a.pubkey}`)!.at(-1)!)!.keys).toEqual([{ pubkey: a.pubkey }])
    }
    // The removed place is off the list: it can neither be carried nor let anyone in.
    forgetKeyReads()
    expect(await carryKeyChain(ONE, depsFor(b, h))).toBe('unlisted')
    expect(await allowAnother([ONE], {}, depsFor(b, h))).toEqual({ ok: false, reason: 'not-listed' })
  })

  it('by the start of its key; an open invite the same way; and says when nothing or too much matches', async () => {
    const { h, a, b } = await twoPlaces()
    const invite = await allowAnother([ONE, TWO], {}, depsFor(a, h, { newSecret: () => secretOf(98) }))
    expect(invite.ok).toBe(true)
    const inviteKey = getPublicKey(secretOf(98))
    expect(await removeKey([ONE, TWO], 'zzzz', {}, depsFor(a, h))).toEqual({ ok: false, reason: 'no-match' })
    expect(await removeKey([ONE, TWO], '', {}, depsFor(a, h))).toEqual({ ok: false, reason: 'no-match' })
    const open = await removeKey([ONE, TWO], inviteKey.slice(0, 12), {}, depsFor(a, h))
    expect(open.ok).toBe(true)
    expect(readKeyList(h.chains.get(`${ONE}|${a.pubkey}`)!.at(-1)!)!.invites).toEqual([])
    const byKey = await removeKey([ONE, TWO], b.pubkey.slice(0, 12), {}, depsFor(a, h))
    expect(byKey.ok && byKey.removed.pubkey).toBe(b.pubkey)
  })

  it('a place that takes itself off publishes as its own key again, and cannot take off the last key', async () => {
    const { h, a, b } = await twoPlaces()
    const resigned: string[] = []
    const self = await removeKey([ONE, TWO], b.pubkey.slice(0, 12), { resign: async host => { resigned.push(host) } }, depsFor(b, h))
    expect(self.ok && self.ownRemoved).toBe(true)
    expect(resigned).toEqual([])
    expect(b.bound()).toBeNull()
    expect(await publisherKeyHex({}, depsFor(b, h))).toBe(b.pubkey)
    expect(await removeKey([ONE, TWO], a.pubkey.slice(0, 12), {}, depsFor(a, h))).toEqual({ ok: false, reason: 'refused', detail: 'a list keeps at least one key' })
  })

  it('only a place on the list takes another off', async () => {
    const { h, a, b } = await twoPlaces()
    await removeKey([ONE, TWO], 'desktop', {}, depsFor(a, h))
    forgetKeyReads()
    expect(await removeKey([ONE, TWO], a.pubkey.slice(0, 12), {}, depsFor(b, h))).toEqual({ ok: false, reason: 'not-listed' })
    expect(await removeKey([], 'desktop', {}, depsFor(a, h))).toEqual({ ok: false, reason: 'no-host' })
  })
})
