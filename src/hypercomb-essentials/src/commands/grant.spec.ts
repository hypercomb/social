// commands/grant.spec.ts
//
// THE PARTICIPANT'S SWITCH. The gate's rule is asserted in core
// (machine-admission.spec.ts); what is asserted here is that a person can
// actually reach it, and that the word cannot be used to widen itself.

import { describe, expect, it, beforeEach } from 'vitest'
import { DEFAULT_MACHINE_GRANT, currentMachineGrant, MACHINE_GRANT_KEY } from '@hypercomb/core'

const registrations = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (key: string, value: unknown) => registrations.set(key, value),
    get: (key: string) => registrations.get(key),
  },
}

const { GrantQueenBee, readGrant } = await import('./grant.queen.js')

describe('reading a grant line', () => {
  it('says SHOW when nothing was named — asking is not setting', () => {
    expect(readGrant('', DEFAULT_MACHINE_GRANT)).toEqual({ show: true })
    expect(readGrant('   ', DEFAULT_MACHINE_GRANT)).toEqual({ show: true })
  })

  it('moves one axis at a time, and leaves the other where it was', () => {
    // The two ladders share no value, so a single word is never ambiguous
    // about which axis it names.
    expect(readGrant('destructive', DEFAULT_MACHINE_GRANT))
      .toEqual({ grant: { reach: 'destructive', scope: DEFAULT_MACHINE_GRANT.scope } })
    expect(readGrant('page', DEFAULT_MACHINE_GRANT))
      .toEqual({ grant: { reach: DEFAULT_MACHINE_GRANT.reach, scope: 'page' } })
  })

  it('takes both rungs in one line, in either order and either separator', () => {
    const both = { grant: { reach: 'additive' as const, scope: 'tile' as const } }
    expect(readGrant('additive tile', DEFAULT_MACHINE_GRANT)).toEqual(both)
    expect(readGrant('tile additive', DEFAULT_MACHINE_GRANT)).toEqual(both)
    expect(readGrant('additive/tile', DEFAULT_MACHINE_GRANT)).toEqual(both)
  })

  it('REFUSES A WORD IT DOES NOT KNOW rather than ignoring it', () => {
    // Silently dropping an unrecognized word is how a participant ends up
    // believing they narrowed something they did not. `/grant readonly` must
    // not quietly leave the ceiling where it was and report success.
    const refusal = readGrant('readonly', DEFAULT_MACHINE_GRANT)
    expect('refuse' in refusal).toBe(true)
    expect((refusal as { refuse: string }).refuse).toContain('readonly')
  })

  it('and refuses the whole line when any word in it is unknown', () => {
    expect('refuse' in readGrant('additive sideways', DEFAULT_MACHINE_GRANT)).toBe(true)
  })

  it('offers `none` as the off switch, on the reach ladder', () => {
    expect(readGrant('none', DEFAULT_MACHINE_GRANT))
      .toEqual({ grant: { reach: 'none', scope: DEFAULT_MACHINE_GRANT.scope } })
  })
})

describe('the word itself', () => {
  beforeEach(() => localStorage.removeItem(MACHINE_GRANT_KEY))

  it('IS NOT MACHINE-CALLABLE, and here that absence is the security property', () => {
    // A ceiling a model can raise is not a ceiling. Every other queen's missing
    // `machine` block is an author who has not got to it yet; this one is a
    // decision, which is why it is asserted rather than left to be noticed.
    expect(new GrantQueenBee().machine).toBeUndefined()
  })

  it('completes from the same ladders the gate compares against', () => {
    const bee = new GrantQueenBee()
    expect(bee.slashComplete('')).toContain('destructive')
    expect(bee.slashComplete('')).toContain('none')
    expect(bee.slashComplete('n')).toEqual(['none', 'network'])
  })

  it('writes a ceiling the gate then reads back', async () => {
    const bee = new GrantQueenBee()
    await (bee as unknown as { execute(a: string): Promise<void> }).execute('none')
    expect(currentMachineGrant()).toEqual({ reach: 'none', scope: DEFAULT_MACHINE_GRANT.scope })
    await (bee as unknown as { execute(a: string): Promise<void> }).execute('destructive hive')
    expect(currentMachineGrant()).toEqual({ reach: 'destructive', scope: 'hive' })
  })

  it('leaves the ceiling untouched when the line is refused', async () => {
    localStorage.setItem(MACHINE_GRANT_KEY, 'additive/tile')
    const bee = new GrantQueenBee()
    await (bee as unknown as { execute(a: string): Promise<void> }).execute('readonly')
    expect(currentMachineGrant()).toEqual({ reach: 'additive', scope: 'tile' })
  })
})
