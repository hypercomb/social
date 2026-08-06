// Fill the FLAT-TOP image slot for cells that have none.
//
// Cells carry two independent art slots: `small.image` (point-top, the glyph
// cards) and `flat.small.image` (flat-top). 209 of 458 cells wear photographic
// flat art; the rest were blank in flat-top mode. This fills only the blanks
// with the flat-top glyph set (tiles-flat/), and NEVER touches a cell that
// already has flat art — the photographs are the user's and stay put.
//
// --replace additionally overwrites flat art that is already there. A cell's
// two slots are meant to be the SAME card drawn twice — point-top ring for the
// point-top grid, flat-top ring for the flat-top grid — so photographs left in
// a flat slot are simply the wrong picture, and this is how they are corrected.
// The displaced image stays addressable by its own signature.
//
// Usage: node push-flat-tiles.cjs [--dry] [--replace]
const WebSocket = require('ws')
const fs = require('fs')
const BRIDGE = 'ws://127.0.0.1:2401'
const DRY = process.argv.includes('--dry')
const REPLACE = process.argv.includes('--replace')
let counter = 0

function send(req, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const id = `flat-${Date.now()}-${++counter}`
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
  const manifest = JSON.parse(fs.readFileSync('tiles-flat/manifest.json', 'utf8'))
  const progress = fs.existsSync('push-flat-progress.json')
    ? JSON.parse(fs.readFileSync('push-flat-progress.json', 'utf8')) : {}
  const tierOrder = { root: 0, collection: 1, behavior: 2, part: 3 }
  const entries = Object.entries(manifest)
    .map(([p, m]) => ({ path: p.split('/'), key: p, ...m }))
    .sort((a, b) => (tierOrder[a.tier] - tierOrder[b.tier]) || a.key.localeCompare(b.key))

  let filled = 0, kept = 0, failed = 0
  for (const e of entries) {
    if (progress[e.key] === 'done' || progress[e.key] === 'kept') { kept += progress[e.key] === 'kept' ? 1 : 0; continue }
    try {
      const lr = await sendRetry({ op: 'layer-at', segments: e.path })
      if (!lr.ok) throw new Error(`layer-at: ${lr.error}`)
      const propsSig = (lr.data.properties || [])[0]
      let props = {}
      if (propsSig) {
        const pr = await sendRetry({ op: 'get-resource', sig: propsSig })
        if (pr.ok && pr.data.encoding === 'text') { try { props = JSON.parse(pr.data.text) } catch {} }
      }
      // Existing flat art is preserved unless --replace says otherwise.
      if (props?.flat?.small?.image && !REPLACE) {
        progress[e.key] = 'kept'; kept++
        fs.writeFileSync('push-flat-progress.json', JSON.stringify(progress))
        continue
      }
      const displaced = props?.flat?.small?.image
      if (DRY) { console.log(`would set ${e.key}${displaced ? ` (displaces ${displaced.slice(0, 12)}…)` : ''}`); filled++; continue }

      const b64 = fs.readFileSync(`tiles-flat/${e.file}`).toString('base64')
      const ir = await sendRetry({ op: 'put-resource', base64: b64 })
      if (!ir.ok) throw new Error(`put-resource img: ${ir.error}`)
      const imgSig = ir.data.sig
      // Already wearing this exact card — nothing to commit.
      if (props?.flat?.small?.image === imgSig) {
        progress[e.key] = 'done'
        fs.writeFileSync('push-flat-progress.json', JSON.stringify(progress))
        continue
      }

      const merged = {
        ...props,
        flat: { ...(props.flat || {}), small: { ...((props.flat || {}).small || {}), image: imgSig } },
      }
      const jr = await sendRetry({ op: 'put-resource', text: canonical(merged) })
      if (!jr.ok) throw new Error(`put-resource props: ${jr.error}`)
      const br = await sendRetry({ op: 'bag-set', segments: e.path, slot: 'properties', cells: [jr.data.sig] })
      if (!br.ok) throw new Error(`bag-set: ${br.error}`)
      const sr = await sendRetry({ op: 'stamp', segments: e.path, layer: { substrate: false } })
      if (!sr.ok) throw new Error(`stamp: ${sr.error}`)

      progress[e.key] = 'done'; filled++
      fs.writeFileSync('push-flat-progress.json', JSON.stringify(progress))
      // Log the displaced signature — the old picture stays addressable by it.
      console.log(`+ ${e.key}${displaced ? `  displaced=${displaced}` : ''}`)
      await new Promise(s => setTimeout(s, 120))
    } catch (err) {
      failed++
      console.log(`! ${e.key} FAILED: ${err.message}`)
      progress[e.key] = 'failed:' + err.message
      fs.writeFileSync('push-flat-progress.json', JSON.stringify(progress))
      await new Promise(s => setTimeout(s, 2000))
    }
  }
  console.log(`DONE filled=${filled} kept-existing=${kept} failed=${failed} of ${entries.length}`)
  if (DRY || !filled) { console.log('BUILD REV     skipped'); return }
  const rev = await sendRetry({
    op: 'build-record', segments: ['behaviors'],
    label: `behaviors flat-top art (${filled} card${filled === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''})`,
  })
  console.log(rev.ok ? `BUILD REV     ${rev.data.label} seal=${String(rev.data.seal).slice(0, 12)}` : `BUILD REV     FAILED: ${rev.error}`)
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })
