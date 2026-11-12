// system — the hive in the words of an operating system
// (presentation-blueprint.md, "The shared system, in the words people already
// know"). Eight cards, two rows of four. Each card says the word people
// already know above, and the thing in the hive it points at below: files are
// atoms, folders are layers, programs are bees, the command line is
// sentences, installing is replication, updates are notices, the network is
// your hosts. The eighth, the rules screen for accepting other people's code,
// is drawn dashed and says planned (code-admission.md: designed, not built).
const { text, svg, part } = require('../../../../presentation/plates/lib.cjs')

const CARD = { x: 44, w: 200, gap: 24, ys: [36, 212], h: 152 }
const CARDS = [
  ['files', 'files', 'atoms', 'named by signature'],
  ['folders', 'folders', 'layers', 'a word, and its words'],
  ['programs', 'programs', 'bees', 'a tile turns them on'],
  ['command', 'command line', 'sentences', 'for people and agents'],
  ['installing', 'installing', 'replication', 'from a host you follow'],
  ['updates', 'updates', 'notices', 'take or skip'],
  ['network', 'network', 'your hosts', 'no centre'],
  ['rules', 'permissions', 'rules screen', 'planned'],
]

const card = ([id, known, here, how], i) => {
  const x = CARD.x + (i % 4) * (CARD.w + CARD.gap)
  const y = CARD.ys[Math.floor(i / 4)]
  const cx = x + CARD.w / 2
  const planned = id === 'rules'
  return part(id,
    `<rect x="${x}" y="${y}" width="${CARD.w}" height="${CARD.h}" rx="3" fill="${planned ? 'none' : 'var(--panel)'}" ` +
      (planned ? 'stroke="var(--line-strong)" stroke-width="1.2" stroke-dasharray="5 5"/>' : 'stroke="var(--honey-deep)" stroke-width="1.5"/>'),
    text(cx, y + 36, known, 'd', 18),
    `<path d="M${cx},${y + 50} V${y + 70} M${cx - 6},${y + 64} L${cx},${y + 70} L${cx + 6},${y + 64}" fill="none" stroke="var(--line-strong)" stroke-width="1.5"/>`,
    text(cx, y + 104, here, planned ? 'k st' : 'k hy', 24),
    text(cx, y + 132, how, planned ? 'm f' : 'f', 15))
}

module.exports = () => svg('eight cards, each a familiar word over what it is in the hive: files are atoms named by signature, folders are layers, programs are bees a tile turns on, the command line is sentences, installing is replication from a host you follow, updates are notices you take or skip, the network is your hosts with no centre, and the rules screen for permissions is planned',
  CARDS.map(card).join('\n'))
