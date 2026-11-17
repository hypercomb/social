// composed-parts-reader.spec.ts — the live reader of a tile's composed parts:
// each answer comes from the service that owns it, and a service that is not
// here is an empty answer, never a throw.

import { Blob as NodeBlob } from 'node:buffer'
import { beforeEach, describe, expect, it } from 'vitest'
import { SITE_VIEW_IOC_KEY, TRAITS_IOC_KEY } from '@hypercomb/core'
import { hiveParts } from './composed-parts-reader.js'
import { HIVE_TREE_READER_IOC_KEY } from './hive-tree-reader.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')

const registrations = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = { get: (key: string) => registrations.get(key) }

const SITE_VIEW_DRONE = '@diamondcoreprocessor.com/SiteViewDrone'
const STORE = '@hypercomb.social/Store'
const HISTORY = '@diamondcoreprocessor.com/HistoryService'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
// The test environment's Blob has no text() or arrayBuffer(): the store's answers are Node's.
const Blob = NodeBlob as unknown as typeof globalThis.Blob

beforeEach(() => registrations.clear())

describe('the live reader of composed parts', () => {
  it('answers nothing, and never throws, when no service is here', async () => {
    const reader = hiveParts()
    expect(await reader.tile(['card'])).toBeNull()
    expect(await reader.pageSig(['card'])).toBeNull()
    expect(await reader.traits(['card'])).toEqual([])
    expect(await reader.card(['card'])).toBeNull()
    expect(await reader.text(sig(1))).toBeNull()
    expect((await reader.held([sig(1)])).size).toBe(0)
    expect(reader.stated('<p>no traits</p>')).toEqual([])
  })

  it('answers nothing when a service throws', async () => {
    const fails = async (): Promise<never> => { throw new Error('not now') }
    registrations.set(HIVE_TREE_READER_IOC_KEY, { readNode: fails })
    registrations.set(SITE_VIEW_DRONE, { resolvePageSig: fails })
    registrations.set(TRAITS_IOC_KEY, { resolveAt: fails })
    registrations.set(STORE, { getResource: fails, getResourceResolvedLocal: fails })
    const reader = hiveParts()
    expect(await reader.tile(['card'])).toBeNull()
    expect(await reader.pageSig(['card'])).toBeNull()
    expect(await reader.traits(['card'])).toEqual([])
    expect(await reader.text(sig(1))).toBeNull()
    expect((await reader.held([sig(1)])).size).toBe(0)
  })

  it('reads a tile with its content: its children with their heads, and its files', async () => {
    const asked: unknown[] = []
    registrations.set(HIVE_TREE_READER_IOC_KEY, {
      readNode: async (segments: readonly string[], options?: { withContent?: boolean }) => {
        asked.push([segments, options])
        return segments[0] === 'card'
          ? { ok: true, layerSig: sig(9), children: [{ name: 'back', sig: sig(2) }, { name: 'front' }], files: [{ name: 'main.js', sig: sig(3), size: 12 }] }
          : { ok: false }
      },
    })
    const reader = hiveParts()
    expect(await reader.tile(['card'])).toEqual({
      children: [{ name: 'back', sig: sig(2) }, { name: 'front' }],
      files: [{ name: 'main.js', sig: sig(3), size: 12 }],
    })
    expect(asked).toEqual([[['card'], { withContent: true }]])
    expect(await reader.tile(['nowhere'])).toBeNull()
  })

  it('asks the website view for the page: the one registered at load before the one registered on its first heartbeat', async () => {
    registrations.set(SITE_VIEW_IOC_KEY, { resolvePageSig: async () => sig(2) })
    expect(await hiveParts().pageSig(['card'])).toBe(sig(2))
    registrations.set(SITE_VIEW_DRONE, { resolvePageSig: async () => sig(1) })
    expect(await hiveParts().pageSig(['card'])).toBe(sig(1))
    registrations.set(SITE_VIEW_DRONE, { resolvePageSig: async () => 'not a signature' })
    expect(await hiveParts().pageSig(['card'])).toBeNull()
  })

  it('asks the trait provider what the tile\'s traits resolve to', async () => {
    const resolved = [{ word: 'header', rung: 'miss' }]
    registrations.set(TRAITS_IOC_KEY, { resolveAt: async (segments: readonly string[]) => segments.join('/') === 'site' ? resolved : [] })
    expect(await hiveParts().traits(['site'])).toEqual(resolved)
  })

  // The card record is read as the card page reads it (files/card-commit.ts
  // cardRecordAt), through the tile's own decorations.
  describe('the card of a tile', () => {
    const CARD = sig(7), OTHER = sig(6)
    const records: Record<string, unknown> = {
      [OTHER]: { kind: 'visual:website:page', payload: { htmlSig: sig(50) } },
      [CARD]: { kind: 'card:data', payload: { dataSig: sig(41), themeSig: sig(42) }, refs: [sig(99)] },
    }
    const asked: unknown[] = []
    const wearing = (decorations: readonly string[]): void => {
      asked.length = 0
      registrations.set(STORE, { getResource: async (wanted: string) => wanted in records ? new Blob([JSON.stringify(records[wanted])]) : null })
      registrations.set(HISTORY, {
        sign: async (lineage: { explorerSegments?: () => readonly string[] }) => { asked.push(lineage.explorerSegments?.()); return 'here' },
        currentLayerAt: async () => ({ decorations }),
      })
    }

    it('is the kind of the record and its payload alone: no refs, no signature', async () => {
      wearing([OTHER, CARD])
      const card = await hiveParts().card(['business-card'])
      expect(card).toEqual({ kind: 'card:data', payload: { dataSig: sig(41), themeSig: sig(42) } })
      expect(Object.keys(card!)).toEqual(['kind', 'payload'])
      expect(asked).toEqual([['business-card']])
    })

    it('is nothing when the tile wears no card, or the read fails', async () => {
      wearing([OTHER])
      expect(await hiveParts().card(['business-card'])).toBeNull()
      wearing([OTHER, CARD])
      registrations.set(HISTORY, { sign: async () => 'here', currentLayerAt: async () => { throw new Error('not now') } })
      expect(await hiveParts().card(['business-card'])).toBeNull()
    })
  })

  it('reads text through the store', async () => {
    registrations.set(STORE, { getResource: async (wanted: string) => wanted === sig(1) ? new Blob(['<p>page</p>']) : null })
    const reader = hiveParts()
    expect(await reader.text(sig(1))).toBe('<p>page</p>')
    expect(await reader.text(sig(2))).toBeNull()
  })

  it('says what is held from this device only, and a picture by its first bytes', async () => {
    registrations.set(STORE, {
      // Listing what a page names must never reach a host.
      getResource: async () => { throw new Error('held() asked a host') },
      getResourceResolvedLocal: async (wanted: string) =>
        wanted === sig(1) ? new Blob([PNG]) : wanted === sig(2) ? new Blob(['body{}']) : null,
    })
    const held = await hiveParts().held([sig(1), sig(2), sig(3)])
    expect([...held]).toEqual([[sig(1), { size: PNG.length, picture: true }], [sig(2), { size: 6, picture: false }]])
  })

  it('holds nothing when the store cannot read this device alone', async () => {
    registrations.set(STORE, { getResource: async () => new Blob(['x']) })
    expect((await hiveParts().held([sig(1)])).size).toBe(0)
  })

  it('reads the traits a page states, in document order, one per word', () => {
    const reader = hiveParts()
    const page = '<!doctype html><html><body><header data-hc-trait="header">mine</header><main data-hc-trait="hero"></main><footer data-hc-trait="Header"></footer></body></html>'
    expect(reader.stated(page)).toEqual(['header', 'hero'])
    expect(reader.stated('<!doctype html><html><body><header>mine</header></body></html>')).toEqual([])
  })

  // The draw replaces the element of a filled trait and never asks for a
  // trait stated inside it (website/trait-seat.ts seatFillers).
  it('leaves out a trait stated inside one that is filled, as the draw does', () => {
    const reader = hiveParts()
    const page = '<!doctype html><html><body><header data-hc-trait="header"><img data-hc-trait="logo"></header><footer data-hc-trait="footer"></footer></body></html>'
    expect(reader.stated(page)).toEqual(['header', 'logo', 'footer'])
    expect(reader.stated(page, () => false)).toEqual(['header', 'logo', 'footer'])
    expect(reader.stated(page, word => word === 'header')).toEqual(['header', 'footer'])
    // Filled itself, the inner one is still asked for while the outer one is not filled.
    expect(reader.stated(page, word => word === 'logo')).toEqual(['header', 'logo', 'footer'])
    // Stated again outside the filled one: still a trait of the drawn page.
    const again = page.replace('<footer data-hc-trait="footer">', '<footer data-hc-trait="logo">')
    expect(reader.stated(again, word => word === 'header')).toEqual(['header', 'logo'])
  })
})
