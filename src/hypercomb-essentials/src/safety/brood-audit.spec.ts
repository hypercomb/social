import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptIntoHive, broodRecord, holdInBrood, mayRunBee } from '@hypercomb/core'

const sig = (c: string): string => c.repeat(64)

const callModel = vi.fn()
vi.mock('../assistant/llm-dispatch.js', () => ({ callModel: (call: unknown) => callModel(call) }))

const { auditHeldBee, AUDIT_SYSTEM } = await import('./brood-audit.js')

type Ioc = { get: (key: string) => unknown }

const hive = (options: { code?: string; jev?: unknown } = {}): void => {
  const store = {
    getBeeBytes: async () => new TextEncoder().encode(options.code ?? 'export const bee = 1'),
    putResource: async () => sig('f'),
  }
  ;(globalThis as { ioc?: Ioc }).ioc = {
    get: (key: string) => key === '@hypercomb.social/Store' ? store
      : key === '@hypercomb.social/JevDecision' ? options.jev
      : undefined,
  }
}

describe('auditing held code', () => {
  beforeEach(() => {
    callModel.mockReset()
    callModel.mockResolvedValue({ text: 'Reads localStorage and posts it offsite.\nRECOMMENDS: refuse', model: 'test-model', providerId: 'openrouter:test' })
  })

  it('records the reading and still leaves the code unable to run', async () => {
    const s = sig('a')
    await holdInBrood(s, { zone: 'stranger.example' })
    const after = await auditHeldBee(s)
    expect(after?.audits.at(-1)?.recommends).toBe('refuse')
    expect(after?.audits.at(-1)?.summary).toContain('Reads localStorage')
    expect(after?.ruling).toBeUndefined()
    expect(await mayRunBee(s)).toBe(false)
  })

  it('AN AUDIT THAT SAYS ACCEPT STILL DOES NOT ACCEPT', async () => {
    const s = sig('b')
    await holdInBrood(s)
    callModel.mockResolvedValue({ text: 'Harmless.\nRECOMMENDS: accept', model: 'test-model', providerId: 'openrouter:test' })
    await auditHeldBee(s)
    expect(await mayRunBee(s)).toBe(false)
    expect((await broodRecord(s))?.ruling).toBeUndefined()
    // Only the hand, with its two warnings, opens the door.
    await acceptIntoHive(s, ['not-safe', 'audit-is-not-approval'])
    expect(await mayRunBee(s)).toBe(true)
  })

  it('sends the code as fenced data, and says so in the system turn', async () => {
    const s = sig('c')
    await holdInBrood(s)
    await auditHeldBee(s)
    const call = callModel.mock.calls[0]?.[0] as { system: string; messages: { content: string }[] }
    expect(call.system).toBe(AUDIT_SYSTEM)
    expect(call.system).toMatch(/DATA/)
    expect(call.messages[0]?.content).toMatch(/<held-code signature="[0-9a-f]{64}">/)
  })

  it('lets JEV score the same material, and takes its verdict as a score only', async () => {
    const s = sig('d')
    await holdInBrood(s)
    const evaluate = vi.fn().mockResolvedValue({
      outcome: 'selected', selected: 'accept', rejected: [], reason: 'ok', model: 'jev',
      answers: { accept_fit: { type: 'noul', noul: 0.91 } },
    })
    hive({ jev: { ready: () => true, evaluate } })
    const after = await auditHeldBee(s)
    expect(evaluate).toHaveBeenCalled()
    expect(after?.audits.at(-1)?.scores).toEqual({ accept_fit: 0.91 })
    expect(after?.audits.at(-1)?.recommends).toBe('accept')
    expect(await mayRunBee(s)).toBe(false)
  })

  it('stands on the agent reading alone when JEV is not available', async () => {
    const s = sig('e')
    await holdInBrood(s)
    hive({ jev: { ready: () => false, evaluate: vi.fn() } })
    const after = await auditHeldBee(s)
    expect(after?.audits.at(-1)?.scores).toBeUndefined()
    expect(after?.audits.at(-1)?.by).toBe('test-model')
  })

  it('refuses to read what is not held', async () => {
    await expect(auditHeldBee(sig('9'))).rejects.toThrow(/nothing is held/)
    expect(callModel).not.toHaveBeenCalled()
  })
})

beforeEach(() => { if (!(globalThis as { ioc?: Ioc }).ioc) hive() })
hive()
