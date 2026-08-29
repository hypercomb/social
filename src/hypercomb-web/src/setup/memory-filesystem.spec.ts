import { describe, expect, it, vi } from 'vitest'
import { installMemoryFilesystem } from './memory-filesystem'

describe('visitor memory filesystem', () => {
  it('replaces OPFS before use and keeps bytes only in the session root', async () => {
    const realOpfs = vi.fn(async () => { throw new Error('real OPFS must not open') })
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: realOpfs },
    })

    installMemoryFilesystem()

    const root = await navigator.storage.getDirectory()
    const pool = await root.getDirectoryHandle('pool', { create: true })
    const handle = await pool.getFileHandle('a'.repeat(64), { create: true })
    const writable = await handle.createWritable()
    await writable.write('verified bytes')
    await writable.close()

    expect(realOpfs).not.toHaveBeenCalled()
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error)
      reader.onload = () => resolve(String(reader.result ?? ''))
      void handle.getFile().then(file => reader.readAsText(file), reject)
    })
    expect(text).toBe('verified bytes')
    expect([...await Array.fromAsync((pool as unknown as { keys(): AsyncIterable<string> }).keys())])
      .toEqual(['a'.repeat(64)])
    expect((window as Window & { __HC_READONLY__?: boolean }).__HC_READONLY__).toBe(true)
    expect(document.documentElement.dataset['hypercombMode']).toBe('visitor')
  })
})
