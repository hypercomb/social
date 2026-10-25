// sharing/use-live-relay.queen.ts
//
// `/use-live-relay` — THE one-command participant setup (Jaime's ruling,
// 2026-08-20): "the only requirement of joining a swarm needs to be the use
// of the mesh… if there is any setup at all outside of server and location,
// secret" — so this command takes AT MOST those three inputs and configures
// everything else a working participant needs, idempotently:
//
//   /use-live-relay                       join: keep the zone THIS tab is in,
//                                         at its host; a tab with no zone or
//                                         no host opens the selector
//   /use-live-relay <room>                join <room> (secret = room)
//   /use-live-relay <room> <secret>       join an explicit zone
//   /use-live-relay "Garden Rose" rose    a room (or secret) with a space
//   /use-live-relay <room> <secret> <ws(s)://relay>   + explicit server
//   /use-live-relay off                   leave: go private, opt out of live
//   /use-live-relay clear                 clear the relay flag and this tab's
//                                         host (it meets at the host its own
//                                         relay list names, said by name, or
//                                         nowhere until it names one again)
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
//   1. the host — clears a 'hc:nostrmesh:network' opt-out, then meets at
//      the host it is GIVEN, never one chosen for it (jwize, 2026-10-11:
//      "Let's just make sure that there isn't a default host"): an explicit
//      ws(s):// server becomes THIS TAB's meeting point (sessionStorage
//      `hc:mesh-zone`, membership.ts), so a reload dials it again — never the
//      origin-wide list, which every other tab (in its own meeting) would dial
//      on its next reload. With no server, the host this tab already meets at
//      stays (its point and access code — whichever room the word names: the
//      host is the participant's choice, a room is not), else the relay its
//      own list names (hc:nostrmesh:relays as chosen — the host /domain or an
//      older run of this word saved), made this tab's point. With NO host at
//      all the word joins nothing: the selector opens on its host field, the
//      room and secret already in — one host typed (or hypercomb.com tapped)
//      and START. The bare form once forced the shipped live relay
//      ('hc:nostrmesh:use-live-relay'='1') and so landed every bare run in
//      the default zone at the default host; it names no host now. The local
//      dev relay is a server you name (`ws://localhost:7777`). The mesh is
//      re-pointed ONLY when the relay actually differs: re-pointing it at the
//      relay it already holds tore down a live socket mid-meeting.
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
// The success toast names the room and its two comparison words with the
// host beside them ('marble cove · hypercomb.com', jwize 2026-10-11) — the
// host this word pointed the tab at, never the page's own domain. The words
// are core's: secretTag(lifecyclePreimage(room, secret, host)), the same
// preimage the swarm addresses the room with (presence-status roomWords
// draws them the same way for the package that is loaded — this one).
//
// The old on|off|clear ramp-control forms keep working for scripts.

import { EffectBus, canonicalZoneText, I18N_IOC_KEY, lifecyclePreimage, meetingPointKey, secretTag, type I18nProvider } from '@hypercomb/core'
import { isJoinedHere, ownZone, readTabZone, writeTabZone } from './membership.js'
import { swarmRelayUrl } from './swarm-link.js'
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
  /** The relay this tab meets at: its zone's point while joined, else the
   *  first relay of its own (chosen) list; '' for none. */
  meetingRelay?: () => string
}

const ioc = () => (window as { ioc?: { get?: <T>(k: string) => T | undefined } }).ioc

/** The catalog's words, else the English fallback (`t()` answers a missing
 *  key with the key itself on an older shell). */
const tr = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const s = ioc()?.get?.<I18nProvider>(I18N_IOC_KEY)?.t(key, params)
  return s && s !== key ? s : fallback
}

export class UseLiveRelayQueenBee {
  readonly command = 'use-live-relay'
  readonly description =
    'One-command swarm setup: /use-live-relay [room] [secret] [ws(s)://server] meets at the host you give (or the one this tab already meets at), sets the zone, and goes public. With no host it opens the selector on the host field. Bare = keep the zone this tab is in. "Quote" a room with a space. off = leave, clear = forget this tab host.'
  readonly slashHidden = false
  readonly examples = [
    { input: '/use-live-relay downtown rose hypercomb.com', result: 'Meets at hypercomb.com, in the room downtown with the secret rose, and goes public if you were not already. A message names the room and its two words to compare out loud' },
    { input: '/use-live-relay downtown', result: 'Sets both the room and the secret to downtown and meets at the host this tab already meets at. With no host at all it keeps the words and opens the selector on the host field' },
    { input: '/use-live-relay off', result: 'Leaves the swarm if this tab had joined. The tab’s host and relay list are left as they are' },
  ]
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
      if (readTabZone()?.relay) {
        writeTabZone({ relay: '', host: '', code: '' })
        EffectBus.emit('mesh:zone', { relay: '' })
      }
      // There is no default to fall back to (2026-10-11): the tab meets at
      // the relay its own list names (as chosen), or nowhere until a host is
      // named. Which one is SAID — a move to the own list's host is another
      // room with other words, never a silent one. Read after the mesh has
      // taken the cleared zone (its sync runs a microtask after `mesh:zone`).
      const mesh = ioc()?.get?.<MeshLike>('@diamondcoreprocessor.com/NostrMeshDrone')
      queueMicrotask(() => {
        let left = ''
        try { left = meetingRelayOf(mesh?.meetingRelay?.() ?? '') } catch { left = '' }
        const host = left ? meetingPointKey(left) : ''
        this.#toast('success', host
          ? tr('use-live-relay.cleared-own', `this tab's host is cleared — it meets at ${host} now, the host your relay list names`, { host })
          : tr('use-live-relay.cleared', 'this tab has no host now — name a host to meet again'))
      })
      return
    }

    // ── the one-command setup ──────────────────────────────────────────
    // 'on'/'1'/'true' are the legacy bare form; anything else is the zone.
    const zoneTokens = (first === 'on' || first === '1' || first === 'true')
      ? tokens.slice(1)
      : tokens
    // A THIRD word is the host, written as a person writes it (jwize,
    // 2026-10-12: `join downtown downtown hypercomb.com`) — dialled wss://,
    // ws:// on a loopback host (swarm-link swarmRelayUrl).
    const bare = zoneTokens.filter(t => !/^wss?:\/\//i.test(t))
    // Only a word that READS as a host (a dot, a port, or localhost) — a
    // third bare word like 'downtown' is still refused below, by name: it
    // was the secret someone meant after putting the host first.
    const hostLike = (w: string): boolean => /[.:]/.test(w) || /^localhost$/i.test(w)
    const hostWord = bare.length === 3 && hostLike(bare[2]) ? swarmRelayUrl(bare[2]) : ''
    const servers = [...zoneTokens.filter(t => /^wss?:\/\//i.test(t)), ...(hostWord ? [hostWord] : [])]
    const named = hostWord ? bare.slice(0, 2) : bare
    // A room, a secret, one server — nothing else. An extra word is not
    // silently dropped (it was the secret the participant meant).
    if (named.length > 2 || servers.length > 1) {
      const words = [...named.slice(2), ...servers.slice(1)].map(w => `'${w}'`).join(', ')
      this.#toast('error', tr('use-live-relay.too-many', `too many words: ${words} — give a room, a secret, and a host`, { words }))
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

    // THE HOST — given, kept, or the tab's own list's; never a default.
    let listed = ''
    if (!server && !tabRelay) {
      try { listed = meetingRelayOf(mesh?.meetingRelay?.() ?? '') } catch { listed = '' }
    }
    const host = server || tabRelay || listed

    // The bare form keeps the zone THIS tab is in — see step 2. With none,
    // the selector opens pre-filled (the room, secret and host of the last
    // meeting on this device) and START is the join — on the host field when
    // there is no host to pre-fill it with.
    const own = ownZone()
    if (!named.length && !own) {
      EffectBus.emit('mesh:open-modal', server ? { join: true, point: server } : host ? { join: true } : { join: true, focus: 'point' })
      this.#toast('tip', tr('use-live-relay.pick-zone', 'this tab has no meeting of its own yet — check the room and secret, then start'))
      return
    }
    const room = named.length ? named[0] : own!.room
    const secret = named.length ? (named[1] ?? named[0]) : own!.secret

    // NO HOST, NO ROOM: the words a person typed are kept (the selector opens
    // on them), and the selector asks for the one thing missing — the host
    // they meet at. Nothing is joined until START.
    if (!host) {
      if (roomStore.value !== room) roomStore.set(room)
      if (secretStore.value !== secret) secretStore.set(secret)
      writeTabZone({ room: roomStore.value, secret: secretStore.value })
      EffectBus.emit('mesh:open-modal', { join: true, focus: 'point' })
      this.#toast('tip', tr('use-live-relay.pick-host', 'name the host you meet at — or tap hypercomb.com — then start'))
      return
    }

    // 1. The host: a server given, the one this tab meets at (whatever room
    // the word names — the host is the participant's, a room is not), or its
    // own list's, made this tab's point.
    if (server) {
      // This tab's meeting point. A different one is a different meeting:
      // the old one's access code and host do not come along.
      if (server !== tabRelay) writeTabZone({ relay: server, host: '', code: '' })
      this.#pointAt(mesh, server)
    } else if (listed) {
      writeTabZone({ relay: listed, host: '', code: '' })
      this.#pointAt(mesh, listed)
    }
    const meetAt = host
    if (meetAt !== tabRelay) EffectBus.emit('mesh:zone', { relay: meetAt })
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

    // 4. The roster is OFFERED, never raised: a window opens only when the
    // participant asks for it, so the joined toast carries its door (which
    // behaviors travel with what they share) instead of the join popping it.

    const relayNote = meetAt
    console.log(`[use-live-relay] participant setup: room='${room}' relay=${relayNote}`)
    // The room's words with their host beside them, as the stores now hold
    // the pair (folded) — the pair everyone at this host reads out loud.
    const hostKey = meetingPointKey(meetAt)
    const preimage = lifecyclePreimage(roomStore.value, secretStore.value, meetAt)
    const words = preimage ? secretTag(preimage, 'en') : ''
    this.#toast('success', words
      ? tr('use-live-relay.joined-at',
        `you're in "${room}" — ${words} · ${hostKey} — compare these two words out loud; the roster picks which behaviors you share, world mode picks the tiles`,
        { room, words, host: hostKey })
      : tr('use-live-relay.joined',
        `you're in "${room}" via ${relayNote} — compare the two words on the room line out loud; the roster picks which behaviors you share, world mode picks the tiles`,
        { room, relay: relayNote }), {
      actionLabel: tr('features.viewer.title', 'Beehaviors'),
      actionEffect: 'features:roster-open',
      actionPayload: {},
    })
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

  /** `door` is a toast action — the way to a window this word only offers. */
  #toast(type: string, message: string, door?: { actionLabel: string; actionEffect: string; actionPayload?: unknown }): void {
    EffectBus.emit('toast:show', { type, title: '/use-live-relay', message, duration: 6000, ...door })
  }
}

;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/UseLiveRelayQueenBee',
  new UseLiveRelayQueenBee(),
)
