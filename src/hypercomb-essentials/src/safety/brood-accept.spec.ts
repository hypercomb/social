// The door: two warnings, both dismissed, or the code stays held.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus, forgetInBrood, holdInBrood, mayRunBee, type ConfirmRequest } from '@hypercomb/core'
import { acceptByHand, auditLine, broodLabel, refuseByHand } from './brood-accept.js'

const sig = (c: string): string => c.repeat(64)

/** Answer the confirmation dialogs the way a participant would. */
const answering = (answers: readonly boolean[]): { asked: ConfirmRequest[]; off: () => void } => {
  const asked: ConfirmRequest[] = []
  // EffectBus replays its last value SYNCHRONOUSLY on subscribe, so a
  // subscriber set up here is handed the PREVIOUS test's dialog before this
  // one has asked anything. Only what arrives after the subscription counts.
  // (requestConfirm itself is immune: it matches responses by id.)
  let live = false
  const off = EffectBus.on<ConfirmRequest>('confirm:request', request => {
    if (!live) return
    asked.push(request)
    const confirmed = answers[asked.length - 1] ?? false
    queueMicrotask(() => EffectBus.emit('confirm:response', { id: request.id, confirmed }))
  })
  live = true
  return { asked, off }
}

const held = async (c: string) => {
  const s = sig(c)
  await forgetInBrood(s)
  return (await holdInBrood(s, { zone: 'stranger.example', kind: 'stranger' }, 'stranger-bee'))!
}

describe('accepting held code by hand', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('asks twice, and both warnings must be dismissed before it may run', async () => {
    const record = await held('1')
    const { asked, off } = answering([true, true])
    const ruled = await acceptByHand(record)
    off()
    expect(asked).toHaveLength(2)
    expect(ruled?.ruling?.verdict).toBe('accepted')
    expect(ruled?.ruling?.warnings).toEqual(['not-safe', 'audit-is-not-approval'])
    expect(await mayRunBee(record.sig)).toBe(true)
  })

  it('stopping at the FIRST warning leaves it held and writes nothing', async () => {
    const record = await held('2')
    const { asked, off } = answering([false])
    expect(await acceptByHand(record)).toBeNull()
    off()
    expect(asked).toHaveLength(1)
    expect(await mayRunBee(record.sig)).toBe(false)
  })

  it('stopping at the SECOND warning leaves it held — the first click is not enough', async () => {
    const record = await held('3')
    const { asked, off } = answering([true, false])
    expect(await acceptByHand(record)).toBeNull()
    off()
    expect(asked).toHaveLength(2)
    expect(await mayRunBee(record.sig)).toBe(false)
  })

  it('both dialogs are marked dangerous and say different true things', async () => {
    const record = await held('4')
    const { asked, off } = answering([true, true])
    await acceptByHand(record)
    off()
    expect(asked.every(request => request.danger)).toBe(true)
    expect(asked[0]?.title).not.toBe(asked[1]?.title)
    // The second exists precisely to say a clean audit is not an approval.
    expect(`${asked[1]?.title} ${asked[1]?.message}`.toLowerCase()).toContain('approval')
  })

  it('refusing takes no ceremony and is the safe direction', async () => {
    const record = await held('5')
    const { asked, off } = answering([])
    const ruled = await refuseByHand(record)
    off()
    expect(asked).toHaveLength(0)
    expect(ruled?.ruling?.verdict).toBe('refused')
    expect(await mayRunBee(record.sig)).toBe(false)
  })

  it('names what it can and says plainly when nothing has read the code', async () => {
    const record = await held('6')
    expect(broodLabel(record)).toBe('stranger-bee')
    expect(auditLine(record)).toMatch(/nothing has read this code/i)
  })
})

describe('a ruling is said aloud', () => {
  it('says brood:ruled when a hand accepts or refuses, and nothing when it stops', async () => {
    const heard: { sig: string; verdict: string }[] = []
    let live = false
    const off = EffectBus.on<{ sig: string; verdict: string }>('brood:ruled', ruled => { if (live) heard.push({ sig: ruled.sig, verdict: ruled.verdict }) })
    live = true
    const stopped = await held('7')
    const first = answering([false])
    await acceptByHand(stopped)
    first.off()
    expect(heard).toEqual([])
    const accepted = await held('8')
    const both = answering([true, true])
    await acceptByHand(accepted)
    both.off()
    await refuseByHand(await held('9'))
    off()
    expect(heard).toEqual([{ sig: sig('8'), verdict: 'accepted' }, { sig: sig('9'), verdict: 'refused' }])
  })
})
