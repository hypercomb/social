import { createHash } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let StoreClass: typeof import('./store.ts').Store

const originalIoc = window.ioc

beforeAll(async () => {
  // store.ts preserves the browser shell's module-scope self-registration.
  // Install that browser global before importing the module in isolation.
  vi.stubGlobal('register', vi.fn())
  ;({ Store: StoreClass } = await import('./store.ts'))
})

const installIoc = (): void => {
  const instances = new Map<string, unknown>()
  const listeners = new Set<(key: string, value: unknown) => void>()
  ;(window as any).ioc = {
    get: (key: string) => instances.get(key),
    list: () => [...instances.keys()],
    onRegister: (listener: (key: string, value: unknown) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    register: (key: string, value: unknown) => {
      if (instances.has(key)) return
      instances.set(key, value)
      for (const listener of listeners) listener(key, value)
    },
  }
}

afterEach(() => {
  ;(window as any).ioc = originalIoc
  vi.unstubAllGlobals()
})

describe('Store signed bee execution', () => {
  it('rejects bytes that do not match their claimed signature before import', async () => {
    installIoc()
    const importer = vi.fn(async () => ({}))
    const bytes = new TextEncoder().encode('not the claimed bee')

    await expect(new StoreClass().getBee('a'.repeat(64), bytes.buffer, importer)).resolves.toBeNull()
    expect(importer).not.toHaveBeenCalled()
  })

  it('seeds verified bytes and imports from the exact bees-pool signature URL', async () => {
    installIoc()
    const cachePut = vi.fn(async () => undefined)
    vi.stubGlobal('caches', {
      open: vi.fn(async () => ({
        match: vi.fn(async () => undefined),
        put: cachePut,
      })),
    })

    const bytes = new TextEncoder().encode('export const signed = true')
    const signature = createHash('sha256').update(bytes).digest('hex')
    class SignedBee { public pulse = async (): Promise<void> => undefined }
    const bee = new SignedBee()
    const importer = vi.fn(async () => {
      window.ioc.register('@test/SignedBee', bee)
      return { SignedBee }
    })

    await expect(new StoreClass().getBee(signature, bytes.buffer, importer)).resolves.toBe(bee)

    const beesPool = await StoreClass.poolSignature(StoreClass.BEES_MEANING)
    expect(importer).toHaveBeenCalledWith(beesPool, signature)
    expect(cachePut).toHaveBeenCalledOnce()
    expect(String(cachePut.mock.calls[0]?.[0]).endsWith(`/opfs/${beesPool}/${signature}`)).toBe(true)
    expect((cachePut.mock.calls[0]?.[1] as Response).headers.get('x-hypercomb-signature'))
      .toBe(signature)
  })
})
