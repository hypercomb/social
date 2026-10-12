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
import { isAccessCode, meetingRelayOf, readMeshZone, relayDomainOf, writeMeshZone, type MeshZone } from './mesh-session'
import { folderPath, hivePathname } from './url-folder'

const PENDING_INVITE_KEY = 'hc:pending-invite' // mirror of essentials meeting-invite.ts
const PENDING_INVITE_SECRET_KEY = 'hc:pending-invite-secret' // mirror of PENDING_INVITE_SECRET_KEY
const INVITE_SECRET_PREFIX = '#invite-secret='               // mirror of INVITE_SECRET_PREFIX
const PENDING_DOOR_KEY = 'hc:pending-door'     // mirror of essentials hive-link.ts
const SIG_RE = /^[0-9a-f]{64}$/
const DOOR_PARAM = 'hive'                      // mirror of HIVE_DOOR_PARAM

;(function captureInviteLink(): void {
  try {
    const segments = hivePathname().split('/').filter(Boolean)
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
    const clean = folderPath('/') + (window.location.search ?? '') + hash
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
//
// The address bar is stripped only once the stash HOLDS the link: where
// sessionStorage is refused ("block all site data"), the URL is the only copy
// a reload — after the setting is fixed — can still read (CC-2).
const PENDING_MEET_KEY = 'hc:pending-meet' // mirror of essentials meeting-invite.ts MEET_KEY
const MEET_PREFIX = '#meet='               // mirror of MEET_PREFIX

/** THE SHELL'S OWN COPY of the link, beside the package's stash. The stash
 *  is the package's to drain — and an older package drains a link it cannot
 *  read (VO-1); where storage is refused, this copy is all there is (CC-2).
 *  A reload that finds the stash still unanswered starts from it. */
let meetCopy = ''

/** Take a `#meet=` fragment from the address bar. True when there was one. */
const captureMeetLink = (): boolean => {
  try {
    const hash = window.location.hash ?? ''
    if (!hash.startsWith(MEET_PREFIX)) return false
    meetCopy = hash.slice(MEET_PREFIX.length)
    try { sessionStorage.setItem(PENDING_MEET_KEY, meetCopy) } catch { return true }
    const clean = window.location.pathname + (window.location.search ?? '')
    window.history.replaceState(window.history.state, '', clean)
    return true
  } catch { return false } // never block boot on capture
}

if (!captureMeetLink()) {
  try { meetCopy = sessionStorage.getItem(PENDING_MEET_KEY) ?? '' } catch { /* no storage */ }
}

// A LINK OPENED IN A TAB ALREADY ON THE HIVE (MS3). Only the fragment differs,
// so the browser navigates within the page: nothing loads, and the capture
// above never runs again — the link was ignored, and its secret and access
// code sat in the address bar. So the capture listens. `popstate` fires
// first, and this listener is registered before Navigation's (which reads the
// hash as a selection), so the secret leaves before anything reads it. The
// package's worker takes the link at once (`meet:pending`); an older one is
// answered by the fallback below. A path or a query never changes without a
// load, so the `/<sig>` invite and the door need no second look.
const onFragment = (): void => {
  // A link put back for a guest whose storage is blocked stays put — the
  // shell's own synthetic popstate (bootstrap-history) must not take it again.
  if (restoredLink) return
  if (!captureMeetLink()) return
  EffectBus.emitTransient('meet:pending', { at: Date.now() })
  if (watching) watchPendingMeet(watching)
}
window.addEventListener('popstate', onFragment)
window.addEventListener('hashchange', onFragment)

/** WHERE STORAGE IS BLOCKED (a private window, "block all site data", an
 *  in-app browser with storage of its own): the hive cannot run here, and
 *  every remedy the welcome card offers — another window, a reload — needs
 *  the link. Puts the unanswered meeting link back in the address bar, so
 *  copying the URL, or an in-app "Open in browser", carries it; returns the
 *  whole link ('' when none is held). */
export const restoreMeetLink = (): string => {
  let raw = meetCopy
  try { raw = sessionStorage.getItem(PENDING_MEET_KEY) ?? '' } catch { /* refused: the copy is all there is */ }
  if (!raw) return ''
  restoredLink = MEET_PREFIX + raw
  return keepRestoredMeetLink()
}

/** The `#meet=…` the address bar keeps for a guest whose storage is blocked. */
let restoredLink = ''

/** Put a restored meeting link back once more, exactly as it was minted. The
 *  router's first navigation writes the address with the fragment decoded
 *  (`%2F` → '/'), which would turn a room holding a slash into a page; the
 *  web shell calls this after it. '' when nothing was restored. */
export const keepRestoredMeetLink = (): string => {
  if (!restoredLink) return ''
  try {
    if (window.location.hash !== restoredLink) {
      window.history.replaceState(window.history.state, '', window.location.pathname + (window.location.search ?? '') + restoredLink)
    }
    return window.location.href
  } catch { return '' }
}

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
// A package from before the meeting link never reads the stash (the link did
// nothing at all), and one from before the kept stash drains it the moment
// its worker acts. A current package says so on its worker (`meetLinks >= 2`)
// and keeps the stash until its sheet is answered.
//
// So, once the drones are loaded: a current worker → leave it be. An older
// worker and a link it READS → it is answering (or, never reading the stash,
// the shell opens the selector after a grace, pre-filled with the link's room
// and secret: nothing is joined until START). An older worker and a link it
// REFUSES — one naming a meeting point (by design, so it never joins the
// wrong place) or holding a slash in its room or secret — needs the newer
// package: the shell puts it back in the stash, opens the update door and
// says why; the update reloads the tab and the link opens itself (VO-1). No
// worker at all after the long wait → the selector.

const MEETING_INVITE_WORKER_KEY = '@diamondcoreprocessor.com/MeetingInviteWorker'
/** The update door — what the shell's update pill emits (web
 *  package-floor.ts UPDATE_DOOR). */
const UPDATE_DOOR = 'packages:open'

export interface PendingMeetTiming {
  /** How often the stash is looked at. */
  pollMs?: number
  /** After an older worker appears, how long it has to take the stash. */
  graceMs?: number
  /** With no worker at all, how long before the shell answers itself. */
  maxWaitMs?: number
}

/** What a sentence or a chat app's linkifier leaves stuck to the END of a
 *  link — never the link's own. MIRROR of essentials meeting-invite.ts
 *  trimLinkTail (invite-capture.robust.spec.ts holds the two together). */
const trimLinkTail = (text: string): string => {
  let body = text
  for (;;) {
    let next = body.replace(/[.,;:!?'"\]}>]+$/, '')
    if (next.endsWith(')') && (next.match(/\(/g)?.length ?? 0) < (next.match(/\)/g)?.length ?? 0)) next = next.slice(0, -1)
    if (next === body) return body
    body = next
  }
}

/** A stashed link's text after `#meet=`, its stray tail trimmed. */
const meetBody = (raw: string): string => {
  let body = String(raw ?? '').trim()
  if (body.startsWith(MEET_PREFIX)) body = body.slice(MEET_PREFIX.length)
  return trimLinkTail(body)
}

/** The room and secret a stashed link names — only what the selector needs.
 *  The one full validator stays essentials' parseMeet; this reads the two
 *  credentials and nothing else, or null. Free text, as there: a '/' in
 *  either was encoded, and the place splits before decoding. */
export const meetCredentialsOf = (raw: string): { room: string; secret: string } | null => {
  const body = meetBody(raw)
  const amp = body.indexOf('&')
  const parts = (amp < 0 ? body : body.slice(0, amp)).split('/')
  if (parts.length < 2) return null
  try {
    const room = decodeURIComponent(parts[0]).trim()
    const secret = decodeURIComponent(parts[1]).trim()
    if (!room || !secret) return null
    return { room, secret }
  } catch { return null }
}

/** The meeting point a stashed link names — canonical relay, its host and
 *  access code. relay '' when it names none; null when it names one that is
 *  not a meeting point (the link is no link — never a quiet join at the
 *  default). The first of a repeated key wins; a code only rides a relay. */
const meetingPointOf = (raw: string): { relay: string; host: string; code: string } | null => {
  const body = meetBody(raw)
  const amp = body.indexOf('&')
  const point = { relay: '', host: '', code: '' }
  if (amp < 0) return point
  const seen = new Set<string>()
  for (const pair of body.slice(amp + 1).split('&')) {
    const eq = pair.indexOf('=')
    const key = eq < 0 ? pair : pair.slice(0, eq)
    if (seen.has(key)) continue
    seen.add(key)
    let value: string
    try { value = decodeURIComponent(eq < 0 ? '' : pair.slice(eq + 1)) } catch { if (key === 'relay') return null; continue }
    if (key === 'relay') { point.relay = meetingRelayOf(value); if (!point.relay) return null }
    else if (key === 'host') point.host = relayDomainOf(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`)
    else if (key === 'code' && isAccessCode(value)) point.code = value
  }
  if (!point.relay) point.code = ''
  return point
}

/** The meeting point a stashed link names, canonical: '' when it names none,
 *  null when it names one that is not a meeting point. */
export const meetPointOf = (raw: string): string | null => meetingPointOf(raw)?.relay ?? null

/** Would a package from before 2026-10-10 refuse this link? It refuses one
 *  naming a meeting point — by design (meeting-invite.ts) — and one whose
 *  room or secret holds a slash or runs past 512 characters. */
const olderRefuses = (raw: string): boolean => {
  if (meetPointOf(raw)) return true
  const creds = meetCredentialsOf(raw)
  return !!creds && (/[/\\]/.test(creds.room + creds.secret) || creds.room.length > 512 || creds.secret.length > 512)
}

const held = (): string => { try { return sessionStorage.getItem(PENDING_MEET_KEY) ?? '' } catch { return '' } }

/** The pair in the meeting link stashed in this tab, or null — read where it
 *  lives, device-local, so it never has to ride an effect. */
export const pendingMeetCredentials = (): { room: string; secret: string } | null => meetCredentialsOf(held())

/** The link is answered: neither copy is kept. */
const drop = (): void => {
  meetCopy = ''
  try { sessionStorage.removeItem(PENDING_MEET_KEY) } catch { /* ignore */ }
}

/** The catalog's words, else English — `t()` answers a missing key with the
 *  key itself. */
const tr = (key: string, fallback: string): string => {
  let s: string | undefined
  try { s = ((window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@hypercomb.social/I18n') as { t?: (k: string) => string } | undefined)?.t?.(key) } catch { s = undefined }
  return s && s !== key ? s : fallback
}

/** THE LINK NEEDS THE NEWER PACKAGE. Back in the stash, where the newer
 *  worker reads it once the update reloads the tab; the update door opens,
 *  and the guest is told why — never nothing at all. */
const offerUpdate = (link: string): void => {
  try { sessionStorage.setItem(PENDING_MEET_KEY, link) } catch { /* the copy stays in this page */ }
  EffectBus.emit(UPDATE_DOOR, {})
  EffectBus.emit('toast:show', {
    type: 'info',
    title: tr('invite.meet.title', 'Meeting link'),
    message: tr('meet.needs-update', 'This meeting needs the newer Hypercomb — update and the link opens itself.'),
  })
}

/** The selector, pre-filled from the link — the consent for joining. A link
 *  naming a meeting point puts it in this tab's zone FIRST, with its host and
 *  access code: no effect carries a code, so the selector shows it from the
 *  zone, and a reload (the floor's own included) resumes at the point with it
 *  (VO-3). Closed without START, the zone is put back as it was.
 *
 *  The pair does not ride the bus either: the bus replays its last value to
 *  every late subscriber, so the open names the stash (`meet: true`) and the
 *  selector reads the pair from it (pendingMeetCredentials) when it opens.
 *  The meeting point rides along, so START meets where the room is — never
 *  quietly at the default relay. */
const answer = (link: string): void => {
  const creds = meetCredentialsOf(link)
  const point = meetingPointOf(link)
  if (!creds || !point) { drop(); return }
  let before: MeshZone | null = null
  if (point.relay) {
    const zone = readMeshZone()
    before = { relay: zone?.relay ?? '', host: zone?.host ?? '', code: zone?.code ?? '' }
    // Before the guest has said yes: the tab's zone only — never the next
    // tab's pre-fill (a link naming any point would otherwise steer every
    // later selector on this device to it). START's join records it.
    writeMeshZone(point, { prefill: false })
  }
  EffectBus.emit('mesh:open-modal', { join: true, meet: true, ...(point.relay ? { point: point.relay } : {}) })
  // Subscribed AFTER the open, so the replayed value is this open.
  const off = EffectBus.on<{ open?: boolean; cancelled?: boolean }>('mesh:modal-open', (p) => {
    if (p?.open !== false) return
    drop()
    if (before && p.cancelled) writeMeshZone(before, { prefill: false })
    queueMicrotask(() => off())
  })
}

/** The timing the shell watches with — a link opened later in the tab is
 *  watched for again with it. */
let watching: PendingMeetTiming | null = null
let watchRun = 0

export const watchPendingMeet = (timing: PendingMeetTiming = {}): void => {
  watching = timing
  const run = ++watchRun
  const pollMs = timing.pollMs ?? 250
  const graceMs = timing.graceMs ?? 5_000
  const maxWaitMs = timing.maxWaitMs ?? 30_000
  const started = Date.now()
  let workerSeenAt = 0

  const tick = (): void => {
    if (run !== watchRun) return
    const stashed = held()
    const link = stashed || meetCopy
    if (!link) return
    let worker: { meetLinks?: unknown } | undefined
    try { worker = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(MEETING_INVITE_WORKER_KEY) as { meetLinks?: unknown } | undefined } catch { worker = undefined }
    if (worker && Number(worker.meetLinks) >= 2) return
    if (!stashed) {
      // Drained by an older worker: a link it reads, it is answering; one it
      // refuses needs the newer package. (No worker and no stash: storage is
      // refused here, and restoreMeetLink keeps the link.)
      if (worker && olderRefuses(link)) offerUpdate(link)
      return
    }
    const now = Date.now()
    if (worker && !workerSeenAt) workerSeenAt = now
    const due = worker ? now - workerSeenAt >= graceMs : now - started >= maxWaitMs
    if (!due) { setTimeout(tick, pollMs); return }
    if (worker && olderRefuses(link)) offerUpdate(link)
    else answer(link)
  }
  tick()
}
