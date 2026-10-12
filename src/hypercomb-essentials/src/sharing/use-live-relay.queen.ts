// sharing/use-live-relay.queen.ts
//
// `/use-live-relay` — THE one-command participant setup (Jaime's ruling,
// 2026-08-20): "the only requirement of joining a swarm needs to be the use
// of the mesh… if there is any setup at all outside of server and location,
// secret" — so this command takes AT MOST those three inputs and configures
// everything else a working participant needs, idempotently:
//
//   /use-live-relay                       join: keep the zone THIS tab is in;
//                                         a tab with none opens the selector
//   /use-live-relay <room>                join <room> (secret = room)
//   /use-live-relay <room> <secret>       join an explicit zone
//   /use-live-relay "Garden Rose" rose    a room (or secret) with a space
//   /use-live-relay <room> <secret> <ws(s)://relay>   + explicit server
//   /use-live-relay off                   leave: go private, opt out of live
//   /use-live-relay clear                 clear the relay flag (origin default)
//                                         and this tab's meeting point
//
// More words than a room and a secret are REFUSED, by name: typed as
// `pluginthematrix.com downtown downtown` the third word used to vanish and
// the room became 'pluginthematrix.com' — a zone of one. Double quotes (or
// the curly ones a phone's smart punctuation makes of them) keep a room with
// a space whole: `Garden Rose` unquoted is room 'Garden', secret 'Rose'.
// Every word is folded by core's canonicalZoneText, as the selector folds
// it, so the same text typed anywhere is the same zone.
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
//      down a live socket mid-meeting. THE TAB'S OWN MEETING POINT IS KEPT
//      (ZI-1): with no server given and the room and secret this tab is
//      already in, its point and access code stay — retyping the words to
//      'fix' something used to drop the tab onto the default relay, a second
//      meeting under the same two words. Only `clear` or an explicit server
//      moves it; another room is another meeting, at the default.
//   2. the zone — RoomStore/SecretStore .set() (their change events run the
//      swarm's teardown+resync), and the pair is recorded as THIS tab's
//      zone. The BARE command keeps the zone this TAB joined or chose
//      (`ownZone`, membership.ts) — typed mid-meeting it used to drag a
//      participant out of their room into 'hive'. A tab with no zone of its
//      own (D5, 2026-10-10) opens the selector pre-filled instead of
//      joining: the origin-wide pair is LAST WEEK'S meeting on a returning
//      device, and the old fallback put every fresh device in the world in
//      one public zone (hive/hive). One tap to START; no round trip.
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
// The success toast names the room and points at the room line for the two
// comparison words: the words are drawn in one place (presence-status
// roomWords, which folds in the meeting point), never a second formula here.
//
// The old on|off|clear ramp-control forms keep working for scripts.

import { EffectBus, canonicalZoneText, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { isJoinedHere, ownZone, readTabZone, writeTabZone } from './membership.js'
import { meetingRelayOf } from './meeting-invite.js'

const FLAG_KEY = 'hc:nostrmesh:use-live-relay'
const NETWORK_KEY = 'hc:nostrmesh:network'

/** The command's words: whitespace-separated, a double-quoted run (straight
 *  or curly — folded first) is one word, and an unclosed quote runs to the
 *  end. Every word is canonical zone text. */
export const zoneWords = (args: string): string[] => {
  const words: string[] = []
  for (const m of canonicalZoneText(args).matchAll(/"([^"]*)(?:"|$)|(\S+)/g)) {
    const word = (m[1] ?? m[2] ?? '').trim()
    if (word) words.push(word)
  }
  return words
}

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

/** The shipped default meeting point — nostr-mesh's LIVE_RELAY, read from the
 *  anchor it publishes; the literal is only for a mesh not loaded yet. Open,
 *  always online, and the only host a public install names (2026-10-11). */
const liveRelayUrl = (): string => {
  const known = (globalThis as Record<string, unknown>)['__HYPERCOMB_RELAYS__'] as
    | { live?: string } | undefined
  return known?.live ?? 'wss://hypercomb.com'
}

export class UseLiveRelayQueenBee {
  readonly command = 'use-live-relay'
  readonly description =
    'One-command swarm setup: /use-live-relay [room] [secret] [ws(s)://server] configures the relay, the zone, and goes public — nothing else to set. Bare = keep the zone this tab is in (a tab with none opens the selector). "Quote" a room with a space. off = leave, clear = reset the relay flag.'
  readonly slashHidden = false
  // The room and secret are the zone's identity, capitals and all: the
  // selector and a #meet link keep them as typed, so this word must too, or
  // `Garden Rose` here and `Garden Rose` from a link meet in two rooms.
  readonly rawArgs = true

  invoke(args: string): void {
    const tokens = zoneWords(args ?? '')
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
    const roomStore = ioc()?.get?.<ZoneStore>('@hypercomb.social/RoomStore')
    const secretStore = ioc()?.get?.<ZoneStore>('@hypercomb.social/SecretStore')
    if (!roomStore?.set || !secretStore?.set) {
      this.#toast('warning', 'the shell is still booting — try again in a moment')
      return
    }
    const mesh = ioc()?.get?.<MeshLike>('@diamondcoreprocessor.com/NostrMeshDrone')
    const tabRelay = readTabZone()?.relay ?? ''
    // Reachability first, whichever way the join goes: an earlier opt-out
    // would leave even the selector's START with nothing to dial.
    if (localStorage.getItem(NETWORK_KEY) === '0') localStorage.removeItem(NETWORK_KEY)

    // The bare form keeps the zone THIS tab is in — see step 2. With none,
    // the selector opens pre-filled (the room, secret and meeting point of
    // the last meeting on this device) and START is the join.
    const own = ownZone()
    if (!named.length && !own) {
      if (!server && !tabRelay) this.#defaultRelay(mesh)
      EffectBus.emit('mesh:open-modal', server ? { join: true, point: server } : { join: true })
      this.#toast('tip', tr('use-live-relay.pick-zone', 'this tab has no meeting of its own yet — check the room and secret, then start'))
      return
    }
    const room = named.length ? named[0] : own!.room
    const secret = named.length ? (named[1] ?? named[0]) : own!.secret
    const sameZone = !!own && own.room === room && own.secret === secret

    // 1. Relay reachability — point at a server, keep the tab's own, or the
    // default.
    let relayNote: string
    let nextRelay = ''
    if (server) {
      // This tab's meeting point. A different one is a different meeting:
      // the old one's access code and host do not come along.
      if (server !== tabRelay) writeTabZone({ relay: server, host: '', code: '' })
      this.#pointAt(mesh, server)
      relayNote = nextRelay = server
    } else if (tabRelay && sameZone) {
      // The meeting this tab is in, typed again: its point and code stay.
      relayNote = nextRelay = tabRelay
    } else {
      // Another room (or none held): the default meeting point. A tab that
      // held its own lets it go.
      if (tabRelay) writeTabZone({ relay: '', host: '', code: '' })
      relayNote = this.#defaultRelay(mesh)
    }
    if (nextRelay !== tabRelay) EffectBus.emit('mesh:zone', { relay: nextRelay })
    mesh?.connectAll?.()

    // 2. The zone. set() fires the stores' change events — the swarm tears
    // down the old zone and resyncs into this one on its own; an unchanged
    // value is never set, so a bare run in the current zone tears nothing.
    // The pair is then THIS tab's own (the guarded join below asks for one).
    if (roomStore.value !== room) roomStore.set(room)
    if (secretStore.value !== secret) secretStore.set(secret)
    writeTabZone({ room: roomStore.value, secret: secretStore.value })

    // 3. Public — the guarded gesture, only ever toward ON, and only when
    // THIS tab is not already joined.
    if (!isJoinedHere()) this.#togglePublic()

    // 4. The WARM-UP PLACE (Jaime, 2026-08-20): joining opens the global
    // Beehaviors roster so the participant explicitly decides which
    // BEHAVIORS travel with what they share (the withheld list is the
    // 30208 broadcast) — the tile half of the ritual is world mode's
    // share toggles, named in the toast.
    EffectBus.emit('features:roster-open', {})

    console.log(`[use-live-relay] participant setup: room='${room}' relay=${relayNote}`)
    this.#toast('success', tr('use-live-relay.joined',
      `you're in "${room}" via ${relayNote} — compare the two words on the room line out loud; the roster picks which behaviors you share, world mode picks the tiles`,
      { room, relay: relayNote }))
  }

  /** The default meeting point: a local origin keeps its loopback relay; a
   *  real host forces the live relay and applies it now. */
  #defaultRelay(mesh: MeshLike | undefined): string {
    if (isLocalOrigin()) return 'local relay'
    localStorage.setItem(FLAG_KEY, '1')
    this.#pointAt(mesh, liveRelayUrl())
    return 'live relay'
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
