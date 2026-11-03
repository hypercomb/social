// the meta — meaning wraps the content. On the left, a layer (the mountains
// postcard from the tour's film): its background slot does not name the
// picture, it names an envelope. In the middle, that envelope, the meta: it
// declares one kind of four (layer, resource, dependency, bee — the absent
// three drawn faint), the one signature to follow, and how it is held. On the
// right, the picture's bytes, untouched. A child is an envelope too, around a
// layer. The hex is real: the envelope is mintMetaEnvelope's bytes
// {"meta":1,"resource":<the picture>,"relation":"background"}, and its
// signature is what the layer's slot holds.
const { hex, CELL, marker, flow, text, svg } = require('../../../../presentation/plates/lib.cjs')

const LAY = { x: 36, y: 92, w: 262, h: 196 }
const ENV = { x: 352, y: 40, w: 272, h: 314 }
const ER = i => ENV.y + 82 + i * 38          // envelope rows
const KEY = ENV.x + 22, VAL = ENV.x + 134
const PIC = { x: 704, y: 118, w: 200, h: 148 }

const lrow = (y, key, sig, cls) => text(LAY.x + 20, y + 6, key, 'm d', 18, 'start') + text(LAY.x + LAY.w - 18, y + 6, sig, cls, 18, 'end')
const erow = (i, key, val = '', keyCls = 'm d', valCls = 'm k') =>
  text(KEY, ER(i) + 6, key, keyCls, 18, 'start') + (val ? text(VAL, ER(i) + 6, val, valCls, 18, 'start') : '')
const band = (i, n = 1, attrs = 'fill="none" stroke="none"') =>
  `<rect x="${ENV.x + 10}" y="${ER(i) - 18}" width="${ENV.w - 20}" height="${n * 38 - 2}" rx="2" ${attrs}/>`

module.exports = () => svg('a layer’s background slot names an envelope, not the picture; the envelope declares one kind of four, resource, the signature to follow and how it is held; the picture’s bytes are untouched; a child is an envelope too', [
  `<defs>${marker('pm-ah')}</defs>`,
  // the layer
  `<g data-id="layer"><rect x="${LAY.x}" y="${LAY.y}" width="${LAY.w}" height="${LAY.h}" rx="3" fill="var(--panel)" stroke="var(--line-strong)" stroke-width="1.2"/>` +
    hex(LAY.x + 30, LAY.y + 34, 13, CELL) + text(LAY.x + 54, LAY.y + 40, 'mountains', 'k', 18, 'start') +
    `<path d="M${LAY.x + 16},${LAY.y + 64} H${LAY.x + LAY.w - 16}" stroke="var(--line)" stroke-width="1"/></g>`,
  text(LAY.x + LAY.w / 2, LAY.y + LAY.h + 36, 'a layer', 'f', 18),
  `<g data-id="kids"><rect x="${LAY.x + 8}" y="${LAY.y + 76}" width="${LAY.w - 16}" height="40" rx="2" fill="none" stroke="none"/>${lrow(LAY.y + 96, 'children', '78567596…', 'm d')}</g>`,
  `<g data-id="ref"><rect x="${LAY.x + 8}" y="${LAY.y + 128}" width="${LAY.w - 16}" height="44" rx="2" fill="var(--honey-tint)" stroke="none"/>${lrow(LAY.y + 150, 'background', '9fe1f0c3…', 'm k hy')}` +
    `<path d="M${LAY.x + LAY.w + 4},${LAY.y + 150} C${LAY.x + LAY.w + 36},${LAY.y + 150} ${ENV.x - 34},${ENV.y + 30} ${ENV.x - 4},${ENV.y + 30}" fill="none" stroke="var(--honey-deep)" stroke-width="1.5"/>` +
    `<circle cx="${ENV.x - 4}" cy="${ENV.y + 30}" r="3.5" fill="var(--honey-deep)"/></g>`,
  // the envelope
  `<g data-id="env"><rect x="${ENV.x}" y="${ENV.y}" width="${ENV.w}" height="${ENV.h}" rx="3" fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.5"/>` +
    text(KEY, ENV.y + 36, 'META', 'm hy', 16, 'start', 'letter-spacing="3"') + text(ENV.x + ENV.w - 22, ENV.y + 36, '9fe1f0c3…', 'm f', 16, 'end') +
    `<path d="M${ENV.x + 16},${ENV.y + 52} H${ENV.x + ENV.w - 16}" stroke="var(--line)" stroke-width="1"/>` +
    erow(0, 'meta', '1', 'm d', 'm k') + `</g>`,
  `<g data-id="k-layer">${band(1)}${erow(1, 'layer', '', 'm f')}</g>`,
  `<g data-id="k-resource">${band(2, 1, 'fill="var(--honey-tint)" stroke="var(--honey)" stroke-width="1.2"')}${erow(2, 'resource', 'deaad403…', 'm k hy', 'm k hy')}</g>`,
  `<g data-id="k-other">${band(3, 2)}${erow(3, 'dependency', '', 'm f')}${erow(4, 'bee', '', 'm f')}</g>`,
  `<g data-id="relation">${band(5)}${erow(5, 'relation', 'background', 'm d', 'm k')}</g>`,
  // the picture, untouched
  `<g data-id="bytes"><rect x="${PIC.x}" y="${PIC.y}" width="${PIC.w}" height="${PIC.h + 48}" fill="none" stroke="none"/><path d="M${PIC.x + 3},${PIC.y} H${PIC.x + PIC.w - 30} L${PIC.x + PIC.w},${PIC.y + 30} V${PIC.y + PIC.h - 3} a3,3 0 0 1 -3,3 H${PIC.x + 3} a3,3 0 0 1 -3,-3 V${PIC.y + 3} a3,3 0 0 1 3,-3 Z" fill="var(--bg)" stroke="var(--line-strong)" stroke-width="1.5"/>` +
    `<path d="M${PIC.x + PIC.w - 30},${PIC.y} V${PIC.y + 30} H${PIC.x + PIC.w}" fill="none" stroke="var(--line-strong)" stroke-width="1.5"/>` +
    `<path d="M${PIC.x + 22},${PIC.y + PIC.h - 22} L${PIC.x + 78},${PIC.y + 58} L${PIC.x + 108},${PIC.y + 92} L${PIC.x + 138},${PIC.y + 70} L${PIC.x + 188},${PIC.y + PIC.h - 22} Z" fill="none" stroke="var(--steel)" stroke-width="1.8"/>` +
    `<circle cx="${PIC.x + 160}" cy="${PIC.y + 52}" r="11" fill="none" stroke="var(--honey-deep)" stroke-width="1.5"/>` +
    text(PIC.x + PIC.w / 2, PIC.y + PIC.h + 38, 'deaad403…', 'm d', 18) +
    flow(`M${ENV.x + ENV.w + 4},${ER(2)} C${ENV.x + ENV.w + 40},${ER(2)} ${PIC.x - 40},${PIC.y + PIC.h / 2} ${PIC.x - 6},${PIC.y + PIC.h / 2}`, 'pm-ah') + `</g>`,
  text(PIC.x + PIC.w / 2, PIC.y + PIC.h + 66, 'the picture, untouched', 'f', 18),
].join('\n'))
