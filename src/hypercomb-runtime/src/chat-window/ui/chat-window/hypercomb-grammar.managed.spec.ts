// hypercomb-grammar.managed.spec.ts — on a managed site door nothing is fenced
// (jwize, 2026-11-13: "The ai should be able to do anything it likes").
//
// The page holds a replica of its owner's card and has no command line, so no
// `/grant allow` could ever reach its roster: every model verb was refused
// ("offered to models but not granted") and the chat could change nothing.
// The chat's grammar door works under the page's grant — the owner's full
// grant there — while every other page reads the participant's own, live,
// exactly as core does.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { forgetManagedPageForTests } from '../../core/managed-page'
import { MACHINE_GRANT_KEY, MACHINE_ROSTER_KEY } from '@hypercomb/core'
import {
  callableBehaviours, hypercombPlanLeaves, hypercombPlanReach, hypercombVocabulary, hypercombWriteRefusal, parseHypercombGrammars,
  type HypercombBehaviour,
} from './hypercomb-grammar'

const entries: readonly HypercombBehaviour[] = [
  { name: 'create', description: 'make a tile', machine: { forms: '<name>', example: '/create roadmap', reach: 'additive', scope: 'page' } },
  { name: 'hide', description: 'hide a tile', machine: { forms: '<tile>', example: '/hide drafts', reach: 'editing', scope: 'network' } },
  { name: 'remove', description: 'remove a tile', machine: { forms: '<tile>', example: '/remove drafts', reach: 'destructive', scope: 'page' } },
  { name: 'secret', hidden: true, machine: { forms: '<tile>', example: '/secret x', reach: 'additive', scope: 'tile' } },
]

const mark = (): void => {
  const script = document.createElement('script')
  script.id = 'hc-manage'
  script.type = 'application/json'
  script.textContent = JSON.stringify({ lineage: 'business-card', title: 'Business card' })
  document.head.appendChild(script)
  forgetManagedPageForTests()
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { document.getElementById('hc-manage')?.remove(); forgetManagedPageForTests(); localStorage.clear() })

describe('every other page', () => {
  it('is unchanged: a fresh hive grants a model no verb until the participant grants it', () => {
    expect(callableBehaviours(entries)).toEqual([])
    expect(hypercombVocabulary(entries)).toBe('')
    expect(() => parseHypercombGrammars(['/create roadmap'], entries))
      .toThrow('/create is offered to models but not granted — the participant grants it with /grant allow create')
  })

  it('reads the participant\'s roster and ceiling live, at every call', () => {
    localStorage.setItem(MACHINE_ROSTER_KEY, JSON.stringify([{ name: 'create', reach: 'additive', scope: 'page', forms: '<name>' }]))
    expect(callableBehaviours(entries).map(entry => entry.name)).toEqual(['create'])
    localStorage.setItem(MACHINE_GRANT_KEY, 'none/network')
    expect(callableBehaviours(entries)).toEqual([])
    expect(hypercombWriteRefusal()).toBe('this hive grants a machine nothing at present, so /write cannot be run from here')
  })

  it('still lets a caller hand in a grant of its own', () => {
    expect(callableBehaviours(entries, { reach: 'editing', scope: 'network' }).map(entry => entry.name)).toEqual(['create', 'hide'])
  })
})

describe('a managed site door', () => {
  beforeEach(mark)

  it('offers every verb that changes the replica, with no roster and no grant asked — destructive ones too — and none that leaves it', () => {
    // jwize: "AI can't publish on the community but it can make changes" — /hide is a signed mesh event (network).
    expect(callableBehaviours(entries).map(entry => entry.name)).toEqual(['create', 'remove'])
    const taught = hypercombVocabulary(entries)
    expect(taught).toContain('/create <name>')
    expect(taught).toContain('/remove <tile>')
  })

  it('runs a model\'s lines that no one granted, and weighs them as they are', () => {
    const plan = parseHypercombGrammars(['/create roadmap', '/remove old'], entries)
    expect(plan.actions.map(action => action.command)).toEqual(['create', 'remove'])
    expect(hypercombPlanReach(plan, entries)).toBe('destructive')
    expect(hypercombPlanLeaves(plan, entries)).toEqual([])
  })

  it('refuses a line that would leave the replica for the community', () => {
    expect(() => parseHypercombGrammars(['/hide drafts'], entries)).toThrow(/reaches the network/)
  })

  it('never refuses a write, whatever this browser\'s stored ceiling says', () => {
    localStorage.setItem(MACHINE_GRANT_KEY, 'none/local')
    expect(hypercombWriteRefusal()).toBeUndefined()
    expect(callableBehaviours(entries).map(entry => entry.name)).toEqual(['create', 'remove'])
  })

  it('still refuses what is no behaviour at all: a concealed verb, or a word with no machine form', () => {
    expect(() => parseHypercombGrammars(['/secret x'], entries)).toThrow('/secret is not offered to a caller that is not typing it')
    expect(() => parseHypercombGrammars(['/nothing x'], entries)).toThrow('/nothing is not a behaviour in this hive')
  })
})
