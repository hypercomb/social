// share-link.drone.spec.ts — ONE definition of mobile for the share gesture.
//
// The drone used to keep a private media-query copy of the phone predicate
// (`(pointer: coarse)` AND the width/height query) that ignored the
// `/mobile on|off` override: `/mobile on` on a desktop gave the deck, the bar
// and the rails but left share on the desktop address-link path, and
// `/mobile off` on a phone could not get share OFF the publish path. It now
// reads MobileModeService through IoC, so the override drives share too
// (documentation/mobile-rails-projection.md §9).
//
// window.ioc is stubbed BEFORE the module import (the drone self-registers at
// load). The two backends are mocked at their module seams: what is under
// test is WHICH one a tap reaches, not what they do.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const seams = vi.hoisted(() => ({
  hostCurrentBranch: vi.fn(async (): Promise<void> => undefined),
  deliverLink: vi.fn(async (): Promise<'copied'> => 'copied'),
}))
vi.mock('./host-gesture.js', () => ({ hostCurrentBranch: seams.hostCurrentBranch }))
vi.mock('./deliver-link.js', () => ({ deliverLink: seams.deliverLink }))
vi.mock('../commands/decoration-kind-index.js', () => ({ kindsForLabel: () => [] }))

const mobile = { active: false }
const services: Record<string, unknown> = {
  '@diamondcoreprocessor.com/MobileMode': mobile,
  '@hypercomb.social/IconProviderRegistry': { add: () => void 0 },
  '@hypercomb.social/Lineage': { explorerSegments: () => ['docs', 'guide'] },
}
;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (k: string) => services[k],
}

// The OLD predicate answered "phone" from these two queries alone. They say
// "yes" for the whole file, so the only thing that can route a tap is the
// service — exactly the drift the override exposed.
;(window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
  matches: true,
  media: query,
  addEventListener: () => void 0,
  removeEventListener: () => void 0,
})

const { ShareLinkDrone } = await import('./share-link.drone.js')

let drone: InstanceType<typeof ShareLinkDrone>
let activity: { message: string }[]

const tap = async (label = 'intro'): Promise<void> => {
  EffectBus.emit('tile:action', { action: 'share-link', label })
  await new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  EffectBus.clear()
  seams.hostCurrentBranch.mockClear()
  seams.deliverLink.mockClear()
  mobile.active = false
  services['@diamondcoreprocessor.com/MobileMode'] = mobile
  activity = []
  EffectBus.on<{ message: string }>('activity:log', p => activity.push(p))
  drone = new ShareLinkDrone()
})

afterEach(() => drone.markDisposed())

describe('share-link — which backend a tap reaches', () => {
  it('desktop (MobileMode off): mints the name-first address and delivers it — even though the media queries say "phone"', async () => {
    await tap('intro')
    expect(seams.hostCurrentBranch).not.toHaveBeenCalled()
    expect(seams.deliverLink).toHaveBeenCalledTimes(1)
    expect(seams.deliverLink).toHaveBeenCalledWith(`${window.location.origin}/docs/guide/[intro]`, 'intro')
    expect(activity.map(a => a.message)).toEqual([`link copied — ${window.location.origin}/docs/guide/[intro]`])
  })

  it('phone (MobileMode on): share means publish — the address link is never minted', async () => {
    mobile.active = true
    await tap('intro')
    expect(seams.hostCurrentBranch).toHaveBeenCalledTimes(1)
    expect(seams.deliverLink).not.toHaveBeenCalled()
    expect(activity).toHaveLength(0)
  })

  it('the override is honoured live — the service is read on every tap, not cached', async () => {
    await tap('a')
    mobile.active = true
    await tap('b')
    mobile.active = false
    await tap('c')
    expect(seams.deliverLink).toHaveBeenCalledTimes(2)
    expect(seams.hostCurrentBranch).toHaveBeenCalledTimes(1)
  })

  it('no MobileModeService registered yet = not a phone (the desktop path, never a throw)', async () => {
    delete services['@diamondcoreprocessor.com/MobileMode']
    await tap('intro')
    expect(seams.deliverLink).toHaveBeenCalledTimes(1)
    expect(seams.hostCurrentBranch).not.toHaveBeenCalled()
  })

  it('percent-encodes every segment and the bracketed selection', async () => {
    services['@hypercomb.social/Lineage'] = { explorerSegments: () => ['my docs', 'guide/1'] }
    await tap('a b')
    expect(seams.deliverLink).toHaveBeenCalledWith(`${window.location.origin}/my%20docs/guide%2F1/[a%20b]`, 'a b')
    services['@hypercomb.social/Lineage'] = { explorerSegments: () => ['docs', 'guide'] }
  })

  it('ignores other actions and a blank label', async () => {
    EffectBus.emit('tile:action', { action: 'delete', label: 'intro' })
    EffectBus.emit('tile:action', { action: 'share-link', label: '   ' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(seams.deliverLink).not.toHaveBeenCalled()
    expect(seams.hostCurrentBranch).not.toHaveBeenCalled()
  })
})
