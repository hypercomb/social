// assistant/agent-panel.view.ts
//
// AGENT PANEL — click a bee, see what it is doing, give it more to work with.
//
// Opened by the `agent:open` effect (agent-bee.drone.ts). Shows one agent:
// which behaviour is flying, what was asked, where the answer will land, and
// the running activity the responder reports over the bridge. The text box at
// the bottom hands the agent MORE CONTEXT while it is still in flight — the
// thing you think of ten seconds after you asked.
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
// PURE, and the only speller of the `chat:<convoId>` key a conversation bee
// wears (presentation/avatars/resting-bees.ts). Read here rather than
// re-spelled, so the press that opens a talk can never drift from the key that
// names it.
import { restingConvoId } from '../presentation/avatars/resting-bees.js'
import { AgentTilesRail } from './agent-tiles-rail.js'
import { readAskSteps, settle, stepRequest, type ChatStep } from './chat-steps.js'

const STYLE_ID = 'hc-agent-panel-styles'
const STEEL = '126, 182, 214'
/** The same hue taken deep for bright looks — `identity.deepen()` on #7eb6d6,
 *  precomputed because this sheet is not Sass. */
const STEEL_DEEP = '39, 93, 124'
const WIDTH_KEY = 'hc:agent-panel-width'
const FULLSCREEN_KEY = 'hc:agent-panel-fullscreen'
const MIN_WIDTH = 320
/** How many recorded steps the panel lists. A panel is a summary; a run
 *  longer than this says so on its last line rather than scrolling. */
const MAX_DID_LINES = 40

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

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

/** What the panel needs of the thread store to show a conversation: the turns.
 *  Reached structurally through IoC — chat-thread.ts registers its singleton at
 *  module scope, and importing a value from it would mint a second one in this
 *  bundle. */
type ThreadsLike = {
  readTurns?: (convoId: string) => Promise<ReadonlyArray<{ role: string; text: string; at: number }>>
}

const chatThreads = (): ThreadsLike | undefined =>
  ioc<ThreadsLike>('@diamondcoreprocessor.com/ChatThreads')

/** How many turns of a conversation the little panel shows. It is a glance at
 *  what was said, not the conversation — the window is one press further on. */
const MAX_TURN_LINES = 8

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
  #input: HTMLTextAreaElement | null = null
  #stopButton: HTMLButtonElement | null = null
  #registry: AgentRegistry | undefined
  #expandedActivity = new Set<string>()
  /** Bumped on every render. A ledger read that returns after the panel
   *  has moved on belongs to an agent nobody is looking at any more. */
  #didToken = 0
  #fullscreen = false
  #resizeCleanup: (() => void) | null = null
  /** The Copilot-style left column, alive only in full screen: the hive as a
   *  drillable vertical list, where agents are applied to tiles. */
  #rail: AgentTilesRail | null = null
  #railHost: HTMLDivElement | null = null
  #chips: HTMLDivElement | null = null
  /** The composer row. Hidden for a conversation: "add context while it works"
   *  is an offer only a run can keep. */
  #composeRow: HTMLDivElement | null = null
  #send: HTMLButtonElement | null = null
  /** Model hint the Apply flow rides out on; the chip in the chips row cycles it. */
  #askModel = 'opus'
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
    // Leaving a tile's conversation is the smaller commitment — let Escape
    // put that down first, and only a second press closes the panel.
    if (this.#rail?.subject) { this.#rail.clearSubject(); return }
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
      const agent = this.#subject()
      if ((agent?.origin ?? 'local') === 'local') this.close()
    })
    // The report is live. Findings clear on their own when work recovers, and
    // the orchestrator's running commentary lands on its own clock — neither
    // touches the agent registry, so without this the open panel would sit
    // there showing a state that has already passed.
    EffectBus.on('orchestrator:findings', () => {
      if (this.#panel && this.#subject()?.kind === 'orchestrator') this.#render()
    })
  }

  /** The agent this panel is about, from EITHER lane — the work lane first,
   *  because a resting bee and the working one that wakes from it share an id. */
  #subject(): Agent | undefined {
    return this.#registry?.find(this.#id)
  }

  /** Is the subject a conversation rather than a run? */
  #restingNow(): boolean {
    return this.#registry?.isResting(this.#id) ?? false
  }

  #t(key: string, fallback: string): string {
    const value = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key)
    return value && value !== key ? value : fallback
  }

  open(id: string): void {
    // Clicking a second bee swaps the panel's subject rather than stacking.
    if (this.#panel && this.#id === id) return
    if (this.#panel) this.close()

    this.#registry = ioc<AgentRegistry>('@diamondcoreprocessor.com/AgentRegistry')
    // BOTH LANES. A tile that has been talked to keeps a bee whether or not a
    // question is out, and that bee is in the RESTING lane — `get` sees only
    // work, so pressing one opened nothing at all (Jaime, 2026-09-09: "the
    // logs are still not showing … used to have a little window show up in the
    // bottom of the screen when I click the Bees"). The registry has had
    // `find` for exactly this; nothing was using it.
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
    this.#fullscreen = localStorage.getItem(FULLSCREEN_KEY) === 'true'
    panel.classList.toggle('fullscreen', this.#fullscreen)

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
    title.textContent = agent.kind === 'model' ? (agent.model ?? agent.behavior) : agent.behavior
    // What SORT of worker this is — the same thing the bee's dance and its
    // mark are saying, spelled out. For a model that means the VENDOR, which
    // is the colour family it is flying.
    const kind = document.createElement('span')
    kind.className = 'hc-agent-kind'
    kind.textContent = agent.kind === 'model' && agent.vendor
      ? `${agent.vendor}${agent.tier ? ` · ${agent.tier}` : ''}`
      : this.#t(`agent.kind.${agent.kind}`, agent.kind)
    title.appendChild(kind)
    const fullscreen = document.createElement('button')
    fullscreen.type = 'button'
    fullscreen.className = 'hc-agent-window'
    const updateFullscreenButton = (): void => {
      fullscreen.textContent = this.#fullscreen ? '↙' : '⛶'
      const label = this.#fullscreen
        ? this.#t('agent.restore', 'Restore window')
        : this.#t('agent.fullscreen', 'Full screen')
      fullscreen.title = label
      fullscreen.setAttribute('aria-label', label)
      fullscreen.setAttribute('aria-pressed', String(this.#fullscreen))
    }
    updateFullscreenButton()
    fullscreen.addEventListener('click', () => {
      this.#fullscreen = !this.#fullscreen
      panel.classList.toggle('fullscreen', this.#fullscreen)
      localStorage.setItem(FULLSCREEN_KEY, String(this.#fullscreen))
      updateFullscreenButton()
      // The rail exists only where there is room for it. Once mounted it
      // stays (hidden) across toggles, keeping its trail and picks.
      if (this.#fullscreen) this.#mountRail()
    })
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'hc-agent-close'
    close.textContent = '×'
    close.setAttribute('aria-label', this.#t('agent.close', 'Close'))
    close.addEventListener('click', () => this.close())
    head.append(avatar, title, fullscreen, close)

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

    // The tile you are talking to lands here, as a chip over the composer —
    // the visible sign that Enter now APPLIES agents instead of adding
    // context.
    const chips = document.createElement('div')
    chips.className = 'hc-agent-chips'
    chips.hidden = true
    this.#chips = chips

    const row = document.createElement('div')
    row.className = 'hc-agent-row'
    const input = document.createElement('textarea')
    input.className = 'hc-agent-input'
    input.rows = 2
    input.placeholder = this.#t('agent.context-placeholder', 'Add context while it works…')
    const send = document.createElement('button')
    send.type = 'button'
    send.className = 'hc-agent-btn hc-agent-ok'
    send.textContent = this.#t('agent.context-send', 'Add')
    this.#send = send
    const submit = (): void => {
      if (this.#rail?.applied.length) void this.#applyToTiles(send)
      else void this.#addContext(send)
    }
    send.addEventListener('click', submit)
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }
    })
    row.append(input, send, stop)
    this.#input = input
    this.#composeRow = row

    // Two columns: the tiles rail (full screen only) and everything the
    // panel already was. The rail host exists from the start so toggling
    // full screen is a CSS matter, not a rebuild.
    const railHost = document.createElement('div')
    railHost.className = 'hc-agent-rail'
    this.#railHost = railHost
    const main = document.createElement('div')
    main.className = 'hc-agent-main'
    main.append(head, body, chips, row)

    panel.append(resize, railHost, main)
    document.body.appendChild(panel)
    this.#panel = panel

    if (this.#fullscreen) this.#mountRail()
    this.#render()
    this.#registry?.addEventListener('change', this.#render)
    document.addEventListener('keydown', this.#onKey, true)
  }

  /** Bring the rail up. One rail per panel LIFETIME, not per subject: a swap
   *  rebuilds the panel's DOM, so the same rail re-mounts into the new host
   *  with its trail, subject and icon cache intact — stepping into an agent's
   *  log must not drop the conversation you were halfway through. */
  #mountRail(): void {
    if (!this.#railHost) return
    if (!this.#rail) {
      this.#rail = new AgentTilesRail()
      this.#rail.onSubjectChanged = () => this.#renderChips()
    }
    this.#rail.mount(this.#railHost)
    this.#renderChips()
  }

  /** The chips row mirrors the rail's subject: the tile the asks will ride
   *  out against, and the model answering. The composer's words follow suit. */
  #renderChips(): void {
    const chips = this.#chips
    if (!chips) return
    const picks = this.#rail?.applied ?? []
    chips.textContent = ''
    chips.hidden = picks.length === 0
    if (this.#input) {
      this.#input.placeholder = picks.length
        ? this.#t('agent.apply-placeholder', 'What should they do on this tile?')
        : this.#t('agent.context-placeholder', 'Add context while it works…')
    }
    if (this.#send) {
      this.#send.textContent = picks.length
        ? this.#t('agent.apply-send', 'Apply')
        : this.#t('agent.context-send', 'Add')
    }
    if (!picks.length) return

    for (const pick of picks) {
      const chip = document.createElement('span')
      chip.className = 'hc-agent-chip'
      const name = document.createElement('span')
      name.className = 'hc-agent-chip-name'
      name.textContent = pick.name
      const off = document.createElement('button')
      off.type = 'button'
      off.className = 'hc-agent-chip-off'
      off.textContent = '×'
      off.setAttribute('aria-label', this.#t('agent.chip-remove', 'Remove'))
      off.addEventListener('click', () => this.#rail?.clearSubject())
      chip.append(name, off)
      chips.appendChild(chip)
    }

    // The model is part of the send, so it lives with the chips — one quiet
    // word that cycles rather than a control that shouts.
    const model = document.createElement('button')
    model.type = 'button'
    model.className = 'hc-agent-chip hc-agent-chip-model'
    model.textContent = this.#askModel
    model.title = this.#t('agent.model-cycle', 'Which model answers — click to change')
    model.addEventListener('click', () => {
      const models = ['opus', 'sonnet', 'haiku', 'fable']
      this.#askModel = models[(models.indexOf(this.#askModel) + 1) % models.length]
      model.textContent = this.#askModel
    })
    chips.appendChild(model)
  }

  /** APPLY — mint a real ask for the tile the conversation is with. Targets
   *  are grouped by the level they live on (an ask names tiles on ONE page),
   *  which is what lets this stay unchanged if a future gesture hands it more
   *  than one. Any number of applications, one after another, is exactly what
   *  the registry and the bees are built for. */
  async #applyToTiles(button: HTMLButtonElement): Promise<void> {
    const rail = this.#rail
    const input = this.#input
    const prompt = input?.value.trim() ?? ''
    const picks = rail?.applied ?? []
    if (!rail || !prompt || !picks.length) return

    const queen = ioc<{ activeModel: string; submitAsk?: (prompt: string, targets: string[], at?: readonly string[]) => Promise<boolean> }>(
      '@diamondcoreprocessor.com/LlmQueenBee')
    if (!queen?.submitAsk) {
      EffectBus.emit('toast:show', { type: 'warning', message: this.#t('agent.apply-error', 'Could not queue the work — try again.') })
      return
    }

    const groups = new Map<string, { path: readonly string[]; names: string[] }>()
    for (const pick of picks) {
      const key = pick.path.join('\u0000')
      const group = groups.get(key) ?? { path: pick.path, names: [] }
      group.names.push(pick.name)
      groups.set(key, group)
    }

    button.disabled = true
    const prior = queen.activeModel
    queen.activeModel = this.#askModel
    let ok = true
    try {
      for (const group of groups.values()) {
        ok = (await queen.submitAsk(prompt, group.names, group.path)) && ok
      }
    } finally {
      queen.activeModel = prior
      button.disabled = false
    }
    if (ok) {
      if (input) input.value = ''
      rail.clearSubject()
    }
  }

  #render = (): void => {
    const body = this.#body
    if (!body) return
    const agent = this.#subject()
    // A RESTING bee is not work: it is a conversation this tile has had. It is
    // minted `working` so its sprite dances, so the panel must ask the lane,
    // not the status — otherwise it offers to Stop a talk that ended days ago.
    const resting = this.#restingNow()
    const running = !resting
      && (agent?.status === 'pending' || agent?.status === 'working' || agent?.status === 'blocked')
    if (this.#stopButton) this.#stopButton.hidden = !running
    if (this.#composeRow) this.#composeRow.hidden = resting
    if (resting && this.#chips) this.#chips.hidden = true
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

    // A CONVERSATION, NOT A RUN. There is no progress to report, nothing to
    // stop and no context to add mid-flight — what you pressed the bee for is
    // WHAT WAS SAID. The panel shows the tail of it and offers the window.
    if (resting) {
      body.append(
        this.#restedRow(agent),
        this.#whereRow(agent),
        this.#conversation(agent),
        this.#openTalkRow(agent),
      )
      return
    }

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
    body.appendChild(this.#activity(agent))
    body.appendChild(this.#did(agent))
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
  #whereRow(agent: Agent): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'hc-agent-section'
    const head = document.createElement('div')
    head.className = 'hc-agent-label'
    head.textContent = this.#t('agent.where', 'Working on')
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

  /** The top line of a conversation's panel. No status pill: "working" is what
   *  makes the bee dance, not a claim about a talk that is over — what belongs
   *  here is that it was a talk, and how long ago. */
  #restedRow(agent: Agent): HTMLElement {
    const row = document.createElement('div')
    row.className = 'hc-agent-status'
    const pill = document.createElement('span')
    // The plain pill, not `done`: green reads as "it succeeded", and a
    // conversation you had is neither a success nor a failure.
    pill.className = 'hc-agent-pill'
    pill.textContent = this.#t('agent.talked', 'talked to')
    const age = document.createElement('span')
    age.className = 'hc-agent-dim'
    age.textContent = elapsed(agent.updatedAt || agent.startedAt)
    row.append(pill, age)
    return row
  }

  /** WHAT WAS SAID, the last few turns of it. Read from the thread store, so
   *  it arrives a beat late and says so — an empty conversation and one that
   *  could not be read are different facts, and only the first is safe to show
   *  as nothing. */
  #conversation(agent: Agent): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'hc-agent-section'
    const head = document.createElement('div')
    head.className = 'hc-agent-label'
    head.textContent = this.#t('agent.said-here', 'What was said here')
    const log = document.createElement('div')
    log.className = 'hc-agent-log'
    const waiting = document.createElement('div')
    waiting.className = 'hc-agent-dim'
    waiting.textContent = this.#t('agent.reading', 'reading…')
    log.appendChild(waiting)
    wrap.append(head, log)
    void this.#fillConversation(wrap, log, agent.id, ++this.#didToken)
    return wrap
  }

  async #fillConversation(
    wrap: HTMLElement,
    log: HTMLElement,
    id: string,
    token: number,
  ): Promise<void> {
    const convoId = restingConvoId(id)
    let turns: ReadonlyArray<{ role: string; text: string; at: number }> = []
    try {
      turns = (await chatThreads()?.readTurns?.(convoId)) ?? []
    } catch {
      // Could not read — leave the panel saying so rather than claiming the
      // conversation was empty.
      if (token === this.#didToken && wrap.isConnected) {
        log.textContent = this.#t('agent.said-unreadable', 'Could not read this conversation.')
      }
      return
    }
    if (token !== this.#didToken || !wrap.isConnected) return

    log.textContent = ''
    if (!turns.length) {
      const none = document.createElement('div')
      none.className = 'hc-agent-dim'
      none.textContent = this.#t('agent.said-none', 'Nothing said yet.')
      log.appendChild(none)
      return
    }

    // The TAIL: the last thing said is the thing you pressed the bee to see.
    for (const turn of turns.slice(-MAX_TURN_LINES)) {
      const line = document.createElement('div')
      line.className = 'hc-agent-logline reading'
      const who = document.createElement('span')
      who.className = 'hc-agent-dim'
      who.textContent = turn.role === 'user'
        ? this.#t('agent.said-you', 'you')
        : this.#t('agent.said-them', 'reply')
      const text = document.createElement('span')
      text.className = 'hc-agent-logtext'
      text.textContent = turn.text.replace(/\s+/g, ' ').trim()
      line.title = `${who.textContent} · ${new Date(turn.at).toLocaleString()}`
      line.append(who, text)
      log.appendChild(line)
    }
  }

  /** The way in. The panel is a glance; the conversation lives in the chat
   *  window, and this is the one press between them. */
  #openTalkRow(agent: Agent): HTMLElement {
    const row = document.createElement('div')
    row.className = 'hc-agent-section'
    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'hc-agent-btn hc-agent-ok'
    open.textContent = this.#t('agent.open-talk', 'Open the conversation')
    open.addEventListener('click', () => {
      const convoId = restingConvoId(agent.id)
      if (!convoId) return
      // Closed first: the chat window takes the screen, and a panel left
      // standing under it is a panel you cannot see to close.
      this.close()
      EffectBus.emit('chat:open', { convoId })
    })
    row.appendChild(open)
    return row
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

  /**
   * WHAT IT DID — the durable half of the panel.
   *
   * The activity log above is what the responder SAID while it worked: a
   * live needle, held in memory, gone on reload and empty for any agent
   * this tab did not personally watch. This is the hive's own record —
   * every bridge op the run actually ran, in order, including the ones that
   * failed (assistant/chat-steps.ts).
   *
   * The two disagreeing is INFORMATION, not a fault. A claim with no step
   * behind it is work that was announced and did not land, which is exactly
   * what you want to see when an agent says it is finished and the tile
   * disagrees.
   *
   * Filled from disk, so it arrives a beat late and stays HIDDEN until it
   * has something to say: an agent that recorded nothing costs no space and
   * owes no explanation.
   */
  #did(agent: Agent): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'hc-agent-section'
    wrap.hidden = true
    const head = document.createElement('div')
    head.className = 'hc-agent-label'
    head.textContent = this.#t('agent.did', 'What it did')
    const log = document.createElement('div')
    log.className = 'hc-agent-log'
    wrap.append(head, log)
    void this.#fillDid(wrap, log, agent.id, ++this.#didToken)
    return wrap
  }

  /** Read the run, then paint it — never the other way round. A failure to
   *  read leaves the section hidden rather than claiming the run did
   *  nothing: "no record" and "could not read the record" are different
   *  facts, and only one of them is safe to show as an empty list. */
  async #fillDid(
    wrap: HTMLElement,
    log: HTMLElement,
    askSig: string,
    token: number,
  ): Promise<void> {
    let steps: ChatStep[] = []
    try {
      steps = settle(await readAskSteps(askSig))
    } catch { return }
    if (!steps.length) return

    // The panel re-rendered while the disk was answering — this section is
    // detached and belongs to an agent that is no longer on screen.
    if (token !== this.#didToken || !wrap.isConnected) return

    // What each step ACTED ON lives behind its content signature. Fetched
    // together rather than one line at a time, and capped: a panel is a
    // summary, and a run long enough to hit the cap is telling you that on
    // its own.
    const shown = steps.slice(-MAX_DID_LINES)
    const requests = await Promise.all(
      shown.map(step => stepRequest(step).catch(() => undefined)),
    )
    if (token !== this.#didToken || !wrap.isConnected) return

    shown.forEach((step, index) => {
      const line = document.createElement('div')
      line.className = 'hc-agent-logline reading'

      const time = document.createElement('span')
      time.className = 'hc-agent-dim'
      time.textContent = new Date(step.at).toLocaleTimeString()

      const text = document.createElement('span')
      text.className = 'hc-agent-logtext'
      const request = requests[index] as { cell?: unknown; segments?: unknown } | undefined
      const cell = typeof request?.cell === 'string' ? request.cell : ''
      text.textContent = cell ? `${step.verb} — ${cell}` : step.verb

      line.append(time, text)

      // Failure is named in words, never by colour alone: the ledger records
      // attempts, and an attempt that did not land is the single most
      // useful thing on this list.
      if (step.outcome === 'failed') {
        const failed = document.createElement('span')
        failed.className = 'hc-agent-dim'
        failed.textContent = this.#t('agent.did-failed', 'failed')
        line.appendChild(failed)
      }

      line.title = `#${step.seq} ${step.verb} · ${step.outcome}`
      log.appendChild(line)
    })

    if (steps.length > shown.length) {
      const more = document.createElement('div')
      more.className = 'hc-agent-dim'
      more.textContent = this.#t('agent.did-more', `…and ${steps.length - shown.length} earlier`)
      log.appendChild(more)
    }

    wrap.hidden = false
  }

  async #addContext(button: HTMLButtonElement): Promise<void> {
    const input = this.#input
    const text = input?.value.trim() ?? ''
    if (!text) return
    button.disabled = true
    const ok = await this.#registry?.addContext(this.#id, text)
    button.disabled = false
    if (ok) {
      if (input) input.value = ''
    } else {
      EffectBus.emit('toast:show', { type: 'warning', message: 'Could not add context — try again.' })
    }
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
    // A swap keeps the rail (see #mountRail); only a real close puts it down.
    if (!this.#swapping) {
      this.#rail?.dispose()
      this.#rail = null
    }
    this.#railHost = null
    this.#chips = null
    this.#send = null
    this.#composeRow = null
    this.#panel?.remove()
    this.#panel = null
    this.#body = null
    this.#input = null
    this.#stopButton = null
    this.#id = ''
    this.#expandedActivity.clear()
  }

  #beginResize(event: PointerEvent): void {
    const panel = this.#panel
    if (!panel || this.#fullscreen) return
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
/* ── THE PANE ────────────────────────────────────────────────────────────
   The floating tool-window material (ui/_toolwindow.scss floating-panel),
   said again here because this is a DOM singleton with no SCSS. A tool
   window never names a colour (documentation/tool-window-colour-roles.md):
   the pane, the ink, the shadow and the grounds are the theme's, and the
   identity is the steel family the chat window flies. The roles are declared
   ON the panel so the tiles rail mounted inside it reads the real identity
   instead of its literal fallbacks. */
.hc-agent{
  --acc:${STEEL};
  --hc-window-accent:rgb(var(--acc));
  --hc-window-accent-quiet:rgb(var(--acc));
  --hc-window-wash:rgba(var(--acc),0.10);
  --hc-window-wash-strong:rgba(var(--acc),0.20);
  --hc-window-edge:rgba(var(--acc),0.28);
  --hc-window-edge-firm:rgba(var(--acc),0.62);
  --hc-window-on-accent:rgb(var(--hc-panel-pane));
  /* Colour on purpose — amber caution, green ok, red failed — pulled toward
     the panel's ink under a bright look, untouched on a dark one (tw.ink()). */
  --hc-agent-amber:color-mix(in srgb, #d6b26e, rgb(var(--hc-panel-ink)) var(--hc-deepen, 0%));
  --hc-agent-green:color-mix(in srgb, #96d6a4, rgb(var(--hc-panel-ink)) var(--hc-deepen, 0%));
  --hc-agent-red:color-mix(in srgb, #e87c7b, rgb(var(--hc-panel-ink)) var(--hc-deepen, 0%));
  /* Chrome is mono; anything READ takes the reading face. */
  --hc-agent-prose:var(--hc-read, var(--hc-font, system-ui));
  position:fixed;z-index:99999;display:flex;flex-direction:row;align-items:stretch;
  right:calc(var(--hc-controls-right, 0px) + 1rem);bottom:1rem;width:min(24rem,calc(100vw - 2rem));
  max-height:min(30rem,70vh);box-sizing:border-box;
  background:rgba(var(--hc-panel-pane),0.98);
  border:1px solid rgba(var(--acc),0.38);border-radius:var(--hc-radius-floating, 4px);
  box-shadow:0 18px 54px rgba(var(--hc-panel-shadow),0.55), inset 0 1px rgba(var(--hc-panel-sheen),0.03);
  font-family:var(--hc-mono, system-ui);color:var(--hc-panel-text);}
/* Bright looks take the identity DEEP (ui/_panel-identity.scss, deepen()):
   the same hue, down under 0.12 luminance so it reads on cream. A global
   sheet, so the plain selector is enough — no :host-context needed. */
:is([data-theme="light"],[data-theme="honey"],[data-theme="bloom"],[data-theme="sherbet"]) .hc-agent{--acc:${STEEL_DEEP};}
@media (prefers-color-scheme: light){:root:not([data-theme]) .hc-agent{--acc:${STEEL_DEEP};}}
.hc-agent.fullscreen{inset:0;width:auto!important;max-width:none;height:auto;max-height:none;
  border-radius:0;border:none;box-shadow:none;}
.hc-agent-main{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;}
.hc-agent-rail{display:none;}
.hc-agent.fullscreen .hc-agent-rail{display:flex;flex-direction:column;min-height:0;
  flex:0 0 clamp(15rem,24vw,19rem);border-right:1px solid var(--hc-window-line);
  background:var(--hc-window-tint);}
.hc-agent-resize{position:absolute;z-index:1;inset:0 auto 0 -0.35rem;width:0.7rem;cursor:ew-resize;}
.hc-agent-resize::after{content:"";position:absolute;top:42%;bottom:42%;left:0.25rem;
  border-left:1px solid var(--hc-window-edge-firm);}
.hc-agent.fullscreen .hc-agent-resize{display:none;}

/* ── THE HEADER BAND (tw.header) ─────────────────────────────────────────
   One height, one divider — the identity hairline — and one hit area for
   every action, so this title bar lines up with every other tool window's. */
.hc-agent-head{flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:0.5rem;
  height:2.875rem;min-height:2.875rem;padding:0 0.75rem;line-height:1;
  border-bottom:1px solid var(--hc-window-edge);
  background:linear-gradient(180deg, rgba(var(--hc-panel-sheen),0.018), rgba(var(--hc-panel-sheen),0.006));}
.hc-agent-avatar{width:1.75rem;height:1.75rem;flex:0 0 auto;}
.hc-agent-title{flex:1 1 auto;min-width:0;font-size:0.72rem;font-weight:600;
  letter-spacing:0.12em;text-transform:uppercase;color:var(--hc-window-accent);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-agent-kind{margin-left:0.5rem;font-weight:400;letter-spacing:0.06em;color:var(--hc-window-ink-quiet);}
.hc-agent-head>button{box-sizing:border-box;display:inline-grid;place-items:center;flex:0 0 auto;
  min-width:1.75rem;height:1.75rem;padding:0 0.25rem;border:0;background:none;font:inherit;
  border-radius:var(--hc-radius-control, 2px);line-height:1;cursor:pointer;color:var(--hc-window-ink-faint);
  transition:color 120ms ease, background-color 120ms ease;}
.hc-agent-head>button:hover{color:var(--hc-panel-text);background-color:rgba(var(--hc-panel-ink),0.075);}
.hc-agent-head>button:focus-visible{outline:1px solid color-mix(in srgb, var(--hc-window-accent) 72%, white);outline-offset:1px;}
.hc-agent-back{font-size:1.4rem;color:var(--hc-window-accent-quiet);}
.hc-agent-window{font-size:1rem;}
.hc-agent-close{width:1.75rem;padding:0;font-size:1.125rem;}

/* ── THE BODY ────────────────────────────────────────────────────────────── */
.hc-agent-body{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:0.8rem;
  padding:0.75rem 0.85rem;scrollbar-width:thin;scrollbar-color:var(--hc-window-line-firm) transparent;}
.hc-agent-section>.hc-agent-section{margin-top:0.75rem;}
.hc-agent-label{font-size:0.66rem;letter-spacing:0.1em;text-transform:uppercase;
  color:var(--hc-window-accent-quiet);margin-bottom:0.3rem;}
.hc-agent-text{font-family:var(--hc-agent-prose);font-size:0.86rem;line-height:1.5;
  color:var(--hc-window-ink-plain);white-space:pre-wrap;word-break:break-word;}
.hc-agent-dim{font-size:0.72rem;color:var(--hc-window-ink-quiet);font-variant-numeric:tabular-nums;}
.hc-agent-status{display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;}
.hc-agent-pill{padding:0.14rem 0.55rem;border-radius:var(--hc-radius-pill, 999px);font-size:0.66rem;line-height:1.3;
  letter-spacing:0.08em;text-transform:uppercase;border:1px solid var(--hc-window-edge-firm);color:var(--hc-window-accent);}
.hc-agent-pill.working{background:var(--hc-window-wash-strong);}
.hc-agent-pill.stalled{border-color:var(--hc-agent-amber);color:var(--hc-agent-amber);background:none;}
.hc-agent-pill.blocked{border-color:var(--hc-window-accent);background:var(--hc-window-wash);}
.hc-agent-pill.done{border-color:var(--hc-agent-green);color:var(--hc-agent-green);}
.hc-agent-pill.failed{border-color:var(--hc-agent-red);color:var(--hc-agent-red);}
.hc-agent-needs{font-family:var(--hc-agent-prose);font-size:0.8rem;line-height:1.4;color:var(--hc-window-ink-plain);}
.hc-agent-headline{font-family:var(--hc-agent-prose);font-size:0.94rem;line-height:1.4;
  color:var(--hc-window-ink-loud);margin-bottom:0.5rem;}
.hc-agent-headline.ok{color:var(--hc-agent-green);}
.hc-agent-headline.attention{color:var(--hc-agent-amber);}
.hc-agent-counts{display:flex;flex-wrap:wrap;gap:0.35rem;margin-bottom:0.35rem;}
.hc-agent-finding{display:flex;align-items:flex-start;gap:0.5rem;padding:0.3rem 0;}
.hc-agent-finding .hc-agent-pill{flex:0 0 auto;}
.hc-agent-finding .hc-agent-text{flex:1 1 auto;min-width:0;font-size:0.8rem;}
.hc-agent-carry{display:flex;flex-direction:column;gap:0.35rem;margin-bottom:0.6rem;padding:0.6rem 0.65rem;
  border:1px solid color-mix(in srgb, var(--hc-agent-amber) 45%, transparent);border-left:3px solid var(--hc-agent-amber);
  border-radius:var(--hc-radius-card, 3px);background:var(--hc-window-tint);}
.hc-agent-carry .hc-agent-label{color:var(--hc-agent-amber);margin:0;}
.hc-agent-carry-actions{display:flex;gap:0.4rem;margin-top:0.15rem;}
.hc-agent-carry-actions .hc-agent-btn{min-height:2rem;padding:0 0.7rem;font-size:0.78rem;}
.hc-agent-run{display:flex;align-items:stretch;gap:0.25rem;}
.hc-agent-runmain{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:0.12rem;
  padding:0.3rem 0.4rem;border:0;background:none;text-align:left;font:inherit;color:inherit;cursor:pointer;
  border-radius:var(--hc-radius-control, 2px);}
.hc-agent-runmain:hover,.hc-agent-runmain:focus-visible{background:var(--hc-window-tint);outline:none;}
.hc-agent-runtop{display:flex;align-items:baseline;justify-content:space-between;gap:0.5rem;}
.hc-agent-runwho{font-size:0.8rem;font-weight:600;color:var(--hc-window-ink-loud);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-agent-runlatest{font-family:var(--hc-agent-prose);font-size:0.76rem;color:var(--hc-window-ink-quiet);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-agent-runbee{flex:0 0 auto;width:1.85rem;border:1px solid var(--hc-window-line-firm);
  border-radius:var(--hc-radius-control, 2px);background:none;color:var(--hc-window-accent-quiet);
  font-size:0.9rem;line-height:1;cursor:pointer;}
.hc-agent-runbee:hover{border-color:var(--hc-window-edge-firm);background:var(--hc-window-wash);color:var(--hc-window-accent);}
.hc-agent-go{flex:0 0 auto;align-self:flex-start;margin-left:auto;padding:0.12rem 0.55rem;
  border:1px solid var(--hc-window-edge-firm);border-radius:var(--hc-radius-pill, 999px);background:none;
  color:var(--hc-window-accent);font:inherit;font-size:0.68rem;letter-spacing:0.08em;text-transform:uppercase;cursor:pointer;}
.hc-agent-go:hover{background:var(--hc-window-wash-strong);}
.hc-agent-where{display:flex;flex-wrap:wrap;gap:0.3rem;}
.hc-agent-tile{padding:0.16rem 0.6rem;border:1px solid var(--hc-window-line-firm);border-radius:var(--hc-radius-pill, 999px);
  background:none;color:var(--hc-window-ink-plain);font:inherit;font-family:var(--hc-agent-prose);font-size:0.8rem;cursor:pointer;
  max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-agent-tile:hover,.hc-agent-tile:focus-visible{border-color:var(--hc-window-edge-firm);
  background:var(--hc-window-wash);color:var(--hc-window-ink-loud);outline:none;}
.hc-agent-log{display:flex;flex-direction:column;gap:0.15rem;}
.hc-agent-logline{display:flex;box-sizing:border-box;width:calc(100% + 0.7rem);margin:0 -0.35rem;min-width:0;gap:0.5rem;
  padding:0.15rem 0.35rem;border:0;background:none;text-align:left;font:inherit;font-size:0.78rem;line-height:1.45;
  color:var(--hc-window-ink-plain);cursor:pointer;border-radius:var(--hc-radius-control, 2px);}
.hc-agent-logline:hover,.hc-agent-logline:focus-visible{background:var(--hc-window-tint);outline:none;}
.hc-agent-logline .hc-agent-dim{flex:0 0 auto;}
/* A RECORDED step is read, never pressed — the activity lines above expand on
   click, these do not. Without this they would still offer a pointer and a
   hover lift, which is a control promising something it cannot do. */
.hc-agent-logline.reading{cursor:default;}
.hc-agent-logline.reading:hover{background:none;}
.hc-agent-logtext{min-width:0;font-family:var(--hc-agent-prose);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-agent-logline.expanded .hc-agent-logtext{overflow:visible;text-overflow:clip;white-space:pre-wrap;
  overflow-wrap:anywhere;}

/* ── THE COMPOSER ────────────────────────────────────────────────────────── */
.hc-agent-chips{display:flex;flex-wrap:wrap;gap:0.3rem;flex:0 0 auto;padding:0.55rem 0.85rem 0;
  border-top:1px solid var(--hc-window-line);}
.hc-agent-chips[hidden]{display:none;}
.hc-agent-chip{display:inline-flex;align-items:center;gap:0.25rem;max-width:12rem;
  padding:0.1rem 0.3rem 0.1rem 0.55rem;border:1px solid var(--hc-window-edge-firm);border-radius:var(--hc-radius-pill, 999px);
  color:var(--hc-window-ink-plain);font-size:0.76rem;background:var(--hc-window-wash);}
.hc-agent-chip-name{min-width:0;font-family:var(--hc-agent-prose);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-agent-chip-off{border:0;background:none;color:var(--hc-window-ink-quiet);font:inherit;
  font-size:0.9rem;line-height:1;cursor:pointer;padding:0 0.15rem;border-radius:var(--hc-radius-pill, 999px);}
.hc-agent-chip-off:hover{color:var(--hc-window-ink-loud);}
.hc-agent-chip-model{cursor:pointer;font-family:var(--hc-mono,monospace);letter-spacing:0.06em;
  text-transform:uppercase;font-size:0.68rem;color:var(--hc-window-accent);background:none;
  padding:0.14rem 0.6rem;margin-left:auto;}
.hc-agent-chip-model:hover{background:var(--hc-window-wash);}
.hc-agent-row{display:flex;gap:0.5rem;align-items:flex-end;flex:0 0 auto;padding:0.6rem 0.85rem 0.8rem;
  border-top:1px solid var(--hc-window-line);}
.hc-agent-chips:not([hidden])+.hc-agent-row{border-top:0;padding-top:0.5rem;}
/* \`hidden\` must win over the flex display, or a conversation still shows a
   composer that "add context while it works" cannot honour. */
.hc-agent-row[hidden]{display:none;}
.hc-agent-input{flex:1 1 auto;box-sizing:border-box;resize:none;padding:0.5rem 0.6rem;font:inherit;
  font-family:var(--hc-agent-prose);font-size:16px;line-height:1.4;color:var(--hc-window-ink-loud);
  background:var(--hc-window-tint);border:1px solid var(--hc-window-line-firm);
  border-radius:var(--hc-radius-control, 2px);outline:none;}
.hc-agent-input::placeholder{color:var(--hc-window-ink-quiet);}
.hc-agent-input:focus{border-color:var(--hc-window-edge-firm);}
.hc-agent-btn{min-height:2.4rem;padding:0 0.9rem;border-radius:var(--hc-radius-control, 2px);
  border:1px solid var(--hc-window-line-firm);background:none;color:var(--hc-window-ink-plain);
  font:inherit;font-size:0.84rem;cursor:pointer;}
.hc-agent-btn:hover{background:var(--hc-window-tint);color:var(--hc-window-ink-loud);}
.hc-agent-ok{background:var(--hc-window-accent);border-color:var(--hc-window-accent);color:var(--hc-window-on-accent);font-weight:700;}
.hc-agent-ok:hover{background:var(--hc-window-accent);color:var(--hc-window-on-accent);}
.hc-agent-ok:disabled{opacity:0.55;cursor:default;}
.hc-agent-stop{flex:0 0 auto;border-color:color-mix(in srgb, var(--hc-agent-red) 55%, transparent);color:var(--hc-agent-red);}
.hc-agent-stop:hover{border-color:var(--hc-agent-red);background:color-mix(in srgb, var(--hc-agent-red) 14%, transparent);color:var(--hc-agent-red);}
.hc-agent-stop:disabled{opacity:0.55;cursor:default;}
.hc-agent-stop[hidden]{display:none;}
`
    document.head.appendChild(style)
  }
}

const _agentPanel = new AgentPanelView()
window.ioc.register('@diamondcoreprocessor.com/AgentPanelView', _agentPanel)
