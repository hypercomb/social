// sharing/site-revisions.view.ts
//
// THE SITE'S REVISIONS, ON THE MANAGED SITE DOOR'S BAR (jwize, 2026-11-16:
// "save named revisions and then incremental subitems … a new name just
// starts a new list of updates and if we want to change revisions we would
// first save the current one unless we wanted to discard with confirmations.
// This way we can always put our development away for a bit.").
//
// One button in the bar says which revision is in hand and which step of it
// ("red theme · 3", with a mark while the card holds changes no step does).
// It opens a small panel under the bar:
//
//   • a name and Save. The name in hand is filled in, so Save alone adds the
//     next step; a different name starts a new line of work from here.
//   • Discard changes, only while there are some, behind a question.
//   • every line, the one in hand open, each with its steps newest first.
//     Pressing a step opens it. What the card holds now is saved first as a
//     step of the line being left, so opening another revision never loses
//     anything and asks nothing.
//
// The revisions are the tile's build records (history/revision-lines.ts);
// this file only shows them and calls the three acts. A dependency: it
// exports the panel and registers nothing. site-manage.view.ts mounts it.

import { EffectBus, I18N_IOC_KEY, requestConfirm, type I18nProvider } from '@hypercomb/core'
import type { BuildRecord } from '../history/builds-slot.js'
import {
  discardChanges, lineKey, openRevision, readRevisions, saveRevision, stepOf,
  type RevisionLine, type RevisionState,
} from '../history/revision-lines.js'

const STYLE_ID = 'hc-site-revisions-styles'

type IocLike = { get?<T>(key: string): T | undefined }
const ioc = (): IocLike | undefined => (globalThis as { ioc?: IocLike }).ioc

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  try {
    const value = ioc()?.get?.<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    if (typeof value === 'string' && value && value !== key) return value
  } catch { /* the fallback below */ }
  return fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
}

const when = (at: number): string => {
  if (!at) return ''
  try {
    return new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch { return '' }
}

/** What the bar's button says: the line in hand and its step, or the
 *  invitation to save a first one. */
export const revisionButtonWords = (state: RevisionState | null): string => {
  if (!state?.current) return t('revisions.none', 'Revisions')
  const newest = state.records[state.records.length - 1]
  const step = newest ? stepOf(state.lines, newest) : 0
  const words = step > 0
    ? t('revisions.in-hand', '{name} · {step}', { name: state.current, step })
    : state.current
  return state.dirty ? t('revisions.in-hand-changed', '{words} •', { words }) : words
}

export type SiteRevisionsHost = {
  /** The site's tile, as its route. */
  readonly segments: () => readonly string[] | null
  /** The state changed (a save, an open, a discard, or a fresh read). */
  readonly onState: (state: RevisionState | null) => void
  /** Another revision is live now: its conversations are the ones to show. */
  readonly onOpened: () => void
}

/** The panel under the bar. `element` is mounted by the host; `toggle` opens
 *  and closes it; `refresh` re-reads where the revisions stand. */
export class SiteRevisionsPanel {
  readonly element: HTMLDivElement
  readonly #host: SiteRevisionsHost
  #state: RevisionState | null = null
  #busy = false
  #said = ''
  /** The line whose steps are shown: the one in hand until another is pressed. */
  #unfolded = ''
  #name: HTMLInputElement | null = null
  #ticket = 0

  constructor(host: SiteRevisionsHost) {
    ensureStyles()
    this.#host = host
    const element = this.element = document.createElement('div')
    element.className = 'sr-panel'
    element.hidden = true
    element.setAttribute('role', 'dialog')
    element.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      this.close()
    })
  }

  get open(): boolean { return !this.element.hidden }
  get state(): RevisionState | null { return this.#state }

  toggle(): void { if (this.open) this.close(); else this.show() }

  show(): void {
    this.element.hidden = false
    this.#said = ''
    this.#unfolded = ''
    this.#paint()
    void this.refresh().then(() => { this.#name?.focus(); this.#name?.select() })
  }

  close(): void { this.element.hidden = true }

  /** Re-read where the revisions stand, and say so to the bar. */
  async refresh(): Promise<void> {
    const segments = this.#host.segments()
    if (!segments?.length) return
    const ticket = ++this.#ticket
    const state = await readRevisions(segments).catch(() => null)
    if (ticket !== this.#ticket) return
    this.#state = state
    this.#host.onState(state)
    if (this.open) this.#paint()
  }

  async #run(act: () => Promise<string>): Promise<void> {
    if (this.#busy) return
    this.#busy = true
    this.#paint()
    try { this.#said = await act() } catch (error) { this.#said = error instanceof Error ? error.message : String(error ?? '') }
    this.#busy = false
    await this.refresh()
    this.#paint()
  }

  #save(): void {
    const segments = this.#host.segments()
    if (!segments?.length) return
    const typed = this.#name?.value.trim() ?? ''
    void this.#run(async () => {
      const outcome = await saveRevision(segments, typed)
      if (!outcome.ok) {
        return outcome.needsName ? t('revisions.needs-name', 'Give this revision a name.') : t('revisions.failed', 'That did not complete. {reason}', { reason: outcome.error })
      }
      this.#unfolded = ''
      // A new name is a new line: the conversations shown are that line's.
      EffectBus.emit('chat:threads-changed', {})
      return outcome.unchanged
        ? t('revisions.unchanged', 'Nothing changed since {name} · {step}.', { name: outcome.name, step: outcome.step })
        : t('revisions.saved', 'Saved {name} · {step}.', { name: outcome.name, step: outcome.step })
    })
  }

  #openStep(record: BuildRecord): void {
    const segments = this.#host.segments()
    if (!segments?.length) return
    void this.#run(async () => {
      const outcome = await openRevision(segments, record)
      if (!outcome.ok) return t('revisions.failed', 'That did not complete. {reason}', { reason: outcome.error })
      this.#unfolded = ''
      EffectBus.emit('chat:threads-changed', {})
      this.#host.onOpened()
      return outcome.failed > 0
        ? t('revisions.opened-partly', 'Opened {name}. {failed} parts of it are not on this device.', { name: outcome.name, failed: outcome.failed })
        : t('revisions.opened', 'Opened {name}.', { name: outcome.name })
    })
  }

  async #discard(): Promise<void> {
    const segments = this.#host.segments()
    const state = this.#state
    if (!segments?.length || !state?.current || this.#busy) return
    const yes = await requestConfirm({
      // Said already: a catalog without these words shows the English.
      title: t('revisions.discard-confirm.title', 'Discard your changes?'),
      message: t('revisions.discard-confirm.message', 'The card goes back to the last step saved under {name}. What you changed since stays one step back in its history.', { name: state.current }),
      confirmLabel: t('revisions.discard', 'Discard changes'),
      cancelLabel: t('revisions.discard-confirm.cancel', 'Keep them'),
      danger: true,
    })
    if (!yes) return
    void this.#run(async () => {
      const outcome = await discardChanges(segments)
      if (!outcome.ok) return t('revisions.failed', 'That did not complete. {reason}', { reason: outcome.error })
      return t('revisions.discarded', 'Back to the last step of {name}.', { name: outcome.name })
    })
  }

  #paint(): void {
    const state = this.#state
    const element = this.element
    const kept = this.#name && document.activeElement === this.#name ? this.#name.value : null
    element.replaceChildren()

    const form = document.createElement('form')
    form.className = 'sr-save'
    form.addEventListener('submit', event => { event.preventDefault(); this.#save() })
    const name = this.#name = document.createElement('input')
    name.type = 'text'
    name.className = 'sr-name'
    name.maxLength = 80
    name.autocomplete = 'off'
    name.spellcheck = false
    name.placeholder = t('revisions.name', 'Name this revision')
    name.setAttribute('aria-label', name.placeholder)
    name.value = kept ?? state?.current ?? ''
    name.disabled = this.#busy
    const save = document.createElement('button')
    save.type = 'submit'
    save.className = 'sm-btn sr-go'
    save.disabled = this.#busy
    save.textContent = this.#busy ? t('revisions.working', 'Working…') : t('revisions.save', 'Save')
    form.append(name, save)
    element.append(form)
    if (kept !== null) name.focus()

    if (state?.current && state.dirty) {
      const changed = document.createElement('div')
      changed.className = 'sr-changed'
      const words = document.createElement('span')
      words.textContent = t('revisions.changed', 'Changes not saved to {name} yet.', { name: state.current })
      const discard = document.createElement('button')
      discard.type = 'button'
      discard.className = 'sr-link'
      discard.disabled = this.#busy
      discard.textContent = t('revisions.discard', 'Discard changes')
      discard.addEventListener('click', () => { void this.#discard() })
      changed.append(words, discard)
      element.append(changed)
    }

    if (this.#said) {
      const said = document.createElement('div')
      said.className = 'sr-said'
      said.setAttribute('role', 'status')
      said.textContent = this.#said
      element.append(said)
    }

    const lines = state?.lines ?? []
    if (!lines.length) {
      const empty = document.createElement('div')
      empty.className = 'sr-empty'
      empty.textContent = t('revisions.empty', 'Nothing saved yet. Save names the card as it stands; every save after it is a step under that name.')
      element.append(empty)
      return
    }
    const inHand = lineKey(state?.current ?? '')
    const unfolded = this.#unfolded || inHand
    const newest = state?.records[state.records.length - 1] ?? null
    const list = document.createElement('div')
    list.className = 'sr-lines'
    for (const line of lines) list.append(this.#line(line, line.key === inHand, line.key === unfolded, newest, !!state?.dirty))
    element.append(list)
  }

  #line(line: RevisionLine, inHand: boolean, unfolded: boolean, newest: BuildRecord | null, dirty: boolean): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'sr-line' + (inHand ? ' in-hand' : '')
    const head = document.createElement('button')
    head.type = 'button'
    head.className = 'sr-line-head'
    head.setAttribute('aria-expanded', String(unfolded))
    const name = document.createElement('span')
    name.className = 'sr-line-name'
    name.textContent = line.name
    const count = document.createElement('span')
    count.className = 'sr-line-count'
    count.textContent = line.steps.length === 1
      ? t('revisions.steps-one', '1 step')
      : t('revisions.steps-many', '{n} steps', { n: line.steps.length })
    const at = document.createElement('span')
    at.className = 'sr-line-at'
    at.textContent = when(line.at)
    head.append(name, count, at)
    head.addEventListener('click', () => {
      this.#unfolded = unfolded ? '\u0000' : line.key
      this.#paint()
    })
    wrap.append(head)
    if (!unfolded) return wrap

    const steps = document.createElement('div')
    steps.className = 'sr-steps'
    for (let index = line.steps.length - 1; index >= 0; index--) {
      const record = line.steps[index]!
      const here = inHand && !!newest && newest.seal === record.seal
      const step = document.createElement('button')
      step.type = 'button'
      step.className = 'sr-step' + (here ? ' here' : '')
      // The step the card is at needs no opening while nothing changed.
      step.disabled = this.#busy || (here && !dirty)
      const number = document.createElement('span')
      number.className = 'sr-step-number'
      number.textContent = String(index + 1)
      const stamp = document.createElement('span')
      stamp.className = 'sr-step-at'
      stamp.textContent = when(record.at)
      const mark = document.createElement('span')
      mark.className = 'sr-step-mark'
      mark.textContent = here
        ? (dirty ? t('revisions.here-changed', 'here, changed') : t('revisions.here', 'here'))
        : t('revisions.open', 'Open')
      step.append(number, stamp, mark)
      step.addEventListener('click', () => this.#openStep(record))
      steps.append(step)
    }
    wrap.append(steps)
    return wrap
  }
}

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  const P = 'hc-site-manage .sr-panel'
  style.textContent = `
hc-site-manage .sm-revisions { max-width: 16rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${P} {
  position: fixed; top: 2.6rem; right: 0.75rem; z-index: 99992; width: min(24rem, calc(100vw - 1.5rem));
  max-height: min(70vh, 32rem); overflow: auto; padding: 0.6rem; border-radius: 4px;
  background: rgba(10, 12, 16, 0.96); color: #e8e8ea; border: 1px solid rgba(255, 255, 255, 0.14);
  font: 500 0.78rem/1.45 var(--hc-mono, ui-monospace, monospace); box-shadow: 0 0.6rem 2rem rgba(0, 0, 0, 0.5);
}
${P} .sr-save { display: flex; gap: 0.4rem; }
${P} .sr-name {
  flex: 1; min-width: 0; padding: 0.3rem 0.5rem; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.05); color: inherit; font: inherit;
}
${P} .sr-name:focus { outline: none; border-color: rgba(200, 151, 90, 0.8); }
${P} .sr-go { border-color: rgba(200, 151, 90, 0.6); }
${P} .sr-changed { display: flex; align-items: baseline; gap: 0.5rem; margin-top: 0.5rem; color: #e3c48f; }
${P} .sr-changed span { flex: 1; min-width: 0; }
${P} .sr-link { flex-shrink: 0; padding: 0; border: 0; background: none; color: #e8a0a0; font: inherit; cursor: pointer; text-decoration: underline; }
${P} .sr-link:disabled { opacity: 0.6; cursor: progress; }
${P} .sr-said { margin-top: 0.5rem; color: #bfe8c8; }
${P} .sr-empty { margin-top: 0.6rem; color: #a9adb5; }
${P} .sr-lines { margin-top: 0.6rem; border-top: 1px solid rgba(255, 255, 255, 0.1); }
${P} .sr-line { border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
${P} .sr-line-head {
  display: flex; align-items: baseline; gap: 0.6rem; width: 100%; padding: 0.4rem 0.2rem; border: 0; background: none;
  color: inherit; font: inherit; text-align: left; cursor: pointer;
}
${P} .sr-line-head:hover { background: rgba(255, 255, 255, 0.06); }
${P} .sr-line-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${P} .sr-line.in-hand .sr-line-name { color: #c8975a; }
${P} .sr-line-count, ${P} .sr-line-at, ${P} .sr-step-at { flex-shrink: 0; color: #a9adb5; }
${P} .sr-steps { padding: 0 0 0.35rem 0.6rem; }
${P} .sr-step {
  display: flex; align-items: baseline; gap: 0.6rem; width: 100%; padding: 0.25rem 0.3rem; border: 0; border-radius: 4px;
  background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
${P} .sr-step:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); }
${P} .sr-step:disabled { cursor: default; }
${P} .sr-step-number { flex-shrink: 0; min-width: 1.4rem; color: #c8975a; }
${P} .sr-step-at { flex: 1; min-width: 0; }
${P} .sr-step-mark { flex-shrink: 0; color: #a9adb5; }
${P} .sr-step.here .sr-step-mark { color: #bfe8c8; }
`
  document.head.appendChild(style)
}
