// diamondcoreprocessor.com/presentation/tiles/help-view.drone.ts
//
// Full-viewport HELP takeover for the /help launcher page. The launch group
// still owns discovery and action-card activation; this renderer only presents
// the same live members as a readable hierarchy instead of a hexagon field.

import { Drone, EffectBus } from '@hypercomb/core'

const HELP_SEGMENT = 'help'
const MAX_VISIBLE = 5

type GroupMemberLike = {
  key: string
  label: string
  segments?: string[]
  role?: 'header' | 'action'
  group?: string
}
type LaunchGroupLike = { members(): GroupMemberLike[] }
type GroupRegistryLike = EventTarget & {
  get(id: string): LaunchGroupLike | undefined
  show?(id: string): void
  currentId?(): string | null
  exitBag?(): void
}
type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }

type HelpItem = GroupMemberLike & { kind: string }
type HelpSection = { id: string; title: string; items: HelpItem[] }
type MountState = { host: HTMLDivElement; contentKey: string }
type GuideAction = { label: string; text: string; action: () => void }

const COLORS = {
  ink: '#111820',
  panel: 'rgba(255,255,255,0.055)',
  panelStrong: 'rgba(255,255,255,0.085)',
  border: '1px solid rgba(188,209,220,0.18)',
  borderStrong: '1px solid rgba(188,209,220,0.34)',
  text: '#edf4f7',
  dim: 'rgba(237,244,247,0.68)',
  soft: 'rgba(237,244,247,0.48)',
  accent: '#a9d6c4',
}

export class HelpViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Full-viewport help takeover. When the participant stands on /help, renders the live help launch group as a hierarchical list.'

  #mount: MountState | null = null
  #viewActive = false
  #registered = false
  #lineageBound = false
  #registryBound = false
  #keyBound = false

  protected override deps = { lineage: '@hypercomb.social/Lineage' }
  protected override emits = ['view:active', 'group:open']

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#registered) {
      window.ioc.register('@diamondcoreprocessor.com/HelpViewDrone', this)
      this.#registered = true
    }
    this.#bindLineage()
    this.#bindRegistry()
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
    if (this.#keyBound) window.removeEventListener('keydown', this.#onKeyDown, true)
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

  #segments(): string[] {
    return [...(this.resolve<LineageLike>('lineage')?.explorerSegments?.() ?? [])]
  }

  #onHelpPage(): boolean {
    const segs = this.#segments()
    return segs.length === 1 && segs[0] === HELP_SEGMENT
  }

  #reconcile(): void {
    if (!this.#onHelpPage()) { this.#teardown(); return }
    const group = this.#registry()?.get(HELP_SEGMENT)
    if (!group) { this.#teardown(); return }
    const sections = this.#sections(group.members())
    const contentKey = sections
      .map(s => `${s.title}:${s.items.map(i => i.key + '=' + i.label).join(',')}`)
      .join('|')
    if (this.#mount?.contentKey === contentKey) return
    this.#mountHelp(sections, contentKey)
  }

  #sections(members: GroupMemberLike[]): HelpSection[] {
    const byId = new Map<string, HelpSection>()
    const order: HelpSection[] = []
    const ensure = (id: string, title: string): HelpSection => {
      let section = byId.get(id)
      if (!section) {
        section = { id, title, items: [] }
        byId.set(id, section)
        order.push(section)
      } else if (section.title === 'More' && title !== 'More') {
        section.title = title
      }
      return section
    }

    for (const m of members) {
      const id = m.group || 'ungrouped'
      if (m.role === 'header') {
        ensure(id, m.label)
        continue
      }
      const title = m.key === 'ui.shortcutSheet' ? 'Start here' : 'More'
      ensure(id, title).items.push({ ...m, kind: this.#kind(m) })
    }
    return order.filter(s => s.items.length > 0)
  }

  #kind(m: GroupMemberLike): string {
    if (m.key === 'ui.shortcutSheet') return 'guide'
    if (m.key.startsWith('slash:')) return 'slash'
    if (m.key.startsWith('cli:')) return 'input'
    return 'action'
  }

  #mountHelp(sections: HelpSection[], contentKey: string): void {
    this.#teardown()
    const host = document.createElement('div')
    host.id = 'hc-help-view-host'
    host.style.cssText =
      `position:fixed;inset:0;z-index:59987;overflow:auto;background:${COLORS.ink};` +
      `color:${COLORS.text};font-family:inherit;`
    host.setAttribute('data-consumes-wheel', '')
    document.body.appendChild(host)

    const inner = document.createElement('div')
    inner.style.cssText = 'width:min(1080px,calc(100vw - 40px));margin:0 auto;padding:44px 0 96px;box-sizing:border-box;'
    host.appendChild(inner)
    inner.appendChild(this.#header())
    inner.appendChild(this.#onboarding())

    const list = document.createElement('div')
    list.style.cssText = 'display:grid;grid-template-columns:1fr;gap:14px;'
    for (const section of sections) list.appendChild(this.#section(section))
    inner.appendChild(list)

    this.#mount = { host, contentKey }
    this.#setViewActive(true)
  }

  #header(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:24px;'

    const titleBlock = document.createElement('div')
    const title = document.createElement('div')
    title.style.cssText = 'font-size:30px;font-weight:720;line-height:1.1;margin-bottom:8px;letter-spacing:0;'
    title.textContent = 'Help'
    const sub = document.createElement('div')
    sub.style.cssText = `font-size:14px;line-height:1.55;color:${COLORS.dim};max-width:680px;`
    sub.textContent = 'A shortlist of things to try first, with the rest tucked into sections when you want more.'
    titleBlock.appendChild(title)
    titleBlock.appendChild(sub)

    const exit = document.createElement('button')
    exit.type = 'button'
    exit.style.cssText =
      `all:unset;cursor:pointer;flex:none;font-size:13px;color:${COLORS.dim};` +
      `padding:8px 12px;border-radius:6px;border:${COLORS.border};`
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
      'padding:18px;box-sizing:border-box;margin-bottom:16px;'

    const title = document.createElement('div')
    title.style.cssText = 'font-size:18px;font-weight:720;margin-bottom:8px;letter-spacing:0;'
    title.textContent = 'Start here'
    const body = document.createElement('div')
    body.style.cssText = `font-size:14px;line-height:1.6;color:${COLORS.dim};max-width:760px;margin-bottom:14px;`
    body.textContent = 'Hypercomb is a place made of tiles. Open a tile to go deeper, add behaviors when you want a tile to do something, and use websites or games as simple first things to explore.'
    wrap.appendChild(title)
    wrap.appendChild(body)

    const steps = document.createElement('div')
    steps.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:14px;'
    const cards = [
      ['1', 'Open a tile', 'Click once to choose something, then open it when you want to go inside.'],
      ['2', 'Try a behavior', 'Behaviors are features a tile can wear, like a website, home page, presentation, or game.'],
      ['3', 'Keep it small', 'Use the shortlist first. Open more only when you are ready for the full set.'],
    ]
    for (const [num, heading, text] of cards) steps.appendChild(this.#guideCard(num, heading, text))
    wrap.appendChild(steps)

    const actions = document.createElement('div')
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;'
    const guides: GuideAction[] = [
      { label: 'How to use', text: 'Open the reference sheet', action: () => this.#open('Reference') },
      { label: 'Websites', text: 'Browse saved websites', action: () => this.#showGroup('websites') },
      { label: 'Games', text: 'Try something playful', action: () => this.#showGroup('games') },
    ]
    for (const guide of guides) actions.appendChild(this.#guideButton(guide))
    wrap.appendChild(actions)
    return wrap
  }

  #guideCard(num: string, heading: string, text: string): HTMLElement {
    const card = document.createElement('div')
    card.style.cssText =
      `background:${COLORS.panelStrong};border:${COLORS.border};border-radius:6px;` +
      'padding:13px;box-sizing:border-box;min-height:104px;'
    const badge = document.createElement('div')
    badge.style.cssText = `font-size:12px;color:${COLORS.accent};font-weight:700;margin-bottom:8px;`
    badge.textContent = num
    const h = document.createElement('div')
    h.style.cssText = 'font-size:14px;font-weight:680;margin-bottom:5px;'
    h.textContent = heading
    const p = document.createElement('div')
    p.style.cssText = `font-size:13px;line-height:1.45;color:${COLORS.dim};`
    p.textContent = text
    card.appendChild(badge)
    card.appendChild(h)
    card.appendChild(p)
    return card
  }

  #guideButton(guide: GuideAction): HTMLElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.style.cssText =
      `display:grid;grid-template-columns:1fr;gap:2px;min-width:170px;padding:10px 12px;` +
      `border-radius:6px;border:${COLORS.border};background:${COLORS.panelStrong};` +
      `color:${COLORS.text};font:inherit;text-align:left;cursor:pointer;box-sizing:border-box;`
    const label = document.createElement('span')
    label.style.cssText = 'font-size:13px;font-weight:680;'
    label.textContent = guide.label
    const text = document.createElement('span')
    text.style.cssText = `font-size:12px;color:${COLORS.soft};`
    text.textContent = guide.text
    button.appendChild(label)
    button.appendChild(text)
    button.addEventListener('click', guide.action)
    button.addEventListener('mouseenter', () => { button.style.border = COLORS.borderStrong })
    button.addEventListener('mouseleave', () => { button.style.border = COLORS.border })
    return button
  }

  #section(section: HelpSection): HTMLElement {
    const card = document.createElement('section')
    card.style.cssText =
      `background:${COLORS.panel};border:${COLORS.border};border-radius:8px;` +
      'padding:16px;box-sizing:border-box;'

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
    card.appendChild(this.#rows(visible))
    if (hidden.length > 0) card.appendChild(this.#more(hidden))
    return card
  }

  #rows(items: HelpItem[]): HTMLElement {
    const rows = document.createElement('div')
    rows.style.cssText = 'display:grid;grid-template-columns:1fr;gap:8px;'
    for (const item of items) rows.appendChild(this.#row(item))
    return rows
  }

  #more(items: HelpItem[]): HTMLElement {
    const details = document.createElement('details')
    details.style.cssText = 'margin-top:8px;'
    const summary = document.createElement('summary')
    summary.style.cssText =
      `cursor:pointer;list-style:none;color:${COLORS.accent};font-size:13px;` +
      'padding:8px 2px 2px;'
    summary.textContent = `show ${items.length} more`
    details.appendChild(summary)
    details.appendChild(this.#rows(items))
    return details
  }

  #row(item: HelpItem): HTMLElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.style.cssText =
      `width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;` +
      `padding:11px 12px;border-radius:6px;border:${COLORS.border};background:${COLORS.panelStrong};` +
      `color:${COLORS.text};font:inherit;text-align:left;cursor:pointer;box-sizing:border-box;`
    const label = document.createElement('span')
    label.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;'
    label.textContent = item.label
    const kind = document.createElement('span')
    kind.style.cssText = `font-size:11px;color:${COLORS.soft};text-transform:uppercase;letter-spacing:0;`
    kind.textContent = item.kind
    button.appendChild(label)
    button.appendChild(kind)
    button.addEventListener('click', () => this.#open(item.label))
    button.addEventListener('mouseenter', () => { button.style.border = COLORS.borderStrong })
    button.addEventListener('mouseleave', () => { button.style.border = COLORS.border })
    return button
  }

  #open(label: string): void {
    EffectBus.emit('group:open', { label })
  }

  #showGroup(id: string): void {
    if (!this.#registry()?.get(id)) return
    window.setTimeout(() => this.#registry()?.show?.(id), 0)
  }

  #exit(): void {
    this.#registry()?.exitBag?.()
  }

  #teardown(): void {
    if (this.#mount) {
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
