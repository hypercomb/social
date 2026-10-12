// history/manifest-optimizer.spec.ts — one door for "this parent needs a manifest".

import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
})

import { EffectBus } from '@hypercomb/core'
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
      // a store without the local layer reader: the pass keeps the old read
      if (key === '@hypercomb.social/Store') return { writeChildrenManifest: async (sig: string, m: unknown[]) => { written.push([sig, m]) } }
      if (key === '@diamondcoreprocessor.com/HistoryService') return { peekLayerBySig: () => null, getLayerBySig: async (sig: string) => layers[sig] ?? null }
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

// A COLD CHILD KEEPS ITS PARENT WAITING (incident 2026-10-11/12): a parent
// whose child layer is not local yet used to be dropped for good, so it never
// got a manifest and the search index read its children as leaves.
describe('a cold child', () => {
  const C3 = 'd'.repeat(64)
  type Stored = { name: string } | { meta: 1; layer: string }
  const bytesOf = (layer: Stored) => new TextEncoder().encode(JSON.stringify(layer))
  /** A META ENVELOPE's target, as Store.getLayerBytes and getLayerBySig follow it. */
  const follow = (here: Record<string, Stored>, sig: string): { name: string } | null => {
    const at = here[sig]
    if (!at) return null
    return 'meta' in at ? follow(here, at.layer) : at
  }

  /** A hive whose layers on this device are `here`. `reads` records every
   *  local read; `hostAsks` records every getLayerBySig for a layer that is
   *  not here, which in the real HistoryService fires a host fetch. `onRead`
   *  runs inside a local read, before it answers. An envelope in `here` is
   *  followed the way the real readers follow it. */
  const stubHive = (here: Record<string, Stored>, onRead?: (sig: string) => unknown) => {
    const written: Array<[string, Array<{ sig: string; layer: { name?: string } }>]> = []
    const reads: string[] = []
    const hostAsks: string[] = []
    vi.stubGlobal('get', (key: string) => {
      if (key === '@hypercomb.social/Store') return {
        writeChildrenManifest: async (sig: string, m: Array<{ sig: string; layer: { name?: string } }>) => { written.push([sig, m]) },
        getLayerBytes: async (sig: string) => {
          reads.push(sig)
          await onRead?.(sig)
          const layer = follow(here, sig)
          return layer ? bytesOf(layer) : null
        },
        getLayerLocalBytes: async (sig: string) => here[sig] ? bytesOf(here[sig]) : null,
      }
      if (key === '@diamondcoreprocessor.com/HistoryService') return {
        peekLayerBySig: () => null,
        getLayerBySig: async (sig: string) => {
          const layer = follow(here, sig)
          if (!layer) hostAsks.push(sig)
          return layer
        },
      }
      return undefined
    })
    return { written, reads, hostAsks }
  }

  const quietDebug = () => vi.spyOn(console, 'debug').mockImplementation(() => {})
  /** One burst of acts: the five passes that park a parent with a cold child. */
  const park = async (drone: ManifestOptimizerDrone) => {
    for (let pass = 1; pass <= 5; pass++) await drone.optimize()
    expect(drone.pendingCount).toBe(0)
  }

  it('keeps the parent waiting, writes it on the pass that finds the child here, and never asks the host', async () => {
    const here: Record<string, { name: string }> = { [C1]: { name: 'one' } }
    const { written, hostAsks } = stubHive(here)
    const drone = new ManifestOptimizerDrone()
    drone.enqueue(P, [C1, C2])

    await drone.optimize()
    expect(written).toHaveLength(0) // still complete-or-absent: nothing partial
    expect(drone.pendingCount).toBe(1) // ...but the parent waits for a later pass

    here[C2] = { name: 'two' }
    await drone.optimize()
    expect(drone.pendingCount).toBe(0)
    expect(written).toHaveLength(1)
    expect(written[0]![0]).toBe(P)
    expect(written[0]![1].map(e => e.sig)).toEqual([C1, C2])
    expect(hostAsks).toEqual([]) // the optimize phase reads what is here
  })

  it('parks a parent after five passes in a row that find nothing new, said once', async () => {
    const { written, reads } = stubHive({ [C1]: { name: 'one' } })
    const debug = quietDebug()
    try {
      const drone = new ManifestOptimizerDrone()
      drone.enqueue(P, [C1, C2])
      for (let pass = 1; pass <= 4; pass++) {
        await drone.optimize()
        expect(drone.pendingCount).toBe(1)
      }
      expect(debug).not.toHaveBeenCalled()

      await drone.optimize() // the fifth pass with nothing new is the last
      expect(drone.pendingCount).toBe(0)
      expect(debug).toHaveBeenCalledTimes(1)

      await drone.optimize() // parked: no pass reads the child again
      expect(reads.filter(s => s === C2)).toHaveLength(5)
      expect(written).toHaveLength(0)
      expect(debug).toHaveBeenCalledTimes(1)
    } finally {
      debug.mockRestore()
    }
  })

  it('keeps waiting while the children arrive, however many passes that takes', async () => {
    const kids = ['1', '2', '3', '4', '5', '6'].map(c => c.repeat(64))
    const here: Record<string, { name: string }> = {}
    const { written, hostAsks } = stubHive(here)
    const debug = quietDebug()
    try {
      const drone = new ManifestOptimizerDrone()
      drone.enqueue(P, kids)
      for (const kid of kids) {
        await drone.optimize() // finds one more child than the pass before
        expect(written).toHaveLength(0)
        here[kid] = { name: kid.slice(0, 4) }
      }
      await drone.optimize()
      expect(written).toHaveLength(1)
      expect(written[0]![1].map(e => e.sig)).toEqual(kids)
      expect(debug).not.toHaveBeenCalled()
      expect(hostAsks).toEqual([])
    } finally {
      debug.mockRestore()
    }
  })

  it('wakes a parked parent when its child arrives — the next pass writes it', async () => {
    const here: Record<string, { name: string }> = { [C1]: { name: 'one' } }
    const { written } = stubHive(here)
    const debug = quietDebug()
    try {
      const drone = new ManifestOptimizerDrone()
      drone.enqueue(P, [C1, C2])
      for (let pass = 1; pass <= 5; pass++) await drone.optimize() // one burst of acts
      expect(drone.pendingCount).toBe(0)

      EffectBus.emit('content:arrived', { sig: C3, kind: 'layer' }) // nobody waits for it
      expect(drone.pendingCount).toBe(0)

      here[C2] = { name: 'two' }
      EffectBus.emit('content:arrived', { sig: C2, kind: 'layer' })
      expect(drone.pendingCount).toBe(1)
      await drone.optimize()
      expect(written).toHaveLength(1)
      expect(written[0]![1].map(e => e.sig)).toEqual([C1, C2])
    } finally {
      debug.mockRestore()
    }
  })

  it('leaves a newer list queued during the pass alone — the latest list wins', async () => {
    const here: Record<string, { name: string }> = { [C1]: { name: 'one' }, [C3]: { name: 'three' } }
    // the parent is re-enqueued with a fresh list while this pass runs
    const drone = new ManifestOptimizerDrone()
    const { written } = stubHive(here, sig => { if (sig === C2) drone.enqueue(P, [C1, C3]) })
    drone.enqueue(P, [C1, C2])

    await drone.optimize()
    expect(written).toHaveLength(0)
    await drone.optimize()
    expect(written).toHaveLength(1)
    expect(written[0]![1].map(e => e.sig)).toEqual([C1, C3])
  })

  it('runs one pass at a time — a pass started mid-pass waits for the first', async () => {
    const P2 = 'e'.repeat(64)
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    let held = false
    const { written } = stubHive({ [C1]: { name: 'one' } }, async sig => {
      if (sig === C2 && !held) { held = true; await gate }
    })
    const drone = new ManifestOptimizerDrone()
    drone.enqueue(P, [C1, C2])
    const tick = () => new Promise(r => setTimeout(r, 0))
    const first = drone.optimize()
    await tick() // the first pass holds P, stopped on its read of C2
    drone.enqueue(P2, [C1]) // an act() lands mid-pass...
    const second = drone.optimize() // ...and its run starts
    await tick()
    expect(written).toHaveLength(0) // P2 is ready, but the second pass waits for the first

    release()
    await Promise.all([first, second])
    expect(written.map(w => w[0])).toEqual([P2])
    expect(drone.pendingCount).toBe(1) // P, still waiting for C2
  })

  // 2026-10-12 — the review of the fix above.

  it('coalesces the passes asked for during a pass into ONE — a burst of acts is one stall, not five', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    let held = false
    const { reads } = stubHive({ [C1]: { name: 'one' } }, async sig => {
      if (sig === C2 && !held) { held = true; await gate }
    })
    const debug = quietDebug()
    try {
      const drone = new ManifestOptimizerDrone()
      drone.enqueue(P, [C1, C2])
      const first = drone.optimize()
      await new Promise(r => setTimeout(r, 0)) // the first pass holds P on its read of C2
      const burst = [1, 2, 3, 4, 5].map(() => drone.optimize())
      release()
      await Promise.all([first, ...burst])
      expect(reads.filter(s => s === C2)).toHaveLength(2) // the held pass, and one more
      expect(drone.pendingCount).toBe(1) // two stalls: still waiting, not parked
      expect(debug).not.toHaveBeenCalled()
    } finally {
      debug.mockRestore()
    }
  })

  it('wakes a parked parent whose child slot is a META ENVELOPE when the envelope\'s TARGET arrives', async () => {
    const E = 'e'.repeat(64)
    const L = 'f'.repeat(64)
    // the envelope is here; the layer it names is not
    const here: Record<string, Stored> = { [C1]: { name: 'one' }, [E]: { meta: 1, layer: L } }
    const { written, hostAsks } = stubHive(here)
    const debug = quietDebug()
    try {
      const drone = new ManifestOptimizerDrone()
      drone.enqueue(P, [C1, E])
      await park(drone)

      here[L] = { name: 'two' }
      EffectBus.emit('content:arrived', { sig: L, kind: 'layer' }) // the heal names the target, never the slot
      expect(drone.pendingCount).toBe(1)
      await drone.optimize()
      expect(written).toHaveLength(1)
      expect(written[0]![1].map(e => e.sig)).toEqual([C1, E]) // the slot keeps its own sig
      expect(written[0]![1][1]!.layer.name).toBe('two')
      expect(hostAsks).toEqual([])
    } finally {
      debug.mockRestore()
    }
  })

  it('wakes a parked parent on a commit of its child (content:wrote)', async () => {
    const here: Record<string, Stored> = { [C1]: { name: 'one' } }
    const { written } = stubHive(here)
    const debug = quietDebug()
    try {
      const drone = new ManifestOptimizerDrone()
      drone.enqueue(P, [C1, C2])
      await park(drone)

      here[C2] = { name: 'two' }
      EffectBus.emit('content:wrote', { sig: C2, kind: 'layer', bytes: bytesOf(here[C2]!).buffer })
      expect(drone.pendingCount).toBe(1) // P only — the child has no children of its own
      await drone.optimize()
      expect(written.map(w => w[0])).toEqual([P])
    } finally {
      debug.mockRestore()
    }
  })

  it('wakes a parked parent on the broker\'s own landings, which never say content:arrived', async () => {
    const P2 = 'e'.repeat(64)
    const here: Record<string, Stored> = { [C1]: { name: 'one' } }
    const { written } = stubHive(here)
    const debug = quietDebug()
    try {
      const drone = new ManifestOptimizerDrone()
      drone.enqueue(P, [C1, C2])
      drone.enqueue(P2, [C1, C3])
      await park(drone)

      EffectBus.emit('broker:fetched', { sig: C2, type: 'resource', bytes: 10 }) // not a layer
      expect(drone.pendingCount).toBe(0)
      here[C2] = { name: 'two' }
      EffectBus.emit('broker:fetched', { sig: C2, type: 'layer', bytes: 10 }) // a mesh fetch
      expect(drone.pendingCount).toBe(1)
      await drone.optimize()
      expect(written.map(w => w[0])).toEqual([P])

      // the adopt walk: progress names each layer it landed; done wakes every waiter
      EffectBus.emit('adopt:progress', { sig: C2, layers: 1, leaves: 0 })
      expect(drone.pendingCount).toBe(0) // P2 does not wait on C2
      EffectBus.emit('adopt:progress', { sig: C3, layers: 2, leaves: 0 })
      expect(drone.pendingCount).toBe(1)
      await park(drone) // C3 is still not here: five fresh passes, parked again
      here[C3] = { name: 'three' }
      EffectBus.emit('adopt:done', { root: P2, silent: false, layers: 2 })
      expect(drone.pendingCount).toBe(1)
      await drone.optimize()
      expect(written.map(w => w[0])).toEqual([P, P2])
    } finally {
      debug.mockRestore()
    }
  })

  it('a wake whose bytes have not landed (a host learned) gives the parent five more passes, not one', async () => {
    const { written } = stubHive({ [C1]: { name: 'one' } })
    const debug = quietDebug()
    try {
      const drone = new ManifestOptimizerDrone()
      drone.enqueue(P, [C1, C2])
      await park(drone)
      EffectBus.emit('content:arrived', { sig: C2, kind: 'layer' }) // the broker learned a host; no bytes yet
      for (let pass = 1; pass <= 4; pass++) {
        await drone.optimize()
        expect(drone.pendingCount).toBe(1)
      }
      await drone.optimize()
      expect(drone.pendingCount).toBe(0)
      expect(debug).toHaveBeenCalledTimes(2)
      expect(written).toHaveLength(0)
    } finally {
      debug.mockRestore()
    }
  })

  it('asking again for a parked parent starts its count over', async () => {
    stubHive({ [C1]: { name: 'one' } })
    const debug = quietDebug()
    try {
      const drone = new ManifestOptimizerDrone()
      drone.enqueue(P, [C1, C2])
      await park(drone)
      drone.enqueue(P, [C1, C2])
      for (let pass = 1; pass <= 4; pass++) {
        await drone.optimize()
        expect(drone.pendingCount).toBe(1)
      }
      expect(debug).toHaveBeenCalledTimes(1)
      await drone.optimize()
      expect(drone.pendingCount).toBe(0)
      expect(debug).toHaveBeenCalledTimes(2)
    } finally {
      debug.mockRestore()
    }
  })

  it('keeps at most 256 waiting parents — the longest waiter is forgotten', async () => {
    const parents = Array.from({ length: 257 }, (_, i) => i.toString(16).padStart(64, '0'))
    const here: Record<string, Stored> = { [C1]: { name: 'one' } }
    const { written } = stubHive(here)
    const drone = new ManifestOptimizerDrone()
    for (const parent of parents) drone.enqueue(parent, [C1, C2])
    await drone.optimize()
    expect(drone.pendingCount).toBe(256)

    here[C2] = { name: 'two' }
    await drone.optimize()
    expect(written.map(w => w[0])).toEqual(parents.slice(1)) // the first to wait was the one let go
  })
})
