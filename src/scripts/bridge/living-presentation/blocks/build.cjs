// Build the blocks: for every tile with a page, its page, its included files,
// and the media its page names, read from the repo now so a page quotes the
// code as it is and names each medium by the signature of its bytes.
//
// buildBlocks({ under }) -> { blocks: [{ route, page, files }], media: [{ sig, path, name, type, size }] }
//   `under` limits it to routes at or under a route ('protocol/simple').
//
// One tile, one scene. A tile has a page when the tour explains it (tour.cjs)
// or when content.cjs says something for it. A scene tile shows its scene; its
// content may add only what the scene does not say — a picture from a running
// hive, or a part to try, beside the figure, and the source as included files —
// and never a second headline or narration (no idea is said twice; build
// refuses a block that would). A block's `code` excerpts are still checked
// against the source here, so an excerpt that no longer matches fails loudly.

const fs = require('fs')
const path = require('path')
const { render, tryPanel, livePanel } = require('./page.cjs')
const content = require('./content.cjs')
const tree = require('../tree.cjs')
const tour = require('./tour.cjs')
const { createMedia } = require('./media.cjs')
const { drawn } = require('./drawn.cjs')
const { liveFigure, hiveFigure } = require('./hive-figure.cjs')

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
    if (has(content, key) || tour.sceneAt(key)) out.push(key)
    for (const c of node.children || []) walk(c, route)
  }
  for (const r of tree.roots || [tree]) walk(r, [])
  for (const key of [...Object.keys(content), ...Object.keys(tour.SCENES_OF)]) {
    if (tree.isWaiting(key)) continue // set aside, ready (tree.cjs WAITING)
    if (!tileAt(key.split('/'))) throw new Error(`${key} has a page but no tile in tree.cjs`)
  }
  return out
}

/** Where a reader can go from a block, each way said once (jwize 2026-11-06:
 *  "basically all nodes are videos and some have children"; a parent is a
 *  category you choose into, so there is no one road through the tree):
 *    up        the crumbs at the top, and the parent named in the beside row
 *    inside    this tile's children, as cards: each opens the next level down
 *    beside    the tiles under the same parent: previous and next among those
 *              that have a page, and where this one stands among them
 *  A top tile's siblings are the other top tiles (the protocol and the road;
 *  the presenter's machinery is not a page). A tile with no page yet is shown
 *  as coming, and is never what previous or next lands on. */
const waysOf = (route, paged) => {
  const tile = tileAt(route)
  const marked = (at) => (c) => {
    const r = [...at, c.name]
    return { name: c.name, note: c.note || '', route: r, page: paged.has(r.join('/')), current: r.join('/') === route.join('/') }
  }
  const children = (tile?.children || []).map(marked(route))
  // THE SIBLING ROW STAYS PUT (above the video since 2026-11-10; jwize 2026-11-09: "the siblings show
  // together at the bottom ... the first level, and when you click any of those
  // buttons the buttons stay"). On a page below the top it is the tiles beside
  // this one. On a TOP page it is that tile's own first level, so standing on
  // /protocol shows simple, organized, collaborative ... and clicking one of
  // them keeps the same row, lit on the one you are on. A top tile with nothing
  // below it falls back to the other top tiles.
  const first = route.length === 1 ? (tile?.children || []) : []
  const hasFirst = route.length === 1 && first.some(c => paged.has([...route, c.name].join('/')))
  const siblings = (hasFirst
    ? first.map(marked(route))
    : route.length === 1
      ? (tree.roots || []).filter(r => paged.has(r.name)).map(marked([]))
      : (tileAt(route.slice(0, -1))?.children || []).map(marked(route.slice(0, -1))))
  const sectionOf = hasFirst ? route[0] : route.length > 1 ? route[route.length - 2] : ''
  const walkable = siblings.filter(s => s.page)
  const at = walkable.findIndex(s => s.current)
  const beside = {
    at: at + 1,
    of: walkable.length,
    parent: route.length > 1 ? { name: route[route.length - 2], route: route.slice(0, -1), page: paged.has(route.slice(0, -1).join('/')) } : null,
    prev: at > 0 ? walkable[at - 1] : null,
    next: at >= 0 && at < walkable.length - 1 ? walkable[at + 1] : null,
  }
  return { children, section: siblings, sectionOf, beside }
}

/** EXPLORE MORE (jwize 2026-11-10: "all levels have their children as
 *  presentations"). The siblings row only changes which video is selected; to
 *  learn more you go IN: the button opens the first child's presentation, whose
 *  own row is then that level's tiles. The topic is a plain-language noun
 *  authored on the page (`topic`), else the tile's name. Nothing when no page
 *  lies below the tile. */
const exploreOf = (route, paged, block) => {
  const below = (tileAt(route)?.children || []).map(c => [...route, c.name]).filter(r => paged.has(r.join('/')))
  const first = below[0]
  if (!first) return null
  // what lies below, by name: the detail under the button, different on every page
  return { topic: String((block && block.topic) || route[route.length - 1]), to: first, names: below.map(r => r[r.length - 1]) }
}

/** THE TREE MENU (jwize 2026-11-08: "a left hand sidebar menu for the tree"):
 *  every tile that can be walked to, nested as the tree nests, each marked by
 *  whether it has a page yet. The same on every page; the page marks where it
 *  stands. A waiting tile is not in tree.cjs's roots, so it is not here. */
const menuOf = (paged) => {
  const walk = (node, at) => {
    const route = [...at, node.name]
    return { name: node.name, route, page: paged.has(route.join('/')), children: (node.children || []).map(c => walk(c, route)) }
  }
  return (tree.roots || []).filter(r => paged.has(r.name)).map(r => walk(r, []))
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

/** A capture: a picture taken in a running hive (blocks/captures/<shot>.webp|png). */
const liveOf = (l, media) => {
  // tiles taken out of a running hive (blocks/tiles.cjs), drawn as tiles again
  if (l.tiles) return { tiles: true, html: hiveFigure(l, media), title: l.title, caption: l.caption }
  const file = ['webp', 'png'].map(x => path.join(CAPTURES, `${l.shot}.${x}`)).find(f => fs.existsSync(f))
  if (!file) throw new Error(`capture ${l.shot} is missing (blocks/captures/${l.shot}.webp)`)
  return { ...sizeOf(file), src: media.ref(media.add(file)), title: l.title, caption: l.caption, alt: l.alt || l.caption || l.title }
}

/** "1 min": the narration's length, from the voice files (48 kbit/s, the tour's rate). */
const minutesOf = (steps, media) => {
  const bySig = new Map(media.list().map(m => [m.sig, m]))
  const voices = [...new Set(steps.map(s => s.voice).filter(Boolean))]
  const secs = voices.reduce((t, v) => t + bySig.get(v.slice('resource:'.length)).size * 8 / 48000 + 0.8, 0)
  return secs ? `${Math.max(1, Math.round(secs / 60))} min` : ''
}

/** Each voiced step names its voice's parts too (media.cjs): a page that may
 *  stream plays from the first one, anywhere else from the whole voice. */
const inParts = (steps, media) => steps.map(s => {
  const parts = s.voice ? media.partsOf(s.voice) : null
  return parts ? { ...s, parts } : s
})

const SCENE_ONLY = ['title', 'lede', 'eyebrow', 'headline', 'sub', 'picture', 'plate', 'beats']

/** A route's one scene: the tour's, or the block's own beats over its plate.
 *  A capture or a part to try stands beside the figure; a capture's caption is
 *  the scene's last beat, said while the narration turns to it. */
const sceneFor = (key, block, media) => {
  const T = tour.T
  const live = (block.live || []).map(l => liveOf(l, media))
  if (live.length > 1) throw new Error(`${key}: one scene has room for one picture from the hive beside its figure; ${live.length} are named`)
  if (live.length && block.try) throw new Error(`${key}: a capture and a part to try cannot both stand beside the figure`)
  const beside = live.length ? (live[0].tiles ? live[0].html : livePanel(live[0])) : block.try ? tryPanel(block.try) : ''
  const besideStep = live.length ? [{ say: live[0].caption, voice: tour.voiceOf(live[0].caption, media), beside: true }] : []
  const n = tour.sceneAt(key)
  if (n) {
    const said = SCENE_ONLY.filter(k => has(block, k))
    if (said.length) throw new Error(`${key}: tour scene ${n} explains this tile, so its block must not say ${said.join(', ')} again`)
    // A scene the tour filmed in its demo hive shows the author's hive here
    // (figures, by scene number), told in its own words where they differ.
    const own = block.figures?.[n] ?? null
    const p = tour.sceneParts(n, media, own?.say ?? null, !!own)
    if (own) p.figure = liveFigure(own, media)
    // One sentence on screen at a time, each playing its own stretch of the
    // scene's one voice: a scene reads like a film with subtitles.
    const timed = p.voice && p.lines.every(l => l.from !== null)
    const steps = [...p.lines.map(l => ({ say: l.say, voice: timed ? p.voice : null, from: timed ? l.from : null, to: timed ? l.to : null, lit: l.lit })), ...besideStep]
    if (p.voice && !timed) steps.splice(0, p.lines.length, { say: p.caption, voice: p.voice })
    // Every part a sentence lights must be a part of the figure.
    const parts = new Set([...p.figure.matchAll(/data-id="([^"]+)"/g)].map(m => m[1]))
    const unknown = [...new Set(steps.flatMap(st => st.lit || []).filter(id => id !== '*' && !parts.has(id)))]
    if (unknown.length) throw new Error(`${key}: scene ${n}'s lights name ${unknown.join(', ')}, which its figure does not draw`)
    const lights = steps.some(st => Array.isArray(st.lit))
    return { name: p.name, eyebrow: p.eyebrow, headline: p.headline, figure: p.figure, beside, sub: p.sub, link: p.link, steps: inParts(steps, media), lights, minutes: minutesOf(steps, media) }
  }
  for (const k of ['eyebrow', 'headline', 'beats']) if (!has(block, k)) throw new Error(`${key}: a block no scene explains needs its ${k}`)
  const steps = [...block.beats.map(b => ({ say: b.say, voice: tour.voiceOf(b.say, media), lit: b.lit || [] })), ...besideStep]
  return {
    name: T.plain(block.headline).replace(/[.]$/, ''),
    eyebrow: T.esc(T.smart(block.eyebrow)),
    headline: T.emph(block.headline),
    figure: drawn(block, key),
    beside,
    sub: block.sub ? T.emph(block.sub) : '',
    link: null,
    steps: inParts(steps, media),
    minutes: minutesOf(steps, media),
  }
}

const buildBlocks = ({ under = '' } = {}) => {
  const prefix = String(under).replace(/^\/+|\/+$/g, '')
  const media = createMedia()
  const faces = tour.fontFaces(media)
  const sprite = tour.sprite()
  const routes = pagedRoutes()
  const paged = new Set(routes)
  const menu = menuOf(paged)
  const blocks = routes
    .filter(key => !prefix || key === prefix || key.startsWith(`${prefix}/`))
    .map(key => {
      const block = content[key] || {}
      const route = key.split('/')
      const scene = sceneFor(key, block, media)
      return {
        route,
        page: render({
          route,
          title: `${scene.name} · Hypercomb`,
          scene,
          tryPart: block.try || null,
          ways: { ...waysOf(route, paged), menu, explore: exploreOf(route, paged, block) },
          faces,
          sprite,
        }),
        files: filesOf(block.files ?? []),
        code: (block.code ?? []).map(excerpt),
      }
    })
  return { blocks, media: media.list() }
}

module.exports = { buildBlocks, SRC, pagedRoutes }
