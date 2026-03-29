// diamondcoreprocessor.com/pixi/neon-toolbar.drone.ts
// Vertical swatch strip for choosing the neon hover overlay color.
// Toggled by the /neon queen command.

import { Drone, EffectBus } from '@hypercomb/core'
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js'
import { NEON_PRESETS } from './hex-overlay.shader.js'
import type { HostReadyPayload } from './pixi-host.worker.js'

const STORAGE_KEY = 'hc:neon-color'
const SHOW_HIDDEN_KEY = 'hc:show-hidden'
const SWATCH_SIZE = 18
const SWATCH_GAP  = 6
const SWATCH_CORNER = 4
const TOOLBAR_PAD = 8
const TOOLBAR_X   = 12        // left margin from canvas edge
const AUTO_HIDE_MS = 6000     // auto-hide after 6 seconds

export class NeonToolbarDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'neon color swatch toolbar, toggled via /neon'

  protected override listens = ['render:host-ready', 'neon:toggle-toolbar', 'visibility:toggle-toolbar']
  protected override emits = ['overlay:neon-color', 'visibility:show-hidden']

  #app: Application | null = null
  #toolbar: Container | null = null
  #swatches: Graphics[] = []
  #selectedIndex = 0
  #effectsRegistered = false
  #hideTimer: ReturnType<typeof setTimeout> | null = null
  #canvas: HTMLCanvasElement | null = null

  // visibility toolbar (bottom-left, independent of neon toolbar)
  #visibilityToolbar: Container | null = null
  #showHidden = false
  #eyeGraphic: Graphics | null = null
  #eyeLabel: Text | null = null

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#app = payload.app
      this.#canvas = payload.canvas
      this.#buildToolbar()
      this.#buildVisibilityToolbar()
    })

    this.onEffect('neon:toggle-toolbar', () => {
      this.#toggle()
    })

    this.onEffect('visibility:toggle-toolbar', () => {
      this.#toggleVisibilityToolbar()
    })
  }

  #buildToolbar(): void {
    if (!this.#app || this.#toolbar) return

    this.#selectedIndex = loadIndex()

    this.#toolbar = new Container()
    this.#toolbar.visible = false
    this.#toolbar.zIndex = 10000
    this.#toolbar.eventMode = 'static'

    const count = NEON_PRESETS.length
    const totalH = count * SWATCH_SIZE + (count - 1) * SWATCH_GAP + TOOLBAR_PAD * 2
    const totalW = SWATCH_SIZE + TOOLBAR_PAD * 2

    // background panel
    const bg = new Graphics()
    bg.roundRect(0, 0, totalW, totalH, 6)
    bg.fill({ color: 0x0a0a14, alpha: 0.75 })
    bg.roundRect(0, 0, totalW, totalH, 6)
    bg.stroke({ width: 1, color: 0x334455, alpha: 0.5 })
    this.#toolbar.addChild(bg)

    // swatches
    for (let i = 0; i < count; i++) {
      const preset = NEON_PRESETS[i]
      const g = new Graphics()
      const y = TOOLBAR_PAD + i * (SWATCH_SIZE + SWATCH_GAP)

      this.#drawSwatch(g, preset.core, i === this.#selectedIndex)
      g.position.set(TOOLBAR_PAD, y)
      g.eventMode = 'static'
      g.cursor = 'pointer'
      g.on('pointerdown', () => this.#selectColor(i))

      this.#toolbar.addChild(g)
      this.#swatches.push(g)
    }

    // position: left side, vertically centered
    this.#positionToolbar(totalW, totalH)
    this.#app.stage.addChild(this.#toolbar)

    // reposition on resize
    if (this.#canvas) {
      const observer = new ResizeObserver(() => this.#positionToolbar(totalW, totalH))
      observer.observe(this.#canvas)
    }
  }

  #positionToolbar(w: number, h: number): void {
    if (!this.#app) return
    const screenH = this.#app.screen.height
    this.#toolbar!.position.set(TOOLBAR_X, (screenH - h) / 2)
  }

  #drawSwatch(g: Graphics, color: number, selected: boolean): void {
    g.clear()

    // selected ring
    if (selected) {
      g.roundRect(-2, -2, SWATCH_SIZE + 4, SWATCH_SIZE + 4, SWATCH_CORNER + 2)
      g.stroke({ width: 2, color: 0xffffff, alpha: 0.9 })
    }

    // color fill
    g.roundRect(0, 0, SWATCH_SIZE, SWATCH_SIZE, SWATCH_CORNER)
    g.fill({ color, alpha: 0.9 })

    // subtle inner glow
    g.roundRect(2, 2, SWATCH_SIZE - 4, SWATCH_SIZE - 4, SWATCH_CORNER - 1)
    g.fill({ color: 0xffffff, alpha: 0.15 })
  }

  #selectColor(index: number): void {
    this.#selectedIndex = index
    localStorage.setItem(STORAGE_KEY, String(index))

    // redraw all swatches
    for (let i = 0; i < this.#swatches.length; i++) {
      this.#drawSwatch(this.#swatches[i], NEON_PRESETS[i].core, i === index)
    }

    // notify overlay
    EffectBus.emit('overlay:neon-color', { index })

    // reset auto-hide timer
    this.#scheduleAutoHide()
  }

  #toggle(): void {
    if (!this.#toolbar) return
    const visible = !this.#toolbar.visible
    this.#toolbar.visible = visible

    if (this.#hideTimer) {
      clearTimeout(this.#hideTimer)
      this.#hideTimer = null
    }

    if (visible) {
      // refresh selection state
      this.#selectedIndex = loadIndex()
      for (let i = 0; i < this.#swatches.length; i++) {
        this.#drawSwatch(this.#swatches[i], NEON_PRESETS[i].core, i === this.#selectedIndex)
      }
      this.#scheduleAutoHide()
    }
  }

  #scheduleAutoHide(): void {
    if (this.#hideTimer) clearTimeout(this.#hideTimer)
    this.#hideTimer = setTimeout(() => {
      if (this.#toolbar) this.#toolbar.visible = false
      this.#hideTimer = null
    }, AUTO_HIDE_MS)
  }

  // ── Visibility toolbar (eye toggle for showing hidden items) ────

  #buildVisibilityToolbar(): void {
    if (!this.#app || this.#visibilityToolbar) return

    this.#showHidden = localStorage.getItem(SHOW_HIDDEN_KEY) === '1'

    this.#visibilityToolbar = new Container()
    this.#visibilityToolbar.zIndex = 10000
    this.#visibilityToolbar.eventMode = 'static'

    const btnSize = SWATCH_SIZE
    const totalW = btnSize + TOOLBAR_PAD * 2
    const totalH = btnSize + TOOLBAR_PAD * 2

    // background panel
    const bg = new Graphics()
    bg.roundRect(0, 0, totalW, totalH, 6)
    bg.fill({ color: 0x0a0a14, alpha: 0.75 })
    bg.roundRect(0, 0, totalW, totalH, 6)
    bg.stroke({ width: 1, color: 0x334455, alpha: 0.5 })
    this.#visibilityToolbar.addChild(bg)

    // eye icon drawn as graphics
    const eye = new Graphics()
    this.#eyeGraphic = eye
    eye.position.set(TOOLBAR_PAD, TOOLBAR_PAD)
    eye.eventMode = 'static'
    eye.cursor = 'pointer'
    eye.on('pointerdown', () => this.#toggleShowHidden())
    this.#drawEyeIcon(eye, this.#showHidden)
    this.#visibilityToolbar.addChild(eye)

    // position: bottom-left
    this.#positionVisibilityToolbar(totalW, totalH)
    this.#app.stage.addChild(this.#visibilityToolbar)

    if (this.#canvas) {
      const observer = new ResizeObserver(() => this.#positionVisibilityToolbar(totalW, totalH))
      observer.observe(this.#canvas)
    }

    // emit initial state
    if (this.#showHidden) {
      EffectBus.emit('visibility:show-hidden', { active: true })
    }
  }

  #positionVisibilityToolbar(w: number, h: number): void {
    if (!this.#app) return
    const screenH = this.#app.screen.height
    this.#visibilityToolbar!.position.set(TOOLBAR_X, screenH - h - 12)
  }

  #drawEyeIcon(g: Graphics, active: boolean): void {
    g.clear()
    const s = SWATCH_SIZE
    const color = active ? 0x66ccff : 0x888888
    const alpha = active ? 0.95 : 0.5

    // eye shape: two arcs
    g.moveTo(0, s / 2)
    g.bezierCurveTo(s * 0.2, s * 0.15, s * 0.8, s * 0.15, s, s / 2)
    g.bezierCurveTo(s * 0.8, s * 0.85, s * 0.2, s * 0.85, 0, s / 2)
    g.fill({ color, alpha })

    // pupil
    g.circle(s / 2, s / 2, s * 0.18)
    g.fill({ color: 0x0a0a14, alpha: 0.9 })

    // strike-through when inactive
    if (!active) {
      g.moveTo(s * 0.1, s * 0.85)
      g.lineTo(s * 0.9, s * 0.15)
      g.stroke({ width: 1.5, color: 0xcc4444, alpha: 0.8 })
    }
  }

  #toggleShowHidden(): void {
    this.#showHidden = !this.#showHidden
    localStorage.setItem(SHOW_HIDDEN_KEY, this.#showHidden ? '1' : '0')
    if (this.#eyeGraphic) this.#drawEyeIcon(this.#eyeGraphic, this.#showHidden)
    EffectBus.emit('visibility:show-hidden', { active: this.#showHidden })
  }

  #toggleVisibilityToolbar(): void {
    if (!this.#visibilityToolbar) return
    this.#visibilityToolbar.visible = !this.#visibilityToolbar.visible
  }
}

function loadIndex(): number {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return 0
  const n = parseInt(stored, 10)
  return (n >= 0 && n < NEON_PRESETS.length) ? n : 0
}

const _neonToolbar = new NeonToolbarDrone()
window.ioc.register('@diamondcoreprocessor.com/NeonToolbarDrone', _neonToolbar)
