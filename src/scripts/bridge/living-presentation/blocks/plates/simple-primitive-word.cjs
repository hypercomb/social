// the word — any spelling, one address. Three hands (you, ann and bo, the
// same three as the opening's spread) type the same word their own way, each
// in their own hive. The hive folds every spelling to one key (lower case,
// each run of spaces and marks one hyphen: molecule-address.ts moleculeKey),
// signs it, and all three land on one address. The sign() hexagon and the
// address bar are the signature scene's own, so the word reads as the
// signature, used on a name. The hex is sha256('my-tile'), as the page's try
// part computes it.
const { hex, LIT, marker, flow, text, svg } = require('../../../../presentation/plates/lib.cjs')

const CARD = { x: 40, w: 224, h: 72 }
const HANDS = [
  { id: 'you', hand: 'you', typed: 'My Tile', y: 40 },
  { id: 'ann', hand: 'ann', typed: 'my tile!', y: 164 },
  { id: 'bo', hand: 'bo', typed: 'MY-TILE', y: 288 },
]
const FOLD = { x: 334, y: 164, w: 186, h: 72 }
const SX = 616, SY = 200, SR = 50

module.exports = () => svg('three people type the same word three ways; each spelling folds to my-tile, is signed, and lands on one address', [
  `<defs>${marker('pw-ah')}</defs>`,
  ...HANDS.map(({ id, hand, typed, y }) => {
    const cy = y + CARD.h / 2
    return `<g data-id="${id}"><rect x="${CARD.x}" y="${y}" width="${CARD.w}" height="${CARD.h}" rx="3" fill="var(--bg)" stroke="var(--line-strong)" stroke-width="1.5"/>` +
      text(CARD.x + 20, y + 27, hand, 'm f', 16, 'start') +
      text(CARD.x + 20, y + 57, typed, 'm k', 22, 'start') +
      `<path d="M${CARD.x + CARD.w + 4},${cy} C${CARD.x + CARD.w + 44},${cy} ${FOLD.x - 40},${SY} ${FOLD.x - 4},${SY}" fill="none" stroke="var(--honey-deep)" stroke-width="1.5"/></g>`
  }),
  `<g data-id="fold"><rect x="${FOLD.x}" y="${FOLD.y}" width="${FOLD.w}" height="${FOLD.h}" rx="3" fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.5"/>` +
    text(FOLD.x + FOLD.w / 2, SY + 8, 'my-tile', 'm k', 24) +
    text(FOLD.x + FOLD.w / 2, FOLD.y + FOLD.h + 34, 'folded', 'd', 18) + `</g>`,
  `<g data-id="sign"><path d="M${FOLD.x + FOLD.w + 4},${SY} H${SX - SR * 0.866 - 4}" stroke="var(--honey-deep)" stroke-width="1.5"/>` +
    hex(SX, SY, SR, LIT) + text(SX, SY + 8, 'sign()', 'm k hy', 22) + `</g>`,
  `<g data-id="address"><rect x="712" y="${SY - 30}" width="208" height="60" rx="3" fill="var(--panel)" stroke="var(--honey)" stroke-width="1.5"/>` +
    text(816, SY + 8, '0d3465c0…', 'm k hy', 22) +
    text(816, SY + 64, 'its address', 'd', 18) +
    flow(`M${SX + SR * 0.866 + 4},${SY} L706,${SY}`, 'pw-ah') + `</g>`,
].join('\n'))
