// diamondcoreprocessor.com/sharing/swarm-adopt.drone.ts
//
// Adoption path for peer-published swarm tiles. Sig-handoff-only model:
// when the user clicks `adopt` on a peer's tile (kind: 'peer'), this drone
// reads the publisher's branchSig from the mesh visual and hands it off to
// the canonical installer via window.dispatchEvent('portal:open', ...).
//
// THE DRONE DOES NOT COMMIT OR FETCH. Per the architectural decision
// captured in src/documentation/network-architecture.md:
//   "the only thing you receive from the adopt button is the result
//    meta-layer signature. Then you use the host to retrieve them in
//    your installer and view and adopt them there."
//
// All of the previous behavior — writeTilePropertiesAt + broker.adopt +
// resource walks + substrate fallback — has been REMOVED because the
// canonical installer (running at its own origin in an iframe) is now
// responsible for adoption mechanics. The hive's job is the sig + at
// handoff and nothing else.
//
// Browser hash routing: the destination URL is
//   https://diamondcoreprocessor.com/#branch=<sig>&at=<segments>
// where `at` is the participant's current navigation path joined by
// comma (URLSearchParams reserves '&' and '=' so '/' wouldn't survive
// the param split). DCP's home.component reads the hash on init AND on
// every hashchange event, so re-adopting a different sig from the same
// portal session correctly re-renders the new branch.

import { Drone, EffectBus } from '@hypercomb/core'

const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const LINEAGE_KEY = '@hypercomb.social/Lineage'

interface SwarmDroneLike {
  peerTilesAtCurrentSig: () => readonly ({
    name: string
    peerPubkey: string
  } & Record<string, unknown>)[]
  /** Tiles from the subscribed leader's personal channel. Adopt looks
   *  here as a fallback when the requested label isn't at the current
   *  location — this is how auto-adopt-on-subscribe works: the leader's
   *  tiles live at THEIR channel sig, but the participant's adopt-gesture
   *  fires from THEIR current location. */
  subscribedTiles?: () => readonly ({
    name: string
    peerPubkey: string
  } & Record<string, unknown>)[]
}

interface LineageLike {
  explorerSegments?: () => readonly string[]
}

interface TileActionPayload {
  action: string
  label?: string
  /** When the action is fired from the selection menu (Adopt All on a
   *  multi-selected set), `labels` carries the full set and `label` is
   *  unused. Single-tile adopt continues to use `label`. */
  labels?: readonly string[]
  /** `adopt-selected` (fired by the swarm adopt panel) carries the
   *  participant-grouped picks. pubkey disambiguates overlapping names:
   *  two peers publishing the same tile name are DIFFERENT adoptable
   *  branches, and the panel says whose version the user chose. */
  selections?: readonly { label: string; pubkey?: string }[]
  q?: number
  r?: number
  index?: number
}

export class SwarmAdoptDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Hands the publisher\'s branchSig off to the canonical installer when the user clicks adopt on a peer tile. Does not commit or fetch — the installer is responsible for adoption mechanics under the sig-handoff model.'

  protected override listens: string[] = ['tile:action']
  /** adopt:started survives for diagnostic / observability hooks. The
   *  install-monitor crumb that used to consume it was retired during the
   *  full-split refactor (the portal opening IS the visible feedback).
   *  swarm:adopt-panel:open wakes the participant-grouped adoption panel
   *  (hypercomb-shared/ui/swarm-adopt-panel). */
  protected override emits: string[] = ['adopt:started', 'swarm:adopt-panel:open']

  constructor() {
    super()

    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      const action = String(payload?.action ?? '')

      // Panel-confirmed en-masse adopt. Each pick is (label, pubkey) so
      // overlapping names resolve to the participant the user chose.
      // Sequential, not parallel, so the installer iframe processes the
      // hashchanges in pick-order rather than racing.
      if (action === 'adopt-selected') {
        const selections = Array.isArray(payload?.selections)
          ? payload.selections
              .map(s => ({ label: String(s?.label ?? '').trim(), pubkey: String(s?.pubkey ?? '').trim().toLowerCase() }))
              .filter(s => s.label.length > 0)
          : []
        for (const s of selections) {
          this.#adoptPeerTile(s.label, s.pubkey || undefined)
        }
        return
      }

      if (action !== 'adopt' && action !== 'sync') return

      // Multi-tile adopt — legacy direct path (selection-menu Adopt All).
      // Each adopt dispatches its own portal:open so the installer iframe
      // re-routes on hashchange to the next sig. Sequential, not parallel,
      // so the iframe processes them in click-order rather than racing.
      const labels = Array.isArray(payload?.labels)
        ? payload.labels.map(s => String(s ?? '').trim()).filter(Boolean)
        : []
      if (labels.length > 0) {
        void (async () => {
          for (const label of labels) {
            this.#adoptPeerTile(label)
          }
        })()
        return
      }

      const label = String(payload?.label ?? '').trim()
      if (!label) return

      // Single adopt-gesture on a peer tile → open the participant-grouped
      // panel instead of adopting immediately. The user sees what every
      // present participant is publishing here (grouped, overlapping names
      // included once per publisher) and picks what to adopt en masse; the
      // panel's confirm comes back as `adopt-selected` above. `sync` keeps
      // the immediate single-tile handoff for programmatic callers.
      if (action === 'adopt') {
        if (!this.#isPeerTile(label)) return
        this.emitEffect('swarm:adopt-panel:open', { preselect: [label] })
        return
      }

      this.#adoptPeerTile(label)
    })
  }

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => { /* noop */ }

  /** Is this label currently surfaced as a peer tile (current-location
   *  cache or subscribed channel)? Gate for opening the adopt panel —
   *  other action handlers (editor for owned tiles) cover their own
   *  kinds; we no-op so they don't double-handle. */
  #isPeerTile = (label: string): boolean => {
    const ioc = (window as { ioc?: { get: (k: string) => unknown } }).ioc
    const swarm = ioc?.get?.(SWARM_DRONE_KEY) as SwarmDroneLike | undefined
    if (!swarm?.peerTilesAtCurrentSig) return false
    if (swarm.peerTilesAtCurrentSig().some(p => p.name === label)) return true
    return swarm.subscribedTiles?.().some(p => p.name === label) ?? false
  }

  #adoptPeerTile = (label: string, pubkey?: string): void => {
    // Diagnostic signal — fires immediately on click. install-monitor
    // doesn't listen anymore (the portal opening is the feedback) but
    // observability hooks / future consumers can still tap this.
    EffectBus.emit('adopt:started', { label, ...(pubkey ? { pubkey } : {}) })

    const ioc = (window as { ioc?: { get: (k: string) => unknown } }).ioc
    const swarm = ioc?.get?.(SWARM_DRONE_KEY) as SwarmDroneLike | undefined
    if (!swarm?.peerTilesAtCurrentSig) return

    // Filter — only act if this tile is currently surfaced as a peer
    // tile by the swarm. Other action handlers (editor for owned tiles)
    // cover their own kinds; we no-op so they don't double-handle.
    //
    // Look first in the current-location peer cache (the common case for
    // click-adopt of a peer tile we can see at our spot). If not found,
    // fall back to the subscribed channel — that's how auto-adopt-on-
    // subscribe gets the leader's tiles even though they live at the
    // leader's personal channel sig rather than our own current sig.
    //
    // When the caller pins a pubkey (panel pick on an overlapping name),
    // match (name, pubkey) exactly — the same name from another publisher
    // is a DIFFERENT branch. Name-only fallback covers the case where the
    // pinned publisher dropped between pick and confirm.
    const matches = (p: { name: string; peerPubkey: string }): boolean =>
      p.name === label && (!pubkey || p.peerPubkey === pubkey)
    const peerTiles = swarm.peerTilesAtCurrentSig()
    let peerEntry = peerTiles.find(matches)
    if (!peerEntry && swarm.subscribedTiles) {
      peerEntry = swarm.subscribedTiles().find(matches)
    }
    if (!peerEntry && pubkey) {
      peerEntry = peerTiles.find(p => p.name === label)
        ?? swarm.subscribedTiles?.().find(p => p.name === label)
    }
    if (!peerEntry) return

    // Extract the layer signature published by the peer. This is the
    // branchSig — the sig of the peer's layer at this position, which
    // can be anywhere in their tree (not necessarily a root). Per
    // visual-sanitizer.ts §170, mesh visuals carry layerSig as the
    // publisher's signed branch root.
    const layerSig = String((peerEntry as Record<string, unknown>)['layerSig'] ?? '')
      .trim().toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(layerSig)) return

    // Capture current lineage location — this is the placement decision
    // per the natural-placement model (Option A, confirmed in design
    // session). Adopted content lands at the participant's CURRENT path
    // in the host's hierarchy, regardless of where the publisher had it.
    // Comma-joined because URLSearchParams reserves '&' and '='.
    const lineage = ioc?.get?.(LINEAGE_KEY) as LineageLike | undefined
    const segments = lineage?.explorerSegments?.() ?? []
    const segmentsClean = (Array.isArray(segments) ? segments : [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    const atPath = segmentsClean.length > 0 ? segmentsClean.join(',') : ''

    // Capture the publisher's DOMAIN at click time (if they advertised one
    // via their mesh broadcast — operators set hc:nostrmesh:self-domain, so
    // their kind-30401 responses carry a ['domain',…] tag the adopter has
    // already accumulated into the broker's known-domains for this sig).
    // Threaded through the handoff so the installer — a fresh iframe that
    // has observed no mesh responses of its own — knows WHERE to HTTP-direct
    // fetch the adopted content's resources from (the byte path). Empty for
    // a browser-only publisher with no domain (then the installer falls back
    // to mesh/community/CDN, and durable resources require a host).
    const broker = ioc?.get?.('@diamondcoreprocessor.com/ContentBrokerDrone') as
      { getKnownDomains?: (s: string) => string[] } | undefined
    const ownerDomain = String(broker?.getKnownDomains?.(layerSig)?.[0] ?? '').trim()

    // Hand off to the embedded installer. portal-overlay listens at the
    // window level (matches the pattern used by command-line + controls-
    // bar when opening DCP from their own buttons). The installer reads
    // `branchSig`, `at`, and `domain` from the URL hash on init + on every
    // hashchange so subsequent adopts in the same session re-route the
    // iframe correctly.
    window.dispatchEvent(new CustomEvent('portal:open', {
      detail: {
        target: 'dcp',
        branchSig: layerSig,
        at: atPath,
        domain: ownerDomain,
        label,
      },
    }))
  }
}

const _swarmAdopt = new SwarmAdoptDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/SwarmAdoptDrone',
  _swarmAdopt,
)
