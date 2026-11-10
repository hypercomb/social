// host — hosting your hive from this computer (becoming-a-host.md, "Host your
// hive from this computer (built)"; the rest of that document is design). Top
// left, a reader: reading and taking need no host. Below, this computer, with
// the desktop app open. Every act that puts the hive online passes one card
// first: it asks, and says what becomes readable. From there, two addresses:
// a temporary one with no account, and your own domain, which is then checked
// the way a visitor would fetch it. On the right, the other people who reach
// your work at those addresses. Under the ask, the control that stops it. And
// a dashed card for the rest of the host path, which is planned.
const { hex, LIT, text, svg, flow, marker, check, device, part } = require('../../../../presentation/plates/lib.cjs')

const person = (x, y) => `<circle cx="${x}" cy="${y - 10}" r="8" fill="none" stroke="var(--dim)" stroke-width="1.5"/>` +
  `<path d="M${x - 14},${y + 16} C${x - 14},${y - 2} ${x + 14},${y - 2} ${x + 14},${y + 16}" fill="none" stroke="var(--dim)" stroke-width="1.5"/>`

// reading and taking need no host
const reader = part('reader',
  person(64, 54),
  text(92, 62, 'reading and taking need no host', 'd', 16, 'start'))

// this computer, the desktop app open
const computer = part('computer',
  device(70, 124, 180, 116),
  hex(160, 182, 34, LIT),
  text(160, 292, 'this computer', 'k hy', 20),
  text(160, 316, 'the desktop app, open', 'f', 15))

// every act that puts the hive online asks first
const ASK = { x: 300, y: 142, w: 180, h: 80 }
const ask = part('ask',
  flow(`M256,182 H${ASK.x - 6}`, 'host-arrow', 1.8),
  `<rect x="${ASK.x}" y="${ASK.y}" width="${ASK.w}" height="${ASK.h}" rx="3" fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.5"/>`,
  text(ASK.x + ASK.w / 2, ASK.y + 34, 'asks first', 'k', 18),
  text(ASK.x + ASK.w / 2, ASK.y + 60, 'what becomes readable', 'f', 14))

// take it offline stops it
const offline = part('offline',
  `<rect x="${ASK.x}" y="262" width="${ASK.w}" height="40" rx="20" fill="var(--bg)" stroke="var(--steel)" stroke-width="1.5"/>`,
  `<rect x="${ASK.x + 18}" y="276" width="12" height="12" rx="1" fill="none" stroke="var(--steel)" stroke-width="1.6"/>`,
  text(ASK.x + ASK.w / 2 + 12, 288, 'take it offline', 'k st', 16))

// two addresses: a temporary one, and your own domain
const PILL = { x: 540, w: 220, h: 44 }
const TRY = 70, DOMAIN = 190
const pill = (y, s) => `<rect x="${PILL.x}" y="${y}" width="${PILL.w}" height="${PILL.h}" rx="22" fill="var(--bg)" stroke="var(--honey)" stroke-width="1.5"/>` +
  text(PILL.x + PILL.w / 2, y + 29, s, 'k', 18)
const attempt = part('try',
  flow(`M${ASK.x + ASK.w + 4},${ASK.y + 24} C${ASK.x + ASK.w + 34},${ASK.y + 24} ${PILL.x - 40},${TRY + 22} ${PILL.x - 6},${TRY + 22}`, 'host-arrow', 1.8),
  pill(TRY, 'temporary address'),
  text(PILL.x + PILL.w / 2, TRY + 68, 'no account', 'f', 15))
const domain = part('domain',
  flow(`M${ASK.x + ASK.w + 4},${ASK.y + 56} C${ASK.x + ASK.w + 34},${ASK.y + 56} ${PILL.x - 40},${DOMAIN + 22} ${PILL.x - 6},${DOMAIN + 22}`, 'host-arrow', 1.8),
  pill(DOMAIN, 'your domain'))

// check it: the address fetched the way a visitor would
const checked = part('check',
  check(PILL.x + 58, DOMAIN + 70),
  text(PILL.x + 74, DOMAIN + 76, 'checked as a visitor', 'd', 15, 'start'))

// the people who reach your work there
const OTHERS = { x: 868, y: 150 }
const others = part('others',
  `<path d="M${PILL.x + PILL.w + 4},${TRY + 22} C${PILL.x + PILL.w + 40},${TRY + 22} ${OTHERS.x - 60},${OTHERS.y - 14} ${OTHERS.x - 24},${OTHERS.y - 8}" fill="none" stroke="var(--line-strong)" stroke-width="1.5" stroke-dasharray="4 5"/>`,
  `<path d="M${PILL.x + PILL.w + 4},${DOMAIN + 22} C${PILL.x + PILL.w + 40},${DOMAIN + 22} ${OTHERS.x - 60},${OTHERS.y + 20} ${OTHERS.x - 24},${OTHERS.y + 10}" fill="none" stroke="var(--line-strong)" stroke-width="1.5" stroke-dasharray="4 5"/>`,
  person(OTHERS.x, OTHERS.y), person(OTHERS.x + 40, OTHERS.y),
  text(OTHERS.x + 20, OTHERS.y + 46, 'other people', 'd', 16))

// the rest of the path: design, not built
const REST = { x: 540, y: 316, w: 380, h: 60 }
const planned = part('planned',
  `<rect x="${REST.x}" y="${REST.y}" width="${REST.w}" height="${REST.h}" rx="3" fill="none" stroke="var(--line-strong)" stroke-width="1.2" stroke-dasharray="5 5"/>`,
  text(REST.x + REST.w / 2, REST.y + 28, 'the rest of the host path', 'k st', 17),
  text(REST.x + REST.w / 2, REST.y + 48, 'planned', 'm f', 14))

module.exports = () => svg('reading and taking need no host; this computer, with the desktop app open, can be one; every act that puts the hive online asks first and says what becomes readable; the hive then answers at a temporary address with no account, or at your own domain, which is checked the way a visitor would fetch it; other people reach your work there; take it offline stops it; the rest of the host path is planned', [
  `<defs>${marker('host-arrow')}</defs>`,
  reader, computer, ask, offline, attempt, domain, checked, others, planned,
].join('\n'))
