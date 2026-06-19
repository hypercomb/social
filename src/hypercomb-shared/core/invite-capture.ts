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
// diamondcoreprocessor.com/sharing/meeting-invite.ts (PENDING_INVITE_KEY).
// Keep the two literals in sync.

const PENDING_INVITE_KEY = 'hc:pending-invite' // mirror of essentials meeting-invite.ts
const SIG_RE = /^[0-9a-f]{64}$/

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
