// Send a FILE / ARTIFACT from this machine into the hive.
//
//   node scripts/bridge/_put-file.cjs <local-file> <tile/path> [--slot <slot>] [--text]
//
// Two hops, both existing bridge ops:
//   1. put-resource  → mints a CONTENT-ADDRESSED resource, returns its sig
//   2. bag-add       → appends that sig to a slot on the target tile's layer,
//                      which is an ordinary layer commit (undoable, adoptable,
//                      shareable — the artifact becomes part of the merkle tree)
//
// The slot decides what the artifact MEANS, and therefore which behavior picks
// it up. There is no universal "attachments" slot — that's the point of
// layer-as-primitive. Common choices:
//   context      (default) the AI context bag — what /ask expansions can see
//   decorations  decoration records (prefer the `decoration-add` op, which
//                mints the record + attaches in one call)
//   <behavior>   whatever slot a behavior reads (e.g. `website`, `tutor`)
//
// --text sends the file as UTF-8 text (better dedup + readable in the store);
// default is base64, which is safe for any bytes. Binary and text alike end up
// as the same content-addressed resource.
//
// BRIDGE_URL env overrides the broker (default ws://localhost:2401) — that is
// also how you drive ANOTHER machine's hive, since the broker listens on all
// interfaces while the hive tab is always local to its own broker.

const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
// A WebSocket frame carrying base64 JSON is ~1.37x the file size; keep well
// clear of the default 100MB frame cap and of wedging the renderer.
const MAX_BYTES = 8 * 1024 * 1024

let counter = 0
const nextId = () => `putfile-${Date.now()}-${++counter}`

function send(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE, { maxPayload: 64 * 1024 * 1024 })
    const t = setTimeout(() => { try { ws.close() } catch {} ; reject(new Error('bridge timeout')) }, 30_000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: nextId() })))
    ws.on('message', raw => {
      clearTimeout(t)
      try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) }
      try { ws.close() } catch {}
    })
    ws.on('error', e => { clearTimeout(t); reject(e) })
  })
}

async function withRenderer(req, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await send(req)
      if (r.ok || r.error !== 'no renderer connected') return r
    } catch (e) { if (i === attempts - 1) throw e }
    await new Promise(r => setTimeout(r, 1500))
  }
  return { ok: false, error: 'renderer never connected' }
}

async function main() {
  const args = process.argv.slice(2)
  const flags = new Set(args.filter(a => a.startsWith('--')))
  const slotIdx = args.indexOf('--slot')
  const slot = slotIdx >= 0 ? args[slotIdx + 1] : 'context'
  const positional = args.filter((a, i) => !a.startsWith('--') && !(slotIdx >= 0 && i === slotIdx + 1))
  const [file, tilePath] = positional

  if (!file || !tilePath) {
    console.error('Usage: _put-file.cjs <local-file> <tile/path> [--slot <slot>] [--text]')
    process.exit(1)
  }
  if (!fs.existsSync(file)) { console.error(`no such file: ${file}`); process.exit(1) }

  const stat = fs.statSync(file)
  if (stat.size > MAX_BYTES) {
    console.error(`file is ${(stat.size / 1048576).toFixed(1)}MB — cap is ${MAX_BYTES / 1048576}MB over the bridge`)
    process.exit(1)
  }

  const segments = String(tilePath).split(/[\\/]/).map(s => s.trim()).filter(Boolean)
  if (segments.length === 0) { console.error('tile/path must resolve to at least one segment'); process.exit(1) }

  // 1. mint the resource
  const buf = fs.readFileSync(file)
  const payload = flags.has('--text')
    ? { text: buf.toString('utf8') }
    : { base64: buf.toString('base64') }
  const put = await withRenderer({ op: 'put-resource', ...payload })
  if (!put.ok) { console.error('put-resource failed:', put.error); process.exit(1) }
  const sig = put.data?.sig
  if (!sig) { console.error('put-resource returned no sig'); process.exit(1) }

  // 2. attach it to the tile's slot (an ordinary, undoable layer commit)
  const bag = await withRenderer({ op: 'bag-add', segments, slot, sig })
  if (!bag.ok) {
    console.error(`resource stored (${sig}) but bag-add failed:`, bag.error)
    process.exit(1)
  }

  console.log(`[put-file] ${path.basename(file)} (${stat.size}B) → /${segments.join('/')} slot=${slot}`)
  console.log(`[put-file] sig ${sig}`)
}

main().catch(err => { console.error(String(err)); process.exit(1) })
