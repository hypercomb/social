// diamondcoreprocessor.com/sharing/swarm-adopt.drone.ts
//
// Adoption is paste with a fetch in front. When the user clicks `adopt`
// on a peer tile (kind: 'peer'), this drone localizes the publisher's
// branch subtree via the ContentBroker (the resolution protocol), re-homes
// it at the participant's CURRENT location, and folds it into the layer's
// `children` through the SAME `update({ children })` cascade as create and
// paste. After that the adopted cell is an ordinary child of the hive's
// layer — same bytes, same lineage, broadcast with everything else, drawn
// in one preloaded pass. There is no separate render source for adopted
// content and no snapshot bridge: your layer is the one way into your hive.
//
// SAFETY: this drone applies content ONLY in response to an explicit user
// click (adopt / adopt-selected / sync). It does NOT auto-fold the DCP
// installer's projected branches (RegistrySnapshot) — that automation was
// removed: nothing enters your tree from here without a participant action.
// Whether an update EXISTS (detection) and surfacing installer-installed
// content are separate MANUAL concerns — the command-line update icon opens
// the installer; the participant pulls there.

import { Drone, EffectBus, hypercomb } from '@hypercomb/core'
import {
  childNamesOf,
  flattenLayerTree,
  resolveLayerAt,
  type PlacementHistory,
  type PlacementLineage,
} from '../history/layer-placement.js'

const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'
const REGISTRY_SNAPSHOT_KEY = '@hypercomb.social/RegistrySnapshot'
// Recoverable receipt of branches this hive has folded in — the baseline the
// pending-diff (portal counts) and the un-fold (remove) path read from.
const FOLDED_KEY = 'hc:last-folded'

const SIG_RE = /^[a-f0-9]{64}$/

interface SwarmDroneLike {
  peerTilesAtCurrentSig: () => readonly ({ name: string; peerPubkey: string } & Record<string, unknown>)[]
  subscribedTiles?: () => readonly ({ name: string; peerPubkey: string } & Record<string, unknown>)[]
}

interface LineageLike {
  explorerSegments?: () => readonly string[]
}

interface BrokerLike {
  adopt: (rootSig: string, opts?: { layersOnly?: boolean }) => Promise<{ layers: number; leaves: number; failed: number }>
  noteDomainsForSig?: (sig: string, domains: string[]) => void
  getKnownDomains?: (sig: string) => string[]
}

interface CommitterLike {
  update: (
    segments: readonly string[],
    layer: { name?: string; [slot: string]: unknown },
    nameSlots?: ReadonlySet<string>,
  ) => Promise<string>
  importTree: (
    updates: { segments: readonly string[]; layer: { name?: string } & { [slot: string]: unknown } }[],
    nameSlots?: ReadonlySet<string>,
  ) => Promise<void>
}

/** The DCP installer's registry projection (control plane → data plane),
 *  cached in shared's RegistrySnapshotStore and re-emitted on EffectBus
 *  'registry:snapshot'. We read only the fields the fold needs. */
interface RegistryBranchLike {
  domain?: string
  name?: string
  branchSig?: string
  at?: string[]
  enabled?: boolean
  kind?: 'package' | 'content'
}
interface RegistrySnapshotLike { branches?: RegistryBranchLike[] }
interface RegistrySnapshotStoreLike { snapshot?: RegistrySnapshotLike | null }

/** A branch this hive has folded in — the recoverable receipt persisted at
 *  FOLDED_KEY. Drives the portal's pending-diff counts and lets a disable
 *  un-fold the right tile. Removal is recoverable: the installer keeps the
 *  branch record (re-enable re-folds) and history keeps the prior marker +
 *  the content-addressed bytes, so nothing is ever lost. */
interface FoldedEntry { sig: string; name: string; at: string[] }

interface TileActionPayload {
  action: string
  label?: string
  /** `Adopt All` over a multi-selected set carries the full list. */
  labels?: readonly string[]
  /** `adopt-selected` (panel confirm) carries participant-grouped picks;
   *  pubkey disambiguates the same name published by two peers. */
  selections?: readonly { label: string; pubkey?: string }[]
  q?: number
  r?: number
  index?: number
}

export class SwarmAdoptDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Adopts a peer tile by localizing its branch (ContentBroker) and folding it into the hive layer via the same update({children}) cascade as paste, on explicit user click ONLY — no snapshot bridge, no automatic installer fold.'

  protected override listens: string[] = ['tile:action', 'registry:snapshot']
  protected override emits: string[] = ['adopt:started', 'swarm:adopt-panel:open', 'fs:changed', 'fold:receipt']

  // Latest installer registry projection — cached for the Done-gated fold.
  #lastSnapshot: RegistrySnapshotLike | null = null

  constructor() {
    super()

    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      const action = String(payload?.action ?? '')

      // Panel-confirmed en-masse adopt. Sequential so commits land in pick
      // order rather than racing the committer queue.
      if (action === 'adopt-selected') {
        const selections = Array.isArray(payload?.selections)
          ? payload.selections
              .map(s => ({ label: String(s?.label ?? '').trim(), pubkey: String(s?.pubkey ?? '').trim().toLowerCase() }))
              .filter(s => s.label.length > 0)
          : []
        void (async () => { for (const s of selections) await this.#adoptPeerTile(s.label, s.pubkey || undefined) })()
        return
      }

      if (action !== 'adopt' && action !== 'sync') return

      // Multi-tile adopt (selection-menu Adopt All) — sequential.
      const labels = Array.isArray(payload?.labels)
        ? payload.labels.map(s => String(s ?? '').trim()).filter(Boolean)
        : []
      if (labels.length > 0) {
        void (async () => { for (const label of labels) await this.#adoptPeerTile(label) })()
        return
      }

      const label = String(payload?.label ?? '').trim()
      if (!label) return

      // Single adopt-gesture → open the participant-grouped panel; its
      // confirm comes back as `adopt-selected`. `sync` keeps the immediate
      // single-tile path for programmatic callers.
      if (action === 'adopt') {
        if (!this.#isPeerTile(label)) return
        this.emitEffect('swarm:adopt-panel:open', { preselect: [label] })
        return
      }

      void this.#adoptPeerTile(label)
    })

    // ── DCP installer round-trip → hive config fold (on ACCEPT) ────────
    // The participant adopts/enables inside the DCP installer; their intent
    // streams over as `registry:snapshot` while they toggle. NOTHING is
    // folded until they EXPLICITLY ACCEPT by clicking Done — portal-overlay
    // dispatches `actions:available` ONLY from apply(). Every passive exit
    // (the ×/back button, the backdrop, Escape, a touch-drag) fires
    // `dcp:embed-closed` instead and is DISCARDED here: a change must never
    // enter your hive — and start running — before you authorize it.
    //
    // On accept we fold the installer's enabled CONTENT config into the hive
    // sigbag via the SAME #commitBranch / update({children}) cascade a manual
    // adopt uses — the one way into your hive, the symmetric counterpart to
    // the hive→DCP content push. A discarded diff isn't lost: DCP keeps the
    // config and the installer re-surfaces it next open. Idempotent, so a
    // stray re-fire is a safe no-op (existing children → 'exists').
    this.onEffect<RegistrySnapshotLike>('registry:snapshot', (snap) => {
      this.#lastSnapshot = snap
      console.info('[swarm-adopt] registry:snapshot received —', (snap?.branches?.length ?? 0), 'branch(es)')
    })
    // Fold ONLY on the explicit accept signal, NEVER on a passive close.
    window.addEventListener('actions:available', this.#onDcpDone)
  }

  #ioc = () => (window as { ioc?: { get: (k: string) => unknown } }).ioc

  /** Is this label currently surfaced as a peer tile (current-location
   *  cache or subscribed channel)? Gate for opening the adopt panel. */
  #isPeerTile = (label: string): boolean => {
    const swarm = this.#ioc()?.get?.(SWARM_DRONE_KEY) as SwarmDroneLike | undefined
    if (!swarm?.peerTilesAtCurrentSig) return false
    if (swarm.peerTilesAtCurrentSig().some(p => p.name === label)) return true
    return swarm.subscribedTiles?.().some(p => p.name === label) ?? false
  }

  // ── adopt a peer tile → SEND THE SIG TO THE INSTALLER ──────────────
  // Adopt does NOT fetch or commit in the hive. It hands the publisher's
  // branch signature to the installer (portal-overlay opens DCP with
  // #branch=<sig>&at=…); the install happens THERE when the participant
  // toggles the node on. No in-hive broker.adopt walk (that walk's
  // adopt:meta/progress is what lit the "adopting…" header crumb), no layer
  // write.
  #adoptPeerTile = async (label: string, pubkey?: string): Promise<void> => {
    const ioc = this.#ioc()
    const swarm = ioc?.get?.(SWARM_DRONE_KEY) as SwarmDroneLike | undefined
    if (!swarm?.peerTilesAtCurrentSig) return

    // Look first in the current-location peer cache, then the subscribed
    // channel (auto-adopt-on-subscribe — the leader's tiles live at THEIR
    // channel sig). pubkey pins the publisher on overlapping names.
    const matches = (p: { name: string; peerPubkey: string }): boolean =>
      p.name === label && (!pubkey || p.peerPubkey === pubkey)
    const peerTiles = swarm.peerTilesAtCurrentSig()
    let peerEntry = peerTiles.find(matches)
    if (!peerEntry && swarm.subscribedTiles) peerEntry = swarm.subscribedTiles().find(matches)
    if (!peerEntry && pubkey) {
      peerEntry = peerTiles.find(p => p.name === label) ?? swarm.subscribedTiles?.().find(p => p.name === label)
    }
    if (!peerEntry) return

    // The publisher's signed branch root (mesh visuals carry layerSig via
    // visual-sanitizer §170), validated at the trust boundary as 64-hex.
    const layerSig = String((peerEntry as Record<string, unknown>)['layerSig'] ?? '').trim().toLowerCase()
    if (!SIG_RE.test(layerSig)) return

    // Natural placement: adopted content lands at the participant's CURRENT
    // path, regardless of where the publisher had it.
    const lineage = ioc?.get?.(LINEAGE_KEY) as LineageLike | undefined
    const segments = lineage?.explorerSegments?.() ?? []
    const at = (Array.isArray(segments) ? segments : []).map(s => String(s ?? '').trim()).filter(Boolean)

    // Publisher domain (if the broker learned it from the mesh) → so the
    // resolution protocol can HTTP-direct fetch the branch bytes.
    const broker = ioc?.get?.(BROKER_KEY) as BrokerLike | undefined
    const ownerDomain = String(broker?.getKnownDomains?.(layerSig)?.[0] ?? '').trim()

    window.dispatchEvent(new CustomEvent('portal:open', {
      detail: { target: 'dcp', branchSig: layerSig, at, domain: ownerDomain || undefined, label },
    }))
  }

  // ── the one primitive: localize + re-home + re-point children ──────
  // Mirrors clipboard paste exactly, with broker.adopt() in front.
  //
  // Serialized through #commitLock: two concurrent click-adopts both read the
  // parent's children, append, and write the full list, so running them at the
  // same time (e.g. during the slow broker.adopt) would lose one append. The
  // lock makes every commit read AFTER the previous wrote.
  #commitLock: Promise<unknown> = Promise.resolve()
  #commitBranch = (
    branchSig: string,
    atSegments: readonly string[],
    domain?: string,
  ): Promise<'committed' | 'exists' | 'unavailable'> => {
    const run = () => this.#doCommitBranch(branchSig, atSegments, domain)
    const next = this.#commitLock.then(run, run)
    this.#commitLock = next.catch(() => undefined)
    return next
  }

  #doCommitBranch = async (
    branchSig: string,
    atSegments: readonly string[],
    domain?: string,
  ): Promise<'committed' | 'exists' | 'unavailable'> => {
    const sig = String(branchSig ?? '').toLowerCase().trim()
    if (!SIG_RE.test(sig)) return 'unavailable'

    const ioc = this.#ioc()
    const broker = ioc?.get?.(BROKER_KEY) as BrokerLike | undefined
    const history = ioc?.get?.(HISTORY_KEY) as PlacementHistory | undefined
    const committer = ioc?.get?.(COMMITTER_KEY) as CommitterLike | undefined
    const lineage = ioc?.get?.(LINEAGE_KEY) as PlacementLineage | undefined
    if (!broker?.adopt || !history?.getLayerBySig || !committer?.update || !lineage) return 'unavailable'

    try {
      // Resolution protocol: pull the branch's LAYER closure into our pool so
      // getLayerBySig resolves it locally and flattenLayerTree can re-home it.
      // layersOnly — resources are sig-refs that STREAM on demand at render
      // (memory→OPFS→host write-through), so a content-rich adopt transfers a
      // handful of tiny layers, not its hundreds of images.
      if (domain) broker.noteDomainsForSig?.(sig, [domain])
      const adoptRes = await broker.adopt(sig, { layersOnly: true })

      const branchLayer = await history.getLayerBySig(sig)
      // DIAGNOSTIC: did the HIVE resolve the branch bytes? broker.adopt fetches
      // local→HTTP(domain)→mesh; failed>0 or resolved=false means the bytes
      // aren't reachable from the hive (publisher offline / domainless / not on
      // the mesh) — the content-availability edge, distinct from a wiring break.
      console.info('[swarm-adopt] fold branch', sig.slice(0, 8),
        'domain=', domain || '(none)', 'broker.adopt=', JSON.stringify(adoptRes), 'resolved=', !!branchLayer)
      const name = (branchLayer && typeof branchLayer.name === 'string') ? branchLayer.name.trim() : ''
      // Name rides untrusted signed peer content — reject path separators and
      // control chars (they corrupt the lineage path). Hyphens/spaces are fine.
      if (!branchLayer || !name || /[\\/\x00-\x1f]/.test(name)) return 'unavailable'

      const at = (Array.isArray(atSegments) ? atSegments : []).map(s => String(s ?? '').trim()).filter(Boolean)
      // Resolve the parent ROBUSTLY — resolveLayerAt walks the parent chain to
      // root. The bare currentLayerAt(sign(at)) reads `at`'s OWN bag, which is
      // cold for the very location the user is viewing when they adopt (the
      // renderer paints through the cursor, warming a different cache); a null
      // read there makes existing=[] and the children SET below WIPE the
      // siblings it couldn't see. Mirrors clipboard paste's #resolveParentLayer.
      const parent = await resolveLayerAt(history, lineage.domain, at)
      const existing = await childNamesOf(history, parent)
      if (existing.includes(name)) return 'exists' // already a child here — idempotent

      // Re-home the subtree and fold the name into the parent's children in ONE
      // mechanical importTree cascade — each affected ancestor commits exactly
      // once, the same primitive create / paste / bulk-import use.
      // flattenLayerTree re-expresses the branch subtree as importTree updates
      // (children by name, other slots verbatim); the parent update folds in the
      // new top.
      const treeUpdates = await flattenLayerTree(history, branchLayer, [...at, name])
      await committer.importTree([
        { segments: at, layer: { ...(parent ?? {}), children: [...existing, name] } },
        ...treeUpdates,
      ])
      EffectBus.emit('fs:changed', { segments: at })
      await new hypercomb().act()
      return 'committed'
    } catch (err) {
      console.warn('[swarm-adopt] commit failed', { sig: sig.slice(0, 8), err })
      return 'unavailable'
    }
  }

  // ── DCP→hive config fold (accept-gated: actions:available) ────────
  #onDcpDone = (ev?: Event): void => {
    console.info('[swarm-adopt] fold trigger:', ev?.type ?? 'manual')
    void this.#foldEnabledConfig()
  }

  #folding = false
  #foldEnabledConfig = async (): Promise<void> => {
    if (this.#folding) return            // a fold is already running — skip re-entry
    this.#folding = true
    try {
      // Prefer the persisted snapshot store (survives reloads); fall back to
      // the last live snapshot seen this session.
      const store = this.#ioc()?.get?.(REGISTRY_SNAPSHOT_KEY) as RegistrySnapshotStoreLike | undefined
      const snap = store?.snapshot ?? this.#lastSnapshot
      const branches: RegistryBranchLike[] = (snap && Array.isArray(snap.branches)) ? snap.branches : []

      // DESIRED = the installer's ENABLED CONTENT branches (its current intent).
      // Packages are functionality (refs only, never tiles); disabled = off.
      const desired = branches.filter((b): b is RegistryBranchLike & { branchSig: string } =>
        !!b && b.enabled !== false
        && (b.kind ?? 'content') === 'content'
        && typeof b.branchSig === 'string' && SIG_RE.test(b.branchSig.toLowerCase()))

      // FOLDED = the recoverable receipt of what this hive last folded in.
      const folded = this.#loadFolded()
      const desiredSigs = new Set(desired.map(b => b.branchSig.toLowerCase()))
      const foldedSigs = new Set(folded.map(f => f.sig))

      // ADDS = desired, not yet folded.  REMOVES = folded, no longer desired.
      const adds = desired.filter(b => !foldedSigs.has(b.branchSig.toLowerCase()))
      const removes = folded.filter(f => !desiredSigs.has(f.sig))

      console.info(`[swarm-adopt] fold: desired ${desired.length}, folded ${folded.length} → +${adds.length} −${removes.length}`)
      if (!adds.length && !removes.length) return

      // Next receipt begins as the still-desired folded entries.
      const nextFolded: FoldedEntry[] = folded.filter(f => desiredSigs.has(f.sig))
      let committed = 0, removed = 0, unavailable = 0

      // REMOVES first — un-fold the tile from the hive membership. RECOVERABLE:
      // the installer keeps the branch record (re-enable re-folds) and history
      // keeps the prior marker + content-addressed bytes, so nothing is lost.
      for (const f of removes) {
        const ok = await this.#unfoldBranch(f.name, f.at)
        if (ok) removed++
        else nextFolded.push(f)   // couldn't remove → keep it in the receipt
      }

      // ADDS — fold the newly-enabled content in (layersOnly; resources stream).
      for (const b of adds) {
        const at = Array.isArray(b.at) ? b.at.map(s => String(s ?? '').trim()).filter(Boolean) : []
        const res = await this.#commitBranch(b.branchSig.toLowerCase(), at, b.domain ? String(b.domain) : undefined)
        if (res === 'committed' || res === 'exists') {
          committed++
          nextFolded.push({ sig: b.branchSig.toLowerCase(), name: String(b.name ?? '').trim(), at })
        } else {
          unavailable++   // bytes unresolved — stays a pending add for next time
        }
      }

      // Persist the new recoverable receipt (sorted by sig — a stable list whose
      // sha256 is the hive's installed signature the installer can verify).
      this.#saveFolded([...nextFolded].sort((a, b) => a.sig.localeCompare(b.sig)))
      console.info(`[swarm-adopt] DCP config fold — +${committed} −${removed} (${unavailable} unavailable)`)
      EffectBus.emit('fold:receipt', { committed, removed, unavailable })
    } finally {
      this.#folding = false
    }
  }

  // ── recoverable fold receipt (persisted) ──────────────────────────
  #loadFolded = (): FoldedEntry[] => {
    try {
      const raw = localStorage.getItem(FOLDED_KEY)
      const arr = raw ? JSON.parse(raw) : []
      return Array.isArray(arr)
        ? arr
            .filter((e: unknown): e is FoldedEntry =>
              !!e && typeof (e as FoldedEntry).sig === 'string' && typeof (e as FoldedEntry).name === 'string')
            .map((e: FoldedEntry) => ({ sig: e.sig.toLowerCase(), name: e.name, at: Array.isArray(e.at) ? e.at : [] }))
        : []
    } catch { return [] }
  }
  #saveFolded = (entries: FoldedEntry[]): void => {
    try { localStorage.setItem(FOLDED_KEY, JSON.stringify(entries)) } catch { /* no localStorage — diff degrades */ }
  }

  // ── un-fold (remove) a tile from the hive membership — recoverable ──
  // Serialized through the SAME #commitLock as #commitBranch so adds/removes
  // never race on a parent's children list.
  #unfoldBranch = (name: string, atSegments: readonly string[]): Promise<boolean> => {
    const run = () => this.#doUnfoldBranch(name, atSegments)
    const next = this.#commitLock.then(run, run)
    this.#commitLock = next.catch(() => undefined)
    return next
  }

  #doUnfoldBranch = async (name: string, atSegments: readonly string[]): Promise<boolean> => {
    const n = String(name ?? '').trim()
    if (!n) return false
    const ioc = this.#ioc()
    const history = ioc?.get?.(HISTORY_KEY) as PlacementHistory | undefined
    const committer = ioc?.get?.(COMMITTER_KEY) as CommitterLike | undefined
    const lineage = ioc?.get?.(LINEAGE_KEY) as PlacementLineage | undefined
    if (!history?.sign || !history?.currentLayerAt || !committer?.update || !lineage) return false
    try {
      const at = (Array.isArray(atSegments) ? atSegments : []).map(s => String(s ?? '').trim()).filter(Boolean)
      const atLoc = await history.sign({ domain: lineage.domain, explorerSegments: () => at })
      const parent = await history.currentLayerAt(atLoc)
      const existing = await childNamesOf(history, parent)
      if (!existing.includes(n)) return true   // already gone — idempotent
      // Removal = a NEW marker without this child. The prior marker (with it)
      // and the content bytes persist (append-only + content-addressed), so a
      // later re-enable re-folds it — "a path back to recovery, always".
      await committer.update(at, { ...(parent ?? {}), children: existing.filter(c => c !== n) })
      EffectBus.emit('fs:changed', { segments: at })
      await new hypercomb().act()
      return true
    } catch (err) {
      console.warn('[swarm-adopt] unfold failed', { name: n, err })
      return false
    }
  }

}

const _swarmAdopt = new SwarmAdoptDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/SwarmAdoptDrone',
  _swarmAdopt,
)
