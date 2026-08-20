// diamondcoreprocessor.com/sharing/use-live-relay.queen.ts
//
// `/use-live-relay` — THE one-command participant setup (Jaime's ruling,
// 2026-08-20): "the only requirement of joining a swarm needs to be the use
// of the mesh… if there is any setup at all outside of server and location,
// secret" — so this command takes AT MOST those three inputs and configures
// everything else a working participant needs, idempotently:
//
//   /use-live-relay                       join the commons (room+secret 'hive')
//   /use-live-relay <room>                join <room> (secret = room)
//   /use-live-relay <room> <secret>       join an explicit zone
//   /use-live-relay <room> <secret> <ws(s)://relay>   + explicit server
//   /use-live-relay off                   leave: go private, opt out of live
//   /use-live-relay clear                 clear the relay flag (origin default)
//
// What one invocation configures (each step skipped when already right):
//   1. relay reachability — clears a 'hc:nostrmesh:network' opt-out; on a
//      real host forces the live relay ('hc:nostrmesh:use-live-relay'='1')
//      and applies it NOW via mesh.configureRelays (no reload); an explicit
//      ws(s):// server persists 'hc:nostrmesh:relays' instead. A local
//      origin keeps its loopback default unless a server is given.
//   2. the zone — RoomStore/SecretStore .set() (their change events run the
//      swarm's teardown+resync). The BARE command always lands the shared
//      default zone, so two people who each type nothing more than
//      `/use-live-relay` are guaranteed to MEET — predictability beats
//      preserving a stale room here.
//   3. public — the same guarded mesh.togglePublic gesture the keymap uses
//      (only when not already public; never toggles OFF).
//   4. the availability gate — 'hc:swarm:ungated'='1' for now: Jaime's
//      "reliable and simple" ruling. The gate's share doctrine returns once
//      the host drain confirms receipts dependably; until then a silent
//      hold that offers 0 tiles is the worse failure.
//
// Sharing CONTENT stays a deliberate act (world mode / in-zone creates are
// auto-public) — this command makes the PARTICIPANT work, it does not
// publish their hive.
//
// The old on|off|clear ramp-control forms keep working for scripts.

import { EffectBus } from '@hypercomb/core'

const FLAG_KEY = 'hc:nostrmesh:use-live-relay'
const RELAYS_KEY = 'hc:nostrmesh:relays'
const NETWORK_KEY = 'hc:nostrmesh:network'
const PUBLIC_KEY = 'hc:mesh-public'
const UNGATED_KEY = 'hc:swarm:ungated'
const DEFAULT_ZONE = 'hive'

interface ZoneStore { value: string; set: (v: string) => void }
interface MeshLike {
  configureRelays?: (urls: string[], persist?: boolean) => void
  connectAll?: () => void
}

const ioc = () => (window as { ioc?: { get?: <T>(k: string) => T | undefined } }).ioc

const isLocalOrigin = (): boolean => {
  try {
    const h = (window.location.hostname ?? '').toLowerCase()
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')
  } catch { return false }
}

const liveRelayUrl = (): string => {
  const known = (globalThis as Record<string, unknown>)['__HYPERCOMB_RELAYS__'] as
    | { live?: string } | undefined
  return known?.live ?? 'wss://jwize.com'
}

export class UseLiveRelayQueenBee {
  readonly command = 'use-live-relay'
  readonly description =
    'One-command swarm setup: /use-live-relay [room] [secret] [ws(s)://server] configures the relay, the zone, and goes public — nothing else to set. Bare = join the shared default zone. off = leave, clear = reset the relay flag.'
  readonly slashHidden = false

  invoke(args: string): void {
    const tokens = (args ?? '').trim().split(/\s+/).filter(Boolean)
    const first = (tokens[0] ?? '').toLowerCase()

    // ── legacy ramp controls, kept for scripts ─────────────────────────
    if (first === 'off' || first === '0' || first === 'false') {
      localStorage.setItem(FLAG_KEY, '0')
      if (localStorage.getItem(PUBLIC_KEY) === 'true') this.#togglePublic()
      this.#toast('success', `left the swarm — live relay opted out ('0')`)
      return
    }
    if (first === 'clear' || first === 'reset' || first === 'default') {
      localStorage.removeItem(FLAG_KEY)
      this.#toast('success', 'relay flag cleared — origin default applies on reload')
      return
    }

    // ── the one-command setup ──────────────────────────────────────────
    // 'on'/'1'/'true' are the legacy bare form; anything else is the zone.
    const zoneTokens = (first === 'on' || first === '1' || first === 'true')
      ? tokens.slice(1)
      : tokens
    const server = zoneTokens.find(t => /^wss?:\/\//i.test(t))
    const named = zoneTokens.filter(t => !/^wss?:\/\//i.test(t))
    const room = named[0] ?? DEFAULT_ZONE
    const secret = named[1] ?? named[0] ?? DEFAULT_ZONE

    // 1. Relay reachability — undo opt-outs, then point at a server.
    if (localStorage.getItem(NETWORK_KEY) === '0') localStorage.removeItem(NETWORK_KEY)
    const mesh = ioc()?.get?.<MeshLike>('@diamondcoreprocessor.com/NostrMeshDrone')
    let relayNote: string
    if (server) {
      localStorage.setItem(RELAYS_KEY, JSON.stringify([server]))
      mesh?.configureRelays?.([server], false)
      relayNote = server
    } else if (isLocalOrigin()) {
      relayNote = 'local relay'
    } else {
      localStorage.setItem(FLAG_KEY, '1')
      mesh?.configureRelays?.([liveRelayUrl()], false)
      relayNote = 'live relay'
    }
    mesh?.connectAll?.()

    // 2. The zone. set() fires the stores' change events — the swarm tears
    // down the old zone and resyncs into this one on its own.
    const roomStore = ioc()?.get?.<ZoneStore>('@hypercomb.social/RoomStore')
    const secretStore = ioc()?.get?.<ZoneStore>('@hypercomb.social/SecretStore')
    if (!roomStore?.set || !secretStore?.set) {
      this.#toast('warning', 'the shell is still booting — try again in a moment')
      return
    }
    if (roomStore.value !== room) roomStore.set(room)
    if (secretStore.value !== secret) secretStore.set(secret)

    // 3. The availability gate — reliability ruling (see header).
    localStorage.setItem(UNGATED_KEY, '1')

    // 4. Public — the guarded gesture, only ever toward ON.
    if (localStorage.getItem(PUBLIC_KEY) !== 'true') this.#togglePublic()

    // 5. The WARM-UP PLACE (Jaime, 2026-08-20): joining opens the global
    // Beehaviors roster so the participant explicitly decides which
    // BEHAVIORS travel with what they share (the withheld list is the
    // 30208 broadcast) — the tile half of the ritual is world mode's
    // share toggles, named in the toast.
    EffectBus.emit('features:roster-open', {})

    console.log(`[use-live-relay] participant setup: room='${room}' relay=${relayNote}`)
    this.#toast('success',
      `you're in "${room}" via ${relayNote} — the roster picks which behaviors you share; world mode picks the tiles`)
  }

  /** The same guarded toggle the keymap rides — with a complete zone it
   *  flips public, provisions the byte target, and resyncs. */
  #togglePublic(): void {
    EffectBus.emit('keymap:invoke', { cmd: 'mesh.togglePublic', binding: null, event: null })
  }

  #toast(type: string, message: string): void {
    EffectBus.emit('toast:show', { type, title: '/use-live-relay', message, duration: 6000 })
  }
}

;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/UseLiveRelayQueenBee',
  new UseLiveRelayQueenBee(),
)
