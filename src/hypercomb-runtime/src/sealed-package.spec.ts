import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { bytesMatchSignature, validateSealedPackage } from './sealed-package'

const sig = (value: string): string => createHash('sha256').update(value).digest('hex')

describe('sealed install packages', () => {
  const root = sig('root')
  const bee = sig('bee')
  const dependency = sig('dependency')

  it('accepts a transitively declared package boundary', () => {
    expect(validateSealedPackage(root, {
      layers: [root],
      bees: [bee],
      dependencies: [dependency],
      beeDeps: { [bee]: [dependency] },
    })).toEqual({ valid: true, errors: [] })
  })

  it('rejects a dependency outside the package boundary', () => {
    const external = sig('external')
    const result = validateSealedPackage(root, {
      layers: [root],
      bees: [bee],
      dependencies: [],
      beeDeps: { [bee]: [external] },
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(`bee ${bee} requires undeclared dependency: ${external}`)
  })

  it('requires the package identity to be an included root layer', () => {
    const result = validateSealedPackage(root, { layers: [], bees: [], dependencies: [] })
    expect(result.errors).toContain('package root signature is not declared in layers')
  })

  it('accepts only bytes whose SHA-256 signature matches the manifest', async () => {
    const bytes = new TextEncoder().encode('sealed content')
    expect(await bytesMatchSignature(bytes, sig('sealed content'))).toBe(true)
    expect(await bytesMatchSignature(bytes, sig('substituted content'))).toBe(false)
  })
})
