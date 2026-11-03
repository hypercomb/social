// sharing without dependencies — parts meet at a word. On the left, two parts,
// a card and a menu. Neither names the other, and neither names a colour: each
// has sockets for the words it needs (the hive's real token roles: surface,
// primary, outline — theme.types.ts, "components never name colors; they
// consume token roles"). In the middle, the words, which belong to neither
// side; their lines run to whatever theme is chosen, never to a particular
// one. On the right, two of the hive's own themes, honey and bloom, each a set
// of answers, one per word. Switching is one choice (ThemeService.setTheme):
// the frame moves from honey to bloom, and no part is touched.
const { LIT, marker, flow, text, svg } = require('../../../../presentation/plates/lib.cjs')

const ROWS = { surface: 150, primary: 230, outline: 310 }
const W = { x: 340, w: 160 }                 // the word pills
const REACH = 584                            // where the words reach the chosen theme
const TH = { honey: 600, bloom: 780, w: 148, y: 70, h: 280 }
const ANS = {
  honey: { surface: 'var(--panel)', primary: 'var(--honey-fill)', outline: 'var(--honey-deep)' },
  bloom: { surface: 'var(--bg2)', primary: 'var(--steel)', outline: 'var(--dim)' },
}
const socket = (y) => `<circle cx="276" cy="${y}" r="6" fill="var(--bg)" stroke="var(--honey-deep)" stroke-width="1.5"/>`
const thread = (y, to) => `<path d="M282,${y} C312,${y} ${W.x - 30},${ROWS[to]} ${W.x - 4},${ROWS[to]}" fill="none" stroke="var(--honey-deep)" stroke-width="1.5"/>`
const part = (id, y, h, name, body, sockets) =>
  `<g data-id="${id}"><rect x="40" y="${y}" width="236" height="${h}" rx="3" fill="var(--panel)" stroke="var(--line-strong)" stroke-width="1.5"/>` +
  text(64, y + 38, name, 'k', 20, 'start') + body +
  sockets.map(([sy, to]) => thread(sy, to) + socket(sy)).join('') + `</g>`
const theme = (id, x, frame) =>
  `<g data-id="${id}"><rect x="${x}" y="${TH.y}" width="${TH.w}" height="${TH.h}" rx="6" ${frame}/>` +
  text(x + TH.w / 2, TH.y + 36, id, 'k', 20) +
  Object.entries(ROWS).map(([word, y]) => `<rect x="${x + 22}" y="${y - 20}" width="${TH.w - 44}" height="40" rx="3" fill="${ANS[id][word]}" stroke="var(--line-strong)" stroke-width="1"/>`).join('') + `</g>`

module.exports = () => svg('a card and a menu name only the words surface, primary and outline; the words belong to neither side; two themes, honey and bloom, each answer every word; switching themes moves one choice and touches no part', [
  `<defs>${marker('sh-ah')}</defs>`,
  part('card', 56, 148, 'card',
    `<rect x="64" y="${56 + 60}" width="64" height="56" rx="2" fill="none" stroke="var(--steel)" stroke-width="1.5"/>` +
    `<path d="M144,${56 + 72} H236 M144,${56 + 94} H214" stroke="var(--line-strong)" stroke-width="2"/>`,
    [[120, 'surface'], [176, 'primary']]),
  part('menu', 224, 136, 'menu',
    `<path d="M64,${224 + 66} H200 M64,${224 + 88} H180 M64,${224 + 110} H192" stroke="var(--line-strong)" stroke-width="2"/>`,
    [[274, 'primary'], [326, 'outline']]),
  // the words: an interface that belongs to neither side
  `<g data-id="words"><rect x="${W.x}" y="${ROWS.surface - 22}" width="${W.w}" height="${ROWS.outline - ROWS.surface + 44}" fill="none" stroke="none"/>` +
    Object.entries(ROWS).map(([word, y]) =>
      `<rect x="${W.x}" y="${y - 22}" width="${W.w}" height="44" rx="22" fill="var(--bg)" stroke="var(--honey)" stroke-width="1.5"/>` +
      text(W.x + W.w / 2, y + 6, word, 'm k', 18) +
      `<path d="M${W.x + W.w + 4},${y} H${REACH}" stroke="var(--honey-deep)" stroke-width="1.5" stroke-dasharray="4 5"/>` +
      `<circle cx="${REACH}" cy="${y}" r="3.5" fill="var(--honey-deep)"/>`).join('') + `</g>`,
  // two themes, each a set of answers
  theme('honey', TH.honey, LIT),
  theme('bloom', TH.bloom, 'fill="none" stroke="var(--line-strong)" stroke-width="1.2"'),
  // the one choice that moves
  `<g data-id="swap"><rect x="${TH.bloom - 6}" y="${TH.y - 6}" width="${TH.w + 12}" height="${TH.h + 12}" rx="9" fill="none" stroke="var(--honey)" stroke-width="2"/>` +
    flow(`M${TH.honey + TH.w / 2 + 20},${TH.y - 12} C${TH.honey + TH.w / 2 + 50},${TH.y - 40} ${TH.bloom + TH.w / 2 - 50},${TH.y - 40} ${TH.bloom + TH.w / 2 - 20},${TH.y - 14}`, 'sh-ah') + `</g>`,
].join('\n'))
