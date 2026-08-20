// diamondcoreprocessor.com/presentation/avatars/agent-bee.drone.ts
//
// AGENT BEES — one visible bee per unit of work in flight.
//
// The hive tells you something is happening by showing you a bee doing it,
// over the tiles it is doing it to. Click the bee and the request opens: what
// was asked, what it is doing now, and a place to hand it more context.
//
// ── Why sprites and not the swarm mesh ─────────────────────────────────
//
// The peer/op swarm (avatar-swarm.drone.ts) draws up to 2048 bees in ONE draw
// call, which it can do because every bee shares one texture. Agent bees do
// NOT share a texture — each behaviour has its OWN avatar (agent-avatar.ts) —
// and there are only ever a handful of them. So they render as individual
// sprites: per-behaviour textures, per-bee hit testing, negligible cost. The
// swarm keeps its fast path; this layer keeps its identity.
//
// ── Clicking ───────────────────────────────────────────────────────────
//
// Hit testing is done in a CAPTURE-phase window listener rather than through
// Pixi interactivity, because tile navigation is driven by its own window
// pointer listeners: capturing first is the only way to take the press before
// the hive treats it as a tile click, and `stopPropagation` there stops the
// whole cascade (nothing pans, nothing navigates, nothing selects).
//
// Bees hold a CONSTANT SCREEN SIZE (counter-scaled against the world
// container) so a zoomed-out hive still shows a bee you can see and hit.
//
// ── Branding ───────────────────────────────────────────────────────────
//
// A bee's NAME is painted ON THE BEE — livery across its abdomen, baked into
// the same atlas as the drawing (bee-ab-atlas.ts). It is not a caption beside
// it: a caption is a separate object that has to be positioned, scaled and
// faded in step with a creature flying a figure-8, and the moment two bees
// dance near each other a reader has to guess which name goes with which. What
// is painted on the bee cannot be read against the wrong one.

import { Drone } from '@hypercomb/core'
import { Application, Container, Graphics, Point, Sprite, Texture } from 'pixi.js'
import type { AgentRegistry, Agent } from '../../assistant/agent-registry.service.js'
import { avatarKeyOf, type AgentAvatarRegistry } from './agent-avatar.js'
import { inWaggleArea, waggleOffset, wagglePath, type AgentKind } from './agent-waggle.js'
import type { HostReadyPayload } from '../tiles/pixi-host.worker.js'
import type { HexGeometry } from '../grid/hex-geometry.js'

type ShowCellLike = { snapshotCells?: () => Array<{ q: number; r: number; label: string }> }
type LineageLike = { explorerSegments?: () => readonly string[] }
/** Only the two calls this layer makes — structural, so the bee bundle never
 *  imports the orchestrator module and mints a second copy of it. */
type OrchestratorLike = { audit?: () => number; clearAudit?: () => void }

/** One rendered agent. */
interface BeeSprite {
  id: string
  kind: AgentKind
  sprite: Sprite
  /** The "waiting on you" mark, minted only once an agent actually blocks.
   *  A bee that never asks anything never pays for one. */
  badge: Graphics | null
  frames: Texture[] | null
  /** Where the DANCE is centred, in world coordinates — the bee orbits this. */
  anchorX: number
  anchorY: number
  /** Eased dance centre: the anchor can jump (pan, repaint), the dance must not. */
  centreX: number
  centreY: number
  x: number
  y: number
  seed: number
  /** Per-bee dance clock. It stops while the pointer is over this bee. */
  danceTime: number
  alpha: number
  fadeTarget: number
  facing: number
}

/** Bee size on screen, in CSS pixels, regardless of zoom. Big enough that the
 *  NAME painted on the abdomen is a name and not a smudge — the bee carries its
 *  own branding, so the bee has to be worth reading. */
const BEE_PX = 56
/** Square cell size of a baked avatar atlas frame (agent-avatar.ts). */
const ATLAS_CELL_PX = 128
/** Click/hover radius around the BEE ITSELF, in CSS px. The waggle area around
 *  the dance centre is the other, larger half of the target. */
const HIT_PX = 22
/** How often anchors are re-resolved against the painted tiles. */
const ANCHOR_INTERVAL_MS = 400
/** Wing beat, in frames per second. */
const FLAP_FPS = 13
/** How far above its tile a bee dances, in CSS px. */
const HOVER_PX = 38
/** Fixed compact waggle size. Agent status must not pulse the path width. */
const WAGGLE_SCALE = 0.34
/** How far a bee leans into the way it is travelling, in radians. */
const BANK = 0.11
/** Where a PERCHED bee sits, as a fraction of the screen. The orchestrator
 *  goes to the top left when you open it and stays there while you read: it is
 *  watching the hive, so it gets out of the hive's way. Clear of the header
 *  band, which owns the very top. */
const PERCH_X = 0.07
const PERCH_Y = 0.2

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

export class AgentBeeDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'

  public override description =
    'Draws a bee for every agent working in the hive, over the tiles it is working on, and opens the request when clicked. '
    + 'Opening the orchestrator gathers every tended tile into one normal view, each bee dancing over its own tile.'
  public override effects = ['render'] as const

  protected override listens = [
    'render:host-ready', 'render:geometry-changed', 'render:set-hive-visible', 'agent:closed',
    'mesh:public-changed',
  ]
  protected override emits = ['agent:open', 'agent:close', 'toast:show']

  #app: Application | null = null
  #world: Container | null = null
  #layer: Container | null = null
  /** The waggle-area traces, under the bees. */
  #trace: Graphics | null = null
  #canvas: HTMLCanvasElement | null = null
  #effectsRegistered = false
  #tickerBound = false
  #listenersBound = false

  readonly #bees = new Map<string, BeeSprite>()
  #hexGeo: HexGeometry = { circumRadiusPx: 32, gapPx: 6, padPx: 10, spacing: 38 }
  #time = 0
  #lastAnchorAt = 0
  #hiveHidden = false
  /** In a swarm — LOCAL agents go out of sight for as long as it lasts
   *  (see the `mesh:public-changed` handler). */
  #inSwarm = false

  /** Scratch point for pointer mapping — one allocation, not one per move. */
  readonly #probe = new Point()
  #tooltip: HTMLDivElement | null = null
  #hovering = ''
  /** A press landed on a bee: swallow the pointerup/click that follows it. */
  #swallowPointer: number | null = null
  #swallowClickUntil = 0
  /** The agent that has been PERCHED — pulled out of the hive to the top-left
   *  corner where it stays put while its panel is open. Only the orchestrator
   *  perches today (opening it is a request to audit the hive, and it should
   *  not be dancing over the tiles you are trying to read), but nothing here is
   *  specific to it. '' = nobody is perched. */
  #perched = ''

  protected override sense = (): boolean => true

  protected override heartbeat = async (): Promise<void> => {
    this.#ensureEffects()
  }

  #ensureEffects = (): void => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<HostReadyPayload>('render:host-ready', payload => {
      if (this.#app) return
      this.#app = payload.app
      this.#world = payload.container
      this.#canvas = payload.canvas
      this.#mount()
    })

    this.onEffect<HexGeometry>('render:geometry-changed', geo => { this.#hexGeo = geo })

    // The panel closed by its own button or Escape. A perch is the visible half
    // of "this agent is open" — when the panel goes, the bee rejoins the hive
    // and its audit view is put down with it.
    this.onEffect<{ id?: string }>('agent:closed', ({ id }) => {
      // Closing ONE agent's log, stepped into from the gathered view, is not
      // leaving the orchestrator — the watcher stays perched.
      if (!id || this.#perched !== id) return
      this.#perched = ''
      this.#lastAnchorAt = 0
      ioc<OrchestratorLike>('@diamondcoreprocessor.com/OrchestratorDrone')?.clearAudit?.()
    })

    // A takeover feature (a website view, the screensaver) owns the screen —
    // the hive is standing down, and so are its agents.
    this.onEffect<{ visible: boolean }>('render:set-hive-visible', ({ visible }) => {
      this.#hiveHidden = visible === false
      if (this.#layer) this.#layer.visible = !this.#hiveHidden
    })

    // ── in a swarm, the sky belongs to the participants ─────────────
    //
    // A bee over a tile means SOMEBODY IS HERE. In a swarm that sentence is
    // the peer swarm's to say (avatar-swarm.drone.ts, one layer below this
    // one), and it has to stay unambiguous: a unit of work running for YOU,
    // on this machine, must not be read as a person who just arrived.
    //
    // So the rule is PER AGENT, not per layer — an agent that belongs to the
    // swarm (`origin:'swarm'`) is exactly what a swarm is for and keeps
    // flying. Local agents — the default, and everything the hive raises
    // today — go out of sight for as long as the swarm lasts: their bees
    // fade out where they stand (`#grounded`), which also takes them out of
    // the gesture, since `#hitTest` skips a faded bee and the press falls
    // through to the hive.
    //
    // NOTHING IS STOPPED. The registry keeps every agent, the work keeps
    // running, answers keep landing as notes, and the queued-ask pill and
    // its toast still say so. Leaving the swarm fades the same bees back in
    // over the same tiles.
    //
    // Last-value replayed, so joining a swarm before this drone mounts still
    // grounds the local bees.
    this.onEffect<{ public?: boolean }>('mesh:public-changed', ({ public: isPublic }) => {
      const next = isPublic === true
      if (next === this.#inSwarm) return
      this.#inSwarm = next
      // Both directions re-resolve at once: leaving must fade the bees back
      // in now, not at the end of the slow anchor cadence.
      this.#lastAnchorAt = 0
      if (!next) return
      this.#setHover('')
      // A perch and an audit view are both "this agent is open" made
      // visible. Grounding the bee without putting them down would leave the
      // hive gathered around agents with nothing dancing over it.
      const perched = this.#perched
      const agent = perched ? this.#registry()?.get(perched) : undefined
      if (!agent || !this.#grounded(agent)) return
      this.#perched = ''
      ioc<OrchestratorLike>('@diamondcoreprocessor.com/OrchestratorDrone')?.clearAudit?.()
      this.emitEffect('agent:close', { id: perched })
    })
  }

  /** Out of sight: work running for you locally, while you are in a swarm.
   *  Grounded is not stopped — the agent is untouched, only its bee is. */
  #grounded = (agent: Agent): boolean =>
    this.#inSwarm && (agent.origin ?? 'local') === 'local'

  #registry = (): AgentRegistry | undefined =>
    ioc<AgentRegistry>('@diamondcoreprocessor.com/AgentRegistry')

  #avatars = (): AgentAvatarRegistry | undefined =>
    ioc<AgentAvatarRegistry>('@diamondcoreprocessor.com/AgentAvatarRegistry')

  #mount = (): void => {
    if (!this.#app || !this.#world) return

    this.#layer = new Container()
    this.#layer.zIndex = 11 // above the peer swarm, below DOM chrome
    this.#layer.visible = !this.#hiveHidden
    this.#world.addChild(this.#layer)

    // Added first so every bee draws over its own trace.
    this.#trace = new Graphics()
    this.#layer.addChild(this.#trace)

    const registry = this.#registry()
    registry?.addEventListener('change', this.#sync)
    // The pool already holds the asks queued before this reload — pick them up
    // off the boot path, then draw whatever is there.
    const seed = (): void => { void registry?.seed().then(this.#sync) }
    if (typeof requestIdleCallback === 'function') requestIdleCallback(seed, { timeout: 4000 })
    else setTimeout(seed, 1200)
    this.#sync()

    // Avatar decoration changed — re-resolve textures.
    this.#avatars()?.addEventListener('change', this.#repaintAvatars)

    if (!this.#tickerBound) {
      this.#tickerBound = true
      this.#app.ticker.add(this.#onTick)
    }
    if (!this.#listenersBound) {
      this.#listenersBound = true
      window.addEventListener('pointerdown', this.#onPointerDown, true)
      window.addEventListener('pointerup', this.#onPointerSettle, true)
      window.addEventListener('click', this.#onPointerSettle, true)
      window.addEventListener('pointermove', this.#onPointerMove, { passive: true })
    }
  }

  // ── the sprite set follows the registry ──────────────────────────────

  #sync = (): void => {
    if (!this.#layer) return
    const agents = this.#registry()?.list() ?? []
    const live = new Set(agents.map(a => a.id))

    for (const agent of agents) {
      if (this.#bees.has(agent.id)) continue
      this.#spawn(agent)
    }
    for (const [id, bee] of this.#bees) {
      if (!live.has(id)) bee.fadeTarget = 0
    }
  }

  #spawn = (agent: Agent): void => {
    if (!this.#layer) return
    const sprite = new Sprite(Texture.EMPTY)
    sprite.anchor.set(0.5)
    sprite.alpha = 0
    this.#layer.addChild(sprite)

    // Born off its layer: the bee exists but waits, invisible, for the
    // participant to arrive where its work is.
    const resolved = this.#anchorFor(agent)
    const anchor = resolved ?? { x: 0, y: 0 }
    const bee: BeeSprite = {
      id: agent.id,
      kind: agent.kind,
      sprite,
      badge: null,
      frames: null,
      anchorX: anchor.x,
      anchorY: anchor.y,
      // Fly IN: the dance centre starts off to one side so a new bee arrives
      // rather than materialising on top of the tile.
      centreX: anchor.x + (Math.random() - 0.5) * 160,
      centreY: anchor.y - 120,
      x: anchor.x,
      y: anchor.y,
      seed: Math.random() * 6.28,
      danceTime: 0,
      alpha: 0,
      fadeTarget: resolved && !this.#grounded(agent) ? 1 : 0,
      facing: 1,
    }
    this.#bees.set(agent.id, bee)

    // Resolved under the AVATAR KEY, not the behaviour: a routine that calls a
    // model flies that model's bee, wearing that model's name.
    void this.#avatars()?.frames(avatarKeyOf(agent), agent.kind).then(frames => {
      if (!frames?.length) return
      const current = this.#bees.get(agent.id)
      if (!current) return
      current.frames = frames
      current.sprite.texture = frames[0]
    })
  }

  #repaintAvatars = (): void => {
    for (const [id, bee] of this.#bees) {
      const agent = this.#registry()?.get(id)
      if (!agent) continue
      void this.#avatars()?.frames(avatarKeyOf(agent), agent.kind).then(frames => {
        if (!frames?.length) return
        bee.frames = frames
      })
    }
  }

  /** Where an agent's bee belongs — and whether it belongs HERE at all.
   *
   *  Bees are local to their layer. A targeted bee sits over its tile when
   *  that tile is painted on the current layer, and is simply not shown
   *  anywhere else — it does not chase the participant across the hive. A
   *  hive-wide bee (no tile targets) belongs to the ROOT layer only.
   *  `null` means "not on this layer": the bee fades out and comes back when
   *  the participant returns. */
  #anchorFor = (agent: Agent): { x: number; y: number } | null => {
    // PERCHED: out of the hive, into the corner, on every layer. A perched bee
    // is being read, not watched at work, so it does not go looking for a tile
    // and it does not disappear when the participant navigates.
    if (agent.id === this.#perched) return this.#perchAnchor()

    const cells = ioc<ShowCellLike>('@diamondcoreprocessor.com/ShowCellDrone')?.snapshotCells?.() ?? []
    for (const label of agent.targets) {
      const cell = cells.find(c => c.label === label)
      if (cell) return this.#axialToPixel(cell.q, cell.r)
    }
    if (agent.targets.length) return null
    // A hive-wide bee (no tile targets) belongs to the ROOT layer — and to the
    // orchestrator's gathered view, where EVERY agent must be present: the
    // targeted ones over the tiles the audit gathered, the untargeted ones
    // dancing in the open.
    return this.#atRoot() || this.#perched ? this.#viewAnchor(agent.id) : null
  }

  /** Is the participant on the root layer? Global work lives there. */
  #atRoot = (): boolean => {
    const lineage = ioc<LineageLike>('@hypercomb.social/Lineage')
    const segments = lineage?.explorerSegments?.()
    return !segments || segments.length === 0
  }

  /** The corner a perched bee holds, in world coordinates. Resolved from the
   *  screen every time the anchors are re-read, so it stays in the corner
   *  through a pan or a zoom instead of being carried off with the hive. */
  #perchAnchor = (): { x: number; y: number } => {
    if (!this.#app || !this.#world) return { x: 0, y: 0 }
    const screen = this.#app.renderer.screen
    return this.#world.toLocal(new Point(screen.width * PERCH_X, screen.height * PERCH_Y))
  }

  /** A stable spot in the current view, spread so hive-wide bees never stack.
   *
   *  Spaced by RANK among the hive-wide agents, not by an id hash: a hash can
   *  park two bees on one spot, and the press then belongs to whichever bee
   *  is nearer that frame — a click aimed at the backup bee opening the
   *  orchestrator. Sorted ids keep each bee's slot stable while the set
   *  stands; when the set changes, the eased dance centres glide to the new
   *  slots rather than jumping. */
  #viewAnchor = (id: string): { x: number; y: number } => {
    if (!this.#app || !this.#world) return { x: 0, y: 0 }
    const open = (this.#registry()?.list() ?? [])
      .filter(a => a.targets.length === 0)
      .map(a => a.id)
      .sort()
    const index = Math.max(0, open.indexOf(id))
    const count = Math.max(1, open.length)
    const spread = (index + 0.5) / count // 0..1, evenly spaced
    const screen = this.#app.renderer.screen
    // Kept clear of the top edge: the header bar owns that band, and a bee
    // wanders ±60px around its anchor.
    const point = new Point(screen.width * (0.2 + spread * 0.6), screen.height * 0.34)
    return this.#world.toLocal(point)
  }

  // ── per-frame ────────────────────────────────────────────────────────

  #onTick = (): void => {
    if (!this.#layer || !this.#app || !this.#world || this.#bees.size === 0) return

    const dt = this.#app.ticker.deltaMS / 1000
    this.#time += dt
    const now = Date.now()

    // Anchors are re-resolved on a slow cadence: the tiles under the bees only
    // move when the participant pans, zooms, or the layer repaints.
    const reanchor = now - this.#lastAnchorAt > ANCHOR_INTERVAL_MS
    if (reanchor) this.#lastAnchorAt = now

    // Counter-scale: constant size on screen whatever the world scale is.
    // The avatar's texture cell is ATLAS_CELL_PX square.
    const worldScale = this.#world.scale.x || 1
    const scale = BEE_PX / ATLAS_CELL_PX / worldScale

    for (const [id, bee] of this.#bees) {
      const agent = this.#registry()?.get(id)
      // In a swarm, your own work is out of sight — same treatment as a bee
      // whose work is on another layer: it fades where it stands and waits.
      const grounded = !!agent && this.#grounded(agent)

      if (reanchor && agent && !grounded) {
        const anchor = this.#anchorFor(agent)
        if (anchor) {
          // Coming back into view after a navigation: the eased centre still
          // points at the OLD layer's coordinates — arrive fresh, don't
          // streak across the hive from wherever the dance last was.
          if (bee.alpha < 0.02 && bee.fadeTarget === 0) {
            bee.centreX = anchor.x + (Math.random() - 0.5) * 160
            bee.centreY = anchor.y - 120
          }
          bee.anchorX = anchor.x
          bee.anchorY = anchor.y
          bee.fadeTarget = 1
        } else {
          // Not this layer's bee — it stays with its work, out of sight.
          bee.fadeTarget = 0
        }
        bee.kind = agent.kind
      }
      if (!agent || grounded) bee.fadeTarget = 0

      // The dance CENTRE eases onto the anchor; the bee then dances around the
      // centre. Two layers, so a pan or a repaint moves the whole dance
      // smoothly instead of teleporting the bee mid-figure.
      const hover = HOVER_PX / worldScale
      const hovered = this.#hovering === id
      if (!hovered) {
        bee.centreX += (bee.anchorX - bee.centreX) * 0.06
        bee.centreY += (bee.anchorY - hover - bee.centreY) * 0.06
      }

      // Freeze a hovered bee in place so the following press has a stable
      // target. Its wings can keep beating; only the waggle motion pauses.
      if (!hovered) bee.danceTime += dt
      const offset = waggleOffset(bee.kind, bee.danceTime, bee.seed, WAGGLE_SCALE)
      const ahead = waggleOffset(bee.kind, bee.danceTime + 0.05, bee.seed, WAGGLE_SCALE)
      bee.x = bee.centreX + offset.x / worldScale
      bee.y = bee.centreY + offset.y / worldScale
      // Lean the way the dance is going — the turn at each end of the run is
      // what makes a figure-8 read as a figure-8.
      if (Math.abs(ahead.x - offset.x) > 0.2) bee.facing = ahead.x >= offset.x ? 1 : -1

      if (!hovered && (agent?.status === 'done' || agent?.status === 'failed')) {
        // Finished work drifts upward and out, so a landing reads as a
        // departure rather than a disappearance.
        bee.centreY -= 26 * dt
      }

      bee.alpha += (bee.fadeTarget - bee.alpha) * 0.08
      // A faded bee is only DESTROYED when its agent is gone. An off-layer
      // bee just waits, invisible, for the participant to come back.
      if (!agent && bee.fadeTarget === 0 && bee.alpha < 0.02) {
        // `{ children: true }` — the badge is a child, and a sprite destroyed
        // without it would leave the mark behind in the scene graph.
        bee.sprite.destroy({ children: true })
        bee.badge = null
        this.#bees.delete(id)
        if (this.#perched === id) this.#perched = ''
        if (this.#hovering === id) this.#setHover('')
        continue
      }

      if (bee.frames?.length) {
        const frame = Math.floor(this.#time * FLAP_FPS) % bee.frames.length
        bee.sprite.texture = bee.frames[frame]
      }
      bee.sprite.position.set(bee.x, bee.y)
      bee.sprite.scale.set(scale)
      // BANKS, never mirrors. A bee that carries its name on its own body
      // cannot be flipped to show which way it is going — the name would come
      // out backwards — so the turn at each end of the run is a lean instead.
      bee.sprite.rotation += (bee.facing * BANK - bee.sprite.rotation) * 0.12
      bee.sprite.alpha = bee.alpha
      this.#badge(bee, agent?.status === 'blocked')
    }

    this.#drawWaggleAreas(worldScale)
  }

  /** THE BADGE — "this one is waiting on you", carried by the bee itself.
   *
   *  It rides as a child of the sprite so it flies the dance with the bee
   *  and needs no second position to keep in step. It BREATHES rather than
   *  flashes: the hive's chrome is cold and a blinking dot would read as an
   *  error, which this is not — the agent is fine, it just asked a question.
   *  Drawn once and then only faded; nothing is re-tessellated per frame. */
  #badge = (bee: BeeSprite, wanted: boolean): void => {
    if (!wanted) {
      if (bee.badge) bee.badge.visible = false
      return
    }
    if (!bee.badge) {
      const badge = new Graphics()
      badge.circle(0, 0, 5).fill({ color: 0x7eb6d6 }).stroke({ color: 0x0b1016, width: 1.5 })
      // Off the shoulder, so it never sits on the name the bee is wearing.
      badge.position.set(13, -13)
      bee.sprite.addChild(badge)
      bee.badge = badge
    }
    bee.badge.visible = true
    // One slow breath, in step with nothing else — a bee that has been
    // waiting a while is still asking just as calmly as when it started.
    bee.badge.alpha = bee.alpha * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(this.#time * 2.2)))
  }

  /** The WAGGLE AREA — a faint trace of the patch of air each bee is dancing
   *  in. It is the honest target: the bee itself never holds still, but the
   *  dance does, so this is what a cursor can actually be aimed at. Drawn
   *  under the bees, brighter under the one being hovered. */
  #drawWaggleAreas = (worldScale: number): void => {
    const trace = this.#trace
    if (!trace) return
    trace.clear()
    for (const [id, bee] of this.#bees) {
      if (bee.alpha < 0.1) continue
      const path = wagglePath(bee.kind)
      const hovered = this.#hovering === id
      trace.moveTo(bee.centreX + (path[0].x * WAGGLE_SCALE) / worldScale,
                   bee.centreY + (path[0].y * WAGGLE_SCALE) / worldScale)
      for (let i = 1; i < path.length; i++) {
        trace.lineTo(bee.centreX + (path[i].x * WAGGLE_SCALE) / worldScale,
                     bee.centreY + (path[i].y * WAGGLE_SCALE) / worldScale)
      }
      trace.closePath()
      trace.stroke({
        width: (hovered ? 1.6 : 1) / worldScale,
        color: 0x7eb6d6,
        alpha: bee.alpha * (hovered ? 0.5 : 0.17),
      })
    }
  }

  // ── pointer ──────────────────────────────────────────────────────────

  /** The agent under a client-space point, or ''.
   *
   *  Two targets per bee: the bee itself, and the WAGGLE AREA it is dancing
   *  in. The bee wins when the cursor is on it (nearest bee first), but the
   *  area is what makes this usable — you should not have to chase a dancing
   *  insect with a mouse. Distances are compared in SCREEN pixels so the
   *  target is the same size at any zoom. */
  #hitTest = (clientX: number, clientY: number): string => {
    if (!this.#app || !this.#world || !this.#layer?.visible || this.#bees.size === 0) return ''
    const rect = this.#canvas?.getBoundingClientRect()
    if (rect && (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom)) return ''

    this.#app.renderer.events.mapPositionToPoint(this.#probe, clientX, clientY)
    const local = this.#world.toLocal(this.#probe)
    const worldScale = this.#world.scale.x || 1

    let onBee = ''
    let bestDistance = HIT_PX * HIT_PX
    let inArea = ''
    let areaDistance = Number.POSITIVE_INFINITY
    // A grounded bee stops being a target the instant you join, not when it
    // finishes fading — resolved once for the whole sweep, and only in a
    // swarm, so the common case costs nothing.
    const grounding = this.#inSwarm ? this.#registry() : undefined
    for (const [id, bee] of this.#bees) {
      if (bee.alpha < 0.25) continue
      if (grounding && (grounding.get(id)?.origin ?? 'local') === 'local') continue
      const dx = (local.x - bee.x) * worldScale
      const dy = (local.y - bee.y) * worldScale
      const distance = dx * dx + dy * dy
      if (distance <= bestDistance) {
        onBee = id
        bestDistance = distance
      }
      const cx = (local.x - bee.centreX) * worldScale
      const cy = (local.y - bee.centreY) * worldScale
      const centreDistance = cx * cx + cy * cy
      if (centreDistance < areaDistance && inWaggleArea(bee.kind, cx, cy)) {
        inArea = id
        areaDistance = centreDistance
      }
    }
    return onBee || inArea
  }

  #onPointerDown = (event: PointerEvent): void => {
    if (this.#hiveHidden) return

    const id = this.#hitTest(event.clientX, event.clientY)
    if (!id) return
    // Take the whole gesture: no pan, no tile navigation, no selection.
    event.stopPropagation()
    event.preventDefault()
    this.#swallowPointer = event.pointerId
    this.#setHover('')

    // THE ORCHESTRATOR IS A DIFFERENT PRESS. Opening the watcher is a request
    // to audit the hive, which is three things at once: it takes itself out of
    // the way (perches top-left), it gathers every tile that has an agent on
    // it into ONE NORMAL VIEW — real tiles, painted by the hive's own
    // renderer, each with its bee dancing over it, exactly the way work is
    // read everywhere else — and it opens its panel with the summary.
    // Untargeted agents dance in the open in the same view (`#anchorFor`).
    // Clicking a bee opens its request as usual; clicking a tile travels to
    // the real work. Pressing the watcher again puts all of it down.
    if (this.#bees.get(id)?.kind === 'orchestrator') {
      const orchestrator = ioc<OrchestratorLike>('@diamondcoreprocessor.com/OrchestratorDrone')
      if (this.#perched === id) {
        this.#perched = ''
        orchestrator?.clearAudit?.()
        this.emitEffect('agent:close', { id })
        return
      }
      this.#perched = id
      // Fly to the corner from wherever it is, rather than jumping: the eased
      // dance centre is already the mechanism, so nothing else is needed.
      this.#lastAnchorAt = 0
      const gathered = orchestrator?.audit?.() ?? 0
      // Only say "nothing to audit" when there is genuinely nothing: no tile
      // gathered AND no live agent left to dance in the open.
      const live = (this.#registry()?.list() ?? [])
        .filter(a => a.kind !== 'orchestrator' && a.status !== 'done' && a.status !== 'failed')
      if (gathered === 0 && live.length === 0) {
        this.emitEffect('toast:show', {
          type: 'tip',
          message: 'Nothing is running right now — no commands to watch.',
        })
      }
      this.emitEffect('agent:open', { id })
      return
    }

    // Clicked out of the orchestrator's gathered view, opening a bee is a STEP,
    // not a fresh open: a fresh one closes the watcher's panel first, and
    // `agent:closed` would put the perch and the audit view down under the
    // participant mid-read. The step keeps the view up and grows the log a
    // '‹ back to the orchestrator'.
    this.emitEffect('agent:open', this.#perched ? { id, from: this.#perched } : { id })
  }

  /** Swallow the pointerup/click that trails a press we took. The click is
   *  matched by a short window rather than by pointerId (a click event carries
   *  no useful one), and the window is what makes this self-clearing: a press
   *  whose click never arrives cannot leave the next gesture swallowed. */
  #onPointerSettle = (event: Event): void => {
    if (event.type === 'click') {
      if (Date.now() > this.#swallowClickUntil) return
      this.#swallowClickUntil = 0
      event.stopPropagation()
      event.preventDefault()
      return
    }
    if (this.#swallowPointer === null) return
    const pointerId = (event as PointerEvent).pointerId
    if (pointerId !== undefined && pointerId !== this.#swallowPointer) return
    this.#swallowPointer = null
    this.#swallowClickUntil = Date.now() + 500
    event.stopPropagation()
    event.preventDefault()
  }

  #onPointerMove = (event: PointerEvent): void => {
    if (this.#hiveHidden) { this.#setHover(''); return }
    const id = this.#hitTest(event.clientX, event.clientY)
    this.#setHover(id, event.clientX, event.clientY)
  }

  #setHover = (id: string, clientX = 0, clientY = 0): void => {
    if (!id) {
      this.#hovering = ''
      if (this.#tooltip) this.#tooltip.style.display = 'none'
      if (this.#canvas && this.#canvas.style.cursor === 'pointer') this.#canvas.style.cursor = ''
      return
    }
    const agent = this.#registry()?.get(id)
    if (!agent) return
    this.#hovering = id
    if (this.#canvas) this.#canvas.style.cursor = 'pointer'
    const tip = this.#ensureTooltip()
    const progress = agent.total ? ` ${agent.current ?? 0}/${agent.total}` : ''
    const latest = agent.activity[agent.activity.length - 1]?.text ?? agent.status
    // Who it is first: for a model that is the VENDOR (the colour family the
    // bee is wearing), for anything else the kind. The behaviour name alone
    // does not answer "is this a model, and whose?".
    const who = agent.kind === 'model' ? `${agent.vendor ?? 'model'} · ${agent.model ?? agent.behavior}` : `${agent.kind} · ${agent.behavior}`
    // A blocked bee says what it wants FIRST — the whole point of the badge
    // is that hovering it answers "what does this need?" without a click.
    tip.textContent = agent.status === 'blocked'
      ? `${who} · waiting on you${agent.needs ? `: ${agent.needs}` : ''}`
      : `${who}${progress} · ${latest}`
    tip.style.display = 'block'
    tip.style.left = `${Math.round(clientX + 16)}px`
    tip.style.top = `${Math.round(clientY + 16)}px`
  }

  #ensureTooltip = (): HTMLDivElement => {
    if (this.#tooltip) return this.#tooltip
    const tip = document.createElement('div')
    tip.className = 'hc-agent-tip'
    tip.style.cssText =
      'position:fixed;z-index:99998;pointer-events:none;display:none;max-width:22rem;' +
      'padding:0.3rem 0.55rem;border-radius:6px;font-size:0.74rem;line-height:1.35;' +
      'color:rgba(238,244,250,0.92);background:rgba(6,9,14,0.92);' +
      'border:1px solid rgba(126,182,214,0.35);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
    document.body.appendChild(tip)
    this.#tooltip = tip
    return tip
  }

  // ── helpers ──────────────────────────────────────────────────────────

  #axialToPixel = (q: number, r: number): { x: number; y: number } => {
    const s = this.#hexGeo.spacing
    return { x: Math.sqrt(3) * s * (q + r / 2), y: s * 1.5 * r }
  }

  protected override dispose = (): void => {
    if (this.#app && this.#tickerBound) this.#app.ticker.remove(this.#onTick)
    if (this.#listenersBound) {
      window.removeEventListener('pointerdown', this.#onPointerDown, true)
      window.removeEventListener('pointerup', this.#onPointerSettle, true)
      window.removeEventListener('click', this.#onPointerSettle, true)
      window.removeEventListener('pointermove', this.#onPointerMove)
      this.#listenersBound = false
    }
    this.#registry()?.removeEventListener('change', this.#sync)
    this.#avatars()?.removeEventListener('change', this.#repaintAvatars)
    this.#tooltip?.remove()
    this.#tooltip = null
    if (this.#layer && this.#world) this.#world.removeChild(this.#layer)
  }
}

const _agentBees = new AgentBeeDrone()
window.ioc.register('@diamondcoreprocessor.com/AgentBeeDrone', _agentBees)
