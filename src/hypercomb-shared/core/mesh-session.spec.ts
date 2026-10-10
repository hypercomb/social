// core/mesh-session.spec.ts — the join AND the zone are this tab's.
//
// A reload used to rejoin, at once and without asking, whatever room and
// secret ANY other tab last wrote: the join was per tab (sessionStorage) and
// the pair origin-wide (localStorage). Now the pair rides beside the join in
// `hc:mesh-zone`, and the stores read it first. The module seeds at load, so
// each case imports it fresh.

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Mod = typeof import('./mesh-session')
const load = async (): Promise<Mod> => {
  vi.resetModules()
  return await import('./mesh-session')
}

const services = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = { get: (k: string) => services.get(k) }
;(globalThis as { register?: unknown }).register = (k: string, v: unknown) => { services.set(k, v) }

const zone = (): Record<string, string> | null => {
  const raw = sessionStorage.getItem('hc:mesh-zone')
  return raw ? JSON.parse(raw) : null
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  services.clear()
})

describe('the tab\'s zone', () => {
  it('a join records the zone it joined, beside the join', async () => {
    const m = await load()
    services.set('@hypercomb.social/RoomStore', { value: 'downtown' })
    services.set('@hypercomb.social/SecretStore', { value: 'downtown' })
    m.rememberMeshSession(true)
    expect(sessionStorage.getItem('hc:mesh-session')).toBe('true')
    expect(zone()).toEqual({ room: 'downtown', secret: 'downtown' })
  })

  it('a join keeps the meeting point the tab already holds', async () => {
    const m = await load()
    m.writeMeshZone({ relay: 'wss://pluginthematrix.com', host: 'pluginthematrix.com', code: 'k-1' })
    services.set('@hypercomb.social/RoomStore', { value: 'meetup' })
    services.set('@hypercomb.social/SecretStore', { value: '4417' })
    m.rememberMeshSession(true)
    expect(zone()).toEqual({ relay: 'wss://pluginthematrix.com', host: 'pluginthematrix.com', code: 'k-1', room: 'meetup', secret: '4417' })
  })

  it('a leave keeps the zone (a rejoin in this tab goes back to it)', async () => {
    const m = await load()
    m.writeMeshZone({ room: 'meetup', secret: '4417' })
    m.rememberMeshSession(false)
    expect(sessionStorage.getItem('hc:mesh-session')).toBe('false')
    expect(zone()).toEqual({ room: 'meetup', secret: '4417' })
  })

  it('merges: undefined keeps a field, an empty relay/host/code removes it, an empty room is recorded', async () => {
    const m = await load()
    m.writeMeshZone({ room: ' a ', secret: 'b', relay: 'wss://x.example', code: 'c' })
    m.writeMeshZone({ code: '' })
    m.writeMeshZone({ room: '' })
    expect(zone()).toEqual({ room: '', secret: 'b', relay: 'wss://x.example' })
  })

  it('a corrupt record reads as none', async () => {
    sessionStorage.setItem('hc:mesh-zone', '{nope')
    const m = await load()
    expect(m.readMeshZone()).toBeNull()
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify(['room']))
    expect(m.readMeshZone()).toBeNull()
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 5, secret: 's' }))
    expect(m.readMeshZone()).toEqual({ secret: 's' })
  })

  it('tabCredential: the tab\'s own first, else a FRESH read of the origin-wide pair', async () => {
    const m = await load()
    localStorage.setItem('hc:room', 'first')
    expect(m.tabCredential('room')).toBe('first')
    localStorage.setItem('hc:room', 'moved-by-another-tab')
    expect(m.tabCredential('room')).toBe('moved-by-another-tab')
    m.writeMeshZone({ room: 'mine' })
    expect(m.tabCredential('room')).toBe('mine')
  })
})

describe('resuming after a reload', () => {
  it('another tab writing a different pair does not move a resumed tab', async () => {
    // Tab A joined downtown; tab B then joined another meeting.
    sessionStorage.setItem('hc:mesh-session', 'true')
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'downtown', secret: 'downtown' }))
    localStorage.setItem('hc:room', 'xtab-b')
    localStorage.setItem('hc:secret', 'xtab-b-secret')
    const m = await load()
    expect(m.meshResumed).toBe(true)
    const { RoomStore } = await import('./room-store')
    const { SecretStore } = await import('./secret-store')
    expect(new RoomStore().value).toBe('downtown')
    expect(new SecretStore().value).toBe('downtown')
    expect(localStorage.getItem('hc:mesh-public')).toBe('true')
  })

  it('a join from an older shell (no zone yet) is pinned at once to the pair it resumes with', async () => {
    sessionStorage.setItem('hc:mesh-session', 'true')
    localStorage.setItem('hc:room', 'meetup')
    localStorage.setItem('hc:secret', '4417')
    await load()
    expect(zone()).toEqual({ room: 'meetup', secret: '4417' })
    // …and from then on it is this tab's.
    localStorage.setItem('hc:room', 'another')
    const { RoomStore } = await import('./room-store')
    expect(new RoomStore().value).toBe('meetup')
  })

  it('a new tab has no zone: it is pre-filled from the origin-wide pair and boots private', async () => {
    localStorage.setItem('hc:room', 'meetup')
    const m = await load()
    expect(m.meshResumed).toBe(false)
    expect(zone()).toBeNull()
    expect(localStorage.getItem('hc:mesh-public')).toBe('false')
    const { RoomStore } = await import('./room-store')
    expect(new RoomStore().value).toBe('meetup')
  })
})

describe('the meeting point mirrors (the shell never imports a module)', () => {
  it('agree with essentials meeting-invite.ts on every answer', async () => {
    const shell = await load()
    const mod = await import('../../hypercomb-essentials/src/sharing/meeting-invite')
    const relays = [
      'pluginthematrix.com', 'PluginTheMatrix.com/io/', 'wss://x.example:8443/io', 'ws://localhost:7801', 'ws://127.0.0.1:7801',
      'ws://x.example', 'wss://u:p@x.example', 'wss://x.example/?q', 'wss://x.example/#f', 'http://x.example', 'not a host', '', 'localhost',
    ]
    for (const r of relays) {
      expect(shell.meetingRelayOf(r), r).toBe(mod.meetingRelayOf(r))
      const canonical = mod.meetingRelayOf(r)
      if (canonical) expect(shell.relayDomainOf(canonical), r).toBe(mod.relayDomainOf(canonical))
    }
    for (const c of ['abc', 'a.b-c_d~e!', '', 'a b', 'a,b', 'a/b', 'x'.repeat(128), 'x'.repeat(129), 'é']) {
      expect(shell.isAccessCode(c), c).toBe(mod.isAccessCode(c))
    }
  })
})
