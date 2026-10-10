// sharing/meeting-invite.join.ts
//
// Shared "apply an invite" logic, used by EVERY entry path:
//   - the meeting link — `#meet=room/secret/page[&relay=…&host=…&code=…]`,
//     captured at boot
//   - the link path    — MeetingInviteWorker resolves a /<sig> boot URL
//   - the tile path    — clicking a `swarm:invite` junction icon on a tile
//
// Joining is an AUTH SWITCH (the model the user picked: "just an auth-switch
// junction"). ONE sheet asks, naming the room, the meeting point when the
// link names one, and the host that keeps what the guest shares — never the
// meeting point's access code. On Join the credentials are set EXACTLY, the
// link's meeting point becomes this tab's (sessionStorage `hc:mesh-zone`,
// membership.ts) and the mesh is pointed at it, the guest walks to the page,
// the command line drops to tiles (a typed name must become a tile, never a
// command — the sticky stance ate a meeting's worth of names), and the swarm
// is joined through the one toggle door. "Not now" writes NOTHING: every
// write waits for the answer, so a declined invite leaves the participant
// exactly where they were — and never writes a stale pair over another tab's.

import { EffectBus, get, requestConfirm, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { validateInviteBundle, meetingRelayOf, meetingHostOf, isAccessCode, type MeetingInviteBundle, type MeetingPoint } from './meeting-invite.js'
import { PUBLIC_CONTENT_HOSTS } from './hive-link.js'
import { readDoorsOf } from './zone-door.js'
import { isJoinedHere, readTabZone, writeTabZone } from './membership.js'

const STORE_KEY = '@hypercomb.social/Store'
const ROOM_KEY = '@hypercomb.social/RoomStore'
const SECRET_KEY = '@hypercomb.social/SecretStore'
const NAV_KEY = '@hypercomb.social/Navigation'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const CONTENT_BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'
const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
/** Mirror of the command line's own key (hypercomb-shared/ui/command-line). */
const STANCE_KEY = 'hc:command-line-stance'

const SIG_RE = /^[a-f0-9]{64}$/

interface StoreLike {
  getResource: (sig: string) => Promise<Blob | null>
  putResource?: (blob: Blob, options?: { emit?: boolean }) => Promise<string>
}
interface CredStoreLike { value: string; set: (v: string) => void }
interface NavLike {
  go: (segments: readonly string[]) => void
  goRaw?: (segments: readonly string[]) => void
  segments: () => string[]
}
interface LineageLike { explorerSegments?: () => readonly string[] }
interface HostSyncLike {
  swarmHostsFor?: (segments: readonly string[]) => { hosts: readonly string[]; pending: boolean; source?: string }
  warmSwarmHosts?: (segments: readonly string[]) => void
}
interface MeshLike {
  configureRelays?: (urls: string[], persist?: boolean) => void
  getDebug?: () => { relays?: readonly string[] } | undefined
  connectionState?: () => { refused?: string } | undefined
}

/** How long the sheet waits for the invited page's host to be known (local
 *  reads only — the pool, the page's marks; the socket is already warm). */
const KEEPER_WAIT_MS = 1_500
const KEEPER_POLL_MS = 100

/** WHO KEEPS WHAT THE GUEST SHARES on the invited page: its publish domains,
 *  else their hosts pool, else a relay that hosts participants (host-sync,
 *  from caches). On a first visit those are still being read when the link
 *  opens, and the sheet IS the consent — so it waits, briefly, for the answer
 *  rather than naming no one. '' when nothing hosts it (or still unknown). */
async function keeperOf(segments: readonly string[], meetingHost = ''): Promise<string> {
  const hostSync = get<HostSyncLike>(HOST_SYNC_KEY)
  // The link names its meeting host: that is who keeps the room's tiles,
  // unless the page already wears publish domains of its own (they come
  // first — swarm-hosts.ts). Asked once, from caches; nothing waits.
  if (meetingHost) {
    let choice: { hosts: readonly string[]; pending: boolean; source?: string } | undefined
    try { choice = hostSync?.swarmHostsFor?.(segments) } catch { choice = undefined }
    return choice && !choice.pending && choice.source === 'publish' && choice.hosts[0] ? choice.hosts[0] : meetingHost
  }
  if (!hostSync?.swarmHostsFor) return ''
  try { hostSync.warmSwarmHosts?.(segments) } catch { /* an older host-sync */ }
  const deadline = Date.now() + KEEPER_WAIT_MS
  for (;;) {
    let choice: { hosts: readonly string[]; pending: boolean } | undefined
    try { choice = hostSync.swarmHostsFor(segments) } catch { return '' }
    if (!choice?.pending || Date.now() >= deadline) return choice?.hosts?.[0] ?? ''
    await new Promise(resolve => setTimeout(resolve, KEEPER_POLL_MS))
  }
}

function toast(type: string, title: string, message: string): void {
  EffectBus.emit('toast:show', { type, title, message })
}

/** The catalog's words, else the English fallback — `t()` answers a missing
 *  key with the key itself, never undefined, so `?? fallback` alone would
 *  paint a raw key on an older shell. */
function tr(key: string, fallback: string, params?: Record<string, string | number>): string {
  const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
  const s = i18n?.t(key, params)
  return s && s !== key ? s : fallback
}

/** Where the swarm hashes from: the explorer's segments, trimmed, exactly
 *  as SwarmDrone reads them — never the URL's lower-cased form. */
function hereSegments(nav: NavLike): string[] {
  const raw = get<LineageLike>(LINEAGE_KEY)?.explorerSegments?.()
  const segs = Array.isArray(raw) ? raw : nav.segments()
  return segs.map(s => String(s ?? '').trim()).filter(s => s.length > 0)
}

/** Walk to the page as written — case kept, so the guest's explorer
 *  segments equal the inviter's and the two hash the same page. */
function walkTo(nav: NavLike, segments: readonly string[]): void {
  if (typeof nav.goRaw === 'function') nav.goRaw(segments)
  else nav.go(segments)
}

/** Resolve a link bundle's RAW JSON by signature: memory → OPFS → host via
 *  Store, then a direct origin fetch (sha256-verified) as a last resort. A
 *  fresh recipient won't have the bytes locally; the link/junction host
 *  serves `/<sig>`. Bytes are hash-checked, so an SPA index.html fallback
 *  is rejected. Kind-agnostic: the caller validates against whichever
 *  bundle shape(s) it accepts (meeting-invite, hive-link, …). */
export async function loadBundleJson(sig: string): Promise<unknown | null> {
  if (!SIG_RE.test(sig)) return null
  const store = get<StoreLike>(STORE_KEY)
  // Teach the broker the standing public CDN as a byte source for this sig
  // BEFORE the Store cascade runs: a bundle minted to the CDN then opened on
  // a different app origin has no other reachable host in private mode.
  try {
    get<{ noteDomainsForSig?: (sig: string, domains: string[]) => void }>(CONTENT_BROKER_KEY)
      ?.noteDomainsForSig?.(sig, readDoorsOf(PUBLIC_CONTENT_HOSTS))
  } catch { /* broker absent — origin fetch below still covers same-origin */ }
  let blob: Blob | null = null
  try { blob = (await store?.getResource(sig)) ?? null } catch { /* fall through */ }
  if (!blob) blob = await fetchAndVerify(sig)
  if (!blob) return null
  // Persist for repeat opens; suppress host re-push (someone else's bytes).
  try { await store?.putResource?.(blob, { emit: false }) } catch { /* ignore */ }
  try { return JSON.parse(await blob.text()) as unknown } catch { return null }
}

/** Resolve + validate a MEETING-INVITE bundle (the tile-junction path,
 *  which only ever carries invites). */
export async function loadInviteBundle(sig: string): Promise<MeetingInviteBundle | null> {
  return validateInviteBundle(await loadBundleJson(sig))
}

async function fetchAndVerify(sig: string): Promise<Blob | null> {
  for (const url of [`/${sig}`, `/@resource/${sig}`]) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) continue
      const buf = await res.arrayBuffer()
      const hash = await crypto.subtle.digest('SHA-256', buf)
      const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
      if (hex !== sig) continue // wrong bytes / SPA fallback — reject
      return new Blob([buf], { type: 'application/json' })
    } catch { /* next candidate */ }
  }
  return null
}

const sameSegments = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((s, i) => s === b[i])

/** The meeting point a link names, canonical — '' when it names none. */
const pointOf = (bundle: MeetingInviteBundle & MeetingPoint): Required<MeetingPoint> => {
  const relay = meetingRelayOf(bundle.relay)
  return {
    relay,
    host: meetingHostOf(bundle.host),
    // A code is for its meeting point alone — never the default relay's.
    code: relay && isAccessCode(bundle.code) ? bundle.code : '',
  }
}

/** Is the meeting point refusing this tab's access code right now? */
function refusedAccess(): boolean {
  try { return get<MeshLike>(MESH_KEY)?.connectionState?.()?.refused === 'access' } catch { return false }
}

/** A meeting point as a person reads it: its host and path, no scheme. */
export const meetingPointLabel = (relay: string): string => relay.replace(/^wss?:\/\//, '')

/**
 * POINT THIS TAB'S MESH AT ITS MEETING POINT, now. The zone must already hold
 * it (the dial reads the access code from there). '' = the default relay: the
 * mesh reloads its own defaults on the announcement. Re-pointing to the relay
 * the mesh already dials does nothing — that tore a live socket down.
 * Announces `mesh:zone` {relay} — never the code.
 */
export function pointMeshAt(relay: string): void {
  if (relay) {
    const mesh = get<MeshLike>(MESH_KEY)
    let current: readonly string[] | undefined
    try { current = mesh?.getDebug?.()?.relays } catch { current = undefined }
    const same = Array.isArray(current) && current.length === 1 && current[0] === relay
    if (!same) {
      try { mesh?.configureRelays?.([relay], false) } catch { /* the announcement below still reaches the mesh */ }
    }
  }
  EffectBus.emit('mesh:zone', { relay })
}

/** Confirm + auth-switch into the bundle's meeting place. Returns true iff
 *  the participant joined. Nothing is written unless they do. */
export async function joinMeetingPlace(bundle: MeetingInviteBundle & MeetingPoint): Promise<boolean> {
  const room = get<CredStoreLike>(ROOM_KEY)
  const secret = get<CredStoreLike>(SECRET_KEY)
  const nav = get<NavLike>(NAV_KEY)
  if (!room || !secret || !nav) return false

  const where = bundle.segments.length ? '/' + bundle.segments.join('/') : '/ (hive root)'
  const label = bundle.alias?.trim() || where
  const point = pointOf(bundle)
  const tab = readTabZone()

  // Already in this room AT THIS MEETING POINT, joined — there is nothing to
  // switch and nothing to ask. At most the guest walks to the page the link
  // names. The owner who clicks the invite they minted, or a guest re-opening
  // the link after a reload, lands where they were pointed with no sheet.
  //
  // But a link that would CHANGE something is never taken quietly — anyone
  // who knows the room can post one. A new meeting host is who keeps what
  // this participant shares from then on, so the sheet names it and asks. A
  // new access code is taken quietly only while the meeting point is refusing
  // this tab's code (a recycle — the very case a fresh link is for); a tab the
  // meeting point lets in is asked before its working code is replaced.
  const hereAlready = room.value === bundle.room && secret.value === bundle.secret && (tab?.relay ?? '') === point.relay && isJoinedHere()
  const newKeeper = !!point.host && point.host !== (tab?.host ?? '')
  const newCode = !!point.code && point.code !== (tab?.code ?? '')
  if (hereAlready && !newKeeper && (!newCode || refusedAccess())) {
    if (newCode) {
      writeTabZone({ code: point.code })
      // The mesh dials the new code at once, past its refusal.
      EffectBus.emit('mesh:zone', { relay: point.relay })
    }
    if (!sameSegments(hereSegments(nav), bundle.segments)) walkTo(nav, bundle.segments)
    toast('tip', tr('invite.join.title', 'Meeting place'), tr('invite.already-here', `You're already in "${label}".`, { label }))
    return false
  }

  // The sheet names the meeting point (when the link names one) and who keeps
  // what the guest shares (keeperOf) — never the access code. Still not known
  // after the short wait: the sheet names no keeper.
  const host = await keeperOf(bundle.segments, point.host)
  const at = point.relay ? meetingPointLabel(point.relay) : ''
  const params = { room: bundle.room, host, point: at }
  const message = at
    ? host
      ? tr('invite.meet.join.message-at', `Join the room “${bundle.room}” at ${at}? You'll see everyone here. Tiles you add while joined are shared with the room and kept by ${host}.`, params)
      : tr('invite.meet.join.message-at-local', `Join the room “${bundle.room}” at ${at}? You'll see everyone here. Tiles you add while joined are shared with the room.`, params)
    : host
      ? tr('invite.meet.join.message', `Join the room “${bundle.room}”? You'll see everyone here. Tiles you add while joined are shared with the room and kept by ${host}.`, params)
      : tr('invite.meet.join.message-local', `Join the room “${bundle.room}”? You'll see everyone here. Tiles you add while joined are shared with the room.`, params)
  const confirmed = await requestConfirm({
    title: tr('invite.meet.join.title', 'Join the room'),
    message,
    confirmLabel: tr('invite.meet.join.confirm', 'Join'),
    cancelLabel: tr('invite.meet.join.cancel', 'Not now'),
  })
  // Not now: nothing was written, so nothing is restored. (Restoring a
  // snapshot WROTE it — a stale tab's pair over the one another tab chose.)
  if (!confirmed) return false

  // Reproduce (segments, room, secret) so the composed sig lands on the
  // inviter's exact relay slot: the credentials EXACTLY as carried (never
  // case-folded — the zone is case-sensitive), then the page.
  room.set(bundle.room)
  secret.set(bundle.secret)
  // The link's meeting point becomes this tab's, whole: a link that names
  // none meets at the default, so a point this tab held from an earlier
  // meeting is dropped with its code.
  writeTabZone({ room: bundle.room, secret: bundle.secret, relay: point.relay, host: point.host, code: point.code })
  if (point.relay !== (tab?.relay ?? '')) pointMeshAt(point.relay)
  else if (point.code !== (tab?.code ?? '')) EffectBus.emit('mesh:zone', { relay: point.relay })
  EffectBus.emit('mesh:room', { room: bundle.room })
  EffectBus.emit('mesh:secret', { secret: bundle.secret })
  walkTo(nav, bundle.segments)
  // A guest who typed a slash word before tapping the link is still in
  // command stance — and there every name they type next is read as a
  // command and silently dropped. Joining a room is joining to make tiles.
  try { localStorage.setItem(STANCE_KEY, 'tiles') } catch { /* the effect below still lands */ }
  EffectBus.emit('command-line:stance', { stance: 'tiles' })
  // THE ONE DOOR in: the same toggle the control, the shortcut and the
  // `join` word use (its zone guard lives in runtime-initializer). Only
  // when this tab is not already a member — a toggle would make it leave.
  if (!isJoinedHere()) EffectBus.emit('keymap:invoke', { cmd: 'mesh.togglePublic', binding: null, event: null })
  toast('success', tr('invite.join.success', 'Joined meeting place'), label)
  return true
}
