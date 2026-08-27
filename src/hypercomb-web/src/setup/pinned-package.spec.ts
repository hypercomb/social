import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { BOOTSTRAP_PIN_PATH, fetchPinnedPackage, parsePinnedPackage } from './pinned-package'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)
const SIG_C = 'c'.repeat(64)

const descriptor = {
  version: 1 as const,
  packageSig: SIG_A,
  acquisition: SIG_C,
  layers: [SIG_A],
  bees: [SIG_B],
  dependencies: [SIG_C],
  platforms: { '@hypercomb/core': SIG_C },
  beeDeps: { [SIG_B]: [SIG_C] },
  dependenciesBag: SIG_A,
  beesBag: SIG_B,
  renderCriticalKeys: ['@hypercomb.test/Renderer'],
  label: 'test',
  previous: null,
}

const bytesOf = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value) + '\n')
const signatureOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

describe('pinned package discovery', () => {
  it('accepts the complete signed descriptor shape', () => {
    expect(parsePinnedPackage(descriptor)).toEqual(descriptor)
  })

  it('rejects malformed signature edges', () => {
    expect(parsePinnedPackage({ ...descriptor, bees: ['not-a-signature'] })).toBeNull()
    expect(parsePinnedPackage({ ...descriptor, platforms: { pixi: 'forged' } })).toBeNull()
    expect(parsePinnedPackage({ ...descriptor, beeDeps: { forged: [SIG_C] } })).toBeNull()
  })

  it('tries the canonical flat path before bundled content and accepts only matching bytes', async () => {
    const valid = bytesOf(descriptor)
    const descriptorSig = signatureOf(valid)
    const forged = bytesOf({ ...descriptor, label: 'forged' })
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === BOOTSTRAP_PIN_PATH) {
        return new Response(JSON.stringify({ version: 1, bootstrap: descriptorSig }), { status: 200 })
      }
      if (path === `/${descriptorSig}`) return new Response(forged, { status: 200 })
      if (path === `/content/${descriptorSig}`) return new Response(valid, { status: 200 })
      return new Response('', { status: 404 })
    })

    await expect(fetchPinnedPackage(fetcher)).resolves.toEqual({
      status: 'verified',
      package: descriptor,
      descriptorSig,
    })
    expect(fetcher.mock.calls.map(([path]) => String(path))).toEqual([
      BOOTSTRAP_PIN_PATH,
      `/${descriptorSig}`,
      `/content/${descriptorSig}`,
    ])
  })

  it('fails closed when a present pin cannot produce its exact bytes', async () => {
    const valid = bytesOf(descriptor)
    const descriptorSig = signatureOf(valid)
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === BOOTSTRAP_PIN_PATH) {
        return new Response(JSON.stringify({ version: 1, bootstrap: descriptorSig }), { status: 200 })
      }
      return new Response(bytesOf({ ...descriptor, label: 'wrong bytes' }), { status: 200 })
    })

    await expect(fetchPinnedPackage(fetcher)).resolves.toEqual({
      status: 'invalid',
      reason: 'no host path returned the pinned bytes',
    })
  })

  it('marks only a genuinely missing pin as legacy-compatible', async () => {
    const absent = vi.fn(async () => new Response('', { status: 404 }))
    const malformed = vi.fn(async () => new Response('<html>fallback</html>', { status: 200 }))
    await expect(fetchPinnedPackage(absent)).resolves.toEqual({ status: 'absent' })
    await expect(fetchPinnedPackage(malformed)).resolves.toEqual({ status: 'invalid', reason: 'pin is not JSON' })
  })
})
