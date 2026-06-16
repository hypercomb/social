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
  cloneLayerTree,
  type PlacementHistory,
  type PlacementLineage,
} from '../history/layer-placement.js'

const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'

const SIG_RE = /^[a-f0-9]{64}$/

interface SwarmDroneLike {
  peerTilesAtCurrentSig: () => readonly ({ name: string; peerPubkey: string } & Record<string, unknown>)[]
  subscribedTiles?: () => readonly ({ name: string; peerPubkey: string } & Record<string, unknown>)[]
}

interface LineageLike {
  explorerSegments?: () => readonly string[]
}

interface BrokerLike {
  adopt: (rootSig: string) => Promise<{ layers: number; leaves: number; failed: number }>
  noteDomainsForSig?: (sig: string, domains: string[]) => void
  getKnownDomains?: (sig: string) => string[]
}

interface CommitterLike {
  update: (
    segments: readonly string[],
    layer: { name?: string; [slot: string]: unknown },
    nameSlots?: ReadonlySet<string>,
  ) => Promise<string>
}

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

  protected override listens: string[] = ['tile:action']
  protected override emits: string[] = ['adopt:started', 'swarm:adopt-panel:open', 'fs:changed']

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
      // Resolution protocol: pull the branch's whole subtree into our pool so
      // getLayerBySig resolves it locally — "indistinguishable from authored".
      if (domain) broker.noteDomainsForSig?.(sig, [domain])
      await broker.adopt(sig)

      const branchLayer = await history.getLayerBySig(sig)
      const name = (branchLayer && typeof branchLayer.name === 'string') ? branchLayer.name.trim() : ''
      // Name rides untrusted signed peer content — reject path separators and
      // control chars (they corrupt the lineage path). Hyphens/spaces are fine.
      if (!branchLayer || !name || /[\\/\x00-\x1f]/.test(name)) return 'unavailable'

      const at = (Array.isArray(atSegments) ? atSegments : []).map(s => String(s ?? '').trim()).filter(Boolean)
      const atLoc = await history.sign({ domain: lineage.domain, explorerSegments: () => at })
      const parent = await history.currentLayerAt(atLoc)
      const existing = await childNamesOf(history, parent)
      if (existing.includes(name)) return 'exists' // already a child here — idempotent

      // Re-home the subtree at [...at, name], then fold the name into the
      // parent's children — one update(), one collection, broadcast.
      await cloneLayerTree(history, lineage, branchLayer, [...at, name])
      await committer.update(at, { ...(parent ?? {}), children: [...existing, name] })
      EffectBus.emit('fs:changed', { segments: at })
      await new hypercomb().act()
      return 'committed'
    } catch (err) {
      console.warn('[swarm-adopt] commit failed', { sig: sig.slice(0, 8), err })
      return 'unavailable'
    }
  }

}

const _swarmAdopt = new SwarmAdoptDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/SwarmAdoptDrone',
  _swarmAdopt,
)
