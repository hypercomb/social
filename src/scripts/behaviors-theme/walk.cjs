// Fresh census of the behaviors tree over the bridge.
// layer-at(path) is fresh truth; child layer bytes (possibly stale sigs) are
// used ONLY to learn child names, then we re-read fresh by path.
const WebSocket = require('ws')
const fs = require('fs')
const BRIDGE = 'ws://127.0.0.1:2401'
let counter = 0

function send(req, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const id = `walk-${Date.now()}-${++counter}`
    const ws = new WebSocket(BRIDGE)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, timeoutMs)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
    ws.on('message', raw => { clearTimeout(timer); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) } ws.close() })
    ws.on('error', err => { clearTimeout(timer); reject(err) })
  })
}

async function sendRetry(req, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await send(req)
      if (r.ok) return r
      if (/no renderer/.test(r.error || '')) { await new Promise(s => setTimeout(s, 5000)); continue }
      return r
    } catch (e) { await new Promise(s => setTimeout(s, 3000)) }
  }
  return { ok: false, error: 'retries exhausted' }
}

const resourceCache = new Map()
async function getResource(sig) {
  if (resourceCache.has(sig)) return resourceCache.get(sig)
  const r = await sendRetry({ op: 'get-resource', sig })
  const val = r.ok ? r.data.text : null
  resourceCache.set(sig, val)
  return val
}

async function walk(path, out) {
  const r = await sendRetry({ op: 'layer-at', segments: path })
  if (!r.ok) { out.push({ path, error: r.error }); return }
  const layer = r.data
  const cell = { path, propsSig: (layer.properties || [])[0] || null, props: null, decorations: [], childNames: [] }
  if (cell.propsSig) {
    const t = await getResource(cell.propsSig)
    try { cell.props = JSON.parse(t) } catch {}
  }
  for (const dsig of (layer.decorations || [])) {
    const t = await getResource(dsig)
    try { const d = JSON.parse(t); cell.decorations.push({ sig: dsig, kind: d.kind, payload: d.payload }) } catch {}
  }
  for (const csig of (layer.children || [])) {
    const t = await getResource(csig)
    try { const cl = JSON.parse(t); if (cl?.name) cell.childNames.push(cl.name) } catch {}
  }
  out.push(cell)
  for (const name of cell.childNames) await walk([...path, name], out)
}

async function main() {
  const out = []
  await walk(['behaviors'], out)
  fs.writeFileSync('census.json', JSON.stringify(out, null, 1))
  for (const c of out) {
    if (c.error) { console.log(`${c.path.join('/')} | ERROR ${c.error}`); continue }
    const img = c.props?.small?.image ? 'IMG' : '---'
    const sub = c.props?.substrate === false ? 'noSub' : (c.props?.substrate === true ? 'sub' : '   ')
    const tags = c.decorations.filter(d => d.kind === 'tag').map(d => d.payload?.name).join(',')
    const kinds = c.decorations.filter(d => d.kind !== 'tag').map(d => d.kind).join(',')
    console.log(`${c.path.join('/')} | ${img} ${sub} | ${tags} | ${kinds}`)
  }
  console.log('TOTAL', out.length)
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })
