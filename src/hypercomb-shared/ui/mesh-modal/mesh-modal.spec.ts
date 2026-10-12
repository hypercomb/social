// hypercomb-shared/ui/mesh-modal/mesh-modal.spec.ts — the selector is THIS tab's.
//
// It pre-filled from the store's in-memory copy, which a stale tab held since
// boot: START then wrote that stale pair back over the meeting another tab
// had joined since. Now it pre-fills from the tab's own zone, else a FRESH
// read of the origin-wide pair; an opener may point it at the meeting link
// stashed in this tab or hand it a meeting point; nothing is written until
// save / START / share, and cancel writes nothing. The meeting point's access
// code is typed here, once — never on the command line — and kept only in
// this tab's session (and the link). The secret never rides the bus: the bus
// replays its last value to every late subscriber.

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
/** A meeting link stashed in this tab, as the shell's capture leaves it. */
const stashMeet = (link: string): void => { sessionStorage.setItem('hc:pending-meet', link) }
/** The old-package fallback's open: the pair waits in this tab's stash and
 *  the open names it — the pair itself never rides the bus. */
const openStashed = (pair: { room: string; secret: string }, payload: Record<string, unknown> = {}): InstanceType<typeof MeshModalComponent> => {
  stashMeet(`${encodeURIComponent(pair.room)}/${encodeURIComponent(pair.secret)}/`)
  return open({ ...payload, meet: true })
}
/** What a subscriber arriving now is handed for an effect. */
const replayed = (effect: string): unknown => {
  let got: unknown
  EffectBus.on(effect, (payload) => { got = payload })()
  return got
}

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
    relays: ['wss://hypercomb.com'],
    configureRelays: vi.fn((urls: string[]) => { mesh.relays = [...urls] }),
    getDebug: () => ({ relays: mesh.relays }),
    ownRelays: () => ['wss://hypercomb.com'],
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

  it('an opener may point it at the stashed meeting link (the fallback) — and cancel writes nothing at all', () => {
    stashMeet('Meet%20Up/4417/')
    const modal = open({ join: true, meet: true })
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
    stashMeet('Meet%20Up/4417/')
    const modal = open({ join: true, meet: true })
    modal.save()
    expect(room.set).toHaveBeenCalledWith('Meet Up')
    expect(secret.set).toHaveBeenCalledWith('4417')
    expect(seen.map(s => s.effect)).toContain('mesh:join')
  })
})

describe('the secret never rides the bus', () => {
  it('save makes mesh:secret a notice and the draft a strength — no late subscriber is handed the secret', () => {
    const modal = open({ join: true })
    typeInto(modal.onRoomInput, 'river')
    typeInto(modal.onSecretInput, 'river-stone-9')
    expect(replayed('mesh:secret-draft')).toMatchObject({ open: true, score: expect.any(Number) })
    modal.save()
    expect(secret.set).toHaveBeenCalledWith('river-stone-9')
    expect(seen.map(s => s.effect)).toContain('mesh:secret')
    expect(JSON.stringify(seen)).not.toContain('river-stone-9')
    for (const effect of ['mesh:secret', 'mesh:secret-draft', 'mesh:open-modal']) {
      expect(JSON.stringify(replayed(effect) ?? null)).not.toContain('river-stone-9')
    }
    expect(replayed('mesh:secret-draft')).toEqual({ open: false, score: null })
  })

  it('a stashed meeting link fills the drafts without its secret ever reaching the bus', () => {
    stashMeet('Meet%20Up/4417/')
    const modal = open({ join: true, meet: true })
    expect(modal.secretDraft()).toBe('4417')
    expect(JSON.stringify(replayed('mesh:open-modal'))).not.toContain('4417')
    expect(JSON.stringify(replayed('mesh:secret-draft'))).not.toContain('4417')
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
    stashMeet('r/s/')
    const modal = open({ join: true, meet: true })
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
    stashMeet('downtown/downtown/')
    const modal = open({ meet: true, point: 'pluginthematrix.com' })
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
    const modal = openStashed({ room: 'r', secret: 's' }, { join: true, point: 'ws://localhost:7894' })
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
    const modal = openStashed({ room: 'downtown', secret: 'rose' }, { join: true, point: 'wss://pluginthematrix.com' })
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
    const plain = secretTag('lifecycle\0downtown\0joe\'s\0hypercomb.com', 'en')
    const modal = openStashed({ room: 'ｄｏｗｎｔｏｗｎ', secret: 'joe’s' })
    expect(modal.zoneWords()).toBe(plain)        // what a friend typing plain text reads
    // A pair the store already holds (recorded before the fold) previews as held.
    room.value = 'joe’s place'
    const held = openStashed({ room: 'joe’s place', secret: 'joe’s' })
    expect(held.zoneWords()).toBe(secretTag('lifecycle\0joe’s place\0joe\'s\0hypercomb.com', 'en'))
    typeInto(held.onRoomInput, 'joe’s place ')
    expect(held.zoneWords()).toBe(secretTag('lifecycle\0joe’s place\0joe\'s\0hypercomb.com', 'en'))
  })

  it('fold the point — always, an empty field being hypercomb.com — from the English list, the reader\'s own beside it', async () => {
    const { secretTag } = await import('@hypercomb/core')
    const today = secretTag('lifecycle\0downtown\0rose\0hypercomb.com', 'en')
    // the pair from before the point was part of the room is not it
    expect(today).not.toBe(secretTag('lifecycle\0downtown\0rose', 'en'))
    const modal = openStashed({ room: 'downtown', secret: 'rose' })
    expect(modal.zoneWords()).toBe(today)
    typeInto(modal.onPointInput, 'pluginthematrix.com')
    const atPoint = modal.zoneWords()
    expect(atPoint).not.toBe(today)
    expect(atPoint).toBe(secretTag('lifecycle\0downtown\0rose\0pluginthematrix.com', 'en'))
    for (const p of ['wss://hypercomb.com', 'hypercomb.com', 'wss://HyperComb.com/', '']) {
      typeInto(modal.onPointInput, p)
      expect([p, modal.zoneWords()]).toEqual([p, today])
    }

    services.set('@hypercomb.social/I18n', { locale: 'ja' })
    const ja = openStashed({ room: 'downtown', secret: 'rose' })
    expect(ja.zoneWords()).toBe(`${today} (${secretTag('lifecycle\0downtown\0rose\0hypercomb.com', 'ja')})`)
  })

  it('with no point typed, fold the point an empty field dials — a chosen local relay on a local page, never one a public page cannot reach', async () => {
    const { secretTag } = await import('@hypercomb/core')
    // jsdom serves localhost: a chosen dev relay is where this page meets —
    // shown in the field, never a point hidden in a list.
    mesh.ownRelays = () => ['ws://localhost:7777']
    const local = openStashed({ room: 'downtown', secret: 'rose' })
    expect(local.pointDraft()).toBe('ws://localhost:7777')
    expect(local.zoneWords()).toBe(secretTag('lifecycle\0downtown\0rose\0localhost:7777', 'en'))
    // Cleared, the field is the shipped default — the pair says so.
    typeInto(local.onPointInput, '')
    expect(local.zoneWords()).toBe(secretTag('lifecycle\0downtown\0rose\0hypercomb.com', 'en'))
    // Nothing chosen: the shipped default.
    mesh.ownRelays = () => ['wss://hypercomb.com']
    expect(openStashed({ room: 'downtown', secret: 'rose' }).zoneWords()).toBe(secretTag('lifecycle\0downtown\0rose\0hypercomb.com', 'en'))
  })
})

// ── ONLY WHAT DEFINES THE MEETING (jwize, 2026-10-12) ─────────────────────
describe('the selector shows the meeting point, the room and the secret — and a code only when a coded point needs one', () => {
  const html = async (): Promise<string> => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    return readFileSync(join(__dirname, 'mesh-modal.component.html'), 'utf8')
  }

  it('its fields are the meeting point, the room and the secret, in that order, and the code — nothing else', async () => {
    const tpl = await html()
    const ids = [...tpl.matchAll(/<input[^>]*?\sid="([^"]+)"/g)].map(m => m[1])
    expect(ids).toEqual(['mesh-modal-point-input', 'mesh-modal-code-input', 'mesh-modal-room-input', 'mesh-modal-secret-input'])
    // the replication host and the alias are not the meeting's: they live
    // in the host directory and on the presence line
    for (const gone of ['mesh-modal-host-input', 'mesh-modal-label-input', "'mesh-modal.host-label'", "'mesh-modal.label-label'"]) expect(tpl).not.toContain(gone)
    const at = tpl.indexOf('id="mesh-modal-code-input"')
    expect(tpl.lastIndexOf('@if (codeShown())', at)).toBeGreaterThan(tpl.indexOf('id="mesh-modal-point-input"'))
  })

  it('the code shows for a point other than the default, a code already held, or an opener asking — never for an empty field or hypercomb.com', () => {
    const modal = open({ join: true })
    expect(modal.pointDraft()).toBe('')
    expect(modal.codeShown()).toBe(false)
    for (const p of ['hypercomb.com', 'wss://HyperComb.com/']) {
      typeInto(modal.onPointInput, p)
      expect([p, modal.codeShown()]).toEqual([p, false])
    }
    typeInto(modal.onPointInput, 'wss://pluginthematrix.com')
    expect(modal.codeShown()).toBe(true)
    typeInto(modal.onPointInput, '')
    typeInto(modal.onCodeInput, 'k-1')
    expect(modal.codeShown()).toBe(true)
    expect(open({ point: 'wss://pluginthematrix.com', focus: 'code' }).codeShown()).toBe(true)
  })

  it('an EMPTY field is the shipped default: a list the page chose elsewhere is never where START meets unseen', () => {
    // An older command saved this origin's list at another relay.
    mesh.ownRelays = () => ['wss://jwize.com']
    const modal = open({ join: true })
    expect(modal.pointDraft()).toBe('jwize.com')            // shown, not hidden
    typeInto(modal.onPointInput, '')
    typeInto(modal.onRoomInput, 'garden')
    typeInto(modal.onSecretInput, 'rose')
    modal.save()
    // The default named as this tab's point: the same room as typing it.
    expect(zone()).toMatchObject({ relay: 'wss://hypercomb.com' })
    expect(zone()?.code ?? '').toBe('')
    // A page whose own list IS the default needs no point of its own.
    meshSession.writeMeshZone({ relay: '' })
    sessionStorage.clear()
    mesh.ownRelays = () => ['wss://hypercomb.com']
    const plain = open({ join: true })
    expect(plain.pointDraft()).toBe('')
    typeInto(plain.onRoomInput, 'garden')
    typeInto(plain.onSecretInput, 'rose')
    plain.save()
    expect(zone()?.relay ?? '').toBe('')
  })

  it("the point is written BEFORE the room and the secret — the swarm's first address after the move is at the new point", () => {
    const atRoomSet: string[] = []
    room.set = vi.fn((v: string) => { atRoomSet.push(String(zone()?.relay ?? '')); room.value = v })
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'garden', secret: 'rose' }))
    const modal = open({ join: true })
    typeInto(modal.onPointInput, 'wss://other.example')
    typeInto(modal.onRoomInput, 'garden2')
    modal.save()
    expect(atRoomSet).toEqual(['wss://other.example'])
  })

  it("the access code is always masked — the secret's eye never reveals it", async () => {
    const tpl = await html()
    const at = tpl.indexOf('id="mesh-modal-code-input"')
    const input = tpl.slice(at, tpl.indexOf('/>', at))
    expect(input).toContain('type="password"')
    expect(input).not.toContain('secretInputType')
  })

  it('save writes no host and no label: your own host is never part of the meeting', () => {
    localStorage.setItem('hc:nostrmesh:self-domain', 'mine.example')
    const setMyLabel = vi.fn()
    services.set('@diamondcoreprocessor.com/SwarmDrone', { myLabel: () => 'me', setMyLabel })
    const hosts: unknown[] = []
    offs.push(EffectBus.on('mesh:host', (p) => { hosts.push(p) }))
    hosts.length = 0
    const modal = open({ join: true })
    typeInto(modal.onRoomInput, 'river')
    typeInto(modal.onSecretInput, 'stone')
    modal.save()
    expect(localStorage.getItem('hc:nostrmesh:self-domain')).toBe('mine.example')
    expect(setMyLabel).not.toHaveBeenCalled()
    expect(hosts).toEqual([])
    expect(seen.map(s => s.effect)).toContain('mesh:join')
  })
})
