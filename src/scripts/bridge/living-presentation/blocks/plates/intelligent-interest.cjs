// interest — a pheromone is a signed interest signal, never a label (doctrine
// R1, R2, R3; pheromones.md, intake-filter.md). Middle, a piece of content
// with its name above it: the name says what it is. On it, a small signed
// signal: worth attention. Left, who can leave one: you, someone else, or an
// agent that read the content. Right, your interests: a private list that is
// never sent, and the line where a signal meets it is a match. Bottom, the
// part that is planned and not built: the signal travelling with its content
// to another hive.
const { hex, CELL, GHOST, text, svg, flow, marker, check, part } = require('../../../../presentation/plates/lib.cjs')

const person = (x, y) => `<circle cx="${x}" cy="${y - 10}" r="8" fill="none" stroke="var(--dim)" stroke-width="1.5"/>` +
  `<path d="M${x - 14},${y + 16} C${x - 14},${y - 2} ${x + 14},${y - 2} ${x + 14},${y + 16}" fill="none" stroke="var(--dim)" stroke-width="1.5"/>`
const dashed = (d) => `<path d="${d}" fill="none" stroke="var(--line-strong)" stroke-width="1.5" stroke-dasharray="4 5"/>`

const AT = { x: 310, y: 196 }
const content = part('content',
  hex(AT.x, AT.y, 46, CELL),
  text(AT.x, AT.y + 6, 'content', 'k', 16))

// the name says what it is
const name = part('name',
  text(AT.x, 70, 'its name says what it is', 'd', 14),
  `<rect x="${AT.x - 60}" y="84" width="120" height="34" rx="17" fill="var(--bg)" stroke="var(--honey-deep)" stroke-width="1.5"/>`,
  text(AT.x, 107, 'garden', 'm k', 16))

// the signal: signed, and left on the content
const deposit = part('deposit',
  `<circle cx="362" cy="158" r="9" fill="var(--honey-fill)" fill-opacity=".3" stroke="var(--honey)" stroke-width="2"/>`,
  text(382, 156, 'worth attention', 'k hy', 15, 'start'),
  text(382, 176, 'signed', 'm f', 14, 'start'))

// who can leave one
const authors = part('authors',
  person(60, 116), text(88, 122, 'you', 'd', 14, 'start'),
  person(60, 196), text(88, 202, 'someone else', 'd', 14, 'start'),
  hex(60, 276, 13, CELL), text(88, 281, 'an agent', 'd', 14, 'start'),
  dashed(`M130,118 L262,176`), dashed(`M192,198 H256`), dashed(`M160,276 L262,218`))

// your interests: private, never sent
const BOX = { x: 650, y: 110, w: 250, h: 150 }
const interests = part('interests',
  text(BOX.x + BOX.w / 2, 94, 'your interests', 'k hy', 18),
  `<rect x="${BOX.x}" y="${BOX.y}" width="${BOX.w}" height="${BOX.h}" rx="3" fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.5"/>`,
  text(BOX.x + 24, 156, 'watch for: garden', 'm k', 14, 'start'),
  text(BOX.x + 24, 190, 'never: spam', 'm', 14, 'start'),
  text(BOX.x + BOX.w / 2, 238, 'private, never sent', 'f', 14))

// a match brings it forward
const match = part('match',
  flow(`M520,151 H642`, 'interest-arrow', 1.8),
  check(580, 132),
  text(580, 176, 'a match', 'k', 15))

// travelling with its content: planned
const travel = part('travel',
  dashed(`M310,246 V318 H446`),
  `<circle cx="380" cy="318" r="6" fill="none" stroke="var(--steel)" stroke-width="1.6"/>`,
  hex(478, 318, 26, GHOST + ' stroke-dasharray="5 5"'),
  text(478, 370, 'another hive', 'd', 14),
  text(524, 314, 'travelling with its content', 'k st', 15, 'start'),
  text(524, 336, 'planned', 'm f', 14, 'start'))

module.exports = () => svg('a piece of content carries a small signed signal that says it is worth attention; its name, not the signal, says what it is; you, someone else or an agent can leave a signal; your interests are a private list that is never sent, and a match between a signal and that list brings the content forward; a signal travelling with its content to another hive is planned', [
  `<defs>${marker('interest-arrow')}</defs>`,
  authors, content, name, deposit, interests, match, travel,
].join('\n'))
