// diamondcoreprocessor.com/assistant/orchestrator.drone.ts
//
// THE ORCHESTRATOR — the bee that watches the other bees.
//
// Work that runs in the background goes wrong quietly: an ask sits pending
// because nothing is bridged, a routine claims a tile and never reports again,
// two passes fight over the same tile, something fails at 3am and nobody sees
// the toast. The orchestrator's whole job is that none of it goes unnoticed.
//
// It sweeps the agent registry on a slow tick and raises FINDINGS:
//
//   waiting    queued a long time with nothing picking it up
//   silent     said it was working, then went quiet
//   overlap    two live agents working the same tile
//   failed     ended badly
//   rogue      still alive long past any reasonable run
//
// It has its own bee (kind `orchestrator`: the wide slow figure-8, wearing the
// eye) which is calm while everything is healthy and dances when it has
// something to say. Clicking it opens the same panel every other agent uses —
// its activity log IS the findings list.
//
// ── It reports, it never intervenes ────────────────────────────────────
//
// A stalled ask is still the participant's request; a slow routine may be
// slow for a good reason. Retiring or restarting someone else's work on a
// timer would destroy data to satisfy a heuristic, so the orchestrator does
// not do it. It makes the state visible and leaves the decision where it
// belongs.
//
// The other half of the job — stray log files, code that has drifted from the
// documentation, mirrors that were never built — lives outside the browser
// and runs over the bridge: `scripts/bridge/orchestrator-sweep.cjs` reports
// its findings back through the `agent-progress` op, onto this same bee.

import { Drone, EffectBus } from '@hypercomb/core'
import type { Agent, AgentRegistry } from './agent-registry.service.js'
import { drainBlurbs } from './chat-blurb.js'

export type FindingKind = 'waiting' | 'silent' | 'overlap' | 'failed' | 'rogue' | 'sweep' | 'blocked'

export interface OrchestratorFinding {
  /** Stable identity for as long as the finding stands — the same string the
   *  drone keys it under. It is what a button in the panel can hold on to:
   *  a finding cannot be carried across a navigation by object reference,
   *  because every sweep rebuilds the objects. */
  readonly key: string
  readonly kind: FindingKind
  /** Agent ids the finding concerns. */
  readonly agents: readonly string[]
  readonly text: string
  readonly at: number
  /** Where in the hive to go and look, when the finding has a place at all.
   *  Captured when the finding is raised, NOT resolved later: by the time
   *  somebody presses "go", the agent that explains where this belongs may
   *  already have been retired. */
  readonly path?: readonly string[]
}

/** The one agent id the orchestrator reports under. Bridge sweeps target it. */
export const ORCHESTRATOR_ID = 'orchestrator'

/** The state of the hive's work in one object — what the orchestrator would
 *  say if you asked "how is it going?". Derived, never stored. */
export interface OrchestratorSummary {
  /** Live work: everything not yet done or failed. */
  readonly working: number
  readonly pending: number
  readonly done: number
  readonly failed: number
  /** Live agents with nothing reported for a while. */
  readonly stalled: number
  /** Live agents waiting on the PARTICIPANT. Not a fault in the hive — the
   *  most actionable number on the panel, because it is the only one a
   *  person can clear by answering. */
  readonly blocked: number
  /** Live model agents by vendor — "who is running right now". */
  readonly vendors: ReadonlyArray<{ vendor: string; count: number }>
  /** Every tile any live agent is working on, with where it lives. */
  readonly tiles: ReadonlyArray<{ label: string; path: string[]; agents: number }>
  readonly findings: readonly OrchestratorFinding[]
  /** Nothing standing and nothing stalled. */
  readonly healthy: boolean
  /** One line: the answer to "is everything going smoothly?". */
  readonly headline: string
}

const SWEEP_MS = 15_000
/** Queued this long with nobody picking it up is worth saying out loud. */
const WAITING_MS = 5 * 60_000
/** Working, but nothing reported since. */
const SILENT_MS = 4 * 60_000
/** Alive far longer than any single pass should be. */
const ROGUE_MS = 45 * 60_000
/** Soonest the orchestrator will generalize again once something has changed. */
const SUMMARY_MS = 3 * 60_000
/** It speaks this often even when nothing has changed — a hive stuck quietly
 *  for an hour must still say so out loud. */
const STEADY_MS = 12 * 60_000

// ── LABELLING THE THREADS NOBODY LABELLED ─────────────────────────────
//
// A conversation is named by its FIRST message, which is what you did not
// know yet when you typed it. The blurb (chat-blurb.ts) is the other end of
// the thread said briefly, and something has to notice which threads are
// missing one — that is a sweep over background work nobody is watching,
// which is this bee's whole job.
//
// It runs on its OWN clock, not inside #sweep, because #sweep stands down
// entirely when no agent is live — and an idle hive is exactly when there is
// room to do this. It is also silent: the drain never RAISES the bee (see
// #blurbPass), so a hive with nothing to watch stays empty while its threads
// quietly get their labels.
const BLURB_MS = 5 * 60_000
/** Threads labelled per pass. Small on purpose — it competes with the hive
 *  for one main thread, so it takes a few and comes back in five minutes. */
const BLURB_LIMIT = 2

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

const minutes = (ms: number): string => `${Math.max(1, Math.round(ms / 60_000))}m`

export class OrchestratorDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'

  public override description =
    'Watches every agent in the hive and reports work that has stalled, gone silent, overlapped, failed, or run away.'
  public override effects = ['network'] as const

  protected override listens = []
  protected override emits = [
    'agent:start', 'agent:progress', 'agent:end', 'orchestrator:findings', 'render:gather-set',
  ]

  #timer: ReturnType<typeof setInterval> | null = null
  #blurbTimer: ReturnType<typeof setInterval> | null = null
  /** A pass in flight. Model calls outlast the interval, and two drains would
   *  pick the same threads and pay for them twice. */
  #blurbBusy = false
  #started = false
  /** Findings currently standing, keyed so the same one is not re-announced
   *  every 15 seconds — an alert that repeats is an alert nobody reads. */
  readonly #open = new Map<string, OrchestratorFinding>()
  #raised = false
  /** The finding the participant is carrying, by key. */
  #held = ''
  /** Running-commentary state: when it last spoke, the shape of the hive when
   *  it did, and who was live then — the diff against this is what it has to
   *  say next time. */
  #lastSummaryAt = 0
  #lastShape = ''
  #seen = new Map<string, string>()
  /** The last all-clear said out loud, so it is not repeated every sweep. */
  #lastAllClear = ''

  protected override sense = (): boolean => true

  /** Start watching at WARMUP, not on the first pulse. A drone's heartbeat
   *  runs when the processor acts — i.e. when somebody is using the hive —
   *  and a watchdog that only wakes up while you are watching it is not a
   *  watchdog. (Verified: a hive left alone never started the sweep at all.)
   *  The heartbeat below stays as a safety net if warmup was missed. */
  public override async warmup(): Promise<void> {
    this.#begin()
  }

  protected override heartbeat = async (): Promise<void> => {
    this.#begin()
  }

  #begin = (): void => {
    if (this.#started) return
    this.#started = true
    this.#timer = setInterval(this.#sweep, SWEEP_MS)
    this.#sweep()
    this.#blurbTimer = setInterval(this.#blurbPass, BLURB_MS)
    void this.#blurbPass()
  }

  /** ONE LABELLING PASS. Never raises the bee: a hive with nothing to watch
   *  must stay empty, and a blurb is a convenience, not a finding. It reports
   *  only when the orchestrator is ALREADY up and has a log worth adding to. */
  #blurbPass = async (): Promise<void> => {
    if (this.#blurbBusy) return
    this.#blurbBusy = true
    try {
      const { behind, minted } = await drainBlurbs(BLURB_LIMIT)
      if (!minted || !this.#raised) return
      const left = behind - minted
      this.emitEffect('agent:progress', {
        id: ORCHESTRATOR_ID,
        status: 'working',
        activity: `labelled ${minted} conversation${minted === 1 ? '' : 's'}`
          + (left > 0 ? ` — ${left} still unlabelled` : ''),
      })
    } catch { /* a convenience nobody asked for out loud must never raise */ }
    finally { this.#blurbBusy = false }
  }

  /** Everything currently wrong, newest first. */
  get findings(): OrchestratorFinding[] {
    return [...this.#open.values()].sort((a, b) => b.at - a.at)
  }

  /** Record a finding from the REPO-SIDE sweep (stray logs, mirrors that were
   *  never built, notes citing source files that no longer exist). Those come
   *  in over the bridge, which cannot see the registry — so they are kept
   *  under their own keys and carried through every hive-side sweep until the
   *  next run of the script clears them. */
  noteSweep(text: string): void {
    const clean = text.trim()
    if (!clean) return
    if (clean === 'clear') {
      for (const key of [...this.#open.keys()]) if (this.#open.get(key)?.kind === 'sweep') this.#open.delete(key)
      this.emitEffect('orchestrator:findings', { findings: this.findings })
      return
    }
    const key = `sweep:${clean}`
    if (this.#open.has(key)) return
    this.#raise(this.#registry()?.list().length ?? 0)
    this.#open.set(key, { key, kind: 'sweep', agents: [], text: clean, at: Date.now() })
    this.emitEffect('orchestrator:findings', { findings: this.findings })
  }

  /** How the hive is doing, in one read. The panel shows this when you open
   *  the orchestrator, and it is the same derivation the findings come from —
   *  so the headline can never disagree with the list under it. */
  summary(): OrchestratorSummary {
    const agents = (this.#registry()?.list() ?? []).filter(a => a.id !== ORCHESTRATOR_ID)
    const live = agents.filter(a => a.status === 'pending' || a.status === 'working' || a.status === 'blocked')

    const vendors = new Map<string, number>()
    for (const agent of live) {
      if (agent.kind !== 'model') continue
      const vendor = agent.vendor ?? 'unknown'
      vendors.set(vendor, (vendors.get(vendor) ?? 0) + 1)
    }

    // One row per TILE, not per agent: two agents on one tile is one place to
    // go and look, and the count is exactly what makes it worth looking at.
    const tiles = new Map<string, { label: string; path: string[]; agents: number }>()
    for (const agent of live) {
      for (const label of agent.targets) {
        const existing = tiles.get(label)
        if (existing) { existing.agents += 1; continue }
        tiles.set(label, { label, path: [...agent.segments, label], agents: 1 })
      }
    }

    const findings = this.findings
    const stalled = live.filter(a => a.stalled).length
    const blocked = live.filter(a => a.status === 'blocked').length
    const healthy = findings.length === 0 && stalled === 0 && blocked === 0
    // Blocked leads. It is the only line the participant can clear by
    // answering, so it must not be averaged in with things that are merely
    // going wrong on their own.
    const headline = blocked > 0
      ? `${blocked} agent${blocked === 1 ? ' is' : 's are'} waiting on you.`
      : live.length === 0
        ? (findings.length === 0 ? 'Nothing is running.' : `Nothing is running, but ${findings.length} thing${findings.length === 1 ? '' : 's'} still needs a look.`)
        : healthy
          ? `${live.length} agent${live.length === 1 ? '' : 's'} working, all reporting normally.`
          : `${live.length} agent${live.length === 1 ? '' : 's'} working — ${findings.length || stalled} need${(findings.length || stalled) === 1 ? 's' : ''} a look.`

    return {
      working: agents.filter(a => a.status === 'working').length,
      pending: agents.filter(a => a.status === 'pending').length,
      done: agents.filter(a => a.status === 'done').length,
      failed: agents.filter(a => a.status === 'failed').length,
      stalled,
      blocked,
      vendors: [...vendors.entries()].map(([vendor, count]) => ({ vendor, count })).sort((a, b) => b.count - a.count),
      tiles: [...tiles.values()].sort((a, b) => b.agents - a.agents || a.label.localeCompare(b.label)),
      findings,
      healthy,
      headline,
    }
  }

  /** THE AUDIT — paint every tile that has an agent on it as one view, gathered
   *  from wherever in the hive those tiles actually live, so the participant
   *  can walk the whole of what is running from one place. Transient: nothing
   *  is committed, and it clears the moment they enter one of the tiles (which
   *  is the point — the click takes them to the real work).
   *
   *  Returns how many tiles were gathered; 0 means nothing is targeting a tile
   *  right now, and the caller says so rather than opening an empty view. */
  audit(): number {
    const tiles = this.summary().tiles
    this.emitEffect('render:gather-set', {
      key: `orchestrator:${tiles.map(t => t.label).join(',')}`,
      items: tiles.map(t => ({ label: t.label, path: t.path })),
    })
    return tiles.length
  }

  /** Put the audit view down without navigating anywhere. */
  clearAudit(): void {
    this.emitEffect('render:gather-set', { items: [] })
  }

  // ── carrying a finding ────────────────────────────────────────────────
  //
  // A finding is worth something only if you can act on it, and acting on it
  // usually means going to look first. Between "go and look" and "deal with
  // it" the hive navigates, the sweep runs several more times, and every
  // finding object is rebuilt — so what is carried across is the KEY, and the
  // finding is re-resolved from it on the other side. Carrying nothing but a
  // string is what makes the trip survivable.

  /** The finding being carried, if it still stands. It can vanish underneath
   *  the participant — the work may recover on its own while they walk over —
   *  and that is a resolution too, so the caller shows it as one. */
  get held(): OrchestratorFinding | undefined {
    return this.#held ? this.#open.get(this.#held) : undefined
  }

  /** Pick a finding up. Returns it, or undefined if it has already cleared. */
  hold(key: string): OrchestratorFinding | undefined {
    const finding = this.#open.get(key)
    this.#held = finding ? key : ''
    this.emitEffect('orchestrator:findings', { findings: this.findings })
    return finding
  }

  /** Put it down without doing anything to it. */
  release(): void {
    if (!this.#held) return
    this.#held = ''
    this.emitEffect('orchestrator:findings', { findings: this.findings })
  }

  /** COMPLETE the carried operation — the participant's hand, not the
   *  orchestrator's.
   *
   *  This does not contradict "it reports, it never intervenes". That rule is
   *  about acting ON A TIMER: retiring somebody's ask because a heuristic ran
   *  out of patience destroys their data to satisfy a guess. A participant who
   *  has walked to the tile, read the finding and pressed the button has made
   *  the decision the orchestrator is not entitled to make on its own. The
   *  automatic path above is unchanged and still only ever describes.
   *
   *  Returns what it did, in words, for the log and the toast. */
  async complete(): Promise<string> {
    const finding = this.held
    if (!finding) return ''
    const registry = this.#registry()

    let did = ''
    if (finding.kind === 'sweep') {
      // Repo-side: there is nothing in the hive to stop. Completing it means
      // acknowledging it, so it stops being raised at the participant.
      did = 'marked as dealt with'
    } else if (finding.kind === 'overlap' && registry) {
      // Keep the one still talking, retire the rest. Two passes on one tile
      // is a race to clobber each other's writes, and the agent that reported
      // most recently is the one demonstrably still doing something.
      const live = finding.agents
        .map(id => registry.get(id))
        .filter((a): a is Agent => !!a)
        .sort((a, b) => b.updatedAt - a.updatedAt)
      const [keep, ...rest] = live
      for (const agent of rest) await registry.stop(agent.id, 'stopped by you — another agent has this tile')
      did = rest.length
        ? `stopped ${rest.length} of ${live.length}, left ${keep?.behavior ?? 'the newest'} working`
        : 'nothing left to stop — it had already cleared'
    } else if (registry) {
      let stopped = 0
      for (const id of finding.agents) if (await registry.stop(id, 'stopped by you')) stopped++
      did = stopped ? `stopped ${stopped} agent${stopped === 1 ? '' : 's'}` : 'it had already finished'
    }

    this.#open.delete(finding.key)
    this.#held = ''
    this.emitEffect('agent:progress', {
      id: ORCHESTRATOR_ID,
      activity: `you completed "${finding.text}" — ${did}`,
      status: 'working',
    })
    this.emitEffect('orchestrator:findings', { findings: this.findings })
    return did
  }

  // ── the running commentary ────────────────────────────────────────────

  /** Periodically, the orchestrator says in its own words what has been going
   *  on. Not a repeat of the findings — a GENERALIZATION over them and over
   *  what has changed since it last spoke, so the log reads as a narrative you
   *  can scroll back through instead of a pile of alerts.
   *
   *  Two clocks, because both failure modes are real: narrate too often and it
   *  is noise nobody reads; narrate only on change and a hive that has been
   *  quietly stuck for an hour never says so. So it speaks when something has
   *  CHANGED (at most every SUMMARY_MS), and otherwise still speaks every
   *  STEADY_MS to say that nothing has. */
  #summarize = (agents: readonly Agent[], now: number): void => {
    const live = agents.filter(a => a.status === 'pending' || a.status === 'working')
    const shape = live.map(a => `${a.id}:${a.status}`).sort().join(',') + `|${this.#open.size}`
    const since = now - this.#lastSummaryAt
    const changed = shape !== this.#lastShape

    if (since < SUMMARY_MS) return
    if (!changed && since < STEADY_MS) return

    const parts: string[] = []
    const working = live.filter(a => a.status === 'working').length
    const queued = live.filter(a => a.status === 'pending').length
    parts.push(live.length === 0 ? 'nothing running'
      : [working && `${working} working`, queued && `${queued} queued`].filter(Boolean).join(', '))

    // What moved since it last spoke. This is the part that makes it a
    // narrative rather than a snapshot repeated.
    if (this.#seen.size) {
      const started = live.filter(a => !this.#seen.has(a.id)).length
      let finished = 0
      let failed = 0
      for (const [id] of this.#seen) {
        const agent = agents.find(a => a.id === id)
        if (!agent) { finished++; continue }
        if (agent.status === 'done') finished++
        else if (agent.status === 'failed') failed++
      }
      const moved = [
        started && `${started} started`,
        finished && `${finished} finished`,
        failed && `${failed} failed`,
      ].filter(Boolean).join(', ')
      parts.push(moved ? `since last: ${moved}` : `nothing has moved in ${minutes(since)}`)
    }

    // The one to keep an eye on. A count cannot tell you WHICH agent is
    // drifting, and that is the whole reason to read this line.
    const quietest = [...live].sort((a, b) => a.updatedAt - b.updatedAt)[0]
    if (quietest && now - quietest.updatedAt > SILENT_MS / 2) {
      const where = quietest.targets.length ? ` on "${quietest.targets[0]}"` : ''
      parts.push(`quietest: ${quietest.behavior}${where}, ${minutes(now - quietest.updatedAt)} without a word`)
    } else if (this.#open.size) {
      parts.push(`${this.#open.size} finding${this.#open.size === 1 ? '' : 's'} standing`)
    } else if (live.length) {
      parts.push('all reporting normally')
    }

    this.#lastSummaryAt = now
    this.#lastShape = shape
    this.#seen = new Map(live.map(a => [a.id, a.status]))
    this.emitEffect('agent:progress', {
      id: ORCHESTRATOR_ID,
      activity: parts.join(' · '),
      status: live.length ? 'working' : 'pending',
    })
  }

  #registry = (): AgentRegistry | undefined => ioc<AgentRegistry>('@diamondcoreprocessor.com/AgentRegistry')

  #sweep = (): void => {
    const registry = this.#registry()
    if (!registry) return
    const agents = registry.list().filter(a => a.id !== ORCHESTRATOR_ID)

    // Nothing running and nothing outstanding: stand down completely. An idle
    // hive should be an empty hive — a permanent watcher bee is decoration.
    if (agents.length === 0 && this.#open.size === 0) {
      if (this.#raised) {
        this.#raised = false
        this.emitEffect('agent:end', { id: ORCHESTRATOR_ID, ok: true, summary: 'nothing left to watch' })
      }
      return
    }

    this.#raise(agents.length)

    const now = Date.now()
    const found = new Map<string, OrchestratorFinding>()
    const add = (key: string, finding: Omit<OrchestratorFinding, 'key'>): void => {
      found.set(key, { ...finding, key })
    }
    /** Where an agent's trouble lives. A targeted agent points at its tile; an
     *  untargeted one points at the page it was raised from. */
    const placeOf = (agent: Agent): string[] | undefined =>
      agent.targets.length ? [...agent.segments, agent.targets[0]]
        : agent.segments.length ? [...agent.segments]
        : undefined

    for (const agent of agents) {
      const idle = now - agent.updatedAt
      const age = now - agent.startedAt
      const path = placeOf(agent)

      if (agent.status === 'failed') {
        add(`failed:${agent.id}`, {
          kind: 'failed', agents: [agent.id], at: now, path,
          text: `${agent.behavior} failed${agent.targets.length ? ` on ${agent.targets.join(', ')}` : ''}`,
        })
      } else if (agent.status === 'pending' && age > WAITING_MS) {
        add(`waiting:${agent.id}`, {
          kind: 'waiting', agents: [agent.id], at: now, path,
          text: `${agent.behavior} has been queued ${minutes(age)} with nothing picking it up`
            + (agent.kind === 'model' ? ' — is a Claude Code bridged?' : ''),
        })
      } else if (agent.status === 'blocked') {
        // Raised immediately — no grace period. A question nobody has been
        // told about is the one thing here that only a person can clear, so
        // it must surface the moment it is asked, not after a timeout.
        add(`blocked:${agent.id}`, {
          kind: 'blocked', agents: [agent.id], at: now, path,
          text: agent.needs
            ? `${agent.behavior} is waiting on you: ${agent.needs}`
            : `${agent.behavior} is waiting on you`,
        })
      } else if (agent.status === 'working' && idle > SILENT_MS) {
        add(`silent:${agent.id}`, {
          kind: 'silent', agents: [agent.id], at: now, path,
          text: `${agent.behavior} has reported nothing for ${minutes(idle)}`,
        })
      }

      // ROGUE means "running far too long". Waiting on a person is not
      // running — the same exemption the registry watchdog makes, for the
      // same reason.
      if (age > ROGUE_MS && agent.status !== 'done' && agent.status !== 'blocked') {
        add(`rogue:${agent.id}`, {
          kind: 'rogue', agents: [agent.id], at: now, path,
          text: `${agent.behavior} has been running ${minutes(age)} — check whether it is still doing anything`,
        })
      }
    }

    // Two live agents on one tile: not always wrong (an ask and a sync can
    // legitimately overlap), but it is the shape of two passes clobbering each
    // other's writes, so it gets said once.
    const byTarget = new Map<string, Agent[]>()
    for (const agent of agents) {
      if (agent.status === 'done' || agent.status === 'failed') continue
      for (const target of agent.targets) {
        byTarget.set(target, [...(byTarget.get(target) ?? []), agent])
      }
    }
    for (const [target, sharing] of byTarget) {
      if (sharing.length < 2) continue
      add(`overlap:${target}`, {
        kind: 'overlap', agents: sharing.map(a => a.id), at: now,
        path: [...sharing[0].segments, target],
        text: `${sharing.length} agents are working "${target}" at once (${sharing.map(a => a.behavior).join(', ')})`,
      })
    }

    // Sweep findings pushed in from the bridge live under their own keys and
    // are not re-derived here — carry them through untouched.
    for (const [key, finding] of this.#open) {
      if (finding.kind === 'sweep') found.set(key, finding)
    }

    for (const [key, finding] of found) {
      if (this.#open.has(key)) continue
      this.#open.set(key, finding)
      this.emitEffect('agent:progress', { id: ORCHESTRATOR_ID, activity: finding.text, status: 'working' })
    }
    // A finding that no longer holds simply clears — the work recovered.
    for (const key of [...this.#open.keys()]) {
      if (!found.has(key)) this.#open.delete(key)
    }

    // The all-clear, said ONCE per state — not every fifteen seconds. Emitted
    // unguarded it appended an identical line to the activity log on every
    // sweep, and since the log keeps only the last ACTIVITY_LIMIT entries, ten
    // quiet minutes were enough to push every finding and every summary out of
    // it. A watcher that floods its own log has destroyed the record it exists
    // to keep. (Seen live: three identical lines in thirty seconds.)
    if (this.#open.size === 0) {
      const allClear = `watching ${agents.length} agent${agents.length === 1 ? '' : 's'} — all healthy`
      if (allClear !== this.#lastAllClear) {
        this.#lastAllClear = allClear
        this.emitEffect('agent:progress', { id: ORCHESTRATOR_ID, activity: allClear, status: 'pending' })
      }
    } else {
      // Something is standing again: the next all-clear is news.
      this.#lastAllClear = ''
    }
    // A finding can clear while the participant is walking to it. Nothing to
    // complete then — drop the carry rather than leave a button pointing at
    // something that no longer exists.
    if (this.#held && !this.#open.has(this.#held)) this.#held = ''
    this.#summarize(agents, now)
    this.emitEffect('orchestrator:findings', { findings: this.findings })
  }

  /** Raise the orchestrator's own agent so it has a bee. Idempotent. */
  #raise = (watching: number): void => {
    if (this.#raised) return
    this.#raised = true
    this.emitEffect('agent:start', {
      id: ORCHESTRATOR_ID,
      behavior: 'orchestrator',
      kind: 'orchestrator',
      request: 'Watching every agent in the hive for work that stalls, overlaps, fails, or runs away.',
      targets: [],
      segments: [],
    })
    this.emitEffect('agent:progress', {
      id: ORCHESTRATOR_ID,
      activity: `watching ${watching} agent${watching === 1 ? '' : 's'}`,
      status: 'pending',
    })
  }

  protected override dispose = (): void => {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
    if (this.#blurbTimer) clearInterval(this.#blurbTimer)
    this.#blurbTimer = null
  }
}

const _orchestrator = new OrchestratorDrone()
window.ioc.register('@diamondcoreprocessor.com/OrchestratorDrone', _orchestrator)

// A sweep run over the bridge reports through the same `agent-progress` op as
// any other responder. It marks its lines with SWEEP_PREFIX so they can be
// told apart from the drone's OWN progress emissions — without that, this
// listener would hear itself and every heartbeat would become a finding.
export const SWEEP_PREFIX = 'sweep: '

EffectBus.on<{ id?: string; activity?: string }>('agent:progress', payload => {
  if (payload?.id !== ORCHESTRATOR_ID) return
  const activity = String(payload.activity ?? '')
  if (!activity.startsWith(SWEEP_PREFIX)) return
  ioc<OrchestratorDrone>('@diamondcoreprocessor.com/OrchestratorDrone')
    ?.noteSweep(activity.slice(SWEEP_PREFIX.length))
})
