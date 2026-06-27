// _gallery-diagrams.cjs — retry just the gallery decorations (resources +
// hive already created by _put-diagrams.cjs). Longer timeout + per-op retry
// to ride out renderer throttling. Run from monorepo root. Gitignored.

const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
const TIMEOUT_MS = 30_000
let counter = 0

function once(req) {
  return new Promise((resolve, reject) => {
    const id = `gal-${Date.now()}-${++counter}`
    const ws = new WebSocket(BRIDGE)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT_MS)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
    ws.on('message', (raw) => { clearTimeout(timer); try { resolve(JSON.parse(String(raw))) } catch { reject(new Error('bad response')) } ws.close() })
    ws.on('error', (err) => { clearTimeout(timer); reject(err) })
  })
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function send(req, what, tries = 4) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      const r = await once(req)
      if (r && r.ok === false) throw new Error(r.error)
      return r
    } catch (e) { lastErr = e; console.log(`  retry ${i + 1}/${tries} (${what}): ${e.message}`); await sleep(1200) }
  }
  throw new Error(`${what} failed after ${tries}: ${lastErr && lastErr.message}`)
}

const GALLERY_KIND = 'visual:lightbox:gallery'
const ROOT = 'diagrams'
const D = [
  { cell: 'runtime-lifecycle', label: 'Runtime Lifecycle', sig: '332a39037bb534dd8375b68d47302780b6f8c6adf23b5af76639fff89b702118' },
  { cell: 'dcp-internals',     label: 'DCP Internals',     sig: '276be114d4884c09d10f50a784dbb6fd6ce01b157c6270614d7679b6c56c8371' },
  { cell: 'website-pipeline',  label: 'Website Pipeline',  sig: '5d55a0bf344bd223f37ef5efb1355674941803c955a1b7a7dc751919f81f8feb' },
  { cell: 'game-pipeline',     label: 'Game Pipeline',     sig: 'fd97b43a24ab20e6d1a0cc3290b6a2e3fd0c1e46f36ed652caad505972a767de' },
  { cell: 'participant-loop',  label: 'Participant Loop',  sig: 'dd87b3fd8cf9a178e2eb637caa1cbe12e01beaf2d01472ba435c3d72c058dc73' },
]

async function gallery(segments, images, label) {
  return send({
    op: 'decoration-add', segments, kind: GALLERY_KIND, appliesTo: segments,
    payload: { images, icon: 'collections', label, createdAt: Date.now() },
    mark: 'persistent', replaceKind: true,
  }, `gallery ${segments.join('/')}`)
}

async function main() {
  const all = D.map(d => d.sig)
  const p = await gallery([ROOT], all, 'Hypercomb Diagrams')
  console.log(`gallery /${ROOT} (${all.length})  -> ${p.data.sig}`)
  for (const d of D) {
    const r = await gallery([ROOT, d.cell], [d.sig], d.label)
    console.log(`gallery /${ROOT}/${d.cell.padEnd(18)} -> ${r.data.sig}`)
  }
  // verify parent
  const layer = await send({ op: 'layer-at', segments: [ROOT] }, 'layer-at')
  const decs = Array.isArray(layer.data && layer.data.decorations) ? layer.data.decorations : []
  for (const sig of decs) {
    if (!/^[0-9a-f]{64}$/.test(sig)) continue
    const res = await once({ op: 'get-resource', sig }).catch(() => null)
    if (!res || !res.ok) continue
    try {
      const rec = JSON.parse(res.data.text)
      if (rec.kind === GALLERY_KIND && Array.isArray(rec.payload.images)) {
        console.log(`VERIFY OK  /${ROOT} gallery carries ${rec.payload.images.length} images`)
      }
    } catch {}
  }
  console.log('\nDONE.')
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
