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
// THE RENDERER SLOT IS NARROWER STILL. Any localhost page may open a socket,
// but only the hive's own pages may register as the renderer — the socket
// every op is forwarded to and every answer comes from. Those are the origins
// in BRIDGE_RENDERER_ORIGINS (comma- or space-separated), or by default the
// ports the hive's dev and web shells serve on, on localhost, 127.0.0.1 or
// [::1]. No Origin (a Node client on this machine) may register too.
//
// Twin: hypercomb-cli/src/bridge/server.ts keeps the same lines.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
// hypercomb-dev (start, start:4251/4253/4254/4450) and hypercomb-web (4200, start:4260, 4264).
const HIVE_PORTS = [4200, 4250, 4251, 4253, 4254, 4260, 4264, 4450]

function bridgeOriginAllowed(origin) {
  if (origin === undefined || origin === null) return true
  try {
    const url = new URL(String(origin))
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

// The origins a page may register the renderer from, normalized.
function rendererOrigins(env) {
  const listed = String(env ?? '').split(/[\s,]+/).filter(Boolean)
  const wanted = listed.length
    ? listed
    : HIVE_PORTS.flatMap(port => [...LOOPBACK_HOSTS].flatMap(host => [`http://${host}:${port}`, `https://${host}:${port}`]))
  const origins = new Set()
  for (const entry of wanted) {
    try {
      const { origin } = new URL(entry)
      if (origin !== 'null') origins.add(origin)
    } catch { /* not an origin — never matches */ }
  }
  return origins
}

function rendererOriginAllowed(origin, origins) {
  if (origin === undefined || origin === null) return true
  try {
    return origins.has(new URL(String(origin)).origin)
  } catch {
    return false
  }
}

module.exports = { bridgeOriginAllowed, rendererOrigins, rendererOriginAllowed, HIVE_PORTS }
