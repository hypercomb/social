// Plant ONE layer of the living presentation into the hive, by speaking, and
// publish it so it can be seen. This is the canonical loop, the same for
// everyone: one layer, one build revision, one publish.
//
//   node scripts/bridge/living-presentation/plant.cjs [<route>] [--all] [--dry] [--sentences] [--console] [--say [<url>]]
//                                                     [--tiles-only] [--publish-only]
//                                                     [--publish <domain>]... [--as <label>]
//                                                     [--revision <name>]
//
// <route> is the tile whose children are planted, as a path in tree.cjs:
// `presentation` (the default) plants the first layer, the values; a deeper
// route plants that tile's children. With --all, every layer under the route
// is planted in one pass — the whole mesh — so agents can take tiles in
// parallel, and the pass is still sealed as one build revision.
//
// Every act is a sentence said through say.cjs, the way a participant types it
// (documentation/speak-dont-bridge.md):
//   1. the tile itself is made if it is missing (`create`), then, standing in
//      it, `trait` gives it its children's words as traits: traits are markers,
//      and each one extrudes the tile that fills it;
//   2. `file on` a short note on each new tile saying what it is;
//   3. `builds <name>` on the top tile: the pass sealed as one build revision
//      (it changes nothing when nothing changed);
//   4. with --publish, `publish /<top> on <domain>` for each domain named
//      (repeat the flag, or separate domains with commas): the bytes go to the
//      host and <top>.<domain> opens on the new head, on every domain at once.
//      With --as <label>, the tile gets its own address instead:
//      <label>.<domain> (`publish /<top> on <domain> as <label>`), so
//      The top tile is already named presentation, so `--publish hypercomb.com`
//      alone is presentation.hypercomb.com.
//      Publishing is not joining or sharing; the hive asks for consent in the
//      browser before each publish.
// The usual order is two runs with a step by hand between them: plant the
// layer (steps 1 to 3), give the tiles their pictures in the hive, then run
// again with --publish-only (steps 3 and 4), so the pictures are sealed into
// the revision that gets published.
// No bridge is needed: --sentences prints only the sentences, one per line,
// each with its leading slash, to type into the hive's own command line or
// hand to the hive's chat. --console prints one snippet to paste into the
// hive tab's browser console: it says every sentence through the same door
// Enter uses (`command:submit`), one at a time, as the participant. Saying
// them through the bridge is the optional, scripted way.
// --say posts the sentences to the hive's HTTP door (scripts/hive-say.cjs,
// http://127.0.0.1:4262/say unless a URL follows) and prints what the hive
// said back to each one: the hive's own language, over HTTP, with no file.
// The slash matters: on the command line a bare line is read as prose first,
// and in the tiles stance plain text lays a tile of that name.
// --dry prints the sentences and says nothing; they can also be typed by hand.
// Each planted layer is shown by its own words: after its markers, any marker
// an earlier planting left (retired.cjs) is retired with `trait ~` (its tile
// stays), and `layout on` shows only the markers' children; whatever else is
// referenced there is left out, untouched, one `layout off` away. Before the
// notes are filed, an earlier planting's notes are taken off with `unfile` (a
// list change; history keeps them). --no-retire skips both retirements.
// --blocks [<route>] [--out <file>] writes each tile's BLOCK (its page) and its
// included files (the documents and source it explains), for the tiles under
// the route that have content (blocks/content.cjs). A file's text cannot ride a
// command line, so this writes one snippet to paste into the hive tab's
// console: it stores each page, attaches each file through the hive's own
// tile-files door, then puts `go` and `website page <sig>` lines on the
// command line: dressing a tile with its page is the participant's own word,
// so one Enter says them all (a page a model writes is a trial instead, shown
// as a door to its sandbox). Plant the tiles first; a page needs its tile.
// Saying the notes twice files them twice, so re-run with --tiles-only.

const path = require('path')
const { spawnSync } = require('child_process')
const tree = require('./tree.cjs')
const retired = require('./retired.cjs')

const args = process.argv.slice(2)
const valueOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }
const valuesOf = (flag) => args.flatMap((a, i) => a === flag && args[i + 1] && !args[i + 1].startsWith('--') ? [args[i + 1]] : [])
const SENTENCES = args.includes('--sentences')
const CONSOLE = args.includes('--console')
const HTTP_SAY = args.includes('--say')
const SAY_URL = (() => { const i = args.indexOf('--say'); const v = args[i + 1]; return i >= 0 && v && /^https?:/.test(v) ? v : 'http://127.0.0.1:4262/say' })()
const DRY = args.includes('--dry') || SENTENCES || CONSOLE
const TILES_ONLY = args.includes('--tiles-only')
const RETIRE = !args.includes('--no-retire')
const PUBLISH_ONLY = args.includes('--publish-only')
const ALL = args.includes('--all')
const DOMAINS = [...new Set(valuesOf('--publish').flatMap(v => v.split(',')).map(d => d.trim().toLowerCase()).filter(Boolean))]
const LABEL = valueOf('--as')
const flagValues = new Set([...valuesOf('--publish'), valueOf('--revision'), valueOf('--out'), LABEL, SAY_URL].filter(Boolean))
// Two trees, two relations (tree.cjs): presentation (what is shown, and what is
// published) and presenter (what shows it). With --all and no route, both are
// planted; a route plants under its own tree.
const ROOTS = tree.roots || [tree]
const named = args.find(a => !a.startsWith('--') && !flagValues.has(a))
const route = (named || tree.name).replace(/^\/+|\/+$/g, '')
const EVERY_ROOT = ALL && !named
const SAY = path.join(__dirname, '..', 'say.cjs')

if (args.includes('--blocks')) {
  // Pages and files, not sentences: one console snippet, written to a file
  // (OS temp unless --out names one), since it is long.
  const fs = require('fs')
  const os = require('os')
  const { buildBlocks } = require('./blocks/build.cjs')
  const under = named ? route : ''
  const blocks = buildBlocks({ under })
  if (!blocks.length) { console.error(`no block content under /${under || '(everything)'} yet (blocks/content.cjs)`); process.exit(2) }
  const out = valueOf('--out') || path.join(os.tmpdir(), `living-blocks-${Date.now()}.js`)
  const snippet = `// Paste into the hive tab's console (F12 → Console), then press Enter on the
// hive's command line when it asks. ${blocks.length} pages and their files.
(async () => {
  const ioc = globalThis.ioc
  const bus = globalThis.__hypercombEffectBus
  const store = ioc?.get?.('@hypercomb.social/Store')
  const door = ioc?.get?.('@diamondcoreprocessor.com/TileFilesDrone')
  if (!bus || !store?.putResource || !door?.write) { console.error('Open this in the hive tab: the hive is not here.'); return }
  const blocks = ${JSON.stringify(blocks)}
  // 1. Each page's bytes into the hive (nothing is dressed yet), and each
  //    tile's included files onto it.
  const lines = []
  let files = 0, failed = 0
  for (const b of blocks) {
    const at = '/' + b.route.join('/')
    const sig = await store.putResource(new Blob([b.page], { type: 'text/html' }))
    lines.push('go ' + at, 'website page ' + sig)
    for (const f of b.files) {
      const file = await door.write({ route: b.route, kind: 'file', name: f.name }, f.text)
      if (file.ok) files++; else { failed++; console.error(at + ' ' + f.name + ': ' + file.error) }
    }
  }
  // The presentation OPENS AS its pages: one view:default mark on its top
  // tile, which every tile under it inherits, so walking in shows a page and
  // walking back up lands on one too (a tile with no face of its own drops
  // the website view back to hexagons). \`h\` is hexagons for one visit.
  for (const top of ${JSON.stringify([...new Set(blocks.map(b => b.route[0]))])}) lines.push('go /', 'opens ' + top + ' as website')
  console.log('Files: ' + files + ' written, ' + failed + ' failed.')
  // 2. Dressing each tile with its page is YOUR word, website page <sig>: the
  //    lines wait on the command line, and Enter says them all.
  const outcome = await new Promise(resolve => bus.emitTransient('external:call', {
    from: 'living-blocks', lines, accept: () => {}, complete: resolve,
  }))
  if (outcome?.kind === 'declined') { console.log('Declined: no tile was given its page.'); return }
  const missed = (outcome?.results || []).filter(r => !/^ran/i.test(String(r.verdict || '')))
  console.log('Pages: ' + blocks.length + ' tiles dressed' + (missed.length ? ', ' + missed.length + ' lines did not run:' : '.'))
  for (const r of missed) console.error(r.text + ' → ' + r.verdict)
})()
`
  fs.writeFileSync(out, snippet, 'utf8')
  const files = blocks.reduce((n, b) => n + b.files.length, 0)
  console.log(`${blocks.length} blocks (${blocks.map(b => b.route.at(-1)).join(', ')}) and ${files} files.`)
  console.log(`Console snippet: ${out}`)
  console.log('Open the hive tab, press F12 → Console, paste the file\'s contents, press Enter;')
  console.log('then press Enter on the hive\'s command line to give each tile its page.')
  process.exit(0)
}

if (PUBLISH_ONLY && !DOMAINS.length) { console.error('--publish-only needs --publish <domain>'); process.exit(2) }
if (args.includes('--publish') && !DOMAINS.length) { console.error('--publish needs a domain, e.g. --publish example.com'); process.exit(2) }
if (args.includes('--as') && (!LABEL || LABEL.startsWith('--'))) { console.error('--as needs a label, e.g. --as presentation'); process.exit(2) }
if (LABEL && !DOMAINS.length) { console.error('--as names an address on a domain: add --publish <domain>'); process.exit(2) }

const segments = route.split('/')
const root = ROOTS.find(r => r.name === segments[0])
if (!root) { console.error(`the route starts at ${ROOTS.map(r => r.name).join(' or ')}`); process.exit(2) }
let node = root
for (const name of segments.slice(1)) {
  node = (node.children || []).find(child => child.name === name)
  if (!node) { console.error(`no tile ${name} in tree.cjs under /${route}`); process.exit(2) }
}
const children = node.children || []
if (!children.length) { console.error(`/${route} has no planned children yet`); process.exit(2) }
// What gets planted: the named place, or with --all and no route, every tree.
const plantings = EVERY_ROOT ? ROOTS.map(r => ({ node: r, route: r.name, top: true })) : [{ node, route, top: segments.length === 1 }]

// A build name is a plain word, never a behaviour word: the layer and the minute.
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
const REVISION = valueOf('--revision') || `${segments[segments.length - 1]}-layer-${stamp}`

// Only the reader's note is planted; a tile's `brief` is the builder's and
// stays in the repo (tree.cjs), so the published presentation carries no work
// notes.
const noteFor = (tile) => tile.note || tile.name

// The layers to plant: this tile's, and with --all every layer beneath it,
// parents before children.
const layers = []
const walk = (tile, at, into) => {
  if (!(tile.children || []).length) return
  into.push({ tile, at })
  if (ALL) for (const child of tile.children) walk(child, `${at}/${child.name}`, into)
}
for (const p of plantings) { p.layers = []; walk(p.node, p.route, p.layers); layers.push(...p.layers) }

const sentences = []
if (!PUBLISH_ONLY) {
  for (const p of plantings) {
    if (p.top) sentences.push('go /', `create ${p.node.name}`)
    for (const { tile, at } of p.layers) {
      sentences.push(`go /${at}`, `trait ${tile.children.map(c => c.name).join(' ')}`)
      const old = RETIRE ? retired.markers[at] ?? [] : []
      if (old.length) sentences.push(`trait ~ ${old.join(' ')}`)
    }
  }
  // Layouts last, once every layer's tiles exist: `layout on` seats the
  // named children in the markers' order, and a tile not made yet gets no seat.
  for (const p of plantings) for (const { at } of p.layers) sentences.push(`go /${at}`, 'layout on')
}
if (!TILES_ONLY && !PUBLISH_ONLY) {
  // The earlier planting's notes first, under the routes planted now.
  if (RETIRE) {
    for (const [at, start] of Object.entries(retired.notes)) {
      if (plantings.some(p => at === p.route || at.startsWith(`${p.route}/`))) sentences.push(`unfile on /${at}: ${start}`)
    }
  }
  for (const p of plantings) {
    if (p.top && p.node.note) sentences.push(`file on /${p.route}: ${noteFor(p.node)}`)
    for (const { tile, at } of p.layers) for (const child of tile.children) if (child.note) sentences.push(`file on /${at}/${child.name}: ${noteFor(child)}`)
  }
}
// Each planted tree is sealed as one build; only the presentation (the tree
// the route names, or presentation itself) is published.
const sealed = [...new Set(plantings.map(p => p.route.split('/')[0]))]
for (const top of sealed) sentences.push(`go /${top}`, `builds ${REVISION}`)
const publishing = EVERY_ROOT ? tree.name : segments[0]
for (const domain of DOMAINS) sentences.push(`publish /${publishing} on ${domain}${LABEL ? ` as ${LABEL}` : ''}`)

// The participant's door reads a line as a behaviour only with its slash.
const slashed = sentences.map(line => (line.startsWith('/') ? line : `/${line}`))
if (SENTENCES) { console.log(slashed.join('\n')); process.exit(0) }
if (HTTP_SAY) {
  ;(async () => {
    // One call for the whole planting: the hive shows it on its command line
    // and one Enter there runs every sentence (Escape declines them all).
    console.log(`Asking the hive at ${SAY_URL}; answer on its command line (Enter runs, Esc declines).`)
    const response = await fetch(SAY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-caller': 'living-plant' },
      body: JSON.stringify({ sentences: slashed, from: 'living-plant' }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) { console.error(`refused: ${body.error ?? response.status}`); process.exit(1) }
    const outcome = body.outcome
    if (outcome) {
      if (outcome.kind === 'declined') { console.log('Declined in the hive. Nothing ran.'); process.exit(3) }
      if (outcome.kind === 'refused') { console.error(`refused: ${outcome.reason}`); process.exit(1) }
      for (const result of outcome.results ?? []) console.log(`${result.text}\n  hive: ${result.verdict}`)
      return
    }
    // A door started with --participant answers what the hive showed instead.
    for (const said of body.said ?? []) {
      console.log(said.text)
      for (const line of said.heard ?? []) console.log(`  hive: ${line}`)
    }
  })().catch(error => { console.error(`Could not reach the hive at ${SAY_URL}: ${error?.cause?.message ?? error?.message ?? error}`); process.exit(1) })
  // Said over HTTP; nothing goes through the bridge below. (A CommonJS
  // module may return from its top level.)
  return
}
if (CONSOLE) {
  // Paste into the hive tab's console. Each line goes through the door Enter
  // uses; a pause lets each commit land before the next line. A publish asks
  // for consent in the page, so it is said last.
  console.log(`(async () => {
  const bus = globalThis.__hypercombEffectBus
  if (!bus) { console.error('Open this in the hive tab: no command line here.'); return }
  const lines = ${JSON.stringify(slashed, null, 2)}
  for (const [i, text] of lines.entries()) {
    console.log(\`\${i + 1}/\${lines.length} \${text}\`)
    bus.emit('command:submit', { text })
    await new Promise(r => setTimeout(r, text.startsWith('/go ') ? 1200 : 900))
  }
  console.log('Done. If a publish was said, answer its consent in the page.')
})()`)
  process.exit(0)
}
console.log(PUBLISH_ONLY
  ? `${DRY ? '[DRY] ' : ''}sealing and publishing /${segments[0]}\n`
  : `${DRY ? '[DRY] ' : ''}planting ${ALL ? 'every layer' : 'one layer'} under ${plantings.map(p => `/${p.route}`).join(' and ')}: ${plantings.flatMap(p => (p.node.children || []).map(c => c.name)).join(', ')}${ALL ? ', and everything beneath them' : ''}\n`)
;(async () => {
if (DRY) {
  for (const sentence of sentences) console.log(sentence)
} else {
  // ONE CALL FOR THE WHOLE PLANTING over the bridge: the hive tab shows it on
  // its command line as from living-plant, and one Enter there runs every
  // sentence (Esc declines them all). The bridge carries lines only, and a
  // call of several lines always waits for the participant.
  const WebSocket = require('ws')
  const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
  const outcome = await new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE, { maxPayload: 128 * 1024 * 1024 })
    const id = `plant-${Date.now()}`
    ws.on('error', error => reject(new Error(`cannot reach the hive over the bridge at ${BRIDGE} (npm run bridge, and the hive tab open with ?claudeBridge=1): ${error.message}`)))
    ws.on('open', () => {
      console.log('Asked the hive. Answer on its command line: Enter runs every sentence, Esc declines.')
      ws.send(JSON.stringify({ id, op: 'submit', from: 'living-plant', text: slashed.join('\n') }))
    })
    ws.on('message', raw => {
      let m; try { m = JSON.parse(String(raw)) } catch { return }
      if (m.id !== id) return
      ws.close()
      if (!m.ok) reject(new Error(/renderer/i.test(String(m.error))
        ? `${m.error}: open the hive at http://localhost:4250/?claudeBridge=1 in your browser (once is enough; it remembers), wait for it to load, and run this again`
        : m.error || 'refused'))
      else resolve(m.data && m.data.outcome)
    })
  }).catch(error => { console.error(error.message); process.exit(1) })
  if (!outcome || outcome.kind === 'refused') { console.error(`refused: ${outcome ? outcome.reason : 'no answer'}`); process.exit(1) }
  if (outcome.kind === 'declined') { console.log('Declined in the hive. Nothing ran.'); process.exit(3) }
  for (const result of outcome.results || []) console.log(`${result.text}\n  hive: ${result.verdict}`)
}
const published = DOMAINS.length ? `, published to ${DOMAINS.map(d => `${LABEL || publishing}.${d}`).join(', ')}` : ''
const tileCount = layers.reduce((n, { tile }) => n + tile.children.length, 0)
const planted = PUBLISH_ONLY ? `/${publishing}` : `${tileCount} tiles${TILES_ONLY ? '' : ' and their notes'} in ${layers.length} layer${layers.length === 1 ? '' : 's'} under ${plantings.map(p => `/${p.route}`).join(' and ')}`
console.log(`\n${DRY ? '[DRY] ' : ''}${planted}, build ${REVISION}${published}.`)
})()
