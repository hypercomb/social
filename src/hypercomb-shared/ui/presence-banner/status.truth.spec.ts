// ui/presence-banner/status.truth.spec.ts — THE ONE STATUS LINE against what
// the long-tail hunt captured (2026-10-10).
//
// Promoted from the hunt's scratch spec (truth/spec/status.truth.spec.ts),
// which pinned what the line SAID for states it read wrong. Each case here is
// the state as captured — the owner's own tab at 04:04-04:43Z, a meeting
// point that recycled its access code, a slow uplink — and the sentence a
// participant must read for it. Resolved through en.json the way
// LocalizationService resolves it (plural suffix, then {token}), so a reworded
// catalog fails here, not at the next meeting.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { secretTag } from '@hypercomb/core'
import {
  SHIPPED_POINT, SLOW_FOR_MS, UNREACHABLE_AFTER_MS, didYouMean, editDistance, headerLink, linkPhase, meetingPointKey, refusalOf,
  roomWords, slowLink, statusLine, wordsBeside,
  type ShareStatus, type StatusInput, type StatusLine,
} from './presence-status'

const en = JSON.parse(readFileSync(join(__dirname, '..', '..', 'i18n', 'en.json'), 'utf8')) as Record<string, string>
function t(key: string, params?: Record<string, string | number>): string {
  let template: string | undefined
  if (params && typeof params['count'] === 'number') {
    const n = params['count']
    if (n === 0) template = en[`${key}.zero`]
    if (template === undefined && n === 1) template = en[`${key}.one`]
    if (template === undefined) template = en[`${key}.other`]
  }
  template ??= en[key]
  if (template === undefined) return key
  return params ? template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`)) : template
}
const say = (l: StatusLine): string => l.parts.map(p => p.text ?? t(p.key!, p.params)).join(' · ')

const base: StatusInput = {
  phase: 'open', host: 'jwize.com', uploadHost: '', room: 'downtown', words: 'two words',
  roomCount: 3, hereCount: 3, share: null, sync: null, older: 0, clockOff: false, rejected: '',
}

// ── TS-1 / BCL-2: the owner's tab, page "/", 04:04-04:43Z ────────────────
describe('the owner\'s tab: 27 tiles name-only behind hosts the page never named', () => {
  // swarm:share-status exactly as the bridge read it, every minute for 23 min.
  const captured: ShareStatus = {
    location: '/', offered: 27, uploading: 27, nameOnly: 27, private: 1,
    host: 'jwize.com', hosts: ['jwize.com'], hostSource: 'pool', hostState: 'backed-up', reason: '',
    passedOver: ['hypercomb.com'],
  }
  const sync = { host: 'jwize.com', state: 'backed-up', status: 'backed-up', swarm: true, missing: 0 }
  // What the gate's verdict says for the same tiles (L2's held[]): the
  // CORS-blocked apex holds 25, the misspelled publish domain 2.
  const held = [
    { host: 'hypercomb.com', state: 'unreachable', reason: 'unreachable', count: 25 },
    { host: 'hyperccomb.com', state: 'never-answered', reason: 'no answer', count: 2 },
  ]

  it('names the host that holds the most tiles, in the warn tone — never "uploading" in the all-is-well one', () => {
    const line = statusLine({ ...base, uploadHost: 'jwize.com', share: { ...captured, uploading: 0, held }, sync, knownHosts: ['jwize.com', 'hypercomb.com'] })
    expect(say(line)).toBe("Live · downtown · two words · 3 in the room (3 here) · Sharing 27 · hypercomb.com can't be reached — 25 tiles stay names · 1 of your tiles here is private · Share")
    expect(line.tone).toBe('warn')
    expect(say(line)).not.toContain('uploading')
  })

  it('a host that never answered is offered the near-miss spelling this device knows', () => {
    const line = statusLine({ ...base, uploadHost: 'jwize.com', share: { ...captured, uploading: 0, held: [{ host: 'hyperccomb.com', state: 'never-answered', count: 27 }] }, sync, knownHosts: ['jwize.com', 'hypercomb.com', 'hyperccomb.com'] })
    expect(say(line)).toContain('hyperccomb.com has never answered — 27 tiles stay names · did you mean hypercomb.com?')
    expect(say(line)).toContain('hypercomb.com passed over')
    expect(line.tone).toBe('warn')
  })

  it('names only, with nothing on its way: "not queued", never "uploading"', () => {
    const line = statusLine({ ...base, uploadHost: 'jwize.com', share: { ...captured, uploading: 0, held: [] }, sync })
    expect(say(line)).toContain('Sharing 27 · 27 names only — not queued · hypercomb.com passed over')
    expect(line.tone).toBe('warn')
  })

  it('the branch line offers the spelling too (blocked[], the landed half)', () => {
    const line = statusLine({ ...base, share: { offered: 3, blocked: [{ branch: 'favorites', host: 'hyperccomb.com', state: 'unreachable', why: 'unresolved' }] }, knownHosts: ['hypercomb.com'] })
    expect(say(line)).toContain("favorites: hyperccomb.com can't be reached — check the host name, and that the host is running · did you mean hypercomb.com?")
  })

  it('the near miss is a near miss: two edits, a swap counts once, nothing far', () => {
    expect(editDistance('hyperccomb.com', 'hypercomb.com')).toBe(1)
    expect(editDistance('hpyercomb.com', 'hypercomb.com')).toBe(1)
    expect(editDistance('jwize.com', 'hypercomb.com')).toBe(3)
    expect(didYouMean('hyperccomb.com', ['jwize.com', 'hypercomb.com'])).toBe('hypercomb.com')
    expect(didYouMean('pool-a.example', ['jwize.com'])).toBe('')
    // a refusing host is not a typo: no hint for it
    const refused = statusLine({ ...base, share: { offered: 2, held: [{ host: 'pool-a.localhost', state: 'refused', count: 2 }] }, knownHosts: ['pool-b.localhost'] })
    expect(say(refused)).toContain("pool-a.localhost isn't taking uploads — 2 tiles stay names")
    expect(say(refused)).not.toContain('did you mean')
  })

  it('a tile the room CAN take, whose deeper pages a host refuses, is never said to "stay a name" (T4, deep held)', () => {
    const line = statusLine({ ...base, share: { offered: 1, nameOnly: 0, held: [{ host: 'dead-b.localhost', state: 'refused', reason: '403 participants-closed', count: 1, deep: true }] } })
    expect(say(line)).toContain("dead-b.localhost isn't taking the deeper pages of 1 tile — they open from your device while you're here")
    expect(say(line)).not.toMatch(/stays? (a )?names?/)
    expect(line.tone).toBe('warn')
  })

  it("a RECEIVER is told when a branch here opens its deeper pages from its sharer's device alone (D1)", () => {
    const line = statusLine({ ...base, deepOwners: ['Ana'] })
    expect(say(line)).toContain("Deeper pages open from Ana's device until their upload finishes")
    expect(line.tone).toBe('live')
    expect(say(statusLine({ ...base }))).not.toContain('Deeper pages')
  })

  it('a passed-over publish domain is named once the tiles went by the pool and are takeable (D2)', () => {
    const line = statusLine({ ...base, share: { offered: 3, nameOnly: 0, uploading: 0, passedOver: ['hyperccomb.com'] } })
    expect(say(line)).toContain('Sharing 3 · hyperccomb.com passed over')
  })

  // BCL-3 (D1 sharer line): a tile is takeable while its deeper pages are
  // still only on the sharer's device; a healthy host is draining them. The
  // sharer read a green "Sharing 27" — and leaving then leaves the takers
  // blank deeper pages. smoke1 / GW1, 2026-10-11 acceptance.
  it('the SHARER is told while deeper pages are still only on their device — asked to stay, never the all-is-well tone', () => {
    const line = statusLine({ ...base, share: { offered: 27, nameOnly: 0, uploading: 0, deepOnDevice: 3, held: [] } })
    expect(say(line)).toBe('Live · downtown · two words · 3 in the room (3 here) · Sharing 27 · Deeper pages of 3 tiles are still only on your device — stay a moment to leave them with the room')
    expect(line.tone).toBe('warn')
    expect(line.quiet).toBe(false)
    expect(say(statusLine({ ...base, share: { offered: 1, deepOnDevice: 1 } }))).toContain('Deeper pages of 1 tile are still only on your device')
  })

  it('a host that REFUSES the deeper pages is named instead (share.held.deep) — the line never asks to stay for pages no host will take', () => {
    const line = statusLine({ ...base, share: { offered: 2, nameOnly: 0, deepOnDevice: 1, held: [{ host: 'dead-b.localhost', state: 'refused', count: 1, deep: true }] } })
    expect(say(line)).toContain("dead-b.localhost isn't taking the deeper pages of 1 tile")
    expect(say(line)).not.toContain('stay a moment')
  })

  it('nothing on the device alone: no such line', () => {
    expect(say(statusLine({ ...base, share: { offered: 3, deepOnDevice: 0 } }))).not.toContain('only on your device')
    expect(statusLine({ ...base, share: { offered: 3, deepOnDevice: 0 } }).tone).toBe('live')
  })

  // BCL-1 (D2 naming half): smoke1 — lt-typo/c01 wears typo.localhost and
  // lt-refused/c01 refuse.localhost, a page BELOW the offered tile. Once
  // their pages fell through to the pool the root read plain "Sharing 27".
  // The swarm now names them in passedOver (swarm.share-status.spec); the
  // line says them beside the counts.
  it('domains worn deeper than the offered tile, passed over, are named on the root line', () => {
    const line = statusLine({ ...base, uploadHost: 'pool-a.localhost', share: { offered: 27, nameOnly: 0, uploading: 0, passedOver: ['typo.localhost', 'refuse.localhost'] } })
    expect(say(line)).toBe('Live · downtown · two words · 3 in the room (3 here) · Sharing 27 · typo.localhost, refuse.localhost passed over — they aren\'t taking uploads')
    expect(say(statusLine({ ...base, share: { offered: 3, passedOver: ['typo.localhost'] } }))).toContain("typo.localhost passed over — it isn't taking uploads")
  })
})

// ── TS-2 / VO-4: the meeting point's standing refusals ───────────────────
describe('a refusal no wifi fixes is said at once, as what it is', () => {
  const t0 = 1_000_000
  const at = (refused: string, state: string, dt: number, wasOpen = true): StatusLine => {
    const conn = { state, refused, since: t0, reopened: false, attempt: 3, clockOffsetMs: 0 }
    const phase = linkPhase(conn, state === 'open' ? null : t0, t0 + dt, wasOpen)!
    return statusLine({ ...base, host: 'pluginthematrix.com', phase, refused: refusalOf(conn), point: 'wss://pluginthematrix.com', roomCount: 1, hereCount: 1 })
  }

  it("refused 'access': down at once with the link remedy and the code button — never 'check wifi', at +0.2 s or +78 s", () => {
    for (const dt of [200, 5_000, UNREACHABLE_AFTER_MS + 1, 78_000]) {
      const line = at('access', 'retrying', dt)
      expect(say(line)).toBe('pluginthematrix.com needs the current meeting link — ask for the newest one · Enter the new code')
      expect(line.tone).toBe('down')
      expect(line.parts.at(-1)?.action).toBe('code')
      expect(say(line)).not.toMatch(/wifi|Reconnecting/)
    }
    // a first dial refused the same way
    expect(say(at('access', 'connecting', 200, false))).toContain('needs the current meeting link')
  })

  it("refused 'unreachable': names the computer's own relay this page cannot dial", () => {
    const conn = { state: 'offline', refused: 'unreachable', since: t0, reopened: false, attempt: 0, clockOffsetMs: 0 }
    const line = statusLine({ ...base, host: 'the meeting point', phase: linkPhase(conn, t0, t0 + 1_000, false)!, refused: 'unreachable', point: 'ws://localhost:7896' })
    expect(say(line)).toBe("This link meets at ws://localhost:7896, a computer's own relay — this page can't reach it")
    expect(line.tone).toBe('down')
  })

  it("refused 'no-host': joined with no host named — said at once, with the host field one tap away (no default, 2026-10-11)", () => {
    const conn = { state: 'offline', refused: 'no-host', since: t0, reopened: false, attempt: 0, clockOffsetMs: 0 }
    const line = statusLine({ ...base, host: 'the meeting point', words: '', phase: linkPhase(conn, t0, t0 + 1_000, false)!, refused: 'no-host' })
    expect(say(line)).toBe('No host named — this tab meets nowhere yet · Name the host')
    expect(line.tone).toBe('down')
    expect(line.parts.at(-1)?.action).toBe('host')
    expect(say(line)).not.toMatch(/hypercomb\.com|wifi|Connecting|Reconnecting/)
  })

  it("refused 'subscriptions': live, with the reload said in the warn tone", () => {
    const line = at('subscriptions', 'open', 1_000)
    expect(say(line)).toContain('The meeting point stopped taking more listeners — reload this tab')
    expect(line.tone).toBe('warn')
  })

  it('reads the refusal in either shape', () => {
    expect(refusalOf({ state: 'retrying', refused: 'access' })).toBe('access')
    expect(refusalOf({ state: 'retrying', refused: { reason: 'access', at: 1 } })).toBe('access')
    expect(refusalOf({ state: 'open' })).toBe('')
    expect(refusalOf(null)).toBe('')
  })
})

// ── TS-6: a slow but working socket ──────────────────────────────────────
describe('a slow socket is live and slow, never "Reconnecting"', () => {
  const t0 = 2_000_000
  it(`stalled for under ${SLOW_FOR_MS} ms is slow; past the probe deadline it is a reconnect`, () => {
    const conn = { state: 'stalled', since: t0 }
    expect(slowLink(conn, t0 + 1_000)).toBe(true)
    expect(slowLink(conn, t0 + SLOW_FOR_MS - 1)).toBe(true)
    expect(slowLink(conn, t0 + SLOW_FOR_MS)).toBe(false)
    expect(slowLink({ state: 'retrying', since: t0 }, t0 + 10)).toBe(false)
    expect(slowLink({ state: 'open', since: t0 }, t0 + 10)).toBe(false)
  })
  it('the line: Live · slow connection, in the live tone', () => {
    const line = statusLine({ ...base, slow: true })
    expect(say(line)).toBe('Live · slow connection · downtown · two words · 3 in the room (3 here)')
    expect(line.tone).toBe('live')
  })
})

// ── TS-7: delivery, not the socket ───────────────────────────────────────
describe('a word the relay has not taken', () => {
  it('says "Sending…" and leaves you out of "here" until it is taken', () => {
    const line = statusLine({ ...base, hereCount: 1, sending: true })
    expect(say(line)).toBe('Live · downtown · two words · 3 in the room (1 here) · Sending…')
    expect(line.tone).toBe('warn')
  })
})

// ── ROOM IDENTITY (jwize, 2026-10-12; replaces D4's fold-only-when-not-default):
// the comparison words ─────────────────────────────────────────────────────
describe('the room\'s two words are its address read aloud: host + room + secret', () => {
  const pairAt = (point: string): string => secretTag(`lifecycle\u0000downtown\u0000rose\u0000${point}`, 'en')

  it('hypercomb.com however it is written reads one pair — and an empty field reads none: there is no default host (2026-10-11)', () => {
    const atHost = pairAt('hypercomb.com')
    for (const p of ['hypercomb.com', 'wss://hypercomb.com', 'wss://HyperComb.com/', 'wss://hypercomb.com:443']) expect([p, roomWords('downtown', 'rose', p)]).toEqual([p, atHost])
    for (const p of ['', '  ']) expect([p, roomWords('downtown', 'rose', p)]).toEqual([p, ''])
    expect(roomWords('downtown', 'rose')).toBe('')
    expect(meetingPointKey('wss://hypercomb.com')).toBe(SHIPPED_POINT)
    expect(meetingPointKey('')).toBe('')
    // and the pair from before the host was part of the room is not it
    expect(atHost).not.toBe(secretTag('lifecycle\u0000downtown\u0000rose', 'en'))
  })

  it('jwize.com, the default before, is a point like any other: no shipped default names it', () => {
    expect(meetingPointKey('wss://jwize.com')).toBe('jwize.com')
    expect(roomWords('downtown', 'rose', 'wss://jwize.com')).toBe(pairAt('jwize.com'))
    expect(roomWords('downtown', 'rose', 'wss://jwize.com')).not.toBe(roomWords('downtown', 'rose', 'hypercomb.com'))
  })

  it('two halves of one meeting on different points read different words', () => {
    const atPoint = roomWords('downtown', 'rose', 'wss://pluginthematrix.com')
    expect(atPoint).not.toBe(roomWords('downtown', 'rose', 'hypercomb.com'))
    // however the point is written, one point folds one way
    for (const p of ['pluginthematrix.com', 'wss://pluginthematrix.com/', 'WSS://PluginTheMatrix.com']) expect(roomWords('downtown', 'rose', p)).toBe(atPoint)
    expect(roomWords('downtown', 'rose', 'ws://localhost:7896')).not.toBe(roomWords('downtown', 'rose', 'ws://localhost:7895'))
  })

  it('en, ja and fr participants compare the same pair; the reader\'s own pair rides beside it', () => {
    const H = 'hypercomb.com'
    const words = roomWords('downtown', 'rose', H)
    expect(words).toBe(pairAt('hypercomb.com'))
    for (const locale of ['en', 'ja', 'fr', 'de', 'ru']) expect(wordsBeside('downtown', 'rose', H, locale).startsWith(words)).toBe(true)
    expect(wordsBeside('downtown', 'rose', H, 'en')).toBe(words)
    expect(wordsBeside('downtown', 'rose', H, 'ja')).toBe(`${words} (${secretTag('lifecycle\u0000downtown\u0000rose\u0000hypercomb.com', 'ja')})`)
  })

  it('the host offered (never a default) is the relay the mesh ships', () => {
    const relay = /^const LIVE_RELAY = '([^']+)'/m.exec(readFileSync(join(__dirname, '..', '..', '..', 'hypercomb-essentials', 'src', 'sharing', 'nostr-mesh.drone.ts'), 'utf8'))?.[1] ?? ''
    expect(new URL(relay).host).toBe(SHIPPED_POINT)
    expect(meetingPointKey(relay)).toBe(SHIPPED_POINT)
  })
})

// ── TS-6: the header glyph reads the line's rules ────────────────────────
describe('the header glyph follows the line', () => {
  const t0 = 1_000_000
  it('an open socket answering late is live — never the amber reconnect — until its probe deadline passes', () => {
    const stalled = { state: 'stalled', since: t0 }
    expect(headerLink(stalled, t0, t0 + 1_000)).toBe('open')
    expect(headerLink(stalled, t0, t0 + SLOW_FOR_MS + 1)).toBe('pending')
    expect(headerLink({ state: 'open', since: t0 }, null, t0)).toBe('open')
    expect(headerLink(null, null, t0)).toBeNull()
  })

  it('a standing refusal no wait cures is down at once, not after 30 s of amber', () => {
    expect(headerLink({ state: 'retrying', since: t0, refused: 'access' }, t0, t0 + 1_000)).toBe('down')
    expect(headerLink({ state: 'retrying', since: t0, refused: 'unreachable' }, t0, t0 + 1_000)).toBe('down')
    expect(headerLink({ state: 'offline', since: t0, refused: 'no-host' }, t0, t0 + 1_000)).toBe('down')
    expect(headerLink({ state: 'retrying', since: t0 }, t0, t0 + 1_000)).toBe('pending')
    expect(headerLink({ state: 'retrying', since: t0 }, t0, t0 + UNREACHABLE_AFTER_MS)).toBe('down')
  })
})
