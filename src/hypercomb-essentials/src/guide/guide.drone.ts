// guide/guide.drone.ts
//
// /guide — the cursor is the bee. Passing over a tile names the beehaviors
// it carries and offers one idea. Staying there waggles, then drops the
// recommendations. A press hides the cursor and slides that
// tile to the middle of the screen at one common size, the bee riding it.
// Drag toward a choice. Letting go sends the choice and flies the view
// back to where the press began. When that flight lands, the real cursor
// returns and the next press belongs to the hive. Escape puts the bee down.

import { Drone, EffectBus } from '@hypercomb/core'
import { newTileConvoId } from '../assistant/chat-thread.js'
import { kindsForLabel, placesWithKind } from '../commands/decoration-kind-index.js'
import { listDecorations } from '../commands/decoration-manifest.js'
import { bindingsFor } from '../sharing/behavior-enablement.js'
import { hostZone } from '../sharing/community-hosts.js'
import { publishedDoors } from '../sharing/publish-results.js'
import {
  CHOICE_REACH,
  COMMON_HEX_RADIUS,
  choiceAt,
  hoverLine,
  payloadDetail,
  placeFromTile,
  tileSuggestions,
  type GuideAttachment,
  type GuideKin,
  type GuideTile,
} from './guide-place.js'
import { GUIDE_SURFACE, GuideOverlayElement } from './guide-overlay.view.js'

type LineageApi = { explorerSegments?: () => readonly string[] }
type Hover = { label?: string | null }
type OverlayApi = {
  actionsForTile?: (label: string) => readonly { name?: string; featureRow?: boolean; dangerRow?: boolean }[]
  labelAtClient?: (x: number, y: number) => string | null
  clientAnchorForLabel?: (label: string) => { x: number; y: number; radius: number } | null
}
type Point = { x: number; y: number }
type Xform = { scale: number; x: number; y: number }
type PixiPoint = { x: number; y: number }
type Host = {
  app?: { stage?: { scale?: { x?: number } } }
  container?: {
    scale: { x: number; set: (scale: number) => void }
    position: { x: number; y: number; set: (x: number, y: number) => void }
    parent?: { toLocal: (point: PixiPoint) => PixiPoint } | null
    toLocal: (point: PixiPoint) => PixiPoint
    toGlobal: (point: PixiPoint) => PixiPoint
  }
  canvas?: HTMLCanvasElement
  renderer?: { screen: { width: number; height: number } }
}
type Gate = { lock: (owner: string) => void; unlock: (owner: string) => void }
type Hold = {
  pointerId: number
  label: string
  options: readonly string[]
  from: Xform
  to: Xform
  started: number
  phase: 'in' | 'aim' | 'out'
  dx: number
  dy: number
  chosen: string | null
  frame: number
}
type RegistryApi = {
  byDecorationKind?: (kind: string) => { view?: string; fallbackDescription?: string } | undefined
}
type Found = { details: ReadonlyMap<string, string>; kin: readonly GuideKin[] }
type NamesApi = { displayNameFor?: (label: string) => string }

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

/** How long the tile and the bee take to reach the centre, and then to come home. */
const FLIGHT_MS = 480
const RETURN_MS = 420
const CURSOR_STYLE = 'html.hc-guide, html.hc-guide * { cursor: none !important; }'

export class GuideDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  public override description =
    'The cursor becomes a bee. Over a tile it names the beehaviors. Stay and it reads what is attached and where the same beehavior shows. Press and the tile comes to center for a choice. Letting go flies the view home and the cursor returns.'

  protected override sense = (): boolean => false
  protected override listens = ['guide:toggle', 'guide:stop', 'tile:hover']
  protected override emits = ['guide:toggle', 'guide:stop', 'chat:open', 'toast:show', 'activity:log']

  #on = false
  #overlay: GuideOverlayElement | null = null
  /** The tile under the pointer. Empty when the pointer is not on one. */
  #label = ''
  #tile: GuideTile | null = null
  #point = { x: 0, y: 0 }
  #host: Host | null = null
  #hold: Hold | null = null
  /** The rest before a recommendation, then the dance. */
  #wait = 0
  /** A programmatic close must not arm another rest. */
  #quiet = false
  /** Bumps when the tile changes, so a late lookup cannot rewrite the card. */
  #ticket = 0
  /** Attached payload text and cross-domain places for the tile under the bee. */
  #found: { label: string; value: Found } | null = null
  /** The press took the pointer, so the click that follows must not walk in. */
  #ate = false
  readonly #offs: (() => void)[] = []

  constructor() {
    super()
    this.onEffect('guide:toggle', () => { if (this.#on) this.#stop(); else this.#start() })
    this.onEffect('guide:stop', () => this.#stop())
    this.onEffect<Hover>('tile:hover', payload => this.#hover(payload?.label ?? null))
    this.onEffect<Host>('render:host-ready', payload => { this.#host = payload ?? null })
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
    const up = (event: PointerEvent): void => this.#up(event)
    const click = (event: MouseEvent): void => this.#click(event)
    const key = (event: KeyboardEvent): void => this.#key(event)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('click', click, true)
    window.addEventListener('keydown', key, true)
    this.#offs.push(
      () => window.removeEventListener('pointermove', move, true),
      () => window.removeEventListener('pointerdown', down, true),
      () => window.removeEventListener('pointerup', up, true),
      () => window.removeEventListener('pointercancel', up, true),
      () => window.removeEventListener('click', click, true),
      () => window.removeEventListener('keydown', key, true),
    )
    EffectBus.emit('toast:show', {
      type: 'info',
      title: 'Guide',
      message: 'The bee is your cursor. Over a tile it names the beehaviors. Stay and it reads what is attached and where the same beehavior shows. Press and the tile comes to center. Drag to a choice and let go. The view flies home and the cursor returns.',
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
    this.#on = false
    this.#cancelWait()
    this.#label = ''
    this.#tile = null
    if (this.#hold) {
      this.#hold.chosen = null
      this.#finish()
    }
    for (const off of this.#offs.splice(0)) off()
    this.#overlay?.disarm()
    document.documentElement.classList.remove('hc-guide')
  }

  #mount(): GuideOverlayElement {
    if (!customElements.get(GUIDE_SURFACE)) customElements.define(GUIDE_SURFACE, GuideOverlayElement)
    const existing = document.querySelector(GUIDE_SURFACE)
    const overlay = existing instanceof GuideOverlayElement ? existing : new GuideOverlayElement()
    if (!overlay.isConnected) document.body.appendChild(overlay)
    overlay.onPick = option => this.#pick(option)
    overlay.onDismiss = () => {
      if (this.#quiet || !this.#on || this.#hold || !this.#label) return
      this.#arm(this.#label)
    }
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
    if (event.key !== 'Escape' || event.repeat) return
    if (this.#hold && this.#hold.phase !== 'out') {
      event.preventDefault()
      event.stopPropagation()
      this.#hold.chosen = null
      if (this.#hold.phase === 'in') {
        const now = this.#currentXform()
        if (now) this.#hold.to = now
      }
      this.#beginOut()
      return
    }
    if (this.#overlay?.dialogOpen) {
      event.preventDefault()
      event.stopPropagation()
      this.#overlay.dismiss()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    this.#stop()
  }

  #hover(label: string | null): void {
    if (!this.#on || this.#hold) return
    const next = String(label ?? '').trim()
    // Moving onto the recommendation leaves the canvas, so the hive reports
    // no tile. The card stays while the pointer is on it.
    if (!next && this.#onCard()) return
    if (next === this.#label) return
    this.#ticket++
    this.#found = null
    this.#label = next
    this.#closeCard()
    this.#overlay?.waggle(false)
    if (!next) {
      this.#overlay?.hint('')
      return
    }
    this.#overlay?.hint(hoverLine(this.#read(next, this.#point.x, this.#point.y)))
    this.#arm(next)
  }

  /** Rest, dance, then drop the recommendations for this tile. */
  #arm(label: string): void {
    this.#cancelWait()
    this.#enrich(label)
    const dwell = this.#reduced() ? 0 : DWELL_MS
    this.#wait = window.setTimeout(() => {
      if (!this.#on || this.#hold || this.#label !== label) return
      this.#overlay?.waggle(true)
      const dance = this.#reduced() ? 0 : DANCE_MS
      this.#wait = window.setTimeout(() => this.#offer(label), dance)
    }, dwell)
  }

  #offer(label: string): void {
    this.#wait = 0
    if (!this.#on || this.#hold || this.#label !== label) return
    const tile = this.#read(label, this.#point.x, this.#point.y)
    this.#tile = tile
    this.#overlay?.waggle(false)
    const suggestions = tileSuggestions(tile)
    this.#overlay?.show({
      prompt: suggestions.prompt,
      options: suggestions.options,
      place: placeFromTile(tile),
      status: '',
      from: 'bee',
    })
  }

  #cancelWait(): void {
    if (!this.#wait) return
    window.clearTimeout(this.#wait)
    this.#wait = 0
  }

  #closeCard(): void {
    this.#cancelWait()
    if (!this.#overlay?.dialogOpen) return
    this.#quiet = true
    this.#overlay.dismiss()
    this.#quiet = false
  }

  /** The pointer is on the recommendation, which sits above the canvas. */
  #onCard(): boolean {
    const overlay = this.#overlay
    if (!overlay?.dialogOpen) return false
    const hit = document.elementFromPoint(this.#point.x, this.#point.y)
    if (!hit) return false
    if (hit === overlay) return true
    const root = overlay.shadowRoot
    return !!root && (root.contains(hit) || hit.getRootNode() === root)
  }

  #move(event: PointerEvent): void {
    if (this.#hold && event.pointerId === this.#hold.pointerId) {
      this.#drag(event)
      return
    }
    this.#point = { x: event.clientX, y: event.clientY }
    this.#overlay?.follow(event.clientX, event.clientY)
  }

  #down(event: PointerEvent): void {
    if (!this.#on || this.#hold || event.button !== 0) return
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    const canvas = this.#host?.canvas
    if (!canvas || event.target !== canvas) return
    const label = this.#tiles()?.labelAtClient?.(event.clientX, event.clientY) || this.#label
    if (!label) return
    const framed = this.#frame(label)
    if (!framed) return
    this.#closeCard()
    event.preventDefault()
    event.stopPropagation()
    this.#ate = true
    this.#point = { x: event.clientX, y: event.clientY }
    const tile = this.#read(label, event.clientX, event.clientY)
    this.#tile = tile
    const hold: Hold = {
      pointerId: event.pointerId,
      label,
      options: tileSuggestions(tile).options,
      from: framed.from,
      to: framed.to,
      started: performance.now(),
      phase: 'in',
      dx: 0,
      dy: 0,
      chosen: null,
      frame: 0,
    }
    this.#hold = hold
    this.#overlay?.hint('')
    this.#overlay?.waggle(true)
    this.#gate()?.lock('guide')
    const lock = canvas.requestPointerLock?.bind(canvas)
    if (lock && event.pointerType !== 'touch') void Promise.resolve(lock()).catch(() => undefined)
    hold.frame = requestAnimationFrame(() => this.#tick())
  }

  #drag(event: PointerEvent): void {
    const hold = this.#hold
    if (!hold) return
    event.preventDefault()
    event.stopPropagation()
    if (document.pointerLockElement) {
      hold.dx += event.movementX || 0
      hold.dy += event.movementY || 0
    } else {
      hold.dx += event.clientX - this.#point.x
      hold.dy += event.clientY - this.#point.y
      this.#point = { x: event.clientX, y: event.clientY }
    }
    if (hold.phase === 'aim') this.#placeBee()
  }

  #up(event: PointerEvent): void {
    const hold = this.#hold
    if (!hold || event.pointerId !== hold.pointerId || hold.phase === 'out') return
    event.preventDefault()
    event.stopPropagation()
    if (event.type === 'pointercancel') hold.chosen = null
    else {
      const index = choiceAt(hold.dx, hold.dy, hold.options.length)
      hold.chosen = index >= 0 ? (hold.options[index] ?? null) : null
    }
    if (hold.phase === 'in') {
      const now = this.#currentXform()
      if (now) hold.to = now
    }
    this.#beginOut()
  }

  #click(event: MouseEvent): void {
    if (!this.#ate) return
    this.#ate = false
    event.preventDefault()
    event.stopPropagation()
  }

  /** Slide the view. The bee stays on the tile until the centre, then aims. */
  #tick(): void {
    const hold = this.#hold
    if (!hold || hold.phase === 'aim') return
    const dur = this.#reduced() ? 0 : (hold.phase === 'in' ? FLIGHT_MS : RETURN_MS)
    const t = dur <= 0 ? 1 : Math.min(1, (performance.now() - hold.started) / dur)
    const ease = 1 - (1 - t) ** 3
    const start = hold.phase === 'in' ? hold.from : hold.to
    const end = hold.phase === 'in' ? hold.to : hold.from
    this.#apply({
      scale: start.scale + (end.scale - start.scale) * ease,
      x: start.x + (end.x - start.x) * ease,
      y: start.y + (end.y - start.y) * ease,
    })
    const anchor = this.#anchor(hold.label)
    if (anchor) this.#overlay?.follow(anchor.x, anchor.y)
    if (t < 1) {
      hold.frame = requestAnimationFrame(() => this.#tick())
      return
    }
    if (hold.phase === 'in') {
      hold.phase = 'aim'
      this.#overlay?.waggle(false)
      const center = this.#center()
      this.#overlay?.ringChoices(center.x, center.y, hold.options, CHOICE_REACH)
      this.#placeBee()
      return
    }
    this.#finish()
  }

  #beginOut(): void {
    const hold = this.#hold
    if (!hold || hold.phase === 'out') return
    if (hold.frame) cancelAnimationFrame(hold.frame)
    hold.phase = 'out'
    hold.started = performance.now()
    this.#overlay?.clearChoices()
    this.#overlay?.waggle(false)
    hold.frame = requestAnimationFrame(() => this.#tick())
  }

  #finish(): void {
    const hold = this.#hold
    if (!hold) return
    if (hold.frame) cancelAnimationFrame(hold.frame)
    this.#apply(hold.from)
    this.#overlay?.clearChoices()
    this.#overlay?.waggle(false)
    const anchor = this.#anchor(hold.label)
    if (anchor) this.#overlay?.follow(anchor.x, anchor.y)
    try { this.#gate()?.unlock('guide') } catch { /* the gate may already be gone */ }
    if (document.pointerLockElement) document.exitPointerLock()
    const chosen = hold.chosen
    this.#hold = null
    if (chosen) this.#pick(chosen)
    // The flight is over. The real cursor is back at the press, and a later
    // click walks, pans, and hovers the way it did before the guide.
    this.#stop()
  }

  #placeBee(): void {
    const hold = this.#hold
    if (!hold) return
    let dx = hold.dx
    let dy = hold.dy
    const distance = Math.hypot(dx, dy)
    if (distance > CHOICE_REACH) {
      dx *= CHOICE_REACH / distance
      dy *= CHOICE_REACH / distance
    }
    const center = this.#center()
    this.#overlay?.follow(center.x + dx, center.y + dy)
    this.#overlay?.aimChoice(choiceAt(hold.dx, hold.dy, hold.options.length))
  }

  /** Where the container must sit so this tile's centre is the screen's, at one size. */
  #frame(label: string): { from: Xform; to: Xform } | null {
    const container = this.#host?.container
    const canvas = this.#host?.canvas
    const renderer = this.#host?.renderer
    const anchor = this.#anchor(label)
    if (!container || !canvas || !renderer || !anchor || anchor.radius < 2) return null
    const from = { scale: container.scale.x || 1, x: container.position.x, y: container.position.y }
    const factor = COMMON_HEX_RADIUS / anchor.radius
    const next = Math.min(8, Math.max(0.15, from.scale * factor))
    if (!Number.isFinite(next) || next <= 0) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    const screen = renderer.screen
    const toGlobal = (clientX: number, clientY: number): PixiPoint => ({
      x: (clientX - rect.left) * (screen.width / rect.width),
      y: (clientY - rect.top) * (screen.height / rect.height),
    })
    try {
      const local = container.toLocal(toGlobal(anchor.x, anchor.y))
      container.scale.set(next)
      const landed = container.toGlobal(local)
      const want = toGlobal(window.innerWidth / 2, window.innerHeight / 2)
      const parent = container.parent
      if (parent?.toLocal) {
        const wanted = parent.toLocal(want)
        const got = parent.toLocal(landed)
        container.position.x += wanted.x - got.x
        container.position.y += wanted.y - got.y
      } else {
        container.position.x += want.x - landed.x
        container.position.y += want.y - landed.y
      }
      const to = { scale: container.scale.x || next, x: container.position.x, y: container.position.y }
      return { from, to }
    } catch {
      return null
    } finally {
      container.scale.set(from.scale)
      container.position.set(from.x, from.y)
    }
  }

  #apply(xform: Xform): void {
    const container = this.#host?.container
    if (!container) return
    container.scale.set(xform.scale)
    container.position.set(xform.x, xform.y)
  }

  #currentXform(): Xform | null {
    const container = this.#host?.container
    if (!container) return null
    return { scale: container.scale.x || 1, x: container.position.x, y: container.position.y }
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

  #center(): Point {
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  }

  #reduced(): boolean {
    return this.#overlay?.classList.contains('motion') !== true
  }

  #pick(option: string): void {
    const tile = this.#tile
    const chosen = option.trim()
    if (!tile || !chosen) return
    const name = tile.name || tile.label
    EffectBus.emit('chat:open', {
      convoId: this.#convo(tile.label),
      prefill: `On ${tile.route}, the tile ${name}, the participant chose this suggestion: ${chosen}.`,
    })
    this.#overlay?.status('Sent that choice to the conversation.')
    this.#tile = null
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
      if (ticket !== this.#ticket || this.#label !== label || !this.#on || this.#hold || !found) return
      this.#found = { label, value: found }
      const tile = this.#read(label, this.#point.x, this.#point.y)
      if (this.#overlay?.dialogOpen) this.#offer(label)
      else this.#overlay?.hint(hoverLine(tile))
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

  #convo(label: string): string {
    const segments = [...this.#segments(), label].filter(Boolean)
    return newTileConvoId(segments.length ? segments : ['guide'], 'guide')
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
