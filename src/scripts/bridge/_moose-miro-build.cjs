// Moose on the Loose — import the Miro board from the board's own data.
//
//   node scripts/bridge/_moose-miro-build.cjs --stage=structure [--dry] [--limit=N]
//   node scripts/bridge/_moose-miro-build.cjs --stage=notes
//   node scripts/bridge/_moose-miro-build.cjs --stage=marks
//   node scripts/bridge/_moose-miro-build.cjs --stage=lists
//   node scripts/bridge/_moose-miro-build.cjs --stage=all
//
// Reads plan.json produced by the scratchpad extractor (see
// documentation/moose-miro-import.md). Every stage is idempotent:
//   structure — `update` merges children, never replaces
//   notes     — gated on the note's own first line
//   marks     — `tag` decorations whose payload IS their identity
//   lists     — note-tree blobs are content-addressed; identical input,
//               identical sig, so `bag-set` writes the same array
//
// Writes are sequential (one layer per change, history never branches);
// reads are pipelined on a single socket.

const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const PLAN = process.env.MOOSE_PLAN || path.join(
  'C:', 'Users', 'Jaime', 'AppData', 'Local', 'Temp', 'claude',
  'C--Projects-hypercomb-social-src', '794930d7-2799-414e-a615-a4bc6f07d7c6',
  'scratchpad', 'miro', 'plan.json')

const arg = (k, d) => { const m = process.argv.find(a => a.startsWith(`--${k}=`)); return m ? m.split('=')[1] : d }
const DRY = process.argv.includes('--dry')
const STAGE = arg('stage', 'structure')
const LIMIT = Number(arg('limit', '0')) || 0
const ONLY = arg('only', '')

const log = (...a) => console.log(...a)

// ── transport ─────────────────────────────────────────────────────────

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
      const p = pending.get(m.id)
      if (p) { pending.delete(m.id); clearTimeout(p.timer); p.res(m) }
    })
  })
  return connected
}

async function call(req, timeoutMs = 90_000) {
  await connect()
  const id = `mm-${Date.now()}-${++seq}`
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(`bridge timeout: ${req.op}`)) }, timeoutMs)
    pending.set(id, { res, rej, timer })
    try { ws.send(JSON.stringify({ ...req, id })) }
    catch (e) { pending.delete(id); clearTimeout(timer); rej(e) }
  })
}

/**
 * Retry through renderer restarts. A big commit can freeze the tab hard
 * enough that it reloads, which drops the socket AND the renderer
 * registration — so back off long enough for a full boot (~30s+) rather
 * than hammering.
 */
async function ask(req, attempts = 10) {
  let wait = 2000
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await call(req)
      if (r.ok || r.error !== 'no renderer connected') return r
    } catch (e) {
      if (/socket closed/i.test(e.message)) connected = null
      if (i === attempts - 1) return { ok: false, error: e.message }
    }
    await new Promise(r => setTimeout(r, wait))
    wait = Math.min(wait * 1.7, 30_000)
    connected = null // force a fresh socket; the old one may be half-dead
  }
  return { ok: false, error: 'renderer never came back' }
}

// ── reads ─────────────────────────────────────────────────────────────

const resourceCache = new Map()
async function resource(sig) {
  if (resourceCache.has(sig)) return resourceCache.get(sig)
  const r = await ask({ op: 'get-resource', sig })
  const v = r.ok ? r.data.text : null
  resourceCache.set(sig, v)
  return v
}

/** Child names of a layer, resolved in parallel. */
async function childNamesOf(segments) {
  const layer = await ask({ op: 'layer-at', segments })
  if (!layer.ok) return null
  const sigs = Array.isArray(layer.data?.children) ? layer.data.children.map(String) : []
  const texts = await Promise.all(sigs.map(resource))
  const names = []
  for (const t of texts) {
    if (!t) continue
    try { const n = JSON.parse(t).name; if (typeof n === 'string' && n.trim()) names.push(n.trim()) } catch {}
  }
  return names
}

async function noteFirstLines(segments) {
  const r = await ask({ op: 'note-list', segments })
  const d = r.ok ? r.data : []
  const items = Array.isArray(d) ? d : (Array.isArray(d?.notes) ? d.notes : [])
  return items.map(n => String(n?.text || '').split('\n')[0].trim())
}

// ── writes ────────────────────────────────────────────────────────────

async function ensureChildren(segments, wanted) {
  const have = await childNamesOf(segments)
  if (have === null) return { ok: false, reason: 'no layer' }
  const missing = wanted.filter(n => !have.includes(n))
  if (!missing.length) return { ok: true, added: 0, total: have.length }
  if (DRY) return { ok: true, added: missing.length, dry: true }
  const name = segments[segments.length - 1]
  // Commit in batches — a single update carrying hundreds of new children
  // freezes the renderer hard enough that the tab reloads mid-write.
  const BATCH = 100
  let running = [...have], added = 0
  for (let i = 0; i < missing.length; i += BATCH) {
    const slice = missing.slice(i, i + BATCH)
    const r = await ask({ op: 'update', segments, layer: { name, children: [...running, ...slice] } })
    if (!r.ok) return { ok: false, reason: r.error, added }
    running = [...running, ...slice]
    added += slice.length
    if (missing.length > BATCH) log(`      … ${added}/${missing.length}`)
  }
  return { ok: true, added }
}

async function ensureNote(parentSegments, cell, text) {
  const first = text.split('\n')[0].trim()
  const have = await noteFirstLines([...parentSegments, cell])
  if (have.includes(first)) return 'present'
  if (DRY) return 'would-add'
  const r = await ask({ op: 'note-add', segments: parentSegments, cell, text })
  return r.ok ? 'added' : 'ERR ' + r.error
}

async function paint(segments, names) {
  if (DRY) return names.length
  let n = 0
  for (const name of names) {
    const r = await ask({ op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name } })
    if (r.ok) n++
  }
  return n
}

// ── hierarchical lists (the notes tree) ───────────────────────────────
// A note blob is canonical key-sorted compact JSON:
//   {"children":[...sigs],"mark":"<icon>|null","note":"<text>","shape":null}
// Seeded palette: label = heading, check_circle / bolt = list, notes = prose.

function canonicalNote(note, mark, children) {
  return JSON.stringify({ children: children || [], mark: mark || null, note, shape: null },
    ['children', 'mark', 'note', 'shape'])
}

/** Write a note tree bottom-up. `tree` = { note, mark, children: [tree] }. Returns the root sig. */
async function putNoteTree(tree) {
  const childSigs = []
  for (const c of tree.children || []) childSigs.push(await putNoteTree(c))
  const text = canonicalNote(tree.note, tree.mark, childSigs)
  const r = await ask({ op: 'put-resource', text })
  if (!r.ok) throw new Error('put-resource failed: ' + r.error)
  return String(r.data.sig)
}

/** Attach root sigs to a tile's `notes` slot, preserving what is already there. */
async function attachNoteRoots(segments, rootSigs) {
  const layer = await ask({ op: 'layer-at', segments })
  const existing = (layer.ok && Array.isArray(layer.data?.notes)) ? layer.data.notes.map(String) : []
  const merged = [...existing]
  for (const s of rootSigs) if (!merged.includes(s)) merged.push(s)
  if (merged.length === existing.length) return 'present'
  if (DRY) return 'would-attach'
  const r = await ask({ op: 'bag-set', segments, slot: 'notes', cells: merged })
  return r.ok ? 'attached' : 'ERR ' + r.error
}

// ── stages ────────────────────────────────────────────────────────────

const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'))
const allTiles = [...plan.tiles, ...plan.companyTiles]
const pick = (t) => !ONLY || t.segments.join('/').includes(ONLY)

async function stageStructure() {
  log('\n── structure ──')
  // deepest-last so parents exist before children
  const branches = plan.branches.slice().sort((a, b) => a.segments.length - b.segments.length)
  let added = 0, failed = 0
  for (const b of branches) {
    if (ONLY && !b.segments.join('/').includes(ONLY) && !ONLY.includes(b.segments.join('/'))) continue
    const r = await ensureChildren(b.segments, b.children)
    if (!r.ok) { failed++; log(`  ! /${b.segments.join('/')}  ${r.reason}`) }
    else if (r.added) { added += r.added; log(`  + /${b.segments.join('/')}  ← ${r.added} new (${b.children.length} wanted)`) }
    else log(`  = /${b.segments.join('/')}  (${r.total} present)`)
  }
  log(`structure: ${added} children added, ${failed} failures`)
}

async function stageNotes() {
  log('\n── notes ──')
  const tiles = allTiles.filter(pick).slice(0, LIMIT || undefined)
  let added = 0, present = 0, err = 0
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]
    const r1 = await ensureNote(t.segments, t.name, t.instruction)
    const r2 = await ensureNote(t.segments, t.name, t.note)
    for (const r of [r1, r2]) {
      if (r === 'added' || r === 'would-add') added++
      else if (r === 'present') present++
      else { err++; if (err <= 10) log(`  ! ${t.segments.join('/')}/${t.name}: ${r}`) }
    }
    if ((i + 1) % 50 === 0) log(`  … ${i + 1}/${tiles.length}  added=${added} present=${present} err=${err}`)
  }
  log(`notes: ${added} added, ${present} already present, ${err} errors`)
}

async function stageMarks() {
  log('\n── marks ──')
  const tiles = allTiles.filter(pick).slice(0, LIMIT || undefined)
  let painted = 0
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]
    painted += await paint([...t.segments, t.name], t.marks)
    if ((i + 1) % 50 === 0) log(`  … ${i + 1}/${tiles.length}  ${painted} marks`)
  }
  log(`marks: ${painted} tag decorations applied`)
}

async function stageLists() {
  log('\n── hierarchical lists ──')

  // 1. the stock register — 566 names the board lists as holdings
  const chunk = (arr, n) => arr.reduce((a, v, i) => (i % n ? a[a.length - 1].push(v) : a.push([v]), a), [])
  const letters = new Map()
  for (const n of plan.stockRegister) {
    const k = (n[0] || '#').toUpperCase()
    if (!letters.has(k)) letters.set(k, [])
    letters.get(k).push(n)
  }
  const registerTree = {
    note: `Stock holdings named by the board (${plan.stockRegister.length})`,
    mark: 'label',
    children: [...letters.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, names]) => ({
      note: `${k} — ${names.length}`,
      mark: 'label',
      children: names.map(n => ({ note: n, mark: 'check_circle', children: [] })),
    })),
  }

  const registerSegs = ['moose-on-the-loose', 'companies', 'stock-register']
  const parent = await ensureChildren(['moose-on-the-loose', 'companies'], ['stock-register'])
  if (!parent.ok) log('  ! could not create stock-register:', parent.reason)
  else {
    const sig = await putNoteTree(registerTree)
    log(`  register root ${sig.slice(0, 12)} → ${await attachNoteRoots(registerSegs, [sig])}`)
  }

  // 2. the rules of this hive, as a list on the root
  const rulesTree = {
    note: 'How this hive is built — rules for anyone adding to it',
    mark: 'label',
    children: [
      { note: 'Every tile is one atomic unit — one claim, one entity, one company.', mark: 'check_circle', children: [] },
      { note: 'Pheromones are the only relation. A claim tile never names its companies in a field; shared marks make them candidates for integration.', mark: 'check_circle', children: [] },
      { note: 'companies/ is the integration layer. A firm named by two boards is ONE tile. Never mint a second tile for a name already in the register.', mark: 'check_circle', children: [] },
      { note: 'Every tile carries a one-line instruction (the claim in a sentence) and a long-form note (the block transcribed, sources listed).', mark: 'check_circle', children: [] },
      { note: 'Keep to the declared mark vocabulary. Extend it in the vocabulary note rather than minting a synonym.', mark: 'check_circle', children: [] },
      { note: 'Everything here is a transcription of what a board asserts, never independently verified, and the notes must say so.', mark: 'bolt', children: [] },
      { note: 'Where a source contradicts itself, WRITE THE CONTRADICTION DOWN rather than silently picking a side.', mark: 'bolt', children: [] },
    ],
  }
  const rootSegs = ['moose-on-the-loose']
  const rulesSig = await putNoteTree(rulesTree)
  log(`  rules root ${rulesSig.slice(0, 12)} → ${await attachNoteRoots(rootSegs, [rulesSig])}`)

  // 3. provenance of this import
  const provTree = {
    note: 'Where this material came from',
    mark: 'label',
    children: [
      { note: 'Source: the public Miro board "Public Moose on the Loose" (miro.com/app/board/uXjVIgUjvog=).', mark: 'notes', children: [] },
      { note: 'Read via Miro\'s /content endpoint, not from screenshots — the board is a canvas, so pixels cannot be read faithfully.', mark: 'notes', children: [] },
      { note: `Imported: ${plan.tiles.length} atomic claims, ${plan.companyTiles.length} company tiles, ${plan.stockRegister.length} stock names.`, mark: 'notes', children: [] },
      { note: '46 of the 58 linked boards return 403 boardAccessDenied and are not in this import. They need to be shared before they can be read.', mark: 'bolt', children: [] },
    ],
  }
  const provSig = await putNoteTree(provTree)
  log(`  provenance root ${provSig.slice(0, 12)} → ${await attachNoteRoots(['moose-on-the-loose', 'miro-board'], [provSig])}`)
}

// ── main ──────────────────────────────────────────────────────────────

/**
 * The broker is LAST-HELLO-WINS: any localhost tab carrying ?claudeBridge=1
 * steals the renderer slot, and the flag persists in localStorage. A stray
 * tab on a different browser profile therefore serves a DIFFERENT hive, and
 * a write aimed at moose-on-the-loose would land in it silently. Refuse to
 * write unless the attached hive is the one that owns this tree.
 */
async function assertRightHive() {
  const root = await ask({ op: 'layer-at', segments: [] })
  if (!root.ok) throw new Error('cannot read the hive root: ' + root.error)
  const sigs = (root.data?.children || []).map(String)
  const texts = await Promise.all(sigs.map(resource))
  const names = []
  for (const t of texts) { if (!t) continue; try { const n = JSON.parse(t).name; if (n) names.push(n) } catch {} }
  if (!names.includes('moose-on-the-loose')) {
    throw new Error(
      'WRONG HIVE — the attached renderer has no /moose-on-the-loose.\n' +
      `  root children: ${names.join(', ')}\n` +
      '  A stray tab stole the broker slot. Re-open the authoring hive with\n' +
      "  Start-Process chrome 'http://localhost:4250/?claudeBridge=1' and close the other tab.")
  }
  log(`hive ok — root holds ${names.length} branches including moose-on-the-loose`)
}

async function main() {
  log(`plan: ${plan.tiles.length} claim tiles, ${plan.companyTiles.length} company tiles, ${plan.branches.length} parent layers`)
  await assertRightHive()
  log(`stage=${STAGE}${DRY ? ' DRY' : ''}${LIMIT ? ` limit=${LIMIT}` : ''}${ONLY ? ` only=${ONLY}` : ''}`)
  const t0 = Date.now()
  if (STAGE === 'structure' || STAGE === 'all') await stageStructure()
  if (STAGE === 'notes' || STAGE === 'all') await stageNotes()
  if (STAGE === 'marks' || STAGE === 'all') await stageMarks()
  if (STAGE === 'lists' || STAGE === 'all') await stageLists()
  // One build record over the pass (build-revisions standard): the import
  // mints resources and stamps many anchors — it must be ONE restorable step.
  if (!DRY) {
    const br = await ask({ op: 'build-record', segments: ['moose-on-the-loose'], label: `Moose Miro import — stage ${STAGE}` })
    log('build record:', br.ok ? 'stamped' : 'ERR ' + br.error)
  }
  log(`\ndone in ${Math.round((Date.now() - t0) / 1000)}s`)
  try { ws.close() } catch {}
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
