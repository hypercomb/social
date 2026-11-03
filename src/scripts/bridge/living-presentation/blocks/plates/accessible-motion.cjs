// less motion, nothing lost. Two rows of the same beat, frame by frame in
// time. With motion, the part fades up, the line draws itself and the caption
// rises (page.cjs: the transitions, the `rise`). With less motion asked for
// (prefers-reduced-motion), every frame is already the last one: the part is
// lit at once, the line is whole, the caption is there (the one gate in
// page.cjs's STYLE). The last frames match. At the end of each row, what
// happens next: a silent page plays itself, or, with less motion, it waits
// for you to step (`!voiced && !still`).
const { hex, LIT, marker, markerS, text, svg } = require('../../../../presentation/plates/lib.cjs')

const F = { xs: [204, 386, 568], w: 166, h: 116 }   // three frames in time
const ROW = { motion: 70, still: 238 }
// one frame of the beat, at a share of the way through (0 to 1)
const frame = (x, y, t, mk) => {
  const cx = x + 44, cy = y + 48, ln = x + 78 + (t === 1 ? 64 : 64 * t)
  const part = t === 1 ? hex(cx, cy, 24, LIT)
    : hex(cx, cy, 24, `fill="var(--honey-fill)" fill-opacity="${(0.12 * t).toFixed(2)}" stroke="var(--honey)" stroke-opacity="${(0.25 + 0.5 * t).toFixed(2)}" stroke-width="2"`)
  const line = t > 0 ? `<path d="M${x + 78},${cy} H${ln}" stroke="var(--honey)" stroke-width="2"${t === 1 ? ` marker-end="url(#${mk})"` : ''}/>` : ''
  const lift = Math.round((1 - t) * 12)
  const cap = `<path d="M${x + 22},${y + 92 + lift} H${x + 144}" stroke="var(--dim)" stroke-width="5" stroke-opacity="${(0.2 + 0.6 * t).toFixed(2)}"/>`
  return `<rect x="${x}" y="${y}" width="${F.w}" height="${F.h}" rx="3" fill="var(--bg)" stroke="var(--line-strong)" stroke-width="1.5"/>` + part + line + cap
}
const row = (id, y, label, ts) => `<g data-id="${id}"><rect x="40" y="${y}" width="${F.xs[2] + F.w - 40}" height="${F.h}" fill="none" stroke="none"/>` +
  text(40, y + F.h / 2 + 8, label, 'k', 24, 'start') + F.xs.map((x, i) => frame(x, y, ts[i], 'mo-ah')).join('') + `</g>`

const END = { x: 762, w: 170 }
const play = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="20" fill="none" stroke="var(--dim)" stroke-width="1.8"/><path d="M${cx - 6},${cy - 10} L${cx + 10},${cy} L${cx - 6},${cy + 10} Z" fill="var(--dim)"/>`
const key = (x, y, d) => `<rect x="${x}" y="${y}" width="36" height="36" rx="4" fill="none" stroke="var(--honey)" stroke-width="1.8"/>` +
  `<path d="M${x + 18 + 6 * d},${y + 10} L${x + 18 - 6 * d},${y + 18} L${x + 18 + 6 * d},${y + 26}" fill="none" stroke="var(--honey)" stroke-width="2"/>`

module.exports = () => svg('the same beat frame by frame: with motion the part fades up, the line draws and the caption rises; with less motion every frame is already the last; the last frames match; a page that would play itself waits for you instead', [
  `<defs>${marker('mo-ah')}${markerS('mo-as')}</defs>`,
  // time runs left to right
  text(40, 46, 'TIME', 'm f', 16, 'start', 'letter-spacing="3"'),
  `<path d="M${F.xs[0]},40 H${F.xs[2] + F.w - 4}" stroke="var(--steel)" stroke-width="1.5" marker-end="url(#mo-as)"/>`,
  row('motion', ROW.motion, 'with motion', [0, 0.5, 1]),
  row('still', ROW.still, 'less motion', [1, 1, 1]),
  // the last frame is the same either way
  `<g data-id="same"><rect x="${F.xs[2] - 8}" y="${ROW.motion - 8}" width="${F.w + 16}" height="${ROW.still - ROW.motion + F.h + 16}" rx="6" fill="none" stroke="var(--honey)" stroke-width="2"/>` +
    text(F.xs[2] + F.w / 2, ROW.motion + F.h + 34, 'the same', 'k hy', 22) + `</g>`,
  // what happens next
  `<g data-id="auto"><rect x="${END.x}" y="${ROW.motion}" width="${END.w}" height="${F.h}" fill="none" stroke="none"/>` +
    play(END.x + 85, ROW.motion + 40) + text(END.x + 85, ROW.motion + 98, 'plays itself', 'd', 22) + `</g>`,
  `<g data-id="step"><rect x="${END.x}" y="${ROW.still}" width="${END.w}" height="${F.h}" fill="none" stroke="none"/>` +
    key(END.x + 44, ROW.still + 22, 1) + key(END.x + 90, ROW.still + 22, -1) + text(END.x + 85, ROW.still + 98, 'waits for you', 'k', 22) + `</g>`,
].join('\n'))
