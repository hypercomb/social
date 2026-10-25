// eggs.hatch.spec.ts — a miss never outlives a head move.
//
// A head-only host answers a withdrawn old version as a plain 404 and serves
// it again on a revert (documentation/hosted-tenants.md §4b), so whoever takes
// a new head hatches the eggs for what it reaches. The disk is always asked:
// a service worker lays eggs this page's copy never saw. And the worker is
// told, so its own copy does not keep a stale miss.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '../effect-bus.js'
import { registerPoolMeaning } from './pool-registry.js'
import { askUntried, EGGS_HATCH_EFFECT, EGGS_MEANING, EGGS_HATCH_MESSAGE, hatchEgg, hatchEggs, untriedHosts, type EggProbe } from './eggs.js'

const sig = (c: string): string => c.repeat(64)

const refusing = () => {
  const asked: string[] = []
  return { asked, ask: async (base: string): Promise<EggProbe<string>> => { asked.push(base); return 'absent' } }
}

/** A minimal OPFS: one root, directories by name, files by name. */
const fakeOpfs = () => {
  const dirs = new Map<string, Map<string, string>>()
  const dirHandle = (files: Map<string, string>) => ({
    getFileHandle: async (name: string, opts?: { create?: boolean }) => {
      if (!files.has(name)) {
        if (!opts?.create) throw new DOMException('missing', 'NotFoundError')
        files.set(name, '')
      }
      return {
        getFile: async () => ({ text: async () => files.get(name) ?? '' }),
        createWritable: async () => ({ write: async (text: string) => { files.set(name, text) }, close: async () => {} }),
      }
    },
    removeEntry: async (name: string) => {
      if (!files.delete(name)) throw new DOMException('missing', 'NotFoundError')
    },
    entries: async function* () { for (const name of files.keys()) yield [name, {}] as [string, unknown] },
  })
  const root = {
    getDirectoryHandle: async (name: string, opts?: { create?: boolean }) => {
      let files = dirs.get(name)
      if (!files) {
        if (!opts?.create) throw new DOMException('missing', 'NotFoundError')
        files = new Map(); dirs.set(name, files)
      }
      return dirHandle(files)
    },
  }
  return { dirs, root }
}

const withNavigator = (opfs: ReturnType<typeof fakeOpfs> | null, posted: unknown[] = []) => {
  vi.stubGlobal('navigator', {
    storage: opfs ? { getDirectory: async () => opfs.root } : undefined,
    serviceWorker: { controller: { postMessage: (message: unknown) => posted.push(message) } },
  })
  return posted
}

afterEach(() => { vi.unstubAllGlobals() })

describe('hatchEggs — a new head asks again', () => {
  it('a hatched miss is asked again; a host that still refuses lays it again', async () => {
    withNavigator(null)
    const s = sig('5')
    const net = refusing()
    await askUntried(s, ['https://one'], net.ask)
    expect(await untriedHosts(s, ['https://one'])).toEqual([])

    expect(await hatchEggs([s])).toEqual([s])
    expect(await untriedHosts(s, ['https://one'])).toEqual(['https://one'])
    await askUntried(s, ['https://one'], net.ask)
    expect(net.asked).toEqual(['https://one', 'https://one'])
    expect(await untriedHosts(s, ['https://one'])).toEqual([])
  })

  it('tells the service worker which signatures hatched, and nothing when none had an egg', async () => {
    const posted = withNavigator(null)
    const s = sig('6')
    await askUntried(s, ['https://one'], refusing().ask)

    await hatchEggs([s, sig('7'), 'not-a-sig'])
    expect(posted).toEqual([{ type: EGGS_HATCH_MESSAGE, sigs: [s] }])

    await hatchEggs([sig('8')])
    expect(posted).toHaveLength(1)
  })

  it('hatches an egg on disk that this session never saw laid — the empty copy is no reason to skip the disk', async () => {
    const opfs = fakeOpfs()
    const posted = withNavigator(opfs)
    const s = sig('9')
    // This page's copy learns "nothing here"…
    await hatchEgg(s)
    // …then another context (a service worker) lays the egg on disk.
    const address = await registerPoolMeaning(EGGS_MEANING)
    const dir = await opfs.root.getDirectoryHandle(address, { create: true })
    await (await (await dir.getFileHandle(s, { create: true })).createWritable()).write(JSON.stringify({ tried: ['https://one'] }))

    await hatchEgg(s)
    expect(opfs.dirs.get(address)?.has(s)).toBe(false)
    expect(posted).toEqual([{ type: EGGS_HATCH_MESSAGE, sigs: [s] }])
  })

  it('a module asks by effect, without importing anything new from core', async () => {
    withNavigator(null)
    const s = sig('0')
    await askUntried(s, ['https://one'], refusing().ask)
    EffectBus.emit(EGGS_HATCH_EFFECT, { sigs: [s] })
    await vi.waitFor(async () => expect(await untriedHosts(s, ['https://one'])).toEqual(['https://one']))
  })
})
