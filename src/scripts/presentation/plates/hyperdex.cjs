// 16 — the first impression: visuals/hyperdex.svg
// A domain's root IS its Hyperdex (hyper + index): the domain leads to one index,
// the index points at entries — the business card is one of them, not the holder
// of the list — and the same index can be shown in many views. What the index
// lists is not decided (jwize, 2026-10-15), so the other entries stay unnamed.
const { hexPts, hex, LIT, CELL, marker, flow, text, svg, note } = require('./lib.cjs')

module.exports = () => {
  const IX = 360, IY = 186, IR = 62
  const entries = [88, 152, 220, 284]
  const leaders = entries.map(y => `<path d="M${IX + IR * 0.866},${IY} C450,${IY} 462,${y} ${520 - 24 * 0.866},${y}" fill="none" stroke="var(--line)" stroke-width="1.5"/>`).join('')
  const cells = entries.map((y, i) => hex(520, y, 24, CELL) + (i === 1 ? note(509, 144, 22, 17) : '')).join('')
  const rows = [0, 1, 2].map(i => `<path d="M${IX - 26},${IY - 20 + i * 20} h10" stroke="var(--honey)" stroke-width="2"/><path d="M${IX - 10},${IY - 20 + i * 20} h36" stroke="var(--line)" stroke-width="2"/>`).join('')
  const frame = (y) => `<rect x="648" y="${y}" width="272" height="74" rx="3" fill="var(--panel)" stroke="var(--line)" stroke-width="1.2"/>`
  // view one: a list
  const list = frame(40) + [0, 1, 2, 3].map(i => `<circle cx="668" cy="${54 + i * 15}" r="3" fill="var(--honey-deep)"/><path d="M680,${54 + i * 15} h${150 - i * 22}" stroke="var(--line)" stroke-width="2"/>`).join('')
  // view two: a honeycomb
  const cx = 784, cy = 167, r = 12, w = r * 1.732
  const comb = frame(130) + [[0, 0], [w, 0], [-w, 0], [w / 2, r * 1.5], [-w / 2, r * 1.5], [w / 2, -r * 1.5], [-w / 2, -r * 1.5]]
    .map(([dx, dy], i) => hex(cx + dx, cy + dy, r - 1, i === 0 ? LIT : 'fill="none" stroke="var(--honey-deep)" stroke-width="1.2"')).join('')
  // view three: cards
  const cards = frame(220) + [0, 1, 2, 3].map(i => `<rect x="${664 + i * 63}" y="234" width="50" height="46" rx="2" fill="var(--bg)" stroke="var(--line)" stroke-width="1.2"/>` +
    `<path d="M${672 + i * 63},245 h${i === 0 ? 30 : 22}" stroke="${i === 0 ? 'var(--honey-fill)' : 'var(--line)'}" stroke-width="2"/>`).join('')
  return svg('a domain whose root is its Hyperdex: one index pointing at entries, the business card one of them, shown in many views', [
    `<defs>${marker('hx-ah')}</defs>`,
    `<rect x="40" y="166" width="196" height="44" rx="3" fill="var(--panel)" stroke="var(--steel)" stroke-width="1.5"/>`,
    text(138, 194, 'yourname.com', 'm d', 18),
    flow(`M244,${IY + 2} L${IX - IR * 0.866 - 8},${IY + 2}`, 'hx-ah'),
    hex(IX, IY, IR, LIT), rows,
    text(IX, IY + IR + 34, 'index', 'k hy', 24),
    leaders, cells,
    text(552, 158, 'card', 'd', 18, 'start'),
    list, comb, cards,
    text(784, 330, 'many views', 'd', 18),
  ].join('\n'))
}
