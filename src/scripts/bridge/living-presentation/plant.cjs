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
// `protocol` (the default) plants the first layer, the values; a deeper
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
//      The top tile is named protocol, so `--publish hypercomb.com` alone is
//      protocol.hypercomb.com. An earlier root (retired.cjs `roots`) is
//      withdrawn from each domain first, `publish /<old> off <domain>`.
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
// Three trees, three relations (tree.cjs): protocol (the values, what is
// shown and published), road (the way ahead, one tour scene per tile) and
// presenter (what shows them). With --all and no route, all are planted; a
// route plants under its own tree.
const ROOTS = tree.roots || [tree]
const named = args.find(a => !a.startsWith('--') && !flagValues.has(a))
const route = (named || tree.name).replace(/^\/+|\/+$/g, '')
const EVERY_ROOT = ALL && !named
const SAY = path.join(__dirname, '..', 'say.cjs')

if (args.includes('--blocks')) {
  // Pages, files and media, not sentences: one console snippet, written to a
  // file (OS temp unless --out names one), since it is long.
  //
  // The media (the voice, the clips, the faces, the captured pictures) are
  // too large to paste, so this serves them on 127.0.0.1 while the snippet
  // runs (the hive's connect-src allows it): the snippet GETs each by its
  // signature, skips any the hive already holds, stores the rest, and checks
  // that the hive named each one by the same signature before a single page
  // is dressed. --port <n> picks the port (default 4271).
  const fs = require('fs')
  const os = require('os')
  const http = require('http')
  const { buildBlocks } = require('./blocks/build.cjs')
  const under = named ? route : ''
  const { blocks, media } = buildBlocks({ under })
  if (!blocks.length) { console.error(`no pages under /${under || '(everything)'} yet (blocks/content.cjs, blocks/tour.cjs)`); process.exit(2) }
  const PORT = Number(valueOf('--port') || 4271)
  const SERVE = `http://127.0.0.1:${PORT}`
  const out = valueOf('--out') || path.join(os.tmpdir(), `living-blocks-${Date.now()}.js`)
  const snippet = `// Paste into the hive tab's console (F12 → Console), then press Enter on the
// hive's command line when it asks. ${blocks.length} pages, their files, and ${media.length} media.
(async () => {
  const ioc = globalThis.ioc
  const bus = globalThis.__hypercombEffectBus
  const store = ioc?.get?.('@hypercomb.social/Store')
  const door = ioc?.get?.('@diamondcoreprocessor.com/TileFilesDrone')
  if (!bus || !store?.putResource || !door?.write) { console.error('Open this in the hive tab: the hive is not here.'); return }
  // 1. The media, each by its signature, before any page names it.
  const media = ${JSON.stringify(media.map(m => ({ sig: m.sig, name: m.name, type: m.type })))}
  let kept = 0, stored = 0
  for (const m of media) {
    if (await store.getResourceLocal?.(m.sig)) { kept++; continue }
    const res = await fetch('${SERVE}/' + m.sig).catch(e => ({ ok: false, statusText: e.message }))
    if (!res.ok) { console.error('Could not fetch ' + m.name + ' (' + res.statusText + '): is plant.cjs --blocks still running?'); return }
    const sig = await store.putResource(new Blob([await res.arrayBuffer()], { type: m.type }))
    if (sig !== m.sig) { console.error(m.name + ' arrived as ' + sig + ', not ' + m.sig + '. Nothing was dressed.'); return }
    stored++
  }
  console.log('Media: ' + stored + ' stored, ' + kept + ' already here.')
  fetch('${SERVE}/done', { method: 'POST' }).catch(() => {})
  // Each file's text once, however many tiles carry it.
  const texts = ${JSON.stringify(Object.fromEntries(blocks.flatMap(b => b.files.map(f => [f.path, f.text]))))}
  const blocks = ${JSON.stringify(blocks.map(b => ({ route: b.route, page: b.page, files: b.files.map(f => ({ name: f.name, path: f.path })) })))}
  // 2. Each page's bytes into the hive (nothing is dressed yet), and each
  //    tile's included files onto it.
  const lines = []
  let files = 0, failed = 0
  for (const b of blocks) {
    const at = '/' + b.route.join('/')
    const sig = await store.putResource(new Blob([b.page], { type: 'text/html' }))
    lines.push('go ' + at, 'website page ' + sig)
    for (const f of b.files) {
      const file = await door.write({ route: b.route, kind: 'file', name: f.name }, texts[f.path])
      if (file.ok) files++; else { failed++; console.error(at + ' ' + f.name + ': ' + file.error) }
    }
  }
  // HOW A TOP TILE OPENS IS LEFT AS IT IS (jwize 2026-11-11). This used to end by saying
  // "opens <top> as hexagons" for every top tile, which took the website pin off the published root: a publish
  // straight after put six hexagons on protocol.hypercomb.com in place of the presentation. The pin is the
  // participant's own word ("opens protocol as website", said from /), and a replant no longer touches it.
  // The walk ends at the top, where the command line is in view whatever the tiles open as.
  lines.push('go /')
  console.log('Files: ' + files + ' written, ' + failed + ' failed.')
  // 3. Dressing each tile with its page is YOUR word, website page <sig>: the
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
  const mb = (media.reduce((n, m) => n + m.size, 0) / 1e6).toFixed(1)
  console.log(`${blocks.length} pages, ${files} files, ${media.length} media (${mb} MB).`)
  console.log(`Console snippet: ${out}`)
  if (args.includes('--no-serve')) process.exit(0)
  const bySig = new Map(media.map(m => [m.sig, m]))
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (req.method === 'POST' && req.url === '/done') {
      res.end('ok')
      console.log('The hive has every medium; the snippet goes on to the pages. Stopping the media server.')
      setTimeout(() => server.close(() => process.exit(0)), 200)
      return
    }
    const m = bySig.get(String(req.url).slice(1))
    if (req.method !== 'GET' || !m) { res.statusCode = 404; res.end('not one of the pages\' media'); return }
    res.setHeader('Content-Type', m.type)
    // a voice part is a slice of its voice's file (blocks/media.cjs)
    fs.createReadStream(m.path, m.start == null ? {} : { start: m.start, end: m.end - 1 }).pipe(res)
  })
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Serving the media on ${SERVE} until the snippet has them (Ctrl+C to stop).`)
    console.log('Open the hive tab, press F12 → Console, paste the file\'s contents, press Enter;')
    console.log('then press Enter on the hive\'s command line to give each tile its page.')
  })
  return
}

if (PUBLISH_ONLY && !DOMAINS.length) { console.error('--publish-only needs --publish <domain>'); process.exit(2) }
if (args.includes('--publish') && !DOMAINS.length) { console.error('--publish needs a domain, e.g. --publish example.com'); process.exit(2) }
if (args.includes('--as') && (!LABEL || LABEL.startsWith('--'))) { console.error('--as needs a label, e.g. --as protocol'); process.exit(2) }
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

/** The children of `at` in the whole tree that wait unpromoted (tree.cjs). */
const waitingUnder = (at) => {
  const [top, ...rest] = at.split('/')
  let node = (tree.all || []).find(r => r.name === top)
  for (const name of rest) node = (node?.children || []).find(c => c.name === name)
  return (node?.children || []).map(c => c.name).filter(name => tree.isWaiting(`${at}/${name}`))
}

const sentences = []
if (!PUBLISH_ONLY) {
  for (const p of plantings) {
    if (p.top) {
      sentences.push('go /', `create ${p.node.name}`)
      // An earlier root is retired at the root, once: its marker forgotten, its tile kept.
      const old = RETIRE && p === plantings[0] ? (retired.roots ?? []).filter(r => !ROOTS.some(x => x.name === r)) : []
      if (old.length) sentences.push(`trait ~ ${old.join(' ')}`)
    }
    for (const { tile, at } of p.layers) {
      sentences.push(`go /${at}`, `trait ${tile.children.map(c => c.name).join(' ')}`)
      // What an earlier planting left, and what now waits unpromoted
      // (tree.cjs WAITING): each marker forgotten, each tile kept.
      const old = RETIRE ? [...(retired.markers[at] ?? []), ...waitingUnder(at)] : []
      if (old.length) sentences.push(`trait ~ ${[...new Set(old)].join(' ')}`)
    }
    // A promoted tile whose every child waits is no layer any more; its old
    // markers are forgotten all the same.
    if (RETIRE && ALL) {
      const layered = new Set(p.layers.map(l => l.at))
      const visit = (node, at) => {
        for (const c of node.children || []) {
          const route = `${at}/${c.name}`
          if (tree.isWaiting(route)) continue
          if (!layered.has(route) && waitingUnder(route).length) sentences.push(`go /${route}`, `trait ~ ${waitingUnder(route).join(' ')}`)
          visit(c, route)
        }
      }
      visit(p.node, p.route)
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
// Each planted tree is sealed as one build; only the protocol (the tree the
// route names, or protocol itself) is published. An earlier root is withdrawn
// from each domain first, so the one address serves the one presentation.
const sealed = [...new Set(plantings.map(p => p.route.split('/')[0]))]
for (const top of sealed) sentences.push(`go /${top}`, `builds ${REVISION}`)
const publishing = EVERY_ROOT ? tree.name : segments[0]
if (RETIRE) for (const domain of DOMAINS) for (const old of retired.roots ?? []) if (old !== publishing) sentences.push(`publish /${old} off ${domain}`)
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
