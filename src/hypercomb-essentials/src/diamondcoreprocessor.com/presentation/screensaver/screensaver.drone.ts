// diamondcoreprocessor.com/presentation/screensaver/screensaver.drone.ts
//
// Screensaver — a real idle screensaver for hypercomb. When enabled and the
// participant goes idle, the tiles of the node they're viewing detach and
// drift around the screen as neon bubbles (each carrying that tile's image
// AND its text), bouncing off the edges and off each other like a DVD
// screensaver. ANY input — mouse move, key, wheel, touch — dismisses it and
// the hexagons re-render.
//
// Enabled BY DEFAULT. The on/off choice is STICKY (localStorage,
// `hc:screensaver-enabled`) — that's a participant-local UI preference, the
// same class as accent colour / language / substrate registry, so localStorage
// is the right home. It is NOT layer state: a decorative mode in the layer
// would skew the lineage signature across peers (same reason viewport /
// clipboard stay out of history).
//
// Rendering model: the tiles are a single GPU mesh owned by ShowCellDrone,
// rebuilt every `synchronize`. We don't fight that — we TAKE OVER: hide the
// hive (render:set-hive-visible), spawn one free-floating bubble Container per
// visible tile in our own layer parented directly to app.stage, and counter-
// transform that layer by the inverse of the stage transform so the bubbles
// live in screen pixels regardless of pan/zoom. On dismiss we tear the
// bubbles down, destroy every texture we created, and unhide the hive (which
// re-renders the hexagons).

import { Drone } from '@hypercomb/core'
import { Application, Container, Texture } from 'pixi.js'
import type { HostReadyPayload } from '../tiles/pixi-host.worker.js'
import { DEFAULT_BUBBLE_STYLE } from './styles.js'   // also registers the built-in styles
import { getBubbleStyle, bubbleStyleNames } from './bubble-style.js'
import { DEFAULT_MOTION } from './motions.js'        // also registers the built-in motions
import { getMotion, motionNames } from './motion.js'
import type { Bubble, BubbleMotion, MotionContext } from './motion.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

const ENABLED_KEY = 'hc:screensaver-enabled'
const STYLE_KEY = 'hc:screensaver-style'
const MOTION_KEY = 'hc:screensaver-motion'
const RANDOM_KEY = 'hc:screensaver-random'

/** A random element of `arr` (undefined if empty). */
function pickRandom<T>(arr: readonly T[]): T | undefined {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined
}

type TileSnap = { q: number; r: number; label: string; imageSig?: string; hideText?: boolean }

type ShowCell = { snapshotCells?: () => TileSnap[] }
type Store = { getResource: (sig: string) => Promise<Blob | null> }
type Lineage = { explorerSegments?: () => readonly string[] }

// Idle time before the screensaver kicks in.
const IDLE_MS = 30_000

// Hard cap on simultaneously-animated bubbles. Collision resolution is O(N²)
// per frame and each bubble holds its own GPU texture, so a node with hundreds
// of tiles is sampled down to this many. We log when that happens — a silent
// cap would read as "all tiles bounced" when they didn't.
const MAX_BUBBLES = 120
const MIN_RADIUS = 32
const MAX_RADIUS = 78
const MAX_DT = 1 / 30  // clamp so a backgrounded tab doesn't tunnel bubbles through walls

// How long the bubbles take to glide back onto their tiles when dismissed.
const RETURN_MS = 650

/** easeInOutCubic — slow start, slow settle; reads as easing into place. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

// Input that counts as "the participant is active" → dismiss / reset idle.
const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'touchmove'] as const

/** DJB2 hash → a vivid neon color from a tile label (stable per label). */
function neonColor(label: string): number {
  let h = 5381
  for (let i = 0; i < label.length; i++) h = ((h << 5) + h + label.charCodeAt(i)) | 0
  const hue = (h >>> 0) % 360
  return hslToHex(hue, 0.95, 0.6)
}

function hslToHex(h: number, s: number, l: number): number {
  h /= 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  const sector = (h * 6) | 0
  if (sector === 0) { r = c; g = x }
  else if (sector === 1) { r = x; g = c }
  else if (sector === 2) { g = c; b = x }
  else if (sector === 3) { g = x; b = c }
  else if (sector === 4) { r = x; b = c }
  else { r = c; b = x }
  const to = (v: number) => Math.round((v + m) * 255) & 0xff
  return (to(r) << 16) | (to(g) << 8) | to(b)
}

export class ScreensaverDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'

  public override description =
    'Idle screensaver — turns the current node\'s tiles into neon bubbles (image + text) that move by the chosen motion (bounce, shooting-stars…); any input dismisses it. Enabled by default, sticky on/off.'
  public override effects = ['render'] as const

  protected override listens = ['render:host-ready', 'keymap:invoke']
  protected override emits = ['render:set-hive-visible', 'screensaver:active']

  #app: Application | null = null
  #container: Container | null = null   // the pan/zoomed world container — used to map tiles → screen
  #layer: Container | null = null
  #tickerBound = false
  #wired = false

  // Grid geometry, mirrored from the renderer so bubbles lift off from the
  // exact spot their tile occupies on screen.
  #meshOffset = { x: 0, y: 0 }
  #spacing = 38

  // Return-home glide: when dismissed by activity, bubbles ease back onto
  // their tiles instead of vanishing. The hive reappears once they've landed.
  #returning = false
  #returnStart = 0

  #enabled = true
  #active = false
  // A portal/overlay (the installer iframe, meadowverse, …) is covering the
  // hive. While covered the parent window receives no activity events, so the
  // idle timer would otherwise fire and hide the hive BEHIND the overlay —
  // then leave it hidden on return (the restore only comes on the next
  // parent-window activity). Suspends arming while true; cleared on portal
  // close (or the next genuine parent activity, as a safety net).
  #portalOpen = false
  #idleTimer: number | null = null
  // Bumped on every (re)activation AND on every dismiss, so an in-flight async
  // bubble-build that's been superseded can detect it's stale and bail.
  #epoch = 0

  #bubbles: Bubble[] = []
  // Image textures WE created — destroyed on teardown so the screensaver can
  // cycle repeatedly without leaking GPU memory.
  #ownedTextures: Texture[] = []
  // Hex orientation, mirrored from the renderer so bubbles match the grid:
  // false = point-top (default), true = flat-top. Tracked via render:set-orientation.
  #flat = false
  // The chosen visual style (sticky). Drawn per-bubble by the matching
  // BubbleStyle from the registry. Switchable via /screensaver <name>.
  #styleName = DEFAULT_BUBBLE_STYLE
  // The chosen motion (sticky) — how the field moves (bounce, shooting-stars…).
  // Resolved from the motion registry. Switchable via /screensaver <name>.
  #motionName = DEFAULT_MOTION
  // Random mode (sticky, default ON): each activation picks a random style AND
  // a random motion from the registries, so the screensaver surprises you with
  // a different combination every time. Picking a specific style or motion pins
  // it (turns random off); `/screensaver random` turns it back on.
  #random = true
  // The motion chosen for the CURRENT run — so the per-frame tick uses the same
  // motion #activate spawned with (critical when random picked one at random).
  #runMotion: BubbleMotion | null = null

  protected override sense = (): boolean => true

  protected override heartbeat = async (): Promise<void> => {
    this.#wire()
  }

  // ─────────────────────────── public API (queen) ───────────────────────────

  /** Flip the sticky enabled/disabled preference. Returns the new state. */
  public toggleEnabled(): boolean {
    return this.setEnabled(!this.#enabled)
  }

  /** Set (and persist) the enabled preference. Disabling dismisses an active
   *  screensaver immediately; enabling arms the idle timer. */
  public setEnabled(on: boolean): boolean {
    this.#enabled = on
    try { localStorage.setItem(ENABLED_KEY, String(on)) } catch { /* ignore */ }
    if (!on) { this.#dismiss(); if (this.#idleTimer !== null) { clearTimeout(this.#idleTimer); this.#idleTimer = null } }
    else this.#armIdle()
    return on
  }

  public isEnabled(): boolean { return this.#enabled }
  public isActive(): boolean { return this.#active }

  /** Choose the visual style (sticky). Returns false if no such style is
   *  registered. Picking a style pins it (turns random mode off). Applies live
   *  if the screensaver is currently running. */
  public setStyle(name: string): boolean {
    if (!getBubbleStyle(name)) return false
    this.#styleName = name
    this.#setRandom(false)
    try { localStorage.setItem(STYLE_KEY, name) } catch { /* ignore */ }
    if (this.#active) this.#restart()
    return true
  }

  public getStyle(): string { return this.#styleName }

  /** Choose the motion (sticky) — how the field moves. Returns false if no such
   *  motion is registered. Picking a motion pins it (turns random mode off).
   *  Applies live if the screensaver is running. */
  public setMotion(name: string): boolean {
    if (!getMotion(name)) return false
    this.#motionName = name
    this.#setRandom(false)
    try { localStorage.setItem(MOTION_KEY, name) } catch { /* ignore */ }
    if (this.#active) this.#restart()
    return true
  }

  public getMotionName(): string { return this.#motionName }

  /** Turn random mode on/off (sticky). When on, each activation picks a random
   *  style + motion. Returns the new state; applies live if running. */
  public setRandom(on: boolean): boolean {
    this.#setRandom(on)
    if (this.#active) this.#restart()
    return on
  }

  public isRandom(): boolean { return this.#random }

  // Set + persist the random flag (no restart — callers decide).
  #setRandom = (on: boolean): void => {
    this.#random = on
    try { localStorage.setItem(RANDOM_KEY, String(on)) } catch { /* ignore */ }
  }

  /** Start the screensaver right now (for previewing without waiting for idle).
   *  Deferred a tick so the keystroke that invoked it doesn't immediately count
   *  as the dismissing activity. */
  public activateNow(): void {
    window.setTimeout(() => { if (this.#enabled && !this.#active) void this.#activate() }, 60)
  }

  /** Show the screensaver right now via the keyboard shortcut, ignoring the
   *  sticky enabled preference (and without changing it). Deferred a tick so the
   *  triggering keystroke isn't counted as the dismissing activity. This is the
   *  "surprise me" gesture: it ALWAYS rolls a random style + motion, even if a
   *  specific look has been pinned (random off) — so every press is different. */
  #showNow = (): void => {
    window.setTimeout(() => { if (!this.#active) void this.#activate(true) }, 60)
  }

  // ─────────────────────────── wiring ───────────────────────────

  #wire = (): void => {
    if (this.#wired) return
    this.#wired = true

    this.#enabled = this.#readEnabled()
    this.#styleName = this.#readStyle()
    this.#motionName = this.#readMotion()
    this.#random = this.#readRandom()

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      if (this.#app) return
      this.#app = payload.app
      this.#container = payload.container
    })

    // Keyboard shortcut (Ctrl+Shift+7) — show the screensaver right now. This is
    // an explicit "show it" gesture (a preview), so it activates regardless of
    // the sticky enabled preference and never flips that saved on/off.
    this.onEffect<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
      if (cmd === 'screensaver.show') this.#showNow()
    })

    // Mirror the grid's hex orientation so bubbles are the right hexagon shape.
    this.onEffect<{ flat: boolean }>('render:set-orientation', ({ flat }) => { this.#flat = !!flat })
    // Track grid geometry + offset so bubbles start exactly on their tiles.
    this.onEffect<{ spacing: number }>('render:geometry-changed', (geo) => { if (geo?.spacing) this.#spacing = geo.spacing })
    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (o) => { this.#meshOffset = { x: o?.x ?? 0, y: o?.y ?? 0 } })

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, this.#onActivity, { passive: true })
    }
    document.addEventListener('visibilitychange', this.#onActivity)

    // Portal/overlay lifecycle — suspend while the hive is covered. `portal:open`
    // fires for every overlay (the adopt flow dispatches it before opening the
    // installer); `portal:closed` fires for every overlay close.
    window.addEventListener('portal:open', this.#onPortalOpen)
    window.addEventListener('portal:closed', this.#onPortalClosed)

    this.#armIdle()
  }

  #readEnabled = (): boolean => {
    try {
      const v = localStorage.getItem(ENABLED_KEY)
      return v === null ? true : v === 'true'
    } catch { return true }
  }

  #readStyle = (): string => {
    try {
      const v = localStorage.getItem(STYLE_KEY)
      return v && getBubbleStyle(v) ? v : DEFAULT_BUBBLE_STYLE
    } catch { return DEFAULT_BUBBLE_STYLE }
  }

  #readMotion = (): string => {
    try {
      const v = localStorage.getItem(MOTION_KEY)
      return v && getMotion(v) ? v : DEFAULT_MOTION
    } catch { return DEFAULT_MOTION }
  }

  // Random mode defaults ON — out of the box the screensaver varies itself.
  #readRandom = (): boolean => {
    try {
      const v = localStorage.getItem(RANDOM_KEY)
      return v === null ? true : v === 'true'
    } catch { return true }
  }

  // Re-render the running screensaver (e.g. after a live style change). Hands
  // the screen back briefly, then rebuilds with the current style.
  #restart = (): void => {
    if (!this.#active) return
    this.#dismiss()
    this.activateNow()
  }

  // ─────────────────────────── idle / activity ───────────────────────────

  #armIdle = (): void => {
    if (this.#idleTimer !== null) { clearTimeout(this.#idleTimer); this.#idleTimer = null }
    if (!this.#enabled || this.#portalOpen) return
    this.#idleTimer = window.setTimeout(this.#onIdle, IDLE_MS)
  }

  #onIdle = (): void => {
    this.#idleTimer = null
    if (!this.#enabled || this.#active || !this.#app || this.#portalOpen) { this.#armIdle(); return }
    void this.#activate()
  }

  #onActivity = (): void => {
    if (this.#active) {
      if (!this.#returning) this.#beginReturn()   // glide back onto the tiles, then restore
    } else {
      this.#epoch++               // cancel any in-flight activation
      this.#armIdle()
    }
  }

  // ─────────────────────────── portal suspension ───────────────────────────

  // An overlay opened over the hive. Restore the hive now (if we were mid-run)
  // and stop arming — nothing should hide the grid behind the overlay, and the
  // grid must be visible the instant the overlay closes.
  #onPortalOpen = (): void => {
    this.#portalOpen = true
    if (this.#active) {
      this.#dismiss()             // emits render:set-hive-visible{true}; #armIdle no-ops while #portalOpen
    } else {
      this.#epoch++               // cancel any in-flight activation
      if (this.#idleTimer !== null) { clearTimeout(this.#idleTimer); this.#idleTimer = null }
    }
  }

  // The overlay closed — resume normal idle behaviour.
  #onPortalClosed = (): void => {
    this.#portalOpen = false
    this.#armIdle()
  }

  // ─────────────────────────── activate / dismiss ───────────────────────────

  #activate = async (forceRandom = false): Promise<void> => {
    const app = this.#app
    if (!app) return
    const epoch = ++this.#epoch

    const showCell = get('@diamondcoreprocessor.com/ShowCellDrone') as ShowCell | undefined
    let tiles = showCell?.snapshotCells?.() ?? []
    if (tiles.length === 0) { this.#armIdle(); return } // nothing here to bounce — try again later

    if (tiles.length > MAX_BUBBLES) {
      console.info(`[screensaver] ${tiles.length} tiles — bouncing first ${MAX_BUBBLES}`)
      tiles = tiles.slice(0, MAX_BUBBLES)
    }

    // Resolve a texture per tile up front so the bubbles pop in already-imaged.
    const store = get('@hypercomb.social/Store') as Store | undefined
    const texByTile = await Promise.all(tiles.map(async (t) => {
      if (!t.imageSig || !store) return null
      try {
        const blob = await store.getResource(t.imageSig)
        if (!blob) return null
        return Texture.from(await createImageBitmap(blob))
      } catch { return null }
    }))

    // Activity / disable may have superseded us while images loaded — bail and
    // clean up the textures we decoded.
    if (epoch !== this.#epoch) {
      for (const tex of texByTile) tex?.destroy(true)
      return
    }
    for (const tex of texByTile) if (tex) this.#ownedTextures.push(tex)

    const layer = new Container()
    this.#layer = layer
    app.stage.addChild(layer)
    this.#returning = false

    const W = app.screen.width
    const H = app.screen.height
    const radius = this.#bubbleRadius(tiles.length, W, H)
    // Random mode (or a forced "surprise me" from the keyboard shortcut) rolls a
    // fresh style + motion for this run; otherwise use the pinned ones. The
    // chosen motion is remembered (#runMotion) so the tick advances with the
    // SAME motion this activation spawned with.
    const useRandom = this.#random || forceRandom
    const styleName = useRandom ? (pickRandom(bubbleStyleNames()) ?? this.#styleName) : this.#styleName
    const motionName = useRandom ? (pickRandom(motionNames()) ?? this.#motionName) : this.#motionName
    const style = getBubbleStyle(styleName) ?? getBubbleStyle(DEFAULT_BUBBLE_STYLE)!
    const motion = getMotion(motionName) ?? getMotion(DEFAULT_MOTION)!
    this.#runMotion = motion
    const ctx: MotionContext = { W, H, layer }

    this.#bubbles = tiles.map((t, i) => {
      const color = neonColor(t.label)
      const view = style.build({ tex: texByTile[i], color, r: radius, label: t.label, hideText: t.hideText === true, flat: this.#flat })
      layer.addChild(view)
      // The tile's on-screen position — where the bubble eases back to on
      // dismiss (and where bounce lifts off from).
      const home = this.#tileHome(t.q, t.r)
        ?? { x: radius + Math.random() * Math.max(1, W - radius * 2), y: radius + Math.random() * Math.max(1, H - radius * 2) }
      const b: Bubble = {
        x: home.x, y: home.y,
        vx: 0, vy: 0,
        r: radius,
        mass: radius * radius,
        color,
        view,
        homeX: home.x, homeY: home.y,
        rsx: home.x, rsy: home.y,
      }
      motion.spawn(b, ctx)            // motion sets the start position + velocity (+ any trail)
      view.position.set(b.x, b.y)     // painted at its start before the first tick moves it
      return b
    })

    // Hand the screen over: hide the hive grid so the tiles read as having
    // "become" the bubbles.
    this.emitEffect('render:set-hive-visible', { visible: false })

    if (!this.#tickerBound) {
      this.#tickerBound = true
      app.ticker.add(this.#onTick)
    }
    this.#active = true
    // Tell shell UI (the selection context menu) to hide while we own the screen.
    this.emitEffect('screensaver:active', { active: true })
  }

  // Tear down and give the screen back to the hive (which re-renders the
  // hexagons). Re-arms the idle timer so the screensaver can return.
  #dismiss = (): void => {
    this.#epoch++ // invalidate any in-flight #activate
    const wasActive = this.#active || this.#bubbles.length > 0 || !!this.#layer
    this.#active = false
    this.#returning = false

    if (this.#app && this.#tickerBound) {
      this.#app.ticker.remove(this.#onTick)
      this.#tickerBound = false
    }
    if (this.#layer) {
      this.#layer.destroy({ children: true })
      this.#layer = null
    }
    this.#bubbles = []
    this.#runMotion = null
    for (const tex of this.#ownedTextures) {
      try { tex.destroy(true) } catch { /* already gone */ }
    }
    this.#ownedTextures = []

    if (wasActive) {
      this.emitEffect('render:set-hive-visible', { visible: true })
      this.emitEffect('screensaver:active', { active: false }) // let the context menu reappear
    }
    this.#armIdle()
  }

  // Activity arrived while running — begin easing every bubble back onto its
  // tile (instead of vanishing). The hive is restored once they've landed
  // (handled in #onTick when the glide completes).
  #beginReturn = (): void => {
    if (!this.#active || this.#returning) return
    this.#returning = true
    this.#returnStart = Date.now()
    for (const b of this.#bubbles) {
      b.rsx = b.x; b.rsy = b.y
      if (b.trailGfx) b.trailGfx.visible = false  // hide any motion trail during the glide home
    }
  }

  // The tile at axial (q,r) → its current on-screen position (screen px), via
  // the world container's transform. Null when geometry isn't wired up yet.
  #tileHome = (q: number, r: number): { x: number; y: number } | null => {
    const c = this.#container as any
    if (!c || typeof c.toGlobal !== 'function') return null
    const s = this.#spacing
    const ax = this.#flat
      ? { x: 1.5 * s * q, y: Math.sqrt(3) * s * (r + q / 2) }
      : { x: Math.sqrt(3) * s * (q + r / 2), y: s * 1.5 * r }
    const g = c.toGlobal({ x: this.#meshOffset.x + ax.x, y: this.#meshOffset.y + ax.y })
    return { x: g.x, y: g.y }
  }

  // ─────────────────────────── per-frame tick ───────────────────────────

  #onTick = (): void => {
    const app = this.#app
    const layer = this.#layer
    if (!app || !layer || this.#bubbles.length === 0) return

    const dt = Math.min(app.ticker.deltaMS / 1000, MAX_DT)
    const W = app.screen.width
    const H = app.screen.height

    // Keep the bubble layer in screen space: undo the stage's pan/zoom so a
    // local coordinate in `layer` maps 1:1 to a screen pixel.
    const sx = app.stage.scale.x || 1
    const sy = app.stage.scale.y || 1
    layer.scale.set(1 / sx, 1 / sy)
    layer.position.set(-app.stage.position.x / sx, -app.stage.position.y / sy)

    // Return-home glide: ease each bubble from where it was when dismissed back
    // onto its tile, then restore the hive (which renders the hexagons exactly
    // where the bubbles landed — a clean hand-off).
    if (this.#returning) {
      const t = Math.min(1, (Date.now() - this.#returnStart) / RETURN_MS)
      const e = easeInOut(t)
      for (const b of this.#bubbles) {
        b.x = b.rsx + (b.homeX - b.rsx) * e
        b.y = b.rsy + (b.homeY - b.rsy) * e
        b.view.position.set(b.x, b.y)
      }
      if (t >= 1) this.#dismiss()
      return
    }

    const bubbles = this.#bubbles
    const motion = this.#runMotion ?? getMotion(this.#motionName) ?? getMotion(DEFAULT_MOTION)!
    motion.step(bubbles, dt, { W, H, layer })   // advance positions + draw any trails
    for (const b of bubbles) b.view.position.set(b.x, b.y)
  }

  // ─────────────────────────── bubble visuals ───────────────────────────

  #bubbleRadius = (count: number, w: number, h: number): number => {
    const r = Math.min(w, h) / (Math.sqrt(Math.max(1, count)) * 2.6)
    return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, Math.round(r)))
  }

  // ─────────────────────────── teardown ───────────────────────────

  protected override dispose = (): void => {
    this.#dismiss()
    if (this.#idleTimer !== null) { clearTimeout(this.#idleTimer); this.#idleTimer = null }
    for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, this.#onActivity)
    document.removeEventListener('visibilitychange', this.#onActivity)
  }
}

const _screensaver = new ScreensaverDrone()
window.ioc.register('@diamondcoreprocessor.com/ScreensaverDrone', _screensaver)
