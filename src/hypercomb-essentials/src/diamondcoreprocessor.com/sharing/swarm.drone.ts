// diamondcoreprocessor.com/sharing/swarm.drone.ts
//
// Public swarm sync over the Nostr mesh.
//
// Wire shape: a parameterized replaceable Nostr event per peer per
// lineage. The relay holds exactly one event per (pubkey, kind, d-tag)
// triple — replaceability gives us late-joiner discovery in a single
// REQ without anyone having to republish, and updates from a peer
// overwrite their slot in place.
//
//   kind     SWARM_LAYER_KIND (30200) — parameterized replaceable range
//   tags     [['x', lineageSig], ['d', lineageSig]]
//                x = the existing mesh filter convention (NostrMeshDrone
//                    subscribes by `#x`); kept identical so the existing
//                    bucketing / fan-out works unchanged.
//                d = the canonical replaceable-event parameter; what the
//                    relay uses to dedupe by (pubkey, kind, d-tag).
//   content  JSON: { children: [{ name }] } — the publishing peer's
//                  tile-layer at this lineage. Empty children means
//                  "I'm here, contributing nothing" (a soft leave).
//
// Render path: the SwarmTileSource (registered with TileSourceRegistry
// at boot) reads peerTilesAtCurrentSig(). Show-cell calls
// registry.resolve() on every render, so any change to peer state
// surfaces on the next paint — and show-cell's existing mesh
// subscription on the same sig auto-triggers that paint when an event
// arrives, so we don't need to dispatch a render signal ourselves.

import { Drone } from '@hypercomb/core'

const SWARM_LAYER_KIND = 30200
const NOSTR_MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const TILE_SOURCE_REGISTRY_KEY = '@hypercomb.social/TileSourceRegistry'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const SIGNATURE_STORE_KEY = '@hypercomb/SignatureStore'
const STORE_KEY = '@hypercomb.social/Store'

// How deep we walk our local subtree on each publish. Capped so a
// publisher's entire OPFS isn't dumped onto the relay at boot — but
// deep enough that a receiver navigating into a peer tile actually
// sees the peer's children there. 3 = current + 3 descendant levels.
const MAX_PUBLISH_DEPTH = 3

// Hard cap on per-publish-burst event count. Defensive against a
// publisher with thousands of cells filling the relay in one wave.
const MAX_PUBLISH_NODES = 200

interface SwarmLayerPayload {
  children: { name: string; index?: number }[]
}

interface MeshEvtLike {
  relay: string
  sig: string
  event: { kind?: number; pubkey?: string; tags?: string[][]; content?: string }
  payload: unknown
}

interface MeshSubLike { close: () => void }

interface MeshApi {
  publish: (kind: number, sig: string, payload: unknown, extraTags?: string[][]) => Promise<boolean>
  subscribe: (sig: string, cb: (e: MeshEvtLike) => void) => MeshSubLike
  configureKinds: (kinds: number[] | null, persist?: boolean) => void
  ensureStartedForSig: (sig: string) => void
}

interface SignerApi {
  getPublicKeyHex: () => Promise<string | null>
}

interface LineageLike extends EventTarget {
  explorerSegments?: () => readonly string[]
  // Note: we deliberately do NOT call lineage.explorerDir() here — its
  // result-cache stores `null` when Store isn't ready yet, and that
  // null is then served to every other caller (including show-cell)
  // until the next invalidate(). We walk Store.hypercombRoot ourselves
  // to avoid polluting that shared cache.
}

interface SignatureStoreLike {
  signText: (input: string) => Promise<string>
}

interface StoreLike {
  hypercombRoot?: FileSystemDirectoryHandle | null
}

interface TileSourceRegistryLike {
  register: (source: (loc: { segments: readonly string[]; dir: FileSystemDirectoryHandle | null }) =>
    Promise<readonly { name: string; kind: string; source: Record<string, unknown> }[]>) => () => void
}

const SYSTEM_DIR_NAMES = new Set([
  '__dependencies__', '__bees__', '__layers__', '__location__',
  '__history__', '__optimization__', '__resources__',
])

function isSystemDirName(name: string): boolean {
  if (!name) return true
  if (SYSTEM_DIR_NAMES.has(name)) return true
  return name.startsWith('__') && name.endsWith('__')
}

async function listLocalChildren(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const out: string[] = []
  try {
    for await (const [name, h] of (dir as unknown as {
      entries: () => AsyncIterable<[string, FileSystemHandle]>
    }).entries()) {
      if (h.kind !== 'directory') continue
      if (isSystemDirName(name)) continue
      out.push(name)
    }
  } catch { /* ignore — return what we have */ }
  out.sort((a, b) => a.localeCompare(b))
  return out
}

// Lightweight 0000 reader. Mirrors readCellProperties() in
// editor/tile-properties.ts; kept local so swarm.drone has no
// presentation/editor import chain. Returns {} on missing/parse-fail
// — callers treat absence as "no index field".
async function readChildProperties(cellDir: FileSystemDirectoryHandle): Promise<Record<string, unknown>> {
  let fh: FileSystemFileHandle
  try { fh = await cellDir.getFileHandle('0000') }
  catch { return {} }
  try {
    const f = await fh.getFile()
    const txt = await f.text()
    const v = JSON.parse(txt)
    return (v && typeof v === 'object') ? v as Record<string, unknown> : {}
  } catch { return {} }
}

export class SwarmDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Public swarm sync. Each peer publishes their layer at every visited lineage as a parameterized replaceable Nostr event; subscribers cache a Map<pubkey, layer> per lineage and surface peer tiles to the renderer via TileSourceRegistry.'

  public override effects = ['network'] as const

  protected override deps = {
    mesh: NOSTR_MESH_KEY,
    signer: NOSTR_SIGNER_KEY,
  }
  // Listens to mesh:ensure-started purely for backward-compat — show-cell
  // emits it on every render; if it fires before our lineage-change hook
  // resolves, we still subscribe + publish on time. The primary trigger is
  // the Lineage `change` event we wire up in the constructor below.
  protected override listens: string[] = ['mesh:ensure-started', 'mesh:public-changed']
  protected override emits: string[] = ['swarm:peers-changed']

  // Per-lineage subscription handle. We open one per visited sig and
  // never close (cheap — mesh dedupes by sig at the bucket layer).
  #subsBySig = new Map<string, MeshSubLike>()

  // Per-lineage peer state. Outer key = lineage sig, inner key = peer
  // pubkey. Updated on every incoming event; replaceability means the
  // last write wins per peer, which matches what we want at render.
  #peerLayersBySig = new Map<string, Map<string, SwarmLayerPayload>>()

  // Per-lineage memo of the last children list we published. Used to
  // skip republishing when nothing about our local layer changed.
  #lastPublishedBySig = new Map<string, string>()

  // Resolved lazily from NostrSigner. Until it lands, incoming events
  // aren't filtered for self — which is harmless because show-cell
  // already dedupes peer entries against its OPFS-owned set, so our
  // own tiles still surface as `kind: 'opfs'` not `kind: 'peer'`.
  #myPubkey: string | null = null

  // The most recent lineage sig surfaced via mesh:ensure-started. The
  // TileSource queries with the current location's segments; we trust
  // show-cell to call registry.resolve at the same lineage it just
  // emitted ensure-started for, so this is the right key to read.
  #currentSig = ''

  // Debounce token for swarm:peers-changed emission. Each peer's
  // subtree publish fans out ~10–30 events to subscribers in a burst;
  // emitting on every one made show-cell reset its render cache faster
  // than it could complete a render, leaving local tiles unsurfaced.
  // Coalesced to one emit per ~150ms so the canvas settles between
  // bursts but live updates still feel responsive.
  #peersChangedTimer: ReturnType<typeof setTimeout> | null = null

  #initialized = false

  constructor() {
    super()
    // Boot wiring — needs the IoC singletons to be registered, which
    // happens during module load. Defer to next tick so module load
    // order doesn't matter (NostrMeshDrone, NostrSigner, the
    // TileSourceRegistry, and Lineage may register after us). Each
    // setup task retries until its dependency is reachable; one-shot
    // boot is fragile because module-load race windows are real.
    queueMicrotask(() => this.#configureMeshKinds(0))
    queueMicrotask(() => this.#registerTileSource(0))
    queueMicrotask(() => { void this.#resolveMyPubkey() })
    queueMicrotask(() => this.#hookLineageChanges(0))
  }

  protected override sense = () => true

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    // Backup trigger — if show-cell happens to be running its render
    // loop, ride its emit. The primary trigger is lineage `change`
    // (wired up in the constructor) which fires the same logic without
    // depending on processor pulses or any other drone.
    this.onEffect<{ signature: string }>('mesh:ensure-started', ({ signature }) => {
      void this.#syncForSig(String(signature ?? '').trim())
    })

    // Mesh-public toggle handler. Going OFF tears down state so temp
    // shared tiles disappear from the canvas. Going ON re-runs the
    // current-lineage sync so subscriptions reattach + we publish
    // without the user having to navigate first — without this the
    // toggle felt like sync was broken (mesh comes back online but
    // nothing happens until a 'change' event fires).
    this.onEffect<{ public: boolean }>('mesh:public-changed', (payload) => {
      if (payload?.public === false) {
        for (const sub of this.#subsBySig.values()) {
          try { sub.close() } catch { /* ignore */ }
        }
        this.#subsBySig.clear()
        this.#peerLayersBySig.clear()
        this.#lastPublishedBySig.clear()
        this.emitEffect('swarm:peers-changed', { sig: this.#currentSig, reason: 'mode-private' })
        return
      }
      // public === true → wake the swarm at the current lineage.
      void this.#syncForCurrentLineage()
    })
  }

  // -----------------------------------------------------------------
  // Public — the SwarmTileSource queries this on every render.
  // -----------------------------------------------------------------

  /** All children any peer is currently publishing at #currentSig,
   *  excluding our own slot. Each entry carries the publisher's pubkey
   *  so the renderer can apply mine-vs-theirs treatment downstream. */
  public peerTilesAtCurrentSig = (): readonly { name: string; peerPubkey: string }[] => {
    const peerLayers = this.#peerLayersBySig.get(this.#currentSig)
    if (!peerLayers || peerLayers.size === 0) return []
    const out: { name: string; peerPubkey: string }[] = []
    for (const [pubkey, layer] of peerLayers) {
      if (this.#myPubkey && pubkey === this.#myPubkey) continue
      const children = Array.isArray(layer?.children) ? layer.children : []
      for (const c of children) {
        const name = String(c?.name ?? '').trim()
        if (!name) continue
        out.push({ name, peerPubkey: pubkey })
      }
    }
    return out
  }

  // -----------------------------------------------------------------
  // Boot
  // -----------------------------------------------------------------

  #configureMeshKinds = (attempts: number): void => {
    const mesh = this.#getMesh()
    if (!mesh?.configureKinds) {
      if (attempts >= 50) return  // ~5s of retries — give up silently
      setTimeout(() => this.#configureMeshKinds(attempts + 1), 100)
      return
    }
    // Explicit allowlist (legacy 29010 from paired-channel + show-cell's
    // sync-request workaround, plus our swarm kind 30200). Setting `null`
    // here would make the mesh route ALL kinds to every subscriber's
    // callback — show-cell's callback then runs requestRender on every
    // kind 30200 arrival, churning its render loop and visibly
    // suppressing local tiles.
    //
    // CRITICAL: without our kind in the list, the mesh's REQ filter pins
    // to the legacy default [29010] and our swarm events get filtered
    // out at the relay — silent miss.
    mesh.configureKinds([29010, SWARM_LAYER_KIND], true)
  }

  #registerTileSource = (attempts: number): void => {
    const registry = this.#getRegistry()
    if (registry?.register) {
      const source = async (_loc: { segments: readonly string[]; dir: FileSystemDirectoryHandle | null }) => {
        const tiles = this.peerTilesAtCurrentSig()
        return tiles.map(({ name, peerPubkey }) => ({
          name,
          kind: 'peer' as const,
          source: { peerPubkey },
        }))
      }
      registry.register(source)
      return
    }
    if (attempts >= 50) return  // ~5s of retries is enough; give up silently
    setTimeout(() => this.#registerTileSource(attempts + 1), 100)
  }

  #resolveMyPubkey = async (): Promise<void> => {
    const signer = this.#getSigner()
    if (!signer?.getPublicKeyHex) return
    try {
      const pk = await signer.getPublicKeyHex()
      if (pk) this.#myPubkey = pk.toLowerCase()
    } catch { /* ignore — left null, no self-filter applied */ }
  }

  // Wire ourselves to Lineage's `change` events so we follow navigation
  // independently of show-cell's render loop. This is the primary trigger
  // for "current location changed" — fires whenever the user navigates,
  // even before any user input has caused a processor pulse.
  //
  // Gating: also waits for NostrMeshDrone before firing the boot sync.
  // If mesh isn't ready when we fire, #ensureSubscribed silently skips
  // and we'd never subscribe (no further `change` events to retry on
  // when the user is idle on a freshly-loaded location).
  #hookLineageChanges = (attempts: number): void => {
    const lineage = this.#getLineage()
    const sigStore = this.#getSignatureStore()
    const mesh = this.#getMesh()
    if (!lineage || !sigStore || !mesh) {
      if (attempts >= 50) return  // ~5s of retries — give up silently
      setTimeout(() => this.#hookLineageChanges(attempts + 1), 100)
      return
    }
    lineage.addEventListener('change', () => { void this.#syncForCurrentLineage() })
    // Fire once for the current location at boot so we're already
    // subscribed + published before the user navigates anywhere.
    void this.#syncForCurrentLineage()
  }

  #syncForCurrentLineage = async (): Promise<void> => {
    const lineage = this.#getLineage()
    const sigStore = this.#getSignatureStore()
    if (!lineage || !sigStore) return

    const segsRaw = lineage.explorerSegments?.() ?? []
    // Match show-cell's sig derivation exactly: trim, drop empty, join
    // with '/'. Any drift here means the swarm subscribes to a different
    // sig than show-cell uses, and peers never see each other's tiles.
    const segments = (Array.isArray(segsRaw) ? segsRaw : [])
      .map((x: unknown) => String(x ?? '').trim())
      .filter((x: string) => x.length > 0)
    const key = segments.join('/')

    let sig = ''
    try { sig = await sigStore.signText(key) } catch { return }
    if (!sig) return

    await this.#syncForSig(sig)
  }

  #syncForSig = async (sig: string): Promise<void> => {
    if (!sig) return
    this.#currentSig = sig
    this.#ensureSubscribed(sig)
    await this.#publishMyLayerAt(sig)
  }

  // -----------------------------------------------------------------
  // Subscribe / receive
  // -----------------------------------------------------------------

  #ensureSubscribed = (sig: string): void => {
    if (this.#subsBySig.has(sig)) return
    const mesh = this.#getMesh()
    if (!mesh?.subscribe) return
    const sub = mesh.subscribe(sig, (evt) => this.#onEvent(sig, evt))
    this.#subsBySig.set(sig, sub)
  }

  #onEvent = (sig: string, evt: MeshEvtLike): void => {
    // Filter to our swarm kind only — the mesh allowlist is `null`,
    // so events of any kind that match the lineage `#x` filter reach
    // this callback.
    const kind = Number(evt?.event?.kind ?? 0)
    if (kind !== SWARM_LAYER_KIND) return

    // Local fanout has no pubkey on the event (the mesh fans the
    // unsigned event before signing). Skip — our own publish already
    // updated #lastPublishedBySig and a self entry doesn't add value.
    const pubkey = String(evt?.event?.pubkey ?? '').trim().toLowerCase()
    if (!pubkey) return

    // Self-skip via relay echo. Until #myPubkey resolves this is a
    // no-op; show-cell's localCellSet dedup catches the overlap.
    if (this.#myPubkey && pubkey === this.#myPubkey) return

    const payload = evt?.payload
    if (!payload || typeof payload !== 'object') return
    const layer = payload as SwarmLayerPayload
    if (!Array.isArray(layer.children)) return

    let bag = this.#peerLayersBySig.get(sig)
    if (!bag) { bag = new Map(); this.#peerLayersBySig.set(sig, bag) }
    const previousLayer = bag.get(pubkey)
    const isNewPeer = previousLayer === undefined
    const layerChanged = isNewPeer ||
      JSON.stringify(previousLayer) !== JSON.stringify(layer)
    bag.set(pubkey, layer)

    // Tell renderers about the new/changed peer so they repaint without
    // waiting for the user to navigate or interact. Show-cell's mesh
    // callback was previously the trigger, but it now ignores swarm-
    // kind events to avoid render churn — so the swarm has to surface
    // its own state-changed signal here. Suppressed when nothing about
    // this peer's layer actually changed (replaceability echoes), and
    // debounced so a publisher's subtree-publish burst (~10–30 events)
    // collapses to a single render trigger instead of cancelling
    // show-cell's render mid-flight on each event.
    if (layerChanged) {
      this.#schedulePeersChangedEmit({
        sig,
        pubkey,
        reason: isNewPeer ? 'peer-arrived' : 'layer-updated',
      })
    }
  }

  #schedulePeersChangedEmit = (payload: { sig: string; pubkey: string; reason: string }): void => {
    if (this.#peersChangedTimer !== null) return  // already queued for this burst
    this.#peersChangedTimer = setTimeout(() => {
      this.#peersChangedTimer = null
      this.emitEffect('swarm:peers-changed', payload)
    }, 150)
  }

  // -----------------------------------------------------------------
  // Publish
  // -----------------------------------------------------------------

  #publishMyLayerAt = async (sig: string): Promise<void> => {
    const mesh = this.#getMesh()
    const sigStore = this.#getSignatureStore()
    if (!mesh?.publish || !sigStore) return

    // Resolve the lineage's directory ourselves from Store.hypercombRoot
    // rather than calling lineage.explorerDir() — see LineageLike comment.
    const dir = await this.#resolveLineageDir()
    if (!dir) return

    const lineage = this.#getLineage()
    const segsRaw = lineage?.explorerSegments?.() ?? []
    const segments = (Array.isArray(segsRaw) ? segsRaw : [])
      .map((x: unknown) => String(x ?? '').trim())
      .filter((x: string) => x.length > 0)

    // Walk our local subtree from the current lineage and publish at
    // each descendant sig too. This is what lets a peer see our full
    // hierarchy by clicking down into peer tiles — without it, only
    // the current lineage has a publish on the relay and navigation
    // into a peer tile lands on an empty page. Depth-capped + node-
    // capped to bound the publish burst.
    const counter = { count: 0 }
    void this.#publishSubtree(dir, segments, 0, counter, sigStore, mesh)
    void sig  // sig is recomputed inside #publishSubtree from segments
  }

  #publishSubtree = async (
    dir: FileSystemDirectoryHandle,
    segments: readonly string[],
    depth: number,
    counter: { count: number },
    sigStore: SignatureStoreLike,
    mesh: MeshApi,
  ): Promise<void> => {
    if (counter.count >= MAX_PUBLISH_NODES) return

    const key = segments.join('/')
    let sig = ''
    try { sig = await sigStore.signText(key) } catch { return }
    if (!sig) return

    const childNames = await listLocalChildren(dir)

    // Read each child's index from its 0000 file in parallel — gives
    // followers (peers in follow-host mode) a (name, index) map they
    // can apply to their own pinned-layout slot machine. Children with
    // no 0000 or no index field publish without `index` (downstream
    // assigns next-free slot).
    const children = await Promise.all(childNames.map(async name => {
      try {
        const childDir = await dir.getDirectoryHandle(name, { create: false })
        const props = await readChildProperties(childDir)
        const idx = Number(props['index'])
        return Number.isFinite(idx) && idx >= 0
          ? { name, index: idx }
          : { name }
      } catch {
        return { name }
      }
    }))
    const payload: SwarmLayerPayload = { children }

    // Dedupe — only publish if our local layer at this sig has actually
    // changed since the last publish. Without this, every navigation
    // would re-emit the same children list, generating relay noise.
    const serialized = JSON.stringify(payload)
    if (this.#lastPublishedBySig.get(sig) !== serialized) {
      this.#lastPublishedBySig.set(sig, serialized)
      counter.count++
      // d-tag = lineage sig: parameterized-replaceable per
      // (pubkey, kind, lineage). Late joiners get this slot in a
      // single REQ; updates replace in place.
      await mesh.publish(SWARM_LAYER_KIND, sig, payload, [['d', sig]])
    }

    if (depth >= MAX_PUBLISH_DEPTH) return

    for (const childName of childNames) {
      if (counter.count >= MAX_PUBLISH_NODES) break
      let childDir: FileSystemDirectoryHandle
      try { childDir = await dir.getDirectoryHandle(childName, { create: false }) }
      catch { continue }
      await this.#publishSubtree(
        childDir,
        [...segments, childName],
        depth + 1,
        counter,
        sigStore,
        mesh,
      )
    }
  }

  // -----------------------------------------------------------------
  // IoC resolvers
  // -----------------------------------------------------------------

  #getMesh = (): MeshApi | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(NOSTR_MESH_KEY) as MeshApi | undefined

  #getSigner = (): SignerApi | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(NOSTR_SIGNER_KEY) as SignerApi | undefined

  #getRegistry = (): TileSourceRegistryLike | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(TILE_SOURCE_REGISTRY_KEY) as TileSourceRegistryLike | undefined

  #getLineage = (): LineageLike | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(LINEAGE_KEY) as LineageLike | undefined

  #getSignatureStore = (): SignatureStoreLike | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(SIGNATURE_STORE_KEY) as SignatureStoreLike | undefined

  #getStore = (): StoreLike | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(STORE_KEY) as StoreLike | undefined

  // Resolve the FileSystemDirectoryHandle for the current lineage by
  // walking from Store.hypercombRoot using the segments — bypasses
  // lineage's explorerDir cache so a too-early call here can never
  // pollute show-cell's later reads with a cached null.
  #resolveLineageDir = async (): Promise<FileSystemDirectoryHandle | null> => {
    const store = this.#getStore()
    const root = store?.hypercombRoot
    if (!root) return null

    const lineage = this.#getLineage()
    const segs = lineage?.explorerSegments?.() ?? []
    const segments = (Array.isArray(segs) ? segs : [])
      .map((x: unknown) => String(x ?? '').trim())
      .filter((x: string) => x.length > 0)

    let dir: FileSystemDirectoryHandle = root
    for (const seg of segments) {
      try {
        dir = await dir.getDirectoryHandle(seg, { create: false })
      } catch {
        return null
      }
    }
    return dir
  }
}

const _swarmDrone = new SwarmDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/SwarmDrone',
  _swarmDrone,
)
