// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// core/zone-join.spec.ts — THE BARE WORDS JOIN THIS TAB'S MEETING, OR ASK.
//
// The long-tail hunt's use-live-relay, join and keymap probes, kept as specs
// against the REAL RoomStore/SecretStore (shell), membership + the
// use-live-relay and join queens (essentials) and the runtime's keymap guard
// — every case a fresh set of modules, as a new tab is:
//
//   ZI-4  device B was in last week's meeting downtown/rose on this browser.
//         In a new tab, bare `/use-live-relay`, `join` and ctrl+shift+P used
//         to put it straight back there without a word (and a fresh device A
//         into the world-shared hive/hive) — the two never met. Now each
//         opens the selector pre-filled; START is the join (D5).
//   ZI-1  a tab meeting at wss://pluginthematrix.com with a code retyped
//         `/use-live-relay downtown rose` and dropped onto the default relay:
//         a second meeting under the same two words. It keeps its point.
//   ZI-8  `/use-live-relay Garden Rose` is room 'Garden', secret 'Rose'; a
//         room with a space is given in quotes, straight or curly.
//   NO DEFAULT HOST (jwize, 2026-10-11): a join with no host named anywhere
//         — not in the tab's zone, not in the page's own chosen list — opens
//         the selector on its host field; another room keeps the host the
//         tab meets at.

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const x = (room: string, secret: string): string =>
  createHash('sha256').update(`lifecycle\0${room}\0${secret}`, 'utf8').digest('hex').slice(0, 12)

const registry = new Map<string, unknown>()
const g = globalThis as unknown as {
  get: (k: string) => unknown
  register: (k: string, v: unknown) => void
  ioc: { get: (k: string) => unknown; register: (k: string, v: unknown) => void }
}
g.get = (k) => registry.get(k)
g.register = (k, v) => { registry.set(k, v) }
g.ioc = { get: g.get, register: g.register }
;(window as unknown as { ioc: unknown }).ioc = g.ioc

let relays: string[] = []
/** The relay the page's own list names as chosen — what the real mesh's
 *  meetingRelay answers for a tab with no point of its own ('' for none). */
let ownPoint = ''
const mesh = {
  configureRelays: vi.fn((urls: string[]) => { relays = [...urls] }),
  connectAll: vi.fn(),
  getDebug: () => ({ relays }),
  meetingRelay: () => {
    try {
      const relay = JSON.parse(sessionStorage.getItem('hc:mesh-zone') ?? 'null')?.relay
      if (sessionStorage.getItem('hc:mesh-session') === 'true' && typeof relay === 'string' && relay) return relay
    } catch { /* no zone */ }
    return ownPoint
  },
}

type Store = { value: string; set: (v: string) => void }
type Tab = {
  room: Store
  secret: Store
  isJoinedHere: () => boolean
  zone: () => Record<string, string> | null
  useLiveRelay: (args: string) => void
  join: () => Promise<void>
  shortcut: () => void
  seen: { modal: unknown[]; joined: boolean[]; toasts: Array<{ type: string; message: string }> }
}

/** A new tab: the browser's storage as given, every module loaded fresh. */
const openTab = async (): Promise<Tab> => {
  EffectBus.clear()
  registry.clear()
  vi.resetModules()
  relays = ['wss://hypercomb.com']
  mesh.configureRelays.mockClear()
  registry.set('@diamondcoreprocessor.com/NostrMeshDrone', mesh)
  await import('./mesh-session')
  await import('./room-store')
  await import('./secret-store')
  const membership = await import('../../hypercomb-essentials/src/sharing/membership')
  await import('../../hypercomb-essentials/src/sharing/use-live-relay.queen')
  await import('../../hypercomb-essentials/src/sharing/swarm-join.queen')
  const { initializeRuntime } = await import('../../hypercomb-runtime/src/runtime-initializer')
  await initializeRuntime()
  const seen: Tab['seen'] = { modal: [], joined: [], toasts: [] }
  EffectBus.on('mesh:open-modal', (p) => { if (p) seen.modal.push(p) })
  EffectBus.on<{ public?: boolean }>('mesh:public-changed', (p) => { if (p) seen.joined.push(p.public === true) })
  EffectBus.on<{ type: string; message: string }>('toast:show', (t) => { if (t) seen.toasts.push(t) })
  seen.modal.length = 0
  seen.joined.length = 0
  seen.toasts.length = 0
  const queen = registry.get('@diamondcoreprocessor.com/UseLiveRelayQueenBee') as { invoke: (a: string) => void }
  const join = registry.get('@diamondcoreprocessor.com/JoinQueenBee') as { invoke: (a: string) => Promise<void> }
  return {
    room: registry.get('@hypercomb.social/RoomStore') as Store,
    secret: registry.get('@hypercomb.social/SecretStore') as Store,
    isJoinedHere: membership.isJoinedHere,
    zone: () => JSON.parse(sessionStorage.getItem('hc:mesh-zone') ?? 'null'),
    useLiveRelay: (args) => queen.invoke(args),
    join: () => join.invoke(''),
    shortcut: () => EffectBus.emit('keymap:invoke', { cmd: 'mesh.togglePublic', binding: null, event: null }),
    seen,
  }
}

/** Last week's meeting, left in this browser's origin-wide pre-fill. */
const lastWeek = (): void => {
  localStorage.setItem('hc:room', 'downtown')
  localStorage.setItem('hc:secret', 'rose')
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  ownPoint = ''
})

describe('ZI-4 — a new tab is never put in last week\'s meeting (or hive/hive) without asking', () => {
  it('bare /use-live-relay on device B (a stale pair): the selector, pre-filled — no join', async () => {
    lastWeek()
    const tab = await openTab()
    expect([tab.room.value, tab.secret.value]).toEqual(['downtown', 'rose'])   // the pre-fill
    tab.useLiveRelay('')
    // no host named anywhere: the selector opens on the host field
    expect(tab.seen.modal).toEqual([{ join: true, focus: 'point' }])
    expect(tab.seen.joined).toEqual([])
    expect(tab.isJoinedHere()).toBe(false)
  })

  it('bare /use-live-relay on fresh device A: the selector — never the world-shared hive/hive', async () => {
    const tab = await openTab()
    tab.useLiveRelay('')
    expect(tab.seen.modal).toEqual([{ join: true, focus: 'point' }])
    expect(tab.seen.joined).toEqual([])
    expect([tab.room.value, tab.secret.value]).toEqual(['', ''])
    expect(x(tab.room.value, tab.secret.value)).not.toBe('64b3daa81ae0')
  })

  it('the `join` word on a stale pair: the selector — no join', async () => {
    lastWeek()
    const tab = await openTab()
    await tab.join()
    expect(tab.seen.modal).toEqual([{ join: true }])
    expect(tab.seen.joined).toEqual([])
  })

  it('ctrl+shift+P on a stale pair: the selector — no join', async () => {
    lastWeek()
    const tab = await openTab()
    tab.shortcut()
    expect(tab.seen.modal).toEqual([{ join: true }])
    expect(tab.seen.joined).toEqual([])
  })

  it('a named zone at a host still joins at once, even when the store already held that pair', async () => {
    lastWeek()
    ownPoint = 'wss://hypercomb.com'                   // a host this device chose
    const tab = await openTab()
    tab.useLiveRelay('downtown rose')
    expect(tab.seen.modal).toEqual([])
    expect(tab.seen.joined).toEqual([true])
    expect(tab.zone()).toMatchObject({ room: 'downtown', secret: 'rose' })
    expect(x(tab.room.value, tab.secret.value)).toBe('166d0590ac44')
  })

  it('a named zone with NO host anywhere: the words are kept, the selector opens on the host field — no join', async () => {
    const tab = await openTab()
    tab.useLiveRelay('downtown rose')
    expect(tab.seen.modal).toEqual([{ join: true, focus: 'point' }])
    expect(tab.seen.joined).toEqual([])
    expect(tab.zone()).toEqual({ room: 'downtown', secret: 'rose' })
    expect([tab.room.value, tab.secret.value]).toEqual(['downtown', 'rose'])
  })

  it('a tab with a zone of its own: the bare words rejoin it, no question', async () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'uptown', secret: 'lily', relay: 'wss://hypercomb.com' }))
    lastWeek()                                         // another meeting's pre-fill
    const tab = await openTab()
    await tab.join()
    expect(tab.seen.modal).toEqual([])
    expect(tab.seen.joined).toEqual([true])
    expect([tab.room.value, tab.secret.value]).toEqual(['uptown', 'lily'])
  })

  it('a zone of its own but NO host: `join` and the shortcut open the selector on the host field — no join', async () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'uptown', secret: 'lily' }))
    const tab = await openTab()
    await tab.join()
    expect(tab.seen.modal).toEqual([{ join: true, focus: 'point' }])
    tab.shortcut()
    expect(tab.seen.modal).toEqual([{ join: true, focus: 'point' }, { join: true, focus: 'point' }])
    expect(tab.seen.joined).toEqual([])
    // the page's own chosen list is a host: then it joins
    ownPoint = 'wss://own.example'
    await tab.join()
    expect(tab.seen.joined).toEqual([true])
  })

  it('a reload of a joined tab resumes with no gesture at all', async () => {
    sessionStorage.setItem('hc:mesh-session', 'true')
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'downtown', secret: 'rose' }))
    const tab = await openTab()
    expect(tab.isJoinedHere()).toBe(true)
    expect(tab.seen.modal).toEqual([])
  })
})

describe('ZI-1 — retyping the room keeps this tab\'s meeting point', () => {
  const atPoint = (): void => {
    sessionStorage.setItem('hc:mesh-session', 'true')
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'downtown', secret: 'rose', relay: 'wss://pluginthematrix.com', code: 'k-7' }))
  }

  it('/use-live-relay downtown rose at {pluginthematrix, code}: relay and code stay', async () => {
    atPoint()
    const tab = await openTab()
    relays = ['wss://pluginthematrix.com']
    tab.useLiveRelay('downtown rose')
    expect(tab.zone()).toMatchObject({ room: 'downtown', secret: 'rose', relay: 'wss://pluginthematrix.com', code: 'k-7' })
    expect(mesh.configureRelays).not.toHaveBeenCalled()
    expect(relays).toEqual(['wss://pluginthematrix.com'])
  })

  it('the bare form there keeps it too', async () => {
    atPoint()
    const tab = await openTab()
    relays = ['wss://pluginthematrix.com']
    tab.useLiveRelay('')
    expect(tab.zone()).toMatchObject({ relay: 'wss://pluginthematrix.com', code: 'k-7' })
    expect(mesh.configureRelays).not.toHaveBeenCalled()
  })

  it('another room keeps the host this tab meets at — its point and code (there is no default to fall back to)', async () => {
    atPoint()
    const tab = await openTab()
    relays = ['wss://pluginthematrix.com']
    tab.useLiveRelay('uptown lily')
    expect(tab.zone()).toEqual({ room: 'uptown', secret: 'lily', relay: 'wss://pluginthematrix.com', code: 'k-7' })
    expect(relays).toEqual(['wss://pluginthematrix.com'])
    expect(mesh.configureRelays).not.toHaveBeenCalled()
  })

  it('the toast names the words with the host they were drawn at — the point it kept, never the page (2026-10-11)', async () => {
    atPoint()
    const tab = await openTab()
    tab.useLiveRelay('downtown rose')
    const toast = tab.seen.toasts.at(-1)!
    expect(toast.type).toBe('success')
    const { lifecyclePreimage, secretTag } = await import('@hypercomb/core')
    expect(toast.message).toContain(`${secretTag(lifecyclePreimage('downtown', 'rose', 'wss://pluginthematrix.com'), 'en')} · pluginthematrix.com`)
    expect(toast.message).not.toContain('hypercomb.io')
  })
})

describe('ZI-8 / ZI-5 — what /use-live-relay is given is the zone the selector would make', () => {
  it('a quoted room with a space is one word: the selector\'s "Garden Rose"', async () => {
    const tab = await openTab()
    tab.useLiveRelay('"Garden Rose"')
    expect([tab.room.value, tab.secret.value]).toEqual(['Garden Rose', 'Garden Rose'])
    expect(x(tab.room.value, tab.secret.value)).toBe('9ec86f8cbd61')
  })

  it('"Garden Rose" rose — a quoted room and a secret', async () => {
    const tab = await openTab()
    tab.useLiveRelay('"Garden Rose" rose')
    expect([tab.room.value, tab.secret.value]).toEqual(['Garden Rose', 'rose'])
    expect(x(tab.room.value, tab.secret.value)).toBe('579b7de8ce0c')
  })

  it('curly quotes from smart punctuation work the same', async () => {
    const tab = await openTab()
    tab.useLiveRelay('“Garden Rose” rose')
    expect([tab.room.value, tab.secret.value]).toEqual(['Garden Rose', 'rose'])
  })

  it('unquoted, two words stay a room and a secret', async () => {
    const tab = await openTab()
    tab.useLiveRelay('Garden Rose')
    expect([tab.room.value, tab.secret.value]).toEqual(['Garden', 'Rose'])
  })

  it('a full-width room and a smart-quoted secret land in the ASCII zone', async () => {
    const tab = await openTab()
    tab.useLiveRelay('ｄｏｗｎｔｏｗｎ rose​')
    expect(x(tab.room.value, tab.secret.value)).toBe('166d0590ac44')
    const again = await openTab()
    again.useLiveRelay('paris joe’s')
    expect([again.room.value, again.secret.value]).toEqual(['paris', "joe's"])
  })
})
