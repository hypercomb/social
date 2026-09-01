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
// ── ONE SHAPE: full screen ──────────────────────────────────────────────────
//
// There used to be two shapes — a right-docked strip and a focus mode that
// widened over the hive — and a button to swap between them. Two shapes meant
// two layouts to keep honest, a rail that existed in one of them and not the
// other, and an Escape cascade with a rung whose only job was to undo a
// choice nobody wanted to make. The docked strip lost anyway: a conversation
// about the hive needs the tiles rail beside it, and the rail needs the width.
//
// So the window is full screen, always. What the docked strip was for — seeing
// the hive while you talk about it — the rail does better, because it names
// the tiles the request will actually carry. `hcDockedPanel` stays on the
// element for the window group's text ladder and settings gear, not for
// geometry; the SCSS overrides its width and lane offset outright.
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
import { NgTemplateOutlet } from '@angular/common'
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
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { signalSession } from '../window-session'
import { highlightBlocks } from './chat-highlight'
import { resolveEntryImageUrl } from '../clipboard-thumbs'
import { hivePathSegments, renderChatMarkdown } from './chat-markdown'
import { liveHostConvos, liveHostRun, startHostRun, stopHostRun, type HostAsk } from './host-stream'

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
  /** PUT AWAY — kept whole, taken out of the list. Optional because an older
   *  essentials build has no archive at all, and there every thread is live. */
  readonly archived?: boolean
  readonly goal?: { readonly details: string; readonly at: number }
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
  /** Put a conversation away, or bring it back. Absent on an older essentials
   *  build — the control is hidden rather than dead when it is (see
   *  `canArchive`). */
  setConversationArchived?(convoId: string, archived: boolean): Promise<boolean>
  newConvoId(): string
  /** A tile's conversation id, derived from its path — every tile has one,
   *  dormant until something lands in it. Absent on an older essentials
   *  build, and then the sidebar simply opens free-floating chats. */
  tileConvoId?(segments: readonly string[]): string
  tilePath?(segments: readonly string[]): string
  tilePathOf?(convoId: string): string
  /** Unsent thinking, stored the moment it is typed and activating nothing. */
  readTileDraft?(path: string): Promise<string>
  saveTileDraft?(path: string, text: string): Promise<boolean>
  /** Read-marker for the list's unread mark. Per DEVICE, not per hive. */
  markConversationSeen?(convoId: string, at?: number): void
  /** Every held draft, so the roster can list what has no turns yet. */
  listTileDrafts?(): Promise<ReadonlyArray<{ path: string; text: string }>>
  /** IN-FLIGHT ANSWERS, written down while they arrive. A streamed answer is
   *  only a turn once its last chunk lands, so the partial is checkpointed as
   *  it accumulates and recovered on the next boot — otherwise a reload
   *  mid-answer takes the whole thing, including the half already read.
   *  Absent on an older essentials build: then the run is still durable
   *  against everything except the page going away. */
  saveStreamCheckpoint?(convoId: string, text: string): Promise<boolean>
  listStreamCheckpoints?(): Promise<ReadonlyArray<{ convoId: string; text: string; at: number }>>
  recoverStreamCheckpoints?(live?: ReadonlySet<string>): Promise<number>
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
    /** The references this request carries. An older essentials build ignores
     *  the argument and the ask simply carries less. */
    references?: readonly { kind: string; sig: string; label: string }[],
  ): Promise<string | boolean | null>
}

type LineageLike = { explorerSegments?(): readonly string[] }
type SelectionLike = { selected: ReadonlySet<string> }

/** The tiles rail — the full-screen view's left sidebar for choosing tiles.
 *  It lives in essentials (assistant/agent-tiles-rail.ts) and shared must
 *  never import essentials, so it arrives structurally through the factory
 *  it registers in IoC. */
type RailPickLike = {
  readonly key: string
  readonly path: readonly string[]
  readonly name: string
  readonly sig?: string
  readonly convoId?: string
  /** What the signature points at: one layer, a whole context group, or —
   *  when it is a media type — a picture attached to the question. */
  readonly kind?: string
  /** Bytes, for an attached picture. Absent for a tile: a tile's weight is
   *  not a fact about the reference. */
  readonly size?: number
}

/** A tile dragged out of the sidebar. The CONTRACT with essentials is this
 *  mime type and this shape — the shell may never import the module that
 *  sends it, so the wire is a string, not a type. */
export const TILE_DRAG_TYPE = 'application/x-hypercomb-tile'
export type DroppedTile = { readonly name: string; readonly path: string; readonly sig: string }
type TilesRailLike = {
  onSubjectChanged: (subject: RailPickLike | null) => void
  onSelectionChanged: (selection: RailPickLike[]) => void
  readonly subject: RailPickLike | null
  /** Start ANOTHER conversation on the tile in hand, and list it there.
   *  False when no tile is in hand. Absent on an older essentials build —
   *  then the window mints a free chat as it always did. */
  newChatOnSubject?(): boolean
  /** Tiles ctrl-clicked as context, and the signatures they resolve to. */
  readonly selection: RailPickLike[]
  readonly selectionSigs: string[]
  mount(host: HTMLElement): void
  clearSubject(): void
  clearSelection(): void
  dispose(): void
}
type TilesRailFactoryLike = { create?: () => TilesRailLike }
type BridgeLike = { connected?: boolean }
type NavigationLike = { goRaw?(segments: readonly string[]): void }

/** The optimization pool, over the shared Store — the durable inbox a queued
 *  ask lives in until a Claude session drains it. Withdrawing is removing it. */
type StoreLike = {
  removeOptimization?(signature: string): Promise<boolean>
  putOptimization?(blob: Blob): Promise<string>
  /** THE DURABLE INBOX, read back. A queued question is a record in the
   *  optimization pool; reading them is how a reloaded window learns which of
   *  its conversations are still waiting on an answer. */
  listOptimizations?(): Promise<string[]>
  getOptimization?(signature: string): Promise<Blob | null>
  /** Content in, signature out — the same address a layer or a note gets.
   *  An image dropped into a question is content like any other. */
  putResource?(blob: Blob): Promise<string>
  getResource?(sig: string): Promise<Blob | null>
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

/** WHO ANSWERS, decided by the participant's standing instructions rather
 *  than by a control in this window (assistant/model-policy.ts, over IoC —
 *  the shell may never import a module). `model` is the WIRE ID: the ask
 *  hint the bridge roster resolves, and the one string a model bee's vendor
 *  family and tier shade are read off. `tier` is the level of thinking the
 *  designation was made for, DECLARED by the provider. */
type PolicyLike = {
  designate?(need: { tier?: string; readsHive?: boolean; streaming?: boolean }):
    DesignationLike | undefined
}

type DesignationLike = {
  readonly providerId: string
  readonly label: string
  readonly vendor: string
  readonly tier: string
  readonly model: string
  readonly name: string
}

type RoutedChunkLike = {
  readonly text: string
  readonly providerId: string
  readonly providerLabel: string
  readonly vendor: string
  readonly model: string
}

type LlmRouterLike = {
  ready?(call?: { providerId?: string; model?: string; preferModel?: string; need?: { tier?: string; streaming?: boolean } }): boolean
  stream?(call: {
    providerId?: string
    model?: string
    preferModel?: string
    need?: { tier?: string; streaming?: boolean }
    messages: readonly { role: 'user' | 'assistant'; content: string }[]
    system?: string
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncGenerator<RoutedChunkLike>
}

/** The tile-context module (assistant/tile-context.ts), over IoC — the shell
 *  may never import essentials. `branchesFor` is the cheap synchronous count
 *  for the status chip; `signaturesFor` is the resolved union an ask carries. */
type TileContextLike = {
  branchesFor?(segments: readonly string[]): readonly string[][]
  signaturesFor?(segments: readonly string[]): Promise<readonly string[]>
}

/** The command line's bracket syntax passes the SHORT op — `[tile]/o ask me`
 *  sets the model to `o` (command-line.component.ts, the opus/sonnet/haiku
 *  branch). Unmapped, that is silently not a model and the request quietly
 *  lands on whatever tier the conversation was already in. */
const MODEL_ALIASES: Record<string, string> = { o: 'opus', s: 'sonnet', h: 'haiku', f: 'fable' }

/** Which model each conversation was last held in, participant-local. Per
 *  CONVERSATION, not global: a thread is about one thing, and the tier you
 *  chose for it is part of what you set up. */
const MODEL_KEY = 'hc:chat-models'
const HOST_TIER_MODEL = 'haiku'
const RAIL_WIDTH_KEY = 'hc:chat-rail-width'
const RAIL_MIN = 180
const RAIL_MAX = 640
const CONVERSATION_MIN = 260

const readRailWidth = (): number => {
  try {
    const raw = Number(localStorage.getItem(RAIL_WIDTH_KEY) ?? '')
    return Number.isFinite(raw) && raw >= RAIL_MIN ? Math.min(RAIL_MAX, raw) : 0
  } catch { return 0 }
}
const DEFAULT_MODEL = 'auto'

/** Turns carried to a stateless responder. The stored thread can be any
 *  length; this is the window into it the ask record can afford. */
const TRANSCRIPT_TURNS = 12

/** How long the composer waits after the last keystroke before the thinking
 *  is written down. Long enough that a sentence is one write, short enough
 *  that a hand leaving the keyboard has already been saved. */
const DRAFT_HOLD_MS = 500
const HOST_AI_IOC_KEY = '@diamondcoreprocessor.com/HostAi'
const LLM_ROUTER_IOC_KEY = '@diamondcoreprocessor.com/LlmRouter'

/** How far back a pending ask record may reach and still be shown as waiting.
 *  Matches the agent registry's give-up window: past it nobody is coming, and
 *  a clock still ticking would be a lie rather than a reassurance. */
const RECOVER_MAX_AGE_MS = 45 * 60_000

/** How much of the durable inbox a recovery pass reads. Same bound the
 *  registry's own seed uses. */
const RECOVER_SCAN_LIMIT = 400
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

/** The rail is on screen above this width — the twin of the `max-width: 700px`
 *  rule in the stylesheet, where the sidebar is hidden because a narrow shell
 *  has no room beside a conversation. Kept next to nothing else so the two
 *  numbers are one edit apart. */
const RAIL_QUERY = '(min-width: 701px)'

/** The most a single attached picture may weigh. A phone screenshot is ~2 MB;
 *  past this it is a file to keep in the hive deliberately, not something to
 *  staple to one question. */
const IMAGE_MAX_BYTES = 12 * 1024 * 1024
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

/** This window's name in the owner-counted `view:active` mode. */
const SURFACE_OWNER = 'chat-window'

/** THE VIEW THAT LEAVES THE BAR ITS EDGE.
 *
 *  `view:active` means "a view is covering the canvas, put the chrome away",
 *  and the control bar obeys it by hiding — correct for a takeover, wrong for
 *  this window. The chat covers the canvas but stops at the bar's reservation
 *  (see the stylesheet's `--hc-controls-left` / `--hc-controls-right`), so the
 *  bar has a place to be, and hiding it only cost the participant every control
 *  on it for as long as a conversation was open.
 *
 *  A second owner-counted mode says so, rather than the bar learning this
 *  window's name: any view that leaves the bar its edge can hold it, and the
 *  bar stays while ANY owner does. Claimed and released in lockstep with
 *  `view:active` — the fold releases both, which is what brings the hive AND
 *  its chrome back. */
const KEEPS_CONTROLS = 'view:keeps-controls'

const MODE_REGISTRY_IOC_KEY = '@diamondcoreprocessor.com/ModeRegistry'

type ModeRegistryLike = {
  enter(mode: string, owner: string): void
  exit(mode: string, owner: string): void
}

@Component({
  selector: 'hc-chat-window',
  standalone: true,
  imports: [NgTemplateOutlet, TranslatePipe, HcDockedPanelDirective, DockInsetDirective],
  templateUrl: './chat-window.component.html',
  // TWO SHEETS, in source order. Angular's `anyComponentStyle` budget is
  // measured per compiled stylesheet and one output is emitted per `styleUrls`
  // entry — so splitting is the only thing that lowers the number a `@use`'d
  // partial cannot. The markdown sheet is last because it styles the message
  // bodies the first sheet lays out.
  // Four sheets, not one: Angular's component style budget is per-sheet, and
  // the peek geometry and the picture viewer are self-contained states that
  // read better apart.
  styleUrls: [
    './chat-window.component.scss', './chat-markdown.scss',
    './chat-peek.scss', './chat-look.scss',
  ],
})
export class ChatWindowComponent implements OnDestroy {

  /** A direct/keyed/local provider can answer ordinary chat even when no
   * host or hive-reading bridge is configured. */
  readonly providerReady = signal(false)

  /** Chat stays discoverable, but only a participant-supplied responder makes
   *  it interactive. `configured` is stable through a temporary disconnect;
   *  `bridgeUp` below is merely the live transport state. */
  readonly bridgeConfigured = signal(isLocalClaudeBridgeConfigured())
  readonly hostConfigured = signal(isParticipantAiHostConfigured())
  readonly enabled = computed(() => this.providerReady() || this.bridgeConfigured() || this.hostConfigured())

  /** The participant's last explicit open/closed choice survives a refresh.
   *  On the first visit only, a configured local bridge keeps the established
   *  companion-view default; everyone else begins with the launcher. */
  readonly visible = signal(rememberedChatVisibility(this.bridgeConfigured()))

  /** Parked while the hive is covered and brought back intact — the thread is
   *  durable, but the scroll position and the half-typed message are not.
   *
   *  PARKING IS THE SHELL TAKING THE WINDOW OFF SCREEN, and everything the
   *  fold turned on OUT IN THE HIVE has to go with it. `announce` fires only
   *  on park/unpark (open/close emit `chat:window-state` themselves), which
   *  makes this the one seam where that can be said once:
   *
   *    • the tile icon comes off. A parked window keeps `peeking` true — that
   *      is the whole point of parking — so without this the hexagons went on
   *      offering "add to the request" for a shelf that was not on screen,
   *      which is exactly the thing chat-context-action.drone.ts exists to
   *      prevent.
   *    • the `view:active` claim follows the SCREEN, not the intent: a parked
   *      window covers nothing, so it must not go on claiming the surface. */
  readonly session = signalSession(this.visible, open => {
    EffectBus.emit('chat:window-state', { open })
    this.#claimSurface(open && !this.peeking())
    this.#applyFold()
  })

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
  /** A local broker socket can remain open while the machine is offline. It
   *  is transport plumbing, not proof that a remote model can answer. */
  readonly networkOnline = signal(typeof navigator === 'undefined' || navigator.onLine)
  readonly linkUp = computed(() => this.networkOnline() && (
    this.providerReady() || (this.bridgeUp() && !!this.designated())
  ))

  /** THE MODEL SOMEBODY NAMED, for this conversation. `''` is the normal
   *  case: nobody named one, and the policy designates instead. Naming still
   *  wins — `/opus`, `[tile]/o …`, a `chat:open` carrying a model — because a
   *  participant overriding their own default is the whole point of being
   *  able to say it. */
  readonly model = signal<string>('')
  /** Whether `model` was named by the participant. A remembered actual model
   * is sticky, but remains fallback-capable. */
  readonly modelExplicit = signal(false)

  /** WHO THE POLICY DESIGNATED for a hive-reading question, refreshed from
   *  the providers console's standing instructions (assistant/model-policy.ts
   *  over IoC). Null while nothing is set up — then the composer says only
   *  what the availability line already says. */
  readonly designated = signal<DesignationLike | null>(null)

  /** THE MODEL THAT WILL ANSWER. A remembered fallback must not impersonate
   *  an active provider: vendor model names appear only when explicitly named
   *  by the participant or designated by the live policy. */
  readonly answering = computed(() =>
    this.modelExplicit()
      ? this.model() || DEFAULT_MODEL
      : this.designated()?.model || DEFAULT_MODEL)

  /** The designation said in full — "Claude Code · deep": whose model, and at
   *  what level of thinking. The footer's title, because the line itself
   *  carries the model and nothing else. Empty when nothing is designated;
   *  the template falls back to the standing explanation. */
  readonly answeringWhy = computed(() => {
    const chosen = this.designated()
    return chosen ? `${chosen.label} · ${chosen.tier}` : ''
  })

  /** An answer arriving a chunk at a time from the host tier. Held apart from
   *  `turns` because it is not a turn yet — it becomes one, once, when the
   *  stream closes and the text is on disk. */
  readonly streaming = signal('')

  /** Where the participant is standing, and what they have selected. This IS
   *  the context the question carries — reported, never operated. */
  readonly here = signal<readonly string[]>([])
  readonly targets = signal<readonly string[]>([])

  /** The tile whose conversation is open — clicked in the sidebar, which is
   *  a list of tiles AND therefore a list of chats. Every tile has one; it is
   *  dormant until something is said or written there. Null means a
   *  free-floating chat, about nothing in particular. */
  readonly railSubject = signal<RailPickLike | null>(null)

  // ── THE CLIPBOARD IS THE WAY IN ────────────────────────────────────
  //
  // One kind of thing — an op-less sig reference — and WHERE IT SITS is
  // what it means:
  //
  //   on the clipboard   gathered, not committed to anything. Filled from
  //                      anywhere in the hive (click a tile with the
  //                      clipboard window open, drag a row off the rail).
  //   on the SHELF       part of THIS request — what the responder reads.
  //
  // Moving between them is the whole interface: click a clipboard item to
  // PASTE it onto the shelf (it leaves the clipboard — one home per item,
  // and the clipboard empties as you use it), drag it back off the shelf
  // to RESTORE it, or × to drop it from the request outright.
  //
  // There is no references tab and no second pool: a set worth keeping
  // past this conversation is a named context group, not a compartment.

  /** THE SHELF — the references this request carries, in the order they
   *  were pasted. Chat-local: the clipboard is where things are gathered,
   *  this is where they are committed to the question. */
  readonly references = signal<readonly RailPickLike[]>([])

  /** What the clipboard is holding right now — the shelf's source, mirrored
   *  from `clipboard:changed` (last-value replayed, so the flyout is current
   *  the moment it opens). Read-only here; the clipboard owns it. */
  readonly clipboardHeld = signal<readonly RailPickLike[]>([])

  /** The clipboard flyout is showing. A small icon in the header, because
   *  what you are pasting FROM should be one press away from the composer
   *  rather than a docked panel across the screen. */
  readonly clipboardOpen = signal(false)

  toggleClipboardShelf(): void { this.clipboardOpen.update(open => !open) }

  /** PASTE AS REFERENCE — one click on a clipboard item puts it on the
   *  shelf and takes it off the clipboard. Same entry, new place. */
  pasteReference(pick: RailPickLike): void {
    if (!this.references().some(held => held.key === pick.key)) {
      this.references.set([...this.references(), pick])
      this.#announceSet()
      void this.#refreshContextThumbs()
    }
    EffectBus.emit('clipboard:discard-items', { labels: [pick.name] })
    if (this.clipboardHeld().length <= 1) this.clipboardOpen.set(false)
  }

  /** RESTORE — a reference dragged off the shelf goes back to the clipboard.
   *  The drag is the gesture; this is what it lands as. */
  restoreToClipboard(index: number): void {
    const held = this.references()[index]
    if (!held) return
    this.references.set(this.references().filter((_, at) => at !== index))
    this.#announceSet()
    EffectBus.emit('clipboard:take-entries', {
      entries: [{ label: held.name, sourceSegments: [...held.path], sig: held.sig || undefined }],
    })
  }

  /** What the next question is about, counted for the status row — the SAME
   *  deduped union `send()` will carry, so a tile both canvas-selected and
   *  sidebar-picked counts once. */
  readonly chosen = computed(() => this.#chosenTargets().length)

  /** The gathered tiles, named, for the chip's tooltip. */
  readonly contextNames = computed(() => this.references().map(pick => pick.name).join(', '))

  /** WHICH BRANCH IT CAME FROM. A shelf of pictures says how many references
   *  a request carries and never which — and a gathered set exists to relate
   *  things, so the relation has to be readable without hovering anything.
   *  The last two segments are what distinguishes two same-named tiles in
   *  practice; the whole address rides the title. */
  branchOf(pick: RailPickLike): string {
    return pick.path.length ? pick.path.slice(-2).join(' / ') : ''
  }

  /** The full address, for the hover — same ` / ` crumb the clipboard panel
   *  writes, so one path is spelled one way everywhere. */
  pathOf(pick: RailPickLike): string { return pick.path.join(' / ') }

  /** Is this reference a picture rather than something in the hive's tree? */
  isPicture(pick: RailPickLike): boolean { return !!pick.kind?.startsWith('image/') }

  /** A picture's weight, where a tile's branch would be — the one fact worth
   *  knowing about a file you just attached. */
  sizeOf(pick: RailPickLike): string {
    const bytes = pick.size ?? 0
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
    return `${bytes} B`
  }

  /** pick.key → blob: URL of the tile's PICTURE ('large' — a square must
   *  never wear the hex capture when the tile has a real picture). Absent →
   *  the box falls back to its name chip. Shares the panel's resolver, so
   *  the two faces of the gathered set can never show different images. */
  readonly contextThumbs = signal<Record<string, string>>({})
  #thumbUrls = new Map<string, string>()
  #thumbToken = 0

  /** Same bounded-cache discipline as the panel: revoke what left the set,
   *  resolve only what is new, and let a superseding change win the race.
   *
   *  Resolve pictures for BOTH faces at once — the shelf and the flyout draw
   *  from one cache, so pasting an item never has to re-fetch the picture the
   *  flyout was already showing, and neither list can revoke the other's
   *  object-URLs by being refreshed on its own. */
  async #refreshContextThumbs(): Promise<void> {
    const entries = [...this.references(), ...this.clipboardHeld()]
    const token = ++this.#thumbToken
    const wanted = new Set(entries.map(entry => entry.key))
    for (const key of [...this.#thumbUrls.keys()]) {
      if (!wanted.has(key)) {
        const url = this.#thumbUrls.get(key)
        if (url) URL.revokeObjectURL(url)
        this.#thumbUrls.delete(key)
      }
    }
    const pending = entries.filter(entry => !this.#thumbUrls.has(entry.key))
    if (pending.length) {
      const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
      await Promise.all(pending.map(async (entry) => {
        // An attached PICTURE is its own thumbnail: it has no tile to walk to,
        // only bytes at a signature.
        const url = entry.kind?.startsWith('image/')
          ? await this.#imageUrl(store, entry.sig ?? '')
          : await resolveEntryImageUrl(entry.name, entry.path, 'large').catch(() => null)
        if (token !== this.#thumbToken) { if (url) URL.revokeObjectURL(url); return }
        if (url) this.#thumbUrls.set(entry.key, url)
      }))
    }
    if (token !== this.#thumbToken) return
    const map: Record<string, string> = {}
    for (const [k, v] of this.#thumbUrls) map[k] = v
    this.contextThumbs.set(map)
  }

  // ── LOOKING AT WHAT THE REQUEST CARRIES ────────────────────────────
  //
  // The shelf shows a picture shrunk to a mark, which answers WHICH but not
  // WHAT — and a reference you cannot actually look at is one you have to
  // take on trust. So a shelf picture opens where it already is.
  //
  // IN PLACE, NOT IN A TAB. Leaving is the expensive move: the composer holds
  // an unsent question and a shelf you assembled, and on the native shell a
  // document navigation takes the window with it (a link out of a view is the
  // one thing a view may never do). The overlay lives inside the chat panel,
  // so nothing is put down to look at something.
  //
  // NO SECOND FETCH. It paints the URL the shelf is ALREADY holding —
  // `contextThumbs` resolves a tile's `large` picture and an attached image's
  // own bytes, both full-size — so opening one is free and closing it cannot
  // strand an object-URL: the thumbnail cache owns every URL and revokes them
  // on its own terms.

  /** The shelf picture on screen, by its entry key — or null. */
  readonly viewing = signal<{ key: string; name: string } | null>(null)

  /** What to paint. Derived from the live cache rather than captured at open,
   *  so a refresh that re-resolves a picture cannot leave the viewer showing
   *  a URL that has since been revoked. An entry that leaves the shelf while
   *  you are looking at it yields '' and the viewer closes itself. */
  readonly viewingUrl = computed(() => {
    const held = this.viewing()
    return held ? this.contextThumbs()[held.key] ?? '' : ''
  })

  /** The shelf's pictures, in shelf order — what ← and → step through. A
   *  reference with no picture is not in the set: stepping onto a hexagon
   *  glyph would be a blank screen with no way to tell it from a failure. */
  #picturesOnShelf(): RailPickLike[] {
    const thumbs = this.contextThumbs()
    return this.references().filter(pick => !!thumbs[pick.key])
  }

  /** Which of them is showing, or -1. */
  readonly viewingIndex = computed(() => {
    const held = this.viewing()
    if (!held) return -1
    return this.#picturesOnShelf().findIndex(pick => pick.key === held.key)
  })

  readonly viewingCount = computed(() => this.#picturesOnShelf().length)

  /** Open a shelf picture. Guarded on there BEING one: the box falls back to
   *  a name chip when nothing resolved, and that must not open an empty
   *  screen. */
  openPicture(pick: RailPickLike, event?: Event): void {
    event?.stopPropagation()
    if (!this.contextThumbs()[pick.key]) return
    this.viewing.set({ key: pick.key, name: pick.name })
  }

  closePicture(): void { this.viewing.set(null) }

  /** ← and → walk the shelf WITHIN the viewer — the same axis the rest of the
   *  product uses for "the next one of these", never for leaving. Wraps, so a
   *  shelf of three is a loop rather than a corridor with two dead ends. */
  stepPicture(delta: 1 | -1): void {
    const pictures = this.#picturesOnShelf()
    if (pictures.length < 2) return
    const at = this.viewingIndex()
    if (at < 0) return
    const next = pictures[(at + delta + pictures.length) % pictures.length]
    if (next) this.viewing.set({ key: next.key, name: next.name })
  }

  /** TAKE THE FOCUS WHEN IT OPENS. The overlay's keys are the whole
   *  interaction — step, step, done — and a surface you have to click before
   *  the arrows work is one whose arrows nobody finds. The press that opened
   *  it was on a button inside the shelf, so focus has to be moved
   *  deliberately. */
  readonly #focusLook = effect(() => {
    if (!this.viewing()) return
    const layer = this.lookLayer()?.nativeElement
    if (layer) queueMicrotask(() => layer.focus())
  })

  /** The viewer's own keys. Escape also unwinds through the window's cascade
   *  (see onKey) for when focus never reached the overlay. */
  onPictureKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight') { event.preventDefault(); this.stepPicture(1); return }
    if (event.key === 'ArrowLeft') { event.preventDefault(); this.stepPicture(-1); return }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closePicture() }
  }

  /** The bytes at a signature, as something an <img> can show. Bounded by the
   *  same cache the rest of the shelf uses, so it is revoked with everything
   *  else when the reference leaves. */
  async #imageUrl(store: StoreLike | undefined, sig: string): Promise<string | null> {
    if (!store?.getResource || !/^[0-9a-f]{64}$/.test(sig)) return null
    try {
      const blob = await store.getResource(sig)
      return blob ? URL.createObjectURL(blob) : null
    } catch { return null }
  }

  // ── TWO KINDS OF DATA IN ONE REQUEST ──────────────────────────────────
  //
  // They are not the same thing and conflating them is why an answer can be
  // well-informed and still edit the wrong tile:
  //
  //   THE WORK BRANCH   the branch that needs CHANGES. One. It is what the
  //                     ask applies to, and what an answer is written onto.
  //   THE CONTEXT       supporting branches and resources the responder
  //                     should READ. Any number, in the order you added
  //                     them, carried as signatures so the payload is the
  //                     same bytes every time it is composed.
  //
  // Both are filled by dropping a tile from the sidebar, and both are
  // signatures the moment they land — a name would make the request depend
  // on where the hive stood when it was sent.
  //
  // THE CONTEXT LIVES ON THE CLIPBOARD. Not a private list: the same
  // op-less sig entries the clipboard window shows, the hive's swap takes
  // fill, and the panel's place/discard act on. Pin the chat, open the
  // clipboard window, walk the hive clicking tiles — they appear here as
  // they land, and dragging rows out of the sidebar lands in the same set.
  // The work branch stays chat-local: it is an ADDRESS for the answer, not
  // a gathered reference.

  // THE TARGET IS THE TILE YOU ARE IN. There is no box for it, because there
  // is nothing to choose: the conversation is about a tile, so that tile is
  // what an answer may change. An anchor rank used to sit here saying the
  // same thing a second time, and a second way of saying it is a second thing
  // to keep in step. What remains is one list of references — everything the
  // request should READ — and the target it is already standing on.

  /** A tile dropped straight onto the shelf — dragged off the sidebar rail,
   *  never through the clipboard. It lands as a reference directly, because
   *  a drag that has already crossed the window should not need a second
   *  gesture to finish. */
  addContext(tile: DroppedTile): void {
    if (!tile.sig && !tile.path) return
    const segments = tile.path.split('/').filter(Boolean)
    const name = tile.name || segments[segments.length - 1] || ''
    const key = tile.path.startsWith('/') ? tile.path : '/' + segments.join('/')
    if (this.references().some(held => held.key === key)) return
    this.references.set([...this.references(), {
      key,
      path: segments.slice(0, -1),
      name,
      sig: tile.sig || undefined,
    }])
    this.#announceSet()
    void this.#refreshContextThumbs()
  }

  /** WHAT THE REQUEST CARRIES, structured. A reference is a pointer plus what
   *  KIND of thing it points at, because "one layer" and "a whole context"
   *  are read differently by whoever answers:
   *
   *    layer  a single tile's own content
   *    group  a named set of tiles — a META CONTEXT, one reference standing
   *           for many, carried by the set's own signature
   *
   *  The TARGET is not in here: the tile whose conversation this is rides as
   *  the ask's target, because it is what may be changed rather than
   *  something to be read. */
  referencePayload(): { kind: string; sig: string; label: string }[] {
    return this.references()
      .filter(pick => !!pick.sig)
      .map(pick => ({ kind: pick.kind ?? 'layer', sig: pick.sig ?? '', label: pick.name }))
  }

  /** Tell the sidebar which tiles are in the set being asked about, so it can
   *  draw them as one handful. The window owns the set; the rail only shows
   *  it — it must never have to guess from its own selection state, which is
   *  a different thing that happens to overlap. */
  #announceSet(): void {
    const paths = this.references().map(pick =>
      pick.key.startsWith('/') ? pick.key : '/' + [...pick.path, pick.name].join('/'))
    EffectBus.emit('context:active-set', { paths })
  }

  /** ON OR OFF, from a press out in the hive. The tile icon that raises this
   *  is the SAME control both directions — pressing a tile that is already on
   *  the shelf takes it off — because a lit icon you cannot un-press is an
   *  icon you have to come back to the window to undo. */
  toggleContext(tile: DroppedTile): void {
    const segments = tile.path.split('/').filter(Boolean)
    const key = tile.path.startsWith('/') ? tile.path : '/' + segments.join('/')
    if (this.references().some(held => held.key === key)) {
      this.references.set(this.references().filter(held => held.key !== key))
      this.#announceSet()
      void this.#refreshContextThumbs()
      return
    }
    this.addContext(tile)
  }

  /** The × — take it off the shelf and out of the request. Deliberately NOT
   *  a restore: dragging it back is how you say "not now, but keep it".
   *  The tile itself is untouched either way. */
  removeContext(index: number): void {
    const held = this.references()[index]
    if (!held) return
    this.references.set(this.references().filter((_, at) => at !== index))
    this.#announceSet()
    void this.#refreshContextThumbs()
  }

  /** Read a dragged tile, whatever surface dropped it. Returns null for a
   *  drag that is not one of ours, so an accidental file drop does nothing. */
  readDrop(event: DragEvent): DroppedTile | null {
    const raw = event.dataTransfer?.getData(TILE_DRAG_TYPE)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as Partial<DroppedTile>
      const name = String(parsed?.name ?? '').trim()
      const path = String(parsed?.path ?? '').trim()
      if (!name && !path) return null
      return { name: name || path, path, sig: String(parsed?.sig ?? '') }
    } catch { return null }
  }

  onDropReference(event: DragEvent): void {
    event.preventDefault()
    this.dragOverReference.set(false)
    const tile = this.readDrop(event)
    if (tile) { this.addContext(tile); return }
    // A PICTURE IS A REFERENCE TOO. Files dropped here are kept in the hive
    // like everything else — content in, signature out — and ride on the
    // question by that signature.
    const files = [...(event.dataTransfer?.files ?? [])].filter(file => file.type.startsWith('image/'))
    if (files.length) void this.#attachImages(files)
  }

  // ── PICTURES ────────────────────────────────────────────────────────────
  //
  // A question about a screenshot is the most ordinary question there is, and
  // until now the only way to ask it was to describe the picture in words.
  //
  // The image is CONTENT: `putResource` stores the bytes at the content root
  // under their own signature, exactly like a layer or a note body, so the
  // same picture pasted twice is stored once and the reference is a 64-hex
  // string either way. What rides on the ask is that signature plus the media
  // type as its KIND — the responder resolves the bytes itself (the bridge
  // serves them base64) rather than being handed a copy inline.

  /** Paste an image straight into the composer. The clipboard is where a
   *  screenshot already is; making you save it to a file first would be a
   *  step invented by the software. */
  onComposerPaste(event: ClipboardEvent): void {
    const files = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith('image/'))
    if (!files.length) return
    // Only when it IS a picture — pasting text must stay ordinary pasting.
    event.preventDefault()
    void this.#attachImages(files)
  }

  /** Store each picture and put it on the shelf. Anything that will not store
   *  says so rather than sitting there looking attached. */
  async #attachImages(files: readonly File[]): Promise<void> {
    const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
    if (!store?.putResource) {
      EffectBus.emit('toast:show', { type: 'warning', message: 'No hive to keep the picture in.' })
      return
    }
    for (const file of files) {
      if (file.size > IMAGE_MAX_BYTES) {
        EffectBus.emit('toast:show', {
          type: 'warning',
          message: `${file.name || 'That picture'} is too large to attach.`,
        })
        continue
      }
      let sig = ''
      try { sig = await store.putResource(file) } catch { sig = '' }
      if (!/^[0-9a-f]{64}$/.test(sig)) {
        EffectBus.emit('toast:show', { type: 'warning', message: 'Could not keep that picture.' })
        continue
      }
      const key = `image:${sig}`
      if (this.references().some(held => held.key === key)) continue
      this.references.set([...this.references(), {
        key,
        path: [],
        name: file.name || 'pasted image',
        sig,
        size: file.size,
        // The MEDIA TYPE is the kind: a responder reading the ask knows both
        // that this is a picture and how to open it, from one field.
        kind: file.type || 'image/png',
      }])
    }
    this.#announceSet()
    void this.#refreshContextThumbs()
  }

  // ── DRAG IT BACK OFF THE SHELF ─────────────────────────────────────
  // A reference dragged out of the shelf and released anywhere off it goes
  // back to the clipboard. The drop is not caught by a target — the shelf
  // is the only thing that would accept it, so LEAVING the shelf IS the
  // gesture, and dragend is where "it left" is known.

  /** Which reference is in the air, by index. */
  #draggingRef: number | null = null

  onReferenceDragStart(event: DragEvent, index: number): void {
    const held = this.references()[index]
    if (!held) return
    this.#draggingRef = index
    // It travels in the same shape the rail sends, so anything that accepts
    // a hive tile accepts this one too.
    const payload = JSON.stringify({
      name: held.name,
      path: held.key,
      sig: held.sig ?? '',
    })
    event.dataTransfer?.setData(TILE_DRAG_TYPE, payload)
    event.dataTransfer?.setData('text/plain', held.key)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }

  /** The drag ended. Dropped back on the shelf → nothing happened (the shelf's
   *  own drop handler already cleared the mark). Dropped anywhere else → it
   *  left the request and goes home to the clipboard. */
  onReferenceDragEnd(): void {
    const index = this.#draggingRef
    this.#draggingRef = null
    if (index === null || this.dragOverReference()) { this.dragOverReference.set(false); return }
    this.restoreToClipboard(index)
  }

  /** A drop target has to LOOK like one while something is over it. */
  readonly dragOverReference = signal(false)

  onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types?.includes(TILE_DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    this.dragOverReference.set(true)
  }

  onDragLeave(): void {
    this.dragOverReference.set(false)
  }

  // WHOSE CONVERSATION IS THIS? Read off the CONVERSATION, never off the
  // sidebar — the sidebar exists only in full screen, and a thread resumed
  // from the roster has no sidebar state at all. The id knows: a tile chat is
  // `chat:tile:/dolphin/site`, and everything else is about nothing in
  // particular. Without this the window opened on a thread and said only
  // "Chat", which is the one thing it could say that is never wrong and never
  // useful.

  /** The tile path this conversation belongs to, or '' for a free chat. */
  readonly subjectPath = computed(() => {
    void this.turns()   // recomputed as the thread moves, so it can never lag
    return this.#threads()?.tilePathOf?.(this.activeId()) ?? ''
  })

  /** What the header says: the tile's own name, or nothing to name. */
  readonly subjectName = computed(() => {
    const path = this.subjectPath()
    if (!path || path === '/') return ''
    const segments = path.split('/').filter(Boolean)
    return segments[segments.length - 1] ?? ''
  })

  // ── WHAT YOU PICKED, SHOWN AT THE TOP ───────────────────────────────────
  //
  // The sidebar says which row is selected; this says the same thing at the
  // head of the reading column, where your eye already is once you have
  // stopped choosing and started asking. A NAME alone was not enough — the
  // rail identifies a tile by its PICTURE, and the header identified the same
  // tile by a word, so the two did not obviously agree. Now the header wears
  // the tile's own picture, resolved through the SAME resolver the shelf
  // squares use, so one tile can never show two faces in one window.
  //
  // Best-effort and never load-bearing: no picture (or a cold index) leaves
  // the header exactly what it was — the name on its own.

  /** The selected tile's picture as a blob: URL, or '' for none. */
  readonly subjectThumb = signal('')
  #subjectThumbUrl: string | null = null
  #subjectThumbToken = 0

  /** Resolve the picture for whatever the window is now about. Every path
   *  through here revokes the URL it replaces, and a superseding change wins
   *  the race — the same discipline `#refreshContextThumbs` keeps. */
  async #refreshSubjectThumb(): Promise<void> {
    const token = ++this.#subjectThumbToken
    const path = this.subjectPath()
    const segments = path.split('/').filter(Boolean)
    const label = segments[segments.length - 1] ?? ''
    const url = label
      ? await resolveEntryImageUrl(label, segments.slice(0, -1), 'large').catch(() => null)
      : null
    if (token !== this.#subjectThumbToken) { if (url) URL.revokeObjectURL(url); return }
    if (this.#subjectThumbUrl) URL.revokeObjectURL(this.#subjectThumbUrl)
    this.#subjectThumbUrl = url
    this.subjectThumb.set(url ?? '')
  }

  /** Clear the shelf — the request carries nothing extra again. The tiles
   *  are untouched and the clipboard is left alone: this empties what THIS
   *  question would have carried, nothing more. */
  clearContext(): void {
    this.#rail?.clearSelection()
    this.references.set([])
    this.#announceSet()
    void this.#refreshContextThumbs()
    this.#focus()
  }

  /** How many context branches are ATTACHED to this tile (the portal-drop
   *  records) — they ride with every question, and a rider the participant
   *  cannot see is a surprise, so the count is shown beside the path. */
  readonly contextCount = signal(0)

  /** Unsent drafts, by their own key — a tile path, or a free chat's id.
   *  Held here so the roster can list a conversation that has NOTHING in it
   *  yet but your words. */
  readonly drafts = signal<readonly { key: string; text: string }[]>([])

  /** THE ROSTER — every conversation you could return to, which is not the
   *  same as every conversation that holds a turn.
   *
   *  A chat you typed into and left without sending has no turns, so the
   *  thread walk cannot see it, so it never appeared here — and the words
   *  were unreachable from the moment you clicked away. They were never
   *  lost (the drafts pool had them all along), but a thing you cannot get
   *  back to may as well be gone. Draft-only conversations are folded in,
   *  and tile chats are named by their TILE rather than by their first
   *  sentence, because that is what you would look for. */
  readonly roster = computed(() => {
    const threads = this.#threads()
    const tileOf = (id: string): string => threads?.tilePathOf?.(id) ?? ''
    const rows = this.conversations().map(convo => ({
      convoId: convo.convoId,
      tile: tileOf(convo.convoId),
      title: convo.title,
      turnCount: convo.turnCount,
      lastAt: convo.lastAt,
      draft: '',
      archived: !!convo.archived,
    }))

    const known = new Set(rows.map(row => row.convoId))
    for (const held of this.drafts()) {
      // A tile's draft is keyed by its path; a free chat's by its own id.
      const convoId = held.key.startsWith('/')
        ? (threads?.tileConvoId?.(held.key.split('/').filter(Boolean)) ?? '')
        : held.key
      if (!convoId) continue
      const existing = rows.find(row => row.convoId === convoId)
      if (existing) { existing.draft = held.text; continue }
      if (known.has(convoId)) continue
      rows.push({
        convoId,
        tile: tileOf(convoId),
        title: held.text,
        turnCount: 0,
        lastAt: 0,
        draft: held.text,
        archived: false,
      })
    }
    return rows.sort((a, b) => b.lastAt - a.lastAt)
  })

  /** The list as it is READ — everything that has not been put away. */
  readonly liveRoster = computed(() => this.roster().filter(row => !row.archived))

  /** And what has been. Shown only when asked for; see `archiveOpen`. */
  readonly filedRoster = computed(() => this.roster().filter(row => row.archived))

  /** Is the archive showing in this window's flat list? Not persisted:
   *  putting a conversation away is durable, wanting to look at what you put
   *  away is something you are doing right now. */
  readonly archiveOpen = signal(false)
  readonly goalOpen = signal(false)
  readonly activeGoal = computed(() =>
    this.conversations().find(convo => convo.convoId === this.activeId())?.goal)

  toggleGoal(): void { this.goalOpen.update(open => !open) }

  /** PUT AWAY, NOT THROWN AWAY. Delete was the only thing you could do with a
   *  conversation you were finished with, and it is the wrong verb for the
   *  common case: you are done needing the thread, not done having said it.
   *  Archiving keeps every turn and takes the row out of the list.
   *
   *  Same button both ways — un-archiving is this act with the flag flipped,
   *  so there is no separate "restore" somewhere else to go and find. The
   *  list is updated optimistically because this is a one-press act on a row
   *  under the pointer; the refresh behind it corrects a write that failed.
   *
   *  Archiving the conversation you are IN leaves you in it: it is still
   *  open, still readable, still where what you type goes. What changed is
   *  where it sits in the list. */
  async archive(convoId: string, archived: boolean, event?: MouseEvent): Promise<void> {
    event?.stopPropagation()
    // A row half-way through arming a DELETE must not silently keep that
    // arming after a different button was pressed.
    this.armed.set('')
    this.conversations.update(list => list.map(convo =>
      convo.convoId === convoId ? { ...convo, archived } : convo))
    if (!archived && !this.filedRoster().length) this.archiveOpen.set(false)
    await this.#threads()?.setConversationArchived?.(convoId, archived)
    await this.#refreshList()
  }

  toggleArchive(): void { this.archiveOpen.update(open => !open) }

  /** Is the conversation in hand put away? A fresh chat that has never been
   *  listed is not — nothing has been said in it to file. */
  readonly activeArchived = computed(() =>
    !!this.conversations().find(convo => convo.convoId === this.activeId())?.archived)

  /** ARCHIVE THE ONE YOU ARE READING. The per-row control in the list acts on
   *  a conversation you are pointing at; this acts on the one in hand, which
   *  is the common case — you finish with a thread while you are in it.
   *
   *  And then it MOVES ON. This is the one place where staying put would be
   *  wrong: a press that files the conversation and leaves it on screen looks
   *  like a press that did nothing. So the window lands on the next live
   *  thread, or on a fresh chat when that was the last one — the same thing
   *  deleting does, for the same reason.
   *
   *  Bringing one BACK does stay put: you navigated into it deliberately and
   *  being thrown somewhere else for un-filing it is not what the press asks
   *  for. */
  async archiveCurrent(): Promise<void> {
    const convoId = this.activeId()
    if (!convoId) return
    const filing = !this.activeArchived()
    this.goalOpen.set(false)
    await this.archive(convoId, filing)
    if (!filing) return

    const next = this.conversations().find(convo => !convo.archived && convo.convoId !== convoId)
    if (next) { await this.#load(next.convoId); await this.#restoreDraft(); this.#focus() }
    else this.newChat()
  }

  /** Does the loaded essentials build know how to archive? A control that
   *  cannot do anything is worse than one that is not there.
   *
   *  A method rather than a signal on purpose: the module registers itself
   *  whenever it lands, so the honest answer is "ask at read time". Writing a
   *  signal from `#threads()` — which the roster computed calls — would be a
   *  write inside a computed, which Angular rightly refuses. */
  canArchive(): boolean { return !!this.#threads()?.setConversationArchived }

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
  readonly chatRail = viewChild<ElementRef<HTMLDivElement>>('chatRail')
  readonly lookLayer = viewChild<ElementRef<HTMLElement>>('lookLayer')
  readonly panel = viewChild<ElementRef<HTMLElement>>('panel')

  readonly railWidth = signal(readRailWidth())
  readonly railDragging = signal(false)

  readonly #railWidthEffect = effect(() => {
    const element = this.panel()?.nativeElement
    if (!element) return
    const width = this.railWidth()
    if (width) element.style.setProperty('--chat-rail-width', `${width}px`)
    else element.style.removeProperty('--chat-rail-width')
  })

  /** ONE rail per window lifetime, mounted whenever full screen puts its host
   *  in the DOM — so the trail you drilled and the tiles you chose survive
   *  leaving and re-entering full screen. */
  #rail: TilesRailLike | null = null

  /** The rail picks last reported, keyed by row key — what lets a selection
   *  change flow into the clipboard as ADDS and REMOVES rather than a
   *  wholesale replace that would clobber entries gathered elsewhere. */
  #railSeen = new Map<string, RailPickLike>()
  /** The text last written to the drafts pool for the open conversation —
   *  so an unchanged box is never re-written. */
  #heldDraft = ''
  #draftTimer: ReturnType<typeof setTimeout> | null = null
  /** Questions that are out, by conversation — see #startWait. */
  readonly #outstanding = new Map<string, { sig: string; askedAt: number }>()

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

  // ── WHERE A CONVERSATION IS LISTED ────────────────────────────────────
  //
  // A conversation about a tile is listed UNDER THAT TILE, in the rail, and
  // nowhere else. A tile is a subject and its threads hang off it — walk to
  // another page and each tile there carries its own. The window used to
  // print a second, flat list of every chat above the transcript; two homes
  // for one thing is how you end up not knowing which is the real one, and
  // the flat one could not say what any of it was ABOUT.
  //
  // The list survives in exactly one case: a window with NO rail (the narrow
  // shell hides it below 700px, the twin of the rule in the stylesheet).
  // There the rail cannot carry it, so the window still must.

  /** Is the sidebar on screen — i.e. is the rail carrying the chat list? */
  readonly railVisible = signal(true)
  #railQuery: MediaQueryList | null = null

  // ── PEEK: the hive, without leaving the conversation ────────────────────
  //
  // The window is full screen, which is right while you are reading an answer
  // and wrong while you are deciding WHICH tiles the next question should
  // carry. The rail names tiles; it does not show you the hive.
  //
  // So: peek. The transcript, the rail and the conversation bar fold away and
  // the panel stops taking pointer events, leaving the header (the shelf) and
  // the footer (the input) floating over the LIVE hive. Navigation is the
  // hive's own — an ordinary click walks in, and nothing about that changes,
  // because a second navigation grammar over the same hexagons is a second
  // thing to learn for no gain. Putting a tile ON the shelf is a per-tile icon
  // that arrives with the fold (assistant/chat-context-action.drone.ts); it
  // could not be a chord, because ctrl-click on a hexagon is already the
  // selection toggle.
  //
  // Peek is a state of the OPEN window, not a second shape: the conversation,
  // the draft and the shelf are all still there, and unfolding returns to
  // exactly what you left, now carrying whatever you picked up.
  readonly peeking = signal(false)

  /** Whether the providers console is standing. Reported BY the console, never
   *  guessed here: the same press opens and shuts it, and a toggle that draws
   *  itself from its own last press goes wrong the moment the console is shut
   *  any other way (Escape, `/providers`, the command line). */
  readonly providersOpen = signal(false)

  /** Fold the window away to the hive, or bring it back. */
  togglePeek(): void {
    const next = !this.peeking()
    this.peeking.set(next)
    // Folding away closes the things that only make sense over a transcript —
    // and a full-bleed picture would cover the live hive the fold exists to
    // show. Closed, not merely hidden: an invisible surface still standing is
    // one Escape would unwind before the fold, which reads as a dead key.
    if (next) { this.clipboardOpen.set(false); this.listOpen.set(false); this.closePicture() }
    this.#claimSurface(!next)
    this.#applyFold()
    if (!next) this.#focus()
  }

  /** EVERYTHING THAT FOLLOWS THE FOLD, in one place — so park, close, open
   *  and the toggle cannot disagree about it. Two things follow:
   *
   *  1. WHO IS GATHERING. The hexagons grow a per-tile "add to the request"
   *     icon while folded away and lose it again when the window comes back
   *     (assistant/chat-context-action.drone.ts) — an affordance for a shelf
   *     nobody can see would be an affordance for nothing.
   *  2. THE LAYER'S SAVED FRAMING IS NOT OURS TO CHANGE. Reserving the bars
   *     resizes the canvas, and the canvas owner answers a resize by
   *     recentring and (when the saved zoom was a fit) refitting — which is
   *     exactly what we want to SEE and exactly what must not be WRITTEN. A
   *     fit computed for the band between two bars is not the framing this
   *     layer should open with next time. `suspend()` blocks automatic writes
   *     only, so a pan or zoom the participant performs while folded is still
   *     theirs and still persists. Unfolding resumes, the bars stop
   *     reserving, and the same resize path restores the framing from the
   *     value that was never overwritten. */
  #applyFold(): void {
    const folded = this.visible() && this.peeking()
    EffectBus.emit('chat:peek', { peeking: folded })

    if (folded === this.#foldSuspendedViewport) return
    const viewport = ioc()?.get('@diamondcoreprocessor.com/ViewportPersistence') as
      { suspend?(): void; resume?(): void } | undefined
    if (!viewport?.suspend || !viewport.resume) return
    // Only ever resume what THIS window suspended — the flag is global and a
    // blanket resume would clear somebody else's.
    if (folded) viewport.suspend()
    else viewport.resume()
    this.#foldSuspendedViewport = folded
  }

  /** Whether the fold is currently holding viewport persistence down. */
  #foldSuspendedViewport = false

  /** THE SURFACE IS OWNED, and the owner is counted (ModeRegistry). A full
   *  screen window is a view covering the canvas by any honest reading, and
   *  everything that hides itself for a view — the pixi canvas, the post-it
   *  stickies, the empty-collection prompt — was drawing straight over this
   *  window because it never said so. Peeking releases the claim, which is
   *  what makes the hive underneath live and clickable again. */
  #claimSurface(active: boolean): void {
    this.#surfaceWanted = active
    const modes = ioc()?.get(MODE_REGISTRY_IOC_KEY) as ModeRegistryLike | undefined
    if (!modes) {
      // The registry is an essentials bee and the window can boot open before
      // it lands. Claim on the SETTLED intent when it arrives, never on the
      // intent that was current when this call was made.
      if (active) this.#whenModes(late => {
        if (!this.#surfaceWanted) return
        late.enter('view:active', SURFACE_OWNER)
        late.enter(KEEPS_CONTROLS, SURFACE_OWNER)
      })
      return
    }
    if (active) {
      modes.enter('view:active', SURFACE_OWNER)
      modes.enter(KEEPS_CONTROLS, SURFACE_OWNER)
    } else {
      modes.exit('view:active', SURFACE_OWNER)
      modes.exit(KEEPS_CONTROLS, SURFACE_OWNER)
    }
  }

  /** Is the surface claimed, as far as this window is concerned. */
  #surfaceWanted = false

  #whenModes(run: (modes: ModeRegistryLike) => void): void {
    (globalThis as { ioc?: { whenReady?: (k: string, cb: (v: unknown) => void) => void } }).ioc
      ?.whenReady?.(MODE_REGISTRY_IOC_KEY, value => run(value as ModeRegistryLike))
  }

  #cleanups: (() => void)[] = []
  #elapsedTimer: ReturnType<typeof setInterval> | null = null

  #onSync = (): void => { if (this.visible()) this.#refreshContext() }
  #onNetworkChange = (): void => {
    this.networkOnline.set(navigator.onLine)
    this.#refreshDesignation()
  }
  #onRailQuery = (event: MediaQueryListEvent): void => { this.railVisible.set(event.matches) }
  #onStorage = (event: StorageEvent): void => {
    if (event.key !== PARTICIPANT_AI_HOST_STORAGE_KEY && event.key !== null) return
    const configured = isParticipantAiHostConfigured()
    this.hostConfigured.set(configured)
    if (configured && this.visible() && !this.activeId()) void this.#resume()
  }

  constructor() {
    window.addEventListener('online', this.#onNetworkChange)
    window.addEventListener('offline', this.#onNetworkChange)
    // Code blocks are highlighted AFTER the turn is in the DOM — highlight.js
    // works on live elements, and the loader is lazy, so the first fenced block
    // in a session pays for the library and none of the later ones do.
    effect(() => {
      this.rendered()
      this.streaming()
      setTimeout(() => void highlightBlocks(this.scroller()?.nativeElement), 0)
    })

    // The header follows the selection. `subjectPath` is the one signal that
    // knows what the window is about — it already recomputes as the thread
    // moves — so reading it here is the whole subscription.
    effect(() => {
      this.subjectPath()
      void this.#refreshSubjectThumb()
    })

    // The left sidebar. Its host `<div>` exists only while the window is open,
    // so this effect re-fires as the window comes and goes; the rail itself is
    // created once and re-mounted, keeping its trail and subject. Essentials
    // may register the factory AFTER this window is up (web loads its bees
    // from OPFS), so a miss WAITS on the key instead of leaving the sidebar
    // empty until the next refocus. Without any factory ever arriving the
    // sidebar stays empty — the chat loses nothing it had before.
    effect(() => {
      const host = this.chatRail()?.nativeElement
      if (!host) return
      if (this.#rail) { this.#rail.mount(host); return }
      const registry = ioc() as { get?(k: string): unknown; whenReady?(k: string, cb: (v: unknown) => void): void } | undefined
      const key = '@diamondcoreprocessor.com/AgentTilesRailFactory'
      const bring = (factory: TilesRailFactoryLike | undefined): void => {
        if (this.#rail || !factory?.create) return
        this.#rail = factory.create()
        this.#rail.onSubjectChanged = subject => { void this.#enterSubject(subject) }
        // Rail picks flow INTO the clipboard as deltas — never a wholesale
        // replace, because the clipboard also holds what the hive's takes
        // and the header's drops gathered, and a ctrl-click in the sidebar
        // must not blow those away.
        this.#rail.onSelectionChanged = selection => {
          const before = this.#railSeen
          const now = new Map(selection.map(pick => [pick.key, pick]))
          this.#railSeen = now
          const added = selection.filter(pick => !before.has(pick.key))
          const removed = [...before.values()].filter(pick => !now.has(pick.key))
          if (added.length) {
            EffectBus.emit('clipboard:take-entries', {
              entries: added.map(pick => ({
                label: pick.name,
                sourceSegments: [...pick.path],
                sig: pick.sig || undefined,
              })),
            })
          }
          if (removed.length) {
            EffectBus.emit('clipboard:discard-items', { labels: removed.map(pick => pick.name) })
          }
        }
        // The host captured here may have been replaced by the time a late
        // factory lands — mount into whatever full screen is showing NOW.
        const live = this.chatRail()?.nativeElement
        if (live) this.#rail.mount(live)
      }
      const now = registry?.get?.(key) as TilesRailFactoryLike | undefined
      if (now) bring(now)
      else registry?.whenReady?.(key, value => bring(value as TilesRailFactoryLike))
    })

    // A TILE PRESSED OUT IN THE HIVE. The hexagons carry the icon while the
    // window is folded away; the window owns the shelf, so the press arrives
    // here as a plain reference rather than the canvas reaching into it.
    this.#cleanups.push(EffectBus.on<DroppedTile>(
      'chat:add-context', payload => {
        if (!payload?.path && !payload?.sig) return
        this.toggleContext({
          name: String(payload.name ?? ''),
          path: String(payload.path ?? ''),
          sig: String(payload.sig ?? ''),
        })
      }))

    this.#cleanups.push(EffectBus.on<{ model?: string; prefill?: string; convoId?: string }>(
      'chat:open', payload => { void this.open(payload) }))

    this.#cleanups.push(EffectBus.on('chat:toggle', () => {
      if (this.visible()) this.close()
      else void this.open()
    }))

    // THE KEY IS THE SAME ACT. `c` (keyboard/default-keymap.ts) dispatches
    // through the keymap's one lane rather than a second toggle event, so
    // the shortcut, the command-line icon and the palette all end up in the
    // branch above — there is one way this window opens, however you ask.
    this.#cleanups.push(EffectBus.on<{ cmd?: string }>('keymap:invoke', payload => {
      if (payload?.cmd !== 'chat.toggle') return
      if (this.visible()) this.close()
      else void this.open()
    }))

    this.#cleanups.push(EffectBus.on('chat:close', () => { if (this.visible()) this.close() }))

    // A PICTURE ARRIVING FROM ELSEWHERE. The markup sheet (markup-overlay)
    // photographs the screen and stores the bytes itself, so what reaches the
    // shelf is the same {sig, kind} reference a pasted screenshot becomes —
    // the surface that took the picture never has to know how this window
    // holds one. The window opens on arrival: a context nobody can see is a
    // context nobody will use.
    this.#cleanups.push(EffectBus.on<{ sig?: string; name?: string; kind?: string; size?: number; open?: boolean }>(
      'chat:attach-picture', payload => {
        const sig = String(payload?.sig ?? '')
        if (!/^[0-9a-f]{64}$/.test(sig)) return
        const key = `image:${sig}`
        if (!this.references().some(held => held.key === key)) {
          this.references.set([...this.references(), {
            key,
            path: [],
            name: String(payload?.name || 'marked-up screen'),
            sig,
            size: Number(payload?.size) || undefined,
            kind: String(payload?.kind || 'image/png'),
          }])
          this.#announceSet()
          void this.#refreshContextThumbs()
        }
        if (payload?.open !== false && !this.visible()) void this.open()
      }))

    // A draft landing anywhere — this composer, another window, a sweep — is
    // a change to the roster, because a conversation that holds only unsent
    // words is still a conversation you must be able to get back to.
    this.#cleanups.push(EffectBus.on('chat:drafts-changed', () => { void this.#refreshDrafts() }))
    this.#cleanups.push(EffectBus.on<{ convoId?: string }>('chat:goal-reached', payload => {
      void this.#refreshList().then(() => {
        if (payload?.convoId === this.activeId()) this.goalOpen.set(true)
      })
    }))

    // ── WHAT THERE IS TO PASTE ───────────────────────────────────────
    // The clipboard's own contents, for the header's flyout. Last-value
    // replay means the shelf's source is current the moment the window
    // opens — including everything gathered before it existed. This is
    // the ONLY writer of `clipboardHeld`; the clipboard owns the truth,
    // and the shelf is filled by pasting FROM it, never by mirroring it.
    this.#cleanups.push(EffectBus.on<{ items?: readonly { label: string; sourceSegments: readonly string[]; sig?: string }[] }>(
      'clipboard:changed', (payload) => {
        const items = Array.isArray(payload?.items) ? payload!.items! : []
        const picks = items.map(item => ({
          key: '/' + [...item.sourceSegments, item.label].join('/'),
          path: [...item.sourceSegments],
          name: item.label,
          sig: item.sig,
        }))
        this.clipboardHeld.set(picks)
        if (!picks.length) this.clipboardOpen.set(false)
        // Both faces draw from one thumbnail cache: an item pasted onto the
        // shelf must not have to re-resolve a picture the flyout just had.
        void this.#refreshContextThumbs()
      }))

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

    // THE SHALLOW TIER'S OWN LANE. Its run outlives this component
    // (host-stream.ts), so the answer reaches the window the same way the
    // bridge's does: as an announcement about a conversation, not as the
    // return value of a call this instance happens to be awaiting.
    this.#cleanups.push(EffectBus.on<{ convoId?: string; text?: string }>(
      'chat:host-chunk', payload => this.#onHostChunk(payload)))
    this.#cleanups.push(EffectBus.on<{ convoId?: string; text?: string; outcome?: string }>(
      'chat:host-done', payload => this.#onHostDone(payload)))

    // WHO ANSWERS CAN CHANGE WHILE YOU ARE LOOKING AT IT — a key arrives, a
    // bridge announces itself, a provider reports its headroom nearly spent,
    // a tier gets pinned. One effect carries all of it (model-policy.ts) and
    // replays its last value, so this both keeps the readout live and does
    // the FIRST read: an essentials build landing after the shell still
    // announces once on load.
    this.#cleanups.push(EffectBus.on('llm:policy-changed', () => this.#refreshDesignation()))

    // The console says when it is up or down; the header's toggle draws
    // itself from that. Replayed, so a window opened while the console is
    // already standing shows it pressed straight away.
    this.#cleanups.push(EffectBus.on<{ open?: boolean }>(
      'providers:state', payload => this.providersOpen.set(!!payload?.open)))

    this.#cleanups.push(EffectBus.on<{ connected?: boolean }>(
      'bridge:status', payload => {
        this.bridgeConfigured.set(isLocalClaudeBridgeConfigured())
        this.bridgeUp.set(!!payload?.connected)
        // A bridge arriving or leaving changes who can answer at all, so the
        // designation is re-read on the same signal the footer's light is.
        this.#refreshDesignation()
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

    // Is the rail on screen? A media query, not a resize handler: the browser
    // already knows, and the stylesheet is asking the same question one line
    // away. Answered once now so the first paint is right.
    if (typeof window.matchMedia === 'function') {
      this.#railQuery = window.matchMedia(RAIL_QUERY)
      this.railVisible.set(this.#railQuery.matches)
      this.#railQuery.addEventListener('change', this.#onRailQuery)
    }

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
    this.#refreshDesignation()
    EffectBus.emit('chat:window-state', { open: this.visible() })
    if (this.visible()) {
      this.#claimSurface(true)
      this.#refreshContext()
      void this.#resume()
    }
    ;(globalThis as { ioc?: { whenReady?: (k: string, cb: () => void) => void } }).ioc
      ?.whenReady?.('@diamondcoreprocessor.com/ChatThreads', () => {
        if (this.enabled() && this.visible() && this.turns().length === 0 && !this.waiting()) void this.#resume()
        // WHETHER OR NOT THE WINDOW IS OPEN. A question left out over a reload
        // is marked on its TILE as much as in here, and the rail's thinking
        // mark is the only sign of it for someone who has the panel folded
        // away. So the pass runs on the threads module arriving, not on the
        // window being looked at.
        void this.#recoverWaits()
      })
    ;(globalThis as { ioc?: { whenReady?: (k: string, cb: (value: unknown) => void) => void } }).ioc
      ?.whenReady?.(HOST_AI_IOC_KEY, value => {
        this.hostConfigured.set(!!(value as HostAiLike | undefined)?.configured)
      })
    ;(globalThis as { ioc?: { whenReady?: (k: string, cb: () => void) => void } }).ioc
      ?.whenReady?.(LLM_ROUTER_IOC_KEY, () => this.#refreshDesignation())
  }

  ngOnDestroy(): void {
    // A leaked enter() strands `view:active` on forever — the canvas and the
    // stickies would never come back.
    this.#claimSurface(false)
    for (const cleanup of this.#cleanups) cleanup()
    window.removeEventListener('synchronize', this.#onSync)
    window.removeEventListener('storage', this.#onStorage)
    window.removeEventListener('online', this.#onNetworkChange)
    window.removeEventListener('offline', this.#onNetworkChange)
    this.#railQuery?.removeEventListener('change', this.#onRailQuery)
    this.#railQuery = null
    if (this.#retryTimer) clearInterval(this.#retryTimer)
    this.#stopClock()
    // A DESTROY IS NOT A STOP. This used to abort the host's stream, so
    // folding the panel away — or any surface swap that rebuilds this
    // component — threw away an answer mid-arrival, unstored. The run lives in
    // host-stream.ts precisely so it can carry on without a window; only the
    // participant pressing Stop calls it back.
    this.#rail?.dispose()
    this.#rail = null
    this.#thumbToken++
    for (const url of this.#thumbUrls.values()) URL.revokeObjectURL(url)
    this.#thumbUrls.clear()
    this.#subjectThumbToken++
    if (this.#subjectThumbUrl) URL.revokeObjectURL(this.#subjectThumbUrl)
    this.#subjectThumbUrl = null
  }

  #retryTimer: ReturnType<typeof setInterval> | null = null

  // ── the wait, told honestly ─────────────────────────────────────────────

  /** Begin waiting: the clock starts, and every state that describes a
   *  previous wait is cleared so nothing from it can be read as current. */
  // A WAIT BELONGS TO ITS CONVERSATION, not to the window.
  //
  // It used to be one flag: opening another thread cleared it, so a question
  // still out on the thread you left lost its clock, its Stop button and its
  // withdraw handle — permanently, since nothing put them back when you
  // returned. With a chat per tile that is the ordinary move, not an edge
  // case: you ask on one tile and step to the next while it thinks.
  //
  // So outstanding asks are held per convoId and the window merely SHOWS the
  // active one. It is also what lets the list mark a tile as thinking: the
  // same record is announced on the bus, keyed by the tile's path.

  // ── A QUESTION SURVIVES THE PAGE ────────────────────────────────────
  //
  // THE ASK WAS ALWAYS DURABLE; THE WAITING WAS NOT.
  //
  // A bridge question is a record in the optimization pool and its answer is
  // written to the thread by the worker, with or without a window open — that
  // half was never in doubt. What died on every reload was everything that
  // SAID SO: `#outstanding` is in-memory, so a refresh mid-question came back
  // with no clock, no Stop, no Withdraw handle, no bee, and no thinking mark on
  // the tile. The question was still out there and the hive showed nothing at
  // all happening — which reads, to the person who asked, exactly like the
  // question having been dropped.
  //
  // So the wait is REBUILT FROM THE RECORD. The pool is the truth about what is
  // outstanding; this is the window catching up to it.

  #recovered = false

  /**
   * Put back every wait the page interruption took away.
   *
   * Two sources, because the two tiers are interrupted differently:
   *
   *   the pool     a bridge ask still marked pending — the answer is coming,
   *                so the clock, Stop and the bee come back and the tile is
   *                marked as thinking again
   *   checkpoints  a host answer that was mid-stream — its connection cannot
   *                outlive the page, so what IS recoverable is the text, filed
   *                as the turn it was becoming (chat-thread.ts)
   *
   * Idempotent and cheap to miss: everything it restores is a re-derivation of
   * something already on disk.
   */
  async #recoverWaits(): Promise<void> {
    if (this.#recovered) return
    this.#recovered = true

    // The interrupted host answers first: they are turns, and a turn wants to
    // be on the thread before the list is walked for it.
    try {
      const recovered = await this.#threads()?.recoverStreamCheckpoints?.(liveHostConvos())
      if (recovered) {
        void this.#refreshList()
        if (this.activeId()) void this.#load(this.activeId())
      }
    } catch { /* the checkpoint stays on disk; the next boot tries again */ }

    const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
    if (!store?.listOptimizations || !store?.getOptimization) return

    let sigs: string[] = []
    try { sigs = await store.listOptimizations() } catch { return }

    // A withdrawn ask leaves a tombstone naming the record it retired. Read
    // them in the same pass, or a question the participant already called back
    // comes home wearing a clock.
    const stopped = new Set<string>()
    const pending: Array<{ sig: string; convoId: string; askedAt: number; prompt: string; model: string }> = []

    for (const sig of sigs.slice(0, RECOVER_SCAN_LIMIT)) {
      let record: {
        kind?: string
        payload?: {
          mode?: string
          askSig?: string
          status?: string
          convoId?: string
          askedAt?: number
          prompt?: string
          model?: string
        }
      } | undefined
      try {
        const blob = await store.getOptimization(sig)
        if (!blob) continue
        record = JSON.parse(await blob.text())
      } catch { continue }
      if (record?.kind !== 'ask') continue
      const payload = record.payload ?? {}
      const mode = String(payload.mode ?? '')
      if (mode === 'stop') { stopped.add(String(payload.askSig ?? '')); continue }
      if (mode !== 'chat') continue
      if (String(payload.status ?? 'pending') !== 'pending') continue
      const convoId = String(payload.convoId ?? '')
      if (!convoId) continue
      pending.push({
        sig,
        convoId,
        askedAt: Number(payload.askedAt) || 0,
        prompt: String(payload.prompt ?? ''),
        model: String(payload.model ?? ''),
      })
    }

    const now = Date.now()
    for (const ask of pending) {
      if (stopped.has(ask.sig)) continue
      // A wait this window already knows about outranks the record: it was
      // started here, this session, and its sig is already on it.
      if (this.#outstanding.has(ask.convoId)) continue
      if (!ask.askedAt || now - ask.askedAt > RECOVER_MAX_AGE_MS) continue

      this.#outstanding.set(ask.convoId, { sig: ask.sig, askedAt: ask.askedAt })
      this.#announceBusy(ask.convoId, true)
      // The bee is raised with the model the RECORD names, not the composer's:
      // what is out there was asked of a particular tier, and re-branding it
      // with whatever the window happens to be set to now would be the
      // confident-looking wrong answer the registry re-brands to avoid.
      this.#raiseBee(ask.convoId, ask.prompt, ask.model || this.#answeringModel())
      if (ask.convoId === this.activeId()) this.#syncWait(ask.convoId)
    }
  }

  #startWait(convoId: string, question = ''): void {
    this.#outstanding.set(convoId, { sig: '', askedAt: Date.now() })
    this.#announceBusy(convoId, true)
    this.#raiseBee(convoId, question)
    this.#syncWait(convoId)
  }

  // ── A QUESTION IS A UNIT OF WORK, so it gets a bee ──────────────────
  //
  // Every other kind of work in the hive raises one — an ask from the ask
  // screen, a routine, a sync — and the one thing a person does most often
  // did not. A chat question was visible only inside this window: send it,
  // fold the window away, and the hive showed nothing at all happening, on
  // the tile it was happening to.
  //
  // WHOSE MODEL IT IS COMES FOR FREE. The registry derives kind → vendor →
  // tier from the model at spawn (`#identity` / `identifyModel`), so
  // declaring `kind: 'model'` and the model in hand is the whole of the
  // branding — this surface never names a colour, which is what keeps the
  // vendor accent bounds a contract rather than a convention.
  //
  // WHERE THE BEE SITS is the tile's own label, with the rest of its path as
  // the segments — the shape the bee drone matches against the cells painted
  // on the current layer. A chat about no tile (the hive's own) leaves both
  // empty, which is exactly how that drone spells "hive-wide": it flies at
  // the root instead of over a cell.
  //
  // Shared UI must never import essentials, and does not: this is the same
  // `agent:start` / `agent:end` lane any behaviour uses, and a shell with no
  // registry simply has nobody listening.

  /** One bee per conversation — `#outstanding` is keyed the same way, so a
   *  second question cannot exist while the first is out. */
  #beeId(convoId: string): string { return `chat:${convoId}` }

  /** WHO IS ABOUT TO ANSWER. With a session on the bridge it is the model the
   *  composer is set to; without one the shallow host takes it, and that tier
   *  has its own model. Not a guess and not something to be discovered from
   *  the reply — the same `bridgeUp()` the send path branches on, read one
   *  moment earlier. */
  #answeringModel(): string {
    return this.providerReady() ? this.answering() : this.bridgeUp() ? this.answering() : HOST_TIER_MODEL
  }

  #raiseBee(convoId: string, question: string, model = this.#answeringModel()): void {
    const path = this.#threads()?.tilePathOf?.(convoId) ?? ''
    const parts = path.split('/').filter(Boolean)
    EffectBus.emit('agent:start', {
      id: this.#beeId(convoId),
      behavior: model,
      kind: 'model',
      model,
      request: question,
      // The tile it is about; empty for the hive's own conversation.
      targets: parts.length ? [parts[parts.length - 1]] : [],
      segments: parts.slice(0, -1),
    })
  }

  /** Stop waiting, whatever ended it — an answer, a failure, a withdrawal.
   *  Defaults to the conversation on screen; an answer landing on a thread
   *  you have since left ends THAT one. */
  #endWait(convoId: string = this.activeId()): void {
    if (this.#outstanding.delete(convoId)) {
      this.#announceBusy(convoId, false)
      // Guarded on the delete for the same reason the announce is: every path
      // that ends a wait comes through here, and several of them can fire for
      // one question (an answer that also fails a bump, a withdrawal that
      // races an arrival). Ending a bee twice would be harmless; raising the
      // toast of a second `agent:end` on an id the registry has already
      // retired is noise in its log.
      EffectBus.emit('agent:end', { id: this.#beeId(convoId), ok: true })
    }
    if (convoId === this.activeId()) this.#syncWait(convoId)
  }

  /** Paint the wait state of one conversation — called on every arrival at a
   *  thread, so a question still out is found exactly as it was left. */
  #syncWait(convoId: string): void {
    const out = this.#outstanding.get(convoId)
    this.#stopClock()
    if (!out) {
      this.waiting.set(false)
      this.hostStreaming.set(false)
      this.streaming.set('')
      this.pendingSig.set('')
      this.elapsed.set(0)
      return
    }
    this.waiting.set(true)
    this.askedAt.set(out.askedAt)
    this.pendingSig.set(out.sig)
    // A HOST ANSWER STILL ARRIVING ON THIS THREAD. The run kept the text while
    // the window was elsewhere; arriving is where it gets picked back up.
    this.#attachHostRun(convoId)
    this.elapsed.set(Math.max(0, Math.round((Date.now() - out.askedAt) / 1000)))
    this.#elapsedTimer = setInterval(() => {
      if (!this.waiting()) { this.#stopClock(); return }
      this.elapsed.set(Math.max(0, Math.round((Date.now() - this.askedAt()) / 1000)))
    }, ELAPSED_TICK_MS)
  }

  /** Tell the list which tile is thinking. The rail cannot see this window's
   *  state and must not try — it hears the fact and paints it. */
  #announceBusy(convoId: string, busy: boolean): void {
    const path = this.#threads()?.tilePathOf?.(convoId)
    if (!path) return
    EffectBus.emit('chat:tile-busy', { path, busy })
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
      // The run keeps whatever had already arrived and stores it — stopping is
      // not discarding. Its `chat:host-done` ends the wait.
      stopHostRun(this.activeId())
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
    this.#refreshDesignation()
    const prefill = String(payload?.prefill ?? '').trim()
    this.visible.set(true)
    rememberChatVisibility(true)
    // Reopening always lands on the conversation, never folded away.
    this.peeking.set(false)
    this.#claimSurface(true)
    this.#applyFold()
    // Announce symmetrically with close() — the controls-bar launcher light
    // (and anything else watching) reads this state.
    EffectBus.emit('chat:window-state', { open: true })
    if (!this.enabled()) return
    this.#refreshContext()
    this.bridgeUp.set(!!(ioc()?.get('@diamondcoreprocessor.com/ClaudeBridgeWorker') as BridgeLike | undefined)?.connected)
    this.#refreshDesignation()

    if (payload?.convoId) { await this.#refreshList(); await this.#load(payload.convoId) }
    else if (prefill) { await this.#refreshList(); this.newChat() }
    else await this.#resume()

    // After the conversation is settled, so it is not overwritten by the
    // remembered model of the thread we just loaded.
    if (payload?.model) this.setModel(payload.model)

    if (prefill) { await this.send(prefill); return }
    await this.#restoreDraft()
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
      // AN ARCHIVED THREAD IS NEVER "where you were" — resuming into one
      // would undo the act on the next reload. `latestTurns` skips them for
      // the same reason, so the two agree about which thread this is.
      const recent = conversations.find(convo => !convo.archived)
      if (recent) {
        this.activeId.set(recent.convoId)
        this.model.set(this.#rememberedModel(recent.convoId))
        this.modelExplicit.set(false)
        this.streaming.set('')
        this.turns.set(latestTurns)
        this.#syncWait(recent.convoId)
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
    const recent = this.conversations().find(convo => !convo.archived)
    if (recent) await this.#load(recent.convoId)
    else this.newChat(false)
  }

  close(): void {
    if (!this.visible()) return
    this.visible.set(false)
    rememberChatVisibility(false)
    this.peeking.set(false)
    this.#claimSurface(false)
    this.#applyFold()
    this.listOpen.set(false)
    this.armed.set('')
    // Closing the window is a real close: the sidebar's trail and subject go
    // down with it.
    // The half-written thought does NOT: it is flushed first, so closing the
    // window is never how you lose it.
    void this.#flushDraft()
    this.#rail?.dispose()
    this.#rail = null
    this.railSubject.set(null)
    // The shelf is NOT reset: coming back to a conversation you were part-way
    // through composing must find the references you had put on it. What
    // dies with the window is the flyout and the rail's pick bookkeeping.
    this.clipboardOpen.set(false)
    this.#railSeen = new Map()
    EffectBus.emit('chat:window-state', { open: false })
  }

  #railBounds(): { min: number; max: number } {
    const panel = this.panel()?.nativeElement
    const room = panel ? panel.getBoundingClientRect().width - CONVERSATION_MIN : RAIL_MAX
    return { min: RAIL_MIN, max: Math.max(RAIL_MIN, Math.min(RAIL_MAX, room)) }
  }

  #setRailWidth(next: number): void {
    const { min, max } = this.#railBounds()
    const width = Math.round(Math.min(max, Math.max(min, next)))
    this.railWidth.set(width)
    try { localStorage.setItem(RAIL_WIDTH_KEY, String(width)) } catch { /* private mode */ }
  }

  startRailDrag(event: PointerEvent): void {
    const grip = event.target as HTMLElement | null
    const rail = this.chatRail()?.nativeElement
    if (!grip || !rail) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = rail.getBoundingClientRect().width
    this.railDragging.set(true)
    grip.classList.add('dragging')
    try { grip.setPointerCapture(event.pointerId) } catch { /* older engines use the window listeners */ }
    const move = (moved: PointerEvent): void => this.#setRailWidth(startWidth + moved.clientX - startX)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      grip.classList.remove('dragging')
      this.railDragging.set(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  resetRailWidth(): void {
    this.railWidth.set(0)
    try { localStorage.removeItem(RAIL_WIDTH_KEY) } catch { /* private mode */ }
  }

  onRailGripKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 40 : 12
    const rail = this.chatRail()?.nativeElement
    const current = this.railWidth() || rail?.getBoundingClientRect().width || RAIL_MIN
    if (event.key === 'ArrowLeft') { event.preventDefault(); this.#setRailWidth(current - step) }
    else if (event.key === 'ArrowRight') { event.preventDefault(); this.#setRailWidth(current + step) }
    else if (event.key === 'Home') { event.preventDefault(); this.resetRailWidth() }
  }

  onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    // The cascade unwinds the smallest commitment first: the tile you are
    // talking to, then the window — matching the escape-cascade's
    // outermost-first rule.
    // The flyout is the smallest thing open, so it unwinds first.
    if (this.clipboardOpen()) { this.clipboardOpen.set(false); return }
    // Folded away is a smaller commitment than the window itself: Escape
    // brings the conversation back before it takes the window down.
    if (this.peeking()) { this.togglePeek(); return }
    // Then the RAIL'S OWN picks; a reference on the shelf is let go with its
    // × or by dragging it back, never by a keystroke that means "go up".
    if (this.#railSeen.size) { this.#rail?.clearSelection(); return }
    if (this.railSubject()) { this.#rail?.clearSubject(); return }
    this.close()
  }

  // ── conversations ───────────────────────────────────────────────────────

  async #refreshList(): Promise<void> {
    const threads = this.#threads()
    if (!threads) return
    this.conversations.set(await threads.listConversations())
    await this.#refreshDrafts()
  }

  /** Read every held draft, so the roster can show the conversations that
   *  exist only as something you were part-way through saying. */
  async #refreshDrafts(): Promise<void> {
    const threads = this.#threads()
    if (!threads?.listTileDrafts) return
    try {
      const held = await threads.listTileDrafts()
      this.drafts.set(held.map(entry => ({ key: entry.path, text: entry.text })))
    } catch { /* the roster degrades to turns-only, never to an error */ }
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
    this.modelExplicit.set(false)
    this.streaming.set('')
    const turns = await threads.readTurns(convoId)
    // A slow read landing after the participant moved on must not paint one
    // thread's turns under another thread's name — checked BEFORE the paint
    // (it used to sit after the set, guarding only the scroll).
    if (this.activeId() !== convoId) return
    this.turns.set(turns)
    this.#syncWait(convoId)
    // Arriving IS reading: the newest turn here is no longer unread, which is
    // what takes the bold off this tile's row in the list.
    threads.markConversationSeen?.(convoId, turns[turns.length - 1]?.at ?? Date.now())
    EffectBus.emit('chat:threads-changed', { convoId })
    // Switching threads re-pins: you are arriving at a conversation, and its
    // newest turn is where arriving means.
    this.#scrollDown(true)
  }

  // ── a conversation per tile ─────────────────────────────────────────────
  //
  // Clicking a row in the sidebar IS entering that tile's chat, so two things
  // move together: the transcript becomes that tile's thread, and the composer
  // becomes that tile's unsent thinking. Neither ACTIVATES anything — arriving
  // at a tile starts nothing, and the words you left there start nothing until
  // you send them.
  //
  // What you type is held as you type it. That is the whole point: you can
  // think tactically across the hive — a line here, a line three tiles over —
  // and come back to finish, delete, or send any of them. An orchestrator
  // coming through later reads the same pool and can decide what is worth
  // doing; until then the thinking just sits where you left it.

  /** Where the composer's text is held: the tile, when the open conversation
   *  belongs to one, else the conversation itself (a free-floating chat keeps
   *  its draft too — it is a conversation like any other, it just has no row). */
  #draftKey(): string {
    const id = this.activeId()
    return this.#threads()?.tilePathOf?.(id) || id
  }

  /** Hold what is in the composer. Debounced: typing must not be a write per
   *  keystroke, and the flushes on the way out of anything (switching tiles,
   *  sending, closing) mean the debounce can never be the last word. */
  #holdDraft(): void {
    if (this.#draftTimer !== null) clearTimeout(this.#draftTimer)
    this.#draftTimer = setTimeout(() => { this.#draftTimer = null; void this.#flushDraft() }, DRAFT_HOLD_MS)
  }

  /** Write the composer's text where it belongs, now. */
  async #flushDraft(key?: string): Promise<void> {
    if (this.#draftTimer !== null) { clearTimeout(this.#draftTimer); this.#draftTimer = null }
    const threads = this.#threads()
    const target = key ?? this.#draftKey()
    if (!threads?.saveTileDraft || !target) return
    const text = this.input()?.nativeElement?.value ?? ''
    if (text === this.#heldDraft) return
    this.#heldDraft = text
    await threads.saveTileDraft(target, text)
  }

  /** Put a conversation's unsent thinking back in the composer. */
  async #restoreDraft(): Promise<void> {
    const threads = this.#threads()
    const key = this.#draftKey()
    const text = key && threads?.readTileDraft ? await threads.readTileDraft(key) : ''
    // A slow read must not overwrite a box the participant has since moved on
    // from — the key it was read for has to still be the open one.
    if (key !== this.#draftKey()) return
    this.#heldDraft = text
    const element = this.input()?.nativeElement
    if (!element) return
    element.value = text
    this.autosize(element)
  }

  /** The sidebar clicked a row: leave the current thinking where it is, then
   *  arrive in that tile's conversation. A tile nobody has spoken to reads as
   *  an empty thread — dormant, not missing. */
  async #enterSubject(subject: RailPickLike | null): Promise<void> {
    await this.#flushDraft()
    this.railSubject.set(subject)
    if (!subject) return
    // WHICH conversation, not just which tile. The rail hands the exact id —
    // a tile holds several, and the hive's own row hands a global one whose
    // path is `/`, which no tile-name derivation could ever produce. Falling
    // back to the derivation only for an older rail that sends no id.
    const convoId = subject.convoId
      || this.#threads()?.tileConvoId?.([...subject.path, subject.name])
    if (convoId) await this.#load(convoId)
    await this.#restoreDraft()
    this.listOpen.set(false)
    this.#focus()
  }

  /** Start a fresh thread. It does not appear in the list until it holds a
   *  turn — an empty conversation is not yet a conversation. `focus` is false
   *  only on the boot path: the default view opens beside the command line and
   *  must not steal its cursor. */
  newChat(focus = true): void {
    const threads = this.#threads()
    void this.#flushDraft()
    // A CHAT ABOUT A TILE BELONGS UNDER THAT TILE. When the rail has a tile
    // in hand it mints the id and lists the new row itself — the window would
    // otherwise start a thread about nothing in particular, which is
    // unlistable: no row can hold it. It answers false when there is no tile,
    // and then a free chat is the honest thing to make.
    if (this.#rail?.newChatOnSubject?.()) { if (focus) this.#focus(); return }
    this.activeId.set(threads?.newConvoId() ?? '')
    this.#heldDraft = ''
    const box = this.input()?.nativeElement
    if (box) { box.value = ''; this.autosize(box) }
    this.turns.set([])
    this.streaming.set('')
    // A NEW CONVERSATION HAS NAMED NOBODY. Carrying the last thread's named
    // model into it was survivable while a picker showed what it was; with
    // the policy designating, an inherited name is a silent override of the
    // participant's own standing instructions.
    this.model.set('')
    this.modelExplicit.set(false)
    this.#refreshDesignation()
    this.#endWait()
    this.listOpen.set(false)
    this.armed.set('')
    this.atBottom.set(true)
    if (focus) this.#focus()
  }

  async pick(convoId: string): Promise<void> {
    this.listOpen.set(false)
    this.armed.set('')
    await this.#flushDraft()
    this.railSubject.set(null)
    this.#rail?.clearSubject()
    await this.#load(convoId)
    // Every conversation holds its own unsent thinking, whether or not it
    // belongs to a tile — arriving anywhere puts it back.
    await this.#restoreDraft()
    this.#focus()
  }

  /** First press arms, second deletes. */
  async remove(convoId: string, event: MouseEvent): Promise<void> {
    event.stopPropagation()
    if (this.armed() !== convoId) { this.armed.set(convoId); return }
    this.armed.set('')
    const threads = this.#threads()
    if (!threads) return

    // A DRAFT-ONLY ROW IS THE DRAFT. Deleting the (empty) bucket would leave
    // the words in the pool and the row would come straight back on the next
    // refresh. A conversation that HOLDS TURNS is different: its tile's
    // unsent thinking is standing intent about the tile, not part of the
    // thread being thrown away, and it stays.
    const row = this.roster().find(entry => entry.convoId === convoId)
    if (row && row.turnCount === 0 && row.draft) {
      const key = threads.tilePathOf?.(convoId) || convoId
      await threads.saveTileDraft?.(key, '')
    }

    // Leaving the conversation being deleted must not carry its words into
    // the next one: the box is emptied and the pending debounce cancelled
    // BEFORE anything else is loaded.
    if (this.activeId() === convoId) {
      if (this.#draftTimer !== null) { clearTimeout(this.#draftTimer); this.#draftTimer = null }
      this.#heldDraft = ''
      const box = this.input()?.nativeElement
      if (box) { box.value = ''; this.autosize(box) }
    }

    await threads.deleteConversation(convoId)
    await this.#refreshList()
    if (this.activeId() === convoId) {
      // Never land in something that was put away — the same rule resume follows.
      const next = this.conversations().find(convo => !convo.archived)
      if (next) { await this.#load(next.convoId); await this.#restoreDraft() }
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

  /** What this thread was last held in, or `''` — a thread nobody has named a
   *  model for is not a thread that chose the default, and the difference is
   *  what lets the policy designate for it. */
  #rememberedModel(convoId: string): string {
    const remembered = this.#modelMap()[convoId]
    return typeof remembered === 'string' ? remembered.trim().toLowerCase() : ''
  }

  /** NAMING A MODEL for this conversation — the command line's `/opus`, its
   *  bracket form, or a `chat:open` that carried one. No longer restricted to
   *  the four Claude words: a bridge announces its own model words
   *  (llm.queen's slash provider), and a word the participant typed is an
   *  override whichever roster it came from. */
  setModel(requested: string): void {
    const next = String(MODEL_ALIASES[requested] ?? requested ?? '').trim().toLowerCase()
    if (!next) return
    this.model.set(next)
    this.modelExplicit.set(true)
    this.#remember(next)
  }

  /** Write what this conversation is being held in. Called when a model is
   *  NAMED and again when a question actually leaves — the map is a record of
   *  who took the last question, which is what the render layer brands a
   *  tile's resting bee from. */
  #remember(model: string): void {
    const id = this.activeId()
    if (!id || !model) return
    try {
      const map = this.#modelMap()
      if (map[id] === model) return
      map[id] = model
      localStorage.setItem(MODEL_KEY, JSON.stringify(map))
    } catch { /* participant-local convenience — never worth failing a send */ }
  }

  /** ASK THE POLICY WHO ANSWERS. A chat question is the deep, hive-reading
   *  kind — that is the whole difference between this window and a routine's
   *  one-shot call — so the need is stated once, here.
   *
   *  Read at the moments the answer could have changed (opening, the bridge
   *  coming or going, sending) rather than watched: the providers console is
   *  where it changes, and you cannot be in it and in here at once. */
  /** THE ONE PLACE IT IS CHOSEN. Company, model and level of thinking are set
   *  in the providers console — pinned per tier, or left to the policy — and
   *  this window points at it rather than keeping a second, smaller answer to
   *  the same question. */
  openProviders(): void {
    EffectBus.emit('providers:open', {})
  }

  #refreshDesignation(): void {
    const policy = ioc()?.get('@diamondcoreprocessor.com/LlmPolicyStore') as PolicyLike | undefined
    const need = { tier: 'fast', streaming: true }
    this.designated.set(policy?.designate?.(need) ?? null)
    const router = ioc()?.get(LLM_ROUTER_IOC_KEY) as LlmRouterLike | undefined
    this.providerReady.set(!!router?.ready?.({
      model: this.modelExplicit() ? this.model() || undefined : undefined,
      preferModel: !this.modelExplicit() ? this.model() || undefined : undefined,
      need,
    }))
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

  /** What the question is about: the canvas selection, plus the tile whose
   *  conversation is open. A subject on the CURRENT page rides as a bare name
   *  — exactly the shape a selection target has always had — and one from a
   *  drilled level rides as its full `/path/name`, which is self-describing
   *  to the responder without any protocol change. */
  #chosenTargets(): string[] {
    // THE TARGET IS THE CONVERSATION'S OWN TILE. Nothing to choose and
    // nothing to keep in step: you are talking to a tile, so that tile is
    // what the answer may change. (Reading it off the sidebar instead meant a
    // chat opened from the roster — or in the docked window, which has no
    // sidebar — asked its question about nothing.)
    const path = this.subjectPath()
    if (!path || path === '/') return [...new Set(this.targets())]
    const segments = path.split('/').filter(Boolean)
    const hereJson = JSON.stringify(this.here())
    const parent = segments.slice(0, -1)
    const named = JSON.stringify(parent) === hereJson ? segments[segments.length - 1] : path
    return [...new Set([...this.targets(), named])]
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
    this.#refreshDesignation()
    if (!this.enabled()) return
    // BEFORE the bee is raised: the wait indicator brands one, and a bee
    // wearing a designation that is one question out of date is exactly the
    // confident-looking wrong answer the registry re-brands to avoid.
    const element = this.input()?.nativeElement
    const message = String(text ?? element?.value ?? '').trim()
    if (!message) return

    const threads = this.#threads()
    const queen = this.#queen()
    if (!threads) {
      EffectBus.emit('toast:show', {
        type: 'warning',
        message: 'Chat service unavailable — try again in a moment.',
      })
      return
    }

    let convoId = this.activeId()
    if (!convoId) { convoId = threads.newConvoId(); this.activeId.set(convoId) }

    if (element && text === undefined) { element.value = ''; this.autosize(element) }
    // SENT IS NOT HELD. The thinking became a turn; leaving a copy in the
    // drafts pool would show the tile as still having something unsaid.
    void this.#flushDraft()

    const turn: ChatTurn = { kind: 'chat-turn', convoId, role: 'user', text: message, at: Date.now() }
    this.turns.update(list => [...list, turn])
    this.#startWait(convoId, message)
    // Sending is the one arrival the participant caused, so it re-pins the
    // transcript even if they had scrolled up to read something.
    this.#scrollDown(true)

    const stored = await threads.appendTurn(convoId, 'user', message)
    if (!stored) console.warn('[chat] the question was not stored — it will be missing after a reload')

    // THREE TIERS, one window. The provider router is first: it covers local
    // Ollama and participant-keyed APIs, applies policy, and owns bounded
    // fallback. It cannot take an explicitly named bridge model, so those
    // choices fall through without silently changing vendor.
    const routed = await this.#askProvider(convoId, message)
    if (routed === 'answered' || routed === 'aborted') return

    // The two legacy transports remain honest fallbacks.
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
      // THE ENDING IS NOT THIS CALL'S RETURN VALUE. `chat:host-done` paints,
      // stores and counts it (`#onHostDone`), because the run outlives this
      // component and its answer must land whether or not anybody is still
      // awaiting here. What comes back is only the ROUTING decision.
      const outcome = await this.#askHost(convoId, message)
      if (outcome === 'answered') return
      // STOPPED BY THE PARTICIPANT. Handing a question they just called back
      // to the durable bridge queue would be the opposite of what Stop means.
      if (outcome === 'aborted') return
    }

    // A participant-host failure is retryable, but without a configured local
    // bridge there is nobody who could ever drain the durable bridge queue.
    if (!this.bridgeConfigured() || !queen?.submitChat) {
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

    // THE TIER CHANGED UNDER THE QUESTION. Getting here with the bridge down
    // means the shallow host declined it and the durable queue will answer
    // instead — with the composer's model, not the host's. The bee was
    // branded for the tier that was going to take it, so it is re-branded
    // for the one that actually did.
    if (!this.bridgeUp()) this.#raiseBee(convoId, message, this.answering())

    // WHAT ANSWERED IS WHAT THE THREAD IS HELD IN. The hint and the brand are
    // one string (`answering`), and writing it down here is what lets the
    // tile's resting bee wear the designation after this window is closed.
    queen.activeModel = this.answering()
    this.#remember(this.answering())
    const queued = await queen.submitChat(
      convoId, message, this.#chosenTargets(), transcript, this.referencePayload())
    if (!queued) {
      this.#endWait()
      EffectBus.emit('toast:show', { type: 'warning', message: 'Could not send — try again.' })
    } else if (typeof queued === 'string') {
      // The ask's record signature: the handle Withdraw pulls on. An older
      // essentials build answers `true` instead, and then the question is
      // queued but not recallable from here. It is stored ON the conversation
      // so stepping away and back finds Withdraw still armed.
      const out = this.#outstanding.get(convoId)
      if (out) this.#outstanding.set(convoId, { ...out, sig: queued })
      if (convoId === this.activeId()) this.pendingSig.set(queued)
    }
    if (!this.#bumpList(convoId)) void this.#refreshList()
  }

  /** Direct provider route (local Ollama or a configured API key). The
   * transcript is the context these providers can honestly see; unlike a
   * bridge, this path never claims it can walk the hive. */
  async #askProvider(convoId: string, message: string): Promise<'answered' | 'declined' | 'aborted'> {
    const router = ioc()?.get(LLM_ROUTER_IOC_KEY) as LlmRouterLike | undefined
    const need = { tier: 'fast', streaming: true }
    const namedModel = this.modelExplicit() ? this.model() || undefined : undefined
    const preferModel = !this.modelExplicit() ? this.model() || undefined : undefined
    if (!router?.stream || !router.ready?.({ model: namedModel, preferModel, need })) return 'declined'

    const messages = this.turns().slice(-TRANSCRIPT_TURNS).map(turn => ({
      role: turn.role,
      content: turn.text,
    }))
    const about = this.#chosenTargets()
    const system = about.length
      ? `You are helping inside Hypercomb. The participant says this conversation is about: ${about.join(', ')}. Do not claim to have read tile contents unless they are present in the messages.`
      : 'You are helping inside Hypercomb. Be accurate and concise. Do not claim to have read hive contents unless they are present in the messages.'

    const component = this
    const ask: HostAsk = async function* (_question, opts) {
      for await (const chunk of router.stream!({
        model: namedModel,
        preferModel,
        need,
        messages,
        system,
        signal: opts?.signal,
      })) {
        // The route that emitted text is the truth, including after a
        // pre-output fallback. Keep the footer, resting bee and transcript's
        // remembered model aligned with that actual answer.
        component.designated.set({
          providerId: chunk.providerId,
          label: chunk.providerLabel,
          vendor: chunk.vendor,
          tier: 'fast',
          model: chunk.model,
          name: chunk.model,
        })
        component.model.set(chunk.model)
        component.modelExplicit.set(false)
        component.#remember(chunk.model)
        yield chunk.text
      }
      return ''
    }

    EffectBus.emit('agent:progress', {
      id: this.#beeId(convoId),
      activity: `routing to ${this.designated()?.label ?? 'a configured provider'}`,
    })
    if (convoId === this.activeId()) this.hostStreaming.set(true)
    const threads = this.#threads()
    return startHostRun(convoId, message, { ask }, {
      appendTurn: (id, role, text) => threads?.appendTurn(id, role as 'user' | 'assistant', text) ?? Promise.resolve(false),
      saveStreamCheckpoint: (id, text) => threads?.saveStreamCheckpoint?.(id, text) ?? Promise.resolve(false),
    })
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
   * THE RUN IS NOT THIS COMPONENT'S. It lives in `host-stream.ts`, at module
   * scope, keyed by conversation — because a streamed answer must survive
   * everything short of the page itself going away, and this window is one of
   * the things that can end without the question having been answered. The
   * loop stores the turn itself; what is left here is the painting.
   *
   * A partial answer is KEPT on abort: the host really did say those words,
   * and throwing them away punishes the person for stopping a stream they had
   * already read half of.
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

    // The shallow tier cannot read the hive, so chosen tiles reach it the
    // only way they can: named in the question itself. Wire-only — the
    // stored turn stays the participant's own words.
    const about = this.#chosenTargets()
    const question = about.length ? `${message}\n\n(About: ${about.join(', ')})` : message

    EffectBus.emit('agent:progress', {
      id: this.#beeId(convoId),
      activity: 'answering on the shallow tier — your AI host',
    })

    if (convoId === this.activeId()) this.hostStreaming.set(true)

    // The threads module is resolved ONCE and handed to the run, because the
    // run may still be going when this window is not: it must not have to come
    // back through a component to find somewhere to put the answer.
    const threads = this.#threads()
    return startHostRun(convoId, question, host as { ask?: HostAsk }, {
      appendTurn: (id, role, text) => threads?.appendTurn(id, role as 'user' | 'assistant', text) ?? Promise.resolve(false),
      saveStreamCheckpoint: (id, text) => threads?.saveStreamCheckpoint?.(id, text) ?? Promise.resolve(false),
    }, { contextSigs })
  }

  /** A chunk landed. Only the conversation on screen is painted — the text
   *  itself is accumulated in the run, not here, so switching away and back
   *  finds the answer exactly as far along as it really is. */
  #onHostChunk(payload?: { convoId?: string; text?: string }): void {
    const convoId = String(payload?.convoId ?? '')
    if (!convoId || convoId !== this.activeId()) return
    this.hostStreaming.set(true)
    this.streaming.set(String(payload?.text ?? ''))
    this.#scrollDown()
  }

  /**
   * A host answer finished — stored by the run before this fired.
   *
   * Every ending comes through here, including the ones that used to be
   * unreachable from a destroyed component: the wait ends, the bee is retired,
   * and the turn is painted if this window is still on that thread. A window
   * that has since moved on paints nothing and re-reads the list instead; a
   * window that was rebuilt mid-stream re-attached on arrival and is holding
   * the same conversation, so it takes the same branch as the one that asked.
   */
  #onHostDone(payload?: { convoId?: string; text?: string; outcome?: string }): void {
    const convoId = String(payload?.convoId ?? '')
    if (!convoId) return
    const text = String(payload?.text ?? '')
    const outcome = String(payload?.outcome ?? '')

    if (convoId === this.activeId()) {
      this.streaming.set('')
      this.hostStreaming.set(false)
    }

    // DECLINED IS NOT AN ENDING. The host could not take the question, and
    // `send()` is still standing there deciding whether the durable bridge
    // queue gets it — ending the wait here would blink the indicator off
    // under a question that is about to be asked again.
    if (outcome === 'declined' && !text.trim()) return

    if (text.trim()) {
      if (convoId === this.activeId()) {
        this.turns.update(list => [...list, {
          kind: 'chat-turn', convoId, role: 'assistant', text, at: Date.now(),
        }])
        this.#threads()?.markConversationSeen?.(convoId, Date.now())
        this.#scrollDown()
      }
      if (!this.#bumpList(convoId, 2)) void this.#refreshList()
      EffectBus.emit('chat:threads-changed', { convoId })
    }
    this.#endWait(convoId)
  }

  /** Re-attach to an answer still arriving on the conversation being shown.
   *  A window rebuilt mid-stream (folded away and back, a surface swap, a
   *  route change) finds the partial where the run kept it. */
  #attachHostRun(convoId: string): void {
    const live = liveHostRun(convoId)
    if (!live) return
    this.hostStreaming.set(true)
    this.streaming.set(live.text)
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
    // the real walk only when it is not. Its wait ends all the same (the
    // question really was answered), and its tile is left UNREAD, which is
    // the mark that brings you back to it.
    if (convoId !== this.activeId()) {
      this.#endWait(convoId)
      if (!this.#bumpList(convoId)) void this.#refreshList()
      EffectBus.emit('chat:threads-changed', { convoId })
      return
    }

    const at = Date.now()
    this.turns.update(list => [...list, {
      kind: 'chat-turn', convoId, role: 'assistant', text, at,
    }])
    this.#endWait(convoId)
    // Read as it lands: you are looking straight at it.
    this.#threads()?.markConversationSeen?.(convoId, at)
    this.#scrollDown()
    if (!this.#bumpList(convoId)) void this.#refreshList()
    EffectBus.emit('chat:threads-changed', { convoId })
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
    // Through the SAME cascade the window itself runs — the caret lives in
    // this box (every focus() lands here), so an Escape that closed the whole
    // window directly would throw away picked tiles and the drilled trail
    // from the one place Escape is most likely to be pressed.
    if (event.key === 'Escape') this.onKey(event)
  }

  /** Grow with the message, to a ceiling — past that the box scrolls, so the
   *  transcript never loses the screen to a long draft. */
  autosize(element: HTMLTextAreaElement): void {
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`
  }

  onInput(event: Event): void {
    this.autosize(event.target as HTMLTextAreaElement)
    this.#holdDraft()
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
