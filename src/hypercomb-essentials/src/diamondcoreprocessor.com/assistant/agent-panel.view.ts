// diamondcoreprocessor.com/assistant/agent-panel.view.ts
//
// AGENT PANEL — click a bee, read what it is doing.
//
// Opened by the `agent:open` effect (agent-bee.drone.ts). Shows one agent:
// which behaviour is flying, what was asked, where the answer will land, and
// the running activity the responder reports over the bridge.
//
// READ-ONLY, ON PURPOSE. This window is a LOG — an account of a tile that the
// participant and the orchestrator both come past to read. It used to carry a
// text box ("add context while it works"), which made it a second, worse place
// to talk: a composer with no thread behind it, no history, and no way to see
// what it had already said. There is one place to talk to a tile and it is the
// chat window, so the corner button opens THAT, on this tile's conversation.
//
// A panel, not a takeover: the hive stays visible and navigable behind it.
// Native form controls own their keyboard events; the panel must not lock the
// hive's pointer navigation merely because its text box is available.
//
// Cold chrome, DOM singleton, no Angular — the same shape as ask-screen.view.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { Agent, AgentRegistry } from './agent-registry.service.js'
// TYPE-ONLY, deliberately. Importing a value from the orchestrator drone would
// inline it into this bundle and mint a second IoC registration for it; the
// panel reaches it structurally through IoC instead.
import type { OrchestratorFinding, OrchestratorSummary } from './orchestrator.drone.js'
import { avatarKeyOf, type AgentAvatarRegistry } from '../presentation/avatars/agent-avatar.js'
import { restingConvoId } from '../presentation/avatars/resting-bees.js'
import { BEE_PERSONALITY_CHANGED, personaFor, resetPersona, savePersona, type BeePersona } from '../presentation/avatars/bee-personality.js'
import { banterReferencesFor, cachedBanterFor } from '../presentation/avatars/bee-banter-cache.js'
import { readBlurb, type ChatBlurb } from './chat-blurb.js'
import { tileConvoId } from './chat-thread.js'

const STYLE_ID = 'hc-agent-panel-styles'
const STEEL = '126, 182, 214'
const WIDTH_KEY = 'hc:agent-panel-width'
const MIN_WIDTH = 320
/** ONE PIXEL RIGHT, SO THE BORDERS DO NOT FIGHT. Flush against the control
 *  bar's reservation, this window's 1px border lands exactly on the bar's own
 *  border — two lines in one place, and the bar's read as covered. Tucked a
 *  pixel further right the window slides UNDER the bar's edge (it sits below
 *  the bar's z-band), so what you see there is the bar's border and nothing
 *  else. */
const BORDER_TUCK = 1
/** And between it and the next window inboard, so two docked windows read as
 *  two windows rather than one seam. */
const LANE_GAP = 8

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** A place on a screen edge, offered by the shell over IoC
 *  (hypercomb-shared/ui/docked-panel/dock-lanes.ts). Structural, because a
 *  module may not import from shared — and it does not need to: the lane only
 *  ever asks a window four things.
 *
 *  WHY THE PANEL TAKES A PLACE AT ALL. Every tool window on the right edge
 *  stacks inward from the control bar, which publishes what it occupies as
 *  `--hc-controls-right` so it is never covered. This window sat on the same
 *  edge WITHOUT taking a slot: open the notes window and the two were one on
 *  top of the other, the bar respected by one of them and not the other. In
 *  the lane it is pushed inboard as another window opens, and slides back to
 *  the edge as one closes — the same as everything else docked there. */
type LaneMemberLike = {
  readonly laneId: string
  readonly laneSide: 'left' | 'right'
  laneWidth(): number
  placeInLane(offset: number): void
  evictFromLane(): void
  returnToLane(): void
}
type DockLanesLike = {
  claim(member: LaneMemberLike): void
  release(member: LaneMemberLike): void
  reflow(): void
}

const dockLanes = (): DockLanesLike | undefined =>
  ioc<DockLanesLike>('@hypercomb.social/DockLanes')

/** What the panel needs of the orchestrator, described where it is used. */
type OrchestratorLike = {
  summary?: () => OrchestratorSummary
  readonly held?: OrchestratorFinding
  hold?: (key: string) => OrchestratorFinding | undefined
  release?: () => void
  complete?: () => Promise<string>
}

const orchestratorDrone = (): OrchestratorLike | undefined =>
  ioc<OrchestratorLike>('@diamondcoreprocessor.com/OrchestratorDrone')

const navigation = (): { goRaw?: (segments: readonly string[]) => void } | undefined =>
  ioc<{ goRaw?: (segments: readonly string[]) => void }>('@hypercomb.social/Navigation')

const elapsed = (since: number): string => {
  const seconds = Math.max(0, Math.round((Date.now() - since) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.round(minutes / 60)}h`
}

export class AgentPanelView extends EventTarget {
  #panel: HTMLDivElement | null = null
  #id = ''
  #body: HTMLDivElement | null = null
  /** Blurbs already read, by conversation. `#render` runs on every registry
   *  change; without this the log would blink out and re-read each time
   *  anything anywhere in the hive reported progress. */
  #blurbs = new Map<string, ChatBlurb | null>()
  #stopButton: HTMLButtonElement | null = null
  #registry: AgentRegistry | undefined
  #expandedActivity = new Set<string>()
  #resizeCleanup: (() => void) | null = null
  /** How far inboard of the control bar the lane has put this window. */
  #laneOffset = 0
  /** Last measured width, so a rebuild never publishes zero to the lane. */
  #laneWidth = MIN_WIDTH
  /** Where "back" goes — the agent this panel was opened FROM, when the
   *  participant stepped into one agent's log out of the orchestrator's
   *  report. '' when the panel was opened directly from a bee. */
  #returnTo = ''
  /** True while swapping subject between agents. The panel is not closing, so
   *  it must not announce that it is: `agent:closed` puts the perched bee down
   *  and clears the audit view, and stepping into a log is not leaving. */
  #swapping = false

  #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.#panel) return
    event.stopPropagation()
    this.close()
  }

  constructor() {
    super()
    EffectBus.on<{ id?: string; from?: string }>('agent:open', payload => {
      const id = String(payload?.id ?? '')
      if (!id) return
      // Some agents have their OWN window, and opening them must not touch
      // this panel at all: routed here, before the step/open split, a click
      // from inside the orchestrator's report leaves the report standing and
      // simply raises the agent's window over it. Routed inside `open()` it
      // would close the report first — the audit you were reading, dismantled
      // by the thing it pointed you at.
      const agent = ioc<AgentRegistry>('@diamondcoreprocessor.com/AgentRegistry')?.find(id)
      if (agent?.behavior === 'folder-sync') {
        EffectBus.emit('folder-sync:open', { agentId: id })
        return
      }
      // LAST RESORT for a `chat:<convoId>` id with NO record in either lane —
      // a press that lands before the resting derivation has run, say. The
      // panel has nothing to render, and returning would be a bee that
      // answers a click with silence, so the window that holds the talk gets
      // it instead.
      if (!agent && id.startsWith('chat:')) {
        EffectBus.emit('chat:open', { convoId: id.slice('chat:'.length) })
        return
      }
      // `from` means "opened out of that agent" — today, clicking a bee inside
      // the orchestrator's gathered view. It has to be a STEP, not a fresh
      // open: a fresh one closes the panel first, and `agent:closed` puts the
      // perch and the audit view down, so opening a bee would dismantle the
      // view you clicked it in.
      const from = String(payload?.from ?? '')
      if (from && from !== id) { this.#stepTo(id, from); return }
      this.open(id)
    })
    // Closed from outside — pressing a perched bee a second time puts its
    // panel down the same way its × would.
    //
    // `#returnTo` counts as well: stepping out of the orchestrator's gathered
    // view into one agent's log is a TRIP, and putting the view down ends the
    // trip. Left open, that log would still be offering "‹ Back to the
    // orchestrator" after the orchestrator had unperched and its view had
    // cleared — a way back to somewhere that is no longer there.
    EffectBus.on<{ id?: string }>('agent:close', payload => {
      const id = String(payload?.id ?? '')
      if (id && (this.#id === id || this.#returnTo === id)) this.close()
    })
    // Joining a swarm takes LOCAL agents out of sight (agent-bee.drone.ts):
    // their bees fade out, so a report left open would be a report on an
    // agent with nothing behind it — and, once closed, no bee left to reopen
    // it from. An agent that belongs to the swarm is a different matter: its
    // bee keeps flying, so its panel stays up.
    EffectBus.on<{ public?: boolean }>('mesh:public-changed', payload => {
      if (payload?.public !== true || !this.#panel) return
      const agent = this.#registry?.find(this.#id)
      if ((agent?.origin ?? 'local') === 'local') this.close()
    })
    // The report is live. Findings clear on their own when work recovers, and
    // the orchestrator's running commentary lands on its own clock — neither
    // touches the agent registry, so without this the open panel would sit
    // there showing a state that has already passed.
    EffectBus.on('orchestrator:findings', () => {
      if (this.#panel && this.#registry?.get(this.#id)?.kind === 'orchestrator') this.#render()
    })
  }

  // ── LaneMember ─────────────────────────────────────────────────────
  // Four methods and no framework. The lane calls these; nothing here knows
  // what else is docked, which is the point of letting the lane place it.

  readonly laneId = 'agent-panel'
  readonly laneSide = 'right' as const

  /** What the window inboard of this one is offset by. Measured, because the
   *  participant can drag this panel wider and the one beside it has to move
   *  with it. */
  laneWidth(): number {
    // Remembered across a SWAP: the panel's DOM is rebuilt between the close
    // and the open, and a window asking the lane for room in that gap would be
    // told this one is 0 wide and land on top of it.
    const live = this.#panel?.getBoundingClientRect().width ?? 0
    if (live) this.#laneWidth = live
    return this.#laneWidth + LANE_GAP
  }

  /** Sit this far in from the edge. Written as a `calc` over the control bar's
   *  own reservation rather than a resolved number, so a bar that docks,
   *  undocks or changes width moves the window with it and never ends up
   *  underneath it. */
  placeInLane(offset: number): void {
    this.#laneOffset = Math.max(0, Math.round(offset))
    if (this.#panel) {
      this.#panel.style.right = `calc(var(--hc-controls-right, 0px) + ${this.#laneOffset - BORDER_TUCK}px)`
    }
  }

  /** Pushed out of a full lane. A parked window keeps its content and comes
   *  back; this one has nothing staged and nothing unsaved — it is a reading
   *  window over a record that is still there — so closing IS the park, and
   *  pressing the bee again brings back exactly what was on screen. */
  evictFromLane(): void { this.close() }

  /** Nothing to unpark: see evictFromLane. */
  returnToLane(): void { /* the bee is the way back */ }

  #t(key: string, fallback: string): string {
    const value = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key)
    return value && value !== key ? value : fallback
  }

  open(id: string): void {
    // Clicking a second bee swaps the panel's subject rather than stacking.
    if (this.#panel && this.#id === id) return
    if (this.#panel) this.close()

    this.#registry = ioc<AgentRegistry>('@diamondcoreprocessor.com/AgentRegistry')
    // EITHER LANE. A resting bee — a tile that has been talked to, with
    // nothing running on it — is an agent this panel can open; `get` alone
    // returned undefined and left the press showing nothing at all.
    const agent = this.#registry?.find(id)
    if (!agent) return
    // Own-window agents (folder-sync) are routed by the `agent:open` handler
    // and by #swap before this runs — this is the last resort for a direct
    // caller, kept so the generic panel can never open on one of them.
    if (agent.behavior === 'folder-sync') {
      EffectBus.emit('folder-sync:open', { agentId: id })
      return
    }

    this.#id = id
    this.#ensureStyles()

    const panel = document.createElement('div')
    panel.className = 'hc-agent'
    const savedWidth = Number.parseFloat(localStorage.getItem(WIDTH_KEY) ?? '')
    if (Number.isFinite(savedWidth)) panel.style.width = `${Math.max(MIN_WIDTH, savedWidth)}px`
    // Where the lane last had it, so the panel paints in its place rather than
    // at the edge and then jumping inboard on the next frame.
    panel.style.right = `calc(var(--hc-controls-right, 0px) + ${this.#laneOffset - BORDER_TUCK}px)`

    const resize = document.createElement('div')
    resize.className = 'hc-agent-resize'
    resize.title = this.#t('agent.resize', 'Drag to resize')
    resize.setAttribute('aria-hidden', 'true')
    resize.addEventListener('pointerdown', event => this.#beginResize(event))

    const head = document.createElement('div')
    head.className = 'hc-agent-head'
    // Stepping into an agent's log from the report is a trip you can come back
    // from. Without this the only way out is closing the panel, which also
    // puts the perch and the audit view down — losing the audit you were
    // halfway through reading.
    if (this.#returnTo && this.#returnTo !== id) {
      const back = document.createElement('button')
      back.type = 'button'
      back.className = 'hc-agent-back'
      back.textContent = '‹'
      const label = this.#t('agent.back', 'Back to the orchestrator')
      back.title = label
      back.setAttribute('aria-label', label)
      back.addEventListener('click', () => this.#swap(this.#returnTo))
      head.appendChild(back)
    }
    const avatar = document.createElement('img')
    avatar.className = 'hc-agent-avatar'
    avatar.alt = ''
    avatar.src = ioc<AgentAvatarRegistry>('@diamondcoreprocessor.com/AgentAvatarRegistry')
      ?.imageUrl(avatarKeyOf(agent), 96, agent.kind) ?? ''
    const title = document.createElement('div')
    title.className = 'hc-agent-title'
    // The name is its own element so it can ellipsise on its own line — a bare
    // text node in a column stack overflows the box instead of clipping.
    const name = document.createElement('span')
    name.className = 'hc-agent-name'
    name.textContent = agent.kind === 'model' ? (agent.model ?? agent.behavior) : agent.behavior
    title.appendChild(name)
    // What SORT of worker this is — the same thing the bee's dance and its
    // mark are saying, spelled out. For a model that means the VENDOR, which
    // is the colour family it is flying.
    const kind = document.createElement('span')
    kind.className = 'hc-agent-kind'
    // The tier is dropped when the NAME above is already saying it — "opus"
    // over "anthropic · opus" is the same word twice, and the line under a
    // name is for what the name does not tell you.
    const tier = agent.tier && agent.tier !== name.textContent ? ` · ${agent.tier}` : ''
    kind.textContent = agent.kind === 'model' && agent.vendor
      ? `${agent.vendor}${tier}`
      : this.#t(`agent.kind.${agent.kind}`, agent.kind)
    title.appendChild(kind)
    // WHAT THE CORNER HOLDS: the way to the talk. This window only ever
    // reads, so the one thing it owes the participant is a door to the place
    // where they can answer — that tile's conversations, in the chat window.
    const corner = this.#conversationsButton(agent)
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'hc-agent-close'
    close.textContent = '×'
    close.setAttribute('aria-label', this.#t('agent.close', 'Close'))
    close.addEventListener('click', () => this.close())
    head.append(avatar, title, corner, close)

    // STOP — the way out for work that cannot finish. Closing the panel only
    // hides it; this takes the request out of the pool so nothing picks it up
    // again. Shown only while there is something left to stop.
    const stop = document.createElement('button')
    stop.type = 'button'
    stop.className = 'hc-agent-btn hc-agent-stop'
    stop.textContent = this.#t('agent.stop', 'Stop')
    stop.title = this.#t('agent.stop-hint', 'Stop this work and clear it from the hive')
    stop.addEventListener('click', () => { void this.#stop(stop) })
    this.#stopButton = stop

    const body = document.createElement('div')
    body.className = 'hc-agent-body'
    this.#body = body

    // Stop is the only control a reading window keeps: work that cannot
    // finish has to be stoppable from where you found out about it, and there
    // is nowhere else to do it. Hidden unless there is something to stop.
    const actions = document.createElement('div')
    actions.className = 'hc-agent-actions'
    actions.appendChild(stop)

    const main = document.createElement('div')
    main.className = 'hc-agent-main'
    main.append(head, body, actions)

    panel.append(resize, main)
    document.body.appendChild(panel)
    this.#panel = panel

    this.#render()
    // A SWAP KEEPS THE PLACE. Stepping from the orchestrator's report into one
    // agent's log rebuilds this panel's DOM, and re-claiming would put it back
    // at the edge — over the window it was sitting beside a moment ago.
    if (!this.#swapping) dockLanes()?.claim(this)
    this.#registry?.addEventListener('change', this.#render)
    document.addEventListener('keydown', this.#onKey, true)
  }

  #render = (): void => {
    const body = this.#body
    if (!body) return
    const agent = this.#registry?.find(this.#id)
    // AT REST IS NOT RUNNING. The record says `working` because that is what
    // keeps the bee dancing, so the status field alone would offer a Stop
    // button for work that does not exist.
    const resting = this.#registry?.isResting(this.#id) ?? false
    const running = !resting
      && (agent?.status === 'pending' || agent?.status === 'working' || agent?.status === 'blocked')
    if (this.#stopButton) this.#stopButton.hidden = !running
    if (!agent) {
      // The agent finished and its record has been retired — say so rather
      // than leaving a panel describing something that no longer exists.
      body.textContent = ''
      const gone = document.createElement('div')
      gone.className = 'hc-agent-dim'
      gone.textContent = this.#t('agent.gone', 'This agent has finished.')
      body.appendChild(gone)
      return
    }

    body.textContent = ''
    if (resting) { this.#renderResting(body, agent); return }
    body.append(this.#statusRow(agent))
    // The orchestrator's panel is a REPORT, not a request. Its own "where" is
    // the whole hive and its own "request" is a sentence nobody needs twice —
    // what belongs at the top is the state of everything it watches.
    const overview = agent.kind === 'orchestrator' ? this.#overview() : null
    if (overview) body.appendChild(overview)
    else {
      body.append(
        this.#whereRow(agent),
        this.#section(this.#t('agent.request', 'The request'), agent.request || '—'),
      )
    }
    if (agent.kind === 'model') body.appendChild(this.#personality(agent))
    body.appendChild(this.#activity(agent))
    if (agent.context.length) {
      body.appendChild(this.#section(
        this.#t('agent.context-added', 'Context you added'),
        agent.context.join('\n\n'),
      ))
    }
  }

  /** THE HIVE, IN ONE READ — what the orchestrator has to say when you open it.
   *  A headline that answers "is everything going smoothly?", the counts under
   *  it, who is running, and the tiles being worked (each one a way in, since
   *  the audit view behind this panel is showing exactly the same set).
   *
   *  Null when the orchestrator drone is not loaded — the panel then falls back
   *  to the ordinary agent shape rather than showing an empty report. */
  #overview(): HTMLElement | null {
    const orchestrator = orchestratorDrone()
    const summary = orchestrator?.summary?.()
    if (!orchestrator || !summary) return null

    const wrap = document.createElement('div')
    wrap.className = 'hc-agent-section'

    // The carried operation comes FIRST, above even the headline: it is the
    // one thing on this panel the participant has already committed to, and
    // they arrived back here to finish it.
    const carrying = this.#carrying(orchestrator)
    if (carrying) wrap.appendChild(carrying)

    const headline = document.createElement('div')
    headline.className = `hc-agent-headline ${summary.healthy ? 'ok' : 'attention'}`
    headline.textContent = summary.headline
    wrap.appendChild(headline)

    const counts: Array<[string, number]> = [
      [this.#t('agent.status.blocked', 'waiting on you'), summary.blocked],
      [this.#t('agent.status.working', 'working'), summary.working],
      [this.#t('agent.status.pending', 'pending'), summary.pending],
      [this.#t('agent.status.stalled', 'stalled'), summary.stalled],
      [this.#t('agent.status.failed', 'failed'), summary.failed],
    ]
    const row = document.createElement('div')
    row.className = 'hc-agent-counts'
    for (const [label, value] of counts) {
      if (!value) continue
      const pill = document.createElement('span')
      pill.className = 'hc-agent-pill'
      pill.textContent = `${value} ${label}`
      row.appendChild(pill)
    }
    if (row.childElementCount) wrap.appendChild(row)

    if (summary.vendors.length) {
      wrap.appendChild(this.#section(
        this.#t('orchestrator.models', 'Models running'),
        summary.vendors.map(v => `${v.vendor} ×${v.count}`).join(' · '),
      ))
    }

    const running = this.#running()
    if (running) wrap.appendChild(running)

    if (summary.tiles.length) {
      const tiles = document.createElement('div')
      tiles.className = 'hc-agent-section'
      const head = document.createElement('div')
      head.className = 'hc-agent-label'
      head.textContent = this.#t('orchestrator.tiles', 'Tiles being worked')
      tiles.appendChild(head)
      const list = document.createElement('div')
      list.className = 'hc-agent-log'
      for (const tile of summary.tiles) {
        const line = document.createElement('button')
        line.type = 'button'
        line.className = 'hc-agent-logline'
        const name = document.createElement('span')
        name.className = 'hc-agent-logtext'
        name.textContent = tile.label
        const count = document.createElement('span')
        count.className = 'hc-agent-dim'
        count.textContent = tile.agents > 1 ? `${tile.agents} agents` : '1 agent'
        line.append(name, count)
        // Straight there. The audit view behind this panel holds the same
        // tiles, so this is the second way in, not the only one.
        line.addEventListener('click', () => {
          ioc<{ goRaw?: (segments: readonly string[]) => void }>('@hypercomb.social/Navigation')?.goRaw?.(tile.path)
        })
        list.appendChild(line)
      }
      tiles.appendChild(list)
      wrap.appendChild(tiles)
    }

    if (summary.findings.length) {
      const findings = document.createElement('div')
      findings.className = 'hc-agent-section'
      const head = document.createElement('div')
      head.className = 'hc-agent-label'
      head.textContent = this.#t('orchestrator.findings', 'Worth a look')
      findings.appendChild(head)
      for (const finding of summary.findings) {
        const line = document.createElement('div')
        line.className = 'hc-agent-finding'
        const kind = document.createElement('span')
        kind.className = 'hc-agent-pill stalled'
        kind.textContent = this.#t(`orchestrator.kind.${finding.kind}`, finding.kind)
        const text = document.createElement('span')
        text.className = 'hc-agent-text'
        text.textContent = finding.text
        line.append(kind, text)
        // GO AND LOOK — travel to where the trouble is, carrying the finding.
        // Picking it up is what makes the completion button waiting at the
        // other end refer to THIS finding and not to whatever the sweep has
        // since decided is most urgent.
        if (finding.path?.length) {
          const go = document.createElement('button')
          go.type = 'button'
          go.className = 'hc-agent-go'
          go.textContent = this.#t('orchestrator.go', 'Go')
          go.title = this.#t('orchestrator.go-hint', 'Go there, keeping this ready to complete')
          go.addEventListener('click', () => {
            orchestrator.hold?.(finding.key)
            navigation()?.goRaw?.(finding.path ?? [])
            this.#render()
          })
          line.appendChild(go)
        }
        findings.appendChild(line)
      }
      wrap.appendChild(findings)
    }

    return wrap
  }

  /** THE OPERATION IN HAND. Shown while the participant is carrying a finding:
   *  what they picked up, and the two ways it can end. This is the second half
   *  of "go and look" — they pressed go, the hive navigated, and this is what
   *  is waiting for them when they get there. */
  #carrying(orchestrator: OrchestratorLike): HTMLElement | null {
    const held = orchestrator.held
    if (!held) return null

    const bar = document.createElement('div')
    bar.className = 'hc-agent-carry'

    const label = document.createElement('div')
    label.className = 'hc-agent-label'
    label.textContent = this.#t('orchestrator.carrying', 'Carrying')
    const text = document.createElement('div')
    text.className = 'hc-agent-text'
    text.textContent = held.text

    const actions = document.createElement('div')
    actions.className = 'hc-agent-carry-actions'

    const complete = document.createElement('button')
    complete.type = 'button'
    complete.className = 'hc-agent-btn hc-agent-ok'
    complete.textContent = this.#t('orchestrator.complete', 'Complete it')
    complete.title = this.#t(
      'orchestrator.complete-hint',
      'Carry out this operation on the hive — the agents it names are stopped',
    )
    complete.addEventListener('click', () => {
      complete.disabled = true
      void orchestrator.complete?.().then(did => {
        EffectBus.emit('toast:show', { type: 'tip', message: did ? `Done — ${did}.` : 'Nothing left to do.' })
        this.#render()
      })
    })

    const drop = document.createElement('button')
    drop.type = 'button'
    drop.className = 'hc-agent-btn'
    drop.textContent = this.#t('orchestrator.drop', 'Put it down')
    drop.addEventListener('click', () => { orchestrator.release?.(); this.#render() })

    actions.append(complete, drop)
    bar.append(label, text, actions)
    return bar
  }

  /** WHO IS RUNNING, one row each — the way into an individual agent's log.
   *  The report answers "how is the hive doing"; this answers "and what is
   *  THAT one actually doing", which needs the agent's own activity log, so
   *  every row is a way into it.
   *
   *  Two destinations per row, because they are genuinely different places:
   *  the row opens the LOG, and the ◎ flies to the BEE — the layer the bee is
   *  dancing on, where you can watch it work. */
  #running(): HTMLElement | null {
    const agents = (this.#registry?.list() ?? [])
      .filter(a => a.kind !== 'orchestrator')
      .filter(a => a.status === 'working' || a.status === 'pending' || a.status === 'blocked')
    if (!agents.length) return null

    const wrap = document.createElement('div')
    wrap.className = 'hc-agent-section'
    const head = document.createElement('div')
    head.className = 'hc-agent-label'
    head.textContent = this.#t('orchestrator.running', 'Running now — open a log')
    wrap.appendChild(head)

    const list = document.createElement('div')
    list.className = 'hc-agent-log'
    for (const agent of agents) {
      const row = document.createElement('div')
      row.className = 'hc-agent-run'

      const main = document.createElement('button')
      main.type = 'button'
      main.className = 'hc-agent-runmain'
      main.title = this.#t('orchestrator.open-log', 'Open this agent’s log')

      const top = document.createElement('span')
      top.className = 'hc-agent-runtop'
      const who = document.createElement('span')
      who.className = 'hc-agent-runwho'
      who.textContent = agent.kind === 'model' ? (agent.model ?? agent.behavior) : agent.behavior
      const when = document.createElement('span')
      when.className = 'hc-agent-dim'
      when.textContent = elapsed(agent.startedAt) + (agent.stalled ? ' · quiet' : '')
      top.append(who, when)

      // The last thing it said. The single most useful line about a running
      // agent, and the reason to open the log rather than guess.
      const latest = document.createElement('span')
      latest.className = 'hc-agent-runlatest'
      latest.textContent = agent.activity[agent.activity.length - 1]?.text ?? agent.status
      main.append(top, latest)
      main.addEventListener('click', () => this.#swap(agent.id))

      const bee = document.createElement('button')
      bee.type = 'button'
      bee.className = 'hc-agent-runbee'
      bee.textContent = '◎'
      const beeLabel = this.#t('orchestrator.go-to-bee', 'Go to the layer its bee is flying on')
      bee.title = beeLabel
      bee.setAttribute('aria-label', beeLabel)
      bee.addEventListener('click', () => this.#goToBee(agent))

      row.append(main, bee)
      list.appendChild(row)
    }
    wrap.appendChild(list)
    return wrap
  }

  /** Go and WATCH one. A bee flies over its tile on that tile's PARENT layer,
   *  so this navigates to the parent, not into the tile — entering the tile
   *  would land the participant inside the work, on a layer where the bee they
   *  were looking for is not drawn. An agent with no tile is hive-wide, and
   *  those bees live at the root. */
  #goToBee(agent: Agent): void {
    navigation()?.goRaw?.(agent.targets.length ? agent.segments : [])
  }

  // ── A BEE AT REST ────────────────────────────────────────────────────
  //
  // Nothing is running, so there is no activity log, no progress and nothing
  // to stop. What is left is short and stays short: what it is, where it sits,
  // what it is about, and ONE ICON to the tile's conversations. The talk lives
  // in the chat window; details are a label on the door, not the room.
  #renderResting(body: HTMLElement, agent: Agent): void {
    body.append(
      this.#restingStatus(agent),
      this.#whereRow(agent, this.#t('agent.where-talked', 'Talked to')),
      this.#section(this.#t('agent.about', 'What it is about'), agent.request || '—'),
      this.#personality(agent),
      this.#restingLog(agent),
    )
  }

  /** Participant-authored acting instructions for this reusable model bee.
   *  Saved by model/behaviour identity, so the character survives new tasks. */
  #personality(agent: Agent): HTMLElement {
    const details = document.createElement('details')
    details.className = 'hc-agent-personality'
    const summary = document.createElement('summary')
    const current = personaFor(agent)
    summary.textContent = `Personality · ${current.name}`
    details.appendChild(summary)

    const form = document.createElement('div')
    form.className = 'hc-agent-personality-form'
    const fields: Array<[keyof BeePersona, string]> = [
      ['name', 'Name'], ['manner', 'Temperament'], ['voice', 'Voice'],
      ['values', 'Values'], ['provokedBy', 'Provoked by'], ['responseStyle', 'How it responds'],
    ]
    const inputs = new Map<keyof BeePersona, HTMLInputElement | HTMLTextAreaElement>()
    for (const [key, label] of fields) {
      const row = document.createElement('label')
      row.className = 'hc-agent-personality-field'
      const caption = document.createElement('span')
      caption.textContent = label
      const input = key === 'name' || key === 'manner'
        ? document.createElement('input')
        : document.createElement('textarea')
      input.value = current[key]
      input.maxLength = key === 'name' ? 40 : 220
      if (input instanceof HTMLTextAreaElement) input.rows = 2
      row.append(caption, input)
      form.appendChild(row)
      inputs.set(key, input)
    }

    const actions = document.createElement('div')
    actions.className = 'hc-agent-personality-actions'
    const save = document.createElement('button')
    save.type = 'button'
    save.className = 'hc-agent-btn hc-agent-ok'
    save.textContent = 'Save personality'
    save.addEventListener('click', () => {
      const next = Object.fromEntries(fields.map(([key]) => [key, inputs.get(key)?.value.trim() || current[key]])) as unknown as BeePersona
      savePersona(agent, next)
      summary.textContent = `Personality · ${next.name}`
      EffectBus.emit(BEE_PERSONALITY_CHANGED, { agent: agent.id })
      EffectBus.emit('toast:show', { type: 'tip', message: `${next.name} will use these instructions in bee conversations.` })
    })
    const reset = document.createElement('button')
    reset.type = 'button'
    reset.className = 'hc-agent-btn'
    reset.textContent = 'Use preset'
    reset.addEventListener('click', () => {
      const next = resetPersona(agent)
      for (const [key] of fields) { const input = inputs.get(key); if (input) input.value = next[key] }
      summary.textContent = `Personality · ${next.name}`
      EffectBus.emit(BEE_PERSONALITY_CHANGED, { agent: agent.id })
    })
    actions.append(save, reset)
    form.appendChild(actions)
    details.appendChild(form)
    const history = cachedBanterFor(agent)
    if (history.length) {
      const historyDetails = document.createElement('details')
      historyDetails.className = 'hc-agent-banter-history'
      const historySummary = document.createElement('summary')
      historySummary.textContent = `Recent bee conversations · ${history.length}`
      historyDetails.appendChild(historySummary)
      for (const record of history) {
        const exchange = document.createElement('div')
        exchange.className = 'hc-agent-banter-exchange'
        const meta = document.createElement('div')
        meta.className = 'hc-agent-dim'
        meta.textContent = `${record.beeNames.join(' ↔ ')} · ${new Date(record.createdAt).toLocaleString()}`
        exchange.appendChild(meta)
        record.lines.forEach((line, index) => {
          const turn = document.createElement('div')
          turn.className = 'hc-agent-banter-turn'
          turn.textContent = `${record.beeNames[index % 2]}: ${line}`
          exchange.appendChild(turn)
        })
        historyDetails.appendChild(exchange)
      }
      details.appendChild(historyDetails)
    }
    const references = banterReferencesFor(agent)
    if (references.length) {
      const referenceDetails = document.createElement('details')
      referenceDetails.className = 'hc-agent-banter-history'
      const referenceSummary = document.createElement('summary')
      referenceSummary.textContent = `Archived conversation references · ${references.length}`
      referenceDetails.appendChild(referenceSummary)
      for (const reference of references) {
        const file = document.createElement('div')
        file.className = 'hc-agent-banter-exchange'
        const meta = document.createElement('div')
        meta.className = 'hc-agent-dim'
        meta.textContent = `${reference.beeNames.join(' ↔ ')} · archived ${new Date(reference.archivedAt).toLocaleString()}`
        const summaryLine = document.createElement('div')
        summaryLine.className = 'hc-agent-banter-turn'
        summaryLine.textContent = reference.summary
        file.append(meta, summaryLine)
        for (const highlight of reference.highlights) {
          const quote = document.createElement('div')
          quote.className = 'hc-agent-banter-turn'
          quote.textContent = `“${highlight}”`
          file.appendChild(quote)
        }
        referenceDetails.appendChild(file)
      }
      details.appendChild(referenceDetails)
    }
    return details
  }

  /** THE WAY IN, NOT THE THING ITSELF. The conversations belong to the chat
   *  window and are read there; a panel that printed the turns would be a
   *  second, worse copy of a window that already exists. So: one button, in
   *  the corner where full screen would be, and the tile's conversations open
   *  where they live. */
  #conversationsButton(agent: Agent): HTMLButtonElement {
    // A chat bee IS a conversation and carries its id. Anything else — an ask,
    // a sync, the orchestrator — is work ON a tile, and the tile's own
    // conversation is the thread to answer in, so the door leads there.
    const convoId = restingConvoId(agent.id)
      || tileConvoId(agent.targets[0] ? [...agent.segments, agent.targets[0]] : agent.segments)
    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'hc-agent-window'
    const label = this.#t('agent.open-chat', 'Open this tile’s conversations')
    open.title = label
    open.setAttribute('aria-label', label)
    const glyph = document.createElement('span')
    glyph.className = 'mat-sym'
    glyph.setAttribute('aria-hidden', 'true')
    glyph.textContent = 'forum'
    open.appendChild(glyph)
    open.addEventListener('click', () => { EffectBus.emit('chat:open', { convoId }) })
    return open
  }

  /** THE LOG — what has been said here, in summary. Not the turns: the
   *  conversation's own blurb (`chat-blurb.ts`), which is the other end of the
   *  thread said briefly — a line and the concrete points under it.
   *
   *  This is what the panel is FOR once nothing is running. It is also what
   *  the orchestrator comes past to read: an account of the tile that keeps
   *  itself current as the conversation grows, rather than a box asking the
   *  participant to type the account by hand.
   *
   *  NEVER LOAD-BEARING. A blurb missing (not minted yet, wiped, or from an
   *  older derivation) costs these lines and nothing else — the panel above it
   *  reads exactly the same. */
  #restingLog(agent: Agent): HTMLElement {
    const convoId = restingConvoId(agent.id)
    const wrap = document.createElement('div')
    wrap.className = 'hc-agent-section'
    const head = document.createElement('div')
    head.className = 'hc-agent-label'
    head.textContent = this.#t('agent.log', 'The log')
    wrap.appendChild(head)

    const body = document.createElement('div')
    body.className = 'hc-agent-log'
    wrap.appendChild(body)

    // What was read last time, straight away: a re-render must not blink.
    if (this.#blurbs.has(convoId)) this.#fillLog(body, this.#blurbs.get(convoId) ?? null)
    else {
      const reading = document.createElement('div')
      reading.className = 'hc-agent-dim'
      reading.textContent = this.#t('agent.log-reading', 'reading…')
      body.appendChild(reading)
    }

    const opened = this.#id
    void readBlurb(convoId).then(blurb => {
      this.#blurbs.set(convoId, blurb)
      if (this.#id !== opened || !body.isConnected) return
      this.#fillLog(body, blurb)
    }).catch(() => { /* no blurb is a normal answer, not an error */ })
    return wrap
  }

  #fillLog(body: HTMLElement, blurb: ChatBlurb | null): void {
    body.textContent = ''
    if (!blurb) {
      const none = document.createElement('div')
      none.className = 'hc-agent-dim'
      none.textContent = this.#t('agent.log-none', 'No summary yet — one is written as the conversation settles.')
      body.appendChild(none)
      return
    }
    const line = document.createElement('div')
    line.className = 'hc-agent-text'
    line.textContent = blurb.line
    body.appendChild(line)
    for (const point of blurb.points) {
      const item = document.createElement('div')
      item.className = 'hc-agent-point'
      item.textContent = point
      body.appendChild(item)
    }
    const read = document.createElement('div')
    read.className = 'hc-agent-dim'
    read.textContent = this.#t('agent.log-upto', 'summarised through {count} turns, {ago} ago')
      .replace('{count}', String(blurb.upToTurnCount))
      .replace('{ago}', elapsed(blurb.upToAt || blurb.at))
    body.appendChild(read)
  }

  /** The status line of a resting bee: at rest, in which model, last spoken
   *  when. `#statusRow` would read the record's `working` out loud. */
  #restingStatus(agent: Agent): HTMLElement {
    const row = document.createElement('div')
    row.className = 'hc-agent-status'
    const pill = document.createElement('span')
    pill.className = 'hc-agent-pill resting'
    pill.textContent = this.#t('agent.status.resting', 'Idle')
    row.appendChild(pill)
    const when = document.createElement('span')
    when.className = 'hc-agent-dim'
    when.textContent = this.#t('agent.last-spoken', 'last spoken {ago} ago')
      .replace('{ago}', elapsed(agent.updatedAt || agent.startedAt))
    row.appendChild(when)
    return row
  }

  #statusRow(agent: Agent): HTMLElement {
    const row = document.createElement('div')
    row.className = 'hc-agent-status'
    const pill = document.createElement('span')
    // Blocked outranks stalled in the pill: an agent waiting on a person is
    // not quiet by accident, and calling it stalled would send the
    // participant looking for a fault instead of answering the question.
    pill.className = `hc-agent-pill ${agent.status}${agent.stalled && agent.status !== 'blocked' ? ' stalled' : ''}`
    pill.textContent = agent.status === 'blocked'
      ? this.#t('agent.status.blocked', 'waiting on you')
      : agent.stalled
        ? this.#t('agent.status.stalled', 'stalled')
        : this.#t(`agent.status.${agent.status}`, agent.status)
    row.appendChild(pill)
    if (agent.status === 'blocked' && agent.needs) {
      const needs = document.createElement('span')
      needs.className = 'hc-agent-needs'
      needs.textContent = agent.needs
      row.appendChild(needs)
    }
    if (agent.total) {
      const progress = document.createElement('span')
      progress.className = 'hc-agent-dim'
      progress.textContent = `${agent.current ?? 0}/${agent.total}`
      row.appendChild(progress)
    }
    // The model already names the panel for a model agent — repeating it here
    // would just be the same word twice.
    if (agent.model && agent.kind !== 'model') {
      const model = document.createElement('span')
      model.className = 'hc-agent-dim'
      model.textContent = agent.model
      row.appendChild(model)
    }
    const age = document.createElement('span')
    age.className = 'hc-agent-dim'
    age.textContent = elapsed(agent.startedAt)
    row.appendChild(age)
    return row
  }

  /** WORKING ON — and a way THERE. Each tile name is a link: it opens the
   *  layer the tile lives on (the agent's own page, the same place its bee is
   *  flying — see #goToBee) and raises a spotlight on the tile, which burns
   *  until the pointer finds it. A hive-wide agent has no single place, so it
   *  stays a sentence. */
  #whereRow(agent: Agent, label = this.#t('agent.where', 'Working on')): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'hc-agent-section'
    const head = document.createElement('div')
    head.className = 'hc-agent-label'
    head.textContent = label
    wrap.appendChild(head)

    if (agent.scope === 'hive') {
      const value = document.createElement('div')
      value.className = 'hc-agent-text'
      value.textContent = this.#t('agent.where-hive', 'the whole hive')
      wrap.appendChild(value)
      return wrap
    }

    const row = document.createElement('div')
    row.className = 'hc-agent-where'
    if (agent.targets.length) {
      const hint = this.#t('agent.where-open', 'Open its layer with this tile lit up')
      for (const target of agent.targets) {
        const link = document.createElement('button')
        link.type = 'button'
        link.className = 'hc-agent-tile'
        link.textContent = target
        link.title = hint
        link.addEventListener('click', () => this.#goToTile(agent, target))
        row.appendChild(link)
      }
    } else {
      const link = document.createElement('button')
      link.type = 'button'
      link.className = 'hc-agent-tile'
      link.textContent = '/' + agent.segments.join('/')
      link.title = this.#t('agent.where-open-page', 'Open this page')
      link.addEventListener('click', () => navigation()?.goRaw?.(agent.segments))
      row.appendChild(link)
    }
    wrap.appendChild(row)
    return wrap
  }

  /** Navigate FIRST, then light: the navigation's own spotlight-clear has
   *  already run by the time the show lands, so the glow survives the trip
   *  and waits on the parent layer for the pointer to find it. */
  #goToTile(agent: Agent, target: string): void {
    navigation()?.goRaw?.(agent.segments)
    EffectBus.emit('spotlight:show', { targets: [target] })
  }

  #section(label: string, text: string): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'hc-agent-section'
    const head = document.createElement('div')
    head.className = 'hc-agent-label'
    head.textContent = label
    const value = document.createElement('div')
    value.className = 'hc-agent-text'
    value.textContent = text
    wrap.append(head, value)
    return wrap
  }

  #activity(agent: Agent): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'hc-agent-section'
    const head = document.createElement('div')
    head.className = 'hc-agent-label'
    head.textContent = this.#t('agent.activity', 'What it is doing')
    wrap.appendChild(head)
    const log = document.createElement('div')
    log.className = 'hc-agent-log'
    agent.activity.forEach((entry, index) => {
      const key = `${entry.at}:${index}:${entry.text}`
      const line = document.createElement('button')
      line.type = 'button'
      line.className = 'hc-agent-logline'
      line.classList.toggle('expanded', this.#expandedActivity.has(key))
      line.title = entry.text
      line.setAttribute('aria-expanded', String(this.#expandedActivity.has(key)))
      const time = document.createElement('span')
      time.className = 'hc-agent-dim'
      time.textContent = new Date(entry.at).toLocaleTimeString()
      const text = document.createElement('span')
      text.className = 'hc-agent-logtext'
      text.textContent = entry.text
      line.append(time, text)
      line.addEventListener('click', () => {
        const expanded = line.classList.toggle('expanded')
        line.setAttribute('aria-expanded', String(expanded))
        if (expanded) this.#expandedActivity.add(key)
        else this.#expandedActivity.delete(key)
      })
      log.appendChild(line)
    })
    wrap.appendChild(log)
    return wrap
  }

  /** Stop the work this panel is showing. One click, no dialog: the record is
   *  the participant's own request and stopping it destroys nothing they
   *  wrote — an answer that already landed is a note, and notes stay. */
  async #stop(button: HTMLButtonElement): Promise<void> {
    button.disabled = true
    const stopped = await this.#registry?.stop(this.#id, 'stopped by you')
    button.disabled = false
    EffectBus.emit('toast:show', stopped
      ? { type: 'tip', message: this.#t('agent.stopped', 'Stopped — the request is out of the hive.') }
      : { type: 'warning', message: this.#t('agent.stop-error', 'Could not stop it — try again.') })
  }

  /** Step to an agent from a NAMED origin, without closing the panel.
   *
   *  Unlike `#swap`, "back" is pinned to the origin rather than to whatever was
   *  showing a moment ago. Clicking bee after bee in the gathered view would
   *  otherwise build a chain — A, then B, then C, with back walking you through
   *  B — when what the participant means by back is, always, the report they
   *  came from.
   *
   *  `#returnTo` is set BEFORE opening because the head is built inside
   *  `open()`, and `#swapping` keeps the close it performs from announcing
   *  itself: `agent:closed` puts down the perch and the audit view, which is
   *  exactly what a step must not do. */
  #stepTo(id: string, from: string): void {
    if (!id || id === this.#id) return
    this.#swapping = true
    this.#returnTo = from
    try { this.open(id) } finally { this.#swapping = false }
  }

  /** Change which agent the panel is showing, WITHOUT closing it. Remembers
   *  where it came from so the head can offer the way back. */
  #swap(id: string): void {
    if (!id || id === this.#id) return
    // An own-window agent is not a subject this panel can show — raise its
    // window and leave the panel (the report, usually) exactly as it stands.
    if (this.#registry?.find(id)?.behavior === 'folder-sync') {
      EffectBus.emit('folder-sync:open', { agentId: id })
      return
    }
    const from = this.#id
    this.#swapping = true
    // Going back to where we came from ends the trip; going deeper keeps the
    // origin, so "back" always means the report, never a chain to unwind.
    this.#returnTo = id === this.#returnTo ? '' : from
    try { this.open(id) } finally { this.#swapping = false }
  }

  close(): void {
    const was = this.#id
    this.#registry?.removeEventListener('change', this.#render)
    document.removeEventListener('keydown', this.#onKey, true)
    // Say so: a perched bee and a gathered audit view are both "this panel is
    // open" made visible, and they have to be put down with it. A SWAP is not
    // a close — the panel is staying open on another agent.
    if (was && !this.#swapping) {
      EffectBus.emit('agent:closed', { id: was })
      this.#returnTo = ''
    }
    this.#resizeCleanup?.()
    this.#resizeCleanup = null
    if (!this.#swapping) {
      dockLanes()?.release(this)
      this.#laneOffset = 0
    }
    this.#panel?.remove()
    this.#panel = null
    this.#body = null
    this.#stopButton = null
    this.#id = ''
    this.#expandedActivity.clear()
  }

  #beginResize(event: PointerEvent): void {
    const panel = this.#panel
    if (!panel) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = panel.getBoundingClientRect().width
    const move = (next: PointerEvent): void => {
      const right = Math.max(16, window.innerWidth - panel.getBoundingClientRect().right)
      const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - right - 16)
      const width = Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth + startX - next.clientX))
      panel.style.width = `${width}px`
    }
    const finish = (): void => {
      localStorage.setItem(WIDTH_KEY, String(Math.round(panel.getBoundingClientRect().width)))
      // This window just got wider or narrower, so whatever is inboard of it
      // in the lane is now in the wrong place.
      dockLanes()?.reflow()
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', finish, true)
      window.removeEventListener('pointercancel', finish, true)
      this.#resizeCleanup = null
    }
    this.#resizeCleanup?.()
    this.#resizeCleanup = finish
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', finish, true)
    window.addEventListener('pointercancel', finish, true)
  }

  #ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
/* UNDER THE CONTROL BAR. The bar publishes what it occupies as
   --hc-controls-right and this window docks flush inboard of it, so the two
   should never meet — but the reservation is 0 while the bar is free-floating
   or on the other edge, and at 99999 this window then drew straight over the
   bar's border and cut it off. Sitting below the bar's own band (59999–60003,
   controls-bar.component.scss) the bar is always the one on top, whatever the
   reservation says. */
.hc-agent{position:fixed;z-index:59990;display:flex;flex-direction:row;align-items:stretch;
  right:calc(var(--hc-controls-right, 0px) - 1px);bottom:1rem;width:min(24rem,calc(100vw - 2rem));
  max-height:min(30rem,70vh);box-sizing:border-box;
  background:rgba(6,9,14,0.96);border:1px solid rgba(${STEEL},0.28);border-radius:var(--hc-radius-floating, 4px);
  box-shadow:0 12px 34px rgba(0,0,0,0.5);
  transition:right 160ms ease;}
@media (prefers-reduced-motion:reduce){.hc-agent{transition:none;}}
.hc-agent-main{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;gap:0.6rem;
  padding:0.7rem 0.85rem 0.75rem;box-sizing:border-box;}
.hc-agent-resize{position:absolute;z-index:1;inset:0 auto 0 -0.35rem;width:0.7rem;cursor:ew-resize;}
.hc-agent-resize::after{content:"";position:absolute;top:42%;bottom:42%;left:0.25rem;
  border-left:1px solid rgba(${STEEL},0.42);}
/* THE HEAD. One hairline under it does the work a heavier border was doing
   badly: the panel reads as head + body instead of one undivided box. */
.hc-agent-head{display:flex;align-items:center;gap:0.55rem;flex:0 0 auto;
  padding-bottom:0.55rem;border-bottom:1px solid rgba(${STEEL},0.16);}
.hc-agent-avatar{width:1.9rem;height:1.9rem;flex:0 0 auto;}
/* WHO, IN TWO LINES. The name and the vendor were competing on one line and
   ellipsising each other; stacked, the name is the thing you read and the
   vendor is the thing you glance at. */
.hc-agent-title{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:0.08rem;
  font-family:var(--hc-mono,monospace);font-size:0.78rem;font-weight:600;
  letter-spacing:0.08em;text-transform:uppercase;color:rgba(246,250,255,0.96);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-agent-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-agent-kind{font-size:0.62rem;font-weight:400;letter-spacing:0.12em;
  color:rgba(${STEEL},0.62);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-agent-back{width:1.7rem;height:2rem;flex:0 0 auto;border:none;background:none;
  color:rgba(${STEEL},0.75);font-size:1.5rem;line-height:1;cursor:pointer;border-radius:var(--hc-radius-control, 2px);}
.hc-agent-back:hover{color:whitesmoke;background:rgba(255,255,255,0.07);}
.hc-agent-carry{display:flex;flex-direction:column;gap:0.35rem;margin-bottom:0.6rem;
  padding:0.55rem 0.6rem;border:1px solid rgba(214,178,110,0.45);border-radius:var(--hc-radius-card, 3px);
  background:rgba(214,178,110,0.08);}
.hc-agent-carry .hc-agent-label{color:rgba(226,196,140,0.85);margin:0;}
.hc-agent-carry-actions{display:flex;gap:0.4rem;margin-top:0.15rem;}
.hc-agent-carry-actions .hc-agent-btn{min-height:2rem;padding:0 0.7rem;font-size:0.78rem;}
.hc-agent-run{display:flex;align-items:stretch;gap:0.25rem;}
.hc-agent-runmain{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:0.1rem;
  padding:0.28rem 0.35rem;border:0;background:none;text-align:left;font:inherit;cursor:pointer;
  border-radius:var(--hc-radius-floating, 4px);}
.hc-agent-runmain:hover,.hc-agent-runmain:focus-visible{background:rgba(255,255,255,0.055);outline:none;}
.hc-agent-runtop{display:flex;align-items:baseline;justify-content:space-between;gap:0.5rem;}
.hc-agent-runwho{font-size:0.8rem;color:rgba(238,244,250,0.92);font-weight:600;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-agent-runlatest{font-size:0.73rem;color:rgba(216,230,238,0.55);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-agent-runbee{flex:0 0 auto;width:2rem;border:1px solid rgba(${STEEL},0.22);border-radius:var(--hc-radius-floating, 4px);
  background:none;color:rgba(${STEEL},0.8);font-size:0.9rem;line-height:1;cursor:pointer;}
.hc-agent-runbee:hover{border-color:rgba(${STEEL},0.7);background:rgba(${STEEL},0.12);color:whitesmoke;}
.hc-agent-go{flex:0 0 auto;align-self:flex-start;margin-left:auto;padding:0.1rem 0.55rem;
  border:1px solid rgba(${STEEL},0.4);border-radius:999px;background:none;
  color:rgba(${STEEL},0.9);font:inherit;font-size:0.7rem;letter-spacing:0.06em;
  text-transform:uppercase;cursor:pointer;}
.hc-agent-go:hover{border-color:rgba(${STEEL},0.9);background:rgba(${STEEL},0.14);color:whitesmoke;}
.hc-agent-close,.hc-agent-window{width:2rem;height:2rem;border:none;background:none;color:rgba(245,245,245,0.4);
  font-size:1.3rem;line-height:1;cursor:pointer;border-radius:var(--hc-radius-control, 2px);}
.hc-agent-window{font-size:1rem;}
.hc-agent-close:hover,.hc-agent-window:hover{color:whitesmoke;background:rgba(255,255,255,0.07);}
.hc-agent-body{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:0.75rem;
  padding-right:0.2rem;}
/* Every section is a label and its content, and nothing else. Given a rule of
   its own, the gap between a label and what it labels stops being whatever
   the last element happened to leave behind. */
.hc-agent-section{display:flex;flex-direction:column;gap:0.3rem;}
.hc-agent-personality{border:1px solid rgba(${STEEL},0.18);border-radius:4px;padding:0.45rem 0.55rem;}
.hc-agent-personality>summary{cursor:pointer;color:rgba(246,250,255,0.9);font-size:0.75rem;font-weight:600;}
.hc-agent-personality-form{display:flex;flex-direction:column;gap:0.45rem;margin-top:0.6rem;}
.hc-agent-personality-field{display:flex;flex-direction:column;gap:0.18rem;font-size:0.67rem;color:rgba(${STEEL},0.72);}
.hc-agent-personality-field input,.hc-agent-personality-field textarea{box-sizing:border-box;width:100%;resize:vertical;
  color:rgba(246,250,255,0.94);background:rgba(255,255,255,0.035);border:1px solid rgba(${STEEL},0.22);
  border-radius:3px;padding:0.35rem 0.42rem;font:0.72rem/1.35 var(--hc-mono,monospace);}
.hc-agent-personality-field input:focus,.hc-agent-personality-field textarea:focus{outline:1px solid rgba(${STEEL},0.62);}
.hc-agent-personality-actions{display:flex;gap:0.4rem;justify-content:flex-end;margin-top:0.15rem;}
.hc-agent-banter-history{margin-top:0.6rem;border-top:1px solid rgba(${STEEL},0.14);padding-top:0.5rem;}
.hc-agent-banter-history>summary{cursor:pointer;font-size:0.7rem;color:rgba(${STEEL},0.78);}
.hc-agent-banter-exchange{display:flex;flex-direction:column;gap:0.24rem;margin-top:0.55rem;padding-top:0.5rem;
  border-top:1px solid rgba(${STEEL},0.1);}
.hc-agent-banter-turn{font-size:0.69rem;line-height:1.35;color:rgba(232,240,246,0.82);}
.hc-agent-status{display:flex;align-items:center;gap:0.45rem;flex-wrap:wrap;}
.hc-agent-pill{padding:0.1rem 0.5rem;border-radius:999px;font-size:0.62rem;letter-spacing:0.12em;
  text-transform:uppercase;border:1px solid rgba(${STEEL},0.4);color:rgba(${STEEL},0.9);}
.hc-agent-pill.working{border-color:rgba(${STEEL},0.9);background:rgba(${STEEL},0.16);}
.hc-agent-pill.resting{border-color:rgba(${STEEL},0.45);color:rgba(${STEEL},0.75);background:none;}
.hc-agent-pill.stalled{border-color:rgba(214,178,110,0.7);color:rgba(226,196,140,0.95);background:none;}
.hc-agent-pill.blocked{border-color:rgba(126,182,214,0.85);color:rgba(196,226,246,0.98);background:rgba(126,182,214,0.12);}
.hc-agent-needs{font-size:0.76rem;line-height:1.35;color:rgba(196,226,246,0.9);}
.hc-agent-pill.done{border-color:rgba(126,196,142,0.7);color:rgba(150,214,164,0.95);}
.hc-agent-pill.failed{border-color:rgba(226,75,74,0.7);color:rgba(232,124,123,0.95);}
.hc-agent-dim{font-size:0.72rem;color:rgba(216,230,238,0.5);}
.hc-agent-window .mat-sym{font-size:1.05rem;line-height:1;}
.hc-agent-point{font-size:0.76rem;line-height:1.45;padding-left:0.75rem;position:relative;
  color:rgba(238,244,250,0.78);}
.hc-agent-point::before{content:'·';position:absolute;left:0.15rem;color:rgba(${STEEL},0.7);}
.hc-agent-headline{font-size:0.92rem;line-height:1.4;color:rgba(238,244,250,0.95);margin-bottom:0.5rem;}
.hc-agent-headline.ok{color:rgba(150,214,164,0.95);}
.hc-agent-headline.attention{color:rgba(226,196,140,0.98);}
.hc-agent-counts{display:flex;flex-wrap:wrap;gap:0.35rem;margin-bottom:0.35rem;}
.hc-agent-finding{display:flex;align-items:flex-start;gap:0.5rem;padding:0.25rem 0;}
.hc-agent-finding .hc-agent-pill{flex:0 0 auto;}
.hc-agent-finding .hc-agent-text{flex:1 1 auto;min-width:0;font-size:0.8rem;}
/* Labels recede. There are four or five of them down a short panel, and at
   full weight they were louder than the answers underneath. */
.hc-agent-label{font-size:0.62rem;letter-spacing:0.14em;text-transform:uppercase;
  color:rgba(${STEEL},0.52);}
.hc-agent-where{display:flex;flex-wrap:wrap;gap:0.3rem;}
/* THE TILE, IN ITS OWN COLOUR. A hovered bee names its tile in white against
   steel (agent-bee.drone.ts); the panel says it the same way, so the thing you
   pointed at and the thing you are reading about are recognisably one thing. */
.hc-agent-tile{padding:0.16rem 0.6rem;border:1px solid rgba(${STEEL},0.3);border-radius:999px;
  background:rgba(${STEEL},0.07);color:rgba(246,250,255,0.98);font:inherit;font-size:0.8rem;
  font-weight:600;cursor:pointer;
  max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-agent-tile:hover,.hc-agent-tile:focus-visible{border-color:rgba(${STEEL},0.85);
  background:rgba(${STEEL},0.14);color:whitesmoke;outline:none;}
.hc-agent-text{font-size:0.85rem;line-height:1.45;color:rgba(238,244,250,0.9);white-space:pre-wrap;
  word-break:break-word;}
.hc-agent-log{display:flex;flex-direction:column;gap:0.25rem;}
.hc-agent-logline{display:flex;width:100%;min-width:0;gap:0.5rem;padding:0.1rem 0;border:0;
  background:none;text-align:left;font:inherit;font-size:0.78rem;line-height:1.4;
  color:rgba(238,244,250,0.82);cursor:pointer;border-radius:4px;}
.hc-agent-logline:hover,.hc-agent-logline:focus-visible{background:rgba(255,255,255,0.055);outline:none;}
.hc-agent-logline .hc-agent-dim{flex:0 0 auto;}
.hc-agent-logtext{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-agent-logline.expanded .hc-agent-logtext{overflow:visible;text-overflow:clip;white-space:pre-wrap;
  overflow-wrap:anywhere;}
/* The one row of controls a reading window has. Empty and invisible until
   there is something to stop. */
.hc-agent-actions{display:flex;justify-content:flex-end;gap:0.5rem;flex:0 0 auto;}
.hc-agent-actions:empty{display:none;}
.hc-agent-btn{min-height:2.4rem;padding:0 0.9rem;border-radius:var(--hc-radius-control, 2px);border:1px solid rgba(255,255,255,0.14);
  background:none;color:rgba(235,242,248,0.85);font:inherit;font-size:0.86rem;cursor:pointer;}
.hc-agent-ok{background:rgba(${STEEL},0.9);border-color:rgba(${STEEL},0.9);color:#0c1118;font-weight:700;}
.hc-agent-ok:disabled{opacity:0.55;cursor:default;}
.hc-agent-stop{flex:0 0 auto;border-color:rgba(226,75,74,0.5);color:rgba(232,140,139,0.95);}
.hc-agent-stop:hover{border-color:rgba(226,75,74,0.9);background:rgba(226,75,74,0.14);}
.hc-agent-stop:disabled{opacity:0.55;cursor:default;}
.hc-agent-stop[hidden]{display:none;}
`
    document.head.appendChild(style)
  }
}

const _agentPanel = new AgentPanelView()
window.ioc.register('@diamondcoreprocessor.com/AgentPanelView', _agentPanel)
