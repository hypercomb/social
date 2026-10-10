// hypercomb-shared/ui/presence-banner/presence-status.ts
//
// THE ONE STATUS LINE — what the presence banner says, as data.
//
// A meeting failed because every state where nothing reached anyone looked
// the same: a joined participant with a dead socket, one whose host refused
// the upload, one whose tiles were all private, and one who was simply alone
// all saw a quiet strip and a toast that said "the upload is running". This
// module turns the four honest signals the modules now publish into one line
// that names the real state:
//
//   - 'mesh:connection'     (NostrMeshDrone)  — is the socket actually live?
//   - 'swarm:share-status'  (SwarmDrone)      — what is offered here, what is
//                                               only a name, what is private
//   - 'sync:state'          (HostSyncService) — does the page's upload host
//                                               take the bytes, and if not why
//   - the room roster                         — who is in the room, who is
//                                               on this page, who is away
//
// Pure: no Angular, no IoC, no clock of its own — the component feeds it and
// the spec drives it, so every state's exact words are pinned in one place.
// The parts are catalog KEYS (plus the two raw words, room and pair, which
// are the participant's own); the template pipes them through `t`.

import { secretTag } from '@hypercomb/core'

/** How long without an OPEN socket before "Reconnecting…" becomes
 *  "Can't reach <host>" — and the header glyph goes from amber to off. */
export const UNREACHABLE_AFTER_MS = 30_000

/** NostrMeshDrone's `mesh:connection` payload. */
export interface MeshConnection {
  state?: string
  reopened?: boolean
  since?: number
  attempt?: number
  clockOffsetMs?: number
  /** Why the relay last refused us — a reason string, or `{ reason, at }`. */
  refused?: unknown
}

/** SwarmDrone's `swarm:share-status` payload — one per walked location.
 *  `host` is where THIS page's tiles go (its publish domains, else the hosts
 *  pool, else a relay that hosts participants — `hostSource` says which), and
 *  `hostState` what it last said; 'no-host' when nothing hosts them. An older
 *  swarm names no host: the relay was its host. */
export interface ShareStatus {
  location?: string
  offered?: number
  uploading?: number
  nameOnly?: number
  private?: number
  host?: string
  hosts?: readonly string[]
  hostSource?: string
  hostState?: string
  reason?: string
  /** Why `host` is not taking the bytes, as a person acts on it (host-sync's
   *  HostWhy: page, unresolved, refused, full, unreachable). */
  why?: string
  /** Branches a host takes none of the bytes of — named with the host and
   *  why, never counted as uploading (a publish domain that does not
   *  resolve, answers a page, refuses or is full). */
  blocked?: readonly BlockedBranch[]
}

/** One branch a host holds (SwarmDrone #blockedBranches). */
export interface BlockedBranch {
  branch?: string
  host?: string
  state?: string
  why?: string
}

/** HostSyncService's `sync:state` payload — swarm hosts' only (the component
 *  drops other targets' reports: a backup is not what the room fetches from),
 *  and the page's own host's when the share status names one. `missing`
 *  counts closure refs no store here holds. */
export interface SyncState {
  state?: string
  status?: string
  reason?: string
  host?: string
  swarm?: boolean
  source?: string
  missing?: number
  /** Why it is not taking the bytes (host-sync's HostWhy). */
  why?: string
}

export type LinkPhase = 'connecting' | 'open' | 'reconnecting' | 'down'

/** The socket as a person reads it. `downSince` is when the tab last stopped
 *  having an OPEN socket (the component keeps it — the mesh's own `since`
 *  restarts on every state change); `wasOpen` tells a first connect from a
 *  reconnect. Every non-open state — connecting, stalled, retrying, and the
 *  mesh's 'offline' (which it also reports for the instant between a join
 *  and its first dial) — reads as coming back until 30 s have passed with no
 *  live socket, then as "can't reach". Null when no `mesh:connection` was
 *  ever heard: an older essentials package, and the banner keeps its old
 *  rendering. */
export function linkPhase(
  conn: MeshConnection | null,
  downSince: number | null,
  now: number,
  wasOpen: boolean,
): LinkPhase | null {
  if (!conn) return null
  if (conn.state === 'open') return 'open'
  if (downSince !== null && now - downSince >= UNREACHABLE_AFTER_MS) return 'down'
  return wasOpen || conn.reopened ? 'reconnecting' : 'connecting'
}

/** The relay refused our events because this device's clock is far off. */
export function clockRefused(conn: MeshConnection | null): boolean {
  const r = conn?.refused
  const reason = typeof r === 'string' ? r : (r as { reason?: unknown } | null | undefined)?.reason
  return typeof reason === 'string' && /clock/i.test(reason)
}

/** THE ROOM'S TWO WORDS — from the room and secret only, never the page, so
 *  everyone in one room reads the same pair wherever they stand and can
 *  check it out loud. The preimage is the swarm's own lifecycle channel
 *  (`lifecycle \0 room \0 secret`), the one roster every member of the room
 *  beacons on: same pair, same room. Empty when there is no room at all. */
export function roomWords(room: string, secret: string, locale = 'en'): string {
  const r = String(room ?? '').trim()
  const s = String(secret ?? '').trim()
  if (!r && !s) return ''
  return secretTag(`lifecycle\0${r}\0${s}`, locale)
}

/** One piece of the line: a catalog key (with params), or the
 *  participant's own text (room, word pair). `action` makes it a button. */
export interface StatusPart {
  key?: string
  params?: Record<string, string | number>
  text?: string
  action?: 'invite' | 'share'
}

export interface StatusLine {
  /** live = all is well; warn = something is held or coming back; down =
   *  the meeting point cannot be reached. */
  tone: 'live' | 'warn' | 'down'
  parts: StatusPart[]
  /** The phone's collapsed form — the counts beside the dot. */
  compact: string
  /** True when nothing on the line asks for attention, so a phone may fold
   *  it to the dot and the counts. */
  quiet: boolean
}

export interface StatusInput {
  phase: LinkPhase
  /** The relay this tab meets at as a person reads it (`jwize.com`),
   *  already resolved to a readable stand-in by the caller when there is
   *  none — what the connection lines name. */
  host: string
  /** The host THIS page's tiles go to (the share status's `host`) — what the
   *  upload lines name. Empty: the relay, as an older swarm had it. */
  uploadHost?: string
  room: string
  words: string
  /** Everyone live in the room, you included. */
  roomCount: number
  /** Everyone live on this page, you included. */
  hereCount: number
  /** This page's share status, when the swarm has walked it. */
  share: ShareStatus | null
  sync: SyncState | null
  /** Peers whose essentials cannot share with this one until they update. */
  older: number
  clockOff: boolean
  /** The last refusal the relay gave an event (other than rate limits,
   *  which the mesh retries itself); '' when none is current. */
  rejected: string
}

/** Host answers that keep a participant's tiles name-only, by catalog key. */
const HOST_HELD: Readonly<Record<string, string>> = {
  'no-host': 'swarm.share.no-host',
  'refused': 'swarm.share.refused',
  'full': 'swarm.share.full',
  'too-large': 'swarm.share.too-large',
  'unreachable': 'swarm.share.unreachable',
  'not-live': 'swarm.share.not-live',
}

/** A branch a host holds, by why, by catalog key: "<branch>: <host> …". */
const BRANCH_HELD: Readonly<Record<string, string>> = {
  'unresolved': 'swarm.share.branch.unresolved',
  'page': 'swarm.share.branch.page',
  'refused': 'swarm.share.branch.refused',
  'full': 'swarm.share.branch.full',
  'unreachable': 'swarm.share.branch.unreachable',
}

const branchPart = (b: BlockedBranch): StatusPart => ({
  key: BRANCH_HELD[String(b.why ?? '')] ?? BRANCH_HELD[String(b.state ?? '')] ?? BRANCH_HELD['unreachable'],
  params: { branch: String(b.branch ?? ''), host: String(b.host ?? '') },
})

const count = (n: unknown): number => {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

export function statusLine(i: StatusInput): StatusLine {
  const host = i.host
  // The upload lines name where the bytes go, never the meeting point.
  const upload = i.uploadHost || host
  const parts: StatusPart[] = []
  let tone: StatusLine['tone'] = 'live'

  if (i.phase === 'connecting') {
    parts.push({ key: 'mesh.state.connecting', params: { host } })
    tone = 'warn'
  } else if (i.phase === 'reconnecting') {
    parts.push({ key: 'mesh.state.reconnecting' })
    tone = 'warn'
  } else if (i.phase === 'down') {
    parts.push({ key: 'mesh.state.unreachable', params: { host } })
    tone = 'down'
  } else {
    parts.push({ key: 'mesh.state.live' })
    if (i.room) parts.push({ text: i.room })
    if (i.words) parts.push({ text: i.words })
    if (i.roomCount <= 1) {
      parts.push({ key: 'presence.room-alone' }, { key: 'presence.room-invite', action: 'invite' })
    } else {
      parts.push({ key: 'presence.room-count', params: { count: i.roomCount, here: Math.max(1, i.hereCount) } })
    }

    // What THIS participant is offering here — only meaningful while the
    // socket is live; a dead socket offers nothing, and says so above.
    // The host's LIVE word wins over the walk's snapshot of it: the snapshot
    // is as old as the last walk, and a recovered host must clear the line
    // at once. A picture too large for the host is one file's fate, never
    // the page's: it is said beside the counts, not instead of them.
    const share = i.share
    const hostWord = i.sync ? (i.sync.state ?? i.sync.status ?? '') : (share?.hostState ?? '')
    const tooLarge = hostWord === 'too-large'
    const held = tooLarge ? undefined : HOST_HELD[hostWord]
    // A BRANCH A HOST HOLDS is named — the branch, the host, and why (a name
    // that does not resolve, a page where a heap belongs, a refusal) —
    // instead of reading as "uploading" for ever. This page's own host is
    // named so only while its live word still holds it.
    const blocked = (share?.blocked ?? []).filter(b => !!b?.branch && !!b.host && (b.host !== upload || !!held))
    const own = held ? blocked.find(b => b.host === upload) : undefined
    if (held) {
      // Names only — the count would promise more than the room receives.
      // The host's live why beats the walk's snapshot of it.
      parts.push(own ? branchPart({ ...own, why: i.sync?.why || own.why }) : { key: held, params: { host: upload } })
      tone = 'warn'
    } else {
      if (share && count(share.offered) > 0) {
        parts.push(count(share.uploading) > 0
          ? { key: 'swarm.share.uploading', params: { count: count(share.offered), uploading: count(share.uploading) } }
          : { key: 'swarm.share.sharing', params: { count: count(share.offered) } })
      }
      // Name-only tiles whose closure reaches content no store here holds
      // and no host serves: they stay names until someone who holds it shares.
      const notHeld = /missing|not-held/.test(share?.reason ?? '') || count(i.sync?.missing) > 0
      if (share && notHeld && count(share.nameOnly) > 0) {
        parts.push({ key: 'swarm.share.not-held', params: { count: count(share.nameOnly) } })
        tone = 'warn'
      }
      if (tooLarge) {
        parts.push({ key: HOST_HELD['too-large'], params: { host: upload } })
        tone = 'warn'
      }
    }
    for (const b of blocked) {
      if (b === own) continue
      parts.push(branchPart(b))
      tone = 'warn'
    }
    if (share && count(share.private) > 0) {
      parts.push(
        { key: 'swarm.share.private', params: { count: count(share.private) } },
        { key: 'swarm.share.offer', action: 'share' },
      )
    }
    if (i.older > 0) {
      parts.push({ key: 'presence.room-older', params: { count: i.older } })
      tone = 'warn'
    }
    if (i.rejected) {
      parts.push({ key: 'mesh.state.rejected', params: { host, reason: i.rejected } })
      tone = 'warn'
    }
  }

  // A far-off clock is the cause of everything else on the line — always say it.
  if (i.clockOff) {
    parts.push({ key: 'mesh.state.clock' })
    if (tone === 'live') tone = 'warn'
  }

  const compact = i.phase === 'open' ? `${i.roomCount} (${Math.max(1, i.hereCount)})` : ''
  const quiet = tone === 'live' && !parts.some(p => p.action)
  return { tone, parts, compact, quiet }
}
