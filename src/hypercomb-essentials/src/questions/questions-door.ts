// questions/questions-door.ts
//
// THE DOOR — how Hypercomb Q and A shows itself. A layer's Q and A is a child
// tile named `<hive> q and a`, but it is never drawn as a hexagon (the grid
// leaves the name out, claimPresence); it is drawn HERE, once, in the chrome,
// on every page of the swarm, saying what the page in front of you holds:
//
//   offered  "<host> leads · 3 here"            Join
//   leading  "you lead · 3 questions here"      Questions · Ask · Tally
//   playing  "following <host> · 3 here"        Questions · Ask · Leave
//   inside   "this layer's questions · 3"       Back · Ask (· Tally)
//
// Every button is a word too: Join = `start <hive> q and a`, Questions =
// `questions`, Back = `questions back`, Leave = `questions leave`, Ask =
// `question <text>`, Tally = `tally`. The element only reads the Questions
// service and calls it; it writes nothing itself.
//
// A dependency: the element class lives here, and the drone
// (questions.drone.ts) defines it and adds it to the shell's surfaces.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { QUESTIONS_KEY, hiveOfGame } from './questions.js'
import type { DoorState, Questions } from './questions.service.js'

export const QUESTIONS_DOOR_SURFACE = 'hc-questions-door'
/** Above the hive (59989) and the phone list (59990), below the controls bar
 *  (60000) and every tool window (100002). */
const DOOR_Z = 59994
const STYLE_ID = 'hc-questions-door-css'

const CSS = `
hc-questions-door { position: fixed; z-index: ${DOOR_Z}; top: calc(env(safe-area-inset-top, 0px) + 64px); left: 50%;
  transform: translateX(-50%); max-width: calc(100vw - 32px); display: none; pointer-events: auto;
  font: 500 0.875rem/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; }
hc-questions-door[data-open] { display: block; }
hc-questions-door .qa { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
  padding: 0.5rem 0.625rem 0.5rem 0.5rem; border-radius: 4px;
  background: var(--hc-surface-raised, rgba(18, 20, 26, 0.9)); color: var(--hc-text, #f3f1ea);
  box-shadow: 0 0.5rem 1.75rem rgba(0, 0, 0, 0.35), inset 0 0 0 1px rgba(236, 188, 87, 0.28);
  backdrop-filter: blur(10px); }
hc-questions-door .qa-mark { flex: none; width: 2.25rem; height: 2.5rem; }
hc-questions-door .qa-text { display: flex; flex-direction: column; min-width: 0; }
hc-questions-door .qa-name { font-weight: 650; letter-spacing: 0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
hc-questions-door .qa-sub { opacity: 0.72; font-size: 0.8125rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
hc-questions-door .qa-acts { display: flex; gap: 0.375rem; margin-left: auto; }
hc-questions-door button { all: unset; cursor: pointer; padding: 0.375rem 0.75rem; border-radius: 2px;
  background: rgba(255, 255, 255, 0.08); color: inherit; font-weight: 600; font-size: 0.8125rem; }
hc-questions-door button:hover, hc-questions-door button:focus-visible { background: rgba(255, 255, 255, 0.16); }
hc-questions-door button.qa-primary { background: #ecbc57; color: #1a1406; }
hc-questions-door button.qa-primary:hover, hc-questions-door button.qa-primary:focus-visible { background: #f3cb72; }
hc-questions-door form { display: flex; gap: 0.375rem; flex-basis: 100%; }
hc-questions-door form[hidden] { display: none; }
hc-questions-door input { flex: 1; min-width: 0; padding: 0.4375rem 0.625rem; border-radius: 2px; border: 0;
  background: rgba(255, 255, 255, 0.1); color: inherit; font: inherit; outline: none; }
hc-questions-door input:focus { box-shadow: inset 0 0 0 1px #ecbc57; }
`

/** The mark: a hexagon holding a question mark — the game's own graphic. */
const MARK = `<svg class="qa-mark" viewBox="0 0 36 40" aria-hidden="true">
  <defs><linearGradient id="qa-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3cb72"/><stop offset="1" stop-color="#d69a2c"/></linearGradient></defs>
  <path d="M18 1.5 34 10.75v18.5L18 38.5 2 29.25v-18.5z" fill="url(#qa-g)"/>
  <path d="M18 6.5 29.5 13.1v13.8L18 33.5 6.5 26.9V13.1z" fill="rgba(26,20,6,0.16)"/>
  <text x="18" y="26.5" text-anchor="middle" font-size="17" font-weight="800" fill="#1a1406" font-family="system-ui, sans-serif">?</text>
</svg>`

const escape = (text: string): string =>
  String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

const t = (key: string, fallback: string, params: Record<string, string | number> = {}): string => {
  const said = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = said?.t?.(key, params)
  return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''))
}

const say = (message: string): void => { EffectBus.emit('activity:log', { message, icon: '✦' }) }

export class QuestionsDoorElement extends HTMLElement {
  #cleanups: (() => void)[] = []
  #asking = false
  #last = ''

  connectedCallback(): void {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }
    this.setAttribute('data-hc-questions-door', '')
    const render = (): void => this.#render()
    const service = this.#service()
    service?.addEventListener('change', render)
    this.#cleanups.push(() => service?.removeEventListener('change', render))
    this.#cleanups.push(EffectBus.on('render:cell-count', render))
    this.#render()
  }

  disconnectedCallback(): void {
    for (const off of this.#cleanups.splice(0)) { try { off() } catch { /* gone */ } }
  }

  #service(): Questions | undefined {
    return (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<Questions>(QUESTIONS_KEY)
  }

  #render(): void {
    const door = this.#service()?.door()
    if (!door || !door.name || door.role === 'none') {
      this.removeAttribute('data-open')
      this.#last = ''
      return
    }
    const key = JSON.stringify(door) + (this.#asking ? '\nasking' : '')
    if (key === this.#last) return
    this.#last = key
    this.setAttribute('data-open', '')
    this.setAttribute('data-role', door.role)
    this.toggleAttribute('data-inside', door.inside)
    this.innerHTML = `<div class="qa" role="group" aria-label="${escape(door.name)}">
      ${MARK}
      <div class="qa-text"><span class="qa-name">${escape(door.name)}</span><span class="qa-sub">${escape(this.#sub(door))}</span></div>
      <div class="qa-acts">${this.#buttons(door)}</div>
      <form class="qa-ask"${this.#asking ? '' : ' hidden'}>
        <input name="q" autocomplete="off" placeholder="${escape(t('questions.door.placeholder', 'Ask a question about this page…'))}" />
        <button type="submit" class="qa-primary">${escape(t('questions.door.ask', 'Ask'))}</button>
      </form>
    </div>`
    for (const b of this.querySelectorAll<HTMLButtonElement>('button[data-act]')) {
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); void this.#act(String(b.dataset['act']), door) })
    }
    const form = this.querySelector('form')
    form?.addEventListener('submit', (e) => { e.preventDefault(); e.stopPropagation(); void this.#ask(form) })
    if (this.#asking) (form?.querySelector('input') as HTMLInputElement | null)?.focus()
  }

  #sub(door: DoorState): string {
    const here = t('questions.door.here', '{count} here', { count: door.count })
    if (door.inside) return t('questions.door.inside', "this layer's questions · {count}", { count: door.count })
    if (door.role === 'offered') return `${t('questions.door.leads', '{host} leads', { host: door.hostLabel })} · ${here}`
    if (door.role === 'host') return `${t('questions.door.you-lead', 'you lead')} · ${here}`
    return `${t('questions.door.following', 'following {host}', { host: door.hostLabel })} · ${here}`
  }

  #buttons(door: DoorState): string {
    const button = (act: string, label: string, primary = false): string =>
      `<button type="button" data-act="${act}"${primary ? ' class="qa-primary"' : ''}>${escape(label)}</button>`
    if (door.role === 'offered') {
      const lead = door.host && door.hostLabel === t('questions.door.you', 'you')
      return button('join', lead ? t('questions.door.lead', 'Lead') : t('questions.door.join', 'Join'), true)
    }
    const out: string[] = []
    out.push(door.inside ? button('back', t('questions.door.back', 'Back')) : button('open', t('questions.door.questions', 'Questions'), true))
    out.push(button('ask', t('questions.door.ask', 'Ask'), door.inside))
    if (door.role === 'host') out.push(button('tally', t('questions.door.tally', 'Tally')))
    else out.push(button('leave', t('questions.door.leave', 'Leave')))
    return out.join('')
  }

  async #act(act: string, door: DoorState): Promise<void> {
    const service = this.#service()
    if (!service) return
    if (act === 'join') {
      const hive = hiveOfGame(door.name) ?? ''
      const result = await service.startGame(hive)
      say(result.outcome === 'joined'
        ? t('questions.joined', 'you joined {game} — you follow {host} through the hive', { game: door.name, host: door.hostLabel })
        : t('questions.started', '{game} started at /{where}', { game: door.name, where: result.where || '/' }))
    } else if (act === 'open') {
      await service.openQuestions()
    } else if (act === 'back') {
      service.back()
    } else if (act === 'leave') {
      await service.leaveGame()
      say(t('questions.left', 'you left {game}', { game: door.name }))
    } else if (act === 'tally') {
      const result = await service.tally()
      say(result
        ? t('questions.tally.done', 'tallied {questions} questions, {answers} answers — {leader} leads with {takes} takes', { questions: result.questions, answers: result.answers, leader: result.leader, takes: result.takes })
        : t('questions.tally.none', 'no questions on this page to tally'))
    } else if (act === 'ask') {
      this.#asking = !this.#asking
      this.#last = ''
      this.#render()
    }
  }

  async #ask(form: HTMLFormElement): Promise<void> {
    const input = form.querySelector('input') as HTMLInputElement | null
    const text = String(input?.value ?? '').trim()
    if (!text) return
    const outcome = await this.#service()?.ask(text)
    if (outcome === 'asked') {
      say(t('questions.asked', 'asked "{question}" — the room can answer it now', { question: text }))
      this.#asking = false
      this.#last = ''
      this.#render()
    } else if (outcome === 'exists') say(t('questions.ask.exists', '"{question}" is already asked here', { question: text }))
    else if (outcome === 'failed') say(t('questions.ask.failed', '"{question}" could not be made a tile here', { question: text }))
  }
}
