// profile.queen.spec.ts — the profile word (documentation/sealed-audiences.md,
// "Names", step 3). A participant's profile is the COMPLETE signed kind-0 event
// kept as an atom and named in their own index as `nostr:profile`. Showing
// reads only and never mints a key; setting changes one field and keeps the
// rest, always moves forward in time, and says NOT published when any step
// fails. A reader believes an atom only from the right key, of the right kind,
// whose bytes hash to the name.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EffectBus, I18N_IOC_KEY, machineCatalogue } from '@hypercomb/core'
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { decode } from 'nostr-tools/nip19'
import type { HiveIndexResult } from './hive-pointer.js'
import { nip05Name } from './names.service.js'
import {
  PROFILE_REASONS, PROFILE_REASON_TEXT, PROFILE_ROOT_KEY, acceptProfile, imageKindOf, parseProfileWord, profileFieldsOf,
  profileMachineRefusal, profilePicture, profileValue, readProfile, setProfileField, showProfile, type ProfileDeps,
} from './profile.js'

const HOST = 'content.example.com'
const T0 = 1_800_000_000_000
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
const secretOf = (fill: number): Uint8Array => new Uint8Array(32).fill(fill)
/** A signed event's bytes as the atom carries them. */
const atomOf = (event: Record<string, unknown>): Uint8Array => utf8(JSON.stringify(event))
/** Bytes that open the way a PNG does. */
const png = (tail: string): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...utf8(tail)])
/** A picture typed at 1,020 characters whose href is 6,020: percent-encoding. */
const SWOLLEN = `https://example.com/${'é'.repeat(1_000)}`

/** One key, one host (its index and its flat heap), one hive store. */
const world = (options: { cached?: boolean; fill?: number } = {}) => {
  const secret = secretOf(options.fill ?? 7)
  const pubkey = getPublicKey(secret)
  const local = new Map<string, Uint8Array>()
  const served = new Map<string, Uint8Array>()
  const state = {
    roots: null as Record<string, string> | null,
    index: null as HiveIndexResult | null,
    now: T0,
    stampFails: null as string | null,
    publishFails: null as string | null,
    /** Runs as a stamp begins — another tab or device writing the index. */
    beforeStamp: null as (() => void) | null,
  }
  const calls = { signerPubkey: 0, sign: [] as { created_at: number; content: string }[], put: 0, publish: [] as string[][], stamp: [] as string[][] }
  const deps: ProfileDeps = {
    cachedPubkey: () => (options.cached === false ? null : pubkey),
    signerPubkey: async () => { calls.signerPubkey++; return pubkey },
    sign: async event => {
      calls.sign.push({ created_at: event.created_at, content: event.content })
      return finalizeEvent(event, secret) as unknown as Record<string, unknown>
    },
    readIndex: async (_host, key) => state.index
      ?? (state.roots && key === pubkey ? { ok: true, manifest: { roots: state.roots, createdAt: 1, pubkey } } : { ok: false, reason: 'http', status: 404 }),
    readLocal: async sig => local.get(sig) ?? null,
    fetchAtom: async (_host, sig) => served.get(sig) ?? null,
    put: async bytes => { calls.put++; const sig = sha(bytes); local.set(sig, bytes); return sig },
    publish: async (_host, sigs) => {
      calls.publish.push([...sigs])
      if (state.publishFails) return { ok: false, error: state.publishFails }
      for (const sig of sigs) {
        const bytes = local.get(sig)
        if (!bytes) return { ok: false, error: `${sig.slice(0, 12)}… is not held here` }
        served.set(sig, bytes)
      }
      return { ok: true }
    },
    // The contract: name the atom only while the index still names `expected`.
    stamp: async (host, key, sig, expected) => {
      state.beforeStamp?.()
      calls.stamp.push([host, key, sig])
      if (state.stampFails) return { ok: false, reason: state.stampFails }
      if ((state.roots?.[key] ?? null) !== expected) return { ok: false, changed: true }
      state.roots = { ...(state.roots ?? {}), [key]: sig }
      return { ok: true }
    },
    now: () => state.now,
  }
  /** The profile atom the host's index names now, parsed. */
  const published = (): Record<string, unknown> => {
    const sig = state.roots?.[PROFILE_ROOT_KEY]
    expect(sig, 'the index names a profile').toBeTruthy()
    return JSON.parse(new TextDecoder().decode(served.get(sig!)!)) as Record<string, unknown>
  }
  const content = (): Record<string, unknown> => JSON.parse(String(published()['content'])) as Record<string, unknown>
  return { secret, pubkey, local, served, state, calls, deps, published, content }
}

// ── the name rule ───────────────────────────────────────────────────

describe('the name rule', () => {
  it('is read through the one copy in this package, which is the rule hypercomb-relay/nip05-names.js states', async () => {
    const relay = await import(/* @vite-ignore */ pathToFileURL(join(__dirname, '..', '..', '..', 'hypercomb-relay', 'nip05-names.js')).href) as {
      nip05Name: (raw: unknown) => string | null
    }
    const inputs: unknown[] = [
      'jwize', ' JWize ', 'a.b-c_d', '_', ' _ ', '', '   ', 'jaime wize', 'jwize@jwize.com', 'x'.repeat(64), 'x'.repeat(65),
      'café', 'ПРИВЕТ', '__proto__', '0', 'a/b', undefined, null, 42, {}, ['jwize'],
      // Folding traps: these lowercase or trim into ASCII unless the rule checks
      // the name as written first — the Kelvin sign, a dotted capital I, a BOM,
      // a no-break space, an ideographic space.
      '\u212Aate', '\u0130lker', '\uFEFFjaime', '\u00A0jaime', 'jaime\u3000', '\tjwize\n',
    ]
    for (const raw of inputs) expect(nip05Name(raw), JSON.stringify(raw) ?? String(raw)).toBe(relay.nip05Name(raw))
    // profile.ts keeps no copy of its own: what it sets and reads is that rule.
    const source = readFileSync(join(__dirname, 'profile.ts'), 'utf8')
    expect(source).not.toMatch(/\[a-z0-9\._-\]/)
    expect(source).toMatch(/import \{ nip05Name \} from '\.\/names\.service\.js'/)
  })

  it('a set name passes it or is refused — never folded', () => {
    expect(profileValue('name', '  JWize ')).toEqual({ ok: true, value: 'jwize' })
    expect(profileValue('name', 'Jaime Wize')).toEqual({ ok: false, problem: 'badname' })
    expect(profileValue('name', '_')).toEqual({ ok: false, problem: 'badname' })
    expect(profileValue('name', 'x'.repeat(65))).toEqual({ ok: false, problem: 'toolong', max: 64 })
    expect(profileValue('about', 'y'.repeat(281))).toEqual({ ok: false, problem: 'toolong', max: 280 })
    expect(profileValue('about', '  Hello, I make hives.  ')).toEqual({ ok: true, value: 'Hello, I make hives.' })
    expect(profileValue('picture', 'http://example.com/me.png')).toEqual({ ok: false, problem: 'badpicture' })
    expect(profileValue('picture', 'javascript:alert(1)')).toEqual({ ok: false, problem: 'badpicture' })
    expect(profileValue('picture', 'https://example.com/me.png')).toEqual({ ok: true, value: 'https://example.com/me.png' })
    expect(profileValue('picture', 'AB'.repeat(32))).toEqual({ ok: true, value: 'ab'.repeat(32) })
    // A space inside an address is a mistake the URL parser would encode away.
    expect(profileValue('picture', 'https://example.com/me.png @localhost:4250')).toEqual({ ok: false, problem: 'badpicture' })
  })

  it('a picture is judged by the href that is stored, the string a reader judges', () => {
    expect(SWOLLEN.length).toBe(1_020)
    expect(new URL(SWOLLEN).href.length).toBe(6_020)
    // Set and read agree: refused when it is set, dropped when it is read.
    expect(profileValue('picture', SWOLLEN)).toEqual({ ok: false, problem: 'toolong', max: 2_048 })
    expect(profileFieldsOf({ picture: SWOLLEN })).toEqual({})
    // At the cap exactly, both take it; one past, both refuse it.
    const at = `https://example.com/${'a'.repeat(2_048 - 'https://example.com/'.length)}`
    expect(profileValue('picture', at)).toEqual({ ok: true, value: at })
    expect(profileFieldsOf({ picture: at })).toEqual({ picture: at })
    expect(profileValue('picture', `${at}a`)).toMatchObject({ ok: false, problem: 'toolong' })
    expect(profilePicture(`${at}a`)).toBeNull()
  })

  it('a picture by signature must be an image: its first bytes say so, or it is not one', () => {
    const ascii = (text: string): number[] => [...utf8(text)]
    expect(imageKindOf(png('rest'))).toBe('png')
    expect(imageKindOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe('jpeg')
    expect(imageKindOf(utf8('GIF89a…'))).toBe('gif')
    expect(imageKindOf(new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8 ')]))).toBe('webp')
    expect(imageKindOf(new Uint8Array([0, 0, 0, 0x1c, ...ascii('ftypavif'), 0, 0, 0, 0, ...ascii('avifmif1miaf')]))).toBe('avif')
    // AVIF behind another major brand, named among the compatible ones.
    expect(imageKindOf(new Uint8Array([0, 0, 0, 0x18, ...ascii('ftypmif1'), 0, 0, 0, 0, ...ascii('mif1avif')]))).toBe('avif')
    expect(imageKindOf(utf8('<?xml version="1.0"?>\n<!-- drawn -->\n<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg')
    // Not pictures: a note, a layer, a sound, a video, nothing.
    expect(imageKindOf(utf8('a private note: the code is 1234'))).toBeNull()
    expect(imageKindOf(utf8(JSON.stringify({ name: 'drafts', children: [] })))).toBeNull()
    expect(imageKindOf(new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVEfmt ')]))).toBeNull()
    expect(imageKindOf(new Uint8Array([0, 0, 0, 0x18, ...ascii('ftypmp42'), 0, 0, 0, 0, ...ascii('isommp42')]))).toBeNull()
    expect(imageKindOf(utf8('<html><svg></svg></html>'))).toBeNull()
    expect(imageKindOf(new Uint8Array())).toBeNull()
  })
})

// ── showing ─────────────────────────────────────────────────────────

describe('profile — showing', () => {
  it('never mints: with no key known it says so, and signs, puts, publishes and stamps nothing', async () => {
    const w = world({ cached: false })
    expect(await showProfile(HOST, w.deps, () => 'jwize')).toEqual({ kind: 'nokey' })
    expect(w.calls).toEqual({ signerPubkey: 0, sign: [], put: 0, publish: [], stamp: [] })
  })

  it('with a known key and no profile, shows the npub and seeds the name from the mesh label only through the rule', async () => {
    const w = world()
    const shown = await showProfile(HOST, w.deps, () => '  JWize ')
    expect(shown).toMatchObject({ kind: 'none', pubkey: w.pubkey, seed: 'jwize' })
    if (shown.kind !== 'none') throw new Error('expected none')
    expect(decode(shown.npub)).toEqual({ type: 'npub', data: w.pubkey })
    expect(await showProfile(HOST, w.deps, () => 'Jaime Wize')).toMatchObject({ kind: 'none', seed: null })
    expect(await showProfile(HOST, w.deps, () => { throw new Error('SecurityError') })).toMatchObject({ kind: 'none', seed: null })
    expect(w.calls).toEqual({ signerPubkey: 0, sign: [], put: 0, publish: [], stamp: [] })
  })

  it('shows the published profile, this hive\'s copy first, else the host\'s — and the label never overrides it', async () => {
    const w = world()
    expect((await setProfileField(HOST, 'name', 'jwize', w.deps)).ok).toBe(true)
    const before = { ...w.calls, publish: [...w.calls.publish], stamp: [...w.calls.stamp], sign: [...w.calls.sign] }
    expect(await showProfile(HOST, w.deps, () => 'someone')).toMatchObject({ kind: 'shown', profile: { fields: { name: 'jwize' } } })
    w.local.clear()
    expect(await showProfile(HOST, w.deps)).toMatchObject({ kind: 'shown', profile: { fields: { name: 'jwize' } } })
    expect(w.calls).toEqual(before)
  })

  it('an index that cannot be read is said — as a reason code, not as no profile', async () => {
    const w = world()
    w.state.index = { ok: false, reason: 'unreachable' }
    expect(await showProfile(HOST, w.deps)).toMatchObject({ kind: 'unreadable', reason: 'index-unreachable', params: { host: HOST } })
    w.state.index = { ok: false, reason: 'http', status: 503 }
    expect(await showProfile(HOST, w.deps)).toMatchObject({ kind: 'unreadable', reason: 'index-http', params: { host: HOST, status: 503 } })
  })
})

// ── setting ─────────────────────────────────────────────────────────

describe('profile — setting', () => {
  it('the atom is the complete signed event, named by the sha256 of its exact bytes, shipped, then stamped', async () => {
    const w = world()
    const done = await setProfileField(HOST, 'name', 'JWize', w.deps)
    expect(done.ok).toBe(true)
    if (!done.ok) return
    const bytes = w.local.get(done.sig)!
    expect(done.sig).toBe(sha(bytes))
    const event = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
    expect(Object.keys(event)).toEqual(['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig'])
    expect(event).toMatchObject({ pubkey: w.pubkey, kind: 0, tags: [], content: JSON.stringify({ name: 'jwize' }), created_at: T0 / 1000 })
    expect(verifyEvent(event as never)).toBe(true)
    expect(w.calls.publish).toEqual([[done.sig]])
    expect(w.calls.stamp).toEqual([[HOST, 'nostr:profile', done.sig]])
    expect(w.served.get(done.sig)).toEqual(bytes)
  })

  it('merges ONE field and keeps the others', async () => {
    const w = world()
    await setProfileField(HOST, 'name', 'jwize', w.deps)
    await setProfileField(HOST, 'about', 'I make hives.', w.deps)
    await setProfileField(HOST, 'picture', 'https://example.com/me.png', w.deps)
    expect(w.content()).toEqual({ name: 'jwize', about: 'I make hives.', picture: 'https://example.com/me.png' })
    await setProfileField(HOST, 'name', 'leanne', w.deps)
    expect(w.content()).toEqual({ name: 'leanne', about: 'I make hives.', picture: 'https://example.com/me.png' })
    // Only the three fields, in one order, whatever order they were set in.
    expect(String(w.published()['content'])).toBe(JSON.stringify({ name: 'leanne', about: 'I make hives.', picture: 'https://example.com/me.png' }))
  })

  it('created_at only moves forward — within one second, and past a profile dated ahead of this clock', async () => {
    const w = world()
    await setProfileField(HOST, 'name', 'jwize', w.deps)
    await setProfileField(HOST, 'about', 'one', w.deps)
    await setProfileField(HOST, 'about', 'two', w.deps)
    expect(w.calls.sign.map(s => s.created_at)).toEqual([T0 / 1000, T0 / 1000 + 1, T0 / 1000 + 2])
    w.state.now = T0 + 3_600_000
    await setProfileField(HOST, 'about', 'three', w.deps)
    expect(w.calls.sign.at(-1)!.created_at).toBe(T0 / 1000 + 3_600)
    w.state.now = T0
    await setProfileField(HOST, 'about', 'four', w.deps)
    expect(w.calls.sign.at(-1)!.created_at).toBe(T0 / 1000 + 3_601)
    expect(w.published()['created_at']).toBe(T0 / 1000 + 3_601)
  })

  it('two sets at once never both say Published: the one whose base moved is NOT published, and nothing is silently lost', async () => {
    const w = world()
    const [a, b] = await Promise.all([
      setProfileField(HOST, 'name', 'jwize', w.deps),
      setProfileField(HOST, 'about', 'I make hives', w.deps),
    ])
    // Both read the same empty profile; the first stamp moved the index.
    expect(a.ok).toBe(true)
    expect(b).toEqual({ ok: false, reason: 'changed', params: { host: HOST } })
    if (!a.ok) return
    expect(w.state.roots?.[PROFILE_ROOT_KEY]).toBe(a.sig)
    expect(w.content()).toEqual({ name: 'jwize' })
    // Said again, it builds on what is there now.
    expect((await setProfileField(HOST, 'about', 'I make hives', w.deps)).ok).toBe(true)
    expect(w.content()).toEqual({ name: 'jwize', about: 'I make hives' })
  })

  it('another writer naming a different profile between the read and the stamp leaves the index as that writer left it', async () => {
    const w = world()
    const first = await setProfileField(HOST, 'name', 'jwize', w.deps)
    if (!first.ok) throw new Error('the first set should publish')
    const elsewhere = 'f'.repeat(64)
    w.state.beforeStamp = () => { w.state.roots = { ...(w.state.roots ?? {}), [PROFILE_ROOT_KEY]: elsewhere } }
    expect(await setProfileField(HOST, 'about', 'hello', w.deps)).toEqual({ ok: false, reason: 'changed', params: { host: HOST } })
    expect(w.state.roots?.[PROFILE_ROOT_KEY]).toBe(elsewhere)
    // The stamp was told what the set merged from: the profile it read.
    w.state.beforeStamp = null
    w.state.roots = { [PROFILE_ROOT_KEY]: first.sig }
    const seen: (string | null)[] = []
    const stamp = w.deps.stamp
    expect((await setProfileField(HOST, 'about', 'hello', { ...w.deps, stamp: (h, k, s, expected) => { seen.push(expected); return stamp(h, k, s, expected) } })).ok).toBe(true)
    expect(seen).toEqual([first.sig])
  })

  it('a stamp that fails is NOT published: the reason is said and the index still names the old profile', async () => {
    const w = world()
    const first = await setProfileField(HOST, 'name', 'jwize', w.deps)
    w.state.stampFails = 'host said 500: index store down'
    const done = await setProfileField(HOST, 'about', 'never seen', w.deps)
    expect(done).toEqual({ ok: false, reason: 'unstamped', params: { host: HOST, detail: 'host said 500: index store down' } })
    if (!first.ok) throw new Error('the first set should publish')
    expect(w.state.roots?.[PROFILE_ROOT_KEY]).toBe(first.sig)
    expect(w.content()).toEqual({ name: 'jwize' })
  })

  it('a publish that fails is NOT published and never stamped', async () => {
    const w = world()
    w.state.publishFails = `${HOST} does not accept uploads from this key`
    expect(await setProfileField(HOST, 'name', 'jwize', w.deps))
      .toEqual({ ok: false, reason: 'unpublished', params: { host: HOST, detail: `${HOST} does not accept uploads from this key` } })
    expect(w.calls.stamp).toEqual([])
    expect(w.state.roots).toBeNull()
  })

  it('a picture named by signature is published to the same host first, then written as its URL there', async () => {
    const w = world()
    const image = png('a picture, all the same')
    const imageSig = sha(image)
    w.local.set(imageSig, image)
    const done = await setProfileField(HOST, 'picture', imageSig.toUpperCase(), w.deps)
    expect(done.ok).toBe(true)
    if (!done.ok) return
    expect(w.calls.publish).toEqual([[imageSig], [done.sig]])
    expect(w.served.get(imageSig)).toEqual(image)
    expect(w.content()).toEqual({ picture: `https://${HOST}/${imageSig}` })
    // On a loopback host the address is where it went: plain http.
    const loop = await setProfileField('localhost:4250', 'picture', imageSig, w.deps)
    expect(loop.ok && loop.profile.fields.picture).toBe(`http://localhost:4250/${imageSig}`)
  })

  it('a picture signature this hive does not hold stops before anything is asked, published or signed', async () => {
    const w = world()
    const missing = 'c'.repeat(64)
    expect(await setProfileField(HOST, 'picture', missing, w.deps)).toEqual({ ok: false, reason: 'picture-missing', params: { sig: 'c'.repeat(12) } })
    expect(w.calls).toEqual({ signerPubkey: 0, sign: [], put: 0, publish: [], stamp: [] })
  })

  it('a signature naming an atom that is not an image — a note, a layer — is never shipped to the host', async () => {
    const w = world()
    for (const bytes of [utf8('a private note: the door code is 1234'), utf8(JSON.stringify({ name: 'drafts', children: [] }))]) {
      const sig = sha(bytes)
      w.local.set(sig, bytes)
      expect(await setProfileField(HOST, 'picture', sig, w.deps)).toEqual({ ok: false, reason: 'picture-notimage', params: { sig: sig.slice(0, 12) } })
      expect(w.served.has(sig)).toBe(false)
    }
    expect(w.calls).toEqual({ signerPubkey: 0, sign: [], put: 0, publish: [], stamp: [] })
  })

  it('a picture whose stored href is past the cap is refused, so a set never reports what its own reader drops', async () => {
    const w = world()
    expect(await setProfileField(HOST, 'picture', SWOLLEN, w.deps)).toEqual({ ok: false, reason: 'value', params: { field: 'picture' } })
    expect(w.calls.sign).toEqual([])
  })

  it('a current profile that cannot be seen is never overwritten', async () => {
    const w = world()
    w.state.roots = { [PROFILE_ROOT_KEY]: 'd'.repeat(64) }
    const done = await setProfileField(HOST, 'about', 'hello', w.deps)
    expect(done).toEqual({ ok: false, reason: 'atom-missing', params: { host: HOST, sig: 'd'.repeat(12) } })
    w.state.roots = null
    w.state.index = { ok: false, reason: 'forged' }
    expect(await setProfileField(HOST, 'about', 'hello', w.deps)).toEqual({ ok: false, reason: 'index-forged', params: { host: HOST } })
    expect(w.calls.sign).toEqual([])
  })

  it('a signer that hands back another event, or signs with another key, publishes nothing', async () => {
    const w = world()
    const stranger = secretOf(9)
    const other = { ...w.deps, sign: async (event: { kind: number; created_at: number; tags: string[][]; content: string }) => finalizeEvent(event, stranger) as unknown as Record<string, unknown> }
    expect(await setProfileField(HOST, 'name', 'jwize', other)).toEqual({ ok: false, reason: 'signer-key', params: {} })
    const altered = { ...w.deps, sign: async (event: { kind: number; created_at: number; tags: string[][]; content: string }) => finalizeEvent({ ...event, content: '{"name":"mallory"}' }, w.secret) as unknown as Record<string, unknown> }
    expect(await setProfileField(HOST, 'name', 'jwize', altered)).toEqual({ ok: false, reason: 'signer-event', params: {} })
    const refusing = { ...w.deps, sign: async () => { throw new Error('User rejected the request') } }
    expect(await setProfileField(HOST, 'name', 'jwize', refusing)).toEqual({ ok: false, reason: 'sign-failed', params: { detail: 'User rejected the request' } })
    expect(w.calls.put).toBe(0)
    expect(w.calls.publish).toEqual([])
  })

  it('every failure is a reason the word can translate', async () => {
    for (const reason of PROFILE_REASONS) expect(PROFILE_REASON_TEXT[reason], reason).toBeTypeOf('string')
    expect(Object.keys(PROFILE_REASON_TEXT).sort()).toEqual([...PROFILE_REASONS].sort())
  })
})

// ── what a reader believes ──────────────────────────────────────────

describe('profile — acceptance', () => {
  const signed = (fill: number, kind: number, content: unknown, createdAt = 1_700_000_000): Record<string, unknown> =>
    finalizeEvent({ kind, created_at: createdAt, tags: [], content: JSON.stringify(content) }, secretOf(fill)) as unknown as Record<string, unknown>

  it('believes the right key\'s kind-0 event whose bytes hash to the name, and reads its name through the rule', async () => {
    const event = signed(7, 0, { name: 'JWize', about: 'hi', picture: 'https://example.com/me.png', display_name: 'ignored' })
    const bytes = atomOf(event)
    const read = await acceptProfile(bytes, sha(bytes), getPublicKey(secretOf(7)))
    expect(read).toMatchObject({ ok: true, profile: { fields: { name: 'jwize', about: 'hi', picture: 'https://example.com/me.png' }, createdAt: 1_700_000_000 } })
    const unnamed = atomOf(signed(7, 0, { name: 'Jaime Wize', picture: 'javascript:alert(1)' }))
    const plain = await acceptProfile(unnamed, sha(unnamed), getPublicKey(secretOf(7)))
    expect(plain.ok && plain.profile.fields).toEqual({})
  })

  it('refuses another key\'s profile named in this key\'s index', async () => {
    const bytes = atomOf(signed(9, 0, { name: 'mallory' }))
    expect(await acceptProfile(bytes, sha(bytes), getPublicKey(secretOf(7)))).toEqual({ ok: false, reason: 'key' })
  })

  it('refuses an event of another kind', async () => {
    const bytes = atomOf(signed(7, 1, { name: 'jwize' }))
    expect(await acceptProfile(bytes, sha(bytes), getPublicKey(secretOf(7)))).toEqual({ ok: false, reason: 'kind' })
  })

  it('refuses bytes that do not hash to the signature named', async () => {
    const bytes = atomOf(signed(7, 0, { name: 'jwize' }))
    expect(await acceptProfile(bytes, 'e'.repeat(64), getPublicKey(secretOf(7)))).toEqual({ ok: false, reason: 'hash' })
  })

  it('refuses an event altered after it was signed, even when the bytes are named by their own hash', async () => {
    const event = { ...signed(7, 0, { name: 'jwize' }), content: JSON.stringify({ name: 'mallory' }) }
    const bytes = atomOf(event)
    expect(await acceptProfile(bytes, sha(bytes), getPublicKey(secretOf(7)))).toEqual({ ok: false, reason: 'signature' })
  })

  it('a wrong-key atom named in the index is shown as not this key\'s, and a host serving wrong bytes as unreadable', async () => {
    const w = world()
    const foreign = atomOf(signed(9, 0, { name: 'mallory' }))
    const foreignSig = sha(foreign)
    w.served.set(foreignSig, foreign)
    w.state.roots = { [PROFILE_ROOT_KEY]: foreignSig }
    expect(await readProfile(HOST, w.pubkey, w.deps)).toEqual({ state: 'rejected', sig: foreignSig, reason: 'key' })
    expect(await showProfile(HOST, w.deps)).toMatchObject({ kind: 'unreadable', reason: 'rejected-key', params: { sig: foreignSig.slice(0, 12) } })
    // A profile that is not this key's is not a profile: a set starts afresh,
    // replacing exactly the atom it read there.
    const done = await setProfileField(HOST, 'about', 'mine', w.deps)
    expect(done.ok).toBe(true)
    expect(w.content()).toEqual({ about: 'mine' })

    const liar = world()
    const real = atomOf(signed(7, 0, { name: 'jwize' }))
    liar.state.roots = { [PROFILE_ROOT_KEY]: sha(real) }
    liar.served.set(sha(real), utf8('something else entirely'))
    expect(await readProfile(HOST, liar.pubkey, liar.deps)).toEqual({ state: 'unreadable', reason: 'atom-hash', params: { host: HOST, sig: sha(real).slice(0, 12) } })
  })
})

// ── the word ────────────────────────────────────────────────────────

describe('the profile word', () => {
  it('takes prose and URLs verbatim, and a host only FIRST, so the end of an about is the about\'s', () => {
    expect(parseProfileWord('')).toEqual({ form: 'show' })
    expect(parseProfileWord('  @Content.Example.com ')).toEqual({ form: 'show', host: 'content.example.com' })
    expect(parseProfileWord('name JWize')).toEqual({ form: 'set', field: 'name', value: 'JWize' })
    expect(parseProfileWord('about I make hives. See https://x.example/a.b?c=d, or say /help.'))
      .toEqual({ form: 'set', field: 'about', value: 'I make hives. See https://x.example/a.b?c=d, or say /help.' })
    expect(parseProfileWord('@localhost:4250 Picture https://example.com/me.png'))
      .toEqual({ form: 'set', field: 'picture', value: 'https://example.com/me.png', host: 'localhost:4250' })
    expect(parseProfileWord('name jwize@jwize.com')).toEqual({ form: 'set', field: 'name', value: 'jwize@jwize.com' })
    // An about that ends in an @mention keeps it, and goes to the participant's own host.
    expect(parseProfileWord('about I also post on @nostr.com')).toEqual({ form: 'set', field: 'about', value: 'I also post on @nostr.com' })
    expect(parseProfileWord('about contact @Jwize')).toEqual({ form: 'set', field: 'about', value: 'contact @Jwize' })
    expect(parseProfileWord('@cafesociety.me about I also post on @nostr.com'))
      .toEqual({ form: 'set', field: 'about', value: 'I also post on @nostr.com', host: 'cafesociety.me' })
    expect(parseProfileWord('@nobody about follow me')).toEqual({ form: 'badhost', host: 'nobody' })
    expect(parseProfileWord('@ about x')).toEqual({ form: 'badhost', host: '' })
    // A name or a picture is one token: a host left at the end is not taken
    // as one, and not swallowed into the value either.
    expect(parseProfileWord('name jwize @localhost:4250')).toEqual({ form: 'usage' })
    expect(parseProfileWord('picture https://example.com/me.png @localhost:4250')).toEqual({ form: 'usage' })
    expect(parseProfileWord('name')).toEqual({ form: 'usage' })
    expect(parseProfileWord('nickname jwize')).toEqual({ form: 'usage' })
  })

  it('a machine may look, on the participant\'s own host, and nothing else', () => {
    expect(profileMachineRefusal('')).toBeUndefined()
    // A host named in a model's words is never asked.
    expect(profileMachineRefusal('@tracker.example')).toBe("/profile shows the participant's own host; a machine does not name another")
    expect(profileMachineRefusal('@content.example.com')).toBeDefined()
    expect(profileMachineRefusal('@nobody')).toBeDefined()
    expect(profileMachineRefusal('name jwize')).toBe("/profile name publishes under the participant's key; only the participant says it")
    expect(profileMachineRefusal('@content.example.com about hi')).toContain('only the participant says it')
    expect(profileMachineRefusal('picture https://example.com/me.png')).toContain('only the participant says it')
    expect(profileMachineRefusal('nickname x')).toBeDefined()
    expect(profileMachineRefusal('profile')).toBeDefined()
  })

  describe('in the hive', async () => {
    // A hand-held IoC, a store, a host service, a signer, and one host.
    const held = new Map<string, unknown>()
    const ioc = {
      register: (key: string, value: unknown) => { held.set(key, value) },
      get: (key: string) => held.get(key),
      has: (key: string) => held.has(key),
      list: () => [...held.keys()],
      whenReady: () => {},
      onRegister: () => () => {},
    }
    ;(window as unknown as { ioc: unknown }).ioc = ioc
    ;(globalThis as unknown as { ioc: unknown }).ioc = ioc

    const secret = secretOf(11)
    const pubkey = getPublicKey(secret)
    const atoms = new Map<string, Uint8Array>()
    const heap = new Map<string, Uint8Array>()
    const host = { putStatus: 500, index: null as string | null, onIndexGet: null as (() => void) | null }
    // jsdom's Blob has no arrayBuffer(); a browser's does. Read it the jsdom
    // way, and hand back blobs that answer the way a browser's would.
    const bytesOfBlob = (blob: Blob): Promise<Uint8Array> => new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
      reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
      reader.readAsArrayBuffer(blob)
    })
    ioc.register('@hypercomb.social/Store', {
      putResource: async (blob: Blob) => { const bytes = await bytesOfBlob(blob); atoms.set(sha(bytes), bytes); return sha(bytes) },
      getResourceLocal: async (sig: string) => {
        const bytes = atoms.get(sig)
        return bytes ? { arrayBuffer: async () => bytes.slice().buffer } as unknown as Blob : null
      },
    })
    ioc.register('@diamondcoreprocessor.com/HostSyncService', {
      publicHostDomain: () => HOST,
      publishAtoms: async (_host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) => {
        for (const sig of sigs) {
          const bytes = await bytesOf(sig)
          if (!bytes) return { ok: false, error: 'not held' }
          heap.set(sig, bytes)
        }
        return { ok: true, sent: sigs.length, held: 0 }
      },
    })
    const asked = { key: 0 }
    ioc.register('@diamondcoreprocessor.com/NostrSigner', {
      getPublicKeyHex: async () => { asked.key++; return pubkey },
      signEvent: async (event: { kind: number; created_at: number; tags: string[][]; content: string }) => finalizeEvent(event, secret),
    })
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith(`/${pubkey}`)) {
        if (method === 'PUT') {
          if (host.putStatus !== 200) return new Response('no', { status: host.putStatus, headers: { 'X-Reason': 'index store down' } })
          host.index = String(init?.body)
          return new Response('', { status: 200 })
        }
        host.onIndexGet?.()
        return host.index ? new Response(host.index, { status: 200, headers: { 'Content-Type': 'application/json' } }) : new Response('', { status: 404 })
      }
      const sig = url.split('/').pop() ?? ''
      return heap.has(sig) ? new Response(heap.get(sig)!.slice().buffer as ArrayBuffer, { status: 200 }) : new Response('', { status: 404 })
    }) as typeof fetch

    /** The profile the host's index names now, read straight off the host. */
    const onHost = (): Record<string, unknown> => {
      const index = JSON.parse(host.index!) as { content: string }
      const sig = (JSON.parse(index.content) as { roots: Record<string, string> }).roots['nostr:profile']!
      expect(sha(heap.get(sig)!)).toBe(sig)
      const event = JSON.parse(new TextDecoder().decode(heap.get(sig)!)) as { content: string }
      return JSON.parse(event.content) as Record<string, unknown>
    }

    const { ProfileQueenBee } = await import('./profile.queen.js')
    const queen = ioc.get('@diamondcoreprocessor.com/ProfileQueenBee') as InstanceType<typeof ProfileQueenBee>
    const hear = async (...lines: string[]): Promise<{ type: string; message: string }[]> => {
      const heard: { type: string; message: string }[] = []
      const off = EffectBus.on<{ type: string; message: string }>('toast:show', toast => { heard.push(toast) })
      heard.length = 0 // the bus replays the last toast to a new listener
      await Promise.all(lines.map(line => queen.invoke(line)))
      off()
      expect(heard.length, `one toast for each of ${JSON.stringify(lines)}`).toBe(lines.length)
      return heard
    }
    const say = async (args: string): Promise<{ type: string; message: string }> => (await hear(args))[0]!

    it('is the word profile, verbatim, and a machine may only show', () => {
      expect(queen).toBeInstanceOf(ProfileQueenBee)
      expect(queen.command).toBe('profile')
      expect(queen.descriptionKey).toBe('slash.profile')
      expect(queen.rawArgs).toBe(true)
      // The argument only: the census writes the word, so the catalogue says
      // `/profile`, never `/profile profile` — and it says a set is not a machine's.
      expect(queen.machine).toMatchObject({ forms: '', example: '/profile', bare: true, reach: 'additive', scope: 'local' })
      expect(queen.machine!.refuse!(queen.machine!.example.replace(/^\/profile\s*/, ''))).toBeUndefined()
      expect(queen.machine!.consequence).toContain('Shows only')
      const line = machineCatalogue([{ name: 'profile', description: queen.description, machine: queen.machine }], { reach: 'editing', scope: 'network' })
      expect(line.startsWith('/profile - See or set your public profile')).toBe(true)
      expect(line).not.toContain('/profile profile')
      expect(line).toContain('setting a field publishes under their key, so it is theirs alone')
      expect(queen.machine!.refuse!('name jwize')).toContain('only the participant says it')
      expect(queen.machine!.refuse!('@tracker.example')).toBeDefined()
      expect(queen.slashComplete!('pi')).toEqual(['picture '])
      expect(queen.slashComplete!('@cafesociety.me ab')).toEqual(['@cafesociety.me about '])
    })

    it('shows nothing and mints nothing before any key is known', async () => {
      expect(await say('')).toMatchObject({ type: 'warning', message: expect.stringContaining('No key is known in this session yet') })
      // The signer was never asked for a key: asking is what mints one.
      expect(asked.key).toBe(0)
      expect(atoms.size).toBe(0)
    })

    it('says NOT published when the host refuses the index, and published once it takes it', async () => {
      expect(await say('name JWize')).toEqual({ type: 'warning', message: `Your profile was NOT published: your index on ${HOST} was not updated (host said 500: index store down)` })
      host.putStatus = 200
      expect(await say('name JWize')).toEqual({ type: 'success', message: `Published your profile (name) on ${HOST}.` })
      expect(onHost()).toEqual({ name: 'jwize' })
    })

    it('shows what it published, under the key the set resolved', async () => {
      const shown = await say('')
      expect(shown.message).toContain('name: jwize')
      expect(shown.message).toContain(`on ${HOST}`)
      expect(shown.message.startsWith('npub1')).toBe(true)
    })

    it('runs two sets said together one after the other: both land, and neither loses the other\'s field', async () => {
      const heard = await hear('about I make hives', 'picture https://example.com/me.png')
      expect(heard).toEqual([
        { type: 'success', message: `Published your profile (about) on ${HOST}.` },
        { type: 'success', message: `Published your profile (picture) on ${HOST}.` },
      ])
      expect(onHost()).toEqual({ name: 'jwize', about: 'I make hives', picture: 'https://example.com/me.png' })
    })

    it('an about ending in an @mention keeps it, on the participant\'s own host', async () => {
      expect(await say('about I also post on @nostr.com')).toEqual({ type: 'success', message: `Published your profile (about) on ${HOST}.` })
      expect(onHost()).toMatchObject({ about: 'I also post on @nostr.com' })
    })

    it('is NOT published when another device names a different profile while it is being set, and leaves that one standing', async () => {
      const before = host.index!
      const roots = (JSON.parse((JSON.parse(before) as { content: string }).content) as { roots: Record<string, string> }).roots
      const elsewhere = finalizeEvent({
        kind: 30564, created_at: Math.floor(Date.now() / 1000) + 60, tags: [],
        content: JSON.stringify({ v: 1, roots: { ...roots, 'nostr:profile': 'f'.repeat(64) } }),
      }, secret)
      // The set's own read sees the old index; the stamp's read sees the new one.
      let gets = 0
      host.onIndexGet = () => { if (++gets === 2) host.index = JSON.stringify(elsewhere) }
      expect(await say('about from this tab')).toEqual({
        type: 'warning',
        message: `Your profile was NOT published: your profile on ${HOST} changed while this was being set; say it again to build on what is there now`,
      })
      expect(gets).toBe(2)
      expect(host.index).toBe(JSON.stringify(elsewhere))
      host.onIndexGet = null
      host.index = before
    })

    it('says why in the participant\'s language — the reason too, not only the sentence around it', async () => {
      const ja = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'hypercomb-shared', 'i18n', 'ja.json'), 'utf8')) as Record<string, string>
      const fill = (text: string, params: Record<string, unknown> = {}): string => text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
      ioc.register(I18N_IOC_KEY, { t: (key: string, params?: Record<string, unknown>) => (key in ja ? fill(ja[key]!, params) : key) })
      host.putStatus = 500
      try {
        const reason = fill(ja['profile.reason.unstamped']!, { host: HOST, detail: 'host said 500: index store down' })
        expect(await say('about 日本語で')).toEqual({ type: 'warning', message: fill(ja['profile.unpublished']!, { reason }) })
        expect(reason).not.toContain('was not updated')
      } finally {
        held.delete(I18N_IOC_KEY)
        host.putStatus = 200
      }
    })

    it('says what it cannot take, before anything is signed', async () => {
      const note = utf8('a private note: the door code is 1234')
      atoms.set(sha(note), note)
      const before = atoms.size
      const shipped = heap.size
      expect((await say('@nobody about follow me')).message).toBe('nobody is not a host name — put @<domain> right after profile, like profile @example.com.')
      expect((await say('name Jaime Wize')).message).toContain('A name is lowercase letters')
      expect((await say('name jwize @localhost:4250')).message).toContain('For another host, put it first: profile @<host> name <name>.')
      expect((await say(`about ${'y'.repeat(281)}`)).message).toBe('A profile about is at most 280 characters.')
      expect((await say(`picture ${SWOLLEN}`)).message).toBe('A profile picture is at most 2048 characters.')
      expect((await say('picture ftp://example.com/me.png')).message).toContain('A picture is an https:// address')
      expect((await say(`picture ${sha(note)}`)).message)
        .toBe(`Your profile was NOT published: ${sha(note).slice(0, 12)}… is not an image (PNG, JPEG, GIF, WebP, AVIF or SVG)`)
      expect(atoms.size).toBe(before)
      expect(heap.size).toBe(shipped)
    })
  })
})

// ── what it says, in every language ────────────────────────────────

describe('the profile word, in every catalog', () => {
  const dir = join(__dirname, '..', '..', '..', 'hypercomb-shared', 'i18n')
  const catalogs = readdirSync(dir).filter(file => file.endsWith('.json'))
  const read = (file: string): Record<string, string> => JSON.parse(readFileSync(join(dir, file), 'utf8'))
  const en = read('en.json')
  const keys = Object.keys(en).filter(key => key.startsWith('profile.') || key === 'slash.profile')
  const slots = (text: string): string[] => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]!))].sort()

  it('finds every catalog and every outcome', () => {
    expect(catalogs.length).toBeGreaterThanOrEqual(14)
    expect(keys).toEqual(expect.arrayContaining([
      'slash.profile', 'profile.usage', 'profile.shown', 'profile.none', 'profile.set', 'profile.unpublished',
      'profile.badpicture', 'profile.badhost', 'profile.nokey', 'profile.toolong',
      ...PROFILE_REASONS.map(reason => `profile.reason.${reason}`),
    ]))
    expect(slots(en['profile.unpublished']!)).toEqual(['reason'])
  })

  it('the word says what English says when no catalog answers', () => {
    const source = readFileSync(join(__dirname, 'profile.queen.ts'), 'utf8')
    const said = [...source.matchAll(/t\('((?:profile\.|slash\.profile)[\w.]*)', '([^']*)'/g)]
    expect(said.length).toBeGreaterThanOrEqual(10)
    for (const [, key, fallback] of said) expect(fallback, key).toBe(en[key!])
    // Each reason's English, held in profile.ts, is the catalog's.
    for (const reason of PROFILE_REASONS) expect(PROFILE_REASON_TEXT[reason], reason).toBe(en[`profile.reason.${reason}`])
  })

  for (const file of catalogs) {
    it(`${file} says every outcome, with the slots English fills`, () => {
      const catalog = read(file)
      for (const key of keys) {
        expect(catalog[key], `${file} is missing ${key}`).toBeTypeOf('string')
        expect(slots(catalog[key]!), `${file} ${key}`).toEqual(slots(en[key]!))
      }
      // A reason left in English would put an English clause in every toast.
      if (file !== 'en.json') {
        for (const reason of PROFILE_REASONS) expect(catalog[`profile.reason.${reason}`], `${file} ${reason}`).not.toBe(en[`profile.reason.${reason}`])
      }
    })
  }
})
