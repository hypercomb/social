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
   *  full-split refactor (the portal opening IS the visible feedback). */
  protected override emits: string[] = ['adopt:started']

  constructor() {
    super()

    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      const action = String(payload?.action ?? '')
      if (action !== 'adopt' && action !== 'sync') return

      // Multi-tile adopt — UI fires this from the selection vertical menu
      // with the set of selected names. Each adopt dispatches its own
      // portal:open so the installer iframe re-routes on hashchange to
      // the next sig. Sequential, not parallel, so the iframe processes
      // them in click-order rather than racing.
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
      this.#adoptPeerTile(label)
    })
  }

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => { /* noop */ }

  #adoptPeerTile = (label: string): void => {
    // Diagnostic signal — fires immediately on click. install-monitor
    // doesn't listen anymore (the portal opening is the feedback) but
    // observability hooks / future consumers can still tap this.
    EffectBus.emit('adopt:started', { label })

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
    const peerTiles = swarm.peerTilesAtCurrentSig()
    let peerEntry = peerTiles.find(p => p.name === label)
    if (!peerEntry && swarm.subscribedTiles) {
      const subTiles = swarm.subscribedTiles()
      peerEntry = subTiles.find(p => p.name === label)
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

    // Hand off to the embedded installer. portal-overlay listens at the
    // window level (matches the pattern used by command-line + controls-
    // bar when opening DCP from their own buttons). The installer reads
    // both `branchSig` and `at` from the URL hash on init + on every
    // hashchange so subsequent adopts in the same session re-route the
    // iframe correctly.
    window.dispatchEvent(new CustomEvent('portal:open', {
      detail: {
        target: 'dcp',
        branchSig: layerSig,
        at: atPath,
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
