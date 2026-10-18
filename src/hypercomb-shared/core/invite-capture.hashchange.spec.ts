// core/invite-capture.hashchange.spec.ts — A MEETING LINK OPENED IN A TAB
// ALREADY ON THE HIVE IS TAKEN (MS3).
//
// Only the fragment differs, so the browser navigates within the page: no
// load, and a capture that ran once at import never saw the link — it was
// ignored, and its secret and access code stayed in the address bar
// (hunt repro hashnav.cjs: pending-meet null, no sheet, href still holding
// '#meet=…&code=…'). Its own file: the capture listens on this window once.

import { describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const LINK = 'room-new/secretNEW&relay=ws%3A%2F%2F127.0.0.1%3A7914&code=NEWCODE0123456789abcd'
const WORKER_KEY = '@diamondcoreprocessor.com/MeetingInviteWorker'
const services = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = { get: (k: string) => services.get(k) }

window.history.replaceState(null, '', '/')
const { watchPendingMeet } = await import('./invite-capture')

const pending: unknown[] = []
EffectBus.on('meet:pending', (p) => { if (p) pending.push(p) })
// The update door rides a toast; the Packages window itself never opens from
// the shell's watch — only from the guest's tap on Update.
const offered: unknown[] = []
EffectBus.on<{ actionEffect?: string }>('toast:show', (p) => { if (p?.actionEffect === 'packages:open') offered.push(p) })
const opened: unknown[] = []
EffectBus.on('packages:open', (p) => { if (p) opened.push(p) })

describe('a link arriving by a same-document navigation', () => {
  it('an older package (its worker read the stash once, at boot): the shell watches again and answers it', async () => {
    vi.useFakeTimers()
    try {
      services.set(WORKER_KEY, {})
      watchPendingMeet({ pollMs: 50, graceMs: 200 }) // the boot watch: nothing to answer
      window.location.hash = '#meet=' + LINK
      await vi.advanceTimersByTimeAsync(500)
      expect(sessionStorage.getItem('hc:pending-meet')).toBe(LINK)
      expect(offered).toHaveLength(1) // it names a meeting point: the update door, never silence
      expect(opened).toEqual([]) // offered on the toast, not opened for the guest
    } finally { vi.useRealTimers() }
  })

  it('a current package: stashed, stripped from the address bar, and the worker is told', async () => {
    services.set(WORKER_KEY, { meetLinks: 2 })
    sessionStorage.clear()
    const before = pending.length
    window.location.hash = '#meet=' + LINK
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(sessionStorage.getItem('hc:pending-meet')).toBe(LINK)
    expect(window.location.href).not.toContain('secretNEW')
    expect(window.location.href).not.toContain('NEWCODE')
    expect(pending).toHaveLength(before + 1)
    expect(offered).toHaveLength(1) // the current worker answers it; the shell stands aside
    expect(opened).toEqual([])
  })

  it('any other fragment is left alone', async () => {
    sessionStorage.clear()
    const before = pending.length
    window.location.hash = '#(a,b)'
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(sessionStorage.getItem('hc:pending-meet')).toBeNull()
    expect(window.location.hash).toBe('#(a,b)')
    expect(pending).toHaveLength(before)
  })
})
