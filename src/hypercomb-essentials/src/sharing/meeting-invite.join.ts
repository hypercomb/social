// sharing/meeting-invite.join.ts
//
// Shared "apply an invite" logic, used by EVERY entry path:
//   - the meeting link — `#meet=room/secret/page`, captured at boot
//   - the link path    — MeetingInviteWorker resolves a /<sig> boot URL
//   - the tile path    — clicking a `swarm:invite` junction icon on a tile
//
// Joining is an AUTH SWITCH (the model the user picked: "just an auth-switch
// junction"). ONE sheet asks, naming the room and the host that keeps what
// the guest shares (the swarm's host — the relay they are about to meet at).
// On Join the credentials are set EXACTLY, the guest walks to the page, the
// command line drops to tiles (a typed name must become a tile, never a
// command — the sticky stance ate a meeting's worth of names), and the swarm
// is joined through the one toggle door. On cancel, the snapshot is restored
// so a declined invite leaves the participant exactly where they were.

import { EffectBus, get, requestConfirm, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { validateInviteBundle, type MeetingInviteBundle } from './meeting-invite.js'
import { PUBLIC_CONTENT_HOSTS } from './hive-link.js'
import { readDoorsOf } from './zone-door.js'
import { isJoinedHere } from './membership.js'

const STORE_KEY = '@hypercomb.social/Store'
const ROOM_KEY = '@hypercomb.social/RoomStore'
const SECRET_KEY = '@hypercomb.social/SecretStore'
const NAV_KEY = '@hypercomb.social/Navigation'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const CONTENT_BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'
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
interface MeshLike { swarmHost?: () => string }

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

/** Confirm + auth-switch into the bundle's meeting place. Returns true iff
 *  the participant joined. Restores prior credentials on cancel. */
export async function joinMeetingPlace(bundle: MeetingInviteBundle): Promise<boolean> {
  const room = get<CredStoreLike>(ROOM_KEY)
  const secret = get<CredStoreLike>(SECRET_KEY)
  const nav = get<NavLike>(NAV_KEY)
  if (!room || !secret || !nav) return false

  const where = bundle.segments.length ? '/' + bundle.segments.join('/') : '/ (hive root)'
  const label = bundle.alias?.trim() || where

  // Already in this room, joined — there is nothing to switch and nothing to
  // ask. At most the guest walks to the page the link names; the owner who
  // clicks the invite they minted, or a guest re-opening the link after a
  // reload, lands where they were pointed with no sheet.
  if (room.value === bundle.room && secret.value === bundle.secret && isJoinedHere()) {
    if (!sameSegments(hereSegments(nav), bundle.segments)) walkTo(nav, bundle.segments)
    toast('tip', tr('invite.join.title', 'Meeting place'), tr('invite.already-here', `You're already in "${label}".`, { label }))
    return false
  }

  // Snapshot the credentials in effect BEFORE the prompt so a cancel
  // restores them exactly. All live writes are deferred to the accept path,
  // so cancel is non-destructive by construction; this is the explicit belt.
  const prev = { room: room.value, secret: secret.value }
  // The sheet names who keeps what the guest shares: the swarm's host is the
  // relay they are about to meet at (derived, synchronous — never fetched).
  let host = ''
  try { host = get<MeshLike>(MESH_KEY)?.swarmHost?.() ?? '' } catch { host = '' }
  const params = { room: bundle.room, host }
  const confirmed = await requestConfirm({
    title: tr('invite.meet.join.title', 'Join the room'),
    message: host
      ? tr('invite.meet.join.message', `Join the room “${bundle.room}”? You'll see everyone here. Tiles you add while joined are shared with the room and kept by ${host}.`, params)
      : tr('invite.meet.join.message-local', `Join the room “${bundle.room}”? You'll see everyone here. Tiles you add while joined are shared with the room.`, params),
    confirmLabel: tr('invite.meet.join.confirm', 'Join'),
    cancelLabel: tr('invite.meet.join.cancel', 'Not now'),
  })
  if (!confirmed) {
    room.set(prev.room)
    secret.set(prev.secret)
    return false
  }

  // Reproduce (segments, room, secret) so the composed sig lands on the
  // inviter's exact relay slot: the credentials EXACTLY as carried (never
  // case-folded — the zone is case-sensitive), then the page.
  room.set(bundle.room)
  secret.set(bundle.secret)
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
