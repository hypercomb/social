// editor/tile-look-overlay.ts
//
// THE TILE'S LOOK, DRAWN OVER THE PICTURE BEING FRAMED — the rim, the inner
// glow, the vignette, the bevel, the name band and the name, placed from the
// same numbers the hex shader uses (`presentation/grid/tile-look.ts`), so what
// the editor shows is the tile the hive will draw.
//
// It is a separate SVG layer ABOVE the picture and exists only on screen.
// Nothing here is ever captured: the save draws the original through
// `hex-capture.ts`, which has no rim to draw. Outside the hexagon the picture
// fades into the panel's own ground, so the part that will be cut off is still
// there to see, and the editor has no frame of its own.

import { TILE_LOOK, tileLookAa } from '../presentation/grid/tile-look.js'
import { frameSize, hexBox, type HexOrientation } from './crop-math.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
export const TILE_NAME_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'

export type TileLook = {
  orientation: HexOrientation
  border: string
  name: string
  showName: boolean
  hasPicture: boolean
  dragging: boolean
}

type Vertex = [number, number]

/** The hexagon's six vertices inside a box centred at (cx, cy). */
export const hexVertices = (orientation: HexOrientation, cx: number, cy: number, width: number, height: number): Vertex[] => {
  const w = width / 2
  const h = height / 2
  return orientation === 'flat-top'
    ? [[cx + w, cy], [cx + w / 2, cy + h], [cx - w / 2, cy + h], [cx - w, cy], [cx - w / 2, cy - h], [cx + w / 2, cy - h]]
    : [[cx, cy - h], [cx + w, cy - h / 2], [cx + w, cy + h / 2], [cx, cy + h], [cx - w, cy + h / 2], [cx - w, cy - h / 2]]
}

/** Move every edge in toward the centre by `by` — a hexagon shrunk about its
 *  centre moves its edges by (1 - factor) × apothem. */
const inset = (vertices: Vertex[], cx: number, cy: number, apothem: number, by: number): Vertex[] => {
  const factor = Math.max(0, (apothem - by) / apothem)
  return vertices.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor])
}

const points = (vertices: Vertex[]): string =>
  vertices.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')

const rgb = (triple: readonly number[], alpha = 1): string =>
  `rgba(${triple.map(c => Math.round(c * 255)).join(',')},${alpha})`

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  return node
}

/** What text on the tile actually sits on, for anything that measures it
 *  (`data-hc-ground`, read by scripts/drive-toolwindow-contrast.cjs): an empty
 *  tile's ground at its lightest, and the name band over a WHITE picture —
 *  the worst case the band can be laid over. */
export const EMPTY_TILE_GROUND = rgb(TILE_LOOK.empty.centre)
const BAND_OVER_WHITE = (() => {
  const v = Math.round(255 * (1 - TILE_LOOK.band.mixImage))
  return `rgb(${v},${v},${v})`
})()

let instances = 0

export class TileLookOverlay {
  readonly svg: SVGSVGElement
  /** The tile's name — real text, laid over the band. */
  readonly name: HTMLDivElement

  #clip: SVGPolygonElement
  #outside: SVGPathElement
  #empty: SVGPolygonElement
  #vignette: SVGCircleElement
  #band: SVGRectElement
  #glow: SVGPolygonElement
  #rim: SVGPolygonElement
  #bevel: SVGPolygonElement
  #vignetteGradient: SVGRadialGradientElement
  #emptyGradient: SVGRadialGradientElement
  #bevelGradient: SVGLinearGradientElement
  #outsideGradient: SVGRadialGradientElement
  #outsideNear: SVGStopElement

  constructor() {
    const id = `te-look-${++instances}`
    this.svg = el('svg', { class: 'te-look', 'aria-hidden': 'true', focusable: 'false' })
    const defs = el('defs')

    const clipPath = el('clipPath', { id: `${id}-clip` })
    this.#clip = el('polygon')
    clipPath.appendChild(this.#clip)

    this.#vignetteGradient = el('radialGradient', { id: `${id}-vignette`, gradientUnits: 'userSpaceOnUse' })
    // smoothstep(0.5, 1.0, dist) × 0.45, sampled — dist is measured in apothems.
    for (const [offset, t] of [[0.5, 0], [0.625, 0.156], [0.75, 0.5], [0.875, 0.844], [1, 1]] as const) {
      this.#vignetteGradient.appendChild(el('stop', {
        offset: String(offset),
        'stop-color': '#000',
        'stop-opacity': String(t * TILE_LOOK.vignette.strength),
      }))
    }

    this.#emptyGradient = el('radialGradient', { id: `${id}-empty`, gradientUnits: 'userSpaceOnUse' })
    this.#emptyGradient.appendChild(el('stop', { offset: '0', 'stop-color': rgb(TILE_LOOK.empty.centre) }))
    this.#emptyGradient.appendChild(el('stop', { offset: '1', 'stop-color': rgb(TILE_LOOK.empty.edge) }))

    this.#bevelGradient = el('linearGradient', { id: `${id}-bevel`, gradientUnits: 'userSpaceOnUse' })
    this.#bevelGradient.appendChild(el('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': String(TILE_LOOK.bevel.highlight) }))
    this.#bevelGradient.appendChild(el('stop', { offset: '0.5', 'stop-color': '#fff', 'stop-opacity': '0' }))
    this.#bevelGradient.appendChild(el('stop', { offset: '0.5', 'stop-color': '#000', 'stop-opacity': '0' }))
    this.#bevelGradient.appendChild(el('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': String(TILE_LOOK.bevel.shadow) }))

    // Outside the hexagon the picture fades into the panel's own ground, and
    // is gone by the stage's corners — so the stage never reads as a box.
    this.#outsideGradient = el('radialGradient', { id: `${id}-outside`, gradientUnits: 'userSpaceOnUse' })
    this.#outsideNear = el('stop', { offset: '0.6', style: 'stop-color:var(--te-ground,#0d151e);stop-opacity:0.62' })
    this.#outsideGradient.append(this.#outsideNear, el('stop', { offset: '1', style: 'stop-color:var(--te-ground,#0d151e);stop-opacity:1' }))

    defs.append(clipPath, this.#vignetteGradient, this.#emptyGradient, this.#bevelGradient, this.#outsideGradient)

    const clipped = el('g', { 'clip-path': `url(#${id}-clip)` })
    this.#empty = el('polygon', { class: 'te-look-empty', fill: `url(#${id}-empty)` })
    this.#vignette = el('circle', { class: 'te-look-vignette', fill: `url(#${id}-vignette)` })
    this.#band = el('rect', { class: 'te-look-band', fill: '#000' })
    this.#glow = el('polygon', { class: 'te-look-glow', fill: 'none' })
    this.#rim = el('polygon', { class: 'te-look-rim', fill: 'none' })
    this.#bevel = el('polygon', { class: 'te-look-bevel', fill: 'none', stroke: `url(#${id}-bevel)` })
    clipped.append(this.#vignette, this.#band, this.#glow, this.#rim, this.#bevel)

    this.#outside = el('path', { class: 'te-look-outside', 'fill-rule': 'evenodd', fill: `url(#${id}-outside)` })

    this.svg.append(defs, this.#outside, this.#empty, clipped)

    this.name = document.createElement('div')
    this.name.className = 'te-look-name'
    this.name.setAttribute('aria-hidden', 'true')
  }

  /** Place everything for a stage `size` CSS pixels square. */
  update(size: number, side: number, look: TileLook): void {
    if (!(size > 0)) return
    const k = size / frameSize(side)
    const box = hexBox(look.orientation, side)
    const width = box.width * k
    const height = box.height * k
    const cx = size / 2
    const cy = size / 2
    // The shader's R is the apothem: half the flat-to-flat distance.
    const apothem = Math.min(width, height) / 2
    const aa = tileLookAa(apothem)
    const hex = hexVertices(look.orientation, cx, cy, width, height)

    this.svg.setAttribute('viewBox', `0 0 ${size} ${size}`)
    this.#clip.setAttribute('points', points(hex))

    // The outer rectangle runs past the stage (which clips it): ending exactly
    // on the edge left an anti-aliased column where the picture showed through.
    this.#outside.setAttribute('d', `M-4 -4H${size + 4}V${size + 4}H-4Z M${points(hex).replace(/ /g, ' L')}Z`)

    // Full ground by the stage's SIDES, not only its corners — otherwise the
    // faded picture meets the stage edge as a hard line.
    const corner = size / 2
    this.#outsideGradient.setAttribute('cx', String(cx))
    this.#outsideGradient.setAttribute('cy', String(cy))
    this.#outsideGradient.setAttribute('r', String(corner))
    this.#outsideNear.setAttribute('offset', String(Math.min(0.95, apothem / corner)))

    this.#empty.setAttribute('points', points(hex))
    this.#empty.style.display = look.hasPicture ? 'none' : ''
    for (const gradient of [this.#emptyGradient, this.#vignetteGradient]) {
      gradient.setAttribute('cx', String(cx))
      gradient.setAttribute('cy', String(cy))
      gradient.setAttribute('r', String(apothem))
    }

    this.#vignette.setAttribute('cx', String(cx))
    this.#vignette.setAttribute('cy', String(cy))
    this.#vignette.setAttribute('r', String(apothem * 1.2))
    this.#vignette.style.display = look.hasPicture ? '' : 'none'

    // The band backs the name on a picture; an empty tile's name sits on its
    // own ground (the shader mixes the band by the picture's presence).
    const bandHalf = apothem * TILE_LOOK.band.halfRowR
    this.#band.setAttribute('x', '0')
    this.#band.setAttribute('y', String(cy - bandHalf))
    this.#band.setAttribute('width', String(size))
    this.#band.setAttribute('height', String(bandHalf * 2))
    this.#band.setAttribute('fill-opacity', String(TILE_LOOK.band.mixImage))
    this.#band.style.display = look.hasPicture && look.showName && look.name ? '' : 'none'

    const border = look.border || '#c8975a'
    const glowMix = look.hasPicture ? TILE_LOOK.glow.mixImage : TILE_LOOK.glow.mixEmpty
    // Each ring is a smoothstep band; a flat stroke at about half its peak
    // carries the same weight to the eye.
    this.#glow.setAttribute('points', points(inset(hex, cx, cy, apothem, TILE_LOOK.glow.insetAa * aa)))
    this.#glow.setAttribute('stroke', border)
    this.#glow.setAttribute('stroke-width', String(TILE_LOOK.glow.widthAa * aa))
    this.#glow.setAttribute('stroke-opacity', String(glowMix * 0.4))

    // The shader's rim is a crisp line that falls off within 1.2 aa of the
    // edge. Clipped to the inside, a stroke 1.2 aa wide shows its inner half at
    // full weight — the same crisp line, never a band that reads as a frame.
    this.#rim.setAttribute('points', points(hex))
    this.#rim.setAttribute('stroke', border)
    this.#rim.setAttribute('stroke-width', String(TILE_LOOK.rim.widthAa * aa))
    this.#rim.setAttribute('stroke-opacity', String(TILE_LOOK.rim.mix))

    const reach = TILE_LOOK.bevel.reachAa * aa
    this.#bevel.setAttribute('points', points(inset(hex, cx, cy, apothem, reach / 2)))
    this.#bevel.setAttribute('stroke-width', String(reach))
    const light = TILE_LOOK.bevel.light
    this.#bevelGradient.setAttribute('x1', String(cx + light.x * apothem))
    this.#bevelGradient.setAttribute('y1', String(cy + light.y * apothem))
    this.#bevelGradient.setAttribute('x2', String(cx - light.x * apothem))
    this.#bevelGradient.setAttribute('y2', String(cy - light.y * apothem))

    // While a picture is being moved, the look steps back and only the rim
    // stays, so the framing is judged against the edge and nothing else.
    const quiet = look.dragging && look.hasPicture
    for (const layer of [this.#vignette, this.#band, this.#glow, this.#bevel]) layer.style.opacity = quiet ? '0.25' : '1'
    this.svg.dataset['dragging'] = quiet ? 'true' : 'false'

    this.name.textContent = look.name
    this.name.setAttribute('data-hc-ground', look.hasPicture ? BAND_OVER_WHITE : EMPTY_TILE_GROUND)
    this.name.style.display = look.showName && look.name ? '' : 'none'
    this.name.style.fontSize = `${Math.max(9, apothem * 0.175)}px`
    this.name.style.maxWidth = `${apothem * 1.55}px`
    this.name.style.opacity = quiet ? '0.25' : '1'
  }
}
