// sharing/swarm-link.spec.ts — THE LINK CARRIES A KEY; THE HOST HOLDS ONLY
// CIPHERTEXT.
//
// jwize, 2026-10-11: "we host the payload and give the link with a
// signature" — "then the swarm login is retrieved". A login is sealed with a
// fresh key, the blob is addressed by its own sha256, the key rides only in
// the #fragment, and opening checks the signature before anything else.
// Every failure is a reason, never a throw; nothing is logged and nothing
// goes on the bus.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus, SEAL_OVERHEAD_BYTES, meetingPointKey, needsSecret, openWithSecret, sealAtom, sealToSecret } from '@hypercomb/core'
import { meetingRelayOf } from './meeting-invite.js'
import {
  SWARM_BLOB_MAX,
  canonicalSwarmHost,
  openSwarmLink,
  parseSwarmLink,
  publishSwarmLink,
  sealSwarmLogin,
  swarmBlobUrl,
  swarmFetcher,
  swarmFragment,
  swarmLinkText,
  swarmLoginBytes,
  swarmRelayUrl,
  type SwarmFetcher,
  type SwarmLogin,
  type SwarmUploader,
} from './swarm-link.js'

// ── a host that keeps what it is given ─────────────────────────────────
const hosted = new Map<string, Uint8Array>()
const put: SwarmUploader = async ({ url, bytes }) => { hosted.set(url, new Uint8Array(bytes)); return { ok: true } }
const get: SwarmFetcher = async ({ url }) => {
  const bytes = hosted.get(url)
  return bytes ? { ok: true, bytes } : { ok: false, reason: 'missing' }
}

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('')
const sha256 = async (bytes: Uint8Array): Promise<string> =>
  hex(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))
const contains = (haystack: Uint8Array, needle: Uint8Array): boolean => {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

const base64Url = (bytes: Uint8Array): string => {
  let text = ''
  for (const b of bytes) text += String.fromCharCode(b)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const keyBytes = (key: string): Uint8Array =>
  Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0))

/** Host ANY blob under its own sha256 — to hand the opener bytes the sealer
 *  would never make. Returns the parts a link would carry. */
const hostRaw = async (host: string, blob: Uint8Array, raw: Uint8Array): Promise<{ sig: string; key: string; blob: Uint8Array }> => {
  const sig = await sha256(blob)
  hosted.set(swarmBlobUrl(host, sig), blob)
  return { sig, blob, key: base64Url(raw) }
}

/** Seal ANY plaintext with core's door seal, as the sealer does. */
const sealRaw = async (host: string, plain: Uint8Array): Promise<{ sig: string; key: string; blob: Uint8Array }> => {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  return hostRaw(host, await sealToSecret(plain, raw), raw)
}

const LOGIN: SwarmLogin = { host: 'hypercomb.com', location: 'Garden', secret: 'S3cret phrase' }

const consoleSpies: ReturnType<typeof vi.spyOn>[] = []
const busSpies: ReturnType<typeof vi.spyOn>[] = []

beforeEach(() => {
  hosted.clear()
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    consoleSpies.push(vi.spyOn(console, method).mockImplementation(() => undefined))
  }
  busSpies.push(vi.spyOn(EffectBus, 'emit'), vi.spyOn(EffectBus, 'emitTransient'))
})

afterEach(() => {
  // Nothing in this module logs or emits — on success or on any failure.
  const logged = consoleSpies.reduce((n, spy) => n + spy.mock.calls.length, 0)
  const emitted = busSpies.reduce((n, spy) => n + spy.mock.calls.length, 0)
  for (const spy of [...consoleSpies, ...busSpies]) spy.mockRestore()
  consoleSpies.length = 0
  busSpies.length = 0
  expect(logged).toBe(0)
  expect(emitted).toBe(0)
})

describe('the login has one byte form', () => {
  it('is JSON { v, host, location, secret, code? } in that order, the host canonical', () => {
    const text = (login: unknown): string => new TextDecoder().decode(swarmLoginBytes(login)!)
    expect(text({ secret: 'S', location: 'Garden', host: 'HyperComb.com' }))
      .toBe('{"v":1,"host":"hypercomb.com","location":"Garden","secret":"S"}')
    expect(text({ ...LOGIN, code: 'door-7' }))
      .toBe('{"v":1,"host":"hypercomb.com","location":"Garden","secret":"S3cret phrase","code":"door-7"}')
  })

  it('keeps the room and the secret exactly as typed, and leaves an empty code out', () => {
    const text = new TextDecoder().decode(swarmLoginBytes({ host: 'hypercomb.com', location: ' Garden ', secret: 'ÅbC', code: '' })!)
    expect(text).toBe('{"v":1,"host":"hypercomb.com","location":" Garden ","secret":"ÅbC"}')
    expect(new TextDecoder().decode(swarmLoginBytes({ ...LOGIN, code: '   ' })!)).not.toContain('code')
  })

  it('refuses a login with no host, no location or no secret', () => {
    expect(swarmLoginBytes({ location: 'Garden', secret: 'S' })).toBeNull()
    expect(swarmLoginBytes({ host: '', location: 'Garden', secret: 'S' })).toBeNull()
    expect(swarmLoginBytes({ host: 'hypercomb.com', secret: 'S' })).toBeNull()
    expect(swarmLoginBytes({ host: 'hypercomb.com', location: '   ', secret: 'S' })).toBeNull()
    expect(swarmLoginBytes({ host: 'hypercomb.com', location: 'Garden' })).toBeNull()
    expect(swarmLoginBytes({ host: 'hypercomb.com', location: 'Garden', secret: '' })).toBeNull()
    expect(swarmLoginBytes({ host: 'hypercomb.com', location: 'Garden', secret: 7 })).toBeNull()
    expect(swarmLoginBytes(null)).toBeNull()
    expect(swarmLoginBytes('hypercomb.com')).toBeNull()
  })

  it('refuses an access code that is not one, and a login too large for a blob', () => {
    expect(swarmLoginBytes({ ...LOGIN, code: 'two words' })).toBeNull()
    expect(swarmLoginBytes({ ...LOGIN, code: 42 })).toBeNull()
    expect(swarmLoginBytes({ ...LOGIN, secret: 'x'.repeat(SWARM_BLOB_MAX) })).toBeNull()
  })
})

describe('the host is canonical', () => {
  it('folds case, scheme, path and the default port into one lowercase host[:port]', () => {
    for (const variant of ['HyperComb.com', 'wss://hypercomb.com/', 'hypercomb.com:443', 'https://HYPERCOMB.com/x?y#z', ' hypercomb.com ']) {
      expect(canonicalSwarmHost(variant)).toBe('hypercomb.com')
    }
    expect(canonicalSwarmHost('ws://localhost:7777')).toBe('localhost:7777')
    expect(canonicalSwarmHost('hypercomb.com:8443')).toBe('hypercomb.com:8443')
    expect(canonicalSwarmHost('bücher.de')).toBe('xn--bcher-kva.de')
  })

  it('names the same host core\'s room identity does', () => {
    for (const variant of ['HyperComb.com', 'wss://hypercomb.com/', 'hypercomb.com:443', 'ws://localhost:7777', 'bücher.de']) {
      expect(canonicalSwarmHost(variant)).toBe(meetingPointKey(variant))
    }
  })

  it('is empty for no host at all', () => {
    for (const bad of ['', '   ', undefined, null, 42, 'not a host', 'https://user:pw@hypercomb.com', 'wss://']) {
      expect(canonicalSwarmHost(bad)).toBe('')
    }
  })

  it('is a fixed point — canonical twice is canonical once', () => {
    for (const variant of [
      'HyperComb.com', 'wss://hypercomb.com/', 'hypercomb.com:443', 'ws://relay.example:443', 'http://hypercomb.com:443',
      'ws://localhost:80', 'ws://localhost:7777', 'bücher.de', 'wss://bücher.de', '%67ood.com', '[::1]:7777',
    ]) {
      const once = canonicalSwarmHost(variant)
      expect(once).not.toBe('')
      expect(canonicalSwarmHost(once)).toBe(once)
    }
  })

  it('names no host under a scheme the URL standard leaves opaque', () => {
    // An opaque host is not decoded or punycoded, so what it names is not
    // what https:// would reach. None of them is a meeting host.
    for (const opaque of ['foo://good.com%2eevil.com', 'good.com://evil.com', 'foo://%67ood.com', 'foo://bücher.de', 'nostr://bücher.de', 'javascript://hypercomb.com']) {
      expect(canonicalSwarmHost(opaque)).toBe('')
      expect(swarmLoginBytes({ ...LOGIN, host: opaque })).toBeNull()
    }
  })

  it('is the point the room hashes for the relay a tab dials', () => {
    // nostr-mesh swarmHost() is new URL(relay).host; core roomPreimage reads
    // it through meetingPointKey. A relay's canonical host is that point.
    for (const relay of ['wss://hypercomb.com', 'wss://HyperComb.com:443/io', 'ws://localhost:7777', 'ws://localhost:80', 'wss://jwize.com:8443', 'ws://relay.example:443']) {
      expect(canonicalSwarmHost(relay)).toBe(meetingPointKey(new URL(relay).host))
    }
  })

  it('seals every variant to the same canonical host', async () => {
    for (const host of ['HyperComb.com', 'wss://hypercomb.com/', 'hypercomb.com:443']) {
      const published = await publishSwarmLink({ ...LOGIN, host }, put)
      expect(published.ok).toBe(true)
      if (!published.ok) continue
      expect(published.parts.host).toBe('hypercomb.com')
      const opened = await openSwarmLink(published.parts, get)
      expect(opened).toEqual({ ok: true, login: { ...LOGIN, host: 'hypercomb.com' } })
    }
  })

  it('every link a publish hands out opens — no host seals to bytes its opener refuses', async () => {
    let opened = 0
    for (const host of ['ws://relay.example:443', 'http://hypercomb.com:443', 'nostr://bücher.de', 'bücher.de', 'ws://localhost:80', '%67ood.com', 'wss://jwize.com:443/', '[::1]:7777']) {
      const published = await publishSwarmLink({ ...LOGIN, host }, put)
      if (!published.ok) continue
      const result = await openSwarmLink(parseSwarmLink(swarmLinkText('https://jwize.com', published.parts))!, get)
      expect(result.ok, host).toBe(true)
      opened++
    }
    expect(opened).toBe(6)
  })
})

describe('a login carries only a meeting point it is dialled back to', () => {
  it('dials wss://<host>, and ws:// only on a loopback host', () => {
    expect(swarmRelayUrl('hypercomb.com')).toBe('wss://hypercomb.com')
    expect(swarmRelayUrl('jwize.com:8443')).toBe('wss://jwize.com:8443')
    expect(swarmRelayUrl('localhost:7777')).toBe('ws://localhost:7777')
    expect(swarmRelayUrl('127.0.0.1:7777')).toBe('ws://127.0.0.1:7777')
    expect(swarmRelayUrl('')).toBe('')
  })

  it('seals a relay the dial rule gives back whole', async () => {
    for (const relay of ['wss://hypercomb.com', 'wss://hypercomb.com/', 'wss://HyperComb.com:443', 'ws://localhost:7777', 'wss://jwize.com:8443', 'hypercomb.com', 'https://hypercomb.com/']) {
      const published = await publishSwarmLink({ ...LOGIN, host: relay }, put)
      expect(published.ok, relay).toBe(true)
      if (!published.ok) continue
      const opened = await openSwarmLink(published.parts, get)
      if (!opened.ok) throw new Error(`${relay}: ${opened.reason}`)
      expect(swarmRelayUrl(opened.login.host)).toBe(meetingRelayOf(relay.replace(/^https:/, 'wss:')))
    }
  })

  it('refuses a path, a query, or a scheme the dial rule would not choose — the caller hands out #meet=', async () => {
    const never = vi.fn(put)
    for (const relay of [
      'wss://pluginthematrix.com/io', 'hypercomb.com/io', 'https://hypercomb.com/x?y#z', 'wss://hypercomb.com/?room=1',
      'ws://relay.example', 'ws://relay.example:443', 'wss://localhost:7777',
    ]) {
      expect(swarmLoginBytes({ ...LOGIN, host: relay }), relay).toBeNull()
      expect(await publishSwarmLink({ ...LOGIN, host: relay }, never), relay).toEqual({ ok: false, reason: 'malformed' })
    }
    expect(never).not.toHaveBeenCalled()
  })
})

describe('sealing', () => {
  it('addresses the blob by its own sha256, sealed with core\'s door seal under the link\'s key', async () => {
    const sealed = (await sealSwarmLogin(LOGIN))!
    expect(sealed.sig).toBe(await sha256(sealed.blob))
    expect(sealed.key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // One wire format for every sealed atom: core sees what it is.
    expect(needsSecret(sealed.blob)).toBe(true)
    expect(sealed.blob.length).toBe(SEAL_OVERHEAD_BYTES + swarmLoginBytes(LOGIN)!.length)
    expect(Array.from((await openWithSecret(sealed.blob, keyBytes(sealed.key)))!)).toEqual(Array.from(swarmLoginBytes(LOGIN)!))
  })

  it('takes a fresh key for every seal — two seals of one login differ', async () => {
    const a = (await sealSwarmLogin(LOGIN))!
    const b = (await sealSwarmLogin(LOGIN))!
    expect(a.key).not.toBe(b.key)
    expect(a.sig).not.toBe(b.sig)
    expect(Array.from(a.blob)).not.toEqual(Array.from(b.blob))
  })

  it('never puts the secret, the room or the code in the blob or the link', async () => {
    const login = { ...LOGIN, code: 'door-7' }
    const published = await publishSwarmLink(login, put)
    if (!published.ok) throw new Error('publish failed')
    const blob = hosted.get(swarmBlobUrl('hypercomb.com', published.parts.sig))!
    const encode = (s: string): Uint8Array => new TextEncoder().encode(s)
    for (const text of [login.secret, login.location, login.code]) {
      expect(contains(blob, encode(text))).toBe(false)
      expect(swarmLinkText('https://jwize.com', published.parts)).not.toContain(text)
    }
  })

  it('mints a key whose last character a linkifier would never trim', async () => {
    for (let i = 0; i < 64; i++) {
      const sealed = (await sealSwarmLogin(LOGIN))!
      expect(sealed.key).not.toMatch(/[-_]$/)
    }
  })

  it('refuses to seal a login that is not one', async () => {
    expect(await sealSwarmLogin({ host: '', location: 'Garden', secret: 'S' })).toBeNull()
  })
})

describe('the link', () => {
  const parts = { sig: 'ab'.repeat(32), host: 'hypercomb.com', key: 'A'.repeat(42) + 'E' }

  it('is <appOrigin>/#swarm=<sig>@<host>~<key>', () => {
    expect(swarmLinkText('https://jwize.com', parts)).toBe(`https://jwize.com/#swarm=${parts.sig}@hypercomb.com~${parts.key}`)
    expect(swarmLinkText('https://jwize.com/', parts)).toBe(`https://jwize.com/#swarm=${parts.sig}@hypercomb.com~${parts.key}`)
    expect(swarmLinkText('https://jwize.com/#meet=x', parts)).toBe(`https://jwize.com/#swarm=${parts.sig}@hypercomb.com~${parts.key}`)
    expect(swarmFragment(parts)).toBe(`#swarm=${parts.sig}@hypercomb.com~${parts.key}`)
  })

  it('is empty for parts that are not a link\'s', () => {
    expect(swarmFragment({ ...parts, sig: 'nope' })).toBe('')
    expect(swarmFragment({ ...parts, host: '' })).toBe('')
    expect(swarmFragment({ ...parts, key: 'short' })).toBe('')
    expect(swarmLinkText('https://jwize.com', { ...parts, key: 'A'.repeat(42) + 'B' })).toBe('')
  })

  it('reads back from the whole link, the fragment alone, or the text after swarm=', () => {
    const link = swarmLinkText('https://jwize.com', parts)
    expect(parseSwarmLink(link)).toEqual(parts)
    expect(parseSwarmLink(swarmFragment(parts))).toEqual(parts)
    expect(parseSwarmLink(swarmFragment(parts).slice(1))).toEqual(parts)
  })

  it('tolerates the punctuation a sentence or a chat leaves on its end', () => {
    const link = swarmLinkText('https://jwize.com', parts)
    for (const text of [`${link}.`, `(${link})`, `${link}).`, `${link},`, `join us: ${link}!`, `${link} — see you there`, `  ${link}\n`]) {
      expect(parseSwarmLink(text)).toEqual(parts)
    }
  })

  it('canonicalizes a host typed into the link by hand', () => {
    const link = `#swarm=${parts.sig.toUpperCase()}@HyperComb.com:443~${parts.key}`
    expect(parseSwarmLink(link)).toEqual(parts)
    expect(parseSwarmLink(`#swarm=${parts.sig}@localhost:7777~${parts.key}`)).toEqual({ ...parts, host: 'localhost:7777' })
  })

  it('is null for anything that is not a swarm link, and never throws', () => {
    for (const bad of [
      '', 'https://jwize.com/', '#meet=room/secret', `#swarm=${parts.sig}`, `#swarm=${parts.sig}@hypercomb.com`,
      `#swarm=${parts.sig}@~${parts.key}`, `#swarm=${parts.sig.slice(1)}@hypercomb.com~${parts.key}`,
      `#swarm=${parts.sig}@hypercomb.com~${parts.key}x`, `#swarm=${parts.sig}@user@hypercomb.com~${parts.key}`,
      undefined, null, 42, {},
    ]) {
      expect(parseSwarmLink(bad)).toBeNull()
    }
  })

  it('refuses a host slot a minted link never carries — a scheme, an escape, a path', () => {
    // Each of these would name one host in the link text and fetch another.
    for (const host of ['foo://good.com%2eevil.com', 'good.com://evil.com', 'foo://%67ood.com', '%67ood.com', 'foo://bücher.de', 'bücher.de', 'hypercomb.com/io', 'wss://hypercomb.com']) {
      expect(parseSwarmLink(`#swarm=${parts.sig}@${host}~${parts.key}`), host).toBeNull()
    }
  })

  it('refuses a body longer than any link\'s before trimming it — a crafted link cannot hang the tab', () => {
    const started = performance.now()
    expect(parseSwarmLink(`https://a.example/#swarm=${'.'.repeat(100_000)}x`)).toBeNull()
    expect(parseSwarmLink(`#swarm=${parts.sig}@hypercomb.com~${parts.key}${')'.repeat(100_000)}`)).toBeNull()
    expect(performance.now() - started).toBeLessThan(250)
  })
})

describe('the round trip', () => {
  it('publishes, links, parses and opens back to the same login', async () => {
    const login = { ...LOGIN, code: 'door-7' }
    const published = await publishSwarmLink(login, put)
    expect(published.ok).toBe(true)
    if (!published.ok) return
    expect(hosted.has(`https://hypercomb.com/${published.parts.sig}`)).toBe(true)
    const link = swarmLinkText('https://jwize.com', published.parts)
    const parts = parseSwarmLink(`Tap ${link}.`)
    expect(parts).toEqual(published.parts)
    expect(await openSwarmLink(parts!, get)).toEqual({ ok: true, login })
  })

  it('fetches over plain http on a loopback host', async () => {
    const published = await publishSwarmLink({ ...LOGIN, host: 'localhost:7777' }, put)
    if (!published.ok) throw new Error('publish failed')
    expect(hosted.has(`http://localhost:7777/${published.parts.sig}`)).toBe(true)
    expect((await openSwarmLink(published.parts, get)).ok).toBe(true)
  })
})

describe('opening refuses what it must', () => {
  it('a tampered blob — before it is ever decrypted', async () => {
    const published = await publishSwarmLink(LOGIN, put)
    if (!published.ok) throw new Error('publish failed')
    const url = swarmBlobUrl('hypercomb.com', published.parts.sig)
    const blob = hosted.get(url)!
    blob[blob.length - 1] ^= 0x01
    const decrypt = vi.spyOn(crypto.subtle, 'decrypt')
    expect(await openSwarmLink(published.parts, get)).toEqual({ ok: false, reason: 'tampered' })
    expect(decrypt).not.toHaveBeenCalled()
    decrypt.mockRestore()
  })

  it('a wrong key — locked', async () => {
    const a = await publishSwarmLink(LOGIN, put)
    const b = await publishSwarmLink(LOGIN, put)
    if (!a.ok || !b.ok) throw new Error('publish failed')
    expect(await openSwarmLink({ ...a.parts, key: b.parts.key }, get)).toEqual({ ok: false, reason: 'locked' })
  })

  it('an oversize blob — too-large, whatever the fetcher says', async () => {
    const big: SwarmFetcher = async () => ({ ok: true, bytes: new Uint8Array(SWARM_BLOB_MAX + 1) })
    const published = await publishSwarmLink(LOGIN, put)
    if (!published.ok) throw new Error('publish failed')
    expect(await openSwarmLink(published.parts, big)).toEqual({ ok: false, reason: 'too-large' })
  })

  it('a sealed payload with a field missing, an unknown version, or not in its one byte form — malformed', async () => {
    const encode = (s: string): Uint8Array => new TextEncoder().encode(s)
    for (const plain of [
      '{"v":1,"host":"hypercomb.com","location":"Garden"}',
      '{"v":1,"host":"hypercomb.com","secret":"S"}',
      '{"v":1,"location":"Garden","secret":"S"}',
      '{"v":2,"host":"hypercomb.com","location":"Garden","secret":"S"}',
      '{"host":"hypercomb.com","location":"Garden","secret":"S","v":1}',
      '{"v":1,"host":"HyperComb.com","location":"Garden","secret":"S"}',
      '{"v":1,"host":"hypercomb.com","location":"Garden","secret":"S","code":""}',
      '{"v":1,"host":"hypercomb.com","location":"Garden","secret":"S","extra":true}',
      'not json',
    ]) {
      const { sig, key } = await sealRaw('hypercomb.com', encode(plain))
      expect(await openSwarmLink({ sig, host: 'hypercomb.com', key }, get)).toEqual({ ok: false, reason: 'malformed' })
    }
  })

  it('a blob that is not sealed to a secret — the login in the clear, or an atom sealed to its content — malformed', async () => {
    const plain = new TextEncoder().encode('{"v":1,"host":"hypercomb.com","location":"Garden","secret":"S"}')
    const raw = crypto.getRandomValues(new Uint8Array(32))
    const decrypt = vi.spyOn(crypto.subtle, 'decrypt')
    for (const blob of [plain, (await sealAtom(plain)).bytes, (await sealToSecret(new Uint8Array(0), raw)).slice(0, SEAL_OVERHEAD_BYTES)]) {
      const { sig, key } = await hostRaw('hypercomb.com', blob, raw)
      expect(await openSwarmLink({ sig, host: 'hypercomb.com', key }, get)).toEqual({ ok: false, reason: 'malformed' })
    }
    expect(decrypt).not.toHaveBeenCalled()
    decrypt.mockRestore()
  })

  it('takes the sealed host as the truth, not the host the link fetched from', async () => {
    const { sig, key } = await sealRaw('mirror.example', new TextEncoder().encode('{"v":1,"host":"hypercomb.com","location":"Garden","secret":"S"}'))
    expect(await openSwarmLink({ sig, host: 'mirror.example', key }, get))
      .toEqual({ ok: true, login: { host: 'hypercomb.com', location: 'Garden', secret: 'S' } })
  })

  it('parts that are not a link\'s — malformed, without fetching', async () => {
    const fetcher = vi.fn(get)
    const sealed = (await sealSwarmLogin(LOGIN))!
    for (const parts of [
      { sig: 'nope', host: 'hypercomb.com', key: sealed.key },
      { sig: sealed.sig, host: '', key: sealed.key },
      { sig: sealed.sig, host: 'hypercomb.com', key: 'short' },
      null, undefined,
    ]) {
      expect(await openSwarmLink(parts as never, fetcher)).toEqual({ ok: false, reason: 'malformed' })
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('a host that does not answer, or does not hold it — and never a throw', async () => {
    const sealed = (await sealSwarmLogin(LOGIN))!
    const parts = { sig: sealed.sig, host: 'hypercomb.com', key: sealed.key }
    expect(await openSwarmLink(parts, get)).toEqual({ ok: false, reason: 'missing' })
    expect(await openSwarmLink(parts, async () => { throw new Error('offline') })).toEqual({ ok: false, reason: 'unreachable' })
    expect(await openSwarmLink(parts, async () => ({ ok: false, reason: 'weird' }) as never)).toEqual({ ok: false, reason: 'unreachable' })
    expect(await openSwarmLink(parts, async () => undefined as never)).toEqual({ ok: false, reason: 'unreachable' })
    expect(await openSwarmLink(parts, async () => ({ ok: false, reason: 'too-large' }))).toEqual({ ok: false, reason: 'too-large' })
  })
})

describe('publishing', () => {
  it('hands the uploader the canonical host, the blob and its sig', async () => {
    const uploader = vi.fn(put)
    const published = await publishSwarmLink({ ...LOGIN, host: 'wss://HyperComb.com/' }, uploader)
    if (!published.ok) throw new Error('publish failed')
    const request = uploader.mock.calls[0][0]
    expect(request.host).toBe('hypercomb.com')
    expect(request.url).toBe(`https://hypercomb.com/${published.parts.sig}`)
    expect(request.sig).toBe(await sha256(request.bytes))
  })

  it('says why it could not, so the caller hands out a #meet= link instead', async () => {
    const never = vi.fn(put)
    expect(await publishSwarmLink({ ...LOGIN, host: '' }, never)).toEqual({ ok: false, reason: 'no-host' })
    expect(await publishSwarmLink({ ...LOGIN, secret: '' }, never)).toEqual({ ok: false, reason: 'malformed' })
    expect(await publishSwarmLink({ ...LOGIN, location: '' }, never)).toEqual({ ok: false, reason: 'malformed' })
    expect(await publishSwarmLink(null as never, never)).toEqual({ ok: false, reason: 'no-host' })
    expect(never).not.toHaveBeenCalled()
    expect(await publishSwarmLink(LOGIN, async () => ({ ok: false, reason: 'refused' }))).toEqual({ ok: false, reason: 'refused' })
    expect(await publishSwarmLink(LOGIN, async () => ({ ok: false, reason: 'unreachable' }))).toEqual({ ok: false, reason: 'unreachable' })
    expect(await publishSwarmLink(LOGIN, async () => { throw new Error('offline') })).toEqual({ ok: false, reason: 'unreachable' })
    expect(await publishSwarmLink(LOGIN, async () => undefined as never)).toEqual({ ok: false, reason: 'unreachable' })
  })
})

describe('the default fetcher', () => {
  const response = (body: BodyInit | null, init: ResponseInit = {}): Response => new Response(body, init)

  it('asks with no credentials, no referrer and the bare /<sig> URL', async () => {
    const calls: [string, RequestInit][] = []
    const fetcher = swarmFetcher({ fetch: (async (url: string, init: RequestInit) => { calls.push([url, init]); return response(new Uint8Array([1, 2, 3])) }) as typeof fetch })
    const sig = 'cd'.repeat(32)
    const result = await fetcher({ url: swarmBlobUrl('hypercomb.com', sig), host: 'hypercomb.com', sig })
    expect(result.ok).toBe(true)
    expect(calls[0][0]).toBe(`https://hypercomb.com/${sig}`)
    expect(calls[0][1].method).toBe('GET')
    expect(calls[0][1].credentials).toBe('omit')
    expect(calls[0][1].referrerPolicy).toBe('no-referrer')
    expect(calls[0][1].signal).toBeDefined()
  })

  it('reads a missing blob, a fallback page, an error and a dead host as reasons', async () => {
    const sig = 'cd'.repeat(32)
    const ask = (impl: () => Promise<Response>) =>
      swarmFetcher({ fetch: impl as unknown as typeof fetch })({ url: swarmBlobUrl('hypercomb.com', sig), host: 'hypercomb.com', sig })
    expect(await ask(async () => response(null, { status: 404 }))).toEqual({ ok: false, reason: 'missing' })
    expect(await ask(async () => response(null, { status: 410 }))).toEqual({ ok: false, reason: 'missing' })
    expect(await ask(async () => response('<!doctype html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }))).toEqual({ ok: false, reason: 'missing' })
    expect(await ask(async () => response('nope', { status: 500 }))).toEqual({ ok: false, reason: 'unreachable' })
    expect(await ask(async () => { throw new TypeError('Failed to fetch') })).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('stops at the size cap — by its length, or while reading', async () => {
    const sig = 'cd'.repeat(32)
    const ask = (impl: () => Promise<Response>) =>
      swarmFetcher({ fetch: impl as unknown as typeof fetch })({ url: swarmBlobUrl('hypercomb.com', sig), host: 'hypercomb.com', sig })
    expect(await ask(async () => response(new Uint8Array(10), { headers: { 'content-length': String(SWARM_BLOB_MAX + 1) } })))
      .toEqual({ ok: false, reason: 'too-large' })
    let pulled = 0
    const endless = new ReadableStream<Uint8Array>({ pull(controller) { pulled++; controller.enqueue(new Uint8Array(1024)) } })
    expect(await ask(async () => response(endless))).toEqual({ ok: false, reason: 'too-large' })
    expect(pulled).toBeLessThan(10)
    const exact = await ask(async () => response(new Uint8Array(SWARM_BLOB_MAX)))
    expect(exact.ok && new Uint8Array(exact.bytes).length).toBe(SWARM_BLOB_MAX)
  })

  it('gives up on a host that never answers', async () => {
    const sig = 'cd'.repeat(32)
    const hang = ((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })) as typeof fetch
    const result = await swarmFetcher({ fetch: hang, timeoutMs: 20 })({ url: swarmBlobUrl('hypercomb.com', sig), host: 'hypercomb.com', sig })
    expect(result).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('opens a published login end to end over a fetch-shaped host', async () => {
    const published = await publishSwarmLink(LOGIN, put)
    if (!published.ok) throw new Error('publish failed')
    const fetcher = swarmFetcher({
      fetch: (async (url: string) => {
        const bytes = hosted.get(url)
        return bytes ? response(bytes.slice(), { headers: { 'content-type': 'application/octet-stream' } }) : response(null, { status: 404 })
      }) as typeof fetch,
    })
    expect(await openSwarmLink(published.parts, fetcher)).toEqual({ ok: true, login: LOGIN })
  })
})
