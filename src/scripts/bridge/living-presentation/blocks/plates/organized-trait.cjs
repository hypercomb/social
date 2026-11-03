// the trait — a place a tile leaves open. On the left, the words a card
// leaves open (its `trait:want` records: portrait, tagline, contact). Beside
// it, the card as you stand in it, each word resolved by the rungs of
// core/trait.ts (resolveTrait): portrait by a child of that name; tagline by a
// filler chosen with the fill word (a `trait:fill` mark, which comes first),
// here a tile kept elsewhere in the same hive (`fill tagline /notes/motto`;
// filling from the hosts you follow is not built). Contact's tile was hidden:
// the `trait:want` record outlives it, so contact waits as a silhouette where
// its tile will land, and pressing it makes the tile again
// (trait-silhouette.ts). On the right, the same portrait filling a second
// creation: a trait is a mark, never a parent.
const { hex, LIT, CELL, STEEL, marker, flow, text, svg } = require('../../../../presentation/plates/lib.cjs')

const LIST = { x: 36, y: 92, w: 168, h: 216 }
const WORDS = ['portrait', 'tagline', 'contact']
const rowY = i => LIST.y + 86 + i * 44
// the card and its three places, one honeycomb step apart
const CX = 296, CY = 200, D = 110, R = 57
const SLOT = { portrait: [CX + D / 2, CY - D * 0.866], tagline: [CX + D, CY], contact: [CX + D / 2, CY + D * 0.866] }
// elsewhere: the chosen filler, and a second creation
const EX = 768, MOTTO = 300, BADGE = 100, ER = 44

const slot = (word, attrs, cls, rung, rungCls) => {
  const [x, y] = SLOT[word]
  return hex(x, y, R, attrs) + text(x, y + 2, word, cls, 18) + text(x, y + 28, rung, rungCls, 18)
}

module.exports = () => svg('a card leaves three words open, portrait, tagline and contact; a child named portrait fills the first, a filler chosen from your notes fills the second, and contact, its tile hidden, waits as a silhouette; the same portrait also fills a second creation', [
  `<defs>${marker('ot-ah')}</defs>`,
  // the words the card leaves open
  `<g data-id="marks"><rect x="${LIST.x}" y="${LIST.y}" width="${LIST.w}" height="${LIST.h}" rx="3" fill="var(--panel)" stroke="var(--line-strong)" stroke-width="1.2"/>` +
    text(LIST.x + 20, LIST.y + 34, 'TRAITS', 'm hy', 16, 'start', 'letter-spacing="3"') +
    `<path d="M${LIST.x + 14},${LIST.y + 50} H${LIST.x + LIST.w - 14}" stroke="var(--line)" stroke-width="1"/>` +
    WORDS.map((w, i) => text(LIST.x + 22, rowY(i) + 6, w, 'k', 18, 'start')).join('') + `</g>`,
  // the card, as you stand in it
  `<g data-id="card"><path d="M${LIST.x + LIST.w + 4},${CY} H${CX - R * 0.866 - 6}" stroke="var(--line-strong)" stroke-width="1.2"/>` +
    hex(CX, CY, R, CELL) + text(CX, CY + 7, 'card', 'k', 20) + `</g>`,
  `<g data-id="portrait">${slot('portrait', CELL, 'k', 'child', 'm f')}</g>`,
  `<g data-id="tagline">${slot('tagline', LIT, 'k', 'chosen', 'm hy')}</g>`,
  `<g data-id="contact">${slot('contact', 'fill="none" stroke="var(--dim)" stroke-width="1.5" stroke-dasharray="5 6"', 'd', 'hidden', 'm f')}` +
    hex(...SLOT.contact, R - 9, 'fill="none" stroke="var(--line)" stroke-width="1"') + `</g>`,
  // the chosen filler, from another hive
  `<g data-id="motto"><rect x="${EX - 80}" y="${MOTTO - ER}" width="160" height="${2 * ER + 34}" fill="none" stroke="none"/>` +
    hex(EX, MOTTO, ER, STEEL) + text(EX, MOTTO + 6, 'motto', 'k', 18) +
    text(EX, MOTTO + ER + 30, 'from your notes', 'd', 18) +
    flow(`M${EX - ER * 0.866 - 6},${MOTTO} C${EX - 150},${MOTTO} ${SLOT.tagline[0] + 120},${CY + 4} ${SLOT.tagline[0] + R * 0.866 + 8},${CY + 2}`, 'ot-ah') + `</g>`,
  // the same portrait fills a second creation
  `<g data-id="badge"><rect x="${EX - 80}" y="${BADGE - ER}" width="160" height="${2 * ER + 34}" fill="none" stroke="none"/>` +
    `<path d="M${SLOT.portrait[0] + R * 0.866 + 6},${SLOT.portrait[1] - 4} C${SLOT.portrait[0] + 160},${SLOT.portrait[1] - 20} ${EX - 150},${BADGE} ${EX - ER * 0.866 - 6},${BADGE}" fill="none" stroke="var(--honey-deep)" stroke-width="1.5" stroke-dasharray="4 5"/>` +
    hex(EX, BADGE, ER, CELL) + text(EX, BADGE + 6, 'badge', 'k', 18) +
    text(EX, BADGE + ER + 30, 'another creation', 'd', 18) + `</g>`,
].join('\n'))
