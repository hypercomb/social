import { describe, expect, it } from 'vitest'
import { QuickMenuRegistry } from './quick-menu-registry.service'
import type { QuickMenuDefinition } from './quick-menu.types'

const adopted: QuickMenuDefinition = {
  name: 'my-website', title: 'My website', contexts: ['website'],
  slots: [{ direction: 'centre', label: 'Exit', action: { kind: 'command', command: 'view', args: 'hexagons' } }],
}

describe('quick menu adoption', () => {
  it('activates only the verified saved definition and lets it claim a shipped context', async () => {
    const registry = new QuickMenuRegistry()
    expect(registry.forContext('website').name).toBe('website')
    expect(await registry.adopt(adopted)).toBe(false)
    expect(registry.byName('my-website')).toBeUndefined()
    registry.setWriter(async () => ({ ...adopted, title: 'Verified revision' }))
    expect(await registry.adopt(adopted)).toBe(true)
    expect(registry.byName('my-website')?.title).toBe('Verified revision')
    expect(registry.forContext('website').name).toBe('my-website')
  })
})
