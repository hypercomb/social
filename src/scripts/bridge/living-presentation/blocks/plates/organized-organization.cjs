// the organization — the same pieces, organized many ways at once. In the
// middle, four pieces, each where it was made, each standing alone. On the
// left, a website (pitch) reads three of them in an order of its own; the
// order is not on the website or the piece but on a mark each member wears,
// one per set it is in (pheromones/enrollment.ts: group { sig, meaning, order }).
// On the right, a question reads the pieces that carry the word travel, as one
// flat list (the tag filter, which today matches any of the chosen words).
// Photo and map sit in both at once, and neither reading owns them; nothing moves.
const { hex, CELL, STEEL, text, svg } = require('../../../../presentation/plates/lib.cjs')

const PX = 480, R = 34
const PIECES = { photo: 74, slide: 158, note: 242, map: 326 }
const SITE = ['slide', 'photo', 'map']           // the website's own order
const ASK = ['photo', 'note', 'map']             // every piece carrying the word
const CARD = { y: 104, w: 236, h: 192 }
const LEFT = 52, RIGHT = 960 - 52 - CARD.w
const rowY = i => CARD.y + 86 + i * 44
const MARK = PX - R * 0.866 - 26                 // where a piece wears its place in the site
const TAG = PX + R * 0.866 + 22                  // where it wears the word

const card = (x, title, value, rows) =>
  `<rect x="${x}" y="${CARD.y}" width="${CARD.w}" height="${CARD.h}" rx="3" fill="var(--panel)" stroke="var(--line-strong)" stroke-width="1.2"/>` +
  text(x + 20, CARD.y + 34, title, 'm hy', 16, 'start', 'letter-spacing="3"') +
  text(x + CARD.w - 20, CARD.y + 34, value, 'm d', 16, 'end') +
  `<path d="M${x + 14},${CARD.y + 50} H${x + CARD.w - 14}" stroke="var(--line)" stroke-width="1"/>` +
  rows.map((w, i) => text(x + 22, rowY(i) + 6, w, 'k', 18, 'start')).join('')
const thread = (x1, y1, x2, y2) => `<path d="M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}" fill="none" stroke="var(--honey-deep)" stroke-width="1.5"/>`

module.exports = () => svg('four pieces in a column, each standing alone; a website on the left reads slide, photo and map in its own order, each wearing a mark with its place; a question on the right reads photo, note and map, the pieces that carry the word travel; nothing moves', [
  // the website: its members, in an order kept on the marks they wear
  `<g data-id="site">${card(LEFT, 'WEBSITE', 'pitch', SITE)}` +
    SITE.map((w, i) => thread(LEFT + CARD.w + 4, rowY(i), MARK - 15, PIECES[w])).join('') + `</g>`,
  `<g data-id="site-marks"><rect x="${MARK - 14}" y="${PIECES.photo - 14}" width="28" height="${PIECES.map - PIECES.photo + 28}" fill="none" stroke="none"/>` +
    SITE.map((w, i) => `<circle cx="${MARK}" cy="${PIECES[w]}" r="13" fill="var(--bg)" stroke="var(--honey)" stroke-width="1.5"/>` + text(MARK, PIECES[w] + 6, `${i + 1}`, 'm hy', 16)).join('') + `</g>`,
  // the question: every piece that carries the word, as one flat list
  `<g data-id="ask">${card(RIGHT, 'QUESTION', 'travel', ASK)}` +
    ASK.map((w, i) => thread(TAG + 12, PIECES[w], RIGHT - 4, rowY(i))).join('') + `</g>`,
  `<g data-id="ask-marks">${ASK.map(w => hex(TAG, PIECES[w], 10, STEEL)).join('')}</g>`,
  // the pieces, each where it was made
  Object.entries(PIECES).map(([w, y]) => `<g data-id="${w}">${hex(PX, y, R, CELL)}${text(PX, y + 6, w, 'k', 18)}</g>`).join('\n'),
].join('\n'))
