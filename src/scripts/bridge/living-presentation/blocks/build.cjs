// Build the blocks: for every tile with a page, its page, its included files,
// and the media its page names, read from the repo now so a page quotes the
// code as it is and names each medium by the signature of its bytes.
//
// buildBlocks({ under }) -> { blocks: [{ route, page, files }], media: [{ sig, path, name, type, size }] }
//   `under` limits it to routes at or under a route ('presentation/simple').
//
// A tile has a page when the tour explains it (tour.cjs) or when content.cjs
// says something for it. A scene tile shows its scene; its content may add
// only what the scene does not say — pictures from a running hive, a part to
// try, the source — and never a second headline or narration (no idea is said
// twice; build refuses a block that would).

const fs = require('fs')
const path = require('path')
const { render } = require('./page.cjs')
const content = require('./content.cjs')
const tree = require('../tree.cjs')
const tour = require('./tour.cjs')
const { createMedia } = require('./media.cjs')
const { drawn } = require('./drawn.cjs')

const SRC = path.join(__dirname, '..', '..', '..', '..')
const CAPTURES = path.join(__dirname, 'captures')

/** The excerpt: `lines` lines from the first line starting with `from`. */
const excerpt = ({ path: rel, from, lines }) => {
  const all = fs.readFileSync(path.join(SRC, rel), 'utf8').split('\n')
  const at = all.findIndex(line => line.startsWith(from))
  if (at < 0) throw new Error(`${rel}: no line starts with ${JSON.stringify(from)}; the block's excerpt needs updating`)
  return { path: rel, text: all.slice(at, at + lines).join('\n') }
}

/** An attached file keeps its own name; a name already taken on the tile gets
 *  its folder in front (two files named index.ts stay two files). */
const filesOf = (rels) => {
  const taken = new Set()
  return rels.map(rel => {
    let name = path.basename(rel)
    if (taken.has(name)) name = `${path.basename(path.dirname(rel))}-${name}`
    taken.add(name)
    return { name, path: rel, text: fs.readFileSync(path.join(SRC, rel), 'utf8') }
  })
}

/** The tile at a route in the trees (tree.cjs), or null. */
const tileAt = (route) => {
  let node = (tree.roots || [tree]).find(r => r.name === route[0])
  for (const name of route.slice(1)) node = node && (node.children || []).find(c => c.name === name)
  return node || null
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** Every route with a page: the tour's tiles and the content's, in tree order. */
const pagedRoutes = () => {
  const out = []
  const walk = (node, at) => {
    const route = [...at, node.name]
    const key = route.join('/')
    if (has(content, key) || tour.stagesOf(key).length) out.push(key)
    for (const c of node.children || []) walk(c, route)
  }
  for (const r of tree.roots || [tree]) walk(r, [])
  for (const key of [...Object.keys(content), ...Object.keys(tour.SCENES_OF)]) {
    if (!tileAt(key.split('/'))) throw new Error(`${key} has a page but no tile in tree.cjs`)
  }
  return out
}

/** Where a reader can go from a block: its children by word, each marked by
 *  whether it has a page yet, and its parent. */
const waysOf = (route, paged) => {
  const tile = tileAt(route)
  const children = (tile?.children || []).map(c => ({
    name: c.name,
    note: c.note || '',
    page: paged.has([...route, c.name].join('/')),
  }))
  return { children, parent: route.length > 1 ? route[route.length - 2] : null, parentRoute: route.slice(0, -1) }
}

/** A WebP or PNG's pixel size, read from its header. */
const sizeOf = (file) => {
  const b = fs.readFileSync(file)
  if (b.toString('ascii', 1, 4) === 'PNG') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16)
    if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
    if (kind === 'VP8L') { const n = b.readUInt32LE(21); return { width: 1 + (n & 0x3fff), height: 1 + ((n >> 14) & 0x3fff) } }
    if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
  }
  throw new Error(`not a PNG or WebP: ${file}`)
}

/** A capture: a picture taken in a running hive (captures.cjs), by name. */
const liveOf = (shots, media) => (shots || []).map(l => {
  const file = ['webp', 'png'].map(x => path.join(CAPTURES, `${l.shot}.${x}`)).find(f => fs.existsSync(f))
  if (!file) throw new Error(`capture ${l.shot} is missing — node scripts/bridge/living-presentation/blocks/captures.cjs ${l.shot}`)
  return { ...sizeOf(file), src: media.ref(media.add(file)), title: l.title, caption: l.caption, alt: l.alt || l.caption || l.title }
})

/** "1 min", "4 min": the narration's length, from the voice files (48 kbit/s, the tour's rate). */
const minutesOf = (steps, media) => {
  const bySig = new Map(media.list().map(m => [m.sig, m]))
  const secs = steps.reduce((t, s) => t + (s.voice ? bySig.get(s.voice.slice('resource:'.length)).size * 8 / 48000 + 0.8 : 0), 0)
  return secs ? `${Math.max(1, Math.round(secs / 60))} min` : ''
}

const SCENE_ONLY = ['title', 'lede', 'eyebrow', 'headline', 'sub', 'picture', 'plate', 'beats']

/** A route's stages: the tour's scenes, or the block's own beats. */
const stagesFor = (key, block, media) => {
  const scened = tour.stagesOf(key)
  if (scened.length) {
    const said = SCENE_ONLY.filter(k => has(block, k))
    if (said.length) throw new Error(`${key}: a tour scene explains this tile, so its block must not say ${said.join(', ')} again`)
    return scened.map(({ label, scenes }) => {
      const parts = scenes.map(n => tour.sceneParts(n, media))
      const steps = parts.map((p, i) => ({ frame: i, say: p.caption, voice: p.voice, name: p.name }))
      return { label, frames: parts, steps, minutes: minutesOf(steps, media), title: parts[0].name }
    })
  }
  for (const k of ['eyebrow', 'headline', 'beats']) if (!has(block, k)) throw new Error(`${key}: a block no scene explains needs its ${k}`)
  const T = tour.T
  const figure = drawn(block, key)
  const steps = block.beats.map(b => ({ frame: 0, say: b.say, voice: tour.voiceOf(b.say, media), lit: b.lit || [] }))
  return [{
    label: '',
    frames: [{ eyebrow: T.esc(T.smart(block.eyebrow)), headline: T.emph(block.headline), figure, sub: block.sub ? T.emph(block.sub) : '', link: null }],
    steps,
    minutes: minutesOf(steps, media),
    title: T.plain(block.headline).replace(/[.]$/, ''),
  }]
}

const buildBlocks = ({ under = '' } = {}) => {
  const prefix = String(under).replace(/^\/+|\/+$/g, '')
  const media = createMedia()
  const faces = tour.fontFaces(media)
  const sprite = tour.sprite()
  const routes = pagedRoutes()
  const paged = new Set(routes)
  const blocks = routes
    .filter(key => !prefix || key === prefix || key.startsWith(`${prefix}/`))
    .map(key => {
      const block = content[key] || {}
      const route = key.split('/')
      const stages = stagesFor(key, block, media)
      return {
        route,
        page: render({
          route,
          title: `${stages[0].title} · Hypercomb`,
          stages,
          live: liveOf(block.live, media),
          tryPart: block.try || null,
          ways: waysOf(route, paged),
          code: (block.code ?? []).map(excerpt),
          faces,
          sprite,
        }),
        files: filesOf(block.files ?? []),
      }
    })
  return { blocks, media: media.list() }
}

module.exports = { buildBlocks, SRC, pagedRoutes }
