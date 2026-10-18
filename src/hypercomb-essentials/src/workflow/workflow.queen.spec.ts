// workflow/workflow.queen.spec.ts — a window opens only from its own door.
//
// `workflow` (bare) and `workflow new <name>` are the designer's own words and
// open it. `workflow run` (also the ring's run) answers in place — the
// surface draws the run-state and the runner toasts how it ended — and never
// raises the designer. `workflow step` waits on the designer's Next, the only
// control that advances it, so stepping opens the designer.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
  ;(globalThis as unknown as { get: (k: string) => unknown }).get = (key: string) =>
    key === '@hypercomb.social/Lineage' ? { explorerSegments: () => ['flows', 'onboard'] } : undefined
})

vi.mock('./workflow-slot.js', () => ({
  WORKFLOW_SLOT: 'workflow',
  listWorkflows: vi.fn(async () => [{ name: 'onboard a peer', segments: ['flows', 'onboard'], record: {} }]),
  nameWorkflow: vi.fn(async () => undefined),
  readWorkflow: vi.fn(async () => ({ name: 'onboard a peer' })),
}))
vi.mock('../pheromones/enrollment-acts.js', () => ({ ensureSiteArtifact: vi.fn(async () => undefined) }))
vi.mock('./workflow-family.js', () => ({ WORKFLOW_FAMILY: 'workflow' }))

const { WorkflowQueenBee } = await import('./workflow.queen.js')

const heard: { effect: string; payload: unknown }[] = []
for (const effect of ['workflow:view-open', 'workflow:run', 'toast:show']) {
  EffectBus.on(effect, payload => { heard.push({ effect, payload }) })
}
const of = (effect: string): unknown[] => heard.filter(h => h.effect === effect).map(h => h.payload)

beforeEach(() => { heard.length = 0 })

describe('workflow word — the designer opens only from its own door', () => {
  it('run never opens the designer', async () => {
    await new WorkflowQueenBee().invoke('run')
    expect(of('workflow:view-open')).toEqual([])
    expect(of('workflow:run')).toEqual([{ segments: ['flows', 'onboard'], stepThrough: false }])
  })

  it('run <name> does not open it either', async () => {
    await new WorkflowQueenBee().invoke('run onboard a peer')
    expect(of('workflow:view-open')).toEqual([])
    expect(of('workflow:run')).toHaveLength(1)
  })

  it('step opens the designer, whose Next is the only way a paused run moves', async () => {
    await new WorkflowQueenBee().invoke('step')
    expect(of('workflow:view-open')).toHaveLength(1)
    expect(of('workflow:run')).toEqual([{ segments: ['flows', 'onboard'], stepThrough: true }])
  })

  it('bare workflow and workflow new <name> keep their door', async () => {
    await new WorkflowQueenBee().invoke('')
    expect(of('workflow:view-open')).toHaveLength(1)
    await new WorkflowQueenBee().invoke('new onboard a peer')
    expect(of('workflow:view-open')).toHaveLength(2)
  })
})
