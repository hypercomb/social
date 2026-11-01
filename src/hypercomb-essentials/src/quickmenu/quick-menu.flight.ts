// quickmenu/quick-menu.flight.ts
//
// Hold alt over a tile and the tile comes to you.
//
// The camera flies — pan and zoom together — until the tile sits in the middle
// of the screen at the menu's own size, there is room all round it for the
// flower, and the options bloom as ordinary tiles in the neighbouring cells. The
// camera is then set in stone. The real cursor is put away and a faux one aims.
// Rolling onto a pathway moves the tile into that cell and a new flower opens
// round it, rolling onto the way back un-does it, and a leaf waits for Enter, a
// click or the release of alt. When it ends, the camera flies back to the exact
// pan and zoom it left.
//
// Nothing here is persisted: the camera is moved directly on the render
// container, never through ViewportPersistence, so the page's saved pan and
// zoom are the same after a flight as before it.

import { EffectBus } from '@hypercomb/core'
import { visibleArea, type SafeArea } from '../navigation/zoom/safe-area.js'
import { viewportIsFramed } from '../sequence/frame-lock.js'
import type { QuickMenuLayer } from './quick-menu.layer.js'
import type { QuickMenuRegistry } from './quick-menu-registry.service.js'
import { fireQuickMenuSlot } from './quick-menu.fire.js'
import { NO_SEATS, applyTileSeats, readTileSeats, seatMenu, type TileSeats } from './quick-menu.traits.js'
import {
  OPPOSITE_DIRECTION,
  slotsByDirection,
  type QuickMenuDefinition,
  type QuickMenuDirection,
  type QuickMenuSlot,
} from './quick-menu.types.js'

const get = <T,>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

/** Fly in / out of the centre. */
const FLY_MS = 240
/** Rest on a hold leaf this long and it fires. */
const HOLD_FIRE_MS = 600
/** On-screen circumradius of the context tile (and so every option), in px. */
const TILE_RADIUS_PX = 72

/** Pathways the flower may walk outward from the tile, and still fit. */
const STEPS_OUT = 2
/** Space kept clear between the flower and the screen edge, in px. */
const EDGE_MARGIN = 24

type Pt = { x: number; y: number }

type Host = {
  app: { stage: { position: Pt & { set(x: number, y: number): void }; scale: { x: number } } }
  container: { position: Pt & { set(x: number, y: number): void }; scale: { x: number; set(s: number): void } }
  canvas: HTMLCanvasElement
  renderer: { screen: { width: number; height: number } }
}

type Camera = { scale: number; x: number; y: number }

type Level = {
  readonly definition: QuickMenuDefinition
  readonly back: QuickMenuDirection | null
  /** Where this ring is centred, in the render container's space. */
  readonly at: Pt
}

const ease = (t: number): number => 1 - Math.pow(1 - t, 3)

export class QuickMenuFlight {
  #layer: QuickMenuLayer
  #host: Host | null = null
  #levels: Level[] = []
  #active = false
  /** Pan and zoom to return to. Held until the flight home has landed, so a
   *  summon mid-return still goes home to where the participant had it. */
  #home: Camera | null = null
  #anim = 0
  /** The flower answers the cursor only once the camera has settled. */
  #ready = false
  #lit: QuickMenuDirection | null = null
  #virtual: Pt = { x: 0, y: 0 }
  #last: Pt | null = null
  #locked = false
  #cursor: HTMLElement | null = null
  /** The tile the flower was raised over; verbs that act on a tile get it. */
  #subject: string | null = null
  /** What this tile has made of its seats. Empty until the read lands. */
  #seats: TileSeats = NO_SEATS
  /** Which flight the seats being read belong to. */
  #seatRead = 0
  #holdTimer: ReturnType<typeof setTimeout> | null = null

  /** Called once a flight has ended, however it ended. */
  onEnd: (() => void) | null = null

  constructor(layer: QuickMenuLayer) {
    this.#layer = layer
    EffectBus.on<Partial<Host>>('render:host-ready', (payload) => {
      if (!payload?.app || !payload.container || !payload.canvas || !payload.renderer) return
      this.#host = payload as Host
    })
    document.addEventListener('pointerlockchange', this.#onLockChange)
  }

  get active(): boolean {
    return this.#active
  }

  /** Whether a flight can run here — a hive canvas, not a framed page. */
  get available(): boolean {
    return !!this.#host && !viewportIsFramed()
  }

  // ── begin / end ─────────────────────────────────────────────────────

  begin(anchor: { q: number; r: number }, definition: QuickMenuDefinition, subject?: string): boolean {
    const host = this.#host
    const registry = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')
    if (!host || !registry || this.#active || viewportIsFramed()) return false

    this.#home ??= {
      scale: host.container.scale.x,
      x: host.container.position.x,
      y: host.container.position.y,
    }
    this.#active = true
    this.#subject = subject ?? null
    this.#ready = false
    this.#lit = null
    this.#last = null

    // Nothing is laid over the tile until it lands; the real tile flies in itself.
    this.#layer.setSubject(subject ?? '')
    this.#layer.place(anchor.q, anchor.r)
    this.#layer.show(definition, registry.label, null, '')
    const at = this.#layer.centreLocal()
    if (!at) { this.#active = false; return false }
    this.#levels = [{ definition, back: null, at }]
    this.#readSeats(definition, subject)

    this.#virtual = this.#screenCentreClient()
    this.#showCursor()
    document.documentElement.classList.add('hc-quick-menu-active')
    this.#requestLock()

    this.#flyTo(at, this.#menuScale(), FLY_MS, () => {
      // Centred: the camera and every tile are frozen from here to the end, and
      // the rest of the hive goes half transparent.
      this.#layer.bloom()
      this.#layer.dim(true)
      this.#ready = true
    })
    return true
  }

  /** Finish. `fire` runs the leaf that is lit, except a click leaf, which only
   *  `confirmed` runs; either way the camera goes home. */
  end(fire: boolean, confirmed = false): void {
    if (!this.#active) return
    const leaf = fire && this.#ready ? this.#leaf(this.#lit) : undefined
    const slot = leaf?.activation === 'click' && !confirmed ? undefined : leaf
    this.#clearHold()
    this.#seatRead++
    this.#seats = NO_SEATS
    this.#active = false
    this.#ready = false
    this.#lit = null
    this.#levels = []
    this.#layer.hide()
    this.#hideCursor()
    document.documentElement.classList.remove('hc-quick-menu-active')
    if (document.pointerLockElement) {
      try { document.exitPointerLock?.() } catch { /* already gone */ }
    }
    this.#locked = false

    const host = this.#host
    const home = this.#home
    if (host && home) {
      this.#tween({ scale: home.scale, x: home.x, y: home.y }, FLY_MS, () => { this.#home = null })
    } else {
      this.#home = null
    }
    if (slot) fireQuickMenuSlot(slot, this.#subject ?? undefined)
    this.#subject = null
    this.onEnd?.()
  }

  /** Enter or a click: run the lit leaf and go home. A pathway or nothing lit
   *  is not an answer, so the flower stays. */
  confirm(): boolean {
    if (!this.#active || !this.#ready || !this.#leaf(this.#lit)) return false
    this.end(true, true)
    return true
  }

  // ── aim ─────────────────────────────────────────────────────────────

  /** The faux cursor moves by the real pointer's travel. Locked, that is the
   *  raw delta; unlocked, the change in position since the last event. */
  move(e: PointerEvent): void {
    if (!this.#active) return
    let dx: number
    let dy: number
    if (this.#locked) {
      dx = e.movementX ?? 0
      dy = e.movementY ?? 0
    } else {
      const last = this.#last
      this.#last = { x: e.clientX, y: e.clientY }
      if (!last) return
      dx = e.clientX - last.x
      dy = e.clientY - last.y
    }
    this.#virtual = {
      x: Math.min(window.innerWidth, Math.max(0, this.#virtual.x + dx)),
      y: Math.min(window.innerHeight, Math.max(0, this.#virtual.y + dy)),
    }
    this.#placeCursor()
    if (this.#ready) this.#aim(this.#layer.slotAtClient(this.#virtual.x, this.#virtual.y, 'gesture'))
  }

  #aim(slot: QuickMenuDirection | null): void {
    const level = this.#levels[this.#levels.length - 1]
    if (!level || slot === this.#lit) return
    this.#clearHold()
    this.#lit = slot
    this.#layer.highlight(slot)
    if (!slot) return
    if (level.back && slot === level.back) { this.#ascend(); return }
    const found = slotsByDirection(level.definition).get(slot)
    if (found?.action.kind === 'menu') { this.#descend(found, slot); return }
    if (found?.activation === 'arrive') this.end(true)
    if (found?.activation === 'hold') this.#holdTimer = setTimeout(() => this.end(true), HOLD_FIRE_MS)
  }

  #clearHold(): void {
    if (this.#holdTimer) clearTimeout(this.#holdTimer)
    this.#holdTimer = null
  }

  /** Read the tile's own seats while the camera flies. The shipped flower stands
   *  until they land, so a slow read never holds the gesture up. */
  #readSeats(definition: QuickMenuDefinition, subject: string | undefined): void {
    if (!subject) return
    const flight = ++this.#seatRead
    const segments = get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []
    void readTileSeats([...segments, subject]).then(seats => {
      if (flight !== this.#seatRead) return
      this.#seats = seats
      const root = this.#levels[0]
      const registry = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')
      if (!root || !registry) return
      const mine = applyTileSeats(definition, seats)
      this.#levels[0] = { ...root, definition: mine }
      if (this.#levels.length === 1) this.#layer.show(mine, registry.label, null, '')
    })
  }

  /** The lit option, when it is a verb rather than a pathway or the way back. */
  #leaf(direction: QuickMenuDirection | null): QuickMenuSlot | undefined {
    const level = this.#levels[this.#levels.length - 1]
    if (!level || !direction || direction === level.back) return undefined
    const slot = slotsByDirection(level.definition).get(direction)
    return slot && slot.action.kind !== 'menu' ? slot : undefined
  }

  #descend(via: QuickMenuSlot, direction: QuickMenuDirection): void {
    const registry = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')
    if (via.action.kind !== 'menu' || !registry) return
    const back = OPPOSITE_DIRECTION[direction]
    const definition = registry.byName(via.action.menu) ?? seatMenu(via.action.menu, this.#seats, back)
    const at = this.#layer.slotLocal(direction)
    if (!definition || !at) return
    this.#levels.push({ definition: applyTileSeats(definition, this.#seats), back, at })
    this.#step(this.#levels[this.#levels.length - 1])
  }

  #ascend(): void {
    if (this.#levels.length <= 1) return
    this.#levels.pop()
    this.#step(this.#levels[this.#levels.length - 1])
  }

  /** Shift the flower to a ring's centre. The camera and the tile under it
   *  stay put: the menu itself walks outward as pathways are taken, and
   *  walks back as they are un-taken. */
  #step(level: Level): void {
    const registry = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')
    if (!registry) return
    this.#lit = null
    this.#layer.placeLocal(level.at.x, level.at.y)
    this.#layer.show(level.definition, registry.label, level.back, registry.label({ label: 'back', labelKey: 'quickmenu.back' }))
    // The faux cursor is on the option just taken, which is now the middle.
    this.#virtual = this.#layer.clientAtLocal(level.at.x, level.at.y) ?? this.#screenCentreClient()
    this.#placeCursor()
  }

  // ── camera ──────────────────────────────────────────────────────────

  /** Screen scale at which one hive tile is the size the menu is drawn for —
   *  and no bigger than leaves room for the whole flower. */
  #menuScale(): number {
    const host = this.#host!
    const area = this.#area()
    const stage = host.app.stage.scale.x || 1
    const { tileRadius, radius, reach } = this.#layer.metrics
    const wanted = TILE_RADIUS_PX / tileRadius
    const room = (Math.min(area.right - area.left, area.bottom - area.top) / 2 - EDGE_MARGIN) / (reach * STEPS_OUT + radius)
    return Math.min(wanted, room) / stage
  }

  /** The canvas the participant can see, beside the rail and under the header. */
  #area(): SafeArea {
    const host = this.#host!
    return visibleArea(host.renderer.screen, host.canvas.getBoundingClientRect())
  }

  /** Where the container must sit for `local` to land in the middle of the area. */
  #cameraFor(local: Pt, scale: number): Camera {
    const host = this.#host!
    const stage = host.app.stage
    const ss = stage.scale.x || 1
    const area = this.#area()
    return {
      scale,
      x: ((area.left + area.right) / 2 - stage.position.x) / ss - scale * local.x,
      y: ((area.top + area.bottom) / 2 - stage.position.y) / ss - scale * local.y,
    }
  }

  #flyTo(local: Pt, scale: number, ms: number, done?: () => void): void {
    this.#tween(this.#cameraFor(local, scale), ms, done)
  }

  #tween(to: Camera, ms: number, done?: () => void): void {
    const host = this.#host
    if (!host) { done?.(); return }
    cancelAnimationFrame(this.#anim)
    const from: Camera = {
      scale: host.container.scale.x,
      x: host.container.position.x,
      y: host.container.position.y,
    }
    const start = performance.now()
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / ms)
      const k = ease(t)
      host.container.scale.set(from.scale + (to.scale - from.scale) * k)
      host.container.position.set(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k)
      if (t < 1) this.#anim = requestAnimationFrame(tick)
      else { this.#anim = 0; done?.() }
    }
    this.#anim = requestAnimationFrame(tick)
  }

  /** The middle of the available area, in client coordinates. */
  #screenCentreClient(): Pt {
    const host = this.#host
    if (!host) return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    const rect = host.canvas.getBoundingClientRect()
    const area = this.#area()
    return { x: rect.left + (area.left + area.right) / 2, y: rect.top + (area.top + area.bottom) / 2 }
  }

  // ── faux cursor ─────────────────────────────────────────────────────

  #showCursor(): void {
    if (!this.#cursor) {
      const dot = document.createElement('div')
      dot.setAttribute('aria-hidden', 'true')
      dot.style.cssText = [
        'position:fixed', 'left:0', 'top:0', 'width:14px', 'height:14px',
        'margin:-7px 0 0 -7px', 'border-radius:50%', 'pointer-events:none',
        'z-index:2147483000', 'border:2px solid #d8e6ee',
        'background:rgba(126,182,214,0.35)', 'box-shadow:0 0 6px rgba(0,0,0,0.6)',
      ].join(';')
      this.#cursor = dot
    }
    if (!this.#cursor.isConnected) document.body.appendChild(this.#cursor)
    this.#placeCursor()
  }

  #placeCursor(): void {
    if (this.#cursor) this.#cursor.style.transform = `translate(${this.#virtual.x}px, ${this.#virtual.y}px)`
  }

  #hideCursor(): void {
    this.#cursor?.remove()
  }

  // ── pointer lock ────────────────────────────────────────────────────

  /** Refusal is normal (a stale gesture, a sandboxed frame): the faux cursor
   *  then follows absolute positions and the real one is hidden by CSS. */
  #requestLock(): void {
    const target = document.body as HTMLElement & {
      requestPointerLock?: (options?: { unadjustedMovement?: boolean }) => Promise<void> | void
    }
    if (!target.requestPointerLock) return
    const attempt = (options?: { unadjustedMovement?: boolean }): Promise<boolean> => {
      try {
        const result = target.requestPointerLock!(options)
        if (result && typeof (result as Promise<void>).then === 'function') {
          return (result as Promise<void>).then(() => true, () => false)
        }
        return Promise.resolve(true)
      } catch {
        return Promise.resolve(false)
      }
    }
    void attempt({ unadjustedMovement: true })
      .then(granted => (granted ? true : attempt()))
      .then(() => undefined, () => undefined)
  }

  #onLockChange = (): void => {
    const held = this.#locked
    this.#locked = document.pointerLockElement === document.body
    // The browser drops the lock on Escape and on focus loss — that is the
    // cancel, and the camera must not be left stranded at the centre.
    if (!this.#locked && held && this.#active) this.end(false)
  }
}
