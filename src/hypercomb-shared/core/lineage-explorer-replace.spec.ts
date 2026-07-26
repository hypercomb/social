// hypercomb-shared/core/lineage-explorer-replace.spec.ts
//
// Reading a website must not grow the browser back-stack. Every page a reader
// clicks inside a site moves the explorer, and `explorerEnter`/`explorerUp`
// push a history entry PER SEGMENT — right for hexagon navigation (each step is
// a place the user chose to be), wrong for a site (a dozen pages read = a dozen
// back presses to escape). `explorerReplace` is the site-reading counterpart:
// one step, one replaceState, so the whole session collapses back to where it
// stood when the site opened and leaving lands on the entrance tile.

import { beforeEach, describe, expect, it, vi } from 'vitest'

interface NavSpy { goRaw: ReturnType<typeof vi.fn>; replaceRaw: ReturnType<typeof vi.fn> }

const load = async (): Promise<{ lineage: any; nav: NavSpy }> => {
  vi.resetModules()
  const nav: NavSpy = { goRaw: vi.fn(), replaceRaw: vi.fn() }
  ;(globalThis as { register?: unknown }).register = (): void => {}
  ;(globalThis as { get?: unknown }).get = (key: string): unknown =>
    key === '@hypercomb.social/Navigation' ? nav : undefined
  const mod = await import('./lineage.js')
  return { lineage: new mod.Lineage(), nav }
}

describe('Lineage.explorerReplace', () => {

  beforeEach(() => { vi.clearAllMocks() })

  it('sets the whole path in one step and REPLACES rather than pushes', async () => {
    const { lineage, nav } = await load()
    lineage.explorerReplace(['revolucion', 'lounge'])
    expect([...lineage.explorerSegments()]).toEqual(['revolucion', 'lounge'])
    expect(nav.replaceRaw).toHaveBeenCalledTimes(1)
    expect(nav.replaceRaw).toHaveBeenCalledWith(['revolucion', 'lounge'])
    expect(nav.goRaw).not.toHaveBeenCalled()
  })

  it('a whole site session costs ONE history entry, not one per page', async () => {
    const { lineage, nav } = await load()
    // entering the site is ordinary navigation — that one push is the entry
    lineage.explorerEnter('revolucion')
    expect(nav.goRaw).toHaveBeenCalledTimes(1)
    // …then the reader walks the site
    for (const page of ['lounge', 'journal', 'humidor', 'flavor-wheel', 'mission']) {
      lineage.explorerReplace(['revolucion', page])
    }
    // …and leaves to the entrance
    lineage.explorerReplace(['revolucion'])
    expect(nav.goRaw).toHaveBeenCalledTimes(1)          // still just the entry
    expect(nav.replaceRaw).toHaveBeenCalledTimes(6)     // every site move replaced
    expect([...lineage.explorerSegments()]).toEqual(['revolucion'])
  })

  it('drops empty and relative segments the way explorerEnter does', async () => {
    const { lineage } = await load()
    lineage.explorerReplace(['revolucion', '', '  ', '.', '..', ' lounge '])
    expect([...lineage.explorerSegments()]).toEqual(['revolucion', 'lounge'])
  })

  it('going to the hive root clears the path', async () => {
    const { lineage, nav } = await load()
    lineage.explorerReplace(['revolucion', 'lounge'])
    lineage.explorerReplace([])
    expect([...lineage.explorerSegments()]).toEqual([])
    expect(nav.replaceRaw).toHaveBeenLastCalledWith([])
  })
})
