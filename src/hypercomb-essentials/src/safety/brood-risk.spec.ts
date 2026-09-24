// brood-risk.spec.ts — the level code composes from what the brood already
// knows: the scan's reaches, each reader's recommendation, a community's
// refusal. It can never say more than they did.
import { describe, expect, it } from 'vitest'
import type { BroodRecord } from '@hypercomb/core'
import { riskLine, riskOf } from './brood-risk.js'

const record = (over: Partial<BroodRecord> = {}): BroodRecord => ({
  sig: 'a'.repeat(64), kind: 'bee', arrived: 1, source: { kind: 'stranger' }, audits: [], vouches: [], ...over,
})

describe('a risk level, and why', () => {
  it('nothing read and nothing scanned is unread', () => {
    expect(riskOf(record())).toEqual({ level: 'unread', reasons: ['nothing has read it yet'] })
  })

  it('a clean scan alone is still unread — the scan is not a reader', () => {
    const risk = riskOf(record({ audits: [{ at: 1, by: 'scan', summary: 'it reaches nothing the scan looks for', reaches: [] }] }))
    expect(risk.level).toBe('unread')
  })

  it('reaching secrets, text run as code or disguise is high, whoever reads it', () => {
    const scanned = record({ audits: [
      { at: 1, by: 'scan', summary: '', reaches: ['network', 'secrets'] },
      { at: 2, by: 'test-model', summary: 'Harmless.', recommends: 'accept' },
    ] })
    const risk = riskOf(scanned)
    expect(risk.level).toBe('high')
    expect(risk.reasons).toEqual(['it reaches secrets and keys', 'it reaches the network'])
  })

  it('a draft the door held for a grave reach is high too', () => {
    expect(riskOf(record({ flags: [{ at: 1, by: 'scan', reason: 'x', reaches: ['eval'] }] })).level).toBe('high')
  })

  it('any refusal is high: a reader, JEV holding it, or a community you follow', () => {
    expect(riskOf(record({ audits: [{ at: 1, by: 'test-model', summary: '', recommends: 'refuse' }] })).reasons)
      .toEqual(['test-model recommends refusing it'])
    expect(riskOf(record({ flags: [{ at: 1, by: 'jev', reason: 'posts it offsite' }] })).reasons)
      .toEqual(['JEV recommends refusing it'])
    expect(riskOf(record({ vouches: [{ by: 'b'.repeat(64), verdict: 'refused', at: 1 }] })).level).toBe('high')
  })

  it('the network, stored data or a way out, or an unclear reading, is medium', () => {
    expect(riskOf(record({ flags: [{ at: 1, by: 'scan', reason: 'x', reaches: ['network'] }] }))).toEqual({
      level: 'medium', reasons: ['it reaches the network'],
    })
    expect(riskOf(record({ audits: [{ at: 1, by: 'm', summary: '', recommends: 'unclear' }] })).reasons)
      .toEqual(['a reader could not tell'])
  })

  it('read, accepted and reaching nothing is low', () => {
    const risk = riskOf(record({ audits: [
      { at: 1, by: 'scan', summary: '', reaches: [] },
      { at: 2, by: 'jev', summary: 'Renames a room.', recommends: 'accept' },
    ] }))
    expect(risk).toEqual({ level: 'low', reasons: ['JEV read it and found nothing of concern'] })
    expect(riskLine(risk)).toBe('Low — JEV read it and found nothing of concern')
  })
})
