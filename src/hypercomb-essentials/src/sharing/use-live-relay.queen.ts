// sharing/use-live-relay.queen.ts
//
// `/use-live-relay` — THE one-command participant setup (Jaime's ruling,
// 2026-08-20): "the only requirement of joining a swarm needs to be the use
// of the mesh… if there is any setup at all outside of server and location,
// secret" — so this command takes AT MOST those three inputs and configures
// everything else a working participant needs, idempotently:
//
//   /use-live-relay                       join: keep the zone you are in, or
//                                         the commons (room+secret 'hive')
//   /use-live-relay <room>                join <room> (secret = room)
//   /use-live-relay <room> <secret>       join an explicit zone
//   /use-live-relay <room> <secret> <ws(s)://relay>   + explicit server
//   /use-live-relay off                   leave: go private, opt out of live
//   /use-live-relay clear                 clear the relay flag (origin default)
//                                         and this tab's meeting point
//
// More words than a room and a secret are REFUSED, by name: typed as
// `pluginthematrix.com downtown downtown` the third word used to vanish and
// the room became 'pluginthematrix.com' — a zone of one. The success toast
// says the room's two words, so a room can compare them out loud.
//
// What one invocation configures (each step skipped when already right):
//   1. relay reachability — clears a 'hc:nostrmesh:network' opt-out; on a
//      real host forces the live relay ('hc:nostrmesh:use-live-relay'='1')
//      and applies it NOW via mesh.configureRelays (no reload); an explicit
//      ws(s):// server becomes THIS TAB's meeting point (sessionStorage
//      `hc:mesh-zone`, membership.ts), so a reload dials it again — never the
//      origin-wide list, which every other tab (in its own meeting) would
//      dial on its next reload. A local origin keeps its loopback default
//      unless a server is given. The mesh is re-pointed ONLY when the relay
//      actually differs: re-pointing it at the relay it already holds tore
//      down a live socket mid-meeting.
//   2. the zone — RoomStore/SecretStore .set() (their change events run the
//      swarm's teardown+resync). The BARE command keeps the zone you are
//      already in (room AND secret set) — typed mid-meeting it used to drag
//      a participant out of their room into 'hive'. With no zone yet it
//      lands the shared default, so two people who each type nothing more
//      than `/use-live-relay` still MEET.
//   3. public — the same guarded mesh.togglePublic gesture the keymap uses
//      (only when THIS tab is not already joined; never toggles OFF).
//   4. no host to pick (2026-10-04; hosts by pool 2026-10-07): each page's
//      tiles go to its publish domains, else your hosts pool, else a relay
//      that hosts participants (swarm-hosts.ts). Your public tiles go out by
//      name at once and with their signatures once that host serves them.
//      This command never turns on the standing public host
//      (hc:public-host) — that stays the Hosts panel's decision.
//
// Sharing CONTENT stays a deliberate act (world mode / in-zone creates are
// auto-public) — this command makes the PARTICIPANT work, it does not
// publish their hive.
//
// The old on|off|clear ramp-control forms keep working for scripts.

import { EffectBus, secretTag, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { isJoinedHere, readTabZone, writeTabZone } from './membership.js'
import { meetingRelayOf } from './meeting-invite.js'

const FLAG_KEY = 'hc:nostrmesh:use-live-relay'
const NETWORK_KEY = 'hc:nostrmesh:network'
const DEFAULT_ZONE = 'hive'

interface ZoneStore { value: string; set: (v: string) => void }
interface MeshLike {
  configureRelays?: (urls: string[], persist?: boolean) => void
  connectAll?: () => void
  getDebug?: () => { relays?: readonly string[] } | undefined
}

const ioc = () => (window as { ioc?: { get?: <T>(k: string) => T | undefined } }).ioc

/** The catalog's words, else the English fallback (`t()` answers a missing
 *  key with the key itself on an older shell). */
const tr = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const s = ioc()?.get?.<I18nProvider>(I18N_IOC_KEY)?.t(key, params)
  return s && s !== key ? s : fallback
}

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
    'One-command swarm setup: /use-live-relay [room] [secret] [ws(s)://server] configures the relay, the zone, and goes public — nothing else to set. Bare = keep the zone you are in (or join the shared default). off = leave, clear = reset the relay flag.'
  readonly slashHidden = false
  // The room and secret are the zone's identity, capitals and all: the
  // selector and a #meet link keep them as typed, so this word must too, or
  // `Garden Rose` here and `Garden Rose` from a link meet in two rooms.
  readonly rawArgs = true

  invoke(args: string): void {
    const tokens = (args ?? '').trim().split(/\s+/).filter(Boolean)
    const first = (tokens[0] ?? '').toLowerCase()

    // ── legacy ramp controls, kept for scripts ─────────────────────────
    if (first === 'off' || first === '0' || first === 'false') {
      localStorage.setItem(FLAG_KEY, '0')
      if (isJoinedHere()) this.#togglePublic()
      this.#toast('success', `left the swarm — live relay opted out ('0')`)
      return
    }
    if (first === 'clear' || first === 'reset' || first === 'default') {
      localStorage.removeItem(FLAG_KEY)
      if (readTabZone()?.relay) writeTabZone({ relay: '', host: '', code: '' })
      this.#toast('success', 'relay flag cleared — origin default applies on reload')
      return
    }

    // ── the one-command setup ──────────────────────────────────────────
    // 'on'/'1'/'true' are the legacy bare form; anything else is the zone.
    const zoneTokens = (first === 'on' || first === '1' || first === 'true')
      ? tokens.slice(1)
      : tokens
    const servers = zoneTokens.filter(t => /^wss?:\/\//i.test(t))
    const named = zoneTokens.filter(t => !/^wss?:\/\//i.test(t))
    // A room, a secret, one server — nothing else. An extra word is not
    // silently dropped (it was the secret the participant meant).
    if (named.length > 2 || servers.length > 1) {
      const words = [...named.slice(2), ...servers.slice(1)].map(w => `'${w}'`).join(', ')
      this.#toast('error', tr('use-live-relay.too-many', `too many words: ${words} — give a room, a secret, and a ws(s):// server`, { words }))
      return
    }
    const server = servers.length ? meetingRelayOf(servers[0]) : ''
    if (servers.length && !server) {
      this.#toast('error', tr('use-live-relay.bad-server', `'${servers[0]}' is not a server this tab can dial`, { server: servers[0] }))
      return
    }
    // The bare form keeps the zone this hive is already in — see step 2.
    const roomStore = ioc()?.get?.<ZoneStore>('@hypercomb.social/RoomStore')
    const secretStore = ioc()?.get?.<ZoneStore>('@hypercomb.social/SecretStore')
    const currentRoom = String(roomStore?.value ?? '').trim()
    const currentSecret = String(secretStore?.value ?? '').trim()
    const keepZone = named.length === 0 && !!currentRoom && !!currentSecret
    const room = keepZone ? String(roomStore?.value) : (named[0] ?? DEFAULT_ZONE)
    const secret = keepZone ? String(secretStore?.value) : (named[1] ?? named[0] ?? DEFAULT_ZONE)

    // 1. Relay reachability — undo opt-outs, then point at a server.
    if (localStorage.getItem(NETWORK_KEY) === '0') localStorage.removeItem(NETWORK_KEY)
    const mesh = ioc()?.get?.<MeshLike>('@diamondcoreprocessor.com/NostrMeshDrone')
    let relayNote: string
    const tabRelay = readTabZone()?.relay ?? ''
    if (server) {
      // This tab's meeting point. A different one is a different meeting:
      // the old one's access code and host do not come along.
      if (server !== tabRelay) writeTabZone({ relay: server, host: '', code: '' })
      this.#pointAt(mesh, server)
      relayNote = server
    } else {
      // The default meeting point: a tab that held its own lets it go.
      if (tabRelay) writeTabZone({ relay: '', host: '', code: '' })
      if (isLocalOrigin()) {
        relayNote = 'local relay'
      } else {
        localStorage.setItem(FLAG_KEY, '1')
        this.#pointAt(mesh, liveRelayUrl())
        relayNote = 'live relay'
      }
    }
    if ((server || '') !== tabRelay) EffectBus.emit('mesh:zone', { relay: server })
    mesh?.connectAll?.()

    // 2. The zone. set() fires the stores' change events — the swarm tears
    // down the old zone and resyncs into this one on its own; an unchanged
    // value is never set, so a bare run in the current zone tears nothing.
    if (!roomStore?.set || !secretStore?.set) {
      this.#toast('warning', 'the shell is still booting — try again in a moment')
      return
    }
    if (roomStore.value !== room) roomStore.set(room)
    if (secretStore.value !== secret) secretStore.set(secret)

    // 3. Public — the guarded gesture, only ever toward ON, and only when
    // THIS tab is not already joined.
    if (!isJoinedHere()) this.#togglePublic()

    // 4. The WARM-UP PLACE (Jaime, 2026-08-20): joining opens the global
    // Beehaviors roster so the participant explicitly decides which
    // BEHAVIORS travel with what they share (the withheld list is the
    // 30208 broadcast) — the tile half of the ritual is world mode's
    // share toggles, named in the toast.
    EffectBus.emit('features:roster-open', {})

    // The room's two words (room + secret only — the swarm's lifecycle
    // channel), so everyone can check out loud that they typed the same.
    let words = ''
    try { words = secretTag(`lifecycle\0${room.trim()}\0${secret.trim()}`, 'en') } catch { words = '' }
    console.log(`[use-live-relay] participant setup: room='${room}' relay=${relayNote}`)
    this.#toast('success',
      `you're in "${room}"${words ? ` ◆ ${words} ◆` : ''} via ${relayNote} — the roster picks which behaviors you share; world mode picks the tiles`)
  }

  /** Point the mesh at `url` — only when it is not already the one relay
   *  the mesh dials. Re-pointing an unchanged list tore down the live
   *  socket (and, before the mesh's retire fix, orphaned it). */
  #pointAt(mesh: MeshLike | undefined, url: string): void {
    let current: readonly string[] | undefined
    try { current = mesh?.getDebug?.()?.relays } catch { current = undefined }
    if (Array.isArray(current) && current.length === 1 && current[0] === url) return
    mesh?.configureRelays?.([url], false)
  }

  /** The same guarded toggle the keymap rides — with a complete zone it
   *  flips public and resyncs. */
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
