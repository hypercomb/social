// domain-claim.spec.ts — claiming a domain is one word: the hive asks its host
// under the participant's key, names the two nameservers, keeps asking until
// the claim settles, never runs two watches for one domain, and never says
// "yours" on the public reading alone.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import {
  CLAIM_LOST_AFTER, CLAIM_MAX_AGE_MS, DOMAIN_CLAIMS_KEY, DomainClaims, claimDomain, claimHost, claimStateOf, claimStatusUrl, claimUrl,
  readClaims, type ClaimIo, type ClaimReport,
} from './domain-claim.js'

const NS = ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com']
const T0 = 1_700_000_000_000
const DOMAIN = 'inspiredbyhumans.org'
const HOST = 'pluginthematrix.com'

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const prose = (status: number, reason: string): Response =>
  new Response(`${reason}\n`, { status, headers: { 'Content-Type': 'text/plain', 'X-Reason': reason } })

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>

const memoryStorage = () => {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, String(value)) },
    removeItem: (key: string) => { map.delete(key) },
  }
}

const world = (route: Route, options: { unsigned?: boolean; storage?: ClaimIo['storage'] } = {}) => {
  const calls: { url: string; init?: RequestInit }[] = []
  const signed: { url: string; method: string; body?: string }[] = []
  const reports: ClaimReport[] = []
  const copied: string[] = []
  const storage = memoryStorage()
  const clock = { now: T0 }
  const timers = new Map<number, () => void>()
  let nextTimer = 1
  const io: ClaimIo = {
    fetch: async (url, init) => { calls.push({ url, init }); return route(url, init) },
    // Read at call time, so a test can take the signer away mid-claim.
    authorize: async (url, method, body) => { signed.push({ url, method, body }); return options.unsigned ? null : `Nostr ${method} ${url}` },
    storage: options.storage === undefined ? storage : options.storage,
    now: () => clock.now,
    copy: async text => { copied.push(text); return true },
    every: tick => { const id = nextTimer++; timers.set(id, tick); return id },
    cancel: handle => { timers.delete(handle as number) },
  }
  const claims = new DomainClaims(io, report => reports.push(report), HOST)
  /** Every watch ticks once, and the questions they asked are answered. */
  const tick = async (): Promise<void> => {
    for (const run of [...timers.values()]) run()
    for (let turn = 0; turn < 6; turn++) await new Promise(resolve => setTimeout(resolve, 0))
  }
  const kinds = (): string[] => reports.map(report => report.kind)
  const methods = (): (string | undefined)[] => calls.map(call => call.init?.method)
  return { claims, calls, signed, reports, copied, storage, clock, timers, tick, kinds, methods, options }
}

const pending = (): Response => json(200, { domain: DOMAIN, status: 'pending', nameservers: NS })
const active = (): Response => json(200, { domain: DOMAIN, status: 'active', nameservers: NS })
const contested = (): Response => json(409, { domain: DOMAIN, status: 'contested', nameservers: NS })

/**
 * A host. The public reading (GET) answers `status.now`; the signed ask (POST)
 * answers `signed.now` — for the holder, the claim as it stands.
 */
const host = (post: () => Response = pending) => {
  const status = { now: pending }
  const signed = { now: post }
  const route: Route = (_url, init) => (init?.method === 'POST' ? signed.now() : status.now())
  return { status, signed, route }
}

describe('a domain name', () => {
  it('is folded to what the host is asked for: lower case, ASCII, no scheme, path or trailing dot', () => {
    expect(claimDomain('InspiredByHumans.ORG')).toBe('inspiredbyhumans.org')
    expect(claimDomain(' https://www.example.org/about?x#y ')).toBe('www.example.org')
    expect(claimDomain('example.org.')).toBe('example.org')
    expect(claimDomain('bücher.de')).toBe('xn--bcher-kva.de')
  })

  it('refuses what no registrar sells: a single label, an address, a port, a special-use name, a bad label', () => {
    for (const bad of ['', 'localhost', 'example', '192.168.1.1', 'example.org:8080', 'me@example.org', 'site.test',
      'shop.localhost', 'a_b.com', '-bad.com', 'bad-.com', 'two words.com', '*.example.org']) {
      expect(claimDomain(bad), bad).toBe('')
    }
  })
})

describe('the signed ask', () => {
  it('signs the exact body it sends — the host refuses a claim whose signature does not cover its body', async () => {
    const w = world(host().route)
    await w.claims.claim(DOMAIN)
    const post = w.calls.find(call => call.init?.method === 'POST')
    expect(post?.init?.body).toBe(JSON.stringify({ domain: DOMAIN }))
    expect(w.signed.filter(ask => ask.method === 'POST')).toEqual([{ url: claimUrl(HOST), method: 'POST', body: post?.init?.body }])
  })
})

describe('the host a claim is made on', () => {
  it('is the write face: the zone ROOT, never the retired content. face; loopback is its own face', () => {
    expect(claimHost('pluginthematrix.com')).toBe('pluginthematrix.com')
    expect(claimHost('@content.pluginthematrix.com')).toBe('pluginthematrix.com')
    expect(claimHost('https://Content.PluginTheMatrix.com/')).toBe('pluginthematrix.com')
    expect(claimHost('localhost:8787')).toBe('localhost:8787')
    // `content.com` is a domain of its own, not a face in front of one.
    expect(claimHost('content.com')).toBe('content.com')
    expect(claimHost('not a host')).toBe('')
    expect(claimUrl('pluginthematrix.com')).toBe('https://pluginthematrix.com/claim')
    expect(claimUrl('localhost:8787')).toBe('http://localhost:8787/claim')
    expect(claimStatusUrl('pluginthematrix.com', 'inspiredbyhumans.org')).toBe('https://pluginthematrix.com/claim/inspiredbyhumans.org')
  })
})

describe("the host's answer", () => {
  it('is checked field by field: a known status, the domain asked about, nameservers when pending', () => {
    expect(claimStateOf({ domain: 'inspiredbyhumans.org', status: 'pending', nameservers: [...NS, 'ADA.ns.cloudflare.com.', 7] }, 'inspiredbyhumans.org'))
      .toEqual({ domain: 'inspiredbyhumans.org', status: 'pending', nameservers: NS })
    expect(claimStateOf({ domain: 'inspiredbyhumans.org', status: 'active' })).toEqual({ domain: 'inspiredbyhumans.org', status: 'active', nameservers: [] })
    expect(claimStateOf({ domain: 'inspiredbyhumans.org', status: 'pending', nameservers: [] })).toBeNull()
    expect(claimStateOf({ domain: 'other.org', status: 'active' }, 'inspiredbyhumans.org')).toBeNull()
    expect(claimStateOf({ domain: 'inspiredbyhumans.org', status: 'granted' })).toBeNull()
    expect(claimStateOf(null)).toBeNull()
    expect(claimStateOf([{ status: 'active' }])).toBeNull()
  })
})

describe('domain claim <domain>', () => {
  it('signs a POST for the exact URL, names the nameservers, copies them, keeps the claim and watches it', async () => {
    const w = world(host().route)
    const report = await w.claims.claim('InspiredByHumans.org')

    expect(w.calls).toHaveLength(1)
    const [{ url, init }] = w.calls
    expect(url).toBe('https://pluginthematrix.com/claim')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Nostr POST https://pluginthematrix.com/claim')
    expect(JSON.parse(String(init?.body))).toEqual({ domain: 'inspiredbyhumans.org' })

    expect(report).toEqual({ kind: 'pending', domain: 'inspiredbyhumans.org', host: 'pluginthematrix.com', nameservers: NS, again: false, copied: true })
    expect(w.reports).toEqual([report])
    expect(w.copied).toEqual([NS.join('\n')])
    expect(readClaims(w.storage)).toEqual({ 'inspiredbyhumans.org': { host: 'pluginthematrix.com', nameservers: NS, since: T0, status: 'pending' } })
    expect(w.claims.watching).toEqual(['inspiredbyhumans.org'])
    expect(w.timers.size).toBe(1)
  })

  it('said again, checks at once instead of claiming again — and still runs one watch', async () => {
    const w = world(host().route)
    await w.claims.claim(DOMAIN)
    w.clock.now += 5 * 60_000
    const again = await w.claims.claim(DOMAIN)

    expect(w.methods()).toEqual(['POST', 'GET'])
    expect(w.calls[1].url).toBe('https://pluginthematrix.com/claim/inspiredbyhumans.org')
    expect(again).toMatchObject({ kind: 'pending', again: true, nameservers: NS })
    expect(readClaims(w.storage)[DOMAIN].since).toBe(T0)
    expect(w.timers.size).toBe(1)
  })

  it('goes to the host it is told: @<host> is that host\'s write face', async () => {
    const w = world(() => pending())
    await w.claims.claim(DOMAIN, '@hypercomb.com')
    expect(w.calls[0].url).toBe('https://hypercomb.com/claim')
    expect(readClaims(w.storage)[DOMAIN].host).toBe('hypercomb.com')
  })

  it('settles at once when the host answers the signed claim active — that answer is already the participant\'s', async () => {
    const w = world(() => active())
    const report = await w.claims.claim(DOMAIN)
    expect(report).toEqual({ kind: 'active', domain: DOMAIN, host: HOST })
    expect(w.methods()).toEqual(['POST'])
    expect(w.storage.map.has(DOMAIN_CLAIMS_KEY)).toBe(false)
    expect(w.timers.size).toBe(0)
  })

  it('says how to use it, and refuses a name or a host it cannot ask for — without asking', async () => {
    const w = world(() => pending())
    expect(await w.claims.claim('')).toEqual({ kind: 'usage' })
    expect(await w.claims.claim('localhost')).toEqual({ kind: 'invalid', text: 'localhost' })
    expect(await w.claims.claim(DOMAIN, '@not a host')).toEqual({ kind: 'badhost', host: 'not a host' })
    expect(w.calls).toEqual([])
    expect(w.kinds()).toEqual(['usage', 'invalid', 'badhost'])
  })

  it('reports each refusal with its reason, and keeps nothing', async () => {
    const cases: [Response | 'throw', Partial<ClaimReport>][] = [
      [prose(503, 'this host takes no claims'), { kind: 'unconfigured', host: 'pluginthematrix.com' }],
      [prose(404, 'nothing here'), { kind: 'unconfigured' }],
      [prose(409, 'already served here'), { kind: 'refused', reason: 'already served here' }],
      [prose(409, 'one pending claim per key'), { kind: 'refused', reason: 'one pending claim per key' }],
      [prose(429, 'try later'), { kind: 'refused', reason: 'try later' }],
      [new Response('<html>oops</html>', { status: 500, headers: { 'X-Reason': 'upstream failed' } }), { kind: 'refused', reason: 'upstream failed' }],
      [json(200, { hello: 'world' }), { kind: 'refused', reason: 'the host answered something that is not a claim' }],
      ['throw', { kind: 'unreachable' }],
    ]
    for (const [answer, expected] of cases) {
      const w = world(() => { if (answer === 'throw') throw new TypeError('Failed to fetch'); return answer })
      expect(await w.claims.claim(DOMAIN)).toMatchObject({ domain: DOMAIN, ...expected })
      expect(w.storage.map.has(DOMAIN_CLAIMS_KEY)).toBe(false)
      expect(w.timers.size).toBe(0)
    }
  })

  it('a contested claim is an answer even on a refusal status, and it is watched', async () => {
    const w = world(() => contested())
    expect(await w.claims.claim(DOMAIN)).toEqual({ kind: 'contested', domain: DOMAIN, host: HOST })
    expect(readClaims(w.storage)[DOMAIN].status).toBe('contested')
    expect(w.timers.size).toBe(1)
  })

  it('with no signer, asks nothing and says so', async () => {
    const w = world(() => pending(), { unsigned: true })
    expect(await w.claims.claim(DOMAIN)).toMatchObject({ kind: 'unsigned', domain: DOMAIN })
    expect(w.calls).toEqual([])
  })
})

describe('the watch', () => {
  it('is quiet while the claim waits, and says "yours" only once the host answers the participant\'s own key with it', async () => {
    const h = host()
    const w = world(h.route)
    await w.claims.claim(DOMAIN)
    await w.tick()
    expect(w.kinds()).toEqual(['pending'])

    h.status.now = active
    h.signed.now = active
    await w.tick()
    expect(w.kinds()).toEqual(['pending', 'active'])
    // The public reading said active; the signed ask is what made it theirs.
    expect(w.methods()).toEqual(['POST', 'GET', 'GET', 'POST'])
    const confirm = w.calls[3]
    expect(confirm.url).toBe('https://pluginthematrix.com/claim')
    expect((confirm.init?.headers as Record<string, string>)['Authorization']).toBe('Nostr POST https://pluginthematrix.com/claim')
    expect(w.storage.map.has(DOMAIN_CLAIMS_KEY)).toBe(false)
    expect(w.timers.size).toBe(0)
    expect(w.claims.watching).toEqual([])
  })

  it('a domain the host reads active under ANOTHER key is never "yours": refused with the host\'s reason, dropped', async () => {
    // A's claim is contested; the operator settles it for the other key, whose
    // nameservers then take effect. The public reading looks the same either way.
    const h = host(contested)
    const w = world(h.route)
    expect(await w.claims.claim(DOMAIN)).toMatchObject({ kind: 'contested' })
    h.status.now = pending
    await w.tick()
    h.status.now = active
    h.signed.now = () => prose(409, 'this domain is claimed')
    await w.tick()

    expect(w.kinds()).toEqual(['contested', 'refused'])
    expect(w.reports.at(-1)).toEqual({ kind: 'refused', domain: DOMAIN, host: HOST, reason: 'this domain is claimed' })
    expect(w.storage.map.has(DOMAIN_CLAIMS_KEY)).toBe(false)
    expect(w.timers.size).toBe(0)
  })

  it('a claim re-answered after this browser forgot it is still confirmed before it is "yours"', async () => {
    // The host answers an old claim idempotently; it may lapse there and be
    // taken by another key while this hive is still watching.
    const h = host()
    const w = world(h.route)
    await w.claims.claim(DOMAIN)
    w.storage.map.clear()
    await w.claims.claim(DOMAIN)
    h.status.now = active
    h.signed.now = () => prose(409, 'this domain is claimed')
    await w.tick()
    expect(w.kinds()).toEqual(['pending', 'pending', 'refused'])
    expect(w.kinds()).not.toContain('active')
  })

  it('a confirmation it cannot have now is asked again next minute, quietly; asked, the participant is told why', async () => {
    const h = host()
    const w = world(h.route)
    await w.claims.claim(DOMAIN)
    h.status.now = active
    h.signed.now = () => { throw new TypeError('Failed to fetch') }
    await w.tick()
    w.options.unsigned = true
    await w.tick()
    w.options.unsigned = false
    expect(w.kinds()).toEqual(['pending'])
    expect(w.timers.size).toBe(1)

    h.signed.now = () => prose(502, 'cloudflare could not read the zone (403, code 9109)')
    expect(await w.claims.claim(DOMAIN)).toEqual({ kind: 'failed', domain: DOMAIN, host: HOST, reason: 'cloudflare could not read the zone (403, code 9109)' })
    expect(w.timers.size).toBe(1)

    h.signed.now = active
    await w.tick()
    expect(w.kinds().at(-1)).toBe('active')
    expect(w.timers.size).toBe(0)
  })

  it('says contested once, not every minute, and keeps watching', async () => {
    const h = host()
    const w = world(h.route)
    await w.claims.claim(DOMAIN)
    h.status.now = () => json(200, { domain: DOMAIN, status: 'contested', nameservers: NS })
    await w.tick()
    await w.tick()
    expect(w.kinds()).toEqual(['pending', 'contested'])
    expect(w.timers.size).toBe(1)
    // Saying the word again always answers.
    expect(await w.claims.claim(DOMAIN)).toMatchObject({ kind: 'contested' })
  })

  it('a claim the host no longer holds is lost only when it says so twice in a row: dropped, and no longer asked about', async () => {
    const h = host()
    const w = world(h.route)
    await w.claims.claim(DOMAIN)
    h.status.now = () => prose(404, 'no claim for this domain')
    // One 404 may be the host failing one read of its bucket.
    for (let minute = 1; minute < CLAIM_LOST_AFTER; minute++) await w.tick()
    expect(w.kinds()).toEqual(['pending'])
    expect(w.timers.size).toBe(1)

    await w.tick()
    expect(w.reports.at(-1)).toEqual({ kind: 'lost', domain: DOMAIN, host: HOST, word: 'domain claim inspiredbyhumans.org' })
    expect(w.storage.map.has(DOMAIN_CLAIMS_KEY)).toBe(false)
    expect(w.timers.size).toBe(0)
  })

  it('a 404 between answers is forgotten', async () => {
    const h = host()
    const w = world(h.route)
    await w.claims.claim(DOMAIN)
    for (const answer of [() => prose(404, 'no claim for this domain'), pending, () => prose(404, 'no claim for this domain')]) {
      h.status.now = answer
      await w.tick()
    }
    expect(w.kinds()).toEqual(['pending'])
    expect(w.claims.watching).toEqual([DOMAIN])
  })

  it('asked, a 404 is said at once — saying the word again claims afresh', async () => {
    const h = host()
    const w = world(h.route)
    await w.claims.claim(DOMAIN)
    h.status.now = () => prose(404, 'no claim for this domain')
    expect(await w.claims.claim(DOMAIN)).toMatchObject({ kind: 'lost', word: 'domain claim inspiredbyhumans.org' })
    await w.claims.claim(DOMAIN)
    expect(w.methods()).toEqual(['POST', 'GET', 'POST'])
  })

  it('a host that is down is silent on a tick and keeps the watch; asked, it says so — in its own words when it answered', async () => {
    const h = host()
    const w = world(h.route)
    await w.claims.claim(DOMAIN)
    h.status.now = () => { throw new TypeError('Failed to fetch') }
    await w.tick()
    h.status.now = () => prose(502, 'bad gateway')
    await w.tick()
    expect(w.kinds()).toEqual(['pending'])
    expect(w.timers.size).toBe(1)
    expect(await w.claims.claim(DOMAIN)).toEqual({ kind: 'failed', domain: DOMAIN, host: HOST, reason: 'bad gateway' })
    h.status.now = () => prose(429, 'slow down')
    expect(await w.claims.claim(DOMAIN)).toMatchObject({ kind: 'failed', reason: 'slow down' })
    h.status.now = () => { throw new TypeError('Failed to fetch') }
    expect(await w.claims.claim(DOMAIN)).toEqual({ kind: 'unreachable', domain: DOMAIN, host: HOST })
    expect(w.timers.size).toBe(1)
  })

  it('shares one question per domain; the participant\'s waits for a tick\'s and is asked afresh', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    let gets = 0
    const w = world(async (_url, init) => {
      if (init?.method === 'POST') return pending()
      gets++
      await gate
      return pending()
    })
    await w.claims.claim(DOMAIN)
    const tickA = w.claims.check(DOMAIN)
    const tickB = w.claims.check(DOMAIN)
    expect(tickB).toBe(tickA)
    const asked = w.claims.claim(DOMAIN)
    release()
    expect(await tickA).toBeNull()
    expect(await asked).toMatchObject({ kind: 'pending', again: true })
    expect(gets).toBe(2)
  })

  it('never runs two timers for one domain', async () => {
    const w = world(() => pending())
    await w.claims.claim(DOMAIN)
    w.claims.watch(DOMAIN)
    w.claims.resume()
    w.claims.resume()
    expect(w.timers.size).toBe(1)
  })
})

describe('at boot', () => {
  const kept = (since: number, at = HOST) => JSON.stringify({
    [DOMAIN]: { host: at, nameservers: NS, since, status: 'pending' },
  })

  it('a claim younger than a week is asked about at once and watched', async () => {
    const w = world(() => pending())
    w.storage.setItem(DOMAIN_CLAIMS_KEY, kept(T0 - 2 * 24 * 60 * 60 * 1000))
    expect(w.claims.resume()).toBe(1)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(w.calls.map(call => call.url)).toEqual(['https://pluginthematrix.com/claim/inspiredbyhumans.org'])
    expect(w.claims.watching).toEqual([DOMAIN])
    expect(w.reports).toEqual([])
  })

  it('an older one is dropped and reported expired, with the word that claims it again, without asking', () => {
    const w = world(() => pending())
    w.storage.setItem(DOMAIN_CLAIMS_KEY, kept(T0 - CLAIM_MAX_AGE_MS - 1))
    expect(w.claims.resume()).toBe(0)
    expect(w.reports).toEqual([{ kind: 'expired', domain: DOMAIN, host: HOST, word: 'domain claim inspiredbyhumans.org' }])
    expect(w.storage.map.has(DOMAIN_CLAIMS_KEY)).toBe(false)
    expect(w.calls).toEqual([])
  })

  it('a claim made on another host is said again on THAT host — the word names it', async () => {
    const w = world(() => pending())
    w.storage.setItem(DOMAIN_CLAIMS_KEY, kept(T0 - CLAIM_MAX_AGE_MS - 1, 'content.hypercomb.com'))
    w.claims.resume()
    const [expired] = w.reports
    expect(expired).toEqual({ kind: 'expired', domain: DOMAIN, host: 'hypercomb.com', word: 'domain claim inspiredbyhumans.org @hypercomb.com' })
    // Saying exactly what it names goes back to where the claim was made.
    const [, , name, at] = (expired as { word: string }).word.split(' ')
    await w.claims.claim(name, at)
    expect(w.calls.map(call => call.url)).toEqual(['https://hypercomb.com/claim'])
  })

  it('an expired claim said again is claimed afresh, with a new week, on the host it was made on', async () => {
    const w = world(() => pending())
    w.storage.setItem(DOMAIN_CLAIMS_KEY, kept(T0 - CLAIM_MAX_AGE_MS - 1, 'content.hypercomb.com'))
    await w.claims.claim(DOMAIN)
    expect(w.methods()).toEqual(['POST'])
    expect(w.calls[0].url).toBe('https://hypercomb.com/claim')
    expect(readClaims(w.storage)[DOMAIN]).toMatchObject({ host: 'hypercomb.com', since: T0 })
  })

  it('what storage holds is read field by field; garbage is nothing', () => {
    const w = world(() => pending())
    for (const junk of ['not json', '[]', 'null', JSON.stringify({ 'not a domain': { host: 'x.org', since: 1 } }),
      JSON.stringify({ 'inspiredbyhumans.org': { host: 'not a host', since: T0 } }),
      JSON.stringify({ 'inspiredbyhumans.org': { host: 'content.pluginthematrix.com', since: 'yesterday' } })]) {
      w.storage.setItem(DOMAIN_CLAIMS_KEY, junk)
      expect(readClaims(w.storage), junk).toEqual({})
      expect(w.claims.resume()).toBe(0)
    }
  })
})

describe('a browser that will not keep the claim', () => {
  const refusing = () => ({
    getItem: () => { throw new Error('SecurityError') },
    setItem: () => { throw new Error('SecurityError') },
    removeItem: () => { throw new Error('SecurityError') },
  })
  const full = () => ({
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError') },
    removeItem: () => {},
  })

  for (const [name, storage] of [['no storage', () => null], ['storage that throws', refusing], ['storage that is full', full]] as const) {
    it(`${name}: still claims, and keeps asking every minute while the hive is open`, async () => {
      const h = host()
      const w = world(h.route, { storage: storage() })
      expect(w.claims.resume()).toBe(0)
      expect(await w.claims.claim(DOMAIN)).toMatchObject({ kind: 'pending', again: false })
      await w.tick()
      expect(w.methods()).toEqual(['POST', 'GET'])
      expect(w.claims.watching).toEqual([DOMAIN])
      // Said again, it is checked, not claimed again.
      expect(await w.claims.claim(DOMAIN)).toMatchObject({ kind: 'pending', again: true })
      expect(w.methods()).toEqual(['POST', 'GET', 'GET'])

      h.status.now = active
      h.signed.now = active
      await w.tick()
      expect(w.kinds().at(-1)).toBe('active')
      expect(w.timers.size).toBe(0)
    })
  }
})

// ── the word itself ────────────────────────────────────────────────

const QUEEN_FILE = join(__dirname, '..', 'commands', 'domain.queen.ts')

describe('the domain word', () => {
  it('acts at load where the build can see it, so she never sleeps through a boot', async () => {
    // Judged on her own source: what keeps her awake must be hers, never
    // another file that happens to name her key.
    const classifier = pathToFileURL(join(__dirname, '..', '..', 'scripts', 'passive-queen.ts')).href
    const { passiveQueen } = await import(/* @vite-ignore */ classifier) as {
      passiveQueen: (file: string, source: string, others: ReadonlyMap<string, string>) => { passive: boolean; why?: string }
    }
    expect(passiveQueen('src/commands/domain.queen.ts', readFileSync(QUEEN_FILE, 'utf8'), new Map()))
      .toEqual({ passive: false, why: 'acts on load (whenReady()' })
  })

  describe('in the hive', async () => {
    // A hand-held IoC, as the shell's: whenReady waits for its key.
    const held = new Map<string, unknown>()
    const listeners: ((key: string, value: unknown) => void)[] = []
    const waiting = new Map<string, ((value: unknown) => void)[]>()
    const ioc = {
      register: (key: string, value: unknown) => {
        held.set(key, value)
        for (const listener of listeners) listener(key, value)
        for (const callback of waiting.get(key) ?? []) callback(value)
        waiting.delete(key)
      },
      get: (key: string) => held.get(key),
      has: (key: string) => held.has(key),
      list: () => [...held.keys()],
      whenReady: (key: string, callback: (value: unknown) => void) => {
        if (held.has(key)) { callback(held.get(key)); return }
        waiting.set(key, [...(waiting.get(key) ?? []), callback])
      },
      onRegister: (listener: (key: string, value: unknown) => void) => { listeners.push(listener); return () => {} },
    }
    ;(window as unknown as { ioc: unknown }).ioc = ioc

    // Two claims a week old, one made on another host, waiting at boot.
    localStorage.setItem(DOMAIN_CLAIMS_KEY, JSON.stringify({
      'first.org': { host: HOST, nameservers: NS, since: 1, status: 'pending' },
      'second.org': { host: 'content.hypercomb.com', nameservers: NS, since: 1, status: 'pending' },
    }))
    await import('../commands/slash-behaviour.drone.js')
    await import('../commands/domain.queen.js')
    type Census = {
      complete(name: string, args: string): readonly string[]
      all(): { name: string; options?: readonly string[]; examples?: readonly { input: string }[] }[]
    }
    const census = ioc.get('@diamondcoreprocessor.com/SlashBehaviourDrone') as Census

    it('offers claim — and `cl` is claim before clear', () => {
      expect(census.complete('domain', '')).toEqual(['claim ', 'list', 'remove ', 'clear'])
      expect(census.complete('domain', 'cl')).toEqual(['claim ', 'clear'])
      const row = census.all().find(behaviour => behaviour.name === 'domain')
      expect(row?.options).toContain('claim <domain> [@<host>]')
      expect(row?.examples?.map(example => example.input)).toContain('/domain claim example.org')
    })

    it('waits for the toasts before it says anything at boot, so every expiry is shown', () => {
      // Nothing was said while she loaded: the bus would replay only the last.
      expect(localStorage.getItem(DOMAIN_CLAIMS_KEY)).not.toBeNull()
      const shown: string[] = []
      const off = EffectBus.on<{ message: string }>('toast:show', toast => { shown.push(toast.message) })
      ioc.register('@diamondcoreprocessor.com/ToastDrone', {})
      off()
      expect(shown).toHaveLength(2)
      expect(shown[0]).toContain('Say domain claim first.org to check again')
      expect(shown[1]).toContain('Say domain claim second.org @hypercomb.com to check again')
      expect(localStorage.getItem(DOMAIN_CLAIMS_KEY)).toBeNull()
    })
  })
})

// ── what it says, in every language ────────────────────────────────

describe('the claim, in every catalog', () => {
  const dir = join(__dirname, '..', '..', '..', 'hypercomb-shared', 'i18n')
  const catalogs = readdirSync(dir).filter(file => file.endsWith('.json'))
  const read = (file: string): Record<string, string> => JSON.parse(readFileSync(join(dir, file), 'utf8'))
  const en = read('en.json')
  const keys = Object.keys(en).filter(key => key.startsWith('domain.claim.') || key === 'slash.domain')
  const slots = (text: string): string[] => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]!))].sort()

  it('finds every catalog and every outcome', () => {
    expect(catalogs.length).toBeGreaterThanOrEqual(14)
    expect(keys).toEqual(expect.arrayContaining(['domain.claim.failed', 'domain.claim.lost', 'domain.claim.expired']))
    // The re-said line is the word the claim reports, host and all — never a copy.
    expect(slots(en['domain.claim.lost']!)).toContain('word')
    expect(slots(en['domain.claim.expired']!)).toContain('word')
  })

  for (const file of catalogs) {
    it(`${file} says every outcome, with the slots English fills`, () => {
      const catalog = read(file)
      for (const key of keys) {
        expect(catalog[key], `${file} is missing ${key}`).toBeTypeOf('string')
        expect(slots(catalog[key]!), `${file} ${key}`).toEqual(slots(en[key]!))
      }
    })
  }
})
