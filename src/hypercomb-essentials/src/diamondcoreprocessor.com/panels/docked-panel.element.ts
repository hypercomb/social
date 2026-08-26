// docked-panel.element.ts — the framework-free docked side panel.
//
// THE PHASE 2 GATE (documentation/everything-is-a-beehavior.md): the
// custom-element counterpart of shared/ui's hcDockedPanel directive, built on
// the SAME pure model in core/panels — lanes, groups, settings rows, window
// session, one-window rule. Both implementations serve panels side by side
// while the 42 Angular panels convert; because the model is shared, a group
// can span kits, the lane stacks a converted panel beside an Angular one,
// and --hc-panel-scale keeps its single decision point (this class and the
// directive both derive it through the same panel-groups records).
//
// A converted panel EXTENDS this class:
//
//   class SequenceViewerElement extends DockedPanelElement {
//     constructor() {
//       super()
//       this.panelId = 'sequence-viewer'
//       this.dockSide = 'right'
//       this.session = { park: …, unpark: … }
//     }
//     protected renderPanel(): void { … build header + body … }
//     protected closePanel(): void { … the panel's own close verb … }
//   }
//   customElements.define('hc-sequence-viewer-panel', SequenceViewerElement)
//
// and registers itself as a shell surface (`element:` shape) — no Angular,
// no shared import, loaded with its own module.
//
// What rides in the base (a transplant of the directive's mechanics):
//   • the resize grip on the inner edge, width persisted under the SAME
//     localStorage key the directive used — a converted panel keeps the
//     participant's width;
//   • --hc-panel-scale: width-derived on AUTO, pinned when a size is picked;
//   • the settings gear + popover drawn from declared rows (renderSettings),
//     with the group / text-size / reading-face / code-font zones;
//   • the edge LANE (claim/layout/release), the window SESSION (park/unpark)
//     and the ONE-WINDOW rule;
//   • dock-inset reporting (`viewport:inset`) — the separate hcDockInset
//     directive's job, folded in so a converted panel needs one base only;
//   • pairing (open-alongside), the controls-rail launcher row, and the
//     cross-implementation popover coordination (PANEL_SETTINGS_OPENED).
//
// Deliberately NOT here: a reconciler (settled in the plan doc — rebuild on
// change; snapshot focus where it must survive; the platform moves nodes),
// and the self-sizing `ownsSize:false` path — the notes strip converts late
// and its machinery stays directive-side until then.

import {
  EffectBus,
  // the group model
  type GroupAttrs, type PanelGroupMember, STEEL, TEXT_SIZES,
  CODE_FONTS, DEFAULT_CODE_FONT, codeFont,
  READ_FONTS, DEFAULT_READ_FONT, readFont,
  members, normalizeGroup, publishAttrs, readGroupAttrs, readMembership, writeMembership,
  readPairing, writePairing, readTextScale, writeTextScale,
  readCodeFont, writeCodeFont, readLigatures, writeLigatures,
  readReadFont, writeReadFont,
  // the settings editor
  type SettingRow, type SettingsView, type SettingsZone,
  focusSnapshot, installSettingsCss, renderSettings, restoreFocus,
  // the lane model
  type LaneMember, type LaneSide,
  claimLane, laneHasRoom, layoutLane, releaseLane,
  // session + policy
  holdWindow, isWindowShowing, type WindowSession,
  holdToolWindow,
  addPopoverDismisser, PANEL_SETTINGS_OPENED,
} from '@hypercomb/core'

const t = (key: string, fallback: string, params?: Record<string, unknown>): string => {
  const i18n = window.ioc?.get?.('@hypercomb.social/I18n') as
    { t(k: string, p?: Record<string, unknown>): string } | undefined
  const value = i18n?.t(key, params)
  return value && value !== key ? value : fallback
}

const HEADER_ACTION = 28
const HEADER_ACTION_GAP = 4
const GEAR_SLOT = HEADER_ACTION + HEADER_ACTION_GAP

/** Every mounted element-kit panel IN THIS BUNDLE. Cross-bundle and
 *  cross-implementation coordination NEVER rides this set — it rides the
 *  core model (`members`, the lane, `isWindowShowing`) and EffectBus
 *  (PANEL_SETTINGS_OPENED) — because each converted panel's bundle inlines
 *  its own copy of this module. This set exists only for local popover
 *  bookkeeping. */
const local = new Set<DockedPanelElement>()

let insetCounter = 0

export abstract class DockedPanelElement extends HTMLElement implements PanelGroupMember, LaneMember {

  // ── configuration (subclass sets in its constructor) ─────────────────
  protected panelId = ''
  protected dockSide: 'left' | 'right' = 'right'
  protected minWidth = 280
  protected maxWidth = 680
  protected defaultWidth = 360
  protected minScale = 0.82
  protected maxScale = 1.4
  protected defaultText: number | null = null
  protected launcherControlId = ''
  protected ownSettings: (() => SettingRow[]) | null = null
  protected pairWindow = ''
  protected pairOpenEffect = ''
  protected pairCloseEffect = ''
  protected pairLabel = ''
  protected hasReadingSurface = false
  protected session: WindowSession | null = null
  /** Report the reserved edge inset (`viewport:inset`) so the hex content
   *  squeezes beside the panel. On by default; a floating mode turns it off
   *  via setInsetActive(false). */
  protected insetActive = true

  // ── subclass contract ────────────────────────────────────────────────
  /** Build the panel's DOM (header + body) under `this`. Called on connect. */
  protected abstract renderPanel(): void
  /** The panel's own close verb — the close button and the lane's eviction
   *  fallback both route here. */
  protected abstract closePanel(): void

  // ── internals ────────────────────────────────────────────────────────
  #grip: HTMLElement | null = null
  #line: HTMLElement | null = null
  #gearBtn: HTMLElement | null = null
  #popover: HTMLElement | null = null
  #group = ''
  #text: number | null = null
  #font: string | undefined = undefined
  #readFace: string | undefined = undefined
  #ligatures = false
  #width = 0
  #startX = 0
  #startWidth = 0
  #dragging = false
  #dockExclusive = true
  #connected = false
  #claimQueued = false
  #laneOffset = 0
  #releaseSession: (() => void) | null = null
  #releaseRule: (() => void) | null = null
  #releaseDismisser: (() => void) | null = null
  #unsubs: (() => void)[] = []
  #insetOwner = ''
  #insetRo: ResizeObserver | null = null
  #insetRaf = 0
  #pairWhen: boolean | null = null

  // ── PanelGroupMember ─────────────────────────────────────────────────
  get group(): string { return this.#group }
  get memberId(): string { return this.panelId }
  memberLabel(): string { return this.#label() }
  attrs(): GroupAttrs {
    const text = this.#text ?? undefined
    const faces = {
      ...(this.#font !== undefined ? { font: this.#font } : {}),
      ...(this.#readFace !== undefined ? { read: this.#readFace } : {}),
      ligatures: this.#ligatures,
    }
    return { width: this.#width, text, ...faces }
  }

  adopt(attrs: GroupAttrs): void {
    if ('text' in attrs) {
      const text = attrs.text ?? null
      if (text !== this.#text) {
        this.#text = text
        writeTextScale(this.panelId, text)
        this.#applyScale()
        this.#refreshPopover()
      }
    }
    if ('font' in attrs || 'ligatures' in attrs || 'read' in attrs) {
      const font = ('font' in attrs) ? attrs.font : this.#font
      const read = ('read' in attrs) ? attrs.read : this.#readFace
      const ligatures = ('ligatures' in attrs) ? attrs.ligatures === true : this.#ligatures
      if (font !== this.#font || read !== this.#readFace || ligatures !== this.#ligatures) {
        this.#font = font
        this.#readFace = read
        this.#ligatures = ligatures
        writeCodeFont(this.panelId, font)
        writeReadFont(this.panelId, read)
        writeLigatures(this.panelId, ligatures)
        this.#applyFont()
        this.#refreshPopover()
      }
    }
    if (attrs.width === undefined) return
    const next = this.#clamp(attrs.width)
    if (next === this.#width) return
    this.#width = next
    this.#apply()
    this.#relayoutLane()
    try { localStorage.setItem(this.#key(), String(next)) } catch { /* ignore */ }
  }

  // ── LaneMember ───────────────────────────────────────────────────────
  get laneSide(): LaneSide { return this.dockSide }
  get laneId(): string { return this.panelId }
  laneWidth(): number { return this.#width || this.offsetWidth }
  placeInLane(offset: number): void {
    this.#laneOffset = Math.max(0, Math.round(offset))
    this.#position()
  }
  returnToLane(): void {
    try { this.session?.unpark() }
    catch (err) { console.error('[docked-panel.element] returnToLane failed:', err) }
  }
  evictFromLane(): void {
    if (!this.session) { this.closePanel(); return }
    try { this.session.park() }
    catch (err) {
      console.error('[docked-panel.element] park failed, closing instead:', err)
      this.closePanel()
    }
  }

  /** Leave / rejoin the edge lane live (a floating mode positions itself). */
  protected setDockExclusive(value: boolean): void {
    const next = value !== false
    if (next === this.#dockExclusive) return
    this.#dockExclusive = next
    if (!this.#connected) return
    if (next) this.#scheduleLaneClaim()
    else { releaseLane(this); this.#clearLanePlacement() }
  }

  /** The pairing CONDITION changed (see the directive's pairWhen input). */
  protected setPairWhen(value: boolean | null): void {
    const previous = this.#pairWhen
    this.#pairWhen = value
    if (!this.#connected) return
    if (value === true) this.#openPairIfWanted()
    else if (previous === true) this.#closePair()
  }

  /** Toggle the viewport-inset reservation (floating panels reserve nothing). */
  protected setInsetActive(value: boolean): void {
    this.insetActive = value !== false
    this.#scheduleInset()
  }

  // ── lifecycle ────────────────────────────────────────────────────────
  connectedCallback(): void {
    if (this.#connected) return
    this.#connected = true
    local.add(this)
    members.add(this)

    this.renderPanel()

    if (this.session) this.#releaseSession = holdWindow(this.panelId, this.session, () => this)
    if (this.session) this.#releaseRule = holdToolWindow(this.panelId, this.session)
    if (this.#dockExclusive) this.#scheduleLaneClaim()
    queueMicrotask(() => { if (this.#connected) this.#openPairIfWanted() })

    this.#group = readMembership(this.panelId)
    const groupAttrs = this.#group ? readGroupAttrs(this.#group) : {}
    const shared = groupAttrs.width
    const ownText = readTextScale(this.panelId)
    this.#text = ('text' in groupAttrs)
      ? (groupAttrs.text ?? null)
      : (ownText === undefined ? this.defaultText : ownText)
    this.#font = ('font' in groupAttrs) ? groupAttrs.font : readCodeFont(this.panelId)
    this.#readFace = ('read' in groupAttrs) ? groupAttrs.read : readReadFont(this.panelId)
    this.#ligatures = ('ligatures' in groupAttrs)
      ? groupAttrs.ligatures === true
      : readLigatures(this.panelId)
    this.#applyFont()

    this.#width = (shared !== undefined) ? this.#clamp(shared) : this.#restoreWidth()
    this.#apply()
    this.#installGrip()
    this.#installSettings()
    if (this.#group && shared === undefined) publishAttrs(this)

    this.#releaseDismisser = addPopoverDismisser(() => this.dismissPopover())
    this.#unsubs.push(EffectBus.on<{ owner?: string }>(PANEL_SETTINGS_OPENED, ({ owner }) => {
      if (owner !== this.panelId) this.#closePopover()
    }))

    this.#installInset()
  }

  disconnectedCallback(): void {
    if (!this.#connected) return
    this.#connected = false
    local.delete(this)
    members.delete(this)
    releaseLane(this)
    this.#releaseSession?.(); this.#releaseSession = null
    this.#releaseRule?.(); this.#releaseRule = null
    this.#releaseDismisser?.(); this.#releaseDismisser = null
    for (const u of this.#unsubs) { try { u() } catch { /* noop */ } }
    this.#unsubs = []
    this.#stopListeners()
    this.#closePopover()
    this.#grip?.removeEventListener('pointerdown', this.#onDown)
    this.#gearBtn?.removeEventListener('click', this.#onGearClick)
    this.#teardownInset()
  }

  // ── pairing ──────────────────────────────────────────────────────────
  #openPairIfWanted(): void {
    if (!this.pairWindow || !this.pairOpenEffect) return
    if (this.#pairWhen === false) return
    if (!readPairing(this.panelId)) return
    if (isWindowShowing(this.pairWindow)) return
    if (!laneHasRoom(this.dockSide)) return
    EffectBus.emit(this.pairOpenEffect, undefined)
  }

  #closePair(): void {
    if (!this.pairWindow) return
    if (!readPairing(this.panelId)) return
    if (!isWindowShowing(this.pairWindow)) return
    if (this.pairCloseEffect) EffectBus.emit(this.pairCloseEffect, undefined)
  }

  // ── lanes / geometry ─────────────────────────────────────────────────
  #scheduleLaneClaim(): void {
    if (this.#claimQueued) return
    this.#claimQueued = true
    queueMicrotask(() => {
      this.#claimQueued = false
      if (!this.#connected || !this.#dockExclusive) return
      claimLane(this)
    })
  }

  #relayoutLane(): void {
    if (this.#dockExclusive && this.#connected) layoutLane(this.dockSide)
  }

  #clearLanePlacement(): void {
    this.#laneOffset = 0
    this.style.removeProperty(this.dockSide)
    this.style.removeProperty('--hc-lane-offset')
  }

  #key(): string { return `hc:docked-width:${this.panelId}` }

  #clamp(w: number): number {
    const vpMax = Math.max(this.minWidth, window.innerWidth - 24 - this.#laneOffset)
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
    this.style.width = `${this.#width}px`
    this.#position()
    this.#applyScale()
  }

  #applyScale(): void {
    const auto = (this.#width || this.defaultWidth) / this.defaultWidth
    const scale = Math.min(this.maxScale, Math.max(this.minScale, this.#text ?? auto))
    this.style.setProperty('--hc-panel-scale', String(scale))
  }

  #applyFont(): void {
    const face = codeFont(this.#font)
    if (face) this.style.setProperty('--hc-code', face.stack)
    else this.style.removeProperty('--hc-code')
    const reading = readFont(this.#readFace)
    if (reading) this.style.setProperty('--hc-read', reading.stack)
    else this.style.removeProperty('--hc-read')
    if (this.#ligatures) this.style.setProperty('--hc-code-ligatures', 'normal')
    else this.style.removeProperty('--hc-code-ligatures')
  }

  #position(): void {
    const side = this.dockSide
    this.style[side] = `calc(var(--hc-controls-${side}, 0px) + ${this.#laneOffset}px)`
    this.style.setProperty('--hc-lane-offset', `${this.#laneOffset}px`)
  }

  // ── grip ─────────────────────────────────────────────────────────────
  #installGrip(): void {
    const inner = this.dockSide === 'right' ? 'left' : 'right'
    const grip = document.createElement('div')
    grip.setAttribute('data-hc-grip', '')
    grip.setAttribute('role', 'separator')
    grip.setAttribute('aria-orientation', 'vertical')
    Object.assign(grip.style, {
      position: 'absolute', top: '0', bottom: '0', [inner]: '0',
      // `pan-y`, NOT `none` — see the directive: a thumb-swipe must scroll,
      // and the browser's pointercancel aborts the half-started resize.
      width: '10px', cursor: 'ew-resize', zIndex: '6', touchAction: 'pan-y',
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

    this.appendChild(grip)
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
    const dx = this.dockSide === 'right' ? (this.#startX - event.clientX) : (event.clientX - this.#startX)
    this.#width = this.#clamp(this.#startWidth + dx)
    this.#apply()
    this.#relayoutLane()
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

  // ── settings gear + popover ──────────────────────────────────────────
  #installSettings(): void {
    installSettingsCss()
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('data-hc-panel-settings', '')
    btn.setAttribute('aria-haspopup', 'dialog')
    btn.setAttribute('aria-expanded', 'false')
    Object.assign(btn.style, {
      width: `${HEADER_ACTION}px`, height: `${HEADER_ACTION}px`, padding: '0',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'transparent', border: 'none', borderRadius: '2px',
      cursor: 'pointer', zIndex: '7', transition: 'color 0.12s ease, background-color 0.12s ease',
    } as Partial<CSSStyleDeclaration>)

    const glyph = document.createElement('span')
    glyph.className = 'mat-sym'
    glyph.textContent = 'settings'
    glyph.style.fontSize = '17px'
    glyph.style.pointerEvents = 'none'
    btn.appendChild(glyph)
    btn.addEventListener('click', this.#onGearClick)

    const header = this.querySelector(':scope > header, :scope > .cv2-dragbar') as HTMLElement | null
    if (header) {
      const style = getComputedStyle(header)
      if (style.position === 'static') header.style.position = 'relative'
      const pad = parseFloat(style.paddingRight) || 0
      const close = header.lastElementChild as HTMLElement | null
      let inset = pad
      if (close) {
        inset = pad + (close.offsetWidth || HEADER_ACTION) + HEADER_ACTION_GAP
        close.style.marginLeft = `${GEAR_SLOT}px`
      }
      Object.assign(btn.style, {
        position: 'absolute', right: `${inset}px`, top: '50%', transform: 'translateY(-50%)',
      } as Partial<CSSStyleDeclaration>)
      header.appendChild(btn)
    } else {
      const inner = this.dockSide === 'right' ? 'left' : 'right'
      Object.assign(btn.style, { position: 'absolute', top: '10px', [inner]: '14px' } as Partial<CSSStyleDeclaration>)
      this.appendChild(btn)
    }
    this.#gearBtn = btn
    this.#renderGearState()
  }

  #label(): string {
    const base = this.panelId.replace(/-(viewer|panel|landing|strip)$/, '').replace(/-/g, ' ')
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : this.panelId
  }

  #renderGearState(): void {
    const btn = this.#gearBtn
    if (!btn) return
    const group = this.#group
    btn.style.setProperty('--hc-gear', group ? `rgb(${STEEL})` : '#6e8290')
    btn.title = group
      ? t('panel.settings.grouped', `Window settings — ${group}`, { group })
      : t('panel.settings', 'Window settings')
  }

  #onGearClick = (event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    if (this.#popover) { this.#closePopover(); return }
    // One popover at a time — locally, and across implementations.
    for (const panel of local) panel.#closePopover()
    EffectBus.emitTransient(PANEL_SETTINGS_OPENED, { owner: this.panelId })
    this.#openPopover()
  }

  #openPopover(): void {
    const pop = document.createElement('div')
    pop.className = 'hc-settings'
    pop.setAttribute('data-hc-panel-settings-pop', '')
    pop.setAttribute('role', 'dialog')
    pop.setAttribute('aria-label', t('panel.settings', 'Window settings'))
    const panelRect = this.getBoundingClientRect()
    const gearRect = this.#gearBtn?.getBoundingClientRect()
    const anchor: Partial<CSSStyleDeclaration> = gearRect
      ? { right: `${Math.max(10, Math.round(panelRect.right - gearRect.right))}px` }
      : { [this.dockSide === 'right' ? 'left' : 'right']: '10px' } as Partial<CSSStyleDeclaration>
    Object.assign(pop.style, {
      position: 'absolute', top: '2.6rem', zIndex: '9', ...anchor,
    } as Partial<CSSStyleDeclaration>)
    pop.addEventListener('pointerdown', (e) => { e.stopPropagation() })
    pop.addEventListener('keydown', (e) => { e.stopPropagation() })
    pop.appendChild(renderSettings(this.#view()))

    this.appendChild(pop)
    this.#popover = pop
    this.#gearBtn?.setAttribute('aria-expanded', 'true')
    window.addEventListener('pointerdown', this.#onOutside, true)
    pop.tabIndex = -1
    pop.setAttribute('aria-modal', 'false')
    pop.focus()
  }

  #closePopover(): void {
    if (!this.#popover) return
    const held = this.#connected && this.#popover.contains(document.activeElement)
    this.#popover.remove()
    this.#popover = null
    this.#gearBtn?.setAttribute('aria-expanded', 'false')
    window.removeEventListener('pointerdown', this.#onOutside, true)
    if (held) this.#gearBtn?.focus()
  }

  get popoverOpen(): boolean { return !!this.#popover }

  dismissPopover(): boolean {
    if (!this.#popover) return false
    this.#closePopover()
    return true
  }

  #onOutside = (event: PointerEvent): void => {
    const target = event.target as Node | null
    if (target && (this.#popover?.contains(target) || this.#gearBtn?.contains(target))) return
    this.#closePopover()
  }

  #view(): SettingsView {
    const group = this.#group
    // Mates across BOTH implementations, via the core census — anonymous
    // members (the Angular directive, until it learns memberLabel) fall back
    // to their id when they carry one, and are skipped when they carry
    // nothing nameable.
    const names = [...members]
      .filter(m => m !== this && m.group !== '' && m.group === group)
      .map(m => m.memberLabel?.() ?? m.memberId ?? '')
      .filter(Boolean)
      .join(', ')

    const identity: SettingRow[] = [{
      kind: 'text', key: 'group',
      label: t('panel.group.label', 'Tool window group'),
      value: group,
      placeholder: t('panel.group.placeholder', 'e.g. left rail'),
      hint: !group
        ? t('panel.group.hint', 'Windows sharing this text share these settings.')
        : names
          ? t('panel.group.shared', `Shared with ${names}`, { panels: names })
          : t('panel.group.alone', 'No other open window is in this group yet.'),
      commit: (value) => { this.#setGroup(normalizeGroup(value)) },
    }]

    const shared: SettingRow[] = [{
      kind: 'choice', key: 'text',
      label: t('panel.text.label', 'Text size'),
      value: this.#text === null ? 'auto' : String(this.#text),
      options: TEXT_SIZES.map(size => ({
        value: size.scale === null ? 'auto' : String(size.scale),
        label: t(`panel.text.${size.key}`, size.label),
      })),
      hint: this.#text === null
        ? t('panel.text.hint', 'Auto sizes the text with the window\'s width.')
        : t('panel.text.hint.pinned', 'Held at this size, whatever the window\'s width.'),
      pick: (value) => { this.#setText(value === 'auto' ? null : parseFloat(value)) },
    }]

    if (this.hasReadingSurface) {
      const prose = this.#readFace ?? DEFAULT_READ_FONT
      shared.push({
        kind: 'specimen', key: 'read-font',
        label: t('panel.read-font.label', 'Reading font'),
        value: prose,
        options: READ_FONTS.map(font => ({
          value: font.key,
          label: font.key === 'system'
            ? t('panel.read-font.system', font.label)
            : font.key === 'mono' ? t('panel.read-font.mono', font.label) : font.label,
          family: font.stack,
        })),
        hint: t('panel.read-font.hint', 'Normal text — answers and notes — reads in this face.'),
        pick: (value) => { this.#setRead(value) },
      })
    }

    const face = this.#font ?? DEFAULT_CODE_FONT
    const code: SettingRow[] = [{
      kind: 'specimen', key: 'code-font',
      label: '',
      value: face,
      options: CODE_FONTS.map(font => ({
        value: font.key,
        label: font.key === 'system' ? t('panel.code-font.system', font.label) : font.label,
        family: font.stack,
      })),
      hint: t('panel.code-font.hint', 'Code blocks, paths and commands read in this face.'),
      pick: (value) => { this.#setFont(value) },
    }]
    if (codeFont(face)?.ligatures) {
      code.push({
        kind: 'switch', key: 'ligatures',
        label: t('panel.ligatures.label', 'Ligatures'),
        checked: this.#ligatures,
        hint: t('panel.ligatures.hint', 'Draws ->, => and !== as single glyphs. Off keeps every character its own.'),
        toggle: (on) => { this.#setLigatures(on) },
      })
    }

    const own: SettingRow[] = []
    if (this.pairWindow && this.pairOpenEffect) {
      const name = this.pairLabel || this.pairWindow.replace(/-(viewer|panel|strip)$/, '').replace(/-/g, ' ')
      own.push({
        kind: 'switch', key: 'pair',
        label: t('panel.pair.open-alongside', `Open ${name} alongside`, { window: name }),
        checked: readPairing(this.panelId),
        hint: t('panel.pair.hint', 'They are two halves of one gesture — a mark is dragged from one onto the other.'),
        toggle: (on) => {
          writePairing(this.panelId, on)
          if (on) this.#openPairIfWanted()
        },
      })
    }
    if (this.launcherControlId) {
      const enabled = this.#launcherEnabled()
      own.push({
        kind: 'action', key: 'launcher',
        label: enabled
          ? t('panel.launcher.remove', 'Remove from controls')
          : t('panel.launcher.add', 'Add to controls'),
        on: enabled,
        run: () => {
          EffectBus.emit('controls:configure', { id: this.launcherControlId, enabled: !this.#launcherEnabled() })
          this.#refreshPopover()
        },
      })
    }
    if (this.ownSettings) {
      try { for (const row of this.ownSettings()) own.push(this.#repainting(row)) }
      catch (err) { console.error('[docked-panel.element] ownSettings failed:', err) }
    }

    const zones: SettingsZone[] = [{ key: 'identity', rows: identity }]
    if (shared.length) {
      zones.push({
        key: 'shared',
        title: group
          ? t('panel.settings.zone.shared', `Shared by “${group}”`, { group })
          : t('panel.settings.zone.alone', 'This window only'),
        rows: shared,
      })
    }
    zones.push({ key: 'code', title: t('panel.code-font.label', 'Code font'), fold: true, rows: code })
    if (own.length) zones.push({ key: 'window', title: t('panel.settings.zone.window', 'This window'), rows: own })

    return { eyebrow: t('panel.settings.eyebrow', 'Settings'), title: this.#label(), zones }
  }

  #repainting(row: SettingRow): SettingRow {
    const after = <T>(run: (value: T) => void) => (value: T): void => { run(value); this.#refreshPopover() }
    switch (row.kind) {
      case 'choice': return { ...row, pick: after(row.pick) }
      case 'specimen': return { ...row, pick: after(row.pick) }
      case 'switch': return { ...row, toggle: after(row.toggle) }
      case 'text': return { ...row, commit: after(row.commit) }
      case 'action': return { ...row, run: () => { row.run(); this.#refreshPopover() } }
    }
  }

  #setText(next: number | null): void {
    if (next === this.#text) return
    this.#text = next
    writeTextScale(this.panelId, next)
    this.#applyScale()
    if (this.#group) publishAttrs(this)
    this.#refreshPopover()
  }

  #setFont(next: string): void {
    if (next === this.#font) return
    this.#font = next
    writeCodeFont(this.panelId, next)
    if (!codeFont(next)?.ligatures && this.#ligatures) {
      this.#ligatures = false
      writeLigatures(this.panelId, false)
    }
    this.#applyFont()
    if (this.#group) publishAttrs(this)
    this.#refreshPopover()
  }

  #setRead(next: string): void {
    if (next === this.#readFace) return
    this.#readFace = next
    writeReadFont(this.panelId, next)
    this.#applyFont()
    if (this.#group) publishAttrs(this)
    this.#refreshPopover()
  }

  #setLigatures(on: boolean): void {
    if (on === this.#ligatures) return
    this.#ligatures = on
    writeLigatures(this.panelId, on)
    this.#applyFont()
    if (this.#group) publishAttrs(this)
    this.#refreshPopover()
  }

  #launcherEnabled(): boolean {
    if (!this.launcherControlId) return false
    try {
      const map = JSON.parse(localStorage.getItem('hc:controls-enabled-map') ?? '{}') as Record<string, boolean>
      return map[this.launcherControlId] === true
    } catch { return false }
  }

  #refreshPopover(): void {
    const pop = this.#popover
    if (!pop) return
    const snap = focusSnapshot(pop)
    const body = renderSettings(this.#view())
    pop.replaceChildren(body)
    restoreFocus(body, snap)
  }

  #setGroup(next: string): void {
    if (next === this.#group) return
    this.#group = next
    writeMembership(this.panelId, next)
    if (next) {
      const attrs = readGroupAttrs(next)
      if (Object.keys(attrs).length) this.adopt(attrs)
      else publishAttrs(this)
    }
    for (const panel of local) { panel.#renderGearState(); panel.#refreshPopover() }
  }

  // ── viewport inset (the hcDockInset job, folded in) ──────────────────
  #installInset(): void {
    this.#insetOwner = `dock-el-${++insetCounter}`
    if (typeof ResizeObserver !== 'undefined') {
      this.#insetRo = new ResizeObserver(() => this.#scheduleInset())
      this.#insetRo.observe(this)
    }
    window.addEventListener('resize', this.#scheduleInset)
    this.#scheduleInset()
  }

  #teardownInset(): void {
    this.#insetRo?.disconnect()
    this.#insetRo = null
    window.removeEventListener('resize', this.#scheduleInset)
    if (this.#insetRaf) cancelAnimationFrame(this.#insetRaf)
    this.#emitInsetClear()
  }

  #scheduleInset = (): void => {
    if (this.#insetRaf) return
    this.#insetRaf = requestAnimationFrame(() => {
      this.#insetRaf = 0
      this.#emitInset()
    })
  }

  #emitInset(): void {
    if (!this.insetActive || !this.#connected) { this.#emitInsetClear(); return }
    const r = this.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) { this.#emitInsetClear(); return }
    // A FULL-BLEED sheet reserves nothing — see hcDockInset for the phone
    // story this guard carries.
    const spansX = r.left <= 1 && r.right >= window.innerWidth - 1
    if (spansX) { this.#emitInsetClear(); return }
    const size = this.dockSide === 'left'
      ? Math.max(0, r.right)
      : Math.max(0, window.innerWidth - r.left)
    EffectBus.emit('viewport:inset', { owner: this.#insetOwner, side: this.dockSide, size })
  }

  #emitInsetClear(): void {
    if (!this.#insetOwner) return
    EffectBus.emit('viewport:inset', { owner: this.#insetOwner, side: this.dockSide, size: 0 })
  }
}
