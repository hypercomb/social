// document-view-links.spec.ts — an external link leaves in a new tab, and
// only there: no opener, no referrer, and the shell's own document stays.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { openExternalLink } from './document-view-links.js'

describe('openExternalLink on the web', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('opens a new tab with no opener and no referrer, and leaves this document where it is', () => {
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this) })
    const open = vi.spyOn(window, 'open')
    openExternalLink('https://games.jwize.com/arkanoid')
    expect(clicked).toHaveLength(1)
    expect(clicked[0]!.href).toBe('https://games.jwize.com/arkanoid')
    expect(clicked[0]!.target).toBe('_blank')
    expect(clicked[0]!.rel).toBe('noopener noreferrer')
    expect(open).not.toHaveBeenCalled()
  })
})
