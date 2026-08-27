import { describe, expect, it, vi } from 'vitest'
import { importSignatureModule, signatureModuleUrl } from './signature-module-loader'

describe('signature module loader', () => {
  it('imports the immutable pool URL and never needs an alias', async () => {
    const pool = 'A'.repeat(64)
    const content = 'B'.repeat(64)
    const importer = vi.fn(async () => ({ loaded: true }))

    await expect(importSignatureModule(pool, content, importer)).resolves.toEqual({ loaded: true })
    expect(importer).toHaveBeenCalledOnce()
    expect(importer).toHaveBeenCalledWith(`/opfs/${'a'.repeat(64)}/${'b'.repeat(64)}`)
  })

  it('rejects anything that is not a content signature', () => {
    expect(() => signatureModuleUrl('dependencies', 'b'.repeat(64))).toThrow('invalid pool signature')
    expect(() => signatureModuleUrl('a'.repeat(64), '@namespace/name')).toThrow('invalid content signature')
  })
})
