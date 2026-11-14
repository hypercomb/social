// manage-base.navigation.spec.ts — the managed site door stands at its site
// with the REAL Navigation, loaded the way the shim's boot loads it (ioc.web,
// then navigation, nothing else). manage-base.spec.ts hands in a stand-in, so
// it could not see that the framework-free shell never registered the
// CompletionUtility the real setUrlBase reads: every card page died at boot
// with "Cannot read properties of undefined (reading 'normalize')".

import { afterEach, describe, expect, it } from 'vitest'

describe('standAtManagedSite — with the shell’s own Navigation', () => {
  afterEach(() => { window.history.replaceState(null, '', '/') })

  it('sets the base and leaves the address at the site, without throwing', async () => {
    await import('@hypercomb/runtime/ioc.web')
    await import('@hypercomb/runtime/navigation')
    const { standAtManagedSite } = await import('./manage-base')
    const navigation = window.ioc.get<{
      setUrlBase: (s: readonly string[]) => void
      urlSegments: (s: readonly string[]) => readonly string[]
    }>('@hypercomb.social/Navigation')
    expect(navigation).toBeDefined()

    window.history.replaceState(null, '', '/@hypercomb')
    expect(standAtManagedSite({ lineage: 'business-card' }, navigation)).toEqual(['business-card'])
    expect(location.pathname).toBe('/')
    // The base took: a link to the site's own tile drops the host-implied part.
    expect(navigation!.urlSegments(['business-card', 'about'])).toEqual(['about'])
  })
})
