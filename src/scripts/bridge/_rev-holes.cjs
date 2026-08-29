// Walk /revolucion by layer-at per path; collect every 64-hex ref in each
// layer; test each ref locally (get-resource) and remotely (content.jwize.com
// HEAD — same R2 bucket as content.pluginthematrix.com). Report holes.
const WebSocket = require('ws')
const https = require('https')
const ws = new WebSocket('ws://localhost:2401')
let counter = 0
const pending = new Map()
function send(req) {
  return new Promise((resolve, reject) => {
    const id = `h-${++counter}`
    pending.set(id, resolve)
    ws.send(JSON.stringify({ ...req, id }))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ ok: false, error: 'timeout' }) } }, 30000)
  })
}
ws.on('message', raw => {
  try { const m = JSON.parse(String(raw)); const r = pending.get(m.id); if (r) { pending.delete(m.id); r(m) } } catch {}
})
function head(sig) {
  return new Promise(resolve => {
    const req = https.request({ host: 'content.jwize.com', path: '/' + sig, method: 'HEAD', timeout: 15000 },
      res => resolve(res.statusCode))
    req.on('error', () => resolve(0)); req.on('timeout', () => { req.destroy(); resolve(0) })
    req.end()
  })
}
const SIG = /\b[0-9a-f]{64}\b/g
ws.on('open', async () => {
  const holes = []   // {path, ref, local, remote}
  const seenRef = new Map() // ref -> verdict cache
  const queue = [['revolucion']]
  let visited = 0
  while (queue.length) {
    const path = queue.shift()
    const r = await send({ op: 'layer-at', segments: path })
    if (!r.ok || !r.data) { console.error('LAYER-AT FAIL /' + path.join('/')); continue }
    visited++
    const layer = r.data
    const childSigs = Array.isArray(layer.children) ? layer.children : []
    // resolve child names via get-resource on each child sig (historical ok — names only)
    for (const cs of childSigs) {
      const g = await send({ op: 'get-resource', sig: String(cs) })
      let name = null
      if (g.ok && g.data && typeof g.data.text === 'string') {
        const m = /"name"\s*:\s*"([^"]+)"/.exec(g.data.text)
        if (m) name = m[1]
      }
      if (name) queue.push([...path, name])
      else console.error('CHILD NAME UNRESOLVED at /' + path.join('/') + ' sig ' + String(cs).slice(0, 12))
    }
    // scan all refs in the layer JSON EXCEPT children (handled by recursion)
    const clone = { ...layer }; delete clone.children
    const refs = new Set((JSON.stringify(clone).match(SIG) || []))
    for (const ref of refs) {
      if (seenRef.has(ref)) { const v = seenRef.get(ref); if (v) holes.push({ path: path.join('/'), ...v }); continue }
      const g = await send({ op: 'get-resource', sig: ref })
      const local = !!g.ok
      let verdict = null
      if (!local) {
        const st = await head(ref)
        if (st !== 200) verdict = { ref, local: false, remote: st }
      }
      seenRef.set(ref, verdict)
      if (verdict) holes.push({ path: path.join('/'), ...verdict })
    }
    if (visited % 25 === 0) console.error(`...visited ${visited}, queue ${queue.length}, holes ${holes.length}`)
  }
  console.log(JSON.stringify({ visited, holes }, null, 1))
  process.exit(0)
})
