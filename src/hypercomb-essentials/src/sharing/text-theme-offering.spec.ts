import { describe, expect, it, vi } from 'vitest'
import { SignatureService, type TextTheme } from '@hypercomb/core'
import { heldTextTheme, setTextThemeOffering, textThemeOfferingStatus,
  type TextThemeOfferDeps } from './text-theme-offering.js'
import type { HiveIndexResult, PutHiveResult } from './hive-pointer.js'

const SIG = 'a'.repeat(64)
const PUBKEY = 'b'.repeat(64)
const HOST = 'jwize.com'
const ENDPOINT = 'content.pluginthematrix.com'
const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
const exact = (value: Uint8Array): ArrayBuffer =>
  value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
const hash = (value: Uint8Array): Promise<string> => SignatureService.sign(exact(value))

const localTheme = async () => {
  const key = 'studio'
  // The old source revision is provenance; it need not be held or uploaded.
  const layerBytes = bytes({ name: 'text-theme', label: 'Studio', read: 'serif', code: 'plex', source: SIG })
  const payload = await hash(layerBytes)
  const metaBytes = bytes({ meta: 1, layer: payload, relation: 'themes:text' })
  const head = await hash(metaBytes)
  const location = await hash(new TextEncoder().encode(`themes:text:${key}`))
  const theme: TextTheme = { key, label: 'Studio', read: 'serif', code: 'plex', location, head }
  let latest = head
  const bag = {
    entries: async function* () { yield ['00000000', { kind: 'file' }] },
    getFileHandle: async () => ({ getFile: async () => ({ text: async () => JSON.stringify({ layer: latest }) }) }),
  } as unknown as FileSystemDirectoryHandle
  const store = {
    openPool: async () => ({ getDirectoryHandle: async () => bag }) as unknown as FileSystemDirectoryHandle,
    getResourceLocal: async (sig: string) => sig === head
      ? { arrayBuffer: async () => exact(metaBytes) } as Blob : null,
    getLayerPoolBytes: async (sig: string) => sig === payload ? layerBytes : null,
  }
  return { theme, store, payload, head, layerBytes, metaBytes, setLatest: (value: string) => { latest = value } }
}

describe('explicit text-theme offering', () => {
  it('stages the current typed leaf before declaring it, then withdraws only its public switch', async () => {
    const local = await localTheme()
    const other = 'c'.repeat(64)
    let content: Record<string, unknown> = {
      v: 1, roots: { site: SIG }, doors: { site: [HOST] },
      offerings: { [other]: { meaning: 'themes:text', key: 'other', head: SIG, title: 'Other', host: HOST } },
      future: { preserved: true },
    }
    let projected: string | null = null
    const order: string[] = []
    const uploaded: string[] = []
    const readIndex = vi.fn(async (): Promise<HiveIndexResult> => ({ ok: true, manifest: {
      roots: content['roots'] as Record<string, string>,
      doors: content['doors'] as Record<string, string[]>,
      offerings: content['offerings'] as Record<string, unknown>,
      createdAt: 1_700_000_000, pubkey: PUBKEY, signedContent: content,
    } }))
    const putIndex = vi.fn(async (host: string, roots: Record<string, string>, doors: Record<string, string[]> = {},
      _replaces = 0, previous?: Record<string, unknown>): Promise<PutHiveResult> => {
      order.push('index')
      expect(host).toBe(ENDPOINT)
      expect(previous?.['future']).toEqual({ preserved: true })
      content = { ...previous, roots, doors }
      projected = (content['offerings'] as Record<string, { head: string }>)[local.theme.location!]?.head ?? projected
      return { ok: true, pubkey: PUBKEY, createdAt: 1_700_000_001 }
    })
    const sync = {
      publicHostDomain: () => ENDPOINT,
      publishAtoms: async (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) => {
        order.push('stage')
        expect(host).toBe(ENDPOINT)
        for (const sig of sigs) {
          const held = await bytesOf(sig)
          expect(held && await hash(held)).toBe(sig)
          uploaded.push(sig)
        }
        return { ok: true as const, sent: sigs.length, held: 0 }
      },
    }
    const deps: TextThemeOfferDeps = { store: local.store, sync, pubkey: async () => PUBKEY,
      readIndex, putIndex, readMarker: async () => projected }

    expect(await setTextThemeOffering(local.theme, HOST, true, deps)).toEqual({ ok: true, state: 'current' })
    expect(order).toEqual(['stage', 'index'])
    expect(uploaded).toEqual([local.payload, local.head])
    expect(content['roots']).toEqual({ site: SIG })
    expect(content['doors']).toEqual({ site: [HOST] })
    expect((content['offerings'] as Record<string, unknown>)[local.theme.location!]).toEqual({
      meaning: 'themes:text', key: 'studio', head: local.head, title: 'Studio', host: HOST,
    })
    expect((content['offerings'] as Record<string, unknown>)[other]).toBeDefined()

    expect(await setTextThemeOffering(local.theme, HOST, false, deps)).toEqual({ ok: true, state: 'off' })
    expect(order).toEqual(['stage', 'index', 'index'])
    expect(uploaded).toEqual([local.payload, local.head])
    expect((content['offerings'] as Record<string, unknown>)[local.theme.location!]).toBeUndefined()
    expect((content['offerings'] as Record<string, unknown>)[other]).toBeDefined()
    expect(projected).toBe(local.head) // the old marker/bytes remain held
  })

  it('refuses a stale local head and never stages or declares it', async () => {
    const local = await localTheme()
    local.setLatest(SIG)
    expect(await heldTextTheme(local.theme, local.store)).toBeNull()
    const publishAtoms = vi.fn(async () => ({ ok: true as const, sent: 0, held: 0 }))
    const putIndex = vi.fn(async (): Promise<PutHiveResult> => ({ ok: true, pubkey: PUBKEY, createdAt: 1 }))
    const deps: TextThemeOfferDeps = {
      store: local.store, sync: { publicHostDomain: () => ENDPOINT, publishAtoms },
      pubkey: async () => PUBKEY,
      readIndex: async (): Promise<HiveIndexResult> => ({ ok: false, reason: 'http', status: 404 }), putIndex,
    }
    expect((await setTextThemeOffering(local.theme, HOST, true, deps)).ok).toBe(false)
    expect(publishAtoms).not.toHaveBeenCalled()
    expect(putIndex).not.toHaveBeenCalled()
  })

  it('refuses an unverified index without touching the public host', async () => {
    const local = await localTheme()
    const publishAtoms = vi.fn(async () => ({ ok: true as const, sent: 0, held: 0 }))
    const putIndex = vi.fn(async (): Promise<PutHiveResult> => ({ ok: true, pubkey: PUBKEY, createdAt: 1 }))
    const deps: TextThemeOfferDeps = {
      store: local.store, sync: { publicHostDomain: () => ENDPOINT, publishAtoms },
      pubkey: async () => PUBKEY,
      readIndex: async (): Promise<HiveIndexResult> => ({ ok: false, reason: 'forged' }), putIndex,
    }
    expect(await setTextThemeOffering(local.theme, HOST, true, deps)).toEqual({
      ok: false, reason: 'Cannot safely read the host index (forged).',
    })
    expect(publishAtoms).not.toHaveBeenCalled()
    expect(putIndex).not.toHaveBeenCalled()
  })

  it('distinguishes a signed declaration from a served current marker', async () => {
    const local = await localTheme()
    const content = { v: 1, roots: {}, offerings: {
      [local.theme.location!]: { meaning: 'themes:text', key: 'studio', head: local.head,
        title: 'Studio', host: HOST },
    } }
    const deps: TextThemeOfferDeps = {
      sync: { publicHostDomain: () => ENDPOINT, publishAtoms: async () => ({ ok: true, sent: 0, held: 0 }) },
      pubkey: async () => PUBKEY,
      readIndex: async (): Promise<HiveIndexResult> => ({ ok: true, manifest: {
        roots: {}, createdAt: 1, pubkey: PUBKEY, offerings: content.offerings, signedContent: content,
      } }),
      readMarker: async () => null,
    }
    expect(await textThemeOfferingStatus(local.theme, HOST, deps)).toEqual({ ok: true, state: 'pending' })
    content.offerings[local.theme.location!].head = SIG
    expect(await textThemeOfferingStatus(local.theme, HOST, deps)).toEqual({ ok: true, state: 'outdated' })
  })
})
