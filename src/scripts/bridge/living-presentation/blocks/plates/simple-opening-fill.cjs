// move six — the points fill a cube nobody drew. Every tile from moves four
// and five shrinks to a point: words run across, versions climb, origins run
// back along move five's slant (one step back is half a step up). The front
// face is move four's six columns, at their own heights; behind simple stand
// move five's other hands, on move five's floor. Only versions that exist are
// drawn, so the cube is nothing but the points: its edges appear at the end,
// faintly, as the shape the points already make.
//
// The depth step is kept well under half the word step and the version step,
// so a point behind never lands between two columns in front; nearer points
// are larger and stronger, so depth reads without a single extra line.
const { hex, LIT, CELL, ghost, text, svg } = require('../../../../presentation/plates/lib.cjs')

// the cube's frame (move seven draws the same cube in the same place)
const X0 = 244, Y0 = 318, SW = 76, SV = 70, DX = 46, DY = -23
const RS = [13, 11, 9]                       // a point's size, nearest first
const R = RS[0]
const P = (w, v, o) => [X0 + w * SW + o * DX, Y0 - v * SV + o * DY]
// how many versions each word has, from each hand: you (move four), ann, bo
const HEIGHT = [[4, 2, 3, 1, 3, 2], [3, 4, 4, 3, 4, 4], [2, 4, 3, 4, 4, 3]]
// nearer points read stronger
const NEAR = ['1', '.7', '.45']
const PAD = R + 10
// the eight corners of the frame the points span, padded
const FRAME = [[0, 0, 0], [5, 0, 0], [5, 3, 0], [0, 3, 0], [0, 0, 2], [5, 0, 2], [5, 3, 2], [0, 3, 2]]
  .map(([w, v, o]) => { const [x, y] = P(w, v, o); return [x + (w ? PAD : -PAD), y + (v ? -PAD : PAD)] })
const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
const point = (w, v, o) => { const [x, y] = P(w, v, o); return hex(x, y, RS[o], `${CELL} stroke-opacity="${NEAR[o]}"`) }

const plate = () => {
  const groups = { front: [], spread: [], rest: [] }
  for (let o = 2; o >= 0; o--) for (let w = 0; w < 6; w++) for (let v = 0; v < HEIGHT[o][w]; v++) {
    if (o === 0 && w === 0 && v === 0) continue        // simple itself, drawn lit
    const shape = point(w, v, o)
    if (o === 0) groups.front.push(shape)
    else if (w === 0) groups.spread.push(shape)
    else groups.rest.push(shape)
  }
  const hull = EDGES.map(([a, b]) => `M${FRAME[a][0]},${FRAME[a][1]} L${FRAME[b][0]},${FRAME[b][1]}`).map(ghost).join('')
  const [sx, sy] = P(0, 0, 0), [fx, fy] = P(0, 0, 2)
  return svg('six words, their versions and three origins as points in three directions; together they fill a cube that was never drawn', [
    `<g data-id="hull">${hull.replace(/stroke="var\(--line\)"/g, 'stroke="var(--honey-deep)" stroke-opacity=".6"')}</g>`,
    `<g data-id="rest">${groups.rest.join('')}</g>`,
    // move five's floor: simple's other hands, standing behind it
    `<g data-id="spread">${ghost(`M${sx - 18},${sy + 9} L${fx + 18},${fy - 9}`)}${groups.spread.join('')}</g>`,
    `<g data-id="front">${groups.front.join('')}</g>`,
    `<g data-id="simple">${hex(sx, sy, R + 3, LIT)}</g>`,
    `<g data-id="ax-words">${text(X0 + 2.5 * SW, Y0 + R + 36, 'words', 'k', 18)}</g>`,
    `<g data-id="ax-versions">${text(X0 - PAD - 14, Y0 - 1.5 * SV + 6, 'versions', 'k', 18, 'end')}</g>`,
    `<g data-id="ax-origins">${text(FRAME[5][0] + 16, FRAME[5][1] + 6, 'origins', 'k', 18, 'start')}</g>`,
    text(sx - R - 12, sy + 6, 'simple', 'hy', 18, 'end'),
  ].join('\n'))
}

// move seven draws this same cube, in the same place
plate.cube = { X0, Y0, SW, SV, DX, DY, R, RS, P, HEIGHT, NEAR, PAD, FRAME, EDGES }
module.exports = plate
