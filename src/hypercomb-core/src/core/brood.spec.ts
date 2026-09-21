import { describe, expect, it } from 'vitest'
import {
  acceptIntoHive, attachAudit, broodRecord, broodRoster, forgetInBrood,
  holdInBrood, mayRunBee, refuseInBrood,
} from './brood.js'

const sig = (c: string): string => c.repeat(64)

describe('the brood — unverified automatons, held and inert', () => {
  it('anything never held runs as before: the brood is a gate, not the only one', async () => {
    expect(await mayRunBee(sig('1'))).toBe(true)
  })

  it('held and unruled never runs', async () => {
    const s = sig('2')
    await holdInBrood(s, { zone: 'stranger.example' }, 'stranger-bee')
    expect(await mayRunBee(s)).toBe(false)
  })

  it('AN AUDIT CAN NEVER LET CODE RUN, however it reads', async () => {
    const s = sig('3')
    await holdInBrood(s)
    const after = await attachAudit(s, { by: 'jev', summary: 'looks entirely benign', recommends: 'accept', scores: { accept_fit: 1 } })
    expect(after?.audits).toHaveLength(1)
    expect(after?.ruling).toBeUndefined()
    expect(await mayRunBee(s)).toBe(false)
  })

  it('accepting needs two distinct warnings shown, and only then runs', async () => {
    const s = sig('4')
    await holdInBrood(s)
    await expect(acceptIntoHive(s, ['not-safe'])).rejects.toThrow(/two distinct warnings/)
    await expect(acceptIntoHive(s, ['not-safe', 'not-safe'])).rejects.toThrow(/two distinct warnings/)
    expect(await mayRunBee(s)).toBe(false)
    const ruled = await acceptIntoHive(s, ['not-safe', 'audit-is-not-approval'])
    expect(ruled?.ruling?.verdict).toBe('accepted')
    expect(ruled?.ruling?.warnings).toEqual(['not-safe', 'audit-is-not-approval'])
    expect(await mayRunBee(s)).toBe(true)
  })

  it('cannot accept what was never held', async () => {
    expect(await acceptIntoHive(sig('5'), ['one', 'two'])).toBeNull()
    expect(await mayRunBee(sig('5'))).toBe(true)
  })

  it('a refusal stands, and re-arrival does not clear it', async () => {
    const s = sig('6')
    await holdInBrood(s, { zone: 'first.example' })
    await refuseInBrood(s)
    await holdInBrood(s, { zone: 'second.example' })
    const record = await broodRecord(s)
    expect(record?.ruling?.verdict).toBe('refused')
    expect(record?.source.zone).toBe('first.example')
    expect(await mayRunBee(s)).toBe(false)
  })

  it('audits accumulate — a reading never replaces an earlier one', async () => {
    const s = sig('7')
    await holdInBrood(s)
    await attachAudit(s, { by: 'agent', summary: 'reads storage', recommends: 'refuse' })
    const after = await attachAudit(s, { by: 'jev', summary: 'scored', recommends: 'unclear' })
    expect(after?.audits.map(a => a.by)).toEqual(['agent', 'jev'])
  })

  it('the roster lists what is held, newest first', async () => {
    const early = sig('8')
    const late = sig('9')
    await holdInBrood(early)
    await new Promise(resolve => setTimeout(resolve, 2))
    await holdInBrood(late)
    const roster = await broodRoster()
    const held = roster.filter(r => r.sig === early || r.sig === late)
    expect(held.map(r => r.sig)).toEqual([late, early])
    await forgetInBrood(early)
    await forgetInBrood(late)
  })

  it('ignores anything that is not a signature', async () => {
    expect(await holdInBrood('not-a-sig')).toBeNull()
    expect(await mayRunBee('not-a-sig')).toBe(true)
  })
})
