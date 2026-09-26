// hive-pointer.carried.spec.ts — a door's page carries its publisher's signed
// index (#hc-index); it answers with no round trip only after it verifies
// against the pinned key, exactly as a fetched one would.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { fetchHiveManifestFromAny } from './hive-pointer.js'

const secret = new Uint8Array(32).fill(3)
const PUB = getPublicKey(secret)
const HEAD = 'a'.repeat(64)

const signed = (roots: Record<string, string>) => finalizeEvent({
  kind: 30564, created_at: 1_800_000_000, tags: [], content: JSON.stringify({ v: 1, roots }),
}, secret)

const carry = (event: unknown): void => {
  document.getElementById('hc-index')?.remove()
  const script = document.createElement('script')
  script.id = 'hc-index'
  script.type = 'application/json'
  script.textContent = JSON.stringify(event)
  document.head.append(script)
}

afterEach(() => { document.getElementById('hc-index')?.remove(); vi.unstubAllGlobals() })

describe('the signed index a page carries', () => {
  it('answers with no fetch when it verifies against the pinned key', async () => {
    carry(signed({ garden: HEAD }))
    const fetched = vi.fn(async () => new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetched)
    const manifest = await fetchHiveManifestFromAny(['content.example.com'], PUB)
    expect(manifest?.roots).toEqual({ garden: HEAD })
    expect(fetched).not.toHaveBeenCalled()
  })

  it('is refused when forged, and the hosts are asked instead', async () => {
    const forged = { ...signed({ garden: HEAD }), content: JSON.stringify({ v: 1, roots: { garden: 'b'.repeat(64) } }) }
    carry(forged)
    const fetched = vi.fn(async () => Response.json(signed({ garden: HEAD })))
    vi.stubGlobal('fetch', fetched)
    const manifest = await fetchHiveManifestFromAny(['content.example.com'], PUB)
    expect(fetched).toHaveBeenCalledTimes(1)
    expect(manifest?.roots).toEqual({ garden: HEAD })
  })

  it('is not another publisher\'s index', async () => {
    carry(finalizeEvent({ kind: 30564, created_at: 1, tags: [], content: JSON.stringify({ v: 1, roots: { x: HEAD } }) }, new Uint8Array(32).fill(9)))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    expect(await fetchHiveManifestFromAny(['content.example.com'], PUB)).toBeNull()
  })
})
