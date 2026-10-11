// hypercomb-shared/ui/mesh-modal/mesh-modal.spec.ts — the selector is THIS tab's.
//
// It pre-filled from the store's in-memory copy, which a stale tab held since
// boot: START then wrote that stale pair back over the meeting another tab
// had joined since. Now it pre-fills from the tab's own zone, else a FRESH
// read of the origin-wide pair; an opener may hand it a pair or a meeting
// point; nothing is written until save / START / share, and cancel writes
// nothing. The meeting point's access code is typed here, once — never on the
// command line — and kept only in this tab's session (and the link).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

// The widget directive's field decorators need the Angular compiler; the
// selector's logic does not touch it.
vi.mock('../widget-zoom/hc-widget.directive', () => ({ HcWidgetDirective: class {} }))

const services = new Map<string, unknown>()
;(globalThis as { get?: unknown }).get = (k: string) => services.get(k)
;(globalThis as { register?: unknown }).register = (k: string, v: unknown) => { services.set(k, v) }
;(window as unknown as { ioc: unknown }).ioc = { get: (k: string) => services.get(k), register: (k: string, v: unknown) => { services.set(k, v) } }

const { MeshModalComponent } = await import('./mesh-modal.component')
const meshSession = await import('../../core/mesh-session')

type Cred = { value: string; set: ReturnType<typeof vi.fn> }
const cred = (value: string): Cred => {
  const c = { value, set: vi.fn((v: string) => { c.value = v }) }
  return c
}
let room: Cred
let secret: Cred
let mesh: {
  relays: string[]; configureRelays: ReturnType<typeof vi.fn>; getDebug: () => { relays: string[] }
  ownRelays?: () => string[]; swarmHost?: () => string
}
const seen: { effect: string; payload: unknown }[] = []
const offs: (() => void)[] = []

const open = (payload: Record<string, unknown> = {}): InstanceType<typeof MeshModalComponent> => {
  const modal = new MeshModalComponent()
  modal.ngOnInit()
  offs.push(() => modal.ngOnDestroy())
  EffectBus.emit('mesh:open-modal', payload)
  return modal
}
const zone = (): Record<string, string> | null => {
  const raw = sessionStorage.getItem('hc:mesh-zone')
  return raw ? JSON.parse(raw) : null
}
const typeInto = (handler: (e: Event) => void, value: string): void => handler({ target: { value } } as unknown as Event)

beforeEach(() => {
  // The pre-fill is a participant document held in memory here (no Store):
  // back to the default relay for every case.
  meshSession.writeMeshZone({ relay: '' })
  sessionStorage.clear()
  localStorage.clear()
  room = cred('boot-copy')
  secret = cred('boot-secret')
  // The mesh as this package ships it: it follows the tab's meeting point
  // (ownRelays is the page's own list, never the point).
  mesh = {
    relays: ['wss://jwize.com'],
    configureRelays: vi.fn((urls: string[]) => { mesh.relays = [...urls] }),
    getDebug: () => ({ relays: mesh.relays }),
    ownRelays: () => ['wss://jwize.com'],
    swarmHost: () => { try { return new URL(mesh.relays[0] ?? '').host } catch { return '' } },
  }
  services.clear()
  services.set('@hypercomb.social/RoomStore', room)
  services.set('@hypercomb.social/SecretStore', secret)
  services.set('@diamondcoreprocessor.com/NostrMeshDrone', mesh)
  seen.length = 0
  for (const effect of ['mesh:zone', 'mesh:join', 'mesh:room', 'mesh:secret']) {
    offs.push(EffectBus.on(effect, (payload) => { seen.push({ effect, payload }) }))
  }
  seen.length = 0
})

afterEach(() => { while (offs.length) offs.pop()!() })

describe('the selector pre-fills from THIS tab', () => {
  it("from the tab's own zone — never the store's boot-time copy", () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'downtown', secret: 'dt' }))
    const modal = open({ join: true })
    expect(modal.roomDraft()).toBe('downtown')
    expect(modal.secretDraft()).toBe('dt')
  })

  it('with no zone of its own: a FRESH read of the origin-wide pair, as another tab left it', () => {
    localStorage.setItem('hc:room', 'moved-by-another-tab')
    localStorage.setItem('hc:secret', 'its-secret')
    const modal = open({ join: true })
    expect(modal.roomDraft()).toBe('moved-by-another-tab')
    expect(modal.secretDraft()).toBe('its-secret')
  })

  it('an opener may hand it a pair (the meeting link fallback) — and cancel writes nothing at all', () => {
    const modal = open({ join: true, room: 'Meet Up', secret: '4417' })
    expect(modal.roomDraft()).toBe('Meet Up')
    expect(modal.secretDraft()).toBe('4417')
    modal.dismiss()
    expect(room.set).not.toHaveBeenCalled()
    expect(secret.set).not.toHaveBeenCalled()
    expect(zone()).toBeNull()
    expect(localStorage.length).toBe(0)
    expect(seen).toEqual([])
  })

  it('START writes the pair on screen and joins', () => {
    const modal = open({ join: true, room: 'Meet Up', secret: '4417' })
    modal.save()
    expect(room.set).toHaveBeenCalledWith('Meet Up')
    expect(secret.set).toHaveBeenCalledWith('4417')
    expect(seen.map(s => s.effect)).toContain('mesh:join')
  })
})

describe('the meeting point and its access code', () => {
  it('`invite wss://…` opens on that point with the cursor on the code; save keeps relay and code for this tab — and names no meeting host', () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'r', secret: 's', relay: 'wss://a.example', host: 'a.example', code: 'k' }))
    const modal = open({ point: 'wss://pluginthematrix.com', focus: 'code' })
    expect(modal.pointDraft()).toBe('pluginthematrix.com')
    expect(modal.codeDraft()).toBe('')
    typeInto(modal.onCodeInput, 'sekrit-42')
    modal.save()
    expect(zone()).toMatchObject({ relay: 'wss://pluginthematrix.com', code: 'sekrit-42' })
    // Never a guess from the point's own domain, and never the old point's
    // host: only a link that names a meeting host sets one (swarm-hosts.ts
    // never passes it over).
    expect(zone()).not.toHaveProperty('host')
    expect(mesh.configureRelays).toHaveBeenCalledWith(['wss://pluginthematrix.com'], false)
    expect(seen.filter(s => s.effect === 'mesh:zone')).toEqual([{ effect: 'mesh:zone', payload: { relay: 'wss://pluginthematrix.com' } }])
    expect(JSON.stringify(seen)).not.toContain('sekrit-42')
    expect(JSON.stringify({ ...localStorage })).not.toContain('sekrit-42')
  })

  it('a recycled code replaces the old one; the point and the mesh stay', () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'r', secret: 's', relay: 'wss://pluginthematrix.com', host: 'pluginthematrix.com', code: 'old' }))
    mesh.relays = ['wss://pluginthematrix.com']
    const modal = open({ focus: 'code' })
    expect(modal.pointDraft()).toBe('pluginthematrix.com')
    expect(modal.codeDraft()).toBe('old')
    typeInto(modal.onCodeInput, 'new-code')
    modal.save()
    expect(zone()).toMatchObject({ relay: 'wss://pluginthematrix.com', host: 'pluginthematrix.com', code: 'new-code' })
    expect(mesh.configureRelays).not.toHaveBeenCalled()
  })

  it('emptying the point goes back to the default and drops its code and host', () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'r', secret: 's', relay: 'wss://a.example', host: 'a.example', code: 'k' }))
    const modal = open()
    typeInto(modal.onPointInput, '')
    typeInto(modal.onCodeInput, '')
    modal.save()
    expect(zone()).toEqual({ room: 'r', secret: 's' })
    expect(seen.filter(s => s.effect === 'mesh:zone')).toEqual([{ effect: 'mesh:zone', payload: { relay: '' } }])
  })

  it('refuses a code with no meeting point (it would reach the default relay), a bad code and a bad point', () => {
    const modal = open({ join: true, room: 'r', secret: 's' })
    typeInto(modal.onCodeInput, 'sekrit')
    modal.save()
    expect(modal.missingField()).toBe('point')
    typeInto(modal.onPointInput, 'ws://pluginthematrix.com')
    modal.save()
    expect(modal.missingField()).toBe('point')
    typeInto(modal.onPointInput, 'pluginthematrix.com')
    typeInto(modal.onCodeInput, 'has space')
    modal.save()
    expect(modal.missingField()).toBe('code')
    expect(room.set).not.toHaveBeenCalled()
    expect(zone()).toBeNull()
    expect(modal.open()).toBe(true)
  })

  it('share commits the point, then hands out the meeting link', async () => {
    const meetingLink = vi.fn(async () => {
      expect(zone()).toMatchObject({ relay: 'wss://pluginthematrix.com', code: 'sekrit-42' })
    })
    services.set('@diamondcoreprocessor.com/InviteQueenBee', { invoke: vi.fn(), meetingLink })
    const modal = open({ room: 'downtown', secret: 'downtown', point: 'pluginthematrix.com' })
    typeInto(modal.onCodeInput, 'sekrit-42')
    await modal.copyShareLink()
    expect(meetingLink).toHaveBeenCalledTimes(1)
  })
})

// ── the long-tail hunt (2026-10-10) ──────────────────────────────────────

describe('VO-6: a computer\'s own ws:// meeting point survives START untouched', () => {
  it('pre-fills ws://localhost:7894 as written, and START commits nothing new', () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'r', secret: 's', relay: 'ws://localhost:7894' }))
    mesh.relays = ['ws://localhost:7894']
    const modal = open({ join: true })
    expect(modal.pointDraft()).toBe('ws://localhost:7894')
    modal.save()
    expect(zone()).toMatchObject({ relay: 'ws://localhost:7894' })
    expect(mesh.configureRelays).not.toHaveBeenCalled()
    expect(seen.filter(s => s.effect === 'mesh:zone')).toEqual([])
  })

  it('the old-package link fallback hands ws://… over and it stays ws://', () => {
    const modal = open({ join: true, room: 'r', secret: 's', point: 'ws://localhost:7894' })
    expect(modal.pointDraft()).toBe('ws://localhost:7894')
    modal.save()
    expect(zone()).toMatchObject({ relay: 'ws://localhost:7894' })
    expect(mesh.configureRelays).toHaveBeenCalledWith(['ws://localhost:7894'], false)
  })
})

describe('VO-2: a package from before meeting points is never pointed at one', () => {
  beforeEach(() => {
    // 87383624's mesh: configureRelays, no ownRelays — it reloads its own
    // default list on every refresh and cannot carry an access code.
    delete mesh.ownRelays
  })

  it('the point and code are disabled, with the way to update — and START never calls configureRelays', () => {
    const modal = open({ join: true, room: 'downtown', secret: 'rose', point: 'wss://pluginthematrix.com' })
    expect(modal.pointSupported()).toBe(false)
    typeInto(modal.onCodeInput, 'sekrit-42')
    modal.save()
    expect(mesh.configureRelays).not.toHaveBeenCalled()
    expect(zone()?.relay).toBeUndefined()
    expect(zone()?.code).toBeUndefined()
    expect(seen.filter(s => s.effect === 'mesh:zone')).toEqual([])
    // it still joins the room — on the relay this package can reach
    expect(seen.map(s => s.effect)).toContain('mesh:join')
  })

  it('the update button opens Packages', () => {
    const opened: unknown[] = []
    offs.push(EffectBus.on('packages:open', p => { opened.push(p) }))
    const modal = open({ join: true })
    modal.openPackages()
    expect(opened.length).toBe(1)
    expect(modal.open()).toBe(false)
  })

  it('the template disables both fields and shows the line', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const html = readFileSync(join(__dirname, 'mesh-modal.component.html'), 'utf8')
    for (const id of ['mesh-modal-point-input', 'mesh-modal-code-input']) {
      const at = html.indexOf(`id="${id}"`)
      expect(html.slice(at, html.indexOf('/>', at))).toContain('[disabled]="!pointSupported()"')
    }
    expect(html).toContain("'zone.point-needs-update' | t")
    expect(html).toContain('(click)="openPackages()"')
  })
})

describe('ZI-1: a new tab pre-fills the point the origin last met at — never its code', () => {
  it('no zone of its own: the point this device last met at (mesh:meet-point), and an empty code', () => {
    localStorage.setItem('hc:room', 'downtown')
    localStorage.setItem('hc:secret', 'rose')
    meshSession.writeMeshZone({ relay: 'wss://pluginthematrix.com', code: 'k-9' })
    sessionStorage.clear()
    const modal = open({ join: true })
    expect(modal.roomDraft()).toBe('downtown')
    expect(modal.pointDraft()).toBe('pluginthematrix.com')
    expect(modal.codeDraft()).toBe('')
  })

  it('a tab with a zone of its own keeps its own point — the default included', () => {
    meshSession.writeMeshZone({ relay: 'wss://pluginthematrix.com' })
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'r', secret: 's' }))
    expect(open({ join: true }).pointDraft()).toBe('')
  })
})

describe('ZI-1 / ZI-6: the selector\'s words', () => {
  it('preview the zone START will store: typed text folds (D6), the store\'s own value is read as held', async () => {
    const { secretTag } = await import('@hypercomb/core')
    const plain = secretTag('lifecycle\0downtown\0joe\'s', 'en')
    const modal = open({ room: 'ｄｏｗｎｔｏｗｎ', secret: 'joe’s' })
    expect(modal.zoneWords()).toBe(plain)        // what a friend typing plain text reads
    // A pair the store already holds (recorded before the fold) previews as held.
    room.value = 'joe’s place'
    const held = open({ room: 'joe’s place', secret: 'joe’s' })
    expect(held.zoneWords()).toBe(secretTag('lifecycle\0joe’s place\0joe\'s', 'en'))
    typeInto(held.onRoomInput, 'joe’s place ')
    expect(held.zoneWords()).toBe(secretTag('lifecycle\0joe’s place\0joe\'s', 'en'))
  })

  it('fold the point typed — the default keeps today\'s pair — from the English list, the reader\'s own beside it', async () => {
    const { secretTag } = await import('@hypercomb/core')
    const today = secretTag('lifecycle\0downtown\0rose', 'en')
    const modal = open({ room: 'downtown', secret: 'rose' })
    expect(modal.zoneWords()).toBe(today)
    typeInto(modal.onPointInput, 'pluginthematrix.com')
    const atPoint = modal.zoneWords()
    expect(atPoint).not.toBe(today)
    typeInto(modal.onPointInput, 'wss://jwize.com')
    expect(modal.zoneWords()).toBe(today)

    services.set('@hypercomb.social/I18n', { locale: 'ja' })
    const ja = open({ room: 'downtown', secret: 'rose' })
    expect(ja.zoneWords()).toBe(`${today} (${secretTag('lifecycle\0downtown\0rose', 'ja')})`)
  })
})
