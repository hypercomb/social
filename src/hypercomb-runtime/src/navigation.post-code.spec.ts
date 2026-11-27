// navigation.post-code.spec.ts — the selection reader ignores an entry
// pool's code (documentation/open-entry-pools.md, "The page a phone sees",
// step 1). The code stays in the address bar; read as a tile's name it would
// select a tile nobody has. Every other fragment reads as it did.

import { beforeEach, describe, expect, it } from 'vitest'

const services: Record<string, unknown> = {}
;(globalThis as any).register = (key: string, value: unknown) => { services[key] = value }
;(globalThis as any).get = (key: string) => services[key]

const { normalizeCell } = await import('@hypercomb/core')
services['@hypercomb.social/CompletionUtility'] = { normalize: (s: string) => normalizeCell(s) }

const { Navigation } = await import('./navigation')

const CODE = `#post=${'3f'.repeat(32)}~${'0a'.repeat(16)}`

describe('getSelections and a #post= fragment', () => {
  beforeEach(() => { window.history.replaceState(null, '', '/') })

  it('a code is no selection, and stays in the address bar', () => {
    window.history.replaceState(null, '', `/recipes${CODE}`)
    const nav = new Navigation()
    expect(nav.getSelections()).toEqual([])
    expect(window.location.hash).toBe(CODE)
  })

  it('a path selection still wins over the fragment', () => {
    window.history.replaceState(null, '', `/recipes/[a,b]${CODE}`)
    expect(new Navigation().getSelections()).toEqual(['a', 'b'])
  })

  it('nothing else changes: a fragment that is nearly a code, and the hash forms, read as before', () => {
    const nav = new Navigation()
    window.history.replaceState(null, '', '/#(a,b)')
    expect(nav.getSelections()).toEqual(['a', 'b'])
    window.history.replaceState(null, '', '/#cheese')
    expect(nav.getSelections()).toEqual(['cheese'])
    window.history.replaceState(null, '', `/${CODE.slice(0, -1)}`)
    expect(nav.getSelections()).toHaveLength(1)
  })
})
