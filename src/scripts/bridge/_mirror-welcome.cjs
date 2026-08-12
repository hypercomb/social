// Mirror the WELCOME behaviour into the behaviors hive (Edge authoring tree).
//
//   node scripts/bridge/_mirror-welcome.cjs [--dry]
//
// behaviors/views/welcome            ← the behavior tile (tags: behavior, view)
// behaviors/views/welcome/<part>     ← one tile per source file (tags: part, view)
//
// Follows scripts/bridge/_mirror-postit.cjs exactly. After this, the GLYPHS
// entry (welcome: 'door_open') is already in gen-behavior-tiles.mjs — run
// scripts/behaviors-theme/sweep.cjs to mint the card.

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
  const id = `mw-${Date.now()}-${++seq}`
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

const BEHAVIOR = 'welcome'
const SEG = ['behaviors', 'views', BEHAVIOR]
const E = 'hypercomb-essentials/src/revolucionstyle.com'

const NOTE = [
  'Welcome — a 3D threshold page built from the layer itself. A cell carrying a `visual:revolucion:welcome` decoration opens into a full-viewport 3D scene (CSS perspective + a 2D canvas of embers and smoke — no dependencies, no fetching beyond the hive\'s own sig-addressed tile art) whose ELEMENTS are the cell\'s children: each child tile is a gilded panel on a gently curved GALLERY WALL facing the visitor — every element visible at once, one row up to seven children, two rows beyond, the foil crest presiding above. The pointer parallaxes the room; hovering lifts a panel toward you; stepping through one navigates into that child — whose own view implementation owns the surface from there.',
  '',
  'One layer at a time: the view renders exactly the decorated layer. Children are doorways, not content — each child\'s own view comes later, built the same way.',
  '',
  'Command line: `/welcome here [tagline]` marks the current cell (one live record — replaceKind semantics), `/welcome remove` takes it off, `/welcome` toggles the view. Attachable (`name@revolucion-welcome`) — the content IS the children, so no authoring step. First instance: /revolucion.',
  '',
  'Design lesson recorded: the first cut was a receding colonnade you dollied through — by the fourth rank panels were 70px specks, most of the layer invisible without walking. A welcome page shows the whole layer AT A GLANCE; depth is presence, not distance. Also paid forward: parallax is written IMMEDIATELY in the input handler (rAF starves in occluded tabs), and the entrance animation fills backwards from opacity 0 so a browser that never runs it still shows the panels.',
].join('\n')

const PARTS = [
  ['welcome.queen.ts', `${E}/welcome/welcome.queen.ts`,
   'the /welcome command + VisualBeeRegistry declaration — kind visual:revolucion:welcome, view revolucion-welcome; mark/update via replaceDecoration, remove, view toggle; attachable, opens on tile click'],
  ['welcome-view.drone.ts', `${E}/welcome/welcome-view.drone.ts`,
   'the daylight atelier renderer — reads the decorated layer\'s children (childNamesOf) and each child\'s tile art from its properties slot, lays them out as gold-hairlined plates on a warm ivory sheet (clean centred gallery grid, espresso-ink crest, staggered entrance, hover lift), steps through a plate into that child\'s own view; Escape / × returns to the hive'],
  ['room-view.drone.ts', `${E}/welcome/room-view.drone.ts`,
   'the generic room — a child\'s OWN view behind its frame: mounts the cell\'s existing visual:website:page as its presence (CSS scoped to the host via scopeCellPageCss, scripts re-executed, resource: refs rewritten, root class/theme mirrored, theme write undone on unmount), in-page absolute links become room-to-room passage, Escape walks back onto the wall, no page = fall through to hexagons — the view never traps'],
]

const NOTE_ROOM = [
  'The room — every plate on the welcome page opens the child\'s OWN view. The children\'s existing pages (the three.js lounge, the interactive flavor wheel, the parchment journal — all visual:website:page decorations) ARE those views: stepping through a plate mounts the child\'s page full-viewport as the cell\'s presence, not bare hexagons and not the global website mode. Escape walks back out onto the welcome page; × leaves to the hexagons; a child with no page falls through to the hexagons, so the view never traps.',
  '',
  'The welcome page itself (v4, superseding the earlier dark 3D concepts) is a DAYLIGHT ATELIER: warm ivory paper, espresso ink, gold hairlines — the children as clean plates in a centred gallery grid, every element visible at once, obviously clickable. Design history: the dark colonnade hid the layer (panels shrank to specks); the dark 3D wall read as heavy and its floating variants as sloppy. Depth is garnish — soft shadows, hover lift, staggered entrance — never a scene the visitor must navigate.',
  '',
  'This room is the GENERIC child view. When a child earns a bespoke view implementation, that view takes over its plate and the room steps aside — one layer at a time.',
].join('\n')

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

  // 1. Membership — append welcome to the views collection.
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

  // 3. Notes + pheromones on the behavior tile.
  log('  note       :', await noted(SEG, NOTE))
  log('  note room  :', await noted(SEG, NOTE_ROOM))
  log('  marks      :', await mark(SEG, 'behavior'), '/', await mark(SEG, 'view'))

  // 4. Verify read-back.
  if (!DRY) {
    const names = await childNames(SEG)
    const ok = PARTS.every(p => names.includes(p[0]))
    log(`  verify     : parts ${names.length}/${PARTS.length} present:${ok}`)
    if (!ok) throw new Error('read-back verification FAILED')
  }

  // The card sweep (scripts/behaviors-theme/sweep.cjs) runs AFTER this and
  // ends with the single build-record over /behaviors — one restorable step.
  log('done')
  try { ws.close() } catch {}
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
