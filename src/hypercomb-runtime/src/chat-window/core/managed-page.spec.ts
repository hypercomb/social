// managed-page.spec.ts — the chat knows a managed site door the way the shim
// does: a <script id="hc-manage"> record naming a lineage. On that page the
// owner's grant is full; on every other page the participant's own grant is
// read exactly as core reads it.

import { afterEach, describe, expect, it } from 'vitest'
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
}

afterEach(() => { document.getElementById('hc-manage')?.remove() })

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
    document.getElementById('hc-manage')?.remove()
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
    expect(MANAGED_PAGE_GRANT).toEqual({ reach: 'destructive', scope: 'network' })
    expect('granted' in MANAGED_PAGE_GRANT).toBe(false)
  })
})
