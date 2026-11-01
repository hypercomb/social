// guide/guide.drone.ts
//
// /guide — the cursor is the bee. Passing over a tile names the beehaviors it
// carries and offers one idea. Staying there waggles, and when the dance ends
// the tile flies to the middle the way a held alt brings it, the hive falls
// back, and every idea for that tile opens round it as a tile. The real cursor
// returns: nothing here needs placing. Rollover names a tile, a click picks it,
// and the bordered board beside them turns the same ideas into a list that
// scrolls. Accept sends one agent per pick, flies the view home, and the next
// press belongs to the hive. Escape puts the bee down.

import { Drone, EffectBus } from '@hypercomb/core'
import { newTileConvoId } from '../assistant/chat-thread.js'
import { kindsForLabel, placesWithKind } from '../commands/decoration-kind-index.js'
import { listDecorations } from '../commands/decoration-manifest.js'
import { bindingsFor, isBehaviorDormant } from '../sharing/behavior-enablement.js'
import { hostZone } from '../sharing/community-hosts.js'
import { publishedDoors } from '../sharing/publish-results.js'
import { drawsAsGlyph } from '../commands/material-glyph.js'
import {
  boardBox,
  hoverLine,
  ideaTask,
  nearestPoint,
  payloadDetail,
  ringsFor,
  tileIdeas,
  tileReading,
  type GuideAttachment,
  type GuideBehavior,
  type GuideIdea,
  type GuideKin,
  type GuideTile,
} from './guide-place.js'
import { GUIDE_SURFACE, GuideOverlayElement, type GuideBoardMode } from './guide-overlay.view.js'
import { GuideStage } from './guide-stage.js'

type LineageApi = { explorerSegments?: () => readonly string[] }
type Hover = { label?: string | null }
type OverlayApi = {
  actionsForTile?: (label: string) => readonly { name?: string; featureRow?: boolean; dangerRow?: boolean }[]
  labelAtClient?: (x: number, y: number) => string | null
  axialForLabel?: (label: string) => { q: number; r: number } | null
  clientAnchorForLabel?: (label: string) => { x: number; y: number; radius: number } | null
}
type Host = { canvas?: HTMLCanvasElement }
type Gate = { lock: (owner: string) => void; unlock: (owner: string) => void }
type RegistryBee = {
  view?: string
  toggleIcon?: string
  iconName?: string
  decorationKind?: string
  behavior?: string
  fallbackDescription?: string
  offersFor?: unknown
}
type RegistryApi = {
  byDecorationKind?: (kind: string) => RegistryBee | undefined
  forPlatform?: (platform: 'mobile' | 'desktop') => readonly RegistryBee[]
}
type Found = { details: ReadonlyMap<string, string>; kin: readonly GuideKin[] }
type NamesApi = { displayNameFor?: (label: string) => string }
type Asked = { askId?: string; ok?: boolean; outcome?: string; error?: string }
/** The tile in the middle and what has been picked for it. */
type Seat = {
  readonly tile: GuideTile
  readonly ideas: readonly GuideIdea[]
  readonly chosen: Set<string>
  mode: GuideBoardMode
  landed: boolean
  leaving: boolean
}

/** How long the bee rests on a tile before it dances, and how long the dance lasts. */
const DWELL_MS = 800
const DANCE_MS = 700
/** How long a payload read or a door lookup may take before the card keeps what it has. */
const LOOKUP_MS = 1600

/** Resolve with the value, or with `fallback` when the work is still going. */
const within = <T>(work: Promise<T>, fallback: T, ms: number): Promise<T> =>
  new Promise(resolve => {
    const timer = window.setTimeout(() => resolve(fallback), ms)
    work.then(
      value => { window.clearTimeout(timer); resolve(value) },
      () => { window.clearTimeout(timer); resolve(fallback) },
    )
  })

const CURSOR_STYLE = 'html.hc-guide, html.hc-guide * { cursor: none !important; }'

export class GuideDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  public override description =
    'The cursor becomes a bee. Over a tile it names the beehaviors. Stay and it dances, the tile flies to the middle, and every idea for it opens round it. Pick the ones you want and accept, and an agent goes out for each.'

  protected override sense = (): boolean => false
  protected override listens = ['guide:toggle', 'guide:stop', 'tile:hover', 'chat:asked']
  protected override emits = ['guide:toggle', 'guide:stop', 'chat:ask', 'toast:show', 'activity:log', 'quick-menu:on-tile', 'tile:hover']

  #on = false
  #overlay: GuideOverlayElement | null = null
  /** The tile under the pointer. Empty when the pointer is not on one. */
  #label = ''
  #point = { x: 0, y: 0 }
  #canvas: HTMLCanvasElement | null = null
  #stage: GuideStage | null = null
  #seat: Seat | null = null
  /** The rest before the fly-in, then the dance. */
  #wait = 0
  /** Bumps when the tile changes, so a late lookup cannot rewrite the hint. */
  #ticket = 0
  /** Attached payload text and cross-domain places for the tile under the bee. */
  #found: { label: string; value: Found } | null = null
  /** The press took the pointer, so the click that follows must not walk in. */
  #ate = false
  /** Agents out from the board, by ask, so a failed one can be told apart from the chat's own. */
  readonly #sent = new Map<string, string>()
  readonly #offs: (() => void)[] = []

  constructor() {
    super()
    this.onEffect('guide:toggle', () => { if (this.#on) this.#stop(); else this.#start() })
    this.onEffect('guide:stop', () => this.#stop())
    this.onEffect<Hover>('tile:hover', payload => this.#hover(payload?.label ?? null))
    this.onEffect<Host>('render:host-ready', payload => { this.#canvas = payload?.canvas ?? null })
    this.onEffect<Asked>('chat:asked', result => this.#asked(result))
  }

  #start(): void {
    if (this.#on) return
    this.#on = true
    const overlay = this.#mount()
    overlay.arm()
    document.documentElement.classList.add('hc-guide')
    this.#cursorStyle()
    const move = (event: PointerEvent): void => this.#move(event)
    const down = (event: PointerEvent): void => this.#down(event)
    const click = (event: MouseEvent): void => this.#click(event)
    const key = (event: KeyboardEvent): void => this.#key(event)
    const resize = (): void => this.#resized()
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('click', click, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('resize', resize)
    this.#offs.push(
      () => window.removeEventListener('pointermove', move, true),
      () => window.removeEventListener('pointerdown', down, true),
      () => window.removeEventListener('click', click, true),
      () => window.removeEventListener('keydown', key, true),
      () => window.removeEventListener('resize', resize),
    )
    EffectBus.emit('toast:show', {
      type: 'info',
      title: 'Guide',
      message: 'The bee is your cursor. Stay on a tile and it dances, then the tile comes to the middle with every idea for it. Pick what you want and accept, and an agent goes out for each.',
    })
    EffectBus.emit('activity:log', { message: 'Guide — the bee is the cursor', icon: '🐝' })
    // The command line keeps the caret after the word runs, and a caret in
    // that line stands tile hover down. The bee is the pointer now.
    const releaseLine = (): void => {
      if (!this.#on) return
      const input = document.querySelector('input.command-input')
      if (input instanceof HTMLElement && document.activeElement === input) input.blur()
    }
    queueMicrotask(releaseLine)
    window.setTimeout(releaseLine, 0)
  }

  #stop(): void {
    if (!this.#on) return
    // The camera is away: it comes home first, and that landing stops the guide.
    if (this.#seat && !this.#seat.leaving) { this.#leave(); return }
    this.#on = false
    this.#cancelWait()
    this.#label = ''
    if (this.#seat) this.#release()
    for (const off of this.#offs.splice(0)) off()
    this.#overlay?.disarm()
    document.documentElement.classList.remove('hc-guide')
  }

  #mount(): GuideOverlayElement {
    if (!customElements.get(GUIDE_SURFACE)) customElements.define(GUIDE_SURFACE, GuideOverlayElement)
    const existing = document.querySelector(GUIDE_SURFACE)
    const overlay = existing instanceof GuideOverlayElement ? existing : new GuideOverlayElement()
    if (!overlay.isConnected) document.body.appendChild(overlay)
    overlay.onAim = (x, y) => this.#aim(x, y)
    overlay.onPress = (x, y) => this.#press(x, y)
    overlay.onToggle = id => this.#toggle(id)
    overlay.onMode = mode => this.#setMode(mode)
    overlay.onAccept = () => this.#accept()
    overlay.onClose = () => this.#leave()
    this.#overlay = overlay
    return overlay
  }

  #cursorStyle(): void {
    if (document.getElementById('hc-guide-cursor')) return
    const style = document.createElement('style')
    style.id = 'hc-guide-cursor'
    style.textContent = CURSOR_STYLE
    document.head.appendChild(style)
  }

  #key(event: KeyboardEvent): void {
    const seat = this.#seat
    if (event.repeat) return
    if (event.key === 'Enter' && seat?.landed && seat.chosen.size > 0) {
      // A focused row's own Enter picks it; only the page's Enter accepts.
      if (event.composedPath()[0] instanceof HTMLButtonElement) return
      event.preventDefault()
      event.stopPropagation()
      this.#accept()
      return
    }
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (seat) this.#leave()
    else this.#stop()
  }

  #hover(label: string | null): void {
    if (!this.#on || this.#seat) return
    const next = String(label ?? '').trim()
    if (next === this.#label) return
    this.#ticket++
    this.#found = null
    this.#label = next
    this.#cancelWait()
    this.#overlay?.waggle(false)
    if (!next) {
      this.#overlay?.hint('')
      return
    }
    this.#overlay?.hint(hoverLine(this.#read(next, this.#point.x, this.#point.y)))
    this.#arm(next)
  }

  /** Rest, dance, then bring this tile to the middle. */
  #arm(label: string): void {
    this.#cancelWait()
    this.#enrich(label)
    const dwell = this.#reduced() ? 0 : DWELL_MS
    this.#wait = window.setTimeout(() => {
      if (!this.#on || this.#seat || this.#label !== label) return
      this.#overlay?.waggle(true)
      const dance = this.#reduced() ? 0 : DANCE_MS
      this.#wait = window.setTimeout(() => this.#land(label), dance)
    }, dwell)
  }

  #cancelWait(): void {
    if (!this.#wait) return
    window.clearTimeout(this.#wait)
    this.#wait = 0
  }

  #move(event: PointerEvent): void {
    this.#point = { x: event.clientX, y: event.clientY }
    if (!this.#seat) this.#overlay?.follow(event.clientX, event.clientY)
  }

  /** A press does not wait out the dance. */
  #down(event: PointerEvent): void {
    if (!this.#on || this.#seat || event.button !== 0) return
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    if (!this.#canvas || event.target !== this.#canvas) return
    const label = this.#tiles()?.labelAtClient?.(event.clientX, event.clientY) || this.#label
    if (!label) return
    event.preventDefault()
    event.stopPropagation()
    this.#ate = true
    this.#point = { x: event.clientX, y: event.clientY }
    this.#land(label)
  }

  #click(event: MouseEvent): void {
    if (!this.#ate) return
    this.#ate = false
    event.preventDefault()
    event.stopPropagation()
  }

  // ── in the middle ─────────────────────────────────────────────────

  #land(label: string): void {
    this.#wait = 0
    const stage = this.#stage ??= new GuideStage()
    const overlay = this.#overlay
    const cell = this.#tiles()?.axialForLabel?.(label)
    if (!this.#on || this.#seat || !overlay || !cell || !stage.available) {
      overlay?.waggle(false)
      return
    }
    const tile = this.#read(label, this.#point.x, this.#point.y)
    const ideas = tileIdeas(tile, this.#offered(tile))
    const seat: Seat = { tile, ideas, chosen: new Set(), mode: 'tiles', landed: false, leaving: false }
    this.#seat = seat
    overlay.hint('')
    overlay.shield()
    overlay.waggle(true)
    this.#gate()?.lock('guide')
    // The hover icons and caption belong to the hive; the shield now holds the
    // pointer, so the last hover would otherwise stay up over the ideas.
    EffectBus.emit('quick-menu:on-tile', { active: true })
    EffectBus.emit('tile:hover', { label: null })
    stage.fly(cell, ideas.length, () => this.#ride(label), () => this.#landed(seat), this.#reduced() ? 0 : undefined)
  }

  /** The bee rides the tile in. */
  #ride(label: string): void {
    const anchor = this.#anchor(label)
    if (anchor) this.#overlay?.follow(anchor.x, anchor.y)
  }

  #landed(seat: Seat): void {
    if (this.#seat !== seat || seat.leaving) return
    seat.landed = true
    document.documentElement.classList.remove('hc-guide')
    this.#overlay?.seat()
    this.#stage?.dim(true)
    this.#paint()
  }

  #paint(): void {
    const seat = this.#seat
    const stage = this.#stage
    const overlay = this.#overlay
    if (!seat?.landed || !stage || !overlay) return
    const asTiles = seat.mode === 'tiles'
    stage.paint(seat.tile.label, asTiles ? seat.ideas.map(idea => ({
      label: idea.word,
      icon: drawsAsGlyph(idea.icon) === false ? undefined : idea.icon,
      lit: seat.chosen.has(idea.id),
    })) : [])
    const rings = asTiles ? ringsFor(seat.ideas.length) : 0
    overlay.board({
      route: seat.tile.route,
      name: seat.tile.name || seat.tile.label,
      reading: seat.tile.attached?.length || seat.tile.kin?.length ? tileReading(seat.tile) : '',
      ideas: seat.ideas,
      chosen: seat.chosen,
      mode: seat.mode,
      box: boardBox(stage.free, stage.middle, stage.extent(rings), seat.mode),
    })
  }

  /** Which idea tile is under a client point. */
  #ideaAt(x: number, y: number): { idea: GuideIdea; x: number; y: number } | null {
    const seat = this.#seat
    const stage = this.#stage
    if (!seat?.landed || !stage || seat.mode !== 'tiles') return null
    const points = stage.points(seat.ideas.length)
    const index = nearestPoint(points, x, y, stage.tileReach * 0.92)
    const idea = seat.ideas[index]
    const point = points[index]
    return idea && point ? { idea, x: point.x, y: point.y - stage.tileReach } : null
  }

  #aim(x: number, y: number): void {
    const hit = this.#ideaAt(x, y)
    this.#overlay?.label(hit?.idea.label ?? '', hit?.x ?? 0, hit?.y ?? 0)
  }

  #press(x: number, y: number): void {
    const hit = this.#ideaAt(x, y)
    this.#aim(x, y)
    if (hit) this.#toggle(hit.idea.id)
  }

  #toggle(id: string): void {
    const seat = this.#seat
    if (!seat?.landed || seat.leaving) return
    if (!seat.chosen.delete(id)) seat.chosen.add(id)
    this.#paint()
  }

  #setMode(mode: GuideBoardMode): void {
    const seat = this.#seat
    if (!seat?.landed || seat.leaving || seat.mode === mode) return
    seat.mode = mode
    this.#overlay?.label('', 0, 0)
    this.#paint()
  }

  #resized(): void {
    if (!this.#seat?.landed) return
    this.#stage?.settle()
    this.#paint()
  }

  /** One agent per pick: its own conversation on this tile, its own bee over it. */
  #accept(): void {
    const seat = this.#seat
    if (!seat?.landed || seat.leaving || seat.chosen.size === 0) return
    const picked = seat.ideas.filter(idea => seat.chosen.has(idea.id))
    const segments = [...this.#segments(), seat.tile.label].filter(Boolean)
    for (const idea of picked) {
      const askId = `guide-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      this.#sent.set(askId, idea.label)
      EffectBus.emit('chat:ask', {
        askId,
        convoId: newTileConvoId(segments),
        text: ideaTask(seat.tile, idea),
        // Accept is the go-ahead for these conversations and no others.
        trust: true,
      })
    }
    const count = picked.length
    EffectBus.emit('activity:log', { message: `Guide — ${count} agent${count === 1 ? '' : 's'} sent to ${seat.tile.name || seat.tile.label}`, icon: '🐝' })
    this.#leave()
  }

  #asked(result: Asked | undefined): void {
    const askId = String(result?.askId ?? '')
    const idea = this.#sent.get(askId)
    if (idea === undefined) return
    this.#sent.delete(askId)
    if (result?.ok || result?.outcome === 'held') return
    EffectBus.emit('toast:show', {
      type: 'warning',
      title: 'Guide',
      message: result?.error ? `${idea}: ${result.error}` : `${idea}: no model answered. Check the providers console.`,
    })
  }

  /** Fly home. When the flight lands the real cursor is the hive's again. */
  #leave(): void {
    const seat = this.#seat
    const stage = this.#stage
    if (!seat || seat.leaving) return
    seat.leaving = true
    this.#overlay?.leave()
    this.#overlay?.waggle(false)
    stage?.clear()
    document.documentElement.classList.remove('hc-guide')
    if (!stage) { this.#stop(); return }
    stage.home(() => undefined, () => this.#stop(), this.#reduced() ? 0 : undefined)
  }

  /** Hand everything the seat took back, whatever ended it. */
  #release(): void {
    this.#seat = null
    this.#stage?.clear()
    try { this.#gate()?.unlock('guide') } catch { /* the gate may already be gone */ }
    EffectBus.emit('quick-menu:on-tile', { active: false })
  }

  #anchor(label: string): { x: number; y: number; radius: number } | null {
    try { return this.#tiles()?.clientAnchorForLabel?.(label) ?? null }
    catch { return null }
  }

  #tiles(): OverlayApi | undefined {
    try { return window.ioc.get<OverlayApi>('@diamondcoreprocessor.com/TileOverlayDrone') }
    catch { return undefined }
  }

  #gate(): Gate | undefined {
    try { return window.ioc.get<Gate>('@diamondcoreprocessor.com/InputGate') }
    catch { return undefined }
  }

  #reduced(): boolean {
    return this.#overlay?.classList.contains('motion') !== true
  }

  /** The beehaviors lit in this hive that could go on this tile. A view that
   *  decides by the tile's shape answers on the tile, not here. */
  #offered(tile: GuideTile): GuideBehavior[] {
    const segments = [...this.#segments(), tile.label].filter(Boolean)
    try {
      const registry = window.ioc.get<RegistryApi>('@diamondcoreprocessor.com/VisualBeeRegistry')
      return (registry?.forPlatform?.('desktop') ?? [])
        .filter(bee => bee.view && bee.behavior !== 'navigation' && !bee.offersFor)
        .filter(bee => !bee.decorationKind || !isBehaviorDormant(bee.decorationKind, segments))
        .map(bee => ({
          word: bee.view ?? '',
          icon: bee.toggleIcon || bee.iconName || 'extension',
          about: (bee.fallbackDescription ?? '').trim(),
        }))
    } catch {
      return []
    }
  }

  #read(label: string, x: number, y: number): GuideTile {
    const surveyed = this.#survey(label)
    const found = this.#found?.label === label ? this.#found.value : null
    const attached = surveyed.attached.map(item => {
      const detail = found?.details.get(item.kind) || item.detail
      return detail === item.detail ? item : { ...item, detail }
    })
    return {
      x,
      y,
      route: this.#route(label),
      label,
      name: this.#display(label),
      behaviors: surveyed.behaviors,
      attached,
      kin: this.#mergeKin(surveyed.kin, found?.kin ?? []),
    }
  }

  /** Beehaviors on this tile, and other indexed places that carry the same ones. */
  #survey(label: string): { behaviors: string[]; attached: GuideAttachment[]; kin: GuideKin[] } {
    const behaviors = this.#behaviors(label)
    const attached: GuideAttachment[] = []
    const kin: GuideKin[] = []
    const route = this.#route(label)
    const seen = new Set<string>()
    const addKin = (item: GuideKin): void => {
      const key = `${item.domain}|${item.where}|${item.name}`
      if (seen.has(key) || kin.length >= 3 || item.where === route) return
      seen.add(key)
      kin.push(item)
    }
    for (const kind of kindsForLabel(label)) {
      if (attached.length >= 4) break
      const named = this.#named(kind)
      if (!named) continue
      const raw = named.detail.replace(/\s+/g, ' ').trim()
      attached.push({ name: named.name, kind, detail: raw.length > 80 ? '' : raw })
      for (const place of placesWithKind(kind, [route])) {
        addKin({ name: named.name, where: place.path, domain: '' })
      }
      try {
        for (const binding of bindingsFor(kind)) {
          if (!binding.path || binding.path === route) continue
          addKin({ name: named.name, where: binding.name || binding.path, domain: '' })
        }
      } catch { /* bindings are participant-local; a miss leaves the index */ }
    }
    return { behaviors, attached, kin }
  }

  #mergeKin(local: readonly GuideKin[], far: readonly GuideKin[]): GuideKin[] {
    const out: GuideKin[] = []
    const seen = new Set<string>()
    for (const item of [...far, ...local]) {
      const key = `${item.domain}|${item.where}|${item.name}`
      if (seen.has(key) || out.length >= 3) continue
      seen.add(key)
      out.push(item)
    }
    return out
  }

  /** Read the decoration payloads, then the domains where the same beehavior shows. */
  #enrich(label: string): void {
    const ticket = this.#ticket
    const segments = [...this.#segments(), label].filter(Boolean)
    void this.#gather(label, segments).then(found => {
      if (ticket !== this.#ticket || this.#label !== label || !this.#on || this.#seat || !found) return
      this.#found = { label, value: found }
      this.#overlay?.hint(hoverLine(this.#read(label, this.#point.x, this.#point.y)))
    }).catch(() => undefined)
  }

  /** The spoken beehavior for a decoration kind. A raw kind, a tag record, and a retired view stay unnamed. */
  #named(kind: string): { name: string; detail: string } | null {
    if (!kind || kind === 'tag') return null
    try {
      const registry = window.ioc.get<RegistryApi>('@diamondcoreprocessor.com/VisualBeeRegistry')
      const bee = registry?.byDecorationKind?.(kind)
      const name = (bee?.view ?? '').trim().toLowerCase().replace(/-/g, ' ')
      if (!name) return null
      return { name, detail: (bee?.fallbackDescription ?? '').trim() }
    } catch {
      return null
    }
  }

  /** One short string from this cell's decoration of `kind`. */
  async #payload(kind: string, segments: readonly string[]): Promise<string> {
    try {
      const rows = await listDecorations<Record<string, unknown>>({ kind, segments: [...segments] })
      return rows.map(row => payloadDetail(row.record?.payload)).find(Boolean) ?? ''
    } catch {
      return ''
    }
  }

  async #gather(label: string, segments: readonly string[]): Promise<Found | null> {
    const kinds = kindsForLabel(label).filter(kind => this.#named(kind)).slice(0, 4)
    const here = hostZone(window.location.host)
    const words = new Set<string>([label.trim().toLowerCase()])
    for (const kind of kinds) {
      const named = this.#named(kind)
      if (named) words.add(named.name)
    }
    const reads = Promise.all(kinds.map(kind => within(this.#payload(kind, segments), '', LOOKUP_MS)))
    const doors = within(publishedDoors().catch(() => []), [] as Awaited<ReturnType<typeof publishedDoors>>, LOOKUP_MS)
    const [foundDetails, published] = await Promise.all([reads, doors])
    const details = new Map<string, string>()
    kinds.forEach((kind, index) => {
      const detail = foundDetails[index]
      if (detail) details.set(kind, detail)
    })
    const kin: GuideKin[] = []
    for (const door of published) {
      const zone = hostZone(door.zone)
      if (!zone || zone === here || kin.length >= 3) continue
      const named = door.name.trim().toLowerCase()
      if (!words.has(named) && !door.segments.some(segment => words.has(segment.trim().toLowerCase()))) continue
      kin.push({ name: named || label, where: door.name, domain: zone })
    }
    if (details.size === 0 && kin.length === 0) return null
    return { details, kin }
  }

  #display(label: string): string {
    try {
      const names = window.ioc.get<NamesApi>('@diamondcoreprocessor.com/ShowCellDrone')
      const shown = names?.displayNameFor?.(label)
      return shown?.trim() || label
    } catch {
      return label
    }
  }

  /** Beehaviors this tile carries: a visual bee's view, then a feature icon. */
  #behaviors(label: string): string[] {
    const found: string[] = []
    const add = (word: string): void => {
      const clean = word.trim().toLowerCase().replace(/-/g, ' ')
      if (!clean || found.length >= 4) return
      if (found.some(held => held === clean)) return
      found.push(clean)
    }
    try {
      const registry = window.ioc.get<RegistryApi>('@diamondcoreprocessor.com/VisualBeeRegistry')
      for (const kind of kindsForLabel(label)) add(registry?.byDecorationKind?.(kind)?.view ?? '')
    } catch { /* the index can be unread; the icons still name what shows */ }
    try {
      const overlay = window.ioc.get<OverlayApi>('@diamondcoreprocessor.com/TileOverlayDrone')
      for (const action of overlay?.actionsForTile?.(label) ?? []) {
        if (!action.featureRow || action.dangerRow) continue
        add(action.name ?? '')
      }
    } catch { /* no band yet */ }
    return found
  }

  #route(label: string): string {
    const segments = [...this.#segments(), label].filter(Boolean)
    return segments.length ? `/${segments.join('/')}` : '/'
  }

  #segments(): string[] {
    try {
      const lineage = window.ioc.get<LineageApi>('@hypercomb.social/Lineage')
      return (lineage?.explorerSegments?.() ?? []).map(segment => String(segment).trim()).filter(Boolean)
    } catch {
      return []
    }
  }
}

const _guide = new GuideDrone()
window.ioc.register('@diamondcoreprocessor.com/GuideDrone', _guide)
