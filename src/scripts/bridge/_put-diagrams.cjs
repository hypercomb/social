// _put-diagrams.cjs — one-shot: turn the 5 diagram SVGs into servable OPFS
// resources, build a `diagrams` hive that links them, and write the
// visual:lightbox:gallery decorations the LightboxDrone reads.
//
// Run from monorepo root:  node scripts/bridge/_put-diagrams.cjs
// Requires: broker (run-bridge.cjs) up + a renderer tab on localhost with
// ?claudeBridge=1. Gitignored (underscore prefix) — temp tooling.

const WebSocket = require('ws')
const { readFileSync } = require('fs')
const path = require('path')

const BRIDGE = 'ws://localhost:2401'
const TIMEOUT_MS = 15_000
let counter = 0

function send(req) {
  return new Promise((resolve, reject) => {
    const id = `diagrams-${Date.now()}-${++counter}`
    const ws = new WebSocket(BRIDGE)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT_MS)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
    ws.on('message', (raw) => { clearTimeout(timer); try { resolve(JSON.parse(String(raw))) } catch { reject(new Error('bad response')) } ws.close() })
    ws.on('error', (err) => { clearTimeout(timer); reject(err) })
  })
}
const ok = (r, what) => { if (!r || r.ok === false) throw new Error(`${what} failed: ${r && r.error}`); return r }

// file → already-NORMALIZED tile name (lowercase-hyphen) so RAW segment
// signing (decoration-add) matches the stored cell name. Order = gallery order.
const DIAGRAMS = [
  { file: '01-runtime-lifecycle.svg', cell: 'runtime-lifecycle', label: 'Runtime Lifecycle' },
  { file: '02-dcp-internals.svg',     cell: 'dcp-internals',     label: 'DCP Internals' },
  { file: '03-website-pipeline.svg',  cell: 'website-pipeline',  label: 'Website Pipeline' },
  { file: '04-game-pipeline.svg',     cell: 'game-pipeline',     label: 'Game Pipeline' },
  { file: '05-participant-loop.svg',  cell: 'participant-loop',  label: 'Participant Loop' },
]
const ASSET_DIR = path.join('documentation', 'assets', 'diagrams')
const ROOT = 'diagrams'
const GALLERY_KIND = 'visual:lightbox:gallery'

async function gallery(segments, images, label) {
  return ok(await send({
    op: 'decoration-add',
    segments,
    kind: GALLERY_KIND,
    appliesTo: segments,
    payload: { images, icon: 'collections', label, createdAt: Date.now() },
    mark: 'persistent',
    replaceKind: true,
  }), `decoration-add ${segments.join('/')}`)
}

async function main() {
  // 1. put-resource each SVG → sig
  const sigs = []
  for (const d of DIAGRAMS) {
    const svg = readFileSync(path.join(ASSET_DIR, d.file), 'utf8')
    const r = ok(await send({ op: 'put-resource', text: svg }), `put-resource ${d.file}`)
    d.sig = r.data.sig
    sigs.push(d.sig)
    console.log(`put-resource  ${d.file.padEnd(26)} -> ${d.sig}`)
  }

  // 2. build the hive: parent + one child per diagram
  ok(await send({ op: 'add', segments: [], cells: [ROOT] }), 'add diagrams')
  console.log(`add           /${ROOT}`)
  ok(await send({ op: 'add', segments: [ROOT], cells: DIAGRAMS.map(d => d.cell) }), 'add children')
  console.log(`add children  ${DIAGRAMS.map(d => d.cell).join(', ')}`)

  // 3. gallery decorations — parent gets ALL, each child gets its own
  const parent = await gallery([ROOT], sigs, 'Hypercomb Diagrams')
  console.log(`gallery       /${ROOT}  (${sigs.length} images)  -> ${parent.data.sig}`)
  for (const d of DIAGRAMS) {
    const r = await gallery([ROOT, d.cell], [d.sig], d.label)
    console.log(`gallery       /${ROOT}/${d.cell.padEnd(18)} -> ${r.data.sig}`)
  }

  // 4. verify: read back the parent's gallery decoration
  const layer = ok(await send({ op: 'layer-at', segments: [ROOT] }), 'layer-at diagrams')
  const decs = Array.isArray(layer.data && layer.data.decorations) ? layer.data.decorations : []
  let verified = false
  for (const sig of decs) {
    if (!/^[0-9a-f]{64}$/.test(sig)) continue
    const res = await send({ op: 'get-resource', sig })
    if (!res.ok) continue
    try {
      const rec = JSON.parse(res.data.text)
      if (rec.kind === GALLERY_KIND && Array.isArray(rec.payload.images) && rec.payload.images.length === sigs.length) {
        verified = true
        console.log(`VERIFY OK     /${ROOT} gallery decoration carries ${rec.payload.images.length} image sigs`)
      }
    } catch { /* skip */ }
  }
  if (!verified) throw new Error('verification failed — gallery decoration not found on read-back')
  console.log('\nDONE. Navigate to /diagrams and run /lightbox (after build:essentials loads the LightboxDrone).')
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1) })
