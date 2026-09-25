import { describe, expect, it } from 'vitest'

import { siteLayerReferences, sitePageReferences, siteResourceReferences } from './site-references.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const D = 'd'.repeat(64)
const E = 'e'.repeat(64)
const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

describe('selected site reference closure', () => {
  it('keeps a scalar child-list role through its resource meta incidence', () => {
    const envelope = { meta: 1, resource: B, relation: 'children' }
    expect(siteLayerReferences({ name: 'Garden', children: A }))
      .toEqual([{ sig: A, kind: 'resource', role: 'child-list' }])
    expect(siteResourceReferences(bytes(envelope), 'child-list'))
      .toEqual([{ sig: B, kind: 'resource', role: 'child-list' }])
    expect(siteResourceReferences(bytes([C, D]), 'child-list'))
      .toEqual([{ sig: C, kind: 'layer' }, { sig: D, kind: 'layer' }])
    expect(siteLayerReferences(envelope))
      .toEqual([{ sig: B, kind: 'resource', role: 'child-list' }])
  })

  it('follows named nested resources without mining hash runs from prose or identities', () => {
    const record = { imageSig: A, small: { image: B }, link: `/@resource/${C}`,
      pages: { home: E }, targetSig: D, description: `An example ${D} in prose` }
    expect(siteResourceReferences(bytes(record))).toEqual([
      { sig: E, kind: 'resource', role: 'html' },
      { sig: C, kind: 'resource' },
      { sig: B, kind: 'resource' },
      { sig: A, kind: 'resource' },
    ])
    expect(siteResourceReferences(bytes({ imageSig: { image: A } }))).toBeNull()
    expect(siteResourceReferences(bytes({ refs: ['not-a-signature'] }))).toBeNull()
  })

  it('walks a page decoration body even when it also declares refs', () => {
    const record = { kind: 'visual:website:page', refs: [A], payload: { htmlSig: B } }
    expect(siteResourceReferences(bytes(record))).toEqual([
      { sig: B, kind: 'resource', role: 'html' }, { sig: A, kind: 'resource' },
    ])
    expect(siteResourceReferences(bytes({ kind: 'group', refs: [D] }))).toEqual([])
  })

  it('recognizes the page renderer URL forms and refuses unsupported signature URLs', () => {
    const html = `<link href="resource:${A}/chrome.css"><img src='${B}'>`
      + `<img data-src="/@resource/${C}/preview.png">`
    expect(sitePageReferences(new TextEncoder().encode(html))).toEqual([
      { sig: A, kind: 'resource' }, { sig: C, kind: 'resource' },
      { sig: B, kind: 'resource' },
    ])
    expect(sitePageReferences(new TextEncoder().encode(`<img src="${A}/wrong.png">`))).toBeNull()
    expect(sitePageReferences(new TextEncoder().encode('<img src="resource:invalid">'))).toBeNull()
  })
})
