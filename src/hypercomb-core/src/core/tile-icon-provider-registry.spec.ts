import { afterEach, describe, expect, it, vi } from 'vitest'
import { IconProviderRegistry, type TileIconProvider } from './tile-icon-provider-registry.js'

const provider = (owner: string): TileIconProvider => ({
  name: 'view:workflow',
  owner,
  svgMarkup: '<svg />',
})

describe('IconProviderRegistry duplicate registration', () => {
  afterEach(() => vi.restoreAllMocks())

  it('silently keeps the first registration from the same signed owner', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const registry = new IconProviderRegistry()

    registry.add(provider('@diamondcoreprocessor.com/visual-bee-icons'))
    registry.add(provider('@diamondcoreprocessor.com/visual-bee-icons'))

    expect(registry.all()).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns when different owners compete for the same public name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const registry = new IconProviderRegistry()

    registry.add(provider('@diamondcoreprocessor.com/visual-bee-icons'))
    registry.add(provider('@example.com/other-icons'))

    expect(registry.all()).toHaveLength(1)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[0]).toContain('conflicting name "view:workflow"')
  })
})
