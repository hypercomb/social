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
// unjoined, and told so — a toast whose Start opens the selector on it. A
// reload is not a request for a window, so the selector waits for the tap.
//
// ONE TEXT, ONE ZONE: a room or secret written here that is not what its
// store already holds is entered text (a link's, a typed word's) and is
// folded by core's canonicalZoneText exactly as the stores fold it, so the
// record and the store never disagree; what the store holds is recorded
// verbatim, so a tab that joined before the fold keeps its pair.
//
// A SELECTOR WITH NO POINT FIELD (VO-5). Under a shell older than the
// meeting point, the selector cannot show or clear the point an earlier link
// left in this tab — a START there used to dial that old point with its old
// code. A shell whose selector carries the point says so
// (`__hcShellZoneUi`, mesh-session.ts); without it, a selector START
// (`mesh:join`) lets the tab's point, host and code go and meets at the
// default, as that selector shows.
//
// Seeded once from the session, then it follows `mesh:public-changed`, which
// every join and leave path announces.

import { EffectBus, I18N_IOC_KEY, canonicalZoneText } from '@hypercomb/core'

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

type Cred = { value?: unknown; set?: (v: string) => void; addEventListener?: (t: string, h: () => void) => void }
const ioc = (key: string): Cred | undefined => {
  try { return (globalThis as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as Cred | undefined } catch { return undefined }
}

/** A room or secret on its way into the zone: what its store holds is kept
 *  verbatim, anything else is entered text and folds. */
const zoneText = (f: 'room' | 'secret', text: string): string => {
  const held = ioc(f === 'room' ? ROOM_KEY : SECRET_KEY)?.value
  return typeof held === 'string' && text === held.trim() ? text : canonicalZoneText(text)
}

/** Merge into this tab's zone, exactly as the shell's writeMeshZone does:
 *  undefined keeps a field, an empty relay/host/code removes it, and a room
 *  or secret that is not the store's folds as entered text. */
export const writeTabZone = (patch: TabZone): void => {
  const next: TabZone = { ...(readTabZone() ?? {}) }
  for (const f of FIELDS) {
    const v = patch[f]
    if (v === undefined) continue
    const clean = String(v ?? '').trim()
    if (f === 'room' || f === 'secret') next[f] = zoneText(f, clean)
    else if (clean) next[f] = clean
    else delete next[f]
  }
  try { sessionStorage.setItem(MESH_ZONE_KEY, JSON.stringify(next)) } catch { /* no storage — this session only */ }
}

/** The zone THIS tab joined or chose — room and secret both recorded here,
 *  never the origin-wide pre-fill another tab (or last week's meeting) left
 *  behind — else null. A bare `join` / `use-live-relay` keeps only this. */
export const ownZone = (): { room: string; secret: string } | null => {
  const zone = readTabZone()
  const room = zone?.room?.trim() ?? ''
  const secret = zone?.secret?.trim() ?? ''
  return room && secret ? { room, secret } : null
}

/** The meeting point this tab dials ('' = none of its own: the page's own
 *  chosen relay list, or nowhere — there is no default). */
export const tabRelay = (): string => readTabZone()?.relay ?? ''
/** The meeting host this tab's tiles go to ('' = none named). */
export const tabMeetingHost = (): string => readTabZone()?.host ?? ''

/** Record the pair the stores hold as this tab's — at a join, and on any
 *  change while joined (a shell older than the zone does not). */
const pinFromStores = (): void => {
  const room = ioc(ROOM_KEY)?.value
  const secret = ioc(SECRET_KEY)?.value
  if (typeof room === 'string' && typeof secret === 'string') writeTabZone({ room, secret })
}

/** The catalog's words, else English — `t()` answers a missing key with the
 *  key itself. */
const tr = (key: string, fallback: string): string => {
  let s: unknown
  try { s = ((globalThis as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(I18N_IOC_KEY) as { t?: (k: string) => string } | undefined)?.t?.(key) } catch { s = undefined }
  return typeof s === 'string' && s && s !== key ? s : fallback
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
  // see the tab is not joined, and offer the START that rejoins it — on a
  // toast, never by opening the selector unasked (a reload is not a tap).
  queueMicrotask(() => {
    ioc(ROOM_KEY)?.set?.(elsewhere.room ?? '')
    ioc(SECRET_KEY)?.set?.(elsewhere.secret ?? '')
    EffectBus.emit('mesh:public-changed', { public: false })
    EffectBus.emit('toast:show', {
      type: 'info',
      // Sticky: emitted at boot, maybe before the toast host has mounted, and
      // the only word that the tab was unjoined — a timer must not eat it.
      duration: 0,
      title: tr('swarm.title', 'swarm'),
      message: tr('swarm.resume-elsewhere', 'Not rejoined — this tab was in another meeting. Start to rejoin it.'),
      actionLabel: tr('swarm.resume-start', 'Start'),
      actionEffect: 'mesh:open-modal',
      actionPayload: { join: true },
    })
  })
}

EffectBus.on<{ public?: boolean }>('mesh:public-changed', (p) => {
  joined = p?.public === true
  if (joined) pinFromStores()
})

// VO-5: a selector START under a shell whose selector has no point field.
// Armed after subscribing, so an earlier START replayed by the bus is not
// taken for this one.
let selectorArmed = false
EffectBus.on('mesh:join', () => {
  if (!selectorArmed) return
  if ((globalThis as { __hcShellZoneUi?: boolean }).__hcShellZoneUi === true) return
  const zone = readTabZone()
  if (!zone?.relay && !zone?.host && !zone?.code) return
  writeTabZone({ relay: '', host: '', code: '' })
  EffectBus.emit('mesh:zone', { relay: '' })
})
selectorArmed = true

// A room changed while joined (the selector, /use-live-relay) moves the
// tab's zone with it, so the next reload resumes where the tab went.
for (const key of [ROOM_KEY, SECRET_KEY]) {
  try { ioc(key)?.addEventListener?.('change', () => { if (joined) pinFromStores() }) } catch { /* a store without events */ }
}

/** True while THIS tab is a member of the swarm. */
export const isJoinedHere = (): boolean => joined
