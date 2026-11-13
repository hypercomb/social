// ui/chat-window/hypercomb-grammar.leaves.spec.ts — which lines of a model's
// plan leave the machine.
//
// Inside the participant's own domain a change runs; a line that carries
// their key outward — `scope: 'network'`, or a scope never declared — waits
// for their hand (execution-queue.ts, `leaves`). Unjudged is the far end,
// never home.

import { describe, expect, it } from 'vitest'
import type { MachineGrant } from '@hypercomb/core'
import { hypercombLinesBeyondPages, hypercombPlanLeaves, parseHypercombGrammars, type HypercombBehaviour } from './hypercomb-grammar'

const ANY: MachineGrant = { reach: 'destructive', scope: 'network' }

const entries: readonly HypercombBehaviour[] = [
  { name: 'create', machine: { forms: '<name>', example: '/create roadmap', reach: 'additive', scope: 'page' } },
  { name: 'title', machine: { forms: '<tile> = <title>', example: '/title a = b', reach: 'editing', scope: 'tile' } },
  { name: 'hide', machine: { forms: '<tile>', example: '/hide drafts', reach: 'editing', scope: 'network' } },
  { name: 'unjudged', machine: { forms: '<tile>', example: '/unjudged drafts', reach: 'editing' } },
]

const leaves = (...lines: string[]): readonly string[] =>
  hypercombPlanLeaves(parseHypercombGrammars(lines, entries, ANY), entries, ANY)

describe('the lines of a plan that leave the machine', () => {
  it('a plan that stays home leaves nothing', () => {
    expect(leaves('/create roadmap', '/title roadmap = Roadmap')).toEqual([])
  })

  it('a network line leaves', () => {
    expect(leaves('/hide drafts')).toEqual(['/hide drafts'])
  })

  it('a line whose scope was never declared is read as leaving', () => {
    expect(leaves('/unjudged drafts')).toEqual(['/unjudged drafts'])
  })

  it('names exactly the lines that leave, in order', () => {
    expect(leaves('/create roadmap', '/hide drafts', '/title a = b', '/unjudged notes'))
      .toEqual(['/hide drafts', '/unjudged notes'])
  })
})

describe('the lines a roll back of pages cannot reach', () => {
  const hive: HypercombBehaviour = { name: 'keyword', machine: { forms: '<tile> = <tag>', example: '/keyword a = b', reach: 'editing', scope: 'hive' } }
  const local: HypercombBehaviour = { name: 'language', machine: { forms: '<locale>', example: '/language ja', reach: 'editing', scope: 'local' } }
  const all = [...entries, hive, local]
  const plan = parseHypercombGrammars(['/create a', '/title a = b', '/keyword a = c', '/language ja', '/hide a', '/unjudged a'], all, ANY)

  it('tile and page lines are pages; hive, local, network and unjudged lines are not', () => {
    expect(hypercombLinesBeyondPages(plan, all, plan.actions.map(action => action.grammar), ANY))
      .toEqual(['/keyword a = c', '/language ja', '/hide a', '/unjudged a'])
  })

  it('only the lines that ran are named', () => {
    expect(hypercombLinesBeyondPages(plan, all, ['/create a', '/keyword a = c'], ANY)).toEqual(['/keyword a = c'])
  })
})
