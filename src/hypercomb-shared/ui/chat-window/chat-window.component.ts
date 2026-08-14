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
// Replies can arrive from a participant-configured host or the local Claude
// bridge. A configured-but-disconnected bridge can durably queue a question;
// an unreachable host cannot. The status line keeps those states distinct.
//
// Shell UI — resolves everything through `window.ioc` at call time and never
// imports essentials.

import { Component, ElementRef, computed, signal, viewChild, type OnDestroy } from '@angular/core'
import {
  EffectBus,
  PARTICIPANT_AI_HOST_STORAGE_KEY,
  isLocalClaudeBridgeConfigured,
  isParticipantAiHostConfigured,
} from '@hypercomb/core'
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
  /** One pass for the list AND the newest thread's turns — the resume path's
   *  read, so opening never re-reads the bucket the list walk just read. */
  listConversationsWithLatest?(): Promise<{ conversations: ConversationSummary[]; latestTurns: ChatTurn[] }>
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
 *  future chat sheet" as a surface that should render it. `contextSigs` is the
 *  parameter it always accepted and nothing ever passed — the tile's attached
 *  context, capped host-side. */
type HostAiLike = {
  readonly configured?: boolean
  ask?(question: string, opts?: { contextSigs?: readonly string[] }): AsyncGenerator<string, string, void>
}

/** The tile-context module (assistant/tile-context.ts), over IoC — the shell
 *  may never import essentials. `branchesFor` is the cheap synchronous count
 *  for the status chip; `signaturesFor` is the resolved union an ask carries. */
type TileContextLike = {
  branchesFor?(segments: readonly string[]): readonly string[][]
  signaturesFor?(segments: readonly string[]): Promise<readonly string[]>
}

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
const HOST_AI_IOC_KEY = '@diamondcoreprocessor.com/HostAi'
const CHAT_VISIBLE_STORAGE_KEY = 'hc:chat-visible'

/** The participant's explicit open/closed choice wins on later page loads.
 *  With no choice yet, preserve the configured local bridge's companion-view
 *  default. Storage can be unavailable in private/locked-down browsers. */
const rememberedChatVisibility = (fallback: boolean): boolean => {
  try {
    const stored = globalThis.localStorage?.getItem(CHAT_VISIBLE_STORAGE_KEY)
    if (stored === '1') return true
    if (stored === '0') return false
  } catch { /* use the first-run fallback */ }
  return fallback
}

const rememberChatVisibility = (visible: boolean): void => {
  try { globalThis.localStorage?.setItem(CHAT_VISIBLE_STORAGE_KEY, visible ? '1' : '0') }
  catch { /* visibility remains sticky for this in-memory session */ }
}

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

  /** Chat stays discoverable, but only a participant-supplied responder makes
   *  it interactive. `configured` is stable through a temporary disconnect;
   *  `bridgeUp` below is merely the live transport state. */
  readonly bridgeConfigured = signal(isLocalClaudeBridgeConfigured())
  readonly hostConfigured = signal(isParticipantAiHostConfigured())
  readonly enabled = computed(() => this.bridgeConfigured() || this.hostConfigured())

  /** The participant's last explicit open/closed choice survives a refresh.
   *  On the first visit only, a configured local bridge keeps the established
   *  companion-view default; everyone else begins with the launcher. */
  readonly visible = signal(rememberedChatVisibility(this.bridgeConfigured()))

  /** FOCUS mode: the panel widens over the hive and a dim settles behind it.
   *  The tiles stay visible — dimmed, never hidden (the fullscreen ask screen
   *  was retired for hiding them) — and the panel stops reserving canvas
   *  space while it lasts, so the grid does not reflow for a temporary mode. */
  readonly focused = signal(false)

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

  /** How many context branches are ATTACHED to this tile (the portal-drop
   *  records) — they ride with every question, and a rider the participant
   *  cannot see is a surprise, so the count is shown beside the path. */
  readonly contextCount = signal(0)

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
    return listed || this.#titleFrom(this.turns())
  })

  /** First line of the first user turn — the same naming rule the threads
   *  module applies, so the in-memory list bump and a cold re-list agree. */
  #titleFrom(turns: readonly ChatTurn[]): string {
    const lead = turns.find(t => t.role === 'user') ?? turns[0]
    const line = String(lead?.text ?? '').split('\n').map(s => s.trim()).find(Boolean) ?? ''
    return line.length > 72 ? line.slice(0, 71).trimEnd() + '…' : line
  }

  readonly path = computed(() => {
    const segments = this.here()
    return segments.length ? '/' + segments.join('/') : '/'
  })

  readonly empty = computed(() => this.turns().length === 0 && !this.streaming())

  #cleanups: (() => void)[] = []

  #onSync = (): void => { if (this.visible()) this.#refreshContext() }
  #onStorage = (event: StorageEvent): void => {
    if (event.key !== PARTICIPANT_AI_HOST_STORAGE_KEY && event.key !== null) return
    const configured = isParticipantAiHostConfigured()
    this.hostConfigured.set(configured)
    if (configured && this.visible() && !this.activeId()) void this.#resume()
  }

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
      'bridge:status', payload => {
        this.bridgeConfigured.set(isLocalClaudeBridgeConfigured())
        this.bridgeUp.set(!!payload?.connected)
      }))

    this.#cleanups.push(EffectBus.on<{ configured?: boolean }>(
      'host-ai:configuration', payload => {
        const configured = !!payload?.configured
        this.hostConfigured.set(configured)
        if (configured && this.visible() && !this.activeId()) void this.#resume()
      }))

    // Attach/detach of context lands between synchronize pulses — the chip
    // must follow the act, not the next unrelated one.
    this.#cleanups.push(EffectBus.on('context:tile-changed', () => {
      if (this.visible()) this.#refreshContext()
    }))

    // The processor's post-pulse beat — the app's canonical "something moved".
    // Cheaper and more honest than polling: the context line follows the hive.
    window.addEventListener('synchronize', this.#onSync)
    window.addEventListener('storage', this.#onStorage)

    // ── configured bridge boot-open ───────────────────────────────────────
    // A local-bridge participant keeps the existing boot-open behavior without
    // stealing command-line focus. Everyone else opens chat deliberately; an
    // unconfigured participant then sees the setup-required view.
    this.#refreshAvailability()
    EffectBus.emit('chat:window-state', { open: this.visible() })
    if (this.visible()) {
      this.#refreshContext()
      void this.#resume()
    }
    ;(globalThis as { ioc?: { whenReady?: (k: string, cb: () => void) => void } }).ioc
      ?.whenReady?.('@diamondcoreprocessor.com/ChatThreads', () => {
        if (this.enabled() && this.visible() && this.turns().length === 0 && !this.waiting()) void this.#resume()
      })
    ;(globalThis as { ioc?: { whenReady?: (k: string, cb: (value: unknown) => void) => void } }).ioc
      ?.whenReady?.(HOST_AI_IOC_KEY, value => {
        this.hostConfigured.set(!!(value as HostAiLike | undefined)?.configured)
      })
  }

  ngOnDestroy(): void {
    for (const cleanup of this.#cleanups) cleanup()
    window.removeEventListener('synchronize', this.#onSync)
    window.removeEventListener('storage', this.#onStorage)
  }

  // ── services ────────────────────────────────────────────────────────────

  #threads(): ChatThreadsLike | undefined {
    return ioc()?.get('@diamondcoreprocessor.com/ChatThreads') as ChatThreadsLike | undefined
  }

  #queen(): QueenLike | undefined {
    return ioc()?.get('@diamondcoreprocessor.com/LlmQueenBee') as QueenLike | undefined
  }

  #refreshAvailability(): void {
    this.bridgeConfigured.set(isLocalClaudeBridgeConfigured())
    const host = ioc()?.get(HOST_AI_IOC_KEY) as HostAiLike | undefined
    this.hostConfigured.set(host ? !!host.configured : isParticipantAiHostConfigured())
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
    this.#refreshAvailability()
    const prefill = String(payload?.prefill ?? '').trim()
    this.visible.set(true)
    rememberChatVisibility(true)
    // Announce symmetrically with close() — the controls-bar launcher light
    // (and anything else watching) reads this state.
    EffectBus.emit('chat:window-state', { open: true })
    if (!this.enabled()) return
    this.#refreshContext()
    this.bridgeUp.set(!!(ioc()?.get('@diamondcoreprocessor.com/ClaudeBridgeWorker') as BridgeLike | undefined)?.connected)

    if (payload?.convoId) { await this.#refreshList(); await this.#load(payload.convoId) }
    else if (prefill) { await this.#refreshList(); this.newChat() }
    else await this.#resume()

    // After the conversation is settled, so it is not overwritten by the
    // remembered model of the thread we just loaded.
    if (payload?.model) this.setModel(payload.model)

    if (prefill) { await this.send(prefill); return }
    this.#focus()
  }

  /** Land on the most recent conversation without taking focus — the boot
   *  path, the re-run once the threads service registers, and open()'s
   *  no-payload branch. One pass: the list walk already read the newest
   *  thread's turns, so resuming adopts them instead of re-reading the bucket. */
  async #resume(): Promise<void> {
    const threads = this.#threads()
    if (!threads) return
    if (threads.listConversationsWithLatest) {
      const { conversations, latestTurns } = await threads.listConversationsWithLatest()
      this.conversations.set(conversations)
      // ANY current conversation is kept — including a just-minted empty New
      // chat, which is a thing the participant explicitly created and must
      // survive a close/reopen. (Guarding on turns.length here silently threw
      // that new chat away and landed back in the previous thread.)
      if (this.activeId()) return
      const recent = conversations[0]
      if (recent) {
        this.activeId.set(recent.convoId)
        this.model.set(this.#rememberedModel(recent.convoId))
        this.streaming.set('')
        this.turns.set(latestTurns)
        this.waiting.set(false)
        this.#scrollDown()
      } else if (!this.activeId()) {
        this.newChat(false)
      }
      return
    }
    // Older module build without the one-pass read — the two-read path.
    await this.#refreshList()
    if (this.activeId()) return
    const recent = this.conversations()[0]
    if (recent) await this.#load(recent.convoId)
    else this.newChat(false)
  }

  close(): void {
    if (!this.visible()) return
    this.visible.set(false)
    rememberChatVisibility(false)
    this.focused.set(false)
    this.listOpen.set(false)
    this.armed.set('')
    EffectBus.emit('chat:window-state', { open: false })
  }

  toggleFocus(): void {
    this.focused.update(on => !on)
    if (this.focused()) this.#focus()
  }

  onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    // Focus mode peels back before the window goes — two Escapes to fully
    // dismiss a focused chat, matching the escape-cascade's outermost-first rule.
    if (this.focused()) { this.focused.set(false); return }
    this.close()
  }

  // ── conversations ───────────────────────────────────────────────────────

  async #refreshList(): Promise<void> {
    const threads = this.#threads()
    if (!threads) return
    this.conversations.set(await threads.listConversations())
  }

  /** Move a conversation to the top of the IN-MEMORY list after a turn lands —
   *  the pool is already the truth (the turn was stored before this), so a
   *  full re-list per send/reply paid a walk over every thread to learn what
   *  this window just did itself. Returns false when the conversation is not
   *  in the list and cannot be derived here (a reply to a thread this session
   *  has never listed) — the caller falls back to the real walk.
   *
   *  `added` is how many turns landed since the last bump, used only when the
   *  conversation is NOT the active one (then the in-memory turns can't be
   *  counted). The host tier stores TWO turns per send (question + streamed
   *  answer) in one bump — a mid-stream switch to another thread must not
   *  leave that row undercounting the pool it mirrors. */
  #bumpList(convoId: string, added = 1): boolean {
    const turnsHere = convoId === this.activeId() ? this.turns() : null
    const list = this.conversations()
    const index = list.findIndex(c => c.convoId === convoId)
    if (index < 0 && !turnsHere) return false
    const prev = index >= 0 ? list[index] : null
    const summary: ConversationSummary = {
      convoId,
      title: prev?.title || this.#titleFrom(turnsHere ?? []),
      turnCount: turnsHere ? turnsHere.length : (prev?.turnCount ?? 0) + added,
      lastAt: turnsHere?.[turnsHere.length - 1]?.at ?? Date.now(),
    }
    const rest = index >= 0 ? [...list.slice(0, index), ...list.slice(index + 1)] : [...list]
    this.conversations.set([summary, ...rest].sort((a, b) => b.lastAt - a.lastAt))
    return true
  }

  async #load(convoId: string): Promise<void> {
    const threads = this.#threads()
    if (!threads || !convoId) return
    this.activeId.set(convoId)
    this.model.set(this.#rememberedModel(convoId))
    this.streaming.set('')
    const turns = await threads.readTurns(convoId)
    // A slow read landing after the participant moved on must not paint one
    // thread's turns under another thread's name — checked BEFORE the paint
    // (it used to sit after the set, guarding only the scroll).
    if (this.activeId() !== convoId) return
    this.turns.set(turns)
    this.waiting.set(false)
    this.#scrollDown()
  }

  /** Start a fresh thread. It does not appear in the list until it holds a
   *  turn — an empty conversation is not yet a conversation. `focus` is false
   *  only on the boot path: the default view opens beside the command line and
   *  must not steal its cursor. */
  newChat(focus = true): void {
    const threads = this.#threads()
    this.activeId.set(threads?.newConvoId() ?? '')
    this.turns.set([])
    this.streaming.set('')
    this.waiting.set(false)
    this.listOpen.set(false)
    this.armed.set('')
    if (focus) this.#focus()
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

    // Attached context — the cheap unresolved read (decoration index verbatim).
    try {
      const tileContext = ioc()?.get('@diamondcoreprocessor.com/TileContext') as TileContextLike | undefined
      this.contextCount.set(tileContext?.branchesFor?.(segments)?.length ?? 0)
    } catch { this.contextCount.set(0) }
  }

  /** The tile's attached context, resolved to content sigs for the SHALLOW
   *  tier (the host caps them server-side). Best-effort: context is a grade
   *  of service, never a reason a question fails to leave. */
  async #contextSigs(): Promise<readonly string[]> {
    try {
      const tileContext = ioc()?.get('@diamondcoreprocessor.com/TileContext') as TileContextLike | undefined
      return await tileContext?.signaturesFor?.(this.here()) ?? []
    } catch { return [] }
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
    this.#refreshAvailability()
    if (!this.enabled()) return
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
    // If the host tier is unreachable and a local bridge is configured, the
    // question is QUEUED there: its durable record can be picked up when a
    // session connects. Without that bridge, host failure is reported now.
    if (!this.bridgeUp() && await this.#askHost(convoId, message)) {
      // TWO turns landed (the question and the streamed answer) — the count
      // matters only if the participant switched threads mid-stream.
      if (!this.#bumpList(convoId, 2)) void this.#refreshList()
      return
    }

    // A participant-host failure is retryable, but without a configured local
    // bridge there is nobody who could ever drain the durable bridge queue.
    if (!this.bridgeConfigured()) {
      this.waiting.set(false)
      EffectBus.emit('toast:show', {
        type: 'warning',
        message: 'Your AI host is unavailable. Check its setup and try again.',
      })
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
    if (!this.#bumpList(convoId)) void this.#refreshList()
  }

  /**
   * The shallow tier: stream an answer from the host's AI.
   *
   * Returns false when the host cannot answer. The caller queues only when a
   * local bridge is configured; otherwise it reports the retryable host failure.
   *
   * The text is accumulated whatever the participant does next: they may switch
   * conversations mid-stream, and the answer still belongs to the thread that
   * asked. Only the PAINTING is conditional on still being in that thread.
   */
  async #askHost(convoId: string, message: string): Promise<boolean> {
    const host = ioc()?.get(HOST_AI_IOC_KEY) as HostAiLike | undefined
    // The bundled address is not a shared/free allowance. Only a host the
    // participant explicitly configured may be used as the shallow fallback.
    if (!host?.configured || !host.ask) return false

    // The attached-context sigs the host inlines server-side from its own
    // heap — the parameter host-ai always accepted and nothing ever passed.
    const contextSigs = await this.#contextSigs()

    let full = ''
    try {
      for await (const chunk of host.ask(message, contextSigs.length ? { contextSigs } : undefined)) {
        full += chunk
        if (this.activeId() !== convoId) continue
        this.streaming.set(full)
        this.#scrollDown()
      }
    } catch {
      // No signer, no AI on that host, or no network. The caller either hands
      // the question to a configured bridge or reports the host failure.
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
    // list that shows it moved to the top — a bump when the thread is listed,
    // the real walk only when it is not.
    if (convoId !== this.activeId()) {
      if (!this.#bumpList(convoId)) void this.#refreshList()
      return
    }

    this.turns.update(list => [...list, {
      kind: 'chat-turn', convoId, role: 'assistant', text, at: Date.now(),
    }])
    this.waiting.set(false)
    this.#scrollDown()
    if (!this.#bumpList(convoId)) void this.#refreshList()
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
