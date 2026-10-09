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
  UNREACHABLE_AFTER_MS, clockRefused, linkPhase, roomWords, statusLine,
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

  it('host refuses, host full, picture too large — names only, and why', () => {
    const refused = statusLine({ ...live, share: { offered: 2, hostState: 'refused' } })
    expect(say(refused)).toContain("jwize.com isn't taking uploads from guests — others see your tile names only")
    expect(refused.tone).toBe('warn')
    expect(say(statusLine({ ...live, sync: { state: 'full' } })))
      .toContain('jwize.com is full — others see your tile names only')
    expect(say(statusLine({ ...live, share: { hostState: 'too-large' } })))
      .toContain('A picture is too large for jwize.com')
  })

  it('the upload lines name the page\'s host; the connection lines name the relay', () => {
    // 2026-10-07: a page's tiles go to its publish domains, else the hosts
    // pool, else a relay that hosts participants — never the relay merely
    // because it is where we meet.
    const pooled = { ...live, uploadHost: 'hypercomb.com' }
    const refused = say(statusLine({ ...pooled, share: { offered: 2, host: 'hypercomb.com', hostSource: 'pool', hostState: 'refused' } }))
    expect(refused).toContain("hypercomb.com isn't taking uploads from guests — others see your tile names only")
    expect(refused).not.toContain('jwize.com')
    expect(say(statusLine({ ...pooled, sync: { state: 'full', host: 'hypercomb.com' } }))).toContain('hypercomb.com is full')
    expect(say(statusLine({ ...pooled, share: { offered: 4 }, sync: { state: 'too-large' } }))).toContain('A picture is too large for hypercomb.com')
    expect(say(statusLine({ ...pooled, phase: 'connecting' }))).toBe('Connecting to jwize.com…')
    expect(say(statusLine({ ...pooled, phase: 'down' }))).toContain("Can't reach jwize.com")
  })

  it('nothing hosts the tiles: said once, names only', () => {
    const line = statusLine({ ...live, uploadHost: '', share: { offered: 3, uploading: 3, nameOnly: 3, host: '', hostSource: 'none', hostState: 'no-host' } })
    expect(say(line)).toBe('Live · meetup · amber falcon · 7 in the room (3 here) · No host keeps your tiles yet — others see your tile names only')
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
  it('come from the room and the secret only — the lifecycle preimage', () => {
    expect(roomWords('meetup', '4417')).toBe(secretTag('lifecycle\u0000meetup\u00004417'))
    expect(roomWords(' meetup ', ' 4417 ')).toBe(roomWords('meetup', '4417'))
    expect(roomWords('', '')).toBe('')
  })

  it('are the same on every page: no word surface hashes the page any more', () => {
    // Two pages, one room: the crumb and the location window both call
    // roomWords(room, secret) and nothing else feeds it.
    const bar = readFileSync(join(UI, 'controls-bar', 'controls-bar.component.ts'), 'utf8')
    const crumb = bar.slice(bar.indexOf('readonly secretWords = computed('), bar.indexOf('readonly hasSecret'))
    expect(crumb).toContain('roomWords(this.#room$(), this.#secret$(), this.#locale$())')
    expect(crumb).not.toMatch(/#lineageKey|segmentsRaw/)
    expect(bar).not.toContain('secretTag(')

    const modal = readFileSync(join(UI, 'mesh-modal', 'mesh-modal.component.ts'), 'utf8')
    expect(modal).toContain('roomWords(this.roomDraft(), this.secretDraft(), this.#locale())')
    expect(modal).not.toContain('secretTag(')
    expect(modal).not.toContain('#lineageKey')
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
