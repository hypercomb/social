// brood-flags.spec.ts — the draft audit's hold: a scan or a reader can put
// code in the brood for a reason, and only the hand lets it run.

import { describe, expect, it } from 'vitest'
import { acceptIntoHive, attachAudit, broodRecord, flagInBrood, holdInBrood, mayRunBee, refuseInBrood } from './brood.js'

const sig = (c: string): string => c.repeat(64)

describe('a flag holds, and only a hand releases', () => {
  it('your own code runs by the rules until something flags it', async () => {
    const s = sig('a')
    await holdInBrood(s, { kind: 'own', how: 'a draft' }, 'src/games/solomon/labyrinth.ts')
    expect(await mayRunBee(s)).toBe(true)
    await flagInBrood(s, { by: 'scan', reason: 'it newly reaches the network', reaches: ['network'] })
    expect(await mayRunBee(s)).toBe(false)
  })

  it('records code it has never seen as your own, held for the reason given', async () => {
    const s = sig('b')
    const record = await flagInBrood(s, { by: 'scan', reason: 'it newly reaches stored data', reaches: ['storage'] })
    expect(record.source.kind).toBe('own')
    expect(record.flags?.[0]).toMatchObject({ by: 'scan', reason: 'it newly reaches stored data', reaches: ['storage'] })
    expect(await mayRunBee(s)).toBe(false)
  })

  it('a reading never clears a flag', async () => {
    const s = sig('c')
    await flagInBrood(s, { by: 'jev', reason: 'posts the hive offsite' })
    await attachAudit(s, { by: 'test-model', summary: 'Harmless.', recommends: 'accept' })
    expect((await broodRecord(s))?.flags).toHaveLength(1)
    expect(await mayRunBee(s)).toBe(false)
  })

  it('the hand outranks every flag, either way', async () => {
    const accepted = sig('d')
    await flagInBrood(accepted, { by: 'scan', reason: 'it newly reaches the network' })
    await acceptIntoHive(accepted, ['not-safe', 'audit-is-not-approval'])
    expect(await mayRunBee(accepted)).toBe(true)
    // A later flag on bytes you accepted by hand does not overrule you.
    await flagInBrood(accepted, { by: 'jev', reason: 'second thoughts' })
    expect(await mayRunBee(accepted)).toBe(true)

    const refused = sig('e')
    await holdInBrood(refused, { kind: 'own' })
    await refuseInBrood(refused)
    expect(await mayRunBee(refused)).toBe(false)
  })

  it('refuses a flag that names no signature', async () => {
    await expect(flagInBrood('not-a-sig', { by: 'scan', reason: 'x' })).rejects.toThrow(/signature/)
  })
})
