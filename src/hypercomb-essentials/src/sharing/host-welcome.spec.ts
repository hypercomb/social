import { afterEach, describe, expect, it } from 'vitest'
import { WELCOME_SWARM_RE, cardOnHost, frontPageRoom, readOwnWelcome, shownRoom, welcomeCardBytes, welcomeSwarm, welcomeZone } from './host-welcome.js'
import { guestsCanReach, sealedRoomLink } from './swarm-door-landing.js'

const LINK = `https://swarm.hypercomb.com/#swarm=${'a'.repeat(64)}@hypercomb.com~${'K'.repeat(43)}`
const read = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes))

describe('a zone\'s card may carry its room', () => {
  it('a card without a room is the same bytes it always was', () => {
    expect(new TextDecoder().decode(welcomeCardBytes('realones.online', 'Real Ones', 'People'))).toBe(
      '{"kind":"host:welcome","zone":"realones.online","title":"Real Ones","tagline":"People","links":[]}')
  })

  it('carries a sealed swarm link, and nothing that is not one', () => {
    expect(read(welcomeCardBytes('realones.online', 'Real Ones', '', LINK))).toEqual(
      { kind: 'host:welcome', zone: 'realones.online', title: 'Real Ones', tagline: '', links: [], swarm: LINK })
    for (const bad of ['https://swarm.hypercomb.com/#meet=lecture/rose', 'http://' + LINK.slice(8), 'javascript:alert(1)', LINK + 'x']) {
      expect(welcomeSwarm(bad), bad).toBe('')
    }
    expect(read(welcomeCardBytes('realones.online', 'R', '', 'https://swarm.hypercomb.com/#meet=a/b'))).not.toHaveProperty('swarm')
    expect(welcomeSwarm(`  ${LINK}  `)).toBe(LINK)
  })
})

describe('welcomeZone — a card names its zone, never the zone\'s door', () => {
  it('folds host.<zone> to <zone>, and keeps a zone that only begins like one', () => {
    expect(welcomeZone('host.realones.online')).toBe('realones.online')
    expect(welcomeZone('https://Host.RealOnes.online/about')).toBe('realones.online')
    expect(welcomeZone('host.com')).toBe('host.com')
    expect(welcomeZone('hosting.example')).toBe('hosting.example')
    expect(welcomeZone('nope')).toBe('')
  })
})

describe('sealedRoomLink — one sealed link per room, for invite and for room host', () => {
  const g = globalThis as { ioc?: unknown }
  afterEach(() => { delete g.ioc })

  it('is nothing for a room that meets nowhere a guest can reach — and never asks a host to keep it', async () => {
    let asked = 0
    g.ioc = { get: () => ({ putOne: async () => { asked++; return { ok: true } } }) }
    const landing = async () => 'https://swarm.hypercomb.com'
    for (const relay of ['', 'ws://localhost:7791', 'ws://127.0.0.1:7791', 'ws://[::1]:7791', 'wss://swarm.localhost']) {
      expect(guestsCanReach(relay), relay).toBe(false)
      expect(await sealedRoomLink('lecture', 'rose', relay, undefined, [], landing), relay).toBe('')
    }
    expect(asked).toBe(0)
    expect(guestsCanReach('wss://hypercomb.com')).toBe(true)
  })

  it('is nothing when the host will not keep the sealed login', async () => {
    g.ioc = { get: () => ({ putOne: async () => ({ ok: false, reason: 'refused' }) }) }
    expect(await sealedRoomLink('lecture', 'rose', 'wss://hypercomb.com', undefined, [], async () => 'https://swarm.hypercomb.com')).toBe('')
  })

  it('seals the login on the room\'s host and hands out a link a front page may carry', async () => {
    const kept: { host: string; sig: string }[] = []
    g.ioc = { get: () => ({ putOne: async (host: string, sig: string) => { kept.push({ host, sig }); return { ok: true } } }) }
    const link = await sealedRoomLink('lecture', 'rose', 'wss://hypercomb.com', undefined, ['swarm-room'], async () => 'https://swarm.hypercomb.com')
    expect(link).toMatch(WELCOME_SWARM_RE)
    expect(link.startsWith('https://swarm.hypercomb.com/#swarm=')).toBe(true)
    expect(kept).toHaveLength(1)
    expect(kept[0]!.host).toBe('hypercomb.com')
    // The words never travel in the link.
    expect(link).not.toMatch(/lecture|rose/)
  })
})

describe('readOwnWelcome — a card, none, or unknown; unknown is never none', () => {
  const KEY = 'b'.repeat(64)
  const CARD = 'c'.repeat(64)
  const bytes = new TextEncoder().encode(JSON.stringify({ kind: 'host:welcome', zone: 'realones.online', title: 'Real Ones', tagline: 'People', links: [], swarm: LINK }))
  const base = { publicKey: async () => KEY }
  const index = (roots: Record<string, string>) => async () => ({ ok: true as const, manifest: { roots } as never })

  it('reads the card the participant signs', async () => {
    const r = await readOwnWelcome('hypercomb.com', 'realones.online', { ...base, fetchIndex: index({ 'welcome:realones.online': CARD }), readBytes: async () => bytes })
    expect(r).toEqual({ state: 'card', card: { title: 'Real Ones', tagline: 'People', swarm: LINK } })
  })

  it('none: no index on the host yet, or an index that names no card for the zone', async () => {
    expect(await readOwnWelcome('hypercomb.com', 'realones.online', { ...base, fetchIndex: async () => ({ ok: false, reason: 'http', status: 404 }) })).toEqual({ state: 'none' })
    expect(await readOwnWelcome('hypercomb.com', 'realones.online', { ...base, fetchIndex: index({}) })).toEqual({ state: 'none' })
  })

  it('none: a card the host answers it no longer holds — so a word can sign a fresh one', async () => {
    expect(await readOwnWelcome('hypercomb.com', 'realones.online', { ...base, fetchIndex: index({ 'welcome:realones.online': CARD }), readBytes: async () => 'gone' })).toEqual({ state: 'none' })
    const status = (code: number) => (async () => new Response('', { status: code })) as unknown as typeof fetch
    expect(await cardOnHost('hypercomb.com', CARD, status(404))).toBe('gone')
    expect(await cardOnHost('hypercomb.com', CARD, status(503))).toBe(null)
    expect(await cardOnHost('hypercomb.com', CARD, (async () => { throw new TypeError('offline') }) as unknown as typeof fetch)).toBe(null)
  })

  it('unknown: an index or a card that could not be read, or no key to ask with', async () => {
    expect((await readOwnWelcome('hypercomb.com', 'realones.online', { ...base, fetchIndex: async () => ({ ok: false, reason: 'unreachable' }) })).state).toBe('unknown')
    expect((await readOwnWelcome('hypercomb.com', 'realones.online', { ...base, fetchIndex: async () => ({ ok: false, reason: 'http', status: 503 }) })).state).toBe('unknown')
    expect((await readOwnWelcome('hypercomb.com', 'realones.online', { ...base, fetchIndex: index({ 'welcome:realones.online': CARD }), readBytes: async () => null })).state).toBe('unknown')
    expect((await readOwnWelcome('hypercomb.com', 'realones.online', { publicKey: async () => null })).state).toBe('unknown')
  })
})

describe('frontPageRoom — what the page itself shows', () => {
  const page = (html: string, ok = true) => (async () => new Response(html, { status: ok ? 200 : 502 })) as unknown as typeof fetch

  it('reads the room the worker wrote into the page', async () => {
    const card = JSON.stringify({ title: 'Real Ones', tagline: '', links: [], swarm: LINK }).replace(/</g, '\\u003c')
    expect(await frontPageRoom('realones.online', page(`<head><script id="hc-welcome" type="application/json">${card}</script></head>`)))
      .toEqual({ read: true, card: true, swarm: LINK })
  })

  it('a page with no signed card is its own site; a page that will not answer is unread', async () => {
    expect(await frontPageRoom('hypercomb.com', page('<head><title>hypercomb</title></head>'))).toEqual({ read: true, card: false, swarm: '' })
    expect(await frontPageRoom('realones.online', page('', false))).toEqual({ read: false })
  })
})

describe('shownRoom — the front page, else the door at host.<zone>', () => {
  // A host missing from the table does not answer (DNS, or a page a hive may not read).
  const pages = (byHost: Record<string, string>) => (async (url: string) => {
    const html = byHost[new URL(url).host]
    if (html === undefined) throw new TypeError('unreachable')
    return new Response(html, { status: 200 })
  }) as unknown as typeof fetch
  const carrying = (swarm: string) =>
    `<head><script id="hc-welcome" type="application/json">${JSON.stringify({ title: 'R', tagline: '', links: [], swarm })}</script></head>`

  it('reads the front page when it carries the card', async () => {
    expect(await shownRoom('realones.online', pages({ 'realones.online': carrying(LINK), 'host.realones.online': carrying('') })))
      .toEqual({ at: 'realones.online', page: { read: true, card: true, swarm: LINK } })
  })

  it('reads the door when the front page is its own site, or will not answer', async () => {
    expect(await shownRoom('hypercomb.com', pages({ 'hypercomb.com': '<head></head>', 'host.hypercomb.com': carrying(LINK) })))
      .toEqual({ at: 'host.hypercomb.com', page: { read: true, card: true, swarm: LINK } })
    expect(await shownRoom('hypercomb.com', pages({ 'host.hypercomb.com': carrying(LINK) })))
      .toEqual({ at: 'host.hypercomb.com', page: { read: true, card: true, swarm: LINK } })
  })

  it('no card seen is no answer while a page that may carry it did not answer — and names that page', async () => {
    // An apex that opens on a creation answers without a card; the door that carries the room does not answer.
    expect(await shownRoom('realones.online', pages({ 'realones.online': '<head></head>' })))
      .toEqual({ at: 'host.realones.online', page: { read: false } })
    expect(await shownRoom('hypercomb.com', pages({ 'host.hypercomb.com': '<head></head>' })))
      .toEqual({ at: 'hypercomb.com', page: { read: false } })
  })

  it('keeps the front page\'s answer when the door shows no card either', async () => {
    expect(await shownRoom('realones.online', pages({ 'realones.online': '<head></head>', 'host.realones.online': '<head></head>' })))
      .toEqual({ at: 'realones.online', page: { read: true, card: false, swarm: '' } })
    expect(await shownRoom('realones.online', pages({}))).toEqual({ at: 'realones.online', page: { read: false } })
  })
})
