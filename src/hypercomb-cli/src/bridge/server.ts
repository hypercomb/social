import { WebSocketServer, WebSocket } from 'ws'
import { createServer, type IncomingMessage } from 'node:http'
import { BRIDGE_PORT } from '@hypercomb/sdk'

// ── TRUST MODEL ─────────────────────────────────────────────────────────
// The broker relays ops that CREATE TILES, WRITE RESOURCES AND COMMIT LAYERS
// on a live hive. Anything that can reach the port can drive the hive, so the
// port itself is the security boundary. Four gates, matched to the actual
// threats (someone else on your LAN, or a page in your own browser), not to
// ceremony:
//
//   0. A BROWSER PAGE IS JUDGED BY ITS ORIGIN, not its socket. Any page you
//      open dials localhost from your own machine, so a loopback socket says
//      nothing about it; a handshake whose Origin is not a page served from
//      this machine is refused. No Origin = a Node client.
//   1. LOOPBACK BIND BY DEFAULT. The socket is not on the network at all
//      unless BRIDGE_HOST is set deliberately.
//   2. RENDERER REGISTRATION IS LOOPBACK-ONLY, always. A hive tab always dials
//      a broker on its own machine (the bee hardcodes ws://localhost), so a
//      renderer arriving from anywhere else is either a mistake or a hijack.
//   3. OP SENDERS: loopback is trusted (already on the machine = already has
//      the browser). Non-loopback senders must present a shared token:
//        Authorization: Bearer <HYPERCOMB_BRIDGE_TOKEN>
//      With NO token configured, non-loopback senders are refused outright —
//      so the safe default holds even when the socket is bound wide.
//
// Env:
//   BRIDGE_HOST             bind address (default 127.0.0.1 — loopback).
//                           Set 0.0.0.0 to allow remote answering sessions.
//   HYPERCOMB_BRIDGE_TOKEN  shared secret required of non-loopback senders.
//
// Kept in step with scripts/bridge/run-bridge.cjs, which is the same broker in
// self-contained form.

const LOOPBACK_RE = /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/

function isLoopback(req: IncomingMessage): boolean {
  return LOOPBACK_RE.test(String(req?.socket?.remoteAddress || ''))
}

// A browser always stamps an Origin on the handshake; a Node client sends
// none. Present passes only for a page served from this machine — exactly
// localhost, 127.0.0.1 or [::1], any port, http or https (try-x.localhost is a
// door, not the hive). Twin: scripts/bridge/bridge-origin.cjs.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function bridgeOriginAllowed(origin: string | null | undefined): boolean {
  if (origin === undefined || origin === null) return true
  try {
    const url = new URL(String(origin))
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

function presentedToken(req: IncomingMessage): string {
  const header = String(req?.headers?.['authorization'] || '')
  const m = /^Bearer\s+(.+)$/i.exec(header)
  return m ? m[1].trim() : ''
}

export function runBridge(): void {
  const BRIDGE_HOST = process.env.BRIDGE_HOST || '127.0.0.1'
  const TOKEN = String(process.env.HYPERCOMB_BRIDGE_TOKEN || '').trim()

  // A browser logs a refused WebSocket before application code can handle it.
  // Expose a tiny CORS-enabled probe so the renderer only opens its socket
  // after this broker is actually listening. CORS is granted only to a page
  // the socket would admit — a door page must not even learn the broker runs.
  const server = createServer((req, res) => {
    if (req.url === '/healthz') {
      const origin = req.headers.origin
      res.writeHead(200, {
        ...(origin && bridgeOriginAllowed(origin) ? { 'access-control-allow-origin': origin } : {}),
        'cache-control': 'no-store',
        'content-type': 'application/json',
      })
      res.end('{"ok":true}')
      return
    }
    res.writeHead(404)
    res.end()
  })
  const wss = new WebSocketServer({
    server,
    verifyClient: (info, done) => {
      if (bridgeOriginAllowed(info.origin)) return done(true)
      console.warn(`[bridge] refused a browser handshake from origin ${info.origin}`)
      done(false, 403)
    },
  })
  server.listen(BRIDGE_PORT, BRIDGE_HOST)

  let renderer: WebSocket | null = null
  const pending = new Map<string, WebSocket>()
  
  wss.on('connection', (ws, req) => {
    let identified = false
    const local = isLoopback(req)
    // Loopback is trusted outright; remote needs the shared token, and if none
    // is configured remote can never be trusted.
    const trusted = local || (TOKEN !== '' && presentedToken(req) === TOKEN)

    ws.on('message', (raw) => {
      let msg: any
      try {
        msg = JSON.parse(String(raw))
      } catch {
        return
      }

      // renderer identifies itself on connect — LOOPBACK ONLY
      if (msg.type === 'renderer') {
        if (!local) {
          console.warn(`[bridge] refused remote renderer registration from ${req.socket.remoteAddress}`)
          try { ws.close() } catch {}
          return
        }
        renderer = ws
        identified = true
        console.log('[bridge] renderer connected')
        return
      }

      // CLI request — forward to renderer, track by id
      if (msg.id && !identified) {
        if (!trusted) {
          console.warn(`[bridge] refused unauthorized op from ${req.socket.remoteAddress}`)
          ws.send(JSON.stringify({
            id: msg.id,
            ok: false,
            error: TOKEN
              ? 'unauthorized — send Authorization: Bearer <token>'
              : 'unauthorized — remote senders require HYPERCOMB_BRIDGE_TOKEN on the broker',
          }))
          try { ws.close() } catch {}
          return
        }
        pending.set(msg.id, ws)
        if (renderer && renderer.readyState === WebSocket.OPEN) {
          renderer.send(JSON.stringify(msg))
        } else {
          ws.send(JSON.stringify({ id: msg.id, ok: false, error: 'no renderer connected' }))
          pending.delete(msg.id)
        }
        return
      }

      // response from renderer — route back to CLI client
      if (msg.id && identified) {
        const cli = pending.get(msg.id)
        if (cli && cli.readyState === WebSocket.OPEN) {
          cli.send(JSON.stringify(msg))
        }
        pending.delete(msg.id)
        return
      }
    })

    ws.on('close', () => {
      if (ws === renderer) {
        renderer = null
        console.log('[bridge] renderer disconnected')
      }
    })
  })

  console.log(`[bridge] listening on ws://${BRIDGE_HOST}:${BRIDGE_PORT}`)
  console.log(
    BRIDGE_HOST === '127.0.0.1'
      ? '[bridge] loopback-only bind — set BRIDGE_HOST=0.0.0.0 for remote answering sessions'
      : TOKEN
        ? '[bridge] bound wide; remote senders must present HYPERCOMB_BRIDGE_TOKEN'
        : '[bridge] bound wide with NO token — remote senders will be REFUSED (set HYPERCOMB_BRIDGE_TOKEN to allow them)',
  )
}
