// assistant/chat.view.ts
//
// THE CHAT, FRAMEWORK-FREE — step one of phasing the Angular chat window out
// (jwize, 2026-11-11). A page with no Angular (the shim's host, the debugger
// build) mounts this element and has a chat: a conversation kept in the same
// threads the Angular window keeps, asked of the same router, answered as it
// streams.
//
// IT CAN CHANGE THE HIVE (step two): a model is taught the behaviours the
// participant granted, a block it writes waits in the execution queue, and the
// queue's waiting blocks are listed here with Run and Skip (chat-work.ts).
//
// WHAT IT IS NOT YET. It cannot read the hive, and sends no anatomy or hive
// context; it cannot write code, doctrine or files. Those live in the shell
// today and move here part by part.
//
// Where the Angular window is registered it is the chat, and this element
// stays closed (chat-surface.ts).

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { refuseWhileDark, closeWhenDark, isWordDark } from '../commands/word-enablement.js'
import { ENABLEMENT_CHANGED } from '../sharing/behavior-enablement.js'
import { CHAT_SURFACE, angularChatPresent } from './chat-surface.js'
import { appendTurn, newConvoId, readTurns, type ChatTurn } from './chat-thread.js'
import { llmRouter, streamRoutedModel, type LlmCall } from './llm-dispatch.js'
import { HOST_AI_IOC_KEY } from './host-ai.service.js'
import { executionQueue } from './execution-queue.js'
import { chatCanChange, runChatWork, type ChatWorkChunk, type ChatWorkDeps, type ChatWorkEvent, type ChatWorkQueue } from './chat-work.js'
import type { HypercombBehaviour } from '@hypercomb/core'

export const CHAT_WORD = 'chat'
const STYLE_ID = 'hc-chat-styles'

export type ChatOpenPayload = { prefill?: string; convoId?: string; model?: string }

/** What the element asks of the world — fields, so a spec (or a later host)
 *  can stand in for any of them. */
/** A block waiting for the participant, as the Run list draws it. */
export type ChatWaiting = { readonly id: string; readonly convoId: string; readonly state: string; readonly lines: readonly string[]; readonly leaves?: boolean }

export type ChatModel = {
  /** The answer, as it streams. */
  stream(call: LlmCall): AsyncIterable<ChatWorkChunk>
  /** The live census a model is taught and may say (chat-work.ts). */
  behaviours(): readonly HypercombBehaviour[]
  /** The public canonical door; absent where no behaviour can run. */
  execute?: (command: string, args: string) => Promise<void> | void
  /** Where a block waits, and how the participant's hand reaches it. */
  queue?: ChatWorkQueue & {
    requests(): readonly ChatWaiting[]
    decide(id: string, decision: 'run' | 'skip'): void
    addEventListener(type: 'change', listener: () => void): void
    removeEventListener(type: 'change', listener: () => void): void
  }
  /** Where the participant stands, as one string. */
  place(): string
  /** The host's own AI, for a participant with no provider of their own. */
  host(): { readonly configured: boolean; ask(question: string, opts?: { signal?: AbortSignal }): AsyncIterable<string> } | undefined
  /** True when somebody can answer here: a provider the router can call, or
   *  the host the participant named. False on a page with no AI set up — a
   *  debugger subdomain is its own origin, so keys set up elsewhere are not
   *  here. */
  canAnswer(): boolean
  /** Open the providers console — through its own word, whose door loads the
   *  console on its first press. */
  setUp(): void
  readTurns(convoId: string): Promise<readonly Pick<ChatTurn, 'role' | 'text'>[]>
  appendTurn(convoId: string, role: 'user' | 'assistant', text: string): Promise<boolean>
  newConvoId(): string
}

type SlashLike = {
  entries?: () => readonly HypercombBehaviour[]
  execute?: (name: string, args: string) => Promise<void> | void
  executePublicCanonical?: (name: string, args: string) => Promise<void> | void
}
const iocGet = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(key) as T | undefined
const slash = (): SlashLike | undefined => iocGet<SlashLike>('@diamondcoreprocessor.com/SlashBehaviourDrone')

const shippedModel: ChatModel = {
  stream: call => streamRoutedModel(call),
  behaviours: () => slash()?.entries?.() ?? [],
  execute: (command, args) => {
    const door = slash()
    if (!door?.executePublicCanonical) throw new Error('no behaviour can run here')
    return door.executePublicCanonical(command, args)
  },
  queue: executionQueue as unknown as ChatModel['queue'],
  place: () => (iocGet<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])
    .map(segment => String(segment ?? '')).filter(Boolean).join('/'),
  host: () => (window as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(HOST_AI_IOC_KEY) as ReturnType<ChatModel['host']>,
  setUp: () => { void slash()?.execute?.('providers', '') },
  canAnswer: () => {
    try { if (llmRouter.ready()) return true } catch { /* no provider registry yet */ }
    return !!shippedModel.host()?.configured
  },
  readTurns,
  appendTurn,
  newConvoId,
}

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t?.(key, params)
  return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
}

type Turn = { role: 'user' | 'assistant'; text: string }

/** What a question's work has produced so far: words, and what was run. */
type Part = { kind: 'said' | 'ran' | 'skipped' | 'failed' | 'refused'; text: string }

const bullets = (lines: readonly string[]): string => lines.map(line => `- ${line}`).join('\n')

/** The answer as it is kept: the words, and plainly what ran and what did
 *  not — the next question's transcript reads it. A block sent back unused
 *  is not part of the answer. */
const keptText = (parts: readonly Part[]): string =>
  parts.filter(part => part.kind !== 'refused').map(part => part.text).join('\n\n').trim()

export class ChatElement extends HTMLElement {
  /** A request made before the element was defined (the bee sets it, then
   *  defines the element): taken once, on connect. */
  static pending: ChatOpenPayload | null = null

  model: ChatModel = shippedModel

  #cleanup: Array<() => void> = []
  #launcher: HTMLButtonElement | null = null
  #panel: HTMLElement | null = null
  #list: HTMLElement | null = null
  #input: HTMLTextAreaElement | null = null
  #sendButton: HTMLButtonElement | null = null
  #convoId = ''
  #turns: Turn[] = []
  #live: { text: string; parts: Part[] } | null = null
  #note = ''
  #abort: AbortController | null = null

  get isOpen(): boolean { return this.#panel !== null }
  get conversation(): string { return this.#convoId }
  get busy(): boolean { return this.#abort !== null }

  connectedCallback(): void {
    ensureStyles()
    // The bus replays its last value to a new subscriber. A replayed open is
    // an old gesture, so nothing said before this element was listening is
    // acted on — except the one request the bee handed over, below.
    let listening = false
    const redraw = (): void => this.#render()
    // A provider set up, switched or removed changes whether anyone can answer.
    this.#cleanup.push(
      EffectBus.on('providers:state', redraw),
      EffectBus.on('llm:policy-changed', redraw),
    )
    const queue = this.model.queue
    queue?.addEventListener('change', redraw)
    this.#cleanup.push(
      () => queue?.removeEventListener('change', redraw),
      EffectBus.on<ChatOpenPayload>('chat:open', payload => { if (listening) void this.open(payload ?? {}) }),
      EffectBus.on('chat:toggle', () => { if (listening) { if (this.isOpen) this.close(); else void this.open({}) } }),
      EffectBus.on('chat:close', () => { if (listening) this.close() }),
      closeWhenDark(CHAT_WORD, () => this.close()),
    )
    listening = true
    // THE CHAT BUTTON follows whatever could change whether it belongs here:
    // the chat word's light, and the shell's surfaces arriving (an Angular
    // chat registered after this element is the chat, and this one steps back).
    const relaunch = (): void => this.#renderLauncher()
    const surfaces = (window as { ioc?: { get?: (key: string) => unknown } }).ioc
      ?.get?.('@hypercomb.social/ShellSurfaceRegistry') as EventTarget | undefined
    surfaces?.addEventListener?.('change', relaunch)
    this.#cleanup.push(
      () => surfaces?.removeEventListener?.('change', relaunch),
      EffectBus.on(ENABLEMENT_CHANGED, relaunch),
      () => { this.#launcher?.remove(); this.#launcher = null },
    )
    this.#renderLauncher()
    const pending = ChatElement.pending
    ChatElement.pending = null
    if (pending) void this.open(pending)
  }

  /** ONE PRESS TO THE CHAT, on a page that has no other door to it — the
   *  framework-free host has no command line and no rail. Shown while the
   *  chat is closed, its word is lit, and no Angular chat is the chat here. */
  #renderLauncher(): void {
    const wanted = !this.#panel && !angularChatPresent() && !isWordDark(CHAT_WORD)
    if (!wanted) { this.#launcher?.remove(); this.#launcher = null; return }
    if (this.#launcher) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'hc-chat-launch'
    button.textContent = t('chat.title', 'Chat')
    button.title = t('chat.title', 'Chat')
    button.addEventListener('click', () => { void this.open({}) })
    this.appendChild(button)
    this.#launcher = button
  }

  disconnectedCallback(): void {
    for (const off of this.#cleanup) off()
    this.#cleanup = []
    this.close()
  }

  /** Open the chat. With a prefill it is a new question: a new conversation,
   *  sent at once. With none it resumes the conversation it last held. */
  async open(payload: ChatOpenPayload = {}): Promise<void> {
    if (angularChatPresent()) return
    if (refuseWhileDark(CHAT_WORD)) return
    const prefill = String(payload.prefill ?? '').trim()
    const asked = String(payload.convoId ?? '').trim()
    const next = asked || (prefill || !this.#convoId ? this.model.newConvoId() : this.#convoId)
    if (next !== this.#convoId) {
      this.stop()
      this.#convoId = next
      this.#note = ''
      this.#turns = (await this.model.readTurns(next)).map(turn => ({ role: turn.role, text: turn.text }))
    }
    this.#mount()
    this.#renderLauncher()
    this.#render()
    if (prefill) await this.send(prefill)
    else this.#input?.focus({ preventScroll: true })
  }

  close(): void {
    this.stop()
    if (!this.#panel) return
    this.#panel.removeEventListener('keydown', this.#onKey)
    this.#panel.remove()
    this.#panel = this.#list = this.#input = this.#sendButton = null
    this.#renderLauncher()
  }

  /** Stop the answer being written. What has arrived is kept. */
  stop(): void {
    this.#abort?.abort()
  }

  /** Say something. The turn is stored before the model is asked, so a page
   *  that closes mid-answer still holds the question. */
  async send(message: string): Promise<void> {
    const text = String(message ?? '').trim()
    if (!text || this.#abort) return
    if (!this.#convoId) this.#convoId = this.model.newConvoId()
    const convoId = this.#convoId
    this.#note = ''
    this.#turns.push({ role: 'user', text })
    await this.model.appendTurn(convoId, 'user', text)
    EffectBus.emit('chat:threads-changed', { convoId })

    const abort = new AbortController()
    this.#abort = abort
    const live: { text: string; parts: Part[] } = { text: '', parts: [] }
    this.#live = live
    this.#render()
    let failure = ''
    try {
      for await (const event of this.#answer(convoId, text, abort.signal)) {
        if (event.kind === 'live') live.text = event.text
        else if (event.kind !== 'waiting') {
          live.text = ''
          if (event.kind === 'said') live.parts.push({ kind: 'said', text: event.text })
          else if (event.kind === 'ran') live.parts.push({ kind: 'ran', text: `${t('chat.lite.ran', 'Ran:')}\n${bullets(event.lines)}` })
          else if (event.kind === 'skipped') live.parts.push({ kind: 'skipped', text: `${t('chat.lite.skipped', 'Skipped, nothing changed:')}\n${bullets(event.lines)}` })
          else if (event.kind === 'failed') live.parts.push({ kind: 'failed', text: t('chat.lite.failed', 'Stopped at {line}: {reason}', { line: event.lines[0] ?? '', reason: event.reason }) })
          else live.parts.push({ kind: 'refused', text: t('chat.lite.refused', 'A block was sent back unused: {reason}', { reason: event.reason }) })
        }
        this.#render()
      }
    } catch (error) {
      if (!abort.signal.aborted) failure = error instanceof Error ? error.message : String(error)
    }
    if (this.#abort === abort) this.#abort = null
    if (this.#live === live) this.#live = null
    // Whatever arrived is the answer, stopped or not; nothing arrived is not
    // a turn, and the reason is said beside the thread, never stored in it.
    // A round cut off mid-reply keeps the words it had.
    if (live.text.trim()) live.parts.push({ kind: 'said', text: live.text.trim() })
    const kept = keptText(live.parts)
    if (kept) {
      if (this.#convoId === convoId) this.#turns.push({ role: 'assistant', text: kept })
      await this.model.appendTurn(convoId, 'assistant', kept)
      EffectBus.emit('chat:threads-changed', { convoId })
    }
    if (failure && this.#convoId === convoId) this.#note = failure
    this.#render()
  }

  /** The router first — the participant's own provider, a local model, a
   *  peer. Where it has nobody to ask and the participant named a host for
   *  AI, that host is asked the question (it holds no conversation). */
  async *#answer(convoId: string, question: string, signal: AbortSignal): AsyncGenerator<ChatWorkEvent> {
    const messages = this.#turns.map(turn => ({ role: turn.role, content: turn.text }))
    let wrote = false
    try {
      for await (const event of runChatWork({ convoId, messages, question, signal }, this.#work())) {
        wrote = true
        yield event
      }
      return
    } catch (error) {
      const host = this.model.host()
      if (wrote || signal.aborted || !host?.configured) throw error
      // The host answers in words only: it is taught nothing and runs nothing.
      let said = ''
      for await (const chunk of host.ask(question, { signal })) { said += chunk; yield { kind: 'live', text: said } }
      if (said.trim()) yield { kind: 'said', text: said.trim() }
    }
  }

  #work(): ChatWorkDeps {
    const model = this.model
    return {
      stream: call => model.stream(call),
      behaviours: () => model.behaviours(),
      ...(model.execute ? { execute: model.execute } : {}),
      ...(model.queue ? { queue: model.queue } : {}),
      place: () => model.place(),
    }
  }

  /** True when a model can change the hive from this chat, here and now. */
  get canChange(): boolean { return chatCanChange(this.#work()) }

  #mount(): void {
    if (this.#panel) return
    const panel = document.createElement('aside')
    panel.className = 'hc-chat'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', t('chat.title', 'Chat'))
    panel.setAttribute('data-consumes-wheel', '')
    panel.tabIndex = -1
    panel.addEventListener('keydown', this.#onKey)

    const head = document.createElement('header')
    head.className = 'hc-chat-head'
    const title = document.createElement('span')
    title.className = 'hc-chat-title'
    title.textContent = t('chat.title', 'Chat')
    const fresh = document.createElement('button')
    fresh.type = 'button'
    fresh.className = 'hc-chat-word hc-chat-new'
    fresh.textContent = '+'
    fresh.title = t('chat.new', 'New conversation')
    fresh.setAttribute('aria-label', fresh.title)
    fresh.addEventListener('click', () => { void this.#startNew() })
    const shut = document.createElement('button')
    shut.type = 'button'
    shut.className = 'hc-chat-word hc-chat-close'
    shut.textContent = '×'
    shut.title = t('chat.close', 'Close the chat')
    shut.setAttribute('aria-label', shut.title)
    shut.addEventListener('click', () => this.close())
    head.append(title, fresh, shut)

    const list = document.createElement('div')
    list.className = 'hc-chat-turns'
    list.setAttribute('aria-live', 'polite')

    const form = document.createElement('form')
    form.className = 'hc-chat-form'
    const input = document.createElement('textarea')
    input.className = 'hc-chat-input'
    input.rows = 2
    input.placeholder = t('chat.placeholder', 'Ask anything.')
    input.setAttribute('aria-label', input.placeholder)
    const send = document.createElement('button')
    send.type = 'submit'
    send.className = 'hc-chat-send'
    form.append(input, send)
    form.addEventListener('submit', event => {
      event.preventDefault()
      if (this.#abort) { this.stop(); return }
      const text = input.value
      if (!text.trim()) return
      input.value = ''
      void this.send(text)
    })
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
      event.preventDefault()
      form.requestSubmit()
    })

    panel.append(head, list, form)
    this.appendChild(panel)
    this.#panel = panel
    this.#list = list
    this.#input = input
    this.#sendButton = send
  }

  async #startNew(): Promise<void> {
    this.stop()
    this.#convoId = this.model.newConvoId()
    this.#turns = []
    this.#note = ''
    this.#render()
    this.#input?.focus({ preventScroll: true })
  }

  #render(): void {
    const list = this.#list
    if (!list) return
    const rows: HTMLElement[] = []
    const row = (kind: string, text: string): void => {
      const element = document.createElement('div')
      element.className = `hc-chat-turn is-${kind}`
      // Somebody's words, a model's included: text, never markup.
      element.textContent = text
      rows.push(element)
    }
    const canAnswer = this.#canAnswer()
    if (!this.#turns.length && !this.#live) {
      row('empty', canAnswer
        ? t('chat.lite.empty', 'Ask the AI you have set up. It can change your hive with the behaviours you granted it; it cannot read your hive yet.')
        : t('chat.lite.noai', 'No AI is set up on this page yet. Add a provider or a key to start.'))
    }
    for (const turn of this.#turns) row(turn.role, turn.text)
    if (this.#live) {
      for (const part of this.#live.parts) row(part.kind === 'said' ? 'assistant' : `work is-${part.kind}`, part.text)
      const waiting = this.#waiting()
      if (this.#live.text || !waiting.length) row('assistant is-live', this.#live.text || t('chat.thinking', 'Thinking…'))
      for (const request of waiting) rows.push(this.#waitingRow(request))
    }
    if (this.#note) row('note', this.#note)
    // THE WAY TO AN ANSWER, offered where it is missing: the providers
    // console is framework-free, so it opens on any page this chat opens on.
    if (!canAnswer && !this.#live) rows.push(this.#setupRow())
    list.replaceChildren(...rows)
    list.scrollTop = list.scrollHeight
    if (this.#sendButton) {
      const busy = this.#abort !== null
      this.#sendButton.textContent = busy ? t('chat.lite.stop', 'Stop') : t('chat.send', 'Send')
      this.#sendButton.classList.toggle('is-stop', busy)
    }
  }

  #canAnswer(): boolean {
    try { return this.model.canAnswer() } catch { return false }
  }

  #setupRow(): HTMLElement {
    const box = document.createElement('div')
    box.className = 'hc-chat-setup'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'hc-chat-run-act is-run hc-chat-setup-act'
    button.textContent = t('chat.lite.setup', 'Set up AI')
    button.addEventListener('click', () => { this.model.setUp() })
    box.append(button)
    return box
  }

  /** This conversation's blocks that wait for a hand. */
  #waiting(): readonly ChatWaiting[] {
    return (this.model.queue?.requests() ?? []).filter(request => request.convoId === this.#convoId && request.state === 'waiting')
  }

  /** THE RUN LIST, one block: exactly the lines that will run, and the two
   *  answers. The lines are a model's words — text, never markup. */
  #waitingRow(request: ChatWaiting): HTMLElement {
    const box = document.createElement('div')
    box.className = 'hc-chat-run'
    const label = document.createElement('div')
    label.className = 'hc-chat-run-label'
    label.textContent = request.leaves
      ? t('chat.lite.run.leaves', 'The AI wants to run this. It reaches beyond this machine:')
      : t('chat.lite.run.asks', 'The AI wants to run this:')
    const lines = document.createElement('pre')
    lines.className = 'hc-chat-run-lines'
    lines.textContent = request.lines.join('\n')
    const acts = document.createElement('div')
    acts.className = 'hc-chat-run-acts'
    const answer = (decision: 'run' | 'skip', text: string): HTMLButtonElement => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `hc-chat-run-act is-${decision}`
      button.textContent = text
      button.addEventListener('click', () => this.model.queue?.decide(request.id, decision))
      return button
    }
    acts.append(answer('run', t('chat.lite.run', 'Run')), answer('skip', t('chat.lite.skip', 'Skip')))
    box.append(label, lines, acts)
    return box
  }

  readonly #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    this.close()
  }
}

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  // The tool-window material in the shared roles (tool-window-colour-roles.md):
  // pane and ink from the theme; rem, never em.
  style.textContent = `
    ${CHAT_SURFACE} { display: contents; }
    .hc-chat {
      position: fixed;
      top: max(calc(2.3rem * var(--hc-header-zoom, 1.0)), var(--hc-header-anchor, 0px));
      right: var(--hc-controls-right, 0px); bottom: 0;
      width: min(30rem, 100vw);
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
    .hc-chat-head {
      flex: 0 0 auto; display: flex; align-items: center; gap: 0.5rem;
      height: 2.875rem; min-height: 2.875rem; padding: 0 0.75rem; box-sizing: border-box;
      border-bottom: 1px solid var(--hc-window-line, rgba(227, 237, 245, 0.14));
    }
    .hc-chat-title {
      flex: 1; min-width: 0; font-weight: 600; letter-spacing: 0.04em;
      color: var(--hc-window-ink-loud, #eef2f5);
    }
    .hc-chat-word {
      display: inline-grid; place-items: center; min-width: 1.75rem; height: 1.75rem; padding: 0 0.25rem;
      background: none; border: 0; border-radius: var(--hc-radius-control, 2px);
      color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); font: inherit; font-size: 1.05rem; cursor: pointer;
    }
    .hc-chat-word:hover { color: var(--hc-window-ink-loud, #fff); background: var(--hc-window-tint-strong, rgba(255, 255, 255, 0.075)); }
    .hc-chat-turns {
      flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0.75rem;
      display: flex; flex-direction: column; gap: 0.625rem;
    }
    .hc-chat-turn { white-space: pre-wrap; overflow-wrap: anywhere; }
    .hc-chat-turn.is-user {
      align-self: flex-end; max-width: 85%; padding: 0.4rem 0.6rem;
      background: var(--hc-window-tint-strong, rgba(255, 255, 255, 0.075));
      border-radius: var(--hc-radius-control, 2px);
      color: var(--hc-window-ink-loud, #eef2f5);
    }
    .hc-chat-turn.is-live { color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); }
    .hc-chat-turn.is-empty, .hc-chat-turn.is-note, .hc-chat-turn.is-work { color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); font-size: 0.9em; }
    .hc-chat-run {
      display: flex; flex-direction: column; gap: 0.4rem; padding: 0.5rem 0.6rem;
      border: 1px solid var(--hc-window-line-firm, rgba(227, 237, 245, 0.26));
      border-radius: var(--hc-radius-control, 2px);
      background: var(--hc-window-tint, rgba(255, 255, 255, 0.04));
    }
    .hc-chat-run-label { color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.62)); font-size: 0.9em; }
    .hc-chat-run-lines { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; color: var(--hc-window-ink-loud, #eef2f5); }
    .hc-chat-run-acts, .hc-chat-setup { display: flex; gap: 0.5rem; }
    .hc-chat-launch {
      position: fixed; right: 1rem; bottom: 1rem; z-index: 100001;
      height: 2.5rem; padding: 0 1.1rem; cursor: pointer;
      font: 600 calc(0.875rem * var(--hc-panel-scale, 1)) var(--hc-mono, system-ui); letter-spacing: 0.04em;
      background: rgba(var(--hc-panel-pane, 12, 19, 27), 0.975);
      color: var(--hc-window-ink-loud, #eef2f5);
      border: 1px solid var(--hc-window-line-firm, rgba(227, 237, 245, 0.26));
      border-radius: var(--hc-radius-control, 2px);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.36);
    }
    .hc-chat-launch:hover { background: var(--hc-window-tint-strong, rgba(255, 255, 255, 0.075)); }
    .hc-chat-run-act {
      height: 1.875rem; padding: 0 0.75rem; cursor: pointer; font: inherit;
      background: none; color: var(--hc-window-ink-plain, rgba(227, 237, 245, 0.86));
      border: 1px solid var(--hc-window-line, rgba(227, 237, 245, 0.14));
      border-radius: var(--hc-radius-control, 2px);
    }
    .hc-chat-run-act.is-run {
      background: var(--hc-window-tint-strong, rgba(255, 255, 255, 0.075));
      border-color: var(--hc-window-line-firm, rgba(227, 237, 245, 0.26));
      color: var(--hc-window-ink-loud, #eef2f5);
    }
    .hc-chat-form {
      flex: 0 0 auto; display: flex; gap: 0.5rem; align-items: flex-end; padding: 0.625rem 0.75rem;
      border-top: 1px solid var(--hc-window-line, rgba(227, 237, 245, 0.14));
    }
    .hc-chat-input {
      flex: 1; min-width: 0; resize: none; box-sizing: border-box; padding: 0.4rem 0.5rem;
      background: var(--hc-window-tint, rgba(255, 255, 255, 0.04));
      border: 1px solid var(--hc-window-line, rgba(227, 237, 245, 0.14));
      border-radius: var(--hc-radius-control, 2px);
      color: inherit; font: inherit;
    }
    .hc-chat-input:focus { outline: none; border-color: var(--hc-window-line-firm, rgba(227, 237, 245, 0.26)); }
    .hc-chat-send {
      flex: 0 0 auto; height: 2rem; padding: 0 0.75rem;
      background: var(--hc-window-tint-strong, rgba(255, 255, 255, 0.075));
      border: 1px solid var(--hc-window-line-firm, rgba(227, 237, 245, 0.26));
      border-radius: var(--hc-radius-control, 2px);
      color: var(--hc-window-ink-loud, #eef2f5); font: inherit; cursor: pointer;
    }
    .hc-chat-send:hover { background: var(--hc-window-tint, rgba(255, 255, 255, 0.04)); }
  `
  document.head.appendChild(style)
}
