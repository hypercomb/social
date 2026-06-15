// Throwaway probe: connect to the loopback relay, subscribe to all swarm
// kinds, and report which pubkeys are publishing (and at which #x sigs)
// over a 45s window. Distinguishes "browser isn't publishing" from
// "browser publishes but the other side doesn't receive."
const WebSocket = require('ws')

const RELAY = process.argv[2] || 'ws://localhost:7777'
const WINDOW_MS = 45_000
const seen = new Map() // pubkey -> Map(kindSig -> {count, lastVisuals})

const ws = new WebSocket(RELAY)
ws.on('open', () => {
  const since = Math.floor(Date.now() / 1000) - 300
  ws.send(JSON.stringify(['REQ', 'probe', { kinds: [30200, 30201, 30202, 30203, 30204, 30205], since }]))
  console.log(`[probe] listening on ${RELAY} for 45s (replay since -300s + live)...`)
})
ws.on('message', (raw) => {
  let msg; try { msg = JSON.parse(raw.toString()) } catch { return }
  if (msg[0] !== 'EVENT') return
  const evt = msg[2]
  const pk = String(evt.pubkey || '').slice(0, 8)
  const x = (evt.tags || []).find((t) => t[0] === 'x')?.[1]?.slice(0, 8) ?? '(none)'
  const key = `kind=${evt.kind} x=${x}`
  let bag = seen.get(pk)
  if (!bag) { bag = new Map(); seen.set(pk, bag) }
  const entry = bag.get(key) ?? { count: 0, detail: '' }
  entry.count++
  if (evt.kind === 30200) {
    try {
      const c = JSON.parse(evt.content)
      entry.detail = `label=${c.label ?? ''} visuals=[${(c.visuals ?? []).map((v) => v.name).join(',')}]`
    } catch { entry.detail = '(unparseable)' }
  }
  bag.set(key, entry)
})
ws.on('error', (e) => { console.log('[probe] ws error:', String(e)); process.exit(2) })

setTimeout(() => {
  console.log(`[probe] --- ${seen.size} distinct pubkey(s) ---`)
  for (const [pk, bag] of seen) {
    console.log(`pubkey ${pk}:`)
    for (const [key, e] of bag) console.log(`  ${key} ×${e.count} ${e.detail}`)
  }
  process.exit(0)
}, WINDOW_MS)
