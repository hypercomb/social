// diamondcoreprocessor.com/presentation/tiles/help-view.drone.ts
//
// Full-viewport HELP takeover for /help.
//
// This is intentionally a small staged help file, not the old live command
// browser. New participants first learn navigation, then tile creation, then
// a short set of next steps.

import { Drone, EffectBus } from '@hypercomb/core'

const HELP_SEGMENT = 'help'
const MAX_VISIBLE = 8
const LONG_PRESS_MS = 5000
const PROGRESS_KEY = 'hypercomb.help.file.progress'

type GroupRegistryLike = EventTarget & {
  exitBag?(): void
}
type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }
type IconOverridesLike = EventTarget & { glyph(id: string, fallback: string): string }
type IconEditModeLike = EventTarget & {
  on?: boolean
  enter?(): void
  requestPick?(id: string): void
}

type HelpSection = { id: string; title: string; items: HelpItem[] }
type MountState = { host: HTMLDivElement; contentKey: string; cleanups: Array<() => void> }
type HelpItem = {
  key: string
  label: string
  kind: string
  icon?: string
  summary?: string
  synthetic?: boolean
}

const COLORS = {
  ink: '#10151f',
  panel: 'rgba(255,255,255,0.075)',
  panelStrong: 'rgba(255,255,255,0.11)',
  border: '1px solid rgba(166,219,255,0.22)',
  borderStrong: '1px solid rgba(166,219,255,0.48)',
  text: '#f4fbff',
  dim: 'rgba(244,251,255,0.72)',
  soft: 'rgba(244,251,255,0.52)',
  accent: '#8df3cf',
  warm: '#ffc86b',
  rose: '#ff8ab3',
  blue: '#8dc6ff',
}

const DEFAULT_ICONS: Record<string, string> = {
  gesture: 'near_me',
  create: 'add_circle',
  next: 'bolt',
  action: 'bolt',
}

export class HelpViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Full-viewport help file. When the participant stands on /help, teaches navigation first, then tile creation.'

  #mount: MountState | null = null
  #viewActive = false
  #registered = false
  #lineageBound = false
  #registryBound = false
  #keyBound = false
  #iconBound = false
  #effectsBound = false
  #effectUnsubs: Array<() => void> = []

  protected override deps = { lineage: '@hypercomb.social/Lineage' }
  protected override emits = ['view:active', 'icon:pick-request']

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#registered) {
      window.ioc.register('@diamondcoreprocessor.com/HelpViewDrone', this)
      this.#registered = true
    }
    this.#bindLineage()
    this.#bindRegistry()
    this.#bindIcons()
    if (!this.#keyBound) {
      window.addEventListener('keydown', this.#onKeyDown, true)
      this.#keyBound = true
    }
    this.#reconcile()
  }

  protected override dispose(): void {
    const lineage = this.resolve<LineageLike>('lineage')
    if (this.#lineageBound && lineage?.removeEventListener) lineage.removeEventListener('change', this.#onChange)
    const registry = this.#registry()
    if (this.#registryBound && registry?.removeEventListener) registry.removeEventListener('change', this.#onChange)
    const icons = this.#icons()
    if (this.#iconBound && icons?.removeEventListener) icons.removeEventListener('change', this.#onChange)
    if (this.#keyBound) window.removeEventListener('keydown', this.#onKeyDown, true)
    for (const u of this.#effectUnsubs) { try { u() } catch { /* noop */ } }
    this.#teardown()
  }

  #bindLineage(): void {
    if (this.#lineageBound) return
    const lineage = this.resolve<LineageLike>('lineage')
    if (lineage?.addEventListener) {
      lineage.addEventListener('change', this.#onChange)
      this.#lineageBound = true
    }
  }

  #bindRegistry(): void {
    if (this.#registryBound) return
    const registry = this.#registry()
    if (registry?.addEventListener) {
      registry.addEventListener('change', this.#onChange)
      this.#registryBound = true
    }
  }

  #bindIcons(): void {
    const icons = this.#icons()
    if (!this.#iconBound && icons?.addEventListener) {
      icons.addEventListener('change', this.#onChange)
      this.#iconBound = true
    }
    if (this.#effectsBound) return
    this.#effectsBound = true
    this.#effectUnsubs.push(
      EffectBus.on('icon:override-changed', () => { if (this.#mount) this.#mount.contentKey = ''; this.#reconcile() }),
      EffectBus.on('icon:edit-mode', () => { if (this.#mount) this.#mount.contentKey = ''; this.#reconcile() }),
    )
  }

  readonly #onChange = (): void => this.#reconcile()

  readonly #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.#onHelpPage()) return
    e.preventDefault()
    e.stopImmediatePropagation()
    this.#exit()
  }

  #registry(): GroupRegistryLike | undefined {
    return window.ioc?.get<GroupRegistryLike>('@hypercomb.social/GroupLauncher')
  }

  #icons(): IconOverridesLike | undefined {
    return window.ioc?.get<IconOverridesLike>('@hypercomb.social/IconOverrides')
  }

  #iconEdit(): IconEditModeLike | undefined {
    return window.ioc?.get<IconEditModeLike>('@hypercomb.social/IconEditMode')
  }

  #segments(): string[] {
    return [...(this.resolve<LineageLike>('lineage')?.explorerSegments?.() ?? [])]
  }

  #onHelpPage(): boolean {
    const segs = this.#segments()
    return segs.length === 1 && segs[0] === HELP_SEGMENT
  }

  #reconcile(): void {
    if (!this.#onHelpPage()) { this.#teardown(); return }
    const contentKey = `help-file;stage=${this.#stage()}`
    if (this.#mount?.contentKey === contentKey) return
    this.#mountHelp(contentKey)
  }

  #mountHelp(contentKey: string): void {
    this.#teardown()
    const host = document.createElement('div')
    host.id = 'hc-help-view-host'
    host.style.cssText =
      `position:fixed;inset:0;z-index:59987;overflow:auto;color:${COLORS.text};font-family:inherit;` +
      `background:` +
      `radial-gradient(circle at 14% 8%, rgba(141,243,207,0.24), transparent 28%),` +
      `radial-gradient(circle at 92% 14%, rgba(141,198,255,0.28), transparent 26%),` +
      `radial-gradient(circle at 82% 82%, rgba(255,138,179,0.20), transparent 30%),` +
      `linear-gradient(135deg, #10151f 0%, #162033 48%, #111820 100%);` +
      `background-size:110% 110%,115% 115%,120% 120%,100% 100%;animation:hc-help-drift 18s ease-in-out infinite alternate;`
    host.setAttribute('data-consumes-wheel', '')
    document.body.appendChild(host)

    const cleanups: Array<() => void> = []
    const style = document.createElement('style')
    style.textContent =
      '@keyframes hc-help-drift{0%{background-position:0% 0%,100% 0%,85% 100%,0 0}100%{background-position:8% 5%,92% 9%,76% 88%,0 0}}'
    host.appendChild(style)
    cleanups.push(() => style.remove())
    const inner = document.createElement('div')
    inner.style.cssText = 'width:min(1220px,calc(100vw - 36px));margin:0 auto;padding:44px 0 96px;box-sizing:border-box;'
    host.appendChild(inner)
    inner.appendChild(this.#header())

    const body = document.createElement('div')
    body.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:18px;align-items:start;'
    body.appendChild(this.#onboarding())

    const list = document.createElement('div')
    list.style.cssText = 'display:grid;grid-template-columns:1fr;gap:14px;'
    const shown = this.#visibleSections()
    for (const section of shown) list.appendChild(this.#section(section, cleanups))
    if (this.#stage() < 2) list.appendChild(this.#lockedMore())
    body.appendChild(list)
    inner.appendChild(body)

    this.#mount = { host, contentKey, cleanups }
    this.#setViewActive(true)
  }

  #header(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:24px;'

    const titleBlock = document.createElement('div')
    const title = document.createElement('div')
    title.style.cssText = `font-size:34px;font-weight:760;line-height:1.05;margin-bottom:8px;letter-spacing:0;color:${COLORS.text};text-shadow:0 0 28px rgba(141,198,255,0.24);`
    title.textContent = 'Help'
    const sub = document.createElement('div')
    sub.style.cssText = `font-size:14px;line-height:1.55;color:${COLORS.dim};max-width:680px;`
    sub.textContent = 'A small help file for the first visit: move around, make a tile, then learn a few next steps.'
    titleBlock.appendChild(title)
    titleBlock.appendChild(sub)

    const exit = document.createElement('button')
    exit.type = 'button'
    exit.style.cssText =
      `all:unset;cursor:pointer;flex:none;font-size:13px;color:${COLORS.dim};` +
      `padding:8px 12px;border-radius:6px;border:${COLORS.border};background:rgba(255,255,255,0.06);`
    exit.textContent = 'back'
    exit.addEventListener('click', () => this.#exit())
    exit.addEventListener('mouseenter', () => { exit.style.color = COLORS.text; exit.style.border = COLORS.borderStrong })
    exit.addEventListener('mouseleave', () => { exit.style.color = COLORS.dim; exit.style.border = COLORS.border })

    wrap.appendChild(titleBlock)
    wrap.appendChild(exit)
    return wrap
  }

  #onboarding(): HTMLElement {
    const wrap = document.createElement('section')
    wrap.style.cssText =
      `background:${COLORS.panel};border:${COLORS.borderStrong};border-radius:8px;` +
      'padding:18px;box-sizing:border-box;position:sticky;top:20px;box-shadow:0 18px 60px rgba(0,0,0,0.22);'

    const title = document.createElement('div')
    title.style.cssText = 'font-size:18px;font-weight:720;margin-bottom:8px;letter-spacing:0;'
    title.textContent = 'Start simple'
    const body = document.createElement('div')
    body.style.cssText = `font-size:14px;line-height:1.6;color:${COLORS.dim};max-width:760px;margin-bottom:14px;`
    body.textContent = 'Hypercomb mostly asks one question: do you want to go into something that already exists, or make a new tile here? This page only teaches that first.'
    wrap.appendChild(title)
    wrap.appendChild(body)

    const steps = document.createElement('div')
    steps.style.cssText = 'display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:14px;'
    steps.appendChild(this.#lessonCard({
      num: '1',
      icon: 'near_me',
      heading: 'Navigate what is already here',
      text: 'Click into tiles, pan when the canvas is larger than the screen, zoom to inspect or orient yourself, then come back.',
      active: this.#stage() === 0,
      done: this.#stage() > 0,
      action: () => this.#focusSection('learn-navigation'),
      complete: () => this.#advance(1),
    }))
    steps.appendChild(this.#lessonCard({
      num: '2',
      icon: 'add_circle',
      heading: 'Create a new tile',
      text: 'Use the command line, type a name, and press Enter. On touch screens, long-press empty space first.',
      active: this.#stage() === 1,
      done: this.#stage() > 1,
      locked: this.#stage() < 1,
      action: () => this.#focusSection('learn-creation'),
      complete: () => this.#advance(2),
    }))
    wrap.appendChild(steps)
    return wrap
  }

  #lessonCard(opts: {
    num: string
    icon: string
    heading: string
    text: string
    active?: boolean
    done?: boolean
    locked?: boolean
    action: () => void
    complete: () => void
  }): HTMLElement {
    const card = document.createElement('div')
    card.style.cssText =
      `background:${opts.active ? 'rgba(141,243,207,0.13)' : COLORS.panelStrong};` +
      `border:${opts.active ? COLORS.borderStrong : COLORS.border};border-radius:8px;` +
      `opacity:${opts.locked ? '0.58' : '1'};padding:14px;box-sizing:border-box;`
    const top = document.createElement('div')
    top.style.cssText = 'display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:center;margin-bottom:8px;'
    const badge = document.createElement('span')
    badge.className = 'mat-sym'
    badge.style.cssText =
      `width:34px;height:34px;border-radius:8px;display:inline-grid;place-items:center;` +
      `background:${opts.done ? 'rgba(141,243,207,0.24)' : 'rgba(141,198,255,0.18)'};` +
      `border:1px solid rgba(141,243,207,0.34);color:${COLORS.text};font-size:20px;`
    badge.textContent = opts.done ? 'check_circle' : opts.icon
    const h = document.createElement('div')
    h.style.cssText = 'font-size:14px;font-weight:720;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
    h.textContent = `${opts.num}. ${opts.heading}`
    const status = document.createElement('span')
    status.style.cssText = `font-size:11px;color:${opts.done ? COLORS.accent : COLORS.soft};text-transform:uppercase;letter-spacing:0;`
    status.textContent = opts.locked ? 'next' : opts.done ? 'done' : 'now'
    top.appendChild(badge)
    top.appendChild(h)
    top.appendChild(status)
    const p = document.createElement('div')
    p.style.cssText = `font-size:13px;line-height:1.5;color:${COLORS.dim};margin-bottom:12px;`
    p.textContent = opts.text
    const actions = document.createElement('div')
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;'
    const study = this.#plainButton(opts.locked ? 'Locked' : 'Study', opts.action)
    study.disabled = !!opts.locked
    if (opts.locked) study.style.opacity = '0.55'
    const complete = this.#plainButton(opts.done ? 'Review' : 'I tried this', opts.complete)
    complete.disabled = !!opts.locked
    if (opts.locked) complete.style.opacity = '0.55'
    actions.appendChild(study)
    actions.appendChild(complete)
    card.appendChild(top)
    card.appendChild(p)
    card.appendChild(actions)
    return card
  }

  #plainButton(label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.style.cssText =
      `border:${COLORS.border};border-radius:6px;background:rgba(255,255,255,0.08);` +
      `color:${COLORS.text};font:inherit;font-size:12px;font-weight:660;padding:7px 10px;cursor:pointer;`
    button.textContent = label
    button.addEventListener('click', action)
    button.addEventListener('mouseenter', () => { button.style.border = COLORS.borderStrong; button.style.background = 'rgba(255,255,255,0.15)' })
    button.addEventListener('mouseleave', () => { button.style.border = COLORS.border; button.style.background = 'rgba(255,255,255,0.08)' })
    return button
  }

  #stage(): number {
    try {
      const raw = window.localStorage?.getItem(PROGRESS_KEY)
      const n = raw ? Number(raw) : 0
      return Number.isFinite(n) ? Math.max(0, Math.min(2, Math.floor(n))) : 0
    } catch {
      return 0
    }
  }

  #advance(stage: number): void {
    const next = Math.max(this.#stage(), Math.max(0, Math.min(2, stage)))
    try { window.localStorage?.setItem(PROGRESS_KEY, String(next)) } catch { /* storage unavailable */ }
    if (this.#mount) this.#mount.contentKey = ''
    this.#reconcile()
  }

  #navigationItems(): HelpItem[] {
    return [
      {
        key: 'core.click',
        label: 'Click tiles',
        icon: 'touch_app',
        kind: 'gesture',
        summary: 'Click a tile to open it. If it has children, you move into that next layer.',
        synthetic: true,
      },
      {
        key: 'core.fit',
        label: 'Fit the view',
        icon: 'fit_screen',
        kind: 'gesture',
        summary: 'Use Fit when you feel lost or zoomed into the wrong part of the layer.',
        synthetic: true,
      },
      {
        key: 'core.back',
        label: 'Step back',
        icon: 'keyboard_return',
        kind: 'gesture',
        summary: 'Right-click the canvas, or Shift-click on a trackpad, to retrace where you came from.',
        synthetic: true,
      },
      {
        key: 'core.pan',
        label: 'Pan the canvas',
        icon: 'pan_tool',
        kind: 'gesture',
        summary: 'Hold Space and move the mouse. On touch, drag with one finger.',
        synthetic: true,
      },
      {
        key: 'core.zoom',
        label: 'Zoom in and out',
        icon: 'zoom_in',
        kind: 'gesture',
        summary: 'Use the mouse wheel or trackpad scroll over the canvas. Ctrl/Cmd + wheel gives finer zoom.',
        synthetic: true,
      },
    ]
  }

  #creationItems(): HelpItem[] {
    return [
      {
        key: 'create.open-input',
        label: 'Open the command line',
        icon: 'terminal',
        kind: 'create',
        summary: 'Click the command line at the top. On touch screens, long-press empty space.',
        synthetic: true,
      },
      {
        key: 'create.type-name',
        label: 'Type a tile name',
        icon: 'edit_note',
        kind: 'create',
        summary: 'A plain name makes a tile in the layer you are currently viewing.',
        synthetic: true,
      },
      {
        key: 'create.enter',
        label: 'Press Enter',
        icon: 'keyboard_return',
        kind: 'create',
        summary: 'The new tile appears here. Click it later to open its own layer.',
        synthetic: true,
      },
    ]
  }

  #nextItems(): HelpItem[] {
    return [
      {
        key: 'next.edit',
        label: 'Edit a tile',
        icon: 'edit',
        kind: 'next',
        summary: 'Hover a tile and use the edit action when you want to rename or adjust it.',
        synthetic: true,
      },
      {
        key: 'next.organize',
        label: 'Organize what you make',
        icon: 'content_paste',
        kind: 'next',
        summary: 'Copy, paste, remove, and undo are the everyday tools once tiles exist.',
        synthetic: true,
      },
      {
        key: 'next.behaviors',
        label: 'Add behaviors later',
        icon: 'bolt',
        kind: 'next',
        summary: 'Extra features make more sense after navigation and creation feel natural.',
        synthetic: true,
      },
    ]
  }

  #visibleSections(): HelpSection[] {
    const stage = this.#stage()
    const navigation = this.#navigationItems()
    const creation = this.#creationItems()
    if (stage === 0) return [{ id: 'learn-navigation', title: 'Navigation', items: navigation }]
    if (stage === 1) return [
      { id: 'learn-navigation', title: 'Navigation', items: navigation },
      { id: 'learn-creation', title: 'Create Tiles', items: creation },
    ]

    return [
      { id: 'learn-navigation', title: 'Navigation', items: navigation },
      { id: 'learn-creation', title: 'Create Tiles', items: creation },
      { id: 'learn-next', title: 'Next Things', items: this.#nextItems() },
    ]
  }

  #focusSection(id: string): void {
    document.getElementById('hc-help-section-' + id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  #lockedMore(): HTMLElement {
    const card = document.createElement('section')
    card.style.cssText =
      `background:rgba(255,255,255,0.045);border:${COLORS.border};border-radius:8px;` +
      'padding:16px;box-sizing:border-box;opacity:0.72;'
    const title = document.createElement('div')
    title.style.cssText = 'font-size:15px;font-weight:700;margin-bottom:6px;'
    title.textContent = 'More appears after this'
    const body = document.createElement('div')
    body.style.cssText = `font-size:13px;line-height:1.5;color:${COLORS.dim};`
    body.textContent = 'The next part of the help file appears after navigation and tile creation make sense.'
    card.appendChild(title)
    card.appendChild(body)
    return card
  }

  #section(section: HelpSection, cleanups: Array<() => void>): HTMLElement {
    const card = document.createElement('section')
    card.id = 'hc-help-section-' + section.id
    card.style.cssText =
      `background:${COLORS.panel};border:${COLORS.border};border-radius:8px;` +
      'padding:16px;box-sizing:border-box;box-shadow:0 16px 46px rgba(0,0,0,0.18);'

    const top = document.createElement('div')
    top.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px;'
    const title = document.createElement('div')
    title.style.cssText = 'font-size:16px;font-weight:680;letter-spacing:0;'
    title.textContent = section.title
    const count = document.createElement('div')
    count.style.cssText = `font-size:12px;color:${COLORS.soft};`
    count.textContent = String(section.items.length)
    top.appendChild(title)
    top.appendChild(count)
    card.appendChild(top)

    const visible = section.items.slice(0, MAX_VISIBLE)
    const hidden = section.items.slice(MAX_VISIBLE)
    card.appendChild(this.#rows(visible, cleanups))
    if (hidden.length > 0) card.appendChild(this.#more(hidden, cleanups))
    return card
  }

  #rows(items: HelpItem[], cleanups: Array<() => void>): HTMLElement {
    const rows = document.createElement('div')
    rows.style.cssText = 'display:grid;grid-template-columns:1fr;gap:8px;'
    for (const item of items) rows.appendChild(this.#row(item, cleanups))
    return rows
  }

  #more(items: HelpItem[], cleanups: Array<() => void>): HTMLElement {
    const details = document.createElement('details')
    details.style.cssText = 'margin-top:8px;'
    const summary = document.createElement('summary')
    summary.style.cssText =
      `cursor:pointer;list-style:none;color:${COLORS.accent};font-size:13px;` +
      'padding:8px 2px 2px;'
    summary.textContent = `show ${items.length} more`
    details.appendChild(summary)
    details.appendChild(this.#rows(items, cleanups))
    return details
  }

  #row(item: HelpItem, cleanups: Array<() => void>): HTMLElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.style.cssText =
      `width:100%;display:grid;grid-template-columns:36px minmax(0,1fr) auto;align-items:center;gap:12px;` +
      `padding:10px 12px;border-radius:7px;border:${COLORS.border};background:${COLORS.panelStrong};` +
      `color:${COLORS.text};font:inherit;text-align:left;cursor:pointer;box-sizing:border-box;`
    const icon = this.#iconButton(item, cleanups)
    const copy = document.createElement('span')
    copy.style.cssText = 'display:grid;grid-template-columns:1fr;gap:2px;min-width:0;'
    const label = document.createElement('span')
    label.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;'
    label.textContent = item.label
    copy.appendChild(label)
    if (item.summary) {
      const summary = document.createElement('span')
      summary.style.cssText = `min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:${COLORS.soft};`
      summary.textContent = item.summary
      copy.appendChild(summary)
    }
    const kind = document.createElement('span')
    kind.style.cssText = `font-size:11px;color:${COLORS.soft};text-transform:uppercase;letter-spacing:0;`
    kind.textContent = item.kind
    button.appendChild(icon)
    button.appendChild(copy)
    button.appendChild(kind)
    button.addEventListener('click', (e) => this.#openFromRow(item, e))
    button.addEventListener('mouseenter', () => {
      button.style.border = COLORS.borderStrong
      button.style.background = 'rgba(255,255,255,0.16)'
    })
    button.addEventListener('mouseleave', () => {
      button.style.border = COLORS.border
      button.style.background = COLORS.panelStrong
    })
    return button
  }

  #iconButton(item: HelpItem, cleanups: Array<() => void>): HTMLElement {
    return this.#commandIcon({
      id: this.#iconId(item),
      label: item.label,
      fallback: this.#defaultIcon(item),
      cleanups,
      action: (e) => this.#openFromRow(item, e),
    })
  }

  #commandIcon(args: {
    id: string
    label: string
    fallback: string
    cleanups: Array<() => void>
    action: (event: MouseEvent) => void
  }): HTMLElement {
    const icon = document.createElement('span')
    icon.className = 'mat-sym'
    icon.setAttribute('role', 'button')
    icon.setAttribute('aria-label', `Change icon for ${args.label}`)
    icon.title = 'Hold to change icon'
    icon.style.cssText =
      `width:34px;height:34px;border-radius:8px;display:inline-grid;place-items:center;` +
      `background:linear-gradient(135deg, rgba(141,243,207,0.30), rgba(141,198,255,0.16));` +
      `border:1px solid rgba(141,243,207,0.40);color:${COLORS.text};font-size:20px;` +
      `box-shadow:0 0 22px rgba(141,243,207,0.16);user-select:none;`
    icon.textContent = this.#glyph(args.id, args.fallback)

    let timer: ReturnType<typeof setTimeout> | null = null
    let consumed = false
    const clear = (): void => { if (timer) { clearTimeout(timer); timer = null } }
    const pick = (): void => {
      consumed = true
      this.#iconEdit()?.enter?.()
      const edit = this.#iconEdit()
      if (edit?.requestPick) edit.requestPick(args.id)
      else EffectBus.emit('icon:pick-request', { id: args.id })
    }
    const down = (e: PointerEvent): void => {
      clear()
      consumed = false
      timer = setTimeout(() => { timer = null; pick() }, LONG_PRESS_MS)
      e.stopPropagation()
    }
    const up = (): void => clear()
    const click = (e: MouseEvent): void => {
      e.stopPropagation()
      if (consumed || this.#iconEdit()?.on) { pick(); consumed = false; return }
      args.action(e)
    }
    icon.addEventListener('pointerdown', down)
    icon.addEventListener('pointerup', up)
    icon.addEventListener('pointerleave', up)
    icon.addEventListener('pointermove', up)
    icon.addEventListener('click', click)
    args.cleanups.push(() => {
      clear()
      icon.removeEventListener('pointerdown', down)
      icon.removeEventListener('pointerup', up)
      icon.removeEventListener('pointerleave', up)
      icon.removeEventListener('pointermove', up)
      icon.removeEventListener('click', click)
    })
    return icon
  }

  #iconId(item: HelpItem): string {
    return 'help:' + item.key
  }

  #glyph(id: string, fallback: string): string {
    return this.#icons()?.glyph?.(id, fallback) ?? fallback
  }

  #defaultIcon(item: HelpItem): string {
    const key = item.key
    if (item.icon) return item.icon
    if (key.includes('palette')) return 'palette'
    if (key.includes('copy')) return 'content_copy'
    if (key.includes('paste')) return 'content_paste'
    if (key.includes('undo')) return 'undo'
    if (key.includes('redo')) return 'redo'
    if (key.includes('history')) return 'history'
    if (key.includes('navigation')) return 'near_me'
    if (key.includes('selection')) return 'select'
    return DEFAULT_ICONS[item.kind] ?? DEFAULT_ICONS['action']
  }

  #openFromRow(_item: HelpItem, _event?: Event): void {
    // Help-file rows are explanatory, not launchers into the old help system.
  }

  #exit(): void {
    this.#registry()?.exitBag?.()
  }

  #teardown(): void {
    if (this.#mount) {
      for (const cleanup of this.#mount.cleanups) {
        try { cleanup() } catch { /* noop */ }
      }
      this.#mount.host.remove()
      this.#mount = null
    }
    if (this.#viewActive) this.#setViewActive(false)
  }

  #setViewActive(active: boolean): void {
    if (this.#viewActive === active) return
    this.#viewActive = active
    EffectBus.emit('view:active', { active })
  }
}

const _helpView = new HelpViewDrone()
window.ioc.register('@diamondcoreprocessor.com/HelpViewDrone', _helpView)
