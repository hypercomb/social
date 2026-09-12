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
// ── Dragging ───────────────────────────────────────────────────────────
//
// The same press that opens a bee can PUT IT SOMEWHERE ELSE. A bee dances
// over the tile it is working on, which is exactly the tile a participant
// sometimes wants to read, so it can be taken hold of and pulled aside; drop
// it back where its work put it and it goes home. The press decides what it is
// by travelling, which is why the open happens on the RELEASE and not on the
// press. What is remembered is a displacement from the bee's own anchor, so
// the bee holds its new place through a pan and a zoom (bee-drag.ts).
//
// ── Branding ───────────────────────────────────────────────────────────
//
// A bee's NAME is painted ON THE BEE — livery across its abdomen, baked into
// the same atlas as the drawing (bee-ab-atlas.ts). It is not a caption beside
// it: a caption is a separate object that has to be positioned, scaled and
// faded in step with a creature flying a figure-8, and the moment two bees
// dance near each other a reader has to guess which name goes with which. What
// is painted on the bee cannot be read against the wrong one.

import { Drone, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { Application, Container, Graphics, Point, Sprite, Text, Texture } from 'pixi.js'
import type { AgentRegistry, Agent } from '../../assistant/agent-registry.service.js'
import { conversationModel, listRailConversations, tileConvoId } from '../../assistant/chat-thread.js'
import { callModel, configuredProviders } from '../../assistant/llm-dispatch.js'
import { chooseProvider } from '../../assistant/model-policy.js'
import { restingBees, restingConvoId } from './resting-bees.js'
import { avatarKeyOf, type AgentAvatarRegistry } from './agent-avatar.js'
import { BEE_PERSONALITY_CHANGED, personaFor, personalityKey, type BeePersona } from './bee-personality.js'
import { cacheBanter, cachedBanter } from './bee-banter-cache.js'
import { loreBeats, topicAt } from './bee-hive-lore.js'
import { inWaggleArea, waggleOffset, wagglePath, type AgentKind } from './agent-waggle.js'
import {
  isDrag, nudgeFrom, releaseVelocity, slowed, snapsHome, ScrubDetector, sweptAsideTo,
  SWEEP_REACH_PX, TOSS_WINDOW_MS,
  type Nudge, type Room, type ScrubSample,
} from './bee-drag.js'
import { trackSceneText } from '../grid/screen-text-resolution.js'
import type { HostReadyPayload } from '../tiles/pixi-host.worker.js'
import type { HexGeometry } from '../grid/hex-geometry.js'
import { MOBILE_MODE_EFFECT } from '../../preferences/mobile-pheromones.js'

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
  /** INK, not presence. Eased 0..1, multiplied into everything the bee draws
   *  so it can stand back out of the light over a tile the participant is
   *  reading WITHOUT moving — `alpha` stays the presence value the hit test
   *  judges by, so a bee that has gone quiet is still exactly as pressable as
   *  it looks. */
  dim: number
  facing: number
  /** Ambient, non-interactive conversation shown only while another bee is
   *  sharing this layer. Kept in the Pixi world so it travels with the bee. */
  thought: Container | null
  thoughtText: Text | null
  /** What the bubble was last DRAWN as — the line plus the side plus the box
   *  height. The box is re-tessellated only when one of those changes. */
  thoughtDrawn: string
  /** Which side of the bee the bubble is currently drawn on. The tail has to
   *  be redrawn when this flips, so it is remembered rather than recomputed. */
  thoughtBelow: boolean
}

/** A press in flight on a bee. What it becomes is decided by whether it
 *  travels: still, it opens the request on release; moving, it carries the bee
 *  out of the way (bee-drag.ts). */
interface BeePress {
  id: string
  pointerId: number
  /** Where the press went down, in client px — the travel is measured here. */
  startX: number
  startY: number
  /** Where inside its dance the bee was taken hold of, in world units. Kept
   *  so a dragged bee does not snap its centre under the cursor. */
  grabX: number
  grabY: number
  dragging: boolean
  /** The last few places the pointer was, in client px. The hand's speed at
   *  the release is read from these — that is what makes a drop a THROW. */
  trail: ScrubSample[]
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
/** How near a hovered tile's centre a bee has to be to be standing in its
 *  light, as a multiple of the hex circumradius. The overlay fills the tile
 *  with its icon rows and the name band while the pointer is on it, and a bee
 *  dancing there sits on top of both (Jaime, 2026-09-09: "when you mouse over
 *  a tile make sure that the agents get out of the way"). 2.1 covers the
 *  hexagon with a margin.
 *
 *  It used to be a PUSH — the bee was moved out of the ring. That is what took
 *  the bees away from the participant: a bee that runs when you reach for it
 *  is a bee whose log you cannot open. Now the same ring only costs the bee
 *  its INK (`GHOST_INK`); moving one is something you do, never something it
 *  decides. */
const TILE_CLEARANCE_R = 2.1
/** How much ink a bee keeps while it is standing back over a tile you are
 *  reading. Enough to still be seen and aimed at — it has not gone anywhere —
 *  little enough that the tile's own overlay reads straight through it. */
const GHOST_INK = 0.3
/** Fixed compact waggle size. Agent status must not pulse the path width. */
const WAGGLE_SCALE = 0.34
/** THE VIEWPORT IS THE ROOM. A bee is chrome, not content: it is anchored to a
 *  tile, and a pan or a zoom can carry that tile off the edge or up under the
 *  header bar, where the bee is simply gone (Jaime, 2026-09-09: they "should
 *  never be able to fly off screen — currently they're going underneath the
 *  header and you can't see them"). The dance is kept inside the visible band,
 *  which starts at the header's MEASURED bottom, not at the canvas top.
 *  Keep-in margin around a bee, in CSS px: half its body plus a little air. */
const BEE_EDGE_PX = BEE_PX * 0.5 + 8
/** Ambient chatter changes slowly enough to read, but never becomes chrome.
 *  A turn now carries a whole thought about how the hive works rather than a
 *  one-line boast, so it needs longer on screen — six seconds was the dwell
 *  for a half-line, nine was still a line you had to catch rather than read
 *  (Jaime, 2026-09-09: "make it stay around a little longer so people can read
 *  it"). Fifteen is a four-line bubble read at a glance, twice, by someone who
 *  is doing something else. */
const CHAT_TURN_SECONDS = 15
const CHAT_MAX_PAIRS = 3
/** How far along its deck a pair will step to avoid saying what another pair
 *  is ALREADY saying. Three pairs can be on screen at once and they draw from
 *  the same curated deck, so two of them landing on one beat is a coincidence
 *  that will happen — and two identical boxes read as a bug, not as chatter. */
const CHAT_DEDUPE_STEPS = 6
/** How many turns a generated chapter runs before the next one is asked for.
 *  A pair NEVER loops its script: when the cursor walks off the end, the next
 *  chapter is written against a fresh topic and appended. */
const CHAT_CHAPTER_LINES = 8
/** Where a conversation stops growing and starts over on new ground. Held
 *  script lines are session ephemera in localStorage; a pair that has been on
 *  screen all day should not carry a novel around. */
const CHAT_SCRIPT_MAX = 32
/** Longest line a bee will speak. The box is a fixed 154px at a fixed screen
 *  size, so this is a HEIGHT budget: ~48 characters per line, so 190 is four
 *  lines of bubble. Anything longer stops being ambient and becomes a wall. */
const CHAT_LINE_MAX = 190
const CHAT_BUBBLE_WIDTH = 154
/** HOW BIG THE CHATTER READS — 60% of the size it was drawn at (Jaime,
 *  2026-09-09: "the text is too big"). A bubble is drawn at a CONSTANT SCREEN
 *  SIZE — `thought.scale.set(1 / worldScale)` cancels the camera — so there is
 *  no zoom level at which this gets out of the way on its own, and no viewport
 *  it adapts to. The number here is the only thing that decides it.
 *
 *  The BOX keeps its width. Narrowing it with the text would wrap the same
 *  105-character line into twice as many lines and give back the height the
 *  smaller type just saved; at the same width, smaller type simply means fewer
 *  lines — the bubble gets shorter, which is the whole point. Padding follows
 *  the text so the box still hugs it. */
const CHAT_BUBBLE_SCALE = 0.6
const CHAT_BUBBLE_FONT = 10.5 * CHAT_BUBBLE_SCALE
const CHAT_BUBBLE_LINE = 14 * CHAT_BUBBLE_SCALE
/** ROOM AROUND THE WORDS, inside the box (Jaime, 2026-09-09: "a little bit of
 *  padding … inside the container"). At this size the text was sitting almost
 *  on the stroke, which is what made a readable line look cramped; the box
 *  keeps its width, so the extra horizontal padding comes out of the wrap
 *  width and the bubble grows down instead of out. */
const CHAT_BUBBLE_PAD_X = 15 * CHAT_BUBBLE_SCALE
const CHAT_BUBBLE_PAD_Y = 13 * CHAT_BUBBLE_SCALE
/** Floor for a one-line bubble, so a short line still reads as a box. */
const CHAT_BUBBLE_MIN_HEIGHT = 34 * CHAT_BUBBLE_SCALE
/** THE VOICE THE BEES SPEAK IN. `system-ui` is the shell's chrome face —
 *  Segoe UI on Windows — which is what a menu sounds like, not a conversation.
 *  Source Sans 3 is the hive's OWN face (the same one the tile names are set
 *  in, `tile-name.drone.ts`): a humanist sans with open counters and real
 *  optical spacing, which is what still reads at this size where a display
 *  serif would silt up. Self-hosted `@font-face` — latin + latin-ext, one
 *  variable file per subset (`hypercomb-shared/fonts/_fonts.scss`), NOTHING
 *  fetched from a third party. The stack behind it is the old chrome one, so
 *  a subset that does not carry the glyph still says something.
 *
 *  Weight 400, not the 300 the face opens at: light-on-dark at six pixels
 *  needs the stem, and the tracking below buys back the openness. */
const CHAT_BUBBLE_FAMILY = "'Source Sans 3', system-ui, -apple-system, 'Segoe UI', sans-serif"
const CHAT_BUBBLE_WEIGHT = '400'
/** A whisker of tracking. At this size, on a dark ground, letters set solid
 *  close their own gaps — this is the difference between a line you can read
 *  at a glance and one you have to stop for. */
const CHAT_BUBBLE_TRACKING = 0.15

/** Keep-out margin between a thought bubble and the viewport edge, in CSS px. */
const THOUGHT_EDGE_PX = 12
/** Length of the bead tail between the bubble box and its anchor, in CSS px. */
const THOUGHT_TAIL_PX = 16
/** Clearance between the bee and the bubble's anchor, in CSS px. */
const THOUGHT_GAP_PX = 34

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
    return `${platform}? Tremendous platform. Tremendously tremendous. And still only a renter — the bytes it makes are named by their own hash, so they outlive it.`
  }
  return `I run on ${platform}, but the platform only decides my latency and my price. What I write is signed content, and the hive is what decides it means anything.`
}

const hashText = (value: string): number => {
  let result = 0
  for (let i = 0; i < value.length; i++) result = ((result << 5) - result + value.charCodeAt(i)) | 0
  return Math.abs(result)
}

/** A NEW ORDER EVERY RUN. The old fallback stepped one index per turn through
 *  eight lines, so every pair recited the same loop in the same order, forever
 *  — which is exactly the staleness this is meant to answer. A pair now walks
 *  its deck by a stride that is coprime with the deck size: it visits every
 *  line before repeating one, in an order that differs per pair and per run. */
const SESSION_SALT = Math.floor(Math.random() * 0xffff)
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
const strideFor = (length: number, seed: number): number => {
  for (let step = 0; step < length; step++) {
    const candidate = 1 + ((seed + step) % Math.max(1, length - 1))
    if (gcd(candidate, length) === 1) return candidate
  }
  return 1
}
const walk = <T>(items: readonly T[], seed: number, n: number): T =>
  items[(seed + n * strideFor(items.length, seed)) % items.length]

/** What a bee says when it has itself to talk about rather than the hive:
 *  its counterpart, its engine, its tier, its actual task. Kept honest — a
 *  tier is a tradeoff, not a crown — and pointed back at the architecture, so
 *  even the personal turns carry something a reader can learn from. */
const reactionLines = (speaker: Agent, listener: Agent): readonly string[] => {
  const mine = modelName(speaker)
  const theirs = modelName(listener)
  const me = personaFor(speaker)
  const them = personaFor(listener)
  return [
    `I am ${me.name}, the ${me.manner} one, and ${mine} is my engine. Swap that engine tomorrow and the work I already signed still stands exactly where it is.`,
    `${them.name}, you would ${them.responseStyle}. I ${me.responseStyle}. Same hive, different angle of attack — and it keeps whichever of us commits something true.`,
    `My task right now: ${taskFor(speaker)}. It lands as a layer either way, so the hive genuinely does not care which of the two of us is faster.`,
    `${them.name}, ${theirs} is clever, I will give you that. But nothing I make belongs to my model — it is named by its own bytes and it outlives us both.`,
    `You value ${them.values.split(',')[0]}; I answer with ${me.values.split(',')[0]}. Neither of us gets to overwrite the other, because here a change is always a new name.`,
    platformBoast(speaker, me),
    speaker.tier
      ? `I fly the ${speaker.tier} tier — speed traded against depth. The result is signed the same either way, so choose the tier per task, never per pride.`
      : `My model is a tradeoff between speed, cost and depth, not a crown. The layer it writes looks identical to one a bigger engine would have written.`,
    `We can argue as loudly as we like, ${them.name}. The hive keeps whichever idea got committed, and the one it did not keep is still addressable forever.`,
  ]
}

/** The no-model voice: a real fact about how this hive is built, roughly two
 *  turns in three, with a personal turn between them so it reads as two bees
 *  talking rather than a lecture with a hat on. Both kinds land on both bees
 *  because 3 and 2 are coprime — the roles rotate instead of freezing. */
const beeBanter = (speaker: Agent, listener: Agent, index: number): string => {
  const seed = hashText(`${personalityKey(speaker)}|${personalityKey(listener)}`) + SESSION_SALT
  const personal = (index + seed) % 3 === 2
  return personal
    ? walk(reactionLines(speaker, listener), seed * 7 + 1, index)
    : walk(loreBeats(), seed, index)
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
// just SLOWER. Never DIMMER: a bee that is on screen is solid, whatever it
// is doing, so pace is the only thing rest changes. It is also literally the
// same sprite: the id is `chat:<convoId>`, which is exactly what the chat
// window raises when a question goes out on that conversation, so sending one
// WAKES this bee into the full dance instead of fading it out and flying a
// new one in.
//
// Never in the work registry. The orchestrator sweeps that for stalls, and a
// resting bee sitting there as `working` would be reported silent after four
// minutes and rogue after forty-five — a watchdog barking at furniture.

/** How fast a resting bee's dance clock runs against a working one's. This is
 *  the ONLY thing rest changes. A resting bee used to also be held at half
 *  alpha, which read as a rendering fault rather than as calm — a bee that is
 *  on screen at all is fully opaque. */
const REST_PACE = 0.3
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
    'mesh:public-changed', 'render:set-agents-visible', BEE_PERSONALITY_CHANGED, MOBILE_MODE_EFFECT,
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
  /** The broom (bee-drag.ts): scribbling over a patch of hive sweeps the bees
   *  in it aside, and scribbling over swept bees sends them back. */
  #scrub = new ScrubDetector()
  /** How much of the canvas each side of the shell's chrome covers, in CSS px
   *  — the header above, the command line or a docked rail on the other three
   *  sides. What is left is THE ROOM. Measured on the anchor cadence, not per
   *  frame: `getComputedStyle` is a layout read, and this is chrome that moves
   *  when the shell moves, not when the camera does. */
  #room = { top: 0, left: 0, right: 0, bottom: 0 }
  #hiveHidden = false
  /** In a swarm — LOCAL agents go out of sight for as long as it lasts
   *  (see the `mesh:public-changed` handler). */
  #inSwarm = false
  /** Participant-only visibility. Hiding the layer never stops or removes an
   *  agent; it only fades its bee and takes that bee out of hit testing. */
  #agentsHidden = false
  /** On a phone — no agents at all (see the `mobile:mode` handler). */
  #mobile = false
  /** Model-written scripts are session ephemera: no immutable hive content is
   *  minted for background theatre. The task/model facts remain in Agent. */
  readonly #banterScripts = new Map<string, readonly string[]>()
  readonly #banterCacheChecked = new Set<string>()
  readonly #banterPending = new Set<string>()
  readonly #banterRetryAt = new Map<string, number>()
  /** The turn a pair's CURRENT position in its script counts from. A script
   *  is read forward, never modulo: when the cursor walks past the last line
   *  the next chapter is written and this is re-based so the new lines are
   *  spoken from their first one. */
  readonly #banterStart = new Map<string, number>()
  /** Which topics a pair has already been through, so the next chapter asks
   *  for ground they have not covered. Survives a reload via the cache. */
  readonly #banterTopics = new Map<string, readonly string[]>()

  /** Scratch point for pointer mapping — one allocation, not one per move. */
  readonly #probe = new Point()
  #tooltip: HTMLDivElement | null = null
  /** The tooltip's three lines: WHERE it is (the tile, bright, because that
   *  is what you are pointing at), what it is doing, and where a press lands. */
  #tipWho: HTMLDivElement | null = null
  #tipWhat: HTMLDivElement | null = null
  #tipWhere: HTMLDivElement | null = null
  #hovering = ''
  /** The tile the pointer is on — bees standing on it step aside. */
  #tileUnderPointer: string | null = null
  /** A press landed on a bee: swallow the pointerup/click that follows it. */
  #swallowPointer: number | null = null
  /** The press in flight, if any — an open or a drag, not yet decided. */
  #press: BeePress | null = null
  /** How far each bee has been PULLED from where its work puts it, in world
   *  units, per agent. Session-only, like the perch: the work is the truth,
   *  the seating is not. */
  readonly #nudges = new Map<string, Nudge>()
  /** Bees IN FLIGHT — thrown, still sliding. The velocity is in SCREEN px/s
   *  (a throw is the hand's, and the hand knows nothing of zoom) and lands in
   *  the nudge frame by frame (#slide). Gone the moment the bee stops. */
  readonly #glides = new Map<string, Nudge>()
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

    // The pointer entering a tile is what makes a bee step aside; the dance
    // centre eases, so it glides out and glides back on its own.
    this.onEffect<{ label?: string | null }>('tile:hover', p => {
      this.#tileUnderPointer = p?.label ?? null
    })

    this.onEffect(BEE_PERSONALITY_CHANGED, () => {
      // A participant edit changes the acting instructions immediately. Any
      // old generated script was written for a character that no longer exists.
      this.#banterScripts.clear()
      this.#banterCacheChecked.clear()
      this.#banterRetryAt.clear()
      this.#banterStart.clear()
      this.#banterTopics.clear()
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

    // ── no agents on a phone ────────────────────────────────────────
    //
    // The phone reads a layer as a list (mobile-one-column.md) and a bee is
    // nothing a thumb can aim at. Same treatment as a swarm, for EVERY agent:
    // grounded, never stopped — the work keeps running and answers still land
    // as notes. Last-value replayed, so a phone grounds the bees before any
    // are drawn.
    this.onEffect<{ active?: boolean }>(MOBILE_MODE_EFFECT, payload => {
      const next = payload?.active === true
      if (next === this.#mobile) return
      this.#mobile = next
      this.#lastAnchorAt = 0
      if (!next) return
      this.#setHover('')
      const perched = this.#perched
      if (!perched) return
      this.#perched = ''
      ioc<OrchestratorLike>('@diamondcoreprocessor.com/OrchestratorDrone')?.clearAudit?.()
      this.emitEffect('agent:close', { id: perched })
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
    this.#agentsHidden || this.#mobile || (this.#inSwarm && (agent.origin ?? 'local') === 'local')

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
      window.addEventListener('pointercancel', this.#onPointerCancel, true)
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
      dim: 1,
      fadeTarget: resolved && !this.#grounded(agent) ? 1 : 0,
      facing: 1,
      thought: null,
      thoughtText: null,
      thoughtDrawn: '',
      thoughtBelow: false,
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

  /** World-space centre of the tile under the pointer, or null when the
   *  pointer is off the hive. Resolved per frame from the same snapshot the
   *  anchors use, so it follows a pan or a zoom for free. */
  #pointerTileCentre = (): { x: number; y: number } | null => {
    const label = this.#tileUnderPointer
    if (!label) return null
    const cells = ioc<ShowCellLike>('@diamondcoreprocessor.com/ShowCellDrone')?.snapshotCells?.() ?? []
    const cell = cells.find(c => c.label === label)
    return cell ? this.#axialToPixel(cell.q, cell.r) : null
  }

  /** Is this bee standing in the light the participant is reading by — that
   *  is, over the tile under the pointer? False for every bee outside the
   *  ring, so reading one tile only quiets the bees actually on top of it. */
  #inTheLight = (bee: BeeSprite): boolean => {
    const centre = this.#pointerTileCentre()
    if (!centre) return false
    const clear = this.#hexGeo.circumRadiusPx * TILE_CLEARANCE_R
    return Math.hypot(bee.centreX - centre.x, bee.centreY - centre.y) < clear
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

  /** What the shell's chrome hides of the canvas, in CSS px, on each side.
   *
   *  The shell publishes its own measured edges and nothing here guesses at
   *  them: `--hc-header-bottom` is the header's bottom in client space, and
   *  `--hc-controls-left/right/bottom` are what the command line — docked to a
   *  side, or a strip along the bottom — reserves from those edges. All are
   *  REMOVED, not zeroed, while the chrome is away, so a hidden header or a
   *  put-down bar gives the bees that ground back on its own.
   *
   *  The canvas is not assumed to fill the window: only the part of each
   *  reservation that actually overlaps THIS canvas is an inset. */
  #measureRoom = (): void => {
    const canvas = this.#canvas ?? this.#app?.canvas
    const rect = canvas?.getBoundingClientRect?.()
    if (!rect) { this.#room = { top: 0, left: 0, right: 0, bottom: 0 }; return }
    const style = getComputedStyle(document.documentElement)
    const px = (name: string): number => Number.parseFloat(style.getPropertyValue(name)) || 0
    this.#room = {
      top: Math.max(0, px('--hc-header-bottom') - rect.top),
      left: Math.max(0, px('--hc-controls-left') - rect.left),
      right: Math.max(0, px('--hc-controls-right') - (window.innerWidth - rect.right)),
      bottom: Math.max(0, px('--hc-controls-bottom') - (window.innerHeight - rect.bottom)),
    }
  }

  /** The free canvas, in screen px: everything the shell's chrome is not
   *  standing on. Where a bee may be, and the wall a sweep parks it against. */
  #theRoom = (): Room => {
    const screen = this.#app?.renderer.screen
    if (!screen) return { left: 0, top: 0, right: 0, bottom: 0 }
    return {
      left: screen.x + this.#room.left,
      top: screen.y + this.#room.top,
      right: screen.x + screen.width - this.#room.right,
      bottom: screen.y + screen.height - this.#room.bottom,
    }
  }

  /** KEEP THE BEE IN THE ROOM. Clamps the drawn position into the visible band
   *  and carries the same correction into the dance CENTRE, so a bee whose
   *  tile has been panned away settles against the edge and keeps dancing
   *  there instead of pressing into the wall every frame and springing back.
   *  Screen space is the only frame that knows about the header, so the clamp
   *  is done there and brought back through the world transform — the same
   *  round trip the thought bubbles make. */
  #keepInView = (bee: BeeSprite): void => {
    if (!this.#app || !this.#world) return
    const room = this.#theRoom()
    const minX = room.left + BEE_EDGE_PX
    const maxX = room.right - BEE_EDGE_PX
    const minY = room.top + BEE_EDGE_PX
    const maxY = room.bottom - BEE_EDGE_PX
    // A viewport too small to hold the bee: park it in the middle of whatever
    // band there is rather than letting the clamp fight itself.
    const point = this.#world.toGlobal(new Point(bee.x, bee.y), undefined, true)
    const x = maxX >= minX ? Math.min(Math.max(point.x, minX), maxX) : (minX + maxX) / 2
    const y = maxY >= minY ? Math.min(Math.max(point.y, minY), maxY) : (minY + maxY) / 2
    if (x === point.x && y === point.y) return
    const local = this.#world.toLocal(new Point(x, y))
    bee.centreX += local.x - bee.x
    bee.centreY += local.y - bee.y
    bee.x = local.x
    bee.y = local.y
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
    this.#slide(dt)

    // Anchors are re-resolved on a slow cadence: the tiles under the bees only
    // move when the participant pans, zooms, or the layer repaints.
    const reanchor = now - this.#lastAnchorAt > ANCHOR_INTERVAL_MS
    if (reanchor) { this.#lastAnchorAt = now; this.#measureRoom() }

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
      // Two states only: on this layer (solid) or not (gone). Rest never
      // dims — it slows the dance below.
      if (!agent || grounded) bee.fadeTarget = 0

      // The dance CENTRE eases onto the anchor; the bee then dances around the
      // centre. Two layers, so a pan or a repaint moves the whole dance
      // smoothly instead of teleporting the bee mid-figure.
      const hover = HOVER_PX / worldScale
      const hovered = this.#hovering === id
      const dragged = this.#press?.dragging === true && this.#press.id === id
      // Thrown and still sliding: the nudge is moving under it (#slide).
      const thrown = this.#glides.has(id)
      // PUT THERE BY HAND. A nudge is held against the bee's OWN anchor, so
      // the place the participant chose survives a pan, a zoom and a repaint.
      const nudge = this.#nudges.get(id)
      if (dragged || thrown) {
        // 1:1 under the pointer while it is being carried — easing here would
        // just make the bee lag the hand that is placing it — and 1:1 with
        // the slide, or the throw would read as a drift and the stop a creep.
        bee.centreX = bee.anchorX + (nudge?.x ?? 0)
        bee.centreY = bee.anchorY - hover + (nudge?.y ?? 0)
      } else {
        // Its work says where it dances; a nudge — a drag, or a sweep — says
        // where the participant put it instead. Nothing else moves a bee. It
        // does NOT step aside from the pointer: a target that flinches as you
        // reach for it cannot be pressed, and pressing is how a log is opened.
        // Standing back out of the light is `#inTheLight` below, and that
        // costs ink, never ground.
        //
        // TRAVEL IS NOT THE DANCE, so hovering does not stop it. Hovering
        // freezes the waggle (below) — that is what makes a dancing bee a
        // stable target — but a bee that has just been swept aside, or swept
        // back to its work, has somewhere to be, and the cursor happens to be
        // exactly where it was standing. Frozen here, it would simply never go
        // (measured 2026-09-09: swept to the wall, the sweep back left it on
        // the wall). The glide is slow enough to follow and the target goes
        // with it.
        bee.centreX += (bee.anchorX + (nudge?.x ?? 0) - bee.centreX) * 0.06
        bee.centreY += (bee.anchorY - hover + (nudge?.y ?? 0) - bee.centreY) * 0.06
      }

      // OUT OF THE LIGHT, NOT OUT OF THE WAY. While the participant is reading
      // the tile this bee is dancing over, the overlay owns that hexagon — its
      // icon rows and its name band are under the bee. So the bee goes quiet:
      // it keeps its place, its size and its whole hit target, and simply
      // stops competing for the eye. A hovered or carried bee never dims —
      // that one is being looked at.
      const lit = hovered || dragged || thrown || !this.#inTheLight(bee)
      bee.dim += ((lit ? 1 : GHOST_INK) - bee.dim) * 0.12

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
      // The room comes last: whatever the anchor, the nudge, the clearance or
      // the departure drift decided, the bee is still on screen and still
      // below the header.
      this.#keepInView(bee)
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
        this.#nudges.delete(id)
        this.#glides.delete(id)
        if (this.#press?.id === id) this.#press = null
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
      bee.sprite.alpha = bee.alpha * bee.dim
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
    // NEVER THE SAME WORDS TWICE ON ONE SCREEN. Pairs are independent and draw
    // from one deck, so a collision is only a matter of time — and two boxes
    // carrying an identical sentence read as a rendering fault, not as two
    // conversations. The second pair steps along its own deck instead.
    const spoken = new Set<string>()
    const turn = Math.floor(this.#time / CHAT_TURN_SECONDS)

    for (let i = 0; i + 1 < visible.length && i / 2 < CHAT_MAX_PAIRS; i += 2) {
      const left = visible[i]
      const right = visible[i + 1]
      const speaker = turn % 2 === 0 ? left : right
      const listener = speaker === left ? right : left
      const speakerAgent = this.#agentFor(speaker.id)
      const listenerAgent = this.#agentFor(listener.id)
      if (!speakerAgent || !listenerAgent) continue

      const key = this.#banterKey(speakerAgent, listenerAgent)
      if (!this.#banterScripts.has(key) && !this.#banterCacheChecked.has(key)) {
        this.#banterCacheChecked.add(key)
        const held = cachedBanter(key)
        if (held?.lines.length) {
          this.#banterScripts.set(key, held.lines)
          this.#banterTopics.set(key, held.topics ?? [])
        }
      }
      // A CONVERSATION, NOT A LOOP. The cursor counts forward from the turn
      // this pair started speaking and never wraps: reaching the end of the
      // script is what ASKS for the next chapter, on a topic they have not
      // been through yet. It is re-based to an even turn so that line 0 of a
      // script is always spoken by the same bee the script was written for.
      let start = this.#banterStart.get(key)
      if (start === undefined) {
        start = turn - (turn % 2)
        this.#banterStart.set(key, start)
      }
      const index = turn - start
      const script = this.#banterScripts.get(key)
      if (!script || index >= script.length - 1) {
        void this.#writeBanter(key, left.id === speaker.id ? speakerAgent : listenerAgent,
          left.id === speaker.id ? listenerAgent : speakerAgent)
      }
      // The curated lore carries every turn the model has not reached yet —
      // the first minutes of a fresh pair, the gap between chapters, and the
      // whole life of a hive with no provider configured at all.
      const lineAt = (n: number): string =>
        script?.[n] ?? beeBanter(speakerAgent, listenerAgent, n)
      let message = lineAt(index)
      for (let step = 1; spoken.has(message) && step <= CHAT_DEDUPE_STEPS; step++) {
        message = lineAt(index + step)
      }
      // Still an echo after stepping the whole way: say nothing rather than say
      // it twice. This pair's next turn comes around on its own.
      if (spoken.has(message)) { this.#hideThought(speaker); this.#hideThought(listener); continue }
      spoken.add(message)
      chatting.add(speaker.id)
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

  /** Ask the fastest configured model for the pair's NEXT CHAPTER — the first
   *  one when they meet, another each time they talk their way to the end of
   *  the last. Still one call per chapter, never a call per bubble or per
   *  animation turn, and the curated lore holds the screen while it arrives.
   *
   *  Two things make the exchange worth reading rather than worth ignoring:
   *  the chapter is GROUNDED — a topic from `bee-hive-lore.ts` travels with
   *  the request, and the model is told it may rephrase those facts but never
   *  extend them — and it is CONTINUOUS: the tail of what was already said
   *  goes back with the ask, so chapter two answers chapter one instead of
   *  restarting the same argument in a different order. */
  #writeBanter = async (key: string, a: Agent, b: Agent): Promise<void> => {
    if (this.#banterPending.has(key) || Date.now() < (this.#banterRetryAt.get(key) ?? 0)) return
    const callable = configuredProviders()
    if (!callable.length) { this.#banterRetryAt.set(key, Date.now() + 60_000); return }
    const preferred = chooseProvider({ tier: 'fast' })
    const provider = callable.find(candidate => candidate.id === preferred?.id) ?? callable[0]
    this.#banterPending.add(key)
    const held = this.#banterScripts.get(key) ?? []
    const covered = this.#banterTopics.get(key) ?? []
    // Fresh ground each chapter, and a different opening topic per pair so two
    // conversations running side by side are not the same lesson twice.
    const topic = topicAt(covered.length + hashText(key))
    try {
      const pa = personaFor(a)
      const pb = personaFor(b)
      const result = await callModel({
        providerId: provider.id,
        need: { tier: 'fast' },
        maxTokens: 700,
        cacheSystem: true,
        system: `You write ambient banter for two bees flying over a live hypergraph workspace called a hive. Return ONLY a JSON array of ${CHAT_CHAPTER_LINES} strings, alternating speaker A then B, no speaker names and no narration. Each line is one or two full sentences under ${CHAT_LINE_MAX} characters — a complete thought, not a slogan. THE POINT OF THE EXCHANGE IS TO TEACH how the hive is built. Every line must carry, react to, or press on something from the supplied "hive" facts: use them, rephrase them, question them, apply them to a task — but never state architecture that is not in that list, and never invent benchmark numbers, prices, privacy guarantees, model capabilities, or features. Boasting is allowed only as seasoning on a real point: a bee that claims its hive is bigger must in the same breath say something true about why that costs nothing here. Treat both personality cards as binding acting instructions. A opens in character; every later line reacts to the other bee's preceding words AND temperament — notice what provokes them, adapt the challenge, answer in that speaker's own response style — so the same bee sounds different against a different counterpart while keeping its identity. Let contrasting values drive the argument, and connect it to what each bee is actually working on. A bombastic showman may use comic repetition, sweeping superlatives and mock certainty, but must stay an original bee rather than imitate or name a real person. End the chapter somewhere new: a question, a concession, or a fresh angle the next exchange could pick up — never a tidy agreement, and never a restatement of the opening line.`,
        messages: [{
          role: 'user',
          content: JSON.stringify({
            A: { personality: pa, platform: platformFor(a), model: modelName(a), tier: a.tier, task: taskFor(a) },
            B: { personality: pb, platform: platformFor(b), model: modelName(b), tier: b.tier, task: taskFor(b) },
            hive: { topic: topic.title, facts: topic.facts },
            alreadyCovered: covered,
            // Only the tail: enough for chapter two to answer chapter one
            // without paying to resend a conversation nobody can scroll back to.
            continuesFrom: held.slice(-4),
          }),
        }],
      })
      const match = result.text.match(/\[[\s\S]*\]/)
      const parsed: unknown = match ? JSON.parse(match[0]) : null
      const lines = Array.isArray(parsed)
        ? parsed.map(String).map(line => line.trim())
          .filter(line => line.length > 0 && line.length <= CHAT_LINE_MAX)
          .slice(0, CHAT_CHAPTER_LINES + 2)
        : []
      if (lines.length >= 4) {
        // Chapters accumulate until the script would become a novel, then the
        // pair simply starts a new one on new ground. Either way the cursor is
        // re-based to the first new line, on an even turn so the A/B parity the
        // script was written with survives.
        const previous = held.length >= CHAT_SCRIPT_MAX ? [] : held
        const script = [...previous, ...lines]
        this.#banterScripts.set(key, script)
        const topics = [...(previous.length ? covered : []), topic.id]
        this.#banterTopics.set(key, topics)
        const now = Math.floor(this.#time / CHAT_TURN_SECONDS)
        const base = now - previous.length
        this.#banterStart.set(key, base % 2 === 0 ? base : base + 1)
        cacheBanter(key, a, b, [pa.name, pb.name], script, [this.#sessionFor(a), this.#sessionFor(b)], topics)
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
      // Canvas text does NOT pull a @font-face down the way a DOM node does:
      // ask for it explicitly, or the first bubble is measured and rasterised
      // in the fallback and keeps that texture until its line next changes.
      // Fire-and-forget — the tile names ask for the same face at boot, so by
      // the time a bee has anything to say it is resident; this is only the
      // insurance that says so out loud, and a miss self-heals on the next
      // turn of the conversation.
      void document.fonts?.load(`${CHAT_BUBBLE_WEIGHT} ${CHAT_BUBBLE_FONT}px 'Source Sans 3'`)
        ?.catch(() => { /* face optional — the stack behind it still speaks */ })
      const thought = new Container()
      thought.eventMode = 'none'
      const bg = new Graphics()
      const label = new Text({
        text: message,
        style: {
          fontFamily: CHAT_BUBBLE_FAMILY,
          fontWeight: CHAT_BUBBLE_WEIGHT,
          fontSize: CHAT_BUBBLE_FONT,
          lineHeight: CHAT_BUBBLE_LINE,
          letterSpacing: CHAT_BUBBLE_TRACKING,
          fill: 0xf4f8fb,
          wordWrap: true,
          wordWrapWidth: CHAT_BUBBLE_WIDTH - CHAT_BUBBLE_PAD_X * 2,
        },
        // Texels on device pixels. The bubble sits at a fractional world
        // position that the counter-scale does not make whole, so without
        // this the glyph raster lands between pixels and is resampled even
        // when its density is right.
        roundPixels: true,
      })
      label.position.set(CHAT_BUBBLE_PAD_X, CHAT_BUBBLE_PAD_Y)
      thought.addChild(bg, label)
      this.#layer.addChild(thought)
      // BAKE AT THE DENSITY IT IS SHOWN AT — the same remedy the overlay's
      // hint and cue text got. The counter-scale below cancels the CAMERA,
      // not the stage: the Pixi host scales the stage ×1.8, so a bubble is
      // always DISPLAYED 1.8× the size its texture was rasterised at, and
      // every glyph came through a bilinear magnify. (That residual is also
      // why 6.3px type reads as ~11px on screen.) Handing the label to the
      // scene-text registry makes the host's one per-frame pass keep it at
      // (screen scale × renderer resolution) — through the ×1.8, through a
      // DPR change, through a move to another monitor.
      trackSceneText(label, thought)
      bee.thought = thought
      bee.thoughtText = label
    }

    const label = bee.thoughtText!
    if (label.text !== message) label.text = message
    const width = CHAT_BUBBLE_WIDTH
    const height = Math.max(CHAT_BUBBLE_MIN_HEIGHT, label.height + CHAT_BUBBLE_PAD_Y * 2)

    // ABOVE OR BELOW, whichever the bee actually has room for. Clamping alone
    // could only slide the box down over the bee it belongs to; a bee near the
    // top of the viewport has to speak DOWNWARD instead, or the words are
    // half off the screen and there is no point drawing them at all.
    const direction = towardX >= bee.x ? 1 : -1
    let below = bee.thoughtBelow
    if (this.#world && this.#app) {
      const screen = this.#app.renderer.screen
      const beeScreen = this.#world.toGlobal({ x: bee.x, y: bee.y }, undefined, true)
      const reach = THOUGHT_GAP_PX + THOUGHT_TAIL_PX + height
      const slackAbove = (beeScreen.y - reach) - screen.y
      const slackBelow = (screen.y + screen.height) - (beeScreen.y + reach)
      // Hysteresis: only flip when the current side genuinely cannot hold the
      // box, so a bee drifting along the edge does not flicker side to side.
      if (!below && slackAbove < THOUGHT_EDGE_PX && slackBelow > THOUGHT_EDGE_PX) below = true
      else if (below && slackBelow < THOUGHT_EDGE_PX && slackAbove > THOUGHT_EDGE_PX) below = false
    }

    if (bee.thoughtDrawn !== `${message}|${below}|${height}`) {
      bee.thoughtDrawn = `${message}|${below}|${height}`
      bee.thoughtBelow = below
      const bg = bee.thought.children[0] as Graphics
      bg.clear()
      bg.roundRect(0, 0, width, height, 8)
        .fill({ color: 0x101923, alpha: 0.82 })
        .stroke({ color: 0x7eb6d6, width: 1, alpha: 0.48 })
      // Thought-bubble beads point back toward the speaking bee — downward
      // from a bubble that sits above it, upward from one that sits below.
      const near = below ? -6 : height + 6
      const far = below ? -13 : height + 13
      bg.circle(width * 0.5, near, 4).fill({ color: 0x101923, alpha: 0.82 })
      bg.circle(width * 0.5 - 6, far, 2.5).fill({ color: 0x101923, alpha: 0.72 })
      bee.thought.pivot.set(width / 2, below ? -THOUGHT_TAIL_PX : height + THOUGHT_TAIL_PX)
    }

    // Both sides reach gently toward the pair's midpoint, making separate
    // bubbles feel like a shared conversation without covering either bee.
    const gap = (below ? THOUGHT_GAP_PX : -THOUGHT_GAP_PX) / worldScale
    bee.thought.position.set(bee.x + (44 * direction) / worldScale, bee.y + gap)
    bee.thought.scale.set(1 / worldScale)
    // A bubble that runs off the edge cannot be read. The bubble is drawn at a
    // constant screen size, so its box in SCREEN px is known from the pivot.
    // Clamp that anchor inside the viewport and carry the correction back into
    // world space.
    if (this.#world && this.#app) {
      const screen = this.#app.renderer.screen
      const anchor = this.#world.toGlobal(bee.thought.position, undefined, true)
      const halfWidth = width / 2
      const minX = screen.x + THOUGHT_EDGE_PX + halfWidth
      const maxX = screen.x + screen.width - THOUGHT_EDGE_PX - halfWidth
      const minY = below
        ? screen.y + THOUGHT_EDGE_PX
        : screen.y + THOUGHT_EDGE_PX + height + THOUGHT_TAIL_PX
      const maxY = below
        ? screen.y + screen.height - THOUGHT_EDGE_PX - height - THOUGHT_TAIL_PX
        : screen.y + screen.height - THOUGHT_EDGE_PX
      anchor.x = maxX >= minX ? Math.min(Math.max(anchor.x, minX), maxX) : (minX + maxX) / 2
      anchor.y = maxY >= minY ? Math.min(Math.max(anchor.y, minY), maxY) : (minY + maxY) / 2
      const local = this.#world.toLocal(anchor)
      bee.thought.position.set(local.x, local.y)
    }
    bee.thought.alpha = Math.min(0.92, bee.alpha) * bee.dim * (0.88 + 0.12 * Math.sin(this.#time * 1.4))
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
    bee.badge.alpha = bee.alpha * bee.dim * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(this.#time * 2.2)))
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
        alpha: bee.alpha * bee.dim * (hovered ? 0.5 : 0.17),
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
   *  target is the same size at any zoom.
   *
   *  THE TILE OWNS ITS OWN AIR. Over a tile, only the bee's BODY answers: the
   *  waggle area is a courtesy for aiming at a bee dancing in the open, and a
   *  courtesy that swallows presses meant for the hexagon underneath is how a
   *  bee gets in the way of the work (Jaime, 2026-09-09: "the agents are in
   *  the way of the tile operations"). The body is generous and the bee holds
   *  still under the cursor, so nothing is lost by aiming at the bee itself. */
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
    return onBee || (this.#tileUnderPointer ? '' : inArea)
  }

  #onPointerDown = (event: PointerEvent): void => {
    if (this.#hiveHidden) return
    // A press ends any scribble in progress, wherever it lands: what follows
    // is a pan, a selection or a carry, and none of them is a sweep.
    this.#scrub.clear()

    const id = this.#hitTest(event.clientX, event.clientY)
    if (!id) return
    // Take the whole gesture: no pan, no tile navigation, no selection.
    event.stopPropagation()
    event.preventDefault()
    this.#swallowPointer = event.pointerId
    this.#setHover('')

    // THE PRESS IS NOT YET AN OPEN. A bee dances over the tile it is working
    // on, and that tile is sometimes the one you are trying to read — so the
    // same press can instead PULL THE BEE OUT OF THE WAY. Which it is, is
    // decided by travel (bee-drag.ts): a still press opens the request when it
    // is released, a moving one carries the bee.
    const bee = this.#bees.get(id)
    const local = this.#toWorld(event.clientX, event.clientY)
    this.#press = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      grabX: bee && local ? local.x - bee.centreX : 0,
      grabY: bee && local ? local.y - bee.centreY : 0,
      dragging: false,
      trail: [],
    }
    // CAUGHT. A bee taken hold of mid-slide stops sliding — the hand has it.
    this.#glides.delete(id)
  }

  /** Open the request the press landed on. Reached from the RELEASE, because
   *  the press itself may still turn into a drag. */
  #openBee = (id: string): void => {
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
      // Perching is itself a "get out of the way", and it names the place: the
      // corner. Any earlier nudge is spent — it would only push the watcher
      // back off the corner it was just sent to.
      this.#nudges.delete(id)
      this.#glides.delete(id)
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
    // THE RELEASE IS WHERE THE PRESS IS SPENT: put the bee down, or open it.
    // A PRESS THAT MOVED NOTHING IS A CLICK. The threshold alone cannot carry
    // that promise — a hand still travelling when the button goes down would
    // spend the press on a drag that ends where it started, and the request
    // would never open. So the release asks what actually happened: the bee is
    // somewhere else now (a drag), or it is exactly where it was (a click).
    const press = this.#press
    this.#press = null
    if (press && (!press.dragging || this.#endDrag(press, event.timeStamp || Date.now()))) this.#openBee(press.id)
    event.stopPropagation()
    event.preventDefault()
  }

  /** A cancelled pointer (a touch taken over by the browser, a lost capture)
   *  ends the press where it stands. Without this the bee would keep following
   *  a pointer that is no longer pressing anything. */
  #onPointerCancel = (event: PointerEvent): void => {
    const press = this.#press
    if (!press || press.pointerId !== event.pointerId) return
    this.#press = null
    this.#swallowPointer = null
    if (press.dragging) this.#endDrag(press, event.timeStamp || Date.now())
  }

  #onPointerMove = (event: PointerEvent): void => {
    if (this.#press && this.#press.pointerId === event.pointerId) { this.#drag(event); return }
    if (this.#hiveHidden) { this.#setHover(''); return }
    // THE BROOM. Scribbling over a patch of hive with nothing pressed sweeps
    // the bees in it out to the wall — and scribbling over swept bees sends
    // them back to their work. Only with no button down: a press already
    // means pan, select or carry, and a gesture must never mean two things.
    if (event.buttons === 0) {
      const at = this.#scrub.feed(event.clientX, event.clientY, event.timeStamp || Date.now())
      if (at) this.#sweep(at)
    } else {
      this.#scrub.clear()
    }
    const id = this.#hitTest(event.clientX, event.clientY)
    this.#setHover(id, event.clientX, event.clientY)
  }

  /** SWEEP THE PATCH. Every bee dancing near the scribble goes out to the wall
   *  along the line from the broom, as a NUDGE — the same displacement a drag
   *  writes, so a swept bee holds its place through a pan and a zoom, comes
   *  home when it is dropped back, and mints nothing.
   *
   *  The same gesture is the way back: when everything the broom can reach has
   *  already been swept, scrubbing sends it home instead. One gesture, both
   *  directions, and no memory of which is which — the bees' own state says. */
  #sweep = (at: { x: number; y: number }): void => {
    if (!this.#app || !this.#world) return
    const rect = this.#canvas?.getBoundingClientRect()
    if (rect && (at.x < rect.left || at.x > rect.right || at.y < rect.top || at.y > rect.bottom)) return

    const worldScale = this.#world.scale.x || 1
    const hover = HOVER_PX / worldScale
    const reach = SWEEP_REACH_PX * SWEEP_REACH_PX
    // The scribble, in the same screen space the bees are measured in.
    this.#app.renderer.events.mapPositionToPoint(this.#probe, at.x, at.y)
    const broom = { x: this.#probe.x, y: this.#probe.y }

    const reached: BeeSprite[] = []
    for (const bee of this.#bees.values()) {
      if (bee.alpha < 0.25 || bee.id === this.#perched) continue
      const screen = this.#world.toGlobal(new Point(bee.centreX, bee.centreY), undefined, true)
      const dx = screen.x - broom.x
      const dy = screen.y - broom.y
      if (dx * dx + dy * dy > reach) continue
      reached.push(bee)
    }
    if (!reached.length) return

    // Already all out of the way? Then this scribble means "come back".
    if (reached.every(bee => this.#nudges.has(bee.id))) {
      for (const bee of reached) { this.#nudges.delete(bee.id); this.#glides.delete(bee.id) }
      this.emitEffect('toast:show', { type: 'tip', message: this.#word('bees.swept-back', 'Back on the work.') })
      return
    }

    const room = this.#theRoom()
    for (const bee of reached) {
      if (this.#nudges.has(bee.id)) continue
      const from = this.#world.toGlobal(new Point(bee.centreX, bee.centreY), undefined, true)
      const to = sweptAsideTo({ x: from.x, y: from.y }, { x: broom.x, y: broom.y }, room, BEE_EDGE_PX)
      const local = this.#world.toLocal(new Point(to.x, to.y))
      this.#glides.delete(bee.id)
      this.#nudges.set(bee.id, {
        x: local.x - bee.anchorX,
        y: local.y - (bee.anchorY - hover),
      })
    }
    this.emitEffect('toast:show', {
      type: 'tip',
      message: this.#word('bees.swept', 'Swept aside — scribble over them again to bring them back.'),
    })
  }

  /** A line in the participant's language, or the English it was written in.
   *  Neither line counts the bees: there is no plural machinery behind `t`,
   *  and a sentence that is true for one bee and for five needs none. */
  #word = (key: string, fallback: string): string => {
    const said = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key)
    return said && said !== key ? said : fallback
  }

  /** Carry the pressed bee with the pointer, once the press has travelled far
   *  enough to be a drag. Below the threshold nothing moves at all, so a click
   *  that wobbles by a pixel still opens the request. */
  #drag = (event: PointerEvent): void => {
    const press = this.#press
    if (!press) return
    if (!press.dragging) {
      if (!isDrag(event.clientX - press.startX, event.clientY - press.startY)) return
      press.dragging = true
      if (this.#canvas) this.#canvas.style.cursor = 'grabbing'
    }
    // The hand's recent path, for the throw. Kept short: the speed wanted is
    // the speed AT the release, not the average of the whole drag.
    const at = event.timeStamp || Date.now()
    press.trail.push({ x: event.clientX, y: event.clientY, t: at })
    while (press.trail.length && at - press.trail[0].t > TOSS_WINDOW_MS * 2) press.trail.shift()
    const bee = this.#bees.get(press.id)
    const local = this.#toWorld(event.clientX, event.clientY)
    if (!bee || !local) return
    const hover = HOVER_PX / (this.#world?.scale.x || 1)
    this.#nudges.set(press.id, nudgeFrom(
      local,
      { x: press.grabX, y: press.grabY },
      { x: bee.anchorX, y: bee.anchorY - hover },
    ))
  }

  /** Let go, and say whether the bee ended up HOME. A bee dropped back where
   *  its work put it takes its old place again — putting it back is how a
   *  nudge is undone, and no command is needed for it — and, because nothing
   *  was moved, that release is still a click.
   *
   *  THE TOSS. Let go while the hand is still moving, the bee is not dropped
   *  but THROWN: it keeps going the way it was thrown and slows to a stop,
   *  like a stone on ice (bee-drag.ts). A thrown bee is nowhere yet, so the
   *  release is not a click, and home is judged where it stops (#slide). */
  #endDrag = (press: BeePress, at: number): boolean => {
    if (this.#canvas?.style.cursor === 'grabbing') this.#canvas.style.cursor = ''
    const nudge = this.#nudges.get(press.id)
    const thrown = nudge ? releaseVelocity(press.trail, at) : null
    if (thrown) {
      this.#glides.set(press.id, thrown)
      return false
    }
    const home = !nudge || snapsHome(nudge, this.#world?.scale.x || 1)
    if (home) this.#nudges.delete(press.id)
    // TRUE = the bee is back where its work put it, so nothing was moved and
    // the press is still a press: the release opens the request.
    return home
  }

  /** THE SLIDE — every thrown bee, one frame on. The nudge advances by the
   *  velocity (screen px/s, brought into world units here so the throw reads
   *  the same at any zoom), friction takes its share, and the wall is where
   *  it stops: a stone that reaches the boards stays at the boards. Only once
   *  it has stopped is the release judged — a bee that slid back onto its
   *  work goes home, exactly as a dropped one would. */
  #slide = (dt: number): void => {
    if (!this.#glides.size || !this.#world) return
    const worldScale = this.#world.scale.x || 1
    const hover = HOVER_PX / worldScale
    const room = this.#theRoom()
    const minX = room.left + BEE_EDGE_PX
    const maxX = room.right - BEE_EDGE_PX
    const minY = room.top + BEE_EDGE_PX
    const maxY = room.bottom - BEE_EDGE_PX
    for (const [id, velocity] of this.#glides) {
      const bee = this.#bees.get(id)
      const nudge = this.#nudges.get(id)
      if (!bee || !nudge) { this.#glides.delete(id); continue }
      let next: Nudge = {
        x: nudge.x + velocity.x * dt / worldScale,
        y: nudge.y + velocity.y * dt / worldScale,
      }
      let remaining = slowed(velocity, dt)
      // The wall, measured on screen like the room itself.
      const point = this.#world.toGlobal(
        new Point(bee.anchorX + next.x, bee.anchorY - hover + next.y), undefined, true)
      const x = Math.min(Math.max(point.x, minX), maxX)
      const y = Math.min(Math.max(point.y, minY), maxY)
      if (x !== point.x || y !== point.y) {
        const local = this.#world.toLocal(new Point(x, y))
        next = { x: local.x - bee.anchorX, y: local.y - (bee.anchorY - hover) }
        remaining = { x: 0, y: 0 }
      }
      this.#nudges.set(id, next)
      if (remaining.x === 0 && remaining.y === 0) {
        this.#glides.delete(id)
        if (snapsHome(next, worldScale)) this.#nudges.delete(id)
      } else {
        this.#glides.set(id, remaining)
      }
    }
  }

  /** A client-space point in world coordinates, or null before the host is up.
   *  The same mapping `#hitTest` uses, so a grab lands where the hit did. */
  #toWorld = (clientX: number, clientY: number): { x: number; y: number } | null => {
    if (!this.#app || !this.#world) return null
    this.#app.renderer.events.mapPositionToPoint(this.#probe, clientX, clientY)
    const local = this.#world.toLocal(this.#probe)
    return { x: local.x, y: local.y }
  }

  #setHover = (id: string, clientX = 0, clientY = 0): void => {
    if (!id) {
      const wasHovering = this.#hovering !== ''
      this.#hovering = ''
      if (this.#tooltip) this.#tooltip.style.display = 'none'
      // Let go only of the hand THIS drone put up. Every pointer move with no
      // bee under it lands here, and the canvas's hand is shared — the docked
      // tile editor shows one over the tiles it can move to.
      if (wasHovering && this.#canvas && this.#canvas.style.cursor === 'pointer') this.#canvas.style.cursor = ''
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
      window.removeEventListener('pointercancel', this.#onPointerCancel, true)
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
