// revolucionstyle.com/wheel/flavor-wheel.drone.ts
// Pixi.js flavor wheel — concentric arc segments for category/flavor selection.
// Standalone Pixi app (not the shared honeycomb host) displayed as a modal overlay.

import { Drone } from '@hypercomb/core'
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js'
import type { FlavorProfile } from '../journal/journal-entry.js'
import { FLAVOR_CATEGORIES, type FlavorCategory } from './flavor-data.js'
import type { FlavorWheelService } from './flavor-wheel.service.js'

// ── geometry constants ───────────────────────────────────────────

const INNER_RADIUS = 90
const INNER_THICKNESS = 55
const OUTER_RADIUS = INNER_RADIUS + INNER_THICKNESS
const OUTER_THICKNESS = 50
const GAP_RAD = (2 * Math.PI) / 180
const CANVAS_SIZE = 420
const CENTER = CANVAS_SIZE / 2

// ── styling ──────────────────────────────────────────────────────

const UNSELECTED_ALPHA = 0.4
const PARTIAL_ALPHA = 0.7
const SELECTED_ALPHA = 1.0
const STROKE_COLOR = 0xFFFFFF
const STROKE_ALPHA = 0.5
const STROKE_WIDTH = 2

const LABEL_STYLE = new TextStyle({
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  fontSize: 9,
  fill: 0xFFFFFF,
  align: 'center',
})

const CAT_LABEL_STYLE = new TextStyle({
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  fontSize: 10,
  fontWeight: 'bold',
  fill: 0xFFFFFF,
  align: 'center',
})

const CENTER_STYLE = new TextStyle({
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  fontSize: 16,
  fontWeight: 'bold',
  fill: 0xe0d5c8,
  align: 'center',
})

// ── hit zone lookup ──────────────────────────────────────────────

type HitZone = {
  type: 'category'
  categoryIndex: number
} | {
  type: 'flavor'
  categoryIndex: number
  flavorIndex: number
}

export class FlavorWheelDrone extends Drone {
  readonly namespace = 'revolucionstyle.com'
  public override description = 'interactive flavor wheel for cigar tasting notes'

  protected override listens = ['wheel:open', 'wheel:close']
  protected override emits: string[] = []

  protected override deps = {
    wheelService: '@revolucionstyle.com/FlavorWheelService',
  }

  // ── pixi state ─────────────────────────────────────────────────

  #app: Application | null = null
  #backdrop: HTMLDivElement | null = null
  #canvas: HTMLCanvasElement | null = null
  #wheelGraphics: Graphics | null = null
  #selectionGraphics: Graphics | null = null
  #labelsContainer: Container | null = null
  #centerText: Text | null = null
  #initialized = false

  // ── lifecycle ──────────────────────────────────────────────────

  protected override heartbeat = async (): Promise<void> => {
    this.onEffect<{ profile?: FlavorProfile }>('wheel:open', (payload) => {
      const service = this.resolve<FlavorWheelService>('wheelService')
      if (!service) return
      service.open(payload.profile)
      void this.#show()
    })

    this.onEffect('wheel:close', () => {
      this.#hide()
    })
  }

  // ── show / hide ────────────────────────────────────────────────

  async #show(): Promise<void> {
    if (!this.#initialized) await this.#init()
    if (this.#backdrop) this.#backdrop.style.display = 'flex'
    this.#redraw()
  }

  #hide(): void {
    const service = this.resolve<FlavorWheelService>('wheelService')
    service?.close()
    if (this.#backdrop) this.#backdrop.style.display = 'none'
  }

  // ── initialization ─────────────────────────────────────────────

  async #init(): Promise<void> {
    // backdrop
    this.#backdrop = document.createElement('div')
    Object.assign(this.#backdrop.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '75000',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      display: 'none',
      justifyContent: 'center',
      alignItems: 'center',
      cursor: 'pointer',
    })
    this.#backdrop.addEventListener('click', (e) => {
      if (e.target === this.#backdrop) this.#hide()
    })

    // wrapper to prevent canvas click from closing
    const wrapper = document.createElement('div')
    Object.assign(wrapper.style, {
      position: 'relative',
      cursor: 'default',
    })
    wrapper.addEventListener('click', (e) => e.stopPropagation())

    // close button
    const closeBtn = document.createElement('button')
    closeBtn.textContent = 'Done'
    Object.assign(closeBtn.style, {
      position: 'absolute',
      bottom: '-48px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '8px 24px',
      border: '1px solid #c8975a',
      borderRadius: '6px',
      backgroundColor: '#2a231c',
      color: '#e0d5c8',
      fontSize: '14px',
      cursor: 'pointer',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
    })
    closeBtn.addEventListener('click', () => this.#hide())

    // pixi app
    this.#app = new Application()
    await this.#app.init({
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio,
    })

    this.#canvas = this.#app.canvas as HTMLCanvasElement
    Object.assign(this.#canvas.style, {
      width: `${CANVAS_SIZE}px`,
      height: `${CANVAS_SIZE}px`,
      cursor: 'pointer',
    })

    // graphics layers
    this.#wheelGraphics = new Graphics()
    this.#selectionGraphics = new Graphics()
    this.#labelsContainer = new Container()
    this.#centerText = new Text({ text: '', style: CENTER_STYLE })
    this.#centerText.anchor.set(0.5)
    this.#centerText.position.set(CENTER, CENTER)

    this.#app.stage.addChild(this.#wheelGraphics)
    this.#app.stage.addChild(this.#selectionGraphics)
    this.#app.stage.addChild(this.#labelsContainer)
    this.#app.stage.addChild(this.#centerText)

    // pointer events
    this.#app.stage.eventMode = 'static'
    this.#app.stage.hitArea = { contains: () => true }
    this.#app.stage.on('pointerdown', this.#onPointerDown)

    wrapper.appendChild(this.#canvas)
    wrapper.appendChild(closeBtn)
    this.#backdrop.appendChild(wrapper)
    document.body.appendChild(this.#backdrop)

    this.#initialized = true
  }

  // ── drawing ────────────────────────────────────────────────────

  #redraw(): void {
    if (!this.#wheelGraphics || !this.#selectionGraphics || !this.#labelsContainer || !this.#centerText) return

    const service = this.resolve<FlavorWheelService>('wheelService')
    if (!service) return

    this.#wheelGraphics.clear()
    this.#selectionGraphics.clear()
    this.#labelsContainer.removeChildren()

    const catCount = FLAVOR_CATEGORIES.length
    const catAngle = (2 * Math.PI) / catCount

    for (let ci = 0; ci < catCount; ci++) {
      const cat = FLAVOR_CATEGORIES[ci]
      const startAngle = ci * catAngle - Math.PI / 2
      const endAngle = startAngle + catAngle
      const flavorIds = cat.flavors.map(f => f.id)

      // ── inner ring (category) ──
      const catSelected = service.isCategoryFullySelected(flavorIds)
      const catPartial = service.isCategoryPartiallySelected(flavorIds)
      const catAlpha = catSelected ? SELECTED_ALPHA : catPartial ? PARTIAL_ALPHA : UNSELECTED_ALPHA

      this.#drawArc(
        this.#wheelGraphics,
        INNER_RADIUS, INNER_RADIUS + INNER_THICKNESS,
        startAngle + GAP_RAD / 2, endAngle - GAP_RAD / 2,
        cat.color, catAlpha,
      )

      if (catSelected || catPartial) {
        this.#drawArcStroke(
          this.#selectionGraphics,
          INNER_RADIUS, INNER_RADIUS + INNER_THICKNESS,
          startAngle + GAP_RAD / 2, endAngle - GAP_RAD / 2,
        )
      }

      // category label
      const catMidAngle = (startAngle + endAngle) / 2
      const catLabelR = INNER_RADIUS + INNER_THICKNESS / 2
      const catLabel = new Text({ text: cat.label, style: CAT_LABEL_STYLE })
      catLabel.anchor.set(0.5)
      catLabel.position.set(
        CENTER + Math.cos(catMidAngle) * catLabelR,
        CENTER + Math.sin(catMidAngle) * catLabelR,
      )
      catLabel.rotation = catMidAngle + (catMidAngle > Math.PI / 2 && catMidAngle < Math.PI * 1.5 ? Math.PI : 0)
      this.#labelsContainer.addChild(catLabel)

      // ── outer ring (individual flavors) ──
      const flavorAngle = (endAngle - startAngle) / cat.flavors.length

      for (let fi = 0; fi < cat.flavors.length; fi++) {
        const flavor = cat.flavors[fi]
        const fStart = startAngle + fi * flavorAngle
        const fEnd = fStart + flavorAngle
        const selected = service.isSelected(flavor.id)
        const alpha = selected ? SELECTED_ALPHA : UNSELECTED_ALPHA

        this.#drawArc(
          this.#wheelGraphics,
          OUTER_RADIUS, OUTER_RADIUS + OUTER_THICKNESS,
          fStart + GAP_RAD / 2, fEnd - GAP_RAD / 2,
          cat.color, alpha,
        )

        if (selected) {
          this.#drawArcStroke(
            this.#selectionGraphics,
            OUTER_RADIUS, OUTER_RADIUS + OUTER_THICKNESS,
            fStart + GAP_RAD / 2, fEnd - GAP_RAD / 2,
          )
        }

        // flavor label
        const fMidAngle = (fStart + fEnd) / 2
        const fLabelR = OUTER_RADIUS + OUTER_THICKNESS / 2
        const fLabel = new Text({ text: flavor.label, style: LABEL_STYLE })
        fLabel.anchor.set(0.5)
        fLabel.position.set(
          CENTER + Math.cos(fMidAngle) * fLabelR,
          CENTER + Math.sin(fMidAngle) * fLabelR,
        )
        fLabel.rotation = fMidAngle + (fMidAngle > Math.PI / 2 && fMidAngle < Math.PI * 1.5 ? Math.PI : 0)
        this.#labelsContainer.addChild(fLabel)
      }
    }

    // center text
    this.#centerText.text = service.count > 0
      ? `${service.count}\nselected`
      : 'Tap to\nselect'
  }

  // ── arc geometry helpers ───────────────────────────────────────

  #drawArc(
    g: Graphics,
    innerR: number, outerR: number,
    startAngle: number, endAngle: number,
    color: number, alpha: number,
  ): void {
    const steps = 32
    const points: number[] = []

    // outer arc forward
    for (let i = 0; i <= steps; i++) {
      const angle = startAngle + (endAngle - startAngle) * (i / steps)
      points.push(CENTER + Math.cos(angle) * outerR)
      points.push(CENTER + Math.sin(angle) * outerR)
    }

    // inner arc backward
    for (let i = steps; i >= 0; i--) {
      const angle = startAngle + (endAngle - startAngle) * (i / steps)
      points.push(CENTER + Math.cos(angle) * innerR)
      points.push(CENTER + Math.sin(angle) * innerR)
    }

    g.poly(points, true)
    g.fill({ color, alpha })
  }

  #drawArcStroke(
    g: Graphics,
    innerR: number, outerR: number,
    startAngle: number, endAngle: number,
  ): void {
    const steps = 32
    const points: number[] = []

    for (let i = 0; i <= steps; i++) {
      const angle = startAngle + (endAngle - startAngle) * (i / steps)
      points.push(CENTER + Math.cos(angle) * outerR)
      points.push(CENTER + Math.sin(angle) * outerR)
    }

    for (let i = steps; i >= 0; i--) {
      const angle = startAngle + (endAngle - startAngle) * (i / steps)
      points.push(CENTER + Math.cos(angle) * innerR)
      points.push(CENTER + Math.sin(angle) * innerR)
    }

    g.poly(points, true)
    g.stroke({ color: STROKE_COLOR, alpha: STROKE_ALPHA, width: STROKE_WIDTH })
  }

  // ── hit detection ──────────────────────────────────────────────

  #hitTest(x: number, y: number): HitZone | null {
    const dx = x - CENTER
    const dy = y - CENTER
    const dist = Math.sqrt(dx * dx + dy * dy)

    // determine ring
    let ring: 'inner' | 'outer' | null = null
    if (dist >= INNER_RADIUS && dist <= INNER_RADIUS + INNER_THICKNESS) ring = 'inner'
    else if (dist >= OUTER_RADIUS && dist <= OUTER_RADIUS + OUTER_THICKNESS) ring = 'outer'
    if (!ring) return null

    // angle from top (matching our drawing offset of -PI/2)
    let angle = Math.atan2(dy, dx) + Math.PI / 2
    if (angle < 0) angle += 2 * Math.PI

    const catCount = FLAVOR_CATEGORIES.length
    const catAngle = (2 * Math.PI) / catCount
    const categoryIndex = Math.floor(angle / catAngle)
    if (categoryIndex < 0 || categoryIndex >= catCount) return null

    if (ring === 'inner') {
      return { type: 'category', categoryIndex }
    }

    const cat = FLAVOR_CATEGORIES[categoryIndex]
    const flavorAngle = catAngle / cat.flavors.length
    const angleWithinCat = angle - categoryIndex * catAngle
    const flavorIndex = Math.floor(angleWithinCat / flavorAngle)
    if (flavorIndex < 0 || flavorIndex >= cat.flavors.length) return null

    return { type: 'flavor', categoryIndex, flavorIndex }
  }

  #onPointerDown = (e: any): void => {
    const service = this.resolve<FlavorWheelService>('wheelService')
    if (!service) return

    const pos = e.global ?? e.data?.global
    if (!pos) return

    // convert to canvas coordinates
    const rect = this.#canvas?.getBoundingClientRect()
    if (!rect) return
    const scaleX = CANVAS_SIZE / rect.width
    const scaleY = CANVAS_SIZE / rect.height
    const x = (pos.x - rect.left) * scaleX
    const y = (pos.y - rect.top) * scaleY

    const hit = this.#hitTest(x, y)
    if (!hit) return

    if (hit.type === 'category') {
      const cat = FLAVOR_CATEGORIES[hit.categoryIndex]
      service.selectCategory(cat.flavors.map(f => f.id))
    } else {
      const cat = FLAVOR_CATEGORIES[hit.categoryIndex]
      service.toggle(cat.flavors[hit.flavorIndex].id)
    }

    this.#redraw()
  }
}

const _flavorWheel = new FlavorWheelDrone()
window.ioc.register('@revolucionstyle.com/FlavorWheelDrone', _flavorWheel)
