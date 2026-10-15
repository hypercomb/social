// Shared by every plate: the 960x400 frame, the hexagon, the four cell styles, markers, flow
// lines, text, cards and the small cast (bee, server, device, check). Tokens only — the page's
// :root is the one sheet; no fonts, gradients, filters or motion inside.
//   const { svg, hex, text, ... } = require('./lib.cjs')
const f1 = n => +n.toFixed(1)
const hexPts = (cx, cy, r) => [[0, -1], [0.866, -0.5], [0.866, 0.5], [0, 1], [-0.866, 0.5], [-0.866, -0.5]]
  .map(([x, y]) => `${f1(cx + x * r)},${f1(cy + y * r)}`).join(' ')
const hex = (cx, cy, r, a = '') => `<polygon points="${hexPts(cx, cy, r)}" ${a}/>`
const LIT = 'fill="var(--honey-fill)" fill-opacity=".16" stroke="var(--honey)" stroke-width="2"'
const CELL = 'fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.5"'
const GHOST = 'fill="none" stroke="var(--line)" stroke-width="1"'
const STEEL = 'fill="var(--panel)" stroke="var(--steel)" stroke-width="1.5"'
const marker = id => `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1,1 L8,5 L1,9" fill="none" stroke="var(--honey)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>`
const markerS = id => `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1,1 L8,5 L1,9" fill="none" stroke="var(--steel)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>`
const flow = (d, mk, w = 2, cls = 'flow') => `<path class="${cls}" d="${d}" pathLength="1" fill="none" stroke="var(--honey)" stroke-width="${w}" stroke-linecap="round" marker-end="url(#${mk})"/>`
const ghost = d => `<path d="${d}" fill="none" stroke="var(--line)" stroke-width="1" stroke-dasharray="4 6" stroke-linecap="round"/>`
const text = (x, y, s, cls = '', size = 18, anchor = 'middle', extra = '') => `<text class="${cls}" x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" ${extra}>${s}</text>`
const svg = (label, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 400" role="img" aria-label="${label}" stroke-linecap="round" stroke-linejoin="round">\n${body}\n</svg>\n`
// a note card: three rules, the first one honey
const note = (x, y, w, h, s = 1) => `<g transform="translate(${x},${y}) scale(${s})"><rect x="0" y="0" width="${w}" height="${h}" rx="3" fill="var(--bg)" stroke="var(--line)" stroke-width="1.2"/>` +
  `<path d="M${w * .18},${h * .3} H${w * .66}" stroke="var(--honey-fill)" stroke-width="2"/><path d="M${w * .18},${h * .52} H${w * .82} M${w * .18},${h * .74} H${w * .7}" stroke="var(--line)" stroke-width="2"/></g>`
// a bee: two hexagons and two wing strokes
const beeDef = id => `<g id="${id}"><polygon points="${hexPts(2, 1, 9)}" fill="var(--honey-fill)"/><polygon points="${hexPts(-11, -3, 5)}" fill="var(--honey-fill)"/>` +
  `<path d="M-1,-7 C1,-15 8,-17 13,-14 M4,-7 C7,-13 13,-14 17,-11" fill="none" stroke="var(--honey)" stroke-width="1.3"/></g>`
// server: three stacked hairline rows
const server = (x, y, w, c = 'var(--steel)') => [0, 1, 2].map(i => `<rect x="${x}" y="${y + i * 34}" width="${w}" height="26" rx="3" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="${x + 13}" cy="${y + i * 34 + 13}" r="2.5" fill="${c}"/>`).join('')
const check = (x, y, c = 'var(--honey)') => `<path d="M${x - 5},${y} L${x - 1.5},${y + 3.5} L${x + 6},${y - 4}" fill="none" stroke="${c}" stroke-width="1.8"/>`
const device = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="none" stroke="var(--dim)" stroke-width="1.5"/>` +
  `<path d="M${x - 22},${y + h + 16} H${x + w + 22}" stroke="var(--line)" stroke-width="1.5"/><path d="M${x + w / 2 - 34},${y + h + 16} h68" stroke="var(--dim)" stroke-width="1.5"/>`


module.exports = { f1, hexPts, hex, LIT, CELL, GHOST, STEEL, marker, markerS, flow, ghost, text, svg, note, beeDef, server, check, device }
