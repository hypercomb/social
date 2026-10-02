// hypercomb-shared/core/url-folder.spec.ts
//
// A hive location is the URL path. A host served in a folder beside another
// build (hypercomb.com's /minimal/) declares the folder as <base href>, and
// navigation reads and writes the hive path under it — at a domain's root,
// with base '/' or none, nothing changes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { folderPath, hivePathname, urlFolder } from './url-folder'

const declare = (href: string | null): void => {
  document.head.querySelectorAll('base').forEach(base => base.remove())
  if (href !== null) document.head.prepend(Object.assign(document.createElement('base'), { href }))
}

afterEach(() => { declare(null); window.history.replaceState(null, '', '/') })

describe('the host\'s folder', () => {
  it('is the page\'s <base href>, or the root when it names none', () => {
    declare(null)
    expect(urlFolder()).toBe('/')
    declare('/')
    expect(urlFolder()).toBe('/')
    declare('/minimal/')
    expect(urlFolder()).toBe('/minimal/')
  })

  it('at the root, hive paths are URL paths', () => {
    declare('/')
    expect(hivePathname('/garden/kitchen')).toBe('/garden/kitchen')
    expect(folderPath('/garden')).toBe('/garden')
    expect(folderPath('/')).toBe('/')
  })

  it('in a folder, the folder is where the page is served, not a place in the hive', () => {
    declare('/minimal/')
    expect(hivePathname('/minimal/')).toBe('/')
    expect(hivePathname('/minimal')).toBe('/')
    expect(hivePathname('/minimal/garden/[a,b]')).toBe('/garden/[a,b]')
    expect(folderPath('/')).toBe('/minimal/')
    expect(folderPath('/garden/kitchen')).toBe('/minimal/garden/kitchen')
    expect(folderPath(hivePathname('/minimal/garden'))).toBe('/minimal/garden')
  })
})

describe('navigation in a folder', () => {
  let Navigation: new () => {
    segments(): string[]
    go(segments: readonly string[]): void
    replace(segments: readonly string[]): void
    goRaw(segments: readonly string[]): void
    replaceSelections(names: string[]): void
    getSelections(): string[]
  }

  beforeEach(async () => {
    vi.resetModules()
    ;(globalThis as { register?: unknown }).register = (): void => {}
    ;(globalThis as { get?: unknown }).get = (key: string): unknown =>
      key === '@hypercomb.social/CompletionUtility' ? { normalize: (s: string) => s.trim().toLowerCase() } : undefined
    ;({ Navigation } = await import('./navigation') as never)
  })

  it('reads the hive path under the folder and writes it back there', () => {
    declare('/minimal/')
    window.history.replaceState(null, '', '/minimal/garden/kitchen')
    const navigation = new Navigation()
    expect(navigation.segments()).toEqual(['garden', 'kitchen'])

    navigation.go(['garden', 'kitchen', 'shelf'])
    expect(location.pathname).toBe('/minimal/garden/kitchen/shelf')
    expect(navigation.segments()).toEqual(['garden', 'kitchen', 'shelf'])

    navigation.replace([])
    expect(location.pathname).toBe('/minimal/')
    expect(navigation.segments()).toEqual([])

    navigation.goRaw(['a b'])
    expect(location.pathname).toBe('/minimal/a%20b')

    navigation.replace(['garden'])
    navigation.replaceSelections(['rose', 'tulip'])
    expect(decodeURIComponent(location.pathname)).toBe('/minimal/garden/[rose,tulip]')
    expect(navigation.getSelections()).toEqual(['rose', 'tulip'])
    navigation.replaceSelections([])
    expect(location.pathname).toBe('/minimal/garden')
  })

  it('at the root, the same calls write the same paths as before', () => {
    declare('/')
    window.history.replaceState(null, '', '/garden')
    const navigation = new Navigation()
    expect(navigation.segments()).toEqual(['garden'])
    navigation.go(['garden', 'kitchen'])
    expect(location.pathname).toBe('/garden/kitchen')
    navigation.replace([])
    expect(location.pathname).toBe('/')
  })
})
