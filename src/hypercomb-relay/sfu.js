// hypercomb-relay/sfu.js — Selective Forwarding Unit module
//
// Plugs into the existing relay to forward WebRTC media streams.
// Each participant uploads ONE stream to the SFU; the SFU forwards
// appropriate simulcast layers to all other participants in the room.
//
// Activated with --sfu flag on relay.js.
//
// Protocol:
//   Client sends Nostr event ['t', 'sfu-probe'] on a room sig.
//   If SFU is enabled, relay injects ['t', 'sfu-ready'] response.
//   Client then uses HTTP WHIP endpoints for WebRTC negotiation:
//     POST /sfu/:roomSig/publish   — offer/answer to send stream to SFU
//     POST /sfu/:roomSig/subscribe — offer/answer to receive streams from SFU
//     DELETE /sfu/:roomSig/:peerId — leave
//
// Requires: wrtc (or werift) npm package for server-side WebRTC.
// This module exports a setup function that attaches routes to the HTTP server.

/**
 * @param {import('node:http').Server} httpServer
 * @param {object} opts
 * @param {Function} opts.broadcast - relay broadcast function
 */
export function setupSfu(httpServer, opts = {}) {
  /** @type {Map<string, SfuRoom>} roomSig → room */
  const rooms = new Map()

  let wrtc
  try {
    wrtc = await import('werift')
  } catch {
    try {
      wrtc = await import('wrtc')
    } catch {
      console.warn('[SFU] No WebRTC module found (install werift or wrtc). SFU disabled.')
      return { enabled: false, handleProbe: () => false }
    }
  }

  /**
   * Handle sfu-probe Nostr events.
   * Called by the relay's message handler when it sees ['t', 'sfu-probe'].
   * @param {string} roomSig
   * @param {Function} sendToClient - (msg) => void
   * @returns {boolean} true if handled
   */
  function handleProbe(roomSig, sendToClient) {
    if (!wrtc) return false
    sendToClient(['EVENT', '__sfu__', {
      created_at: Math.floor(Date.now() / 1000),
      kind: 29011,
      tags: [['x', roomSig], ['t', 'sfu-ready']],
      content: JSON.stringify({ maxParticipants: 7 }),
    }])
    return true
  }

  /**
   * Attach HTTP routes to the server's request handler.
   * Must be called before the server starts listening, or the relay's
   * existing request handler should delegate /sfu/* paths here.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @returns {boolean} true if this request was handled by SFU
   */
  function handleHttp(req, res) {
    if (!wrtc) return false

    const url = new URL(req.url, `http://${req.headers.host}`)
    const match = url.pathname.match(/^\/sfu\/([a-f0-9]{64})\/(publish|subscribe|leave)$/)
    if (!match) return false

    const [, roomSig, action] = match

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return true
    }

    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end('Method not allowed')
      return true
    }

    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body)

        if (action === 'publish') {
          const result = await handlePublish(roomSig, payload)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } else if (action === 'subscribe') {
          const result = await handleSubscribe(roomSig, payload)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } else if (action === 'leave') {
          handleLeave(roomSig, payload)
          res.writeHead(200)
          res.end('ok')
        }
      } catch (err) {
        res.writeHead(500)
        res.end(String(err))
      }
    })

    return true
  }

  // ── room management ──────────────────────────────────────

  function getOrCreateRoom(roomSig) {
    let room = rooms.get(roomSig)
    if (!room) {
      room = { sig: roomSig, publishers: new Map(), subscribers: new Map() }
      rooms.set(roomSig, room)
    }
    return room
  }

  /**
   * Publisher sends their stream to the SFU.
   * WHIP-style: client sends SDP offer, SFU returns SDP answer.
   */
  async function handlePublish(roomSig, { peerId, sdp }) {
    // Stub: actual implementation requires wrtc PeerConnection creation
    // This is the framework — full implementation depends on which wrtc lib is available
    const room = getOrCreateRoom(roomSig)

    // placeholder for server-side RTCPeerConnection
    const entry = { peerId, pc: null, tracks: [] }
    room.publishers.set(peerId, entry)

    // TODO: create server RTCPeerConnection, set remote description (offer),
    // create answer, return it. When tracks arrive, forward to all subscribers.

    return {
      type: 'answer',
      sdp: null, // will be populated by actual wrtc implementation
      peerId,
      note: 'SFU publish endpoint — wrtc integration pending',
    }
  }

  /**
   * Subscriber receives forwarded streams from the SFU.
   */
  async function handleSubscribe(roomSig, { peerId, sdp }) {
    const room = getOrCreateRoom(roomSig)

    const entry = { peerId, pc: null }
    room.subscribers.set(peerId, entry)

    // TODO: create server RTCPeerConnection, add all current publisher tracks,
    // set remote description (offer), create answer, return it.

    return {
      type: 'answer',
      sdp: null,
      peerId,
      note: 'SFU subscribe endpoint — wrtc integration pending',
    }
  }

  function handleLeave(roomSig, { peerId }) {
    const room = rooms.get(roomSig)
    if (!room) return

    const pub = room.publishers.get(peerId)
    if (pub?.pc) pub.pc.close?.()
    room.publishers.delete(peerId)

    const sub = room.subscribers.get(peerId)
    if (sub?.pc) sub.pc.close?.()
    room.subscribers.delete(peerId)

    // cleanup empty rooms
    if (room.publishers.size === 0 && room.subscribers.size === 0) {
      rooms.delete(roomSig)
    }
  }

  // periodic cleanup of stale rooms (no activity for 10 min)
  setInterval(() => {
    for (const [sig, room] of rooms) {
      if (room.publishers.size === 0 && room.subscribers.size === 0) {
        rooms.delete(sig)
      }
    }
  }, 600_000)

  return { enabled: !!wrtc, handleProbe, handleHttp }
}
