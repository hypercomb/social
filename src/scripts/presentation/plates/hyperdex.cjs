// 16 — the first impression: visuals/hyperdex.svg
// jwize 2026-10-16: the primitive is the HIVE; every hive is a hyperdex — the
// hive read from outside, an index of names and signatures that the domain's
// root serves, signed. No structure beside the hive. What the index shows
// depends on the place, and it takes many shapes. So: a domain → your hive
// (a comb, lit) → the same hive read as an index (rows; the business card one
// of them) → many views of that index.
const { hex, LIT, marker, flow, text, svg } = require('./lib.cjs')

module.exports = () => {
  const HX = 344, HY = 186, HR = 62
  // the hive: a small comb inside the lit cell
  const r = 13, w = r * 1.732
  const comb = [[0, 0], [w, 0], [-w, 0], [w / 2, r * 1.5], [-w / 2, r * 1.5], [w / 2, -r * 1.5], [-w / 2, -r * 1.5]]
    .map(([dx, dy], i) => hex(HX + dx, HY + dy, r - 1.5, i === 0
      ? 'fill="var(--honey-fill)" fill-opacity=".55" stroke="var(--honey)" stroke-width="1.5"'
      : 'fill="none" stroke="var(--honey-deep)" stroke-width="1.3"')).join('')
  // the same hive read from outside: an index of names → signatures
  const IX = 450, IY = 92, ROW = 50
  const idx = `<rect x="${IX}" y="${IY}" width="168" height="${ROW * 4}" rx="3" fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.5"/>` +
    [0, 1, 2, 3].map(i => {
      const y = IY + ROW * i + ROW / 2
      const sep = i ? `<path d="M${IX},${IY + ROW * i} h168" stroke="var(--line)" stroke-width="1"/>` : ''
      const mark = hex(IX + 22, y, 8, i === 1 ? LIT : 'fill="none" stroke="var(--honey-deep)" stroke-width="1.2"')
      const name = i === 1 ? '' : `<path d="M${IX + 40},${y} h${[46, 0, 58, 38][i]}" stroke="var(--line)" stroke-width="2"/>`
      const sig = `<path d="M${IX + 118},${y} h34" stroke="var(--steel)" stroke-width="2" stroke-dasharray="3 3"/>`
      return sep + mark + name + sig
    }).join('')
  const frame = y => `<rect x="664" y="${y}" width="256" height="74" rx="3" fill="var(--panel)" stroke="var(--line)" stroke-width="1.2"/>`
  const list = frame(40) + [0, 1, 2, 3].map(i => `<circle cx="684" cy="${54 + i * 15}" r="3" fill="var(--honey-deep)"/><path d="M696,${54 + i * 15} h${140 - i * 22}" stroke="var(--line)" stroke-width="2"/>`).join('')
  const cx = 792, cy = 167, rr = 12, ww = rr * 1.732
  const combView = frame(130) + [[0, 0], [ww, 0], [-ww, 0], [ww / 2, rr * 1.5], [-ww / 2, rr * 1.5], [ww / 2, -rr * 1.5], [-ww / 2, -rr * 1.5]]
    .map(([dx, dy], i) => hex(cx + dx, cy + dy, rr - 1, i === 0 ? LIT : 'fill="none" stroke="var(--honey-deep)" stroke-width="1.2"')).join('')
  const cards = frame(220) + [0, 1, 2, 3].map(i => `<rect x="${678 + i * 60}" y="234" width="48" height="46" rx="2" fill="var(--bg)" stroke="var(--line)" stroke-width="1.2"/>` +
    `<path d="M${686 + i * 60},245 h${i === 0 ? 28 : 20}" stroke="${i === 0 ? 'var(--honey-fill)' : 'var(--line)'}" stroke-width="2"/>`).join('')
  return svg('a domain serves your hive read from outside: an index of names and signatures, the business card one entry, shown in many views', [
    `<defs>${marker('hx-ah')}</defs>`,
    `<rect x="32" y="164" width="188" height="44" rx="3" fill="var(--panel)" stroke="var(--steel)" stroke-width="1.5"/>`,
    text(126, 192, 'yourname.com', 'm d', 18),
    flow(`M228,${HY} L${HX - HR * 0.866 - 8},${HY}`, 'hx-ah'),
    hex(HX, HY, HR, LIT), comb,
    text(HX, HY + HR + 34, 'your hive', 'k hy', 22),
    `<path d="M${HX + HR * 0.866 + 4},${HY} L${IX - 6},${HY}" stroke="var(--honey-deep)" stroke-width="1.5" stroke-dasharray="4 5"/>`,
    idx,
    text(IX + 40, IY + ROW * 1.5 + 6, 'card', 'd', 18, 'start'),
    text(IX + 84, IY + ROW * 4 + 32, 'its index', 'd', 18),
    list, combView, cards,
    text(792, 330, 'many views', 'd', 18),
  ].join('\n'))
}
