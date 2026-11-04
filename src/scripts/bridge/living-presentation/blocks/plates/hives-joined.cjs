// tapestry: four hives, each the same shape; wherever two hold the same piece,
// by the same signature, a thread joins them.
const { svg, group, wire, curve, hex, text, f1, LIT, CELL } = require('./pieces.cjs')

const R = 24
const AROUND = [[1, 0], [0.5, -1], [-0.5, -1], [-1, 0], [-0.5, 1], [0.5, 1]].map(([a, b]) => [f1(a * Math.sqrt(3) * R), f1(b * 1.5 * R)])
// The cells a hive shares, by their place around its centre (0 right, then
// anticlockwise), and where its name sits.
const HIVES = [
  ['you', 170, 200, [1, 5], 'your hive', 286],
  ['ann', 480, 100, [3, 0], 'ann', 28],
  ['bo', 480, 300, [3, 0], 'bo', 388],
  ['cy', 790, 200, [2, 4], 'cy', 286],
]
const at = (id, k) => { const h = HIVES.find(v => v[0] === id); return [f1(h[1] + AROUND[k][0]), f1(h[2] + AROUND[k][1])] }

const hive = ([id, x, y, shared, name, ny]) => group(id,
  hex(x, y, R, CELL) + AROUND.map(([dx, dy], k) => hex(f1(x + dx), f1(y + dy), R, shared.includes(k) ? LIT : CELL)).join('') +
  text(x, ny, name, 'k', 17))

const thread = (id, [a, ka], [b, kb]) => { const [x1, y1] = at(a, ka), [x2, y2] = at(b, kb); return wire(id, curve(x1, y1, x2, y2), { width: 2 }) }

module.exports = () => svg('Four hives joined by threads wherever they hold the same piece', [
  thread('you-ann', ['you', 1], ['ann', 3]),
  thread('you-bo', ['you', 5], ['bo', 3]),
  thread('ann-cy', ['ann', 0], ['cy', 2]),
  thread('bo-cy', ['bo', 0], ['cy', 4]),
  ...HIVES.map(hive),
].join('\n'))
