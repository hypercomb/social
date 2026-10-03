// workflow/workflow-peer-step.spec.ts — a peer's workflow step is judged as a
// stranger's words.
//
// The workflow runner runs each step "as if you had typed them". For the
// participant's own workflow that is exactly right — their words, their Run.
// But steps are tiles, and a branch adopted from a peer carries the PEER's
// tiles: words someone else chose, run unattended, past the gate every other
// machine door asks (the surface audit's "no single seam"). Such a step is
// now judged as a model's line is — declaration, grant, ceiling, the
// behaviour's own refuse — and the participant's own steps are not.

import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MACHINE_GRANT, MACHINE_GRANT_KEY, MACHINE_ROSTER_KEY, grantedVerbOf, writeMachineRoster, writeMachineGrant } from '@hypercomb/core'

;(window as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {}, list: () => [] }

const { peerStepRefusal } = await import('./workflow-runner.drone.js')
const { markAdoptedRoot, markCarriedRoot, _resetAdoptedRootsCache } = await import('../sharing/adopted-roots.js')

const create = { name: 'create', machine: { forms: '<name>', example: '/create a', reach: 'additive' as const, scope: 'page' as const } }
const remove = { name: 'remove', machine: { forms: '<tile>', example: '/remove a', reach: 'destructive' as const, scope: 'page' as const } }
const title = {
  name: 'title',
  machine: {
    forms: '<cell> = <text>', example: '/title a = A', reach: 'editing' as const, scope: 'tile' as const,
    refuse: (args: string) => args.trim().endsWith('=') ? "clearing a title is a participant's to do" : undefined,
  },
}
const slash = { entries: () => [create, remove, title, { name: 'files' }] }

beforeEach(() => {
  localStorage.clear()
  _resetAdoptedRootsCache()
  markAdoptedRoot(['from-alice'])
  localStorage.setItem(MACHINE_GRANT_KEY, writeMachineGrant(DEFAULT_MACHINE_GRANT))
  localStorage.setItem(MACHINE_ROSTER_KEY, writeMachineRoster([create, remove, title].map(grantedVerbOf)))
})

describe("the participant's own workflow", () => {
  it('runs as their words — nothing is asked', () => {
    expect(peerStepRefusal(['mine', 'step-1'], 'remove', 'drafts', slash)).toBeUndefined()
    expect(peerStepRefusal(['mine', 'step-1'], 'files', '', slash)).toBeUndefined()
  })
})

describe("a peer's workflow, adopted", () => {
  const step = ['from-alice', 'chores', 'step-1']

  it('runs a granted verb within the ceiling', () => {
    expect(peerStepRefusal(step, 'create', 'groceries', slash)).toBeUndefined()
  })

  it('refuses what the ceiling refuses', () => {
    expect(peerStepRefusal(step, 'remove', 'drafts', slash))
      .toBe("a peer's step: /remove is destructive, and this hive grants a machine no further than editing")
  })

  it('refuses a verb that never offered itself to machines', () => {
    expect(peerStepRefusal(step, 'files', '', slash)).toBe("a peer's step: /files is not available for model actions")
  })

  it('refuses a verb the participant has not granted', () => {
    localStorage.setItem(MACHINE_ROSTER_KEY, writeMachineRoster([grantedVerbOf(title)]))
    expect(peerStepRefusal(step, 'create', 'groceries', slash))
      .toBe("a peer's step: /create is offered to models but not granted — the participant grants it with /grant allow create")
  })

  it("runs the behaviour's own refuse on the step's arguments", () => {
    expect(peerStepRefusal(step, 'title', 'roadmap =', slash)).toBe("a peer's step: clearing a title is a participant's to do")
    expect(peerStepRefusal(step, 'title', 'roadmap = Road map', slash)).toBeUndefined()
  })
})

describe("a peer's tile the participant carried onto their own page", () => {
  // Cut or copied out of the adopted branch, the record keyed by path stays
  // behind — but the words are still the peer's (adopted-roots.ts
  // isPeerContentAt), so its steps are still judged as a stranger's.
  it("is still judged as a peer's step", () => {
    markCarriedRoot(['mine', 'alices-chores'])
    expect(peerStepRefusal(['mine', 'alices-chores', 'step-1'], 'remove', 'drafts', slash))
      .toBe("a peer's step: /remove is destructive, and this hive grants a machine no further than editing")
    expect(peerStepRefusal(['mine', 'my-chores', 'step-1'], 'remove', 'drafts', slash)).toBeUndefined()
  })
})
