// sharing/membership.spec.ts — swarm membership is THIS tab's.
//
// The origin-wide `hc:mesh-public` flag is shared by every tab, and the shell
// rewrites it from each tab's own session at boot — so a second, unjoined tab
// used to silence the joined one mid-meeting. isJoinedHere() answers from the
// tab's session (`hc:mesh-session`) and the `mesh:public-changed` effect, and
// nothing else. The module seeds at load, so each case imports it fresh.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const load = async (): Promise<() => boolean> => {
  vi.resetModules()
  const mod = await import('./membership.js')
  return mod.isJoinedHere
}

beforeEach(() => {
  EffectBus.clear()
  sessionStorage.clear()
  localStorage.clear()
})

describe('isJoinedHere', () => {
  it('seeds from this tab\'s session', async () => {
    sessionStorage.setItem('hc:mesh-session', 'true')
    expect((await load())()).toBe(true)
  })

  it('is not joined when the session never joined', async () => {
    expect((await load())()).toBe(false)
  })

  it('follows mesh:public-changed — join and leave', async () => {
    const isJoinedHere = await load()
    EffectBus.emit('mesh:public-changed', { public: true })
    expect(isJoinedHere()).toBe(true)
    EffectBus.emit('mesh:public-changed', { public: false })
    expect(isJoinedHere()).toBe(false)
  })

  it('ignores the origin-wide flag a second tab writes', async () => {
    sessionStorage.setItem('hc:mesh-session', 'true')
    const isJoinedHere = await load()
    // A second tab boots unjoined: the shell rewrites the shared flag.
    localStorage.setItem('hc:mesh-public', 'false')
    window.dispatchEvent(new StorageEvent('storage', { key: 'hc:mesh-public', newValue: 'false' }))
    expect(isJoinedHere()).toBe(true)
  })

  it('a flag that says joined does not join a tab whose session never did', async () => {
    localStorage.setItem('hc:mesh-public', 'true')
    expect((await load())()).toBe(false)
  })
})

// ── the tab's zone ─────────────────────────────────────────────────────────

type Store = { value: string; set: (v: string) => void } & EventTarget
const store = (value: string): Store => {
  const t = new EventTarget() as Store
  t.value = value
  t.set = (v: string) => { if (v === t.value) return; t.value = v; t.dispatchEvent(new Event('change')) }
  return t
}
const services = new Map<string, unknown>()
const withStores = (room: string, secret: string): { room: Store; secret: Store } => {
  const r = store(room)
  const s = store(secret)
  services.set('@hypercomb.social/RoomStore', r)
  services.set('@hypercomb.social/SecretStore', s)
  ;(globalThis as unknown as { ioc: unknown }).ioc = { get: (k: string) => services.get(k) }
  return { room: r, secret: s }
}
const zone = (): Record<string, string> | null => {
  const raw = sessionStorage.getItem('hc:mesh-zone')
  return raw ? JSON.parse(raw) : null
}
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }

describe("the tab's zone", () => {
  beforeEach(() => { services.clear() })

  it('a join pins the pair the stores hold, beside the join', async () => {
    withStores('downtown', 'downtown')
    await load()
    EffectBus.emit('mesh:public-changed', { public: true })
    expect(zone()).toEqual({ room: 'downtown', secret: 'downtown' })
  })

  it('a room changed while joined moves the zone with it; while not joined it does not', async () => {
    const { room } = withStores('downtown', 'downtown')
    await load()
    room.set('elsewhere')
    expect(zone()).toBeNull()
    EffectBus.emit('mesh:public-changed', { public: true })
    room.set('uptown')
    expect(zone()).toEqual({ room: 'uptown', secret: 'downtown' })
  })

  it('writeTabZone merges exactly like the shell: undefined keeps, empty relay/host/code removes', async () => {
    const mod = await import('./membership.js')
    mod.writeTabZone({ room: 'r', secret: 's', relay: 'wss://a.example', host: 'a.example', code: 'c' })
    mod.writeTabZone({ code: '', host: undefined })
    expect(mod.readTabZone()).toEqual({ room: 'r', secret: 's', relay: 'wss://a.example', host: 'a.example' })
    expect(mod.tabRelay()).toBe('wss://a.example')
    expect(mod.tabMeetingHost()).toBe('a.example')
  })

  it('the shell and the module agree on the zone key', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const shell = readFileSync(join(process.cwd(), 'hypercomb-shared', 'core', 'mesh-session.ts'), 'utf8')
    const mod = await import('./membership.js')
    expect(shell).toContain(`MESH_ZONE_KEY = '${mod.MESH_ZONE_KEY}'`)
  })
})

describe('resuming on a shell older than the zone', () => {
  beforeEach(() => { services.clear() })

  it('the stores came back in ANOTHER tab\'s pair: not rejoined there — put back, unjoined, and the selector opens', async () => {
    sessionStorage.setItem('hc:mesh-session', 'true')
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'downtown', secret: 'downtown' }))
    const { room, secret } = withStores('xtab-b', 'xtab-b-secret') // the old shell read localStorage
    const seen: unknown[] = []
    EffectBus.on('mesh:public-changed', (p) => { seen.push(['public', p]) })
    EffectBus.on('mesh:open-modal', (p) => { seen.push(['modal', p]) })
    seen.length = 0
    const isJoinedHere = await load()
    expect(isJoinedHere()).toBe(false)
    expect(sessionStorage.getItem('hc:mesh-session')).toBe('false')
    await flush()
    expect(room.value).toBe('downtown')
    expect(secret.value).toBe('downtown')
    expect(seen).toEqual([['public', { public: false }], ['modal', { join: true }]])
  })

  it('the stores came back in its own pair: rejoined silently, nothing asked', async () => {
    sessionStorage.setItem('hc:mesh-session', 'true')
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'downtown', secret: 'downtown' }))
    withStores('downtown', 'downtown')
    const modals: unknown[] = []
    EffectBus.on('mesh:open-modal', (p) => { if (p) modals.push(p) })
    const isJoinedHere = await load()
    await flush()
    expect(isJoinedHere()).toBe(true)
    expect(modals).toEqual([])
  })

  it('no zone recorded (a join from before the zone): resumed as before', async () => {
    sessionStorage.setItem('hc:mesh-session', 'true')
    withStores('meetup', '4417')
    expect((await load())()).toBe(true)
  })
})

// ── one text, one zone (ZI-5) ───────────────────────────────────────────────

describe('writeTabZone folds entered text; what the store holds is kept verbatim', () => {
  beforeEach(() => { services.clear() })

  it('a link\'s or a word\'s room folds exactly as the stores fold it', async () => {
    withStores('', '')
    const mod = await import('./membership.js')
    mod.writeTabZone({ room: 'ｄｏｗｎｔｏｗｎ\u200B', secret: 'joe\u2019s' })
    expect(mod.readTabZone()).toEqual({ room: 'downtown', secret: "joe's" })
  })

  it('the pair a store already holds — a tab that joined before the fold — is recorded as it is', async () => {
    withStores('garden  rose', 'joe\u2019s')
    await load()
    EffectBus.emit('mesh:public-changed', { public: true })
    expect(zone()).toEqual({ room: 'garden  rose', secret: 'joe\u2019s' })
  })
})

describe('ownZone — the zone THIS tab joined or chose', () => {
  it('is null with no record, or with half a pair; the pair when both are recorded', async () => {
    const mod = await import('./membership.js')
    expect(mod.ownZone()).toBeNull()
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'downtown' }))
    expect(mod.ownZone()).toBeNull()
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'downtown', secret: ' ' }))
    expect(mod.ownZone()).toBeNull()
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'downtown', secret: 'rose', relay: 'wss://a.example' }))
    expect(mod.ownZone()).toEqual({ room: 'downtown', secret: 'rose' })
  })

  it('never reads the origin-wide pre-fill', async () => {
    localStorage.setItem('hc:room', 'downtown')
    localStorage.setItem('hc:secret', 'rose')
    const mod = await import('./membership.js')
    expect(mod.ownZone()).toBeNull()
  })
})

// ── VO-5: a selector with no point field ────────────────────────────────────

describe('a selector START under a shell whose selector has no meeting point', () => {
  beforeEach(() => {
    services.clear()
    delete (globalThis as { __hcShellZoneUi?: boolean }).__hcShellZoneUi
  })
  const atOldPoint = (): void => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'downtown', secret: 'rose', relay: 'wss://old.example', host: 'old.example', code: 'k-old' }))
  }

  it('lets the tab\'s point, host and code go, and tells the mesh — that selector showed none', async () => {
    atOldPoint()
    withStores('uptown', 'lily')
    await load()
    const points: unknown[] = []
    EffectBus.on('mesh:zone', (p) => { if (p) points.push(p) })
    EffectBus.emit('mesh:join', {})
    expect(zone()).toEqual({ room: 'downtown', secret: 'rose' })
    expect(points).toEqual([{ relay: '' }])
  })

  it('a shell whose selector carries the point keeps it — that START meant it', async () => {
    ;(globalThis as { __hcShellZoneUi?: boolean }).__hcShellZoneUi = true
    atOldPoint()
    withStores('downtown', 'rose')
    await load()
    EffectBus.emit('mesh:join', {})
    expect(zone()).toMatchObject({ relay: 'wss://old.example', code: 'k-old' })
  })

  it('a START from before this module loaded (replayed by the bus) is not taken for a new one', async () => {
    atOldPoint()
    withStores('downtown', 'rose')
    EffectBus.emit('mesh:join', {})
    await load()
    expect(zone()).toMatchObject({ relay: 'wss://old.example', code: 'k-old' })
  })

  it('a link join (no selector) keeps the point it wrote', async () => {
    withStores('downtown', 'rose')
    const mod = await import('./membership.js')
    mod.writeTabZone({ room: 'downtown', secret: 'rose', relay: 'wss://new.example', code: 'k-new' })
    EffectBus.emit('mesh:public-changed', { public: true })
    expect(zone()).toMatchObject({ relay: 'wss://new.example', code: 'k-new' })
  })
})
