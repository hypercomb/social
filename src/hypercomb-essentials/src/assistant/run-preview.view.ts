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
// A dependency: it exports the element; the external-call bee defines it on
// the first call and adds its tag to the ShellSurfaceRegistry.

import {
  EffectBus, EXTERNAL_ANSWER, EXTERNAL_ASK, I18N_IOC_KEY, currentMachineGrant,
  type ExternalAnswer, type ExternalAsk, type I18nProvider,
} from '@hypercomb/core'
import { planLine, type LinePlan, type PlanDeps, type PlanEntry } from '../commands/utterance/line-plan.js'
import type { UtteranceReading } from '../commands/utterance/utterance-reading.js'

export const RUN_PREVIEW_SURFACE = 'hc-run-preview'
export const RUN_PREVIEW_OWNER = '@diamondcoreprocessor.com/RunPreviewView'
/** `{ open: boolean }`, replayed: while the preview shows a call, the command
 *  line does not list the same lines under itself (shared
 *  command-line.component.ts reads it by this name). */
export const RUN_PREVIEW_OPEN = 'run-preview:open'

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

export class RunPreviewElement extends HTMLElement {
  #sheet: HTMLElement | null = null
  #ask: ExternalAsk | null = null
  #shownAt = 0
  #off: (() => void) | null = null

  /** SEAM: a spec hands in a fixed census. */
  deps: () => PlanDeps = liveDeps

  connectedCallback(): void {
    ensureStyles()
    // Replayed: a call that was waiting before this element was defined shows.
    this.#off = EffectBus.on<ExternalAsk | null>(EXTERNAL_ASK, ask => {
      if (ask && typeof ask.id === 'string' && Array.isArray(ask.lines)) this.show(ask)
      else this.close()
    })
  }

  disconnectedCallback(): void {
    this.#off?.()
    this.#off = null
    this.close()
  }

  get isOpen(): boolean { return !!this.#sheet }

  show(ask: ExternalAsk): void {
    if (ask.id !== this.#ask?.id) this.#shownAt = Date.now()
    this.#ask = ask
    if (!this.#sheet) {
      const sheet = document.createElement('section')
      sheet.className = 'hc-run'
      sheet.setAttribute('role', 'dialog')
      sheet.setAttribute('aria-modal', 'false')
      sheet.setAttribute('data-consumes-wheel', '')
      this.appendChild(sheet)
      this.#sheet = sheet
      window.addEventListener('keydown', this.#onKey, true)
      EffectBus.emit(RUN_PREVIEW_OPEN, { open: true })
    }
    this.#render()
  }

  close(): void {
    this.#ask = null
    if (!this.#sheet) return
    window.removeEventListener('keydown', this.#onKey, true)
    this.#sheet.remove()
    this.#sheet = null
    EffectBus.emit(RUN_PREVIEW_OPEN, { open: false })
  }

  #answer(decision: ExternalAnswer['decision']): void {
    const ask = this.#ask
    if (!ask) return
    if (decision === 'run' && Date.now() - this.#shownAt < ARM_MS) return
    EffectBus.emitTransient<ExternalAnswer>(EXTERNAL_ANSWER, { id: ask.id, decision })
  }

  readonly #onKey = (event: KeyboardEvent): void => {
    if (!this.#ask || event.isComposing) return
    // THE LINE ANSWERS FOR ITSELF while it has the keyboard — as it always has.
    const target = event.target as Element | null
    if (target?.closest?.('hc-command-line')) return
    const body = this.#sheet?.querySelector<HTMLElement>('.hc-run-body')
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey
    if (event.key === 'Enter' && plain && !event.shiftKey) this.#answer('run')
    else if (event.key === 'Escape') this.#answer('decline')
    else if (body && plain && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) body.scrollBy({ top: event.key === 'ArrowDown' ? 48 : -48 })
    else if (body && plain && (event.key === 'PageDown' || event.key === 'PageUp')) body.scrollBy({ top: (event.key === 'PageDown' ? 1 : -1) * body.clientHeight * 0.9 })
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  // ── the drawing ─────────────────────────────────────────────────────────

  #render(): void {
    const sheet = this.#sheet
    const ask = this.#ask
    if (!sheet || !ask) return
    const deps = this.deps()
    const plans = ask.lines.map(line => planLine(line, deps))
    sheet.replaceChildren(this.#head(ask, plans), this.#legend(plans), this.#body(plans), this.#foot())
  }

  #head(ask: ExternalAsk, plans: readonly LinePlan[]): HTMLElement {
    const head = el('header', 'hc-run-head')
    head.appendChild(el('span', 'hc-run-sigil', '$'))
    const title = el('div', 'hc-run-title')
    title.appendChild(el('span', 'hc-run-from', ask.from))
    title.appendChild(el('span', 'hc-run-asks', ' ' + t('run-preview.asks', 'asks to run {count} lines', { count: plans.length })))
    head.appendChild(title)
    const refused = plans.filter(p => p.refused).length
    const ambiguous = plans.filter(p => p.ambiguous && !p.refused).length
    const facts = el('div', 'hc-run-facts')
    const steps = plans.reduce((n, p) => n + (p.refused || p.ambiguous ? 0 : p.steps.length || (p.kind === 'structure' ? 1 : 0)), 0)
    facts.appendChild(el('span', 'hc-run-fact', t('run-preview.steps', '{count} steps will run', { count: steps })))
    if (refused) facts.appendChild(el('span', 'hc-run-fact is-alert', t('run-preview.refused-count', '{count} refused', { count: refused })))
    if (ambiguous) facts.appendChild(el('span', 'hc-run-fact is-warn', t('run-preview.ambiguous-count', '{count} need a choice', { count: ambiguous })))
    if (ask.waiting > 0) facts.appendChild(el('span', 'hc-run-fact', t('run-preview.waiting', '+{count} waiting', { count: ask.waiting })))
    head.appendChild(facts)
    return head
  }

  /** Each behaviour the run uses, once, with what it does and how often. */
  #legend(plans: readonly LinePlan[]): HTMLElement {
    const used = new Map<string, { description: string; count: number }>()
    for (const plan of plans) {
      if (plan.refused) continue
      for (const step of plan.steps) {
        if (step.unknown) continue
        const seen = used.get(step.command)
        if (seen) seen.count++
        else used.set(step.command, { description: step.description, count: 1 })
      }
    }
    const legend = el('div', 'hc-run-legend')
    if (!used.size) return legend
    legend.appendChild(el('div', 'hc-run-section', t('run-preview.behaviours', 'Behaviours in this run')))
    const list = el('dl', 'hc-run-uses')
    for (const [command, use] of used) {
      const row = el('div', 'hc-run-use')
      const name = el('dt', 'hc-run-use-name')
      name.appendChild(el('span', 'hc-tok-verb', command))
      if (use.count > 1) name.appendChild(el('span', 'hc-run-use-count', `×${use.count}`))
      row.appendChild(name)
      row.appendChild(el('dd', use.description ? 'hc-run-use-what' : 'hc-run-use-what is-missing',
        use.description || t('run-preview.no-description', 'this behaviour says nothing about what it does')))
      list.appendChild(row)
    }
    legend.appendChild(list)
    return legend
  }

  #body(plans: readonly LinePlan[]): HTMLElement {
    const body = el('div', 'hc-run-body')
    const code = el('ol', 'hc-run-code')
    const width = String(plans.length).length
    // A behaviour's description reads in full where it first appears; on its
    // later lines it steps back, so the eye goes to what differs.
    const told = new Set<string>()
    plans.forEach((plan, i) => code.appendChild(lineRow(plan, String(i + 1).padStart(width, ' '), told)))
    body.appendChild(code)
    return body
  }

  #foot(): HTMLElement {
    const foot = el('footer', 'hc-run-foot')
    const keys = el('div', 'hc-run-keys')
    keys.appendChild(el('kbd', 'hc-run-kbd', 'Enter'))
    keys.appendChild(el('span', '', ' ' + t('run-preview.enter', 'runs every line, in order') + '   '))
    keys.appendChild(el('kbd', 'hc-run-kbd', 'Esc'))
    keys.appendChild(el('span', '', ' ' + t('run-preview.esc', 'declines: nothing runs')))
    foot.appendChild(keys)
    foot.appendChild(button(t('run-preview.decline', 'Decline'), 'hc-run-act', () => this.#answer('decline')))
    foot.appendChild(button(t('run-preview.run', 'Run'), 'hc-run-act is-go', () => this.#answer('run')))
    return foot
  }
}

// ── one line ───────────────────────────────────────────────────────────────

const lineRow = (plan: LinePlan, number: string, told: Set<string>): HTMLElement => {
  const state = plan.refused ? 'is-refused' : plan.ambiguous ? 'is-ambiguous' : plan.kind === 'inert' ? 'is-refused' : ''
  const row = el('li', `hc-run-line ${state}`.trim())
  row.appendChild(el('span', 'hc-run-gutter', number))
  row.appendChild(codeOf(plan))
  row.appendChild(whatOf(plan, told))
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
    code.appendChild(el('span', plan.steps[0]!.unknown ? 'hc-tok-unknown' : 'hc-tok-verb', word))
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

/** What the line will do, said from the behaviours it names. */
const whatOf = (plan: LinePlan, told: Set<string>): HTMLElement => {
  const what = el('div', 'hc-run-what')
  if (plan.refused) {
    what.appendChild(el('span', 'hc-run-flag is-alert', t('run-preview.refused', 'refused')))
    what.appendChild(el('span', 'hc-run-reason', plan.refused))
    return what
  }
  if (plan.ambiguous) {
    what.appendChild(el('span', 'hc-run-flag is-warn', t('run-preview.ambiguous', 'choose')))
    what.appendChild(el('span', 'hc-run-reason', t('run-preview.ambiguous-why',
      '"{word}" is claimed by {candidates}: nothing on this line runs until it says which', {
        word: plan.ambiguous.word, candidates: plan.ambiguous.candidates.join(', '),
      })))
    return what
  }
  if (plan.kind === 'structure') {
    what.appendChild(el('span', 'hc-run-reason', t('run-preview.structure',
      'the line\'s own grammar: a path, selection, tag or view, carried out by the command line itself')))
    return what
  }
  for (const step of plan.steps) {
    const one = el('div', told.has(step.command) ? 'hc-run-step is-told' : 'hc-run-step')
    told.add(step.command)
    const name = el('span', step.unknown ? 'hc-tok-unknown' : 'hc-tok-verb', step.command)
    one.appendChild(name)
    if (step.said) one.appendChild(el('span', 'hc-run-alias', ` (${step.said})`))
    one.appendChild(el('span', 'hc-run-sep', '  '))
    const description = step.unknown
      ? t('run-preview.unknown', 'not a behaviour in this hive: the command line makes a tile of that name and goes into it')
      : step.description || t('run-preview.no-description', 'this behaviour says nothing about what it does')
    const said = el('span', step.unknown || !step.description ? 'hc-run-reason is-missing' : 'hc-run-reason', description)
    said.title = description
    one.appendChild(said)
    what.appendChild(one)
  }
  return what
}

const el = (tag: string, className: string, text?: string): HTMLElement => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const button = (label: string, className: string, run: () => void): HTMLButtonElement => {
  const node = document.createElement('button')
  node.type = 'button'
  node.className = className
  node.textContent = label
  node.addEventListener('click', run)
  return node
}

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  // The tool-window ink roles (tool-window-colour-roles.md); the code inks are
  // the status colours every theme sets, so a theme recolours them all. The
  // backdrop is see-through on purpose: the hive the lines will change stays
  // in view behind them.
  style.textContent = `
    ${RUN_PREVIEW_SURFACE} { display: contents; }
    .hc-run {
      position: fixed; left: 0; right: 0; bottom: 0;
      top: max(calc(2.3rem * var(--hc-header-zoom, 1.0)), var(--hc-header-anchor, 0px));
      z-index: 100001; box-sizing: border-box;
      display: flex; flex-direction: column; align-items: stretch;
      padding: 1.25rem max(1.25rem, calc((100vw - 84rem) / 2)) 0;
      background: rgba(var(--hc-panel-pane, 9, 14, 20), 0.74);
      backdrop-filter: blur(1.5px);
      -webkit-backdrop-filter: blur(1.5px);
      color: var(--hc-window-ink-plain, rgba(227, 237, 245, 0.86));
      font-family: var(--hc-mono, ui-monospace, monospace);
      font-size: calc(0.8125rem * var(--hc-panel-scale, 1));
      line-height: 1.55;
      /* Mid-tone inks: legible on a light theme's pane and a dark one's. */
      --hc-ink-verb: var(--hc-status-ok, #2fa37a);
      --hc-ink-path: #3f8be0;
      --hc-ink-sig: #9a68d8;
      --hc-ink-string: #c08a1e;
      --hc-ink-number: #d4692a;
      --hc-ink-select: #1f9fab;
    }
    .hc-run-head { flex: 0 0 auto; display: flex; align-items: baseline; gap: 0.75rem; flex-wrap: wrap; padding-bottom: 0.75rem; }
    .hc-run-sigil { font-weight: 700; font-size: 1.25rem; color: var(--hc-status-warn, #d9a441); }
    .hc-run-title { font-size: 1.05rem; color: var(--hc-window-ink-loud, #eef2f5); }
    .hc-run-from { font-weight: 700; }
    .hc-run-asks { color: var(--hc-window-ink-plain, rgba(227, 237, 245, 0.86)); }
    .hc-run-facts { margin-left: auto; display: flex; gap: 0.9rem; color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); }
    .hc-run-fact.is-alert { color: var(--hc-status-alert, #e07a72); }
    .hc-run-fact.is-warn { color: var(--hc-status-warn, #d9a441); }
    .hc-run-legend { flex: 0 0 auto; max-height: 30vh; overflow: auto; }
    .hc-run-section {
      margin: 0 0 0.35rem; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62));
    }
    .hc-run-uses { margin: 0 0 0.9rem; display: grid; grid-template-columns: max-content 1fr; gap: 0.15rem 1.25rem; }
    .hc-run-use { display: contents; }
    .hc-run-use-name { margin: 0; white-space: nowrap; }
    .hc-run-use-count { margin-left: 0.4rem; color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); }
    .hc-run-use-what { margin: 0; font-family: system-ui, sans-serif; }
    .hc-run-body {
      flex: 1 1 auto; min-height: 0; overflow: auto;
      border-top: 1px solid var(--hc-window-line, rgba(227, 237, 245, 0.14));
      border-bottom: 1px solid var(--hc-window-line, rgba(227, 237, 245, 0.14));
    }
    .hc-run-code { list-style: none; margin: 0; padding: 0.4rem 0; }
    .hc-run-line {
      display: grid; grid-template-columns: max-content minmax(0, 1.15fr) minmax(0, 1fr);
      gap: 0 1.25rem; padding: 0.12rem 0.5rem 0.12rem 0; border-left: 2px solid transparent;
    }
    .hc-run-line:hover { background: rgba(255, 255, 255, 0.04); }
    .hc-run-line.is-refused { border-left-color: var(--hc-status-alert, #e07a72); }
    .hc-run-line.is-ambiguous { border-left-color: var(--hc-status-warn, #d9a441); }
    .hc-run-gutter { padding: 0 0.25rem 0 0.75rem; white-space: pre; text-align: right; color: var(--hc-window-ink-faint, rgba(227, 237, 245, 0.38)); user-select: none; }
    .hc-run-text { font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--hc-window-ink-plain, rgba(227, 237, 245, 0.86)); }
    .hc-run-what { min-width: 0; font-family: system-ui, sans-serif; color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); }
    .hc-run-step { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .hc-run-step.is-told .hc-run-reason { opacity: 0.55; }
    .hc-run-step .hc-tok-verb, .hc-run-step .hc-tok-unknown { font-family: var(--hc-mono, ui-monospace, monospace); }
    .hc-run-alias { color: var(--hc-window-ink-faint, rgba(227, 237, 245, 0.38)); }
    .hc-run-reason.is-missing, .hc-run-use-what.is-missing { color: var(--hc-status-warn, #d9a441); font-style: italic; }
    .hc-run-flag { margin-right: 0.5rem; font-weight: 700; text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.06em; }
    .hc-run-flag.is-alert { color: var(--hc-status-alert, #e07a72); }
    .hc-run-flag.is-warn { color: var(--hc-status-warn, #d9a441); }
    .hc-run-line.is-refused .hc-run-reason { color: var(--hc-status-alert, #e07a72); }
    .hc-tok-verb { color: var(--hc-ink-verb); font-weight: 600; }
    .hc-tok-slash { color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); }
    .hc-tok-unknown { color: var(--hc-status-warn, #d9a441); font-weight: 600; }
    .hc-tok-ambiguous { color: var(--hc-status-warn, #d9a441); text-decoration: underline wavy; text-underline-offset: 3px; }
    .hc-tok-residue { color: var(--hc-window-ink-faint, rgba(227, 237, 245, 0.38)); }
    .hc-tok-path { color: var(--hc-ink-path); }
    .hc-tok-sig { color: var(--hc-ink-sig); cursor: help; }
    .hc-tok-string { color: var(--hc-ink-string); }
    .hc-tok-number { color: var(--hc-ink-number); }
    .hc-tok-select { color: var(--hc-ink-select); }
    .hc-run-foot { flex: 0 0 auto; display: flex; align-items: center; justify-content: flex-end; gap: 0.75rem; padding: 0.75rem 0 1rem; }
    .hc-run-keys { margin-right: 0.75rem; color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); font-family: system-ui, sans-serif; white-space: pre; }
    .hc-run-kbd {
      display: inline-block; padding: 0 0.4rem; border-radius: 3px; font-family: var(--hc-mono, ui-monospace, monospace);
      border: 1px solid var(--hc-window-line-firm, rgba(227, 237, 245, 0.26)); color: var(--hc-window-ink-loud, #eef2f5);
    }
    .hc-run-act {
      font: inherit; padding: 0.3rem 1rem; border-radius: var(--hc-radius-control, 2px); cursor: pointer;
      background: none; color: var(--hc-window-ink-plain, rgba(227, 237, 245, 0.86));
      border: 1px solid var(--hc-window-line-firm, rgba(227, 237, 245, 0.26));
    }
    .hc-run-act:hover { color: var(--hc-window-ink-loud, #fff); background: rgba(255, 255, 255, 0.075); }
    .hc-run-act.is-go { color: var(--hc-ink-verb); border-color: currentColor; }
    @media (max-width: 760px) {
      .hc-run { padding: 0.75rem 0.75rem 0; }
      .hc-run-line { grid-template-columns: max-content minmax(0, 1fr); }
      .hc-run-what { grid-column: 2; padding-bottom: 0.3rem; }
    }
  `
  document.head.appendChild(style)
}
