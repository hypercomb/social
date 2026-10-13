// sharing/hosts.own-host.spec.ts — YOUR OWN HOST LIVES WITH YOUR HOSTS.
//
// jwize, 2026-10-12: "the only place the host comes from is the field we
// attached to … hosts are added to our portal for replication". Your own host
// (`hc:nostrmesh:self-domain` — host-sync's backup target, the broker's first
// door) was a field in the swarm selector, beside the room and the secret, as
// if it decided who you meet. It never did: a room is its meeting point, room
// and secret. It is named in the host directory now, and the hosts drone
// writes it. Pinned: the directory offers the field, pre-filled; the drone
// keeps the bare zone, clears it on an empty name, refuses a typo — and the
// picker no longer has it (mesh-modal.spec.ts).

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const registry = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry.set(key, value) },
  get: (key: string) => registry.get(key),
  whenReady: () => void 0,
}
vi.mock('./community-hosts.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  addCommunityHost: async () => '',
  listCommunityHosts: async () => [],
  removeCommunityHost: async () => false,
}))
vi.mock('./update-scout.service.js', () => ({ updateScout: {} }))
vi.mock('./package-attestation.js', () => ({ packageAttestation: {} }))

const KEY = 'hc:nostrmesh:self-domain'
const here = dirname(fileURLToPath(import.meta.url))
const VIEW = readFileSync(join(here, 'host-directory.view.ts'), 'utf8')
const DRONE = readFileSync(join(here, 'hosts.drone.ts'), 'utf8')
const logs: string[] = []

beforeAll(async () => {
  // The key's one writer is host-sync (setOwnHost) — the module that already
  // wrote it for `enable`; the drone hands it the name.
  const { hostSyncService } = await import('./host-sync.service.js')
  registry.set('@diamondcoreprocessor.com/HostSyncService', hostSyncService)
  await import('./hosts.drone.js')
  EffectBus.on<{ message?: string }>('activity:log', (p) => { if (p?.message) logs.push(p.message) })
})

beforeEach(() => {
  localStorage.removeItem(KEY)
  logs.length = 0
})

describe('your own host is named in the host directory', () => {
  it('the directory offers the field, pre-filled from the one key, and hands the name to the drone', () => {
    expect(VIEW).toContain("const OWN_HOST_KEY = 'hc:nostrmesh:self-domain'")
    expect(VIEW).toMatch(/#ownHostForm\(\): HTMLFormElement/)
    expect(VIEW).toContain("EffectBus.emit('hosts:own-host', { host })")
    expect(VIEW).toContain('body.append(this.#ownHostForm())')
    // the view reads the key; host-sync is its one writer
    expect(VIEW).not.toMatch(/localStorage\??\.(?:setItem|removeItem)\(/)
    expect(DRONE).not.toMatch(/localStorage\??\.(?:setItem|removeItem)\(OWN_HOST_KEY/)
    expect(DRONE).toContain('hostSync.setOwnHost(zone)')
  })

  it('the drone keeps the bare zone, however it is written', () => {
    EffectBus.emit('hosts:own-host', { host: 'https://Mine.Example/' })
    expect(localStorage.getItem(KEY)).toBe('mine.example')
    expect(logs.at(-1)).toContain('mine.example')
  })

  it('an empty name clears it; a typo is refused and changes nothing', () => {
    localStorage.setItem(KEY, 'mine.example')
    EffectBus.emit('hosts:own-host', { host: 'not a host' })
    expect(localStorage.getItem(KEY)).toBe('mine.example')
    expect(logs.at(-1)).toContain('is not a host')
    EffectBus.emit('hosts:own-host', { host: '' })
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('naming your own host never switches host backup on', () => {
    localStorage.removeItem('hc:host-sync:enabled')
    EffectBus.emit('hosts:own-host', { host: 'mine.example' })
    expect(localStorage.getItem(KEY)).toBe('mine.example')
    expect(localStorage.getItem('hc:host-sync:enabled')).toBeNull()
  })
})
