// assistant/run-preview.view.ts
//
// WHAT THE COMMAND LINE IS ABOUT TO RUN, READ BEFORE ENTER (jwize,
// 2026-11-26: "a full screen view semi-transparent background so you can see
// the screen behind. The details in professional code formatted glory so you
// can see what the command line is going to execute with a clear description
// based on the behaviors").
//
// A call from outside (an agent, a script, the presentation planter — see
// external-call.drone.ts) waits on the command line as the `$` stance. This
// view opens over the whole hive while it waits, the hive still visible
// through it, and draws every line the way an editor draws code: numbered,
// the behaviour words lit in their own colour, arguments, paths and
// signatures each in their own ink, the words a sentence throws away dimmed.
// Beside each line, what it will do — the behaviour's own description — and,
// where the door will refuse it or a word is claimed twice, why, in the
// door's own words. Nothing here decides anything: each line's plan comes
// from commands/utterance/line-plan.ts, which reads it the way the door will.
//
// The answer is the same as on the line: Enter runs, Escape declines. While
// the command line has the keyboard it answers there, exactly as before; when
// the keyboard is anywhere else, this view takes the two keys. The same one
// second arming as the line, so an Enter meant for something else never runs
// a call that arrived under it.
//
// A DEBUGGER WHEN YOU WANT ONE (jwize: "this should be a debugger as well if
// we want it to … we can step through and see the results in a sub list in
// each item after completed"). Click a line number for a breakpoint; F10
// starts the run paused before the first line, and steps one line at a time;
// F5 runs on to the next breakpoint; Shift+F5 stops, and nothing more is
// said. Every line that has run gets its verdict, and everything the hive said
// while it ran, in a list under it. The pauses are the external-call bee's
// (EXTERNAL_CALL_* below); this view only asks for them and draws them.
//
// YOUR OWN LINE, ON ASK (F2 on the command line, jwize: "opt-in key only").
// The line you are typing is drawn the same way, live as you type, read the
// way your own Enter will read it (line-plan.ts `planOwnLine`). Enter still
// runs it on the command line exactly as before; F2 or Escape puts it away.
//
// A dependency: it exports the element; the external-call bee defines it on
// the first call and adds its tag to the ShellSurfaceRegistry.

import {
  EffectBus, EXTERNAL_ANSWER, EXTERNAL_ASK, I18N_IOC_KEY, currentMachineGrant,
  type ExternalAnswer, type ExternalAsk, type I18nProvider,
} from '@hypercomb/core'
import { planLine, planOwnLine, type LinePlan, type PlanDeps, type PlanEntry, type Stance } from '../commands/utterance/line-plan.js'
import type { UtteranceReading } from '../commands/utterance/utterance-reading.js'

export const RUN_PREVIEW_SURFACE = 'hc-run-preview'
export const RUN_PREVIEW_OWNER = '@diamondcoreprocessor.com/RunPreviewView'
/** `{ open: boolean }`, replayed: while the preview shows a call, the command
 *  line does not list the same lines under itself (shared
 *  command-line.component.ts reads it by this name). */
export const RUN_PREVIEW_OPEN = 'run-preview:open'
/** `{ text, line, stance }` or `{ text: null }`, from the command line while
 *  its own line is shown (F2). Replayed, so a view defined late still shows it. */
export const RUN_PREVIEW_LINE = 'run-preview:line'
/** From this view to the command line: the participant put their line away. */
export const RUN_PREVIEW_LINE_CLOSE = 'run-preview:line-close'

// The external-call bee's debugger, spelled as it spells it.
const EXTERNAL_CALL_DEBUG = 'external-call:debug'
const EXTERNAL_CALL_PAUSED = 'external-call:paused'
const EXTERNAL_CALL_RESUME = 'external-call:resume'
const EXTERNAL_CALL_LINE = 'external-call:line'
const EXTERNAL_CALL_FINISHED = 'external-call:finished'

const STYLE_ID = 'hc-run-preview-styles'
/** As the command line's own `EXTERNAL_ARM_MS`. */
const ARM_MS = 1000

type Ioc = { get?: (key: string) => unknown }
const ioc = (): Ioc | undefined => (window as { ioc?: Ioc }).ioc

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = ioc()?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t?.(key, params)
  return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
}

/** The live census, reader and grant, as the door reads them. */
const liveDeps = (): PlanDeps => {
  const slash = ioc()?.get?.('@diamondcoreprocessor.com/SlashBehaviourDrone') as
    { entries?(): readonly PlanEntry[]; retired?(name: string): PlanEntry['retired'] } | undefined
  const reader = ioc()?.get?.('@diamondcoreprocessor.com/UtteranceReader') as
    { read?(text: string): UtteranceReading | null } | undefined
  return {
    census: slash?.entries?.() ?? [],
    read: text => reader?.read?.(text) ?? null,
    grant: currentMachineGrant(),
    retired: name => slash?.retired?.(name),
  }
}

/** What one line came to, as the bee reported it. */
type LineResult = { readonly text: string; readonly verdict: string; readonly heard?: readonly string[]; readonly extra?: boolean }

/** A call being run under the debugger, kept after the ask leaves the line. */
type Debugged = {
  readonly ask: ExternalAsk
  readonly plans: readonly LinePlan[]
  readonly results: Map<number, LineResult[]>
  state: 'running' | 'paused' | 'finished'
  at: number | null
  stoppedAt?: number
}

/** The participant's own line, while F2 shows it. */
type OwnLine = { readonly text: string; readonly line: string; readonly stance: Stance }

const verdictKind = (verdict: string): 'ok' | 'alert' | 'warn' =>
  /^ran\b/i.test(verdict) ? 'ok' : /^refused\b/i.test(verdict) ? 'alert' : 'warn'

export class RunPreviewElement extends HTMLElement {
  #sheet: HTMLElement | null = null
  #ask: ExternalAsk | null = null
  #shownAt = 0
  #breakpoints = new Set<number>()
  #debugged: Debugged | null = null
  #own: OwnLine | null = null
  #offs: Array<() => void> = []

  /** SEAM: a spec hands in a fixed census. */
  deps: () => PlanDeps = liveDeps

  connectedCallback(): void {
    ensureStyles()
    // Replayed: a call that was waiting before this element was defined shows.
    this.#offs.push(EffectBus.on<ExternalAsk | null>(EXTERNAL_ASK, ask => {
      const waiting = ask && typeof ask.id === 'string' && Array.isArray(ask.lines) ? ask : null
      if (waiting && waiting.id !== this.#ask?.id) {
        this.#shownAt = Date.now()
        this.#breakpoints = new Set()
        this.#terms = new Set()
      }
      this.#ask = waiting
      this.#refresh()
    }))
    this.#offs.push(EffectBus.on<OwnLine | { text: null }>(RUN_PREVIEW_LINE, own => {
      this.#own = own && typeof own.text === 'string'
        ? { text: own.text, line: String((own as OwnLine).line ?? own.text), stance: (own as OwnLine).stance ?? 'command' }
        : null
      this.#refresh()
    }))
    this.#offs.push(EffectBus.on<{ id?: string; at?: number }>(EXTERNAL_CALL_PAUSED, paused => {
      const run = this.#debugged
      if (!run || paused?.id !== run.ask.id) return
      run.state = 'paused'
      run.at = Number(paused.at ?? 0)
      this.#render()
      this.#sheet?.querySelector('.hc-run-line.is-here')?.scrollIntoView?.({ block: 'nearest' })
    }))
    this.#offs.push(EffectBus.on<{ id?: string; at?: number } & LineResult>(EXTERNAL_CALL_LINE, line => {
      const run = this.#debugged
      if (!run || line?.id !== run.ask.id) return
      const at = Number(line.at ?? 0)
      const list = run.results.get(at) ?? []
      list.push({ text: String(line.text ?? ''), verdict: String(line.verdict ?? ''), ...(line.heard?.length ? { heard: line.heard } : {}), ...(line.extra ? { extra: true } : {}) })
      run.results.set(at, list)
      if (!line.extra) { run.state = 'running'; run.at = null }
      this.#render()
    }))
    this.#offs.push(EffectBus.on<{ id?: string; stoppedAt?: number }>(EXTERNAL_CALL_FINISHED, done => {
      const run = this.#debugged
      if (!run || done?.id !== run.ask.id) return
      run.state = 'finished'
      run.at = null
      if (typeof done.stoppedAt === 'number') run.stoppedAt = done.stoppedAt
      this.#render()
    }))
  }

  disconnectedCallback(): void {
    for (const off of this.#offs) off()
    this.#offs = []
    this.#close()
  }

  get isOpen(): boolean { return !!this.#sheet }

  /** Open on whatever is to be shown, or close when nothing is. A debugged
   *  run outranks a waiting call, which outranks your own line. */
  #refresh(): void {
    if (this.#debugged || this.#ask || this.#own) this.#open()
    else this.#close()
  }

  #open(): void {
    if (!this.#sheet) {
      const sheet = document.createElement('section')
      sheet.className = 'hc-run'
      sheet.setAttribute('role', 'dialog')
      sheet.setAttribute('aria-modal', 'false')
      sheet.setAttribute('data-consumes-wheel', '')
      this.appendChild(sheet)
      this.#sheet = sheet
      window.addEventListener('keydown', this.#onKey, true)
    }
    EffectBus.emit(RUN_PREVIEW_OPEN, { open: !!(this.#ask || this.#debugged) })
    this.#render()
  }

  #close(): void {
    if (!this.#sheet) return
    window.removeEventListener('keydown', this.#onKey, true)
    this.#sheet.remove()
    this.#sheet = null
    EffectBus.emit(RUN_PREVIEW_OPEN, { open: false })
  }

  /** Answer the waiting call: run it plainly, run it under the debugger
   *  (`step`, or any breakpoint set), or decline it. */
  #answer(decision: ExternalAnswer['decision'], step = false): void {
    const ask = this.#ask
    if (!ask) return
    if (decision === 'run' && Date.now() - this.#shownAt < ARM_MS) return
    if (decision === 'run' && (step || this.#breakpoints.size)) {
      const deps = this.deps()
      this.#debugged = {
        ask, plans: ask.lines.map(line => planLine(line, deps)),
        results: new Map(), state: 'running', at: null,
      }
      EffectBus.emitTransient(EXTERNAL_CALL_DEBUG, { id: ask.id, step, breakpoints: [...this.#breakpoints] })
    }
    EffectBus.emitTransient<ExternalAnswer>(EXTERNAL_ANSWER, { id: ask.id, decision })
  }

  #resume(mode: 'step' | 'continue' | 'stop'): void {
    const run = this.#debugged
    if (!run || run.state !== 'paused') return
    run.state = 'running'
    run.at = null
    EffectBus.emitTransient(EXTERNAL_CALL_RESUME, { id: run.ask.id, mode })
    this.#render()
  }

  /** Terms broken out, as `<line>:<term>`; folded again when a new call shows. */
  #terms = new Set<string>()

  #termsOpen(line: number): ReadonlySet<string> {
    const open = new Set<string>()
    for (const key of this.#terms) {
      const cut = key.indexOf(':')
      if (Number(key.slice(0, cut)) === line) open.add(key.slice(cut + 1))
    }
    return open
  }

  #toggleTerm(line: number, term: string): void {
    const key = `${line}:${term}`
    if (this.#terms.has(key)) this.#terms.delete(key)
    else this.#terms.add(key)
    this.#render()
  }

  #toggleBreakpoint(at: number): void {
    const run = this.#debugged
    const set = this.#breakpoints
    if (set.has(at)) set.delete(at)
    else set.add(at)
    // A run under the debugger hears the new set at once: its stepping stays.
    if (run && run.state !== 'finished') EffectBus.emitTransient(EXTERNAL_CALL_DEBUG, { id: run.ask.id, breakpoints: [...set] })
    this.#render()
  }

  #putAway(): void {
    if (this.#debugged?.state === 'finished') {
      this.#debugged = null
      this.#refresh()
      return
    }
    if (!this.#debugged && !this.#ask && this.#own) {
      this.#own = null
      EffectBus.emitTransient(RUN_PREVIEW_LINE_CLOSE, {})
      this.#refresh()
    }
  }

  readonly #onKey = (event: KeyboardEvent): void => {
    if (event.isComposing || !this.#sheet) return
    const target = event.target as Element | null
    const inLine = !!target?.closest?.('hc-command-line')
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey
    const run = this.#debugged
    const body = this.#sheet.querySelector<HTMLElement>('.hc-run-body')
    let took = true
    // THE DEBUGGER'S KEYS are nobody else's, so they are taken wherever the
    // keyboard is, the command line included.
    if (run && run.state === 'paused' && event.key === 'F10' && plain) this.#resume('step')
    else if (run && run.state === 'paused' && event.key === 'F5' && plain && event.shiftKey) this.#resume('stop')
    else if (run && run.state === 'paused' && event.key === 'F5' && plain) this.#resume('continue')
    else if (!run && this.#ask && event.key === 'F10' && plain) this.#answer('run', true)
    else if (!run && this.#ask && event.key === 'F5' && plain && !event.shiftKey) this.#answer('run')
    else if (inLine) took = false
    // THE LINE ANSWERS FOR ITSELF while it has the keyboard — as it always has.
    else if (!run && this.#ask && event.key === 'Enter' && plain && !event.shiftKey) this.#answer('run')
    else if (!run && this.#ask && event.key === 'Escape') this.#answer('decline')
    else if (run && run.state === 'paused' && event.key === 'Escape') this.#resume('stop')
    else if (event.key === 'Escape') { took = !!(run?.state === 'finished' || (!run && !this.#ask && this.#own)); this.#putAway() }
    else if (body && plain && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) body.scrollBy({ top: event.key === 'ArrowDown' ? 48 : -48 })
    else if (body && plain && (event.key === 'PageDown' || event.key === 'PageUp')) body.scrollBy({ top: (event.key === 'PageDown' ? 1 : -1) * body.clientHeight * 0.9 })
    else took = false
    if (!took) return
    event.preventDefault()
    event.stopPropagation()
  }

  // ── the drawing ─────────────────────────────────────────────────────────

  #render(): void {
    const sheet = this.#sheet
    if (!sheet) return
    sheet.classList.toggle('is-debugging', !!this.#debugged)
    const run = this.#debugged
    if (run) {
      sheet.replaceChildren(this.#head(run.ask.from, run.plans, run.ask.waiting, run), this.#body(run.plans, run), this.#foot(run))
      return
    }
    const ask = this.#ask
    if (ask) {
      const deps = this.deps()
      const plans = ask.lines.map(line => planLine(line, deps))
      sheet.replaceChildren(this.#head(ask.from, plans, ask.waiting, null), this.#body(plans, null), this.#foot(null))
      return
    }
    const own = this.#own
    if (own) sheet.replaceChildren(...this.#ownLine(own))
  }

  /** One line: who asks, how many lines, and only the facts that need eyes. */
  #head(from: string, plans: readonly LinePlan[], waiting: number, run: Debugged | null): HTMLElement {
    const head = el('header', 'hc-run-head')
    head.appendChild(el('span', 'hc-run-sigil', '$'))
    head.appendChild(el('span', 'hc-run-from', from))
    const facts: HTMLElement[] = []
    if (run) {
      const ran = [...run.results.values()].flat().filter(r => !r.extra)
      const refused = ran.filter(r => verdictKind(r.verdict) === 'alert').length
      facts.push(el('span', `is-state is-${run.state}`, run.state === 'paused'
        ? t('run-preview.debug.paused', 'paused before line {at} of {total}', { at: (run.at ?? 0) + 1, total: plans.length })
        : run.state === 'running'
          ? t('run-preview.debug.running', 'running…')
          : run.stoppedAt !== undefined
            ? t('run-preview.debug.stopped', 'stopped before line {at}', { at: run.stoppedAt + 1 })
            : t('run-preview.debug.finished', 'finished')))
      facts.push(el('span', '', t('run-preview.debug.done', '{done} of {total} said', { done: ran.length, total: plans.length })))
      if (refused) facts.push(el('span', 'is-alert', t('run-preview.refused-count', '{count} refused', { count: refused })))
    } else {
      facts.push(el('span', '', t('run-preview.lines', '{count} lines', { count: plans.length })))
      const refused = plans.filter(p => p.refused).length
      const ambiguous = plans.filter(p => p.ambiguous && !p.refused).length
      if (refused) facts.push(el('span', 'is-alert', t('run-preview.refused-count', '{count} refused', { count: refused })))
      if (ambiguous) facts.push(el('span', 'is-warn', t('run-preview.ambiguous-count', '{count} need a choice', { count: ambiguous })))
      if (waiting > 0) facts.push(el('span', '', t('run-preview.waiting', '+{count} waiting', { count: waiting })))
    }
    for (const fact of facts) {
      head.appendChild(el('span', 'hc-run-dot', '·'))
      fact.classList.add('hc-run-fact')
      head.appendChild(fact)
    }
    return head
  }

  #body(plans: readonly LinePlan[], run: Debugged | null): HTMLElement {
    const body = el('div', 'hc-run-body')
    const code = el('ol', 'hc-run-code')
    const width = String(plans.length).length
    plans.forEach((plan, i) => {
      const row = lineRow(plan, String(i + 1).padStart(width, ' '), {
        open: this.#termsOpen(i), toggle: term => this.#toggleTerm(i, term),
        breakpoint: this.#breakpoints.has(i),
        here: run?.state === 'paused' && run.at === i,
        results: run?.results.get(i),
        unsaid: run?.stoppedAt !== undefined && i >= run.stoppedAt,
      })
      if (!run || run.state !== 'finished') {
        const gutter = row.querySelector<HTMLElement>('.hc-run-gutter')
        gutter?.classList.add('is-clickable')
        gutter?.setAttribute('title', t('run-preview.breakpoint-toggle', 'set or clear a breakpoint on this line'))
        gutter?.addEventListener('click', () => this.#toggleBreakpoint(i))
      }
      code.appendChild(row)
    })
    body.appendChild(code)
    return body
  }

  /** The acts, as words with their keys: nothing else in the footer. */
  #foot(run: Debugged | null): HTMLElement {
    const foot = el('footer', 'hc-run-foot')
    const say = (key: string, label: string, act: () => void): void => { foot.appendChild(word(key, label, act)) }
    if (run?.state === 'paused') {
      say('F10', t('run-preview.debug.step', 'step'), () => this.#resume('step'))
      say('F5', t('run-preview.debug.continue', 'continue'), () => this.#resume('continue'))
      say('⇧F5', t('run-preview.debug.stop', 'stop'), () => this.#resume('stop'))
    } else if (run?.state === 'finished') {
      say('Esc', t('run-preview.close', 'close'), () => this.#putAway())
    } else if (!run) {
      say('Enter', t('run-preview.run-word', 'run'), () => this.#answer('run'))
      say('F10', t('run-preview.debug.step', 'step'), () => this.#answer('run', true))
      say('Esc', t('run-preview.decline-word', 'decline'), () => this.#answer('decline'))
    }
    return foot
  }

  /** The participant's own line, read the way their Enter will read it. */
  #ownLine(own: OwnLine): HTMLElement[] {
    const head = el('header', 'hc-run-head')
    head.appendChild(el('span', 'hc-run-sigil is-own', own.stance === 'find' ? '?' : own.stance === 'tiles' ? '>' : '/'))
    head.appendChild(el('span', 'hc-run-from', t('run-preview.own.title', 'Your line')))
    const body = el('div', 'hc-run-body')
    if (own.text.trim()) {
      const code = el('ol', 'hc-run-code')
      code.appendChild(lineRow(planOwnLine(own.text, own.line, own.stance, this.deps()), '1', {
        open: this.#termsOpen(0), toggle: term => this.#toggleTerm(0, term),
      }))
      body.appendChild(code)
    } else {
      body.appendChild(el('p', 'hc-run-quiet', t('run-preview.own.empty', 'Type a line: this shows what it will run, as you type.')))
    }
    const foot = el('footer', 'hc-run-foot')
    foot.appendChild(word('Esc', t('run-preview.close', 'close'), () => this.#putAway()))
    return [head, body, foot]
  }
}

// ── one line ───────────────────────────────────────────────────────────────

type RowState = {
  /** The terms broken out on this line (a behaviour word, or `why`). */
  readonly open: ReadonlySet<string>
  readonly toggle: (term: string) => void
  readonly breakpoint?: boolean
  readonly here?: boolean
  readonly results?: readonly LineResult[]
  readonly unsaid?: boolean
}

/** ONE LIST: each item is its line of code, nothing more, and a short tag
 *  when the line will not simply run. Click a behaviour word, or the tag, and
 *  its meaning breaks out in a row under the line; click again to fold it.
 *  Once a line has run, its results are listed under it. */
const lineRow = (plan: LinePlan, number: string, state: RowState): HTMLElement => {
  const classes = ['hc-run-line']
  if (plan.refused || plan.kind === 'inert') classes.push('is-refused')
  else if (plan.ambiguous) classes.push('is-ambiguous')
  if (state.here) classes.push('is-here')
  if (state.results?.length) classes.push('is-done')
  if (state.unsaid) classes.push('is-unsaid')
  const row = el('li', classes.join(' '))
  const gutter = el('span', state.breakpoint ? 'hc-run-gutter has-break' : 'hc-run-gutter', number)
  if (state.here) gutter.dataset['here'] = ''
  row.appendChild(gutter)
  const flow = el('div', 'hc-run-flow')
  const head = el('div', 'hc-run-head-line')
  const code = codeOf(plan)
  for (const term of code.querySelectorAll<HTMLElement>('[data-term]')) {
    const name = term.dataset['term']!
    term.classList.add('is-term')
    if (state.open.has(name)) term.classList.add('is-open')
    term.addEventListener('click', event => { event.stopPropagation(); state.toggle(name) })
  }
  head.appendChild(code)
  const tag = tagOf(plan)
  if (tag) {
    if (state.open.has('why')) tag.classList.add('is-open')
    tag.addEventListener('click', event => { event.stopPropagation(); state.toggle('why') })
    head.appendChild(tag)
  }
  flow.appendChild(head)
  for (const term of state.open) {
    const breakout = breakoutOf(plan, term)
    if (breakout) flow.appendChild(breakout)
  }
  // WHAT IT CAME TO: once a line has run, its verdict and what the hive said
  // while it ran, in a list under it.
  if (state.results?.length) {
    const list = el('ul', 'hc-run-results')
    for (const result of state.results) {
      const item = el('li', `hc-run-result is-${verdictKind(result.verdict)}${result.extra ? ' is-extra' : ''}`)
      if (result.extra) item.appendChild(el('code', 'hc-run-result-line', result.text + '  '))
      item.appendChild(el('span', 'hc-run-verdict', result.verdict))
      list.appendChild(item)
      for (const heard of result.heard ?? []) list.appendChild(el('li', 'hc-run-result is-heard', heard))
    }
    flow.appendChild(list)
  }
  row.appendChild(flow)
  return row
}

/** The line as code: every glyph as said, each kind of word in its own ink. */
const codeOf = (plan: LinePlan): HTMLElement => {
  const code = el('code', 'hc-run-text')
  const text = plan.text
  if (plan.kind === 'sentence' && plan.spans) {
    let at = 0
    for (const span of plan.spans) {
      if (span.start > at) code.appendChild(el('span', 'hc-tok-gap', text.slice(at, span.start)))
      const piece = text.slice(span.start, span.end)
      if (span.role === 'action') {
        const verb = el('span', 'hc-tok-verb', piece)
        if (span.color) verb.style.color = span.color
        verb.dataset['term'] = span.command ?? piece.toLowerCase()
        code.appendChild(verb)
      } else if (span.role === 'ambiguity') {
        code.appendChild(el('span', 'hc-tok-ambiguous', piece))
      } else if (span.role === 'residue') {
        code.appendChild(el('span', 'hc-tok-residue', piece))
      } else {
        for (const node of argTokens(piece)) code.appendChild(node)
      }
      at = span.end
    }
    if (at < text.length) code.appendChild(el('span', 'hc-tok-gap', text.slice(at)))
    return code
  }
  if (plan.kind === 'word' && plan.steps.length) {
    const slash = text.startsWith('/')
    const rest = slash ? text.slice(1) : text
    const lead = rest.match(/^\s*/)?.[0] ?? ''
    const word = rest.slice(lead.length).split(/[\s(]/, 1)[0] ?? ''
    if (slash) code.appendChild(el('span', 'hc-tok-slash', '/'))
    if (lead) code.appendChild(el('span', 'hc-tok-gap', lead))
    const verb = el('span', plan.steps[0]!.unknown ? 'hc-tok-unknown' : 'hc-tok-verb', word)
    verb.dataset['term'] = plan.steps[0]!.command
    code.appendChild(verb)
    for (const node of argTokens(rest.slice(lead.length + word.length))) code.appendChild(node)
    return code
  }
  if (plan.kind === 'inert') {
    code.appendChild(el('span', 'hc-tok-residue', text))
    return code
  }
  for (const node of argTokens(text)) code.appendChild(node)
  return code
}

const SIG = /^[0-9a-f]{64}$/i
const ARG_TOKEN = /([0-9a-f]{64})|("[^"]*"|“[^”]*”|'[^']*')|((?:^|(?<=\s))[~#?>.]?\/?[\w.-]*\/[^\s,;]*)|(\[[^\]]*\])|(\b\d+(?:\.\d+)?\b)/gi

/** Arguments, inked by kind: signature, string, path, selection, number. A
 *  signature is drawn short, as a coder reads one, and kept whole in its title. */
const argTokens = (text: string): Node[] => {
  const nodes: Node[] = []
  let at = 0
  for (const match of text.matchAll(ARG_TOKEN)) {
    const start = match.index ?? 0
    const piece = match[0]
    if (!piece) continue
    if (start > at) nodes.push(el('span', 'hc-tok-arg', text.slice(at, start)))
    if (SIG.test(piece)) {
      const sig = el('span', 'hc-tok-sig', `${piece.slice(0, 10)}…${piece.slice(-6)}`)
      sig.title = piece
      nodes.push(sig)
    } else {
      const kind = match[2] ? 'hc-tok-string' : match[3] ? 'hc-tok-path' : match[4] ? 'hc-tok-select' : 'hc-tok-number'
      nodes.push(el('span', kind, piece))
    }
    at = start + piece.length
  }
  if (at < text.length) nodes.push(el('span', 'hc-tok-arg', text.slice(at)))
  return nodes
}

/** The short tag a line wears when it will not simply run, or null. Click
 *  it and the reason breaks out under the line (`why`). */
const tagOf = (plan: LinePlan): HTMLElement | null => {
  const tag = (label: string, kind: string): HTMLElement => {
    const node = el('span', `hc-run-tag is-${kind}`, label)
    node.setAttribute('role', 'button')
    return node
  }
  if (plan.refused) return tag(t('run-preview.refused', 'refused'), 'alert')
  if (plan.ambiguous) return tag(t('run-preview.ambiguous', 'choose'), 'warn')
  if (plan.steps.some(s => s.unknown)) return tag(t('run-preview.unknown-tag', 'not a behaviour'), 'warn')
  if (plan.steps.some(s => s.confirms)) return tag(t('run-preview.confirms', 'asks first'), 'warn')
  if (plan.kind === 'structure' || plan.kind === 'tiles' || plan.kind === 'find') return tag(t(`run-preview.kind.${plan.kind}`, plan.kind), 'quiet')
  return null
}

/** The row that breaks out under a line: a behaviour's meaning and exactly
 *  what it is handed, or the reason behind the line's tag. */
const breakoutOf = (plan: LinePlan, term: string): HTMLElement | null => {
  const row = el('div', 'hc-run-breakout')
  if (term === 'why') {
    const why = plan.refused
      ?? (plan.ambiguous ? t('run-preview.ambiguous-why', '"{word}" is claimed by {candidates}: nothing on this line runs until it says which', {
        word: plan.ambiguous.word, candidates: plan.ambiguous.candidates.join(', '),
      }) : undefined)
      ?? (plan.steps.some(s => s.unknown) ? t('run-preview.unknown', 'not a behaviour in this hive: the command line makes a tile of that name and goes into it') : undefined)
      ?? (plan.steps.some(s => s.confirms) ? t('run-preview.confirms-why', 'a destructive word: Enter asks you to confirm before it runs') : undefined)
      ?? (plan.kind === 'structure' ? t('run-preview.structure', 'the line\'s own grammar: a path, selection, tag or view, carried out by the command line itself')
        : plan.kind === 'tiles' ? t('run-preview.tiles', 'tiles stance: makes a tile with this name here')
        : plan.kind === 'find' ? t('run-preview.find', 'find stance: lists the tiles whose names hold these words; Enter walks to the one chosen')
        : undefined)
    if (!why) return null
    row.classList.add(plan.refused ? 'is-alert' : 'is-warn')
    row.textContent = why
    return row
  }
  const steps = plan.steps.filter(s => s.command === term)
  if (!steps.length) return null
  row.appendChild(el('span', 'hc-tok-verb', term))
  if (steps[0]!.said) row.appendChild(el('span', 'hc-run-alias', ` (${steps[0]!.said})`))
  const description = steps[0]!.unknown
    ? t('run-preview.unknown', 'not a behaviour in this hive: the command line makes a tile of that name and goes into it')
    : steps[0]!.description || t('run-preview.no-description', 'this behaviour says nothing about what it does')
  row.appendChild(el('span', steps[0]!.description && !steps[0]!.unknown ? 'hc-run-meaning' : 'hc-run-meaning is-missing', '  ' + description))
  for (const step of steps) {
    const handed = el('div', 'hc-run-handed')
    handed.appendChild(el('span', 'hc-run-handed-label', t('run-preview.handed', 'is handed') + ' '))
    handed.appendChild(el('code', 'hc-run-handed-args', step.args ? step.args : t('run-preview.handed-nothing', '(nothing)')))
    row.appendChild(handed)
  }
  return row
}

const el = (tag: string, className: string, text?: string): HTMLElement => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** An act is a word with its key, not a bordered button. */
const word = (key: string, label: string, run: () => void): HTMLButtonElement => {
  const node = document.createElement('button')
  node.type = 'button'
  node.className = 'hc-run-word'
  node.appendChild(el('span', 'hc-run-key', key))
  node.appendChild(document.createTextNode(' ' + label))
  node.addEventListener('click', run)
  return node
}

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  // The tool-window ink roles (tool-window-colour-roles.md). Nearly opaque
  // (jwize: "much less transparency"): the hive only shows faintly behind.
  style.textContent = `
    ${RUN_PREVIEW_SURFACE} { display: contents; }
    .hc-run {
      position: fixed; left: 0; right: 0; bottom: 0;
      top: max(calc(2.3rem * var(--hc-header-zoom, 1.0)), var(--hc-header-anchor, 0px));
      z-index: 100001; box-sizing: border-box;
      display: flex; flex-direction: column; align-items: stretch;
      padding: 1rem max(1.25rem, calc((100vw - 72rem) / 2)) 0;
      background: rgba(var(--hc-panel-pane, 9, 14, 20), 0.94);
      color: var(--hc-window-ink-plain, rgba(227, 237, 245, 0.86));
      font-family: var(--hc-mono, ui-monospace, monospace);
      font-size: calc(0.8125rem * var(--hc-panel-scale, 1));
      line-height: 1.6;
      /* Mid-tone inks: legible on a light theme's pane and a dark one's. */
      --hc-ink-verb: var(--hc-status-ok, #2fa37a);
      --hc-ink-path: #3f8be0;
      --hc-ink-sig: #9a68d8;
      --hc-ink-string: #c08a1e;
      --hc-ink-number: #d4692a;
      --hc-ink-select: #1f9fab;
    }
    .hc-run-head { flex: 0 0 auto; display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; padding: 0 0 0.6rem 0.25rem; }
    .hc-run-sigil { font-weight: 700; color: var(--hc-status-warn, #d9a441); }
    .hc-run-sigil.is-own { color: var(--hc-ink-verb); }
    .hc-run-from { font-weight: 600; color: var(--hc-window-ink-loud, #eef2f5); }
    .hc-run-dot, .hc-run-fact { color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); }
    .hc-run-fact.is-alert { color: var(--hc-status-alert, #e07a72); }
    .hc-run-fact.is-warn, .hc-run-fact.is-paused { color: var(--hc-status-warn, #d9a441); }
    .hc-run-fact.is-finished { color: var(--hc-status-ok, #2fa37a); }
    .hc-run-body { flex: 1 1 auto; min-height: 0; overflow: auto; }
    .hc-run-code { list-style: none; margin: 0; padding: 0; }
    .hc-run-line { display: flex; align-items: flex-start; padding: 0.05rem 0; border-left: 2px solid transparent; }
    .hc-run-line:hover { background: rgba(255, 255, 255, 0.035); }
    .hc-run-line.is-refused { border-left-color: var(--hc-status-alert, #e07a72); }
    .hc-run-line.is-ambiguous { border-left-color: var(--hc-status-warn, #d9a441); }
    .hc-run-line.is-here {
      background: color-mix(in srgb, var(--hc-status-warn, #d9a441) 14%, transparent);
      border-left-color: var(--hc-status-warn, #d9a441);
    }
    .hc-run-gutter {
      flex: 0 0 auto; position: relative; box-sizing: border-box; min-width: calc(3ch + 1.5rem);
      padding: 0 1rem 0 0.5rem; white-space: pre; text-align: right; user-select: none;
      color: var(--hc-window-ink-faint, rgba(227, 237, 245, 0.38));
    }
    .hc-run-gutter.is-clickable { cursor: pointer; }
    .hc-run-gutter.is-clickable:hover { color: var(--hc-window-ink-loud, #eef2f5); }
    .hc-run-gutter.has-break { color: var(--hc-status-alert, #e07a72); font-weight: 700; }
    .hc-run-gutter.has-break::before {
      content: ''; position: absolute; left: 0.15rem; top: 0.8em; width: 0.45rem; height: 0.45rem;
      margin-top: -0.225rem; border-radius: 50%; background: var(--hc-status-alert, #e07a72);
    }
    .hc-run-gutter[data-here]::after { content: '\\25B6'; position: absolute; right: 0.15rem; color: var(--hc-status-warn, #d9a441); }
    .hc-run-flow { flex: 1 1 auto; min-width: 0; }
    .hc-run-head-line { display: flex; align-items: baseline; gap: 0.75rem; }
    .hc-run-text { flex: 1 1 auto; min-width: 0; font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }
    .hc-run-line.is-unsaid .hc-run-text { opacity: 0.45; text-decoration: line-through; }
    .hc-tok-verb { color: var(--hc-ink-verb); font-weight: 600; }
    .hc-tok-unknown { color: var(--hc-status-warn, #d9a441); font-weight: 600; }
    .is-term { cursor: pointer; border-bottom: 1px dotted transparent; }
    .is-term:hover, .is-term.is-open { border-bottom-color: currentColor; }
    .hc-tok-slash, .hc-tok-residue { color: var(--hc-window-ink-faint, rgba(227, 237, 245, 0.38)); }
    .hc-tok-ambiguous { color: var(--hc-status-warn, #d9a441); text-decoration: underline wavy; text-underline-offset: 3px; }
    .hc-tok-path { color: var(--hc-ink-path); }
    .hc-tok-sig { color: var(--hc-ink-sig); cursor: help; }
    .hc-tok-string { color: var(--hc-ink-string); }
    .hc-tok-number { color: var(--hc-ink-number); }
    .hc-tok-select { color: var(--hc-ink-select); }
    .hc-run-tag {
      flex: 0 0 auto; cursor: pointer; font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase;
      font-family: system-ui, sans-serif; padding-right: 0.5rem;
    }
    .hc-run-tag.is-alert { color: var(--hc-status-alert, #e07a72); }
    .hc-run-tag.is-warn { color: var(--hc-status-warn, #d9a441); }
    .hc-run-tag.is-quiet { color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); }
    .hc-run-tag:hover, .hc-run-tag.is-open { text-decoration: underline; }
    .hc-run-breakout {
      margin: 0.1rem 0 0.3rem; padding: 0.25rem 0.6rem; border-left: 2px solid var(--hc-window-line-firm, rgba(227, 237, 245, 0.26));
      background: rgba(255, 255, 255, 0.04); font-family: system-ui, sans-serif;
      color: var(--hc-window-ink-plain, rgba(227, 237, 245, 0.86));
    }
    .hc-run-breakout .hc-tok-verb { font-family: var(--hc-mono, ui-monospace, monospace); }
    .hc-run-breakout.is-alert { border-left-color: var(--hc-status-alert, #e07a72); color: var(--hc-status-alert, #e07a72); }
    .hc-run-breakout.is-warn { border-left-color: var(--hc-status-warn, #d9a441); }
    .hc-run-alias, .hc-run-handed-label { color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); }
    .hc-run-meaning.is-missing { color: var(--hc-status-warn, #d9a441); font-style: italic; }
    .hc-run-handed-args { font-family: var(--hc-mono, ui-monospace, monospace); overflow-wrap: anywhere; }
    .hc-run-results {
      list-style: none; margin: 0.1rem 0 0.3rem; padding: 0 0 0 0.75rem;
      border-left: 1px solid var(--hc-window-line, rgba(227, 237, 245, 0.14));
      font-family: system-ui, sans-serif; font-size: 0.92em;
    }
    .hc-run-result { white-space: pre-wrap; overflow-wrap: anywhere; }
    .hc-run-result.is-ok .hc-run-verdict { color: var(--hc-status-ok, #2fa37a); }
    .hc-run-result.is-alert .hc-run-verdict { color: var(--hc-status-alert, #e07a72); }
    .hc-run-result.is-warn .hc-run-verdict { color: var(--hc-status-warn, #d9a441); }
    .hc-run-result.is-ok .hc-run-verdict::before { content: '\\2713  '; }
    .hc-run-result.is-alert .hc-run-verdict::before { content: '\\2717  '; }
    .hc-run-result.is-warn .hc-run-verdict::before { content: '?  '; }
    .hc-run-result.is-heard { color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); padding-left: 1.1rem; }
    .hc-run-result.is-extra { font-style: italic; }
    .hc-run-result-line { font-family: var(--hc-mono, ui-monospace, monospace); }
    .hc-run-foot { flex: 0 0 auto; display: flex; justify-content: flex-end; gap: 1.25rem; padding: 0.6rem 0.25rem 0.9rem; }
    .hc-run-word {
      font: inherit; padding: 0; border: 0; background: none; cursor: pointer;
      color: var(--hc-window-ink-plain, rgba(227, 237, 245, 0.86));
    }
    .hc-run-word:hover { color: var(--hc-window-ink-loud, #fff); text-decoration: underline; }
    .hc-run-key { color: var(--hc-window-ink-faint, rgba(227, 237, 245, 0.38)); }
    .hc-run-quiet { margin: 0.5rem 0.25rem; color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); font-family: system-ui, sans-serif; }
  `
  document.head.appendChild(style)
}
