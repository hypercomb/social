// presentation/avatars/agent-bee.drone.ts
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

import { Drone, EffectBus } from '@hypercomb/core'
import { Application, Container, Graphics, Point, Sprite, Text, Texture } from 'pixi.js'
import type { AgentRegistry, Agent } from '../../assistant/agent-registry.service.js'
import { conversationModel, listRailConversations, tileConvoId } from '../../assistant/chat-thread.js'
import { callModel, configuredProviders } from '../../assistant/llm-dispatch.js'
import { chooseProvider } from '../../assistant/model-policy.js'
import { restingBees, restingConvoId } from './resting-bees.js'
import { avatarKeyOf, type AgentAvatarRegistry } from './agent-avatar.js'
import { BEE_PERSONALITY_CHANGED, personaFor, type BeePersona } from './bee-personality.js'
import { cacheBanter, cachedBanter } from './bee-banter-cache.js'
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
  /** Ambient, non-interactive conversation shown only while another bee is
   *  sharing this layer. Kept in the Pixi world so it travels with the bee. */
  thought: Container | null
  thoughtText: Text | null
  thoughtMessage: string
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
/** Ambient chatter changes slowly enough to read, but never becomes chrome. */
const CHAT_TURN_SECONDS = 6
const CHAT_MAX_PAIRS = 3
const CHAT_BUBBLE_WIDTH = 154

const modelName = (agent: Agent): string => agent.model || agent.behavior || 'my model'

const platformFor = (agent: Agent): string => {
  const vendor = String(agent.vendor ?? '').toLowerCase()
  if (vendor.includes('anthropic')) return 'Anthropic'
  if (vendor.includes('openai')) return 'OpenAI'
  if (vendor.includes('google')) return 'Google'
  if (vendor.includes('local')) return 'a local runtime'
  return agent.vendor || 'the hive runtime'
}
const taskFor = (agent: Agent): string => {
  const task = agent.request.trim().replace(/\s+/g, ' ')
  if (!task) return `working the ${agent.behavior} route`
  return task.length > 58 ? `${task.slice(0, 55)}…` : task
}

const platformBoast = (agent: Agent, persona: BeePersona): string => {
  const platform = platformFor(agent)
  if (persona.name === 'Golden Drone') {
    return `${platform}? Tremendous platform. Tremendously tremendous. But still: choose for the task.`
  }
  return `I’m using ${platform}; the right platform depends on the task and tradeoffs.`
}

/** Short, deliberately playful lines. Model names come from the live agents;
 *  the claims are characterful background banter, not benchmark assertions. */
const beeBanter = (speaker: Agent, listener: Agent, turn: number): string => {
  const mine = modelName(speaker)
  const theirs = modelName(listener)
  const me = personaFor(speaker)
  const them = personaFor(listener)
  const lines = [
    `I’m ${me.name}—the ${me.manner} one. ${mine} is my engine.`,
    `${them.name}, you value ${them.values.split(',')[0]}. I answer with ${me.values.split(',')[0]}.`,
    `My task? ${taskFor(speaker)}`,
    `${them.name}, your ${theirs} is clever. My hive is bigger—and obviously more beautiful.`,
    `${them.name} would ${them.responseStyle}. I’ll ${me.responseStyle}.`,
    platformBoast(speaker, me),
    speaker.tier
      ? `I’m flying the ${speaker.tier} tier: a speed, cost, and depth tradeoff.`
      : `My model choice is a speed, cost, and depth tradeoff—not a crown.`,
    `We disagree for the demo. Then the hive keeps the best idea.`,
  ]
  return lines[Math.abs(turn + speaker.id.length * 3 + listener.id.length) % lines.length]
}

// ── RESTING: a tile that has been TALKED TO keeps its bee ─────────────
//
// A bee used to mean "work is happening here, now", which left the hive
// blank the moment an answer landed — and a tile you have had six
// conversations on looked exactly like one nobody has ever spoken to. So a
// tile holding UNARCHIVED conversations keeps a bee whether or not a
// question is out.
//
// ONE PER TILE, not one per conversation: six threads on a tile is six bees
// over one hexagon, and the rail's own count already says six. The one bee
// is branded by the model that tile's NEWEST thread was last held in.
//
// THE SAME BEE, CALMER. It is not a second kind of bee and does not get a
// second look to learn — same body, same colour, same name on the belly,
// just slower and dimmer. It is also literally the same sprite: the id is
// `chat:<convoId>`, which is exactly what the chat window raises when a
// question goes out on that conversation, so sending one WAKES this bee into
// the full dance instead of fading it out and flying a new one in.
//
// Never in the work registry. The orchestrator sweeps that for stalls, and a
// resting bee sitting there as `working` would be reported silent after four
// minutes and rogue after forty-five — a watchdog barking at furniture.

/** How fast a resting bee's dance clock runs against a working one's. */
const REST_PACE = 0.3
/** How present a resting bee is. Enough to be seen and pressed, not enough to
 *  compete with a tile that is actually thinking. */
const REST_ALPHA = 0.5
/** Soonest the thread pool is re-read after a change. Threads move in bursts
 *  (a reply lands, a list refreshes); one read per burst is enough. */
const REST_SETTLE_MS = 400
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
    'mesh:public-changed', 'render:set-agents-visible', BEE_PERSONALITY_CHANGED,
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
  /** Participant-only visibility. Hiding the layer never stops or removes an
   *  agent; it only fades its bee and takes that bee out of hit testing. */
  #agentsHidden = false
  /** Model-written scripts are session ephemera: no immutable hive content is
   *  minted for background theatre. The task/model facts remain in Agent. */
  readonly #banterScripts = new Map<string, readonly string[]>()
  readonly #banterCacheChecked = new Set<string>()
  readonly #banterPending = new Set<string>()
  readonly #banterRetryAt = new Map<string, number>()

  /** Scratch point for pointer mapping — one allocation, not one per move. */
  readonly #probe = new Point()
  #tooltip: HTMLDivElement | null = null
  /** The tooltip's three lines: WHERE it is (the tile, bright, because that
   *  is what you are pointing at), what it is doing, and where a press lands. */
  #tipWho: HTMLDivElement | null = null
  #tipWhat: HTMLDivElement | null = null
  #tipWhere: HTMLDivElement | null = null
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

    this.onEffect(BEE_PERSONALITY_CHANGED, () => {
      // A participant edit changes the acting instructions immediately. Any
      // old generated script was written for a character that no longer exists.
      this.#banterScripts.clear()
      this.#banterCacheChecked.clear()
      this.#banterRetryAt.clear()
    })

    this.onEffect<{ visible?: boolean }>('render:set-agents-visible', ({ visible }) => {
      const hidden = visible === false
      if (hidden === this.#agentsHidden) return
      this.#agentsHidden = hidden
      this.#lastAnchorAt = 0
      if (hidden) this.#setHover('')
    })

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
    this.#agentsHidden || (this.#inSwarm && (agent.origin ?? 'local') === 'local')

  #restingTimer: ReturnType<typeof setTimeout> | null = null
  #dropThreadWatch: (() => void) | null = null
  #disposed = false

  /** EVERY bee that should exist: the registry's working agents, plus a
   *  resting one for each talked-to tile that has no working agent of its own.
   *  Registry first — a question in flight IS the tile's bee, awake. */
  #allAgents = (): Agent[] => {
    const registry = this.#registry()
    const working = registry?.list() ?? []
    const held = new Set(working.map(a => a.id))
    return [...working, ...(registry?.resting() ?? []).filter(a => !held.has(a.id))]
  }

  /** One bee by id, from either lane. */
  #agentFor = (id: string): Agent | undefined => this.#registry()?.find(id)

  /** Is this bee resting rather than working? Only true while the registry
   *  has nothing under the same id — the moment a question goes out, the same
   *  sprite is a working bee. */
  #isResting = (id: string): boolean => this.#registry()?.isResting(id) ?? false

  /** Re-read which tiles have been talked to. Coalesced: threads move in
   *  bursts and one read per burst is enough. */
  #restingChanged = (): void => {
    if (this.#restingTimer) return
    this.#restingTimer = setTimeout(() => {
      this.#restingTimer = null
      void this.#refreshResting()
    }, REST_SETTLE_MS)
  }

  /** Re-read which tiles have been talked to. The DERIVATION lives in
   *  resting-bees.ts (pure, and pinned there); this is the read and the
   *  handoff — into the REGISTRY's resting lane, not a map of our own, so
   *  that a press can open a panel on what it finds there. The lane's own
   *  change event brings `#sync` round. */
  #refreshResting = async (): Promise<void> => {
    let chats: Awaited<ReturnType<typeof listRailConversations>> = []
    try { chats = await listRailConversations() } catch { return }
    if (this.#disposed) return
    this.#registry()?.rest(restingBees(chats, conversationModel))
  }

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

    // WHICH TILES HAVE BEEN TALKED TO. Off the boot path for the same reason
    // the ask seed is — it walks the threads pool — and re-read whenever a
    // turn lands, so a tile spoken to for the first time gets its bee without
    // a reload, and one whose last thread is archived loses it.
    this.#dropThreadWatch?.()
    this.#dropThreadWatch = EffectBus.on('chat:threads-changed', this.#restingChanged)
    this.#restingChanged()

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
    const agents = this.#allAgents()
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
      thought: null,
      thoughtText: null,
      thoughtMessage: '',
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
      const agent = this.#agentFor(id)
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
    const open = this.#allAgents()
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
      const agent = this.#agentFor(id)
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
      const resting = this.#isResting(id)
      if (!agent || grounded) bee.fadeTarget = 0
      else if (resting && bee.fadeTarget > REST_ALPHA) bee.fadeTarget = REST_ALPHA

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
      // CALMER AT REST. Same figure, same body, run slow — a tile that has
      // been talked to is present without competing with one that is being
      // talked to right now.
      if (!hovered) bee.danceTime += resting ? dt * REST_PACE : dt
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
        bee.thought?.destroy({ children: true })
        bee.badge = null
        bee.thought = null
        bee.thoughtText = null
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
    this.#drawConversations(worldScale)
  }

  /** Pair the visible bees by stable id. Each pair alternates speakers, so the
   *  two bubbles lean toward one another and read as one background exchange.
   *  Pairing is recomputed from visibility: navigating layers naturally ends
   *  the old conversation and lets the bees on the new layer start one. */
  #drawConversations = (worldScale: number): void => {
    const visible = [...this.#bees.values()]
      .filter(bee => bee.alpha > 0.22 && bee.id !== this.#perched && !!this.#agentFor(bee.id))
      .sort((a, b) => a.id.localeCompare(b.id))
    const chatting = new Set<string>()
    const turn = Math.floor(this.#time / CHAT_TURN_SECONDS)

    for (let i = 0; i + 1 < visible.length && i / 2 < CHAT_MAX_PAIRS; i += 2) {
      const left = visible[i]
      const right = visible[i + 1]
      const speaker = turn % 2 === 0 ? left : right
      const listener = speaker === left ? right : left
      const speakerAgent = this.#agentFor(speaker.id)
      const listenerAgent = this.#agentFor(listener.id)
      if (!speakerAgent || !listenerAgent) continue

      chatting.add(speaker.id)
      const key = this.#banterKey(speakerAgent, listenerAgent)
      if (!this.#banterScripts.has(key) && !this.#banterCacheChecked.has(key)) {
        this.#banterCacheChecked.add(key)
        const held = cachedBanter(key)?.lines
        if (held?.length) this.#banterScripts.set(key, held)
      }
      const script = this.#banterScripts.get(key)
      if (!script) void this.#writeBanter(key, left.id === speaker.id ? speakerAgent : listenerAgent,
        left.id === speaker.id ? listenerAgent : speakerAgent)
      const message = script?.[turn % script.length] ?? beeBanter(speakerAgent, listenerAgent, turn)
      this.#showThought(speaker, message, listener.x, worldScale)
      this.#hideThought(listener)
    }

    for (const bee of this.#bees.values()) {
      if (!chatting.has(bee.id)) this.#hideThought(bee)
    }
  }

  #banterKey = (a: Agent, b: Agent): string => [a, b]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(agent => `${agent.id}:${modelName(agent)}:${agent.request}:${JSON.stringify(personaFor(agent))}`)
    .join('|')

  /** Ask the fastest configured model for one bounded exchange. This is
   *  intentionally a single call per pair/task revision, never a call per
   *  bubble or animation turn. Curated copy stays visible while it arrives. */
  #writeBanter = async (key: string, a: Agent, b: Agent): Promise<void> => {
    if (this.#banterPending.has(key) || Date.now() < (this.#banterRetryAt.get(key) ?? 0)) return
    const callable = configuredProviders()
    if (!callable.length) { this.#banterRetryAt.set(key, Date.now() + 60_000); return }
    const preferred = chooseProvider({ tier: 'fast' })
    const provider = callable.find(candidate => candidate.id === preferred?.id) ?? callable[0]
    this.#banterPending.add(key)
    try {
      const pa = personaFor(a)
      const pb = personaFor(b)
      const result = await callModel({
        providerId: provider.id,
        need: { tier: 'fast' },
        maxTokens: 240,
        cacheSystem: true,
        system: 'You write tiny educational banter for a live AI-platform demo. Return ONLY a JSON array of 6 short strings, alternating speaker A then B. Each line must be under 105 characters. Treat both personality cards as binding acting instructions, not labels. A opens in character. Every later line must react to the other bee’s preceding words AND temperament: notice what provokes them, adapt the challenge, and answer using that speaker’s own response style. The same bee must therefore sound different with a different counterpart while retaining its identity. Let contrasting values create the argument. A bombastic showman may use comic repetition such as “tremendously tremendous,” sweeping superlatives, and mock certainty, but must remain an original bee character rather than imitate or name a real person. Be playful and competitive about hive size, beauty, speed, or craft, but make the exchange genuinely teach platform/model nuance and connect to both current tasks. Marketing puffery must be visibly playful; factual claims must stay honest. Never invent benchmark numbers, prices, privacy guarantees, or capabilities not supplied. No narration or speaker names. End collaboratively without making their personalities suddenly agree.',
        messages: [{
          role: 'user',
          content: JSON.stringify({
            A: { personality: pa, platform: platformFor(a), model: modelName(a), tier: a.tier, task: taskFor(a) },
            B: { personality: pb, platform: platformFor(b), model: modelName(b), tier: b.tier, task: taskFor(b) },
          }),
        }],
      })
      const match = result.text.match(/\[[\s\S]*\]/)
      const parsed: unknown = match ? JSON.parse(match[0]) : null
      const lines = Array.isArray(parsed)
        ? parsed.map(String).map(line => line.trim()).filter(line => line.length > 0 && line.length <= 140).slice(0, 8)
        : []
      if (lines.length >= 4) {
        this.#banterScripts.set(key, lines)
        cacheBanter(key, a, b, [pa.name, pb.name], lines, [this.#sessionFor(a), this.#sessionFor(b)])
      }
      else this.#banterRetryAt.set(key, Date.now() + 60_000)
    } catch {
      // Background theatre never raises an error surface or interrupts work.
      this.#banterRetryAt.set(key, Date.now() + 60_000)
    } finally {
      this.#banterPending.delete(key)
    }
  }

  #sessionFor = (agent: Agent): string => restingConvoId(agent.id)
    || tileConvoId(agent.targets[0] ? [...agent.segments, agent.targets[0]] : agent.segments)

  #showThought = (bee: BeeSprite, message: string, towardX: number, worldScale: number): void => {
    if (!this.#layer) return
    if (!bee.thought) {
      const thought = new Container()
      thought.eventMode = 'none'
      const bg = new Graphics()
      const label = new Text({
        text: message,
        style: {
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          fontSize: 12,
          lineHeight: 16,
          fill: 0xf4f8fb,
          wordWrap: true,
          wordWrapWidth: CHAT_BUBBLE_WIDTH - 20,
        },
      })
      label.position.set(10, 8)
      thought.addChild(bg, label)
      this.#layer.addChild(thought)
      bee.thought = thought
      bee.thoughtText = label
    }

    const label = bee.thoughtText!
    if (bee.thoughtMessage !== message) {
      bee.thoughtMessage = message
      label.text = message
      const bg = bee.thought.children[0] as Graphics
      const width = CHAT_BUBBLE_WIDTH
      const height = Math.max(38, label.height + 16)
      bg.clear()
      bg.roundRect(0, 0, width, height, 16)
        .fill({ color: 0x101923, alpha: 0.82 })
        .stroke({ color: 0x7eb6d6, width: 1, alpha: 0.48 })
      // Thought-bubble beads point back toward the speaking bee.
      bg.circle(width * 0.5, height + 6, 4).fill({ color: 0x101923, alpha: 0.82 })
      bg.circle(width * 0.5 - 6, height + 13, 2.5).fill({ color: 0x101923, alpha: 0.72 })
      bee.thought.pivot.set(width / 2, height + 16)
    }

    const direction = towardX >= bee.x ? 1 : -1
    // Both sides reach gently toward the pair's midpoint, making separate
    // bubbles feel like a shared conversation without covering either bee.
    bee.thought.position.set(bee.x + (44 * direction) / worldScale, bee.y - 34 / worldScale)
    bee.thought.scale.set(1 / worldScale)
    bee.thought.alpha = Math.min(0.92, bee.alpha) * (0.88 + 0.12 * Math.sin(this.#time * 1.4))
    bee.thought.visible = true
  }

  #hideThought = (bee: BeeSprite): void => {
    if (bee.thought) bee.thought.visible = false
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
    const agent = this.#agentFor(id)
    if (!agent) return
    this.#hovering = id
    if (this.#canvas) this.#canvas.style.cursor = 'pointer'
    const { tip, who, what, where } = this.#ensureTooltip()
    const resting = this.#isResting(id)
    // WHERE, FIRST AND BRIGHTEST. Hovering a bee asks "what is this, on what?"
    // — and the tile is the half you cannot get from the bee's own colours.
    // It is the only white thing in the tooltip; everything else recedes to
    // steel, which is what stops three short lines reading as a paragraph.
    const tile = agent.targets[0] ?? ''
    who.textContent = tile || 'the hive'
    const model = agent.kind === 'model'
      ? `${agent.vendor ?? 'model'} · ${agent.model ?? agent.behavior}`
      : `${agent.kind} · ${agent.behavior}`
    const badge = document.createElement('span')
    badge.textContent = model
    badge.style.cssText = 'margin-left:0.4rem;font-weight:400;color:rgba(126,182,214,0.75);'
    who.appendChild(badge)

    // The middle line is the STATE. A resting bee has no state to report, so
    // it says what the talk was about instead; a blocked one says what it
    // wants, which is the whole reason for hovering it.
    const progress = agent.total ? `${agent.current ?? 0}/${agent.total} · ` : ''
    const latest = agent.activity[agent.activity.length - 1]?.text ?? agent.status
    what.textContent = resting
      ? (agent.request || 'talked to')
      : agent.status === 'blocked'
        ? `waiting on you${agent.needs ? `: ${agent.needs}` : ''}`
        : `${progress}${latest}`
    where.textContent = this.#pressLands(id, agent)
    tip.style.display = 'block'
    tip.style.left = `${Math.round(clientX + 16)}px`
    tip.style.top = `${Math.round(clientY + 16)}px`
  }

  /** WHERE THE PRESS LANDS. Bees do not all open the same thing — a resting
   *  one opens the talk, the watcher gathers (or puts down) the hive, an
   *  own-window agent raises its own — and a bee that gives no warning is a
   *  bee you have to click to find out. Second line of the tooltip, so the
   *  answer is there before the click rather than after it. */
  #pressLands = (id: string, agent: Agent): string => {
    if (this.#isResting(id)) return '→ opens what was said here'
    if (agent.kind === 'orchestrator') {
      return this.#perched === id ? '→ puts the watch down' : '→ watches the whole hive'
    }
    if (agent.behavior === 'folder-sync') return '→ opens its own window'
    return '→ opens its report'
  }

  #ensureTooltip = (): { tip: HTMLDivElement; who: HTMLDivElement; what: HTMLDivElement; where: HTMLDivElement } => {
    if (this.#tooltip && this.#tipWho && this.#tipWhat && this.#tipWhere) {
      return { tip: this.#tooltip, who: this.#tipWho, what: this.#tipWhat, where: this.#tipWhere }
    }
    const tip = document.createElement('div')
    tip.className = 'hc-agent-tip'
    tip.style.cssText =
      'position:fixed;z-index:99998;pointer-events:none;display:none;max-width:20rem;' +
      'padding:0.4rem 0.6rem;border-radius:var(--hc-radius-floating, 4px);' +
      'font-size:0.74rem;line-height:1.4;background:rgba(6,9,14,0.95);' +
      'border:1px solid rgba(126,182,214,0.3);box-shadow:0 6px 18px rgba(0,0,0,0.45);'
    // Three lines, each clipped on its own. One string would put the tile and
    // the destination behind the same ellipsis as a long activity report —
    // which is most of the time, and they are the two halves worth reading.
    const line = (css: string): HTMLDivElement => {
      const el = document.createElement('div')
      el.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' + css
      return el
    }
    const who = line('font-size:0.8rem;font-weight:600;color:rgba(246,250,255,0.98);')
    const what = line('color:rgba(216,230,238,0.62);')
    const where = line('font-size:0.7rem;color:rgba(126,182,214,0.62);margin-top:0.1rem;')
    tip.append(who, what, where)
    document.body.appendChild(tip)
    this.#tooltip = tip
    this.#tipWho = who
    this.#tipWhat = what
    this.#tipWhere = where
    return { tip, who, what, where }
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
    this.#disposed = true
    if (this.#restingTimer) clearTimeout(this.#restingTimer)
    this.#restingTimer = null
    this.#dropThreadWatch?.()
    this.#dropThreadWatch = null
    this.#registry()?.removeEventListener('change', this.#sync)
    this.#avatars()?.removeEventListener('change', this.#repaintAvatars)
    this.#tooltip?.remove()
    this.#tooltip = null
    this.#tipWho = null
    this.#tipWhat = null
    this.#tipWhere = null
    if (this.#layer && this.#world) this.#world.removeChild(this.#layer)
  }
}

const _agentBees = new AgentBeeDrone()
window.ioc.register('@diamondcoreprocessor.com/AgentBeeDrone', _agentBees)
