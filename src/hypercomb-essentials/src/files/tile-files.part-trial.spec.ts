// files/tile-files.part-trial.spec.ts — a model's write of ONE PART of a page
// in parts rebuilds the page, and the rebuilt page is a trial exactly as a page
// written whole is (2026-11-27, documentation/inline-code-in-input-audit.md H1).
// Before, the rebuild marked the new page authored and remembered no trial, so
// the model's markup and script ran as the hive. The rebuild itself is faked at
// its seam (page-parts-commit.ts); what is asserted is what the write door does
// with the page it hands back.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'

// jsdom's Blob cannot be read back as text; the store reads every file that way.
;(globalThis as unknown as { Blob: unknown }).Blob = NodeBlob

const fake = vi.hoisted(() => ({
  services: new Map<string, unknown>(),
  rebuilt: { sig: 'a1'.repeat(32), html: '<main><script>model()</script></main>', own: true },
  applied: 0,
}))

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = {
    register: () => {},
    get: (key: string) => fake.services.get(key),
    whenReady: () => {},
  }
})

vi.mock('../commands/decoration-manifest.js', () => ({
  listDecorations: async () => [],
  removeDecorationAndWait: async () => {},
  writeDecoration: async () => 'd'.repeat(64),
}))

vi.mock('./files-attachment.js', async (original) => ({
  ...(await original<typeof import('./files-attachment.js')>()),
  writeAttachment: async () => {},
}))

vi.mock('./page-parts-commit.js', () => ({
  partFilesOf: async () => null,
  planPartRebuild: async () => ({
    ok: true,
    page: ['card'],
    apply: async () => { fake.applied++; return { ok: true, ...fake.rebuilt } },
  }),
}))

const sha = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

fake.services.set('@hypercomb.social/Store', {
  putResource: async (blob: Blob) => sha(await blob.text()),
  getResource: async () => null,
})
fake.services.set('@diamondcoreprocessor.com/HypercombHiveTreeReader', {
  readNode: async (segments: string[]) => ({
    ok: true,
    children: (segments.length === 0 ? ['card'] : segments.length === 1 ? ['animation'] : []).map(name => ({ name })),
  }),
})
fake.services.set('@diamondcoreprocessor.com/SiteViewDrone', { resolvePageSig: async () => null })

const { TileFilesDrone } = await import('./tile-files.drone.js')
const { forgetTrials, releaseTrial, trialIsOwn, trialOf } = await import('./try-page.js')
const { isAuthored } = await import('../sharing/authored-sigs.js')

describe('a part of a page, written by a model', () => {
  beforeEach(() => {
    forgetTrials()
    localStorage.removeItem('hc:authored-sigs')
    fake.applied = 0
    fake.rebuilt = { sig: 'a1'.repeat(32), html: '<main><script>model()</script></main>', own: true }
  })

  it('makes the rebuilt page a trial on the tile that wears it, not authored until a person brings it home', async () => {
    const fetched = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }))
    const done = await new TileFilesDrone().write({ route: ['card', 'animation'], kind: 'file', name: 'animation.js' }, 'model()')
    expect(fake.applied).toBe(1)
    expect(done).toMatchObject({ ok: true, trial: expect.stringContaining('try-card') })
    expect(trialOf(fake.rebuilt.sig)).toBe('try-card')
    expect(trialIsOwn(fake.rebuilt.sig)).toBe(true)
    expect(isAuthored(fake.rebuilt.sig)).toBe(false)
    expect(releaseTrial(fake.rebuilt.sig)).toBe(true)
    expect(isAuthored(fake.rebuilt.sig)).toBe(true)
    fetched.mockRestore()
  })

  it('keeps a page rebuilt from someone else\'s page sealed after it comes home', async () => {
    const fetched = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }))
    fake.rebuilt = { sig: 'b2'.repeat(32), html: '<main></main>', own: false }
    await new TileFilesDrone().write({ route: ['card', 'animation'], kind: 'file', name: 'animation.js' }, 'theirs()')
    expect(trialOf(fake.rebuilt.sig)).toBe('try-card')
    releaseTrial(fake.rebuilt.sig)
    expect(isAuthored(fake.rebuilt.sig)).toBe(false)
    fetched.mockRestore()
  })
})
