import { describe, expect, it } from 'vitest'
import { planWorkflowSteps } from './workflow-graph.js'
import type { WorkflowStepView } from './workflow-step.js'

const step = (cell: string, index: number, next?: readonly string[]): WorkflowStepView => ({
  cell,
  index,
  segments: ['flow', cell],
  step: { v: 1, kind: 'command', ...(next === undefined ? {} : { next }) },
  stepSig: null,
  hasChildren: false,
})

describe('planWorkflowSteps', () => {
  it('preserves the child order for legacy workflows', () => {
    const steps = [step('a', 0), step('b', 1), step('c', 2)]
    expect(planWorkflowSteps(steps).map(item => item.cell)).toEqual(['a', 'b', 'c'])
  })

  it('walks explicit branches breadth-first in canvas order', () => {
    const steps = [
      step('start', 0, ['research', 'draft']),
      step('research', 1, ['review']),
      step('draft', 2, ['review']),
      step('review', 3, []),
    ]
    expect(planWorkflowSteps(steps).map(item => item.cell))
      .toEqual(['start', 'research', 'draft', 'review'])
  })

  it('executes cycles once instead of looping', () => {
    const steps = [step('a', 0, ['b']), step('b', 1, ['a'])]
    expect(planWorkflowSteps(steps).map(item => item.cell)).toEqual(['a', 'b'])
  })
})
