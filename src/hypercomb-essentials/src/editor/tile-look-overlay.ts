// editor/tile-look-overlay.ts
//
// THE TILE'S LOOK, DRAWN OVER THE PICTURE BEING FRAMED — the rim, the inner
// glow, the vignette, the bevel, the name band and the name, placed from the
// same numbers the tile shader uses (`presentation/grid/tile-look.ts`), so what
// the editor shows is the tile the hive will draw.
//
// The SHAPE is never computed here. Every path, length and box comes from the
// `ModelGeometry` handed to `update`, so any model draws through this layer.
//
// It is a separate SVG layer ABOVE the picture and exists only on screen.
// Nothing here is ever captured: the save draws the original through
// `hex-capture.ts`, which has no rim to draw. Outside the silhouette the
// picture fades into the panel's own ground (when the model says it fades), so
// the part that will be cut off is still there to see, and the editor has no
// frame of its own.

import { TILE_LOOK, tileLookAa } from '../presentation/grid/tile-look.js'
import type { ModelGeometry } from './models/tile-model.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
export const TILE_NAME_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'

export type TileLook = {
  border: string
  name: string
  showName: boolean
  hasPicture: boolean
  dragging: boolean
  /** The colour behind the picture, painted where the picture leaves the tile bare. '' = none. */
  fill?: string
  /** The framed picture in stage pixels (what the fill is painted AROUND). */
  picture?: { x: number; y: number; w: number; h: number } | null
}

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

  #clip: SVGPathElement
  #outside: SVGPathElement
  #ground: SVGPathElement
  #empty: SVGPathElement
  #vignette: SVGCircleElement
  #band: SVGRectElement
  #glow: SVGPathElement
  #rim: SVGPathElement
  #bevel: SVGPathElement
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
    this.#clip = el('path')
    clipPath.appendChild(this.#clip)

    this.#vignetteGradient = el('radialGradient', { id: `${id}-vignette`, gradientUnits: 'userSpaceOnUse' })
    // smoothstep(0.5, 1.0, dist) × 0.45, sampled — dist is measured in the model's unit.
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

    // Outside the silhouette the picture fades into the panel's own ground, and
    // is gone by the stage's corners — so the stage never reads as a box.
    this.#outsideGradient = el('radialGradient', { id: `${id}-outside`, gradientUnits: 'userSpaceOnUse' })
    this.#outsideNear = el('stop', { offset: '0.6', style: 'stop-color:var(--te-ground,#0d151e);stop-opacity:0.62' })
    this.#outsideGradient.append(this.#outsideNear, el('stop', { offset: '1', style: 'stop-color:var(--te-ground,#0d151e);stop-opacity:1' }))

    defs.append(clipPath, this.#vignetteGradient, this.#emptyGradient, this.#bevelGradient, this.#outsideGradient)

    const clipped = el('g', { 'clip-path': `url(#${id}-clip)` })
    this.#empty = el('path', { class: 'te-look-empty', fill: `url(#${id}-empty)` })
    // The fill behind a picture that does not cover the tile: a plain fill of the
    // ground path (the outline with the picture cut out), inside the clip.
    this.#ground = el('path', { class: 'te-look-fill', 'fill-rule': 'evenodd' })
    this.#vignette = el('circle', { class: 'te-look-vignette', fill: `url(#${id}-vignette)` })
    this.#band = el('rect', { class: 'te-look-band', fill: '#000' })
    this.#glow = el('path', { class: 'te-look-glow', fill: 'none' })
    this.#rim = el('path', { class: 'te-look-rim', fill: 'none' })
    this.#bevel = el('path', { class: 'te-look-bevel', fill: 'none', stroke: `url(#${id}-bevel)` })
    clipped.append(this.#ground, this.#vignette, this.#band, this.#glow, this.#rim, this.#bevel)

    this.#outside = el('path', { class: 'te-look-outside', 'fill-rule': 'evenodd', fill: `url(#${id}-outside)` })

    this.svg.append(defs, this.#outside, this.#empty, clipped)

    this.name = document.createElement('div')
    this.name.className = 'te-look-name'
    this.name.setAttribute('aria-hidden', 'true')
  }

  /** Place everything for the model's geometry (a stage `g.size` CSS pixels square). */
  update(g: ModelGeometry, look: TileLook): void {
    const size = g.size
    if (!(size > 0)) return
    const cx = g.c.x
    const cy = g.c.y
    const unit = g.unit
    const aa = tileLookAa(unit)

    this.svg.setAttribute('viewBox', `0 0 ${size} ${size}`)
    this.#clip.setAttribute('d', g.outline)

    // The outer rectangle runs past the stage (which clips it): ending exactly
    // on the edge left an anti-aliased column where the picture showed through.
    // Only a model that FADES has an outside to draw; a hard-clipped one has
    // its picture cut by the mask and nothing to fade.
    this.#outside.setAttribute('d', `M-4 -4H${size + 4}V${size + 4}H-4Z ${g.outline}`)
    this.#outside.style.display = g.fade ? '' : 'none'

    // Full ground by the stage's SIDES, not only its corners — otherwise the
    // faded picture meets the stage edge as a hard line.
    const corner = size / 2
    this.#outsideGradient.setAttribute('cx', String(cx))
    this.#outsideGradient.setAttribute('cy', String(cy))
    this.#outsideGradient.setAttribute('r', String(corner))
    this.#outsideNear.setAttribute('offset', String(Math.min(0.95, unit / corner)))

    const picture = look.picture ?? null
    const fill = look.hasPicture && look.fill && g.groundShows(picture, false) ? look.fill : ''
    this.#ground.setAttribute('d', fill ? g.groundPath(picture) : '')
    this.#ground.setAttribute('fill', fill)
    this.#ground.style.display = fill ? '' : 'none'

    this.#empty.setAttribute('d', g.outline)
    this.#empty.style.display = look.hasPicture ? 'none' : ''
    for (const gradient of [this.#emptyGradient, this.#vignetteGradient]) {
      gradient.setAttribute('cx', String(cx))
      gradient.setAttribute('cy', String(cy))
      gradient.setAttribute('r', String(unit))
    }

    // The vignette disc reaches the farthest outline point, so the clip is
    // always filled whatever the silhouette.
    this.#vignette.setAttribute('cx', String(cx))
    this.#vignette.setAttribute('cy', String(cy))
    this.#vignette.setAttribute('r', String(g.reach))
    this.#vignette.style.display = look.hasPicture ? '' : 'none'

    // The band backs the name on a picture; an empty tile's name sits on its
    // own ground (the shader mixes the band by the picture's presence).
    const band = g.band
    if (band) {
      this.#band.setAttribute('x', String(band.x))
      this.#band.setAttribute('y', String(band.y))
      this.#band.setAttribute('width', String(band.w))
      this.#band.setAttribute('height', String(band.h))
    }
    this.#band.setAttribute('fill-opacity', String(TILE_LOOK.band.mixImage))
    this.#band.style.display = band && look.hasPicture && look.showName && look.name ? '' : 'none'

    const border = look.border || '#c8975a'
    const glowMix = look.hasPicture ? TILE_LOOK.glow.mixImage : TILE_LOOK.glow.mixEmpty
    // Each ring is a smoothstep band; a flat stroke at about half its peak
    // carries the same weight to the eye.
    this.#glow.setAttribute('d', g.offset(-g.glowInset))
    this.#glow.setAttribute('stroke', border)
    this.#glow.setAttribute('stroke-width', String(g.glowWidth))
    this.#glow.setAttribute('stroke-opacity', String(glowMix * 0.4))

    // The shader's rim is a crisp line that falls off within 1.2 aa of the
    // edge. Centred on the outline and clipped to the inside, the stroke shows
    // its inner half at full weight — a crisp line, never a band that reads as
    // a frame.
    this.#rim.setAttribute('d', g.outline)
    this.#rim.setAttribute('stroke', border)
    this.#rim.setAttribute('stroke-width', String(g.rimWidth))
    this.#rim.setAttribute('stroke-opacity', String(TILE_LOOK.rim.mix))

    const reach = TILE_LOOK.bevel.reachAa * aa
    this.#bevel.setAttribute('d', g.offset(-reach / 2))
    this.#bevel.setAttribute('stroke-width', String(reach))
    const light = TILE_LOOK.bevel.light
    this.#bevelGradient.setAttribute('x1', String(cx + light.x * unit))
    this.#bevelGradient.setAttribute('y1', String(cy + light.y * unit))
    this.#bevelGradient.setAttribute('x2', String(cx - light.x * unit))
    this.#bevelGradient.setAttribute('y2', String(cy - light.y * unit))

    // While a picture is being moved, the look steps back and only the rim
    // stays, so the framing is judged against the edge and nothing else.
    const quiet = look.dragging && look.hasPicture
    for (const layer of [this.#vignette, this.#band, this.#glow, this.#bevel]) layer.style.opacity = quiet ? '0.25' : '1'
    this.svg.dataset['dragging'] = quiet ? 'true' : 'false'

    const box = g.nameBox
    this.name.textContent = look.name
    this.name.setAttribute('data-hc-ground', look.hasPicture ? BAND_OVER_WHITE : EMPTY_TILE_GROUND)
    this.name.style.display = box && look.showName && look.name ? '' : 'none'
    if (box) {
      // The stylesheet centres the name on its left/top, so the box's centre is all it needs.
      this.name.style.left = `${box.cx}px`
      this.name.style.top = `${box.cy}px`
      this.name.style.maxWidth = `${box.w}px`
    }
    this.name.style.fontSize = `${g.nameFont}px`
    this.name.style.opacity = quiet ? '0.25' : '1'
  }
}
