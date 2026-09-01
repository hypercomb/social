// Moose on the Loose — paint ONE tile at a time, root to leaf.
//
//   node scripts/bridge/_moose-paint.cjs <tile-key> [--dry]
//   node scripts/bridge/_moose-paint.cjs --list
//
// A tile is "painted" when it carries everything it should:
//   instruction  one line — what this tile is
//   note         long form — the detail
//   lists        hierarchical lists for rules, maps, structured detail
//   marks        pheromones, from the declared vocabulary only
//   face         an image, where the board has one
//
// Definitions live in TILES below. Everything is idempotent: notes gate on
// their first line, note-tree blobs are content-addressed so an unchanged
// list re-writes the same sig, and marks are tag decorations keyed by payload.

const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const DRY = process.argv.includes('--dry')
const KEY = process.argv.slice(2).find(a => !a.startsWith('--'))
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

// Child reads and child creation come from ONE implementation, shared with
// every other bridge script: scripts/lib/hive-children.mjs. The loops this
// replaces decoded child names with `get-resource`, which CANNOT work — a
// parent's `children` slot holds LAYER sigs and a layer sig is not a resource
// — so every parent read as EMPTY, and that empty read fed a `children:`
// update, which the committer applies by REPLACING the slot.
let namesOfChildSigs, childNamesOf, cellExists, ensureChildren
async function bindHiveHelpers() {
  const { hiveChildren } = await import('../lib/hive-children.mjs')
  ;({ namesOfChildSigs, childNamesOf, cellExists, ensureChildren } = hiveChildren(ask))
}

// ── guard: never write into the wrong hive ────────────────────────────
async function assertRightHive() {
  const root = await ask({ op: 'layer-at', segments: [] })
  if (!root.ok) throw new Error('cannot read hive root: ' + root.error)
  const names = await namesOfChildSigs(root.data?.children || [], '_moose-paint.cjs')
  if (!names.includes('moose-on-the-loose')) {
    throw new Error('WRONG HIVE — no /moose-on-the-loose. A stray tab stole the broker slot.\n  root: ' + names.join(', '))
  }
}

// ── primitives ────────────────────────────────────────────────────────
/**
 * `role` is 'instruction' (one line) or 'note' (long form). Both gate on
 * the note's own first line, but an instruction ALSO stands down when the
 * tile already carries a short flat note — an earlier pass has already
 * said what this tile is, and two one-liners saying the same thing in
 * different words is worse than one.
 */
async function ensureNote(segments, text, role = 'note') {
  const parent = segments.slice(0, -1), cell = segments[segments.length - 1]
  const first = text.split('\n')[0].trim()
  const r = await ask({ op: 'note-list', segments })
  const d = r.ok ? r.data : []
  const items = Array.isArray(d) ? d : (Array.isArray(d?.notes) ? d.notes : [])
  const flat = items.filter(n => !(n?.children || []).length && !n?.mark)
  if (flat.map(n => String(n?.text || '').split('\n')[0].trim()).includes(first)) return 'present'
  if (role === 'instruction' && flat.some(n => String(n?.text || '').trim().length < 300)) {
    return 'skipped (tile already states what it is)'
  }
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
  const merged = [...existing]
  for (const s of roots) if (!merged.includes(s)) merged.push(s)
  if (merged.length === existing.length) return 'present'
  if (DRY) return 'would-attach ' + roots.map(s => s.slice(0, 10)).join(',')
  const r = await ask({ op: 'bag-set', segments, slot: 'notes', cells: merged })
  return r.ok ? `attached ${roots.length}` : 'ERR ' + r.error
}

async function paintMarks(segments, names) {
  if (!names?.length) return 0
  if (DRY) return names.length
  let n = 0
  for (const name of names) {
    const r = await ask({ op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name } })
    if (r.ok) n++
  }
  return n
}

// ── tile definitions ──────────────────────────────────────────────────
const M = 'moose-on-the-loose'
const list = (note, children, mark = 'label') => ({ note, mark, children })
const item = (note, mark = 'check_circle') => ({ note, mark, children: [] })
const prose = (note) => ({ note, mark: 'notes', children: [] })

const TILES = {
  root: {
    segments: [M],
    lists: [
      list('How this hive is built — rules for anyone adding to it', [
        item('Every tile is one atomic unit — one claim, one entity, one company.'),
        item('Pheromones are the only relation. A claim tile never names its companies in a field; shared marks make them candidates for integration.'),
        item('companies/ is the integration layer. A firm named by two boards is ONE tile. Never mint a second tile for a name already in the register.'),
        item('Every tile carries a one-line instruction — what it is — and a long-form note holding the detail.'),
        item('Keep to the declared mark vocabulary. Extend it in the vocabulary note rather than minting a synonym.'),
        item('Everything here is a transcription of what a board asserts, never independently verified, and the notes must say so.', 'bolt'),
        item('Where a source contradicts itself, WRITE THE CONTRADICTION DOWN rather than silently picking a side.', 'bolt'),
        item('Paint root to leaf. A branch is finished before its children are filled in.', 'bolt'),
      ]),
      list('What is in here', [
        list('people/', [prose('The individuals. Each conflict hangs off the person it belongs to.')]),
        list('companies/', [prose('THE INTEGRATION LAYER — the register of firms the boards name. Later material folds into the existing tile.')]),
        list('network/', [prose('The relationship map the board draws with connectors: 522 entities and the associations between them.')]),
        list('carbon-credit-system/', [prose('How carbon credits are said to work and who profits.')]),
        list('net-zero/', [prose('Net zero, the Liberal timeline of it, and the climate policies attached.')]),
        list('china/', [prose('China-linked entities, meetings and influence operations the board alleges.')]),
        list('artificial-intelligence/', [prose('AI holdings, AI infrastructure and data centres.')]),
        list('dairy-supply-management/', [prose('Dairy and supply management.')]),
        list('liberal-party/', [prose('The party, its people and its policies.')]),
        list('miro-board/', [prose('The source board — captures and import provenance.')]),
      ]),
      list('Where this material came from', [
        prose('Source: the public Miro board "Public Moose on the Loose" — miro.com/app/board/uXjVIgUjvog='),
        prose('Read through Miro\'s /content endpoint rather than from screenshots. The board is a canvas, so pixels cannot be read faithfully.'),
        prose('Imported: 1226 atomic claims, 97 company tiles, 522 network entities, 566 further stock names.'),
        item('46 of the 58 boards it links to return 403 boardAccessDenied. They are not in this import and need to be shared before they can be read.', 'bolt'),
      ]),
    ],
    marks: [],
  },

  people: {
    segments: [M, 'people'],
    instruction: 'The individuals the boards name, and what hangs off each of them.',
    note: [
      'People',
      '',
      'One tile per individual. Everything a board alleges about a person hangs off that person\'s tile rather than being scattered through the topic branches — so a second board naming the same person lands here instead of starting a rival tree.',
      '',
      'A person tile carries who the board says they are, the positions it attributes to them, and the branches holding the specific claims. It carries no verdict.',
      '',
      'TRANSCRIBED from the Miro board "Public Moose on the Loose". This is what the board asserts; it has not been independently verified.',
    ].join('\n'),
    lists: [
      list('How a person is filed here', [
        item('One tile per individual — never a second tile for a name already here.'),
        item('Claims hang off the person, in a branch named for the kind of claim.'),
        item('The person tile states positions and associations; the leaves carry the individual claims and their sources.'),
        item('Marks do the relating. A person and a company that share marks are candidates for integration, not an assertion that they are connected.', 'bolt'),
      ]),
    ],
    marks: ['canada'],
  },

  companies: {
    segments: [M, 'companies'],
    instruction: 'The register of firms the boards name — one tile per company, and the layer every other branch folds into.',
    note: [
      'Companies',
      '',
      'THE INTEGRATION LAYER. A firm named by two different boards, or by two different sections of one board, is ONE tile here. New material about a company lands on the tile that already exists. Never mint a second tile for a name already in the register.',
      '',
      'This is what makes the hive accumulate rather than sprawl. The claim tiles across people/, network/ and the topic branches do not name their companies in a field — they carry marks, and a company carrying the same marks becomes a candidate for integration. The register is where those candidates meet.',
      '',
      'WHAT IS IN THE REGISTER',
      '  24 companies from the first pass, read from board screenshots',
      '  97 added from the board\'s own data — 89 the board heads as a direct conflict, 8 it lists as RRSP holdings',
      '  566 further names the board lists only as stock holdings, held as a list on stock-register rather than as tiles',
      '',
      'A name is promoted from the stock register to its own tile as soon as something other than the holdings list argues about it.',
      '',
      'TRANSCRIBED from the Miro board "Public Moose on the Loose". Holdings are as the board lists them; they have not been independently verified.',
    ].join('\n'),
    lists: [
      list('Rules of the register', [
        item('One tile per firm. A name already here never gets a second tile.'),
        item('Fold new material onto the existing tile rather than beside it.'),
        item('Suffix variants are the same firm — Inc, Corp, Ltd, PLC, NV, LP all fold to one name.'),
        item('Marks relate. A company tile never lists the claims that touch it; shared marks make the connection.'),
        item('Promote a stock-register name to its own tile the moment a claim argues about it.', 'bolt'),
        item('The board lists holdings; it does not establish that a holding is a conflict. Keep those two marks distinct.', 'bolt'),
      ]),
      list('How a company got here', [
        list('conflict-of-interest', [prose('89 firms the board heads as a direct conflict — a decision moving money toward a company a position is held in.')]),
        list('rrsp', [prose('8 firms the board lists as RRSP holdings.')]),
        list('carney-invested', [prose('566 further names appearing in the disclosed stock list, held on stock-register.')]),
        prose('The most connected firm on the board by a wide margin is Brookfield Asset Management — 85 connectors against Carney\'s 45. Its government contracts hang off companies/brookfield.'),
      ]),
    ],
    marks: ['company'],
  },

  'stock-register': {
    segments: [M, 'companies', 'stock-register'],
    create: true,
    instruction: 'The stock holdings the board lists but does not argue about — held as a list, not as 566 tiles.',
    note: [
      'Stock register',
      '',
      'The board lists these names verbatim as "Stock:" lines in its holdings sections. It makes no claim about them beyond the fact of the holding — no decision, no procurement, no beneficiary argument. Minting a tile for each would bury the hundred companies that do carry an argument under five hundred that do not.',
      '',
      'So they live here as one hierarchical list. A name is PROMOTED to its own tile in companies/ the moment anything other than the holdings list argues about it — and at that point it should be removed from this list, so the list only ever holds the names nothing has been said about.',
      '',
      'Companies the board heads as a direct conflict, or lists as an RRSP holding, are already tiles in companies/ and are not repeated here.',
      '',
      'TRANSCRIBED from the Miro board "Public Moose on the Loose". These are holdings as the board lists them, not an assertion of conflict, and they have not been independently verified.',
    ].join('\n'),
    lists: 'stock-register',
    marks: ['carney-invested', 'finance'],
  },

  'mark-carney': {
    segments: [M, 'people', 'mark-carney'],
    instruction: 'Mark Carney — Prime Minister of Canada, former Governor of the Bank of England and of the Bank of Canada; the person this board is built around.',
    note: [
      'Mark Carney',
      '',
      'The board describes him as former Governor of the Bank of England, later Prime Minister of Canada, and places him at the centre of a network joining Brookfield, the Liberal Party, and a set of climate-finance institutions.',
      '',
      'The board\'s case, in its own terms, is that decisions taken by the Canadian government under his leadership benefit firms and funds he has held positions in or advised. Each specific allegation lives in a branch below, one claim per tile, with the sources the board cites.',
      '',
      'WHAT THE BOARD ATTRIBUTES TO HIM',
      '  UN Special Envoy on Climate Finance',
      '  Chair, Financial Stability Board',
      '  Advisor to Prime Minister Justin Trudeau',
      '  Positions at Brookfield, including stock options the board values at USD 6.8 million',
      '  Association with the World Economic Forum, Chatham House, the Council for Inclusive Capitalism, the Peterson Institute, the Century Initiative and Macro Advisory Partners',
      '',
      'He is the most connected person on the board — 45 connectors — though Brookfield Asset Management is more connected still, at 85.',
      '',
      'TRANSCRIBED from the Miro board "Public Moose on the Loose". This is what the board asserts; it has not been independently verified. Where the board contradicts itself, the contradiction is written down on the tile that carries it rather than resolved here.',
    ].join('\n'),
    lists: [
      list('What hangs off him', [
        list('conflicts-of-interest/', [prose('56 claims the board heads as direct conflicts — a sector, a project or procurement, and a firm he is said to hold a position in.')]),
        list('lie-tracker/', [prose('75 claims that a public statement was contradicted by the record.')]),
        list('pensions-to-profits/', [prose('29 claims about pension capital flowing to private funds.')]),
        list('stock-conflicts/', [prose('18 claims drawn from the disclosed stock holdings.')]),
        list('assets/', [prose('13 claims about what he owns, with the disclosure documents the board attaches.')]),
        list('ukraine-rebuild/', [prose('13 claims about reconstruction investment.')]),
        list('cabinet-conflicts/', [prose('9 claims about members of his cabinet.')]),
        list('indirect-conflicts/', [prose('6 claims of conflict at one remove.')]),
        list('major-projects/', [prose('The projects the board tracks against him.')]),
      ]),
      list('Directly connected on the board (31 connectors)', [
        list('Brookfield, funds and holdings', [
          item('Brookfield'), item('Brookfield Asset Management'),
          item('6.8 Million USD in Stock Options with Brookfield', 'bolt'),
          item('Qatar Investment Authority'), item('PIMCO'), item('Stripe'),
          item('Palantir'), item('Teck Resources'),
          item('Watershed Technology, Inc.'), item('Cultivo Land PBC'),
          item('Michael Moritz'),
        ]),
        list('Institutions and policy bodies', [
          item('Financial Stability Board (FSB)'), item('World Economic Forum'),
          item('Chatham House'), item('Peterson Institute for International Economics'),
          item('Council for Inclusive Capitalism'), item('Century Initiative'),
          item('Macro Advisory Partners'), item('Bloomberg L.P.'),
          item('Harvard University'),
          item('Blavatnik School of Government, University of Oxford'),
          item('Hoffmann Institute for Global Business and Society, INSEAD'),
        ]),
        list('Politics and people', [
          item('Liberal Party'), item('Katie Telford'), item('Diana Fox Carney'),
          item('Evan Solomon'), item('Andrew Bailey'),
          item('Economic Advisor'), item('Former Prime Minister of Canada'),
        ]),
        list('Media', [
          item('CBC'), item('Fired from CBC — art dealings with guests', 'bolt'),
        ]),
        prose('These are the connectors drawn on the board, not a claim that each is a conflict. The board leaves most of them unlabelled.'),
      ]),
    ],
    marks: ['person', 'canada', 'finance'],
  },
}

/** Create the tile under its parent if it is not there yet. */
/**
 * Create the leaf of `segments` under its parent. Existence is checked on the
 * CHILD PATH and creation goes through `op:'add'`, which the committer turns
 * into an APPEND — so this cannot drop a sibling, whatever any read believed.
 * See scripts/lib/hive-children.mjs.
 */
async function ensureChild(segments) {
  const parent = segments.slice(0, -1), name = segments[segments.length - 1]
  const layer = await ask({ op: 'layer-at', segments: parent })
  if (!layer.ok) throw new Error('no parent layer at /' + parent.join('/'))
  if (await cellExists(segments)) return 'present'
  if (DRY) return 'would-create'
  const u = await ensureChildren(parent, [name])
  return u.ok ? 'created' : 'ERR ' + u.error
}

// The stock register's list is data, not prose — build it from the mined
// register so it stays in step with the source rather than drifting.
function stockRegisterLists() {
  const REG = JSON.parse(fs.readFileSync(path.join(
    'C:', 'Users', 'Jaime', 'AppData', 'Local', 'Temp', 'claude',
    'C--Projects-hypercomb-social-src', '794930d7-2799-414e-a615-a4bc6f07d7c6',
    'scratchpad', 'miro', 'companies.json'), 'utf8'))
  const stock = REG.filter(c => !c.kinds.includes('conflict') && !c.kinds.includes('rrsp'))
  const letters = new Map()
  for (const c of stock) {
    const k = (c.name[0] || '#').toUpperCase()
    if (!letters.has(k)) letters.set(k, [])
    letters.get(k).push(c.name)
  }
  return [list(`Stock holdings the board lists (${stock.length})`,
    [...letters.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, names]) => list(`${k} — ${names.length}`, names.map(n => item(n)))))]
}

// ── main ──────────────────────────────────────────────────────────────
async function main() {
  await bindHiveHelpers()
  if (process.argv.includes('--list')) { log('tiles:', Object.keys(TILES).join(', ')); return }
  const def = TILES[KEY]
  if (!def) { console.error(`unknown tile "${KEY}". Known: ${Object.keys(TILES).join(', ')}`); process.exit(1) }

  await assertRightHive()
  const p = '/' + def.segments.join('/')
  log(`painting ${p}${DRY ? ' (dry)' : ''}`)

  if (def.create) log('  tile       :', await ensureChild(def.segments))
  if (def.instruction) log('  instruction:', await ensureNote(def.segments, def.instruction, 'instruction'))
  if (def.note) log('  note       :', await ensureNote(def.segments, def.note, 'note'))
  const lists = def.lists === 'stock-register' ? stockRegisterLists() : def.lists
  if (lists) log('  lists      :', await attachLists(def.segments, lists))
  if (def.marks?.length) log('  marks      :', await paintMarks(def.segments, def.marks), 'applied')

  // One build record over the pass — a paint mints resources and stamps the
  // tile across slots, so the whole thing must be ONE restorable step
  // (build-revisions standard, enforced by the doctrine ratchet).
  if (!DRY) {
    const br = await ask({ op: 'build-record', segments: [M], label: `Moose paint — ${p}` })
    log('  record     :', br.ok ? 'stamped' : 'ERR ' + br.error)
  }

  log('done')
  try { ws.close() } catch {}
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
