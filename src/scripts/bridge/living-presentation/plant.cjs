// Plant ONE layer of the living presentation into the hive, by speaking.
//
//   node scripts/bridge/living-presentation/plant.cjs [<route>] [--dry] [--tiles-only]
//
// <route> is the tile whose children are planted, as a path in tree.cjs:
// `hypercomb` (the default) plants the first layer, the values; a deeper
// route plants that tile's children once tree.cjs names them — always one
// layer, never more.
//
// Every act is a sentence said through say.cjs, the way a participant types it
// (documentation/speak-dont-bridge.md): `go` to the parent, `create` each
// child (the cascade makes the tile itself if it is missing), then `file on`
// a short note on each new tile saying what it is.
// --dry prints the sentences and says nothing; they can also be typed by hand.
// Saying the notes twice files them twice, so re-run with --tiles-only.

const path = require('path')
const { spawnSync } = require('child_process')
const tree = require('./tree.cjs')

const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const TILES_ONLY = args.includes('--tiles-only')
const route = (args.find(a => !a.startsWith('--')) || tree.name).replace(/^\/+|\/+$/g, '')
const SAY = path.join(__dirname, '..', 'say.cjs')

const segments = route.split('/')
if (segments[0] !== tree.name) { console.error(`the route starts at ${tree.name}`); process.exit(2) }
let node = tree
for (const name of segments.slice(1)) {
  node = (node.children || []).find(child => child.name === name)
  if (!node) { console.error(`no tile ${name} in tree.cjs under /${route}`); process.exit(2) }
}
const children = node.children || []
if (!children.length) { console.error(`/${route} has no planned children yet`); process.exit(2) }

const noteFor = (tile) => tile.note || tile.name

const parent = segments.slice(0, -1)
const sentences = [`go /${parent.join('/')}`]
for (const child of children) sentences.push(`create ${node.name}/${child.name}`)
if (!TILES_ONLY) {
  if (segments.length === 1 && node.note) sentences.push(`file on /${route}: ${noteFor(node)}`)
  for (const child of children) if (child.note) sentences.push(`file on /${route}/${child.name}: ${noteFor(child)}`)
}

console.log(`${DRY ? '[DRY] ' : ''}planting one layer under /${route}: ${children.map(c => c.name).join(', ')}\n`)
for (const sentence of sentences) {
  if (DRY) { console.log(sentence); continue }
  const said = spawnSync(process.execPath, [SAY, sentence], { stdio: 'inherit' })
  if (said.status !== 0) {
    console.error(`\nstopped at: ${sentence}\nThe hive's answer is above. Nothing after this line was said.`)
    process.exit(1)
  }
}
console.log(`\n${DRY ? '[DRY] ' : ''}${children.length} tiles${TILES_ONLY ? '' : ' and their notes'} under /${route}.`)
