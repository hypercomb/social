// managed-page.spec.ts — the chat knows a managed site door the way the shim
// does: a <script id="hc-manage"> record naming a lineage. On that page the
// owner's grant is full; on every other page the participant's own grant is
// read exactly as core reads it.

import { afterEach, describe, expect, it } from 'vitest'
import { forgetManagedPageForTests } from './managed-page'
import { DEFAULT_MACHINE_GRANT, type MachineGrant } from '@hypercomb/core'
import { chatMachineGrant, managedPage, MANAGED_PAGE_GRANT } from './managed-page'

const HEAD = 'a'.repeat(64)
const KEY = 'b'.repeat(64)

const mark = (record: unknown): void => {
  const script = document.createElement('script')
  script.id = 'hc-manage'
  script.type = 'application/json'
  script.textContent = typeof record === 'string' ? record : JSON.stringify(record)
  document.head.appendChild(script)
  forgetManagedPageForTests()
}

afterEach(() => { document.getElementById('hc-manage')?.remove(); forgetManagedPageForTests() })

describe('only the worker’s record counts', () => {
  const plant = (where: HTMLElement, tag = 'script', type = 'application/json'): HTMLElement => {
    const el = document.createElement(tag)
    el.id = 'hc-manage'
    if (tag === 'script') (el as HTMLScriptElement).type = type
    el.textContent = JSON.stringify({ lineage: 'business-card' })
    where.appendChild(el)
    return el
  }

  it('is a JSON script directly in <head>: one in <body>, another element, or another type is not a record', () => {
    // A website page mounted inline on a normal hive can plant markup in the body.
    plant(document.body); forgetManagedPageForTests()
    expect(managedPage()).toBeNull()
    document.getElementById('hc-manage')?.remove()
    plant(document.head, 'div'); forgetManagedPageForTests()
    expect(managedPage()).toBeNull()
    document.getElementById('hc-manage')?.remove()
    plant(document.head, 'script', 'text/javascript'); forgetManagedPageForTests()
    expect(managedPage()).toBeNull()
  })

  it('is the page’s answer taken once: a record planted after it was asked changes nothing', () => {
    forgetManagedPageForTests()
    expect(managedPage()).toBeNull()                  // asked: no record
    plant(document.head)                               // planted later, by page script
    expect(managedPage()).toBeNull()
  })
})

describe('a managed site door', () => {
  it('is read from the page record: lineage, title, publisher and head', () => {
    mark({ lineage: 'business-card', title: 'Business card', publisher: KEY, head: HEAD })
    expect(managedPage()).toEqual({ lineage: 'business-card', title: 'Business card', publisher: KEY, head: HEAD })
  })

  it('takes the lineage as the title when none is given, and drops a field of the wrong shape', () => {
    mark({ lineage: 'business-card', publisher: 'not-a-key', head: 42 })
    expect(managedPage()).toEqual({ lineage: 'business-card', title: 'business-card', publisher: null, head: null })
  })

  it('is no managed page without a record, without a lineage, or with a record that does not parse', () => {
    expect(managedPage()).toBeNull()
    mark({ title: 'no lineage' })
    expect(managedPage()).toBeNull()
    document.getElementById('hc-manage')?.remove(); forgetManagedPageForTests()
    mark('{not json')
    expect(managedPage()).toBeNull()
    expect(managedPage(undefined)).toBeNull()
  })
})

describe('the grant the chat works under', () => {
  const live: MachineGrant = { ...DEFAULT_MACHINE_GRANT, granted: [] }

  it('is the participant\'s own, read live, on every other page', () => {
    let reads = 0
    expect(chatMachineGrant(() => { reads++; return live })).toBe(live)
    expect(reads).toBe(1)
  })

  it('is the owner\'s full grant on a managed site door: the far end of both ladders, no roster asked', () => {
    mark({ lineage: 'business-card' })
    expect(chatMachineGrant(() => live)).toBe(MANAGED_PAGE_GRANT)
    // Every change, nothing that leaves the replica: the community is the owner's Publish.
    expect(MANAGED_PAGE_GRANT).toEqual({ reach: 'destructive', scope: 'hive' })
    expect('granted' in MANAGED_PAGE_GRANT).toBe(false)
  })
})
