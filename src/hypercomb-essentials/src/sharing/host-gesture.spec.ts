// sharing/host-gesture.spec.ts — a publish that waits on consent says so,
// and a declined one says nothing was published. Consent stays a person's:
// nothing publishes without `confirmed: true`.
//
// 2026-10-23: `publish here` on a tile that opens as its website waited on a
// dialog the site hid, and a decline returned without a word — the session
// that asked heard nothing for hours.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const publishBranch = vi.fn(async (_segments: readonly string[], _options?: unknown) => ({ ok: false, failure: 'no-host', reason: 'test' }))
vi.mock('./publish-branch.js', () => ({ publishBranch }))
vi.mock('./deliver-link.js', () => ({ deliverLink: async () => 'copied' }))
;(window as unknown as { ioc: unknown }).ioc = { get: () => undefined, register: () => undefined }

const { hostCurrentBranch } = await import('./host-gesture.js')

let said: string[] = []
let asked: { message?: string; messageParams?: Record<string, string> }[] = []
let answer = false
beforeEach(() => {
  said = []
  asked = []
  publishBranch.mockClear()
})
EffectBus.on<{ message: string }>('activity:log', p => { said.push(p.message) })
EffectBus.on<{ id: string; message?: string; messageParams?: Record<string, string> }>('confirm:request', req => {
  asked.push(req)
  queueMicrotask(() => EffectBus.emit('confirm:response', { id: req.id, confirmed: answer }))
})

describe('the publish gesture', () => {
  it('says it waits for consent before asking, and a decline publishes nothing and says so', async () => {
    answer = false
    await hostCurrentBranch(['hyperdex'])
    expect(said[0]).toBe('waiting for your consent to publish /hyperdex')
    expect(said).toContain('Not published: /hyperdex was not allowed.')
    expect(publishBranch).not.toHaveBeenCalled()
  })

  it('publishes only after consent is given', async () => {
    answer = true
    await hostCurrentBranch(['colony'])
    expect(said[0]).toBe('waiting for your consent to publish /colony')
    expect(publishBranch).toHaveBeenCalledTimes(1)
    expect(publishBranch.mock.calls[0]![0]).toEqual(['colony'])
  })

  // jwize, 2026-10-25: "the prompt should tell you where it is publishing to".
  it('names the address it is publishing to in the consent', async () => {
    answer = false
    await hostCurrentBranch(['work', 'meetups'], { 'hypercomb.com': 'meetups.hypercomb.com' })
    expect(asked.at(-1)?.message).toBe('host.confirm.message-where')
    expect(asked.at(-1)?.messageParams).toEqual({ name: 'meetups', where: 'meetups.hypercomb.com' })
  })

  it('says whether it published', async () => {
    answer = false
    expect(await hostCurrentBranch(['hyperdex'])).toBe(false)
  })
})
