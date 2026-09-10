// assistant/agent-log-action.drone.ts
//
// THE DOOR THE BEE WAS — the tile icon that appears while the agents are
// HIDDEN.
//
// Pressing a bee is how an agent's window opens: its report while it works,
// what was said in it once the talk is over (agent-panel.view.ts). Hiding the
// agents takes the bees off the hive — and took the door with them. The work
// was still running and the conversations were all still there; there was
// simply no longer anywhere to press (Jaime, 2026-09-10: "When the agents are
// hidden can we get a menu icon on the tile overlay to show the agent
// window?").
//
// So the affordance MOVES rather than doubling: while the bees are flying they
// are the door, and this icon is not registered at all; while they are hidden
// the tile carries it. One door at a time, and never two ways to do the same
// thing on screen at once.
//
// ONLY ON TILES THAT HAVE ONE. The icon is not a feature of every hexagon —
// it is the bee that would have been dancing there, so it appears exactly
// where a bee would have appeared: on a tile some agent names as its target,
// working or resting. That is the same rule the bee drone anchors by
// (`#anchorFor`): a targeted bee sits over its tile when that tile is painted
// on this layer, and nowhere else.
//
// A HIVE-WIDE agent (no tile targets) has no tile to hang an icon on. It
// dances in the open at the root, and while the agents are hidden it is
// reached the way it always was — through the orchestrator's watch.

import { Drone } from '@hypercomb/core'
import type { Agent, AgentRegistry } from './agent-registry.service.js'
import { MOBILE_MODE_EFFECT } from '../preferences/mobile-pheromones.js'
import type {
  OverlayActionDescriptor, OverlayProfileKey, OverlayTileContext,
} from '../presentation/tiles/tile-overlay.drone.js'

/** A speech bubble with the line of a report inside it. Deliberately NOT the
 *  tray-with-a-plus the chat shelf wears (chat-context-action.drone.ts): that
 *  one PUTS a tile into a request, this one OPENS what an agent has to say
 *  about this tile, and two icons that mean different things must not read as
 *  the same icon. */
const AGENT_LOG_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8"/><path d="M8 12.5h5"/></svg>'

const OWNER = '@diamondcoreprocessor.com/AgentLogActionDrone'
const ACTION = 'agent-log'

/** Everywhere a bee can fly. A bee is drawn over its target tile wherever that
 *  tile is painted — your own hive, somebody else's, the world — so the door
 *  that replaces it belongs on all of them. */
const PROFILES: readonly OverlayProfileKey[] =
  ['private', 'public-own', 'public-external', 'world']

/** Steel — the assistant's colour, worn by the chat window, the bees' own
 *  waggle trace and the agent panel. Lit when there is LIVE work on the tile,
 *  so "something is running here" is one colour across the whole hive. */
const WORKING_TINT = 0x7eb6d6

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

const registry = (): AgentRegistry | undefined =>
  ioc<AgentRegistry>('@diamondcoreprocessor.com/AgentRegistry')

/** Is this agent live work, rather than a conversation that has ended? */
const isRunning = (agent: Agent): boolean =>
  agent.status === 'pending' || agent.status === 'working' || agent.status === 'blocked'

/**
 * THE AGENT WHOSE WINDOW THIS TILE'S ICON OPENS, or undefined for a tile no
 * agent names.
 *
 * WORK BEFORE TALK, and the NEWEST of either: a tile can carry several — a
 * question out right now, and three conversations from last week — and the
 * one press has to land on the one you meant. What is running wins, because a
 * tile with something happening on it is being pressed to see what is
 * happening on it.
 *
 * Module scope, so the descriptor's `visibleWhen` and `tintWhen` can ask it
 * without dragging this drone into the overlay's render path.
 */
const agentOn = (label: string): Agent | undefined => {
  const lanes = registry()
  if (!label || !lanes) return undefined
  const newest = (agents: readonly Agent[]): Agent | undefined =>
    agents
      .filter(agent => agent.targets.includes(label))
      .sort((a, b) => (b.updatedAt || b.startedAt) - (a.updatedAt || a.startedAt))[0]
  const working = (lanes.list() ?? []).filter(isRunning)
  return newest(working) ?? newest(lanes.resting() ?? [])
}

const descriptorFor = (profile: OverlayProfileKey): OverlayActionDescriptor => ({
  name: ACTION,
  owner: OWNER,
  svgMarkup: AGENT_LOG_SVG,
  x: -2,
  y: -7,
  hoverTint: WORKING_TINT,
  profile,
  labelKey: 'action.agent-log',
  descriptionKey: 'action.agent-log.description',
  visibleWhen: (ctx: OverlayTileContext) => !!agentOn(ctx.label),
  tintWhen: (ctx: OverlayTileContext) => {
    const agent = agentOn(ctx.label)
    return agent && isRunning(agent) ? WORKING_TINT : null
  },
})

const DESCRIPTORS: OverlayActionDescriptor[] = PROFILES.map(descriptorFor)

export class AgentLogActionDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  override description =
    'agent-window icon on tiles that have an agent, while the agents are hidden'

  protected override listens = [
    'render:set-agents-visible', 'overlay:request-register', 'tile:action', MOBILE_MODE_EFFECT,
  ]
  protected override emits = [
    'overlay:register-action', 'overlay:unregister-action', 'agent:open',
  ]

  #bound = false
  /** Are the bees off the hive? The controls bar restores the participant's
   *  choice before the renderer mounts and EffectBus replays the last value,
   *  so a late drone learns the truth without asking. */
  #hidden = false
  /** On a phone there are no agents — no bees and no door either. */
  #mobile = false

  /** Is the icon offered right now? Public because "is this affordance on the
   *  tiles" is a question other surfaces ask — the close-up screen and the
   *  tile brief build their lists from the same registry — and because it is
   *  the only honest way to read this state on a headless renderer, where no
   *  cell is painted and the overlay knows no labels to be asked about. */
  get armed(): boolean { return this.#hidden && !this.#mobile }

  /** The agent a press on this tile would open. Public for the same reason. */
  agentFor(label: string): Agent | undefined { return agentOn(label) }

  protected override heartbeat = async (): Promise<void> => {
    if (this.#bound) return
    this.#bound = true

    this.onEffect<{ visible?: boolean }>('render:set-agents-visible', payload => {
      const hidden = payload?.visible === false
      if (hidden === this.#hidden) return
      this.#hidden = hidden
      this.#apply()
    })

    this.onEffect<{ active?: boolean }>(MOBILE_MODE_EFFECT, payload => {
      const mobile = payload?.active === true
      if (mobile === this.#mobile) return
      this.#mobile = mobile
      this.#apply()
    })

    // The overlay re-asks after a remount. Answering only while the agents are
    // hidden is what keeps the icon off the tiles while the bees are flying.
    this.onEffect('overlay:request-register', () => { this.#apply() })

    this.onEffect<TileActionPayload>('tile:action', payload => {
      if (payload?.action !== ACTION) return
      this.press(String(payload?.label ?? ''))
    })
  }

  /** Open this tile's agent window by tile NAME — the same public shape the
   *  overlay offers (`invokeActionForTile`), and for the same reason: the icon
   *  band is not the only thing that can press an affordance. */
  press(label: string): void {
    const agent = this.#mobile ? undefined : agentOn(label)
    if (!agent) return
    this.emitEffect('agent:open', { id: agent.id })
  }

  #apply(): void {
    if (this.armed) { this.emitEffect('overlay:register-action', DESCRIPTORS); return }
    // Profile-aware removal: the name lives in four orders and each has to be
    // spliced by its own profile, or the wrong one keeps an icon.
    for (const profile of PROFILES) {
      this.emitEffect('overlay:unregister-action', { name: ACTION, profile })
    }
  }
}

window.ioc.register(OWNER, new AgentLogActionDrone())
