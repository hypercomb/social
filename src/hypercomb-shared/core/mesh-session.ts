// hypercomb-shared/core/mesh-session.ts
//
// REFRESH KEEPS THE SWARM; CLOSING THE TAB LEAVES IT.
//
// Swarm membership is a per-tab gesture, never a persisted posture. The flag
// every drone samples (`hc:mesh-public`) lives in localStorage, which outlives
// the tab and is shared by every tab on the origin — so it is rewritten here,
// from THIS tab's sessionStorage, before any drone can read it. A reload (or a
// crash-reload mid-meeting) rejoins; a new tab or a reopened browser boots
// solo/private. Joining is always an explicit act (mesh-header cycle →
// selector → START, the keymap toggle, the `join` word); leaving is the leave
// gesture or closing the tab.
//
// THE ZONE IS THE TAB'S TOO. The room and secret used to live only in
// origin-wide localStorage while the join lived in the tab, so a reload
// rejoined — at once and without asking — whatever pair ANY other tab last
// wrote (another meeting's link, a stale selector's START). Now the pair this
// tab stands in rides beside its membership, in sessionStorage `hc:mesh-zone`
// = {room, secret, relay?, host?, code?}: the meeting point it dials (relay),
// the host its tiles go to (host) and that meeting point's access code (code)
// travel with it. The stores read it first, so a resumed tab is back in the
// zone it joined by construction; the origin-wide pair only pre-fills a NEW
// tab. Secret and code never leave the device: sessionStorage, this tab only.
//
// Both shells import this FIRST in main.ts, after quiet-console: the dev shell
// imports its drones at module load, so a write any later than this would let
// them sample a joined flag a closed tab left behind. The stores import it as
// well, so it has always run before either store reads.
//
// ONE TEXT, ONE ZONE (ZI-5). A room or secret ENTERED into the zone is folded
// by core's canonicalZoneText (NFKC, invisible characters dropped, smart
// punctuation straightened, spaces collapsed), so text that looks the same is
// the same zone. The zone MIRRORS the stores: a value equal to what the store
// already holds is recorded verbatim, so a tab resuming a pair it joined
// before the fold keeps that pair, and the record never disagrees with the
// store a reload reads it back into.
//
// THE MEETING POINT IS PRE-FILLED TOO (ZI-1). The origin-wide pair pre-fills a
// new tab's selector; the meeting point it was met at lived only in the tab,
// so a rejoin from a new tab met on the default relay under the same words.
// The point (never its code) is now kept for the next tab as a participant
// DOCUMENT (pool `mesh:meet-point`, participant-document.ts — durable state
// goes through the store, never a new localStorage key): written when the
// selector sets a point here and at every join (never at a reload's
// re-announcement of one, never by a link's zone write before the guest has
// said yes) — readMeetPointPrefill() is what the selector pre-fills from.

import { canonicalZoneText } from '@hypercomb/core'
import { ParticipantDocument } from './participant-document'

const MESH_PUBLIC_KEY = 'hc:mesh-public'
// MIRRORED: hypercomb-essentials/src/sharing/membership.ts reads this same key
// (a module never imports the shell) — essentials' isJoinedHere() is seeded
// from it. Rename it in both places or per-tab membership silently breaks
// after a reload. hypercomb-runtime's keymap toggle writes it too.
const MESH_SESSION_KEY = 'hc:mesh-session'
/** THIS tab's zone and meeting point. MIRRORED in essentials membership.ts
 *  (MESH_ZONE_KEY) — readers there read it directly. */
export const MESH_ZONE_KEY = 'hc:mesh-zone'
/** The origin-wide pair — mirrors of room-store.ts / secret-store.ts. */
const ROOM_KEY = 'hc:room'
const SECRET_KEY = 'hc:secret'
/** The meeting point a new tab is pre-filled with: its document pool. */
const MEET_POINT_MEANING = 'mesh:meet-point'
const ROOM_STORE = '@hypercomb.social/RoomStore'
const SECRET_STORE = '@hypercomb.social/SecretStore'

/** What a tab remembers about where it meets. Every field optional: a
 *  record may hold only what this tab has set so far. */
export interface MeshZone {
  room?: string
  secret?: string
  /** The meeting point this tab dials, `ws(s)://…` — absent: the default. */
  relay?: string
  /** The meeting host: where this tab's shared tiles go (after a page's own
   *  publish domains, before the hosts pool). */
  host?: string
  /** The meeting point's access code. Never shown, never logged. */
  code?: string
}

const ZONE_FIELDS = ['room', 'secret', 'relay', 'host', 'code'] as const

/** This tab's zone, or null when it has none (a tab that never set a room,
 *  a secret or a meeting point). Never throws. */
export const readMeshZone = (): MeshZone | null => {
  let raw: string | null = null
  try { raw = sessionStorage.getItem(MESH_ZONE_KEY) } catch { return null }
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const o = parsed as Record<string, unknown>
    const zone: MeshZone = {}
    for (const field of ZONE_FIELDS) {
      const v = o[field]
      if (typeof v === 'string') zone[field] = v
    }
    return zone
  } catch { return null }
}

type CredentialLike = { value?: unknown }
const credential = (key: string): string | undefined => {
  try {
    const v = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as CredentialLike | undefined
    return typeof v?.value === 'string' ? v.value : undefined
  } catch { return undefined }
}

/** A room or secret on its way into the zone: what its store already holds
 *  is recorded verbatim (the zone mirrors the store); anything else is
 *  entered text, and folds. */
const zoneText = (field: 'room' | 'secret', text: string): string => {
  const held = credential(field === 'room' ? ROOM_STORE : SECRET_STORE)
  return held !== undefined && text === held.trim() ? text : canonicalZoneText(text)
}

const mergeZone = (patch: MeshZone, fold: (field: 'room' | 'secret', text: string) => string, prefill = true): void => {
  const next: MeshZone = { ...(readMeshZone() ?? {}) }
  for (const field of ZONE_FIELDS) {
    const v = patch[field]
    if (v === undefined) continue
    const clean = String(v ?? '').trim()
    if (field === 'room' || field === 'secret') next[field] = fold(field, clean)
    else if (clean) next[field] = clean
    else delete next[field]
  }
  try { sessionStorage.setItem(MESH_ZONE_KEY, JSON.stringify(next)) } catch { /* no storage — the tab still holds it in memory */ }
  if (patch.relay !== undefined && prefill) recordMeetPoint(next.relay ?? '')
}

/** Merge `patch` into this tab's zone. Undefined fields are kept; room and
 *  secret are trimmed and folded as entered text unless they are what the
 *  store holds (an empty one is recorded — it is this tab's answer); an
 *  empty relay, host or code removes it. A relay written here is also the
 *  next tab's meeting-point pre-fill — unless `prefill: false`: a link's
 *  point put in the zone before the guest said yes is the link's, not a
 *  meeting this device chose (the join records it, if there is one). */
export const writeMeshZone = (patch: MeshZone, options: { prefill?: boolean } = {}): void =>
  mergeZone(patch, zoneText, options.prefill !== false)

/** One credential as THIS tab knows it: its own zone first, else a FRESH
 *  read of the origin-wide pair (what a new tab is pre-filled from) — never
 *  a copy held in memory since boot, which another tab may have moved. */
export const tabCredential = (field: 'room' | 'secret'): string => {
  const own = readMeshZone()?.[field]
  if (typeof own === 'string') return own.trim()
  try { return (localStorage.getItem(field === 'room' ? ROOM_KEY : SECRET_KEY) ?? '').trim() } catch { return '' }
}

export const meshResumed: boolean = (() => {
  try { return sessionStorage.getItem(MESH_SESSION_KEY) === 'true' } catch { return false }
})()

try { localStorage.setItem(MESH_PUBLIC_KEY, String(meshResumed)) } catch { /* no storage — default is off anyway */ }

// THIS SHELL'S SELECTOR CARRIES THE MEETING POINT (VO-5). A package can run
// under an older shell whose selector has no point field; there a selector
// join cannot mean the point an earlier link left in the tab, and essentials
// membership.ts lets it go. The flag says this shell is not that one.
;(globalThis as { __hcShellZoneUi?: boolean }).__hcShellZoneUi = true

// A tab joined under an older shell has its join but no zone. Pin the pair
// it resumes with NOW, before any store reads or any other tab can move the
// origin-wide one again — from here on it is this tab's, like every other
// join. (Which pair that older join was in, nothing recorded; this is the
// one-time crossing, and it keeps today's resume — verbatim, never folded.)
if (meshResumed) {
  const zone = readMeshZone()
  if (typeof zone?.room !== 'string' || typeof zone?.secret !== 'string') {
    mergeZone({ room: tabCredential('room'), secret: tabCredential('secret') }, (_field, text) => text)
  }
}

// ── the meeting point, as the selector writes it ─────────────────────────
// MIRRORS of essentials sharing/meeting-invite.ts (isAccessCode,
// meetingRelayOf, relayDomainOf) — the shell never imports a module.
// mesh-session.spec.ts holds the two to the same answers.

const ACCESS_CODE_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/
const LOOPBACK_NAME_RE = /^(?:(?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3}|\[::1\])$/
const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

/** An access code a dial can carry as `hc-access.<code>` (an HTTP token). */
export const isAccessCode = (code: unknown): code is string =>
  typeof code === 'string' && code.length > 0 && code.length <= 128 && ACCESS_CODE_RE.test(code)

/** A meeting point as the canonical `ws(s)://host[:port][/path]` (a bare
 *  domain is wss://), or '' when it is not one. */
export const meetingRelayOf = (raw: unknown): string => {
  let text = String(raw ?? '').trim()
  if (!text || text.length > 256) return ''
  if (!/^wss?:\/\//i.test(text)) text = `wss://${text}`
  let url: URL
  try { url = new URL(text) } catch { return '' }
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return ''
  if (url.username || url.password || url.search || url.hash) return ''
  const name = url.hostname.toLowerCase()
  const loopback = LOOPBACK_NAME_RE.test(name)
  if (!loopback && !DOMAIN_RE.test(name)) return ''
  if (url.protocol === 'ws:' && !loopback) return ''
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')
  return `${url.protocol}//${url.host.toLowerCase()}${path}`
}

/** The domain a meeting point's relay is on (its default meeting host). */
export const relayDomainOf = (relay: string): string => {
  try {
    const host = new URL(relay).host.toLowerCase()
    const port = /:(\d{1,5})$/.exec(host)
    const name = port ? host.slice(0, port.index) : host
    if (LOOPBACK_NAME_RE.test(name)) return host
    return !port && DOMAIN_RE.test(name) ? name : ''
  } catch { return '' }
}

// ── the meeting point a new tab is pre-filled with ─────────────────────────

/** One current record — the canonical point, '' for the default relay — in
 *  this participant's `mesh:meet-point` document pool. Read synchronously;
 *  written through to the pool. */
const meetPoint = new ParticipantDocument<string>({
  meaning: MEET_POINT_MEANING,
  parse: raw => (typeof raw === 'string' ? meetingRelayOf(raw) : null),
  empty: '',
})

/** Keep `relay` (canonical, never a code) as the next tab's pre-fill; '' —
 *  the default relay — is kept too: the pre-fill follows the last meeting. */
const recordMeetPoint = (relay: string): void => {
  const point = meetingRelayOf(relay)
  if (meetPoint.value !== point) meetPoint.write(point)
}

/** The meeting point of the last meeting on this device — what a NEW tab's
 *  selector pre-fills beside the origin-wide room and secret. '' = the
 *  default relay. A tab with a point of its own reads its zone instead. */
export const readMeetPointPrefill = (): string => meetingRelayOf(meetPoint.value)

/** This tab's membership as last announced — seeded from the resume, so the
 *  shell's boot re-announcement of a resumed join is not taken for a join. */
let announcedJoined = meshResumed

/** Every join and leave path announces `mesh:public-changed`; the shell
 *  records each one here so the next reload of this tab resumes it — and a
 *  join records the zone it joined, beside it. A JOIN (never the boot replay
 *  of a resumed one — another tab's meeting must not be moved by a reload
 *  here) also leaves its meeting point as the next new tab's pre-fill: a
 *  module (a link, `use-live-relay`) writes the point into the tab directly,
 *  so the join is where the shell sees it. */
export const rememberMeshSession = (pub: boolean): void => {
  try { sessionStorage.setItem(MESH_SESSION_KEY, String(pub)) } catch { /* no storage — a reload boots private */ }
  const joinedNow = pub && !announcedJoined
  announcedJoined = pub
  if (!pub) return
  const room = credential(ROOM_STORE)
  const secret = credential(SECRET_STORE)
  if (room !== undefined && secret !== undefined) writeMeshZone({ room, secret })
  if (joinedNow) recordMeetPoint(readMeshZone()?.relay ?? '')
}
