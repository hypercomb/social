// commands/website.queen.lazy.spec.ts
//
// THE ARCHIVE AND THE QUEUE PANEL ARRIVE WITH THE WORD (atomic-modules-plan.md,
// "adopt the proper load"): importing the queen loads neither; `save`/`load`
// and `list` load theirs once, a failed load says so and is tried again, and a
// picker whose press has run out asks for the word again.

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    has: () => false,
    list: () => [],
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
  return {
    archiveLoads: 0,
    // THE LOAD CAN BE HELD: a test sets a gate to keep the first archive load
    // in flight while the press runs out.
    archiveGate: Promise.resolve() as Promise<void>,
    instancesLoads: 0,
    instancesFail: false,
    exportBranch: vi.fn(async () => {}),
    importArchive: vi.fn(async () => {}),
    showWebsiteListPanel: vi.fn(async () => {}),
  }
})

vi.mock('./website-archive.queen.js', async () => {
  state.archiveLoads++
  await state.archiveGate
  return { exportBranch: state.exportBranch, importArchive: state.importArchive }
})
vi.mock('./website-instances.js', () => {
  state.instancesLoads++
  if (state.instancesFail) throw new Error('offline')
  return { showWebsiteListPanel: state.showWebsiteListPanel }
})

import { EffectBus } from '@hypercomb/core'
import { WebsiteQueenBee } from './website.queen.js'

// READ AT IMPORT, before any word runs — so the first test holds in any order.
const loadsAtImport = { archive: state.archiveLoads, instances: state.instancesLoads }

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

let toasts: { type?: string; message?: string }[] = []
const offToasts = EffectBus.on<{ type?: string; message?: string }>('toast:show', toast => { toasts.push(toast) })
afterEach(() => { toasts = [] })
afterAll(() => { offToasts() })

describe('/website — the archive and the queue load with the word', () => {
  it('importing the queen loads neither', () => {
    expect(loadsAtImport).toEqual({ archive: 0, instances: 0 })
  })

  it('a failed queue load says so, and the next list tries again', async () => {
    const queen = new WebsiteQueenBee()
    const archiveLoadsBefore = state.archiveLoads
    const listCallsBefore = state.showWebsiteListPanel.mock.calls.length
    state.instancesFail = true
    await queen.invoke('list')
    await settle()
    expect(toasts.some(toast => toast.type === 'warning' && /gen queue/.test(toast.message ?? ''))).toBe(true)
    expect(state.showWebsiteListPanel.mock.calls.length).toBe(listCallsBefore)

    state.instancesFail = false
    await queen.invoke('list')
    await queen.invoke('list')
    await settle()
    expect(state.showWebsiteListPanel.mock.calls.length).toBe(listCallsBefore + 2)
    expect(state.archiveLoads).toBe(archiveLoadsBefore)
  })

  it('a picker whose press ran out during the load asks for the word again', async () => {
    let active = true
    Object.defineProperty(navigator, 'userActivation', { configurable: true, get: () => ({ isActive: active }) })
    let release!: () => void
    state.archiveGate = new Promise<void>(resolve => { release = resolve })
    try {
      const queen = new WebsiteQueenBee()
      const picksBefore = state.importArchive.mock.calls.length
      // The word reads the press synchronously, then waits on the load — in
      // this file's order the FIRST load, held at the gate while the module
      // is being read. The press runs out while it waits; only then does the
      // load finish. (Already loaded, the wait passes at once.)
      void queen.invoke('load')
      active = false
      await vi.waitFor(() => { expect(state.archiveLoads).toBe(1) })
      release()
      await vi.waitFor(() => {
        expect(toasts.some(toast => /run \/website load again/.test(toast.message ?? ''))).toBe(true)
      })
      expect(state.importArchive.mock.calls.length).toBe(picksBefore)
    } finally {
      release()
      state.archiveGate = Promise.resolve()
      delete (navigator as { userActivation?: unknown }).userActivation
    }
  })

  it('save and load share one archive load', async () => {
    const queen = new WebsiteQueenBee()
    const savesBefore = state.exportBranch.mock.calls.length
    const picksBefore = state.importArchive.mock.calls.length
    await queen.invoke('save')
    await queen.invoke('load')
    await vi.waitFor(() => { expect(state.importArchive.mock.calls.length).toBe(picksBefore + 1) })
    expect(state.exportBranch.mock.calls.length).toBe(savesBefore + 1)
    expect(state.archiveLoads).toBe(1)
  })
})
