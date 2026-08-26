// The command rail's per-level entrance pins, as an embedded custom element.
// The owning entrance drone emits the drag contract; this element owns the
// participant-local pin arrangement and renders it without Angular.
import {
  EffectBus,
  GROUP_LAUNCHER_KEY,
  GROUPS_CHANGED,
  I18N_IOC_KEY,
  registerProximityProvider,
  type GroupLauncherProvider,
  type GroupMember,
  type I18nProvider,
  type LaunchGroup,
} from '@hypercomb/core'
import { PINNED_ENTRANCES_TRANSLATIONS } from './pinned-entrances.i18n.js'
import { pinnedEntrances, type PinnedEntrance } from './pinned-entrances.store.js'

const ELEMENT_NAME = 'hc-pinned-entrances'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const NAVIGATION_KEY = '@hypercomb.social/Navigation'
const VISUAL_BEE_REGISTRY_KEY = '@diamondcoreprocessor.com/VisualBeeRegistry'
const DRAG_THRESHOLD_PX = 8
const REMOVE_SLOP_PX = 24

type PinView = {
  groupId: string
  memberKey: string
  icon: string
  label: string
  member: GroupMember | null
  level: string[]
  cascaded: boolean
  groupLabel: string
  hasAggregate: boolean
  atAggregate: boolean
}
type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }
type VisualBeeRegistryLike = EventTarget & { get?: (view: string) => { cascades?: boolean } | undefined }
type HistoryLike = { sign?: (lineage: { explorerSegments?: () => readonly string[] }) => Promise<string> }
type NavigationLike = { goRaw?: (segments: readonly string[]) => void }

const iocGet = <T,>(key: string): T | undefined => window.ioc?.get?.(key) as T | undefined
const groupLauncher = (): GroupLauncherProvider | undefined => iocGet<GroupLauncherProvider>(GROUP_LAUNCHER_KEY)

const fill = (template: string, params: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (whole, token: string) => params[token] ?? whole)

const t = (key: string, fallback: string, params: Record<string, string>): string => {
  const value = iocGet<I18nProvider>(I18N_IOC_KEY)?.t(key, params)
  return value && value !== key ? value : fill(fallback, params)
}

window.ioc?.whenReady?.(I18N_IOC_KEY, value => {
  const provider = value as I18nProvider
  for (const [locale, catalog] of Object.entries(PINNED_ENTRANCES_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

const CSS = `
${ELEMENT_NAME}{display:inline-flex;align-items:center}
${ELEMENT_NAME} .pinned-entrances{display:inline-flex;align-items:center;gap:var(--hc-rail-gap,.3rem)}
${ELEMENT_NAME} .pinned-entrances::before{content:'';flex:0 0 1px;height:1.15em;margin:0 calc(var(--hc-rail-gap,.3rem)*.5);border-radius:1px;background:rgba(126,182,214,.35)}
${ELEMENT_NAME} .pin-btn{display:inline-flex;align-items:center;justify-content:center;width:var(--hc-rail-btn,1.6rem);height:var(--hc-rail-btn,1.6rem);padding:0;background:none;border:none;border-radius:50%;color:rgba(126,182,214,.42);cursor:pointer;transition:color 150ms ease,background 150ms ease,opacity 150ms ease}
${ELEMENT_NAME} .pin-btn .mat-sym{font-family:'Material Symbols Outlined';font-size:var(--hc-rail-glyph,1.05rem);line-height:1}
${ELEMENT_NAME} .pin-btn:hover{color:rgba(126,182,214,.85);background:rgba(126,182,214,.1)}
${ELEMENT_NAME} .pin-btn:active{transform:scale(.94)}
${ELEMENT_NAME} .pin-btn:focus-visible{outline:1px solid rgba(126,182,214,.6);outline-offset:2px}
${ELEMENT_NAME} .pin-btn.dragging{opacity:.55}
${ELEMENT_NAME} .pin-btn.dragging-out{opacity:.25}
${ELEMENT_NAME} .pin-btn.ctrl-armed:hover{color:var(--hc-accent,rgba(120,210,255,.95));background:rgba(120,210,255,.16)}
${ELEMENT_NAME} .pin-btn.at-aggregate{color:rgba(126,182,214,.95);background:rgba(126,182,214,.16)}
${ELEMENT_NAME} .drop-slot{display:inline-flex;width:var(--hc-rail-btn,1.6rem);height:var(--hc-rail-btn,1.6rem);border-radius:50%;border:1px dashed rgba(126,182,214,.55);background:rgba(126,182,214,.08)}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-pinned-entrances', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class PinnedEntrancesElement extends HTMLElement {
  #connected = false
  #offs: Array<() => void> = []
  #pins: PinView[] = []
  #dropArmed = false
  #swarmMode = false
  #draggingKey = ''
  #draggingOut = false
  #ctrlHeld = false
  #lineage: LineageLike | null = null
  #bees: VisualBeeRegistryLike | null = null
  #rootSigByPath = new Map<string, string>()
  #unregisterProximity: (() => void) | null = null
  #drag: { pin: PinView; startX: number; startY: number; pointerId: number; moved: boolean } | null = null
  #jump: { groupId: string; from: readonly string[]; pin: PinView; arrived: boolean } | null = null

  connectedCallback(): void {
    if (this.#connected) return
    this.#connected = true
    installCss()
    this.setAttribute('data-entrance-dropzone', '')
    this.#offs.push(
      EffectBus.on(GROUPS_CHANGED, () => this.#refresh()),
      EffectBus.on('entrance:drag-start', () => { this.#dropArmed = true; this.#render() }),
      EffectBus.on('entrance:drag-end', () => { this.#dropArmed = false; this.#render() }),
      EffectBus.on<PinnedEntrance>('entrance:pin', pin => {
        if (!pin?.groupId || !pin?.memberKey) return
        pinnedEntrances.addPin(this.#segments(), {
          groupId: pin.groupId,
          memberKey: pin.memberKey,
          icon: pin.icon ?? '',
          label: pin.label ?? '',
          view: pin.view ?? '',
          segments: Array.isArray(pin.segments) ? [...pin.segments] : [],
        })
      }),
      EffectBus.on<{ public?: boolean }>('mesh:public-changed', payload => {
        this.#swarmMode = !!payload.public
        this.#render()
      }),
      EffectBus.on('locale:changed', () => this.#render()),
    )
    pinnedEntrances.addEventListener('change', this.#onChange)
    document.addEventListener('pointermove', this.#onDocMove)
    document.addEventListener('pointerup', this.#onDocUp)
    window.addEventListener('keydown', this.#onModifierKey)
    window.addEventListener('keyup', this.#onModifierKey)
    window.addEventListener('blur', this.#onWindowBlur)
    this.#unregisterProximity = registerProximityProvider(this.#proximitySigs)
    this.#bindLateDependencies()
    this.#refresh()
  }

  disconnectedCallback(): void {
    if (!this.#connected) return
    this.#connected = false
    pinnedEntrances.removeEventListener('change', this.#onChange)
    this.#lineage?.removeEventListener('change', this.#onChange)
    this.#bees?.removeEventListener('change', this.#onChange)
    this.#lineage = null
    this.#bees = null
    this.#unregisterProximity?.()
    this.#unregisterProximity = null
    for (const off of this.#offs.splice(0)) off()
    document.removeEventListener('pointermove', this.#onDocMove)
    document.removeEventListener('pointerup', this.#onDocUp)
    window.removeEventListener('keydown', this.#onModifierKey)
    window.removeEventListener('keyup', this.#onModifierKey)
    window.removeEventListener('blur', this.#onWindowBlur)
  }

  #bindLateDependencies(): void {
    const bindLineage = (value: unknown): void => {
      if (!this.#connected || this.#lineage) return
      const lineage = value as LineageLike
      if (!lineage?.addEventListener) return
      this.#lineage = lineage
      lineage.addEventListener('change', this.#onChange)
      this.#refresh()
    }
    const bindBees = (value: unknown): void => {
      if (!this.#connected || this.#bees) return
      const bees = value as VisualBeeRegistryLike
      if (!bees?.addEventListener) return
      this.#bees = bees
      bees.addEventListener('change', this.#onChange)
      this.#refresh()
    }
    bindLineage(iocGet(LINEAGE_KEY))
    bindBees(iocGet(VISUAL_BEE_REGISTRY_KEY))
    window.ioc?.whenReady?.(LINEAGE_KEY, bindLineage)
    window.ioc?.whenReady?.(VISUAL_BEE_REGISTRY_KEY, bindBees)
  }

  #onChange = (): void => this.#refresh()
  #onModifierKey = (event: KeyboardEvent): void => {
    const next = event.ctrlKey || event.metaKey
    if (next === this.#ctrlHeld) return
    this.#ctrlHeld = next
    this.#render()
  }
  #onWindowBlur = (): void => {
    if (!this.#ctrlHeld) return
    this.#ctrlHeld = false
    this.#render()
  }

  #onPinDown(pin: PinView, event: PointerEvent): void {
    if (event.button !== 0) return
    this.#drag = { pin, startX: event.clientX, startY: event.clientY, pointerId: event.pointerId, moved: false }
  }

  #onDocMove = (event: PointerEvent): void => {
    const drag = this.#drag
    if (!drag || event.pointerId !== drag.pointerId) return
    if (!drag.moved) {
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return
      drag.moved = true
      this.#draggingKey = drag.pin.memberKey
    }
    this.#draggingOut = this.#outsideBar(event.clientX, event.clientY)
    this.#render()
  }

  #onDocUp = (event: PointerEvent): void => {
    const drag = this.#drag
    if (!drag || event.pointerId !== drag.pointerId) return
    this.#drag = null
    const wasOutside = this.#draggingOut
    this.#draggingKey = ''
    this.#draggingOut = false
    if (!drag.moved) this.#open(drag.pin, event.ctrlKey || event.metaKey)
    else if (!drag.pin.atAggregate && wasOutside) {
      pinnedEntrances.removePin(drag.pin.level, drag.pin.groupId, drag.pin.memberKey)
    } else this.#render()
  }

  #outsideBar(x: number, y: number): boolean {
    const bounds = this.getBoundingClientRect()
    return x < bounds.left - REMOVE_SLOP_PX || x > bounds.right + REMOVE_SLOP_PX
      || y < bounds.top - REMOVE_SLOP_PX || y > bounds.bottom + REMOVE_SLOP_PX
  }

  #proximitySigs = async (): Promise<string[]> => {
    if (this.#swarmMode) return []
    const history = iocGet<HistoryLike>(HISTORY_KEY)
    if (!history?.sign) return []
    const out: string[] = []
    for (const pin of this.#pins) {
      const segments = pin.member?.segments
      if (!Array.isArray(segments) || segments.length === 0) continue
      const key = segments.join(' ')
      let sig = this.#rootSigByPath.get(key)
      if (!sig) {
        sig = await history.sign({ explorerSegments: () => segments }).catch(() => '')
        if (sig) this.#rootSigByPath.set(key, sig)
      }
      if (sig) out.push(sig)
    }
    return out
  }

  #open(pin: PinView, wantAggregate: boolean): void {
    if (pin.atAggregate) { this.#returnFromAggregate(); return }
    const group = groupLauncher()?.get(pin.groupId)
    if (!group) return
    if (wantAggregate && !group.openDirectly) {
      this.#jump = { groupId: group.id, from: this.#segments(), pin, arrived: false }
      groupLauncher()?.show(group.id)
      return
    }
    const member = pin.member ?? group.members().find(candidate => candidate.key === pin.memberKey) ?? null
    if (member) group.open(member)
  }

  #returnFromAggregate(): void {
    const jump = this.#jump
    this.#jump = null
    if (!jump) return
    iocGet<NavigationLike>(NAVIGATION_KEY)?.goRaw?.(jump.from)
    this.#refresh()
  }

  #segments(): readonly string[] {
    return (this.#lineage?.explorerSegments?.() ?? [])
      .map(segment => String(segment ?? '').trim()).filter(Boolean)
  }

  #cascades(pin: PinnedEntrance): boolean {
    return !!pin.view && this.#bees?.get?.(pin.view)?.cascades === true
  }

  #memberFor(pin: PinnedEntrance): GroupMember | null {
    return groupLauncher()?.get(pin.groupId)?.members().find(member => member.key === pin.memberKey) ?? null
  }

  #refresh(): void {
    const here = this.#segments()
    const hereKey = here.join('/')
    const jump = this.#jump
    if (jump) {
      if (groupLauncher()?.currentId() === jump.groupId) jump.arrived = true
      else if (jump.arrived || hereKey !== jump.from.join('/')) this.#jump = null
    }
    const entries = pinnedEntrances.pinsForLocation(here, pin => {
      const member = this.#memberFor(pin)
      return {
        cascades: this.#cascades(pin),
        root: Array.isArray(member?.segments ?? pin.segments) ? (member?.segments ?? pin.segments ?? []) : [],
      }
    })
    const views: PinView[] = entries.map(({ level, pin }) => {
      const group: LaunchGroup | undefined = groupLauncher()?.get(pin.groupId)
      const member = this.#memberFor(pin)
      return {
        groupId: pin.groupId,
        memberKey: pin.memberKey,
        icon: member?.icon || pin.icon || group?.icon || 'flag',
        label: member?.label || pin.label || pin.memberKey,
        member,
        level,
        cascaded: level.join('/') !== hereKey,
        groupLabel: group?.label || pin.groupId,
        hasAggregate: !!group && !group.openDirectly,
        atAggregate: false,
      }
    })
    const active = this.#jump?.arrived ? this.#jump : null
    if (active) {
      const group = groupLauncher()?.get(active.groupId)
      views.unshift({
        ...active.pin,
        icon: group?.icon || active.pin.icon,
        groupLabel: group?.label || active.pin.groupLabel,
        cascaded: false,
        atAggregate: true,
      })
    }
    this.#pins = views
    this.#render()
  }

  #render(): void {
    if (this.#swarmMode || (!this.#pins.length && !this.#dropArmed)) {
      this.replaceChildren()
      return
    }
    const rail = document.createElement('div')
    rail.className = `pinned-entrances${this.#dropArmed ? ' drop-armed' : ''}`
    for (const pin of this.#pins) {
      const button = document.createElement('button')
      button.className = 'pin-btn'
      button.type = 'button'
      if (this.#draggingKey === pin.memberKey) button.classList.add('dragging')
      if (this.#draggingKey === pin.memberKey && this.#draggingOut) button.classList.add('dragging-out')
      if (pin.atAggregate) button.classList.add('at-aggregate')
      if (this.#ctrlHeld && pin.hasAggregate && !pin.atAggregate) button.classList.add('ctrl-armed')
      const returnLabel = t('pinned.return', 'Back from {group}', { group: pin.groupLabel })
      button.setAttribute('aria-label', pin.atAggregate ? returnLabel : pin.label)
      if (pin.atAggregate) button.setAttribute('aria-pressed', 'true')
      button.title = pin.atAggregate
        ? returnLabel
        : pin.hasAggregate
          ? t('pinned.aggregate-hint', '{label} — Ctrl+click: {group}', { label: pin.label, group: pin.groupLabel })
          : pin.label
      const glyph = document.createElement('span')
      glyph.className = 'mat-sym'
      glyph.textContent = pin.icon
      button.appendChild(glyph)
      button.addEventListener('pointerdown', event => this.#onPinDown(pin, event))
      button.addEventListener('pointerenter', () => {
        if (pin.hasAggregate) groupLauncher()?.prewarmGroup(pin.groupId)
      })
      rail.appendChild(button)
    }
    if (this.#dropArmed) {
      const slot = document.createElement('span')
      slot.className = 'drop-slot'
      slot.setAttribute('aria-hidden', 'true')
      rail.appendChild(slot)
    }
    this.replaceChildren(rail)
  }
}

if (typeof customElements !== 'undefined' && !customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, PinnedEntrancesElement)
}
