// sharing/meeting-link.robust.spec.ts — A MEETING LINK SURVIVES THE TRIP.
//
// The link is pasted into chats, where a linkifier trims what it thinks is
// sentence punctuation off its end, and into sentences, where a '.', ')' or
// ',' sticks to it. Either way the secret changed silently and the joiner
// landed in a zone of one (ZI-2). A room or secret holding a '/' made a link
// nobody's parser read — no sheet, no toast (ZI-3). Hunt evidence: the link
// probe and the slash probe (long-tail hunt 2026-10-10).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { meetFragment, parseMeet } from './meeting-invite.js'

/** The linkifier step, as GFM's extended autolink rule has it: a trailing
 *  ? ! . , : * _ ~ is not part of the link, nor is an unbalanced ')'. */
const linkify = (url: string): string => {
  let u = url
  for (;;) {
    const before = u
    u = u.replace(/[?!.,:*_~]+$/, '')
    if (u.endsWith(')') && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) u = u.slice(0, -1)
    if (u === before) return u
  }
}

const ORIGIN = 'https://hypercomb.io/'
const fragOf = (url: string): string => url.slice(url.indexOf('#'))
const zoneOf = (raw: string): string | null => {
  const m = parseMeet(raw)
  return m ? JSON.stringify([m.room, m.secret, m.segments, m.relay ?? '', m.host ?? '', m.code ?? '']) : null
}

describe('ZI-2 — punctuation at the end of a link never changes the zone', () => {
  it('a secret ending in punctuation survives the linkifier (the link never ends in raw punctuation)', () => {
    for (const secret of ['rose!', 'spring2026.', 'rose*', 'rose_', 'rose~', "rose'", 'rose(2)', 'rose-']) {
      const url = ORIGIN + meetFragment('downtown', secret, [])
      expect(linkify(url), secret).toBe(url)
      expect(parseMeet(fragOf(linkify(url)))?.secret, secret).toBe(secret)
    }
  })

  it("a plain link with '.', ')' or ',' stuck to it reads back the same zone", () => {
    const url = ORIGIN + meetFragment('downtown', 'rose', [])
    const want = zoneOf(fragOf(url))
    for (const tail of ['.', ')', ',', ';', ':', '!', '?', '"', "'", '>', ']', '}', '.)', ').', '),']) {
      const pasted = fragOf(url) + tail
      expect(zoneOf(pasted), tail).toBe(want)
    }
  })

  it('the tail of a link with a meeting point and a code survives too', () => {
    const url = ORIGIN + meetFragment('downtown', 'rose', ['Plans'], { relay: 'wss://pluginthematrix.com/io', host: 'pluginthematrix.com', code: 'k3y.Recycled-2.' })
    expect(linkify(url)).toBe(url)
    const want = zoneOf(fragOf(url))
    expect(parseMeet(fragOf(url))?.code).toBe('k3y.Recycled-2.')
    for (const tail of ['.', ')', ',']) {
      expect(zoneOf(fragOf(url) + tail), tail).toBe(want)
    }
  })

  it('every older reader decodes the strict escapes to the same text', () => {
    // The parser 75007af2 / 87383624 run, verbatim in what matters: split on
    // '/', decodeURIComponent each part.
    const legacy = (raw: string): string[] => raw.replace(/^#meet=/, '').split('/').map(decodeURIComponent)
    expect(legacy(meetFragment('team-a.b', "it's (rose)!", ['Big_Ideas~']))).toEqual(['team-a.b', "it's (rose)!", 'Big_Ideas~'])
  })

  it('controls: a balanced ( ) survives, and links minted before keep their meaning', () => {
    expect(parseMeet('#meet=downtown/rose(2)')?.secret).toBe('rose(2)')
    // A code or secret minted before, ending raw in '_' '*' '~' (base64url ends in '_'), keeps it.
    expect(parseMeet('#meet=downtown/rose_&relay=a.example&code=AbC_')).toMatchObject({ secret: 'rose_', code: 'AbC_' })
    expect(parseMeet('#meet=Meet%20Up/4417/Big%20Ideas')).toMatchObject({ room: 'Meet Up', secret: '4417', segments: ['Big Ideas'] })
    expect(meetFragment('Meet Up', '4417', ['Big Ideas'])).toBe('#meet=Meet%20Up/4417/Big%20Ideas')
  })
})

describe('ZI-3 — a room or secret may hold a slash; a page may not', () => {
  it("'standup 10/09' and 'spring/2026' round-trip", () => {
    for (const [room, secret] of [['standup 10/09', 'rose'], ['downtown', 'spring/2026'], ['A/B team', 'Q3\\Q4']]) {
      const frag = meetFragment(room, secret, ['Ideas'])
      expect(parseMeet(frag), frag).toMatchObject({ room, secret, segments: ['Ideas'] })
    }
  })

  it('a long room or secret round-trips; a page that is not one path component never reads', () => {
    const long = 'x'.repeat(513)
    expect(parseMeet(meetFragment('downtown', long, []))?.secret).toBe(long)
    expect(parseMeet(meetFragment(long, 'rose', []))?.room).toBe(long)
    expect(parseMeet(meetFragment('downtown', 'rose', [long]))).toBeNull()
    expect(parseMeet('#meet=downtown/rose/a%2Fb')).toBeNull()
  })
})

// ── the mint and the worker say so instead of handing out a dead link ─────
const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  whenReady: () => void 0,
}
const cred = (initial: string) => ({ value: initial, set(v: string) { this.value = String(v ?? '').trim() } })
const room = cred('')
const secret = cred('')
let explorer: string[] = []
services.set('@hypercomb.social/Store', { getResource: async () => null })
services.set('@hypercomb.social/RoomStore', room)
services.set('@hypercomb.social/SecretStore', secret)
services.set('@hypercomb.social/Navigation', { go: () => {}, goRaw: () => {}, segments: () => explorer })
services.set('@hypercomb.social/Lineage', { explorerSegments: () => explorer })
services.set('@diamondcoreprocessor.com/SelectionService', { selected: new Set<string>() })
const toasts: { type: string; title: string; message: string }[] = []
EffectBus.on<{ type: string; title: string; message: string }>('toast:show', (t) => { if (t) toasts.push(t) })
const sheets: { id: string; message: string }[] = []
EffectBus.on<{ id: string; message: string }>('confirm:request', (r) => { if (r?.id && !sheets.some(s => s.id === r.id)) sheets.push(r) })
const writes: string[] = []
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async (s: string) => { writes.push(s) }) } })

const { InviteQueenBee } = await import('./invite.queen.js')
const { MeetingInviteWorker } = await import('./meeting-invite.worker.js')
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)) }
/** One boot of the tab: a fresh worker, the previous one gone with its page. */
type BootedWorker = { pulse: (g: string) => Promise<void>; markDisposed: () => void }
let booted: BootedWorker | null = null
const boot = (): BootedWorker => {
  booted?.markDisposed()
  booted = new MeetingInviteWorker() as unknown as BootedWorker
  return booted
}

beforeEach(() => {
  toasts.length = 0
  sheets.length = 0
  writes.length = 0
  sessionStorage.clear()
  room.value = 'standup 10/09'
  secret.value = 'spring/2026'
  explorer = []
})

describe('the mint warns instead of handing out a link nobody can open', () => {
  it('a room and secret with slashes: the link is handed out and reads back', async () => {
    await new InviteQueenBee().meetingLink()
    expect(writes).toHaveLength(1)
    expect(parseMeet(fragOf(writes[0]))).toMatchObject({ room: 'standup 10/09', secret: 'spring/2026' })
  })

  it('a page part that cannot round-trip (513 chars): no link, a warning that says why', async () => {
    explorer = ['y'.repeat(513)]
    await new InviteQueenBee().meetingLink()
    expect(writes).toHaveLength(0)
    expect(toasts.at(-1)?.type).toBe('warning')
    expect(toasts.at(-1)?.message).toMatch(/would not open/i)
  })
})

describe('the worker says when a link cannot be read', () => {
  it('a stashed link that is no link: dropped, and the guest is told — never nothing at all', async () => {
    sessionStorage.setItem('hc:pending-meet', 'onlyroom')
    const w = boot()
    await w.pulse('')
    await settle()
    expect(sessionStorage.getItem('hc:pending-meet')).toBeNull()
    expect(sheets).toHaveLength(0)
    expect(toasts.at(-1)?.message).toMatch(/could not be read/i)
  })

  it('a link that arrives after boot (a same-tab navigation) is taken when the shell says so', async () => {
    room.value = ''
    secret.value = ''
    const w = boot()
    await w.pulse('')
    await settle()
    expect(sheets).toHaveLength(0)
    sessionStorage.setItem('hc:pending-meet', meetFragment('room-new', 'secretNEW', []).slice('#meet='.length))
    EffectBus.emit('meet:pending', { at: Date.now() })
    await settle()
    expect(sheets).toHaveLength(1)
    expect(sheets[0].message).toContain('room-new')
  })
})

describe('a crafted link never freezes the tab (2026-10-12)', () => {
  it('a 100,000-character tail is refused at once, not trimmed character by character', async () => {
    const { parseMeet } = await import('./meeting-invite.js')
    const t0 = performance.now()
    expect(parseMeet('#meet=room/secret' + ')'.repeat(100_000))).toBeNull()
    expect(performance.now() - t0).toBeLessThan(250)
  })
})
