// private-keep.spec.ts — a tile kept as ciphertext only, and brought into another device with the same key.
//
// One world: hosts are maps of bytes by signature plus the roots a signed index names; the keeping device and the
// bringing device share a key and nothing else. The seal is the real one (sealed-publish.ts, core's ciphers); only
// NIP-44 is stood in for, by a reversible wrap that still refuses the wrong peer.

import { describe, expect, it } from 'vitest'
import { bringPrivate, carrierBytes, keepPrivate, parseCarrier, privateRootKey, PRIVATE_ROOT_PREFIX, type BringDeps, type KeepDeps } from './private-keep.js'
import { signBytes } from './sealed-closure.js'
import type { Nip44 } from './sealed-envelope.js'

const KEY = 'a'.repeat(64)
const OTHER = 'c'.repeat(64)
const enc = (text: string): Uint8Array => new TextEncoder().encode(text)

const nip44For = (me: string): Nip44 => ({
  encrypt: async (peer, text) => `${[me, peer].sort().join('|')}#${text}`,
  decrypt: async (peer, payload) => {
    const tag = `${[me, peer].sort().join('|')}#`
    return payload.startsWith(tag) ? payload.slice(tag.length) : null
  },
})

type Host = { bytes: Map<string, Uint8Array>; roots: Record<string, string> }

const makeWorld = async () => {
  // A tile of two atoms: a note, and the head layer that names it.
  const note = enc('the bread rises overnight')
  const noteSig = await signBytes(note)
  const layer = enc(JSON.stringify({ name: 'bread', notes: [noteSig] }))
  const head = await signBytes(layer)
  const local = new Map<string, Uint8Array>([[noteSig, note], [head, layer]])
  const hosts: Record<string, Host> = { 'one.example': { bytes: new Map(), roots: {} }, 'two.example': { bytes: new Map(), roots: {} } }

  const keep = (over: Partial<KeepDeps> = {}): KeepDeps => ({
    hosts: async () => Object.keys(hosts),
    publisher: async () => KEY,
    own: async () => KEY,
    devices: async () => [],
    nip44: () => nip44For(KEY),
    head: async () => head,
    getBytes: async sig => local.get(sig) ?? null,
    closure: async () => ({ sigs: [head, noteSig], complete: true }),
    upload: host => async atoms => { for (const [sig, bytes] of atoms) hosts[host]!.bytes.set(sig, bytes); return { ok: true } },
    setRoot: async (host, key, sig) => { hosts[host]!.roots[key] = sig; return { ok: true } },
    ...over,
  })

  const device = (me = KEY) => {
    const store = new Map<string, Uint8Array>()
    const placed: { route: readonly string[]; head: string; host: string }[] = []
    const tiles = new Map<string, string>()
    const deps: BringDeps = {
      hosts: async () => Object.keys(hosts),
      publisher: async () => KEY,
      own: async () => me,
      nip44: () => nip44For(me),
      roots: async host => hosts[host]!.roots,
      fetcher: host => async sig => hosts[host]!.bytes.get(sig) ?? null,
      current: async route => tiles.get(route.join('/')) ?? null,
      put: async (sig, bytes) => { store.set(sig, bytes); return true },
      place: tile => { placed.push(tile); tiles.set(tile.route.join('/'), tile.head) },
    }
    return { deps, store, placed }
  }
  return { note, noteSig, layer, head, local, hosts, keep, device }
}

describe('the carrier — where the tile lives, inside the seal', () => {
  it('round-trips a route and a head, and reads nothing else as one', () => {
    expect(parseCarrier(carrierBytes(['recipes', 'bread'], KEY))).toEqual({ kind: 'private-tile', route: ['recipes', 'bread'], head: KEY })
    expect(parseCarrier(enc('{"kind":"private-tile","route":[],"head":"' + KEY + '"}'))).toBeNull()
    expect(parseCarrier(enc('{"kind":"other","route":["a"],"head":"' + KEY + '"}'))).toBeNull()
    expect(parseCarrier(enc('not json'))).toBeNull()
  })

  it('names a private root by a hash, never by the route', async () => {
    const key = await privateRootKey(KEY, 'recipes/bread')
    expect(key).toMatch(/^private:[0-9a-f]{64}$/)
    expect(key).not.toContain('bread')
    expect(await privateRootKey(OTHER, 'recipes/bread')).not.toBe(key)
  })
})

describe('keep — ciphertext only, named in the signed index', () => {
  it('puts no plain atom on any host, and names one private root on each', async () => {
    const w = await makeWorld()
    const result = await keepPrivate(['recipes', 'bread'], w.keep())
    expect(result).toMatchObject({ ok: true, hosts: ['one.example', 'two.example'], failed: [] })
    const key = await privateRootKey(KEY, 'recipes/bread')
    for (const host of Object.values(w.hosts)) {
      expect(Object.keys(host.roots)).toEqual([key])
      expect(host.bytes.has(host.roots[key]!)).toBe(true)
      expect(host.bytes.has(w.head)).toBe(false)
      expect(host.bytes.has(w.noteSig)).toBe(false)
      for (const bytes of host.bytes.values()) expect(new TextDecoder().decode(bytes)).not.toContain('bread')
    }
  })

  it('keeps on the hosts that take it and names the one that did not', async () => {
    const w = await makeWorld()
    const result = await keepPrivate(['bread'], w.keep({
      upload: host => async atoms => {
        if (host === 'two.example') return { ok: false, reason: 'full' }
        for (const [sig, bytes] of atoms) w.hosts[host]!.bytes.set(sig, bytes)
        return { ok: true }
      },
    }))
    expect(result).toMatchObject({ ok: true, hosts: ['one.example'], failed: [{ host: 'two.example', reason: 'upload-failed: full' }] })
    expect(w.hosts['two.example']!.roots).toEqual({})
  })

  it('refuses without a host, a head, a signer or a way to seal, and uploads nothing', async () => {
    const w = await makeWorld()
    expect(await keepPrivate(['bread'], w.keep({ hosts: async () => [] }))).toEqual({ ok: false, reason: 'no-host' })
    expect(await keepPrivate(['bread'], w.keep({ head: async () => null }))).toEqual({ ok: false, reason: 'no-head' })
    expect(await keepPrivate(['bread'], w.keep({ getBytes: async () => null }))).toEqual({ ok: false, reason: 'no-head' })
    expect(await keepPrivate(['bread'], w.keep({ closure: async () => ({ sigs: [w.head], complete: false }) }))).toEqual({ ok: false, reason: 'incomplete' })
    expect(await keepPrivate(['bread'], w.keep({ closure: async () => ({ sigs: [w.head, 'e'.repeat(64)], complete: true }) }))).toEqual({ ok: false, reason: 'incomplete' })
    expect(await keepPrivate(['bread'], w.keep({ publisher: async () => '' }))).toEqual({ ok: false, reason: 'no-signer' })
    expect(await keepPrivate(['bread'], w.keep({ nip44: () => null }))).toEqual({ ok: false, reason: 'no-nip44' })
    expect(await keepPrivate([], w.keep())).toEqual({ ok: false, reason: 'no-tile' })
    for (const host of Object.values(w.hosts)) expect(host.bytes.size).toBe(0)
  })
})

describe('bring — another device, the same key', () => {
  it('opens the tile, keeps every atom under its own signature, and places it at its route', async () => {
    const w = await makeWorld()
    await keepPrivate(['recipes', 'bread'], w.keep())
    const other = w.device()
    const result = await bringPrivate(other.deps)
    expect(result).toMatchObject({ ok: true, here: 0, unopened: 0, unread: [] })
    expect(other.placed).toEqual([{ route: ['recipes', 'bread'], head: w.head, host: 'one.example', publisher: KEY, held: false }])
    expect([...other.store.keys()].sort()).toEqual([w.head, w.noteSig].sort())
    expect(new TextDecoder().decode(other.store.get(w.noteSig)!)).toBe('the bread rises overnight')
    // Asked again, it is already here: nothing is fetched twice or placed twice.
    expect(await bringPrivate(other.deps)).toMatchObject({ ok: true, brought: [], here: 1 })
    expect(other.placed).toHaveLength(1)
  })

  it('says a tile it has at another version is held, so the kept version takes its place', async () => {
    const w = await makeWorld()
    await keepPrivate(['bread'], w.keep())
    const stale = w.device()
    await bringPrivate({ ...stale.deps, current: async () => 'f'.repeat(64) })
    expect(stale.placed).toMatchObject([{ route: ['bread'], head: w.head, held: true }])
  })

  it('places a tile whose bytes are held but which is not in the hive yet', async () => {
    const w = await makeWorld()
    await keepPrivate(['bread'], w.keep())
    const cut = w.device()
    for (const [sig, bytes] of w.local) cut.store.set(sig, bytes)
    expect(await bringPrivate(cut.deps)).toMatchObject({ ok: true, here: 0 })
    expect(cut.placed).toHaveLength(1)
  })

  it('opens on a paired device that holds its own key, when the key list names it', async () => {
    const w = await makeWorld()
    await keepPrivate(['bread'], w.keep({ devices: async () => [OTHER] }))
    const paired = w.device(OTHER)
    expect(await bringPrivate(paired.deps)).toMatchObject({ ok: true, unopened: 0 })
    expect(paired.placed).toHaveLength(1)
    expect(paired.store.has(w.head)).toBe(true)
  })

  it('opens nothing with another key, and writes nothing', async () => {
    const w = await makeWorld()
    await keepPrivate(['bread'], w.keep())
    const stranger = w.device(OTHER)
    expect(await bringPrivate(stranger.deps)).toMatchObject({ ok: true, brought: [], unopened: 2 })
    expect(stranger.store.size).toBe(0)
    expect(stranger.placed).toEqual([])
  })

  it('writes nothing when the host lost a ciphertext: complete or absent', async () => {
    const w = await makeWorld()
    await keepPrivate(['bread'], w.keep({ hosts: async () => ['one.example'] }))
    const host = w.hosts['one.example']!
    const envelope = Object.values(host.roots)[0]!
    // Drop one sealed atom that is neither the envelope nor needed to open the door: try each until the bring is incomplete.
    let dropped = false
    for (const sig of [...host.bytes.keys()]) {
      if (sig === envelope) continue
      const kept = host.bytes.get(sig)!
      host.bytes.delete(sig)
      const device = w.device()
      const result = await bringPrivate({ ...device.deps, hosts: async () => ['one.example'] })
      expect(result).toMatchObject({ ok: true, brought: [] })
      expect(device.store.size).toBe(0)
      host.bytes.set(sig, kept)
      dropped = true
    }
    expect(dropped).toBe(true)
  })

  it('does not believe a private root that carries another tile', async () => {
    const w = await makeWorld()
    await keepPrivate(['bread'], w.keep({ hosts: async () => ['one.example'] }))
    const host = w.hosts['one.example']!
    const [key, envelope] = Object.entries(host.roots)[0]!
    host.roots = { [`${PRIVATE_ROOT_PREFIX}${'d'.repeat(64)}`]: envelope }
    const device = w.device()
    expect(await bringPrivate({ ...device.deps, hosts: async () => ['one.example'] })).toMatchObject({ ok: true, brought: [], unopened: 1 })
    expect(device.store.size).toBe(0)
    expect(key).toMatch(/^private:/)
  })

  it('names a host whose index could not be read, and leaves plain roots alone', async () => {
    const w = await makeWorld()
    w.hosts['one.example']!.roots['recipes/bread'] = w.head
    const device = w.device()
    const result = await bringPrivate({ ...device.deps, roots: async host => host === 'two.example' ? null : w.hosts[host]!.roots })
    expect(result).toEqual({ ok: true, brought: [], here: 0, unopened: 0, unread: ['two.example'] })
  })
})
