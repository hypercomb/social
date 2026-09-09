// hypercomb-shared/core/invite-capture.ts
//
// Boot-time capture for `/<sig>` meeting-place invite links.
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

const PENDING_INVITE_KEY = 'hc:pending-invite' // mirror of essentials meeting-invite.ts
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

    // Strip the signature so the URL is a clean root; preserve any query/hash.
    const clean = '/' + (window.location.search ?? '') + (window.location.hash ?? '')
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
