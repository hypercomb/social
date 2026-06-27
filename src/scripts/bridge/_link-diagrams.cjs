// _link-diagrams.cjs — set each diagram tile's `link` property to its image
// resource. A leaf tile whose link is an image → clicking the hexagon pops
// the existing PhotoView lightbox (LinkOpenWorker → fetchImageBlob → PhotoView).
// Run from monorepo root with broker + renderer (?claudeBridge=1) up. Gitignored.

const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
const TIMEOUT_MS = 30_000
let counter = 0
function once(req) {
  return new Promise((resolve, reject) => {
    const id = `link-${Date.now()}-${++counter}`
    const ws = new WebSocket(BRIDGE)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT_MS)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
    ws.on('message', (raw) => { clearTimeout(timer); try { resolve(JSON.parse(String(raw))) } catch { reject(new Error('bad response')) } ws.close() })
    ws.on('error', (err) => { clearTimeout(timer); reject(err) })
  })
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function send(req, what, tries = 4) {
  let last
  for (let i = 0; i < tries; i++) {
    try { const r = await once(req); if (r && r.ok === false) throw new Error(r.error); return r }
    catch (e) { last = e; console.log(`  retry ${i + 1}/${tries} (${what}): ${e.message}`); await sleep(1200) }
  }
  throw new Error(`${what} failed: ${last && last.message}`)
}

const ROOT = 'diagrams'
const D = [
  { cell: 'runtime-lifecycle', sig: '332a39037bb534dd8375b68d47302780b6f8c6adf23b5af76639fff89b702118' },
  { cell: 'dcp-internals',     sig: '276be114d4884c09d10f50a784dbb6fd6ce01b157c6270614d7679b6c56c8371' },
  { cell: 'website-pipeline',  sig: '5d55a0bf344bd223f37ef5efb1355674941803c955a1b7a7dc751919f81f8feb' },
  { cell: 'game-pipeline',     sig: 'fd97b43a24ab20e6d1a0cc3290b6a2e3fd0c1e46f36ed652caad505972a767de' },
  { cell: 'participant-loop',  sig: 'dd87b3fd8cf9a178e2eb637caa1cbe12e01beaf2d01472ba435c3d72c058dc73' },
]

async function main() {
  for (const d of D) {
    const link = `/@resource/${d.sig}`
    await send({ op: 'stamp', segments: [ROOT, d.cell], layer: { link } }, `stamp link ${d.cell}`)
    console.log(`link /${ROOT}/${d.cell.padEnd(18)} -> ${link}`)
  }
  // verify one tile's link round-trips
  const r = await once({ op: 'inflate', segments: [ROOT, D[0].cell] }).catch(() => null)
  console.log('\nsample inflate runtime-lifecycle:', r && r.ok ? 'ok' : (r && r.error) || 'no-read')
  console.log('DONE. Click a diagram hexagon under /diagrams → PhotoView full-size.')
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
