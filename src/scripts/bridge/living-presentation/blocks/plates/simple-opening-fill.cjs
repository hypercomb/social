// move six — the points fill a cube nobody drew. Every tile from moves four
// and five shrinks to a point: words run across, versions climb, origins run
// back (the same slant as move five). The front face is move four's six
// columns, at their own heights; behind simple stand move five's other hands.
// A place no version fills yet stays an outline, so the cube is whole. Its
// edges appear only at the end, faintly: the shape the points already make.
const { hex, LIT, CELL, GHOST, ghost, text, svg } = require('../../../../presentation/plates/lib.cjs')

// the cube's frame (move seven draws the same cube in the same place)
const X0 = 314, Y0 = 306, SW = 44, SV = 73, DX = 56, DY = -20, R = 13
const P = (w, v, o) => [X0 + w * SW + o * DX, Y0 - v * SV + o * DY]
// how many versions each word has, from each hand: you (move four), ann, bo
const HEIGHT = [[4, 2, 3, 1, 3, 2], [3, 4, 4, 3, 4, 4], [2, 4, 3, 4, 4, 3]]
// nearer points read stronger: depth told by the stroke alone
const NEAR = ['1', '.7', '.45']

const corners = (pad) => {
  const [l, b] = [X0 - pad, Y0 + pad], [r, t] = [X0 + 5 * SW + pad, Y0 - 3 * SV - pad]
  const d = [2 * DX, 2 * DY]
  return { l, b, r, t, d }
}

const plate = () => {
  const groups = { front: [], spread: [], rest: [] }
  const empty = []
  for (let o = 2; o >= 0; o--) for (let w = 0; w < 6; w++) for (let v = 0; v < 4; v++) {
    const [x, y] = P(w, v, o)
    const filled = v < HEIGHT[o][w]
    if (!filled) { empty.push(hex(x, y, R, GHOST)); continue }
    const shape = hex(x, y, R, `${CELL} stroke-opacity="${NEAR[o]}"`)
    if (o === 0) groups.front.push(shape)
    else if (w === 0) groups.spread.push(shape)
    else groups.rest.push(shape)
  }
  const { l, b, r, t, d } = corners(R + 10)
  const [ex, ey] = d
  const hull = [
    `M${l},${b} H${r} V${t} H${l} Z`,
    `M${l + ex},${b + ey} H${r + ex} V${t + ey} H${l + ex} Z`,
    `M${l},${b} l${ex},${ey} M${r},${b} l${ex},${ey} M${r},${t} l${ex},${ey} M${l},${t} l${ex},${ey}`,
  ].map(ghost).join('')
  const [sx, sy] = P(0, 0, 0)
  return svg('six words, four versions and three origins as points in three directions; together they fill a cube that was never drawn', [
    `<g data-id="hull">${hull.replace(/stroke="var\(--line\)"/g, 'stroke="var(--honey-deep)" stroke-opacity=".6"')}</g>`,
    `<g data-id="empty">${empty.join('')}</g>`,
    `<g data-id="rest">${groups.rest.join('')}</g>`,
    `<g data-id="spread">${groups.spread.join('')}</g>`,
    `<g data-id="front">${groups.front.join('')}</g>`,
    `<g data-id="simple">${hex(sx, sy, R + 3, LIT)}</g>`,
    `<g data-id="ax-words">${text(X0 + 2.5 * SW, Y0 + R + 34, 'words', 'k', 18)}</g>`,
    `<g data-id="ax-versions">${text(X0 - R - 26, Y0 - 1.5 * SV + 6, 'versions', 'k', 18, 'end')}</g>`,
    `<g data-id="ax-origins">${text(X0 + 5 * SW + 2 * DX + R + 26, Y0 + 2 * DY + 6, 'origins', 'k', 18, 'start')}</g>`,
    text(sx - R - 10, sy + 6, 'simple', 'hy', 18, 'end'),
  ].join('\n'))
}

// move seven draws this same cube, in the same place
plate.cube = { X0, Y0, SW, SV, DX, DY, R, P, HEIGHT, NEAR }
module.exports = plate
