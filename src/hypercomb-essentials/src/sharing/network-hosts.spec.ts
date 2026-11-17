// The hosts a model's network reads ask. A managed site door asks its own
// site; every other page's address stays out of the list.

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./community-hosts.js', () => ({ listCommunityHosts: async () => [] }))

import { networkHosts } from './network-hosts.js'

const markDoor = (): void => {
  const record = document.createElement('script')
  record.type = 'application/json'
  record.id = 'hc-manage'
  record.textContent = JSON.stringify({ lineage: 'business-card' })
  document.head.appendChild(record)
}

afterEach(() => { document.getElementById('hc-manage')?.remove() })

describe('network hosts', () => {
  it('a managed site door asks its own site', async () => {
    markDoor()
    expect(await networkHosts()).toContain(location.host.toLowerCase())
  })

  it('any other page never puts its own address in the list', async () => {
    expect(await networkHosts()).not.toContain(location.host.toLowerCase())
  })
})
