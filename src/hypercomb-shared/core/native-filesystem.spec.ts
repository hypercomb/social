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
