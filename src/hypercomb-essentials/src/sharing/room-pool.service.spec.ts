// room-pool.service.spec.ts — the room pool's own write: a member naming this
// tab's word for a page, put on the room's host. A device that publishes for an
// anchor (`keys allow`) writes it AS the anchor, so the host must hold the
// anchor's key list first: the write asks for it before the member goes up.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

vi.mock('./membership.js', () => ({ isJoinedHere: () => true }))

const { RoomPool } = await import('./room-pool.service.js')

type World = { ioc?: { get(key: string): unknown } }

afterEach(() => {
  delete (globalThis as World).ioc
  vi.unstubAllGlobals()
})

describe('share', () => {
  it('on a device that publishes for an anchor, asks the room\'s host for the anchor\'s key list before the member goes up', async () => {
    const key = generateSecretKey()
    const pubkey = getPublicKey(key)
    const anchor = 'a'.repeat(64)
    const host = 'room.example'
    const services: Record<string, unknown> = {
      '@diamondcoreprocessor.com/NostrMeshDrone': { swarmHost: () => host },
      '@hypercomb.social/RoomStore': { value: 'kitchen' },
      '@hypercomb.social/SecretStore': { value: 'chalk' },
      '@diamondcoreprocessor.com/SwarmDrone': { takenWord: () => 'soup' },
      '@diamondcoreprocessor.com/HostSyncService': { putOne: async () => ({ ok: true }) },
      '@diamondcoreprocessor.com/NostrSigner': {
        signEvent: async (evt: Record<string, unknown>) => finalizeEvent(evt as never, key) as unknown as Record<string, unknown>,
        knownPublicKeyHex: async () => pubkey,
        getPublicKeyHex: async () => pubkey,
      },
      '@hypercomb.social/AnchorBinding': { ready: async () => undefined, anchor: () => anchor, sources: () => [] },
    }
    ;(globalThis as World).ioc = { get: k => services[k] }
    const order: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      order.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith(`/${anchor}`)) return new Response('', { status: 404 })
      return new Response('', { status: 201 })
    }))

    expect(await new RoomPool().share('b'.repeat(64))).toBe('written')
    const asked = order.findIndex(line => line.startsWith(`GET https://${host}/`) && line.endsWith(`/${anchor}`))
    expect(asked).toBeGreaterThanOrEqual(0)
    expect(asked).toBeLessThan(order.findIndex(line => line.startsWith('PUT ')))
  })
})
