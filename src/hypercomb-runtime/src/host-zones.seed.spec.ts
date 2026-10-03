// host-zones.seed.spec.ts — A GENERIC RELEASE CHOOSES ITS OWN SEED HOSTS.
// The minimal host bakes the operator's list in at build (`--hosts` /
// HYPERCOMB_SEED_HOSTS → __HC_SEED_HOSTS__); Hypercomb's own domains are only
// the fallback for a build that names none.

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  delete (globalThis as { __HC_SEED_HOSTS__?: unknown }).__HC_SEED_HOSTS__
  vi.resetModules()
})

describe('seed hosts', () => {
  it('are the ones the build names', async () => {
    ;(globalThis as { __HC_SEED_HOSTS__?: unknown }).__HC_SEED_HOSTS__ = ['hive.example.org', 'mirror.example.net']
    const { DEFAULT_HOST_ZONES } = await import('./host-zones')
    expect(DEFAULT_HOST_ZONES).toEqual(['hive.example.org', 'mirror.example.net'])
  })

  it('fall back to Hypercomb\'s own only when the build names none', async () => {
    const { DEFAULT_HOST_ZONES } = await import('./host-zones')
    expect(DEFAULT_HOST_ZONES).toEqual(['hypercomb.com'])
  })
})
