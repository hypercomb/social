const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')
const BRIDGE = 'ws://localhost:2401'
let counter = 0
const send = (req) => new Promise((resolve, reject) => {
  const id = `asset-${Date.now()}-${++counter}`
  const ws = new WebSocket(BRIDGE)
  const t = setTimeout(() => { ws.close(); reject(new Error('timeout')) }, 20000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', raw => { clearTimeout(t); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) } ws.close() })
  ws.on('error', e => { clearTimeout(t); reject(e) })
})
const d = require('./_humanity-centres.json')
const map = {}
function imgSig(node) {
  const p = (node.properties || [])[0]
  return p?.small?.image?.$sig || p?.flat?.small?.image?.$sig || null
}
function walk(node, segs) {
  const here = node.name === undefined ? segs : [...segs, node.name]
  const sig = imgSig(node)
  if (sig) map[here.join('/') || '(root)'] = sig
  for (const k of (node.children || [])) walk(k, here)
}
walk(d, [])
;(async () => {
  const dir = path.join(__dirname, '_humanity_assets')
  fs.mkdirSync(dir, { recursive: true })
  const seen = new Set()
  const manifest = {}
  for (const [p, sig] of Object.entries(map)) {
    manifest[p] = sig
    if (seen.has(sig)) continue
    seen.add(sig)
    const r = await send({ op: 'get-resource', sig, text: 'base64' })
    if (!r.ok) { console.log(`  ${p}  ${sig.slice(0,10)}  GET FAILED: ${r.error}`); continue }
    const b64 = r.data.base64 || r.data.text
    const buf = Buffer.from(b64, 'base64')
    fs.writeFileSync(path.join(dir, `${sig.slice(0,16)}.webp`), buf)
    console.log(`  ${p}  ->  ${sig.slice(0,16)}.webp  (${buf.length} bytes)`)
  }
  fs.writeFileSync(path.join(dir, '_manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`\nSaved ${seen.size} unique images for ${Object.keys(map).length} cells.`)
})().catch(e => { console.error('FATAL', e.message); process.exit(2) })
