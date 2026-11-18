// sharing/private-keep.ts
//
// A TILE KEPT ON YOUR HOSTS AS CIPHERTEXT ONLY, AND BROUGHT INTO YOUR OTHER DEVICES (jwize 2026-11-18: "set our tiles to
// host on our other devices and host servers … available on all machines"). This answers the question
// documentation/sealed-audiences.md left open: what the signed index names for a tile with NO public root.
//
//   keep:   sealed head of the tile → a CARRIER atom { route, head } → the closure of the carrier, sealed atom by atom
//           → an envelope sealing the door secret to this key and every device on its key list
//             (sealed-publish.ts publishSealed, unchanged)
//           → ciphertext, door and envelope uploaded to each host the tile names
//           → the envelope named in the signed index under `private:<sign(key ⏎ lineage)>`.
//   bring:  the signed index of this key on each host this hive knows → every `private:` root → the envelope opens with
//           this device's key → the carrier says where the tile lives and its head → every atom is opened, CHECKED and
//           kept under its own signature → the tile is queued as an adopt at its route, which folds from local bytes.
//
// WHAT A HOST HOLDS: ciphertext it cannot read, and one colon root per private tile. A colon root is a system root —
// never a place, never a door, never in a community — so nothing serves it and no visitor is shown it. The root's name
// is a hash, so the index does not say the tile's name (someone who guesses a name and holds the key's hex can test the
// guess; the content stays sealed either way). The route travels INSIDE the sealed closure, in the carrier.
//
// The orchestration takes its collaborators as arguments; `live*` wires them to the running hive.

import { lineageKey } from '@hypercomb/core'
import { collectClosure, signBytes } from './sealed-closure.js'
import type { Nip44 } from './sealed-envelope.js'
import { publishSealed, openSealedVersion, type SealedPublishDeps } from './sealed-publish.js'

const SIG = /^[0-9a-f]{64}$/
export const PRIVATE_ROOT_PREFIX = 'private:'
export const CARRIER_KIND = 'private-tile'

/** The signed index's name for one private tile of one key: a hash, so the index does not spell the route. */
export const privateRootKey = async (pubkey: string, lineage: string): Promise<string> =>
  `${PRIVATE_ROOT_PREFIX}${await signBytes(new TextEncoder().encode(`${pubkey.toLowerCase()}\n${lineage}`))}`

export type Carrier = { readonly kind: typeof CARRIER_KIND; readonly route: readonly string[]; readonly head: string }

export const carrierBytes = (route: readonly string[], head: string): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ kind: CARRIER_KIND, route: [...route], head }))

/** A carrier, believed only as far as its shape. */
export const parseCarrier = (bytes: Uint8Array | null): Carrier | null => {
  if (!bytes) return null
  let raw: Record<string, unknown>
  try { raw = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> } catch { return null }
  const route = Array.isArray(raw?.['route']) ? (raw['route'] as unknown[]).map(s => String(s ?? '').trim()).filter(Boolean) : []
  const head = String(raw?.['head'] ?? '').toLowerCase()
  if (raw?.['kind'] !== CARRIER_KIND || route.length === 0 || route.length > 64 || !SIG.test(head)) return null
  return { kind: CARRIER_KIND, route, head }
}

// ── keep ──

export type KeepDeps = {
  /** The hosts that take uploads for this tile, first to try first. */
  readonly hosts: (segments: readonly string[]) => Promise<readonly string[]>
  /** The key the index is signed under, and this device's own. */
  readonly publisher: () => Promise<string>
  readonly own: () => Promise<string>
  /** The keys this key's list names on `host`: each device of the participant's. Empty when it holds no list. */
  readonly devices: (host: string, publisher: string) => Promise<readonly string[]>
  readonly nip44: () => Nip44 | null
  /** The tile's sealed head, from this hive. */
  readonly head: (segments: readonly string[]) => Promise<string | null>
  readonly getBytes: (sig: string) => Promise<Uint8Array | null>
  /** Every signature the head reaches, as a publish would upload it, and whether the walk finished. */
  readonly closure: (head: string) => Promise<{ sigs: Iterable<string>; complete: boolean } | null>
  readonly upload: (host: string) => SealedPublishDeps['upload']
  /** Name the envelope under `key` in this key's signed index on `host`. */
  readonly setRoot: (host: string, key: string, sig: string) => Promise<{ ok: boolean; reason?: string }>
}

export type KeepResult =
  | { ok: true; hosts: string[]; atoms: number; failed: { host: string; reason: string }[] }
  | { ok: false; reason: 'no-tile' | 'no-nip44' | 'no-signer' | 'no-host' | 'no-head' | 'incomplete' | 'nowhere'; failed?: { host: string; reason: string }[] }

/** Keep the tile at `segments` on every host it names, as ciphertext only this key opens. */
export async function keepPrivate(segments: readonly string[], deps: KeepDeps): Promise<KeepResult> {
  const route = segments.map(s => String(s ?? '').trim()).filter(Boolean)
  const lineage = lineageKey(route)
  if (!route.length || !lineage) return { ok: false, reason: 'no-tile' }
  const nip44 = deps.nip44()
  if (!nip44) return { ok: false, reason: 'no-nip44' }
  const publisher = (await deps.publisher().catch(() => '')).toLowerCase()
  const own = (await deps.own().catch(() => '')).toLowerCase()
  if (!SIG.test(publisher) || !SIG.test(own)) return { ok: false, reason: 'no-signer' }
  const hosts = [...new Set(await deps.hosts(route).catch(() => [] as string[]))]
  if (!hosts.length) return { ok: false, reason: 'no-host' }
  const head = await deps.head(route).catch(() => null)
  if (!head || !SIG.test(head)) return { ok: false, reason: 'no-head' }

  const carrier = carrierBytes(route, head)
  const carrierSig = await signBytes(carrier)
  const getBytes = async (sig: string): Promise<Uint8Array | null> => sig === carrierSig ? carrier : deps.getBytes(sig)
  // Complete or absent: a copy that lacks an atom the tree names would hatch as a husk on another device. The hive's
  // own walk says what the tree reaches; the seal's walk must find every one of those, verbatim.
  const reach = await deps.closure(head).catch(() => null)
  if (!reach?.complete) return { ok: false, reason: 'incomplete' }
  const closure = await collectClosure(carrierSig, getBytes)
  if (!closure.has(head)) return { ok: false, reason: 'no-head' }
  for (const sig of reach.sigs) if (!closure.has(sig)) return { ok: false, reason: 'incomplete' }
  const held = async (sig: string): Promise<Uint8Array | null> => closure.get(sig) ?? null
  const key = await privateRootKey(publisher, lineage)

  const kept: string[] = []
  const failed: { host: string; reason: string }[] = []
  let atoms = 0
  for (const host of hosts) {
    // Sealed to the key the index is signed under AND to every device on its list: a paired device holds its own
    // key, never the anchor's, and it must open what any other device of the participant's keeps.
    const devices = (await deps.devices(host, publisher).catch(() => [] as string[])).map(key => key.toLowerCase()).filter(key => SIG.test(key))
    const result = await publishSealed(carrierSig, [...new Set([publisher, ...devices])], {
      getBytes: held, upload: deps.upload(host), nip44, publisher: own,
      // One private copy per tile: the newest envelope replaces the last, never a list.
      setSealed: async envelopes => deps.setRoot(host, key, envelopes[0]!),
    })
    if (result.ok) { kept.push(host); atoms = result.atoms }
    else failed.push({ host, reason: result.detail ? `${result.reason}: ${result.detail}` : result.reason })
  }
  return kept.length ? { ok: true, hosts: kept, atoms, failed } : { ok: false, reason: 'nowhere', failed }
}

// ── bring ──

export type BringDeps = {
  /** The hosts this hive knows. */
  readonly hosts: () => Promise<readonly string[]>
  readonly publisher: () => Promise<string>
  readonly own: () => Promise<string>
  readonly nip44: () => Nip44 | null
  /** The roots of this key's verified signed index on `host`; null when it could not be read. */
  readonly roots: (host: string, publisher: string) => Promise<Readonly<Record<string, string>> | null>
  readonly fetcher: (host: string) => (sig: string) => Promise<Uint8Array | null>
  /** The sealed head of the tile this hive has at `route`, or null when it has none there. Holding the BYTES of a
   *  head is not having the tile: found live 2026-11-18, a bring cut off after its writes left the bytes held and the
   *  tile unplaced, and "already here" was then said for good. */
  readonly current: (route: readonly string[]) => Promise<string | null>
  /** Keep one verified plaintext atom under its signature. */
  readonly put: (sig: string, bytes: Uint8Array) => Promise<boolean>
  /** Land the tile at its route, from the bytes now held. `held` says this hive already has a tile there, at
   *  another version: the kept version then takes its place, as a new revision the participant can undo. */
  readonly place: (tile: { route: readonly string[]; head: string; host: string; publisher: string; held: boolean }) => Promise<void> | void
}

export type Brought = { readonly route: readonly string[]; readonly head: string; readonly host: string; readonly atoms: number }

export type BringResult =
  | { ok: true; brought: Brought[]; here: number; unopened: number; unread: string[] }
  | { ok: false; reason: 'no-nip44' | 'no-signer' | 'no-host' }

/** Bring every private tile this key keeps on the hosts this hive knows into this device. LAST KEPT WINS: a tile this
 *  device already has at another version is replaced by the kept one, as a new revision (history holds what was
 *  there). `here` counts the ones it already has at that version, `unopened` the ones this device's key does not open or whose bytes are incomplete. */
export async function bringPrivate(deps: BringDeps): Promise<BringResult> {
  const nip44 = deps.nip44()
  if (!nip44) return { ok: false, reason: 'no-nip44' }
  const publisher = (await deps.publisher().catch(() => '')).toLowerCase()
  const own = (await deps.own().catch(() => '')).toLowerCase()
  if (!SIG.test(publisher) || !SIG.test(own)) return { ok: false, reason: 'no-signer' }
  const hosts = [...new Set(await deps.hosts().catch(() => [] as string[]))]
  if (!hosts.length) return { ok: false, reason: 'no-host' }

  const brought: Brought[] = []
  const settled = new Set<string>() // a root already handled on an earlier host
  const unread: string[] = []
  let here = 0
  let unopened = 0
  for (const host of hosts) {
    const roots = await deps.roots(host, publisher).catch(() => null)
    if (!roots) { unread.push(host); continue }
    for (const [key, envelope] of Object.entries(roots)) {
      if (!key.startsWith(PRIVATE_ROOT_PREFIX) || !SIG.test(envelope) || settled.has(key)) continue
      const fetchBytes = deps.fetcher(host)
      const opened = await openSealedVersion([envelope], own, nip44, fetchBytes).catch(() => null)
      const carrier = opened ? parseCarrier(await opened.read(opened.head).catch(() => null)) : null
      // The root is only believed when the tile it carries is the tile it is named for.
      if (!opened || !carrier || (await privateRootKey(publisher, lineageKey(carrier.route))) !== key) { unopened++; continue }
      const current = await deps.current(carrier.route).catch(() => null)
      if (current === carrier.head) { settled.add(key); here++; continue }
      const atoms = new Map<string, Uint8Array>()
      let complete = true
      for (const sig of opened.atoms) {
        if (sig === opened.head) continue
        const bytes = await opened.read(sig).catch(() => null)
        if (!bytes) { complete = false; break }
        atoms.set(sig, bytes)
      }
      if (!complete || !atoms.has(carrier.head)) { unopened++; continue }
      let written = true
      // The head goes last: a hive that holds the head holds the whole tree.
      const order = [...atoms.keys()].filter(sig => sig !== carrier.head).concat(carrier.head)
      for (const sig of order) {
        const bytes = atoms.get(sig)!
        if (bytes.byteLength && !(await deps.put(sig, bytes).catch(() => false))) { written = false; break }
      }
      if (!written) { unopened++; continue }
      await deps.place({ route: carrier.route, head: carrier.head, host, publisher, held: current !== null })
      settled.add(key)
      brought.push({ route: carrier.route, head: carrier.head, host, atoms: atoms.size })
    }
  }
  return { ok: true, brought, here, unopened, unread }
}

// ── drop ──

/** Stop naming the tile's private copy on every host it names. The ciphertext stays where hosts hold it, unnamed. */
export async function dropPrivate(
  segments: readonly string[],
  deps: Pick<KeepDeps, 'hosts' | 'publisher'> & { readonly clearRoot: (host: string, key: string) => Promise<{ ok: boolean; had: boolean }> },
): Promise<{ had: number; failed: string[] }> {
  const route = segments.map(s => String(s ?? '').trim()).filter(Boolean)
  const publisher = (await deps.publisher().catch(() => '')).toLowerCase()
  if (!route.length || !SIG.test(publisher)) return { had: 0, failed: [] }
  const key = await privateRootKey(publisher, lineageKey(route))
  let had = 0
  const failed: string[] = []
  for (const host of new Set(await deps.hosts(route).catch(() => [] as string[]))) {
    const result = await deps.clearRoot(host, key).catch(() => ({ ok: false, had: false }))
    if (!result.ok) failed.push(host)
    else if (result.had) had++
  }
  return { had, failed }
}

// ── the live collaborators ──

const ioc = <T,>(key: string): T | undefined => (window as unknown as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(key) as T | undefined

const liveKeys = () => ({
  publisher: async () => (await import('./key-list.client.js')).publisherKeyHex(),
  own: async () => String((await ioc<{ getPublicKeyHex?: () => Promise<string | null> }>('@diamondcoreprocessor.com/NostrSigner')?.getPublicKeyHex?.().catch(() => null)) ?? ''),
})

const liveUploadHosts = async (segments: readonly string[]): Promise<string[]> => {
  const { nodesFor } = await import('./publish-branch.js')
  const { isPublishNode } = await import('./zone-door.js')
  const hostSync = ioc<Parameters<typeof nodesFor>[1]>('@diamondcoreprocessor.com/HostSyncService')
  return (await nodesFor(segments, hostSync).catch(() => [] as string[])).filter(isPublishNode)
}

export const liveKeepDeps = async (): Promise<KeepDeps> => {
  const sealed = await import('./sealed-publish.js')
  const pointer = await import('./hive-pointer.js')
  const { sealedHeadOf } = await import('./publish-branch.js')
  const { prepareAnchorHosts, listedKeys } = await import('./key-list.client.js')
  return {
    ...liveKeys(),
    hosts: async segments => {
      const hosts = await liveUploadHosts(segments)
      // A device that keeps for an anchor has each host hold the anchor's list before any byte goes up.
      await prepareAnchorHosts(hosts).catch(() => undefined)
      return hosts
    },
    devices: async (host, publisher) => [...((await listedKeys(host, publisher).catch(() => null)) ?? [])],
    nip44: sealed.liveNip44,
    head: sealedHeadOf,
    getBytes: sealed.liveGetBytes,
    closure: async head => {
      const walker = ioc<{ closureSigs?: (sig: string, kind?: 'layer') => Promise<{ sigs: Set<string>; complete: boolean }> }>('@diamondcoreprocessor.com/HostSyncService')
      return walker?.closureSigs ? walker.closureSigs(head, 'layer') : null
    },
    upload: sealed.liveUpload,
    setRoot: async (host, key, sig) => {
      const set = await pointer.setHiveRoot(host, key, sig)
      return { ok: set.ok, ...(set.reason && !set.ok ? { reason: set.reason } : {}) }
    },
  }
}

export const liveDropDeps = async (): Promise<Parameters<typeof dropPrivate>[1]> => {
  const pointer = await import('./hive-pointer.js')
  return {
    publisher: liveKeys().publisher,
    hosts: liveUploadHosts,
    clearRoot: async (host, key) => {
      const cleared = await pointer.clearHiveRoot(host, key)
      return { ok: cleared.ok, had: cleared.ok && cleared.reason !== 'unchanged' }
    },
  }
}

type StoreLike = {
  getResource?: (sig: string) => Promise<Blob | null>
  getResourceLocal?: (sig: string) => Promise<unknown>
  writeLayerBytes?: (signature: string, bytes: ArrayBuffer) => Promise<void>
}
type AdoptQueueLike = { enqueueAll?: (picks: readonly { sig: string; label: string; at: readonly string[]; domain?: string; pubkey?: string }[], batch: string) => unknown }

export const liveBringDeps = async (): Promise<BringDeps> => {
  const sealed = await import('./sealed-publish.js')
  const pointer = await import('./hive-pointer.js')
  const { listCommunityHosts } = await import('./community-hosts.js')
  const { EffectBus } = await import('@hypercomb/core')
  const store = (): StoreLike | undefined => ioc<StoreLike>('@hypercomb.social/Store')
  return {
    ...liveKeys(),
    hosts: listCommunityHosts,
    nip44: sealed.liveNip44,
    roots: async (host, publisher) => {
      const read = await pointer.fetchHiveIndex(host, publisher)
      // A host that holds no index for this key keeps nothing of its own: that is an answer, not a miss.
      return read.ok ? read.manifest.roots : read.reason === 'http' && read.status === 404 ? {} : null
    },
    fetcher: sealed.hostFetcher,
    current: async route => (await import('./publish-branch.js')).sealedHeadOf(route),
    // `writeLayerBytes`, as sealed-adopt.ts: a sig-named file at the flat root, refused when the bytes do not hash to
    // their name, and never announced as something the participant authored.
    put: async (sig, bytes) => {
      const write = store()?.writeLayerBytes
      if (!write) return false
      try {
        await write.call(store(), sig, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
        return true
      } catch { return false }
    },
    place: async tile => {
      const label = tile.route[tile.route.length - 1]!
      const at = tile.route.slice(0, -1)
      // A tile already here is not the queue's to update: its rule for a held tile is additive from a live swarm
      // offer, and adds nothing from a kept version (found live 2026-11-18). The drone's own sync re-homes it.
      const drone = ioc<{ syncResolvedBranch?: (branch: { layerSig: string; at: string[]; domain?: string; label: string }) => Promise<string> }>('@diamondcoreprocessor.com/SwarmAdoptDrone')
      if (tile.held && drone?.syncResolvedBranch) {
        await drone.syncResolvedBranch({ layerSig: tile.head, at: [...at], domain: tile.host, label }).catch(() => undefined)
        return
      }
      ioc<AdoptQueueLike>('@diamondcoreprocessor.com/AdoptQueueService')
        ?.enqueueAll?.([{ sig: tile.head, label, at, domain: tile.host, pubkey: tile.publisher }], `private:${Date.now()}`)
      EffectBus.emit('adopt:queued', { label, at })
      // The queue's own drone works it (swarm-adopt.drone.ts): asked now, never left for the next boot.
      EffectBus.emitTransient('adopt:drain', {})
    },
  }
}
