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
import { MEET_KEY, MEET_PREFIX, encodeInviteBundle, isAccessCode, meetFragment, meetingHostOf, meetingRelayOf, parseMeet } from './meeting-invite.js'

// ── a stubbed world ───────────────────────────────────────────────────────
const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  whenReady: () => void 0,
}

/** Every set() is counted: "Not now" must write NOTHING. */
let credWrites = 0
const cred = (initial: string) => ({ value: initial, set(v: string) { credWrites++; this.value = String(v ?? '').trim() } })
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
let meshRelays: string[] = ['wss://jwize.com']
const configured: string[][] = []
/** What the mesh says the meeting point answered this tab's code with. */
let meshRefused: string | undefined
services.set('@diamondcoreprocessor.com/NostrMeshDrone', {
  swarmHost: () => 'jwize.com',
  getDebug: () => ({ relays: meshRelays }),
  configureRelays: (urls: string[]) => { configured.push([...urls]); meshRelays = [...urls] },
  connectionState: () => ({ state: 'open', refused: meshRefused }),
})
// Where the invited page's tiles would go for this guest (host-sync's
// resolver): a fresh install's pool host — never the relay it meets at.
const asked: string[][] = []
const warmed: string[][] = []
/** Lookups that answer "still being read" before the host is known. */
let pendingLookups = 0
services.set('@diamondcoreprocessor.com/HostSyncService', {
  swarmHostsFor: (segments: readonly string[]) => {
    asked.push([...segments])
    if (pendingLookups > 0) { pendingLookups--; return { hosts: [], source: 'none', pending: true } }
    return { hosts: ['hypercomb.com'], source: 'pool', pending: false }
  },
  warmSwarmHosts: (segments: readonly string[]) => { warmed.push([...segments]) },
})

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
const meetingPoints: unknown[] = []
EffectBus.on('mesh:zone', (p) => { if (p) meetingPoints.push(p) })
const modals: unknown[] = []
EffectBus.on('mesh:open-modal', (p) => { if (p) modals.push(p) })
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
  credWrites = 0
  meshRelays = ['wss://jwize.com']
  configured.length = 0
  meetingPoints.length = 0
  modals.length = 0
  sessionStorage.removeItem('hc:mesh-zone')
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

  it('carries a meeting point after the place — relay, host and code — and reads it back', () => {
    const frag = meetFragment('downtown', 'downtown', ['Big Ideas'], { relay: 'wss://pluginthematrix.com', host: 'pluginthematrix.com', code: 'k3y.Recycled-2' })
    expect(frag).toBe('#meet=downtown/downtown/Big%20Ideas&relay=wss%3A%2F%2Fpluginthematrix.com&host=https%3A%2F%2Fpluginthematrix.com&code=k3y.Recycled-2')
    expect(parseMeet(frag)).toMatchObject({
      room: 'downtown', secret: 'downtown', segments: ['Big Ideas'],
      relay: 'wss://pluginthematrix.com', host: 'pluginthematrix.com', code: 'k3y.Recycled-2',
    })
    // A shortened relay or a bare host, typed by hand, still reads.
    expect(parseMeet('#meet=r/s&relay=pluginthematrix.com&host=pluginthematrix.com')).toMatchObject({ relay: 'wss://pluginthematrix.com', host: 'pluginthematrix.com' })
  })

  it('a package older than the meeting point reads every link that carries one as malformed — never a wrong zone', () => {
    // The parser every published package before the meeting point runs
    // (75007af2 and older), verbatim: it splits on '/' alone.
    const legacyParseMeet = (raw: string): { room: string; secret: string; segments: string[] } | null => {
      let body = String(raw ?? '').trim()
      if (body.startsWith('#meet=')) body = body.slice('#meet='.length)
      else if (body.startsWith('meet=')) body = body.slice('meet='.length)
      if (!body || body.startsWith('#')) return null
      const encoded = body.split('/')
      if (encoded.length < 2 || encoded.length > 64 + 2) return null
      const parts: string[] = []
      for (const e of encoded) {
        let part: string
        try { part = decodeURIComponent(e) } catch { return null }
        if (part.length > 512 || /[\/\\]/.test(part)) return null
        parts.push(part)
      }
      const [room, secret, ...rest] = parts
      if (!room.trim() || !secret.trim()) return null
      return { room: room.trim(), secret: secret.trim(), segments: rest.filter(s => s.trim().length > 0) }
    }
    const points = [
      { relay: 'wss://pluginthematrix.com' },
      { relay: 'wss://pluginthematrix.com', code: 'Abc_123-xyz' },
      { relay: 'wss://pluginthematrix.com/io', host: 'pluginthematrix.com', code: 'k3y.Recycled-2' },
      { relay: 'ws://localhost:7801', code: 'k' },
      { host: 'pluginthematrix.com' },
      { host: 'localhost:4250' },
    ]
    for (const point of points) for (const segments of [[], ['page'], ['Big Ideas', 'café']]) {
      const frag = meetFragment('room', 'secret', segments, point)
      expect(frag, JSON.stringify(point)).toContain('&')
      expect(legacyParseMeet(frag), frag).toBeNull()
      expect(legacyParseMeet(frag.slice('#meet='.length)), frag).toBeNull()
      expect(parseMeet(frag)?.room, frag).toBe('room')
    }
    // …while a link with no meeting point still reads the same on both.
    expect(legacyParseMeet(meetFragment('Meet Up', '4417', ['Big Ideas']))).toEqual({ room: 'Meet Up', secret: '4417', segments: ['Big Ideas'] })
  })

  it('a meeting point with a path or a port keeps it; a loopback one may be ws://', () => {
    expect(parseMeet(meetFragment('r', 's', [], { relay: 'wss://pluginthematrix.com/io' }))?.relay).toBe('wss://pluginthematrix.com/io')
    expect(parseMeet(meetFragment('r', 's', [], { relay: 'ws://localhost:7801' }))?.relay).toBe('ws://localhost:7801')
    expect(parseMeet('#meet=r/s&relay=pluginthematrix.com%2Fio')?.relay).toBe('wss://pluginthematrix.com/io')
  })

  it('every link minted before the meeting point still reads exactly as it did', () => {
    const old = parseMeet('#meet=Meet%20Up/4417/Big%20Ideas')
    expect(old).toEqual({ kind: 'hypercomb.meeting-invite', v: 1, segments: ['Big Ideas'], room: 'Meet Up', secret: '4417' })
    expect(meetFragment('Meet Up', '4417', ['Big Ideas'])).toBe('#meet=Meet%20Up/4417/Big%20Ideas')
    expect(meetFragment('Meet Up', '4417', ['Big Ideas'], {})).toBe('#meet=Meet%20Up/4417/Big%20Ideas')
  })

  it('a meeting point that is not one makes the whole link no link — never a quiet default', () => {
    for (const bad of [
      '#meet=r/s&relay=ws://pluginthematrix.com',          // ws:// off loopback
      '#meet=r/s&relay=wss://user:pw@pluginthematrix.com', // credentials
      '#meet=r/s&relay=wss://x.example/?q=1',              // a query
      '#meet=r/s&relay=not a host',
      '#meet=r/s&relay=x.example&code=has%20space',        // a code no dial can carry
      '#meet=r/s&relay=x.example&code=a%2Cb',
      '#meet=r/s&host=evil.example:8443',                  // a port on a real host
      '#meet=r/s&relay=%E0%A4%A',
    ]) expect(parseMeet(bad), bad).toBeNull()
  })

  it('a code without a meeting point is never kept (it would go to the default relay)', () => {
    expect(parseMeet('#meet=r/s&code=abc')).not.toHaveProperty('code')
    expect(meetFragment('r', 's', [], { code: 'abc' })).toBe('#meet=r/s')
  })

  it('unknown keys are ignored; the first of a repeated key wins', () => {
    expect(parseMeet('#meet=r/s&later=1&relay=a.example&relay=b.example')?.relay).toBe('wss://a.example')
  })

  it('the code never enters an invite bundle (a resource, which a host serves)', async () => {
    const link = parseMeet(meetFragment('r', 's', [], { relay: 'wss://a.example', code: 'sekrit' }))!
    const blob = encodeInviteBundle(link)
    const text = await new Promise<string>(resolve => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsText(blob) })
    expect(text).not.toContain('sekrit')
    expect(text).not.toContain('a.example')
  })

  it('validators: an access code is an HTTP token; hosts and relays are canonical', () => {
    expect(isAccessCode('abc-DEF_123.~!')).toBe(true)
    for (const bad of ['', 'a b', 'a,b', 'a/b', 'a:b', 'x'.repeat(129), 'é']) expect(isAccessCode(bad), bad).toBe(false)
    expect(meetingRelayOf('PluginTheMatrix.com/')).toBe('wss://pluginthematrix.com')
    expect(meetingRelayOf('wss://x.example:8443/io/')).toBe('wss://x.example:8443/io')
    expect(meetingHostOf('https://PluginTheMatrix.com/io')).toBe('pluginthematrix.com')
    expect(meetingHostOf('localhost:7801')).toBe('localhost:7801')
    expect(meetingHostOf('x.example:8443')).toBe('')
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
    expect(confirms[0].message).toContain('kept by hypercomb.com')
    expect(confirms[0].message).not.toContain('jwize.com')
    expect(asked.at(-1)).toEqual(['Ideas']) // the page the link names
  })

  it('a first visit: the sheet waits briefly for the invited page host, and names it', async () => {
    pendingLookups = 3 // the pool and the page's marks are still being read
    confirms.length = 0
    await joinMeetingPlace(parseMeet(meetFragment('meetup', '4417', ['Fresh']))!)
    expect(warmed.at(-1)).toEqual(['Fresh'])
    expect(confirms.at(-1)!.message).toContain('kept by hypercomb.com')
    expect(confirms.at(-1)!.message).not.toContain('jwize.com')
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

  it("Not now WRITES nothing — not even the pair it found (a stale tab's pair over another tab's meeting)", async () => {
    answer = false
    await joinMeetingPlace(parseMeet(meetFragment('meetup', '4417', ['Ideas'], { relay: 'wss://a.example', code: 'k' }))!)
    expect(credWrites).toBe(0)
    expect(sessionStorage.getItem('hc:mesh-zone')).toBeNull()
    expect(configured).toEqual([])
  })

  it('a link with a meeting point: the sheet names it and its host — never the code', async () => {
    await joinMeetingPlace(parseMeet(meetFragment('downtown', 'downtown', [], { relay: 'wss://pluginthematrix.com/io', host: 'pluginthematrix.com', code: 'sekrit-42' }))!)
    const message = confirms.at(-1)!.message
    expect(message).toContain('at pluginthematrix.com/io')
    expect(message).toContain('kept by pluginthematrix.com')
    expect(message).not.toContain('hypercomb.com')     // the meeting host outranks the pool
    expect(message).not.toContain('sekrit-42')
    for (const t of toasts) expect(JSON.stringify(t)).not.toContain('sekrit-42')
  })

  it("on Join the meeting point becomes this tab's, and the mesh is pointed at it (the code never announced)", async () => {
    const ok = await joinMeetingPlace(parseMeet(meetFragment('downtown', 'downtown', [], { relay: 'wss://pluginthematrix.com', host: 'pluginthematrix.com', code: 'sekrit-42' }))!)
    expect(ok).toBe(true)
    expect(JSON.parse(sessionStorage.getItem('hc:mesh-zone')!)).toEqual({
      room: 'downtown', secret: 'downtown', relay: 'wss://pluginthematrix.com', host: 'pluginthematrix.com', code: 'sekrit-42',
    })
    expect(configured).toEqual([['wss://pluginthematrix.com']])
    expect(meetingPoints).toEqual([{ relay: 'wss://pluginthematrix.com' }])
  })

  it('a plain link drops a meeting point this tab held from an earlier meeting', async () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'old-room', secret: 'old-secret', relay: 'wss://a.example', host: 'a.example', code: 'old' }))
    await joinMeetingPlace(parseMeet(meetFragment('meetup', '4417', []))!)
    expect(JSON.parse(sessionStorage.getItem('hc:mesh-zone')!)).toEqual({ room: 'meetup', secret: '4417' })
    expect(meetingPoints).toEqual([{ relay: '' }])
  })

  it('same room at ANOTHER meeting point is not "already here" — it asks', async () => {
    room.value = 'meetup'
    secret.value = '4417'
    joined(true)
    await joinMeetingPlace(parseMeet(meetFragment('meetup', '4417', [], { relay: 'wss://a.example' }))!)
    expect(confirms).toHaveLength(1)
  })

  it('already here while the meeting point refuses the code: no sheet, the new code is dialled at once', async () => {
    room.value = 'meetup'
    secret.value = '4417'
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'meetup', secret: '4417', relay: 'wss://a.example', host: 'a.example', code: 'old' }))
    joined(true)
    meshRefused = 'access'
    try {
      await joinMeetingPlace(parseMeet(meetFragment('meetup', '4417', [], { relay: 'wss://a.example', code: 'new' }))!)
    } finally { meshRefused = undefined }
    expect(confirms).toHaveLength(0)
    expect(JSON.parse(sessionStorage.getItem('hc:mesh-zone')!).code).toBe('new')
    expect(configured).toEqual([])
    expect(meetingPoints).toEqual([{ relay: 'wss://a.example' }])
  })

  it("already here and let in: a link with another code, or another host, is never taken quietly — it asks", async () => {
    room.value = 'meetup'
    secret.value = '4417'
    const zone = { room: 'meetup', secret: '4417', relay: 'wss://a.example', host: 'a.example', code: 'working-code' }
    joined(true)
    answer = false
    for (const point of [
      { relay: 'wss://a.example', code: 'junkjunkjunkjunk' },                     // a code that would lock this tab out
      { relay: 'wss://a.example', host: 'mallory.example', code: 'working-code' }, // a new keeper of what it shares
    ]) {
      sessionStorage.setItem('hc:mesh-zone', JSON.stringify(zone))
      confirms.length = 0
      await joinMeetingPlace(parseMeet(meetFragment('meetup', '4417', [], point))!)
      expect(confirms, JSON.stringify(point)).toHaveLength(1)
      // Not now: nothing changed.
      expect(JSON.parse(sessionStorage.getItem('hc:mesh-zone')!)).toEqual(zone)
    }
    // The sheet names the new keeper.
    expect(confirms[0].message).toContain('mallory.example')
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

  it("the link carries this tab's meeting point — relay, host and code — and the toast names only the point", async () => {
    room.value = 'downtown'
    secret.value = 'downtown'
    explorer = []
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'downtown', secret: 'downtown', relay: 'wss://pluginthematrix.com', host: 'pluginthematrix.com', code: 'sekrit-42' }))
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')) })
    try { await new InviteQueenBee().invoke('') } finally { spy.mockRestore() }
    const url = writes[0]
    expect(parseMeet(url.slice(url.indexOf('#')))).toMatchObject({ room: 'downtown', relay: 'wss://pluginthematrix.com', host: 'pluginthematrix.com', code: 'sekrit-42' })
    expect(toasts.at(-1)?.message).toContain('at pluginthematrix.com')
    expect(toasts.at(-1)?.message).not.toContain('sekrit-42')
    expect(logs.join('\n')).not.toContain('sekrit-42')
  })

  it('`invite wss://…` opens the selector on that meeting point and its code — nothing written, no link', async () => {
    room.value = 'downtown'
    secret.value = 'downtown'
    await new InviteQueenBee().invoke('wss://pluginthematrix.com')
    expect(modals.at(-1)).toEqual({ point: 'wss://pluginthematrix.com', focus: 'code' })
    expect(writes).toHaveLength(0)
    expect(sessionStorage.getItem('hc:mesh-zone')).toBeNull()
  })

  it('`invite code <x>` never takes the code from the command line', async () => {
    room.value = 'downtown'
    secret.value = 'downtown'
    await new InviteQueenBee().invoke('code sekrit-42')
    expect(toasts.at(-1)?.message).toContain('never taken from the command line')
    expect(modals.at(-1)).toEqual({ focus: 'code' })
    expect(sessionStorage.getItem('hc:mesh-zone')).toBeNull()
    expect(writes).toHaveLength(0)
  })

  it('`invite ws://…` to a real host is no meeting point', async () => {
    room.value = 'downtown'
    secret.value = 'downtown'
    await new InviteQueenBee().invoke('ws://pluginthematrix.com')
    expect(toasts.at(-1)?.type).toBe('error')
    expect(modals).toHaveLength(0)
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
