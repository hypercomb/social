// Push themed tile art into the hive over the bridge.
// Per cell: put-resource(png) → merge props (small.image, substrate:false)
// → put-resource(props) → bag-set properties → stamp (index sync + repaint).
// Idempotent: skips cells whose props already point at the target image.
// Progress checkpointed to push-progress.json.
//
// Usage: node push-tiles.cjs [maxDepth]   (maxDepth 3 = root+collections+behaviors)
const WebSocket = require('ws')
const fs = require('fs')
const BRIDGE = 'ws://127.0.0.1:2401'
let counter = 0

function send(req, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const id = `push-${Date.now()}-${++counter}`
    const ws = new WebSocket(BRIDGE)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, timeoutMs)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
    ws.on('message', raw => { clearTimeout(timer); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) } ws.close() })
    ws.on('error', err => { clearTimeout(timer); reject(err) })
  })
}

async function sendRetry(req, tries = 6) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const r = await send(req)
      if (r.ok) return r
      last = r.error
      if (/no renderer/.test(r.error || '')) { await new Promise(s => setTimeout(s, 8000)); continue }
      return r
    } catch (e) { last = e.message; await new Promise(s => setTimeout(s, 5000)) }
  }
  return { ok: false, error: `retries exhausted: ${last}` }
}

const canonical = obj => {
  const out = {}
  for (const k of Object.keys(obj).sort()) out[k] = obj[k]
  return JSON.stringify(out)
}

async function main() {
  const maxDepth = Number(process.argv[2] || 99)
  const manifest = JSON.parse(fs.readFileSync('tiles/manifest.json', 'utf8'))
  const progress = fs.existsSync('push-progress.json') ? JSON.parse(fs.readFileSync('push-progress.json', 'utf8')) : {}
  const tierOrder = { root: 0, collection: 1, behavior: 2, part: 3 }
  const entries = Object.entries(manifest)
    .map(([p, m]) => ({ path: p.split('/'), key: p, ...m }))
    .filter(e => e.path.length <= maxDepth)
    .sort((a, b) => (tierOrder[a.tier] - tierOrder[b.tier]) || a.key.localeCompare(b.key))

  let done = 0, skipped = 0, failed = 0
  for (const e of entries) {
    if (progress[e.key] === 'done') { skipped++; continue }
    try {
      // current layer + props
      const lr = await sendRetry({ op: 'layer-at', segments: e.path })
      if (!lr.ok) throw new Error(`layer-at: ${lr.error}`)
      const propsSig = (lr.data.properties || [])[0]
      let props = {}
      if (propsSig) {
        const pr = await sendRetry({ op: 'get-resource', sig: propsSig })
        if (pr.ok && pr.data.encoding === 'text') { try { props = JSON.parse(pr.data.text) } catch {} }
      }
      // image resource
      const b64 = fs.readFileSync(`tiles/${e.file}`).toString('base64')
      const ir = await sendRetry({ op: 'put-resource', base64: b64 })
      if (!ir.ok) throw new Error(`put-resource img: ${ir.error}`)
      const imgSig = ir.data.sig
      if (props?.small?.image === imgSig && props.substrate === false) {
        progress[e.key] = 'done'; done++
        fs.writeFileSync('push-progress.json', JSON.stringify(progress))
        console.log(`= ${e.key} (already themed)`)
        continue
      }
      // merged props
      const merged = { ...props, small: { ...(props.small || {}), image: imgSig }, substrate: false }
      const jr = await sendRetry({ op: 'put-resource', text: canonical(merged) })
      if (!jr.ok) throw new Error(`put-resource props: ${jr.error}`)
      // commit slot
      const br = await sendRetry({ op: 'bag-set', segments: e.path, slot: 'properties', cells: [jr.data.sig] })
      if (!br.ok) throw new Error(`bag-set: ${br.error}`)
      // index sync + repaint nudge (content-identical merge → dedup commit)
      const sr = await sendRetry({ op: 'stamp', segments: e.path, layer: { substrate: false } })
      if (!sr.ok) throw new Error(`stamp: ${sr.error}`)
      progress[e.key] = 'done'; done++
      fs.writeFileSync('push-progress.json', JSON.stringify(progress))
      console.log(`+ ${e.key}`)
      await new Promise(s => setTimeout(s, 120))
    } catch (err) {
      failed++
      console.log(`! ${e.key} FAILED: ${err.message}`)
      progress[e.key] = 'failed:' + err.message
      fs.writeFileSync('push-progress.json', JSON.stringify(progress))
      await new Promise(s => setTimeout(s, 2000))
    }
  }
  console.log(`DONE pushed=${done} skipped=${skipped} failed=${failed} of ${entries.length}`)
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })
