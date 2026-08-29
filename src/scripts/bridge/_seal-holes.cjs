// Replicate host-sync's closure walk from the sealed root over the bridge.
// A sig is a HOLE when the page's store lacks it (get-resource fails) — those
// are the ones the drain can never push and the availability gate trips on.
const WebSocket = require('ws')
const ws = new WebSocket('ws://localhost:2401')
let n = 0; const pend = new Map()
const send = req => new Promise(res => {
  const id = `s-${++n}`; pend.set(id, res)
  ws.send(JSON.stringify({ ...req, id }))
  setTimeout(() => { if (pend.has(id)) { pend.delete(id); res({ ok: false, error: 'timeout' }) } }, 30000)
})
ws.on('message', raw => { try { const m = JSON.parse(String(raw)); const f = pend.get(m.id); if (f) { pend.delete(m.id); f(m) } } catch {} })
const SIGRE = /^[0-9a-f]{64}$/
const HEX = /\b[0-9a-f]{64}\b/g
const CHILD = new Set(['cells', 'layers', 'children'])
ws.on('open', async () => {
  const root = process.argv[2]
  const visited = new Set()
  const holes = []   // {sig, via, slot}
  let reads = 0
  async function walk(sig, kind, via) {
    if (visited.has(sig)) return
    visited.add(sig)
    const g = await send({ op: 'get-resource', sig })
    reads++
    if (!g.ok) { holes.push({ sig, via, kind }); return }
    const text = g.data && g.data.text
    if (typeof text !== 'string') return
    let obj = null
    try { obj = JSON.parse(text) } catch { /* binary/plain: scan hex anyway */ }
    if (kind === 'layer' && obj && typeof obj === 'object') {
      for (const [slot, value] of Object.entries(obj)) {
        if (!Array.isArray(value)) continue
        const refKind = CHILD.has(slot) ? 'layer' : (slot === 'bees' || slot === 'dependencies') ? 'leaf' : 'resource'
        for (const raw of value) {
          const ref = String(raw ?? '').trim().toLowerCase()
          if (!SIGRE.test(ref) || ref === sig) continue
          if (refKind === 'leaf') continue
          await walk(ref, refKind, `${via}>${slot}`)
        }
      }
    } else if (kind === 'resource') {
      // nestedResourceSigs approximation: every 64-hex in the record text
      const refs = new Set(text.match(HEX) || [])
      for (const ref of refs) {
        if (ref === sig) continue
        await walk(ref, 'resource', `${via}>res`)
      }
    }
    if (reads % 200 === 0) console.error(`...${reads} reads, ${holes.length} holes, ${visited.size} visited`)
  }
  await walk(root, 'layer', 'root')
  console.log(JSON.stringify({ visited: visited.size, holes }, null, 1))
  process.exit(0)
})
