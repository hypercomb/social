// sharing/meeting-link.spec.ts — ONE LINK PUTS EVERYONE IN THE SAME ROOM,
// ON THE SAME PAGE, WITH ONE TAP.
//
// The meeting split into rooms nobody knew they were in: a capital the phone
// slipped into the room, a stale secret /join silently reused, an invite that
// recorded the URL's lower-cased page instead of the one the swarm hashes.
// `#meet=room/secret/page` carries the place itself — no host, no bundle, no
// upload — and joining from it sets the credentials EXACTLY, walks to the
// page, drops the command line to tiles and joins through the one toggle.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { MEET_KEY, MEET_PREFIX, meetFragment, parseMeet } from './meeting-invite.js'

// ── a stubbed world ───────────────────────────────────────────────────────
const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  whenReady: () => void 0,
}

const cred = (initial: string) => ({ value: initial, set(v: string) { this.value = String(v ?? '').trim() } })
const room = cred('old-room')
const secret = cred('old-secret')
const walks: string[][] = []
let explorer: string[] = []
services.set('@hypercomb.social/RoomStore', room)
services.set('@hypercomb.social/SecretStore', secret)
services.set('@hypercomb.social/Navigation', {
  go: (s: readonly string[]) => { walks.push(['go', ...s]) },
  goRaw: (s: readonly string[]) => { walks.push([...s]); explorer = [...s] },
  segments: () => explorer.map(s => s.toLowerCase()),
})
services.set('@hypercomb.social/Lineage', { explorerSegments: () => explorer })
services.set('@diamondcoreprocessor.com/NostrMeshDrone', { swarmHost: () => 'jwize.com' })

// What the join says and does, captured from the bus.
const confirms: { title: string; message: string }[] = []
let answer = true
EffectBus.on<{ id: string; title: string; message: string }>('confirm:request', (r) => {
  if (!r?.id || confirms.some(c => (c as { id?: string }).id === r.id)) return
  confirms.push({ ...r })
  queueMicrotask(() => EffectBus.emit('confirm:response', { id: r.id, confirmed: answer }))
})
const toggles: unknown[] = []
const stances: unknown[] = []
const toasts: { type: string; title: string; message: string }[] = []
EffectBus.emit('keymap:invoke', { cmd: 'noop' })
EffectBus.emit('command-line:stance', { stance: 'noop' })
EffectBus.on<{ cmd?: string }>('keymap:invoke', (p) => { if (p?.cmd === 'mesh.togglePublic') toggles.push(p) })
EffectBus.on<{ stance?: string }>('command-line:stance', (p) => { if (p?.stance !== 'noop') stances.push(p?.stance) })
EffectBus.on<{ type: string; title: string; message: string }>('toast:show', (t) => { if (t) toasts.push(t) })

const { joinMeetingPlace } = await import('./meeting-invite.join.js')
const { InviteQueenBee } = await import('./invite.queen.js')

const joined = (on: boolean): void => EffectBus.emit('mesh:public-changed', { public: on })

beforeEach(() => {
  room.value = 'old-room'
  secret.value = 'old-secret'
  walks.length = 0
  explorer = []
  confirms.length = 0
  toggles.length = 0
  stances.length = 0
  toasts.length = 0
  answer = true
  joined(false)
  try { localStorage.removeItem('hc:command-line-stance') } catch { /* jsdom */ }
})

// ── the link itself ───────────────────────────────────────────────────────
describe('the meeting link', () => {
  it('round-trips a room and secret with spaces and unicode, and the page as written', () => {
    const frag = meetFragment('Meet Up', 'çlé 4417 🔑', ['Big Ideas', 'café', 'a/b'.replace('/', '∕')])
    expect(frag.startsWith(MEET_PREFIX)).toBe(true)
    expect(frag).not.toMatch(/[ ]/)
    const back = parseMeet(frag)
    expect(back?.room).toBe('Meet Up')
    expect(back?.secret).toBe('çlé 4417 🔑')
    expect(back?.segments).toEqual(['Big Ideas', 'café', 'a∕b'])
    // the stash holds the text after the prefix — parse that too
    expect(parseMeet(frag.slice(MEET_PREFIX.length))).toEqual(back)
  })

  it('a slash inside a part is encoded, so it can never add a page', () => {
    const frag = meetFragment('r/oom', 's', [])
    expect(parseMeet(frag)).toBeNull()   // a decoded part may not carry a slash
  })

  it('ignores a malformed fragment', () => {
    for (const bad of ['', '#meet=', '#meet=onlyroom', '#meet=room/', '#meet=/secret', '#meet=%E0%A4%A/x', '#other=room/secret']) {
      expect(parseMeet(bad), bad).toBeNull()
    }
  })

  it('the shell and the module agree on the stash key', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const capture = readFileSync(join(process.cwd(), 'hypercomb-shared', 'core', 'invite-capture.ts'), 'utf8')
    expect(capture).toContain(`'${MEET_KEY}'`)
    expect(capture).toContain(`'${MEET_PREFIX}'`)
  })
})

// ── joining from it ───────────────────────────────────────────────────────
describe('joining from a meeting link', () => {
  it('asks once, naming the room and the host that keeps what is shared', async () => {
    await joinMeetingPlace(parseMeet(meetFragment('meetup', '4417', ['Ideas']))!)
    expect(confirms).toHaveLength(1)
    expect(confirms[0].title).toBe('Join the room')
    expect(confirms[0].message).toContain('“meetup”')
    expect(confirms[0].message).toContain('kept by jwize.com')
  })

  it('on Join: exact credentials, the page as written, tiles stance, then the one toggle', async () => {
    const ok = await joinMeetingPlace(parseMeet(meetFragment('Meetup', '4417', ['Big Ideas']))!)
    expect(ok).toBe(true)
    expect(room.value).toBe('Meetup')        // never case-folded
    expect(secret.value).toBe('4417')
    expect(walks).toEqual([['Big Ideas']])   // goRaw: case kept
    expect(stances).toEqual(['tiles'])
    expect(localStorage.getItem('hc:command-line-stance')).toBe('tiles')
    expect(toggles).toHaveLength(1)
  })

  it('does not toggle a tab that is already a member (a toggle would make it leave)', async () => {
    joined(true)
    await joinMeetingPlace(parseMeet(meetFragment('meetup', '4417', []))!)
    expect(room.value).toBe('meetup')
    expect(toggles).toHaveLength(0)
  })

  it('already in this room: no sheet, just the walk to the page', async () => {
    room.value = 'meetup'
    secret.value = '4417'
    joined(true)
    const ok = await joinMeetingPlace(parseMeet(meetFragment('meetup', '4417', ['Ideas']))!)
    expect(ok).toBe(false)
    expect(confirms).toHaveLength(0)
    expect(walks).toEqual([['Ideas']])
    expect(toggles).toHaveLength(0)
  })

  it('Not now leaves everything as it was', async () => {
    answer = false
    const ok = await joinMeetingPlace(parseMeet(meetFragment('meetup', '4417', ['Ideas']))!)
    expect(ok).toBe(false)
    expect(room.value).toBe('old-room')
    expect(secret.value).toBe('old-secret')
    expect(walks).toEqual([])
    expect(toggles).toHaveLength(0)
    expect(stances).toEqual([])
  })
})

// ── the invite word ───────────────────────────────────────────────────────
describe('`invite` with nothing selected', () => {
  const writes: string[] = []
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async (s: string) => { writes.push(s) }) },
  })
  services.set('@diamondcoreprocessor.com/SelectionService', { selected: new Set<string>() })

  beforeEach(() => { writes.length = 0 })

  it('copies the meeting link for the page the swarm hashes — no host needed', async () => {
    room.value = 'meetup'
    secret.value = '4417'
    joined(true)
    explorer = ['Home Pinned']   // what the explorer shows…
    services.set('@diamondcoreprocessor.com/SwarmDrone', { currentSegments: () => ['Big Ideas'] })  // …and what the swarm hashes
    await new InviteQueenBee().invoke('')
    expect(writes).toHaveLength(1)
    const url = writes[0]
    expect(url.startsWith(`${window.location.origin}/#meet=`)).toBe(true)
    const place = parseMeet(url.slice(url.indexOf('#')))
    expect(place).toMatchObject({ room: 'meetup', secret: '4417', segments: ['Big Ideas'] })
    expect(toasts.at(-1)?.message).toContain('Meeting link copied')
  })

  it('not joined: the explorer page, still no host', async () => {
    room.value = 'meetup'
    secret.value = '4417'
    explorer = ['Café']
    await new InviteQueenBee().invoke('')
    const url = writes[0]
    expect(parseMeet(url.slice(url.indexOf('#')))?.segments).toEqual(['Café'])
  })

  it('without a room and secret there is nothing to hand out', async () => {
    room.value = ''
    await new InviteQueenBee().invoke('')
    expect(writes).toHaveLength(0)
  })

  it("the status line's Invite hands out the meeting link even with a tile selected", async () => {
    room.value = 'meetup'
    secret.value = '4417'
    explorer = ['Café']
    services.set('@diamondcoreprocessor.com/SelectionService', { selected: new Set<string>(['some tile']) })
    try {
      await new InviteQueenBee().meetingLink()
      expect(writes).toHaveLength(1)
      expect(parseMeet(writes[0].slice(writes[0].indexOf('#')))).toMatchObject({ room: 'meetup', secret: '4417' })
    } finally {
      services.set('@diamondcoreprocessor.com/SelectionService', { selected: new Set<string>() })
    }
  })
})
