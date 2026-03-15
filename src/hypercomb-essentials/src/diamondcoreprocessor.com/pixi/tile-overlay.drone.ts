// hypercomb-essentials/src/diamondcoreprocessor.com/pixi/tile-overlay.drone.ts
// Contextual action overlay: dark underlay + icon buttons on occupied hex tiles on hover.

import { Drone, EffectBus, hypercomb } from '@hypercomb/core'
import { Application, Container, Graphics, Point, Text, TextStyle } from 'pixi.js'
import { HexIconButton } from './hex-icon-button.js'
import type { HostReadyPayload } from './pixi-host.drone.js'
import type { Axial } from '../input/hex-detector.js'


type CellCountPayload = { count: number; labels: string[]; branchLabels?: string[] }

type OverlayAction = {
  name: string
  button: HexIconButton
  handler: (label: string, q: number, r: number, index: number) => void
}

// ── SVG icon markup ────────────────────────────────────────────────
// Path data from icon-tray.svg — each icon is a compound path (rounded-rect shell + icon cutout, evenodd fill).
// viewBox crops tightly to the icon's bounding box; rasterised at 48×48 for crisp display at small Pixi sizes.

const EDIT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="99.7 93.2 10.5 10.5" width="96" height="96"><path fill="white" fill-rule="evenodd" d="m 102.56634,99.825408 q 0.0295,0.02951 0.25579,0.245952 l 0.7477,0.75753 -0.34434,0.3345 h -0.364 v -0.62964 h -0.62964 v -0.36401 z m 2.71531,-2.5579 q 0.0984,0.08854 -0.0197,0.19676 l -1.90859,1.908588 q -0.10821,0.118057 -0.19676,0.02952 -0.0885,-0.08854 0.0197,-0.206599 l 1.90859,-1.908588 q 0.11806,-0.108219 0.19676,-0.01968 0,0 0,0 z m -1.79053,4.525512 q 0.10822,-0.10821 0.89527,-0.89526 l 2.66612,-2.666121 -1.88891,-1.888912 -3.56139,3.561386 v 1.888907 z m 3.98442,-3.984418 q 0.0197,-0.01967 0.15741,-0.157409 l 0.44271,-0.442714 q 0.18693,-0.186923 0.18693,-0.442714 0,-0.265628 -0.18693,-0.452551 l -0.99364,-0.993646 q -0.18692,-0.186923 -0.45255,-0.186923 -0.25579,0 -0.44272,0.186923 l -0.60012,0.600123 z m 2.51856,-2.518548 q 0,0.196761 0,1.574093 v 4.722273 q 0,0.77721 -0.56077,1.33798 -0.55094,0.55094 -1.32815,0.55094 h -6.29637 q -0.77721,0 -1.33798,-0.55094 -0.550929,-0.56077 -0.550929,-1.33798 v -6.296366 q 0,-0.777208 0.550929,-1.328141 0.56077,-0.56077 1.33798,-0.56077 h 6.29637 q 0.77721,0 1.32815,0.56077 0.56077,0.550933 0.56077,1.328141 z"/></svg>`

const GARBAGE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="112.2 93.2 10.4 10.5" width="96" height="96"><path fill="white" fill-rule="evenodd" d="m 114.23557,93.367129 c -0.51819,0 -0.96431,0.18841 -1.3382,0.564993 -0.36732,0.369975 -0.55093,0.815843 -0.55093,1.337773 v 6.342445 c 0,0.52192 0.18361,0.97127 0.55093,1.34786 0.37389,0.36997 0.82001,0.5549 1.3382,0.5549 h 6.29699 c 0.51819,0 0.96088,-0.18493 1.3282,-0.5549 0.37387,-0.37659 0.56094,-0.82594 0.56094,-1.34786 v -4.756922 -1.585523 c 0,-0.52193 -0.18707,-0.967798 -0.56094,-1.337773 -0.36732,-0.376583 -0.81001,-0.564993 -1.3282,-0.564993 z m 2.2286,1.368005 h 1.8398 c 0.12936,0.0048 0.23735,0.05074 0.32359,0.1376 0.0862,0.08685 0.13151,0.195289 0.13627,0.325582 v 0.926365 h 0.92008 0.91973 c 0.12936,0.0048 0.23735,0.05075 0.32358,0.1376 0.0863,0.08685 0.13185,0.195636 0.13663,0.32593 v 0.463183 h -0.46021 v 4.632516 c -0.004,0.13029 -0.0499,0.23909 -0.13628,0.32594 -0.0863,0.0868 -0.19423,0.1328 -0.32359,0.13761 h -5.51941 c -0.12935,-0.004 -0.23701,-0.0507 -0.32324,-0.13761 -0.0862,-0.0868 -0.13185,-0.19565 -0.13662,-0.32594 v -4.632516 h -0.45986 v -0.463183 c 0.004,-0.130294 0.0504,-0.239069 0.13661,-0.32593 0.0862,-0.08689 0.19389,-0.132793 0.32325,-0.1376 h 1.83981 v -0.926365 c 0.004,-0.130293 0.0504,-0.238719 0.13661,-0.325582 0.0862,-0.08688 0.19389,-0.132796 0.32325,-0.1376 z m 0.45986,0.926365 v 0.463182 h 0.92008 v -0.463182 h -0.45986 z m -1.83946,1.389895 v 4.169336 h 2.29968 2.29966 v -4.169336 z m 0.91974,0.926366 h 0.45986 0.45986 v 2.3166 h -0.91972 z m 1.8398,0 h 0.45986 0.45986 v 2.3166 h -0.91972 z"/></svg>`

// ── overlay geometry constants ─────────────────────────────────────
// Dark rect fills the hex's rectangular body (between upper/lower shoulder vertices).
// Derived from icon-tray.svg proportions, scaled from SVG mm → Pixi px (scale ≈ 0.6417).
const RECT_X = -30
const RECT_Y = -18
const RECT_W = 60
const RECT_H = 36
const RECT_R = 2
const RECT_COLOR = 0x001e30
const RECT_ALPHA = 0.85

// Icon positions within the overlay (measured from hex center = overlay origin)
const ICON_SIZE = 8.75
const EDIT_X = 8.625
const EDIT_Y = 5
const GARBAGE_X = -2
const GARBAGE_Y = 5

// Seed label styling
const LABEL_X = RECT_X + 2
const LABEL_Y = RECT_Y + 1.5
const LABEL_STYLE = new TextStyle({
  fontFamily: 'monospace',
  fontSize: 7,
  fill: 0xffffff,
  align: 'left',
})

export class TileOverlayDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'contextual action overlay on occupied hex tiles'

  #app: Application | null = null
  #renderContainer: Container | null = null
  #canvas: HTMLCanvasElement | null = null
  #renderer: Application['renderer'] | null = null

  #overlay: Container | null = null
  #hexBg: Graphics | null = null
  #seedLabel: Text | null = null
  #editButton: HexIconButton | null = null
  #deleteButton: HexIconButton | null = null
  #actions: OverlayAction[] = []

  #meshOffset = { x: 0, y: 0 }
  #currentAxial: Axial | null = null
  #currentIndex: number | undefined = undefined

  readonly #circumRadiusPx = 32
  readonly #gapPx = 6
  readonly #spacing = 38 // circumRadiusPx + gapPx

  #cellCount = 0
  #cellLabels: string[] = []

  #listening = false
  #hoverLog = 0

  #occupiedByAxial = new Map<string, { index: number; label: string }>()
  #branchLabels = new Set<string>()

  // navigation click guard — blocks clicks during layer transitions
  #navigationBlocked = false
  #navigationGuardTimer: ReturnType<typeof setTimeout> | null = null

  protected override deps = {
    detector: '@diamondcoreprocessor.com/HexDetector',
    axial: '@diamondcoreprocessor.com/AxialService',
    lineage: '@hypercomb.social/Lineage',
  }
  protected override listens = ['render:host-ready', 'render:mesh-offset', 'render:cell-count', 'navigation:guard-start', 'navigation:guard-end']
  protected override emits = ['tile:hover', 'tile:action', 'tile:click', 'tile:navigate-in', 'tile:navigate-back']

  protected override heartbeat = async (): Promise<void> => {
    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#app = payload.app
      this.#renderContainer = payload.container
      this.#canvas = payload.canvas
      this.#renderer = payload.renderer
      this.#initOverlay()
      this.#attachListeners()
    })

    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (offset) => {
      this.#meshOffset = offset
      if (this.#currentAxial) {
        this.#positionOverlay(this.#currentAxial.q, this.#currentAxial.r)
      }
    })

    this.onEffect<CellCountPayload>('render:cell-count', (payload) => {
      this.#cellCount = payload.count
      this.#cellLabels = payload.labels
      this.#branchLabels = new Set(payload.branchLabels ?? [])
      this.#rebuildOccupiedMap()
      if (this.#overlay && this.#currentAxial) {
        this.#currentIndex = this.#lookupIndex(this.#currentAxial.q, this.#currentAxial.r)
        this.#updateVisibility()
      }
    })

    // navigation guard — block clicks during layer transitions
    this.onEffect('navigation:guard-start', () => {
      this.#navigationBlocked = true
      // safety-net timeout in case guard-end never fires
      if (this.#navigationGuardTimer) clearTimeout(this.#navigationGuardTimer)
      this.#navigationGuardTimer = setTimeout(() => { this.#navigationBlocked = false }, 200)
    })
    this.onEffect('navigation:guard-end', () => {
      this.#navigationBlocked = false
      if (this.#navigationGuardTimer) { clearTimeout(this.#navigationGuardTimer); this.#navigationGuardTimer = null }
    })
  }

  protected override dispose(): void {
    if (this.#listening) {
      document.removeEventListener('pointermove', this.#onPointerMove)
      document.removeEventListener('click', this.#onClick)
      document.removeEventListener('contextmenu', this.#onContextMenu)
      this.#listening = false
    }
    if (this.#overlay) {
      this.#overlay.destroy({ children: true })
      this.#overlay = null
      this.#hexBg = null
      this.#seedLabel = null
      this.#editButton = null
      this.#deleteButton = null
      this.#actions = []
    }
  }

  // ── overlay setup ──────────────────────────────────────────────

  #initOverlay(): void {
    if (!this.#renderContainer || this.#overlay) return

    this.#overlay = new Container()
    this.#overlay.visible = false
    this.#overlay.zIndex = 9999

    // 1. Dark rounded-rect underlay (fills the hex body area)
    this.#hexBg = new Graphics()
    this.#hexBg.roundRect(RECT_X, RECT_Y, RECT_W, RECT_H, RECT_R)
    this.#hexBg.fill({ color: RECT_COLOR, alpha: RECT_ALPHA })
    this.#overlay.addChild(this.#hexBg)

    // 2. Seed name label (top-left of overlay)
    this.#seedLabel = new Text({ text: '', style: LABEL_STYLE, resolution: 4 })
    this.#seedLabel.position.set(LABEL_X, LABEL_Y)
    this.#overlay.addChild(this.#seedLabel)

    // 3. Edit icon button
    this.#editButton = new HexIconButton({
      svgMarkup: EDIT_ICON_SVG,
      width: ICON_SIZE,
      height: ICON_SIZE,
      alias: 'hc-icon-edit',
      hoverTint: 0xc8d8ff,
    })
    this.#editButton.position.set(EDIT_X, EDIT_Y)
    this.#overlay.addChild(this.#editButton)

    // 4. Delete icon button
    this.#deleteButton = new HexIconButton({
      svgMarkup: GARBAGE_ICON_SVG,
      width: ICON_SIZE,
      height: ICON_SIZE,
      alias: 'hc-icon-delete',
      hoverTint: 0xffc8c8,
    })
    this.#deleteButton.position.set(GARBAGE_X, GARBAGE_Y)
    this.#overlay.addChild(this.#deleteButton)

    // 5. Register action handlers
    this.#actions = [
      {
        name: 'edit',
        button: this.#editButton,
        handler: (label, q, r, index) => {
          this.emitEffect('tile:action', { action: 'edit', q, r, index, label })
        },
      },
      {
        name: 'remove',
        button: this.#deleteButton,
        handler: (label, q, r, index) => {
          this.emitEffect('tile:action', { action: 'remove', q, r, index, label })
          void this.#handleRemove(label)
        },
      },
    ]

    this.#renderContainer.addChild(this.#overlay)
    this.#renderContainer.sortableChildren = true

    // load icon textures asynchronously
    void this.#editButton.load()
    void this.#deleteButton.load()
  }

  // ── listener setup ─────────────────────────────────────────────

  #attachListeners(): void {
    if (this.#listening) return
    this.#listening = true
    document.addEventListener('pointermove', this.#onPointerMove)
    document.addEventListener('click', this.#onClick)
    document.addEventListener('contextmenu', this.#onContextMenu)
  }

  // ── pointer tracking ───────────────────────────────────────────

  #onPointerMove = (e: PointerEvent): void => {
    if (!this.#renderContainer || !this.#overlay || !this.#renderer || !this.#canvas) return

    const detector = this.resolve<{ pixelToAxial(px: number, py: number): Axial }>('detector')
    if (!detector) return

    const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY)
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y))
    const meshLocalX = local.x - this.#meshOffset.x
    const meshLocalY = local.y - this.#meshOffset.y
    const axial = detector.pixelToAxial(meshLocalX, meshLocalY)

    const hexChanged = !this.#currentAxial
      || this.#currentAxial.q !== axial.q
      || this.#currentAxial.r !== axial.r

    if (hexChanged) {
      this.#currentAxial = axial
      this.#currentIndex = this.#lookupIndex(axial.q, axial.r)

      if (this.#hoverLog < 5) {
        console.log('[TileOverlay] hover q:', axial.q, 'r:', axial.r, '-> index:', this.#currentIndex)
        this.#hoverLog++
      }

      this.#positionOverlay(axial.q, axial.r)
      this.#updateSeedLabel(axial.q, axial.r)
      this.emitEffect('tile:hover', { q: axial.q, r: axial.r })
    }

    // always update per-icon hover state (even within same hex)
    this.#updateIconHover(local)
  }

  #updateIconHover(local: Point): void {
    if (!this.#overlay?.visible) {
      for (const a of this.#actions) a.button.hovered = false
      return
    }

    const ox = this.#overlay.position.x
    const oy = this.#overlay.position.y

    for (const a of this.#actions) {
      const btn = a.button
      const bx = local.x - ox - btn.position.x
      const by = local.y - oy - btn.position.y
      btn.hovered = btn.containsPoint(bx, by)
    }
  }

  // ── click detection ────────────────────────────────────────────

  #onClick = (e: MouseEvent): void => {
    if (this.#navigationBlocked) return
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return
    if (this.#currentIndex === undefined || this.#currentIndex >= this.#cellCount) return

    const entry = this.#occupiedByAxial.get(
      TileOverlayDrone.axialKey(this.#currentAxial!.q, this.#currentAxial!.r),
    )
    if (!entry?.label) return

    const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY)
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y))

    // check action buttons first (only when overlay is visible)
    if (this.#overlay?.visible) {
      const ox = this.#overlay.position.x
      const oy = this.#overlay.position.y

      for (const action of this.#actions) {
        const btn = action.button
        const bx = local.x - ox - btn.position.x
        const by = local.y - oy - btn.position.y

        if (btn.containsPoint(bx, by)) {
          action.handler(entry.label, this.#currentAxial!.q, this.#currentAxial!.r, this.#currentIndex!)
          return
        }
      }
    }

    // modifier click → selection (existing behavior)
    if (e.ctrlKey || e.metaKey) {
      this.emitEffect('tile:click', {
        q: this.#currentAxial!.q,
        r: this.#currentAxial!.r,
        label: entry.label,
        index: this.#currentIndex!,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      })
      return
    }

    // plain left-click on branch tile → navigate into child layer
    if (this.#branchLabels.has(entry.label)) {
      this.#navigateInto(entry.label)
    }
  }

  // right-click → navigate back to parent layer
  #onContextMenu = (e: MouseEvent): void => {
    if (this.#navigationBlocked) return
    e.preventDefault()
    this.#navigateBack()
  }

  // ── tile navigation ───────────────────────────────────────────

  #navigateInto(label: string): void {
    const lineage = this.resolve<{ explorerEnter(name: string): void }>('lineage')
    if (!lineage) return
    this.emitEffect('tile:navigate-in', { label })
    lineage.explorerEnter(label)
    void new hypercomb().act()
  }

  #navigateBack(): void {
    const lineage = this.resolve<{ explorerUp(): void }>('lineage')
    if (!lineage) return
    this.emitEffect('tile:navigate-back', {})
    lineage.explorerUp()
    void new hypercomb().act()
  }

  #handleRemove = async (label: string): Promise<void> => {
    const lineage = this.resolve<{ explorerDir(): Promise<FileSystemDirectoryHandle | null> }>('lineage')
    if (lineage) {
      const dir = await lineage.explorerDir()
      if (dir) {
        try {
          await dir.removeEntry(label, { recursive: true })
        } catch (e) {
          console.warn('[TileOverlay] failed to remove seed folder:', label, e)
        }
      }
    }

    EffectBus.emit('seed:removed', { seed: label })
    void new hypercomb().act()
  }

  // ── seed label ───────────────────────────────────────────────

  #updateSeedLabel(q: number, r: number): void {
    if (!this.#seedLabel) return
    const entry = this.#occupiedByAxial.get(TileOverlayDrone.axialKey(q, r))
    this.#seedLabel.text = entry?.label ?? ''
  }

  // ── visibility ─────────────────────────────────────────────────

  #updateVisibility(): void {
    if (!this.#overlay) return
    const occupied = this.#currentIndex !== undefined && this.#currentIndex < this.#cellCount
    this.#overlay.visible = occupied
  }

  // ── positioning ────────────────────────────────────────────────

  #positionOverlay(q: number, r: number): void {
    if (!this.#overlay) return
    const px = this.#axialToPixel(q, r)
    this.#overlay.position.set(
      px.x + this.#meshOffset.x,
      px.y + this.#meshOffset.y,
    )
    this.#updateVisibility()
  }

  #axialToPixel(q: number, r: number) {
    return {
      x: Math.sqrt(3) * this.#spacing * (q + r / 2),
      y: this.#spacing * 1.5 * r,
    }
  }

  // ── occupied position lookup ───────────────────────────────────

  static axialKey(q: number, r: number): string {
    return `${q},${r}`
  }

  #rebuildOccupiedMap(): void {
    this.#occupiedByAxial.clear()
    const axial = this.resolve<any>('axial')
    if (!axial?.items) return

    for (let i = 0; i < this.#cellCount; i++) {
      const coord = axial.items.get(i) as Axial | undefined
      const label = this.#cellLabels[i]
      if (!coord || !label) break
      this.#occupiedByAxial.set(TileOverlayDrone.axialKey(coord.q, coord.r), { index: i, label })
    }
  }

  #lookupIndex(q: number, r: number): number | undefined {
    return this.#occupiedByAxial.get(TileOverlayDrone.axialKey(q, r))?.index
  }

  // ── coordinate mapping ─────────────────────────────────────────

  #clientToPixiGlobal(cx: number, cy: number) {
    const events = (this.#renderer as any)?.events
    if (events?.mapPositionToPoint) {
      const out = new Point()
      events.mapPositionToPoint(out, cx, cy)
      return { x: out.x, y: out.y }
    }
    const rect = this.#canvas!.getBoundingClientRect()
    const screen = this.#renderer!.screen
    return {
      x: (cx - rect.left) * (screen.width / rect.width),
      y: (cy - rect.top) * (screen.height / rect.height),
    }
  }
}

const _tileOverlay = new TileOverlayDrone()
window.ioc.register('@diamondcoreprocessor.com/TileOverlayDrone', _tileOverlay)
