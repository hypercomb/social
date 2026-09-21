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

import { broodRoster, broodRules, EffectBus, type BroodRecord, type BroodRules } from '@hypercomb/core'
import { acceptByHand, auditLine, broodLabel, refuseByHand } from './brood-accept.js'

const SURFACE = 'hc-brood'
const STYLE_ID = 'hc-brood-styles'
const OWNER = '@diamondcoreprocessor.com/BroodView'
const OPEN = 'brood:open'
const OPEN_STAMP_MS = 4_000

const STEEL = '126, 182, 214'
const ACCENT = '201, 162, 39'
const ALARM = '214, 126, 126'

/** What a row is: held code and the one sentence that describes its standing. */
const standing = (record: BroodRecord, rules: BroodRules): string => {
  if (record.ruling?.verdict === 'accepted') return 'You accepted this — it runs.'
  if (record.ruling?.verdict === 'refused') return 'You refused this — it stays held.'
  const accepted = record.vouches.filter(vouch => vouch.verdict === 'accepted').length
  const refused = record.vouches.filter(vouch => vouch.verdict === 'refused').length
  if (refused) return `A community you follow read this and refused it.`
  if (rules.vouchesNeeded > 0 && accepted) return `${accepted} of ${rules.vouchesNeeded} communities you follow stand behind it.`
  return 'Held. It will not run.'
}

const whereFrom = (record: BroodRecord): string => {
  const zone = record.source.zone?.trim()
  const kind = record.source.kind ?? 'stranger'
  const who = kind === 'own' ? 'yours' : kind === 'followed' ? 'a community you follow' : 'a stranger'
  return zone ? `${zone} — ${who}` : who
}

class BroodElement extends HTMLElement {
  #panel: HTMLElement | null = null
  #cleanup: Array<() => void> = []
  #roster: readonly BroodRecord[] = []
  #rules: BroodRules | null = null
  #busy = ''

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
    if (!this.#panel) {
      const panel = document.createElement('aside')
      panel.className = 'hc-brood'
      panel.setAttribute('role', 'dialog')
      panel.setAttribute('aria-label', 'The brood')
      panel.tabIndex = -1
      panel.setAttribute('data-consumes-wheel', '')
      panel.addEventListener('keydown', this.#onKey)
      this.appendChild(panel)
      this.#panel = panel
    }
    this.#render()
    void this.refresh()
  }

  close(): void {
    if (!this.#panel) return
    this.#panel.removeEventListener('keydown', this.#onKey)
    this.#panel.remove()
    this.#panel = null
  }

  get open$(): boolean { return !!this.#panel }

  /** Read, then draw. Exposed so a spec can await the reading. */
  async refresh(): Promise<void> {
    this.#roster = await broodRoster().catch(() => [])
    this.#rules = await broodRules().catch(() => null)
    this.#render()
  }

  readonly #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    this.close()
  }

  // ── the drawing ─────────────────────────────────────────────────────────

  #render(): void {
    const panel = this.#panel
    if (!panel) return
    panel.replaceChildren(this.#head(), this.#body())
  }

  #head(): HTMLElement {
    const head = document.createElement('header')
    head.className = 'hc-brood-head'
    const title = document.createElement('span')
    title.className = 'hc-brood-title'
    title.textContent = 'The brood'
    head.appendChild(title)
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'hc-brood-close'
    close.textContent = '×'
    close.setAttribute('aria-label', 'Close')
    close.addEventListener('click', () => this.close())
    head.appendChild(close)
    return head
  }

  #body(): HTMLElement {
    const body = document.createElement('div')
    body.className = 'hc-brood-body'

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

    const said = document.createElement('div')
    said.className = 'hc-brood-said'
    said.textContent = auditLine(record)
    row.appendChild(said)

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
    if (!accepted) acts.appendChild(this.#act('Accept', record, async () => { await acceptByHand(record) }, true))
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
    /* The same material as every other tool window. A module cannot @use the
       shared stylesheet, so the recipe is restated with the SHARED values. */
    ${SURFACE} { display: contents; }
    .hc-brood {
      position: fixed;
      top: max(calc(2.3rem * var(--hc-header-zoom, 1.0)), var(--hc-header-anchor, 0px));
      right: var(--hc-controls-right, 0px); bottom: 0;
      width: 360px; min-width: 260px; max-width: calc(100vw - 1.5rem);
      box-sizing: border-box; display: flex; flex-direction: column;
      z-index: 100002;
      background: rgba(13, 15, 21, 0.975);
      backdrop-filter: blur(14px) saturate(1.04);
      -webkit-backdrop-filter: blur(14px) saturate(1.04);
      border: 0; border-left: 1px solid rgba(${STEEL}, 0.38); border-radius: 0;
      box-shadow: -14px 0 44px rgba(0, 0, 0, 0.46);
      color: #eef2f5;
      font-family: var(--hc-mono, system-ui);
      font-size: calc(0.8125rem * var(--hc-panel-scale, 1));
      line-height: 1.45; overflow: hidden; outline: none;
    }
    .hc-brood-head {
      flex: 0 0 auto; box-sizing: border-box; display: flex; align-items: center;
      gap: 0.5rem; height: 2.875rem; min-height: 2.875rem; padding: 0 0.75rem;
      background: linear-gradient(180deg, rgba(255,255,255,0.018), rgba(255,255,255,0.006));
      border-bottom: 1px solid rgba(${STEEL}, 0.25);
    }
    .hc-brood-title {
      flex: 1; font-weight: 600; font-size: 0.9em; letter-spacing: 0.06em;
      text-transform: uppercase; color: rgba(${ACCENT}, 0.95);
    }
    .hc-brood-close {
      margin-left: auto; display: inline-grid; place-items: center;
      width: 1.75rem; height: 1.75rem; padding: 0;
      background: none; border: 0; border-radius: var(--hc-radius-control, 2px);
      color: rgba(238, 244, 248, 0.62); font: inherit; font-size: 1.125rem;
      line-height: 1; cursor: pointer;
    }
    .hc-brood-close:hover { color: #fff; background-color: rgba(255,255,255,0.075); }

    .hc-brood-body {
      flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden;
      padding: 0.7rem 0.75rem 1.2rem;
    }
    .hc-brood-lede { margin: 0 0 0.6rem; color: rgba(${ALARM}, 0.95); }
    .hc-brood-quiet { margin: 0 0 0.5rem; color: rgba(238, 244, 248, 0.5); font-size: 0.9em; }

    /* A HELD ROW NEVER LOOKS SAFE. The left edge is the alarm until a hand
       has ruled; only an acceptance turns it to the ordinary accent. */
    .hc-brood-row {
      margin: 0 0 0.6rem; padding: 0.45rem 0.55rem;
      border: 1px solid rgba(${STEEL}, 0.2); border-left: 2px solid rgba(${ALARM}, 0.8);
      border-radius: 2px; background: rgba(255, 255, 255, 0.02);
    }
    .hc-brood-row.is-accepted { border-left-color: rgba(${ACCENT}, 0.85); }
    .hc-brood-name { font-size: 1.02em; color: rgba(${ACCENT}, 0.95); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hc-brood-from { font-size: 0.85em; color: rgba(${STEEL}, 0.9); }
    .hc-brood-said { margin-top: 0.25rem; font-size: 0.88em; color: rgba(238, 244, 248, 0.82); }
    .hc-brood-state { margin-top: 0.2rem; font-size: 0.85em; color: rgba(${ALARM}, 0.92); }
    .hc-brood-state.is-accepted { color: rgba(${ACCENT}, 0.92); }

    /* Words, not bordered buttons. */
    .hc-brood-acts { display: flex; gap: 0.75rem; margin-top: 0.45rem; }
    .hc-brood-do {
      padding: 0; background: none; border: 0; border-radius: 0;
      color: rgba(${STEEL}, 0.95); font: inherit; font-size: 0.88em;
      letter-spacing: 0.04em; cursor: pointer;
    }
    .hc-brood-do:hover:not(:disabled) { color: #fff; text-decoration: underline; }
    .hc-brood-do:disabled { opacity: 0.4; cursor: default; }
    .hc-brood-do.is-danger { color: rgba(${ALARM}, 0.95); }

    .hc-brood-rules {
      margin: 0.8rem 0 0; padding-top: 0.5rem; font-size: 0.82em;
      border-top: 1px solid rgba(${STEEL}, 0.18); color: rgba(238, 244, 248, 0.58);
    }
  `
  document.head.appendChild(style)
}

// Contribute the surface the doctrine way: define the element, then add it to
// the registry — never a tag in either app.html.
;(window as { ioc?: { whenReady?: (k: string, cb: (v: { add(s: unknown): void }) => void) => void } })
  .ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', registry => {
    if (!customElements.get(SURFACE)) customElements.define(SURFACE, BroodElement)
    try {
      registry.add({ name: SURFACE, owner: OWNER, element: SURFACE, order: 150 })
    } catch {
      // duplicate add (hot reload) — the mounted surface is already live
    }
  })

export { BroodElement, SURFACE as BROOD_SURFACE, OPEN as BROOD_OPEN_EFFECT }
