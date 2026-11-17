import { describe, expect, it, vi } from 'vitest'
import { debuggerPackage } from './debugger-package'

const PUB = 'e'.repeat(64)
const SIG = 'd'.repeat(64)
const POOL_ROW = {
  zone: 'hypercomb.com', base: 'https://hypercomb.com', packageSig: 'f'.repeat(64), label: 'debugger',
  at: '', generation: null, layers: [], bees: [], dependencies: [],
}

describe('the package a managed site door runs', () => {
  it('takes the root the publisher signed as install:debugger', async () => {
    const readPool = vi.fn(async () => POOL_ROW)
    const pkg = await debuggerPackage({ publisher: PUB }, 'hypercomb.com', {
      readChannel: async (pubkey, zone) => {
        expect([pubkey, zone]).toEqual([PUB, 'hypercomb.com'])
        return { state: 'named', packageSig: SIG, zone, createdAt: 1 }
      },
      readPool,
      basesOf: zone => [`https://${zone}`],
    })
    expect(pkg).toMatchObject({ packageSig: SIG, zone: 'hypercomb.com', base: 'https://hypercomb.com', label: 'debugger' })
    expect(readPool).not.toHaveBeenCalled()
  })

  it('falls back to the pool member named debugger when the index names none', async () => {
    const pkg = await debuggerPackage({ publisher: PUB }, 'hypercomb.com', {
      readChannel: async zone => ({ state: 'unnamed', zone }),
      readPool: async () => POOL_ROW,
    })
    expect(pkg?.packageSig).toBe(POOL_ROW.packageSig)
  })

  it('reads the pool when the record names no publisher', async () => {
    const readChannel = vi.fn()
    const pkg = await debuggerPackage({ publisher: null }, 'hypercomb.com', { readChannel, readPool: async () => POOL_ROW })
    expect(readChannel).not.toHaveBeenCalled()
    expect(pkg?.packageSig).toBe(POOL_ROW.packageSig)
  })

  it('a forged index names nothing — never a substitute', async () => {
    const pkg = await debuggerPackage({ publisher: PUB }, 'hypercomb.com', {
      readChannel: async () => ({ state: 'forged', door: 'evil.example' }),
      readPool: async () => POOL_ROW,
    })
    expect(pkg).toBeNull()
  })

  it('nothing named is null, and a failing read is not a throw', async () => {
    expect(await debuggerPackage({ publisher: PUB }, 'hypercomb.com', {
      readChannel: async () => { throw new Error('offline') },
      readPool: async () => { throw new Error('offline') },
    })).toBeNull()
  })
})
