// The drawn figure of a tile no tour scene explains: a plate in the tour's
// language (scripts/presentation/plates/lib.cjs — the 960×400 frame, the
// hexagon, the four cell styles, tokens only), whose parts a beat can light.
//
// A block names its plate (`plate: 'opening-row'` → plates/opening-row.cjs,
// a module returning the SVG). Every part a beat lights is a group with a
// `data-id`; the page dims the unlit ones while the beats play. A block with
// no plate of its own yet is drawn from its `picture` (nodes and edges) in the
// same language, so every page speaks the one visual language either way.

const fs = require('fs')
const path = require('path')
const lib = require('../../../presentation/plates/lib.cjs')

const PLATES = path.join(__dirname, 'plates')
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const icon = (name) => `<svg class="g" aria-hidden="true"><use href="#i-${name}"/></svg>`

/** The plate check the tour applies to its own (build.cjs, `plate:`): the
 *  page owns the styling, so a plate carries none. */
const checked = (svg, name) => {
  const box = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
  if (!box) throw new Error(`plate ${name} has no viewBox`)
  if (/font-family|@keyframes|feGaussianBlur|Gradient|<style/.test(svg)) throw new Error(`plate ${name} carries styling the page owns`)
  return { svg: svg.trim(), w: +box[1], h: +box[2] }
}

/** A picture's nodes and edges, drawn as a plate. */
const fromPicture = (pic) => {
  const { width = 640, height = 360, nodes = [], edges = [] } = pic
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
  const wires = edges.map(([a, b]) => {
    const p = byId[a], q = byId[b]
    return `<g data-id="${esc(`${a}-${b}`)}"><path d="M${p.x},${p.y} L${q.x},${q.y}" fill="none" stroke="var(--honey-deep)" stroke-width="1.5" stroke-opacity=".7"/></g>`
  }).join('\n')
  const cells = nodes.map(n => {
    const label = esc(n.label ?? n.id)
    const sub = n.sub ? lib.text(n.x, n.y + (n.kind === 'box' ? 22 : 26), esc(n.sub), 'm f', 13) : ''
    const shape = n.kind === 'box'
      ? `<rect x="${n.x - (n.w ?? 150) * 0.6}" y="${n.y - 34}" width="${(n.w ?? 150) * 1.2}" height="68" rx="3" fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.5"/>`
      : lib.hex(n.x, n.y, (n.r ?? 46) * 1.15, lib.CELL)
    return `<g data-id="${esc(n.id)}">${shape}${lib.text(n.x, n.y + (n.sub ? -2 : 6), label, 'k', n.kind === 'box' ? 17 : 16)}${sub}</g>`
  }).join('\n')
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(pic.label ?? '')}" stroke-linecap="round" stroke-linejoin="round">\n${wires}\n${cells}\n</svg>`, w: width, h: height }
}

/** The figure HTML for a block: its plate, framed and captioned as the tour frames one. */
const drawn = (block, key) => {
  let plate
  if (block.plate) {
    const file = path.join(PLATES, `${block.plate}.cjs`)
    if (!fs.existsSync(file)) throw new Error(`${key}: no plate ${block.plate} (blocks/plates/${block.plate}.cjs)`)
    plate = checked(require(file)(), block.plate)
  } else if (block.picture) {
    plate = fromPicture(block.picture)
  } else throw new Error(`${key}: a block no scene explains needs a plate`)
  const lit = new Set((block.beats || []).flatMap(b => b.lit || []))
  const ids = new Set([...plate.svg.matchAll(/data-id="([^"]+)"/g)].map(m => m[1]))
  const missing = [...lit].filter(id => !ids.has(id))
  if (missing.length) throw new Error(`${key}: beats light ${missing.join(', ')}, which the plate does not draw`)
  const caption = block.figcap || (block.plate ? block.plate.replace(/-/g, ' ') : (block.picture?.label || ''))
  return `<div class="figbox"><div class="fig plate${lit.size ? ' beats' : ''}" style="--ratio:${plate.w}/${plate.h}">${plate.svg}</div>` +
    `<div class="figcap plate">${icon('hex')}<span>plate · ${esc(caption)}</span></div></div>`
}

module.exports = { drawn, fromPicture, checked }
