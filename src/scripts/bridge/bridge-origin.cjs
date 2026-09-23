// bridge-origin.cjs — may this browser page talk to the broker?
//
// A LOOPBACK SOCKET PROVES NOTHING ABOUT THE PAGE. Any page the participant
// opens — a try- door running a publisher's code, or any site at all — dials
// ws://localhost:2401 from the participant's own browser, so its socket is
// loopback too. What the page cannot choose is the Origin its browser stamps
// on the handshake, so that is what the broker judges.
//
// ABSENT PASSES: Node clients (the CLI agents) send no Origin, and a browser
// always does. PRESENT PASSES only for a page served from this machine —
// exactly localhost, 127.0.0.1 or [::1], any port, http or https. A subdomain
// of localhost does not count: try-x.localhost is a door in the local harness.
// Anything unparsable ('null' from a sandboxed frame, garbage) is refused.
//
// Twin: hypercomb-cli/src/bridge/server.ts keeps the same lines.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function bridgeOriginAllowed(origin) {
  if (origin === undefined || origin === null) return true
  try {
    const url = new URL(String(origin))
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

module.exports = { bridgeOriginAllowed }
