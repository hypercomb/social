// hypercomb-shared/ui/docked-panel/hc-docked-panel.directive.ts
//
// hcDockedPanel — the shared "docked side panel" chrome: drag-to-resize +
// content-shrink, in ONE place so the docked toolwindows don't each hand-roll
// it. Stamp it on a left- or right-docked panel's root <aside>:
//
//   <aside class="files-panel" hcDockInset="right"
//          hcDockedPanel="files-viewer" dockSide="right"
//          [minWidth]="280" [maxWidth]="680" [defaultWidth]="340"> … </aside>
//
// It:
//   • injects a thin resize grip on the panel's INNER edge (opposite the dock
//     side) — drag it to resize; a steel hairline brightens on hover/drag,
//   • applies the width inline and PERSISTS it participant-local (localStorage,
//     keyed by the id) so the panel reopens at the size you left it,
//   • derives `--hc-panel-scale` from the width and sets it on the host, so the
//     panel's em-sized content SHRINKS as it narrows / grows as it widens (the
//     panel's SCSS consumes the var — see clipboard-panel for the pattern). A
//     calc-multiplier, NOT `zoom`, to avoid softening glyphs under a panel's
//     backdrop-filter (documentation/zoomable-widgets.md).
//
// Pairs with hcDockInset, whose ResizeObserver re-reports the reserved canvas
// inset as the width changes — so resizing keeps every on-screen tile beside
// the panel. Self-contained: the grip is built + styled imperatively (inline,
// bypassing view encapsulation) so no component needs a per-panel grip element
// in its template or SCSS. Shell UI — no essentials import.

import { Directive, ElementRef, Input, inject, type OnDestroy, type OnInit } from '@angular/core'

// Steel hairline — the cold/clean chrome convention shared with the header /
// command line, so every docked panel's grip reads identically.
const STEEL = '126, 182, 214'

@Directive({
  selector: '[hcDockedPanel]',
  standalone: true,
})
export class HcDockedPanelDirective implements OnInit, OnDestroy {

  /** Stable participant-local id → localStorage width key. */
  @Input('hcDockedPanel') id = ''
  /** Screen edge the panel docks against; the grip sits on the opposite edge. */
  @Input() dockSide: 'left' | 'right' = 'right'
  @Input() minWidth = 280
  @Input() maxWidth = 680
  @Input() defaultWidth = 360
  /** Content-scale clamp. Floor keeps text readable; ceiling stops a wide panel
   *  ballooning its content. */
  @Input() minScale = 0.82
  @Input() maxScale = 1.4

  readonly #el: HTMLElement = inject(ElementRef).nativeElement
  #grip: HTMLElement | null = null
  #line: HTMLElement | null = null
  #width = 0
  #startX = 0
  #startWidth = 0
  #dragging = false

  ngOnInit(): void {
    this.#width = this.#restoreWidth()
    this.#apply()
    this.#installGrip()
  }

  ngOnDestroy(): void {
    this.#stopListeners()
    this.#grip?.removeEventListener('pointerdown', this.#onDown)
  }

  #key(): string { return `hc:docked-width:${this.id}` }

  #clamp(w: number): number {
    // Never wider than the viewport (minus a gutter) so the close button can't
    // be stranded off-screen on a narrow display.
    const vpMax = Math.max(this.minWidth, window.innerWidth - 24)
    return Math.round(Math.max(this.minWidth, Math.min(w, Math.min(this.maxWidth, vpMax))))
  }

  #restoreWidth(): number {
    try {
      const raw = localStorage.getItem(this.#key())
      const n = raw ? parseInt(raw, 10) : NaN
      if (Number.isFinite(n)) return this.#clamp(n)
    } catch { /* ignore */ }
    return this.#clamp(this.defaultWidth)
  }

  #apply(): void {
    this.#el.style.width = `${this.#width}px`
    const scale = Math.min(this.maxScale, Math.max(this.minScale, this.#width / this.defaultWidth))
    this.#el.style.setProperty('--hc-panel-scale', String(scale))
  }

  // ── grip ───────────────────────────────────────────────────────────
  #installGrip(): void {
    // Grip on the INNER edge: a right-docked panel resizes from its left edge,
    // a left-docked panel from its right edge.
    const inner = this.dockSide === 'right' ? 'left' : 'right'
    const grip = document.createElement('div')
    grip.setAttribute('data-hc-grip', '')
    grip.setAttribute('role', 'separator')
    grip.setAttribute('aria-orientation', 'vertical')
    Object.assign(grip.style, {
      position: 'absolute', top: '0', bottom: '0', [inner]: '0',
      width: '10px', cursor: 'ew-resize', zIndex: '6', touchAction: 'none',
    } as Partial<CSSStyleDeclaration>)

    const line = document.createElement('div')
    Object.assign(line.style, {
      position: 'absolute', top: '0', bottom: '0', [inner]: '0',
      width: '2px', background: `rgba(${STEEL}, 0)`, transition: 'background 0.12s ease',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>)
    grip.appendChild(line)

    grip.addEventListener('pointerenter', () => { if (!this.#dragging) this.#tintLine(0.6) })
    grip.addEventListener('pointerleave', () => { if (!this.#dragging) this.#tintLine(0) })
    grip.addEventListener('pointerdown', this.#onDown)

    this.#el.appendChild(grip)
    this.#grip = grip
    this.#line = line
  }

  #tintLine(alpha: number): void {
    if (this.#line) this.#line.style.background = `rgba(${STEEL}, ${alpha})`
  }

  #onDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    this.#dragging = true
    this.#startX = event.clientX
    this.#startWidth = this.#width
    this.#tintLine(0.85)
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch { /* best effort */ }
    window.addEventListener('pointermove', this.#onMove)
    window.addEventListener('pointerup', this.#onUp)
    window.addEventListener('pointercancel', this.#onUp)
  }

  #onMove = (event: PointerEvent): void => {
    if (!this.#dragging) return
    // Right-docked: dragging the left grip LEFT (clientX↓) widens. Left-docked:
    // dragging the right grip RIGHT widens. Mirror the delta accordingly.
    const dx = this.dockSide === 'right' ? (this.#startX - event.clientX) : (event.clientX - this.#startX)
    this.#width = this.#clamp(this.#startWidth + dx)
    this.#apply()
  }

  #onUp = (): void => {
    if (!this.#dragging) return
    this.#dragging = false
    this.#stopListeners()
    this.#tintLine(0)
    try { localStorage.setItem(this.#key(), String(this.#width)) } catch { /* ignore */ }
  }

  #stopListeners(): void {
    window.removeEventListener('pointermove', this.#onMove)
    window.removeEventListener('pointerup', this.#onUp)
    window.removeEventListener('pointercancel', this.#onUp)
  }
}
