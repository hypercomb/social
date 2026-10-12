// core/invite-capture.robust.spec.ts — THE SHELL NEVER LETS A MEETING LINK
// DO NOTHING.
//
//   VO-1  an older package drains a link naming a meeting point and refuses
//         it (by design) — the shell kept its own copy, so it puts the link
//         back, opens the update door and says why.
//   VO-3  a link the shell itself answers with the selector carries its
//         access code into the tab's zone, so a reload resumes with it.
//   CC-2  where storage is blocked the link is never destroyed: the address
//         bar keeps it until the stash holds it, and the welcome card can
//         put it back.
//   ZI-2 / ZI-3  the shell reads a link exactly as the module does.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const load = async (): Promise<typeof import('./invite-capture')> => {
  vi.resetModules()
  return await import('./invite-capture')
}

const WORKER_KEY = '@diamondcoreprocessor.com/MeetingInviteWorker'
const POINT_LINK = 'downtown/rose&relay=ws%3A%2F%2Flocalhost%3A7914&host=https%3A%2F%2Flocalhost%3A7914&code=pointCode42'

const services = new Map<string, unknown>()
const fx: { name: string; p: unknown }[] = []
const offs: (() => void)[] = []

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  services.clear()
  ;(window as unknown as { ioc: unknown }).ioc = { get: (k: string) => services.get(k) }
  fx.length = 0
  for (const name of ['mesh:open-modal', 'packages:open', 'toast:show']) {
    offs.push(EffectBus.on(name, (p) => { if (p) fx.push({ name, p }) }))
  }
  // The selector answers an open at once, as mesh-modal.component does.
  offs.push(EffectBus.on('mesh:open-modal', (p) => { if (p) EffectBus.emit('mesh:modal-open', { open: true }) }))
  fx.length = 0
})
afterEach(() => {
  for (const off of offs.splice(0)) off()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const named = (name: string) => fx.filter(e => e.name === name).map(e => e.p)

describe('VO-1 — an older package that drains a link it refuses', () => {
  it('the shell kept its copy: the link goes back, the update door opens, and the guest is told why', async () => {
    window.history.replaceState(null, '', '/#meet=' + POINT_LINK)
    const { watchPendingMeet } = await load()
    expect(sessionStorage.getItem('hc:pending-meet')).toBe(POINT_LINK)
    services.set(WORKER_KEY, {}) // 87383624 / 75007af2: no meetLinks
    watchPendingMeet({ pollMs: 100, graceMs: 5_000 })
    // …and it drains the stash the moment it acts, refusing the link.
    sessionStorage.removeItem('hc:pending-meet')
    await vi.advanceTimersByTimeAsync(300)
    expect(sessionStorage.getItem('hc:pending-meet')).toBe(POINT_LINK) // back, for the newer worker
    expect(named('packages:open')).toHaveLength(1)
    expect(named('toast:show')).toEqual([expect.objectContaining({ message: expect.stringMatching(/needs the newer Hypercomb/) })])
    expect(named('mesh:open-modal')).toEqual([]) // never the selector: it would meet at the default
  })

  it('a reload that finds the link back in the stash: the shell starts from it (the old worker drains it again)', async () => {
    sessionStorage.setItem('hc:pending-meet', POINT_LINK)
    const { watchPendingMeet } = await load()
    services.set(WORKER_KEY, {})
    sessionStorage.removeItem('hc:pending-meet')
    watchPendingMeet({ pollMs: 100 })
    await vi.advanceTimersByTimeAsync(200)
    expect(sessionStorage.getItem('hc:pending-meet')).toBe(POINT_LINK)
    expect(named('packages:open')).toHaveLength(1)
  })

  it('a slash in the room — which an older reader refuses too — goes the same way', async () => {
    const link = 'standup%2010%2F09/rose'
    sessionStorage.setItem('hc:pending-meet', link)
    const { watchPendingMeet } = await load()
    services.set(WORKER_KEY, {})
    sessionStorage.removeItem('hc:pending-meet')
    watchPendingMeet({ pollMs: 100 })
    await vi.advanceTimersByTimeAsync(200)
    expect(sessionStorage.getItem('hc:pending-meet')).toBe(link)
    expect(named('packages:open')).toHaveLength(1)
  })

  it('a plain link the older worker drained: it is answering it — the shell stays out', async () => {
    sessionStorage.setItem('hc:pending-meet', 'meetup/4417')
    const { watchPendingMeet } = await load()
    services.set(WORKER_KEY, {})
    sessionStorage.removeItem('hc:pending-meet')
    watchPendingMeet({ pollMs: 100 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fx).toEqual([])
    expect(sessionStorage.getItem('hc:pending-meet')).toBeNull()
  })

  it('the Sep 30 package, which never reads the stash: a point link opens the update door after the grace, the stash kept', async () => {
    sessionStorage.setItem('hc:pending-meet', POINT_LINK)
    const { watchPendingMeet } = await load()
    services.set(WORKER_KEY, {})
    watchPendingMeet({ pollMs: 100, graceMs: 1_000 })
    await vi.advanceTimersByTimeAsync(900)
    expect(fx).toEqual([])
    await vi.advanceTimersByTimeAsync(300)
    expect(named('packages:open')).toHaveLength(1)
    expect(named('mesh:open-modal')).toEqual([])
    expect(sessionStorage.getItem('hc:pending-meet')).toBe(POINT_LINK)
  })

  it('a current worker: the shell stands aside, whatever the link names', async () => {
    sessionStorage.setItem('hc:pending-meet', POINT_LINK)
    const { watchPendingMeet } = await load()
    services.set(WORKER_KEY, { meetLinks: 2 })
    watchPendingMeet({ pollMs: 100, graceMs: 200 })
    sessionStorage.removeItem('hc:pending-meet')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fx).toEqual([])
  })
})

describe('VO-3 — the selector path carries the access code into the tab', () => {
  it('no worker at all: the zone holds the point, its host and code BEFORE the selector opens', async () => {
    sessionStorage.setItem('hc:pending-meet', POINT_LINK)
    const { watchPendingMeet, pendingMeetCredentials } = await load()
    watchPendingMeet({ pollMs: 100, maxWaitMs: 1_000 })
    await vi.advanceTimersByTimeAsync(1_200)
    expect(JSON.parse(sessionStorage.getItem('hc:mesh-zone') ?? 'null')).toEqual({ relay: 'ws://localhost:7914', host: 'localhost:7914', code: 'pointCode42' })
    // The point rides along; the pair and the code never do — the selector
    // reads the pair from the stash, the code from the zone.
    expect(named('mesh:open-modal')).toEqual([{ join: true, meet: true, point: 'ws://localhost:7914' }])
    expect(JSON.stringify(named('mesh:open-modal'))).not.toMatch(/rose|pointCode42/)
    expect(pendingMeetCredentials()).toEqual({ room: 'downtown', secret: 'rose' })
    EffectBus.emit('mesh:modal-open', { open: false, cancelled: false }) // START
    expect(JSON.parse(sessionStorage.getItem('hc:mesh-zone') ?? 'null')).toMatchObject({ code: 'pointCode42' })
    expect(sessionStorage.getItem('hc:pending-meet')).toBeNull()
  })

  it('closed without START: the zone is put back as it was', async () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'mine', secret: 'mine', relay: 'wss://other.example', code: 'old' }))
    sessionStorage.setItem('hc:pending-meet', POINT_LINK)
    const { watchPendingMeet } = await load()
    watchPendingMeet({ pollMs: 100, maxWaitMs: 1_000 })
    await vi.advanceTimersByTimeAsync(1_200)
    EffectBus.emit('mesh:modal-open', { open: true })
    EffectBus.emit('mesh:modal-open', { open: false, cancelled: true })
    expect(JSON.parse(sessionStorage.getItem('hc:mesh-zone') ?? 'null')).toEqual({ room: 'mine', secret: 'mine', relay: 'wss://other.example', code: 'old' })
  })
})

describe('CC-2 — where storage is blocked, the link is never destroyed', () => {
  it('sessionStorage refused: the address bar keeps the link, and the shell holds a copy', async () => {
    window.history.replaceState(null, '', '/#meet=' + POINT_LINK)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('The operation is insecure.', 'SecurityError') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('The operation is insecure.', 'SecurityError') })
    const { restoreMeetLink } = await load()
    expect(window.location.hash).toBe('#meet=' + POINT_LINK)
    expect(restoreMeetLink()).toBe(`${window.location.origin}/#meet=${POINT_LINK}`)
  })

  it('OPFS refused after the stash took it: the card puts the link back in the address bar', async () => {
    window.history.replaceState(null, '', '/#meet=' + POINT_LINK)
    const { restoreMeetLink } = await load()
    expect(window.location.hash).toBe('') // stripped at boot, as always
    expect(restoreMeetLink()).toBe(`${window.location.origin}/#meet=${POINT_LINK}`)
    expect(window.location.hash).toBe('#meet=' + POINT_LINK)
  })

  it('no link, or one already answered: nothing to put back', async () => {
    const { restoreMeetLink } = await load()
    expect(restoreMeetLink()).toBe('')
    expect(window.location.hash).toBe('')
  })
})

describe('the shell reads a link exactly as the module does', () => {
  it('stray punctuation at the end, and a slash in a room or secret', async () => {
    const { meetCredentialsOf, meetPointOf } = await load()
    const { meetFragment, parseMeet } = await import('../../hypercomb-essentials/src/sharing/meeting-invite')
    const links = [
      meetFragment('downtown', 'rose', []),
      meetFragment('downtown', 'rose!', []),
      meetFragment('standup 10/09', 'spring/2026', ['Ideas']),
      meetFragment('downtown', 'rose', ['Plans'], { relay: 'wss://pluginthematrix.com/io', host: 'pluginthematrix.com', code: 'k3y.Recycled-2.' }),
      '#meet=downtown/rose(2)',
    ]
    for (const link of links) {
      for (const tail of ['', '.', ')', ',', '!', '"', '>', '.)']) {
        const m = parseMeet(link + tail)
        expect(m, link + tail).not.toBeNull()
        expect(meetCredentialsOf(link + tail), link + tail).toEqual({ room: m!.room, secret: m!.secret })
        expect(meetPointOf(link + tail), link + tail).toBe(m!.relay ?? '')
      }
    }
  })
})
