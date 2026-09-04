// history/manifest-optimizer.spec.ts — one door for "this parent needs a manifest".

import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
})

import { ManifestOptimizerDrone } from './manifest-optimizer.drone.js'

const P = 'a'.repeat(64)
const C1 = 'b'.repeat(64)
const C2 = 'c'.repeat(64)

describe('enqueue', () => {
  it('queues a parent with its children, latest list wins, and refuses what is not a signature', () => {
    const drone = new ManifestOptimizerDrone()
    drone.enqueue(P, [C1, 'nope', C2])
    expect(drone.pendingCount).toBe(1)
    drone.enqueue(P, [C1])
    expect(drone.pendingCount).toBe(1)
    drone.enqueue('not-a-sig', [C1])
    drone.enqueue(C2, [])
    expect(drone.pendingCount).toBe(1)
  })

  it('is drained by optimize(), which writes the manifest only when EVERY child resolved', async () => {
    const written: Array<[string, unknown[]]> = []
    const layers: Record<string, { name: string }> = { [C1]: { name: 'one' }, [C2]: { name: 'two' } }
    vi.stubGlobal('get', (key: string) => {
      if (key === '@hypercomb.social/Store') return { writeChildrenManifest: async (sig: string, m: unknown[]) => { written.push([sig, m]) } }
      if (key === '@diamondcoreprocessor.com/HistoryService') return { getLayerBySig: async (sig: string) => layers[sig] ?? null }
      return undefined
    })
    const drone = new ManifestOptimizerDrone()
    drone.enqueue(P, [C1, C2])
    await drone.optimize()
    expect(drone.pendingCount).toBe(0)
    expect(written).toHaveLength(1)
    expect(written[0]![0]).toBe(P)
    expect((written[0]![1] as Array<{ sig: string }>).map(e => e.sig)).toEqual([C1, C2])

    // complete-or-absent: a child that does not resolve means NO manifest
    drone.enqueue(P, [C1, 'd'.repeat(64)])
    await drone.optimize()
    expect(written).toHaveLength(1)
  })
})
