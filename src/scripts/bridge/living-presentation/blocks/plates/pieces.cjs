// The pieces every block plate is drawn with, on top of the tour's own plate
// language (scripts/presentation/plates/lib.cjs): a cell, a card and a wire,
// each a group with a `data-id` so a beat can light it (drawn.cjs). Tokens
// only; the page owns the type, so a piece names a text class (k m d f hy st)
// and never a font.
//
//   const { cell, card, wire, ... } = require('./pieces.cjs')
//   cell('word', 480, 200, 60, 'word', { sub: 'its name', style: LIT })

const crypto = require('crypto')
const lib = require('../../../../presentation/plates/lib.cjs')
const { hex, text, LIT, CELL, GHOST } = lib

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** A part a beat can light; with no id, the same drawing that never dims. */
const group = (id, body) => id ? `<g data-id="${esc(id)}">${body}</g>` : body

/** A hexagon with its word inside, and a small line under it. */
const cell = (id, x, y, r, label, o = {}) => group(id,
  hex(x, y, r, o.style || CELL) +
  (o.inner || '') +
  (label ? text(x, y + (o.sub ? -3 : 6), esc(label), o.cls || 'k', o.size || 18) : '') +
  (o.sub ? text(x, y + 19, esc(o.sub), 'm f', o.subSize || 13) : '') +
  (o.under ? text(x, y + r + 26, esc(o.under), o.underCls || 'k', o.underSize || 17) : ''))

/** A card: a word on a panel, and a small line under it. `lit` draws it honey. */
const card = (id, x, y, w, h, label, o = {}) => group(id,
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${o.fill || 'var(--panel)'}" stroke="${o.lit ? 'var(--honey)' : 'var(--line-strong)'}" stroke-width="1.5"${o.dashed ? ' stroke-dasharray="5 6"' : ''}/>` +
  (o.inner || '') +
  (label ? text(x + w / 2, y + h / 2 + (o.sub ? -3 : 6), esc(label), o.cls || 'k', o.size || 18) : '') +
  (o.sub ? text(x + w / 2, y + h / 2 + 18, esc(o.sub), 'm f', o.subSize || 13) : ''))

/** A wire between two parts; `arrow` names a marker defined in the plate. */
const wire = (id, d, o = {}) => group(id,
  `<path d="${d}" fill="none" stroke="${o.steel ? 'var(--steel)' : 'var(--honey-deep)'}" stroke-width="${o.width || 1.5}"${o.dashed ? ' stroke-dasharray="4 6"' : ''}${o.arrow ? ` marker-end="url(#${o.arrow})"` : ''}/>` +
  (o.label ? text(o.label[0], o.label[1], esc(o.label[2]), o.labelCls || 'm f', o.labelSize || 13) : ''))

/** A gentle S-curve from one point to another, leaving and arriving level. */
const curve = (x1, y1, x2, y2) => {
  const mx = (x1 + x2) / 2
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`
}

/** A curve that leaves downward and arrives level, or the other way round. */
const drop = (x1, y1, x2, y2) => `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`

/** A straight wire between two round parts, stopping short of each. */
const between = (x1, y1, r1, x2, y2, r2) => {
  const d = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / d, uy = (y2 - y1) / d
  return `M${lib.f1(x1 + ux * r1)},${lib.f1(y1 + uy * r1)} L${lib.f1(x2 - ux * r2)},${lib.f1(y2 - uy * r2)}`
}

/** One of the tour's icons (its sprite is on every page), centred on x, y. */
const glyph = (name, x, y, size = 28, color = 'var(--honey)') =>
  `<use href="#i-${name}" x="${lib.f1(x - size / 2)}" y="${lib.f1(y - size / 2)}" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="1.5"/>`

/** The first and last characters of a word's real signature, as the hive makes it. */
const sigOf = (s, head = 6, tail = 4) => {
  const h = crypto.createHash('sha256').update(String(s), 'utf8').digest('hex')
  return `${h.slice(0, head)}…${h.slice(-tail)}`
}

/** An isometric point: x runs right and down, z left and down, y up. */
const iso = (cx, cy, s) => (x, y, z) => [lib.f1(cx + (x - z) * 0.866 * s), lib.f1(cy + (x + z) * 0.5 * s - y * s)]

/** A cube's twelve edges, drawn from an isometric projection. */
const cubeEdges = (p, n, attrs) => {
  const c = [[0, 0, 0], [n, 0, 0], [0, n, 0], [0, 0, n], [n, n, 0], [n, 0, n], [0, n, n], [n, n, n]]
  const key = (v) => v.join(',')
  const out = []
  for (const a of c) for (const b of c) {
    if (key(a) >= key(b)) continue
    if (a.filter((v, i) => v !== b[i]).length !== 1) continue
    const [x1, y1] = p(...a), [x2, y2] = p(...b)
    out.push(`<path d="M${x1},${y1} L${x2},${y2}" ${attrs}/>`)
  }
  return out.join('')
}

module.exports = { ...lib, esc, group, cell, card, wire, curve, drop, between, glyph, sigOf, iso, cubeEdges, LIT, CELL, GHOST }
