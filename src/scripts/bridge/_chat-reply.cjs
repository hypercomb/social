// Deliver a reply INTO the ask screen's refinement conversation.
//
//   node scripts/bridge/_chat-reply.cjs <convoId> "<reply text>"
//
// Sends the `chat-reply` bridge op (cell = convoId, text = reply); the
// renderer surfaces it via the `ask:chat-reply` effect and the open
// conversation appends it. This is the CHAT half of the ask loop — replies
// here are refinement help, never notes. Retire the chat-turn ask separately
// (`_ask-drain.cjs retire <sig>`).
//
// BRIDGE_URL env overrides the broker (default ws://localhost:2401).

const WebSocket = require('ws')
const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
// Only needed when driving a REMOTE broker (loopback senders are trusted).
const TOKEN = String(process.env.HYPERCOMB_BRIDGE_TOKEN || '').trim()

const [convoId, text] = process.argv.slice(2)
if (!convoId || !text) {
  console.error('Usage: _chat-reply.cjs <convoId> "<reply text>"')
  process.exit(1)
}

const ws = new WebSocket(BRIDGE, TOKEN ? { headers: { Authorization: `Bearer ${TOKEN}` } } : undefined)
const t = setTimeout(() => { console.error('bridge timeout'); process.exit(1) }, 15_000)
ws.on('open', () => ws.send(JSON.stringify({ op: 'chat-reply', cell: convoId, text, id: `chatreply-${Date.now()}` })))
ws.on('message', raw => {
  clearTimeout(t)
  const r = JSON.parse(String(raw))
  if (!r.ok) { console.error('chat-reply failed:', r.error); process.exit(1) }
  console.log(`[chat-reply] delivered to ${convoId}`)
  ws.close()
})
ws.on('error', e => { clearTimeout(t); console.error(String(e)); process.exit(1) })
