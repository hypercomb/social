// diamondcoreprocessor.com/assistant/agent-panel.view.ts
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

const STYLE_ID = 'hc-agent-panel-styles'
const STEEL = '126, 182, 214'
const WIDTH_KEY = 'hc:agent-panel-width'
const FULLSCREEN_KEY = 'hc:agent-panel-fullscreen'
const MIN_WIDTH = 320

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
  #fullscreen = false
  #resizeCleanup: (() => void) | null = null
  /** Where "back" goes — the agent this panel was opened FROM, when the
   *  participant stepped into one agent's log out of the orchestrator's
   *  report. '' when the panel was opened directly from a bee. */
  #returnTo = ''
  /** True while swapping subject between agents. The panel is not closing, so
   *  it must not announce that it is: `agent:closed` puts the perched bee down
   *  and clears the audit view, and stepping into a log is not leaving. */
  #swapping = false

  #onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.#panel) { event.stopPropagation(); this.close() }
  }

  constructor() {
    super()
    EffectBus.on<{ id?: string; from?: string }>('agent:open', payload => {
      const id = String(payload?.id ?? '')
      if (!id) return
      // `from` means "opened out of that agent" — today, off the orchestrator's
      // board of running commands. It has to be a STEP, not a fresh open: a
      // fresh one closes the panel first, and `agent:closed` puts the perch and
      // the board down, so hovering a hexagon would dismantle the board you
      // hovered it on.
      const from = String(payload?.from ?? '')
      if (from && from !== id) { this.#stepTo(id, from); return }
      this.open(id)
    })
    // Closed from outside — pressing a perched bee a second time puts its
    // panel down the same way its × would.
    //
    // `#returnTo` counts as well: stepping off the orchestrator's board into
    // one agent's log is a TRIP, and putting the board down ends the trip. Left
    // open, that log would still be offering "‹ Back to the orchestrator" after
    // the orchestrator had unperched and its board had gone — a way back to
    // somewhere that is no longer there.
    EffectBus.on<{ id?: string }>('agent:close', payload => {
      const id = String(payload?.id ?? '')
      if (id && (this.#id === id || this.#returnTo === id)) this.close()
    })
    // The report is live. Findings clear on their own when work recovers, and
    // the orchestrator's running commentary lands on its own clock — neither
    // touches the agent registry, so without this the open panel would sit
    // there showing a state that has already passed.
    EffectBus.on('orchestrator:findings', () => {
      if (this.#panel && this.#registry?.get(this.#id)?.kind === 'orchestrator') this.#render()
    })
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
    const agent = this.#registry?.get(id)
    if (!agent) return
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
    const submit = (): void => { void this.#addContext(send) }
    send.addEventListener('click', submit)
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }
    })
    row.append(input, send, stop)
    this.#input = input

    panel.append(resize, head, body, row)
    document.body.appendChild(panel)
    this.#panel = panel

    this.#render()
    this.#registry?.addEventListener('change', this.#render)
    document.addEventListener('keydown', this.#onKey, true)
  }

  #render = (): void => {
    const body = this.#body
    if (!body) return
    const agent = this.#registry?.get(this.#id)
    const running = agent?.status === 'pending' || agent?.status === 'working' || agent?.status === 'blocked'
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
   *  showing a moment ago. Sweeping a board of hexagons would otherwise build a
   *  chain — hex A, then B, then C, with back walking you through B — when what
   *  the participant means by back is, always, the report they came from.
   *
   *  `#returnTo` is set BEFORE opening because the head is built inside
   *  `open()`, and `#swapping` keeps the close it performs from announcing
   *  itself: `agent:closed` puts down the perch and the board, which is exactly
   *  what a step must not do. */
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
.hc-agent{position:fixed;z-index:99999;display:flex;flex-direction:column;gap:0.55rem;
  right:calc(var(--hc-controls-right, 0px) + 1rem);bottom:1rem;width:min(24rem,calc(100vw - 2rem));
  max-height:min(30rem,70vh);padding:0.75rem 0.85rem;box-sizing:border-box;
  background:rgba(6,9,14,0.96);border:1px solid rgba(${STEEL},0.35);border-radius:10px;}
.hc-agent.fullscreen{inset:0.75rem;width:auto!important;max-width:none;height:auto;max-height:none;}
.hc-agent-resize{position:absolute;z-index:1;inset:0 auto 0 -0.35rem;width:0.7rem;cursor:ew-resize;}
.hc-agent-resize::after{content:"";position:absolute;top:42%;bottom:42%;left:0.25rem;
  border-left:1px solid rgba(${STEEL},0.42);}
.hc-agent.fullscreen .hc-agent-resize{display:none;}
.hc-agent-head{display:flex;align-items:center;gap:0.5rem;flex:0 0 auto;}
.hc-agent-avatar{width:1.9rem;height:1.9rem;flex:0 0 auto;}
.hc-agent-title{flex:1 1 auto;font-family:var(--hc-mono,monospace);font-size:0.76rem;font-weight:600;
  letter-spacing:0.1em;text-transform:uppercase;color:rgba(${STEEL},0.95);}
.hc-agent-kind{margin-left:0.5rem;font-weight:400;letter-spacing:0.06em;
  color:rgba(216,230,238,0.45);}
.hc-agent-back{width:1.7rem;height:2rem;flex:0 0 auto;border:none;background:none;
  color:rgba(${STEEL},0.75);font-size:1.5rem;line-height:1;cursor:pointer;border-radius:6px;}
.hc-agent-back:hover{color:whitesmoke;background:rgba(255,255,255,0.07);}
.hc-agent-carry{display:flex;flex-direction:column;gap:0.35rem;margin-bottom:0.6rem;
  padding:0.55rem 0.6rem;border:1px solid rgba(214,178,110,0.45);border-radius:8px;
  background:rgba(214,178,110,0.08);}
.hc-agent-carry .hc-agent-label{color:rgba(226,196,140,0.85);margin:0;}
.hc-agent-carry-actions{display:flex;gap:0.4rem;margin-top:0.15rem;}
.hc-agent-carry-actions .hc-agent-btn{min-height:2rem;padding:0 0.7rem;font-size:0.78rem;}
.hc-agent-run{display:flex;align-items:stretch;gap:0.25rem;}
.hc-agent-runmain{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:0.1rem;
  padding:0.28rem 0.35rem;border:0;background:none;text-align:left;font:inherit;cursor:pointer;
  border-radius:5px;}
.hc-agent-runmain:hover,.hc-agent-runmain:focus-visible{background:rgba(255,255,255,0.055);outline:none;}
.hc-agent-runtop{display:flex;align-items:baseline;justify-content:space-between;gap:0.5rem;}
.hc-agent-runwho{font-size:0.8rem;color:rgba(238,244,250,0.92);font-weight:600;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-agent-runlatest{font-size:0.73rem;color:rgba(216,230,238,0.55);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-agent-runbee{flex:0 0 auto;width:2rem;border:1px solid rgba(${STEEL},0.22);border-radius:5px;
  background:none;color:rgba(${STEEL},0.8);font-size:0.9rem;line-height:1;cursor:pointer;}
.hc-agent-runbee:hover{border-color:rgba(${STEEL},0.7);background:rgba(${STEEL},0.12);color:whitesmoke;}
.hc-agent-go{flex:0 0 auto;align-self:flex-start;margin-left:auto;padding:0.1rem 0.55rem;
  border:1px solid rgba(${STEEL},0.4);border-radius:999px;background:none;
  color:rgba(${STEEL},0.9);font:inherit;font-size:0.7rem;letter-spacing:0.06em;
  text-transform:uppercase;cursor:pointer;}
.hc-agent-go:hover{border-color:rgba(${STEEL},0.9);background:rgba(${STEEL},0.14);color:whitesmoke;}
.hc-agent-close,.hc-agent-window{width:2rem;height:2rem;border:none;background:none;color:rgba(245,245,245,0.4);
  font-size:1.3rem;line-height:1;cursor:pointer;border-radius:6px;}
.hc-agent-window{font-size:1rem;}
.hc-agent-close:hover,.hc-agent-window:hover{color:whitesmoke;background:rgba(255,255,255,0.07);}
.hc-agent-body{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:0.6rem;}
.hc-agent-status{display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;}
.hc-agent-pill{padding:0.12rem 0.5rem;border-radius:999px;font-size:0.68rem;letter-spacing:0.08em;
  text-transform:uppercase;border:1px solid rgba(${STEEL},0.4);color:rgba(${STEEL},0.9);}
.hc-agent-pill.working{border-color:rgba(${STEEL},0.9);background:rgba(${STEEL},0.16);}
.hc-agent-pill.stalled{border-color:rgba(214,178,110,0.7);color:rgba(226,196,140,0.95);background:none;}
.hc-agent-pill.blocked{border-color:rgba(126,182,214,0.85);color:rgba(196,226,246,0.98);background:rgba(126,182,214,0.12);}
.hc-agent-needs{font-size:0.76rem;line-height:1.35;color:rgba(196,226,246,0.9);}
.hc-agent-pill.done{border-color:rgba(126,196,142,0.7);color:rgba(150,214,164,0.95);}
.hc-agent-pill.failed{border-color:rgba(226,75,74,0.7);color:rgba(232,124,123,0.95);}
.hc-agent-dim{font-size:0.72rem;color:rgba(216,230,238,0.5);}
.hc-agent-headline{font-size:0.92rem;line-height:1.4;color:rgba(238,244,250,0.95);margin-bottom:0.5rem;}
.hc-agent-headline.ok{color:rgba(150,214,164,0.95);}
.hc-agent-headline.attention{color:rgba(226,196,140,0.98);}
.hc-agent-counts{display:flex;flex-wrap:wrap;gap:0.35rem;margin-bottom:0.35rem;}
.hc-agent-finding{display:flex;align-items:flex-start;gap:0.5rem;padding:0.25rem 0;}
.hc-agent-finding .hc-agent-pill{flex:0 0 auto;}
.hc-agent-finding .hc-agent-text{flex:1 1 auto;min-width:0;font-size:0.8rem;}
.hc-agent-label{font-size:0.68rem;letter-spacing:0.06em;text-transform:uppercase;
  color:rgba(${STEEL},0.6);margin-bottom:0.2rem;}
.hc-agent-where{display:flex;flex-wrap:wrap;gap:0.3rem;}
.hc-agent-tile{padding:0.14rem 0.55rem;border:1px solid rgba(${STEEL},0.35);border-radius:999px;
  background:none;color:rgba(238,244,250,0.9);font:inherit;font-size:0.8rem;cursor:pointer;
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
.hc-agent-row{display:flex;gap:0.5rem;align-items:flex-end;flex:0 0 auto;}
.hc-agent-input{flex:1 1 auto;box-sizing:border-box;resize:none;padding:0.5rem 0.6rem;font:inherit;
  font-size:16px;line-height:1.4;color:whitesmoke;background:rgba(255,255,255,0.05);
  border:1px solid rgba(255,255,255,0.12);border-radius:8px;outline:none;}
.hc-agent-input:focus{border-color:rgba(${STEEL},0.55);}
.hc-agent-btn{min-height:2.4rem;padding:0 0.9rem;border-radius:8px;border:1px solid rgba(255,255,255,0.14);
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
