// ui/presence-banner/presence-banner.component.spec.ts — the strip, wired.
//
// presence-status.ts pins each state's words; this drives the COMPONENT the
// way the modules do — the effects it hears, the clock it keeps — and reads
// the line it would render. Each case is a timeline the long-tail hunt
// recorded (2026-10-10, truth drills T1c/T3): a recycled access code, a slow
// uplink that never dropped, frames the relay had not taken yet, a peer who
// only re-announces a page they visited, a meeting split across two relays.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@angular/compiler'
import {
  ElementRef, Injector, createEnvironmentInjector, runInInjectionContext,
  ɵChangeDetectionScheduler, ɵEffectScheduler, type EnvironmentInjector,
} from '@angular/core'
import { EffectBus, secretTag } from '@hypercomb/core'

const services = new Map<string, unknown>()
;(globalThis as { get?: unknown }).get = (k: string) => services.get(k)
;(globalThis as { register?: unknown }).register = (k: string, v: unknown) => { services.set(k, v) }
;(window as unknown as { ioc: unknown }).ioc = { get: (k: string) => services.get(k), register: (k: string, v: unknown) => { services.set(k, v) } }

const { PresenceBannerComponent } = await import('./presence-banner.component')
const { roomWords, wordsBeside } = await import('./presence-status')

type Banner = InstanceType<typeof PresenceBannerComponent>

const value = (v: string): EventTarget & { value: string } => Object.assign(new EventTarget(), { value: v })
let swarmHost = 'jwize.com'
let segments: string[] = []
let made: Banner[] = []

const mount = (): Banner => {
  const env = createEnvironmentInjector([
    { provide: ElementRef, useValue: new ElementRef(document.createElement('div')) },
    { provide: ɵChangeDetectionScheduler, useValue: { notify: () => {}, runningTick: false } },
    { provide: ɵEffectScheduler, useValue: { add: () => {}, schedule: () => {}, remove: () => {}, flush: () => {} } },
  ], (Injector.NULL as unknown) as EnvironmentInjector)
  const banner = runInInjectionContext(env, () => new PresenceBannerComponent())
  banner.ngOnInit()
  made.push(banner)
  EffectBus.emit('mesh:public-changed', { public: true })
  return banner
}
const keys = (b: Banner): string[] => (b.status()?.parts ?? []).map(p => p.key ?? `"${p.text}"`)
const connect = (state: string, extra: Record<string, unknown> = {}): void =>
  EffectBus.emit('mesh:connection', { state, reopened: false, since: Date.now(), attempt: 0, clockOffsetMs: 0, ...extra })

beforeEach(() => {
  vi.useFakeTimers({ now: 1_791_600_000_000 })
  EffectBus.clear()
  sessionStorage.clear()
  services.clear()
  swarmHost = 'jwize.com'
  segments = []
  services.set('@hypercomb.social/RoomStore', value('downtown'))
  services.set('@hypercomb.social/SecretStore', value('rose'))
  services.set('@hypercomb.social/I18n', Object.assign(new EventTarget(), { locale: 'en', t: (k: string) => k }))
  services.set('@diamondcoreprocessor.com/NostrMeshDrone', { swarmHost: () => swarmHost })
  services.set('@diamondcoreprocessor.com/SwarmDrone', {
    myLabel: () => 'me', labelFor: () => '', setMyLabel: () => {}, subscribedTo: () => '', following: () => '',
    subscribeTo: async () => {}, follow: async () => {},
    currentSegments: () => segments, participantsInZone: () => [], awayInZone: () => [],
  })
})

afterEach(() => {
  for (const b of made) b.ngOnDestroy()
  made = []
  EffectBus.clear()
  vi.useRealTimers()
})

describe('TS-2: a meeting point that refuses this tab\'s access code', () => {
  it('says so at once, in the down tone, with the code button — and never "check wifi", through +78 s', () => {
    const b = mount()
    connect('open')
    // T3: +8.3 s the operator recycles the code; the mesh retires the socket
    // and records refused 'access'.
    vi.advanceTimersByTime(8_300)
    connect('retrying', { refused: 'access', attempt: 1 })
    vi.advanceTimersByTime(200)
    expect(keys(b)).toEqual(['mesh.state.access', 'mesh.state.access-action'])
    expect(b.status()?.tone).toBe('down')
    for (let s = 0; s < 78; s++) {
      vi.advanceTimersByTime(1_000)
      if (s % 15 === 0) connect('retrying', { refused: 'access', attempt: 2 + s })
      expect(keys(b)).not.toContain('mesh.state.unreachable')
      expect(keys(b)).not.toContain('mesh.state.reconnecting')
      expect(b.status()?.tone).toBe('down')
    }
  })

  it('the button opens the selector on the access code', async () => {
    const b = mount()
    const opened: unknown[] = []
    EffectBus.on('mesh:open-modal', p => { opened.push(p) })
    await b.onStatusAction('code')
    expect(opened).toEqual([{ focus: 'code' }])
  })

  it("a meeting point this page cannot dial is named, from the tab's zone", () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'downtown', secret: 'rose', relay: 'ws://localhost:7896' }))
    swarmHost = ''
    const b = mount()
    connect('offline', { refused: 'unreachable' })
    expect(keys(b)).toEqual(['mesh.state.unreachable-local'])
    expect(b.status()?.parts[0]?.params).toEqual({ relay: 'ws://localhost:7896' })
    expect(b.status()?.tone).toBe('down')
  })
})

describe('TS-6: a slow socket that never drops', () => {
  it('T1c D2a: four ~1 s stalls in 75 s read "slow connection" — 0 "Reconnecting" flickers', () => {
    const b = mount()
    connect('open')
    let reconnecting = 0, slow = 0, wasReconnecting = false
    const stalls = [19_800, 32_300, 49_800, 62_400]
    for (let ms = 0; ms <= 75_000; ms += 100) {
      if (stalls.includes(ms)) connect('stalled')
      if (stalls.some(s => ms === s + 1_000)) connect('open')
      const k = keys(b)
      const now = k.includes('mesh.state.reconnecting')
      if (now && !wasReconnecting) reconnecting++
      wasReconnecting = now
      if (k.includes('mesh.state.slow')) slow++
      vi.advanceTimersByTime(100)
    }
    expect(reconnecting).toBe(0)
    expect(slow).toBeGreaterThan(0)
  })

  it('a stall that outlives the probe deadline is a reconnect', () => {
    const b = mount()
    connect('open')
    connect('stalled')
    expect(keys(b)).toContain('mesh.state.slow')
    vi.advanceTimersByTime(2_600)
    expect(keys(b)).toEqual(['mesh.state.reconnecting'])
  })
})

describe('TS-7: delivery, not the socket', () => {
  const peer = 'a'.repeat(64)
  it('T1c D2b: frames the relay has not taken for 3 s read "Sending…", and you are not counted here until they are', () => {
    const b = mount()
    connect('open')
    EffectBus.emit('swarm:presence-changed', { sig: 's', peers: [peer], alone: false, zonePeers: [{ pubkey: peer, state: 'here' }] })
    // arrival: the word goes out, the relay takes it at once
    EffectBus.emit('swarm:share-status', { location: '/', offered: 1 })
    EffectBus.emit('swarm:page-announced', { location: '/', segments: [] })
    expect(b.status()?.compact).toBe('2 (2)')
    expect(keys(b)).not.toContain('mesh.state.sending')
    // b-slow: a new word on a throttled uplink, its OK 7.3 s late
    vi.advanceTimersByTime(5_000)
    EffectBus.emit('swarm:share-status', { location: '/', offered: 2 })
    vi.advanceTimersByTime(1_000)
    expect(keys(b)).not.toContain('mesh.state.sending')
    expect(b.status()?.compact).toBe('2 (2)')
    vi.advanceTimersByTime(2_100)
    expect(keys(b)).toContain('mesh.state.sending')
    expect(b.status()?.tone).toBe('warn')
    expect(b.status()?.compact).toBe('2 (1)')
    vi.advanceTimersByTime(4_200)
    EffectBus.emit('swarm:page-announced', { location: '/', segments: [] })
    expect(keys(b)).not.toContain('mesh.state.sending')
    expect(b.status()?.compact).toBe('2 (2)')
  })

  it('an older swarm that never says page-announced reads as it always did', () => {
    const b = mount()
    connect('open')
    EffectBus.emit('swarm:presence-changed', { sig: 's', peers: [peer], alone: false })
    EffectBus.emit('swarm:share-status', { location: '/', offered: 1 })
    vi.advanceTimersByTime(10_000)
    expect(keys(b)).not.toContain('mesh.state.sending')
    expect(b.status()?.compact).toBe('2 (2)')
  })
})

describe('TS-3: who stands here, not who visited', () => {
  it('a peer who only re-announces a page they visited is not counted here, and wears the dim badge', () => {
    const standing = 'a'.repeat(64), visited = 'b'.repeat(64)
    const b = mount()
    connect('open')
    EffectBus.emit('swarm:presence-changed', { sig: 's', peers: [standing, visited], at: [standing], alone: false })
    expect(b.status()?.parts.find(p => p.key === 'presence.room-count')?.params).toEqual({ count: 3, here: 2 })
    expect(b.badges().map(x => x.where)).toEqual(['self', 'here', 'visiting'])
    expect(b.badgeTitleKey(b.badges()[2]!)).toBe('presence.room-visiting')
  })

  it('an older swarm that says nothing of standing: everyone with tiles here is here', () => {
    const b = mount()
    connect('open')
    EffectBus.emit('swarm:presence-changed', { sig: 's', peers: ['a'.repeat(64), 'b'.repeat(64)], alone: false })
    expect(b.status()?.parts.find(p => p.key === 'presence.room-count')?.params).toEqual({ count: 3, here: 3 })
  })
})

describe('ZI-1 / ZI-6: the words fold the point the tab meets at, from one list', () => {
  it('two halves of a meeting on different relays read different words; the default keeps today\'s', () => {
    const b = mount()
    connect('open')
    const words = (): string => b.status()?.parts.find(p => p.text && p.text !== 'downtown')?.text ?? ''
    expect(words()).toBe(secretTag('lifecycle\0downtown\0rose', 'en'))
    swarmHost = 'pluginthematrix.com'
    EffectBus.emit('mesh:zone', { relay: 'wss://pluginthematrix.com' })
    connect('open', { attempt: 1 })
    expect(words()).toBe(roomWords('downtown', 'rose', 'pluginthematrix.com'))
    expect(words()).not.toBe(secretTag('lifecycle\0downtown\0rose', 'en'))
  })

  it('a Japanese reader compares the English pair, their own beside it', () => {
    services.set('@hypercomb.social/I18n', Object.assign(new EventTarget(), { locale: 'ja', t: (k: string) => k }))
    const b = mount()
    connect('open')
    const pair = b.status()?.parts.find(p => p.text && p.text !== 'downtown')?.text
    expect(pair).toBe(wordsBeside('downtown', 'rose', 'jwize.com', 'ja'))
    expect(pair?.startsWith(roomWords('downtown', 'rose'))).toBe(true)
  })
})
