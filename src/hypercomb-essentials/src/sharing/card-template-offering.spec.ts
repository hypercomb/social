import { describe, expect, it, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { cardTemplateLeaf, cardTemplateLocation, setCardTemplateOffering,
  type CardTemplateOfferDeps } from './card-template-offering.js'
import type { HiveIndexResult, PutHiveResult } from './hive-pointer.js'

const PUBKEY = 'b'.repeat(64)
const HOST = 'jwize.com'
const encoder = new TextEncoder()
const exact = (value: Uint8Array): ArrayBuffer =>
  value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
const hash = (value: Uint8Array): Promise<string> => SignatureService.sign(exact(value))

const setup = async (opts: { picture?: boolean } = {}) => {
  const theme = encoder.encode(JSON.stringify({ label: 'Contour', note: 'lines from your name', concept: 'contour' }))
  const themeSig = await hash(theme)
  const picture = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])
  const pictureSig = await hash(picture)
  const held = new Map<string, Uint8Array>([[themeSig, theme], [pictureSig, picture]])
  const store = { getResource: async (sig: string) => held.has(sig)
    ? { size: held.get(sig)!.byteLength, arrayBuffer: async () => exact(held.get(sig)!) } as Blob : null }
  let content: Record<string, unknown> = { v: 1, roots: { site: 'c'.repeat(64) }, doors: {}, offerings: {}, future: { kept: true } }
  const order: string[] = []
  const uploaded: string[] = []
  const readIndex = vi.fn(async (): Promise<HiveIndexResult> => ({ ok: true, manifest: {
    roots: content['roots'] as Record<string, string>, doors: content['doors'] as Record<string, string[]>,
    offerings: content['offerings'] as Record<string, unknown>,
    createdAt: 1_700_000_000, pubkey: PUBKEY, signedContent: content,
  } } as HiveIndexResult))
  const putIndex = vi.fn(async (host: string, roots: Record<string, string>, doors: Record<string, string[]> = {},
    _replaces = 0, previous?: Record<string, unknown>): Promise<PutHiveResult> => {
    order.push('index')
    expect(host).toBe(HOST)
    content = { ...previous, roots, doors }
    return { ok: true, pubkey: PUBKEY, createdAt: 1_700_000_001 } as PutHiveResult
  })
  const sync = {
    publicHostDomain: () => HOST,
    publishAtoms: async (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) => {
      order.push('stage')
      expect(host).toBe(HOST)
      for (const sig of sigs) { const b = await bytesOf(sig); expect(b && await hash(b)).toBe(sig); uploaded.push(sig) }
      return { ok: true as const, sent: sigs.length, held: 0 }
    },
  }
  const deps: CardTemplateOfferDeps = { store, sync, pubkey: async () => PUBKEY, readIndex, putIndex }
  const template = { key: 'jaime-weise/business-card/template/contour', label: 'Contour', themeSig,
    ...(opts.picture ? { pictureSig } : {}) }
  return { deps, template, themeSig, pictureSig, order, uploaded, content: () => content }
}

describe('offering a card template', () => {
  it('sends the theme and the leaf before the head that names them, then declares it in the signed index', async () => {
    const t = await setup()
    expect(await setCardTemplateOffering(t.template, true, t.deps)).toEqual({ ok: true, state: 'on', host: HOST })
    const leaf = await cardTemplateLeaf(t.template)
    expect(t.order).toEqual(['stage', 'index'])
    expect(t.uploaded).toEqual([t.themeSig, leaf.layerSig, leaf.metaSig])
    const location = await cardTemplateLocation(t.template.key)
    expect(location).toBe(await hash(encoder.encode('themes:card:' + t.template.key)))
    expect((t.content()['offerings'] as Record<string, unknown>)[location]).toEqual({
      meaning: 'themes:card', key: t.template.key, head: leaf.metaSig, title: 'Contour', host: HOST,
    })
    expect(t.content()['future']).toEqual({ kept: true })
  })

  it('the leaf is exactly the shape the host checks', async () => {
    const t = await setup({ picture: true })
    const leaf = await cardTemplateLeaf(t.template)
    expect(JSON.parse(new TextDecoder().decode(leaf.layer))).toEqual({ name: 'card-theme', label: 'Contour', theme: t.themeSig, picture: t.pictureSig })
    expect(JSON.parse(new TextDecoder().decode(leaf.meta))).toEqual({ meta: 1, relation: 'themes:card', layer: leaf.layerSig })
  })

  it('carries a picture when the template has one', async () => {
    const t = await setup({ picture: true })
    expect((await setCardTemplateOffering(t.template, true, t.deps)).ok).toBe(true)
    expect(t.uploaded).toContain(t.pictureSig)
  })

  it('off removes only its own declaration', async () => {
    const t = await setup()
    await setCardTemplateOffering(t.template, true, t.deps)
    const location = await cardTemplateLocation(t.template.key)
    expect(await setCardTemplateOffering(t.template, false, t.deps)).toEqual({ ok: true, state: 'off', host: HOST })
    expect((t.content()['offerings'] as Record<string, unknown>)[location]).toBeUndefined()
    expect(t.order).toEqual(['stage', 'index', 'index'])
  })

  it('refuses without a named host, a theme it holds, or a signing key', async () => {
    const t = await setup()
    const noHost = { ...t.deps, sync: { ...t.deps.sync!, publicHostDomain: () => '' } }
    expect(await setCardTemplateOffering(t.template, true, noHost)).toMatchObject({ ok: false })
    expect(await setCardTemplateOffering({ ...t.template, themeSig: 'd'.repeat(64) }, true, t.deps)).toMatchObject({ ok: false })
    expect(await setCardTemplateOffering(t.template, true, { ...t.deps, pubkey: async () => null })).toMatchObject({ ok: false })
    expect(t.order).toEqual([])
  })
})
