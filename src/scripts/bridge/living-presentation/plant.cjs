// Plant ONE layer of the living presentation into the hive, by speaking, and
// publish it so it can be seen. This is the canonical loop, the same for
// everyone: one layer, one build revision, one publish.
//
//   node scripts/bridge/living-presentation/plant.cjs [<route>] [--all] [--dry] [--sentences] [--console]
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
// The slash matters: on the command line a bare line is read as prose first,
// and in the tiles stance plain text lays a tile of that name.
// --dry prints the sentences and says nothing; they can also be typed by hand.
// Saying the notes twice files them twice, so re-run with --tiles-only.

const path = require('path')
const { spawnSync } = require('child_process')
const tree = require('./tree.cjs')

const args = process.argv.slice(2)
const valueOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }
const valuesOf = (flag) => args.flatMap((a, i) => a === flag && args[i + 1] && !args[i + 1].startsWith('--') ? [args[i + 1]] : [])
const SENTENCES = args.includes('--sentences')
const CONSOLE = args.includes('--console')
const DRY = args.includes('--dry') || SENTENCES || CONSOLE
const TILES_ONLY = args.includes('--tiles-only')
const PUBLISH_ONLY = args.includes('--publish-only')
const ALL = args.includes('--all')
const DOMAINS = [...new Set(valuesOf('--publish').flatMap(v => v.split(',')).map(d => d.trim().toLowerCase()).filter(Boolean))]
const LABEL = valueOf('--as')
const flagValues = new Set([...valuesOf('--publish'), valueOf('--revision'), LABEL].filter(Boolean))
const route = (args.find(a => !a.startsWith('--') && !flagValues.has(a)) || tree.name).replace(/^\/+|\/+$/g, '')
const SAY = path.join(__dirname, '..', 'say.cjs')

if (PUBLISH_ONLY && !DOMAINS.length) { console.error('--publish-only needs --publish <domain>'); process.exit(2) }
if (args.includes('--publish') && !DOMAINS.length) { console.error('--publish needs a domain, e.g. --publish example.com'); process.exit(2) }
if (args.includes('--as') && (!LABEL || LABEL.startsWith('--'))) { console.error('--as needs a label, e.g. --as presentation'); process.exit(2) }
if (LABEL && !DOMAINS.length) { console.error('--as names an address on a domain: add --publish <domain>'); process.exit(2) }

const segments = route.split('/')
if (segments[0] !== tree.name) { console.error(`the route starts at ${tree.name}`); process.exit(2) }
let node = tree
for (const name of segments.slice(1)) {
  node = (node.children || []).find(child => child.name === name)
  if (!node) { console.error(`no tile ${name} in tree.cjs under /${route}`); process.exit(2) }
}
const children = node.children || []
if (!children.length) { console.error(`/${route} has no planned children yet`); process.exit(2) }

// A build name is a plain word, never a behaviour word: the layer and the minute.
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
const REVISION = valueOf('--revision') || `${segments[segments.length - 1]}-layer-${stamp}`

const noteFor = (tile) => tile.note || tile.name

// The layers to plant: this tile's, and with --all every layer beneath it,
// parents before children.
const layers = []
const walk = (tile, at) => {
  if (!(tile.children || []).length) return
  layers.push({ tile, at })
  if (ALL) for (const child of tile.children) walk(child, `${at}/${child.name}`)
}
walk(node, route)

const sentences = []
if (!PUBLISH_ONLY) {
  if (segments.length === 1) sentences.push('go /', `create ${node.name}`)
  for (const { tile, at } of layers) sentences.push(`go /${at}`, `trait ${tile.children.map(c => c.name).join(' ')}`)
}
if (!TILES_ONLY && !PUBLISH_ONLY) {
  if (segments.length === 1 && node.note) sentences.push(`file on /${route}: ${noteFor(node)}`)
  for (const { tile, at } of layers) for (const child of tile.children) if (child.note) sentences.push(`file on /${at}/${child.name}: ${noteFor(child)}`)
}
sentences.push(`go /${segments[0]}`, `builds ${REVISION}`)
for (const domain of DOMAINS) sentences.push(`publish /${segments[0]} on ${domain}${LABEL ? ` as ${LABEL}` : ''}`)

// The participant's door reads a line as a behaviour only with its slash.
const slashed = sentences.map(line => (line.startsWith('/') ? line : `/${line}`))
if (SENTENCES) { console.log(slashed.join('\n')); process.exit(0) }
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
  : `${DRY ? '[DRY] ' : ''}planting ${ALL ? 'every layer' : 'one layer'} under /${route}: ${children.map(c => c.name).join(', ')}${ALL ? ', and everything beneath them' : ''}\n`)
for (const sentence of sentences) {
  if (DRY) { console.log(sentence); continue }
  // A publish waits for the participant's consent in the browser, so it listens longer.
  const listen = sentence.startsWith('publish ') ? ['--listen', '120000'] : []
  const said = spawnSync(process.execPath, [SAY, sentence, ...listen], { stdio: 'inherit' })
  if (said.status !== 0) {
    console.error(`\nstopped at: ${sentence}\nThe hive's answer is above. Nothing after this line was said.`)
    process.exit(1)
  }
}
const published = DOMAINS.length ? `, published to ${DOMAINS.map(d => `${LABEL || segments[0]}.${d}`).join(', ')}` : ''
const tileCount = layers.reduce((n, { tile }) => n + tile.children.length, 0)
const planted = PUBLISH_ONLY ? `/${route}` : `${tileCount} tiles${TILES_ONLY ? '' : ' and their notes'} in ${layers.length} layer${layers.length === 1 ? '' : 's'} under /${route}`
console.log(`\n${DRY ? '[DRY] ' : ''}${planted}, build ${REVISION}${published}.`)
