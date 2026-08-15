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
// And a wait is REPORTED, not implied. The row that used to say "Thinking…"
// forever now carries a clock, says "nothing is listening yet" when that is
// the truth (no session on the bridge to drain the durable queue), and offers
// a way out — because a question you cannot call back is a question you are
// stuck with. Stop means two different acts, one per tier: a live host stream
// is ABORTED (`host-ai.service.ts` always accepted an AbortSignal and nothing
// ever passed one), a queued bridge ask is WITHDRAWN from the optimization
// pool. A partial host answer survives the abort — the host really said it.
//
// ── An answer is read, and then acted on ────────────────────────────────────
//
// Turns render as markdown (chat-markdown.ts): headings, lists, tables, fenced
// code with a language label and a copy button, autolinked URLs, and hive-path
// chips that navigate — an answer naming `dolphin/site` takes you there. The
// rendered HTML is trusted past Angular's sanitizer, so the renderer's
// escape-first discipline is load-bearing; read its header before touching it.
//
// Every message carries copy, retry, and either "put this on the tile" (an
// answer) or "edit and send again" (a question). Nothing rewrites the thread:
// editing sends a NEW turn, because a thread is append-only like everything
// else in the hive.
//
// The transcript follows the newest turn only while you are AT the newest
// turn. Scroll up to read something and arrivals stop moving the view under
// you; a pill offers the way back. (It used to pin `scrollTop` on every chunk,
// which made a streaming answer impossible to read from the top.)
//
// Shell UI — resolves everything through `window.ioc` at call time and never
// imports essentials.

import { Component, ElementRef, computed, effect, inject, signal, viewChild, type OnDestroy } from '@angular/core'
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser'
import {
  CLAUDE_BRIDGE_ENABLED_STORAGE_KEY,
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
import { highlightBlocks } from './chat-highlight'
import { hivePathSegments, renderChatMarkdown } from './chat-markdown'

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
  /** The queued ask's record SIGNATURE — what withdrawing it needs. Older
   *  essentials builds (hypercomb-web loads its bees from OPFS, so the module
   *  can lag the shell) return a bare boolean; then the ask is still queued,
   *  it simply cannot be taken back from here. */
  submitChat(
    convoId: string,
    message: string,
    targets: string[],
    transcript: ReadonlyArray<{ role: string; text: string }>,
  ): Promise<string | boolean | null>
}

type LineageLike = { explorerSegments?(): readonly string[] }
type SelectionLike = { selected: ReadonlySet<string> }
type BridgeLike = { connected?: boolean }
type NavigationLike = { goRaw?(segments: readonly string[]): void }

/** The optimization pool, over the shared Store — the durable inbox a queued
 *  ask lives in until a Claude session drains it. Withdrawing is removing it. */
type StoreLike = {
  removeOptimization?(signature: string): Promise<boolean>
  putOptimization?(blob: Blob): Promise<string>
}

/** The notes module (notes/notes.drone.ts), over IoC. `addAtSegments` takes an
 *  EXPLICIT path — the `note:commit` effect writes to a child of wherever the
 *  participant is standing, which is not necessarily the tile they meant. */
type NotesLike = {
  addAtSegments?(
    parentSegments: readonly string[],
    cellLabel: string,
    text: string,
    shape?: unknown,
    mark?: string | null,
  ): Promise<void>
}

/** The host's AI — the SHALLOW immediate tier (assistant/host-ai.service.ts):
 *  a streamed answer from the operator's domain, no bridge involved. It is
 *  what `/ask` used before it folded in here, and its own header names "a
 *  future chat sheet" as a surface that should render it. `contextSigs` is the
 *  parameter it always accepted and nothing ever passed — the tile's attached
 *  context, capped host-side. */
type HostAiLike = {
  readonly configured?: boolean
  ask?(
    question: string,
    opts?: { contextSigs?: readonly string[]; signal?: AbortSignal },
  ): AsyncGenerator<string, string, void>
  /** Set (or clear with '') the participant's AI host — the guided setup's
   *  host door calls this instead of telling people to type a command. */
  setHost?(domain: string): void
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

/** How close to the bottom still counts as reading the newest turn. Below it,
 *  the transcript stops chasing arrivals and offers the pill instead. One line
 *  of slack, so a stray wheel notch does not unpin the view. */
const NEAR_BOTTOM_PX = 56

/** The waiting row's clock. One second is the resolution people read; anything
 *  finer is a flicker and anything coarser feels stopped. */
const ELAPSED_TICK_MS = 1_000

/** Rendered turns are memoized by their text — a thread of 200 turns must not
 *  re-parse every one of them each time a chunk lands. Bounded, because a long
 *  session's cache is otherwise a slow leak of everything ever said. */
const RENDER_CACHE_MAX = 240

// ── guided setup ─────────────────────────────────────────────────────────
//
// The setup state is a CHECKLIST, not a notice. Each step verifies itself
// where reality can be asked: enabling flips the config gate, the broker
// step completes on the worker's own `bridge:status`, and the last step
// completes only when a real answer lands — the checklist is done exactly
// when the loop is proven. Only the tools step takes the participant's word.
/** Set once the whole checklist has been completed (or skipped). */
const SETUP_DONE_KEY = 'hc:bridge-setup-done'
/** The one manual step — "I have Claude Code and the repo". */
const SETUP_TOOLS_KEY = 'hc:bridge-setup-tools'
/** A bridge answer has landed at least once — the loop is proven. */
const FIRST_REPLY_KEY = 'hc:bridge-first-reply'
/** A configured-but-down bridge re-dials on this cadence, so "start the
 *  broker" checks itself off with zero clicks. The worker's connect() is
 *  idempotent and silent, so the retry costs one refused socket at most. */
const BRIDGE_RETRY_MS = 4_000

const readFlag = (key: string): boolean => {
  try { return globalThis.localStorage?.getItem(key) === '1' } catch { return false }
}
const writeFlag = (key: string): void => {
  try { globalThis.localStorage?.setItem(key, '1') } catch { /* session-local */ }
}

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
  // TWO SHEETS, in source order. Angular's `anyComponentStyle` budget is
  // measured per compiled stylesheet and one output is emitted per `styleUrls`
  // entry — so splitting is the only thing that lowers the number a `@use`'d
  // partial cannot. The markdown sheet is last because it styles the message
  // bodies the first sheet lays out.
  styleUrls: ['./chat-window.component.scss', './chat-markdown.scss'],
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

  /** When the outstanding question left, and how long ago that was. A wait
   *  with no clock on it is indistinguishable from a wait that has died. */
  readonly askedAt = signal(0)
  readonly elapsed = signal(0)

  /** The host tier is mid-stream: interrupting it means aborting a live fetch.
   *  A bridge ask, by contrast, is a durable record — see `pendingSig`. */
  readonly hostStreaming = signal(false)

  /** The QUEUED bridge ask's record signature. Withdrawing an ask is removing
   *  that record from the optimization pool, so this is the whole handle on a
   *  question that has left but not been picked up. */
  readonly pendingSig = signal('')

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

  /** The transcript is following the newest turn. False once the participant
   *  has scrolled up to read something — then arrivals stop moving the view
   *  under them and the scroll-to-bottom pill appears instead. */
  readonly atBottom = signal(true)

  /** Which message's Copy just fired — a transient tick on that one row. */
  readonly copiedTurn = signal('')

  readonly models = MODELS

  // ── guided setup state ──────────────────────────────────────────────────

  /** Checklist flags. `toolsDone` is the one manual step; the rest derive
   *  live (config gate, socket state) or from the proven first reply. */
  readonly setupDone = signal(readFlag(SETUP_DONE_KEY))
  readonly toolsDone = signal(readFlag(SETUP_TOOLS_KEY))
  readonly firstReply = signal(readFlag(FIRST_REPLY_KEY))

  /** Which command's Copy button just fired — a transient "Copied" flash. */
  readonly copied = signal('')

  /** The step-4 starter question is out; completes when its answer lands. */
  readonly tried = signal(false)

  /** The local bridge only exists on loopback — elsewhere the step explains
   *  instead of offering a button that could never work. */
  readonly loopback = ((): boolean => {
    try {
      const host = String(globalThis.location?.hostname ?? '').toLowerCase()
      return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
    } catch { return false }
  })()

  /** The commands the checklist hands out — copy targets, never typed. */
  readonly commands = {
    install: 'npm install -g @anthropic-ai/claude-code',
    clone: 'git clone https://github.com/hypercomb/social.git',
    build: 'cd social/src && npm install && npm run build:packages',
    broker: 'npm run bridge',
    claude: 'claude',
    listen: 'listen for hive asks',
  } as const

  /** The wizard shows until the checklist completes (or is skipped). A
   *  configured host needs no checklist; a veteran with existing threads is
   *  grandfathered in `#resume`. */
  readonly showSetup = computed(() =>
    !this.enabled() || (this.bridgeConfigured() && !this.hostConfigured() && !this.setupDone()))

  /** The one current step — everything before it is checked, everything
   *  after it waits. 5 = complete. */
  readonly setupStep = computed(() => {
    if (!this.toolsDone()) return 1
    if (!this.bridgeConfigured()) return 2
    if (!this.bridgeUp()) return 3
    if (!this.firstReply()) return 4
    return 5
  })

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

  // ── markdown ────────────────────────────────────────────────────────────
  //
  // Answers arrive as markdown, so they are read as markdown. The rendering is
  // a pure function (chat-markdown.ts) whose entire safety story is escape-
  // first — nothing unescaped from a model ever reaches the string — which is
  // what makes bypassing Angular's sanitizer sound here. The bypass is needed
  // at all because the sanitizer strips the `data-` attributes the hive-path
  // chips and code-copy buttons are addressed by.

  readonly #sanitizer = inject(DomSanitizer)

  /** text → rendered HTML. Bounded; keyed by content, so an identical turn
   *  reaching two threads is parsed once. */
  readonly #rendered = new Map<string, SafeHtml>()

  #markdown(text: string): SafeHtml {
    const hit = this.#rendered.get(text)
    if (hit) return hit
    const html = this.#sanitizer.bypassSecurityTrustHtml(renderChatMarkdown(text))
    if (this.#rendered.size >= RENDER_CACHE_MAX) {
      // Oldest first — Map preserves insertion order, and the oldest turn in a
      // long thread is the one furthest from the screen.
      const oldest = this.#rendered.keys().next().value
      if (oldest !== undefined) this.#rendered.delete(oldest)
    }
    this.#rendered.set(text, html)
    return html
  }

  /** The thread, rendered. Recomputed when a turn lands; the cache above makes
   *  that a lookup per existing turn rather than a re-parse. */
  readonly rendered = computed(() =>
    this.turns().map((turn, index) => ({
      turn,
      key: `${turn.at}:${index}`,
      html: this.#markdown(turn.text),
    })))

  /** The half-arrived answer. Its own computed and deliberately NOT cached —
   *  every chunk is a new string, and caching them would be a leak with a
   *  hit rate of zero. */
  readonly streamHtml = computed(() =>
    this.#sanitizer.bypassSecurityTrustHtml(renderChatMarkdown(this.streaming())))

  // ── waiting honesty ─────────────────────────────────────────────────────

  /** Something can be called back: a live stream can be aborted, a queued ask
   *  can be taken out of the pool. */
  readonly canStop = computed(() => this.waiting() && (this.hostStreaming() || !!this.pendingSig()))

  /** NOBODY IS LISTENING. The question is a durable record in the optimization
   *  pool and no Claude session is connected to drain it — so it is not slow,
   *  it is unattended, and saying "Thinking…" would be a lie. */
  readonly unattended = computed(() =>
    this.waiting() && !this.hostStreaming() && !this.bridgeUp() && this.bridgeConfigured())

  /** m:ss once past a minute — a bare "127s" makes people do arithmetic. */
  readonly elapsedLabel = computed(() => {
    const seconds = this.elapsed()
    if (seconds < 60) return `${seconds}s`
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
  })

  #cleanups: (() => void)[] = []
  #elapsedTimer: ReturnType<typeof setInterval> | null = null

  /** The live fetch behind a host-tier answer, so Stop has something to pull. */
  #abort: AbortController | null = null

  #onSync = (): void => { if (this.visible()) this.#refreshContext() }
  #onStorage = (event: StorageEvent): void => {
    if (event.key !== PARTICIPANT_AI_HOST_STORAGE_KEY && event.key !== null) return
    const configured = isParticipantAiHostConfigured()
    this.hostConfigured.set(configured)
    if (configured && this.visible() && !this.activeId()) void this.#resume()
  }

  constructor() {
    // Code blocks are highlighted AFTER the turn is in the DOM — highlight.js
    // works on live elements, and the loader is lazy, so the first fenced block
    // in a session pays for the library and none of the later ones do.
    effect(() => {
      this.rendered()
      this.streaming()
      setTimeout(() => void highlightBlocks(this.scroller()?.nativeElement), 0)
    })

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

    // A configured-but-down bridge re-dials quietly, so the checklist's
    // broker step (and an ordinary dropped connection) recovers hands-free.
    // The worker never retries a first attempt on its own — this is the nudge.
    this.#retryTimer = setInterval(() => {
      if (this.visible() && this.bridgeConfigured() && !this.bridgeUp()) {
        EffectBus.emit('claude-bridge:connect', {})
      }
    }, BRIDGE_RETRY_MS)

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
    if (this.#retryTimer) clearInterval(this.#retryTimer)
    this.#stopClock()
    this.#abort?.abort()
  }

  #retryTimer: ReturnType<typeof setInterval> | null = null

  // ── the wait, told honestly ─────────────────────────────────────────────

  /** Begin waiting: the clock starts, and every state that describes a
   *  previous wait is cleared so nothing from it can be read as current. */
  #startWait(): void {
    this.waiting.set(true)
    this.askedAt.set(Date.now())
    this.elapsed.set(0)
    this.pendingSig.set('')
    this.#stopClock()
    this.#elapsedTimer = setInterval(() => {
      if (!this.waiting()) { this.#stopClock(); return }
      this.elapsed.set(Math.max(0, Math.round((Date.now() - this.askedAt()) / 1000)))
    }, ELAPSED_TICK_MS)
  }

  /** Stop waiting, whatever ended it — an answer, a failure, a withdrawal. */
  #endWait(): void {
    this.waiting.set(false)
    this.hostStreaming.set(false)
    this.pendingSig.set('')
    this.#stopClock()
  }

  #stopClock(): void {
    if (!this.#elapsedTimer) return
    clearInterval(this.#elapsedTimer)
    this.#elapsedTimer = null
  }

  /**
   * Call the question back.
   *
   * The two tiers fail differently and so they are stopped differently. A host
   * answer is a live HTTP stream: aborting it is all there is, and whatever had
   * already arrived is kept, because the host really did say it. A bridge ask
   * is a durable RECORD sitting in the optimization pool — stopping it means
   * taking that record out, so no session can ever pick it up, plus the same
   * `mode:'stop'` marker AgentRegistry leaves for a responder already mid-flight.
   */
  async stop(): Promise<void> {
    if (this.hostStreaming()) {
      this.#abort?.abort()
      // #askHost's abort branch stores the partial and ends the wait.
      return
    }
    await this.withdraw()
  }

  /** Retire a queued ask. Idempotent, and safe when the record is already
   *  gone — a responder that drained it a moment ago simply answers anyway. */
  async withdraw(): Promise<void> {
    const sig = this.pendingSig()
    this.#endWait()
    if (!sig) return

    const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
    if (!store?.removeOptimization) return
    try {
      await store.removeOptimization(sig)
      // The courtesy marker: a responder that already has this ask in hand
      // learns it was withdrawn. Same shape AgentRegistry.#retireAsk writes.
      if (store.putOptimization) {
        const marker = {
          kind: 'ask',
          appliesTo: [...this.targets()],
          payload: { mode: 'stop', askSig: sig, status: 'stopped', askedAt: Date.now() },
          mark: 'persistent',
        }
        await store.putOptimization(new Blob([JSON.stringify(marker)], { type: 'application/json' }))
      }
    } catch { /* the ask is out of the pool or was never in it — either way, done */ }
  }

  // ── guided setup actions ────────────────────────────────────────────────

  /** Step 1 — the only step that takes the participant's word. */
  markTools(): void {
    this.toolsDone.set(true)
    writeFlag(SETUP_TOOLS_KEY)
  }

  /** Step 2 — opt this tab in and dial the broker now. The worker's
   *  connect() re-reads the gate, so no reload is needed. */
  enableBridge(): void {
    try { localStorage.setItem(CLAUDE_BRIDGE_ENABLED_STORAGE_KEY, '1') } catch { /* private mode */ }
    this.bridgeConfigured.set(isLocalClaudeBridgeConfigured())
    EffectBus.emit('claude-bridge:connect', {})
  }

  /** Step 4 — prove the loop with a real question. Completes when the
   *  answer lands (`#onReply` sets the first-reply flag). */
  tryAsk(): void {
    const i18n = ioc()?.get('@hypercomb.social/I18n') as { t?: (key: string) => string } | undefined
    const starter = i18n?.t?.('chat.setup.starter') || 'What do you see in this hive?'
    this.tried.set(true)
    void this.send(starter)
  }

  /** Copy a checklist command; the button flashes "Copied" briefly. */
  copyCmd(id: string, text: string): void {
    void navigator.clipboard?.writeText(text).then(() => {
      this.copied.set(id)
      setTimeout(() => { if (this.copied() === id) this.copied.set('') }, 1_400)
    }).catch(() => { /* clipboard unavailable — the text is still visible */ })
  }

  /** Complete (or skip) the checklist and land in the chat. */
  finishSetup(): void {
    this.setupDone.set(true)
    writeFlag(SETUP_DONE_KEY)
    this.#focus()
  }

  /** The host door — configure a participant-controlled AI host directly.
   *  `setHost` announces `host-ai:configuration`, which this window already
   *  follows into `hostConfigured` and a resume. */
  connectHost(domain: string): void {
    const bare = String(domain ?? '').trim()
    if (!bare) return
    const host = ioc()?.get(HOST_AI_IOC_KEY) as HostAiLike | undefined
    if (!host?.setHost) {
      EffectBus.emit('toast:show', { type: 'warning', message: 'Host service unavailable — try again in a moment.' })
      return
    }
    host.setHost(bare)
  }

  /** A participant with existing conversations predates the checklist —
   *  never greet them with a wizard for a loop they already run. */
  #grandfather(): void {
    if (!this.setupDone() && this.conversations().length > 0) {
      this.setupDone.set(true)
      writeFlag(SETUP_DONE_KEY)
    }
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
      this.#grandfather()
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
        this.#endWait()
        this.#scrollDown(true)
      } else if (!this.activeId()) {
        this.newChat(false)
      }
      return
    }
    // Older module build without the one-pass read — the two-read path.
    await this.#refreshList()
    this.#grandfather()
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
    this.#endWait()
    // Switching threads re-pins: you are arriving at a conversation, and its
    // newest turn is where arriving means.
    this.#scrollDown(true)
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
    this.#endWait()
    this.listOpen.set(false)
    this.armed.set('')
    this.atBottom.set(true)
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
    this.#startWait()
    // Sending is the one arrival the participant caused, so it re-pins the
    // transcript even if they had scrolled up to read something.
    this.#scrollDown(true)

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
    if (!this.bridgeUp()) {
      const outcome = await this.#askHost(convoId, message)
      if (outcome === 'answered') {
        // TWO turns landed (the question and the streamed answer) — the count
        // matters only if the participant switched threads mid-stream.
        if (!this.#bumpList(convoId, 2)) void this.#refreshList()
        return
      }
      // STOPPED BY THE PARTICIPANT. Handing a question they just called back
      // to the durable bridge queue would be the opposite of what Stop means.
      if (outcome === 'aborted') {
        if (!this.#bumpList(convoId, 2)) void this.#refreshList()
        return
      }
    }

    // A participant-host failure is retryable, but without a configured local
    // bridge there is nobody who could ever drain the durable bridge queue.
    if (!this.bridgeConfigured()) {
      this.#endWait()
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
    const queued = await queen.submitChat(convoId, message, [...this.targets()], transcript)
    if (!queued) {
      this.#endWait()
      EffectBus.emit('toast:show', { type: 'warning', message: 'Could not send — try again.' })
    } else if (typeof queued === 'string') {
      // The ask's record signature: the handle Withdraw pulls on. An older
      // essentials build answers `true` instead, and then the question is
      // queued but not recallable from here.
      this.pendingSig.set(queued)
    }
    if (!this.#bumpList(convoId)) void this.#refreshList()
  }

  /**
   * The shallow tier: stream an answer from the host's AI.
   *
   * Three outcomes, because two are not enough to route the caller correctly:
   *
   *   'answered'  the host said something and it is stored
   *   'declined'  the host cannot answer — fall through to the bridge queue
   *   'aborted'   the PARTICIPANT stopped it — never re-queue a recalled ask
   *
   * `host-ai.service.ts` has always accepted an AbortSignal and nothing ever
   * passed one; this is that wire. A partial answer is KEPT on abort: the host
   * really did say those words, and throwing them away punishes the person for
   * stopping a stream they had already read half of.
   *
   * The text is accumulated whatever the participant does next: they may switch
   * conversations mid-stream, and the answer still belongs to the thread that
   * asked. Only the PAINTING is conditional on still being in that thread.
   */
  async #askHost(convoId: string, message: string): Promise<'answered' | 'declined' | 'aborted'> {
    const host = ioc()?.get(HOST_AI_IOC_KEY) as HostAiLike | undefined
    // The bundled address is not a shared/free allowance. Only a host the
    // participant explicitly configured may be used as the shallow fallback.
    if (!host?.configured || !host.ask) return 'declined'

    // The attached-context sigs the host inlines server-side from its own
    // heap — the parameter host-ai always accepted and nothing ever passed.
    const contextSigs = await this.#contextSigs()

    const controller = new AbortController()
    this.#abort = controller
    this.hostStreaming.set(true)

    let full = ''
    let aborted = false
    try {
      const options = { signal: controller.signal, ...(contextSigs.length ? { contextSigs } : {}) }
      for await (const chunk of host.ask(message, options)) {
        full += chunk
        if (this.activeId() !== convoId) continue
        this.streaming.set(full)
        this.#scrollDown()
      }
    } catch {
      // No signer, no AI on that host, no network — or the participant pressed
      // Stop, which arrives here as the fetch's own abort.
      aborted = controller.signal.aborted
      if (!aborted) {
        this.streaming.set('')
        this.hostStreaming.set(false)
        this.#abort = null
        return 'declined'
      }
    } finally {
      if (this.#abort === controller) this.#abort = null
    }

    this.streaming.set('')
    this.hostStreaming.set(false)

    if (!full.trim()) {
      if (aborted) this.#endWait()
      return aborted ? 'aborted' : 'declined'
    }

    await this.#threads()?.appendTurn(convoId, 'assistant', full)
    if (this.activeId() === convoId) {
      this.turns.update(list => [...list, {
        kind: 'chat-turn', convoId, role: 'assistant', text: full, at: Date.now(),
      }])
      this.#endWait()
      this.#scrollDown()
    }
    return aborted ? 'aborted' : 'answered'
  }

  #onReply(payload?: { convoId?: string; text?: string }): void {
    const convoId = String(payload?.convoId ?? '')
    const text = String(payload?.text ?? '')
    if (!convoId || !text) return

    // The loop is PROVEN — an answer came back over the bridge. This is the
    // checklist's final verification, whichever thread it landed in.
    if (!this.firstReply()) {
      this.firstReply.set(true)
      writeFlag(FIRST_REPLY_KEY)
    }

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
    this.#endWait()
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

  // ── scroll anchoring ────────────────────────────────────────────────────
  //
  // The transcript used to pin `scrollTop` to the bottom on every chunk, which
  // meant a streaming answer could not be read from the top and scrolling up to
  // check what you asked was physically impossible — the next chunk snatched
  // the view back. So: follow the bottom only while the participant is AT the
  // bottom, and when they are not, say so with a pill instead of overruling them.

  onScroll(): void {
    const element = this.scroller()?.nativeElement
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    this.atBottom.set(distance <= NEAR_BOTTOM_PX)
  }

  /** After the turn is in the DOM, not before. `force` is for arrivals the
   *  participant caused — their own message, a thread they just opened. */
  #scrollDown(force = false): void {
    if (!force && !this.atBottom()) return
    setTimeout(() => {
      const element = this.scroller()?.nativeElement
      if (!element) return
      element.scrollTop = element.scrollHeight
      this.atBottom.set(true)
    }, 0)
  }

  /** The pill. Back to the newest turn, and following again from here. */
  scrollToBottom(): void {
    this.#scrollDown(true)
  }

  // ── per-message actions ─────────────────────────────────────────────────
  //
  // An answer you cannot act on is a screenshot. Copy takes it out of the hive,
  // note puts it IN — and retry and edit exist because the first phrasing of a
  // question is usually not the good one.
  //
  // Nothing here rewrites history: a thread is append-only (the same rule the
  // rest of the hive keeps), so editing a question sends a NEW turn rather than
  // silently replacing the one above it and orphaning the answer it produced.

  /** The question that produced this turn: itself, if it is the question. */
  #questionFor(turn: ChatTurn): string {
    if (turn.role === 'user') return turn.text
    const list = this.turns()
    const index = list.indexOf(turn)
    for (let i = (index < 0 ? list.length : index) - 1; i >= 0; i--) {
      if (list[i].role === 'user') return list[i].text
    }
    return ''
  }

  copyTurn(turn: ChatTurn, key: string): void {
    void navigator.clipboard?.writeText(turn.text).then(() => {
      this.copiedTurn.set(key)
      setTimeout(() => { if (this.copiedTurn() === key) this.copiedTurn.set('') }, 1_400)
    }).catch(() => {
      EffectBus.emit('toast:show', { type: 'warning', message: 'Could not reach the clipboard.' })
    })
  }

  /** Ask it again, unchanged. The answer lands as a new turn. */
  retryTurn(turn: ChatTurn): void {
    const question = this.#questionFor(turn)
    if (question) void this.send(question)
  }

  /** Put it back in the composer to be rewritten. Explicitly NOT a truncation
   *  of the thread — send it and it appends, like anything else you type. */
  editTurn(turn: ChatTurn): void {
    const element = this.input()?.nativeElement
    if (!element) return
    element.value = turn.text
    this.autosize(element)
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }

  /**
   * Put this answer on the tile it is about, as a note.
   *
   * The tile is the ONE selected tile if there is exactly one, else the page
   * the participant is standing in. `NotesService.addAtSegments` takes an
   * explicit path for exactly this reason — the `note:commit` effect writes to
   * a child of the current location, which is a different tile than the one the
   * status line above the composer has been naming all along.
   */
  async noteTurn(turn: ChatTurn): Promise<void> {
    const here = [...this.here()]
    const selected = this.targets()
    const [parents, label] = selected.length === 1
      ? [here, selected[0]]
      : [here.slice(0, -1), here[here.length - 1] ?? '']

    if (!label) {
      EffectBus.emit('toast:show', {
        type: 'warning',
        message: 'Stand on a tile (or select one) to put this answer on it.',
      })
      return
    }

    const notes = ioc()?.get('@diamondcoreprocessor.com/NotesService') as NotesLike | undefined
    if (!notes?.addAtSegments) {
      EffectBus.emit('toast:show', { type: 'warning', message: 'Notes are not available yet.' })
      return
    }

    try {
      await notes.addAtSegments(parents, label, turn.text, null, null)
      EffectBus.emit('toast:show', { type: 'tip', message: `Noted on ${label}.` })
    } catch {
      EffectBus.emit('toast:show', { type: 'warning', message: `Could not write the note on ${label}.` })
    }
  }

  // ── links inside an answer ──────────────────────────────────────────────

  /**
   * One delegated click for the whole transcript.
   *
   * Rendered markdown is not a template, so its interactive parts cannot carry
   * Angular bindings; they carry `data-` attributes and this reads them. The
   * anchor branch is the important one: an `<a href>` left to itself navigates
   * the shell document, which on the native client means the window is gone and
   * on the web means every drone unloads (see document-view-links.ts).
   */
  onThreadClick(event: MouseEvent): void {
    const target = event.target as Element | null
    if (!target?.closest) return

    const chip = target.closest('[data-hive-path]')
    if (chip) {
      event.preventDefault()
      this.goPath(chip.getAttribute('data-hive-path') ?? '')
      return
    }

    const copy = target.closest('[data-copy-code]')
    if (copy) {
      event.preventDefault()
      const code = copy.closest('.chat-code')?.querySelector('code')?.textContent ?? ''
      void navigator.clipboard?.writeText(code).then(() => {
        copy.textContent = 'copied'
        setTimeout(() => { copy.textContent = 'copy' }, 1_400)
      }).catch(() => { /* the code is still on screen and selectable */ })
      return
    }

    const anchor = target.closest('a')
    if (!anchor) return
    // Prevented first and unconditionally — whatever we decide below, the
    // shell's own document must not act on this click.
    event.preventDefault()
    event.stopPropagation()
    this.#openExternal(anchor.getAttribute('href') ?? '')
  }

  /** Go where the answer said. Raw segments: an answer names a place with the
   *  characters it is spelled with, not a normalized guess at them. */
  goPath(path: string): void {
    const segments = hivePathSegments(path)
    if (!segments.length) return
    const navigation = ioc()?.get('@hypercomb.social/Navigation') as NavigationLike | undefined
    navigation?.goRaw?.(segments)
  }

  /** Outside the hive: the OS browser on native, a new tab on the web. Never
   *  this document, on either. */
  #openExternal(href: string): void {
    if (!/^(https?:|mailto:)/i.test(href)) return
    const invoke = (globalThis as { __TAURI__?: { core?: { invoke?: (cmd: string, args: unknown) => unknown } } })
      .__TAURI__?.core?.invoke
    if (typeof invoke === 'function') {
      void Promise.resolve(invoke('open_external', { url: href }))
        .catch(err => console.warn('[chat] host could not open', href, err))
      return
    }
    window.open(href, '_blank', 'noopener,noreferrer')
  }

}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-chat-window',
  owner: '@hypercomb.shared/ChatWindowComponent',
  component: ChatWindowComponent,
  order: 113,
})
