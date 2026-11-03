// merging — PLANNED. One file, three versions: the one both started from,
// yours (a line changed, honey) and theirs (another line changed, steel).
// What is built today: both stay whole, side by side, and a path holds one
// layer, so only one can be picked there (runtime module-drafts.ts, one pick
// per path). Jev's pass over a zone (`module focus`) already names two trials
// that change one source file as a clash (module-review.ts trialClashes).
// What is planned (living-presentation.md, module-sandbox.md "Two changes to
// one path"): a model drafts one version holding both changes, and that
// draft waits like any model's draft, in the brood, until a person accepts
// it or keeps their own. Nothing is rewritten: all versions keep their
// signatures (doctrine H2).
const { marker, markerS, flow, text, svg } = require('../../../../presentation/plates/lib.cjs')

const W = [104, 78, 112, 66, 92]           // the file's five lines
const LINE = (y, i) => y + 58 + i * 18
// a file card: a header word, and five lines; `marks` colours changed lines
const card = (x, y, w, h, head, cls, marks = {}, frame = 'stroke="var(--line-strong)" stroke-width="1.5"') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="var(--bg)" ${frame}/>` +
  text(x + 18, y + 32, head, cls, 20, 'start') +
  W.map((lw, i) => `<rect x="${x + 18}" y="${LINE(y, i) - 4}" width="${lw * (w - 36) / 112}" height="8" rx="2" fill="${marks[i] || 'var(--line)'}"/>`).join('')

const BASE = { x: 40, y: 130, w: 150, h: 140 }
const YOURS = { x: 254, y: 40, w: 156, h: 140 }
const THEIRS = { x: 254, y: 220, w: 156, h: 140 }
const DRAFT = { x: 486, y: 122, w: 172, h: 150 }
const PILL = { x: 736, w: 188, h: 54 }
const ACCEPT_Y = 96, KEEP_Y = 250

const pill = (y, label, lit) =>
  `<rect x="${PILL.x}" y="${y}" width="${PILL.w}" height="${PILL.h}" rx="27" fill="var(--panel)" stroke="${lit ? 'var(--honey)' : 'var(--steel)'}" stroke-width="${lit ? 2 : 1.5}"/>` +
  text(PILL.x + PILL.w / 2, y + 34, label, lit ? 'k hy' : 'k st', 20)

module.exports = () => svg('one file in three versions: the one both started from, yours with one line changed, theirs with another; the two are marked as touching the same file; a planned AI draft holds both changes; from it you accept the draft or keep yours', [
  `<defs>${marker('mg-ah')}${markerS('mg-as')}</defs>`,
  // where both started
  `<g data-id="base">${card(BASE.x, BASE.y, BASE.w, BASE.h, 'before', 'd')}` +
    `<path d="M${BASE.x + BASE.w + 4},${BASE.y + 50} C${BASE.x + BASE.w + 34},${BASE.y + 50} ${YOURS.x - 34},${YOURS.y + 70} ${YOURS.x - 6},${YOURS.y + 70}" fill="none" stroke="var(--line-strong)" stroke-width="1.5"/>` +
    `<path d="M${BASE.x + BASE.w + 4},${BASE.y + 90} C${BASE.x + BASE.w + 34},${BASE.y + 90} ${THEIRS.x - 34},${THEIRS.y + 70} ${THEIRS.x - 6},${THEIRS.y + 70}" fill="none" stroke="var(--line-strong)" stroke-width="1.5"/></g>`,
  // your change: line two
  `<g data-id="yours">${card(YOURS.x, YOURS.y, YOURS.w, YOURS.h, 'yours', 'k hy', { 1: 'var(--honey)' }, 'stroke="var(--honey-deep)" stroke-width="1.5"')}</g>`,
  // their change: line four
  `<g data-id="theirs">${card(THEIRS.x, THEIRS.y, THEIRS.w, THEIRS.h, 'theirs', 'k st', { 3: 'var(--steel)' }, 'stroke="var(--steel)" stroke-width="1.5"')}</g>`,
  // the clash: two changes to one file, named together
  `<g data-id="clash"><rect x="${YOURS.x + 8}" y="${YOURS.y + YOURS.h + 2}" width="${YOURS.w - 16}" height="${THEIRS.y - YOURS.y - YOURS.h - 4}" fill="none" stroke="none"/>` +
    text(YOURS.x + YOURS.w / 2, YOURS.y + YOURS.h + 27, 'clash: one file', 'k', 18) + `</g>`,
  // planned: one draft holding both changes
  `<g data-id="draft">` +
    `<path d="M${YOURS.x + YOURS.w + 6},${YOURS.y + 70} C${DRAFT.x - 40},${YOURS.y + 70} ${DRAFT.x - 44},${DRAFT.y + 56} ${DRAFT.x - 6},${DRAFT.y + 56}" fill="none" stroke="var(--honey-deep)" stroke-width="1.5" stroke-dasharray="5 6"/>` +
    `<path d="M${THEIRS.x + THEIRS.w + 6},${THEIRS.y + 70} C${DRAFT.x - 40},${THEIRS.y + 70} ${DRAFT.x - 44},${DRAFT.y + 96} ${DRAFT.x - 6},${DRAFT.y + 96}" fill="none" stroke="var(--honey-deep)" stroke-width="1.5" stroke-dasharray="5 6"/>` +
    card(DRAFT.x, DRAFT.y, DRAFT.w, DRAFT.h, 'one draft', 'k hy', { 1: 'var(--honey)', 3: 'var(--steel)' }, 'stroke="var(--honey)" stroke-width="2" stroke-dasharray="7 6"') +
    text(DRAFT.x + DRAFT.w / 2, DRAFT.y + DRAFT.h + 34, 'planned', 'm f', 18) + `</g>`,
  // your choice
  `<g data-id="accept">${pill(ACCEPT_Y, 'accept', true)}` +
    flow(`M${DRAFT.x + DRAFT.w + 8},${DRAFT.y + 50} C${DRAFT.x + DRAFT.w + 40},${DRAFT.y + 50} ${PILL.x - 40},${ACCEPT_Y + PILL.h / 2} ${PILL.x - 8},${ACCEPT_Y + PILL.h / 2}`, 'mg-ah') + `</g>`,
  `<g data-id="keep">${pill(KEEP_Y, 'keep yours', false)}` +
    `<path d="M${DRAFT.x + DRAFT.w + 8},${DRAFT.y + 104} C${DRAFT.x + DRAFT.w + 40},${DRAFT.y + 104} ${PILL.x - 40},${KEEP_Y + PILL.h / 2} ${PILL.x - 8},${KEEP_Y + PILL.h / 2}" fill="none" stroke="var(--steel)" stroke-width="1.5" marker-end="url(#mg-as)"/></g>`,
].join('\n'))
