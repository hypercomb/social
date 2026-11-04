// Tiles taken out of a running hive, whole: each one's own picture, its
// border colour and its name, read over the bridge from the tile's
// properties. The pages draw them as tiles again
// (blocks/hive-figure.cjs), so a scene that shows a hive shows a real one —
// never the demo hive the tour's clips were filmed in.
//
//   node scripts/bridge/living-presentation/blocks/tiles.cjs <route>...
//     e.g. revolucion revolucion/humidor knowledge
//
// Writes blocks/tiles/<route, '/' as '--'>.webp and records each tile in
// blocks/tiles/tiles.json: { "<route>": { name, border, file } }. A tile with
// no picture is reported and skipped. The hive tab must be on the bridge
// (http://localhost:4250/?claudeBridge=1).

const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const OUT = path.join(__dirname, 'tiles')
const INDEX = path.join(OUT, 'tiles.json')
const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'

let n = 0
const ask = (req) => new Promise((resolve, reject) => {
  const ws = new WebSocket(BRIDGE, { maxPayload: 256 * 1024 * 1024 })
  const id = `tiles-${++n}`
  const timer = setTimeout(() => { ws.close(); reject(new Error(`the hive did not answer ${req.op} in time`)) }, 30000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw))
    if (m.id !== id) return
    clearTimeout(timer)
    ws.close()
    if (m.ok === false) reject(new Error(m.error || `${req.op} refused`))
    else resolve(m.data)
  })
  ws.on('error', (error) => { clearTimeout(timer); reject(new Error(`cannot reach the hive over the bridge at ${BRIDGE}: ${error.message}`)) })
})

const fileOf = (route) => `${route.split('/').join('--')}.webp`

/** A WebP's pixel size, from its header. */
const webpSize = (b) => {
  const kind = b.toString('ascii', 12, 16)
  if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
  if (kind === 'VP8L') { const n = b.readUInt32LE(21); return { width: 1 + (n & 0x3fff), height: 1 + ((n >> 14) & 0x3fff) } }
  return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
}

const extract = async (route) => {
  const segments = route.split('/').filter(Boolean)
  const layer = await ask({ op: 'layer-at', segments })
  const propsSig = (layer?.properties || [])[0]
  if (!propsSig) return null
  const props = JSON.parse((await ask({ op: 'get-resource', sig: propsSig })).text)
  // A tile keeps two cuts of its picture, one for each hexagon orientation;
  // the pages draw tiles point-up, so the taller cut wins when there is one.
  const sigs = [props?.small?.image, props?.flat?.small?.image].filter(Boolean)
  if (!sigs.length) return null
  const cuts = []
  for (const sig of sigs) {
    const bytes = Buffer.from((await ask({ op: 'get-resource', sig, text: 'base64' })).base64 || '', 'base64')
    if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') throw new Error(`${route}: its picture is not a WebP`)
    cuts.push({ bytes, ...webpSize(bytes) })
  }
  const cut = cuts.find(c => c.height > c.width) ?? cuts[0]
  return { name: segments.at(-1), border: props?.border?.color || null, bytes: cut.bytes }
}

const main = async () => {
  const routes = process.argv.slice(2).map(r => r.replace(/^\/+|\/+$/g, '')).filter(Boolean)
  if (!routes.length) { console.error('usage: tiles.cjs <route>...'); process.exit(2) }
  fs.mkdirSync(OUT, { recursive: true })
  const index = fs.existsSync(INDEX) ? JSON.parse(fs.readFileSync(INDEX, 'utf8')) : {}
  for (const route of routes) {
    const tile = await extract(route)
    if (!tile) { console.log(`${route}: no picture, skipped`); continue }
    const file = fileOf(route)
    fs.writeFileSync(path.join(OUT, file), tile.bytes)
    index[route] = { name: tile.name, border: tile.border, file }
    console.log(`${route} → tiles/${file} (${Math.round(tile.bytes.length / 1024)} KB)`)
  }
  const sorted = Object.fromEntries(Object.keys(index).sort().map(k => [k, index[k]]))
  fs.writeFileSync(INDEX, JSON.stringify(sorted, null, 2) + '\n')
}

main().catch(error => { console.error(error.message); process.exit(1) })
