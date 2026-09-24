// assistant/sandbox-change.view.ts
//
// WHAT A TRIAL CHANGES, ONE DIFFERENCE AT A TIME (documentation/module-sandbox.md,
// "The communal build"; jwize 2026-09-22: "each person can just go to each
// domain … and see the differences one at a time").
//
// `module changes <change>` opens this over whatever hive is running — the
// publisher's, a tester's at the door, anyone's. It walks the trial's
// published change file by file, before and after; says what the trial
// turned off; shows the host AI's reading and every signed assessment with
// its note; and steps to the previous or next trial the zone lists, so a
// group working together can walk every trial in turn without leaving.
//
// Each changed file can be TAKEN into this hive at its path (module-review.ts
// takeTrial, the same act as `module take`): made by hand, so what it brings
// waits in the brood until the participant accepts it there.
//
// Everything is read BY SIGNATURE from the trial's door (the worker's flat
// read), and only bytes that hash to the signature asked for are believed.
// Text from the heap is drawn as text, never as markup: notes and findings
// are anyone's words.
//
// A dependency: it exports the element; the sandbox feature's bee
// (sandbox-door.drone.ts) defines it and adds it to the ShellSurfaceRegistry.

import { EffectBus, I18N_IOC_KEY, isSandboxDoor, type I18nProvider } from '@hypercomb/core'
import type { DiffRow } from './line-diff.js'
import { countedAssessors, doorReader, isSandboxSite, readTrial, takeDepsFrom, takeTrial, tallyAssessments, trialsOf, type SandboxSite, type SandboxTrial, type TakeDeps, type TrialReading } from './module-review.js'

export const SANDBOX_CHANGE_SURFACE = 'hc-sandbox-change'
export const SANDBOX_CHANGE_OWNER = '@diamondcoreprocessor.com/SandboxChangeView'
/** Opens the panel: `{ name, door, site, at }`. `at` guards the bus's replay. */
export const SANDBOX_CHANGE_EFFECT = 'module:changes'

const STYLE_ID = 'hc-sandbox-change-styles'
const OPEN_STAMP_MS = 4_000
/** Rows drawn per file; the rest are counted, with the signature to read them. */
const SHOWN_ROWS = 400

export interface SandboxChangePayload {
  readonly name: string
  /** The trial's door, where its files are read. */
  readonly door: string
  readonly site: SandboxSite
  readonly at: number
}

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t?.(key, params)
  return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
}

const INSTALL_KEY = '@hypercomb.social/Install'
const BROOD_OPEN = 'brood:open'

/** The zone a door hangs off: its origin without the trial's own label. */
const zoneOf = (door: string, name: string): string => door.replace(`//${name}.`, '//')

export class SandboxChangeElement extends HTMLElement {
  #panel: HTMLElement | null = null
  #cleanup: Array<() => void> = []
  #shown: SandboxChangePayload | null = null
  #reading: TrialReading | null = null
  #trials: readonly SandboxTrial[] = []
  /** Whose assessments count here (countedAssessors): this hive's key and the publisher it follows. */
  #counted: ReadonlySet<string> = countedAssessors()
  #turn = 0
  /** What taking each path came to, while this trial is shown. */
  #taking = new Map<string, { text: string; held: boolean }>()

  /** SEAMS, replaced in a spec so no test reads a real door or a real install. */
  reader: (door: string) => (sig: string) => Promise<string | null> = doorReader
  taker: () => TakeDeps | null = () => {
    type Install = Parameters<typeof takeDepsFrom>[0]
    const install = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(INSTALL_KEY) as Partial<Install> | undefined
    return install?.pick && install.revisionsOf ? takeDepsFrom(install as Install) : null
  }

  connectedCallback(): void {
    ensureStyles()
    this.#cleanup.push(EffectBus.on<SandboxChangePayload>(SANDBOX_CHANGE_EFFECT, payload => {
      if (!payload || Math.abs(Date.now() - (payload.at ?? 0)) > OPEN_STAMP_MS) return
      void this.show(payload)
    }))
  }

  disconnectedCallback(): void {
    for (const off of this.#cleanup) off()
    this.#cleanup = []
    this.close()
  }

  /** Open on one trial and read it. Resolves once it is drawn. */
  async show(payload: SandboxChangePayload): Promise<void> {
    const turn = ++this.#turn
    if (this.#shown?.name !== payload.name) this.#taking.clear()
    this.#shown = payload
    this.#reading = null
    this.#open()
    this.#render()
    const [reading, trials] = await Promise.all([
      readTrial(payload.site, this.reader(payload.door)),
      fetch(`${zoneOf(payload.door, payload.name)}/trials.json`, { cache: 'no-store' })
        .then(res => res.ok ? res.json() : null).then(trialsOf).catch(() => [] as SandboxTrial[]),
    ])
    if (turn !== this.#turn) return
    const signer = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@diamondcoreprocessor.com/NostrSigner') as { getPublicKeyHex?(): Promise<string | null> } | undefined
    this.#counted = countedAssessors(await signer?.getPublicKeyHex?.().catch(() => null))
    if (turn !== this.#turn) return
    this.#reading = reading
    this.#trials = trials
    this.#render()
  }

  close(): void {
    this.#turn++
    if (!this.#panel) return
    this.#panel.removeEventListener('keydown', this.#onKey)
    this.#panel.remove()
    this.#panel = null
  }

  get isOpen(): boolean { return !!this.#panel }

  #open(): void {
    if (this.#panel) return
    const panel = document.createElement('aside')
    panel.className = 'hc-trial'
    panel.setAttribute('role', 'dialog')
    panel.tabIndex = -1
    panel.setAttribute('data-consumes-wheel', '')
    panel.addEventListener('keydown', this.#onKey)
    this.appendChild(panel)
    this.#panel = panel
    panel.focus({ preventScroll: true })
  }

  readonly #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    this.close()
  }

  /** Take this trial's layer at one path into this hive, by hand. */
  async #take(path: string): Promise<void> {
    const shown = this.#shown
    const deps = this.taker()
    if (!shown || this.#taking.has(path)) return
    // A DOOR WRITES NOTHING: taking is done from your own hive (a courtesy —
    // the host refuses a door's writes whatever this panel does).
    if (isSandboxDoor()) {
      this.#taking.set(path, { text: t('module.atdoor', 'A sandbox door writes nothing — say {word} from your own hive.', { word: 'module take' }), held: false })
      this.#render()
      return
    }
    if (!deps) {
      this.#taking.set(path, { text: t('module.panel.nottaken', 'not taken: {reason}', { reason: 'nothing is installed here' }), held: false })
      this.#render()
      return
    }
    this.#taking.set(path, { text: t('module.panel.taking', 'taking…'), held: false })
    this.#render()
    const outcome = await takeTrial(shown.site.package, [path], [new URL(shown.door).host], deps)
    const refused = outcome.refused[0]
    this.#taking.set(path, refused
      ? { text: t('module.panel.nottaken', 'not taken: {reason}', { reason: refused.error }), held: false }
      : outcome.held
        ? { text: t('module.panel.takenheld', 'taken — it waits in the brood until you accept it'), held: true }
        : { text: t('module.panel.taken', 'taken — reload to run it'), held: false })
    this.#render()
  }

  /** The neighbouring trial on the zone, read from its own door. */
  async #step(by: number): Promise<void> {
    const shown = this.#shown
    if (!shown || this.#trials.length < 2) return
    const here = Math.max(0, this.#trials.findIndex(trial => trial.name === shown.name))
    const next = this.#trials[(here + by + this.#trials.length) % this.#trials.length]!
    const site = await fetch(`${next.door}/site.json`, { cache: 'no-store' }).then(res => res.ok ? res.json() : null).catch(() => null)
    if (!isSandboxSite(site)) return
    await this.show({ name: next.name, door: next.door, site, at: Date.now() })
  }

  // ── the drawing ─────────────────────────────────────────────────────────

  #render(): void {
    const panel = this.#panel
    const shown = this.#shown
    if (!panel || !shown) return
    panel.setAttribute('aria-label', shown.name)
    panel.replaceChildren(this.#head(shown), this.#body(shown))
  }

  #head(shown: SandboxChangePayload): HTMLElement {
    const head = el('header', 'hc-trial-head')
    head.appendChild(el('span', 'hc-trial-title', shown.name))
    const at = this.#trials.findIndex(trial => trial.name === shown.name)
    if (this.#trials.length > 1) {
      head.appendChild(word('‹', t('module.panel.previous', 'previous trial'), () => void this.#step(-1)))
      head.appendChild(el('span', 'hc-trial-count', t('module.panel.of', '{at} of {total}', { at: at < 0 ? '–' : at + 1, total: this.#trials.length })))
      head.appendChild(word('›', t('module.panel.next', 'next trial'), () => void this.#step(1)))
    }
    const close = word('×', t('module.panel.close', 'Close'), () => this.close())
    close.classList.add('hc-trial-close')
    head.appendChild(close)
    return head
  }

  #body(shown: SandboxChangePayload): HTMLElement {
    const body = el('div', 'hc-trial-body')
    const reading = this.#reading
    const site = shown.site
    const when = reading?.at ? new Date(reading.at).toLocaleString() : ''
    const meta = el('p', 'hc-trial-meta', t('module.panel.by', 'by {publisher}{when} · not promoted', {
      publisher: site.publisher || site.pubkey.slice(0, 12) + '…', when: when ? ` · ${when}` : '',
    }))
    const door = document.createElement('a')
    door.className = 'hc-trial-door'
    door.href = shown.door
    door.target = '_blank'
    door.rel = 'noopener'
    door.textContent = t('module.panel.door', 'open the door')
    meta.append(' · ', door)
    body.appendChild(meta)

    if (!reading) {
      body.appendChild(el('p', 'hc-trial-quiet', t('module.panel.reading', 'Reading the change…')))
      return body
    }

    // The host's AI — as the PUBLISHER recorded it: the review is a record in
    // the publisher's own index, so it is shown as its word.
    body.appendChild(el('h3', 'hc-trial-section', t('module.panel.aiby', "The host's AI — as its publisher recorded it")))
    if (reading.review) {
      body.appendChild(el('p', `hc-trial-verdict is-${reading.review.verdict}`, `${reading.review.verdict}${reading.review.model ? ` · ${reading.review.model}` : ''}`))
      if (reading.review.findings) body.appendChild(el('pre', 'hc-trial-findings', reading.review.findings))
    } else {
      body.appendChild(el('p', 'hc-trial-quiet', t('module.panel.unreviewed', "The host's AI has not read this change.")))
    }

    // Jev: the diff against the doctrine, rule by rule.
    body.appendChild(el('h3', 'hc-trial-section', t('module.panel.jevby', 'Jev — the doctrine, rule by rule, as its publisher recorded it')))
    if (reading.jev) {
      body.appendChild(el('p', `hc-trial-verdict is-${reading.jev.verdict}`, `${reading.jev.verdict}${reading.jev.model ? ` · ${reading.jev.model}` : ''}`))
      for (const file of reading.jev.files) {
        body.appendChild(el('p', 'hc-trial-quiet', t('module.panel.jevfile', '{section}: closest to breaking "{rule}" ({percent}%)', {
          section: file.section, rule: file.worst.rule, percent: Math.round(file.worst.breaks * 100),
        })))
      }
    } else {
      body.appendChild(el('p', 'hc-trial-quiet', t('module.panel.unjev', 'Jev has not read this change.')))
    }

    // People.
    // Only the people who count are counted; everyone else is listed, marked.
    const tally = tallyAssessments(site, this.#counted)
    body.appendChild(el('h3', 'hc-trial-section', t('module.panel.peoplecount', 'People who count — {accept} accept · {refuse} refuse · {unclear} unclear · {others} not counted', tally)))
    if (!reading.people.length) {
      body.appendChild(el('p', 'hc-trial-quiet', t('module.panel.nobody', 'No one has assessed it yet. Assess it from your own hive: module assess {change} accept|refuse <note>.', { change: shown.name.replace(/^try-/, '') })))
    }
    for (const person of reading.people) {
      const row = el('p', 'hc-trial-person')
      row.append(el('span', `hc-trial-verdict is-${person.verdict}`, person.verdict), ' ', el('span', 'hc-trial-key', person.pubkey.slice(0, 12) + '…'), ' ', el('span', 'hc-trial-note', person.note))
      if (!this.#counted.has(person.pubkey.toLowerCase())) row.append(' ', el('span', 'hc-trial-quiet', t('module.panel.uncounted', '(not counted)')))
      body.appendChild(row)
    }

    // The change, file by file.
    body.appendChild(el('h3', 'hc-trial-section', t('module.panel.changed', 'What it changes')))
    if (!site.change) body.appendChild(el('p', 'hc-trial-quiet', t('module.panel.nochange', 'This trial published no change record.')))
    else if (!reading.files.length && !reading.off.length && !reading.taken.length) body.appendChild(el('p', 'hc-trial-quiet', t('module.panel.samecode', 'No source file changed.')))
    for (const file of reading.files) body.appendChild(this.#file(file))
    if (reading.taken.length) {
      body.appendChild(el('h3', 'hc-trial-section', t('module.panel.takenfrom', 'What it takes from other builds')))
      for (const taken of reading.taken) {
        body.appendChild(el('p', 'hc-trial-off', t('module.panel.takenrow', '{path} — from {root}', { path: taken.path, root: taken.root.slice(0, 12) + '…' })))
      }
    }
    if (reading.off.length) {
      body.appendChild(el('h3', 'hc-trial-section', t('module.panel.off', 'What it turns off')))
      for (const path of reading.off) body.appendChild(el('p', 'hc-trial-off', path))
    }
    if (reading.missing.length) {
      body.appendChild(el('p', 'hc-trial-quiet', t('module.panel.missing', 'Not readable from the door: {sigs}', {
        sigs: reading.missing.map(sig => sig.slice(0, 12) + '…').join(', '),
      })))
    }
    return body
  }

  #file(file: TrialReading['files'][number]): HTMLElement {
    const block = el('section', 'hc-trial-file')
    const head = el('div', 'hc-trial-file-head')
    head.appendChild(el('span', 'hc-trial-file-name', file.section))
    if (file.diff) head.appendChild(el('span', 'hc-trial-file-count', `+${file.diff.added} −${file.diff.removed}`))
    if (file.path) {
      const taking = this.#taking.get(file.path)
      if (taking) head.appendChild(el('span', 'hc-trial-taken', taking.text))
      else {
        const take = word(t('module.panel.take', 'take'), t('module.panel.takewhy', 'Take this change into your hive at {path} — held until you accept it', { path: file.path }), () => void this.#take(file.path))
        take.classList.add('hc-trial-take')
        head.appendChild(take)
      }
      if (taking?.held) {
        const brood = word(t('module.panel.brood', 'open the brood'), t('module.panel.brood', 'open the brood'), () => {
          this.close()
          EffectBus.emit(BROOD_OPEN, { at: Date.now() })
        })
        brood.classList.add('hc-trial-take')
        head.appendChild(brood)
      }
    }
    block.appendChild(head)
    if (!file.diff) {
      block.appendChild(el('p', 'hc-trial-quiet', t('module.panel.unreadable', 'This file could not be read from the door.')))
      return block
    }
    const rows = el('div', 'hc-trial-rows')
    for (const row of file.diff.rows.slice(0, SHOWN_ROWS)) rows.appendChild(diffRow(row))
    if (file.diff.rows.length > SHOWN_ROWS) {
      rows.appendChild(el('div', 'hc-trial-row is-skip', t('module.panel.more', '{rows} more rows', { rows: file.diff.rows.length - SHOWN_ROWS })))
    }
    block.appendChild(rows)
    return block
  }
}

const el = (tag: string, className: string, text?: string): HTMLElement => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** An act is a word, not a bordered button. */
const word = (glyph: string, label: string, run: () => void): HTMLButtonElement => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'hc-trial-word'
  button.textContent = glyph
  button.title = label
  button.setAttribute('aria-label', label)
  button.addEventListener('click', run)
  return button
}

const diffRow = (row: DiffRow): HTMLElement => {
  if (row.kind === 'skip') return el('div', 'hc-trial-row is-skip', t('module.panel.unchanged', '⋯ {lines} unchanged lines', { lines: row.count }))
  const mark = row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '
  return el('div', `hc-trial-row is-${row.kind}`, `${mark} ${row.text}`)
}

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  // The tool-window material in the shared ROLES (tool-window-colour-roles.md):
  // pane and ink from the theme, colour only where it is the point — an added
  // line and a removed one — through the status colours every theme sets.
  style.textContent = `
    ${SANDBOX_CHANGE_SURFACE} { display: contents; }
    .hc-trial {
      position: fixed;
      top: max(calc(2.3rem * var(--hc-header-zoom, 1.0)), var(--hc-header-anchor, 0px));
      right: var(--hc-controls-right, 0px); bottom: 0;
      width: min(46rem, calc(100vw - 1.5rem));
      box-sizing: border-box; display: flex; flex-direction: column;
      z-index: 100002;
      background: rgba(var(--hc-panel-pane, 12, 19, 27), 0.975);
      backdrop-filter: blur(14px) saturate(1.04);
      -webkit-backdrop-filter: blur(14px) saturate(1.04);
      border-left: 1px solid var(--hc-window-line-firm, rgba(227, 237, 245, 0.26));
      box-shadow: -14px 0 44px rgba(0, 0, 0, 0.36);
      color: var(--hc-window-ink-plain, rgba(227, 237, 245, 0.86));
      font-family: var(--hc-mono, system-ui);
      font-size: calc(0.8125rem * var(--hc-panel-scale, 1));
      line-height: 1.45; overflow: hidden; outline: none;
    }
    .hc-trial-head {
      flex: 0 0 auto; display: flex; align-items: center; gap: 0.5rem;
      height: 2.875rem; min-height: 2.875rem; padding: 0 0.75rem; box-sizing: border-box;
      border-bottom: 1px solid var(--hc-window-line, rgba(227, 237, 245, 0.14));
    }
    .hc-trial-title {
      flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-weight: 600; letter-spacing: 0.04em; color: var(--hc-window-ink-loud, #eef2f5);
    }
    .hc-trial-count { color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); font-size: 0.9em; }
    .hc-trial-word {
      display: inline-grid; place-items: center; min-width: 1.75rem; height: 1.75rem; padding: 0 0.25rem;
      background: none; border: 0; border-radius: var(--hc-radius-control, 2px);
      color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); font: inherit; font-size: 1.05rem; cursor: pointer;
    }
    .hc-trial-word:hover { color: var(--hc-window-ink-loud, #fff); background: var(--hc-window-tint-strong, rgba(255, 255, 255, 0.075)); }
    .hc-trial-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0.7rem 0.75rem 1.2rem; }
    .hc-trial-meta { margin: 0 0 0.5rem; color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); }
    .hc-trial-door { color: var(--hc-window-ink-plain, rgba(227, 237, 245, 0.86)); }
    .hc-trial-section {
      margin: 0.9rem 0 0.35rem; font-size: 0.82em; font-weight: 600; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62));
    }
    .hc-trial-quiet { margin: 0.2rem 0; color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); }
    .hc-trial-verdict { margin: 0.2rem 0; font-weight: 600; }
    .hc-trial-verdict.is-accept { color: var(--hc-status-ok, #3fbf8f); }
    .hc-trial-verdict.is-refuse { color: var(--hc-status-alert, #e07a72); }
    .hc-trial-verdict.is-follows { color: var(--hc-status-ok, #3fbf8f); }
    .hc-trial-verdict.is-breaks { color: var(--hc-status-alert, #e07a72); }
    .hc-trial-verdict.is-unsure { color: var(--hc-status-warn, #d9a441); }
    .hc-trial-findings, .hc-trial-rows {
      margin: 0.25rem 0 0.5rem; padding: 0.4rem 0.5rem; border-radius: 2px;
      background: var(--hc-window-tint, rgba(255, 255, 255, 0.045));
      font-family: var(--hc-mono, ui-monospace, monospace); font-size: 0.92em;
    }
    .hc-trial-findings { white-space: pre-wrap; max-height: 14em; overflow: auto; }
    .hc-trial-person { margin: 0.2rem 0; }
    .hc-trial-person .hc-trial-verdict { margin: 0; }
    .hc-trial-key { color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); }
    .hc-trial-file { margin: 0 0 0.6rem; }
    .hc-trial-file-head { display: flex; gap: 0.75rem; align-items: baseline; }
    .hc-trial-file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--hc-window-ink-loud, #eef2f5); }
    .hc-trial-file-count { color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); }
    .hc-trial-word.hc-trial-take { min-width: 0; height: auto; padding: 0; font-size: 0.92em; text-decoration: underline; }
    .hc-trial-taken { color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); font-style: italic; }
    .hc-trial-rows { overflow-x: auto; }
    .hc-trial-row { white-space: pre; min-width: max-content; padding: 0 0.25rem; }
    .hc-trial-row.is-same { color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); }
    .hc-trial-row.is-add {
      color: var(--hc-status-ok, #3fbf8f);
      background: color-mix(in srgb, var(--hc-status-ok, #3fbf8f) 12%, transparent);
    }
    .hc-trial-row.is-remove {
      color: var(--hc-status-alert, #e07a72);
      background: color-mix(in srgb, var(--hc-status-alert, #e07a72) 12%, transparent);
    }
    .hc-trial-row.is-skip { color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); font-style: italic; }
    .hc-trial-off { margin: 0.15rem 0; }
    @media (max-width: 640px) {
      .hc-trial { left: 0; width: 100vw; border-left: 0; }
    }
  `
  document.head.appendChild(style)
}
