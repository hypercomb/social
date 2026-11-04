// the layout — a list of words decides what shows. On the left, the layout a
// tile wears (layout.ts: a `layout:extrude` record naming, by signature, its
// ordered word list; the words are the tile's trait markers). On the right,
// organized's six children as they sit in its layer, and below them what the
// layer shows while the layout is on: only the children the words name, each
// taking the next seat in the words' order (layoutSeats), so the threads
// cross. The rest are left out (leftOut): still in the layer, untouched, only
// not drawn. Behind the list, the versions every switch writes; below it,
// another tile taking the same list by its signature (`layout from`).
const { hex, LIT, CELL, text, svg } = require('../../../../presentation/plates/lib.cjs')

const CARD = { x: 36, y: 64, w: 196, h: 180 }
const WORDS = ['build', 'history', 'heart']
const rowY = i => CARD.y + 78 + i * 38
// the layer's children, in their own order, and the seats a layout gives
const KIDS = ['heart', 'history', 'build', 'layout', 'trait', 'organization']
const KX = i => 340 + i * 100, KY = 124, R = 28
const SEAT = i => 440 + i * 100, SY = 300
const SEATED = WORDS.map(w => KIDS.indexOf(w))      // which child takes seat 0, 1, 2

const card = (dx, dy, attrs) => `<rect x="${CARD.x + dx}" y="${CARD.y + dy}" width="${CARD.w}" height="${CARD.h}" rx="3" ${attrs}/>`

module.exports = () => svg('a layout is a list of words, build, history, heart; the layer below holds six children, and with the layout on only the three it names are shown, seated in the list’s order, while the other three are left out, untouched; behind the list its earlier versions, and another tile takes the same list by signature', [
  // every switch is a version of the layer: the earlier ones, behind
  `<g data-id="versions">${card(16, -16, 'fill="var(--bg)" stroke="var(--line-strong)" stroke-width="1.2"')}${card(8, -8, 'fill="var(--bg)" stroke="var(--line-strong)" stroke-width="1.2"')}</g>`,
  // the list
  `<g data-id="list">${card(0, 0, 'fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.5"')}` +
    text(CARD.x + 20, CARD.y + 32, 'LAYOUT', 'm hy', 16, 'start', 'letter-spacing="3"') +
    text(CARD.x + CARD.w - 20, CARD.y + 32, 'e19b…', 'm f', 16, 'end') +
    `<path d="M${CARD.x + 14},${CARD.y + 48} H${CARD.x + CARD.w - 14}" stroke="var(--line)" stroke-width="1"/>` +
    WORDS.map((w, i) => text(CARD.x + 22, rowY(i) + 6, `${i + 1}`, 'm f', 16, 'start') + text(CARD.x + 52, rowY(i) + 6, w, 'k', 18, 'start')).join('') + `</g>`,
  // another tile takes the same list, by its signature
  `<g data-id="from"><rect x="${CARD.x + 18}" y="${CARD.y + CARD.h + 30}" width="186" height="70" fill="none" stroke="none"/>` +
    `<path d="M${CARD.x + 48},${CARD.y + CARD.h + 4} V${CARD.y + CARD.h + 36}" stroke="var(--honey-deep)" stroke-width="1.5" stroke-dasharray="4 5"/>` +
    hex(CARD.x + 48, CARD.y + CARD.h + 66, 28, CELL) +
    text(CARD.x + 88, CARD.y + CARD.h + 62, 'another tile', 'd', 18, 'start') +
    text(CARD.x + 88, CARD.y + CARD.h + 88, 'e19b…', 'm hy', 16, 'start') + `</g>`,
  // the layer: every child, in its own order
  `<g data-id="layer"><rect x="${KX(0) - 34}" y="${KY - R - 50}" width="${KX(2) - KX(0) + 68}" height="${2 * R + 50}" fill="none" stroke="none"/>` +
    [0, 1, 2].map(i => hex(KX(i), KY, R, CELL) + text(KX(i), KY - R - 18, KIDS[i], 'd', 18)).join('') + `</g>`,
  `<g data-id="out"><rect x="${KX(3) - 60}" y="${KY - R - 50}" width="${KX(5) - KX(3) + 120}" height="${2 * R + 104}" fill="none" stroke="none"/>` +
    [3, 4, 5].map(i => hex(KX(i), KY, R, CELL) + text(KX(i), KY - R - 18, KIDS[i], 'd', 18)).join('') +
    text(KX(4), KY + R + 40, 'left out, untouched', 'f', 18) + `</g>`,
  // what shows: the named children, seated in the words' order
  `<g data-id="seats"><rect x="${SEAT(0) - 40}" y="${SY - R}" width="${SEAT(2) - SEAT(0) + 80}" height="${2 * R + 40}" fill="none" stroke="none"/>` +
    SEATED.map((k, i) => `<path d="M${KX(k)},${KY + R + 4} L${SEAT(i)},${SY - R - 4}" stroke="var(--honey-deep)" stroke-width="1.5"/>`).join('') +
    SEATED.map((k, i) => hex(SEAT(i), SY, R, i === 0 ? LIT : CELL) + text(SEAT(i), SY + R + 30, KIDS[k], 'k', 18)).join('') + `</g>`,
  text(SEAT(2) + 56, SY + 6, 'shown', 'f', 18, 'start'),
].join('\n'))
