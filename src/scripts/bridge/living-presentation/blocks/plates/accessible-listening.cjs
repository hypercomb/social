// one sentence, three ways in. On the left, one beat: a plain sentence (the
// page's own words for its beats, page.cjs). It reaches you three ways at
// once: heard, in the tour's voice when the beat is recorded (narrate.cjs);
// read, in the caption under the figure, which a screen reader announces
// (aria-live); and seen, as the part it speaks of lights. The honey line is
// the one that never fails: the caption. Under the sentence, the voice
// switch: off, and the words stay, each held for its reading time.
const { hex, LIT, CELL, marker, flow, text, svg } = require('../../../../presentation/plates/lib.cjs')

const T = { x: 470, w: 330 }                       // the three ways in
const ROW = { voice: 52, caption: 158, part: 264 } // each 86 tall
const H = 86
const way = (id, y, body, label) =>
  `<g data-id="${id}"><rect x="${T.x}" y="${y}" width="${T.w + 136}" height="${H}" fill="none" stroke="none"/>` +
  `<rect x="${T.x}" y="${y}" width="${T.w}" height="${H}" rx="3" fill="var(--panel)" stroke="var(--line-strong)" stroke-width="1.5"/>` +
  body + text(T.x + T.w + 26, y + H / 2 + 8, label, 'k', 24, 'start') + `</g>`
const branch = (y) => `<path d="M372,180 C420,180 424,${y} ${T.x - 6},${y}" fill="none" stroke="var(--honey-deep)" stroke-width="1.5"/>`

// heard: a speaker and the sound of the sentence
const bars = [10, 22, 34, 18, 40, 28, 14, 30, 38, 20, 12, 26, 16, 8, 20, 12].map((h, i) =>
  `<path d="M${T.x + 100 + i * 13},${ROW.voice + H / 2 - h / 2} v${h}" stroke="var(--honey)" stroke-width="4"/>`).join('')
const speaker = (x, y, c = 'var(--ink)') => `<path d="M${x},${y - 8} h10 l13,-12 v40 l-13,-12 h-10 Z" fill="none" stroke="${c}" stroke-width="2"/>`

module.exports = () => svg('one sentence reaches you three ways: heard in the tour’s voice, read in the caption, and seen as the part it speaks of lights; with the voice off, the caption stays', [
  `<defs>${marker('ls-ah')}</defs>`,
  // one beat: one plain sentence
  `<g data-id="sentence"><rect x="48" y="96" width="320" height="168" rx="3" ${CELL}/>` +
    text(76, 136, 'ONE BEAT', 'm f', 16, 'start', 'letter-spacing="3"') +
    text(76, 186, 'Each part lights', 'k', 28, 'start') + text(76, 226, 'as it is said.', 'k', 28, 'start') + `</g>`,
  branch(ROW.voice + H / 2), branch(ROW.part + H / 2),
  flow(`M372,180 C420,180 424,${ROW.caption + H / 2} ${T.x - 6},${ROW.caption + H / 2}`, 'ls-ah', 2.5),
  // heard
  way('voice', ROW.voice, speaker(T.x + 34, ROW.voice + H / 2 - 4) + bars, 'heard'),
  // read: the caption, under its hairline
  way('caption', ROW.caption, `<path d="M${T.x + 22},${ROW.caption + 24} H${T.x + T.w - 22}" stroke="var(--line-strong)" stroke-width="1.2"/>` +
    text(T.x + 24, ROW.caption + 60, 'Each part lights as it is said.', '', 21, 'start'), 'read'),
  // seen: the part it speaks of lights
  way('part', ROW.part, [[T.x + 105, 0], [T.x + 165, LIT], [T.x + 225, 0]].map(([x, a]) => hex(x, ROW.part + H / 2, 30, a || CELL)).join(''), 'seen'),
  // the voice switch: off, and the words stay
  `<g data-id="mute"><rect x="48" y="290" width="320" height="60" rx="3" fill="var(--bg)" stroke="var(--line-strong)" stroke-width="1.5"/>` +
    speaker(76, 324, 'var(--dim)') + `<path d="M112,312 l16,16 M128,312 l-16,16" stroke="var(--danger)" stroke-width="2"/>` +
    text(152, 328, 'voice off', 'd', 22, 'start') + `</g>`,
].join('\n'))
