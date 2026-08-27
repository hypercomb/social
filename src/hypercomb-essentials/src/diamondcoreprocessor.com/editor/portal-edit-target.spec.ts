import { describe, expect, it } from 'vitest'

import { portalEditTarget } from './portal-edit-target.js'

describe('portalEditTarget', () => {
  it('redirects a reference appearance to the canonical root default', () => {
    expect(portalEditTarget(['sets', 'family'], 'people', ['people'])).toEqual({
      segments: ['people'],
      parentSegments: [],
      cell: 'people',
      throughPortal: true,
    })
  })

  it('keeps an ordinary tile edit in its own lineage', () => {
    expect(portalEditTarget(['project-a'], 'people', null)).toEqual({
      segments: ['project-a', 'people'],
      parentSegments: ['project-a'],
      cell: 'people',
      throughPortal: false,
    })
  })

  it('does not redirect a malformed legacy reference onto the hive root', () => {
    expect(portalEditTarget(['sets'], 'people', [])).toEqual({
      segments: ['sets', 'people'],
      parentSegments: ['sets'],
      cell: 'people',
      throughPortal: false,
    })
  })
})
