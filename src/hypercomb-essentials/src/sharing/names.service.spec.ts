// sharing/names.service.spec.ts — who a key is, seen with its host.
//
// A name the hive shows next to a key is a name a HOST vouched for at
// `/.well-known/nostr.json` (documentation/sealed-audiences.md, Names). These
// pin the reader: one request per host, inverted to pubkey → names, cached in
// memory with a TTL, only the hosts a surface shows or the key itself
// advertised, and the three-step display — verified, else the caller's claim
// with the unverified mark in front, else a short npub.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { npubEncode } from 'nostr-tools/nip19'
import {
  MAX_ADVERTISED_HOSTS, MAX_CLAIM_CHARS, MAX_CONCURRENT_LOOKUPS, MAX_DOCUMENT_BYTES, MAX_HOSTS_PER_KEY,
  NAMES_CHANGED, NAMES_COALESCE_MS, NAMES_FAILURE_TTL_MS, NAMES_TTL_MS, NameService, UNVERIFIED_MARK,
  cleanClaim, isLocalHost, nameHost, namesFromDocument, nip05Name, shortNpub,
} from './names.service.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

type Answer = {
  status?: number
  redirected?: boolean
  body?: string
  headers?: Record<string, string>
  stream?: () => ReadableStream<Uint8Array>
}

const answer = (doc: unknown, status = 200): Answer => ({ status, body: JSON.stringify(doc) })

/** A fake network and a fake clock: host → answer (or a pending promise),
 *  every call recorded. `later` timers run on `settle` when they are a
 *  moment (the coalesced emission) and on `advance` when they fall due. */
const harness = (hosts: Record<string, Answer | Promise<Answer>> = {}, allowLocalHosts = false) => {
  let clock = 1_000_000
  const calls: { url: string; init: RequestInit }[] = []
  const emits: { effect: string; payload: unknown }[] = []
  const timers: { fn: () => void; due: number; moment: boolean }[] = []
  const run = (due: (t: { due: number; moment: boolean }) => boolean): void => {
    for (let i = 0; i < timers.length;) {
      const timer = timers[i]!
      if (due(timer)) { timers.splice(i, 1); timer.fn() } else i++
    }
  }
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    const host = new URL(url).host
    const a = await (hosts[host] ?? Promise.reject(new TypeError('unreachable')))
    const res = new Response(a.stream ? a.stream() : (a.body ?? ''), { status: a.status ?? 200, headers: a.headers })
    if (a.redirected) Object.defineProperty(res, 'redirected', { value: true })
    return res
  }
  const names = new NameService({
    fetch,
    now: () => clock,
    emit: (effect, payload) => { emits.push({ effect, payload }) },
    later: (fn, ms) => { timers.push({ fn, due: clock + ms, moment: ms <= NAMES_COALESCE_MS }) },
    allowLocalHosts,
  })
  return {
    names, calls, emits, hosts,
    /** Let background lookups land, then let a moment pass. */
    settle: async (): Promise<void> => {
      for (let i = 0; i < 4; i++) await new Promise(resolve => setTimeout(resolve, 0))
      run(t => t.moment)
    },
    advance: (ms: number): void => {
      clock += ms
      run(t => !t.moment && t.due <= clock)
    },
  }
}

const versions = (emits: readonly { payload: unknown }[]): number[] =>
  emits.map(e => (e.payload as { version: number }).version)

describe('nip05Name — the hosts\' rule, copied', () => {
  it('trims and lowercases, never folds or invents', () => {
    expect(nip05Name('  Leanne ')).toBe('leanne')
    expect(nip05Name('j.wize_1-x')).toBe('j.wize_1-x')
    expect(nip05Name('lean ne')).toBeNull()
    expect(nip05Name('léanne')).toBeNull()
    expect(nip05Name('x'.repeat(65))).toBeNull()
    expect(nip05Name('')).toBeNull()
    expect(nip05Name('_')).toBeNull()
    expect(nip05Name(undefined)).toBeNull()
  })
})

describe('namesFromDocument — inversion and refusal', () => {
  it('inverts names → pubkey into pubkey → names, in document order', () => {
    const byPubkey = namesFromDocument({ names: { _: A, jwize: A, leanne: B } })!
    expect(byPubkey.get(A)).toEqual(['_', 'jwize'])
    expect(byPubkey.get(B)).toEqual(['leanne'])
  })

  it('a contested name is nobody\'s; the key keeps its other names', () => {
    const byPubkey = namesFromDocument({ names: { Alice: A, alice: B, ann: A } })!
    expect(byPubkey.get(A)).toEqual(['ann'])
    expect(byPubkey.has(B)).toBe(false)
  })

  it('garbage entries say nothing; a document without a names object is not one', () => {
    const byPubkey = namesFromDocument({
      names: { ok: A, short: 'abc', number: 7, 'bad name': B, nested: { x: A }, [`${'y'.repeat(65)}`]: C },
    })!
    expect([...byPubkey]).toEqual([[A, ['ok']]])
    expect(namesFromDocument({ names: [A] })).toBeNull()
    expect(namesFromDocument({ names: 'jwize' })).toBeNull()
    expect(namesFromDocument({})).toBeNull()
    expect(namesFromDocument(null)).toBeNull()
    expect(namesFromDocument([{ names: { a: A } }])).toBeNull()
  })

  it('reads an uppercase hex key as its lowercase self', () => {
    expect(namesFromDocument({ names: { up: A.toUpperCase() } })!.get(A)).toEqual(['up'])
  })
})

describe('NameService — what the hive shows for a key', () => {
  it('asks an advertised host once, for the whole document, and answers name@host', async () => {
    const h = harness({ 'jwize.com': answer({ names: { jwize: A } }) })
    h.names.hint(A, 'jwize.com')
    expect(h.names.nameOf(A)).toBeNull()             // a miss starts the lookup
    await h.settle()
    expect(h.calls.map(c => c.url)).toEqual(['https://jwize.com/.well-known/nostr.json'])
    expect(h.calls[0]!.init.redirect).toBe('error')
    expect(h.names.nameOf(A)).toEqual({ name: 'jwize', host: 'jwize.com', verified: true, display: 'jwize@jwize.com' })
    expect(h.names.label(A, undefined, 'Jaime')).toBe('jwize@jwize.com')
  })

  it('shows the domain\'s own key (_) as just the host — and a real name over it', async () => {
    const h = harness({ 'cafesociety.me': answer({ names: { _: A, leanne: C } }) })
    const h2 = harness({ 'jwize.com': answer({ names: { _: A, jwize: A } }) })
    h.names.hint(A, 'cafesociety.me')
    h2.names.hint(A, 'jwize.com')
    h.names.nameOf(A); h2.names.nameOf(A)
    await h.settle(); await h2.settle()
    expect(h.names.label(A)).toBe('cafesociety.me')
    expect(h.names.nameOf(A)!.name).toBe('_')
    expect(h2.names.label(A)).toBe('jwize@jwize.com')
  })

  it('puts the unverified mark IN FRONT of the caller\'s claim when no host vouches', async () => {
    const h = harness({ 'jwize.com': answer({ names: { other: B } }) })
    h.names.hint(A, 'jwize.com')
    h.names.nameOf(A)
    await h.settle()
    expect(h.names.label(A, undefined, '  Jaime ')).toBe(`${UNVERIFIED_MARK}Jaime`)
    const translated = new NameService({
      fetch: async () => { throw new TypeError('offline') },
      t: (key, params) => `${key}: ${params['name']}`,
    })
    expect(translated.label(A, undefined, 'Jaime')).toBe('names.unverified: Jaime')
  })

  it('a claim cannot hide the mark or pass for a verified name@host', () => {
    const h = harness()
    // Fillers that trim() keeps, bidi overrides, zero-width joiners: all gone,
    // so nothing pads the claim — and the mark leads, so nothing can push it
    // out of an ellipsis-clipped row.
    const padded = `jwize@jwize.com${'ㅤ'.repeat(30)}${'⠀'.repeat(19)}`
    expect(h.names.label(A, undefined, padded)).toBe(`${UNVERIFIED_MARK}jwize@jwize.com`)
    expect(h.names.label(A, undefined, '‮jwize​@⁦jwize.com⁩﻿')).toBe(`${UNVERIFIED_MARK}jwize@jwize.com`)
    expect(cleanClaim('  a  　 b  ')).toBe('a b')
    expect(cleanClaim('ᅟᅠﾠ͏️')).toBe('')
    expect(h.names.label(A, undefined, 'ㅤ⠀')).toBe(shortNpub(A))   // nothing left to claim
    expect(Array.from(cleanClaim('é'.repeat(200)))).toHaveLength(MAX_CLAIM_CHARS)
    expect(cleanClaim('é')).toBe('é')                                  // a real accent stays
    // A verified display can never begin with the mark: no name or host may.
    expect(nip05Name(`${UNVERIFIED_MARK}jwize`)).toBeNull()
    expect(nameHost(`${UNVERIFIED_MARK}jwize.com`)).toBeNull()
  })

  it('falls back to a short npub when there is nothing else', () => {
    const h = harness()
    const npub = npubEncode(A)
    expect(h.names.label(A)).toBe(`${npub.slice(0, 9)}…${npub.slice(-4)}`)
    expect(h.names.label(A, undefined, '   ')).toBe(shortNpub(A))
    expect(shortNpub(A)).toMatch(/^npub1[a-z0-9]{4}…[a-z0-9]{4}$/)
  })

  it('never asks a host named only in free text, and a host-less read asks only advertised hosts', async () => {
    const h = harness({ 'evil.example': answer({ names: { mallory: A } }) })
    expect(h.names.nameOf(A)).toBeNull()
    expect(h.names.label(A, undefined, 'mallory@evil.example')).toBe(`${UNVERIFIED_MARK}mallory@evil.example`)
    await h.settle()
    expect(h.calls).toEqual([])
  })

  it('a host-scoped read asks the host it shows — for that read alone, never the key\'s host elsewhere', async () => {
    // A plate, a zone row, a preview: the pair comes from an unsigned ledger
    // or a link, so it must not decide what EVERY other surface shows for A.
    const h = harness({ 'evil.example': answer({ names: { ceo: A } }) })
    expect(h.names.label(A, 'evil.example', 'Jaime')).toBe(`${UNVERIFIED_MARK}Jaime`)
    await h.settle()
    expect(h.calls.map(c => c.url)).toEqual(['https://evil.example/.well-known/nostr.json'])
    expect(h.names.label(A, 'evil.example')).toBe('ceo@evil.example')     // honest: that host says so
    expect(h.names.nameOf(A)).toBeNull()                                  // … and nobody else hears it
    expect(h.names.label(A, undefined, 'Jaime')).toBe(`${UNVERIFIED_MARK}Jaime`)
  })

  it('a host-scoped read is never refused by the per-key cap', async () => {
    const h = harness({ 'jwize.com': answer({ names: { jwize: A } }) })
    for (let i = 0; i < MAX_HOSTS_PER_KEY; i++) h.names.hint(A, `evil${i}.example`)
    h.names.hint(A, 'jwize.com')                                          // past the cap: not advertised
    expect(h.names.label(A, 'jwize.com', 'Jaime')).toBe(`${UNVERIFIED_MARK}Jaime`)
    await h.settle()
    expect(h.calls.some(c => c.url === 'https://jwize.com/.well-known/nostr.json')).toBe(true)
    expect(h.names.label(A, 'jwize.com', 'Jaime')).toBe('jwize@jwize.com')
  })

  it('asks a host about any key it serves', async () => {
    const h = harness({ 'jwize.com': answer({ names: { jwize: A, leanne: B } }) })
    h.names.hint(A, 'jwize.com')
    h.names.nameOf(B, 'jwize.com')
    await h.settle()
    expect(h.names.label(B, 'jwize.com')).toBe('leanne@jwize.com')
    expect(h.names.nameOf(B)).toBeNull()             // B never advertised a host
    expect(h.calls).toHaveLength(1)
  })

  it('normalizes a host and refuses what is not one', async () => {
    const h = harness({ 'jwize.com': answer({ names: { jwize: A } }) })
    h.names.hint(A, ' HTTPS://JWize.com/some/path?q=1 ')
    h.names.hint(A, 'not a host')
    h.names.hint('not-a-key', 'jwize.com')
    h.names.nameOf(A)
    await h.settle()
    expect(h.calls.map(c => c.url)).toEqual(['https://jwize.com/.well-known/nostr.json'])
    expect(h.names.label(A)).toBe('jwize@jwize.com')
  })

  it('never asks the participant\'s own machine or network from a real origin', async () => {
    const local = [
      'localhost:2401', 'content.localhost:2400', '127.0.0.1', '127.1', '192.168.1.1', '10.0.0.8:80',
      '0x7f.1', '2130706433', 'router', 'intranet:8080', 'printer.local',
    ]
    for (const host of local) expect(isLocalHost(host)).toBe(true)
    for (const host of ['jwize.com', 'cafesociety.me:8443', 'a.b.example']) expect(isLocalHost(host)).toBe(false)

    const h = harness()
    for (const host of local) { h.names.hint(A, host); h.names.nameOf(B, host) }
    h.names.nameOf(A)
    await h.settle()
    expect(h.calls).toEqual([])
  })

  it('a dev hive (itself on loopback) asks a loopback host, over plain http', async () => {
    const h = harness({ 'content.localhost:2400': answer({ names: { dev: A } }) }, true)
    h.names.hint(A, 'content.localhost:2400')
    h.names.nameOf(A)
    await h.settle()
    expect(h.calls[0]!.url).toBe('http://content.localhost:2400/.well-known/nostr.json')
    expect(h.names.label(A)).toBe('dev@content.localhost:2400')
  })

  it('keeps at most a few advertised hosts per key — first hinted wins', async () => {
    const h = harness()
    for (let i = 0; i < MAX_HOSTS_PER_KEY + 3; i++) h.names.hint(A, `h${i}.example`)
    h.names.nameOf(A)
    await h.settle()
    expect(h.calls.map(c => new URL(c.url).host)).toEqual(
      Array.from({ length: MAX_HOSTS_PER_KEY }, (_, i) => `h${i}.example`))
  })

  it('caps advertised hosts across every key — free keys cannot fan the hive out', async () => {
    const h = harness()
    const key = (i: number): string => i.toString(16).padStart(64, '0')
    const keys = Array.from({ length: MAX_ADVERTISED_HOSTS }, (_, i) => key(i + 1))
    // Sybils: each a fresh key, each its own fresh hosts.
    for (const [i, k] of keys.entries()) for (let j = 0; j < MAX_HOSTS_PER_KEY; j++) h.names.hint(k, `s${i}-${j}.example`)
    // A host already advertised still attaches to another key.
    h.names.hint(A, 's0-0.example')
    for (const k of [...keys, A]) h.names.nameOf(k)
    for (let i = 0; i < 3; i++) await h.settle()
    const asked = new Set(h.calls.map(c => new URL(c.url).host))
    expect(asked.size).toBe(MAX_ADVERTISED_HOSTS)
    expect(asked.has('s0-0.example')).toBe(true)
  })

  it('runs at most a few lookups at once; the rest wait their turn and still land', async () => {
    const releases: (() => void)[] = []
    const hosts: Record<string, Promise<Answer>> = {}
    const total = MAX_CONCURRENT_LOOKUPS + 3
    for (let i = 0; i < total; i++) {
      hosts[`q${i}.example`] = new Promise<Answer>(resolve => {
        releases.push(() => resolve(answer({ names: { [`n${i}`]: A } })))
      })
    }
    const h = harness(hosts)
    for (let i = 0; i < total; i++) h.names.nameOf(A, `q${i}.example`)
    await h.settle()
    expect(h.calls).toHaveLength(MAX_CONCURRENT_LOOKUPS)
    for (const release of releases.slice(0, MAX_CONCURRENT_LOOKUPS)) release()
    await h.settle()
    expect(h.calls).toHaveLength(total)
    for (const release of releases.slice(MAX_CONCURRENT_LOOKUPS)) release()
    await h.settle()
    expect(h.names.label(A, `q${total - 1}.example`)).toBe(`n${total - 1}@q${total - 1}.example`)
  })

  it('shares one request per host while it is in flight', async () => {
    let release: (a: Answer) => void = () => {}
    const pending = new Promise<Answer>(resolve => { release = resolve })
    const h = harness({ 'jwize.com': pending })
    h.names.hint(A, 'jwize.com')
    h.names.hint(B, 'jwize.com')
    for (let i = 0; i < 5; i++) { h.names.nameOf(A); h.names.label(B) }
    await h.settle()
    expect(h.calls).toHaveLength(1)
    release(answer({ names: { jwize: A, leanne: B } }))
    await h.settle()
    expect(h.calls).toHaveLength(1)
    expect(h.emits).toEqual([{ effect: NAMES_CHANGED, payload: { version: 1 } }])
    expect(h.names.label(B)).toBe('leanne@jwize.com')
  })

  it('says names:changed once for answers landing together, and not again for the same answer', async () => {
    const h = harness({
      'jwize.com': answer({ names: { jwize: A } }),
      'cafesociety.me': answer({ names: { leanne: B } }),
    })
    h.names.hint(A, 'jwize.com')
    h.names.hint(B, 'cafesociety.me')
    h.names.nameOf(A); h.names.nameOf(B)
    await h.settle()
    expect(h.emits).toEqual([{ effect: NAMES_CHANGED, payload: { version: 1 } }])
    expect(h.names.version).toBe(1)
    h.advance(NAMES_TTL_MS + 1)                      // both answers run out — said once
    await h.settle()
    expect(versions(h.emits)).toEqual([1, 2])
    h.names.nameOf(A); h.names.nameOf(B)             // the surfaces re-read …
    await h.settle()
    expect(h.calls).toHaveLength(4)                  // … what is on screen is asked again …
    expect(versions(h.emits)).toEqual([1, 2])        // … and nothing changed
  })

  it('says nothing for an answer that vouches for no key a surface asked it about', async () => {
    const h = harness({
      'empty.example': answer({ names: {} }),
      'other.example': answer({ names: { someone: C } }),
    })
    h.names.nameOf(A, 'empty.example')
    h.names.nameOf(A, 'other.example')
    await h.settle()
    expect(h.calls).toHaveLength(2)
    expect(h.emits).toEqual([])
    h.advance(NAMES_TTL_MS + 1)                      // and their running out says nothing either
    await h.settle()
    expect(h.emits).toEqual([])
  })

  it('a withdrawn name leaves the screen once its answer runs out — no other host needs to speak', async () => {
    const h = harness({ 'jwize.com': answer({ names: { jwize: A } }) })
    expect(h.names.label(A, 'jwize.com')).toBe(shortNpub(A))
    await h.settle()
    expect(h.names.label(A, 'jwize.com')).toBe('jwize@jwize.com')
    h.hosts['jwize.com'] = answer({ names: {} })     // the host withdraws it
    h.advance(NAMES_TTL_MS - 1)
    await h.settle()
    expect(versions(h.emits)).toEqual([1])           // not due yet
    h.advance(1)
    await h.settle()
    expect(versions(h.emits)).toEqual([1, 2])        // due: the plate re-reads …
    expect(h.names.label(A, 'jwize.com')).toBe('jwize@jwize.com')   // … stale while it is asked again
    await h.settle()
    expect(versions(h.emits)).toEqual([1, 2, 3])
    expect(h.names.label(A, 'jwize.com')).toBe(shortNpub(A))
  })

  it('keeps an answer for the TTL, then asks again — answering stale meanwhile', async () => {
    const h = harness({ 'jwize.com': answer({ names: { jwize: A } }) })
    h.names.hint(A, 'jwize.com')
    h.names.nameOf(A)
    await h.settle()
    h.advance(NAMES_TTL_MS - 1)
    expect(h.names.label(A)).toBe('jwize@jwize.com')
    await h.settle()
    expect(h.calls).toHaveLength(1)
    h.hosts['jwize.com'] = answer({ names: { renamed: A } })
    h.advance(2)
    expect(h.names.label(A)).toBe('jwize@jwize.com')  // stale while the next one is fetched
    await h.settle()
    expect(h.calls).toHaveLength(2)
    expect(h.names.label(A)).toBe('renamed@jwize.com')
    expect(versions(h.emits)).toEqual([1, 2])         // the expiry and the rename, said once
  })

  it('remembers a failure for a shorter while, then tries again', async () => {
    const h = harness()
    h.names.hint(A, 'down.example')
    h.names.nameOf(A)
    await h.settle()
    expect(h.calls).toHaveLength(1)
    h.advance(NAMES_FAILURE_TTL_MS - 1)
    h.names.nameOf(A)
    await h.settle()
    expect(h.calls).toHaveLength(1)
    h.hosts['down.example'] = answer({ names: { back: A } })
    h.advance(2)
    h.names.nameOf(A)
    await h.settle()
    expect(h.calls).toHaveLength(2)
    expect(h.names.label(A)).toBe('back@down.example')
    expect(h.emits).toHaveLength(1)
  })

  it('refuses anything but a 200 names document — and a lost answer is said once', async () => {
    const refusals: Answer[] = [
      answer({ names: { jwize: A } }, 404),
      { status: 200, redirected: true, body: JSON.stringify({ names: { jwize: A } }) },
      { status: 200, body: '<!doctype html><title>index</title>' },
      answer({ names: [A] }),
    ]
    for (const refusal of refusals) {
      const h = harness({ 'jwize.com': refusal })
      h.names.hint(A, 'jwize.com')
      h.names.nameOf(A)
      await h.settle()
      expect(h.names.label(A, undefined, 'Jaime')).toBe(`${UNVERIFIED_MARK}Jaime`)
      expect(h.emits).toEqual([])
    }

    const h = harness({ 'jwize.com': answer({ names: { jwize: A } }) })
    h.names.hint(A, 'jwize.com')
    h.names.nameOf(A)
    await h.settle()
    h.hosts['jwize.com'] = { status: 500, body: '' }
    h.advance(NAMES_TTL_MS + 1)
    h.names.nameOf(A)
    await h.settle()
    expect(h.names.label(A, undefined, 'Jaime')).toBe(`${UNVERIFIED_MARK}Jaime`)
    expect(versions(h.emits)).toEqual([1, 2])
  })

  it('reads a body no further than the cap — a declared length past it is refused unread', async () => {
    let pulls = 0
    const chunk = new Uint8Array(64 * 1024).fill(0x20)
    const endless = (): ReadableStream<Uint8Array> => new ReadableStream({
      pull(controller) { pulls++; controller.enqueue(chunk) },
    }, { highWaterMark: 0 })
    const h = harness({ 'flood.example': { stream: endless } })
    h.names.nameOf(A, 'flood.example')
    await h.settle(); await h.settle()
    expect(h.names.label(A, 'flood.example', 'Jaime')).toBe(`${UNVERIFIED_MARK}Jaime`)
    // Stopped at the first chunk past the cap.
    expect(pulls).toBe(Math.floor(MAX_DOCUMENT_BYTES / chunk.byteLength) + 1)

    let read = false
    const declared = harness({
      'big.example': {
        headers: { 'content-length': String(MAX_DOCUMENT_BYTES + 1) },
        stream: () => new ReadableStream({
          pull(c) { read = true; c.enqueue(new TextEncoder().encode(JSON.stringify({ names: { big: A } }))); c.close() },
        }, { highWaterMark: 0 }),
      },
    })
    declared.names.nameOf(A, 'big.example')
    await declared.settle()
    expect(declared.names.label(A, 'big.example', 'Jaime')).toBe(`${UNVERIFIED_MARK}Jaime`)
    expect(read).toBe(false)

    const fits = harness({ 'ok.example': answer({ names: { ok: A, pad: 'x'.repeat(1000) } }) })
    fits.names.nameOf(A, 'ok.example')
    await fits.settle()
    expect(fits.names.label(A, 'ok.example')).toBe('ok@ok.example')
  })
})

describe('who may tie a key to a host — the call sites', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const read = (...path: string[]): string => readFileSync(join(here, ...path), 'utf8')

  it('only the key\'s own signed layer event, naming bytes, hints its host', () => {
    const swarm = read('swarm.drone.ts')
    expect(swarm.match(/nameService\.hint\(/g) ?? []).toHaveLength(1)
    expect(swarm).toMatch(/\n\s*if \(refs\.length\) for \(const host of domainTags\) nameService\.hint\(pubkey, host\)/)
    // The late-join recovery answer is a responder's unsigned JSON.
    const recovery = swarm.slice(swarm.indexOf('#injectRecoveredVisuals = ('), swarm.indexOf('On-demand peer-cache priming'))
    expect(recovery.length).toBeGreaterThan(0)
    expect(recovery).not.toMatch(/nameService\./)
  })

  it('the surfaces that show a host ask it host-scoped, and never hint it', () => {
    const sites = [
      read('static-peers.drone.ts'),
      read('..', 'presentation', 'tiles', 'publications-view.drone.ts'),
      read('..', '..', '..', 'hypercomb-shared', 'ui', 'preview-banner', 'preview-banner.component.ts'),
    ]
    for (const site of sites) expect(site).not.toMatch(/\.hint\(/)
  })
})
