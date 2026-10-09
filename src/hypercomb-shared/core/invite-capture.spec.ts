// core/invite-capture.spec.ts — the meeting link is captured before anything
// can read the hash, and the secret leaves the address bar at once.
//
// `#meet=room/secret/page` rides in the fragment (no server sees it). The
// shell stashes it VERBATIM for MeetingInviteWorker — sessionStorage, so a
// first visit that installs and reloads still joins — and strips it.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const load = async (): Promise<void> => {
  vi.resetModules()
  await import('./invite-capture')
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
})
