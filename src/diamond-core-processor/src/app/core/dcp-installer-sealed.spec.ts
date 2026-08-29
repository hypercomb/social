import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { validateInstallManifest } from './dcp-installer.service'

const sig = (value: string): string => createHash('sha256').update(value).digest('hex')

describe('DCP sealed package acceptance', () => {
  const root = sig('root')
  const bee = sig('bee')
  const dependency = sig('dependency')

  it('accepts a complete package', () => {
    expect(validateInstallManifest(root, {
      layers: [root], bees: [bee], dependencies: [dependency],
      beeDeps: { [bee]: [dependency] },
    })).toEqual([])
  })

  it('rejects dependencies outside the package', () => {
    const external = sig('external')
    expect(validateInstallManifest(root, {
      layers: [root], bees: [bee], dependencies: [],
      beeDeps: { [bee]: [external] },
    })).toContain(`bee ${bee} requires undeclared dependency: ${external}`)
  })

  it('rejects a manifest that does not contain its package root', () => {
    expect(validateInstallManifest(root, {
      layers: [], bees: [], dependencies: [],
    })).toContain('package root is not declared in layers')
  })
})
