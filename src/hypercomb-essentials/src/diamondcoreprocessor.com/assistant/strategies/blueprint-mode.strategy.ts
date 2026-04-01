// diamondcoreprocessor.com/assistant/strategies/blueprint-mode.strategy.ts
//
// "Blueprint Mode" — In-place wireframe decomposition. The component dissolves
// into a blueprint view where each atom is outlined with razor-sharp neon lines
// that taper to fine points at their endpoints, glowing corner accents, and a
// traveling scan highlight. Zero context switch — a lens, not navigation.

import { EffectBus } from '@hypercomb/core'
import type {
  DisplayStrategy,
  DisplayStrategyName,
  AtomizerProvider,
  AtomDescriptor,
} from '@hypercomb/core'

const BLUEPRINT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>'

// ---------------------------------------------------------------------------
// Neon palette
// ---------------------------------------------------------------------------

interface NeonTheme {
  stroke: string      // line stroke color
  glow: string        // outer glow color (broader, dimmer)
  core: string        // hot inner core color (brighter, narrower)
  fill: string        // faint interior fill
  text: string        // label color
}

const NEON_THEMES: NeonTheme[] = [
  { // cyan — depth 0
    stroke: '#00e5ff',
    glow: 'rgba(0, 229, 255, 0.25)',
    core: 'rgba(180, 255, 255, 0.9)',
    fill: 'rgba(0, 229, 255, 0.03)',
    text: '#00e5ff',
  },
  { // magenta — depth 1
    stroke: '#ff00c8',
    glow: 'rgba(255, 0, 200, 0.25)',
    core: 'rgba(255, 180, 240, 0.9)',
    fill: 'rgba(255, 0, 200, 0.03)',
    text: '#ff00c8',
  },
  { // emerald — depth 2
    stroke: '#00ff64',
    glow: 'rgba(0, 255, 100, 0.25)',
    core: 'rgba(180, 255, 210, 0.9)',
    fill: 'rgba(0, 255, 100, 0.03)',
    text: '#00ff64',
  },
  { // gold — depth 3
    stroke: '#ffc800',
    glow: 'rgba(255, 200, 0, 0.25)',
    core: 'rgba(255, 240, 180, 0.9)',
    fill: 'rgba(255, 200, 0, 0.03)',
    text: '#ffc800',
  },
  { // violet — depth 4+
    stroke: '#b464ff',
    glow: 'rgba(180, 100, 255, 0.25)',
    core: 'rgba(220, 190, 255, 0.9)',
    fill: 'rgba(180, 100, 255, 0.03)',
    text: '#b464ff',
  },
]

/** Breathe animation period (ms) */
const BREATHE_PERIOD = 4000

/** Scan line travel period (ms) — how long the highlight takes to orbit one rectangle */
const SCAN_PERIOD = 3000

/** Corner accent radius (px) */
const CORNER_DOT_R = 2.5

/** Taper length at each line endpoint (px) — how far the line narrows to a point */
const TAPER_LENGTH = 8

export class BlueprintModeStrategy implements DisplayStrategy {
  readonly name: DisplayStrategyName = 'blueprint'
  readonly icon = BLUEPRINT_SVG

  #provider: AtomizerProvider | null = null
  #atoms: AtomDescriptor[] = []
  #overlayContainer: HTMLDivElement | null = null
  #svgNS = 'http://www.w3.org/2000/svg'
  #tickerId: number = 0
  #startTime = 0
  #active = false
  #scanElements: { el: SVGCircleElement; perimeter: number; segments: { x1: number; y1: number; x2: number; y2: number; len: number }[] }[] = []

  enter(target: AtomizerProvider, atoms: AtomDescriptor[]): void {
    this.#provider = target
    this.#atoms = atoms
    this.#active = true
    this.#startTime = performance.now()
    this.#scanElements = []

    // Create overlay container
    this.#overlayContainer = document.createElement('div')
    this.#overlayContainer.className = 'atomizer-blueprint-overlay'
    this.#overlayContainer.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 50000;
    `
    document.body.appendChild(this.#overlayContainer)

    // Render atom wireframes as SVG
    this.#renderAtoms(atoms)

    // Start animation loop (breathe + scan)
    this.#tick()

    console.log(`[blueprint] Overlaying ${atoms.length} atom wireframes`)
  }

  exit(): void {
    this.#active = false
    if (this.#tickerId) {
      cancelAnimationFrame(this.#tickerId)
      this.#tickerId = 0
    }
    if (this.#overlayContainer) {
      this.#overlayContainer.remove()
      this.#overlayContainer = null
    }
    this.#scanElements = []
    this.#provider = null
    this.#atoms = []
  }

  switchTo(atoms: AtomDescriptor[]): void {
    const provider = this.#provider
    this.exit()
    if (provider) {
      this.enter(provider, atoms)
    }
  }

  onAtomSelect(atom: AtomDescriptor): void {
    EffectBus.emit('atomize:atom-selected', { atom, strategy: 'blueprint' })
  }

  // ---------------------------------------------------------------------------
  // Rendering — SVG-based for sub-pixel precision
  // ---------------------------------------------------------------------------

  #renderAtoms(atoms: AtomDescriptor[]): void {
    if (!this.#overlayContainer) return

    for (const atom of atoms) {
      const theme = NEON_THEMES[Math.min(atom.depth, NEON_THEMES.length - 1)]
      const b = atom.bounds
      const w = b.width
      const h = b.height
      const pad = 4 // extra padding around the element for glow room

      // Wrapper div for positioning + pointer events
      const wrapper = document.createElement('div')
      wrapper.className = 'atomizer-blueprint-atom'
      wrapper.dataset['atomName'] = atom.name
      wrapper.style.cssText = `
        position: fixed;
        left: ${b.x - pad}px;
        top: ${b.y - pad}px;
        width: ${w + pad * 2}px;
        height: ${h + pad * 2}px;
        pointer-events: auto;
        cursor: pointer;
      `

      // SVG canvas
      const svg = document.createElementNS(this.#svgNS, 'svg') as unknown as SVGSVGElement
      svg.setAttribute('width', String(w + pad * 2))
      svg.setAttribute('height', String(h + pad * 2))
      svg.setAttribute('viewBox', `0 0 ${w + pad * 2} ${h + pad * 2}`)
      svg.style.cssText = `position: absolute; inset: 0; overflow: visible;`

      // Defs — glow filter + tapered line gradient
      const defs = document.createElementNS(this.#svgNS, 'defs')

      // Glow filter (Gaussian blur + composite)
      const filterId = `bp-glow-${atom.name}-${atom.depth}`
      const filter = document.createElementNS(this.#svgNS, 'filter')
      filter.setAttribute('id', filterId)
      filter.setAttribute('x', '-50%')
      filter.setAttribute('y', '-50%')
      filter.setAttribute('width', '200%')
      filter.setAttribute('height', '200%')
      const feBlur = document.createElementNS(this.#svgNS, 'feGaussianBlur')
      feBlur.setAttribute('in', 'SourceGraphic')
      feBlur.setAttribute('stdDeviation', '3')
      feBlur.setAttribute('result', 'blur')
      filter.appendChild(feBlur)
      const feMerge = document.createElementNS(this.#svgNS, 'feMerge')
      const mn1 = document.createElementNS(this.#svgNS, 'feMergeNode')
      mn1.setAttribute('in', 'blur')
      feMerge.appendChild(mn1)
      const mn2 = document.createElementNS(this.#svgNS, 'feMergeNode')
      mn2.setAttribute('in', 'SourceGraphic')
      feMerge.appendChild(mn2)
      filter.appendChild(feMerge)
      defs.appendChild(filter)

      svg.appendChild(defs)

      // Interior fill (very faint)
      const fill = document.createElementNS(this.#svgNS, 'rect') as SVGRectElement
      fill.setAttribute('x', String(pad))
      fill.setAttribute('y', String(pad))
      fill.setAttribute('width', String(w))
      fill.setAttribute('height', String(h))
      fill.setAttribute('rx', '2')
      fill.setAttribute('fill', theme.fill)
      svg.appendChild(fill)

      // ── Tapered border lines ──
      // Each edge is a polygon that's thicker in the center and tapers to
      // sharp points at the corners. This creates the razor-edge look.
      const cx = pad          // content origin x
      const cy = pad          // content origin y
      const lineW = 1.2       // center thickness (half-width)
      const taperW = 0.15     // tip thickness (half-width)
      const tl = Math.min(TAPER_LENGTH, w / 4, h / 4)

      const edges = [
        // top edge: left→right
        { x1: cx, y1: cy, x2: cx + w, y2: cy, nx: 0, ny: -1 },
        // right edge: top→bottom
        { x1: cx + w, y1: cy, x2: cx + w, y2: cy + h, nx: 1, ny: 0 },
        // bottom edge: right→left
        { x1: cx + w, y1: cy + h, x2: cx, y2: cy + h, nx: 0, ny: 1 },
        // left edge: bottom→top
        { x1: cx, y1: cy + h, x2: cx, y2: cy, nx: -1, ny: 0 },
      ]

      // Glow layer (wider, blurred)
      const glowGroup = document.createElementNS(this.#svgNS, 'g')
      glowGroup.setAttribute('filter', `url(#${filterId})`)

      for (const edge of edges) {
        const poly = this.#createTaperedLine(edge, lineW * 2.5, taperW * 2, tl, theme.glow)
        glowGroup.appendChild(poly)
      }
      svg.appendChild(glowGroup)

      // Core layer (sharp, bright)
      for (const edge of edges) {
        const poly = this.#createTaperedLine(edge, lineW, taperW, tl, theme.stroke)
        svg.appendChild(poly)
      }

      // Hot inner core (even thinner, white-ish)
      for (const edge of edges) {
        const poly = this.#createTaperedLine(edge, lineW * 0.4, taperW * 0.3, tl, theme.core)
        svg.appendChild(poly)
      }

      // ── Corner accent dots ──
      const corners = [
        [cx, cy],
        [cx + w, cy],
        [cx + w, cy + h],
        [cx, cy + h],
      ]
      for (const [cornerX, cornerY] of corners) {
        // Outer glow dot
        const outerDot = document.createElementNS(this.#svgNS, 'circle')
        outerDot.setAttribute('cx', String(cornerX))
        outerDot.setAttribute('cy', String(cornerY))
        outerDot.setAttribute('r', String(CORNER_DOT_R * 2.5))
        outerDot.setAttribute('fill', theme.glow)
        outerDot.setAttribute('filter', `url(#${filterId})`)
        svg.appendChild(outerDot)

        // Core dot
        const coreDot = document.createElementNS(this.#svgNS, 'circle')
        coreDot.setAttribute('cx', String(cornerX))
        coreDot.setAttribute('cy', String(cornerY))
        coreDot.setAttribute('r', String(CORNER_DOT_R))
        coreDot.setAttribute('fill', theme.core)
        svg.appendChild(coreDot)
      }

      // ── Scan highlight (traveling dot along perimeter) ──
      const scanDot = document.createElementNS(this.#svgNS, 'circle') as unknown as SVGCircleElement
      scanDot.setAttribute('r', '3')
      scanDot.setAttribute('fill', theme.core)
      scanDot.setAttribute('filter', `url(#${filterId})`)
      svg.appendChild(scanDot)

      // Build perimeter segments for the scan path
      const segments = edges.map(e => ({
        x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2,
        len: Math.sqrt((e.x2 - e.x1) ** 2 + (e.y2 - e.y1) ** 2),
      }))
      const perimeter = segments.reduce((s, seg) => s + seg.len, 0)
      this.#scanElements.push({ el: scanDot, perimeter, segments })

      wrapper.appendChild(svg)

      // ── Labels ──
      const label = document.createElement('span')
      label.textContent = atom.name
      label.style.cssText = `
        position: absolute;
        top: -2px;
        left: ${pad + 3}px;
        font-size: 9px;
        font-weight: 600;
        font-family: monospace;
        letter-spacing: 0.5px;
        color: ${theme.text};
        text-shadow: 0 0 6px ${theme.glow}, 0 0 2px ${theme.stroke};
        white-space: nowrap;
        pointer-events: none;
        transform: translateY(-100%);
      `
      wrapper.appendChild(label)

      // Type badge (bottom-right, dimmer)
      const badge = document.createElement('span')
      badge.textContent = atom.type
      badge.style.cssText = `
        position: absolute;
        bottom: -2px;
        right: ${pad + 3}px;
        font-size: 7px;
        font-family: monospace;
        letter-spacing: 0.3px;
        color: ${theme.text};
        opacity: 0.4;
        pointer-events: none;
        transform: translateY(100%);
      `
      wrapper.appendChild(badge)

      // Interaction
      wrapper.addEventListener('click', () => this.onAtomSelect(atom))
      wrapper.addEventListener('mouseenter', () => {
        fill.setAttribute('fill', theme.fill.replace('0.03', '0.08'))
        EffectBus.emit('atomize:atom-hover', { atom, strategy: 'blueprint' })
      })
      wrapper.addEventListener('mouseleave', () => {
        fill.setAttribute('fill', theme.fill)
      })

      this.#overlayContainer!.appendChild(wrapper)

      // Recurse children
      if (atom.children?.length) {
        this.#renderAtoms(atom.children)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tapered line — a polygon that narrows from center thickness to fine points
  // ---------------------------------------------------------------------------

  #createTaperedLine(
    edge: { x1: number; y1: number; x2: number; y2: number; nx: number; ny: number },
    centerHalfW: number,
    tipHalfW: number,
    taperLen: number,
    color: string,
  ): Element {
    const { x1, y1, x2, y2, nx, ny } = edge
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len === 0) {
      const poly = document.createElementNS(this.#svgNS, 'polygon')
      poly.setAttribute('points', `${x1},${y1}`)
      return poly
    }

    // Unit direction along the edge
    const ux = dx / len
    const uy = dy / len
    // Perpendicular (outward normal direction)
    const px = ny !== 0 ? 0 : (nx > 0 ? -1 : 1) // perpendicular x
    const py = nx !== 0 ? 0 : (ny > 0 ? -1 : 1) // perpendicular y
    // For arbitrary edges, use the actual perpendicular
    const perpX = -uy
    const perpY = ux

    const tl = Math.min(taperLen, len / 2)

    // Build polygon points: start tip → center top → end tip → end tip → center bottom → start tip
    // The shape is: thin at endpoints, thick in the middle
    const points: string[] = []

    // Start tip (thin)
    points.push(`${x1 + perpX * tipHalfW},${y1 + perpY * tipHalfW}`)

    // Taper out to full width
    const taperStartX = x1 + ux * tl
    const taperStartY = y1 + uy * tl
    points.push(`${taperStartX + perpX * centerHalfW},${taperStartY + perpY * centerHalfW}`)

    // Full width through the middle
    const taperEndX = x2 - ux * tl
    const taperEndY = y2 - uy * tl
    points.push(`${taperEndX + perpX * centerHalfW},${taperEndY + perpY * centerHalfW}`)

    // End tip (thin)
    points.push(`${x2 + perpX * tipHalfW},${y2 + perpY * tipHalfW}`)

    // Now the other side (mirrored)
    points.push(`${x2 - perpX * tipHalfW},${y2 - perpY * tipHalfW}`)
    points.push(`${taperEndX - perpX * centerHalfW},${taperEndY - perpY * centerHalfW}`)
    points.push(`${taperStartX - perpX * centerHalfW},${taperStartY - perpY * centerHalfW}`)
    points.push(`${x1 - perpX * tipHalfW},${y1 - perpY * tipHalfW}`)

    const poly = document.createElementNS(this.#svgNS, 'polygon')
    poly.setAttribute('points', points.join(' '))
    poly.setAttribute('fill', color)
    return poly
  }

  // ---------------------------------------------------------------------------
  // Animation tick — breathe + scan highlight
  // ---------------------------------------------------------------------------

  #tick = (): void => {
    if (!this.#active || !this.#overlayContainer) return

    const elapsed = performance.now() - this.#startTime

    // Breathe: subtle opacity pulse on the whole overlay
    const breathe = 0.85 + 0.15 * Math.sin((elapsed / BREATHE_PERIOD) * Math.PI * 2)
    this.#overlayContainer.style.opacity = String(breathe)

    // Scan highlight: move dot along each atom's perimeter
    for (const scan of this.#scanElements) {
      const t = ((elapsed % SCAN_PERIOD) / SCAN_PERIOD) // [0..1] sawtooth
      let distAlong = t * scan.perimeter
      let placed = false

      for (const seg of scan.segments) {
        if (distAlong <= seg.len) {
          const segT = distAlong / seg.len
          const sx = seg.x1 + (seg.x2 - seg.x1) * segT
          const sy = seg.y1 + (seg.y2 - seg.y1) * segT
          scan.el.setAttribute('cx', String(sx))
          scan.el.setAttribute('cy', String(sy))
          placed = true
          break
        }
        distAlong -= seg.len
      }
      if (!placed) {
        // Fallback to first corner
        scan.el.setAttribute('cx', String(scan.segments[0].x1))
        scan.el.setAttribute('cy', String(scan.segments[0].y1))
      }
    }

    this.#tickerId = requestAnimationFrame(this.#tick)
  }
}

// Self-register with AtomizeDrone
const strategy = new BlueprintModeStrategy()
const ioc = (globalThis as any).ioc
ioc?.whenReady?.('@diamondcoreprocessor.com/AtomizeDrone', (drone: any) => {
  drone.registerStrategy(strategy)
})
console.log('[BlueprintModeStrategy] Loaded')
