// commands/view-entrance.spec.ts — where a branch-scoped view is entered.
//
// jwize 2026-11-08: "You enter in webview from the page you enter and you can
// navigate around … sub = sub, root = root." The page you click the icon on
// is the page the site opens at; only a cell with no page of its own climbs,
// and then to the nearest page above it.

import { beforeEach, describe, expect, it } from 'vitest'
import type { VisualBeeDescriptor } from './visual-bee-registry.js'

/** Layers by path; a cell carries the site when its layer has a `website` slot. */
let layers: Map<string, Record<string, unknown> | null>
const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: () => void 0,
  whenReady: () => void 0,
}
const { resolveViewEntrance } = await import('./view-entrance.js')

const SIG = 'a'.repeat(64)
const website = { view: 'website', scope: 'branch', slot: 'website', decorationKind: 'visual:website:page' } as unknown as VisualBeeDescriptor
const postit = { view: 'postit', scope: 'node', decorationKind: 'visual:postit:note' } as unknown as VisualBeeDescriptor

beforeEach(() => {
  layers = new Map()
  services.set('@diamondcoreprocessor.com/HistoryService', {
    sign: async (l: { explorerSegments?: () => readonly string[] }) => (l.explorerSegments?.() ?? []).join('/'),
    currentLayerAt: async (sig: string) => layers.get(sig) ?? null,
  })
  services.set('@hypercomb.social/Store', { getResource: async () => null })
})

describe('resolveViewEntrance', () => {
  it('a sub page that carries a page is entered as itself, not as the root', async () => {
    layers.set('site', { website: [SIG] })
    layers.set('site/about', { website: [SIG] })
    expect(await resolveViewEntrance(website, ['site', 'about'])).toEqual(['site', 'about'])
  })

  it('the root is entered as the root', async () => {
    layers.set('site', { website: [SIG] })
    expect(await resolveViewEntrance(website, ['site'])).toEqual(['site'])
  })

  it('a member with no page of its own opens on the NEAREST page above it', async () => {
    layers.set('site', { website: [SIG] })
    layers.set('site/about', { website: [SIG] })
    layers.set('site/about/team', { name: 'team' })
    expect(await resolveViewEntrance(website, ['site', 'about', 'team'])).toEqual(['site', 'about'])
  })

  it('a member under a root that alone carries the page opens on the root', async () => {
    layers.set('site', { website: [SIG] })
    layers.set('site/about', { name: 'about' })
    expect(await resolveViewEntrance(website, ['site', 'about'])).toEqual(['site'])
  })

  it('nothing carrying the view, or a cold read, opens right here', async () => {
    expect(await resolveViewEntrance(website, ['site', 'about'])).toEqual(['site', 'about'])
  })

  it('a node-scoped view never climbs', async () => {
    layers.set('site', { website: [SIG] })
    expect(await resolveViewEntrance(postit, ['site', 'note'])).toEqual(['site', 'note'])
  })
})
