// hosting — what a host adds. On the left, a hive with no host: it sees only
// the hive online beside it, joined for as long as both are there. On the
// right, three hosts, each answering the same address for the same word, and
// each listing what it holds there from different makers. The address is real:
// d13e… is the first four hex of sha256('pictures:' + sha256('garden')), the
// pool a name's pictures will be listed under (pools-across-hosts.md, "What a
// host adds"). Your hive asks all three and finds them whether or not their
// makers are online.
const { hex, CELL, LIT, GHOST, text, svg, server, flow, marker, part } = require('../../../../presentation/plates/lib.cjs')

const R = 22
const AT = [[0, 0], [1.732, 0], [0.866, -1.5], [-0.866, -1.5], [-1.732, 0], [-0.866, 1.5], [0.866, 1.5]]
const comb = (x, y, centre = LIT) => AT.map(([dx, dy], i) => hex(x + dx * R, y + dy * R, R - 1, i ? CELL : centre)).join('')

const YOU = { x: 120, y: 190 }
const ANN = { x: 300, y: 190 }
const HOSTS = [520, 670, 820]
const SERVER_Y = 92
const SERVER_W = 110

const you = part('you', comb(YOU.x, YOU.y), text(YOU.x, YOU.y + 86, 'your hive', 'k hy', 20))
const online = part('online',
  comb(ANN.x, ANN.y, CELL),
  text(ANN.x, ANN.y + 86, 'ann, online', 'k', 18),
  `<path d="M${YOU.x + 2 * R},${YOU.y} L${ANN.x - 2 * R},${ANN.y}" fill="none" stroke="var(--line-strong)" stroke-width="1.5" stroke-dasharray="4 6"/>`,
  text((YOU.x + ANN.x) / 2, YOU.y + 124, 'only who is online', 'd', 16))

const hosts = part('hosts',
  ...HOSTS.map(x => server(x - SERVER_W / 2, SERVER_Y, SERVER_W)),
  text(HOSTS[1], SERVER_Y - 22, 'hosts', 'k', 20))

const address = part('address', ...HOSTS.map(x => text(x, SERVER_Y + 128, 'garden → d13e', 'm', 15)))

// what each host lists at that address: pictures from different makers
const PICTURES = [[0, 1], [1, 2, 0], [2]]
const pool = part('pool', ...HOSTS.flatMap((x, h) => PICTURES[h].map((_, i, all) =>
  hex(x + (i - (all.length - 1) / 2) * 34, SERVER_Y + 172, 15, LIT))))

const found = part('found', ...HOSTS.map(x =>
  flow(`M${YOU.x + 40},${YOU.y + 64} C${YOU.x + 160},${YOU.y + 150} ${x - 60},${SERVER_Y + 230} ${x - 24},${SERVER_Y + 196}`, 'hosting-arrow', 1.6)))

module.exports = () => svg('your hive with no host sees only ann, who is online beside it; three hosts each answer the same address for the word garden and list pictures from different makers, which your hive finds whether or not their makers are online', [
  `<defs>${marker('hosting-arrow')}</defs>`,
  `<path d="M410,40 V360" ${GHOST}/>`,
  found, online, you, hosts, address, pool,
].join('\n'))
