// Read-only: census of tag (pheromone) names in use across a subtree.
// Usage: node scripts/bridge/_rev-tags.cjs [path] [maxDepth]
const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
let n = 0
function call(req, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const id = `tags-${Date.now()}-${++n}`
    const ws = new WebSocket(BRIDGE)
    const t = setTimeout(() => { ws.close(); reject(new Error('timeout ' + req.op)) }, timeout)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
    ws.on('message', (raw) => { clearTimeout(t); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) }; ws.close() })
    ws.on('error', (e) => { clearTimeout(t); reject(e) })
  })
}
const cache = new Map()
async function rjson(sig) {
  if (cache.has(sig)) return cache.get(sig)
  const r = await call({ op: 'get-resource', sig })
  let v = null
  if (r.ok && r.data && r.data.encoding === 'text') { try { v = JSON.parse(r.data.text) } catch {} }
  cache.set(sig, v); return v
}
const tally = new Map()
async function walk(segments, depth, maxDepth) {
  const r = await call({ op: 'layer-at', segments })
  if (!r.ok) return
  const layer = r.data
  for (const sig of (layer.decorations || []).map(String)) {
    const j = await rjson(sig)
    if (j && j.kind === 'tag') {
      const name = j.payload?.name ?? j.name
      if (name) {
        const key = String(name)
        if (!tally.has(key)) tally.set(key, [])
        tally.get(key).push('/' + segments.join('/'))
      }
    }
  }
  if (depth >= maxDepth) return
  for (const sig of (layer.children || []).map(String)) {
    const j = await rjson(sig)
    if (j && j.name) await walk([...segments, j.name], depth + 1, maxDepth)
  }
}
;(async () => {
  const path = (process.argv[2] || 'revolucion').split(/[\\/]/).filter(Boolean)
  const maxDepth = Number(process.argv[3] || 3)
  await walk(path, 0, maxDepth)
  const rows = [...tally.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [name, where] of rows) {
    console.log(`${String(name).padEnd(28)} ${String(where.length).padStart(3)}  ${where.slice(0, 4).join(' ')}${where.length > 4 ? ' …' : ''}`)
  }
  console.log(`(${rows.length} distinct marks)`)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
