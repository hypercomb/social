// The facade's COST, not just its answers.
//
// These are performance-shape tests, and they earn their place: the packed
// store shipped functionally correct and still rendered Jaime's hive EMPTY,
// because two lookups that read as O(1) were secretly O(n) directory
// listings — and each listing re-enumerated the undrained flat directory
// inside the worker. Small synthetic bags hid it; a real hive (a 251-marker
// root bag, a manifests pool with a member per layer) turned every
// children-manifest read into tens of seconds, so the renderer resolved no
// children at all. Asserting the RESULT would never have caught that.
//
// So: count the round trips.

import { describe, expect, it } from 'vitest'
import { NativeRootDirectory, type NativeBridge } from './native-filesystem'

/** A bridge that records every command, with a pool of `size` members. */
const bridgeWith = (size: number) => {
  const calls: string[] = []
  const members = Array.from({ length: size }, (_, i) => `member-${i}`)
  const bridge: NativeBridge = {
    invoke: async (command, payload) => {
      calls.push(command)
      if (command === 'raw_dir_entries') {
        return members.map(name => ({ name, directory: false }))
      }
      if (command === 'dir_get_raw') {
        const name = String((payload as { name?: string })?.name ?? '')
        if (!members.includes(name)) {
          throw Object.assign(new Error('not found'), { kind: 'NotFound' })
        }
        return new TextEncoder().encode(`bytes:${name}`).buffer
      }
      throw new Error(`unexpected command ${command}`)
    },
  }
  const count = (command: string) => calls.filter(c => c === command).length
  return { bridge, count, calls }
}

const SIG = 'a'.repeat(64)

describe('native filesystem facade: lookups must not list', () => {
  it('reads one member without enumerating the directory', async () => {
    const { bridge, count } = bridgeWith(2000)
    const dir = await new NativeRootDirectory(bridge).getDirectoryHandle(SIG)

    const handle = await dir.getFileHandle('member-7')
    // jsdom's File has no arrayBuffer(), so size is the portable assertion
    // (see packed-interchange.ts's fileBytes for the same trap).
    const file = await handle.getFile()

    expect(file.size).toBe('bytes:member-7'.length)
    // The whole point: a 2,000-member pool costs ONE round trip, not a listing.
    expect(count('raw_dir_entries')).toBe(0)
    expect(count('dir_get_raw')).toBe(1)
  })

  it('still reports an absent member as NotFound', async () => {
    const { bridge, count } = bridgeWith(10)
    const dir = await new NativeRootDirectory(bridge).getDirectoryHandle(SIG)

    await expect(dir.getFileHandle('nope')).rejects.toThrow()
    expect(count('raw_dir_entries')).toBe(0)
  })

  it('creates without any existence round trip at all', async () => {
    const { bridge, count } = bridgeWith(10)
    const dir = await new NativeRootDirectory(bridge).getDirectoryHandle(SIG)

    await dir.getFileHandle('brand-new', { create: true })

    expect(count('raw_dir_entries')).toBe(0)
    expect(count('dir_get_raw')).toBe(0)
  })

  it('iterates a bag with ONE listing, not one per entry', async () => {
    const { bridge, count } = bridgeWith(250)
    const dir = await new NativeRootDirectory(bridge).getDirectoryHandle(SIG)

    const names: string[] = []
    for await (const [name] of dir.entries()) names.push(name)

    expect(names).toHaveLength(250)
    // Before the fix this was 251: the listing, plus one more per entry
    // handed out — each re-enumerating the flat directory in the worker.
    expect(count('raw_dir_entries')).toBe(1)
  })
})

// PRUNE'S DESTROY (jwize 2026-10-18: "make it really destroy"). This store
// never deletes on an ordinary removeEntry — removing a tile appends a layer —
// so prune says `destroy`, and only then does a real delete cross the bridge.
describe('native filesystem facade: a bag names its head without listing', () => {
  const headBridge = (head: { name: string; bytes: string } | null | 'unknown') => {
    const calls: string[] = []
    const bridge: NativeBridge = {
      invoke: async command => {
        calls.push(command)
        if (command === 'dir_head') {
          if (head === 'unknown') throw new Error('unknown packed-store command: dir_head')
          return head ? { name: head.name, bytes: new TextEncoder().encode(head.bytes).buffer } : null
        }
        throw new Error(`unexpected command ${command}`)
      },
    }
    return { bridge, calls }
  }

  it('answers the newest marker and its bytes in one round trip', async () => {
    const { bridge, calls } = headBridge({ name: '00000251', bytes: '{"layer":"x"}' })
    const bag = await new NativeRootDirectory(bridge).getDirectoryHandle(SIG)
    const head = await bag.latestMarker()
    expect(head?.name).toBe('00000251')
    expect(new TextDecoder().decode(head?.bytes)).toBe('{"layer":"x"}')
    expect(calls).toEqual(['dir_head'])
  })

  it('says null for a bag with no marker', async () => {
    const { bridge } = headBridge(null)
    const bag = await new NativeRootDirectory(bridge).getDirectoryHandle(SIG)
    await expect(bag.latestMarker()).resolves.toBeNull()
  })

  it('says undefined when the backend has no head command, and stops asking', async () => {
    const { bridge, calls } = headBridge('unknown')
    const bag = await new NativeRootDirectory(bridge).getDirectoryHandle(SIG)
    await expect(bag.latestMarker()).resolves.toBeUndefined()
    await expect(bag.latestMarker()).resolves.toBeUndefined()
    expect(calls).toEqual(['dir_head'])
  })

  it('never answers for a sub-bucket, which holds pool members, not markers', async () => {
    const { bridge, calls } = headBridge({ name: '00000001', bytes: '' })
    const bag = await new NativeRootDirectory(bridge).getDirectoryHandle(SIG)
    const sub = await bag.getDirectoryHandle('locale', { create: true })
    await expect(sub.latestMarker()).resolves.toBeUndefined()
    expect(calls).toEqual([])
  })
})

describe('native filesystem facade: a sub-bucket asks for its own members', () => {
  it('sends its prefix, and still filters when the backend ignores it', async () => {
    const payloads: unknown[] = []
    const bridge: NativeBridge = {
      invoke: async (command, payload) => {
        payloads.push(payload)
        if (command !== 'raw_dir_entries') throw new Error(`unexpected command ${command}`)
        // A backend that does not know `prefix` answers the whole pool.
        return [
          { name: 'mine/turn-1', directory: false },
          { name: 'other/turn-9', directory: false },
          { name: 'top-level', directory: false },
        ]
      },
    }
    const pool = await new NativeRootDirectory(bridge).getDirectoryHandle(SIG)
    const bucket = await pool.getDirectoryHandle('mine', { create: true })
    const names: string[] = []
    for await (const [name] of bucket.entries()) names.push(name)
    expect(names).toEqual(['turn-1'])
    expect(payloads).toEqual([{ sig: SIG, prefix: 'mine/' }])
  })
})

describe('native filesystem facade: only prune destroys', () => {
  const recording = () => {
    const calls: { command: string; payload: unknown }[] = []
    const bridge: NativeBridge = {
      invoke: async (command, payload) => { calls.push({ command, payload }); return true },
    }
    return { root: new NativeRootDirectory(bridge), calls }
  }
  const SIG = 'a'.repeat(64)

  it('an ordinary removeEntry keeps the never-delete rule', async () => {
    const { root, calls } = recording()
    await root.removeEntry(SIG)
    await root.removeEntry(SIG, { recursive: true })
    expect(calls.map(c => c.command)).toEqual(['raw_remove', 'raw_remove'])
  })

  it('prune\'s destroy removes a bag\'s history, or bytes', async () => {
    const { root, calls } = recording()
    await root.removeEntry(SIG, { recursive: true, destroy: true })
    await root.removeEntry(SIG, { destroy: true })
    expect(calls).toEqual([
      { command: 'raw_destroy', payload: { sig: SIG, directory: true } },
      { command: 'raw_destroy', payload: { sig: SIG, directory: false } },
    ])
  })
})
