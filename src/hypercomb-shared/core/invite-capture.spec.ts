// core/invite-capture.spec.ts — the meeting link is captured before anything
// can read the hash, and the secret leaves the address bar at once.
//
// `#meet=room/secret/page` rides in the fragment (no server sees it). The
// shell stashes it VERBATIM for MeetingInviteWorker — sessionStorage, so a
// first visit that installs and reloads still joins — and strips it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const load = async (): Promise<typeof import('./invite-capture')> => {
  vi.resetModules()
  return await import('./invite-capture')
}

beforeEach(() => {
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('the meeting link at boot', () => {
  it('stashes the fragment verbatim and strips it from the address', async () => {
    window.history.replaceState(null, '', '/#meet=Meet%20Up/4417/Big%20Ideas')
    await load()
    expect(sessionStorage.getItem('hc:pending-meet')).toBe('Meet%20Up/4417/Big%20Ideas')
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/')
  })

  it('keeps the path and query it arrived with', async () => {
    window.history.replaceState(null, '', '/some/page?lang=ja#meet=meetup/4417')
    await load()
    expect(sessionStorage.getItem('hc:pending-meet')).toBe('meetup/4417')
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/some/page?lang=ja')
  })

  it('leaves every other fragment alone', async () => {
    window.history.replaceState(null, '', '/#(a,b)')
    await load()
    expect(sessionStorage.getItem('hc:pending-meet')).toBeNull()
    expect(window.location.hash).toBe('#(a,b)')
  })

  it('a link carrying a meeting point is stashed whole — the code leaves the address bar with it', async () => {
    window.history.replaceState(null, '', '/#meet=downtown/downtown&relay=pluginthematrix.com&code=sekrit-42')
    await load()
    expect(sessionStorage.getItem('hc:pending-meet')).toBe('downtown/downtown&relay=pluginthematrix.com&code=sekrit-42')
    expect(window.location.href).not.toContain('sekrit-42')
  })
})

// ── the old package fallback ────────────────────────────────────────────────
// A package from before the meeting link never reads the stash; one from
// before this revision drained it unanswered. Either way the shell answers
// it itself: the selector, pre-filled from the link, and the stash goes when
// the selector closes. A current package (its worker says `meetLinks`)
// answers it, and the shell stands aside.

describe('the shell answers a meeting link no package will', () => {
  const services = new Map<string, unknown>()
  const opened: unknown[] = []
  let offOpen: () => void = () => {}

  beforeEach(() => {
    vi.useFakeTimers()
    services.clear()
    ;(window as unknown as { ioc: unknown }).ioc = { get: (k: string) => services.get(k) }
    opened.length = 0
    offOpen = EffectBus.on('mesh:open-modal', (p) => { if (p) opened.push(p) })
    opened.length = 0
  })
  afterEach(() => { offOpen(); vi.useRealTimers() })

  it('an older worker that never takes the stash: after the grace, the selector opens on the link\'s room — nothing written', async () => {
    const { watchPendingMeet } = await load()
    sessionStorage.setItem('hc:pending-meet', 'Meet%20Up/4417/Ideas&relay=x.example&code=k')
    services.set('@diamondcoreprocessor.com/MeetingInviteWorker', {}) // no meetLinks
    watchPendingMeet({ pollMs: 100, graceMs: 1_000 })
    await vi.advanceTimersByTimeAsync(900)
    expect(opened).toEqual([])
    await vi.advanceTimersByTimeAsync(300)
    // The meeting point rides along (START meets where the room is); the code never does.
    expect(opened).toEqual([{ join: true, room: 'Meet Up', secret: '4417', point: 'wss://x.example' }])
    expect(sessionStorage.getItem('hc:pending-meet')).not.toBeNull() // kept until answered
    expect(localStorage.getItem('hc:room')).toBeNull()
    EffectBus.emit('mesh:modal-open', { open: true })
    expect(sessionStorage.getItem('hc:pending-meet')).not.toBeNull()
    EffectBus.emit('mesh:modal-open', { open: false, cancelled: true })
    expect(sessionStorage.getItem('hc:pending-meet')).toBeNull()
  })

  it('a worker that drains the stash in time: nothing more to do', async () => {
    const { watchPendingMeet } = await load()
    sessionStorage.setItem('hc:pending-meet', 'meetup/4417')
    services.set('@diamondcoreprocessor.com/MeetingInviteWorker', {})
    watchPendingMeet({ pollMs: 100, graceMs: 1_000 })
    await vi.advanceTimersByTimeAsync(300)
    sessionStorage.removeItem('hc:pending-meet')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(opened).toEqual([])
  })

  it('a current worker keeps and answers the link itself: the shell stands aside', async () => {
    const { watchPendingMeet } = await load()
    sessionStorage.setItem('hc:pending-meet', 'meetup/4417')
    services.set('@diamondcoreprocessor.com/MeetingInviteWorker', { meetLinks: 2 })
    watchPendingMeet({ pollMs: 100, graceMs: 1_000 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(opened).toEqual([])
    expect(sessionStorage.getItem('hc:pending-meet')).toBe('meetup/4417')
  })

  it('no worker at all: answered after the long wait', async () => {
    const { watchPendingMeet } = await load()
    sessionStorage.setItem('hc:pending-meet', 'meetup/4417')
    watchPendingMeet({ pollMs: 100, graceMs: 1_000, maxWaitMs: 5_000 })
    await vi.advanceTimersByTimeAsync(4_000)
    expect(opened).toEqual([])
    await vi.advanceTimersByTimeAsync(1_200)
    expect(opened).toEqual([{ join: true, room: 'meetup', secret: '4417' }])
  })

  it('a link whose meeting point is not one is let go — never a quiet join at the default relay', async () => {
    const { watchPendingMeet, meetPointOf } = await load()
    expect(meetPointOf('r/s')).toBe('')
    expect(meetPointOf('r/s&relay=wss%3A%2F%2Fpluginthematrix.com%2Fio&code=k')).toBe('wss://pluginthematrix.com/io')
    expect(meetPointOf('r/s&relay=ws%3A%2F%2Fpluginthematrix.com')).toBeNull()
    sessionStorage.setItem('hc:pending-meet', 'r/s&relay=not%20a%20host')
    services.set('@diamondcoreprocessor.com/MeetingInviteWorker', {})
    watchPendingMeet({ pollMs: 100, graceMs: 200 })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(opened).toEqual([])
    expect(sessionStorage.getItem('hc:pending-meet')).toBeNull()
  })

  it('a stash that is no link is let go, and nothing opens', async () => {
    const { watchPendingMeet } = await load()
    sessionStorage.setItem('hc:pending-meet', 'onlyroom')
    services.set('@diamondcoreprocessor.com/MeetingInviteWorker', {})
    watchPendingMeet({ pollMs: 100, graceMs: 200 })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(opened).toEqual([])
    expect(sessionStorage.getItem('hc:pending-meet')).toBeNull()
  })

  it('reads only the two credentials, from old links and new', async () => {
    const { meetCredentialsOf } = await load()
    expect(meetCredentialsOf('a/b')).toEqual({ room: 'a', secret: 'b' })
    expect(meetCredentialsOf('#meet=a%20b/c/page&relay=x.example')).toEqual({ room: 'a b', secret: 'c' })
    expect(meetCredentialsOf('a')).toBeNull()
    expect(meetCredentialsOf('a%2Fb/c')).toBeNull()
    expect(meetCredentialsOf('%E0%A4%A/c')).toBeNull()
  })
})
