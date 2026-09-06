// sharing/static-peers.drone.ts
//
// THE STATIC PEER SOURCE — public hosts' creations, shaded in your hive,
// adopted one step at a time. See static-peers.ts for the doctrine and the
// pure walk; this drone is the wiring:
//
//   • OFFERS are what you asked to see (`community:offer` from a plate on the
//     community page; `community:withdraw` to stop). ONE document in the
//     `community:offers` pool — participant state, so a pool, never
//     localStorage.
//   • A TILE SOURCE in the render registry, beside the swarm's: at your top
//     level each offer is one `peer` tile; inside one, the publisher's
//     children at that route. The renderer shades a peer tile it does not
//     hold; the overlay's first click is the TAKE (swarm-adopt.drone.ts
//     `#onWand`), the second walks in. Nothing here folds anything.
//   • The closure is LOCALIZED once per head (broker, layers only) so the
//     walk reads bytes that are already content-addressed cache, and the
//     hosts are noted per sig so images stream from them on demand.
//   • The publisher's head is re-read from their signed index once per
//     session — a stale offer catches up to what they have published since.
//
// Sync lookups (`peerEntriesAt`, `isOffered`) answer from the last render's
// resolution, exactly the trick show-cell's own caches play: the render
// calls the source before any click can land on what it painted.

import { Drone, EffectBus } from '@hypercomb/core'
import { fetchHiveManifestFromAny } from './hive-pointer.js'
import {
  childEntriesOf, entryFor, layerAtRoute, readThrough,
  type StaticOffer, type StaticPeerEntry, type StaticPeersIo,
} from './static-peers.js'
import type { TileEntry, TileSource, LocationContext } from '../presentation/tiles/tile-source.types.js'

export const STATIC_PEERS_KEY = '@diamondcoreprocessor.com/StaticPeersDrone'
/** The offers document's pool. Colon-scoped: no tile can name it. DOCUMENT. */
export const COMMUNITY_OFFERS_MEANING = 'community:offers'

const SIG_RE = /^[a-f0-9]{64}$/
const REGISTRY_KEY = '@hypercomb.social/TileSourceRegistry'
const STORE_KEY = '@hypercomb.social/Store'
const BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'

type StoreLike = {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null | undefined>
  openPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null | undefined>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string) => Promise<string | null>
  getLayerPoolBytes?: (sig: string) => Promise<Uint8Array | null>
  getResource?: (sig: string) => Promise<Blob | null>
}
type BrokerLike = {
  adopt?: (root: string, opts: Record<string, unknown>) => Promise<unknown>
  noteDomainsForSig?: (sig: string, domains: readonly string[]) => void
}
type RegistryLike = { register?: (source: TileSource) => () => void }

const ioc = () => (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc

const parseOffers = (raw: unknown): StaticOffer[] => {
  const list = (raw as { offers?: unknown })?.offers
  if (!Array.isArray(list)) return []
  const out: StaticOffer[] = []
  for (const o of list as Array<Record<string, unknown>>) {
    const name = String(o?.['name'] ?? '').trim()
    const pubkey = String(o?.['pubkey'] ?? '').toLowerCase()
    const head = String(o?.['head'] ?? '').toLowerCase()
    const hosts = Array.isArray(o?.['hosts']) ? (o['hosts'] as unknown[]).map(String).filter(Boolean) : []
    const segments = Array.isArray(o?.['segments']) ? (o['segments'] as unknown[]).map(String).filter(Boolean) : []
    const lineageKey = String(o?.['lineageKey'] ?? '')
    if (!name || !SIG_RE.test(pubkey) || !SIG_RE.test(head) || !hosts.length) continue
    out.push({ name, pubkey, head, hosts, segments, lineageKey })
  }
  return out
}

export class StaticPeersDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description =
    'Offers the creations public hosts publish as shaded peer tiles in your hive — the swarm model for static content. Each step you take through them is the adopt; nothing folds on its own.'
  public override effects = ['network'] as const
  protected override listens = ['community:offer', 'community:withdraw']
  protected override emits = ['swarm:peers-changed', 'activity:log']

  #offers = new Map<string, StaticOffer>()
  #loaded = false
  #unregister: (() => void) | null = null
  /** Heads re-read from the index this session, and closures localized. */
  #refreshed = new Set<string>()
  #localized = new Set<string>()
  /** Last resolution per location key — what the sync lookups answer from. */
  #entriesByLocation = new Map<string, StaticPeerEntry[]>()

  constructor() {
    super()
    this.onEffect<Partial<StaticOffer>>('community:offer', (p) => { void this.#offer(p) })
    this.onEffect<{ name?: string }>('community:withdraw', (p) => { void this.#withdraw(String(p?.name ?? '')) })
  }

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#loaded) { this.#loaded = true; await this.#load() }
    if (!this.#unregister) this.#register(0)
  }

  protected override dispose(): void {
    this.#unregister?.()
    this.#unregister = null
  }

  // ── the offers document ──────────────────────────────────────────────

  #store = (): StoreLike | undefined => ioc()?.get<StoreLike>(STORE_KEY)

  #load = async (): Promise<void> => {
    const store = this.#store()
    if (!store?.getPoolDoc) return
    try {
      const pool = store.openPool ? await store.openPool(COMMUNITY_OFFERS_MEANING) : await store.getPool?.(COMMUNITY_OFFERS_MEANING)
      if (!pool) return
      const bytes = await store.getPoolDoc(pool)
      if (!bytes) return
      for (const o of parseOffers(JSON.parse(new TextDecoder().decode(bytes)))) this.#offers.set(o.name, o)
    } catch { /* no document yet */ }
  }

  #save = async (): Promise<void> => {
    const store = this.#store()
    if (!store?.getPool || !store.putPoolDoc) return
    try {
      const pool = await store.getPool(COMMUNITY_OFFERS_MEANING)
      if (!pool) return
      const bytes = new TextEncoder().encode(JSON.stringify({ offers: [...this.#offers.values()] })).buffer as ArrayBuffer
      await store.putPoolDoc(pool, bytes)
    } catch { /* the in-memory set stands */ }
  }

  #offer = async (p: Partial<StaticOffer>): Promise<void> => {
    const [offer] = parseOffers({ offers: [p] })
    if (!offer) return
    this.#offers.set(offer.name, offer)
    this.#entriesByLocation.clear()
    await this.#save()
    this.emitEffect('activity:log', { message: `"${offer.name}" is offered in your hive — shaded until you take it`, icon: 'public' })
    this.emitEffect('swarm:peers-changed', { sig: '', pubkey: offer.pubkey, reason: 'static-offer' })
  }

  #withdraw = async (name: string): Promise<void> => {
    const offer = this.#offers.get(name)
    if (!offer) return
    this.#offers.delete(name)
    this.#entriesByLocation.clear()
    await this.#save()
    this.emitEffect('swarm:peers-changed', { sig: '', pubkey: offer.pubkey, reason: 'static-withdraw' })
  }

  /** Every offer, for the community page's toggles. */
  public readonly offers = (): readonly StaticOffer[] => [...this.#offers.values()]
  public readonly isOffered = (name: string): boolean => this.#offers.has(String(name ?? '').trim())

  // ── the tile source ──────────────────────────────────────────────────

  #register = (attempts: number): void => {
    const registry = ioc()?.get<RegistryLike>(REGISTRY_KEY)
    if (registry?.register) {
      this.#unregister = registry.register(this.#source)
      return
    }
    if (attempts >= 50) return
    setTimeout(() => this.#register(attempts + 1), 100)
  }

  #source: TileSource = async (loc: LocationContext): Promise<readonly TileEntry[]> => {
    const entries = await this.#resolve(loc.segments.map(s => String(s ?? '').trim()).filter(Boolean))
    return entries.map(e => ({
      name: e.name,
      kind: 'peer' as const,
      source: {
        peerPubkey: e.peerPubkey,
        layerSig: e.layerSig,
        ...(e.imageSig ? { imageSig: e.imageSig } : {}),
        ...(e.index !== undefined ? { peerIndex: e.index } : {}),
      },
    }))
  }

  /** The publisher's tiles at a location, from the last render — for the
   *  wand's synchronous questions. Same shape a swarm peer tile carries. */
  public readonly peerEntriesAt = (segments: readonly string[]): readonly StaticPeerEntry[] =>
    this.#entriesByLocation.get(segments.map(s => String(s ?? '').trim()).filter(Boolean).join('/')) ?? []

  /** The offered names at a location whose publisher layer has an inside —
   *  a taken one is a BRANCH for the overlay even while childless locally. */
  public readonly branchNamesAt = (segments: readonly string[]): readonly string[] =>
    this.peerEntriesAt(segments).filter(e => e.hasChildren).map(e => e.name)

  #io = (): StaticPeersIo => {
    const store = this.#store()
    return {
      bytes: async (sig) => {
        const pooled = await store?.getLayerPoolBytes?.(sig).catch(() => null)
        if (pooled) return pooled
        const blob = await store?.getResource?.(sig).catch(() => null)
        return blob ? new Uint8Array(await blob.arrayBuffer()) : null
      },
    }
  }

  #resolve = async (segments: string[]): Promise<StaticPeerEntry[]> => {
    if (this.#offers.size === 0) return []
    const key = segments.join('/')
    const out: StaticPeerEntry[] = []
    if (segments.length === 0) {
      for (const offer of this.#offers.values()) {
        const entry = await this.#rootEntry(offer)
        if (entry) out.push(entry)
      }
    } else {
      const offer = this.#offers.get(segments[0]!)
      if (offer) {
        await this.#ready(offer)
        const here = await layerAtRoute(offer.head, segments.slice(1), this.#io())
        if (here) {
          const children = await childEntriesOf(here.layer, offer.pubkey, this.#io())
          const broker = ioc()?.get<BrokerLike>(BROKER_KEY)
          for (const c of children) {
            broker?.noteDomainsForSig?.(c.layerSig, offer.hosts)
            if (c.imageSig) broker?.noteDomainsForSig?.(c.imageSig, offer.hosts)
          }
          out.push(...children)
        }
      }
    }
    this.#entriesByLocation.set(key, out)
    return out
  }

  #rootEntry = async (offer: StaticOffer): Promise<StaticPeerEntry | null> => {
    await this.#ready(offer)
    const io = this.#io()
    const hit = await readThrough(offer.head, io)
    if (!hit) return null
    const entry = await entryFor(hit.sig, hit.record, offer.pubkey, io)
    if (!entry) return null
    const broker = ioc()?.get<BrokerLike>(BROKER_KEY)
    if (entry.imageSig) broker?.noteDomainsForSig?.(entry.imageSig, offer.hosts)
    // The tile wears the OFFER's name at your top level, whatever the
    // publisher's layer calls itself — that is the slot you asked for.
    return { ...entry, name: offer.name }
  }

  /** Head current, closure local — once per session per offer. */
  #ready = async (offer: StaticOffer): Promise<void> => {
    if (!this.#refreshed.has(offer.name)) {
      this.#refreshed.add(offer.name)
      const manifest = await fetchHiveManifestFromAny(offer.hosts, offer.pubkey).catch(() => null)
      const head = String(manifest?.roots[offer.lineageKey] ?? '').toLowerCase()
      if (SIG_RE.test(head) && head !== offer.head) {
        this.#offers.set(offer.name, { ...offer, head })
        void this.#save()
        offer = this.#offers.get(offer.name)!
      }
    }
    if (!this.#localized.has(offer.head)) {
      this.#localized.add(offer.head)
      const broker = ioc()?.get<BrokerLike>(BROKER_KEY)
      broker?.noteDomainsForSig?.(offer.head, offer.hosts)
      await broker?.adopt?.(offer.head, { layersOnly: true, silent: true, quiet: true }).catch(() => null)
    }
  }
}

const _staticPeers = new StaticPeersDrone()
window.ioc.register(STATIC_PEERS_KEY, _staticPeers)
