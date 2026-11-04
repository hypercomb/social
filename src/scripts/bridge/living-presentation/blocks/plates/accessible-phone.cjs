// the same page, narrower. On the left, a page on a wide screen: its
// headline, its picture and the panel beside it, the caption, the steps. On
// the right, the same page on a phone: every size read from the page's own
// width (page.cjs, cqi), and below a narrow width the panel moves under the
// picture, one column (the @container rule). The honey line is that one move.
// Under the phone, the width every page is opened at by the presentation's
// own check (check.cjs --render: 390 wide, and a page that scrolls sideways
// fails).
const { hex, LIT, CELL, marker, flow, text, svg, device } = require('../../../../presentation/plates/lib.cjs')

const box = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="var(--panel)" stroke="var(--line-strong)" stroke-width="1.5"/>`
const head = (cx, y, w) => `<path d="M${cx - w / 2},${y} H${cx + w * 0.18}" stroke="var(--ink)" stroke-width="7" stroke-opacity=".7"/>` +
  `<path d="M${cx + w * 0.26},${y} H${cx + w / 2}" stroke="var(--honey)" stroke-width="7"/>`
const comb = (cx, cy, r) => [[-1.732, 0, CELL], [0, 0, LIT], [1.732, 0, CELL]].map(([dx, dy, a]) => hex(cx + dx * r, cy + dy * r, r, a)).join('')
const lines = (x, y, w, n, gap = 14) => Array.from({ length: n }, (_, i) =>
  `<path d="M${x},${y + i * gap} H${x + w * [1, 0.8, 0.9, 0.6][i % 4]}" stroke="var(--dim)" stroke-width="3" stroke-opacity=".7"/>`).join('')
const ticks = (x, y, w, n) => Array.from({ length: n }, (_, i) => {
  const s = w / n
  return `<path d="M${x + i * s + 2},${y} H${x + (i + 1) * s - 2}" stroke="${i === 0 ? 'var(--honey-fill)' : 'var(--line-strong)'}" stroke-width="3"/>`
}).join('')

// the wide page
const W = { x: 40, y: 50, w: 520, h: 262 }
// the phone
const P = { x: 720, y: 24, w: 176, h: 296 }

module.exports = () => svg('the same page on a wide screen, picture and panel side by side, and on a phone, where the panel moves under the picture into one column; every page is opened at a phone’s width and fails if it scrolls sideways', [
  `<defs>${marker('ph-ah')}</defs>`,
  // the wide screen, and the phone
  `<g data-id="wide">${device(W.x, W.y, W.w, W.h)}${text(W.x + W.w / 2, 368, 'a wide screen', 'd', 22)}${head(300, 76, 230)}</g>`,
  `<g data-id="phone"><rect x="${P.x}" y="${P.y}" width="${P.w}" height="${P.h}" rx="16" fill="none" stroke="var(--dim)" stroke-width="1.5"/>` +
    `<path d="M${P.x + 70},${P.y + 10} h36" stroke="var(--line-strong)" stroke-width="3"/>${head(808, 48, 120)}</g>`,
  // the picture, on each
  `<g data-id="figure">${box(62, 96, 270, 144)}${comb(197, 168, 34)}</g>`,
  `<g data-id="figure">${box(734, 62, 148, 92)}${comb(808, 108, 22)}</g>`,
  // the panel beside it, then under it
  `<g data-id="panel">${box(346, 96, 192, 144)}${lines(368, 128, 148, 5, 20)}</g>`,
  `<g data-id="panel">${box(734, 164, 148, 70)}${lines(750, 184, 116, 3, 15)}</g>`,
  flow('M542,206 C620,206 650,199 726,199', 'ph-ah', 2.5),
  // the caption and the steps, on each
  `<g data-id="caption"><rect x="140" y="252" width="400" height="56" fill="none" stroke="none"/>${lines(150, 262, 300, 2)}${ticks(150, 296, 300, 6)}${text(470, 302, '01 / 06', 'm d', 16, 'start')}</g>`,
  `<g data-id="caption"><rect x="734" y="244" width="148" height="60" fill="none" stroke="none"/>${lines(744, 254, 128, 3, 12)}${ticks(744, 296, 128, 6)}</g>`,
  // the width every page is opened at
  `<g data-id="check"><rect x="${P.x}" y="332" width="${P.w}" height="44" fill="none" stroke="none"/>` +
    `<path d="M${P.x},340 H${P.x + P.w} M${P.x},332 v16 M${P.x + P.w},332 v16" stroke="var(--honey)" stroke-width="1.5"/>` +
    text(P.x + P.w / 2, 370, 'phone width', 'm hy', 18) + `</g>`,
].join('\n'))
