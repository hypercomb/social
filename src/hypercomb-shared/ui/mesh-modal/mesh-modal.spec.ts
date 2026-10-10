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

type Cred = { value: string; set: ReturnType<typeof vi.fn> }
const cred = (value: string): Cred => {
  const c = { value, set: vi.fn((v: string) => { c.value = v }) }
  return c
}
let room: Cred
let secret: Cred
let mesh: { relays: string[]; configureRelays: ReturnType<typeof vi.fn>; getDebug: () => { relays: string[] } }
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
  sessionStorage.clear()
  localStorage.clear()
  room = cred('boot-copy')
  secret = cred('boot-secret')
  mesh = {
    relays: ['wss://jwize.com'],
    configureRelays: vi.fn((urls: string[]) => { mesh.relays = [...urls] }),
    getDebug: () => ({ relays: mesh.relays }),
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
