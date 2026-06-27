// diamondcoreprocessor.com/sharing/meeting-invite.join.ts
//
// Shared "apply an invite" logic, used by BOTH entry paths:
//   - the link path  — MeetingInviteWorker resolves a /<sig> boot URL
//   - the tile path  — clicking a `swarm:invite` junction icon on a tile
//
// Joining is an AUTH SWITCH (the model the user picked: "just an auth-switch
// junction"). We confirm, snapshot the current credentials, then navigate to
// the bundle's location and set room/secret — flipping solo → public via
// `mesh:join`. On cancel, the snapshot is restored so a declined invite
// leaves the participant exactly where they were.

import { EffectBus, get, requestConfirm, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { validateInviteBundle, type MeetingInviteBundle } from './meeting-invite.js'

const STORE_KEY = '@hypercomb.social/Store'
const ROOM_KEY = '@hypercomb.social/RoomStore'
const SECRET_KEY = '@hypercomb.social/SecretStore'
const NAV_KEY = '@hypercomb.social/Navigation'

const SIG_RE = /^[a-f0-9]{64}$/

interface StoreLike {
  getResource: (sig: string) => Promise<Blob | null>
  putResource?: (blob: Blob, options?: { emit?: boolean }) => Promise<string>
}
interface CredStoreLike { value: string; set: (v: string) => void }
interface NavLike { go: (segments: readonly string[]) => void; segments: () => string[] }

function toast(type: string, title: string, message: string): void {
  EffectBus.emit('toast:show', { type, title, message })
}

/** Resolve an invite bundle by signature: memory → OPFS → host via Store,
 *  then a direct origin fetch (sha256-verified) as a last resort. A fresh
 *  recipient won't have the bytes locally; the link/junction host serves
 *  `/<sig>`. Bytes are hash-checked, so an SPA index.html fallback is
 *  rejected. */
export async function loadInviteBundle(sig: string): Promise<MeetingInviteBundle | null> {
  if (!SIG_RE.test(sig)) return null
  const store = get<StoreLike>(STORE_KEY)
  let blob: Blob | null = null
  try { blob = (await store?.getResource(sig)) ?? null } catch { /* fall through */ }
  if (!blob) blob = await fetchAndVerify(sig)
  if (!blob) return null
  // Persist for repeat opens; suppress host re-push (someone else's bytes).
  try { await store?.putResource?.(blob, { emit: false }) } catch { /* ignore */ }
  try { return validateInviteBundle(JSON.parse(await blob.text())) } catch { return null }
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

  // Already at this exact junction (same auth AND same location) — nothing
  // to switch. Covers the owner clicking the invite they minted.
  if (
    room.value === bundle.room &&
    secret.value === bundle.secret &&
    sameSegments(nav.segments(), bundle.segments)
  ) {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    toast('tip', i18n?.t('invite.join.title') ?? 'Meeting place', i18n?.t('invite.already-here', { label }) ?? `You're already in "${label}".`)
    return false
  }

  // Snapshot the credentials in effect BEFORE the prompt so a cancel
  // restores them exactly. All live writes are deferred to the accept path,
  // so cancel is non-destructive by construction; this is the explicit belt.
  const prev = { room: room.value, secret: secret.value }
  const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
  const confirmed = await requestConfirm({
    title: i18n?.t('invite.join.title') ?? 'Join meeting place',
    message: i18n?.t('invite.join.message', { label }) ?? `Join "${label}"? Your current room and secret will be switched to this swarm.`,
    confirmLabel: i18n?.t('invite.join.confirm') ?? 'Join',
    cancelLabel: i18n?.t('invite.join.cancel') ?? 'Stay',
  })
  if (!confirmed) {
    room.set(prev.room)
    secret.set(prev.secret)
    return false
  }

  // Reproduce (segments, room, secret) so composeSigForSegments lands on the
  // inviter's exact relay slot, then flip solo → public (controls-bar listens
  // for mesh:join; the store `change` events drive SwarmDrone re-sync).
  nav.go(bundle.segments)
  room.set(bundle.room)
  secret.set(bundle.secret)
  EffectBus.emit('mesh:room', { room: bundle.room })
  EffectBus.emit('mesh:secret', { secret: bundle.secret })
  EffectBus.emit('mesh:join', {})
  toast('success', i18n?.t('invite.join.success') ?? 'Joined meeting place', label)
  return true
}
