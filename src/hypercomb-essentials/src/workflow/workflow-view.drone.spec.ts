// workflow/workflow-view.drone.spec.ts — a window opens only from its own door.
//
// Entering the workflow surface (a `/view`, or arriving on a layer whose view
// is workflow) only draws the flow. The designer opens from the surface's own
// `edit` button, never because the canvas changed mode.

import { describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const viewMode = vi.hoisted(() => {
  const target = new EventTarget() as EventTarget & { mode: string; setMode(next: string): void }
  target.mode = 'hexagons'
  target.setMode = (next: string) => { target.mode = next; target.dispatchEvent(new Event('change')) }
  return target
})

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: (key: string) => (key === '@hypercomb.social/ViewMode' ? viewMode : undefined),
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
})

const { WorkflowViewDrone } = await import('./workflow-view.drone.js')

describe('workflow surface — never pops the designer', () => {
  it('entering the surface draws it and opens no designer; edit is the door', async () => {
    const opens: unknown[] = []
    let live = false
    EffectBus.on('workflow:view-open', p => { if (live) opens.push(p) })
    live = true

    const drone = new WorkflowViewDrone()
    await (drone as unknown as { heartbeat: () => Promise<void> }).heartbeat()
    viewMode.setMode('workflow')

    const host = document.getElementById('hc-workflow-view-host')
    expect(host).not.toBeNull()
    expect(opens).toEqual([])

    const edit = [...host!.querySelectorAll('button')].find(b => b.textContent === 'edit')
    expect(edit).toBeDefined()
    edit!.click()
    expect(opens).toHaveLength(1)

    viewMode.setMode('hexagons')
    expect(document.getElementById('hc-workflow-view-host')).toBeNull()
  })
})
