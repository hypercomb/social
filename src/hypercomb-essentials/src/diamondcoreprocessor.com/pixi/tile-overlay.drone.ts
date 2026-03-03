// hypercomb-essentials/src/diamondcoreprocessor.com/pixi/tile-overlay.drone.ts
// Hover overlay above the active hex tile.

import { Drone } from '@hypercomb/core'
import { Application, Container, Graphics, Point } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.drone.js'
import type { Axial } from '../input/hex-detector.js'

export class TileOverlayDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'hover overlay above the active hex tile'

  private app: Application | null = null
  private renderContainer: Container | null = null
  private canvas: HTMLCanvasElement | null = null
  private renderer: Application['renderer'] | null = null

  private overlay: Container | null = null
  private meshOffset = { x: 0, y: 0 }
  private currentAxial: Axial | null = null

  private readonly circumRadiusPx = 32
  private readonly gapPx = 6
  private readonly spacing = 38 // circumRadiusPx + gapPx

  private initialized = false
  private listening = false

  protected override deps = { detector: '@diamondcoreprocessor.com/HexDetector' }
  protected override listens = ['render:host-ready', 'render:mesh-offset']
  protected override emits = ['tile:hover']

  protected override sense = (): boolean => {
    const prev = this.initialized
    this.initialized = true
    console.log('[TileOverlay] sense() called — initialized was:', prev, '→ returning:', !prev)
    return !prev
  }

  protected override heartbeat = async (): Promise<void> => {
    console.log('[TileOverlay] heartbeat — subscribing to effects')

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      console.log('[TileOverlay] render:host-ready received', {
        app: !!payload.app,
        container: !!payload.container,
        canvas: !!payload.canvas,
        renderer: !!payload.renderer,
      })
      this.app = payload.app
      this.renderContainer = payload.container
      this.canvas = payload.canvas
      this.renderer = payload.renderer
      this.initOverlay()
      this.attachPointerListener()
    })

    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (offset) => {
      console.log('[TileOverlay] render:mesh-offset received', offset)
      this.meshOffset = offset
      if (this.currentAxial) {
        this.positionOverlay(this.currentAxial.q, this.currentAxial.r)
      }
    })
  }

  protected override dispose(): void {
    if (this.listening) {
      document.removeEventListener('pointermove', this.onPointerMove)
      this.listening = false
    }
    if (this.overlay) {
      this.overlay.destroy({ children: true })
      this.overlay = null
    }
  }

  // -------------------------------------------------
  // overlay setup
  // -------------------------------------------------

  private initOverlay(): void {
    if (!this.renderContainer || this.overlay) return

    console.log('[TileOverlay] initOverlay — creating hex outline container')

    this.overlay = new Container()
    this.overlay.visible = false

    const g = new Graphics()
    this.drawHexOutline(g)
    this.overlay.addChild(g)

    this.renderContainer.addChild(this.overlay)
    console.log('[TileOverlay] overlay added to renderContainer, children:', this.renderContainer.children.length)
  }

  private drawHexOutline(g: Graphics): void {
    const r = this.circumRadiusPx

    // flat-top hex vertices (matches the rot30 + sdHex in the SDF shader)
    g.setStrokeStyle({ width: 2, color: 0x00ccff, alpha: 0.7 })
    g.beginPath()
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i // 0°, 60°, 120°, 180°, 240°, 300°
      const x = r * Math.cos(angle)
      const y = r * Math.sin(angle)
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.closePath()
    g.stroke()
  }

  // -------------------------------------------------
  // pointer tracking
  // -------------------------------------------------

  private attachPointerListener(): void {
    if (this.listening) return
    this.listening = true
    console.log('[TileOverlay] attachPointerListener — listening for pointermove')
    document.addEventListener('pointermove', this.onPointerMove)
  }

  private _moveLogCount = 0

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.renderContainer || !this.overlay || !this.renderer || !this.canvas) {
      if (this._moveLogCount < 3) {
        console.warn('[TileOverlay] onPointerMove — missing refs', {
          renderContainer: !!this.renderContainer,
          overlay: !!this.overlay,
          renderer: !!this.renderer,
          canvas: !!this.canvas,
        })
        this._moveLogCount++
      }
      return
    }

    const detector = this.resolve<{ pixelToAxial(px: number, py: number): Axial }>('detector')
    if (!detector) {
      if (this._moveLogCount < 3) {
        console.warn('[TileOverlay] onPointerMove — detector not resolved. ioc keys:', (globalThis as any).ioc?.list?.() ?? 'no list')
        this._moveLogCount++
      }
      return
    }

    // 1. CSS client → pixi global
    const pixiGlobal = this.clientToPixiGlobal(e.clientX, e.clientY)

    // 2. pixi global → renderContainer local
    const local = this.renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y))

    // 3. subtract mesh centering offset → mesh-local coords
    const meshLocalX = local.x - this.meshOffset.x
    const meshLocalY = local.y - this.meshOffset.y

    // 4. O(1) axial rounding
    const axial = detector.pixelToAxial(meshLocalX, meshLocalY)

    // 5. skip if same hex
    if (this.currentAxial && this.currentAxial.q === axial.q && this.currentAxial.r === axial.r) return

    this.currentAxial = axial

    if (this._moveLogCount < 5) {
      console.log('[TileOverlay] hover →', axial, '| overlay visible:', this.overlay.visible, '| pos:', this.overlay.position.x.toFixed(1), this.overlay.position.y.toFixed(1))
      this._moveLogCount++
    }

    // 6. position the overlay
    this.positionOverlay(axial.q, axial.r)

    // 7. broadcast for other drones
    this.emitEffect('tile:hover', { q: axial.q, r: axial.r })
  }

  // -------------------------------------------------
  // positioning
  // -------------------------------------------------

  private positionOverlay(q: number, r: number): void {
    if (!this.overlay) return

    const px = this.axialToPixel(q, r)
    this.overlay.position.set(
      px.x + this.meshOffset.x,
      px.y + this.meshOffset.y
    )
    this.overlay.visible = true
  }

  private axialToPixel(q: number, r: number) {
    return {
      x: Math.sqrt(3) * this.spacing * (q + r / 2),
      y: this.spacing * 1.5 * r
    }
  }

  // -------------------------------------------------
  // coordinate mapping (same approach as ZoomDrone)
  // -------------------------------------------------

  private clientToPixiGlobal(cx: number, cy: number) {
    const events = (this.renderer as any)?.events
    if (events?.mapPositionToPoint) {
      const out = new Point()
      events.mapPositionToPoint(out, cx, cy)
      return { x: out.x, y: out.y }
    }

    const rect = this.canvas!.getBoundingClientRect()
    const screen = this.renderer!.screen
    return {
      x: (cx - rect.left) * (screen.width / rect.width),
      y: (cy - rect.top) * (screen.height / rect.height)
    }
  }
}

const _tileOverlay = new TileOverlayDrone()
window.ioc.register(_tileOverlay.iocKey, _tileOverlay)
