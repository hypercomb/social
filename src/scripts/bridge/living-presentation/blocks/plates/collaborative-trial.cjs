// the trial door — a change tried in public, then promoted by one pointer.
// On the left, the door: try-cards on your own domain, one DNS label
// (try-page.ts trialLabel, core sandbox-door.ts). It is its own origin, so the
// bubble is the browser's own wall: the host refuses every write whose Origin
// is a door, and the shell holds no key there (module-sandbox.md, "a door
// writes nothing"). Its name points at the change's files on the host. On the
// right, the live name, cards, still points at what people run. Promotion is
// module promote: setHiveRoot stamps the live name with the root the door
// already ran. Same files, no rebuild, no upload: one pointer moves.
const { hex, LIT, CELL, STEEL, marker, markerS, flow, text, svg, note } = require('../../../../presentation/plates/lib.cjs')

const B = { x: 572, y: 286, r: 56 }          // the change's files, on your host
const A = { x: 828, y: 286, r: 56 }          // the files the live site runs now
const SEAL = { x: 32, y: 32, w: 400, h: 336 }

// a small comb: the trial page, running inside its door
const comb = (cx, cy) => {
  const r = 15, w = r * 1.732
  return [[0, 0], [w, 0], [-w, 0], [w / 2, r * 1.5], [-w / 2, r * 1.5], [w / 2, -r * 1.5], [-w / 2, -r * 1.5]]
    .map(([dx, dy], i) => hex(cx + dx, cy + dy, r - 1.5, i === 0
      ? 'fill="var(--honey-fill)" fill-opacity=".55" stroke="var(--honey)" stroke-width="1.5"'
      : 'fill="none" stroke="var(--honey-deep)" stroke-width="1.3"')).join('')
}
const pill = (x, y, w, label, cls) =>
  `<rect x="${x}" y="${y}" width="${w}" height="52" rx="26" fill="var(--panel)" stroke="${cls === 'hy' ? 'var(--honey)' : 'var(--steel)'}" stroke-width="1.5"/>` +
  text(x + w / 2, y + 33, label, `m k ${cls}`, 20)

module.exports = () => svg('a change at try-cards on your domain, sealed in its own origin with no writes and no keys, points at its own files; the live name cards points at what people run; promoting moves the live name to the trial’s files', [
  `<defs>${marker('tr-ah')}${markerS('tr-as')}</defs>`,
  // the door: its name, and the change running behind it
  `<g data-id="door"><rect x="48" y="48" width="368" height="52" rx="16" fill="var(--honey-tint)" stroke="var(--honey-deep)" stroke-width="1.2"/>` +
    text(232, 81, 'try-cards.yourname.com', 'm k hy', 20) +
    comb(136, 206) + text(136, 282, 'the change', 'd', 20) +
    `<path d="M418,88 C478,112 522,168 540,224" fill="none" stroke="var(--steel)" stroke-width="1.5" marker-end="url(#tr-as)"/></g>`,
  // its own origin: the browser's wall around everything it does
  `<g data-id="sealed"><rect x="${SEAL.x}" y="${SEAL.y}" width="${SEAL.w}" height="${SEAL.h}" rx="28" fill="none" stroke="var(--honey-deep)" stroke-width="1.5" stroke-dasharray="6 6"/>` +
    text(SEAL.x + SEAL.w / 2, SEAL.y + SEAL.h - 22, 'its own origin', 'f', 20) + `</g>`,
  // what it cannot do: write to the host, or sign with a key
  `<g data-id="refused"><rect x="240" y="140" width="200" height="180" fill="none" stroke="none"/>` +
    `<path d="M256,174 H416" stroke="var(--steel)" stroke-width="1.5" marker-end="url(#tr-as)"/>` +
    `<path d="M432,154 V194" stroke="var(--danger)" stroke-width="3"/>` +
    text(330, 214, 'no writes', 'd', 20) +
    `<circle cx="282" cy="258" r="14" fill="none" stroke="var(--steel)" stroke-width="1.8"/>` +
    `<path d="M296,258 H360 M346,258 V271 M358,258 V269" fill="none" stroke="var(--steel)" stroke-width="1.8"/>` +
    `<path d="M262,282 L374,234" stroke="var(--danger)" stroke-width="3"/>` +
    text(318, 312, 'no keys', 'd', 20) + `</g>`,
  // the change's files, named by their signatures, on your host
  `<g data-id="files"><rect x="${B.x - 80}" y="${B.y - B.r}" width="160" height="${B.r * 2 + 44}" fill="none" stroke="none"/>` +
    hex(B.x, B.y, B.r, LIT) + note(B.x - 20, B.y - 16, 40, 32) +
    text(B.x, B.y + B.r + 34, 'its files', 'd', 20) + `</g>`,
  // the live name, and what it runs today
  `<g data-id="live">${pill(608, 48, 320, 'cards.yourname.com', 'st')}</g>`,
  `<g data-id="was"><rect x="${A.x - 80}" y="${A.y - B.r}" width="160" height="${A.r * 2 + 44}" fill="none" stroke="none"/>` +
    hex(A.x, A.y, A.r, STEEL) + note(A.x - 20, A.y - 16, 40, 32) +
    text(A.x, A.y + A.r + 34, 'what runs now', 'd', 20) +
    `<path d="M808,102 C816,140 826,180 828,222" fill="none" stroke="var(--steel)" stroke-width="1.5" marker-end="url(#tr-as)"/></g>`,
  // promotion: the live name now names the files the door ran
  `<g data-id="promote">${flow('M712,102 C688,160 640,196 610,228', 'tr-ah')}</g>`,
].join('\n'))
