// sharing/meeting-invite.worker.spec.ts — A RELOAD AT THE SHEET KEEPS THE LINK.
//
// The shell strips `#meet=` from the address bar at boot and stashes it in
// sessionStorage; the stash is the only copy. The worker used to drain it
// BEFORE the sheet was answered, so a reload while the sheet was up — by the
// guest, or by the package floor's own reload — lost the invitation with no
// word. Now it is cleared only once the join has settled, on every exit.

import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const services = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (k: string, v: unknown) => { services.set(k, v) },
  get: (k: string) => services.get(k),
  whenReady: () => undefined,
}

const cred = (v = '') => ({ value: v, set(n: string) { this.value = String(n ?? '').trim() } })
const room = cred('')
const secret = cred('')
services.set('@hypercomb.social/Store', { getResource: async () => null })
services.set('@hypercomb.social/RoomStore', room)
services.set('@hypercomb.social/SecretStore', secret)
services.set('@hypercomb.social/Navigation', { go: () => {}, goRaw: () => {}, segments: () => [] })

const requests: { id: string; message: string }[] = []
EffectBus.on<{ id: string; message: string }>('confirm:request', (r) => {
  if (r?.id && !requests.some(q => q.id === r.id)) requests.push(r)
})
const answer = (confirmed: boolean): void => {
  const r = requests.at(-1)!
  EffectBus.emit('confirm:response', { id: r.id, confirmed })
}

const { MeetingInviteWorker } = await import('./meeting-invite.worker.js')

const KEY = 'hc:pending-meet'
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)) }

/** A fresh worker — one boot of the tab — pulsed once. */
const boot = async (): Promise<void> => {
  const w = new MeetingInviteWorker() as unknown as { pulse: (g: string) => Promise<void> }
  await w.pulse('')
  await settle()
}

beforeEach(() => {
  sessionStorage.clear()
  requests.length = 0
  room.value = ''
  secret.value = ''
  EffectBus.emit('mesh:public-changed', { public: false })
})

describe('the meeting link waits for its answer', () => {
  it('a reload while the sheet is up asks again — the stash is still there', async () => {
    sessionStorage.setItem(KEY, 'probe-room/probe-secret/cafe')
    await boot()
    expect(requests).toHaveLength(1)
    expect(requests[0].message).toContain('probe-room')
    expect(sessionStorage.getItem(KEY)).toBe('probe-room/probe-secret/cafe')
    expect(room.value).toBe('')

    await boot() // the reload
    expect(requests).toHaveLength(2)
    expect(requests[1].message).toContain('probe-room')
  })

  it('Not now is an answer: the stash goes, and nothing is written', async () => {
    sessionStorage.setItem(KEY, 'probe-room/probe-secret')
    await boot()
    answer(false)
    await settle()
    expect(sessionStorage.getItem(KEY)).toBeNull()
    expect(room.value).toBe('')
    await boot()
    expect(requests).toHaveLength(1)
  })

  it('Join is an answer: the stash goes once the join has landed', async () => {
    sessionStorage.setItem(KEY, 'probe-room/probe-secret')
    await boot()
    answer(true)
    await settle()
    expect(room.value).toBe('probe-room')
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('already here is an answer too — a re-opened link is not re-processed on every reload', async () => {
    room.value = 'probe-room'
    secret.value = 'probe-secret'
    EffectBus.emit('mesh:public-changed', { public: true })
    sessionStorage.setItem(KEY, 'probe-room/probe-secret')
    await boot()
    expect(requests).toHaveLength(0)
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('a link that is no link is dropped at once, and asks nothing', async () => {
    sessionStorage.setItem(KEY, 'onlyroom')
    await boot()
    expect(requests).toHaveLength(0)
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('tells the shell it keeps the link (the shell\'s own fallback then stands aside)', () => {
    expect((new MeetingInviteWorker() as unknown as { meetLinks: number }).meetLinks).toBeGreaterThanOrEqual(2)
  })
})
