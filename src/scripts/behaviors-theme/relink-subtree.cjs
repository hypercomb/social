// Re-link a whole SUBTREE, deepest cell first.
//
// publish-content.ts re-links the branch and its ANCESTORS, which is enough
// when a build touched one page. A theme sweep stamps hundreds of cells all
// over the tree, and each parent keeps pointing at the generation it last saw
// — so the closure walk descends into stale children and reports "zero holes"
// over content that predates the sweep. (Measured 2026-08-04: a publish right
// after the sweep carried 98 of 458 point-top cards.)
//
// Same operation publish-content uses: `update` with the SAME child names in
// the SAME order. It moves pointers, never membership. Bottom-up, so a parent
// re-links only after its children have settled.
//
// Usage: node relink-subtree.cjs   (paths come from tiles/manifest.json)
const WebSocket = require('ws')
const fs = require('fs')
const BRIDGE = 'ws://127.0.0.1:2401'
let counter = 0

function send(req, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const id = `relink-${Date.now()}-${++counter}`
    const ws = new WebSocket(BRIDGE)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, timeoutMs)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
    ws.on('message', raw => { clearTimeout(timer); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) } ws.close() })
    ws.on('error', err => { clearTimeout(timer); reject(err) })
  })
}

async function sendRetry(req, tries = 5) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const r = await send(req)
      if (r.ok) return r
      last = r.error
      if (/no renderer/.test(r.error || '')) { await new Promise(s => setTimeout(s, 8000)); continue }
      return r
    } catch (e) { last = e.message; await new Promise(s => setTimeout(s, 4000)) }
  }
  return { ok: false, error: `retries exhausted: ${last}` }
}

async function childNames(layer) {
  const sigs = Array.isArray(layer?.children) ? layer.children.map(String) : []
  const names = []
  for (const sig of sigs) {
    const inf = await sendRetry({ op: 'inflate', cell: sig })
    const name = inf?.data?.name
    if (typeof name === 'string' && name.trim()) names.push(name.trim())
  }
  return names
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync('tiles/manifest.json', 'utf8'))
  // deepest first; leaves have nothing to re-link and are skipped below
  const paths = Object.keys(manifest)
    .map(p => p.split('/'))
    .sort((a, b) => b.length - a.length || a.join('/').localeCompare(b.join('/')))

  let relinked = 0, leaves = 0, failed = 0
  for (const segs of paths) {
    try {
      const layer = await sendRetry({ op: 'layer-at', segments: segs })
      if (!layer.ok) throw new Error(`layer-at: ${layer.error}`)
      const names = await childNames(layer.data)
      if (!names.length) { leaves++; continue }
      const res = await sendRetry({
        op: 'update', segments: segs,
        layer: { name: layer.data?.name ?? segs[segs.length - 1], children: names },
      })
      if (!res.ok) throw new Error(`update: ${res.error}`)
      relinked++
      if (relinked % 25 === 0) console.log(`  …${relinked} re-linked`)
    } catch (err) {
      failed++
      console.log(`! /${segs.join('/')} FAILED: ${err.message}`)
    }
  }
  console.log(`DONE re-linked=${relinked} leaves-skipped=${leaves} failed=${failed}`)
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })
