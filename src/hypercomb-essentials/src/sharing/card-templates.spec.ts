import { describe, expect, it } from 'vitest'
import { SignatureService, type HostCreation } from '@hypercomb/core'
import { bringCardTemplate, findCardTemplates, parseTemplateHandle } from './card-templates.js'

const encoder = new TextEncoder()
const exact = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
const hash = (b: Uint8Array): Promise<string> => SignatureService.sign(exact(b))
const PUB = 'b'.repeat(64)

/** A host that offers what it is given; its atoms come back by signature, like a real host's. */
const host = async (name: string, templates: { key: string; label: string; meaning?: string; picture?: boolean; leaf?: Record<string, unknown> }[]) => {
  const atoms = new Map<string, Uint8Array>()
  const keep = async (b: Uint8Array) => { const s = await hash(b); atoms.set(s, b); return s }
  const creations: HostCreation[] = []
  for (const t of templates) {
    const themeSig = await keep(encoder.encode(JSON.stringify({ label: t.label, concept: 'contour' })))
    const pictureSig = t.picture ? await keep(new Uint8Array([82, 73, 70, 70, 9])) : undefined
    const payload = await keep(encoder.encode(JSON.stringify(t.leaf ?? { name: 'card-theme', label: t.label, theme: themeSig, ...(pictureSig ? { picture: pictureSig } : {}) })))
    creations.push({ kind: 'host:creation', meaning: t.meaning ?? 'themes:card', key: t.key, location: 'c'.repeat(64),
      pubkey: PUB, title: t.label, host: name, head: 'd'.repeat(64), payload, index: {} })
  }
  return {
    creations: async (h: string) => h === name ? creations : [],
    atom: async (h: string, sig: string) => h === name ? atoms.get(sig) ?? null : null,
    atoms,
  }
}

describe('community card templates', () => {
  it('lists the card templates a host offers, and only those', async () => {
    const h = await host('jwize.com', [
      { key: 'jaime-weise/business-card/template/contour', label: 'Contour' },
      { key: 'studio', label: 'Studio', meaning: 'themes:text' },
      { key: 'x/broken', label: 'Broken', leaf: { name: 'card-theme', label: 'Broken' } },
    ])
    const found = await findCardTemplates({ hosts: async () => ['jwize.com'], creations: h.creations, atom: h.atom })
    expect(found.map(t => [t.host, t.handle, t.label])).toEqual([['jwize.com', 'contour', 'Contour']])
  })

  it('reads a handle, and leaves a route alone', () => {
    expect(parseTemplateHandle('jwize.com:contour')).toEqual({ host: 'jwize.com', handle: 'contour' })
    expect(parseTemplateHandle('Content.PluginTheMatrix.com:Photo')).toEqual({ host: 'pluginthematrix.com', handle: 'photo' })
    expect(parseTemplateHandle('business-card/template/graphite')).toBeNull()
    expect(parseTemplateHandle('/jaime-weise/business-card/template')).toBeNull()
  })

  it('brings a template home by the signatures it was offered under', async () => {
    const h = await host('jwize.com', [{ key: 'a/template/photo', label: 'Photo', picture: true }])
    const kept: string[] = []
    const brought = await bringCardTemplate('jwize.com', 'photo', {
      creations: h.creations, atom: h.atom, put: async b => { const s = await hash(b); kept.push(s); return s },
    })
    if ('error' in brought) throw new Error(brought.error)
    expect(brought.offer.label).toBe('Photo')
    expect(brought.theme).toEqual({ label: 'Photo', concept: 'contour' })
    expect(kept).toEqual([brought.offer.themeSig, brought.offer.pictureSig])
  })

  it('refuses what it cannot bring faithfully', async () => {
    const h = await host('jwize.com', [{ key: 'a/contour', label: 'A' }, { key: 'b/contour', label: 'B' }, { key: 'c/photo', label: 'Photo', picture: true }])
    const io = { creations: h.creations, atom: h.atom, put: async (b: Uint8Array) => hash(b) }
    expect(await bringCardTemplate('jwize.com', 'nothing', io)).toMatchObject({ error: expect.stringContaining('no card template') })
    expect(await bringCardTemplate('jwize.com', 'contour', io)).toMatchObject({ error: expect.stringContaining('more than one') })
    expect(await bringCardTemplate('jwize.com', 'photo', { ...io, put: async () => 'e'.repeat(64) }))
      .toMatchObject({ error: expect.stringContaining('could not be kept') })
    const noPicture = { ...io, atom: async (hh: string, sig: string) => (h.atoms.get(sig)?.[0] === 82 ? null : h.atom(hh, sig)) }
    expect(await bringCardTemplate('jwize.com', 'photo', noPicture)).toMatchObject({ error: expect.stringContaining('picture did not arrive') })
  })
})
