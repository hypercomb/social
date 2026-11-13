// manage-base.spec.ts — a managed site door's page stands at its site's own
// tile: the URL base is [lineage], and the /@hypercomb trigger leaves the address.

import { afterEach, describe, expect, it } from 'vitest'
import { managedPath, standAtManagedSite } from './manage-base'

describe('managedPath — the address once the page stands at its site', () => {
  it('drops the trigger, and a redundant leading /<lineage>', () => {
    expect(managedPath('/@hypercomb', 'business-card')).toBe('/')
    expect(managedPath('/@hypercomb/', 'business-card')).toBe('/')
    expect(managedPath('/%40hypercomb', 'business-card')).toBe('/')
    expect(managedPath('/business-card', 'business-card')).toBe('/')
    expect(managedPath('/Business-Card/about', 'business-card')).toBe('/about')
  })

  it('keeps every other path as written', () => {
    expect(managedPath('/', 'business-card')).toBe('/')
    expect(managedPath('/about/team', 'business-card')).toBe('/about/team')
    expect(managedPath('/caf%C3%A9', 'business-card')).toBe('/caf%C3%A9')
  })
})

describe('standAtManagedSite — before the bees mount', () => {
  afterEach(() => { window.history.replaceState(null, '', '/') })

  it('sets the base to [lineage], replaces the trigger, keeps search and hash, and re-reads lineage', () => {
    window.history.replaceState({ kept: 1 }, '', '/@hypercomb?x=1#invite=a/b/c')
    const set: Array<readonly string[]> = []
    let navigated = 0
    const count = (): void => { navigated++ }
    window.addEventListener('navigate', count)
    try {
      const base = standAtManagedSite({ lineage: 'business-card' }, { setUrlBase: s => { set.push([...s]) } })
      expect(base).toEqual(['business-card'])
      expect(set).toEqual([['business-card']])
      expect(location.pathname).toBe('/')
      expect(location.search).toBe('?x=1')
      expect(location.hash).toBe('#invite=a/b/c')
      expect(window.history.state).toEqual({ kept: 1 })
      expect(navigated).toBe(1)
    } finally {
      window.removeEventListener('navigate', count)
    }
  })

  it('does nothing on a page that is not a managed site door', () => {
    window.history.replaceState(null, '', '/@hypercomb')
    const set: unknown[] = []
    expect(standAtManagedSite(null, { setUrlBase: s => { set.push(s) } })).toBeNull()
    expect(standAtManagedSite({ lineage: 'business-card' }, undefined)).toBeNull()
    expect(set).toEqual([])
    expect(location.pathname).toBe('/@hypercomb')
  })
})
