// hypercomb-shared/core/invite-capture.ts
//
// Boot-time capture for `/<sig>` meeting-place invite links (and, below, the
// `#meet=` meeting link and the `?hive=` outside-in door).
//
// Runs on import — BEFORE Navigation / bootstrap-history parse the URL. If the
// boot path is a single 64-hex signature, stash it for the receive-side
// MeetingInviteWorker (essentials) and strip it from the URL so navigation
// doesn't try to open a tile named after the hash.
//
// Shell-level plumbing imported by BOTH web and dev main.ts right after
// `ioc.web` (parity). It holds NO essentials import — the only shared contract
// is the sessionStorage key, mirrored from
// sharing/meeting-invite.ts (PENDING_INVITE_KEY).
// Keep the two literals in sync.

import { EffectBus } from '@hypercomb/core'
import { meetingRelayOf } from './mesh-session'

const PENDING_INVITE_KEY = 'hc:pending-invite' // mirror of essentials meeting-invite.ts
const PENDING_INVITE_SECRET_KEY = 'hc:pending-invite-secret' // mirror of PENDING_INVITE_SECRET_KEY
const INVITE_SECRET_PREFIX = '#invite-secret='               // mirror of INVITE_SECRET_PREFIX
const PENDING_DOOR_KEY = 'hc:pending-door'     // mirror of essentials hive-link.ts
const SIG_RE = /^[0-9a-f]{64}$/
const DOOR_PARAM = 'hive'                      // mirror of HIVE_DOOR_PARAM

;(function captureInviteLink(): void {
  try {
    const segments = window.location.pathname.split('/').filter(Boolean)
    // A lone 64-hex path component is unambiguous — real tile paths aren't
    // hashes, and multi-segment / bracket-selection paths have length > 1.
    if (segments.length !== 1) return
    const sig = segments[0].toLowerCase()
    if (!SIG_RE.test(sig)) return

    try { sessionStorage.setItem(PENDING_INVITE_KEY, sig) } catch { /* ignore */ }

    // The invite's secret rides in the fragment (`#invite-secret=…`), never
    // in the bundle the host serves. Stashed for the worker and stripped, so
    // it never sits in the address bar or the history.
    let hash = window.location.hash ?? ''
    if (hash.startsWith(INVITE_SECRET_PREFIX)) {
      try {
        sessionStorage.setItem(PENDING_INVITE_SECRET_KEY, decodeURIComponent(hash.slice(INVITE_SECRET_PREFIX.length)))
      } catch { /* ignore */ }
      hash = ''
    }

    // Strip the signature so the URL is a clean root; preserve any query/hash.
    const clean = '/' + (window.location.search ?? '') + hash
    window.history.replaceState(window.history.state, '', clean)
  } catch { /* ignore — never block boot on capture */ }
})()

// THE MEETING LINK — `#meet=room/secret/page[&relay=…&host=…&code=…]`, what
// a bare `invite` copies. The place (and the meeting point, with its access
// code) rides in the FRAGMENT, which no server ever sees, so the shell
// stashes it for the receive side (MeetingInviteWorker) and strips it before
// anything can read the hash or show the secret in the address bar. Stashed
// VERBATIM, like the door below: the one validator is essentials'
// meeting-invite.ts `parseMeet`. sessionStorage, because a first visit may
// install and reload before the worker runs — the join must survive that.
// The worker keeps it until its sheet is answered (watchPendingMeet below
// covers a package that does not).
const PENDING_MEET_KEY = 'hc:pending-meet' // mirror of essentials meeting-invite.ts MEET_KEY
const MEET_PREFIX = '#meet='               // mirror of MEET_PREFIX

;(function captureMeetLink(): void {
  try {
    const hash = window.location.hash ?? ''
    if (!hash.startsWith(MEET_PREFIX)) return

    try { sessionStorage.setItem(PENDING_MEET_KEY, hash.slice(MEET_PREFIX.length)) } catch { /* ignore */ }

    const clean = window.location.pathname + (window.location.search ?? '')
    window.history.replaceState(window.history.state, '', clean)
  } catch { /* ignore — never block boot on capture */ }
})()

// THE OUTSIDE-IN DOOR — a link pressed on somebody's published site, landing
// here. It carries COORDINATES rather than a signature (a read-only visitor
// shell may not fetch across origins to mint one), so it is a query on the
// root rather than a `/<sig>` path, and it is captured for the same reason
// the signature is: the URL must settle as a clean root before Navigation
// reads it, or the hive tries to open a tile named after the query.
//
// The query is stashed VERBATIM. Nothing here decides what it means — the one
// validator lives in essentials (hive-link.ts `hiveDoorOf`), and a second
// copy of it in the shell is a second place for the two to disagree.
;(function captureHiveDoor(): void {
  try {
    const search = window.location.search ?? ''
    if (!search) return
    const params = new URLSearchParams(search)
    if (!params.get(DOOR_PARAM)) return

    try { sessionStorage.setItem(PENDING_DOOR_KEY, search) } catch { /* ignore */ }

    for (const key of [DOOR_PARAM, 'on', 'of', 'at']) params.delete(key)
    const rest = params.toString()
    const clean = window.location.pathname + (rest ? `?${rest}` : '') + (window.location.hash ?? '')
    window.history.replaceState(window.history.state, '', clean)
  } catch { /* ignore — never block boot on capture */ }
})()

// ── THE OLD PACKAGE FALLBACK ────────────────────────────────────────────────
//
// The shell strips the meeting link from the address bar at boot, so the
// stash is the only copy. A package from before the meeting link never reads
// it (the link did nothing at all), and one from before this revision drains
// it the moment its worker acts. A current package says so on its worker
// (`meetLinks >= 2`) and keeps the stash until its sheet is answered.
//
// So, once the drones are loaded: a current worker → leave it be. Any other
// worker, still holding the stash after a grace → this shell opens the
// selector itself, pre-filled with the link's room and secret (nothing is
// written until START), and lets the stash go when the selector closes. No
// worker at all after the long wait → the same.

const MEETING_INVITE_WORKER_KEY = '@diamondcoreprocessor.com/MeetingInviteWorker'

export interface PendingMeetTiming {
  /** How often the stash is looked at. */
  pollMs?: number
  /** After an older worker appears, how long it has to take the stash. */
  graceMs?: number
  /** With no worker at all, how long before the shell answers itself. */
  maxWaitMs?: number
}

/** The room and secret a stashed link names — only what the selector needs.
 *  The one full validator stays essentials' parseMeet; this reads the two
 *  credentials and nothing else, or null. */
export const meetCredentialsOf = (raw: string): { room: string; secret: string } | null => {
  let body = String(raw ?? '').trim()
  if (body.startsWith(MEET_PREFIX)) body = body.slice(MEET_PREFIX.length)
  const amp = body.indexOf('&')
  const parts = (amp < 0 ? body : body.slice(0, amp)).split('/')
  if (parts.length < 2) return null
  try {
    const room = decodeURIComponent(parts[0]).trim()
    const secret = decodeURIComponent(parts[1]).trim()
    if (!room || !secret || room.length > 512 || secret.length > 512 || /[/\\]/.test(room + secret)) return null
    return { room, secret }
  } catch { return null }
}

/** The meeting point a stashed link names, canonical: '' when it names none,
 *  null when it names one that is not a meeting point (the link is no link —
 *  never a quiet join at the default). */
export const meetPointOf = (raw: string): string | null => {
  const body = String(raw ?? '').trim()
  const amp = body.indexOf('&')
  if (amp < 0) return ''
  for (const pair of body.slice(amp + 1).split('&')) {
    if (!pair.startsWith('relay=')) continue
    let value: string
    try { value = decodeURIComponent(pair.slice('relay='.length)) } catch { return null }
    return meetingRelayOf(value) || null
  }
  return ''
}

export const watchPendingMeet = (timing: PendingMeetTiming = {}): void => {
  const pollMs = timing.pollMs ?? 250
  const graceMs = timing.graceMs ?? 5_000
  const maxWaitMs = timing.maxWaitMs ?? 30_000
  const started = Date.now()
  let workerSeenAt = 0

  const held = (): string => { try { return sessionStorage.getItem(PENDING_MEET_KEY) ?? '' } catch { return '' } }
  const drop = (): void => { try { sessionStorage.removeItem(PENDING_MEET_KEY) } catch { /* ignore */ } }

  const answer = (link: string): void => {
    const creds = meetCredentialsOf(link)
    const point = meetPointOf(link)
    if (!creds || point === null) { drop(); return }
    // The meeting point rides along, so START meets where the room is — never
    // quietly at the default relay. The code does not: no effect carries it.
    EffectBus.emit('mesh:open-modal', { join: true, room: creds.room, secret: creds.secret, ...(point ? { point } : {}) })
    // Subscribed AFTER the open, so the replayed value is this open.
    const off = EffectBus.on<{ open?: boolean }>('mesh:modal-open', (p) => {
      if (p?.open !== false) return
      drop()
      queueMicrotask(() => off())
    })
  }

  const tick = (): void => {
    const link = held()
    if (!link) return
    let worker: { meetLinks?: unknown } | undefined
    try { worker = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(MEETING_INVITE_WORKER_KEY) as { meetLinks?: unknown } | undefined } catch { worker = undefined }
    if (worker && Number(worker.meetLinks) >= 2) return
    const now = Date.now()
    if (worker && !workerSeenAt) workerSeenAt = now
    const due = worker ? now - workerSeenAt >= graceMs : now - started >= maxWaitMs
    if (due) { answer(link); return }
    setTimeout(tick, pollMs)
  }
  tick()
}
