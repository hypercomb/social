// diamondcoreprocessor.com/sharing/mesh-block.queen.ts
//
// Host-driven peer block. Slash command `/block-peer <pubkey>` adds a
// pubkey (full 64-hex or 8–16 hex prefix) to the dev relay's blocklist
// and locally evicts every cached peer entry for it. Pair with
// `/unblock-peer <pubkey>` to lift the block.
//
// Use case: another browser tab or profile is heartbeating tile events
// onto your local mesh and you want to silence it without hunting
// down the tab. `/block-peer <prefix>` rejects its events at the
// relay (so OTHER receivers also stop seeing it) and drops our local
// cache (so this client repaints clean).
//
// Dev-only: the local relay accepts HC_BLOCK from any WS client
// because it's loopback. A production-safe version would require a
// signed nonce verified against a configured host pubkey.

import { get } from '@hypercomb/core'

interface NostrMeshDroneLike {
  sendHcBlock?: (pubkey: string) => { sent: number; cachedWiped: number }
}

interface SwarmDroneLike {
  evictPubkey?: (pubkey: string) => { sigsAffected: number; entriesEvicted: number }
}

const NOSTR_MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'

export class MeshBlockQueenBee {
  readonly command = 'block-peer'
  readonly aliases = ['blockpeer', 'block-pubkey', 'kick-peer'] as const
  readonly description = 'Block a peer pubkey at the dev relay and drop its tiles locally. Args: full 64-hex or 8–16 hex prefix.'
  readonly descriptionKey = 'slash.block-peer'

  invoke(args: string): void {
    const pubkey = (args ?? '').trim().toLowerCase()
    if (!/^[0-9a-f]{8,64}$/.test(pubkey)) {
      console.warn(`[block-peer] invalid pubkey "${pubkey}" — expected 8–64 hex chars`)
      return
    }
    const mesh = get<NostrMeshDroneLike>(NOSTR_MESH_KEY)
    const swarm = get<SwarmDroneLike>(SWARM_DRONE_KEY)
    const relayResult = mesh?.sendHcBlock?.(pubkey) ?? null
    const swarmResult = swarm?.evictPubkey?.(pubkey) ?? null
    console.log(
      `[block-peer] ${pubkey}: relay HC_BLOCK sent to ${relayResult?.sent ?? 0} socket(s), `
      + `wiped ${relayResult?.cachedWiped ?? 0} local mesh cache entr${(relayResult?.cachedWiped ?? 0) === 1 ? 'y' : 'ies'}; `
      + `swarm evicted ${swarmResult?.entriesEvicted ?? 0} peer entr${(swarmResult?.entriesEvicted ?? 0) === 1 ? 'y' : 'ies'} `
      + `across ${swarmResult?.sigsAffected ?? 0} sig(s).`,
    )
  }
}

;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/MeshBlockQueenBee',
  new MeshBlockQueenBee(),
)
