// ui/presence-banner/presence-status.spec.ts — THE ONE STATUS LINE says the
// real state, in exactly these words.
//
// A meeting could not tell "I am not sharing" from "it is slow": a dead
// socket, a refusing host, all-private tiles and an empty room all looked
// like a quiet strip and a toast that said "the upload is running". Each
// state below is pinned to the English sentence a participant reads, resolved
// through en.json the way LocalizationService resolves it (plural suffix,
// then {token} interpolation) — so a reworded catalog fails here, not at the
// next meeting.

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { secretTag } from '@hypercomb/core'
import {
  ROOM_IDENTITY, UNREACHABLE_AFTER_MS, clockRefused, hostKeepsNothing, linkPhase, loadedRoomIdentity, meetingPointKey, roomWords, statusLine, wordsAtHost, wordsBeside,
  type StatusInput, type StatusLine,
} from './presence-status'

const UI = join(__dirname, '..')
const I18N = join(UI, '..', 'i18n')
const catalog = (file: string): Record<string, string> =>
  JSON.parse(readFileSync(join(I18N, file), 'utf8')) as Record<string, string>
const en = catalog('en.json')

/** LocalizationService's resolution, against en.json alone. */
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

const say = (line: StatusLine): string =>
  line.parts.map(p => (p.key ? t(p.key, p.params) : p.text)).join(' · ')

const live: StatusInput = {
  phase: 'open', host: 'jwize.com', room: 'meetup', words: 'amber falcon',
  roomCount: 7, hereCount: 3, share: null, sync: null, older: 0, clockOff: false, rejected: '',
}

describe('the status line — one state, one sentence', () => {
  it('live: the room, its words, everyone in it and how many are here', () => {
    const line = statusLine(live)
    expect(say(line)).toBe('Live · meetup · amber falcon · 7 in the room (3 here)')
    expect(line.tone).toBe('live')
    expect(line.quiet).toBe(true)
    expect(line.compact).toBe('7 (3)')
  })

  it('alone: the first one here, with the invite one tap away', () => {
    const line = statusLine({ ...live, roomCount: 1, hereCount: 1 })
    expect(say(line)).toBe("Live · meetup · amber falcon · you're the first one here · Invite")
    expect(line.parts.find(p => p.action)?.action).toBe('invite')
    expect(line.quiet).toBe(false)
  })

  it('connecting: names the meeting point it is dialling', () => {
    expect(say(statusLine({ ...live, phase: 'connecting' }))).toBe('Connecting to jwize.com…')
  })

  it('reconnecting: never "nobody is here" — the tiles are safe', () => {
    const line = statusLine({ ...live, phase: 'reconnecting' })
    expect(say(line)).toBe('Reconnecting… your tiles are safe')
    expect(line.tone).toBe('warn')
  })

  it('unreachable: says what to do about it, and that it keeps trying', () => {
    const line = statusLine({ ...live, phase: 'down' })
    expect(say(line)).toBe("Can't reach jwize.com — check wifi or switch to mobile data. Still trying.")
    expect(line.tone).toBe('down')
    expect(line.compact).toBe('')
  })

  it('sharing and uploading', () => {
    expect(say(statusLine({ ...live, share: { offered: 4 } })))
      .toBe('Live · meetup · amber falcon · 7 in the room (3 here) · Sharing 4')
    expect(say(statusLine({ ...live, share: { offered: 4, uploading: 1 } })))
      .toBe('Live · meetup · amber falcon · 7 in the room (3 here) · Sharing 4 · 1 uploading')
  })

  it('host refuses, host full — the tiles go live from this device; picture too large — and why', () => {
    // jwize 2026-10-11: a host you named that refuses you leaves your tiles
    // to your device, served while you are in the room.
    const refused = statusLine({ ...live, share: { offered: 2, live: 2, hostState: 'refused' } })
    expect(say(refused)).toContain("jwize.com isn't taking uploads from guests — the room gets your tiles from this device while you're here")
    expect(refused.tone).toBe('warn')
    expect(say(statusLine({ ...live, sync: { state: 'full' } })))
      .toContain("jwize.com is full — the room gets your tiles from this device while you're here")
    expect(say(statusLine({ ...live, share: { hostState: 'too-large' } })))
      .toContain('A picture is too large for jwize.com')
  })

  it('the upload lines name the page\'s host; the connection lines name the relay', () => {
    // A page's tiles go to its publish domains, else the host field
    // (2026-10-11) — the upload lines name where they go, which need not be
    // the relay the connection lines name.
    const pooled = { ...live, uploadHost: 'hypercomb.com' }
    const refused = say(statusLine({ ...pooled, share: { offered: 2, host: 'hypercomb.com', hostSource: 'pool', hostState: 'refused' } }))
    expect(refused).toContain("hypercomb.com isn't taking uploads from guests — the room gets your tiles from this device while you're here")
    expect(refused).not.toContain('jwize.com')
    expect(say(statusLine({ ...pooled, sync: { state: 'full', host: 'hypercomb.com' } }))).toContain('hypercomb.com is full')
    expect(say(statusLine({ ...pooled, share: { offered: 4 }, sync: { state: 'too-large' } }))).toContain('A picture is too large for hypercomb.com')
    expect(say(statusLine({ ...pooled, phase: 'connecting' }))).toBe('Connecting to jwize.com…')
    expect(say(statusLine({ ...pooled, phase: 'down' }))).toContain("Can't reach jwize.com")
  })

  it('nothing hosts the tiles: said once — the room gets them live from this device', () => {
    const line = statusLine({ ...live, uploadHost: '', share: { offered: 3, live: 3, host: '', hostSource: 'none', hostState: 'no-host' } })
    expect(say(line)).toBe("Live · meetup · amber falcon · 7 in the room (3 here) · No host keeps your tiles — the room gets them from this device while you're here")
    expect(line.tone).toBe('warn')
  })

  it('a picture too large is said beside the counts, and the host\'s live word beats the walk\'s snapshot', () => {
    const big = statusLine({ ...live, share: { offered: 4 }, sync: { state: 'too-large' } })
    expect(say(big)).toBe('Live · meetup · amber falcon · 7 in the room (3 here) · Sharing 4 · A picture is too large for jwize.com')
    expect(big.tone).toBe('warn')
    // the walk saw 'unreachable'; the host has since recovered
    expect(say(statusLine({ ...live, share: { offered: 4, hostState: 'unreachable' }, sync: { state: 'backed-up' } })))
      .toBe('Live · meetup · amber falcon · 7 in the room (3 here) · Sharing 4')
  })

  // THE 2026-10-10 MEETING: `favorites` published at the typo
  // `hyperccomb.com` read as "Sharing 27 · 1 uploading" for ever. A branch a
  // host takes none of the bytes of is named — the branch, the host, why.
  it('a branch a publish domain holds is named, with the host and why — never "uploading"', () => {
    const line = statusLine({
      ...live, uploadHost: 'hypercomb.com',
      share: {
        offered: 27, uploading: 0, host: 'hypercomb.com', hostSource: 'pool', hostState: 'backed-up',
        blocked: [{ branch: 'favorites', host: 'hyperccomb.com', state: 'unreachable', why: 'unresolved' }],
      },
      sync: { state: 'backed-up', host: 'hypercomb.com' },
    })
    expect(say(line)).toBe("Live · meetup · amber falcon · 7 in the room (3 here) · Sharing 27 · favorites: hyperccomb.com can't be reached — check the host name, and that the host is running")
    expect(line.tone).toBe('warn')
    const why = (w: string): string => say(statusLine({ ...live, share: { offered: 1, blocked: [{ branch: 'shop', host: 'shop.example', why: w }] } }))
    expect(why('page')).toContain('shop: shop.example answers with a web page — it takes no uploads')
    expect(why('refused')).toContain("shop: shop.example isn't taking uploads from this page")
    expect(why('full')).toContain('shop: shop.example is full')
    expect(why('unreachable')).toContain("shop: can't upload to shop.example right now")
  })

  it('standing on the branch itself: its own host\'s line names the branch and why, while the host\'s live word holds it', () => {
    const share = {
      offered: 3, uploading: 3, nameOnly: 3, host: 'hyperccomb.com', hostSource: 'publish', hostState: 'unreachable', why: 'unresolved',
      blocked: [{ branch: 'favorites', host: 'hyperccomb.com', state: 'unreachable', why: 'unresolved' }],
    }
    const held = say(statusLine({ ...live, uploadHost: 'hyperccomb.com', share, sync: { state: 'unreachable', why: 'unresolved', host: 'hyperccomb.com' } }))
    expect(held).toBe("Live · meetup · amber falcon · 7 in the room (3 here) · favorites: hyperccomb.com can't be reached — check the host name, and that the host is running")
    // The host answered since: the walk's snapshot of it says nothing.
    expect(say(statusLine({ ...live, uploadHost: 'hyperccomb.com', share, sync: { state: 'backed-up', host: 'hyperccomb.com' } })))
      .toBe('Live · meetup · amber falcon · 7 in the room (3 here) · Sharing 3 · 3 uploading')
  })

  // THE LIVE SWARM (decision c, 2026-10-11): a host field nothing at that
  // name ever answered is a standing answer — its tiles go out live from
  // this device, so the line never says "names only" for it.
  it('a host field that has never answered, with this page\'s tiles live: the room gets them from this device — never "names only"', () => {
    const share = { offered: 4, live: 4, nameOnly: 0, host: 'hyperccomb.com', hostSource: 'meeting', hostState: 'unreachable', why: 'unresolved' }
    const line = say(statusLine({ ...live, uploadHost: 'hyperccomb.com', share, sync: { state: 'unreachable', why: 'unresolved', host: 'hyperccomb.com' } }))
    expect(line).toContain("Nothing at hyperccomb.com has ever answered — the room gets your tiles from this device while you're here")
    expect(line).not.toContain('names only')
    // A moment's trouble at a host that HAS answered stays "names only" —
    // nothing went live for it.
    const passing = say(statusLine({ ...live, uploadHost: 'jwize.com', share: { offered: 2, nameOnly: 2, host: 'jwize.com', hostState: 'unreachable', why: 'unreachable' }, sync: { state: 'unreachable', why: 'unreachable', host: 'jwize.com' } }))
    expect(passing).toContain("Can't upload to jwize.com right now")
  })

  it('who keeps what is shared: no one, while the host refused this key, is full or never answered — its live word first', () => {
    expect(hostKeepsNothing({ host: 'friend.example', hostState: 'refused' }, null)).toBe(true)
    expect(hostKeepsNothing({ host: 'friend.example', hostState: 'backed-up' }, { state: 'refused' })).toBe(true)
    expect(hostKeepsNothing({ host: 'friend.example' }, { state: 'full' })).toBe(true)
    expect(hostKeepsNothing({ host: 'typo.example' }, { state: 'unreachable', why: 'unresolved' })).toBe(true)
    expect(hostKeepsNothing({ host: 'door.example' }, { state: 'refused', why: 'page' })).toBe(true)
    // Taking bytes, or a moment's trouble, or one file too large: it keeps them.
    expect(hostKeepsNothing({ host: 'jwize.com', hostState: 'refused' }, { state: 'backed-up' })).toBe(false)
    expect(hostKeepsNothing({ host: 'jwize.com' }, { state: 'syncing' })).toBe(false)
    expect(hostKeepsNothing({ host: 'jwize.com' }, { state: 'unreachable', why: 'unreachable' })).toBe(false)
    expect(hostKeepsNothing({ host: 'jwize.com' }, { state: 'too-large', why: 'too-large' })).toBe(false)
    expect(hostKeepsNothing(null, null)).toBe(false)
  })

  it('content this device does not hold', () => {
    expect(say(statusLine({ ...live, share: { offered: 5, uploading: 3, nameOnly: 3 }, sync: { state: 'syncing', missing: 2 } })))
      .toBe("Live · meetup · amber falcon · 7 in the room (3 here) · Sharing 5 · 3 uploading · 3 tiles include content this device doesn't hold")
  })

  it('private tiles here, with a one-tap Share', () => {
    const line = statusLine({ ...live, share: { offered: 1, private: 12 } })
    expect(say(line)).toBe('Live · meetup · amber falcon · 7 in the room (3 here) · Sharing 1 · 12 of your tiles here are private · Share')
    expect(line.parts.at(-1)?.action).toBe('share')
    expect(say(statusLine({ ...live, share: { private: 1 } }))).toContain('1 of your tiles here is private')
  })

  it('a far-off clock is said whatever else is on the line', () => {
    const line = statusLine({ ...live, clockOff: true })
    expect(say(line)).toContain('Your device clock is far off — set it automatically')
    expect(line.tone).toBe('warn')
    expect(say(statusLine({ ...live, phase: 'reconnecting', clockOff: true })))
      .toBe('Reconnecting… your tiles are safe · Your device clock is far off — set it automatically')
  })

  it('peers on an older version are counted', () => {
    expect(say(statusLine({ ...live, older: 2 }))).toContain('2 people need to tap Update to share')
    expect(say(statusLine({ ...live, older: 1 }))).toContain('1 person needs to tap Update to share')
  })

  it('a relay refusal is said', () => {
    expect(say(statusLine({ ...live, rejected: 'blocked: too many tags' })))
      .toContain('jwize.com refused an update: blocked: too many tags')
  })

  it('the filter chip says who you are looking at, and the way back', () => {
    expect(t('presence.room-filter', { name: 'Ana' })).toBe("Only Ana's tiles")
    expect(t('presence.room-show-all')).toBe('Show everyone')
  })
})

describe('the socket as a person reads it', () => {
  const now = 1_000_000
  it('no mesh:connection ever heard → the old rendering', () => {
    expect(linkPhase(null, null, now, false)).toBeNull()
  })
  it('open is live; a first connect is "connecting", a later one "reconnecting"', () => {
    expect(linkPhase({ state: 'open' }, null, now, false)).toBe('open')
    expect(linkPhase({ state: 'connecting' }, now - 1000, now, false)).toBe('connecting')
    expect(linkPhase({ state: 'connecting' }, now - 1000, now, true)).toBe('reconnecting')
    expect(linkPhase({ state: 'stalled' }, now - 1000, now, true)).toBe('reconnecting')
    expect(linkPhase({ state: 'retrying' }, now - 1000, now, true)).toBe('reconnecting')
  })
  it('30 s without a live socket, in any non-open state, is "can\'t reach"', () => {
    expect(linkPhase({ state: 'retrying' }, now - UNREACHABLE_AFTER_MS, now, true)).toBe('down')
    expect(linkPhase({ state: 'retrying' }, now - UNREACHABLE_AFTER_MS + 1, now, true)).toBe('reconnecting')
    // 'offline' is also the instant between a join and the first dial — it
    // must not flash "can't reach" before the mesh has even tried.
    expect(linkPhase({ state: 'offline' }, now, now, false)).toBe('connecting')
    expect(linkPhase({ state: 'offline' }, now - UNREACHABLE_AFTER_MS, now, false)).toBe('down')
  })
  it('a clock refusal is recognised in either shape', () => {
    expect(clockRefused({ state: 'open', refused: 'clock' })).toBe(true)
    expect(clockRefused({ state: 'open', refused: { reason: 'clock', at: 1 } })).toBe(true)
    expect(clockRefused({ state: 'open', refused: { reason: 'rate-limited' } })).toBe(false)
    expect(clockRefused({ state: 'open' })).toBe(false)
  })
})

describe("the room's two words", () => {
  it('come from the host, the room and the secret — the lifecycle preimage (2026-10-12)', () => {
    const H = 'hypercomb.com'
    expect(roomWords('meetup', '4417', H)).toBe(secretTag('lifecycle\u0000meetup\u00004417\u0000hypercomb.com'))
    expect(roomWords('meetup', '4417', 'wss://HyperComb.com/')).toBe(roomWords('meetup', '4417', H))
    expect(roomWords('meetup', '4417', 'wss://point.example')).toBe(secretTag('lifecycle\u0000meetup\u00004417\u0000point.example'))
    expect(roomWords(' meetup ', ' 4417 ', H)).toBe(roomWords('meetup', '4417', H))
    expect(roomWords('', '', H)).toBe('')
  })

  it('NO HOST, NO WORDS — there is no default host (2026-10-11)', () => {
    expect(roomWords('meetup', '4417')).toBe('')
    expect(roomWords('meetup', '4417', '')).toBe('')
    expect(roomWords('meetup', '4417', '   ')).toBe('')
    expect(wordsBeside('meetup', '4417', '', 'ja')).toBe('')
    expect(meetingPointKey('')).toBe('')
  })

  it('show the host beside them — "marble cove · hypercomb.com" — the host in the preimage, never the page', () => {
    const words = roomWords('meetup', '4417', 'wss://HyperComb.com/')
    expect(wordsAtHost(words, 'wss://HyperComb.com/')).toBe(`${words} · hypercomb.com`)
    expect(wordsAtHost('faint dew', 'ws://localhost:7777')).toBe('faint dew · localhost:7777')
    expect(wordsAtHost('faded lynx', 'wss://jwize.com')).toBe('faded lynx · jwize.com')
    // the words alone with no host; nothing with no words
    expect(wordsAtHost('faint dew', '')).toBe('faint dew')
    expect(wordsAtHost('', 'hypercomb.com')).toBe('')
    // jwize's two tabs (2026-10-11): one relay under two names reads two
    // pairs AND two hosts — the split shows at a glance.
    const dev = wordsAtHost(roomWords('r', 's', 'ws://localhost:7777'), 'ws://localhost:7777')
    const live = wordsAtHost(roomWords('r', 's', 'wss://jwize.com'), 'wss://jwize.com')
    expect(dev).not.toBe(live)
    expect(dev.endsWith(' · localhost:7777')).toBe(true)
    expect(live.endsWith(' · jwize.com')).toBe(true)
  })

  it('follow the package that addresses the room — a shell newer than its package reads that package\'s pair', () => {
    const ioc = globalThis as { ioc?: unknown }
    const prior = ioc.ioc
    const swarm: { roomIdentity?: number } = {}
    ioc.ioc = { get: (key: string) => key === '@diamondcoreprocessor.com/SwarmDrone' ? swarm : undefined }
    try {
      // A package from before 2026-10-12 (no marker) meets at `lifecycle \0
      // room \0 secret`, the point folded into the words only off the
      // default (D4): its words are that address's, whatever this shell is.
      expect(loadedRoomIdentity()).toBe(1)
      expect(roomWords('meetup', '4417')).toBe(secretTag('lifecycle\u0000meetup\u00004417'))
      expect(roomWords('meetup', '4417', 'wss://hypercomb.com')).toBe(secretTag('lifecycle\u0000meetup\u00004417'))
      expect(roomWords('meetup', '4417', 'wss://point.example')).toBe(secretTag('lifecycle\u0000meetup\u00004417\u0000point.example'))
      expect(wordsBeside('meetup', '4417', '', 'ja')).toContain(secretTag('lifecycle\u0000meetup\u00004417', 'ja'))
      // The package that marks itself 2 meets at host + room + secret — and
      // with no host, nowhere.
      swarm.roomIdentity = 2
      expect(loadedRoomIdentity()).toBe(ROOM_IDENTITY)
      expect(roomWords('meetup', '4417', 'hypercomb.com')).toBe(secretTag('lifecycle\u0000meetup\u00004417\u0000hypercomb.com'))
      expect(roomWords('meetup', '4417')).toBe('')
    } finally { ioc.ioc = prior }
    // No swarm loaded yet: the current identity.
    expect(loadedRoomIdentity()).toBe(ROOM_IDENTITY)
  })

  it('the swarm says which identity it derives with — the marker the shell reads', () => {
    const swarm = readFileSync(join(UI, '..', '..', 'hypercomb-essentials', 'src', 'sharing', 'swarm.drone.ts'), 'utf8')
    expect(swarm).toContain(`public readonly roomIdentity = ${ROOM_IDENTITY}`)
    expect(swarm).toContain('roomPreimage(room, secret, this.#swarmHost())')
  })

  it('are the same on every page: no word surface hashes the page any more', () => {
    // Two pages, one room: the crumb, the location window and the presence
    // line all fold room, secret and the meeting point (never the page) —
    // the crumb the English pair alone, the other two with the reader's
    // own beside it (D4, 2026-10-10).
    const bar = readFileSync(join(UI, 'controls-bar', 'controls-bar.component.ts'), 'utf8')
    const crumb = bar.slice(bar.indexOf('readonly secretWords = computed('), bar.indexOf('readonly hasSecret'))
    // the words, and the host they are drawn at beside them (2026-10-11)
    expect(crumb).toContain('wordsAtHost(roomWords(this.#room$(), this.#secret$(), this.#meetPoint$()), this.#meetPoint$())')
    expect(crumb).not.toMatch(/#lineageKey|segmentsRaw|#locale/)
    expect(crumb).not.toMatch(/location\??\.(host|hostname|origin)\b/)
    expect(bar).not.toContain('secretTag(')

    const modal = readFileSync(join(UI, 'mesh-modal', 'mesh-modal.component.ts'), 'utf8')
    // the drafts as START will store them (D6), the host, the reader's locale — never the page
    expect(modal).toContain('const point = this.#wordsPoint()')
    expect(modal).toMatch(/wordsAtHost\(wordsBeside\(\s*this\.#asStored\(this\.roomDraft\(\), this\.#roomStore\?\.value\),\s*this\.#asStored\(this\.secretDraft\(\), this\.#secretStore\?\.value\),\s*point, this\.#locale\(\)\), point\)/)
    expect(modal).not.toContain('secretTag(')
    expect(modal).not.toContain('#lineageKey')
    // the page's own domain picks no host there either
    expect(modal).not.toMatch(/location\??\.(host|hostname|origin)\b/)

    const banner = readFileSync(join(UI, 'presence-banner', 'presence-banner.component.ts'), 'utf8')
    expect(banner).toContain('wordsAtHost(wordsBeside(this.#room(), this.#secret(), this.#swarmHost(), this.#locale()), this.#swarmHost())')
    expect(banner).not.toContain('secretTag(')
    expect(banner).not.toMatch(/location\??\.(host|hostname|origin)\b/)
  })

  it("the crumb's root is never the page's domain while in a swarm — it reads as home; the host stands beside the words (2026-10-11)", () => {
    const html = readFileSync(join(UI, 'controls-bar', 'controls-bar.component.html'), 'utf8').replace(/\r\n/g, '\n')
    const root = html.slice(html.indexOf('<div class="breadcrumb-top"'), html.indexOf('@for (seg of pathSegments()'))
    // activeDomain() (the page's hostname) only in the private branch
    const at = root.indexOf('activeDomain()')
    expect(at).toBeGreaterThan(root.indexOf('} @else {', root.indexOf('@if (meshPublic())')))
    expect(root.slice(root.indexOf('@if (meshPublic())'), root.indexOf('} @else {', root.indexOf('@if (meshPublic())')))).not.toContain('activeDomain()')
  })

  it('the command line never autocorrects either: a room typed there is the room (ZI-8)', () => {
    const html = readFileSync(join(UI, 'command-shell', 'command-shell.component.html'), 'utf8')
    const at = html.indexOf('class="command-input"')
    const tag = html.slice(html.lastIndexOf('<input', at), html.indexOf('/>', at))
    for (const attr of ['autocapitalize="off"', 'autocorrect="off"', 'spellcheck="false"', 'autocomplete="off"']) {
      expect(tag, `command input ${attr}`).toContain(attr)
    }
  })

  it('room and secret fields never autocapitalize or autocorrect', () => {
    const html = readFileSync(join(UI, 'mesh-modal', 'mesh-modal.component.html'), 'utf8')
    for (const id of ['mesh-modal-room-input', 'mesh-modal-secret-input']) {
      const at = html.indexOf(`id="${id}"`)
      const tag = html.slice(html.lastIndexOf('<input', at), html.indexOf('/>', at))
      for (const attr of ['autocapitalize="off"', 'autocorrect="off"', 'spellcheck="false"', 'autocomplete="off"']) {
        expect(tag, `${id} ${attr}`).toContain(attr)
      }
    }
  })
})

// ── catalogs ─────────────────────────────────────────────────────────────

const NEW_KEYS = Object.keys(en)
  .filter(k => /^(mesh\.state\.|swarm\.share\.|presence\.room-|invite\.meet\.)/.test(k))
  .concat(['command.inert', 'host.no-host'])
const RETIRED = [
  'swarm.needs-host.title', 'swarm.needs-host.message',
  'swarm.availability-hold.title', 'swarm.availability-hold.message',
]

describe('the status line speaks every language the window does', () => {
  const files = readdirSync(I18N).filter(f => f.endsWith('.json'))

  it('finds every catalog and every new key', () => {
    expect(files.length).toBeGreaterThanOrEqual(14)
    expect(NEW_KEYS.length).toBeGreaterThan(35)
  })

  for (const file of files) {
    it(`${file}: carries every new key with the same tokens, and none of the retired ones`, () => {
      const json = catalog(file)
      for (const key of NEW_KEYS) {
        expect(json[key], `${file} is missing ${key}`).toBeTypeOf('string')
        expect(json[key].trim().length, `${file} ${key} is empty`).toBeGreaterThan(0)
        const want = (en[key].match(/\{\w+\}/g) ?? []).sort()
        const have = (json[key].match(/\{\w+\}/g) ?? []).sort()
        expect(have, `${file} ${key} tokens`).toEqual(want)
      }
      for (const key of RETIRED) expect(key in json, `${file} still carries ${key}`).toBe(false)
    })
  }

  it('host.failed no longer points at the retired sync pill', () => {
    expect(en['host.failed']).not.toMatch(/pill/i)
    expect(en['host.no-host']).toContain('{reason}')
  })
})
