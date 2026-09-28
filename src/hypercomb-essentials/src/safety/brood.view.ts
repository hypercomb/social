// safety/brood.view.ts
//
// WHAT THIS HIVE IS HOLDING, AND WHAT YOU CAN DO ABOUT IT.
//
// One row per held automaton: what it calls itself, where it came from, what
// the last reader made of it, who is vouching for it. The acts are WORDS —
// Read · Accept · Refuse — not bordered buttons, because this is a console
// and a console stays quiet.
//
// THE SURFACE CANNOT ACCEPT EITHER. Pressing Accept runs the same two-warning
// gesture the word runs (brood-accept.ts) and nothing else; the ruling is
// written by core, which refuses without both warnings. So there is exactly
// one door in the codebase, and both handles turn it.
//
// A held row NEVER pretends to be safe, and a clean audit never dresses a row
// as approved: the strongest thing any reading can do here is change one line
// of text and a recommendation. The only state that reads as "this runs" is a
// ruling a person made.
//
// ── AN ELEMENT, NOT A COMPONENT ─────────────────────────────────────────
//
// Module chrome is a framework-free custom element added to the
// ShellSurfaceRegistry over IoC — never a tag in either app.html, never an
// Angular class in the shared barrel. The tool-window recipe is restated in
// plain CSS with the shared values.
//
// A DEPENDENCY: it exports the element and never registers it. The safety
// domain's bee (brood.drone.ts) defines it and adds the surface — a view that
// wired itself became a lazy atom nothing imported, and the brood stopped
// opening (atomic-modules-plan.md, rule 1).

import { broodRoster, broodRules, EffectBus, mountToolWindow, type BroodRecord, type BroodRules, type ToolWindow } from '@hypercomb/core'
import { acceptByHand, auditLine, broodLabel, refuseByHand } from './brood-accept.js'
import { riskLine, riskOf } from './brood-risk.js'

const SURFACE = 'hc-brood'
const STYLE_ID = 'hc-brood-styles'
const OWNER = '@diamondcoreprocessor.com/BroodView'
const OPEN = 'brood:open'
const OPEN_STAMP_MS = 4_000

const BROOD_WINDOW = 'brood'
const ACCENT_RGB = [201, 162, 39] as const

/** What a row is: held code and the one sentence that describes its standing. */
const standing = (record: BroodRecord, rules: BroodRules): string => {
  if (record.ruling?.verdict === 'accepted') return 'You accepted this — it runs.'
  if (record.ruling?.verdict === 'refused') return 'You refused this — it stays held.'
  const flag = record.flags?.[record.flags.length - 1]
  if (flag) return `Held: ${flag.reason}. It will not run until you accept it.`
  const accepted = record.vouches.filter(vouch => vouch.verdict === 'accepted').length
  const refused = record.vouches.filter(vouch => vouch.verdict === 'refused').length
  if (refused) return `A community you follow read this and refused it.`
  if (rules.vouchesNeeded > 0 && accepted) return `${accepted} of ${rules.vouchesNeeded} communities you follow stand behind it.`
  if (runsByRule(record, rules)) return 'Yours — it runs. A reading is advice, never permission.'
  return 'Held. It will not run.'
}

/** Your own code that nothing held: the rules run it, so there is nothing to
 *  accept (the draft audit records every draft here, held or not). */
const runsByRule = (record: BroodRecord, rules: BroodRules): boolean =>
  !record.ruling && !record.flags?.length && (record.source.kind ?? 'stranger') === 'own' && rules.own === 'run'

const whereFrom = (record: BroodRecord): string => {
  const zone = record.source.zone?.trim()
  const kind = record.source.kind ?? 'stranger'
  const who = kind === 'own' ? 'yours' : kind === 'followed' ? 'a community you follow' : 'a stranger'
  return zone ? `${zone} — ${who}` : who
}

class BroodElement extends HTMLElement {
  #window: ToolWindow | null = null
  #cleanup: Array<() => void> = []
  #roster: readonly BroodRecord[] = []
  #rules: BroodRules | null = null
  #busy = ''
  // Reviews opened on a row, by signature: the reader's full findings.
  readonly #reports = new Map<string, string>()

  connectedCallback(): void {
    ensureStyles()
    this.#cleanup.push(EffectBus.on<{ at?: number }>(OPEN, payload => {
      if (Math.abs(Date.now() - (payload?.at ?? 0)) > OPEN_STAMP_MS) return
      this.open()
    }))
  }

  disconnectedCallback(): void {
    for (const off of this.#cleanup) off()
    this.#cleanup = []
    this.close()
  }

  open(): void {
    // The base layer (core/panels/tool-window.ts) is the shell, the header,
    // the lane and the session; the brood adds only its roster.
    this.#window ??= mountToolWindow(this, {
      id: BROOD_WINDOW,
      title: 'The brood',
      accent: ACCENT_RGB,
      className: 'hc-brood',
      defaultWidth: 360,
      minWidth: 260,
      onClose: () => this.close(),
    })
    this.#render()
    void this.refresh()
  }

  close(): void {
    this.#window?.dispose()
    this.#window = null
  }

  get open$(): boolean { return !!this.#window }

  /** Read, then draw. Exposed so a spec can await the reading. */
  async refresh(): Promise<void> {
    this.#roster = await broodRoster().catch(() => [])
    this.#rules = await broodRules().catch(() => null)
    this.#render()
  }

  // ── the drawing ─────────────────────────────────────────────────────────

  #render(): void {
    this.#window?.body.replaceChildren(this.#body())
  }

  #body(): HTMLElement {
    const body = document.createElement('div')
    body.className = 'hc-brood-content'

    if (!this.#roster.length) {
      const quiet = document.createElement('p')
      quiet.className = 'hc-brood-quiet'
      quiet.textContent = 'Nothing is held. Every automaton here was cleared by your rules.'
      body.appendChild(quiet)
      body.appendChild(this.#rulesLine())
      return body
    }

    const lede = document.createElement('p')
    lede.className = 'hc-brood-lede'
    lede.textContent = this.#roster.length === 1
      ? 'One automaton is held here. It does not run.'
      : `${this.#roster.length} automatons are held here. They do not run.`
    body.appendChild(lede)

    for (const record of this.#roster) body.appendChild(this.#row(record))
    body.appendChild(this.#rulesLine())
    return body
  }

  #row(record: BroodRecord): HTMLElement {
    const row = document.createElement('article')
    const accepted = record.ruling?.verdict === 'accepted'
    row.className = `hc-brood-row${accepted ? ' is-accepted' : ''}`

    const name = document.createElement('div')
    name.className = 'hc-brood-name'
    name.textContent = broodLabel(record)
    row.appendChild(name)

    const from = document.createElement('div')
    from.className = 'hc-brood-from'
    from.textContent = whereFrom(record)
    row.appendChild(from)

    const risk = riskOf(record)
    const level = document.createElement('div')
    level.className = `hc-brood-risk is-${risk.level}`
    level.textContent = riskLine(risk)
    row.appendChild(level)

    const said = document.createElement('div')
    said.className = 'hc-brood-said'
    said.textContent = auditLine(record)
    row.appendChild(said)

    // THE CODE REVIEW: the last reader's full findings, kept as a resource.
    const report = this.#reports.get(record.sig)
    if (report !== undefined) {
      const text = document.createElement('pre')
      text.className = 'hc-brood-report'
      text.textContent = report
      row.appendChild(text)
    }

    const state = document.createElement('div')
    state.className = `hc-brood-state${accepted ? ' is-accepted' : ''}`
    state.textContent = standing(record, this.#rules ?? { own: 'run', followed: 'run', stranger: 'hold', vouchesNeeded: 0, vouchesAdmitStrangers: false })
    row.appendChild(state)

    const acts = document.createElement('div')
    acts.className = 'hc-brood-acts'
    acts.appendChild(this.#act('Read', record, async () => {
      const { auditHeldBee } = await import('./brood-audit.js')
      await auditHeldBee(record.sig)
    }))
    const reportSig = [...record.audits].reverse().find(audit => audit.reportSig)?.reportSig
    if (reportSig) {
      acts.appendChild(this.#act(report === undefined ? 'Review' : 'Hide review', record, async () => {
        if (this.#reports.has(record.sig)) { this.#reports.delete(record.sig); return }
        const store = (globalThis as { ioc?: { get?: <T>(key: string) => T | undefined } }).ioc
          ?.get?.<{ getResource?: (sig: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
        const blob = await store?.getResource?.(reportSig).catch(() => null)
        this.#reports.set(record.sig, blob ? await blob.text() : 'The review is not in this hive.')
      }))
    }
    if (!accepted && !runsByRule(record, this.#rules ?? { own: 'run', followed: 'run', stranger: 'hold', vouchesNeeded: 0, vouchesAdmitStrangers: false })) {
      acts.appendChild(this.#act('Accept', record, async () => { await acceptByHand(record) }, true))
    }
    if (record.ruling?.verdict !== 'refused') {
      acts.appendChild(this.#act('Refuse', record, async () => { await refuseByHand(record) }))
    }
    row.appendChild(acts)
    return row
  }

  /** An act is a WORD, not a bordered button. */
  #act(label: string, record: BroodRecord, run: () => Promise<void>, danger = false): HTMLElement {
    const word = document.createElement('button')
    word.type = 'button'
    word.className = `hc-brood-do${danger ? ' is-danger' : ''}`
    word.textContent = this.#busy === `${label}:${record.sig}` ? `${label}…` : label
    word.disabled = !!this.#busy
    word.addEventListener('click', () => {
      if (this.#busy) return
      this.#busy = `${label}:${record.sig}`
      this.#render()
      void run()
        .catch(() => { /* the row redraws with whatever actually happened */ })
        .finally(() => { this.#busy = ''; void this.refresh() })
    })
    return word
  }

  #rulesLine(): HTMLElement {
    const line = document.createElement('p')
    line.className = 'hc-brood-rules'
    const rules = this.#rules
    line.textContent = rules
      ? `Your code ${rules.own === 'hold' ? 'is held' : 'runs'} · a community you follow ${rules.followed === 'hold' ? 'is held' : 'runs'} · a stranger is ${rules.stranger === 'refuse' ? 'refused' : 'held'}${rules.vouchesNeeded > 0 ? ` · ${rules.vouchesNeeded} vouches stand in for you` : ''}`
      : ''
    return line
  }
}

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    /* The shell, header, title, close and body are the tool window's base
       layer (core/panels/tool-window.ts). Only the roster is here, painted
       from the theme's roles: its text used to be near-white literals that
       vanished on every bright theme. Steel and alarm are brought down to the
       ground the way tw.ink() brings a colour down. */
    ${SURFACE} { display: contents; }
    .hc-brood {
      --hc-brood-steel: color-mix(in srgb, rgb(126, 182, 214), rgb(var(--hc-panel-ink)) var(--hc-deepen, 0%));
      --hc-brood-alarm: color-mix(in srgb, rgb(214, 126, 126), rgb(var(--hc-panel-ink)) var(--hc-deepen, 0%));
    }
    .hc-brood-lede { margin: 0 0 0.6rem; color: var(--hc-brood-alarm); }
    .hc-brood-quiet { margin: 0 0 0.5rem; color: var(--hc-window-ink-faint); font-size: 0.9em; }

    /* A HELD ROW NEVER LOOKS SAFE. The left edge is the alarm until a hand
       has ruled; only an acceptance turns it to the ordinary accent. */
    .hc-brood-row {
      margin: 0 0 0.6rem; padding: 0.45rem 0.55rem;
      border: 1px solid var(--hc-window-edge); border-left: 2px solid var(--hc-brood-alarm);
      border-radius: var(--hc-radius-control, 2px); background: rgba(var(--hc-panel-ink), 0.02);
    }
    .hc-brood-row.is-accepted { border-left-color: var(--hc-window-accent); }
    .hc-brood-name { font-size: 1.02em; color: var(--hc-window-accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hc-brood-from { font-size: 0.85em; color: var(--hc-brood-steel); }
    .hc-brood-said { margin-top: 0.25rem; font-size: 0.88em; color: var(--hc-window-ink-quiet); }
    .hc-brood-risk { margin-top: 0.2rem; font-size: 0.88em; }
    .hc-brood-risk.is-high { color: var(--hc-brood-alarm); }
    .hc-brood-risk.is-medium { color: var(--hc-window-accent); }
    .hc-brood-risk.is-low { color: var(--hc-brood-steel); }
    .hc-brood-risk.is-unread { color: var(--hc-window-ink-faint); }
    .hc-brood-report { margin: 0.3rem 0 0; max-height: 16rem; overflow: auto; white-space: pre-wrap; font-size: 0.82em; color: var(--hc-window-ink-quiet); }
    .hc-brood-state { margin-top: 0.2rem; font-size: 0.85em; color: var(--hc-brood-alarm); }
    .hc-brood-state.is-accepted { color: var(--hc-window-accent); }

    /* Words, not bordered buttons. */
    .hc-brood-acts { display: flex; gap: 0.75rem; margin-top: 0.45rem; }
    .hc-brood-do {
      padding: 0; background: none; border: 0; border-radius: 0;
      color: var(--hc-brood-steel); font: inherit; font-size: 0.88em;
      letter-spacing: 0.04em; cursor: pointer;
    }
    .hc-brood-do:hover:not(:disabled) { color: var(--hc-panel-text); text-decoration: underline; }
    .hc-brood-do:disabled { opacity: 0.4; cursor: default; }
    .hc-brood-do.is-danger { color: var(--hc-brood-alarm); }

    .hc-brood-rules {
      margin: 0.8rem 0 0; padding-top: 0.5rem; font-size: 0.82em;
      border-top: 1px solid var(--hc-window-edge); color: var(--hc-window-ink-faint);
    }
  `
  document.head.appendChild(style)
}

export { BroodElement, SURFACE as BROOD_SURFACE, OWNER as BROOD_OWNER, OPEN as BROOD_OPEN_EFFECT }
