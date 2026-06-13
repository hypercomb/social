// verify-sync-affordance-peer.cjs
//
// Synthetic second peer for the tile `sync` affordance verification.
// Publishes ONE kind-30200 swarm layer event at the composed sig passed
// as argv[2], carrying a visual whose name matches a tile the dev-shell
// page already holds locally (argv[3]) plus a synthetic layerSig
// (argv[4]). The dev shell at the same composed sig should cache it as
// a peer visual, which is exactly what the sync icon's visibleWhen
// consults.
//
// Usage: node verify-sync-affordance-peer.cjs <composedSig> <tileName> <layerSig>

const WebSocket = require('ws')
const { finalizeEvent, generateSecretKey } = require('nostr-tools')

const [, , SIG, NAME, LAYER_SIG] = process.argv
if (!/^[a-f0-9]{64}$/.test(SIG ?? '') || !NAME || !/^[a-f0-9]{64}$/.test(LAYER_SIG ?? '')) {
  console.error('usage: node verify-sync-affordance-peer.cjs <composedSig> <tileName> <layerSig>')
  process.exit(1)
}

const sk = generateSecretKey()
const expiration = Math.floor(Date.now() / 1000) + 120

const event = finalizeEvent({
  kind: 30200,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ['x', SIG],
    ['d', SIG],
    ['expiration', String(expiration)],
  ],
  content: JSON.stringify({
    label: 'SyncVerifyPeer',
    visuals: [{ name: NAME, layerSig: LAYER_SIG }],
  }),
}, sk)

const ws = new WebSocket('ws://localhost:7777')
ws.on('open', () => {
  ws.send(JSON.stringify(['EVENT', event]))
  console.log(`published kind-30200 as ${event.pubkey.slice(0, 8)} at x=${SIG.slice(0, 12)} visuals=[{name:${NAME}, layerSig:${LAYER_SIG.slice(0, 12)}}]`)
  // Keep the socket open briefly so the relay registers us as present.
  setTimeout(() => { ws.close(); process.exit(0) }, 3000)
})
ws.on('message', (raw) => {
  try { const m = JSON.parse(raw.toString()); if (m[0] === 'OK') console.log('relay OK:', m[1]?.slice(0, 12), m[2]) } catch { }
})
ws.on('error', (err) => { console.error('ws error:', err.message); process.exit(1) })
