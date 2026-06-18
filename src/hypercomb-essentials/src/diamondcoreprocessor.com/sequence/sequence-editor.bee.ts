// diamondcoreprocessor.com/sequence/sequence-editor.bee.ts
//
// SequenceEditorBee — the interactive drop-target sequence CREATOR.
//
// `/sequence <name>` navigates the canvas into a hidden, blank layer (the
// dashboard pattern: a content-addressed bag at a one-off `seq-<salt>`
// segment that no layer's `children` references, so it never appears as a
// tile). On that clean grid:
//
//   • a GHOST hex follows the cursor (move-preview's overlay technique:
//     a Pixi child of the render container, so it pans/zooms with the grid);
//   • a left-click drops the next numbered target at that hex; clicking a
//     placed target removes it and the rest renumber;
//   • a bottom-right DONE saves the ordered hex-spiral indexes as a named
//     set (SequenceService) and binds it (cascading, position→leaf) to the
//     location `/sequence` was launched from. CANCEL / Escape discards.
//
// The in-memory `#steps` array is the only source of truth while editing —
// nothing is committed to the hidden layer, so there is no history churn and
// no fight with show-cell's placement. The save happens once, on Done.

import { Worker } from '@hypercomb/core'
import { Container, Graphics, Text, Point } from 'pixi.js'
import type { HostReadyPayload } from '../presentation/tiles/pixi-host.worker.js'

const RETURN_KEY = 'hc:@diamondcoreprocessor.com/SequenceEditorBee:return'

type LineageLike = {
  domain?: () => string
  explorerSegments?: () => readonly string[]
}
type HistoryLike = {
  sign(l: { domain?: () => string; explorerSegments?: () => readonly string[] }): Promise<string>
  commitLayer(locationSig: string, layer: { name?: string; children?: string[] }): Promise<string>
}
type NavigationLike = { goRaw: (segments: readonly string[]) => void }
type SequenceServiceLike = {
  get(name: string): { indexes: number[] } | null
  save(name: string, indexes: readonly number[]): Promise<string>
  applyTo(segments: readonly string[], name: string): Promise<void>
}
type AxialCoord = { q: number; r: number; index: number }
type AxialLike = {
  items: Map<number, AxialCoord>
  newCoordinate(q: number, r: number, s: number): { index: number }
}
type DetectorLike = {
  pixelToAxial(px: number, py: number, flat?: boolean): { q: number; r: number }
  spacing: number
}
type RendererLike = {
  events?: { mapPositionToPoint?: (out: Point, x: number, y: number) => void }
  screen?: { width: number; height: number }
}
type I18nLike = { t: (k: string, p?: Record<string, string | number>) => string }

const ACCENT = 0x6eb4ff
const REMOVE = 0xff6e6e

export class SequenceEditorBee extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sequence'

  public override description =
    'SequenceEditorBee — interactive drop-target sequence creator. Click empty hexes to set the order new tiles fill; Done saves the set and binds it to the branch.'

  // ── render-host handles (move-preview pattern) ──────────────────────
  #renderContainer: Container | null = null
  #renderer: RendererLike | null = null
  #canvas: HTMLCanvasElement | null = null
  #meshOffset = { x: 0, y: 0 }
  #flat = false // hex orientation (point-top default), tracked off render:set-orientation

  #ghost: Graphics | null = null
  #targets: Container | null = null

  // ── editor state ────────────────────────────────────────────────────
  #active = false
  #name = 'default'
  #steps: number[] = []
  #anchorSegments: readonly string[] = []
  #returnSegments: readonly string[] = []
  #bagSegments: readonly string[] = []
  #hoverIndex: number | null = null
  #spaceHeld = false

  // ── DOM overlay ─────────────────────────────────────────────────────
  #overlay: HTMLDivElement | null = null
  #nameInput: HTMLInputElement | null = null
  #countLabel: HTMLSpanElement | null = null

  protected override act = async (): Promise<void> => {
    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#renderContainer = payload.container
      this.#renderer = payload.renderer as unknown as RendererLike
      this.#canvas = payload.canvas
      this.#ghost = null
      this.#targets = null
    })
    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (offset) => {
      this.#meshOffset = offset
      if (this.#active) {
        this.#redrawTargets()
        this.#redrawGhost()
      }
    })
    this.onEffect<{ flat: boolean }>('render:set-orientation', (payload) => {
      this.#flat = !!payload?.flat
      if (this.#active) {
        this.#redrawTargets()
        this.#redrawGhost()
      }
    })
  }

  public get isActive(): boolean {
    return this.#active
  }

  // ── lifecycle ───────────────────────────────────────────────────────

  /** `/sequence <name>` entry point. Navigates into a blank hidden layer
   *  and begins editing the named set, anchored to `anchorSegments`. */
  public async openEditor(name: string, anchorSegments: readonly string[]): Promise<void> {
    if (this.#active) return
    const lineage = window.ioc.get<LineageLike>('@hypercomb.social/Lineage')
    const history = window.ioc.get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !history) return

    this.#name = (name || 'default').trim() || 'default'
    this.#anchorSegments = anchorSegments.map(s => String(s ?? '').trim()).filter(Boolean)
    this.#returnSegments = this.#currentSegments()

    // Preload an existing set so re-running `/sequence <name>` edits it.
    const svc = window.ioc.get<SequenceServiceLike>('@diamondcoreprocessor.com/SequenceService')
    const existing = svc?.get(this.#name)
    this.#steps = existing?.indexes ? [...existing.indexes] : []
    this.#hoverIndex = null

    // Mint an empty hidden layer at a one-off segment and navigate in.
    const salt = Date.now().toString(36)
    this.#bagSegments = [`seq-${salt}`]
    const bagLocSig = await history.sign({
      domain: lineage.domain,
      explorerSegments: () => this.#bagSegments,
    })
    await history.commitLayer(bagLocSig, { name: this.#bagSegments[0], children: [] })

    this.#active = true
    this.#persistReturn()
    this.#navigate(this.#bagSegments)

    this.#ensureLayers()
    this.#attachListeners()
    this.#showOverlay()
    this.#redrawTargets()
    this.#redrawGhost()
  }

  /** Save the set + bind it to the anchor branch, then exit. */
  async #done(): Promise<void> {
    if (!this.#active) return
    const name = (this.#nameInput?.value || this.#name).trim() || 'default'
    this.#name = name
    const steps = [...this.#steps]
    const svc = window.ioc.get<SequenceServiceLike>('@diamondcoreprocessor.com/SequenceService')
    if (svc && steps.length) {
      try {
        await svc.save(name, steps)
        await svc.applyTo(this.#anchorSegments, name)
      } catch (err) {
        console.warn('[/sequence] save/apply failed', err)
      }
    }
    this.#teardown(true)
  }

  /** Discard and exit. */
  #cancel(): void {
    this.#teardown(true)
  }

  #teardown(navigateBack: boolean): void {
    if (!this.#active) return
    this.#active = false
    this.#detachListeners()
    this.#hideOverlay()
    this.#clearLayers()
    if (navigateBack) this.#navigate(this.#returnSegments ?? [])
    this.#steps = []
    this.#hoverIndex = null
    this.#spaceHeld = false
  }

  // ── navigation ──────────────────────────────────────────────────────

  #navigate(segments: readonly string[]): void {
    window.ioc.get<NavigationLike>('@hypercomb.social/Navigation')?.goRaw?.(segments)
  }

  #currentSegments(): string[] {
    const lineage = window.ioc.get<LineageLike>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  #persistReturn(): void {
    try {
      localStorage.setItem(RETURN_KEY, JSON.stringify(this.#returnSegments))
    } catch {
      /* ignore */
    }
  }

  // ── input ───────────────────────────────────────────────────────────

  #attachListeners(): void {
    document.addEventListener('pointerdown', this.#onPointerDown, true)
    document.addEventListener('pointermove', this.#onPointerMove, true)
    document.addEventListener('contextmenu', this.#onContextMenu, true)
    window.addEventListener('keydown', this.#onKeyDown, true)
    window.addEventListener('keyup', this.#onKeyUp, true)
  }

  #detachListeners(): void {
    document.removeEventListener('pointerdown', this.#onPointerDown, true)
    document.removeEventListener('pointermove', this.#onPointerMove, true)
    document.removeEventListener('contextmenu', this.#onContextMenu, true)
    window.removeEventListener('keydown', this.#onKeyDown, true)
    window.removeEventListener('keyup', this.#onKeyUp, true)
  }

  // While editing we own every canvas pointerdown (except spacebar-pan) so
  // selection / up-nav / long-press never fire on the blank grid.
  #onPointerDown = (e: PointerEvent): void => {
    if (!this.#active) return
    if (!(e.target instanceof HTMLCanvasElement)) return // DOM overlay buttons pass through
    if (this.#spaceHeld) return // let spacebar-pan drag the view
    if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      const idx = this.#indexAt(e.clientX, e.clientY)
      if (idx != null) this.#toggleStep(idx)
    }
    e.preventDefault()
    e.stopPropagation()
  }

  #onPointerMove = (e: PointerEvent): void => {
    if (!this.#active) return
    const idx = e.target instanceof HTMLCanvasElement ? this.#indexAt(e.clientX, e.clientY) : null
    if (idx !== this.#hoverIndex) {
      this.#hoverIndex = idx
      this.#redrawGhost()
    }
  }

  // Right-click on the blank grid would otherwise navigate up and out of the
  // hidden editor layer — swallow it.
  #onContextMenu = (e: MouseEvent): void => {
    if (!this.#active) return
    if (!(e.target instanceof HTMLCanvasElement)) return
    e.preventDefault()
    e.stopPropagation()
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (!this.#active) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.#cancel()
      return
    }
    // Don't treat typing in the name field as canvas input.
    if (e.target instanceof HTMLInputElement) return
    if (e.code === 'Space') this.#spaceHeld = true
  }

  #onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') this.#spaceHeld = false
  }

  // ── geometry ────────────────────────────────────────────────────────

  #axial(): AxialLike | undefined {
    return window.ioc.get<AxialLike>('@diamondcoreprocessor.com/AxialService')
  }

  #detector(): DetectorLike | undefined {
    return window.ioc.get<DetectorLike>('@diamondcoreprocessor.com/HexDetector')
  }

  /** Center-to-center hex spacing, matching the live mesh (circumRadiusPx +
   *  gapPx; HexDetector carries the canonical value). */
  #spacing(): number {
    const s = this.#detector()?.spacing
    return typeof s === 'number' && s > 0 ? s : 38
  }

  /** Radius for the drawn target/ghost hex — slightly inset from the cell. */
  #drawRadius(): number {
    return this.#spacing() * 0.9
  }

  /** Axial (q,r) → mesh-local pixel center — same formula show-cell renders
   *  tiles with (see show-cell.drone.ts axialToPixel). */
  #axialToPixel(q: number, r: number): { x: number; y: number } {
    const s = this.#spacing()
    return this.#flat
      ? { x: 1.5 * s * q, y: Math.sqrt(3) * s * (r + q / 2) }
      : { x: Math.sqrt(3) * s * (q + r / 2), y: s * 1.5 * r }
  }

  /** Screen client coords → the hex-spiral index under the cursor, or null
   *  when the point is outside the grid. Mirrors tile-overlay's click path:
   *  toLocal → minus meshOffset → detector.pixelToAxial. */
  #indexAt(cx: number, cy: number): number | null {
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return null
    const axial = this.#axial()
    const detector = this.#detector()
    if (!axial?.items || !axial.newCoordinate || !detector?.pixelToAxial) return null
    const pg = this.#clientToPixiGlobal(cx, cy)
    const local = this.#renderContainer.toLocal(new Point(pg.x, pg.y))
    const mx = local.x - this.#meshOffset.x
    const my = local.y - this.#meshOffset.y
    const { q, r } = detector.pixelToAxial(mx, my, this.#flat)
    const idx = axial.newCoordinate(q, r, -q - r).index
    if (!Number.isFinite(idx) || idx < 0) return null
    // Reject clicks beyond the grid edge (pixelToAxial snaps to a rim cell).
    const center = this.#axialToPixel(q, r)
    if (Math.hypot(mx - center.x, my - center.y) > this.#spacing()) return null
    return idx
  }

  #clientToPixiGlobal(cx: number, cy: number): { x: number; y: number } {
    const events = this.#renderer?.events
    if (events?.mapPositionToPoint) {
      const out = new Point()
      events.mapPositionToPoint(out, cx, cy)
      return { x: out.x, y: out.y }
    }
    const rect = this.#canvas!.getBoundingClientRect()
    const screen = this.#renderer!.screen!
    return {
      x: (cx - rect.left) * (screen.width / rect.width),
      y: (cy - rect.top) * (screen.height / rect.height),
    }
  }

  // ── steps ───────────────────────────────────────────────────────────

  #toggleStep(idx: number): void {
    const at = this.#steps.indexOf(idx)
    if (at >= 0) this.#steps.splice(at, 1)
    else this.#steps.push(idx)
    this.#redrawTargets()
    this.#redrawGhost()
    this.#updateCount()
  }

  // ── drawing (render-container children, pan/zoom for free) ───────────

  #ensureLayers(): void {
    if (!this.#renderContainer) return
    if (!this.#targets) {
      this.#targets = new Container()
      this.#targets.zIndex = 8000
      this.#renderContainer.addChild(this.#targets)
    }
    if (!this.#ghost) {
      this.#ghost = new Graphics()
      this.#ghost.zIndex = 8001
      this.#renderContainer.addChild(this.#ghost)
    }
    this.#renderContainer.sortableChildren = true
  }

  #clearLayers(): void {
    if (this.#targets) {
      for (const c of this.#targets.removeChildren()) c.destroy()
    }
    this.#ghost?.clear()
  }

  #hexVerts(cx: number, cy: number, r: number): number[] {
    const verts: number[] = []
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2 // pointy-top
      verts.push(cx + r * Math.cos(a), cy + r * Math.sin(a))
    }
    return verts
  }

  #redrawTargets(): void {
    if (!this.#active) return
    this.#ensureLayers()
    if (!this.#targets) return
    for (const c of this.#targets.removeChildren()) c.destroy()
    const axial = this.#axial()
    if (!axial?.items) return
    const r = this.#drawRadius()
    const ox = this.#meshOffset.x
    const oy = this.#meshOffset.y

    this.#steps.forEach((idx, i) => {
      const coord = axial.items.get(idx)
      if (!coord) return
      const p = this.#axialToPixel(coord.q, coord.r)
      const cx = p.x + ox
      const cy = p.y + oy
      const verts = this.#hexVerts(cx, cy, r)

      const g = new Graphics()
      g.poly(verts, true)
      g.fill({ color: ACCENT, alpha: 0.18 })
      g.poly(verts, true)
      g.stroke({ color: ACCENT, alpha: 0.9, width: 3 })
      this.#targets!.addChild(g)

      const label = new Text({
        text: String(i + 1),
        style: {
          fill: 0xffffff,
          fontSize: Math.max(10, r * 0.7),
          fontWeight: '700',
          fontFamily: 'Inter, system-ui, sans-serif',
        },
      })
      label.anchor.set(0.5)
      label.position.set(cx, cy)
      this.#targets!.addChild(label)
    })
  }

  #redrawGhost(): void {
    if (!this.#ghost) return
    this.#ghost.clear()
    if (!this.#active || this.#hoverIndex == null) return
    const axial = this.#axial()
    const coord = axial?.items?.get(this.#hoverIndex)
    if (!coord) return
    const p = this.#axialToPixel(coord.q, coord.r)
    const cx = p.x + this.#meshOffset.x
    const cy = p.y + this.#meshOffset.y
    const exists = this.#steps.includes(this.#hoverIndex)
    const color = exists ? REMOVE : ACCENT
    const verts = this.#hexVerts(cx, cy, this.#drawRadius())
    this.#ghost.poly(verts, true)
    this.#ghost.fill({ color, alpha: 0.12 })
    this.#ghost.poly(verts, true)
    this.#ghost.stroke({ color, alpha: 0.65, width: 2 })
  }

  // ── DOM overlay ─────────────────────────────────────────────────────

  #i18n(key: string, fallback: string): string {
    const i18n = window.ioc.get<I18nLike>('@hypercomb.social/I18n')
    const t = i18n?.t(key)
    return t && t !== key ? t : fallback
  }

  #showOverlay(): void {
    if (this.#overlay) this.#hideOverlay()
    const o = document.createElement('div')
    o.setAttribute('data-hc-sequence-editor', '')
    Object.assign(o.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '60000',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      padding: '12px 14px',
      width: 'min(260px, 80vw)',
      background: '#1c1c20',
      color: '#eaeaea',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '10px',
      boxShadow: '0 14px 36px rgba(0,0,0,0.55)',
      font: '13px/1.4 Inter, system-ui, sans-serif',
    } as CSSStyleDeclaration)

    const hint = document.createElement('div')
    hint.textContent = this.#i18n('sequence.hint', 'Click hexes in order to set where new tiles land.')
    Object.assign(hint.style, { fontSize: '0.78rem', opacity: '0.7', lineHeight: '1.35' } as CSSStyleDeclaration)
    o.appendChild(hint)

    const nameInput = document.createElement('input')
    nameInput.type = 'text'
    nameInput.value = this.#name
    nameInput.placeholder = this.#i18n('sequence.namePlaceholder', 'sequence name')
    Object.assign(nameInput.style, {
      width: '100%',
      padding: '0.4rem 0.55rem',
      background: 'rgba(0,0,0,0.25)',
      color: 'inherit',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '6px',
      font: 'inherit',
      boxSizing: 'border-box',
    } as CSSStyleDeclaration)
    o.appendChild(nameInput)
    this.#nameInput = nameInput

    const count = document.createElement('span')
    Object.assign(count.style, { fontSize: '0.78rem', opacity: '0.75' } as CSSStyleDeclaration)
    o.appendChild(count)
    this.#countLabel = count
    this.#updateCount()

    const actions = document.createElement('div')
    Object.assign(actions.style, { display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' } as CSSStyleDeclaration)

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.textContent = this.#i18n('sequence.cancel', 'Cancel')
    Object.assign(cancelBtn.style, {
      padding: '0.4rem 0.9rem',
      background: 'transparent',
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: '6px',
      color: '#cfcfcf',
      cursor: 'pointer',
    } as CSSStyleDeclaration)
    cancelBtn.addEventListener('click', () => this.#cancel())
    actions.appendChild(cancelBtn)

    const doneBtn = document.createElement('button')
    doneBtn.type = 'button'
    doneBtn.textContent = this.#i18n('sequence.done', 'Done')
    Object.assign(doneBtn.style, {
      padding: '0.4rem 1.2rem',
      background: 'rgba(110, 180, 255, 0.22)',
      border: '1px solid rgba(110, 180, 255, 0.55)',
      borderRadius: '6px',
      color: '#d4e6ff',
      fontWeight: '600',
      cursor: 'pointer',
    } as CSSStyleDeclaration)
    doneBtn.addEventListener('click', () => { void this.#done() })
    actions.appendChild(doneBtn)

    o.appendChild(actions)
    document.body.appendChild(o)
    this.#overlay = o
  }

  #updateCount(): void {
    if (!this.#countLabel) return
    const n = this.#steps.length
    this.#countLabel.textContent = this.#i18n('sequence.count', `${n} targets`).replace('{count}', String(n))
  }

  #hideOverlay(): void {
    this.#overlay?.remove()
    this.#overlay = null
    this.#nameInput = null
    this.#countLabel = null
  }
}

const _sequenceEditor = new SequenceEditorBee()
window.ioc.register('@diamondcoreprocessor.com/SequenceEditorBee', _sequenceEditor)
