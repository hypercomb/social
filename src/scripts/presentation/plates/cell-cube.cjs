// 12 — one tile, yours: visuals/cell-cube.svg
const { f1, hexPts, hex, LIT, CELL, GHOST, STEEL, marker, markerS, flow, ghost, text, svg, note, beeDef, server, check, device, part } = require('./lib.cjs')

module.exports = () => {
  const cells = []
  const r = 44, w = 76.2, h = 66
  for (let row = -3; row <= 3; row++) for (let col = -5; col <= 5; col++) {
    const x = 480 + col * w + (row % 2 ? w / 2 : 0), y = 183 + row * h
    if (!(row === 0 && col === 0)) cells.push(hex(x, y, r, GHOST))
  }
  return svg('one lit tile in an open lattice of tiles, on your own device', [
    `<clipPath id="cc-clip"><rect x="202" y="50" width="556" height="266"/></clipPath>`,
    part('device', device(200, 48, 560, 270),
    `<g clip-path="url(#cc-clip)">${cells.join('')}</g>`,
    text(480, 352, 'your device', 'd', 18)),
    part('tile', hex(480, 183, 44, LIT), note(462, 170, 36, 28)),
  ].join('\n'))
}
