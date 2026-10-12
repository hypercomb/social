// core/zone-entry.spec.ts — ONE TEXT, ONE ZONE; NO ZONE FROM AN ADDRESS BAR.
//
// The long-tail hunt's typed-variant, subdomain and pre-fill probes, kept as
// specs against the REAL RoomStore, SecretStore and mesh-session (each case
// a fresh module load, as a new tab is):
//
//   ZI-5  two people type what looks like the same room — a zero-width space
//         from a chat, a full-width IME, NFD from a macOS file name, a smart
//         quote, an em dash, a no-break space, a doubled space — and must
//         land in ONE zone. Plain ASCII zones hash exactly as before.
//   ZI-7  business-card.jwize.com seeded room = secret = 'business-card':
//         every visitor of every such host shared one zone whose "secret"
//         sat in the address bar. The secret is never seeded from a host,
//         and the room only on an explicit zone host.
//   ZI-1  a new tab's selector is pre-filled with the pair of the last
//         meeting on this origin but not its meeting point, so a rejoin
//         from the selector silently met on the default relay. The point
//         (never its code) is now pre-filled beside the pair.

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
// Transformed at collection, so a cold first tab is not timed against a case.
import '@hypercomb/core'

const services = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = { get: (k: string) => services.get(k) }
;(globalThis as { register?: unknown }).register = (k: string, v: unknown) => { services.set(k, v) }

/** What the room and secret put into the swarm's zone address — compared
 *  across entry paths that share one meeting point. The address itself also
 *  names the point (core lifecyclePreimage, 2026-10-12), which no entry path
 *  here moves. */
const x = (room: string, secret: string): string =>
  createHash('sha256').update(`lifecycle\0${room}\0${secret}`, 'utf8').digest('hex').slice(0, 12)

// The participant's document pools, shared by every "tab" of the origin (the
// meeting-point pre-fill is a participant document, never a localStorage key).
const docs = new Map<string, ArrayBuffer>()
const fakeStore = {
  openPool: async (meaning: string) => (docs.has(meaning) ? { name: meaning } : null),
  getPool: async (meaning: string) => ({ name: meaning }),
  getPoolDoc: async (pool: { name: string }) => docs.get(pool.name) ?? null,
  putPoolDoc: async (pool: { name: string }, bytes: ArrayBuffer) => { docs.set(pool.name, bytes); return 'sig' },
}
const seedMeetPoint = (value: unknown): void => {
  docs.set('mesh:meet-point', new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer)
}
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

type Stores = { room: { value: string; set: (v: string, exact?: boolean) => void }; secret: { value: string; set: (v: string, exact?: boolean) => void } }
const newTab = async (): Promise<Stores & { session: typeof import('./mesh-session') }> => {
  await settle()   // what the tab before wrote has reached the pool
  vi.resetModules()
  const session = await import('./mesh-session')
  const { RoomStore } = await import('./room-store')
  const { SecretStore } = await import('./secret-store')
  const tab = { session, room: new RoomStore(), secret: new SecretStore() }
  await settle()   // the pre-fill document has been read
  return tab
}

/** The zone a fresh tab lands in when the participant types `room`/`secret`. */
const typed = async (room: string, secret: string): Promise<string> => {
  localStorage.clear()
  sessionStorage.clear()
  const tab = await newTab()
  tab.room.set(room)
  tab.secret.set(secret)
  return x(tab.room.value, tab.secret.value)
}

const atHost = (hostname: string): (() => void) => {
  const original = Object.getOwnPropertyDescriptor(window, 'location')!
  Object.defineProperty(window, 'location', { value: { hostname }, writable: true, configurable: true })
  return () => Object.defineProperty(window, 'location', original)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  services.clear()
  docs.clear()
  services.set('@hypercomb.social/Store', fakeStore)
})

describe('ZI-5 — text that looks the same is the same zone', () => {
  const pairs: Array<[string, string, string]> = [
    ['zero-width space', 'downtown', 'downtown​'],
    ['word joiner + BOM + soft hyphen', 'downtown', '﻿down­town⁠'],
    ['NFC vs NFD (Latin)', 'Café', 'Café'],
    ['NFC vs NFD (kana)', 'ガーデン', 'ガーデン'.normalize('NFD')],
    ['full-width IME', 'downtown', 'ｄｏｗｎｔｏｗｎ'],
    ['smart apostrophe', "joe's", 'joe’s'],
    ['smart double quotes', '"rose"', '“rose”'],
    ['em dash from a typed --', 'north--side', 'north—side'],
    ['en dash', 'north-side', 'north–side'],
    ['no-break space', 'garden rose', 'garden rose'],
    ['doubled space', 'garden rose', 'garden  rose'],
    ['ideographic space', 'garden rose', 'garden　rose'],
  ]
  for (const [name, a, b] of pairs) {
    it(`${name}: one zone`, async () => {
      expect(await typed(a, 'rose')).toBe(await typed(b, 'rose'))
      expect(await typed('downtown', a)).toBe(await typed('downtown', b))
    })
  }

  it('plain ASCII zones hash exactly as before', async () => {
    expect(await typed('downtown', 'rose')).toBe('166d0590ac44')
    expect(await typed('hive', 'hive')).toBe('64b3daa81ae0')
    expect(await typed('Garden Rose', 'Garden Rose')).toBe('9ec86f8cbd61')
  })

  it('case is kept — Garden is not garden', async () => {
    expect(await typed('Garden', 'rose')).not.toBe(await typed('garden', 'rose'))
  })

  it('a pair this tab already holds is kept as recorded (a resumed tab never moves)', async () => {
    sessionStorage.setItem('hc:mesh-session', 'true')
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'garden  rose', secret: 'joe’s' }))
    const tab = await newTab()
    expect(tab.room.value).toBe('garden  rose')
    expect(tab.secret.value).toBe('joe’s')
    // Saving the selector unchanged is no move either.
    const changed = vi.fn()
    tab.room.addEventListener?.('change', changed)
    tab.room.set('garden  rose')
    tab.secret.set('joe’s')
    expect(changed).not.toHaveBeenCalled()
    expect(JSON.parse(sessionStorage.getItem('hc:mesh-zone')!)).toMatchObject({ room: 'garden  rose', secret: 'joe’s' })
    // …and the join's own record of it mirrors the stores verbatim.
    services.set('@hypercomb.social/RoomStore', tab.room)
    services.set('@hypercomb.social/SecretStore', tab.secret)
    tab.session.rememberMeshSession(true)
    expect(JSON.parse(sessionStorage.getItem('hc:mesh-zone')!)).toMatchObject({ room: 'garden  rose', secret: 'joe’s' })
  })

  it('anything else written to the zone is entered text, and folds', async () => {
    const tab = await newTab()
    tab.session.writeMeshZone({ room: 'ｄｏｗｎｔｏｗｎ​', secret: 'joe’s' })
    expect(tab.session.readMeshZone()).toEqual({ room: 'downtown', secret: "joe's" })
  })

  it("a LINK's room and secret are an exact zone: recorded as carried, so the guest meets the inviter in a pre-fold room", async () => {
    const tab = await newTab()
    services.set('@hypercomb.social/RoomStore', tab.room)
    services.set('@hypercomb.social/SecretStore', tab.secret)
    tab.room.set('joe’s place', true)
    tab.secret.set('rose  garden', true)
    expect([tab.room.value, tab.secret.value]).toEqual(['joe’s place', 'rose  garden'])
    expect(tab.session.readMeshZone()).toMatchObject({ room: 'joe’s place', secret: 'rose  garden' })
    // The same text TYPED (in a fresh tab) is entered text: it folds.
    sessionStorage.clear()
    localStorage.clear()
    const typedTab = await newTab()
    typedTab.room.set('joe’s place')
    expect(typedTab.room.value).toBe("joe's place")
  })
})

describe('ZI-7 — no zone from an address bar', () => {
  it('business-card.jwize.com seeds neither the room nor the secret', async () => {
    const restore = atHost('business-card.jwize.com')
    try {
      const tab = await newTab()
      expect(tab.room.value).toBe('')
      expect(tab.secret.value).toBe('')
      expect(localStorage.getItem('hc:room')).toBeNull()
      expect(localStorage.getItem('hc:secret')).toBeNull()
    } finally { restore() }
  })

  it('a *.pages.dev deployment and a www. origin seed nothing', async () => {
    for (const host of ['hypercomb-web.pages.dev', 'abc123.hypercomb-web.pages.dev', 'www.hypercomb.io', 'www.jwize.com']) {
      localStorage.clear()
      sessionStorage.clear()
      const restore = atHost(host)
      try {
        const tab = await newTab()
        expect([host, tab.room.value, tab.secret.value]).toEqual([host, '', ''])
      } finally { restore() }
    }
  })

  it('a zone host seeds the ROOM only — the secret stays empty, so join asks', async () => {
    const restore = atHost('myroom.hypercomb.io')
    try {
      const tab = await newTab()
      expect(tab.room.value).toBe('myroom')
      expect(tab.secret.value).toBe('')
      expect(localStorage.getItem('hc:secret')).toBeNull()
    } finally { restore() }
  })
})

describe('ZI-1 — a new tab is pre-filled with the meeting point too (never its code)', () => {
  it('the last join\'s meeting point is the new tab\'s pre-fill', async () => {
    // Tab A joined downtown/rose at the always-online point, with a code.
    const a = await newTab()
    a.room.set('downtown')
    a.secret.set('rose')
    a.session.writeMeshZone({ relay: 'wss://pluginthematrix.com', code: 'k-7' })
    services.set('@hypercomb.social/RoomStore', a.room)
    services.set('@hypercomb.social/SecretStore', a.secret)
    a.session.rememberMeshSession(true)
    // A new tab (closed and reopened, a home-screen launch, iOS dropping it).
    sessionStorage.clear()
    const b = await newTab()
    expect(b.room.value).toBe('downtown')
    expect(b.secret.value).toBe('rose')
    expect(b.session.readMeetPointPrefill()).toBe('wss://pluginthematrix.com')
    // The code never leaves the tab — and the point is no localStorage key.
    expect(JSON.stringify({ ...localStorage })).not.toContain('k-7')
    expect(JSON.stringify({ ...localStorage })).not.toContain('pluginthematrix')
    expect(new TextDecoder().decode(docs.get('mesh:meet-point'))).not.toContain('k-7')
  })

  it('a meeting point written by a module (a link, use-live-relay) is recorded at the join', async () => {
    const a = await newTab()
    // essentials' writeTabZone writes sessionStorage directly — the shell
    // records the point when the join is announced.
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'downtown', secret: 'rose', relay: 'wss://pluginthematrix.com', code: 'k-7' }))
    services.set('@hypercomb.social/RoomStore', { value: 'downtown' })
    services.set('@hypercomb.social/SecretStore', { value: 'rose' })
    a.session.rememberMeshSession(true)
    expect(a.session.readMeetPointPrefill()).toBe('wss://pluginthematrix.com')
  })

  it('a join at the default relay clears the pre-fill — it follows the last meeting', async () => {
    const a = await newTab()
    a.session.writeMeshZone({ relay: 'wss://pluginthematrix.com' })
    expect(a.session.readMeetPointPrefill()).toBe('wss://pluginthematrix.com')
    a.session.writeMeshZone({ relay: '' })
    expect(a.session.readMeetPointPrefill()).toBe('')
    a.session.writeMeshZone({ relay: 'wss://pluginthematrix.com' })
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'hive', secret: 'hive' }))
    services.set('@hypercomb.social/RoomStore', { value: 'hive' })
    services.set('@hypercomb.social/SecretStore', { value: 'hive' })
    a.session.rememberMeshSession(true)
    expect(a.session.readMeetPointPrefill()).toBe('')
  })

  it('the boot re-announcement of a RESUMED join moves no pre-fill — a reload is not a join', async () => {
    // Another tab's meeting left its point as the pre-fill…
    seedMeetPoint('wss://pluginthematrix.com')
    // …and this tab, joined at the default relay under this shell, reloads.
    sessionStorage.setItem('hc:mesh-point-crossing', '1')
    sessionStorage.setItem('hc:mesh-session', 'true')
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'hive2', secret: 'x' }))
    const tab = await newTab()
    services.set('@hypercomb.social/RoomStore', tab.room)
    services.set('@hypercomb.social/SecretStore', tab.secret)
    tab.session.rememberMeshSession(true)            // the shell's boot broadcast
    expect(tab.session.readMeetPointPrefill()).toBe('wss://pluginthematrix.com')
    // A leave and a fresh join is a join: now it is this tab's point.
    tab.session.rememberMeshSession(false)
    tab.session.rememberMeshSession(true)
    expect(tab.session.readMeetPointPrefill()).toBe('')
  })

  it("a link's point put in the zone before the guest said yes is never the next tab's pre-fill", async () => {
    const a = await newTab()
    a.session.writeMeshZone({ relay: 'wss://attacker.example' }, { prefill: false })
    expect(a.session.readMeshZone()?.relay).toBe('wss://attacker.example')
    expect(a.session.readMeetPointPrefill()).toBe('')
    sessionStorage.clear()
    expect((await newTab()).session.readMeetPointPrefill()).toBe('')
  })

  it('a pre-fill that is not a meeting point reads as none', async () => {
    seedMeetPoint('http://not-a-relay.example/?x')
    const a = await newTab()
    expect(a.session.readMeetPointPrefill()).toBe('')
  })
})
