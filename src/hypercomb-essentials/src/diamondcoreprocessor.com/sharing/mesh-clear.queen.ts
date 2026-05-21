// diamondcoreprocessor.com/sharing/mesh-clear.queen.ts
//
// Host-driven nuke for the dev Nostr relay's event store. Slash command
// `/clear-mesh` invokes this queen, which:
//
//   1. Calls NostrMeshDrone.sendHcClear() — broadcasts a custom
//      `["HC_CLEAR"]` WS frame to every connected relay and wipes our
//      local mesh item cache. The bundled dev relay
//      (`scripts/local-relay.ts`) understands the frame and clears its
//      stored events map; public relays will ignore it (they don't know
//      the frame).
//
//   2. Calls SwarmDrone.clearAllPeers() — drops every cached peer
//      layer/last-seen/lastPublished entry across every sig and emits
//      `swarm:peers-changed` so show-cell repaints. Without this the
//      local view would keep displaying the peer tiles whose events
//      the relay just dropped, until the 135s stale-peer sweep ran.
//
//   3. Triggers a fresh `#syncForCurrentLineage` (via clearAllPeers)
//      so we immediately re-subscribe and re-publish at the current
//      lineage. Live peers who are still heartbeating will re-appear
//      within their next heartbeat (≤30s); stale ghosts won't.
//
// The "host" framing in the slash description is aspirational: this
// command is currently invokable by any user who has IoC access to the
// drones. The dev relay accepts HC_CLEAR from any WS client because
// it's loopback-only. A future host-gated version would add a signed
// nonce + pubkey-allowlist on the relay side.

import { get } from '@hypercomb/core'

interface NostrMeshDroneLike {
  sendHcClear?: () => { sent: number; cachedBefore: number }
}

interface SwarmDroneLike {
  clearAllPeers?: () => { sigsCleared: number; peerEntriesCleared: number }
}

const NOSTR_MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'

export class MeshClearQueenBee {
  // SlashBehaviourDrone auto-wraps any registered queen exposing these
  // fields into a slash provider at command-parse time. No mirror
  // entry needed in the manual provider list.
  readonly command = 'clear-mesh'
  readonly aliases = ['clearmesh', 'clear-relay', 'wipe-mesh'] as const
  readonly description = 'Wipe the dev relay event store and drop all peer caches. Live peers will reappear on their next heartbeat (≤30s).'
  readonly descriptionKey = 'slash.clear-mesh'

  invoke(_args: string): void {
    const mesh = get<NostrMeshDroneLike>(NOSTR_MESH_KEY)
    const swarm = get<SwarmDroneLike>(SWARM_DRONE_KEY)

    let relayResult: { sent: number; cachedBefore: number } | null = null
    let swarmResult: { sigsCleared: number; peerEntriesCleared: number } | null = null

    if (mesh?.sendHcClear) {
      try { relayResult = mesh.sendHcClear() } catch (err) { console.warn('[clear-mesh] sendHcClear failed', err) }
    }
    if (swarm?.clearAllPeers) {
      try { swarmResult = swarm.clearAllPeers() } catch (err) { console.warn('[clear-mesh] clearAllPeers failed', err) }
    }

    const r = relayResult ? `relay: HC_CLEAR sent to ${relayResult.sent} socket(s), wiped ${relayResult.cachedBefore} local cache entr${relayResult.cachedBefore === 1 ? 'y' : 'ies'}` : 'relay: NostrMeshDrone unavailable'
    const s = swarmResult ? `swarm: cleared ${swarmResult.peerEntriesCleared} peer entr${swarmResult.peerEntriesCleared === 1 ? 'y' : 'ies'} across ${swarmResult.sigsCleared} sig(s)` : 'swarm: SwarmDrone unavailable'
    console.log(`[clear-mesh] ${r}; ${s}`)
  }
}

;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/MeshClearQueenBee',
  new MeshClearQueenBee(),
)
