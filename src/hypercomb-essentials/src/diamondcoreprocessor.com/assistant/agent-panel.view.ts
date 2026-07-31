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
import { avatarKeyOf, type AgentAvatarRegistry } from '../presentation/avatars/agent-avatar.js'

const STYLE_ID = 'hc-agent-panel-styles'
const STEEL = '126, 182, 214'
const WIDTH_KEY = 'hc:agent-panel-width'
const FULLSCREEN_KEY = 'hc:agent-panel-fullscreen'
const MIN_WIDTH = 320

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

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
  #registry: AgentRegistry | undefined
  #expandedActivity = new Set<string>()
  #fullscreen = false
  #resizeCleanup: (() => void) | null = null

  #onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.#panel) { event.stopPropagation(); this.close() }
  }

  constructor() {
    super()
    EffectBus.on<{ id?: string }>('agent:open', payload => {
      const id = String(payload?.id ?? '')
      if (id) this.open(id)
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
    row.append(input, send)
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
    body.append(
      this.#statusRow(agent),
      this.#whereRow(agent),
      this.#section(this.#t('agent.request', 'The request'), agent.request || '—'),
      this.#activity(agent),
    )
    if (agent.context.length) {
      body.appendChild(this.#section(
        this.#t('agent.context-added', 'Context you added'),
        agent.context.join('\n\n'),
      ))
    }
  }

  #statusRow(agent: Agent): HTMLElement {
    const row = document.createElement('div')
    row.className = 'hc-agent-status'
    const pill = document.createElement('span')
    pill.className = `hc-agent-pill ${agent.status}`
    pill.textContent = this.#t(`agent.status.${agent.status}`, agent.status)
    row.appendChild(pill)
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

  #whereRow(agent: Agent): HTMLElement {
    const where = agent.scope === 'hive'
      ? this.#t('agent.where-hive', 'the whole hive')
      : agent.targets.length
        ? agent.targets.join(', ')
        : '/' + agent.segments.join('/')
    return this.#section(this.#t('agent.where', 'Working on'), where)
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

  close(): void {
    this.#registry?.removeEventListener('change', this.#render)
    document.removeEventListener('keydown', this.#onKey, true)
    this.#resizeCleanup?.()
    this.#resizeCleanup = null
    this.#panel?.remove()
    this.#panel = null
    this.#body = null
    this.#input = null
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
.hc-agent-close,.hc-agent-window{width:2rem;height:2rem;border:none;background:none;color:rgba(245,245,245,0.4);
  font-size:1.3rem;line-height:1;cursor:pointer;border-radius:6px;}
.hc-agent-window{font-size:1rem;}
.hc-agent-close:hover,.hc-agent-window:hover{color:whitesmoke;background:rgba(255,255,255,0.07);}
.hc-agent-body{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:0.6rem;}
.hc-agent-status{display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;}
.hc-agent-pill{padding:0.12rem 0.5rem;border-radius:999px;font-size:0.68rem;letter-spacing:0.08em;
  text-transform:uppercase;border:1px solid rgba(${STEEL},0.4);color:rgba(${STEEL},0.9);}
.hc-agent-pill.working{border-color:rgba(${STEEL},0.9);background:rgba(${STEEL},0.16);}
.hc-agent-pill.done{border-color:rgba(126,196,142,0.7);color:rgba(150,214,164,0.95);}
.hc-agent-pill.failed{border-color:rgba(226,75,74,0.7);color:rgba(232,124,123,0.95);}
.hc-agent-dim{font-size:0.72rem;color:rgba(216,230,238,0.5);}
.hc-agent-label{font-size:0.68rem;letter-spacing:0.06em;text-transform:uppercase;
  color:rgba(${STEEL},0.6);margin-bottom:0.2rem;}
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
`
    document.head.appendChild(style)
  }
}

const _agentPanel = new AgentPanelView()
window.ioc.register('@diamondcoreprocessor.com/AgentPanelView', _agentPanel)
