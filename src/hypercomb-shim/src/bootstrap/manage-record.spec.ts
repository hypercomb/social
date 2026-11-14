// manage-record.spec.ts — what a managed site door's page is told, read the
// one way there is, and every field checked.

import { describe, expect, it } from 'vitest'
import { beesOnDisk, manageRecord, MANAGE_LEAVE_HREF, siteDoorZone } from './manage-record'

describe('siteDoorZone — where a site door\'s packages come from', () => {
  it('is the zone root the site door hangs off, never the site door itself', () => {
    expect(siteDoorZone('business-card.jwize.com')).toBe('jwize.com')
    expect(siteDoorZone('business-card.jwize.com:443')).toBe('jwize.com')
    expect(siteDoorZone('BUSINESS-CARD.JWIZE.COM')).toBe('jwize.com')
    // A bare zone is its own root.
    expect(siteDoorZone('jwize.com')).toBe('jwize.com')
  })
})

describe('beesOnDisk — cold is what is on disk', () => {
  it('says no bees where the page cannot read storage at all, never trusting a stamp', async () => {
    localStorage.setItem('hc:shim:installed-package', 'a'.repeat(64))
    try { expect(await beesOnDisk()).toBe(false) } finally { localStorage.removeItem('hc:shim:installed-package') }
  })
})

const pageWith = (text: string | null): Document => {
  const doc = document.implementation.createHTMLDocument('page')
  if (text !== null) {
    const script = doc.createElement('script')
    script.id = 'hc-manage'
    script.type = 'application/json'
    script.textContent = text
    doc.head.appendChild(script)
  }
  return doc
}
const sig = (ch: string): string => ch.repeat(64)

describe('manageRecord', () => {
  it('is null on a page the worker did not mark as managing a site', () => {
    expect(manageRecord(pageWith(null))).toBeNull()
    expect(manageRecord(pageWith('not json'))).toBeNull()
    expect(manageRecord(pageWith(JSON.stringify({ title: 'no lineage' })))).toBeNull()
  })

  it('reads the site, its title, its publisher and its head', () => {
    const record = manageRecord(pageWith(JSON.stringify({ lineage: 'business-card', title: 'Card', publisher: sig('b'), head: sig('c'), writes: 'pluginthematrix.com' })))
    expect(record).toEqual({ lineage: 'business-card', title: 'Card', publisher: sig('b'), head: sig('c'), writes: 'pluginthematrix.com' })
  })

  it('keeps no field that is not the shape it should be', () => {
    const record = manageRecord(pageWith(JSON.stringify({ lineage: 'b', title: 42, publisher: 'nope', head: '<script>', writes: 'https://evil.example/x' })))
    expect(record).toEqual({ lineage: 'b', title: 'b', publisher: null, head: null, writes: null })
    // Where the publish writes is a bare host name; a machine's own, port and all, is one.
    expect(manageRecord(pageWith(JSON.stringify({ lineage: 'b', writes: 'LocalHost:4270' })))?.writes).toBe('localhost:4270')
    expect(manageRecord(pageWith(JSON.stringify({ lineage: 'b' })))?.writes).toBeNull()
  })

  it('names the way back to the website', () => {
    expect(MANAGE_LEAVE_HREF).toBe('/@hypercomb/leave')
  })
})
