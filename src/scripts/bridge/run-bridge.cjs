// Self-contained Hypercomb claude bridge server.
// Mirrors hypercomb-cli/src/bridge/server.ts so we don't need to build the CLI.
//
// ── TRUST MODEL ─────────────────────────────────────────────────────────
// The broker relays ops that CREATE TILES, WRITE RESOURCES AND COMMIT LAYERS
// on a live hive. It used to accept anything that could reach the port, which
// meant anyone on the network could drive the hive — or claim the renderer
// slot and displace the real tab. Two gates now, matched to the actual threat
// (someone else on your LAN), not to ceremony:
//
//   1. RENDERER REGISTRATION IS LOOPBACK-ONLY, always. A hive tab always dials
//      a broker on its own machine (the bee hardcodes ws://localhost), so a
//      renderer arriving from anywhere else is either a mistake or a hijack.
//
//   2. OP SENDERS: loopback is trusted (already on the machine = already has
//      the browser). Non-loopback senders must present a shared token:
//        Authorization: Bearer <HYPERCOMB_BRIDGE_TOKEN>
//      With NO token configured, non-loopback senders are refused outright —
//      so the safe default holds even when the socket is bound wide.
//
// Env:
//   BRIDGE_PORT             listen port (default 2401)
//   BRIDGE_HOST             bind address (default 127.0.0.1 — loopback).
//                           Set 0.0.0.0 to allow remote answering sessions.
//   HYPERCOMB_BRIDGE_TOKEN  shared secret required of non-loopback senders.
//
// Local workflows are unaffected: without a token, on the default bind, this
// behaves exactly as before.

const { WebSocketServer, WebSocket } = require('ws')
const { createServer } = require('node:http')
const { watchFile } = require('node:fs')
const { OWED_FILE, readOwed, settleOwed, followedPubkey, servedByRelay } = require('./owed-stamps.cjs')

const BRIDGE_PORT = Number(process.env.BRIDGE_PORT || 2401)
const BRIDGE_HOST = process.env.BRIDGE_HOST || '127.0.0.1'
const TOKEN = String(process.env.HYPERCOMB_BRIDGE_TOKEN || '').trim()

// Browsers cannot test whether a TCP/WebSocket port is open without creating
// a WebSocket, and Chromium logs every refused WebSocket in the console. This
// small CORS-enabled probe lets an opted-in renderer wait quietly until the
// broker actually exists.
const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, {
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      'content-type': 'application/json',
    })
    res.end('{"ok":true}')
    return
  }
  res.writeHead(404)
  res.end()
})
const wss = new WebSocketServer({ server })
server.listen(BRIDGE_PORT, BRIDGE_HOST)

let renderer = null
const pending = new Map()
let paying = false

// A debt recorded while a hive is already attached is paid without waiting for it to reconnect.
watchFile(OWED_FILE, { interval: Number(process.env.BRIDGE_OWED_POLL_MS || 3000) }, () => {
  if (renderer && renderer.readyState === WebSocket.OPEN) void payOwedStamps()
})

const LOOPBACK_RE = /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/

function isLoopback(req) {
  return LOOPBACK_RE.test(String(req?.socket?.remoteAddress || ''))
}

function presentedToken(req) {
  const header = String(req?.headers?.['authorization'] || '')
  const m = /^Bearer\s+(.+)$/i.exec(header)
  return m ? m[1].trim() : ''
}

function askRenderer(op, waitMs = 45_000) {
  return new Promise((resolve) => {
    const id = `owed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: 'renderer did not answer' }) }, waitMs)
    pending.set(id, {
      readyState: WebSocket.OPEN,
      send: (json) => {
        clearTimeout(timer)
        try { resolve(JSON.parse(json)) } catch { resolve({ ok: false, error: 'unreadable answer' }) }
      },
    })
    if (renderer && renderer.readyState === WebSocket.OPEN) {
      renderer.send(JSON.stringify({ ...op, id }))
    } else {
      clearTimeout(timer)
      pending.delete(id)
      resolve({ ok: false, error: 'no renderer connected' })
    }
  })
}

// A build that found no signer left its install stamp owed; the hive that just attached holds the key.
async function payOwedStamps() {
  if (paying) return
  paying = true
  try {
    const followed = followedPubkey()
    for (const [channel, debt] of Object.entries(readOwed())) {
      const label = `install:${channel} → ${debt.sig.slice(0, 12)}…`
      if (!followed) { console.warn(`[bridge] owed stamp ${label} left owed — no followed publisher recorded`); continue }
      if (!servedByRelay(debt.sig)) { console.warn(`[bridge] owed stamp ${label} left owed — the local relay does not serve it`); continue }
      // A hive answers the bridge before its store is open, and a big hive
      // takes a while to open — so a silent renderer is asked again while it
      // is still the same connection, not given up on at the first timeout.
      const asked = renderer
      let res = null
      for (let attempt = 0; attempt < 6 && renderer === asked; attempt++) {
        res = await askRenderer({ op: 'hive-root-set', key: `install:${channel}`, sig: debt.sig, ...(debt.host ? { host: debt.host } : {}) })
        if (res?.ok || res?.error !== 'renderer did not answer') break
      }
      if (!res?.ok) { console.warn(`[bridge] owed stamp ${label} still owed: ${res?.error || 'failed'}`); continue }
      const signer = String(res.data?.pubkey || '').toLowerCase()
      if (signer !== followed) { console.warn(`[bridge] owed stamp ${label} left owed — signed by ${signer.slice(0, 12)}…, not the followed publisher`); continue }
      settleOwed(channel, debt.sig)
      console.log(`[bridge] owed stamp paid: ${label} (pubkey ${signer.slice(0, 12)}…)`)
    }
  } finally {
    paying = false
  }
}

wss.on('connection', (ws, req) => {
  let identified = false
  const local = isLoopback(req)
  // Loopback is trusted outright; remote needs the shared token, and if none
  // is configured remote can never be trusted.
  const trusted = local || (TOKEN !== '' && presentedToken(req) === TOKEN)

  ws.on('message', (raw) => {
    let msg
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
      void payOwedStamps()
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

// Said once the socket is bound — a client that trusts this line must be able to connect.
server.on('listening', () => {
  console.log(`[bridge] listening on ws://${BRIDGE_HOST}:${BRIDGE_PORT}`)
  console.log(
    BRIDGE_HOST === '127.0.0.1'
      ? '[bridge] loopback-only bind — set BRIDGE_HOST=0.0.0.0 for remote answering sessions'
      : TOKEN
        ? '[bridge] bound wide; remote senders must present HYPERCOMB_BRIDGE_TOKEN'
        : '[bridge] bound wide with NO token — remote senders will be REFUSED (set HYPERCOMB_BRIDGE_TOKEN to allow them)',
  )
})
