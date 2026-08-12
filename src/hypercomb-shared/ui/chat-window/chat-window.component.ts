// hypercomb-shared/ui/chat-window/chat-window.component.ts
//
// THE CHAT WINDOW — talk to Claude about the hive. One tool window, one
// conversation per chat, and nothing else to learn.
//
// ── What this replaced, and why ─────────────────────────────────────────────
//
// The ask screen (assistant/ask-screen.view.ts, retired) was a fullscreen
// REQUEST-REFINEMENT HARNESS: a draft box at the top labelled "this is what
// gets sent as the note", a grid of tile chips, a chat box at the bottom for
// "talking it through", and a Send-as-note button that wrote the draft — not
// the conversation — onto the chosen tiles. Talking to Claude was not the
// point; producing a note for a LATER routine to read was.
//
// That model is defensible and nobody could hold it. Two text boxes where the
// one you type in is not the one that ships; one button with three different
// destinations depending on invisible state (chipped tiles / this page / the
// feedback window); and `close()` threw away the draft, the chips and the whole
// transcript, so every visit started from nothing.
//
// So: a chat window is a chat window. You type, Claude answers, the answer is
// in the window. Writing a note is something Claude DOES — "put that on the
// Genome tile" is a sentence, not a button — and it shows up in the hive.
//
// ── One conversation per chat ───────────────────────────────────────────────
//
// Every chat is its own thread with its own id, and threads are DURABLE: they
// live in the `sign('threads')` pool (assistant/chat-thread.ts), which already
// stored every reply long before anything read them back. Closing the window
// costs nothing; reopening resumes where you were; a second device sees the
// same threads.
//
// The list is recovered from the pool rather than from an index — a bucket is
// named `sha256(convoId)`, but every turn inside carries its own convoId, so
// the threads describe themselves. An index would be a second copy of a fact
// the turns already hold, free to drift the first time a write half-lands.
//
// ── Context is shown, not operated ──────────────────────────────────────────
//
// The chip grid is gone. Where you are standing and what you have selected ARE
// the context, reported in one line above the input. That is the same
// information the chips carried, minus the obligation to maintain it.
//
// ── Silence is a state, and it is named ─────────────────────────────────────
//
// Every reply arrives over the Claude bridge. With no session listening, a
// question is not slow — it is queued until one connects. The status line says
// which, because a thinking indicator that never resolves is the single most
// confusing thing this window could do.
//
// Shell UI — resolves everything through `window.ioc` at call time and never
// imports essentials.

import { Component, ElementRef, computed, signal, viewChild, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { registerShellSurface } from '../../core/shell-surface-registry'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'

type TurnRole = 'user' | 'assistant'

type ChatTurn = {
  readonly kind: 'chat-turn'
  readonly convoId: string
  readonly role: TurnRole
  readonly text: string
  readonly at: number
}

type ConversationSummary = {
  readonly convoId: string
  readonly title: string
  readonly turnCount: number
  readonly lastAt: number
}

/** The threads module, reached through IoC — shell may never import essentials. */
type ChatThreadsLike = {
  appendTurn(convoId: string, role: TurnRole, text: string): Promise<boolean>
  readTurns(convoId: string): Promise<ChatTurn[]>
  listConversations(): Promise<ConversationSummary[]>
  deleteConversation(convoId: string): Promise<boolean>
  newConvoId(): string
}

type QueenLike = {
  activeModel: string
  submitChat(
    convoId: string,
    message: string,
    targets: string[],
    transcript: ReadonlyArray<{ role: string; text: string }>,
  ): Promise<boolean>
}

type LineageLike = { explorerSegments?(): readonly string[] }
type SelectionLike = { selected: ReadonlySet<string> }
type BridgeLike = { connected?: boolean }

/** The host's AI — the SHALLOW immediate tier (assistant/host-ai.service.ts):
 *  a streamed answer from the operator's domain, no bridge involved. It is
 *  what `/ask` used before it folded in here, and its own header names "a
 *  future chat sheet" as a surface that should render it. */
type HostAiLike = { ask?(question: string): AsyncGenerator<string, string, void> }

/** Model hints the bridge understands. The responder maps the name to a real
 *  model id (scripts/bridge/drain-tick.cjs); a parked session answers as
 *  whatever it already is. Keep aligned with that map. */
const MODELS = ['opus', 'sonnet', 'haiku', 'fable'] as const

/** The command line's bracket syntax passes the SHORT op — `[tile]/o ask me`
 *  sets the model to `o` (command-line.component.ts, the opus/sonnet/haiku
 *  branch). Unmapped, that is silently not a model and the request quietly
 *  lands on whatever tier the conversation was already in. */
const MODEL_ALIASES: Record<string, string> = { o: 'opus', s: 'sonnet', h: 'haiku', f: 'fable' }

/** Which model each conversation was last held in, participant-local. Per
 *  CONVERSATION, not global: a thread is about one thing, and the tier you
 *  chose for it is part of what you set up. */
const MODEL_KEY = 'hc:chat-models'
const DEFAULT_MODEL = 'opus'

/** Turns carried to a stateless responder. The stored thread can be any
 *  length; this is the window into it the ask record can afford. */
const TRANSCRIPT_TURNS = 12

const ioc = (): { get(k: string): unknown } | undefined =>
  (globalThis as { ioc?: { get(k: string): unknown } }).ioc

@Component({
  selector: 'hc-chat-window',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './chat-window.component.html',
  styleUrls: ['./chat-window.component.scss'],
})
export class ChatWindowComponent implements OnDestroy {

  readonly visible = signal(false)

  /** Parked while the hive is covered and brought back intact — the thread is
   *  durable, but the scroll position and the half-typed message are not. */
  readonly session = signalSession(this.visible, open =>
    EffectBus.emit('chat:window-state', { open }))

  readonly conversations = signal<readonly ConversationSummary[]>([])
  readonly activeId = signal('')
  readonly turns = signal<readonly ChatTurn[]>([])

  /** The conversation list, open. Collapsed by default: the thread you are in
   *  is the thing you came for, and the others are one click away. */
  readonly listOpen = signal(false)

  /** A question is out and its answer has not come back. Per window, not
   *  global — asking in one conversation must not make another look busy. */
  readonly waiting = signal(false)

  readonly bridgeUp = signal(false)
  readonly model = signal<string>(DEFAULT_MODEL)

  /** An answer arriving a chunk at a time from the host tier. Held apart from
   *  `turns` because it is not a turn yet — it becomes one, once, when the
   *  stream closes and the text is on disk. */
  readonly streaming = signal('')

  /** Where the participant is standing, and what they have selected. This IS
   *  the context the question carries — reported, never operated. */
  readonly here = signal<readonly string[]>([])
  readonly targets = signal<readonly string[]>([])

  /** Deleting a thread destroys turns that cannot be dragged back, so the
   *  button ARMS on the first press and deletes on the second. A confirm
   *  dialog for a row action is too much furniture; doing it silently on one
   *  press is too little. */
  readonly armed = signal('')

  readonly models = MODELS

  readonly input = viewChild<ElementRef<HTMLTextAreaElement>>('input')
  readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller')

  /** The active thread's name — its first message. Read from the list when it
   *  is there, else from the turns in hand, so a brand-new conversation is
   *  named the moment you send rather than after the next list refresh. */
  readonly activeTitle = computed(() => {
    const id = this.activeId()
    const listed = this.conversations().find(c => c.convoId === id)?.title
    if (listed) return listed
    const lead = this.turns().find(t => t.role === 'user') ?? this.turns()[0]
    const line = String(lead?.text ?? '').split('\n').map(s => s.trim()).find(Boolean) ?? ''
    return line.length > 72 ? line.slice(0, 71).trimEnd() + '…' : line
  })

  readonly path = computed(() => {
    const segments = this.here()
    return segments.length ? '/' + segments.join('/') : '/'
  })

  readonly empty = computed(() => this.turns().length === 0 && !this.streaming())

  #cleanups: (() => void)[] = []

  #onSync = (): void => { if (this.visible()) this.#refreshContext() }

  constructor() {
    this.#cleanups.push(EffectBus.on<{ model?: string; prefill?: string; convoId?: string }>(
      'chat:open', payload => { void this.open(payload) }))

    this.#cleanups.push(EffectBus.on('chat:toggle', () => {
      if (this.visible()) this.close()
      else void this.open()
    }))

    this.#cleanups.push(EffectBus.on('chat:close', () => { if (this.visible()) this.close() }))

    // The retired ask screen's channel. Kept because other surfaces open a
    // conversation through it — the skills window's "use" action and the
    // context window's "ask about this tile" — and their meaning is unchanged:
    // start a chat, here, about this.
    this.#cleanups.push(EffectBus.on<{ model?: string; prefill?: string }>(
      'ask:open', payload => { void this.open(payload) }))

    // A reply landed. It is already ON DISK by the time this fires
    // (chat-thread.deliverTurn writes, then announces) — the text rides along
    // only so an open window can paint without a re-read.
    this.#cleanups.push(EffectBus.on<{ convoId: string; text: string }>(
      'ask:chat-reply', payload => this.#onReply(payload)))

    this.#cleanups.push(EffectBus.on<{ connected?: boolean }>(
      'bridge:status', payload => this.bridgeUp.set(!!payload?.connected)))

    // The processor's post-pulse beat — the app's canonical "something moved".
    // Cheaper and more honest than polling: the context line follows the hive.
    window.addEventListener('synchronize', this.#onSync)
  }

  ngOnDestroy(): void {
    for (const cleanup of this.#cleanups) cleanup()
    window.removeEventListener('synchronize', this.#onSync)
  }

  // ── services ────────────────────────────────────────────────────────────

  #threads(): ChatThreadsLike | undefined {
    return ioc()?.get('@diamondcoreprocessor.com/ChatThreads') as ChatThreadsLike | undefined
  }

  #queen(): QueenLike | undefined {
    return ioc()?.get('@diamondcoreprocessor.com/LlmQueenBee') as QueenLike | undefined
  }

  // ── opening and closing ─────────────────────────────────────────────────

  /**
   * Show the window.
   *
   * With a PREFILL this is a new question, so it starts a NEW conversation and
   * sends immediately — `/opus what links these tiles?` should answer, not fill
   * a box you then have to press Enter on, and it must not graft an unrelated
   * question onto whatever thread happened to be last.
   *
   * With no prefill it RESUMES the most recent conversation, which is what
   * reopening a chat window should do.
   */
  async open(payload?: { model?: string; prefill?: string; convoId?: string }): Promise<void> {
    const prefill = String(payload?.prefill ?? '').trim()
    this.visible.set(true)
    this.#refreshContext()
    this.bridgeUp.set(!!(ioc()?.get('@diamondcoreprocessor.com/ClaudeBridgeWorker') as BridgeLike | undefined)?.connected)
    await this.#refreshList()

    if (payload?.convoId) await this.#load(payload.convoId)
    else if (prefill) this.newChat()
    else if (!this.activeId()) {
      const recent = this.conversations()[0]
      if (recent) await this.#load(recent.convoId)
      else this.newChat()
    }

    // After the conversation is settled, so it is not overwritten by the
    // remembered model of the thread we just loaded.
    if (payload?.model) this.setModel(payload.model)

    if (prefill) { await this.send(prefill); return }
    this.#focus()
  }

  close(): void {
    if (!this.visible()) return
    this.visible.set(false)
    this.listOpen.set(false)
    this.armed.set('')
    EffectBus.emit('chat:window-state', { open: false })
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.close() }
  }

  // ── conversations ───────────────────────────────────────────────────────

  async #refreshList(): Promise<void> {
    const threads = this.#threads()
    if (!threads) return
    this.conversations.set(await threads.listConversations())
  }

  async #load(convoId: string): Promise<void> {
    const threads = this.#threads()
    if (!threads || !convoId) return
    this.activeId.set(convoId)
    this.model.set(this.#rememberedModel(convoId))
    this.streaming.set('')
    this.turns.set(await threads.readTurns(convoId))
    // A slow read landing after the participant moved on must not paint one
    // thread's turns under another thread's name.
    if (this.activeId() !== convoId) return
    this.waiting.set(false)
    this.#scrollDown()
  }

  /** Start a fresh thread. It does not appear in the list until it holds a
   *  turn — an empty conversation is not yet a conversation. */
  newChat(): void {
    const threads = this.#threads()
    this.activeId.set(threads?.newConvoId() ?? '')
    this.turns.set([])
    this.streaming.set('')
    this.waiting.set(false)
    this.listOpen.set(false)
    this.armed.set('')
    this.#focus()
  }

  async pick(convoId: string): Promise<void> {
    this.listOpen.set(false)
    this.armed.set('')
    await this.#load(convoId)
    this.#focus()
  }

  /** First press arms, second deletes. */
  async remove(convoId: string, event: MouseEvent): Promise<void> {
    event.stopPropagation()
    if (this.armed() !== convoId) { this.armed.set(convoId); return }
    this.armed.set('')
    const threads = this.#threads()
    if (!threads) return
    await threads.deleteConversation(convoId)
    await this.#refreshList()
    if (this.activeId() === convoId) {
      const next = this.conversations()[0]
      if (next) await this.#load(next.convoId)
      else this.newChat()
    }
  }

  toggleList(): void {
    this.armed.set('')
    this.listOpen.update(open => !open)
  }

  // ── model ───────────────────────────────────────────────────────────────

  #modelMap(): Record<string, string> {
    try { return JSON.parse(localStorage.getItem(MODEL_KEY) ?? '{}') as Record<string, string> }
    catch { return {} }
  }

  #rememberedModel(convoId: string): string {
    const remembered = this.#modelMap()[convoId]
    return MODELS.includes(remembered as typeof MODELS[number]) ? remembered : DEFAULT_MODEL
  }

  setModel(requested: string): void {
    const next = MODEL_ALIASES[requested] ?? requested
    if (!MODELS.includes(next as typeof MODELS[number])) return
    this.model.set(next)
    const id = this.activeId()
    if (!id) return
    try {
      const map = this.#modelMap()
      map[id] = next
      localStorage.setItem(MODEL_KEY, JSON.stringify(map))
    } catch { /* participant-local convenience — never worth failing a send */ }
  }

  onModelChange(event: Event): void {
    this.setModel((event.target as HTMLSelectElement).value)
  }

  // ── context ─────────────────────────────────────────────────────────────

  /** Where we are and what is selected. Read live from the hive, never stored
   *  on the conversation: a thread outlives the page it was started on. */
  #refreshContext(): void {
    const lineage = ioc()?.get('@hypercomb.social/Lineage') as LineageLike | undefined
    const segments = (lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    this.here.set(segments)

    const selection = ioc()?.get('@diamondcoreprocessor.com/SelectionService') as SelectionLike | undefined
    this.targets.set([...(selection?.selected ?? [])])
  }

  // ── sending ─────────────────────────────────────────────────────────────

  /**
   * Send a message on the active conversation.
   *
   * The user's turn is written to the thread BEFORE the ask goes out. It used
   * not to be — only replies were stored — so a reload showed answers with no
   * questions above them. The reply's own durability was never the half that
   * was missing.
   */
  async send(text?: string): Promise<void> {
    const element = this.input()?.nativeElement
    const message = String(text ?? element?.value ?? '').trim()
    if (!message) return

    const threads = this.#threads()
    const queen = this.#queen()
    if (!threads || !queen?.submitChat) {
      EffectBus.emit('toast:show', {
        type: 'warning',
        message: 'Chat service unavailable — try again in a moment.',
      })
      return
    }

    let convoId = this.activeId()
    if (!convoId) { convoId = threads.newConvoId(); this.activeId.set(convoId) }

    if (element && text === undefined) { element.value = ''; this.autosize(element) }

    const turn: ChatTurn = { kind: 'chat-turn', convoId, role: 'user', text: message, at: Date.now() }
    this.turns.update(list => [...list, turn])
    this.waiting.set(true)
    this.#scrollDown()

    const stored = await threads.appendTurn(convoId, 'user', message)
    if (!stored) console.warn('[chat] the question was not stored — it will be missing after a reload')

    // TWO TIERS, one window.
    //
    // With a session on the bridge, the question goes to it: that is the deep
    // tier, and the only one that can read the hive. With nothing listening,
    // the host's AI answers immediately instead — that is what `/ask` did
    // before it folded in here, and folding it in must not cost it.
    //
    // If the host tier is unreachable too (no signer, no AI configured, no
    // network) the question is still QUEUED on the bridge channel: the record
    // is durable, so a session that connects later picks it up. That is why
    // the status line says "queued" and not "thinking".
    if (!this.bridgeUp() && await this.#askHost(convoId, message)) {
      await this.#refreshList()
      return
    }

    const transcript = this.turns()
      .slice(-TRANSCRIPT_TURNS)
      .map(t => ({ role: t.role, text: t.text }))

    queen.activeModel = this.model()
    const ok = await queen.submitChat(convoId, message, [...this.targets()], transcript)
    if (!ok) {
      this.waiting.set(false)
      EffectBus.emit('toast:show', { type: 'warning', message: 'Could not send — try again.' })
    }
    await this.#refreshList()
  }

  /**
   * The shallow tier: stream an answer from the host's AI.
   *
   * Returns false when the host cannot answer, so the caller falls through to
   * queueing on the bridge — an unreachable host must never swallow a question.
   *
   * The text is accumulated whatever the participant does next: they may switch
   * conversations mid-stream, and the answer still belongs to the thread that
   * asked. Only the PAINTING is conditional on still being in that thread.
   */
  async #askHost(convoId: string, message: string): Promise<boolean> {
    const host = ioc()?.get('@diamondcoreprocessor.com/HostAi') as HostAiLike | undefined
    if (!host?.ask) return false

    let full = ''
    try {
      for await (const chunk of host.ask(message)) {
        full += chunk
        if (this.activeId() !== convoId) continue
        this.streaming.set(full)
        this.#scrollDown()
      }
    } catch {
      // No signer, no AI on that host, or no network. Not an error the
      // participant needs shown — the bridge queue is about to take it.
      this.streaming.set('')
      return false
    }

    this.streaming.set('')
    if (!full.trim()) return false

    await this.#threads()?.appendTurn(convoId, 'assistant', full)
    if (this.activeId() === convoId) {
      this.turns.update(list => [...list, {
        kind: 'chat-turn', convoId, role: 'assistant', text: full, at: Date.now(),
      }])
      this.waiting.set(false)
      this.#scrollDown()
    }
    return true
  }

  #onReply(payload?: { convoId?: string; text?: string }): void {
    const convoId = String(payload?.convoId ?? '')
    const text = String(payload?.text ?? '')
    if (!convoId || !text) return

    // A reply for another thread: it is on disk, so all that is owed here is a
    // list that shows it moved to the top.
    if (convoId !== this.activeId()) { void this.#refreshList(); return }

    this.turns.update(list => [...list, {
      kind: 'chat-turn', convoId, role: 'assistant', text, at: Date.now(),
    }])
    this.waiting.set(false)
    this.#scrollDown()
    void this.#refreshList()
  }

  // ── input ───────────────────────────────────────────────────────────────

  /**
   * Enter sends, Shift+Enter opens a line.
   *
   * Propagation is stopped on EVERY key, not just the ones handled here: the
   * hive binds bare letters as shortcuts, so a message typed into an input that
   * let its keys through would drive the canvas as it was written.
   */
  onInputKey(event: KeyboardEvent): void {
    event.stopPropagation()
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void this.send()
      return
    }
    if (event.key === 'Escape') { event.preventDefault(); this.close() }
  }

  /** Grow with the message, to a ceiling — past that the box scrolls, so the
   *  transcript never loses the screen to a long draft. */
  autosize(element: HTMLTextAreaElement): void {
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`
  }

  onInput(event: Event): void {
    this.autosize(event.target as HTMLTextAreaElement)
  }

  #focus(): void {
    setTimeout(() => this.input()?.nativeElement?.focus(), 0)
  }

  /** After the turn is in the DOM, not before. */
  #scrollDown(): void {
    setTimeout(() => {
      const element = this.scroller()?.nativeElement
      if (element) element.scrollTop = element.scrollHeight
    }, 0)
  }

  // ── template helpers ────────────────────────────────────────────────────

  trackTurn = (index: number, turn: ChatTurn): string => `${turn.at}:${index}`
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-chat-window',
  owner: '@hypercomb.shared/ChatWindowComponent',
  component: ChatWindowComponent,
  order: 113,
})
