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
//     backdrop-filter (documentation/zoomable-widgets.md),
//   • injects a SETTINGS gear into the panel's header, opening a small popover
//     of per-window settings. The one setting today is the window's GROUP: a
//     plain text field. Windows whose group text MATCHES share attributes (the
//     width, for now); a blank one is on its own. Nothing to create, name or
//     delete — the text is the whole model.
//
// Pairs with hcDockInset, whose ResizeObserver re-reports the reserved canvas
// inset as the width changes — so resizing keeps every on-screen tile beside
// the panel. Self-contained: the grip is built + styled imperatively (inline,
// bypassing view encapsulation) so no component needs a per-panel grip element
// in its template or SCSS. Shell UI — no essentials import.

import { Directive, ElementRef, Input, inject, type OnDestroy, type OnInit } from '@angular/core'

// The GROUP model — membership text and shared attributes — lives in
// panel-groups.ts. This file is the chrome that drives it.
import {
  type GroupAttrs, type GroupMember, STEEL,
  members, normalizeGroup, publishAttrs, readGroupAttrs, readMembership, writeMembership,
} from './panel-groups'

const t = (key: string, fallback: string, params?: Record<string, unknown>): string => {
  const i18n = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@hypercomb.social/I18n') as
    { t(k: string, p?: Record<string, unknown>): string } | undefined
  return i18n?.t(key, params) ?? fallback
}

/** Every mounted docked panel — the chrome-side view of `members`, used to
 *  repaint gears and popovers when grouping changes anywhere. */
const live = new Set<HcDockedPanelDirective>()

/** The gear's reveal + resting/hover colour. Bare glyph — no circle, no plate —
 *  and ABSENT until you hover the band it lives in.
 *
 *  A real stylesheet, not inline style: `:hover` cannot be expressed inline, and
 *  the gear is created imperatively so a component's (emulated-encapsulation)
 *  SCSS never reaches it. The RESTING colour is per-window state (a grouped
 *  window's gear is steel, an ungrouped one dim), so the directive sets only the
 *  `--hc-gear` custom property inline and the sheet reads it — an inline
 *  `color` would outrank the `:hover` rule and kill the effect. It also brightens
 *  while focused (keyboard reach) and while its popover is open.
 *
 *  HOVER-ONLY, deliberately (do not make it stand at all times): window grouping
 *  is a rare act, and permanent chrome in every panel's title bar competes with
 *  the panel's own controls. `*:hover >` matches the gear's own parent — the
 *  header band, or the panel root for a headerless panel. At rest it is also
 *  non-interactive, so it can never swallow a click aimed at the header
 *  underneath. It stays up while focused and while its popover is open — a gear
 *  that vanished as the pointer travelled into the popover it just opened would
 *  read as the panel snatching the settings away. */
const GEAR_CSS = `
[data-hc-panel-settings] { color: var(--hc-gear, #6e8290); opacity: 0; pointer-events: none; }
*:hover > [data-hc-panel-settings],
[data-hc-panel-settings]:focus-visible,
[data-hc-panel-settings][aria-expanded='true'] { opacity: 1; pointer-events: auto; }
[data-hc-panel-settings]:hover,
[data-hc-panel-settings]:focus-visible,
[data-hc-panel-settings][aria-expanded='true'] { color: #cfe3ef; }
`

let gearCssInstalled = false

const installGearCss = (): void => {
  if (gearCssInstalled || typeof document === 'undefined') return
  gearCssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-panel-settings-css', '')
  style.textContent = GEAR_CSS
  document.head.appendChild(style)
}

@Directive({
  selector: '[hcDockedPanel]',
  standalone: true,
})
export class HcDockedPanelDirective implements OnInit, OnDestroy, GroupMember {

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
  #gearBtn: HTMLElement | null = null
  #popover: HTMLElement | null = null
  #group = ''
  #width = 0
  #startX = 0
  #startWidth = 0
  #dragging = false

  /** GroupMember — what this window contributes to, and takes from, its group. */
  get group(): string { return this.#group }
  attrs(): GroupAttrs { return { width: this.#width } }

  ngOnInit(): void {
    live.add(this)
    members.add(this)
    this.#group = readMembership(this.id)
    // A grouped panel opens at its GROUP's width rather than its own remembered
    // one — that is what "shares attributes" has to mean for a window that
    // wasn't mounted when the group's width last changed.
    const shared = this.#group ? readGroupAttrs(this.#group).width : undefined
    this.#width = (shared !== undefined) ? this.#clamp(shared) : this.#restoreWidth()
    this.#apply()
    this.#installGrip()
    this.#installSettings()
    // First member of an empty group defines its width.
    if (this.#group && shared === undefined) publishAttrs(this)
  }

  ngOnDestroy(): void {
    live.delete(this)
    members.delete(this)
    this.#stopListeners()
    this.#closePopover()
    this.#grip?.removeEventListener('pointerdown', this.#onDown)
    this.#gearBtn?.removeEventListener('click', this.#onGearClick)
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
    // Fit BESIDE the control bar, never over it. The bar is fixed to its edge
    // and publishes what it occupies as `--hc-controls-<side>` (0 when it is
    // free-floating, on the other edge, or on mobile), so a panel on the same
    // edge starts just inboard of it. Set inline because panels hardcode
    // `right: 0` / `left: 0` in their own SCSS.
    this.#el.style[this.dockSide] = `var(--hc-controls-${this.dockSide}, 0px)`
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

  // ── settings gear ──────────────────────────────────────────────────
  /** The settings affordance: a gear in the header band, LAST before the close
   *  button — after the window's title and its own controls, never leading them.
   *  It is chrome the directive adds, so it sits at the trailing end rather than
   *  pushing a panel's identity (icon + title) off the head of its own header.
   *
   *  It goes IN the header's flex flow rather than floating over a corner — an
   *  overlay is how the old bottom-corner lock silently ate the feedback panel's
   *  Send button, and a shared directive must not inflict that on panels that
   *  know nothing about it. In flow it can never overlap, in this panel or any
   *  future one, with no per-panel styling; and the header band is already a
   *  fixed shared height (_toolwindow.scss), so the gear lands at the same spot
   *  in every tool window. Panels whose root has no header get the gear pinned
   *  to the top corner opposite their close button instead.
   *
   *  Just the glyph — no circle, no plate — and it appears only while the header
   *  band is hovered (see `GEAR_CSS`). */
  #installSettings(): void {
    installGearCss()
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('data-hc-panel-settings', '')
    btn.setAttribute('aria-haspopup', 'dialog')
    btn.setAttribute('aria-expanded', 'false')
    Object.assign(btn.style, {
      flex: '0 0 auto', width: '22px', height: '22px', padding: '0',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'transparent', border: 'none', borderRadius: '0',
      cursor: 'pointer', zIndex: '7', transition: 'opacity 0.12s ease, color 0.12s ease',
    } as Partial<CSSStyleDeclaration>)

    const glyph = document.createElement('span')
    glyph.className = 'mat-sym'
    glyph.textContent = 'settings'
    glyph.style.fontSize = '15px'
    glyph.style.pointerEvents = 'none'
    btn.appendChild(glyph)
    btn.addEventListener('click', this.#onGearClick)

    const header = this.#el.querySelector(':scope > header')
    if (header) {
      // Before the close button (the last element in every tool window's
      // header), so the gear trails the title and the panel's own controls and
      // close stays hard-right where it always is.
      header.insertBefore(btn, header.lastElementChild)
    } else {
      // No header to ride in: sit in the top corner on the panel's INNER edge,
      // which is the corner a close button never occupies.
      const inner = this.dockSide === 'right' ? 'left' : 'right'
      Object.assign(btn.style, { position: 'absolute', top: '10px', [inner]: '14px' } as Partial<CSSStyleDeclaration>)
      this.#el.appendChild(btn)
    }
    this.#gearBtn = btn
    this.#renderGearState()
  }

  #t(key: string, fallback: string, params?: Record<string, unknown>): string { return t(key, fallback, params) }

  /** Human label for this window in the group's membership line. The id is the
   *  only name the directive has — panels never tell it their title. */
  #label(): string {
    const base = this.id.replace(/-(viewer|panel|landing)$/, '').replace(/-/g, ' ')
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : this.id
  }

  /** A grouped window's gear lights up, and says which group in its tooltip —
   *  so the header itself tells you the window travels with others, and the
   *  popover is only needed to CHANGE that. */
  #renderGearState(): void {
    const btn = this.#gearBtn
    if (!btn) return
    const group = this.#group
    // The RESTING colour only — as a custom property, so the sheet's `:hover`
    // rule still wins (an inline `color` would outrank it).
    btn.style.setProperty('--hc-gear', group ? `rgb(${STEEL})` : '#6e8290')
    btn.title = group
      ? this.#t('panel.settings.grouped', `Window settings — ${group}`, { group })
      : this.#t('panel.settings', 'Window settings')
  }

  #onGearClick = (event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    if (this.#popover) { this.#closePopover(); return }
    // One settings popover at a time across the whole docked column.
    for (const panel of live) panel.#closePopover()
    this.#openPopover()
  }

  // ── settings popover ───────────────────────────────────────────────
  #openPopover(): void {
    const pop = document.createElement('div')
    pop.setAttribute('data-hc-panel-settings-pop', '')
    pop.setAttribute('role', 'dialog')
    pop.setAttribute('aria-label', this.#t('panel.settings', 'Window settings'))
    const inner = this.dockSide === 'right' ? 'left' : 'right'
    Object.assign(pop.style, {
      position: 'absolute', top: '2.6rem', [inner]: '10px',
      width: 'min(248px, calc(100% - 20px))', boxSizing: 'border-box',
      padding: '0.6rem 0.7rem 0.7rem', zIndex: '9',
      background: 'rgba(12, 18, 24, 0.97)',
      border: `1px solid rgba(${STEEL}, 0.35)`, borderRadius: '6px',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
      font: '400 12px/1.45 system-ui, sans-serif', color: '#c8d6de',
    } as Partial<CSSStyleDeclaration>)
    pop.addEventListener('pointerdown', (e) => { e.stopPropagation() })

    pop.appendChild(this.#groupSection())

    this.#el.appendChild(pop)
    this.#popover = pop
    this.#gearBtn?.setAttribute('aria-expanded', 'true')
    window.addEventListener('pointerdown', this.#onOutside, true)
    window.addEventListener('keydown', this.#onEscape, true)
  }

  #closePopover(): void {
    if (!this.#popover) return
    this.#popover.remove()
    this.#popover = null
    this.#gearBtn?.setAttribute('aria-expanded', 'false')
    window.removeEventListener('pointerdown', this.#onOutside, true)
    window.removeEventListener('keydown', this.#onEscape, true)
  }

  #onOutside = (event: PointerEvent): void => {
    const target = event.target as Node | null
    if (target && (this.#popover?.contains(target) || this.#gearBtn?.contains(target))) return
    this.#closePopover()
  }

  #onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.#popover) return
    event.stopPropagation()
    this.#closePopover()
    this.#gearBtn?.focus()
  }

  /** The GROUP setting: one text field. Type the same word in another window
   *  and the two travel together. Committed on Enter/blur (`change`) rather
   *  than per keystroke, so typing "team" doesn't briefly join "t". */
  #groupSection(): HTMLElement {
    const section = document.createElement('div')
    section.setAttribute('data-hc-setting', 'group')

    const label = document.createElement('div')
    label.textContent = this.#t('panel.group.label', 'Tool window group')
    Object.assign(label.style, {
      fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase',
      color: '#7f95a3', marginBottom: '0.45rem',
    } as Partial<CSSStyleDeclaration>)
    section.appendChild(label)

    const input = document.createElement('input')
    input.type = 'text'
    input.value = this.#group
    input.placeholder = this.#t('panel.group.placeholder', 'e.g. left rail')
    input.setAttribute('aria-label', this.#t('panel.group.label', 'Tool window group'))
    Object.assign(input.style, {
      width: '100%', boxSizing: 'border-box', height: '24px', padding: '0 0.4rem',
      font: 'inherit', color: '#c8d6de', background: 'rgba(255, 255, 255, 0.04)',
      border: `1px solid rgba(${STEEL}, 0.25)`, borderRadius: '4px',
    } as Partial<CSSStyleDeclaration>)
    input.addEventListener('change', () => { this.#setGroup(normalizeGroup(input.value)) })
    input.addEventListener('keydown', (e) => { e.stopPropagation() })
    section.appendChild(input)

    const hint = document.createElement('div')
    const mates = [...live].filter(p => p !== this && p.#group !== '' && p.#group === this.#group)
    const names = mates.map(p => p.#label()).join(', ')
    hint.textContent = !this.#group
      ? this.#t('panel.group.hint', 'Windows sharing this text share their width.')
      : mates.length
        ? this.#t('panel.group.shared', `Shared with ${names}`, { panels: names })
        : this.#t('panel.group.alone', 'No other open window is in this group yet.')
    Object.assign(hint.style, { marginTop: '0.5rem', fontSize: '11px', color: '#7f95a3' } as Partial<CSSStyleDeclaration>)
    section.appendChild(hint)

    return section
  }

  /** Repaint an open popover's group section — membership lines in OTHER
   *  windows' popovers go stale the moment this one changes slot. */
  #refreshPopover(): void {
    const pop = this.#popover
    if (!pop) return
    const old = pop.querySelector('[data-hc-setting="group"]')
    if (old) pop.replaceChild(this.#groupSection(), old)
  }

  // ── group membership ───────────────────────────────────────────────
  /** Join a group (or leave, with `''`). Text that already has a shared width
   *  TAKES it; text nobody has used yet DEFINES it from this window. */
  #setGroup(next: string): void {
    if (next === this.#group) return
    this.#group = next
    writeMembership(this.id, next)

    if (next) {
      const attrs = readGroupAttrs(next)
      if (attrs.width !== undefined) this.adopt(attrs)
      else publishAttrs(this)
    }
    for (const panel of live) { panel.#renderGearState(); panel.#refreshPopover() }
  }

  /** GroupMember — take the group's shared attributes, each clamped to THIS
   *  window's own limits, so a panel that cannot go that wide sits at its limit
   *  rather than breaking layout. */
  adopt(attrs: GroupAttrs): void {
    if (attrs.width === undefined) return
    const next = this.#clamp(attrs.width)
    if (next === this.#width) return
    this.#width = next
    this.#apply()
    try { localStorage.setItem(this.#key(), String(next)) } catch { /* ignore */ }
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
    // Grouped: the other members track this drag live, so the grouping is
    // visible as you pull rather than snapping only on release.
    publishAttrs(this)
  }

  #onUp = (): void => {
    if (!this.#dragging) return
    this.#dragging = false
    this.#stopListeners()
    this.#tintLine(0)
    try { localStorage.setItem(this.#key(), String(this.#width)) } catch { /* ignore */ }
    publishAttrs(this)
  }

  #stopListeners(): void {
    window.removeEventListener('pointermove', this.#onMove)
    window.removeEventListener('pointerup', this.#onUp)
    window.removeEventListener('pointercancel', this.#onUp)
  }
}
