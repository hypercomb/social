import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PACKED_STORE_FLAG_KEY } from '@hypercomb/core'
import { nativeAvailable } from './native-filesystem'
import { packedStoreHasRecords } from './packed-bridge'
import { packedStoreBlocksBoot } from './packed-store-gate'

vi.mock('./native-filesystem', () => ({ nativeAvailable: vi.fn() }))
vi.mock('./packed-bridge', () => ({ packedStoreHasRecords: vi.fn() }))

const mockedNativeAvailable = vi.mocked(nativeAvailable)
const mockedPackedStoreHasRecords = vi.mocked(packedStoreHasRecords)

describe('packedStoreBlocksBoot', () => {
  const getDirectory = vi.fn(async () => ({}))

  beforeEach(() => {
    vi.restoreAllMocks()
    mockedNativeAvailable.mockReset().mockReturnValue(false)
    mockedPackedStoreHasRecords.mockReset().mockResolvedValue(false)
    localStorage.clear()
    document.body.innerHTML = '<app-root>loading</app-root>'
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory },
    })
  })

  it('leaves a complete flat hive in flat mode', async () => {
    await expect(packedStoreBlocksBoot('pack-pool')).resolves.toBe(false)

    expect(localStorage.getItem(PACKED_STORE_FLAG_KEY)).toBeNull()
    expect(document.querySelector('app-root')).not.toBeNull()
  })

  it('does not inspect browser storage in a native shell', async () => {
    mockedNativeAvailable.mockReturnValue(true)

    await expect(packedStoreBlocksBoot('pack-pool')).resolves.toBe(false)

    expect(mockedPackedStoreHasRecords).not.toHaveBeenCalled()
  })

  it('makes packed mode sticky once records have migrated', async () => {
    mockedPackedStoreHasRecords.mockResolvedValue(true)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(packedStoreBlocksBoot('pack-pool')).resolves.toBe(false)

    expect(localStorage.getItem(PACKED_STORE_FLAG_KEY)).toBe('1')
    expect(document.querySelector('app-root')).not.toBeNull()
  })

  it('still stops before flat writes when packed mode cannot be persisted', async () => {
    mockedPackedStoreHasRecords.mockResolvedValue(true)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(packedStoreBlocksBoot('pack-pool')).resolves.toBe(true)

    expect(document.body.textContent).toContain('This hive lives in the packed store')
    await expect(navigator.storage.getDirectory()).rejects.toThrow('This hive lives in the packed store')
  })
})
