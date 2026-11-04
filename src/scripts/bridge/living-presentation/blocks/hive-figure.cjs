// A figure made of real tiles, taken out of a running hive (blocks/tiles.cjs):
// each one's own picture in a pointy-top hexagon edged in its own border
// colour, laid out in staggered rows the way the hive lays out a layer. A
// scene the tour filmed in its demo hive shows the author's hive here instead.
//
//   hiveFigure({ tiles: ['revolucion', 'knowledge', ...], title }, media) -> HTML
//   shotFigure({ shot: 'hive-of-pictures', title }, media)                -> HTML
//
// Every picture is a medium named by its signature (media.cjs), so the page
// carries references and the hive stores each picture once.

const fs = require('fs')
const path = require('path')

const TILES = path.join(__dirname, 'tiles')
const CAPTURES = path.join(__dirname, 'captures')
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const icon = (name) => `<svg class="g" aria-hidden="true"><use href="#i-${name}"/></svg>`
const pct = (n) => `${+(n * 100).toFixed(3)}%`
/** The widest a tile is ever drawn, in CSS pixels. */
const TILE_PX = 200

/** The extracted tiles, by route. */
const tileIndex = () => {
  const file = path.join(TILES, 'tiles.json')
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
}

/** Rows of at most five, as even as they can be: 9 → 5,4; 14 → 5,5,4. */
const rowsOf = (n) => {
  const rows = Math.max(1, Math.ceil(n / 5))
  const per = Math.ceil(n / rows)
  return Array.from({ length: rows }, (_, r) => Math.min(per, n - r * per)).filter(k => k > 0)
}

const hiveFigure = (figure, media) => {
  const index = tileIndex()
  const tiles = figure.tiles.map(route => {
    const t = index[route]
    if (!t) throw new Error(`tile ${route} has not been taken out of the hive — node scripts/bridge/living-presentation/blocks/tiles.cjs ${route}`)
    return { route, ...t, src: media.ref(media.add(path.join(TILES, t.file))) }
  })
  // A pointy-top hexagon is √3/2 as wide as it is tall; rows overlap by a
  // quarter of its height, and every other row is pushed half a tile right.
  const rows = rowsOf(tiles.length)
  const per = Math.max(...rows)
  const w = 1, h = 2 / Math.sqrt(3)
  const width = (per + (rows.length > 1 ? 0.5 : 0)) * w
  const height = h + (rows.length - 1) * h * 0.75
  let k = 0
  const cells = rows.flatMap((count, r) => Array.from({ length: count }, (_, i) => {
    const t = tiles[k++]
    const x = (i + (r % 2 ? 0.5 : 0)) * w
    const y = r * h * 0.75
    const place = `left:${pct(x / width)};top:${pct(y / height)};width:${pct(w / width)};height:${pct(h / height)}`
    const edge = t.border ? `--edge:${esc(t.border)};` : ''
    return `<div class="hx" title="${esc(t.name)}" style="${edge}${place}"><img src="${esc(t.src)}" alt="${esc(t.name)}" loading="lazy" decoding="async"></div>`
  }))
  // Its height comes from its own width (the padding), never from a grid
  // pass; its tiles are never drawn wider than TILE_PX, and the caption sits
  // under the tiles, not under the column.
  // --tall-n: the same ratio as a number, so a slide can bound the figure by
  // the height it has (a page is one screen tall).
  return `<div class="figbox hivebox" style="--cap:${Math.round(width * TILE_PX)}px;--tall-n:${+(height / width).toFixed(4)}"><div class="fig hive" style="--tall:${pct(height / width)}" role="img" aria-label="${esc(figure.title)}">${cells.join('')}</div>` +
    `<div class="figcap live">${icon('hex')}<span>live · ${esc(figure.title)}</span></div></div>`
}

/** The size of a WebP capture, from its header. */
const webpSize = (file) => {
  const b = fs.readFileSync(file)
  const kind = b.toString('ascii', 12, 16)
  if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
  if (kind === 'VP8L') { const n = b.readUInt32LE(21); return { width: 1 + (n & 0x3fff), height: 1 + ((n >> 14) & 0x3fff) } }
  return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
}

const shotFigure = (figure, media) => {
  const file = path.join(CAPTURES, `${figure.shot}.webp`)
  if (!fs.existsSync(file)) throw new Error(`capture ${figure.shot} is missing from blocks/captures/`)
  const { width, height } = webpSize(file)
  return `<div class="figbox"><div class="fig shot" style="--ratio:${width}/${height}"><img src="${esc(media.ref(media.add(file)))}" width="${width}" height="${height}" alt="${esc(figure.title)}" decoding="async"></div>` +
    `<div class="figcap live">${icon('hex')}<span>live · ${esc(figure.title)}</span></div></div>`
}

/** A scene's own figure in the hive: real tiles, or a capture. */
const liveFigure = (figure, media) => figure.tiles ? hiveFigure(figure, media) : shotFigure(figure, media)

module.exports = { hiveFigure, shotFigure, liveFigure, rowsOf, tileIndex }
