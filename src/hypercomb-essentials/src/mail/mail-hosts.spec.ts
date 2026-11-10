// mail/mail-hosts.spec.ts — mail comes from the hosts you carry: the Home Domain first, then Your
// Network, each once; a hive with no host has nothing to ask.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const carried = vi.hoisted(() => ({ zones: [] as string[], fail: false }))
vi.mock('../sharing/community-hosts.js', async importOriginal => {
  const real = await importOriginal<typeof import('../sharing/community-hosts.js')>()
  return {
    ...real,
    listCommunityHosts: async () => { if (carried.fail) throw new Error('no store'); return [...carried.zones] },
  }
})

import { mailHostZones, ownHostZone } from './mail-hosts.js'

const OWN_HOST_KEY = 'hc:nostrmesh:self-domain'

describe('mailHostZones', () => {
  beforeEach(() => { carried.zones = []; carried.fail = false; localStorage.removeItem(OWN_HOST_KEY) })
  afterEach(() => { localStorage.removeItem(OWN_HOST_KEY) })

  it('is empty when the participant carries no host — no host is named in code', async () => {
    expect(await mailHostZones()).toEqual([])
  })

  it('puts the Home Domain first, then Your Network, each zone once', async () => {
    localStorage.setItem(OWN_HOST_KEY, 'https://Mail.Example.org/')
    carried.zones = ['hypercomb.com', 'mail.example.org', 'content.other.example']
    expect(ownHostZone()).toBe('mail.example.org')
    expect(await mailHostZones()).toEqual(['mail.example.org', 'hypercomb.com', 'other.example'])
  })

  it('drops what is not a zone and survives a pool that cannot be read', async () => {
    localStorage.setItem(OWN_HOST_KEY, 'not a host')
    carried.zones = ['', 'hypercomb.com', 'also not a host!']
    expect(await mailHostZones()).toEqual(['hypercomb.com'])
    carried.fail = true
    expect(await mailHostZones()).toEqual([])
  })
})
