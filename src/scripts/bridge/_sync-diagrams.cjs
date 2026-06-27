// _sync-diagrams.cjs — DYNAMIC, DIFFERENTIAL sync of the /diagrams hive.
//
// Scans documentation/assets/diagrams/*.svg, content-addresses each, and
// ensures /diagrams holds one tile per image whose `link` points at the
// current resource. Re-running is a diff for free:
//   • unchanged svg → same sig → link already set → no-op
//   • changed svg   → new sig  → link updated (differential)
//   • new svg file  → new tile + link ("loads new stuff")
//
// Each tile is a leaf whose link is an image, so clicking the hexagon pops
// the existing PhotoView lightbox full-size. Run from monorepo root with the
// broker + a renderer (?claudeBridge=1) up. Gitignored.

const WebSocket = require('ws')
const { readdirSync, readFileSync } = require('fs')
const path = require('path')

const BRIDGE = 'ws://localhost:2401'
const TIMEOUT_MS = 30_000
const ASSET_DIR = path.join('documentation', 'assets', 'diagrams')
const ROOT = 'diagrams'
let counter = 0

function once(req) {
  return new Promise((resolve, reject) => {
    const id = `sync-${Date.now()}-${++counter}`
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

// filename → already-normalized tile name (drop "NN-" prefix + ".svg")
const tileName = (f) => f.replace(/^\d+-/, '').replace(/\.svg$/i, '')

async function main() {
  const files = readdirSync(ASSET_DIR).filter(f => /\.svg$/i.test(f)).sort()
  if (!files.length) { console.log('no svg files in', ASSET_DIR); return }

  // 1. content-address each → sig (dedups; new bytes → new sig)
  const tiles = []
  for (const f of files) {
    const svg = readFileSync(path.join(ASSET_DIR, f), 'utf8')
    const r = await send({ op: 'put-resource', text: svg }, `put ${f}`)
    tiles.push({ cell: tileName(f), sig: r.data.sig })
    console.log(`resource ${f.padEnd(26)} -> ${r.data.sig.slice(0, 12)}…`)
  }

  // 2. ensure /diagrams exists, then add only the MISSING child tiles (diff)
  await send({ op: 'add', segments: [], cells: [ROOT] }, 'add diagrams')
  const existing = await send({ op: 'list-at', segments: [ROOT] }, 'list-at diagrams').catch(() => ({ data: [] }))
  const have = new Set((existing.data || []).map(String))
  const missing = tiles.filter(t => !have.has(t.cell)).map(t => t.cell)
  if (missing.length) {
    await send({ op: 'add', segments: [ROOT], cells: missing }, 'add tiles')
    console.log(`added tiles: ${missing.join(', ')}`)
  } else {
    console.log('no new tiles')
  }

  // 3. stamp each tile's link to its CURRENT sig (differential update).
  //    Cosmetic `.svg` suffix so the resource SW serves `image/svg+xml` and
  //    fetchImageBlob recognises it as an image (the bare sig has no extension
  //    and is served octet-stream → PhotoView can't render it). The SW resolves
  //    the 64-hex sig and ignores the trailing path (same as resource:<sig>/chrome.css).
  for (const t of tiles) {
    const link = `/@resource/${t.sig}/${t.cell}.svg`
    await send({ op: 'stamp', segments: [ROOT, t.cell], layer: { link } }, `link ${t.cell}`)
    console.log(`link /${ROOT}/${t.cell.padEnd(18)} -> ${link.slice(0, 34)}…`)
  }

  console.log(`\nDONE. /${ROOT}: ${tiles.length} tiles. Click a diagram hexagon → PhotoView full-size.`)
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
