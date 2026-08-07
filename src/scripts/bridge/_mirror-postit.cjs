// Mirror the POSTIT behaviour into the behaviors hive (Edge authoring tree).
//
//   node scripts/bridge/_mirror-postit.cjs [--dry]
//
// behaviors/views/postit            ← the behavior tile (tags: behavior, view)
// behaviors/views/postit/<part>     ← one tile per source file (tags: part, view)
//
// Follows scripts/mirror-behaviors-theme.ts shapes exactly. After this, add
// the GLYPHS entry and run scripts/behaviors-theme/sweep.cjs to mint cards.

const WebSocket = require('ws')
const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const DRY = process.argv.includes('--dry')
const log = (...a) => console.log(...a)

let ws, pending = new Map(), seq = 0, connected = null
async function connect() {
  if (connected) return connected
  connected = new Promise((res, rej) => {
    ws = new WebSocket(BRIDGE, { maxPayload: 128 * 1024 * 1024 })
    ws.on('open', () => res(ws))
    ws.on('error', rej)
    ws.on('close', () => { connected = null; for (const [, p] of pending) p.rej(new Error('socket closed')); pending.clear() })
    ws.on('message', raw => {
      let m; try { m = JSON.parse(String(raw)) } catch { return }
      const p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); p.res(m) }
    })
  })
  return connected
}
async function call(req, timeoutMs = 90_000) {
  await connect()
  const id = `pm-${Date.now()}-${++seq}`
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { pending.delete(id); rej(new Error('bridge timeout: ' + req.op)) }, timeoutMs)
    pending.set(id, { res, rej, timer })
    try { ws.send(JSON.stringify({ ...req, id })) } catch (e) { pending.delete(id); clearTimeout(timer); rej(e) }
  })
}
async function ask(req, attempts = 8) {
  let wait = 2000
  for (let i = 0; i < attempts; i++) {
    try { const r = await call(req); if (r.ok || r.error !== 'no renderer connected') return r }
    catch (e) { if (i === attempts - 1) return { ok: false, error: e.message } }
    await new Promise(r => setTimeout(r, wait)); wait = Math.min(wait * 1.7, 30_000); connected = null
  }
  return { ok: false, error: 'renderer never came back' }
}

const BEHAVIOR = 'postit'
const SEG = ['behaviors', 'views', BEHAVIOR]
const E = 'hypercomb-essentials/src/diamondcoreprocessor.com'

const NOTE = [
  'Post-it — the smallest shareable "read this" surface. A tile carrying a `visual:postit:note` decoration shows a small sticky note on screen (bottom-left, over the hive, never blocking navigation); opening it — from the sticky or the tile\'s view-enter icon — mounts the note full-viewport. A payload `htmlSig` mounts that one-page resource inside a shadow root (a standalone artifact, CSS isolated both ways); a text-only payload renders as one large sticky.',
  '',
  'Command line: `/postit here <text>` sticks text on the current cell (one live record — replaceKind semantics), `/postit remove` takes it off, `/postit` toggles the view. Adoptable; the page rides the decoration\'s refs closure, so sync carries the bytes.',
  '',
  'First instance: /revolucion/meetup — the remodeled Meetup listing as a post-it, for Pavlos or a connected Claude to follow.',
].join('\n')

const PARTS = [
  ['postit.queen.ts', `${E}/commands/postit.queen.ts`,
   'the /postit command + VisualBeeRegistry declaration — kind visual:postit:note, view postit; attach/update via replaceDecoration, remove, view toggle'],
  ['postit-view.drone.ts', `${E}/presentation/tiles/postit-view.drone.ts`,
   'both render surfaces — the docked stickies for decorated tiles on the current layer (hexagons mode) and the full-viewport mount (postit mode): htmlSig page in a shadow root, or text as one large sticky; Escape / × returns to the hive'],
]

async function noted(segments, text) {
  const first = text.split('\n')[0].trim()
  const r = await ask({ op: 'note-list', segments })
  const d = r.ok ? r.data : []
  const items = Array.isArray(d) ? d : (Array.isArray(d?.notes) ? d.notes : [])
  if (items.some(n => String(n?.text || '').split('\n')[0].trim() === first)) return 'present'
  if (DRY) return 'would-add'
  const a = await ask({ op: 'note-add', segments: segments.slice(0, -1), cell: segments[segments.length - 1], text })
  return a.ok ? 'added' : 'ERR ' + a.error
}

async function mark(segments, name) {
  if (DRY) return 'would-mark'
  const r = await ask({ op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name } })
  return r.ok ? 'ok' : 'ERR ' + r.error
}

async function childNames(segments) {
  const layer = await ask({ op: 'layer-at', segments })
  if (!layer.ok) throw new Error('no layer at /' + segments.join('/') + ': ' + layer.error)
  const names = []
  for (const sig of (layer.data?.children || []).map(String)) {
    const r = await ask({ op: 'get-resource', sig })
    if (r.ok) { try { const n = JSON.parse(r.data.text).name; if (n) names.push(n) } catch {} }
  }
  return names
}

async function main() {
  // Guard: the behaviors mirror must exist in this renderer's hive.
  const collection = SEG.slice(0, 2)
  const have = await childNames(collection)
  log(`/behaviors/views holds ${have.length} members`)

  // 1. Membership — append postit to the views collection.
  if (!have.includes(BEHAVIOR)) {
    if (DRY) log('  member     : would-append')
    else {
      const up = await ask({ op: 'update', segments: collection, layer: { name: 'views', children: [...have, BEHAVIOR] } })
      log('  member     :', up.ok ? 'appended' : 'ERR ' + up.error)
      if (!up.ok) throw new Error('membership append failed')
    }
  } else log('  member     : present')

  // 2. The behavior tile + its parts as children.
  if (!DRY) {
    const mk = await ask({ op: 'update', segments: SEG, layer: { name: BEHAVIOR } })
    if (!mk.ok) throw new Error('behavior tile: ' + mk.error)
    const kids = await ask({ op: 'update', segments: SEG, layer: { name: BEHAVIOR, children: PARTS.map(p => p[0]) } })
    if (!kids.ok) throw new Error('parts membership: ' + kids.error)
    log('  tile+parts : written')
    for (const [key, file, role] of PARTS) {
      const seg = [...SEG, key]
      const p = await ask({ op: 'update', segments: seg, layer: { name: key } })
      if (!p.ok) { log(`  part ${key}: ERR ${p.error}`); continue }
      log(`  part ${key}:`, await noted(seg, `${key} — ${role}\n\npart of ${BEHAVIOR}\nsource: ${file}`),
        '/', await mark(seg, 'part'), '/', await mark(seg, 'view'))
    }
  } else log('  tile+parts : would-write')

  // 3. Note + pheromones on the behavior tile.
  log('  note       :', await noted(SEG, NOTE))
  log('  marks      :', await mark(SEG, 'behavior'), '/', await mark(SEG, 'view'))

  // 4. Verify read-back.
  if (!DRY) {
    const names = await childNames(SEG)
    const ok = PARTS.every(p => names.includes(p[0]))
    log(`  verify     : parts ${names.length}/2 present:${ok}`)
    if (!ok) throw new Error('read-back verification FAILED')
  }

  // The card sweep (scripts/behaviors-theme/sweep.cjs) runs AFTER this and
  // ends with the single build-record over /behaviors — one restorable step.
  log('done')
  try { ws.close() } catch {}
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
