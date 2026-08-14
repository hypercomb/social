// Read-only census of /revolucion — names, depth, notes count, decoration kinds.
// Usage: node scripts/bridge/_rev-census.cjs [depth] [path/with/slashes]
const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
let n = 0

function call(req, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const id = `census-${Date.now()}-${++n}`
    const ws = new WebSocket(BRIDGE)
    const t = setTimeout(() => { ws.close(); reject(new Error('timeout ' + req.op)) }, timeout)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
    ws.on('message', (raw) => { clearTimeout(t); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) }; ws.close() })
    ws.on('error', (e) => { clearTimeout(t); reject(e) })
  })
}

const cache = new Map()
async function resourceJson(sig) {
  if (cache.has(sig)) return cache.get(sig)
  const r = await call({ op: 'get-resource', sig })
  let v = null
  if (r.ok && r.data && r.data.encoding === 'text') { try { v = JSON.parse(r.data.text) } catch {} }
  cache.set(sig, v)
  return v
}

async function namesOf(layer) {
  const out = []
  for (const sig of (layer?.children || []).map(String)) {
    const j = await resourceJson(sig)
    if (j && j.name) out.push(j.name)
  }
  return out
}

async function layerAt(segments) {
  const r = await call({ op: 'layer-at', segments })
  return r.ok ? r.data : null
}

async function walk(segments, depth, maxDepth) {
  const layer = await layerAt(segments)
  if (!layer) return
  const kids = await namesOf(layer)
  const decos = []
  for (const sig of (layer.decorations || []).map(String)) {
    const j = await resourceJson(sig)
    if (j && j.kind) decos.push(j.kind)
  }
  const noteCount = (layer.notes || []).length
  const pad = '  '.repeat(depth)
  const bits = []
  if (noteCount) bits.push(`${noteCount}n`)
  if (decos.length) bits.push(decos.join(','))
  console.log(`${pad}${segments[segments.length - 1] || '/'}${bits.length ? '   [' + bits.join(' | ') + ']' : ''}`)
  if (depth >= maxDepth) { if (kids.length) console.log(`${pad}  … ${kids.length} children`); return }
  for (const k of kids) await walk([...segments, k], depth + 1, maxDepth)
}

;(async () => {
  const maxDepth = Number(process.argv[2] || 2)
  const path = (process.argv[3] || 'revolucion').split(/[\\/]/).filter(Boolean)
  await walk(path, 0, maxDepth)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
