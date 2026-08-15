// Meetup post-it branch — /revolucion/meetup
//
//   node scripts/bridge/_meetup-postit-build.cjs [--dry]
//
// One cell carrying the remodeled Meetup listing as a POST-IT: the
// `visual:postit:note` decoration holds the one-page mockup (htmlSig), the
// tile wears sticky-note art, and the notes tree carries the copy doctrine
// + how to apply it to meetup.com — readable by Pavlos, Jaime, or a
// bridge-connected Claude. Meetup owns the real layout; this branch is the
// note to follow.
//
// Idempotent: content-addressed page + art, decoration-add replaceKind,
// notes gate on first line, ONE build-record seals the pass.

const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const DRY = process.argv.includes('--dry')
// Page + art live next to this script — a session scratchpad does not survive.
const ASSETS = path.join(__dirname, '_meetup-postit')
const SEGMENTS = ['revolucion', 'meetup']
const KIND = 'visual:postit:note'
const MARKER = 'own your corner of the internet'
const log = (...a) => console.log(...a)

// ── transport (the _moose-paint pattern) ──────────────────────────────
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
  const id = `mp-${Date.now()}-${++seq}`
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

// ── guard: never write into the wrong hive ────────────────────────────
async function assertRightHive() {
  const root = await ask({ op: 'layer-at', segments: [] })
  if (!root.ok) throw new Error('cannot read hive root: ' + root.error)
  const names = []
  for (const sig of (root.data?.children || []).map(String)) {
    const r = await ask({ op: 'get-resource', sig })
    if (r.ok) { try { const n = JSON.parse(r.data.text).name; if (n) names.push(n) } catch {} }
  }
  if (!names.includes('revolucion')) {
    throw new Error('WRONG HIVE — no /revolucion at root. A stray tab stole the broker slot.\n  root: ' + names.join(', '))
  }
}

// ── primitives (same shapes as _moose-paint) ──────────────────────────
async function ensureChild(segments) {
  const parent = segments.slice(0, -1), name = segments[segments.length - 1]
  const layer = await ask({ op: 'layer-at', segments: parent })
  if (!layer.ok) throw new Error('no parent layer at /' + parent.join('/'))
  const have = []
  for (const sig of (layer.data?.children || []).map(String)) {
    const r = await ask({ op: 'get-resource', sig })
    if (r.ok) { try { const n = JSON.parse(r.data.text).name; if (n) have.push(n) } catch {} }
  }
  if (have.includes(name)) return 'present'
  if (DRY) return 'would-create'
  const u = await ask({ op: 'update', segments: parent, layer: { name: parent[parent.length - 1], children: [...have, name] } })
  return u.ok ? 'created' : 'ERR ' + u.error
}

async function ensureNote(segments, text) {
  const parent = segments.slice(0, -1), cell = segments[segments.length - 1]
  const first = text.split('\n')[0].trim()
  const r = await ask({ op: 'note-list', segments })
  const d = r.ok ? r.data : []
  const items = Array.isArray(d) ? d : (Array.isArray(d?.notes) ? d.notes : [])
  const flat = items.filter(n => !(n?.children || []).length && !n?.mark)
  if (flat.map(n => String(n?.text || '').split('\n')[0].trim()).includes(first)) return 'present'
  if (DRY) return 'would-add'
  const a = await ask({ op: 'note-add', segments: parent, cell, text })
  return a.ok ? 'added' : 'ERR ' + a.error
}

const canonicalNote = (note, mark, children) =>
  JSON.stringify({ children: children || [], mark: mark || null, note, shape: null },
    ['children', 'mark', 'note', 'shape'])

async function putNoteTree(tree) {
  const kids = []
  for (const c of tree.children || []) kids.push(await putNoteTree(c))
  const r = await ask({ op: 'put-resource', text: canonicalNote(tree.note, tree.mark, kids) })
  if (!r.ok) throw new Error('put-resource: ' + r.error)
  return String(r.data.sig)
}

async function attachLists(segments, trees) {
  if (!trees.length) return 'none'
  const roots = []
  for (const t of trees) roots.push(await putNoteTree(t))
  const layer = await ask({ op: 'layer-at', segments })
  const existing = (layer.ok && Array.isArray(layer.data?.notes)) ? layer.data.notes.map(String) : []
  // Editing a list mints a NEW root — carry the old one and the tile shows the
  // list twice. Titles are the identity: a new root REPLACES its namesake.
  const titles = new Set(trees.map(t => t.note))
  const kept = []
  for (const sig of existing) {
    if (roots.includes(sig)) continue
    const r = await ask({ op: 'get-resource', sig })
    let title = null
    if (r.ok) { try { title = JSON.parse(r.data.text)?.note } catch {} }
    if (!titles.has(title)) kept.push(sig)
  }
  const merged = [...kept, ...roots]
  if (merged.length === existing.length && merged.every((s, i) => s === existing[i])) return 'present'
  if (DRY) return 'would-attach'
  const r = await ask({ op: 'bag-set', segments, slot: 'notes', cells: merged })
  return r.ok ? `attached ${roots.length}` : 'ERR ' + r.error
}

const canonicalProps = obj => {
  const out = {}
  for (const k of Object.keys(obj).sort()) out[k] = obj[k]
  return JSON.stringify(out)
}

async function paintArt(segments, pngPath) {
  const lr = await ask({ op: 'layer-at', segments })
  if (!lr.ok) throw new Error('layer-at: ' + lr.error)
  const propsSig = (lr.data.properties || [])[0]
  let props = {}
  if (propsSig) {
    const pr = await ask({ op: 'get-resource', sig: propsSig })
    if (pr.ok && pr.data.encoding === 'text') { try { props = JSON.parse(pr.data.text) } catch {} }
  }
  const b64 = fs.readFileSync(pngPath).toString('base64')
  if (DRY) return 'would-paint'
  const ir = await ask({ op: 'put-resource', base64: b64 })
  if (!ir.ok) throw new Error('put-resource img: ' + ir.error)
  const imgSig = ir.data.sig
  if (props?.small?.image === imgSig && props.substrate === false) return 'already ' + imgSig.slice(0, 12)
  const merged = { ...props, small: { ...(props.small || {}), image: imgSig }, substrate: false }
  const jr = await ask({ op: 'put-resource', text: canonicalProps(merged) })
  if (!jr.ok) throw new Error('put-resource props: ' + jr.error)
  const br = await ask({ op: 'bag-set', segments, slot: 'properties', cells: [jr.data.sig] })
  if (!br.ok) throw new Error('bag-set: ' + br.error)
  const sr = await ask({ op: 'stamp', segments, layer: { substrate: false } })
  if (!sr.ok) throw new Error('stamp: ' + sr.error)
  return 'painted ' + imgSig.slice(0, 12)
}

// ── notes content ─────────────────────────────────────────────────────
const list = (note, children, mark = 'label') => ({ note, mark, children })
const item = (note, mark = 'check_circle') => ({ note, mark, children: [] })
const prose = (note) => ({ note, mark: 'notes', children: [] })

const INSTRUCTION = 'The remodeled Meetup listing for the weekly Hypercomb intro — a post-it: open it for the one-page mockup, follow it to update meetup.com.'

const NOTE = [
  'Meetup remodel — Social Networking for Humanity',
  '',
  'This cell carries the improved copy for the weekly "Introduction Exploring Social Networking for Humanity" Meetup (Saturdays 9:15 AM, Yaletown Galleria, Vancouver — hosts Pavlos & Jaime).',
  '',
  'The post-it on this tile opens into a one-page mockup of the listing as it should read. Meetup controls the real layout — the page is the COPY to carry over, not a design to reproduce. The hook line must stay first: Meetup search results show only the first two lines.',
  '',
  'Why the remodel: the old text led with format instead of the idea, broke a sentence across two paragraphs, and never said concretely what makes Hypercomb different. The new copy leads with ownership ("What if your corner of the internet actually belonged to you?") and makes the differentiators concrete — no algorithm, hive on your own device, complete history, communities that grow by adoption — while keeping the tech (signatures, OPFS, relays) invisible.',
].join('\n')

const LISTS = [
  list('Apply to the Meetup listing', [
    item('Title field: Meet Hypercomb — Social Networking for Humanity (Beginner-Friendly Intro)'),
    item('Description: everything above the Details block of the post-it page, hook line first.'),
    item('First two lines are the search preview — the hook question stays the opening sentence.', 'bolt'),
    item('Keep the tech invisible: say ownership, permanence, exploration — never signatures, OPFS, relays.', 'bolt'),
    item('Cover photo: the page banner — a hive of tiles holding pictures, notes and collections (scripts/bridge/_meetup-postit/meetup-banner.png, regenerate with gen-banner.cjs).'),
    item('Add photos: one screenshot of a real populated hive, one of the room or a laptop showing the comb.'),
    item('Keep "Buzz 500, 5th floor" in How-to-find-us unchanged.'),
  ]),
]

// ── main ──────────────────────────────────────────────────────────────
async function main() {
  await assertRightHive()
  log(`building /${SEGMENTS.join('/')}${DRY ? ' (dry)' : ''}`)

  log('  tile       :', await ensureChild(SEGMENTS))

  // A just-created child may have no layer of its own yet — materialize it
  // before decorating/painting (the site builder's re-link `update` shape).
  if (!DRY) {
    const probe = await ask({ op: 'layer-at', segments: SEGMENTS })
    if (!probe.ok) {
      const mk = await ask({ op: 'update', segments: SEGMENTS, layer: { name: SEGMENTS[SEGMENTS.length - 1] } })
      if (!mk.ok) throw new Error('materialize child layer: ' + mk.error)
      log('  layer      : materialized')
    }
  }

  // The post-it page
  const html = fs.readFileSync(path.join(ASSETS, 'meetup-page.html'), 'utf8')
  let htmlSig = '(dry)'
  if (!DRY) {
    const put = await ask({ op: 'put-resource', text: html })
    if (!put.ok) throw new Error('put page: ' + put.error)
    htmlSig = String(put.data.sig)
    const deco = await ask({
      op: 'decoration-add',
      segments: SEGMENTS,
      kind: KIND,
      appliesTo: SEGMENTS,
      // No wall-clock fields — identical content must mint an identical record.
      payload: { version: 1, title: 'Meetup remodel', htmlSig },
      mark: 'persistent',
      replaceKind: true,
    })
    if (!deco.ok) throw new Error('decoration-add: ' + deco.error)
    log(`  post-it    : html ${htmlSig.slice(0, 12)}… deco ${String(deco.data.sig).slice(0, 12)}…${deco.data.unchanged ? ' (unchanged)' : ''}`)
  }

  log('  instruction:', await ensureNote(SEGMENTS, INSTRUCTION))
  log('  note       :', await ensureNote(SEGMENTS, NOTE))
  log('  lists      :', await attachLists(SEGMENTS, LISTS))
  log('  art        :', await paintArt(SEGMENTS, path.join(ASSETS, 'meetup-tile.png')))

  // Verify by read-back FROM the hive (never trust our own console line).
  if (!DRY) {
    const layer = await ask({ op: 'layer-at', segments: SEGMENTS })
    const decoSigs = Array.isArray(layer?.data?.decorations) ? layer.data.decorations : []
    let found = false
    for (const sig of decoSigs) {
      const r = await ask({ op: 'get-resource', sig })
      if (!r.ok) continue
      try {
        const rec = JSON.parse(r.data.text)
        if (rec.kind === KIND && rec.payload?.htmlSig === htmlSig) { found = true; break }
      } catch {}
    }
    const back = await ask({ op: 'get-resource', sig: htmlSig })
    const roundTrip = back.ok && String(back.data.text || '').includes(MARKER)
    const propsSig = (layer?.data?.properties || [])[0]
    let art = false
    if (propsSig) {
      const pr = await ask({ op: 'get-resource', sig: propsSig })
      if (pr.ok) { try { art = /^[0-9a-f]{64}$/.test(JSON.parse(pr.data.text)?.small?.image || '') } catch {} }
    }
    log(`  verify     : decoration:${found} page:${roundTrip} art:${art}`)
    if (!found || !roundTrip || !art) throw new Error('read-back verification FAILED')

    const rev = await ask({ op: 'build-record', segments: ['revolucion'], label: 'meetup post-it branch' })
    log('  record     :', rev.ok ? `sealed ${String(rev.data.seal || rev.data.label || '').slice(0, 12)}` : 'ERR ' + rev.error)
  }

  log('done')
  try { ws.close() } catch {}
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
