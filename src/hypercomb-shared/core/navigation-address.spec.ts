// The address bar never carries %20 — words are spelled with hyphens, and the
// explorer still gets back the raw names it wrote.

import { beforeEach, describe, expect, it } from 'vitest'

const services: Record<string, unknown> = {}
;(globalThis as any).register = (key: string, value: unknown) => { services[key] = value }
;(globalThis as any).get = (key: string) => services[key]

const { addressSegment, normalizeCell } = await import('@hypercomb/core')
services['@hypercomb.social/CompletionUtility'] = { normalize: (s: string) => normalizeCell(s) }

const { Navigation } = await import('./navigation')

describe('addressSegment', () => {
  it('turns every run of whitespace into one hyphen', () => {
    expect(addressSegment('Big  Ideas')).toBe('Big-Ideas')
    expect(addressSegment(' q and a ')).toBe('q-and-a')
    expect(addressSegment('a b')).toBe('a-b')
  })
  it('still encodes what a path cannot carry', () => {
    expect(addressSegment('guide/1')).toBe('guide%2F1')
    expect(addressSegment('what?')).toBe('what%3F')
  })
})

describe('Navigation address spelling', () => {
  beforeEach(() => { window.history.replaceState(null, '', '/') })

  it('goRaw writes hyphens, never %20, and segmentsRaw returns the raw names', () => {
    const nav = new Navigation()
    nav.goRaw(['Big Ideas', 'q and a'])
    expect(window.location.pathname).toBe('/Big-Ideas/q-and-a')
    expect(window.location.href).not.toContain('%20')
    expect(nav.segmentsRaw()).toEqual(['Big Ideas', 'q and a'])
  })

  it('an entry that did not carry the names (view-back) still resolves them', () => {
    const nav = new Navigation()
    nav.goRaw(['Big Ideas'])
    window.history.pushState({ hcView: 'x' }, '')
    expect(nav.segmentsRaw()).toEqual(['Big Ideas'])
  })

  it('an arriving %20 address is respelled at once, keeping its names', () => {
    window.history.replaceState(null, '', '/Big%20Ideas/[a,b]')
    const nav = new Navigation()
    expect(window.location.pathname).toBe('/Big-Ideas/[a,b]')
    expect(nav.segmentsRaw()).toEqual(['Big Ideas'])
    expect(nav.getSelections()).toEqual(['a', 'b'])
  })

  it('a spaced name inside an arriving selection is respelled too', () => {
    window.history.replaceState(null, '', '/Big%20Ideas/[a%20b,c]')
    const nav = new Navigation()
    expect(window.location.pathname).toBe('/Big-Ideas/[a-b,c]')
    expect(nav.getSelections()).toEqual(['a-b', 'c'])
  })

  it('a cold hyphen link reads as itself (same place: lineageKey folds both)', () => {
    window.history.replaceState(null, '', '/Big-Ideas')
    expect(new Navigation().segmentsRaw()).toEqual(['Big-Ideas'])
  })
})
