// hiding — hide first, delete second (doctrine H4, B3;
// hide-first-delete-second.md). Left, a list: the one removing act it offers
// is hide. Middle, the delete area, a fold opened on purpose, holding only
// what was hidden; an arrow runs back, because one press returns it. Delete
// exists only inside that area. Right, another host: the same bytes are still
// there and still valid, because delete is a local forget. Bottom right, what
// is never wiped: your tiles, your history and your pools.
const { hex, LIT, text, svg, flow, marker, server, check, part } = require('../../../../presentation/plates/lib.cjs')

const ROWS = [100, 145, 190, 235]
const row = (x, y, w, c = 'var(--line-strong)') => `<path d="M${x},${y} H${x + w}" stroke="${c}" stroke-width="2"/>`

// a list: rows, and nothing to remove them with but hide
const LIST = { x: 60, y: 70, w: 230, h: 200 }
const list = part('list',
  text(LIST.x + LIST.w / 2, 54, 'a list', 'k', 18),
  `<rect x="${LIST.x}" y="${LIST.y}" width="${LIST.w}" height="${LIST.h}" rx="3" fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.5"/>`,
  ...ROWS.map(y => row(LIST.x + 20, y, 120)))

const hide = part('hide',
  `<rect x="214" y="131" width="62" height="28" rx="14" fill="var(--bg)" stroke="var(--honey)" stroke-width="1.5"/>`,
  text(245, 150, 'hide', 'k', 15),
  flow(`M296,145 H382`, 'hiding-arrow', 1.8))

// the delete area: only what you already put away
const AREA = { x: 390, y: 70, w: 230, h: 200 }
const area = part('area',
  text(AREA.x + AREA.w / 2, 54, 'the delete area', 'k', 18),
  `<rect x="${AREA.x}" y="${AREA.y}" width="${AREA.w}" height="${AREA.h}" rx="3" fill="none" stroke="var(--line-strong)" stroke-width="1.5" stroke-dasharray="5 5"/>`,
  row(AREA.x + 20, 145, 120, 'var(--dim)'),
  text(AREA.x + AREA.w / 2, 248, 'opened on purpose', 'f', 14))

// one press brings it back
const back = part('back',
  flow(`M440,276 C440,340 220,340 220,280`, 'hiding-arrow', 1.8),
  text(330, 366, 'one press brings it back', 'd', 15))

// delete lives only in the area
const del = part('delete',
  `<rect x="540" y="131" width="68" height="28" rx="14" fill="var(--bg)" stroke="var(--steel)" stroke-width="1.5"/>`,
  text(574, 150, 'delete', 'k st', 15),
  text(574, 186, 'only here', 'f', 14))

// another host still holds the same bytes
const ELSE = { x: 720, y: 70, w: 110 }
const elsewhere = part('elsewhere',
  text(ELSE.x + ELSE.w / 2, 54, 'another host', 'k', 18),
  server(ELSE.x, ELSE.y, ELSE.w),
  check(700, 196), text(714, 201, 'same bytes, still valid', 'd', 15, 'start'),
  text(ELSE.x + ELSE.w / 2, 226, 'forgotten only here', 'f', 14))

// never wiped
const yours = part('yours',
  ...[0, 1, 2].map(i => hex(716 + i * 36, 318, 15, LIT)),
  text(824, 324, 'never wiped', 'k hy', 16, 'start'),
  text(790, 366, 'your tiles, history and pools', 'd', 15))

module.exports = () => svg('a list offers hide and nothing else; what was hidden collects in a delete area opened on purpose, and one press brings it back; delete exists only in that area; another host still holds the same bytes, still valid, because delete forgets only here; your tiles, history and pools are never wiped', [
  `<defs>${marker('hiding-arrow')}</defs>`,
  list, hide, area, back, del, elsewhere, yours,
].join('\n'))
