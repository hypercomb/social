// core/machine-admission.spec.ts
//
// THE ONE GATE, ASSERTED WHERE IT LIVES. Two doors read this module — the
// bridge's remote-submit listener and the model channel — and both are Angular
// or shell code the packages under test may not import. So the RULE is pinned
// here, in isolation, and each door's spec pins only that it asks this module
// rather than judging for itself.

import { describe, expect, it } from 'vitest'
import {
  admitMachineCall, primaryEntry, spokenEntry,
  readMachineGrant, writeMachineGrant, DEFAULT_MACHINE_GRANT,
  type AdmissionEntry, type MachineGrant,
} from './machine-admission.js'

const census: readonly AdmissionEntry[] = [
  { name: 'create', machine: { reach: 'additive', scope: 'page' } },
  { name: 'title', machine: { reach: 'editing', scope: 'tile' } },
  { name: 'hide', machine: { reach: 'editing', scope: 'network' } },
  { name: 'remove', aliases: ['rm'], machine: { reach: 'destructive', scope: 'page' } },
  { name: 'cut', machine: { reach: 'destructive', scope: 'hive' } },
  // The majority of the live census: no declaration at all.
  { name: 'files' },
  // Concealed, and declaring anyway — a declaration is not an override.
  { name: 'flatten', hidden: true, machine: { reach: 'destructive', scope: 'hive' } },
  { name: 'workbench', prototype: true, machine: { reach: 'editing', scope: 'tile' } },
  // Declared, but says nothing about how far it travels: the thirteenth verb
  // nobody has traced to its commit yet.
  { name: 'thirteenth', machine: { reach: 'editing' } },
]

const admit = (verb: string, caller: 'operator' | 'model', grant?: MachineGrant) =>
  admitMachineCall(verb, spokenEntry(verb, census), caller, grant)

describe('what separates the two machine callers', () => {
  it('is exactly one bit: whether a declaration is required', () => {
    // /files declares nothing, which is true of ~97 of ~109 behaviours. The
    // bridge is the participant's own tool and must keep reaching them;
    // requiring a declaration there would break the authoring tool this hive is
    // built with, and would not protect anyone who is not present.
    expect(admit('files', 'operator').admit).toBe(true)
    expect(admit('files', 'model')).toEqual({
      admit: false, reason: '/files is not available for model actions',
    })
  })

  it('and nothing else — both are refused a concealed verb', () => {
    // `slashHidden` is documented as "must be typed in full on purpose": a
    // HUMAN-typing assumption a machine defeats for free. /flatten is the verb
    // that once hard-deleted a pool it mistook for a lineage bag.
    for (const caller of ['operator', 'model'] as const) {
      expect(admit('flatten', caller)).toEqual({
        admit: false, reason: '/flatten is not offered to a caller that is not typing it',
      })
      expect(admit('workbench', caller).admit).toBe(false)
    }
  })

  it('and both are held to the same ceiling', () => {
    for (const caller of ['operator', 'model'] as const) {
      expect(admit('remove', caller).admit).toBe(false)
      expect(admit('title', caller).admit).toBe(true)
    }
  })
})

describe('the standing default', () => {
  it('refuses the one thing the audit found alarming, and nothing gentler', () => {
    // Blunt question from the audit: can a model delete a tile unattended? It
    // could — /remove <leaf> ran to a committed layer with no dialog.
    expect(admit('remove', 'model').admit).toBe(false)
    expect(admit('cut', 'model').admit).toBe(false)
    expect(admit('create', 'model').admit).toBe(true)
    expect(admit('title', 'model').admit).toBe(true)
  })

  it('leaves the gentle verb reachable even though it travels furthest', () => {
    // HIDE FIRST, DELETE SECOND. /hide is editing at 'network' — it publishes a
    // signed mesh event — and it is the verb a model should reach for BEFORE
    // /remove. A default that refused 'network' would refuse the safe verb and
    // leave nothing safer in its place, inverting the doctrine at exactly the
    // surface where a machine chooses.
    expect(DEFAULT_MACHINE_GRANT.scope).toBe('network')
    expect(admit('hide', 'model').admit).toBe(true)
  })

  it('says which rule applied, in words a caller can act on', () => {
    expect(admit('remove', 'model')).toEqual({
      admit: false,
      reason: '/remove is destructive, and this hive grants a machine no further than editing',
    })
  })
})

describe('an alias cannot walk around a refusal', () => {
  it('because the door resolves what the participant named', () => {
    // This is precisely how the retired four-name set (`remove, rm, delete,
    // del`) was defeated: a name absent from a list, rather than a verb
    // inheriting the reach it declared.
    expect(spokenEntry('rm', census)?.name).toBe('remove')
    expect(admit('rm', 'operator').admit).toBe(false)
  })

  it('and the model channel resolves primary names ONLY, so none can redirect', () => {
    // Aliases are participant-authored; `executePublicCanonical` exists as a
    // separate seam so one can never point a canonical word elsewhere.
    expect(primaryEntry('rm', census)).toBeUndefined()
    expect(admitMachineCall('rm', primaryEntry('rm', census), 'model')).toEqual({
      admit: false, reason: '/rm is not a behaviour in this hive',
    })
  })
})

describe('the participant tightens it', () => {
  it('and `none` closes the door on every verb', () => {
    const closed: MachineGrant = { reach: 'none', scope: 'network' }
    for (const verb of ['create', 'title', 'hide', 'files']) {
      expect(admit(verb, 'operator', closed).admit).toBe(false)
      expect(admit(verb, 'model', closed).admit).toBe(false)
    }
    expect(admit('create', 'model', closed)).toEqual({
      admit: false,
      reason: 'this hive grants a machine nothing at present, so /create cannot be run from here',
    })
  })

  it('and a narrowed scope refuses on its own axis, independently of reach', () => {
    // /hide is only 'editing' and still leaves the machine. Neither axis can be
    // inferred from the other, which is why there are two.
    const nearby: MachineGrant = { reach: 'destructive', scope: 'page' }
    expect(admit('hide', 'model', nearby)).toEqual({
      admit: false,
      reason: '/hide reaches the network, and this hive keeps a machine within the page',
    })
    expect(admit('remove', 'model', nearby).admit).toBe(true)
  })

  it('and an UNDECLARED scope drops out the moment anything is narrowed', () => {
    // Refusing what has not been judged is the safe direction. At the widest
    // ceiling it rides — the twelve declared values were each traced to their
    // commit and a thirteenth has not been, so narrowing is the moment to stop
    // guessing on its behalf.
    expect(admit('thirteenth', 'model').admit).toBe(true)
    expect(admit('thirteenth', 'model', { reach: 'editing', scope: 'hive' })).toEqual({
      admit: false,
      reason: '/thirteenth has not declared how far it travels, and this hive has narrowed that',
    })
  })
})

describe('a stored grant', () => {
  it('round-trips through the one shape a participant can read', () => {
    const grant: MachineGrant = { reach: 'destructive', scope: 'hive' }
    expect(writeMachineGrant(grant)).toBe('destructive/hive')
    expect(readMachineGrant('destructive/hive')).toEqual(grant)
  })

  it('CANNOT WIDEN BY ACCIDENT — anything unrecognized clamps to the default', () => {
    // A corrupt value must never grant more than an absent one. Every one of
    // these would be a silent widening if the clamp went the other way.
    for (const raw of [undefined, null, '', 'yes', 'all/everything', 'destructive!', '{}']) {
      expect(readMachineGrant(raw)).toEqual(DEFAULT_MACHINE_GRANT)
    }
    // Half a value keeps the default for the half that is missing.
    expect(readMachineGrant('additive/nonsense'))
      .toEqual({ reach: 'additive', scope: DEFAULT_MACHINE_GRANT.scope })
  })
})

describe('nothing here judges the participant', () => {
  it('there is no caller for a person, and a verb with no name is not one', () => {
    // MachineCaller has no 'participant' member on purpose: the day it gains
    // one is the day somebody starts gating the owner of the hive.
    expect(admitMachineCall('', undefined, 'operator')).toEqual({
      admit: false, reason: 'no behaviour was named',
    })
  })
})
