// sharing/membership.ts
//
// IS THIS TAB IN THE SWARM — AND WHERE? Membership is per tab: the shell keeps
// it in this tab's sessionStorage under `hc:mesh-session` (hypercomb-shared/
// core/mesh-session.ts — keep the key literal in step with it), so a reload
// keeps the join and a new tab never inherits one. Essentials never reads the
// origin-wide `hc:mesh-public` flag: every tab shares that one, and a second
// tab's boot used to silence the joined tab mid-meeting (doctrine.spec.ts
// ratchets the literal out of essentials).
//
// THE ZONE IS THE TAB'S TOO: `hc:mesh-zone` = {room, secret, relay?, host?,
// code?} beside the join (the same shell module writes it at join; the
// stores read it first). Read here directly — a module never imports the
// shell. relay = the meeting point this tab dials, host = where its shared
// tiles go (swarm-hosts.ts), code = that meeting point's access code. The
// secret and the code stay on this device, in this tab: never in a pool, a
// resource, an event or a log.
//
// THE RESUME CHECK. A shell older than the per-tab zone resumes the join with
// whatever pair the origin-wide store holds — perhaps another tab's meeting.
// When the zone this tab joined is known and the stores disagree, the tab is
// NOT rejoined silently somewhere else: it is put back in its own pair, left
// unjoined, and the selector opens on it — one START and it is back.
//
// Seeded once from the session, then it follows `mesh:public-changed`, which
// every join and leave path announces.

import { EffectBus } from '@hypercomb/core'

const MESH_SESSION_KEY = 'hc:mesh-session'
/** MIRRORED: hypercomb-shared/core/mesh-session.ts MESH_ZONE_KEY. */
export const MESH_ZONE_KEY = 'hc:mesh-zone'

const ROOM_KEY = '@hypercomb.social/RoomStore'
const SECRET_KEY = '@hypercomb.social/SecretStore'

/** Where this tab meets. Every field optional (see mesh-session.ts). */
export interface TabZone {
  room?: string
  secret?: string
  relay?: string
  host?: string
  code?: string
}

const FIELDS = ['room', 'secret', 'relay', 'host', 'code'] as const

/** This tab's zone, or null. Never throws. */
export const readTabZone = (): TabZone | null => {
  let raw: string | null = null
  try { raw = sessionStorage.getItem(MESH_ZONE_KEY) } catch { return null }
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const o = parsed as Record<string, unknown>
    const zone: TabZone = {}
    for (const f of FIELDS) if (typeof o[f] === 'string') zone[f] = o[f] as string
    return zone
  } catch { return null }
}

/** Merge into this tab's zone, exactly as the shell's writeMeshZone does:
 *  undefined keeps a field, an empty relay/host/code removes it. */
export const writeTabZone = (patch: TabZone): void => {
  const next: TabZone = { ...(readTabZone() ?? {}) }
  for (const f of FIELDS) {
    const v = patch[f]
    if (v === undefined) continue
    const clean = String(v ?? '').trim()
    if (f === 'room' || f === 'secret') next[f] = clean
    else if (clean) next[f] = clean
    else delete next[f]
  }
  try { sessionStorage.setItem(MESH_ZONE_KEY, JSON.stringify(next)) } catch { /* no storage — this session only */ }
}

/** The meeting point this tab dials ('' = the default relay). */
export const tabRelay = (): string => readTabZone()?.relay ?? ''
/** The meeting host this tab's tiles go to ('' = none named). */
export const tabMeetingHost = (): string => readTabZone()?.host ?? ''

type Cred = { value?: unknown; set?: (v: string) => void; addEventListener?: (t: string, h: () => void) => void }
const ioc = (key: string): Cred | undefined => {
  try { return (globalThis as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as Cred | undefined } catch { return undefined }
}

/** Record the pair the stores hold as this tab's — at a join, and on any
 *  change while joined (a shell older than the zone does not). */
const pinFromStores = (): void => {
  const room = ioc(ROOM_KEY)?.value
  const secret = ioc(SECRET_KEY)?.value
  if (typeof room === 'string' && typeof secret === 'string') writeTabZone({ room, secret })
}

/** Joined, with a zone recorded, and the stores holding another pair. */
const resumedElsewhere = (): TabZone | null => {
  const zone = readTabZone()
  if (typeof zone?.room !== 'string' || typeof zone?.secret !== 'string') return null
  const room = ioc(ROOM_KEY)?.value
  const secret = ioc(SECRET_KEY)?.value
  if (typeof room !== 'string' || typeof secret !== 'string') return null
  return room.trim() === zone.room.trim() && secret.trim() === zone.secret.trim() ? null : zone
}

let joined = ((): boolean => {
  try { return sessionStorage.getItem(MESH_SESSION_KEY) === 'true' } catch { return false }
})()

const elsewhere = joined ? resumedElsewhere() : null
if (elsewhere) {
  joined = false
  try { sessionStorage.setItem(MESH_SESSION_KEY, 'false') } catch { /* the effect below still flips this tab */ }
  // After this module's importers have wired their listeners: put the tab
  // back in its own pair (the selector pre-fills from it), let every surface
  // see the tab is not joined, and offer the START that rejoins it.
  queueMicrotask(() => {
    ioc(ROOM_KEY)?.set?.(elsewhere.room ?? '')
    ioc(SECRET_KEY)?.set?.(elsewhere.secret ?? '')
    EffectBus.emit('mesh:public-changed', { public: false })
    EffectBus.emit('mesh:open-modal', { join: true })
  })
}

EffectBus.on<{ public?: boolean }>('mesh:public-changed', (p) => {
  joined = p?.public === true
  if (joined) pinFromStores()
})

// A room changed while joined (the selector, /use-live-relay) moves the
// tab's zone with it, so the next reload resumes where the tab went.
for (const key of [ROOM_KEY, SECRET_KEY]) {
  try { ioc(key)?.addEventListener?.('change', () => { if (joined) pinFromStores() }) } catch { /* a store without events */ }
}

/** True while THIS tab is a member of the swarm. */
export const isJoinedHere = (): boolean => joined
