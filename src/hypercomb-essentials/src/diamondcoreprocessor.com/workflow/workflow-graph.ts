import type { WorkflowStepView } from './workflow-step.js'

/**
 * Resolve the deterministic execution order of a visual workflow graph.
 *
 * - Legacy steps (`next === undefined`) flow to their next sibling.
 * - Explicit edges are followed breadth-first in canvas order.
 * - Every root runs, which makes disconnected roots intentional parallel
 *   entry lanes (executed deterministically today).
 * - Cycles execute each node once; the remaining cycle is entered at its
 *   earliest canvas position rather than looping forever.
 */
export function planWorkflowSteps(steps: readonly WorkflowStepView[]): WorkflowStepView[] {
  if (steps.length < 2) return [...steps]

  const byCell = new Map(steps.map((step, index) => [step.cell, index]))
  const outgoing = steps.map((view, index): number[] => {
    const targets = view.step?.next
    if (targets === undefined) return index + 1 < steps.length ? [index + 1] : []
    return [...new Set(targets.map(target => byCell.get(target)).filter(isIndex))]
  })
  const incoming = Array.from({ length: steps.length }, () => 0)
  for (const targets of outgoing) for (const target of targets) incoming[target]++

  const queue = incoming.flatMap((count, index) => count === 0 ? [index] : [])
  const queued = new Set(queue)
  const visited = new Set<number>()
  const order: WorkflowStepView[] = []

  const drain = (): void => {
    while (queue.length) {
      const index = queue.shift()!
      if (visited.has(index)) continue
      visited.add(index)
      order.push(steps[index])
      for (const target of outgoing[index]) {
        if (visited.has(target) || queued.has(target)) continue
        queued.add(target)
        queue.push(target)
      }
    }
  }

  drain()
  for (let index = 0; index < steps.length; index++) {
    if (visited.has(index)) continue
    queue.push(index)
    queued.add(index)
    drain()
  }
  return order
}

const isIndex = (value: number | undefined): value is number => value !== undefined
