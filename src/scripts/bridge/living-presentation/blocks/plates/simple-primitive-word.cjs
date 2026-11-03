// the word — any spelling, one address. Three hands (you, ann and bo, the
// same three as the opening's spread) type the same word their own way, each
// in a hive of their own. Nothing joins the three rows: each hive folds the
// word by itself (lower case, one hyphen between words, edge marks dropped:
// molecule-address.ts moleculeKey), signs it by itself, and the three answers
// agree. The agreement is the only thing drawn across the rows, because there
// is no registry for them to meet at. The hex is real: sha256('my-tile'), as
// the page's try part computes it for its default "My Tile".
const { hex, LIT, marker, text, svg } = require('../../../../presentation/plates/lib.cjs')

const ROWS = [
  { id: 'you', typed: 'My Tile', cy: 112 },
  { id: 'ann', typed: 'my tile!', cy: 212 },
  { id: 'bo', typed: 'MY-TILE', cy: 312 },
]
const H = 68
const CARD = { x: 40, w: 220 }
const FOLD = { x: 322, w: 176 }
const SX = 556, SR = 28
const ADDR = { x: 622, w: 196 }
const ADDRESS = '0d3465c0…'

const arrow = (x1, x2, y) => `<path d="M${x1},${y} H${x2}" stroke="var(--honey-deep)" stroke-width="1.5" marker-end="url(#pw-ah)"/>`

module.exports = () => svg('three people, each in a hive of their own, type the same word three ways; each hive folds it to my-tile and signs it alone, and all three get the same address', [
  `<defs>${marker('pw-ah')}</defs>`,
  // what each column is
  text(CARD.x + CARD.w / 2, 50, 'typed', 'f', 18),
  text(FOLD.x + FOLD.w / 2, 50, 'folded', 'f', 18),
  text(SX, 50, 'signed', 'f', 18),
  text(ADDR.x + ADDR.w / 2, 50, 'address', 'f', 18),
  ...ROWS.map(({ id, typed, cy }) => [
    `<g data-id="${id}"><rect x="${CARD.x}" y="${cy - H / 2}" width="${CARD.w}" height="${H}" rx="3" fill="var(--bg)" stroke="var(--line-strong)" stroke-width="1.5"/>` +
      text(CARD.x + 18, cy - 10, id, 'm f', 16, 'start') +
      text(CARD.x + 18, cy + 22, typed, 'm k', 22, 'start') + `</g>`,
    `<g data-id="${id}-fold"><rect x="${FOLD.x}" y="${cy - H / 2}" width="${FOLD.w}" height="${H}" rx="3" fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.5"/>` +
      text(FOLD.x + FOLD.w / 2, cy + 8, 'my-tile', 'm k', 22) +
      arrow(CARD.x + CARD.w + 6, FOLD.x - 8, cy) + `</g>`,
    `<g data-id="${id}-sign"><rect x="${SX - SR}" y="${cy - H / 2}" width="${ADDR.x + ADDR.w - SX + SR}" height="${H}" fill="none" stroke="none"/>` +
      `<rect x="${ADDR.x}" y="${cy - H / 2 + 6}" width="${ADDR.w}" height="${H - 12}" rx="3" fill="var(--panel)" stroke="var(--honey)" stroke-width="1.5"/>` +
      hex(SX, cy, SR, LIT) + text(SX, cy + 6, 'sign', 'm hy', 16) +
      text(ADDR.x + ADDR.w / 2, cy + 8, ADDRESS, 'm k hy', 22) +
      arrow(FOLD.x + FOLD.w + 6, SX - SR * 0.866 - 8, cy) +
      arrow(SX + SR * 0.866 + 6, ADDR.x - 8, cy) + `</g>`,
  ].join('\n')),
  // the one thing drawn across the rows: they agree
  `<g data-id="one"><rect x="834" y="${ROWS[0].cy}" width="102" height="${ROWS[2].cy - ROWS[0].cy}" fill="none" stroke="none"/>` +
    `<path d="M836,${ROWS[0].cy} H846 V${ROWS[2].cy} H836 M846,${ROWS[1].cy} H854" fill="none" stroke="var(--honey)" stroke-width="1.5"/>` +
    text(864, ROWS[1].cy - 6, 'one', 'k hy', 18, 'start') +
    text(864, ROWS[1].cy + 18, 'address', 'k hy', 18, 'start') + `</g>`,
].join('\n'))
