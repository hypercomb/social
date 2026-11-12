// shelf — a tile is placed, never copied or cut (doctrine A7, A9, H7;
// recents-and-the-quick-tray.md). Top, the shelf: a strip always in view,
// holding the tiles you are carrying. Left, one page and a tile on it; a
// dashed line takes a reference to the shelf and writes nothing. Middle,
// another page: the drop is the only write, and the same tile now shows there
// as well. Right, recents: every tile a hive made, once each, newest at the
// centre, hidden ones shaded further out. Bottom right, the one part not
// built: choosing which look a tile lands with.
const { hex, CELL, LIT, GHOST, text, svg, flow, marker, part } = require('../../../../presentation/plates/lib.cjs')

// the shelf: always in view, atop the screen
const shelf = part('shelf',
  `<rect x="150" y="24" width="520" height="56" rx="6" fill="var(--panel)" stroke="var(--honey)" stroke-width="1.5"/>`,
  text(172, 58, 'the shelf', 'k hy', 18, 'start'),
  hex(300, 52, 17, CELL), hex(344, 52, 17, CELL),
  text(652, 57, 'always in view', 'f', 14, 'end'))

// two pages
const page = (x, label) => `<rect x="${x}" y="140" width="250" height="200" rx="3" fill="none" stroke="var(--line-strong)" stroke-width="1.5"/>` +
  text(x + 125, 366, label, 'd', 15)
const pages = part('pages',
  page(60, 'one page'), hex(120, 208, 28, CELL), hex(140, 284, 28, CELL),
  page(390, 'another page'), hex(590, 284, 28, CELL))

// the tile
const atom = part('atom',
  hex(236, 212, 30, LIT),
  text(236, 266, 'a tile', 'k', 15))

// to the shelf: a reference, and nothing written
const take = part('take',
  `<path d="M250,182 C260,130 370,130 386,86" fill="none" stroke="var(--honey)" stroke-width="1.5" stroke-dasharray="4 5"/>`,
  hex(388, 52, 17, LIT),
  text(240, 118, 'a reference, nothing written', 'd', 14, 'end'))

// the drop: the only write
const drop = part('drop',
  flow(`M430,86 C440,130 462,146 470,176`, 'shelf-arrow', 1.8),
  hex(478, 212, 30, LIT),
  text(478, 266, 'the same tile', 'k', 15),
  text(478, 300, 'drop: show here too', 'd', 14),
  text(478, 320, 'Shift: move here', 'd', 14))

// recents: every tile, once, newest at the centre
const C = { x: 810, y: 176 }
const ring = (d, n, off) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2 + off
  return [C.x + Math.cos(a) * d, C.y + Math.sin(a) * d]
})
const recents = part('recents',
  hex(C.x, C.y, 20, LIT),
  ...ring(44, 6, 0).map(([x, y]) => hex(x, y, 14, CELL)),
  ...ring(86, 5, 0.5).map(([x, y]) => hex(x, y, 12, GHOST)),
  text(C.x, 300, 'recents', 'k', 18),
  text(C.x, 322, 'every tile, once', 'f', 14))

// not built: the look a tile lands with
const pick = part('pick',
  `<rect x="700" y="338" width="220" height="50" rx="3" fill="none" stroke="var(--line-strong)" stroke-width="1.2" stroke-dasharray="5 5"/>`,
  text(810, 358, 'which look it lands with', 'k st', 14),
  text(810, 378, 'not built', 'm f', 14))

module.exports = () => svg('the shelf is a strip always in view that holds the tiles you are carrying; a tile on one page sends a reference to the shelf and nothing is written; the drop on another page is the only write, and the same tile shows there too; recents shows every tile once, newest at the centre, hidden ones shaded further out; choosing which look a tile lands with is not built', [
  `<defs>${marker('shelf-arrow')}</defs>`,
  shelf, pages, atom, take, drop, recents, pick,
].join('\n'))
