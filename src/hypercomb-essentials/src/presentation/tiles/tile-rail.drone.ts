// presentation/tiles/tile-rail.drone.ts
//
// THE LEFT SIDEBAR — the hive's one tile list, docked on the left.
//
// There is ONE list of tiles in the product: the tiles rail the AI chat uses
// (assistant/agent-tiles-rail.ts — title, find box, a row per tile, › where
// there is structure inside, ‹ to walk back out). Every surface that shows "the
// tiles at this level" mounts that list through its IoC factory with a profile;
// none draws its own, because a second list drifts. This surface is one more
// mount of it: a left-docked column whose only job is to give the list a place
// to stand and to say where a press goes.
//
// It owns no rows, no walk and no search, and it adds no behaviour of its own.
// Everything a situation needs comes from whoever opens it, and with nothing
// given it is exactly the list the chat window gets (the rail's own defaults:
// a click moves to that layer, chat furniture on):
//
//   tile-rail:open  { profile?, onPick?, side?, width? }
//       profile  the rail's own RailProfile (walk, chats, choose, badge, admits,
//                matches, labelOf, findLabel, clickLabel, title ...), merged onto nothing
//       onPick   what a press on a tile does, when it is not the rail's own move
//       side     'left' (default) or 'right'
//       offset   px from that edge (default: clear of the shell's own icon column on the left)
//       width    px, default 260
//   tile-rail:close {}
//
// While open it takes that edge of the stage through `viewport:inset`, the
// owner-keyed lane the other docked surfaces use, and gives it back on close.
// A new `tile-rail:open` while open re-mounts the list with the new request.

import { Drone, EffectBus } from '@hypercomb/core'

export const TILE_RAIL_SURFACE = 'hc-tile-rail'
export const TILE_RAIL_KEY = '@diamondcoreprocessor.com/TileRailDrone'
const RAIL_FACTORY_KEY = '@diamondcoreprocessor.com/AgentTilesRailFactory'
const INSET_OWNER = 'tile-rail'
/** Below the tile close-up (59990), above the stage host (59989). */
const RAIL_Z = 59989
const RAIL_ORDER = 305
export const TILE_RAIL_WIDTH = 260
/** The shell's own left icon column (controls-bar's `$rail-width`): a left sidebar starts after it, never under it. */
export const SHELL_LEFT_RAIL = '2.55rem'

type RailShape = {
  mount(host: HTMLElement): void
  dispose(): void
  refresh(): void
  onSubjectChanged: (subject: { name: string; path: readonly string[] } | null) => void
}
type RailFactoryShape = { create(profile?: Record<string, unknown>): RailShape }
type Pick = { name: string; path: readonly string[] }

export type TileRailOpen = {
  /** The rail's own profile, passed through untouched. */
  profile?: Record<string, unknown>
  /** What a press on a tile does. Absent: the rail's own move to that layer. */
  onPick?: (pick: Pick) => void
  side?: 'left' | 'right'
  /** Distance from that edge, px. Default: clear of the shell's own icon column on the left, flush on the right. */
  offset?: number
  width?: number
}

/** The element the registry mounts; it tells the drone where it is. */
export class TileRailElement extends HTMLElement {
  connectedCallback(): void {
    this.style.cssText = `position:fixed;top:0;bottom:0;left:0;width:${TILE_RAIL_WIDTH}px;z-index:${RAIL_Z};display:none;overflow:hidden;`
    this.setAttribute('data-hc-tile-rail', '')
    window.ioc?.get?.<TileRailDrone>(TILE_RAIL_KEY)?.attach(this)
  }

  disconnectedCallback(): void {
    window.ioc?.get?.<TileRailDrone>(TILE_RAIL_KEY)?.detach(this)
  }
}

export class TileRailDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  protected override deps = { lineage: '@hypercomb.social/Lineage' }
  protected override listens = ['tile-rail:open', 'tile-rail:close']
  protected override emits = ['viewport:inset']

  #registered = false
  #bound = false
  #element: HTMLElement | null = null
  #rail: RailShape | null = null
  #open = false
  #request: TileRailOpen = {}
  #side: 'left' | 'right' = 'left'
  /** Bumped on every open/close so a factory that arrives late cannot mount a stale rail. */
  #turn = 0

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#registered) {
      window.ioc.register(TILE_RAIL_KEY, this)
      this.#registered = true
    }
    if (this.#bound) return
    this.#bound = true
    this.onEffect<TileRailOpen | undefined>('tile-rail:open', request => this.open(request ?? {}))
    this.onEffect('tile-rail:close', () => this.close())
    window.addEventListener('navigate', this.#onNavigate)
  }

  attach(element: HTMLElement): void {
    this.#element = element
    if (this.#open) this.open(this.#request)
  }

  detach(element: HTMLElement): void {
    if (this.#element !== element) return
    this.#drop()
    this.#element = null
  }

  get isOpen(): boolean { return this.#open }

  open(request: TileRailOpen = {}): void {
    this.#open = true
    this.#request = request
    const el = this.#element
    if (!el) return
    const side = request.side === 'right' ? 'right' : 'left'
    const width = Number.isFinite(request.width) && (request.width as number) > 0 ? Math.round(request.width as number) : TILE_RAIL_WIDTH
    if (this.#side !== side) EffectBus.emit('viewport:inset', { owner: INSET_OWNER, side: this.#side, size: 0 })
    this.#side = side
    const edge = Number.isFinite(request.offset) && (request.offset as number) >= 0 ? `${Math.round(request.offset as number)}px` : side === 'left' ? SHELL_LEFT_RAIL : '0px'
    el.style.left = side === 'left' ? edge : 'auto'
    el.style.right = side === 'right' ? edge : 'auto'
    el.style.width = `${width}px`
    el.style.display = 'block'
    EffectBus.emit('viewport:inset', { owner: INSET_OWNER, side, size: width })
    // A new request replaces the list that is up: the profile is fixed at creation.
    this.#drop()
    const turn = ++this.#turn
    window.ioc?.whenReady?.(RAIL_FACTORY_KEY, (value: unknown) => {
      if (turn !== this.#turn || this.#rail || !this.#open || this.#element !== el) return
      const rail = (value as RailFactoryShape).create(request.profile)
      if (request.onPick) {
        const pick = request.onPick
        rail.onSubjectChanged = subject => { if (subject) pick(subject) }
      }
      rail.mount(el)
      this.#rail = rail
    })
  }

  close(): void {
    const side = this.#side
    this.#open = false
    this.#turn++
    this.#drop()
    if (this.#element) this.#element.style.display = 'none'
    EffectBus.emit('viewport:inset', { owner: INSET_OWNER, side, size: 0 })
  }

  #drop(): void {
    try { this.#rail?.dispose() } catch { /* already gone */ }
    this.#rail = null
  }

  #onNavigate = (): void => {
    if (this.#open) this.#rail?.refresh()
  }
}

const _tileRail = new TileRailDrone()
window.ioc.register(TILE_RAIL_KEY, _tileRail)

// Contribute the surface the doctrine way: define the element, then add it to
// the registry — never a template tag in either app.html.
window.ioc.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  if (!customElements.get(TILE_RAIL_SURFACE)) customElements.define(TILE_RAIL_SURFACE, TileRailElement)
  try {
    registry.add({ name: TILE_RAIL_SURFACE, owner: TILE_RAIL_KEY, element: TILE_RAIL_SURFACE, order: RAIL_ORDER })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})
