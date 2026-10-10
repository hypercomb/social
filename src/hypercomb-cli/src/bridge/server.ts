import { WebSocketServer, WebSocket } from 'ws'
import { createServer, type IncomingMessage } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { BRIDGE_PORT } from '@hypercomb/sdk'

// ── TRUST MODEL ─────────────────────────────────────────────────────────
// The broker relays ops that CREATE TILES, WRITE RESOURCES AND COMMIT LAYERS
// on a live hive. It used to accept anything that could reach the port, which
// meant anyone on the network could drive the hive — or claim the renderer
// slot and displace the real tab. The socket binds loopback unless BRIDGE_HOST
// says otherwise, and four gates stand behind it, matched to the actual
// threats (someone else on your LAN, or a page in your own browser), not to
// ceremony:
//
//   0. A BROWSER PAGE IS JUDGED BY ITS ORIGIN, not its socket. Any page you
//      open dials localhost from your own machine, so a loopback socket says
//      nothing about it; a handshake whose Origin is not a page served from
//      this machine is refused (bridgeOriginAllowed). No Origin = a Node client.
//
//   1. RENDERER REGISTRATION IS LOOPBACK-ONLY, always, AND ONLY FROM THE
//      HIVE'S OWN PAGES. A hive tab always dials a broker on its own machine
//      (the bee hardcodes ws://localhost), so a renderer arriving from
//      anywhere else is either a mistake or a hijack. The renderer sees every
//      op and writes every answer, so "any localhost page" is not enough: a
//      page registers only from an origin in BRIDGE_RENDERER_ORIGINS (default:
//      the hive's dev and web ports — rendererOrigins); a Node client with no
//      Origin (this machine's tools) may too. An OPEN renderer is never
//      displaced by a stranger: a second registration is refused while it
//      holds the slot, unless it is another tab of the same origin, carries
//      the same non-empty code list, or is this machine's tool. An answer is
//      taken only from the socket its op was forwarded to.
//
//   2. OP SENDERS: this machine's own tools — a loopback socket with NO
//      Origin (the scripts and Claude sessions on this machine) — are
//      trusted. Every page (any Origin, localhost included) and every remote
//      sender presents a bridge code, checked again on EACH op so a code
//      withdrawn in the hive stops working at once:
//        Node:  Authorization: Bearer <code>
//        page:  {"type":"code","code":"<code>"} before its ops
//      Codes are made in the hive (`bridge give <name>`); the broker holds only
//      their SHA-256 hashes (codeAdmitted). With no codes and no token,
//      everyone but this machine's tools is refused.
//
//   3. THE CODE LIST BELONGS TO THE RENDERER SOCKET. It arrives with the
//      renderer registration, is replaced whole by a `codes` message from that
//      same socket (from any other socket it is ignored), and is cleared when
//      that socket closes. No renderer, no codes — and no ops anyway.
//
// Env:
//   BRIDGE_HOST                    bind address (default 127.0.0.1 — loopback).
//                                  Set 0.0.0.0 to allow remote answering sessions.
//   BRIDGE_RENDERER_ORIGINS        the hive pages that may register as the
//                                  renderer (default: the hive's dev and web ports)
//   HYPERCOMB_BRIDGE_BROKER_TOKEN  optional FALLBACK: one more code, set on the
//                                  broker, admitted like any code the hive gave.
//   (HYPERCOMB_BRIDGE_TOKEN is the CLIENT's: the code this machine's scripts
//   present to someone else's broker. The broker never admits it — a code you
//   hold for another hive must not open yours.)
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
// hypercomb-dev (start, start:4251/4253/4254/4450) and hypercomb-web (4200, start:4260, 4264).
export const HIVE_PORTS = [4200, 4250, 4251, 4253, 4254, 4260, 4264, 4450]

export function bridgeOriginAllowed(origin: string | null | undefined): boolean {
  if (origin === undefined || origin === null) return true
  try {
    const url = new URL(String(origin))
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

// Only the hive's own pages may register as the renderer: the origins in
// BRIDGE_RENDERER_ORIGINS (comma- or space-separated), or by default the
// hive's dev and web ports on localhost, 127.0.0.1 or [::1]. No Origin (a Node
// client on this machine) may too. Twin: scripts/bridge/bridge-origin.cjs.
export function rendererOrigins(env: string | null | undefined): Set<string> {
  const listed = String(env ?? '').split(/[\s,]+/).filter(Boolean)
  const wanted = listed.length
    ? listed
    : HIVE_PORTS.flatMap(port => [...LOOPBACK_HOSTS].flatMap(host => [`http://${host}:${port}`, `https://${host}:${port}`]))
  const origins = new Set<string>()
  for (const entry of wanted) {
    try {
      const { origin } = new URL(entry)
      if (origin !== 'null') origins.add(origin)
    } catch { /* not an origin — never matches */ }
  }
  return origins
}

export function rendererOriginAllowed(origin: string | null | undefined, origins: Set<string>): boolean {
  if (origin === undefined || origin === null) return true
  try {
    return origins.has(new URL(String(origin)).origin)
  } catch {
    return false
  }
}

// The broker never sees a code it did not receive: the hive hands it only the
// SHA-256 hashes of its codes. THE SHARED RULE (byte for byte with the hive's
// BridgeCodeStore): a code is String(x).trim(), no case folding, 1–256
// PRINTABLE ASCII characters (0x21–0x7E — no spaces, because a Node client
// presents it in the Authorization header); its hash is lowercase hex SHA-256
// of its UTF-8 bytes. Anything else is not a code and hashes to ''.
// Twin: scripts/bridge/bridge-codes.cjs.
const HASH_RE = /^[0-9a-f]{64}$/
const CODE_RE = /^[\x21-\x7e]{1,256}$/
const MAX_HASHES = 256

export function hashCode(code: unknown): string {
  const text = String(code ?? '').trim()
  if (!CODE_RE.test(text)) return ''
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function parseCodeHashes(list: unknown): Set<string> {
  const hashes = new Set<string>()
  if (!Array.isArray(list)) return hashes
  for (const entry of list) {
    if (hashes.size >= MAX_HASHES) break
    if (typeof entry === 'string' && HASH_RE.test(entry)) hashes.add(entry)
  }
  return hashes
}

// Constant time against every entry and the token hash, OR-ed, no early exit.
export function codeAdmitted(presentedHash: string, hashes: Iterable<string> | null | undefined, tokenHash: string): boolean {
  if (typeof presentedHash !== 'string' || !HASH_RE.test(presentedHash)) return false
  const presented = Buffer.from(presentedHash, 'hex')
  let admitted = false
  for (const candidate of [...(hashes ?? []), tokenHash]) {
    if (typeof candidate !== 'string' || !HASH_RE.test(candidate)) continue
    admitted = timingSafeEqual(presented, Buffer.from(candidate, 'hex')) || admitted
  }
  return admitted
}

const UNAUTHORIZED = 'unauthorized — this bridge serves its own machine; anyone else needs a bridge code from the hive (bridge give <name>), sent as Authorization: Bearer <code>, or from a page as {"type":"code","code":"<code>"} first'

function presentedToken(req: IncomingMessage): string {
  const header = String(req?.headers?.['authorization'] || '')
  const m = /^Bearer\s+(.+)$/i.exec(header)
  return m ? m[1].trim() : ''
}

// The same list, held by a newcomer that never saw it — only the hive's own tabs can carry it.
function sameCodeList(offered: Set<string>, held: Set<string>): boolean {
  if (offered.size === 0 || offered.size !== held.size) return false
  for (const hash of offered) if (!held.has(hash)) return false
  return true
}

export function runBridge(): void {
  const BRIDGE_HOST = process.env.BRIDGE_HOST || '127.0.0.1'
  const TOKEN = String(process.env.HYPERCOMB_BRIDGE_BROKER_TOKEN || '').trim()
  const TOKEN_HASH = TOKEN ? hashCode(TOKEN) : ''
  const CLIENT_TOKEN_SET = String(process.env.HYPERCOMB_BRIDGE_TOKEN || '').trim() !== ''
  const RENDERER_ORIGINS = rendererOrigins(process.env.BRIDGE_RENDERER_ORIGINS)

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
  // The renderer's page origin ('' for a Node renderer) — a later tab of the same origin is the same hive.
  let rendererOrigin = ''
  // Hashes of the codes the renderer gave — never a code, never logged.
  let codeHashes = new Set<string>()
  // op id → who asked, and the renderer socket the op went to — the only socket whose answer counts.
  const pending = new Map<string, { client: WebSocket; via: WebSocket }>()
  // Second-renderer refusals already logged since the slot last changed hands (a refused tab retries every few seconds).
  const refusalsNoted = new Set<string>()

  wss.on('connection', (ws, req) => {
    let identified = false
    const local = isLoopback(req)
    // A browser always stamps an Origin; this machine's own tools send none.
    const page = req.headers.origin !== undefined
    const me = local && !page
    // The code this sender presented, hashed once — '' when it presented none.
    const bearer = presentedToken(req)
    let presented = bearer ? hashCode(bearer) : ''

    ws.on('message', (raw) => {
      let msg: any
      try {
        msg = JSON.parse(String(raw))
      } catch {
        return
      }
      // `null`, a number, a string: valid JSON, not a message — and `null.type` would end the process.
      if (!msg || typeof msg !== 'object') return

      // renderer identifies itself on connect — LOOPBACK ONLY, from the hive's
      // own pages — and brings the hashes of the hive's bridge codes with it.
      if (msg.type === 'renderer') {
        if (!local) {
          console.warn(`[bridge] refused remote renderer registration from ${req.socket.remoteAddress}`)
          try { ws.close() } catch {}
          return
        }
        const origin = page ? String(req.headers.origin) : ''
        if (!rendererOriginAllowed(page ? origin : undefined, RENDERER_ORIGINS)) {
          console.warn(`[bridge] refused a renderer from page ${origin} — not a hive page (BRIDGE_RENDERER_ORIGINS)`)
          try { ws.close(4403, 'not a hive page') } catch {}
          return
        }
        const offered = parseCodeHashes(msg.codes)
        const held = !!renderer && renderer !== ws && renderer.readyState === WebSocket.OPEN
        if (held && !me && origin !== rendererOrigin && !sameCodeList(offered, codeHashes)) {
          if (!refusalsNoted.has(origin)) {
            refusalsNoted.add(origin)
            console.warn(`[bridge] refused a second renderer from page ${origin} — ${rendererOrigin ? `the hive at ${rendererOrigin}` : "this machine's tool"} holds the slot until it closes`)
          }
          try { ws.close(4409, 'renderer slot held') } catch {}
          return
        }
        if (held) console.log(`[bridge] renderer slot passed to ${origin || "this machine's tool"}`)
        renderer = ws
        rendererOrigin = origin
        refusalsNoted.clear()
        identified = true
        codeHashes = offered
        console.log(`[bridge] renderer connected (${codeHashes.size} codes)`)
        return
      }

      // the hive's code list changed — only the renderer may say so, whole
      if (msg.type === 'codes') {
        if (ws !== renderer) {
          console.warn(`[bridge] ignored a code list from a socket that is not the renderer (${req.socket.remoteAddress})`)
          return
        }
        codeHashes = parseCodeHashes(msg.codes)
        console.log(`[bridge] code list now ${codeHashes.size} codes`)
        return
      }

      // a page presents its code before its ops; a resend replaces it, no reply
      if (msg.type === 'code') {
        if (identified) return
        presented = typeof msg.code === 'string' ? hashCode(msg.code) : ''
        return
      }

      // CLI request — forward to renderer, track by id
      if (msg.id && !identified) {
        // Asked on EVERY op, so a code withdrawn in the hive stops working at once.
        if (!(me || codeAdmitted(presented, codeHashes, TOKEN_HASH))) {
          console.warn(`[bridge] refused unauthorized op from ${req.socket.remoteAddress}${page ? ` (page ${req.headers.origin})` : ''}`)
          ws.send(JSON.stringify({ id: msg.id, ok: false, error: UNAUTHORIZED }))
          try { ws.close() } catch {}
          return
        }
        if (renderer && renderer.readyState === WebSocket.OPEN) {
          pending.set(msg.id, { client: ws, via: renderer })
          renderer.send(JSON.stringify(msg))
        } else {
          ws.send(JSON.stringify({ id: msg.id, ok: false, error: 'no renderer connected' }))
        }
        return
      }

      // response from a renderer — routed back to the client only when it
      // comes from the socket the op was forwarded to; a displaced renderer
      // that kept its socket cannot answer anyone else's op.
      if (msg.id && identified) {
        const entry = pending.get(msg.id)
        if (!entry) return
        if (entry.via !== ws) {
          console.warn('[bridge] ignored an answer from a renderer socket the op was not sent to')
          return
        }
        pending.delete(msg.id)
        if (entry.client.readyState === WebSocket.OPEN) entry.client.send(JSON.stringify(msg))
        return
      }
    })

    ws.on('close', () => {
      if (ws === renderer) {
        renderer = null
        rendererOrigin = ''
        refusalsNoted.clear()
        codeHashes = new Set()
        console.log('[bridge] renderer disconnected')
      }
    })
  })

  console.log(`[bridge] listening on ws://${BRIDGE_HOST}:${BRIDGE_PORT}`)
  console.log(
    BRIDGE_HOST === '127.0.0.1'
      ? '[bridge] loopback-only bind — set BRIDGE_HOST=0.0.0.0 for remote answering sessions'
      : '[bridge] bound wide — remote senders need a bridge code',
  )
  console.log(
    `[bridge] this machine's tools connect freely; pages and remote senders need a bridge code from the hive (bridge give <name>)${
      TOKEN_HASH ? ' — HYPERCOMB_BRIDGE_BROKER_TOKEN is set as a fallback code'
        : TOKEN ? ' — HYPERCOMB_BRIDGE_BROKER_TOKEN is not a code (1–256 printable ASCII characters, no spaces), so it admits no one'
        : ' — HYPERCOMB_BRIDGE_BROKER_TOKEN is an optional fallback'
    }`,
  )
  if (CLIENT_TOKEN_SET) {
    console.log("[bridge] HYPERCOMB_BRIDGE_TOKEN is set here — that is the code this machine's scripts present to a broker; this broker does not admit it (HYPERCOMB_BRIDGE_BROKER_TOKEN is the broker's fallback)")
  }
  console.log(`[bridge] the renderer registers only from this machine's tools or a hive page: ${
    process.env.BRIDGE_RENDERER_ORIGINS ? [...RENDERER_ORIGINS].join(', ') || 'none' : `localhost ports ${HIVE_PORTS.join(', ')}`
  } (BRIDGE_RENDERER_ORIGINS)`)
}
