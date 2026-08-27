// chat-window.view.ts — THE CHAT WINDOW, as a framework-free custom element
// (everything-is-a-beehavior Phase 2: the Angular panels leave the shell and
// ship as signed modules).
//
// A straight port of shared/ui/chat-window: same surface name
// (hc-chat-window), same order band (113), same panel id ('chat-window' — so
// the participant's saved width, text size, code font and group membership all
// come across), the same effects in and out, and the same four stylesheets
// expanded to one plain-CSS string. It lands in `assistant/` beside the
// machinery it is the visible half of: chat-thread.ts (the durable turns),
// chat-blurb.ts (the sticky summaries), agent-tiles-rail.ts (the sidebar it
// mounts through IoC) and chat-context-action.drone.ts (the per-tile icon that
// only exists while this window is folded away).
//
// ── WHAT IT IS FOR ─────────────────────────────────────────────────────────
//
// Talk to Claude about the hive. One tool window, one conversation per chat,
// and nothing else to learn. You type, Claude answers, the answer is in the
// window. Writing a note is something Claude DOES — "put that on the Genome
// tile" is a sentence, not a button — and it shows up in the hive.
//
// Every chat is its own thread with its own id, and threads are DURABLE: they
// live in the `sign('threads')` pool, so closing the window costs nothing and a
// second device sees the same threads. Where you are standing and what you have
// selected ARE the context, reported in one line above the input.
//
// ── THE FOUR THINGS THAT MADE THIS PORT DIFFERENT ──────────────────────────
//
// 1. IT STREAMS. `chat:host-chunk` arrives token by token while a reply is
//    being written. `#paintStream()` MUTATES the live message node's innerHTML
//    and touches nothing else — rebuilding the transcript per chunk would be a
//    catastrophic regression, and it would take the composer's caret with it on
//    every token.
//
// 2. THE COMPOSER IS THE MOST IMPORTANT CARET IN THE APP. The `<textarea>` is
//    created exactly ONCE per activation, in `#buildChat()`, and no render path
//    replaces it or any ancestor of it: `#renderFoot()` writes text into the
//    link row, swaps only the trailing send/stop BUTTON of `.chat-inputrow`,
//    and replaces only `.chat-status`'s two optional chips — the model
//    `<select>`, the path span and the textarea are built once and mutated in
//    place. `#renderThread()` reaches only into `.chat-thread`. The one thing
//    that does rebuild the footer is the setup ⇄ chat branch swap, which is
//    exactly what Angular's `@if (showSetup())` did.
//
// 3. THE TRANSCRIPT IS KEYED, NOT REBUILT. Angular kept one `<div
//    class="chat-thread">` for the panel's whole life and `@for … track`
//    removed only the rows that left, so a turn landing while you read
//    something further up never moved the view. Rebuilding would reset
//    scrollTop and drop focus out of a message's action row, so the transcript
//    is the sanctioned per-panel `Map<key, element>` (the plan doc's one
//    exception) placed with an ANCHOR WALK that skips rows already in place —
//    `insertBefore` moves a node, and a node already where it belongs is never
//    touched at all. Departed rows are swept BEFORE the walk, never during.
//
// 4. DRAFTS ARE PERSISTED. What you type is held in the drafts pool as you type
//    it (debounced), and flushed on the way out of anything — switching tiles,
//    sending, closing. The debounce can never be the last word.
//
// ── LIFECYCLE NOTE ─────────────────────────────────────────────────────────
//
// The Angular version wrapped its whole `<aside>` in `@if (visible())`, so the
// panel's DOM existed only while it was open. A registry-fed element is mounted
// ONCE at boot and stays, so DOM presence and ENGAGEMENT are split the way
// DockedPanelElement splits them: `activate()` builds + claims the lane + joins
// the session, `deactivate()` tears that down and clears the children.
// `#show()`/`#hide()` are those two calls plus the `.open` class. The window
// still starts from the REMEMBERED visibility (`hc:chat-visible`), because that
// was the Angular signal's initial value and a configured local bridge is meant
// to boot with its companion view open.
//
// Because the host IS the panel, Angular's `:host { inset:0; pointer-events:
// none }` full-bleed wrapper and the `.chat-panel` rules merge onto the tag —
// the sequence-viewer precedent. The `!important` on `right` and `width`
// survives the merge: it is what beats DockedPanelElement's inline geometry,
// exactly as it beat the directive's.
//
// Its strings ship WITH it (chat-window.i18n.ts, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice.
//
// Shell-free: resolves everything through `window.ioc` at call time.

import {
  EffectBus,
  I18N_IOC_KEY, type I18nProvider,
  CLAUDE_BRIDGE_ENABLED_STORAGE_KEY,
  PARTICIPANT_AI_HOST_STORAGE_KEY,
  isLocalClaudeBridgeConfigured,
  isParticipantAiHostConfigured,
  focusSnapshot, restoreFocus,
} from '@hypercomb/core'
import { DockedPanelElement } from '../panels/docked-panel.element.js'
import { CHAT_WINDOW_TRANSLATIONS } from './chat-window.i18n.js'
import { highlightBlocks } from './chat-highlight.js'
import { hivePathSegments, renderChatMarkdown } from './chat-markdown.js'
import {
  liveHostConvos, liveHostRun, startHostRun, stopHostRun, type HostAsk,
} from './host-stream.js'

const SURFACE_NAME = 'hc-chat-window'

// ── the contracts this window reaches through IoC ─────────────────────────
//
// Every one of these was a structural type in the Angular component because
// shared may never import essentials. They stay structural here for a
// different reason: an `import` would INLINE that module into this bundle, and
// a second importer would then run two copies of it (the dup-inlining trap).
// The rail, the threads module and the queen all have their own bees.

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

/** The threads module (assistant/chat-thread.ts), reached through IoC. */
type ChatThreadsLike = {
  appendTurn(convoId: string, role: TurnRole, text: string): Promise<boolean>
  readTurns(convoId: string): Promise<ChatTurn[]>
  listConversations(): Promise<ConversationSummary[]>
  /** One pass for the list AND the newest thread's turns — the resume path's
   *  read, so opening never re-reads the bucket the list walk just read. */
  listConversationsWithLatest?(): Promise<{ conversations: ConversationSummary[]; latestTurns: ChatTurn[] }>
  deleteConversation(convoId: string): Promise<boolean>
  /** Put a conversation away, or bring it back. Absent on an older essentials
   *  build — the control is hidden rather than dead when it is. */
  setConversationArchived?(convoId: string, archived: boolean): Promise<boolean>
  newConvoId(): string
  /** A tile's conversation id, derived from its path — every tile has one,
   *  dormant until something lands in it. */
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
  /** IN-FLIGHT ANSWERS, written down while they arrive — recovered on the next
   *  boot, so a reload mid-answer does not take the half already read. */
  saveStreamCheckpoint?(convoId: string, text: string): Promise<boolean>
  listStreamCheckpoints?(): Promise<ReadonlyArray<{ convoId: string; text: string; at: number }>>
  recoverStreamCheckpoints?(live?: ReadonlySet<string>): Promise<number>
}

type QueenLike = {
  activeModel: string
  /** The queued ask's record SIGNATURE — what withdrawing it needs. Older
   *  essentials builds return a bare boolean; then the ask is still queued, it
   *  simply cannot be taken back from here. */
  submitChat(
    convoId: string,
    message: string,
    targets: string[],
    transcript: ReadonlyArray<{ role: string; text: string }>,
    references?: readonly { kind: string; sig: string; label: string }[],
  ): Promise<string | boolean | null>
}

type LineageLike = { explorerSegments?(): readonly string[] }
type SelectionLike = { selected: ReadonlySet<string> }
type BridgeLike = { connected?: boolean }
type NavigationLike = { goRaw?(segments: readonly string[]): void }
type NotesLike = {
  addAtSegments?(
    parentSegments: readonly string[],
    cellLabel: string,
    text: string,
    shape?: unknown,
    mark?: string | null,
  ): Promise<void>
}
type ModeRegistryLike = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void }
type ViewportPersistenceLike = { suspend?(): void; resume?(): void }
type HistoryLike = { sign?: (ctx: { explorerSegments: () => string[] }) => Promise<string> }
type WorkerLike = { propsSigAt?: (s: readonly string[]) => Promise<string | null> }

/** The tiles rail — the full-screen view's left sidebar. It lives in
 *  essentials too now, but it arrives through the factory it registers in IoC
 *  rather than by import: exactly one bundle may inline it. */
type RailPickLike = {
  readonly key: string
  readonly path: readonly string[]
  readonly name: string
  readonly sig?: string
  readonly convoId?: string
  /** What the signature points at: one layer, a whole context group, or — when
   *  it is a media type — a picture attached to the question. */
  readonly kind?: string
  /** Bytes, for an attached picture. Absent for a tile: a tile's weight is not
   *  a fact about the reference. */
  readonly size?: number
}
type TilesRailLike = {
  onSubjectChanged: (subject: RailPickLike | null) => void
  onSelectionChanged: (selection: RailPickLike[]) => void
  readonly subject: RailPickLike | null
  newChatOnSubject?(): boolean
  readonly selection: RailPickLike[]
  readonly selectionSigs: string[]
  mount(host: HTMLElement): void
  clearSubject(): void
  clearSelection(): void
  dispose(): void
}
type TilesRailFactoryLike = { create?: () => TilesRailLike }

/** The optimization pool over Store — the durable inbox a queued ask lives in
 *  until a Claude session drains it. Withdrawing is removing it. */
type StoreLike = {
  removeOptimization?(signature: string): Promise<boolean>
  putOptimization?(blob: Blob): Promise<string>
  listOptimizations?(): Promise<string[]>
  getOptimization?(signature: string): Promise<Blob | null>
  /** Content in, signature out. An image dropped into a question is content
   *  like any other. */
  putResource?(blob: Blob): Promise<string>
  getResource?(sig: string): Promise<Blob | null>
}

/** The host's AI — the SHALLOW immediate tier (assistant/host-ai.service.ts). */
type HostAiLike = {
  readonly configured?: boolean
  ask?(
    question: string,
    opts?: { contextSigs?: readonly string[]; signal?: AbortSignal },
  ): AsyncGenerator<string, string, void>
  setHost?(domain: string): void
}

type PolicyLike = {
  designate?(need: { tier?: string; readsHive?: boolean; streaming?: boolean }): DesignationLike | undefined
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
  ready?(call?: {
    providerId?: string
    model?: string
    preferModel?: string
    need?: { tier?: string; streaming?: boolean }
  }): boolean
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

/** The tile-context module (assistant/tile-context.ts). `branchesFor` is the
 *  cheap synchronous count for the status chip; `signaturesFor` is the resolved
 *  union an ask carries. */
type TileContextLike = {
  branchesFor?(segments: readonly string[]): readonly string[][]
  signaturesFor?(segments: readonly string[]): Promise<readonly string[]>
}

/** A tile dragged out of the sidebar. The CONTRACT is this mime type and this
 *  shape. Spelled here AND in agent-tiles-rail.ts (which exports the same
 *  constant): the two bundles may not import each other, so the wire is a
 *  string in both. Change one, change both. */
const TILE_DRAG_TYPE = 'application/x-hypercomb-tile'
type DroppedTile = { readonly name: string; readonly path: string; readonly sig: string }

// ── constants, verbatim from the component ────────────────────────────────

/** The command line's bracket syntax passes the SHORT op — `[tile]/o ask me`
 *  sets the model to `o`. Unmapped, that is silently not a model. */
const MODEL_ALIASES: Record<string, string> = { o: 'opus', s: 'sonnet', h: 'haiku', f: 'fable' }

/** Which model each conversation was last held in, participant-local.
 *  THE RENDER LAYER READS THIS MAP TOO — a tile's resting bee is branded from
 *  the model its newest conversation was last held in (via chat-thread's
 *  `conversationModel`). chat-thread.ts names this file as the writer. */
const MODEL_KEY = 'hc:chat-models'
const DEFAULT_MODEL = 'opus'
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

/** WHAT THE SHALLOW TIER ANSWERS WITH. WHICH TIER will answer is decided at
 *  send time by `#bridgeUp` — so the bee is branded from the tier that is
 *  actually going to take the question. */
const HOST_TIER_MODEL = 'haiku'

/** Turns carried to a stateless responder. */
const TRANSCRIPT_TURNS = 12

/** How long the composer waits after the last keystroke before the thinking is
 *  written down. */
const DRAFT_HOLD_MS = 500
const HOST_AI_IOC_KEY = '@diamondcoreprocessor.com/HostAi'
const LLM_ROUTER_IOC_KEY = '@diamondcoreprocessor.com/LlmRouter'
const THREADS_IOC_KEY = '@diamondcoreprocessor.com/ChatThreads'
const QUEEN_IOC_KEY = '@diamondcoreprocessor.com/LlmQueenBee'
const STORE_IOC_KEY = '@hypercomb.social/Store'
const LINEAGE_IOC_KEY = '@hypercomb.social/Lineage'
const NAVIGATION_IOC_KEY = '@hypercomb.social/Navigation'
const SELECTION_IOC_KEY = '@diamondcoreprocessor.com/SelectionService'
const TILE_CONTEXT_IOC_KEY = '@diamondcoreprocessor.com/TileContext'
const NOTES_IOC_KEY = '@diamondcoreprocessor.com/NotesService'
const BRIDGE_IOC_KEY = '@diamondcoreprocessor.com/ClaudeBridgeWorker'
const RAIL_FACTORY_IOC_KEY = '@diamondcoreprocessor.com/AgentTilesRailFactory'
const MODE_REGISTRY_IOC_KEY = '@diamondcoreprocessor.com/ModeRegistry'
const VIEWPORT_PERSISTENCE_IOC_KEY = '@diamondcoreprocessor.com/ViewportPersistence'
const HISTORY_IOC_KEY = '@diamondcoreprocessor.com/HistoryService'
const CLIPBOARD_WORKER_IOC_KEY = '@diamondcoreprocessor.com/ClipboardWorker'

/** How far back a pending ask record may reach and still be shown as waiting.
 *  Matches the agent registry's give-up window. */
const RECOVER_MAX_AGE_MS = 45 * 60_000

/** How much of the durable inbox a recovery pass reads. */
const RECOVER_SCAN_LIMIT = 400
const CHAT_VISIBLE_STORAGE_KEY = 'hc:chat-visible'

/** How close to the bottom still counts as reading the newest turn. */
const NEAR_BOTTOM_PX = 56

/** The waiting row's clock. */
const ELAPSED_TICK_MS = 1_000

/** Rendered turns are memoized by their text. Bounded, because a long
 *  session's cache is otherwise a slow leak of everything ever said. */
const RENDER_CACHE_MAX = 240

/** Set once the whole guided-setup checklist has been completed (or skipped). */
const SETUP_DONE_KEY = 'hc:bridge-setup-done'

/** The rail is on screen above this width — the twin of the `max-width: 700px`
 *  rule in the stylesheet below. Kept next to nothing else so the two numbers
 *  are one edit apart. */
const RAIL_QUERY = '(min-width: 701px)'

/** The most a single attached picture may weigh. */
const IMAGE_MAX_BYTES = 12 * 1024 * 1024
/** The one manual step — "I have Claude Code and the repo". */
const SETUP_TOOLS_KEY = 'hc:bridge-setup-tools'
/** A bridge answer has landed at least once — the loop is proven. */
const FIRST_REPLY_KEY = 'hc:bridge-first-reply'

/** This window's name in the owner-counted `view:active` mode. */
const SURFACE_OWNER = 'chat-window'
const KEEPS_CONTROLS = 'view:keeps-controls'

/** The commands the checklist hands out — copy targets, never typed, never
 *  translated (they are literal shell lines). */
const COMMANDS = {
  install: 'npm install -g @anthropic-ai/claude-code',
  clone: 'git clone https://github.com/hypercomb/social.git',
  build: 'cd social/src && npm install && npm run build:packages',
  broker: 'npm run bridge',
  claude: 'claude',
  listen: 'listen for hive asks',
} as const

// ── small helpers ─────────────────────────────────────────────────────────

const get = <T,>(key: string): T | undefined => window.ioc?.get?.<T>(key)

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

// Same contract as the shell pipe: params drive both pluralization
// (`key.one` / `key.other`, chosen on params.count by the i18n service) and
// `{token}` interpolation. The fallback is the English catalog text, and it
// interpolates the same tokens so a bare host with no i18n reads identically.
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = get<I18nProvider>(I18N_IOC_KEY)
  const value = i18n?.t(key, params)
  if (value && value !== key) return value
  if (!params) return fallback
  return fallback.replace(/\{(\w+)\}/g, (whole, token: string) =>
    token in params ? String(params[token]) : whole)
}

/** The three counting strings have NO bare key in the catalogs — only `.one` /
 *  `.other`. The i18n service picks between them off `params.count`; the
 *  FALLBACK has to make the same choice itself, or a host with no catalog
 *  would read "1 messages". */
const tCount = (key: string, one: string, other: string, count: number): string =>
  t(key, count === 1 ? one : other, { count })

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** A material-symbols glyph, decorative. */
const sym = (name: string, className = 'mat-sym'): HTMLSpanElement => {
  const span = el('span', className, name)
  span.setAttribute('aria-hidden', 'true')
  return span
}

const button = (className: string, focusKey?: string): HTMLButtonElement => {
  const node = el('button', className)
  node.type = 'button'
  // `data-hc-row` is what core's focusSnapshot/restoreFocus read — the key is
  // OURS, never a class, so two buttons in one strip can never be confused
  // (the copy/cut incident).
  if (focusKey) node.dataset['hcRow'] = focusKey
  return node
}

// The panel's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(CHAT_WINDOW_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the viewport inset, the hcDockInset directive's job ───────────────────
//
// The chat window does NOT reserve an edge for itself — it is full screen, and
// reserving an edge of the whole screen would be a lie (DockedPanelElement's
// own inset is switched off in the constructor). What it reserves is the two
// BARS while it is folded away: the header at the top and the footer at the
// bottom, so "centre in window" means the band of hive you can actually see.
// A faithful transplant of dock-inset.directive.ts, full-bleed guard included.

let insetCounter = 0

type Inset = { setActive(active: boolean): void; dispose(): void }

const attachInset = (host: HTMLElement, side: 'top' | 'bottom'): Inset => {
  const owner = `chat-inset-${++insetCounter}`
  let active = false
  let raf = 0

  const emitClear = (): void => { EffectBus.emit('viewport:inset', { owner, side, size: 0 }) }

  const emit = (): void => {
    if (!active) { emitClear(); return }
    const r = host.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) { emitClear(); return }
    // A FULL-BLEED sheet reserves nothing — report NOTHING rather than guess a
    // replacement edge (see the directive's header for what that cost).
    const spansY = r.top <= 1 && r.bottom >= window.innerHeight - 1
    if (spansY) { emitClear(); return }
    const size = side === 'top'
      ? Math.max(0, r.bottom)
      : Math.max(0, window.innerHeight - r.top)
    EffectBus.emit('viewport:inset', { owner, side, size })
  }

  const schedule = (): void => {
    if (raf) return
    raf = requestAnimationFrame(() => { raf = 0; emit() })
  }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
  ro?.observe(host)
  window.addEventListener('resize', schedule)
  schedule()

  return {
    setActive: (next: boolean): void => {
      if (next === active) return
      active = next
      schedule()
    },
    dispose: (): void => {
      ro?.disconnect()
      window.removeEventListener('resize', schedule)
      if (raf) cancelAnimationFrame(raf)
      emitClear()
    },
  }
}

// ── thumbnails ────────────────────────────────────────────────────────────
//
// "What does this reference look like" — a transplant of
// shared/ui/clipboard-thumbs.ts, which retires with the Angular component this
// file replaces. clipboard-panel.view.ts carries the SAME transplant, and its
// header already names the debt: one of the two copies must go down to core so
// both faces of the gathered set call one resolver. That move is a core edit
// and does not belong in this pass — it is reported, not performed.
//
// Resolution goes through the participant-local props-index (localStorage,
// O(1)) — the same cache the renderer reads — with the worker's warm canonical
// lookup as the only fallback. We deliberately do NOT touch
// `history.currentLayerAt`: for a tile with no index entry that read can
// trigger a cold whole-tree scan, and a set of N such entries would fire N
// scans and hang the surface. A miss returns null and the box shows its glyph.

const SIG_RE = /^[0-9a-f]{64}$/i
const TILE_PROPS_INDEX_KEY = 'hc:tile-props-index'

const lookupPropsSig = (locSig: string, label: string): string | undefined => {
  try {
    const idx = JSON.parse(localStorage.getItem(TILE_PROPS_INDEX_KEY) ?? '{}') as Record<string, string>
    const v = (locSig && idx[locSig]) ?? idx[label]
    return (typeof v === 'string' && SIG_RE.test(v)) ? v : undefined
  } catch { return undefined }
}

const canonicalPropsSig = async (segments: readonly string[]): Promise<string | undefined> => {
  const worker = get<WorkerLike>(CLIPBOARD_WORKER_IOC_KEY)
  if (!worker?.propsSigAt) return undefined
  try { return (await worker.propsSigAt(segments)) ?? undefined } catch { return undefined }
}

const sigAt = (props: Record<string, unknown>, slot: 'large' | 'small'): string | undefined => {
  const direct = (props as Record<string, { image?: unknown } | undefined>)[slot]
  if (direct && typeof direct === 'object' && typeof direct.image === 'string' && SIG_RE.test(direct.image)) return direct.image
  const flat = (props as { flat?: Record<string, { image?: unknown } | undefined> }).flat
  const fi = flat?.[slot]?.image
  return (typeof fi === 'string' && SIG_RE.test(fi)) ? fi : undefined
}

const imageSigOf = (props: Record<string, unknown>, prefer: 'large' | 'small'): string | undefined =>
  prefer === 'large'
    ? sigAt(props, 'large') ?? sigAt(props, 'small')
    : sigAt(props, 'small')

/** Entry → blob: URL, or null on any miss. The CALLER owns the URL — cache it,
 *  and revoke it when the entry leaves the screen. */
const resolveEntryImageUrl = async (
  label: string,
  sourceSegments: readonly string[],
  prefer: 'large' | 'small',
): Promise<string | null> => {
  const history = get<HistoryLike>(HISTORY_IOC_KEY)
  const store = get<StoreLike>(STORE_IOC_KEY)
  if (!store?.getResource) return null

  let locSig = ''
  if (history?.sign) {
    try { locSig = await history.sign({ explorerSegments: () => [...sourceSegments, label] }) } catch { /* cold */ }
  }
  let propsSig = lookupPropsSig(locSig, label)
  if (!propsSig) propsSig = await canonicalPropsSig([...sourceSegments, label])
  if (!propsSig) return null

  const propsBlob = await store.getResource(propsSig)
  if (!propsBlob) return null
  let props: Record<string, unknown>
  try { props = JSON.parse(await propsBlob.text()) } catch { return null }

  const imageSig = imageSigOf(props, prefer)
  if (!imageSig) return null
  const imgBlob = await store.getResource(imageSig)
  if (!imgBlob) return null
  return URL.createObjectURL(imgBlob)
}

// ── the styles the four Angular SCSS sheets carried, expanded to plain CSS ──
//
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the TAG NAME and every other selector is prefixed
// with it. Prefixing every selector with the same one-element name shifts every
// specificity by exactly (0,0,1), so the cascade the four sheets produced is
// preserved verbatim — including the two places it is load-bearing (below).
//
// `$accent: #7eb6d6` is inlined at every `rgba($accent, …)` call site;
// `tw.$radius-control|card|floating` become the `var(--hc-radius-*)` ladder
// _shape.scss publishes app-wide, `tw.$radius-pill` its literal 999px, and the
// `var(--md-*)` / `var(--hc-*)` tokens are left alone.
//
// THE ORDER IS chat-window.component.scss → chat-markdown.scss →
// chat-peek.scss → chat-look.scss, exactly the `styleUrls` order, because two
// pairs of rules decide on source order rather than specificity.
//
// FOUR EXPANSIONS WORTH NAMING:
//
//  • `:host` and `.chat-panel` were two elements — a fixed full-bleed wrapper
//    with `pointer-events: none` and the `<aside>` filling it. They MERGE onto
//    the tag: position:fixed + inset:0 + z-index from the host, everything else
//    from the panel, and `pointer-events: auto` because the panel covered the
//    wrapper entirely. `right: 0 !important` / `width: auto !important` survive
//    the merge — they are what beats DockedPanelElement's inline geometry,
//    exactly as they beat the directive's.
//
//  • `@include tw.panel($accent, right)` was NOT the last thing in
//    `.chat-panel`: `border-radius: 0`, `border-right: none` and
//    `box-shadow: 0 18px 60px rgba(0,0,0,.55)` are written after it and WIN. So
//    the mixin's own `-14px 0 44px` shadow is not carried — only the values
//    that actually reached the screen are.
//
//  • `.chat-close` sits LATER in the sheet than the `tw.header` close-button
//    rules, but `…chat-header>button[class*='close']` outranks `.chat-close` on
//    specificity, so width / padding / font-size / colour come from the header
//    band and only background / border / cursor / line-height come from
//    `.chat-close`. Reproduced verbatim so the × lands where it always did.
//
//  • `.chat-panel .chat-msg { max-width: min(92%, 44em) }` was a
//    higher-specificity override of `.chat-msg { max-width: 92% }`. Prefixed,
//    the two are now EQUAL, so the override wins on source order instead —
//    which is why it must stay written after.
//
// `@keyframes chat-pulse` is renamed `hc-chat-window-pulse`: keyframe names are
// a global namespace and a document-level sheet must not squat a bare one.
// Angular's build autoprefixed; `-webkit-backdrop-filter` is written by hand.
const CSS = `
${SURFACE_NAME}{position:fixed;inset:0;left:var(--hc-controls-left,0px);right:var(--hc-controls-right,0px)!important;width:auto!important;max-width:none;margin:0;z-index:100002;pointer-events:auto;display:none;flex-direction:column;font-size:calc(1rem * var(--hc-panel-scale,1));
  --hc-window-accent:#7eb6d6;--hc-window-radius-control:var(--hc-radius-control);--hc-window-radius-card:var(--hc-radius-card);--hc-window-radius-floating:var(--hc-radius-floating);
  background:rgba(13,15,21,.975);backdrop-filter:blur(14px) saturate(1.04);-webkit-backdrop-filter:blur(14px) saturate(1.04);border-radius:0;
  border-right:none;border-left:1px solid rgba(126,182,214,.38);font-family:var(--hc-mono,system-ui);color:#eef2f5;outline:none;
  padding-left:var(--chat-rail-width,clamp(15rem,22vw,20rem));box-shadow:0 18px 60px rgba(0,0,0,.55)}
${SURFACE_NAME}.open{display:flex}
${SURFACE_NAME} .chat-body{flex:1;min-height:0;display:flex;align-items:stretch}
${SURFACE_NAME} .chat-reading{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
${SURFACE_NAME} .chat-providers-host{flex:0 0 auto;width:var(--hc-providers-width,0px);min-width:0;display:flex;overflow:visible}
${SURFACE_NAME} .chat-rail{position:absolute;top:0;bottom:0;left:0;width:var(--chat-rail-width,clamp(15rem,22vw,20rem));display:flex;flex-direction:column;border-right:1px solid rgba(126,182,214,.18);background:rgba(3,5,9,.55)}
${SURFACE_NAME} .chat-rail-grip{position:absolute;top:0;bottom:0;left:var(--chat-rail-width,clamp(15rem,22vw,20rem));width:8px;margin-left:-4px;z-index:3;cursor:col-resize;background:transparent;transition:background 120ms ease}
${SURFACE_NAME} .chat-rail-grip:hover,${SURFACE_NAME} .chat-rail-grip:focus-visible,${SURFACE_NAME} .chat-rail-grip.dragging{background:rgba(126,182,214,.35)}
${SURFACE_NAME} .chat-rail-grip:focus-visible{outline:none}
@media (max-width:700px){${SURFACE_NAME}{padding-left:0}${SURFACE_NAME} .chat-rail,${SURFACE_NAME} .chat-rail-grip{display:none}}
${SURFACE_NAME} .chat-header{flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:.4em;height:2.875rem;min-height:2.875rem;padding:0 .75rem;line-height:1;background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(255,255,255,.006));border-bottom:1px solid rgba(126,182,214,.25);position:relative}
${SURFACE_NAME} .chat-header>button{box-sizing:border-box;display:inline-grid;place-items:center;min-width:1.75rem;height:1.75rem;padding:0 .25rem;border-radius:var(--hc-radius-control);line-height:1;transition:color 120ms ease,background-color 120ms ease,border-color 120ms ease}
${SURFACE_NAME} .chat-header>button:hover{background-color:rgba(255,255,255,.055)}
${SURFACE_NAME} .chat-header>button:focus-visible{outline:1px solid color-mix(in srgb,var(--hc-window-accent) 72%,white);outline-offset:1px}
${SURFACE_NAME} .chat-header>button[class*='close']{width:1.75rem;min-width:1.75rem;padding:0;font-size:1.125rem;color:rgba(238,244,248,.62)}
${SURFACE_NAME} .chat-header>button[class*='close']:hover{color:#fff;background-color:rgba(255,255,255,.075)}
${SURFACE_NAME} .chat-glyph{font-size:1.05em;color:rgba(126,182,214,.8)}
${SURFACE_NAME} .chat-subject-hive{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(226,196,140,.92);font-family:var(--hc-mono,monospace);letter-spacing:.12em;text-transform:uppercase}
${SURFACE_NAME} .chat-subject{display:inline-flex;align-items:center;min-width:0;max-width:40%;font-size:.9em;letter-spacing:.05em}
${SURFACE_NAME} .chat-payload{flex:1 1 auto;display:flex;align-items:center;gap:.34rem;min-width:0;min-height:2.2rem;margin:0 .5rem;padding:.28rem .5rem;border:1px dashed rgba(126,182,214,.28);border-radius:var(--hc-radius-control,2px);overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;scrollbar-color:rgba(126,182,214,.3) transparent}
${SURFACE_NAME} .chat-payload.over{border-style:solid;border-color:rgba(126,182,214,.9);background:rgba(126,182,214,.14)}
${SURFACE_NAME} .chat-payload-hint{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(126,182,214,.45);font-size:.78em}
${SURFACE_NAME} .chat-box{display:inline-flex;align-items:center;gap:.2em;max-width:10rem;min-width:2rem;padding:.1em .4em;border:1px dashed rgba(126,182,214,.4);border-radius:var(--hc-radius-control,2px);background:none;color:rgba(126,182,214,.75);font:inherit;font-size:.82em;line-height:1.6;cursor:pointer}
${SURFACE_NAME} .chat-box.filled{border-style:solid;background:rgba(126,182,214,.12);color:rgba(126,182,214,.98)}
${SURFACE_NAME} .chat-box.over{border-color:rgba(126,182,214,.95);background:rgba(126,182,214,.22);color:rgba(238,244,250,.98)}
${SURFACE_NAME} .chat-box:focus-visible{outline:1px solid rgba(126,182,214,.7);outline-offset:1px}
${SURFACE_NAME} .chat-box .mat-sym{font-size:1.05em;opacity:.85}
${SURFACE_NAME} .chat-box-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--hc-mono,monospace)}
${SURFACE_NAME} .chat-box-hint{opacity:.75}
${SURFACE_NAME} .chat-box-off{padding:0;border:0;background:none;color:inherit;font:inherit;line-height:1;opacity:.7;cursor:pointer}
${SURFACE_NAME} .chat-box-off:hover{opacity:1}
${SURFACE_NAME} .chat-box-off:focus-visible{outline:1px solid rgba(126,182,214,.8);outline-offset:1px;opacity:1}
${SURFACE_NAME} .chat-box-add{justify-content:center;min-width:1.5rem;color:rgba(126,182,214,.6)}
${SURFACE_NAME} .chat-clip{flex:0 0 auto;display:inline-flex;align-items:center;gap:.15em;padding:.1em .25em;border:0;border-radius:var(--hc-radius-control,2px);background:none;color:rgba(126,182,214,.45);font:inherit;font-size:.82em;cursor:pointer}
${SURFACE_NAME} .chat-clip.holding{color:rgba(126,182,214,.85)}
${SURFACE_NAME} .chat-clip.on{background:rgba(126,182,214,.18);color:rgba(238,244,250,.98)}
${SURFACE_NAME} .chat-clip:hover{color:rgba(238,244,250,.95)}
${SURFACE_NAME} .chat-clip:focus-visible{outline:1px solid rgba(126,182,214,.7);outline-offset:1px}
${SURFACE_NAME} .chat-clip .mat-sym{font-size:1.1em}
${SURFACE_NAME} .chat-clip-count{font-family:var(--hc-mono,monospace);font-size:.85em;line-height:1}
${SURFACE_NAME} .chat-clip-shelf{position:absolute;top:100%;left:2.2rem;right:.5rem;z-index:3;display:flex;flex-direction:column;gap:.15rem;max-width:22rem;max-height:40vh;padding:.4rem;overflow-y:auto;border:1px solid rgba(126,182,214,.35);border-radius:var(--hc-radius-floating,4px);background:rgba(6,10,16,.97);box-shadow:0 10px 30px rgba(0,0,0,.5)}
${SURFACE_NAME} .chat-clip-item{display:flex;align-items:center;gap:.4rem;width:100%;padding:.2rem .3rem;border:1px solid transparent;border-radius:var(--hc-radius-control,2px);background:none;color:rgba(126,182,214,.9);font:inherit;font-size:.72em;text-align:left;cursor:pointer}
${SURFACE_NAME} .chat-clip-item:hover{border-color:rgba(126,182,214,.6);background:rgba(126,182,214,.14)}
${SURFACE_NAME} .chat-clip-item:focus-visible{outline:1px solid rgba(126,182,214,.75);outline-offset:1px}
${SURFACE_NAME} .chat-clip-img{flex:0 0 auto;width:1.56rem;height:1.56rem;object-fit:cover;border-radius:var(--hc-radius-control,2px)}
${SURFACE_NAME} .chat-clip-glyph{flex:0 0 auto;width:1.56rem;font-size:1.3em;text-align:center;opacity:.5}
${SURFACE_NAME} .chat-clip-text{display:flex;flex-direction:column;min-width:0;line-height:1.25}
${SURFACE_NAME} .chat-clip-name{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--hc-mono,monospace)}
${SURFACE_NAME} .chat-clip-branch{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.55;font-size:.88em;font-family:var(--hc-mono,monospace)}
${SURFACE_NAME} .chat-clip-empty{padding:.2rem .3rem;color:rgba(126,182,214,.5);font-size:.78em}
${SURFACE_NAME} .chat-box-context{flex:0 0 auto;gap:.28em;max-width:20rem;padding:.1em .2em .1em .3em}
${SURFACE_NAME} .chat-box-context .chat-box-img{flex:0 0 auto;width:.9rem;height:.9rem;object-fit:cover;border-radius:var(--hc-radius-control,2px);display:block}
${SURFACE_NAME} .chat-box-context .chat-box-glyph{flex:0 0 auto;font-size:.9rem;opacity:.5}
${SURFACE_NAME} .chat-box-context .chat-box-name{flex:0 0 auto;max-width:11rem}
${SURFACE_NAME} .chat-box-context .chat-box-branch{flex:0 1 auto;flex-shrink:6;min-width:0;margin-left:.15em;max-width:9.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.55;font-size:.86em;font-family:var(--hc-mono,monospace)}
${SURFACE_NAME} .chat-box-context .chat-box-off{flex:0 0 auto;opacity:.35}
${SURFACE_NAME} .chat-box-context:hover .chat-box-off,${SURFACE_NAME} .chat-box-context:focus-within .chat-box-off{opacity:.9}
${SURFACE_NAME} .chat-title{display:inline-flex;align-items:center;gap:.15em;min-width:0;padding:.1em .35em;border:0;border-radius:var(--hc-radius-control,2px);background:none;font-size:.9em;letter-spacing:.05em;font-family:inherit;color:rgba(126,182,214,.95);cursor:pointer}
${SURFACE_NAME} .chat-title:hover,${SURFACE_NAME} .chat-title.on{background:rgba(126,182,214,.14)}
${SURFACE_NAME} .chat-title:focus-visible{outline:1px solid rgba(126,182,214,.7);outline-offset:-1px}
${SURFACE_NAME} .chat-header-space{flex:1 1 auto}
${SURFACE_NAME} .chat-close{background:none;border:none;color:rgba(255,255,255,.55);font-size:1.2em;line-height:1;padding:0 .25em;cursor:pointer}
${SURFACE_NAME} .chat-close:hover{color:#fff}
${SURFACE_NAME} .chat-setup{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;overflow-y:auto;gap:.75em;padding:1.5em 1.5em 2em;text-align:center;color:rgba(238,244,250,.88);font-family:var(--hc-read,inherit);scrollbar-width:thin;scrollbar-color:rgba(126,182,214,.35) transparent}
${SURFACE_NAME} .chat-setup h2{margin:0;font-size:1em;font-weight:600;color:rgba(126,182,214,.98)}
${SURFACE_NAME} .chat-setup>p{max-width:29em;margin:0;font-size:.78em;line-height:1.6;color:rgba(255,255,255,.62)}
${SURFACE_NAME} .chat-setup-glyph{font-size:2.2em;color:rgba(126,182,214,.72)}
${SURFACE_NAME} .chat-setup-options{width:min(100%,30em);display:grid;gap:.55em;margin:.35em 0}
${SURFACE_NAME} .chat-setup-options p{display:flex;align-items:flex-start;gap:.6em;margin:0;padding:.75em .85em;border:1px solid rgba(126,182,214,.2);border-radius:var(--hc-radius-card);background:rgba(126,182,214,.07);font-size:.75em;line-height:1.45;text-align:left}
${SURFACE_NAME} .chat-setup-options .mat-sym{flex:0 0 auto;font-size:1.25em;color:rgba(126,182,214,.88)}
${SURFACE_NAME} .chat-setup .chat-setup-note{font-size:.68em;color:rgba(255,255,255,.4)}
${SURFACE_NAME} .chat-wizard{width:100%;max-width:30em;box-sizing:border-box;list-style:none;margin:.35em 0 0;padding:0;display:grid;gap:.45em;text-align:left}
${SURFACE_NAME} .chat-step{min-width:0;box-sizing:border-box;padding:.55em .7em;border:1px solid rgba(126,182,214,.16);border-radius:var(--hc-radius-card);background:rgba(255,255,255,.025);opacity:.55}
${SURFACE_NAME} .chat-step.done{opacity:.8;border-color:rgba(140,220,170,.28)}
${SURFACE_NAME} .chat-step.current{opacity:1;border-color:rgba(126,182,214,.45);background:rgba(126,182,214,.07)}
${SURFACE_NAME} .chat-step-head{display:flex;align-items:center;gap:.55em;font-size:.8em;font-weight:600;color:rgba(238,244,250,.92)}
${SURFACE_NAME} .chat-step-n{flex:0 0 auto;width:1.5em;height:1.5em;display:grid;place-items:center;font-size:.85em;border:1px solid rgba(126,182,214,.5);border-radius:999px;color:rgba(126,182,214,.95)}
${SURFACE_NAME} .chat-step-check{flex:0 0 auto;font-size:1.25em;color:rgba(140,220,170,.9)}
${SURFACE_NAME} .chat-step-body{margin:.5em 0 .1em 2.15em;min-width:0;display:grid;gap:.45em}
${SURFACE_NAME} .chat-step-body>p{margin:0;font-size:.72em;line-height:1.5;color:rgba(255,255,255,.66)}
${SURFACE_NAME} .chat-step-hint{font-size:.7em;color:rgba(224,180,92,.88)}
${SURFACE_NAME} .chat-step-live{animation:hc-chat-window-pulse 1.4s ease-in-out infinite}
${SURFACE_NAME} .chat-cmd{display:flex;align-items:center;gap:.5em;min-width:0;box-sizing:border-box;padding:.4em .55em;background:rgba(6,10,16,.75);border:1px solid rgba(255,255,255,.1);border-radius:var(--md-shape-xs,4px)}
${SURFACE_NAME} .chat-cmd code{flex:1 1 0;min-width:0;overflow-x:auto;white-space:nowrap;scrollbar-width:none;font-family:var(--hc-code);font-variant-ligatures:var(--hc-code-ligatures);font-size:.72em;color:#d9e4ee}
${SURFACE_NAME} .chat-cmd button{flex:0 0 auto;padding:.2em .55em;font:inherit;font-size:.65em;letter-spacing:.04em;color:rgba(126,182,214,.9);background:none;border:1px solid rgba(126,182,214,.35);border-radius:var(--md-shape-xs,4px);cursor:pointer}
${SURFACE_NAME} .chat-cmd button:hover{background:rgba(126,182,214,.14)}
${SURFACE_NAME} .chat-btn{justify-self:start;padding:.45em 1em;font:inherit;font-size:.75em;font-weight:600;color:#0c1118;background:rgba(126,182,214,.92);border:1px solid rgba(126,182,214,.92);border-radius:var(--md-shape-xs,4px);cursor:pointer}
${SURFACE_NAME} .chat-btn:hover{background:#7eb6d6}
${SURFACE_NAME} .chat-btn:disabled{opacity:.5;cursor:default}
${SURFACE_NAME} .chat-host{width:100%;max-width:30em;box-sizing:border-box;margin-top:.6em;padding-top:.7em;border-top:1px solid rgba(255,255,255,.08);text-align:left}
${SURFACE_NAME} .chat-host>p{margin:0 0 .4em;font-size:.72em;color:rgba(255,255,255,.6)}
${SURFACE_NAME} .chat-host-row{display:flex;gap:.4em}
${SURFACE_NAME} .chat-host-row input{flex:1 1 auto;min-width:0;padding:.4em .55em;font:inherit;font-size:max(.72em,16px);color:whitesmoke;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.13);border-radius:var(--md-shape-xs,4px);outline:none}
${SURFACE_NAME} .chat-host-row input:focus{border-color:rgba(126,182,214,.6)}
${SURFACE_NAME} .chat-host-row button{flex:0 0 auto;padding:.35em .85em;font:inherit;font-size:.75em;color:rgba(126,182,214,.95);background:rgba(126,182,214,.12);border:1px solid rgba(126,182,214,.4);border-radius:var(--md-shape-xs,4px);cursor:pointer}
${SURFACE_NAME} .chat-host-row button:hover{background:rgba(126,182,214,.2)}
${SURFACE_NAME} .chat-skip{margin-top:.5em;background:none;border:none;font:inherit;font-size:.68em;color:rgba(255,255,255,.42);text-decoration:underline;text-underline-offset:2px;cursor:pointer}
${SURFACE_NAME} .chat-skip:hover{color:rgba(255,255,255,.7)}
${SURFACE_NAME} .chat-complete{display:flex;flex-direction:column;align-items:center;gap:.6em}
${SURFACE_NAME} .chat-complete h2{margin:0;font-size:1em;color:rgba(140,220,170,.95)}
${SURFACE_NAME} .chat-complete p{margin:0;font-size:.78em;color:rgba(255,255,255,.62)}
${SURFACE_NAME} .chat-complete-glyph{font-size:2.4em;color:rgba(140,220,170,.9)}
${SURFACE_NAME} .chat-bar{flex:0 0 auto;display:flex;align-items:center;gap:.3em;padding:.35em .5em .35em .35em;border-bottom:1px solid rgba(255,255,255,.06)}
${SURFACE_NAME} .chat-current{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:.3em;padding:.35em .4em;background:none;border:none;color:rgba(255,255,255,.85);font:inherit;font-size:.8em;text-align:left;cursor:pointer;border-radius:var(--md-shape-xs,4px)}
${SURFACE_NAME} .chat-current .mat-sym{font-size:1.1em;color:rgba(255,255,255,.45)}
${SURFACE_NAME} .chat-current:hover{background:rgba(126,182,214,.09)}
${SURFACE_NAME} .chat-current-still{cursor:default}
${SURFACE_NAME} .chat-current-still:hover{background:none}
${SURFACE_NAME} .chat-current-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .chat-new,${SURFACE_NAME} .chat-put{flex:0 0 auto;display:inline-grid;place-items:center;width:1.85rem;height:1.85rem;padding:0;border-radius:var(--hc-radius-control);background:none;border:none;cursor:pointer}
${SURFACE_NAME} .chat-new .mat-sym,${SURFACE_NAME} .chat-put .mat-sym{font-size:1.05em}
${SURFACE_NAME} .chat-goal{border:0;background:transparent;color:#70d59a;cursor:pointer;padding:5px 7px;border-radius:999px}
${SURFACE_NAME} .chat-goal.on,${SURFACE_NAME} .chat-goal:hover{background:rgba(112,213,154,.14)}
${SURFACE_NAME} .chat-goal-details{margin:0 12px 10px;padding:12px;border:1px solid rgba(112,213,154,.42);border-radius:var(--hc-radius-card);background:rgba(23,42,32,.96);color:inherit}
${SURFACE_NAME} .chat-goal-head{display:flex;align-items:center;gap:8px;color:#8ee5af}
${SURFACE_NAME} .chat-goal-head button{margin-left:auto;border:0;background:transparent;color:inherit;cursor:pointer}
${SURFACE_NAME} .chat-goal-details p{margin:10px 0;white-space:pre-wrap}
${SURFACE_NAME} .chat-goal-archive{display:inline-flex;align-items:center;gap:6px;cursor:pointer}
${SURFACE_NAME} .chat-new{color:rgba(126,182,214,.9)}
${SURFACE_NAME} .chat-new:hover{background:rgba(126,182,214,.16)}
${SURFACE_NAME} .chat-put{color:rgba(255,255,255,.42)}
${SURFACE_NAME} .chat-put:hover{color:rgba(126,182,214,.95);background:rgba(126,182,214,.14)}
${SURFACE_NAME} .chat-bar-split{flex:0 0 auto;align-self:center;width:1px;height:1.1em;margin:0 .15em;background:rgba(255,255,255,.14)}
${SURFACE_NAME} .chat-list{flex:0 1 auto;list-style:none;margin:0;padding:.2em 0;overflow-y:auto;max-height:40%;border-bottom:1px solid rgba(255,255,255,.07)}
${SURFACE_NAME} .chat-list-empty{padding:.7em .9em;font-size:.72em;color:rgba(255,255,255,.45)}
${SURFACE_NAME} .chat-list-row{display:flex;align-items:stretch;padding:0 .35em}
${SURFACE_NAME} .chat-list-row:hover{background:rgba(126,182,214,.07)}
${SURFACE_NAME} .chat-list-row.on{background:rgba(126,182,214,.13)}
${SURFACE_NAME} .chat-list-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:.1em;padding:.45em .45em;background:none;border:none;text-align:left;color:inherit;font:inherit;cursor:pointer}
${SURFACE_NAME} .chat-list-name{font-size:.78em;color:#f3f3f3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .chat-list-meta{font-size:.65em;color:rgba(255,255,255,.42)}
${SURFACE_NAME} .chat-list-del{flex:0 0 auto;align-self:center;background:none;border:none;color:rgba(255,255,255,.3);padding:.3em;cursor:pointer;border-radius:var(--md-shape-xs,4px)}
${SURFACE_NAME} .chat-list-del .mat-sym{font-size:1em}
${SURFACE_NAME} .chat-list-del:hover{color:rgba(255,140,140,.9);background:rgba(255,120,120,.12)}
${SURFACE_NAME} .chat-list-del.armed{color:#fff;background:rgba(226,75,74,.85)}
${SURFACE_NAME} .chat-list-put{flex:0 0 auto;align-self:center;background:none;border:none;color:rgba(255,255,255,.28);padding:.3em;cursor:pointer;border-radius:var(--md-shape-xs,4px)}
${SURFACE_NAME} .chat-list-put .mat-sym{font-size:1em}
${SURFACE_NAME} .chat-list-put:hover{color:rgba(126,182,214,.95);background:rgba(126,182,214,.14)}
${SURFACE_NAME} .chat-list-row.filed .chat-list-name{color:rgba(243,243,243,.55)}
${SURFACE_NAME} .chat-list-row.filed .chat-list-meta{color:rgba(255,255,255,.3)}
${SURFACE_NAME} .chat-list-archived{padding:.15em .35em .35em}
${SURFACE_NAME} .chat-list-archived button{display:flex;align-items:center;gap:.2em;width:100%;padding:.3em .4em;background:none;border:none;border-radius:var(--md-shape-xs,4px);color:rgba(255,255,255,.42);font:inherit;font-size:.68em;text-align:left;cursor:pointer}
${SURFACE_NAME} .chat-list-archived button .mat-sym{font-size:1.1em}
${SURFACE_NAME} .chat-list-archived button:hover{color:rgba(126,182,214,.9);background:rgba(126,182,214,.08)}
${SURFACE_NAME} .chat-list-archived button.on{color:rgba(126,182,214,.9)}
${SURFACE_NAME} .chat-thread{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:.5em;padding:.85em .85em;font-family:var(--hc-read,inherit);scrollbar-width:thin;scrollbar-color:rgba(126,182,214,.35) transparent}
${SURFACE_NAME} .chat-thread::-webkit-scrollbar{width:6px}
${SURFACE_NAME} .chat-thread::-webkit-scrollbar-thumb{background:rgba(126,182,214,.3);border-radius:999px}
${SURFACE_NAME} .chat-empty{margin:auto 0;padding:1em .4em;font-size:.75em;line-height:1.6;color:rgba(255,255,255,.42);text-align:center}
${SURFACE_NAME} .chat-msg{max-width:92%;padding:.5em .65em;font-size:.8em;line-height:1.55;color:rgba(238,244,250,.94);border-radius:var(--hc-radius-card)}
${SURFACE_NAME} .chat-msg.user{align-self:flex-end;background:rgba(126,182,214,.17);border:1px solid rgba(126,182,214,.3)}
${SURFACE_NAME} .chat-msg.ai{align-self:flex-start;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.09);border-left:2px solid rgba(126,182,214,.55)}
${SURFACE_NAME} .chat-msg{max-width:min(92%,44em)}
${SURFACE_NAME} .chat-think{color:rgba(216,230,238,.55);animation:hc-chat-window-pulse 1.4s ease-in-out infinite}
@keyframes hc-chat-window-pulse{0%,100%{opacity:.45}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){${SURFACE_NAME} .chat-think{animation:none}}
${SURFACE_NAME} .chat-foot{flex:0 0 auto;padding:.55em calc(.75em + var(--hc-providers-width,0px)) .7em .75em;background:rgba(255,255,255,.015);transition:padding-right .16s ease}
${SURFACE_NAME} .chat-answering{display:inline-flex;align-items:center;gap:.25em;flex:0 0 auto;margin-right:.65em;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:.15em .35em;font:inherit;font-family:var(--hc-mono,monospace);color:rgba(126,182,214,.95);background:rgba(126,182,214,.1);border:1px solid rgba(126,182,214,.3);border-radius:var(--md-shape-xs,4px);cursor:pointer}
${SURFACE_NAME} .chat-answering .mat-sym{font-size:1.15em;opacity:.75}
${SURFACE_NAME} .chat-answering:hover{background:rgba(126,182,214,.18)}
${SURFACE_NAME} .chat-subject-tile{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--hc-mono,monospace);color:rgba(126,182,214,.95)}
${SURFACE_NAME} .chat-title-caret{flex:0 0 auto;font-size:1em;opacity:.6}
${SURFACE_NAME} .chat-list-tile{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--hc-mono,monospace);font-size:.82em;color:rgba(126,182,214,.95)}
${SURFACE_NAME} .chat-list-draft{margin-right:.4em;padding:0 .3em;border:1px solid rgba(238,244,250,.45);border-radius:var(--hc-radius-control,2px);color:rgba(238,244,250,.85);font-size:.92em}
${SURFACE_NAME} .chat-targets{flex:0 0 auto;color:rgba(126,182,214,.85)}
${SURFACE_NAME} .chat-context-chip{flex:0 0 auto;display:inline-flex;align-items:center;gap:.25em;padding:.05em .4em;border:1px solid rgba(126,182,214,.45);border-radius:var(--hc-radius-control,2px);background:rgba(126,182,214,.1);color:rgba(126,182,214,.95);font:inherit;font-size:.92em;cursor:pointer}
${SURFACE_NAME} .chat-context-chip:hover{background:rgba(126,182,214,.18)}
${SURFACE_NAME} .chat-context-chip:focus-visible{outline:1px solid rgba(126,182,214,.7);outline-offset:1px}
${SURFACE_NAME} .chat-context-chip .mat-sym{font-size:1.05em}
${SURFACE_NAME} .chat-context-off{opacity:.7;font-size:1.05em;line-height:1}
${SURFACE_NAME} .chat-context{flex:0 0 auto;display:inline-flex;align-items:center;gap:.15em;color:rgba(224,180,92,.9)}
${SURFACE_NAME} .chat-context .mat-sym{font-size:1.15em}
${SURFACE_NAME} .chat-link{display:flex;align-items:center;gap:.35em;padding-bottom:.5em;font-size:.65em;color:rgba(140,220,170,.85)}
${SURFACE_NAME} .chat-link.down{color:rgba(255,255,255,.42)}
${SURFACE_NAME} .chat-link.waiting{color:rgba(224,180,92,.88)}
${SURFACE_NAME} .chat-dot{width:.55em;height:.55em;border-radius:999px;background:currentColor}
${SURFACE_NAME} .chat-inputrow{display:flex;align-items:flex-end;gap:.4em;margin-top:.45em;--hc-chat-line:max(.8em,16px);--hc-chat-box:calc(2.45 * var(--hc-chat-line))}
${SURFACE_NAME} .chat-input{flex:1 1 auto;box-sizing:border-box;resize:none;min-height:var(--hc-chat-box);max-height:160px;padding:.5em .6em;font:inherit;font-family:var(--hc-read,inherit);font-size:var(--hc-chat-line);line-height:1.45;color:whitesmoke;caret-color:rgba(126,182,214,.95);background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.13);border-radius:var(--md-shape-xs,4px);outline:none;transition:border-color 140ms ease,box-shadow 140ms ease;scrollbar-width:thin;scrollbar-color:rgba(126,182,214,.38) transparent}
${SURFACE_NAME} .chat-input:focus{border-color:rgba(126,182,214,.6);box-shadow:0 0 0 1px rgba(126,182,214,.18)}
${SURFACE_NAME} .chat-input::-webkit-scrollbar{width:.5em}
${SURFACE_NAME} .chat-input::-webkit-scrollbar-track{background:transparent}
${SURFACE_NAME} .chat-input::-webkit-scrollbar-button{display:none;height:0;width:0}
${SURFACE_NAME} .chat-input::-webkit-scrollbar-thumb{background:rgba(126,182,214,.32);border-radius:.25em;border:2px solid transparent;background-clip:padding-box}
${SURFACE_NAME} .chat-input:hover::-webkit-scrollbar-thumb{background-clip:padding-box;background:rgba(126,182,214,.5)}
${SURFACE_NAME} .chat-send{flex:0 0 auto;display:inline-grid;place-items:center;padding:0;border-radius:var(--hc-radius-control);width:var(--hc-chat-box);height:var(--hc-chat-box);background:rgba(126,182,214,.9);border:1px solid rgba(126,182,214,.9);color:#0c1118;cursor:pointer}
${SURFACE_NAME} .chat-send .mat-sym{font-size:1.05em}
${SURFACE_NAME} .chat-send:hover{background:#7eb6d6}

/* ── chat-markdown.scss ─────────────────────────────────────────────────
   Half of this sheet was \`:host ::ng-deep\` because a rendered answer is
   written with innerHTML and carries no \`_ngcontent\` attribute, so emulated
   encapsulation would have matched nothing. Without encapsulation the deep
   prefix simply disappears — the tag prefix does the same containment job. */
${SURFACE_NAME} .chat-msg-text{word-break:break-word}
${SURFACE_NAME} .chat-msg-text>:first-child{margin-top:0}
${SURFACE_NAME} .chat-msg-text>:last-child{margin-bottom:0}
${SURFACE_NAME} .chat-msg-text p{margin:0 0 .7em}
${SURFACE_NAME} .chat-msg-text h1,${SURFACE_NAME} .chat-msg-text h2,${SURFACE_NAME} .chat-msg-text h3,${SURFACE_NAME} .chat-msg-text h4,${SURFACE_NAME} .chat-msg-text h5,${SURFACE_NAME} .chat-msg-text h6{margin:1.1em 0 .45em;font-weight:600;line-height:1.3;color:rgba(126,182,214,.95)}
${SURFACE_NAME} .chat-msg-text h1{font-size:1.15em}
${SURFACE_NAME} .chat-msg-text h2{font-size:1.08em}
${SURFACE_NAME} .chat-msg-text h3{font-size:1em}
${SURFACE_NAME} .chat-msg-text h4,${SURFACE_NAME} .chat-msg-text h5,${SURFACE_NAME} .chat-msg-text h6{font-size:.95em;color:rgba(238,244,250,.9)}
${SURFACE_NAME} .chat-msg-text ul,${SURFACE_NAME} .chat-msg-text ol{margin:0 0 .7em;padding-left:1.35em}
${SURFACE_NAME} .chat-msg-text li{margin:.15em 0}
${SURFACE_NAME} .chat-msg-text li>ul,${SURFACE_NAME} .chat-msg-text li>ol,${SURFACE_NAME} .chat-msg-text>ul ul,${SURFACE_NAME} .chat-msg-text>ul ol,${SURFACE_NAME} .chat-msg-text>ol ul,${SURFACE_NAME} .chat-msg-text>ol ol{margin-bottom:0}
${SURFACE_NAME} .chat-msg-text blockquote{margin:0 0 .7em;padding:.1em 0 .1em .8em;border-left:2px solid rgba(126,182,214,.4);color:rgba(238,244,250,.72);font-style:italic}
${SURFACE_NAME} .chat-msg-text hr{margin:1em 0;border:none;border-top:1px solid rgba(255,255,255,.12)}
${SURFACE_NAME} .chat-msg-text strong{font-weight:650;color:#fff}
${SURFACE_NAME} .chat-msg-text del{opacity:.6}
${SURFACE_NAME} .chat-msg-text code{padding:.1em .32em;font-family:var(--hc-code);font-variant-ligatures:var(--hc-code-ligatures);font-size:.9em;background:rgba(6,10,16,.6);border:1px solid rgba(255,255,255,.08);border-radius:var(--md-shape-xs,4px)}
${SURFACE_NAME} .chat-link-out{color:rgba(126,182,214,.95);text-decoration:underline;text-underline-offset:2px;overflow-wrap:anywhere}
${SURFACE_NAME} .chat-link-out:hover{color:#fff}
${SURFACE_NAME} .chat-path{display:inline-flex;align-items:center;gap:.2em;padding:.05em .4em .05em .3em;font:inherit;font-family:var(--hc-code);font-variant-ligatures:var(--hc-code-ligatures);font-size:.88em;color:rgba(224,180,92,.95);background:rgba(224,180,92,.1);border:1px solid rgba(224,180,92,.35);border-radius:999px;cursor:pointer;vertical-align:baseline}
${SURFACE_NAME} .chat-path:hover{color:#fff;background:rgba(224,180,92,.24)}
${SURFACE_NAME} .chat-path .chat-path-glyph{font-size:.95em;opacity:.8}
${SURFACE_NAME} .chat-code{margin:0 0 .7em;border:1px solid rgba(255,255,255,.1);border-radius:var(--md-shape-xs,4px);background:rgba(6,10,16,.78);overflow:hidden}
${SURFACE_NAME} .chat-code pre{margin:0;padding:.6em .7em;overflow-x:auto;scrollbar-width:thin;scrollbar-color:rgba(126,182,214,.3) transparent}
${SURFACE_NAME} .chat-code code{display:block;padding:0;font-family:var(--hc-code);font-variant-ligatures:var(--hc-code-ligatures);font-size:.88em;line-height:1.5;color:#d9e4ee;background:none;border:none;white-space:pre}
${SURFACE_NAME} .chat-code .chat-code-bar{display:flex;align-items:center;gap:.5em;padding:.2em .4em .2em .6em;background:rgba(255,255,255,.035);border-bottom:1px solid rgba(255,255,255,.07)}
${SURFACE_NAME} .chat-code .chat-code-lang{flex:1 1 auto;min-width:0;font-size:.7em;letter-spacing:.06em;text-transform:lowercase;color:rgba(255,255,255,.42)}
${SURFACE_NAME} .chat-code .chat-code-copy{flex:0 0 auto;padding:.15em .5em;font:inherit;font-size:.68em;letter-spacing:.04em;color:rgba(126,182,214,.85);background:none;border:1px solid rgba(126,182,214,.28);border-radius:var(--md-shape-xs,4px);cursor:pointer}
${SURFACE_NAME} .chat-code .chat-code-copy:hover{background:rgba(126,182,214,.15);color:#fff}
${SURFACE_NAME} .chat-code .hljs-comment,${SURFACE_NAME} .chat-code .hljs-quote{color:rgba(255,255,255,.35);font-style:italic}
${SURFACE_NAME} .chat-code .hljs-keyword,${SURFACE_NAME} .chat-code .hljs-selector-tag,${SURFACE_NAME} .chat-code .hljs-literal,${SURFACE_NAME} .chat-code .hljs-doctag{color:#c99bf0}
${SURFACE_NAME} .chat-code .hljs-string,${SURFACE_NAME} .chat-code .hljs-regexp,${SURFACE_NAME} .chat-code .hljs-addition{color:#9fd6a0}
${SURFACE_NAME} .chat-code .hljs-number,${SURFACE_NAME} .chat-code .hljs-symbol,${SURFACE_NAME} .chat-code .hljs-bullet{color:#e0b45c}
${SURFACE_NAME} .chat-code .hljs-title,${SURFACE_NAME} .chat-code .hljs-name,${SURFACE_NAME} .chat-code .hljs-section,${SURFACE_NAME} .chat-code .hljs-selector-id{color:#7eb6d6}
${SURFACE_NAME} .chat-code .hljs-attr,${SURFACE_NAME} .chat-code .hljs-attribute,${SURFACE_NAME} .chat-code .hljs-variable,${SURFACE_NAME} .chat-code .hljs-template-variable{color:#86cdd6}
${SURFACE_NAME} .chat-code .hljs-type,${SURFACE_NAME} .chat-code .hljs-built_in{color:#d6b98a}
${SURFACE_NAME} .chat-code .hljs-meta{color:rgba(255,255,255,.45)}
${SURFACE_NAME} .chat-code .hljs-deletion{color:#e08a8a}
${SURFACE_NAME} .chat-code .hljs-emphasis{font-style:italic}
${SURFACE_NAME} .chat-code .hljs-strong{font-weight:600}
${SURFACE_NAME} .chat-table{margin:0 0 .7em;overflow-x:auto;scrollbar-width:thin;scrollbar-color:rgba(126,182,214,.3) transparent}
${SURFACE_NAME} .chat-table table{border-collapse:collapse;font-size:.92em;min-width:100%}
${SURFACE_NAME} .chat-table th,${SURFACE_NAME} .chat-table td{padding:.32em .6em;text-align:left;white-space:nowrap;border:1px solid rgba(255,255,255,.1)}
${SURFACE_NAME} .chat-table th{font-weight:600;color:rgba(126,182,214,.92);background:rgba(255,255,255,.04)}
${SURFACE_NAME} .chat-msg{position:relative}
${SURFACE_NAME} .chat-acts{position:absolute;top:-.55em;right:.35em;display:flex;gap:.1em;padding:.1em;border-radius:var(--md-shape-xs,4px);background:rgba(10,16,24,.92);border:1px solid rgba(255,255,255,.1);opacity:0;transition:opacity 120ms ease}
${SURFACE_NAME} .chat-acts button{padding:.15em .25em;background:none;border:none;color:rgba(255,255,255,.5);cursor:pointer;border-radius:var(--md-shape-xs,4px)}
${SURFACE_NAME} .chat-acts button .mat-sym{font-size:.95em;display:block}
${SURFACE_NAME} .chat-acts button:hover{color:rgba(126,182,214,.98);background:rgba(126,182,214,.14)}
${SURFACE_NAME} .chat-acts button:disabled{opacity:.35;cursor:default;background:none}
${SURFACE_NAME} .chat-msg:hover .chat-acts,${SURFACE_NAME} .chat-acts:focus-within{opacity:1}
@media (hover:none){${SURFACE_NAME} .chat-acts{opacity:.75}}
${SURFACE_NAME} .chat-wait{display:flex;align-items:baseline;gap:.6em;color:rgba(216,230,238,.6)}
${SURFACE_NAME} .chat-wait-clock{flex:0 0 auto;font-family:var(--hc-code);font-variant-ligatures:var(--hc-code-ligatures);font-size:.85em;color:rgba(255,255,255,.4);font-variant-numeric:tabular-nums}
${SURFACE_NAME} .chat-wait-hint{align-self:flex-start;max-width:92%;margin:-.2em 0 0;padding:0 .2em;font-size:.72em;line-height:1.5;color:rgba(224,180,92,.85)}
${SURFACE_NAME} .chat-threadwrap{position:relative;flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
${SURFACE_NAME} .chat-pill{position:absolute;left:50%;bottom:.7em;transform:translateX(-50%);z-index:2;display:flex;align-items:center;gap:.3em;padding:.3em .75em;font:inherit;font-size:.7em;color:#0c1118;background:rgba(126,182,214,.94);border:none;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.45);cursor:pointer}
${SURFACE_NAME} .chat-pill .mat-sym{font-size:1.15em}
${SURFACE_NAME} .chat-pill:hover{background:#7eb6d6}

/* ── chat-peek.scss — the window folded away to the hive ───────────────── */
${SURFACE_NAME}.peeking{pointer-events:none;background:none;border:none;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;padding-left:0}
${SURFACE_NAME}.peeking .chat-rail,${SURFACE_NAME}.peeking .chat-bar,${SURFACE_NAME}.peeking .chat-list,${SURFACE_NAME}.peeking .chat-threadwrap,${SURFACE_NAME}.peeking .chat-setup{display:none}
${SURFACE_NAME}.peeking .chat-foot{margin-top:auto}
${SURFACE_NAME}.peeking .chat-header,${SURFACE_NAME}.peeking .chat-foot{pointer-events:auto;position:relative;isolation:isolate;background:none;border-color:rgba(126,182,214,.3)}
${SURFACE_NAME}.peeking .chat-header::before,${SURFACE_NAME}.peeking .chat-foot::before{content:'';position:absolute;inset:0;z-index:-1;background:rgba(6,10,16,.82);backdrop-filter:blur(10px) saturate(1.1);-webkit-backdrop-filter:blur(10px) saturate(1.1)}
${SURFACE_NAME}.peeking .chat-header::before{border-bottom:1px solid rgba(126,182,214,.28)}
${SURFACE_NAME}.peeking .chat-foot::before{border-top:1px solid rgba(126,182,214,.28)}
${SURFACE_NAME} .chat-peek,${SURFACE_NAME} .chat-providers{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:1.9em;height:1.9em;padding:0;border:1px solid transparent;border-radius:.35em;background:none;color:rgba(255,255,255,.55);cursor:pointer;transition:color .14s ease,background .14s ease,border-color .14s ease}
${SURFACE_NAME} .chat-peek .mat-sym,${SURFACE_NAME} .chat-providers .mat-sym{font-size:1.05em}
${SURFACE_NAME} .chat-peek:hover,${SURFACE_NAME} .chat-peek:focus-visible,${SURFACE_NAME} .chat-providers:hover,${SURFACE_NAME} .chat-providers:focus-visible{color:rgba(126,182,214,.95);background:rgba(126,182,214,.12)}
${SURFACE_NAME} .chat-peek.on,${SURFACE_NAME} .chat-providers.on{color:rgba(126,182,214,.95);background:rgba(126,182,214,.16);border-color:rgba(126,182,214,.4)}

/* ── chat-look.scss — a shelf picture, full size, without leaving ──────── */
${SURFACE_NAME} .chat-box-look{flex:0 0 auto;display:block;padding:0;margin:0;border:0;background:none;line-height:0;cursor:zoom-in}
${SURFACE_NAME} .chat-box-look:focus-visible{outline:1px solid rgba(126,182,214,.7);outline-offset:1px}
${SURFACE_NAME} .chat-look{position:absolute;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.6rem;padding:1.2rem;box-sizing:border-box;background:rgba(6,10,14,.94);cursor:zoom-out}
${SURFACE_NAME} .chat-look:focus{outline:none}
${SURFACE_NAME} .chat-look-img{max-width:100%;min-height:0;flex:0 1 auto;object-fit:contain;border-radius:var(--hc-radius-card,3px);cursor:default;background:rgba(10,16,22,.9)}
${SURFACE_NAME} .chat-look-bar{flex:0 0 auto;display:flex;align-items:center;gap:.5rem;max-width:100%;cursor:default;color:rgba(126,182,214,.85);font-size:.82rem}
${SURFACE_NAME} .chat-look-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--hc-mono,monospace)}
${SURFACE_NAME} .chat-look-count{flex:0 0 auto;font-family:var(--hc-mono,monospace);opacity:.6}
${SURFACE_NAME} .chat-look-step,${SURFACE_NAME} .chat-look-off{flex:0 0 auto;display:grid;place-items:center;padding:.2rem;border:0;border-radius:var(--hc-radius-control,2px);background:none;color:inherit;font:inherit;line-height:1;opacity:.8;cursor:pointer}
${SURFACE_NAME} .chat-look-step .mat-sym,${SURFACE_NAME} .chat-look-off .mat-sym{font-size:1.15rem}
${SURFACE_NAME} .chat-look-step:hover,${SURFACE_NAME} .chat-look-off:hover{opacity:1;background:rgba(126,182,214,.14)}
${SURFACE_NAME} .chat-look-step:focus-visible,${SURFACE_NAME} .chat-look-off:focus-visible{outline:1px solid rgba(126,182,214,.7);outline-offset:1px}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-chat-window', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** One rendered turn, kept across renders — the sanctioned per-panel keyed map
 *  (see the header). `turn` is what the node was built FROM, so a key that
 *  comes back pointing at different text rebuilds rather than lying. */
type TurnRow = {
  el: HTMLElement
  turn: ChatTurn
  copyGlyph: HTMLElement
  retry: HTMLButtonElement
}

/** One row of the roster — a conversation you could return to, whether it
 *  holds turns, a draft, or both. */
type RosterRow = {
  convoId: string
  tile: string
  title: string
  turnCount: number
  lastAt: number
  draft: string
  archived: boolean
}

export class ChatWindowElement extends DockedPanelElement {

  // ── state (services and fields, never the DOM) ───────────────────────
  #offs: Array<() => void> = []

  /** Chat stays discoverable, but only a participant-supplied responder makes
   *  it interactive. `#bridgeConfigured` is stable through a temporary
   *  disconnect; `#bridgeUp` is merely the live transport state. */
  #bridgeConfigured = isLocalClaudeBridgeConfigured()
  #hostConfigured = isParticipantAiHostConfigured()
  #bridgeUp = false
  #providerReady = false

  /** THE visibility flag — the field `open`, `close`, the toggle and the
   *  session's park/unpark all read and write. */
  #visible = false

  #conversations: readonly ConversationSummary[] = []
  #activeId = ''
  #turns: readonly ChatTurn[] = []

  /** The conversation list, open. Collapsed by default. */
  #listOpen = false

  /** A question is out and its answer has not come back. Per window. */
  #waiting = false
  #askedAt = 0
  #elapsed = 0

  /** The host tier is mid-stream: interrupting it means aborting a live fetch.
   *  A bridge ask, by contrast, is a durable record — see `#pendingSig`. */
  #hostStreaming = false

  /** The QUEUED bridge ask's record signature — the whole handle on a question
   *  that has left but not been picked up. */
  #pendingSig = ''

  /** An explicitly named model overrides policy; an empty model lets policy
   *  designate the provider and model for the question. */
  #model = ''
  #modelExplicit = false
  #designated: DesignationLike | null = null
  #providersOpen = false

  /** An answer arriving a chunk at a time. Held apart from `#turns` because it
   *  is not a turn yet — it becomes one, once, when the stream closes. */
  #streaming = ''

  /** Where the participant is standing, and what they have selected. */
  #here: readonly string[] = []
  #targets: readonly string[] = []

  /** The tile whose conversation is open. Null means a free-floating chat. */
  #railSubject: RailPickLike | null = null

  /** THE SHELF — the references this request carries, in the order they were
   *  pasted. Chat-local: the clipboard is where things are gathered, this is
   *  where they are committed to the question. */
  #references: readonly RailPickLike[] = []

  /** What the clipboard is holding right now — mirrored from
   *  `clipboard:changed` (last-value replayed). Read-only here. */
  #clipboardHeld: readonly RailPickLike[] = []
  #clipboardOpen = false

  /** pick.key → blob: URL of the tile's PICTURE ('large'). */
  #contextThumbs: Record<string, string> = {}
  #thumbUrls = new Map<string, string>()
  #thumbToken = 0

  /** The shelf picture on screen, by its entry key — or null. */
  #viewing: { key: string; name: string } | null = null

  /** How many context branches are ATTACHED to this tile. */
  #contextCount = 0

  /** Unsent drafts, by their own key — a tile path, or a free chat's id. */
  #drafts: readonly { key: string; text: string }[] = []

  #archiveOpen = false
  #goalOpen = false
  #armed = ''
  #atBottom = true
  #copiedTurn = ''

  // guided setup
  #setupDone = readFlag(SETUP_DONE_KEY)
  #toolsDone = readFlag(SETUP_TOOLS_KEY)
  #firstReply = readFlag(FIRST_REPLY_KEY)
  #copied = ''
  #tried = false

  /** The local bridge only exists on loopback — elsewhere the step explains
   *  instead of offering a button that could never work. */
  readonly #loopback = ((): boolean => {
    try {
      const host = String(globalThis.location?.hostname ?? '').toLowerCase()
      return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
    } catch { return false }
  })()

  /** Is the sidebar on screen — i.e. is the rail carrying the chat list? */
  #railVisible = true
  #railQuery: MediaQueryList | null = null

  /** The window is folded away to the hive. */
  #peeking = false
  #foldSuspendedViewport = false
  #surfaceWanted = false
  #railWidth = readRailWidth()

  #dragOverReference = false
  #draggingRef: number | null = null

  /** ONE rail per window lifetime. */
  #rail: TilesRailLike | null = null
  /** The rail picks last reported, keyed by row key — what lets a selection
   *  change flow into the clipboard as ADDS and REMOVES. */
  #railSeen = new Map<string, RailPickLike>()

  /** The text last written to the drafts pool for the open conversation. */
  #heldDraft = ''
  #draftTimer: ReturnType<typeof setTimeout> | null = null

  /** Questions that are out, by conversation. */
  readonly #outstanding = new Map<string, { sig: string; askedAt: number }>()

  /** text → rendered HTML. Bounded; keyed by content, so an identical turn
   *  reaching two threads is parsed once. */
  readonly #rendered = new Map<string, string>()

  #recovered = false
  #elapsedTimer: ReturnType<typeof setInterval> | null = null
  /** Every short-lived timeout, so none of them outlives the element. */
  readonly #timers = new Set<ReturnType<typeof setTimeout>>()

  // ── chrome, built once per activation ────────────────────────────────
  //
  // The header must survive every re-render because DockedPanelElement plants
  // the settings gear inside it — and nudges the close button over to make
  // room — AFTER renderPanel() returns. Rebuilding the header would throw the
  // gear away. Everything below is therefore built once and MUTATED.
  #railHost: HTMLElement | null = null
  #headerEl: HTMLElement | null = null
  #subjectEl: HTMLElement | null = null
  #payloadEl: HTMLElement | null = null
  #clipBtn: HTMLButtonElement | null = null
  #clipShelfEl: HTMLElement | null = null
  #headerSpaceEl: HTMLElement | null = null
  #peekBtn: HTMLButtonElement | null = null
  #providersBtn: HTMLButtonElement | null = null
  #closeBtn: HTMLButtonElement | null = null
  #bodyEl: HTMLElement | null = null
  #lookEl: HTMLElement | null = null
  /** What the picture viewer is currently drawing, so an unrelated render does
   *  not rebuild it under the participant's hands. */
  #lookStamp = ''

  /** Which of Angular's two `@if (showSetup())` branches is built. */
  #branch: 'none' | 'setup' | 'chat' = 'none'

  // the setup branch
  #setupEl: HTMLElement | null = null
  #setupCompleteEl: HTMLElement | null = null
  /** The step-1–4 branch, as siblings — see `#buildSetup`. */
  #setupChecklist: HTMLElement[] = []
  #setupHostBlock: HTMLElement | null = null
  #setupSkipEl: HTMLElement | null = null
  #setupNoteEl: HTMLElement | null = null
  #setupHeadingEl: HTMLElement | null = null
  #setupBodyEl: HTMLElement | null = null
  #wizardEl: HTMLElement | null = null
  #hostInputEl: HTMLInputElement | null = null

  // the chat branch
  #barEl: HTMLElement | null = null
  #goalEl: HTMLElement | null = null
  #listEl: HTMLElement | null = null
  #threadWrapEl: HTMLElement | null = null
  #threadEl: HTMLElement | null = null
  #pillEl: HTMLButtonElement | null = null
  #footEl: HTMLElement | null = null
  #linkEl: HTMLElement | null = null
  #linkTextEl: HTMLElement | null = null
  #answeringEl: HTMLButtonElement | null = null
  #inputRowEl: HTMLElement | null = null
  /** THE COMPOSER. Created once per activation and never replaced. */
  #inputEl: HTMLTextAreaElement | null = null
  #sendBtn: HTMLButtonElement | null = null
  #emptyEl: HTMLElement | null = null
  #streamEl: HTMLElement | null = null
  #streamTextEl: HTMLElement | null = null
  #waitEl: HTMLElement | null = null
  #waitTextEl: HTMLElement | null = null
  #waitClockEl: HTMLElement | null = null
  #waitHintEl: HTMLElement | null = null

  /** The transcript's live rows, by key. */
  readonly #rows = new Map<string, TurnRow>()

  /** The two bars' viewport reservations, live only while folded away. */
  #headerInset: Inset | null = null
  #footInset: Inset | null = null

  constructor() {
    super()
    // Same panel id the Angular `hcDockedPanel="chat-window"` carried, so the
    // saved width (`hc:docked-width:chat-window`), text size, code font and
    // group membership all come across with the participant.
    this.panelId = 'chat-window'
    this.dockSide = 'right'
    this.minWidth = 300
    this.maxWidth = 720
    this.defaultWidth = 400
    this.defaultText = 1
    // `[hasReadingSurface]="true"` — the transcript is prose, so the settings
    // popover offers the reading-font row.
    this.hasReadingSurface = true
    // Registry-fed: mounted once at boot, engaged only when something opens it.
    this.autoActivate = false
    // THE PANEL RESERVES NO EDGE. It is full screen; a right-edge inset the
    // width of the screen is the exact lie dock-inset.directive guards against.
    // What DOES reserve is the header and the footer while folded away —
    // hcDockInset="top"/"bottom" in the template, attached in renderPanel().
    this.setInsetActive(false)
    // The Angular original built this with `signalSession(visible, announce,
    // { close })`. Reproduced literally: park/unpark flip visibility and
    // announce, and the announcement is where everything that follows the
    // window off screen is said once — the `chat:window-state` light, the
    // `view:active` claim (a parked window covers nothing) and the fold (a
    // parked window must stop offering "add to the request" out in the hive).
    this.session = {
      park: () => { this.#hide(); this.#announceSession(false) },
      unpark: () => { this.#show(); this.#announceSession(true) },
      close: () => this.close(),
    }
  }

  /** signalSession's `announce` callback, verbatim. */
  #announceSession(open: boolean): void {
    EffectBus.emit('chat:window-state', { open })
    this.#claimSurface(open && !this.#peeking)
    this.#applyFold()
  }

  // ── derived readings (Angular computeds, as methods) ─────────────────

  #enabled(): boolean { return this.#providerReady || this.#bridgeConfigured || this.#hostConfigured }

  #answering(): string { return this.#model || this.#designated?.model || DEFAULT_MODEL }

  #answeringWhy(): string {
    const chosen = this.#designated
    return chosen ? `${chosen.label} · ${chosen.tier}` : ''
  }

  #path(): string { return this.#here.length ? '/' + this.#here.join('/') : '/' }

  #empty(): boolean { return this.#turns.length === 0 && !this.#streaming }

  /** Something can be called back: a live stream can be aborted, a queued ask
   *  can be taken out of the pool. */
  #canStop(): boolean { return this.#waiting && (this.#hostStreaming || !!this.#pendingSig) }

  /** NOBODY IS LISTENING. The question is a durable record in the optimization
   *  pool and no Claude session is connected to drain it — so it is not slow,
   *  it is unattended, and saying "Thinking…" would be a lie. */
  #unattended(): boolean {
    return this.#waiting && !this.#hostStreaming && !this.#bridgeUp && this.#bridgeConfigured
  }

  /** m:ss once past a minute — a bare "127s" makes people do arithmetic. */
  #elapsedLabel(): string {
    const seconds = this.#elapsed
    if (seconds < 60) return `${seconds}s`
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
  }

  /** The wizard shows until the checklist completes (or is skipped). A
   *  configured host needs no checklist; a veteran with existing threads is
   *  grandfathered in `#resume`. */
  #showSetup(): boolean {
    return !this.#enabled() || (this.#bridgeConfigured && !this.#hostConfigured && !this.#setupDone)
  }

  /** The one current step — everything before it is checked, everything after
   *  it waits. 5 = complete. */
  #setupStep(): number {
    if (!this.#toolsDone) return 1
    if (!this.#bridgeConfigured) return 2
    if (!this.#bridgeUp) return 3
    if (!this.#firstReply) return 4
    return 5
  }

  /** The tile path this conversation belongs to, or '' for a free chat. Read
   *  off the CONVERSATION, never off the sidebar — a thread resumed from the
   *  roster has no sidebar state at all. */
  #subjectPath(): string { return this.#threads()?.tilePathOf?.(this.#activeId) ?? '' }

  /** What the header says: the tile's own name, or nothing to name. */
  #subjectName(): string {
    const path = this.#subjectPath()
    if (!path || path === '/') return ''
    const segments = path.split('/').filter(Boolean)
    return segments[segments.length - 1] ?? ''
  }

  /** The active thread's name — its first message. Read from the list when it
   *  is there, else from the turns in hand. */
  #activeTitle(): string {
    const id = this.#activeId
    const listed = this.#conversations.find(c => c.convoId === id)?.title
    return listed || this.#titleFrom(this.#turns)
  }

  /** First line of the first user turn — the same naming rule the threads
   *  module applies, so the in-memory list bump and a cold re-list agree. */
  #titleFrom(turns: readonly ChatTurn[]): string {
    const lead = turns.find(turn => turn.role === 'user') ?? turns[0]
    const line = String(lead?.text ?? '').split('\n').map(s => s.trim()).find(Boolean) ?? ''
    return line.length > 72 ? line.slice(0, 71).trimEnd() + '…' : line
  }

  /** THE ROSTER — every conversation you could return to, which is not the
   *  same as every conversation that holds a turn. A chat you typed into and
   *  left without sending has no turns, so the thread walk cannot see it; the
   *  drafts are folded in here, and tile chats are named by their TILE. */
  #roster(): RosterRow[] {
    const threads = this.#threads()
    const tileOf = (id: string): string => threads?.tilePathOf?.(id) ?? ''
    const rows = this.#conversations.map(convo => ({
      convoId: convo.convoId,
      tile: tileOf(convo.convoId),
      title: convo.title,
      turnCount: convo.turnCount,
      lastAt: convo.lastAt,
      draft: '',
      archived: !!convo.archived,
    }))

    const known = new Set(rows.map(row => row.convoId))
    for (const held of this.#drafts) {
      // A tile's draft is keyed by its path; a free chat's by its own id.
      const convoId = held.key.startsWith('/')
        ? (threads?.tileConvoId?.(held.key.split('/').filter(Boolean)) ?? '')
        : held.key
      if (!convoId) continue
      const existing = rows.find(row => row.convoId === convoId)
      if (existing) { existing.draft = held.text; continue }
      if (known.has(convoId)) continue
      rows.push({
        convoId, tile: tileOf(convoId), title: held.text,
        turnCount: 0, lastAt: 0, draft: held.text, archived: false,
      })
    }
    return rows.sort((a, b) => b.lastAt - a.lastAt)
  }

  /** The list as it is READ — everything that has not been put away. */
  #liveRoster(): RosterRow[] { return this.#roster().filter(row => !row.archived) }
  /** And what has been. Shown only when asked for; see `#archiveOpen`. */
  #filedRoster(): RosterRow[] { return this.#roster().filter(row => row.archived) }

  #activeGoal(): { details: string; at: number } | undefined {
    return this.#conversations.find(convo => convo.convoId === this.#activeId)?.goal
  }

  /** Is the conversation in hand put away? A fresh chat that has never been
   *  listed is not — nothing has been said in it to file. */
  #activeArchived(): boolean {
    return !!this.#conversations.find(convo => convo.convoId === this.#activeId)?.archived
  }

  /** Does the loaded essentials build know how to archive? A control that
   *  cannot do anything is worse than one that is not there. Asked at READ
   *  time, because the module registers itself whenever it lands. */
  #canArchive(): boolean { return !!this.#threads()?.setConversationArchived }

  /** What the next question is about, counted for the status row — the SAME
   *  deduped union `send()` will carry. */
  #chosen(): number { return this.#chosenTargets().length }

  // ── services ─────────────────────────────────────────────────────────
  #threads(): ChatThreadsLike | undefined { return get<ChatThreadsLike>(THREADS_IOC_KEY) }
  #queen(): QueenLike | undefined { return get<QueenLike>(QUEEN_IOC_KEY) }

  #refreshAvailability(): void {
    this.#bridgeConfigured = isLocalClaudeBridgeConfigured()
    const host = get<HostAiLike>(HOST_AI_IOC_KEY)
    this.#hostConfigured = host ? !!host.configured : isParticipantAiHostConfigured()
  }

  #refreshDesignation(): void {
    const policy = get<PolicyLike>('@diamondcoreprocessor.com/LlmPolicyStore')
    const need = { tier: 'fast', streaming: true }
    this.#designated = policy?.designate?.(need) ?? null
    const router = get<LlmRouterLike>(LLM_ROUTER_IOC_KEY)
    this.#providerReady = !!router?.ready?.({
      model: this.#modelExplicit ? this.#model || undefined : undefined,
      preferModel: !this.#modelExplicit ? this.#model || undefined : undefined,
      need,
    })
    if (this.#visible) this.#renderFoot()
  }

  openProviders(): void { EffectBus.emit('providers:open', {}) }

  /** A timeout that cannot outlive the element. */
  #after(ms: number, run: () => void): void {
    const id = setTimeout(() => { this.#timers.delete(id); run() }, ms)
    this.#timers.add(id)
  }

  // ── lifecycle ────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback()   // autoActivate is false — this engages nothing
    installCss()
    // `<aside role="dialog">`'s attributes, kept by hand. `aria-label` follows
    // the aside's EXISTENCE (set on show, removed on hide) so a closed window
    // is not announced; role and tabindex are structural and stay.
    this.setAttribute('role', 'dialog')
    this.setAttribute('data-consumes-wheel', '')
    this.tabIndex = -1
    // `(keydown)="onKey($event)"` on the aside. A RAW listener, exactly as the
    // template bound it — NOT Angular's `keydown.escape` form, so there is no
    // modifier composition to reproduce and adding a
    // ctrl/alt/shift/meta guard here would ITSELF be the regression.
    this.addEventListener('keydown', this.#onKey)

    this.#visible = rememberedChatVisibility(this.#bridgeConfigured)

    this.#offs.push(
      // A TILE PRESSED OUT IN THE HIVE. The hexagons carry the icon while the
      // window is folded away; the window owns the shelf, so the press arrives
      // here as a plain reference rather than the canvas reaching into it.
      EffectBus.on<DroppedTile>('chat:add-context', payload => {
        if (!payload?.path && !payload?.sig) return
        this.toggleContext({
          name: String(payload.name ?? ''),
          path: String(payload.path ?? ''),
          sig: String(payload.sig ?? ''),
        })
      }),

      EffectBus.on<{ model?: string; prefill?: string; convoId?: string }>(
        'chat:open', payload => { void this.open(payload) }),

      EffectBus.on('chat:toggle', () => {
        if (this.#visible) this.close()
        else void this.open()
      }),

      // THE KEY IS THE SAME ACT. `a` (keyboard/default-keymap.ts) dispatches
      // through the keymap's one lane rather than a second toggle event, so
      // the shortcut, the command-line icon and the palette all end up in the
      // branch above — there is one way this window opens, however you ask.
      EffectBus.on<{ cmd?: string }>('keymap:invoke', payload => {
        if (payload?.cmd !== 'chat.toggle') return
        if (this.#visible) this.close()
        else void this.open()
      }),

      EffectBus.on('chat:close', () => { if (this.#visible) this.close() }),

      // A draft landing anywhere — this composer, another window, a sweep — is
      // a change to the roster, because a conversation that holds only unsent
      // words is still a conversation you must be able to get back to.
      EffectBus.on('chat:drafts-changed', () => { void this.#refreshDrafts() }),

      // TERMINAL SIGNAL. The orchestrator says a conversation reached its goal;
      // the list learns the flag and the window in that thread opens the panel.
      EffectBus.on<{ convoId?: string }>('chat:goal-reached', payload => {
        void this.#refreshList().then(() => {
          if (payload?.convoId === this.#activeId) { this.#goalOpen = true; this.#render() }
        })
      }),

      // ── WHAT THERE IS TO PASTE ───────────────────────────────────────
      // The clipboard's own contents, for the header's flyout. Last-value
      // replay means the shelf's source is current the moment the window
      // opens — including everything gathered before it existed. This is the
      // ONLY writer of `#clipboardHeld`; the clipboard owns the truth.
      EffectBus.on<{ items?: readonly { label: string; sourceSegments: readonly string[]; sig?: string }[] }>(
        'clipboard:changed', payload => {
          const raw = payload?.items
          const items = Array.isArray(raw) ? raw : []
          this.#clipboardHeld = items.map(item => ({
            key: '/' + [...item.sourceSegments, item.label].join('/'),
            path: [...item.sourceSegments],
            name: item.label,
            sig: item.sig,
          }))
          if (!this.#clipboardHeld.length) this.#clipboardOpen = false
          // Both faces draw from one thumbnail cache: an item pasted onto the
          // shelf must not have to re-resolve a picture the flyout just had.
          void this.#refreshContextThumbs()
          this.#renderHeader()
        }),

      // The retired ask screen's channel. Kept because other surfaces open a
      // conversation through it — the skills window's "use" action and the
      // context window's "ask about this tile".
      EffectBus.on<{ model?: string; prefill?: string }>(
        'ask:open', payload => { void this.open(payload) }),

      // A reply landed. It is already ON DISK by the time this fires
      // (chat-thread.deliverTurn writes, then announces).
      EffectBus.on<{ convoId: string; text: string }>(
        'ask:chat-reply', payload => this.#onReply(payload)),

      // THE SHALLOW TIER'S OWN LANE. Its run outlives this element
      // (host-stream.ts), so the answer reaches the window the same way the
      // bridge's does: as an announcement about a conversation.
      EffectBus.on<{ convoId?: string; text?: string }>(
        'chat:host-chunk', payload => this.#onHostChunk(payload)),
      EffectBus.on<{ convoId?: string; text?: string; outcome?: string }>(
        'chat:host-done', payload => this.#onHostDone(payload)),

      EffectBus.on('llm:policy-changed', () => this.#refreshDesignation()),

      EffectBus.on<{ open?: boolean }>('providers:state', payload => {
        this.#providersOpen = !!payload?.open
        this.#renderHeader()
      }),

      EffectBus.on<{ connected?: boolean }>('bridge:status', payload => {
        this.#bridgeConfigured = isLocalClaudeBridgeConfigured()
        this.#bridgeUp = !!payload?.connected
        this.#refreshDesignation()
        this.#render()
      }),

      EffectBus.on<{ configured?: boolean }>('host-ai:configuration', payload => {
        const configured = !!payload?.configured
        this.#hostConfigured = configured
        this.#render()
        if (configured && this.#visible && !this.#activeId) void this.#resume()
      }),

      // Attach/detach of context lands between synchronize pulses — the chip
      // must follow the act, not the next unrelated one.
      EffectBus.on('context:tile-changed', () => {
        if (this.#visible) { this.#refreshContext(); this.#render() }
      }),

      // THE PIPE WAS IMPURE. Angular's `t` pipe is declared `pure: false`, so
      // every change-detection tick re-resolved every string and `/language ja`
      // re-labelled an OPEN panel on the spot. An element renders when it
      // decides to, so the locale switch has to be a reason to render — else an
      // open window keeps its old-locale title, its setup checklist, its wait
      // row and the placeholder in the box you type in until it is closed and
      // reopened. Rebuilding is safe: every string lives in a catalog or a
      // service, never in the DOM. `#relabel()` re-resolves the handful written
      // ONCE per activation (the panel's aria-label, the close and peek
      // buttons, the composer's placeholder) that no render path revisits.
      EffectBus.on('locale:changed', () => {
        if (!this.#visible) return
        this.#relabel()
        this.#rows.clear()           // rows re-resolve their labels on rebuild
        this.#threadEl?.replaceChildren()
        this.#render()
      }),
    )

    // The processor's post-pulse beat — the app's canonical "something moved".
    // Cheaper and more honest than polling: the context line follows the hive.
    window.addEventListener('synchronize', this.#onSync)
    window.addEventListener('storage', this.#onStorage)

    // Is the rail on screen? A media query, not a resize handler: the browser
    // already knows, and the stylesheet is asking the same question one line
    // away. Answered once now so the first paint is right.
    if (typeof window.matchMedia === 'function') {
      this.#railQuery = window.matchMedia(RAIL_QUERY)
      this.#railVisible = this.#railQuery.matches
      this.#railQuery.addEventListener('change', this.#onRailQuery)
    }

    // ── configured bridge boot-open ──────────────────────────────────────
    // A local-bridge participant keeps the existing boot-open behavior without
    // stealing command-line focus. Everyone else opens chat deliberately.
    this.#refreshAvailability()
    this.#refreshDesignation()
    EffectBus.emit('chat:window-state', { open: this.#visible })
    if (this.#visible) {
      // #show() before the claim, so the DOM the claim describes exists.
      this.#show()
      this.#claimSurface(true)
      this.#refreshContext()
      this.#render()
      void this.#resume()
    }
    window.ioc?.whenReady?.(THREADS_IOC_KEY, () => {
      if (this.#enabled() && this.#visible && this.#turns.length === 0 && !this.#waiting) void this.#resume()
      // WHETHER OR NOT THE WINDOW IS OPEN. A question left out over a reload is
      // marked on its TILE as much as in here, and the rail's thinking mark is
      // the only sign of it for someone who has the panel folded away.
      void this.#recoverWaits()
    })
    window.ioc?.whenReady?.(HOST_AI_IOC_KEY, value => {
      this.#hostConfigured = !!(value as HostAiLike | undefined)?.configured
      this.#render()
    })
    window.ioc?.whenReady?.(LLM_ROUTER_IOC_KEY, () => this.#refreshDesignation())
  }

  override disconnectedCallback(): void {
    // A leaked enter() strands `view:active` on forever — the canvas and the
    // stickies would never come back.
    this.#claimSurface(false)
    for (const off of this.#offs) { try { off() } catch { /* noop */ } }
    this.#offs = []
    this.removeEventListener('keydown', this.#onKey)
    window.removeEventListener('synchronize', this.#onSync)
    window.removeEventListener('storage', this.#onStorage)
    this.#railQuery?.removeEventListener('change', this.#onRailQuery)
    this.#railQuery = null
    this.#stopClock()
    for (const id of this.#timers) clearTimeout(id)
    this.#timers.clear()
    if (this.#draftTimer !== null) { clearTimeout(this.#draftTimer); this.#draftTimer = null }
    // A DESTROY IS NOT A STOP. This must never abort the host's stream: the run
    // lives in host-stream.ts precisely so it can carry on without a window,
    // and only the participant pressing Stop calls it back.
    this.#rail?.dispose()
    this.#rail = null
    this.#thumbToken++
    for (const url of this.#thumbUrls.values()) URL.revokeObjectURL(url)
    this.#thumbUrls.clear()
    super.disconnectedCallback()   // → deactivate(): lane, session, grip, gear, children
    this.#visible = false
    this.#engaged = false
    this.classList.remove('open')
    this.removeAttribute('aria-label')
    this.#forgetChrome()
  }

  // ── show / hide — Angular's `@if (visible())` on the whole aside ─────
  //
  // The aside existed only while open, so the element's ENGAGEMENT follows the
  // same line: activate() renders + claims the lane + joins the session,
  // deactivate() tears it down and clears the children.

  /** `#visible` is the FLAG (seeded from the remembered choice before the
   *  subscriptions run, exactly as the Angular signal's initializer was);
   *  `#engaged` is whether the DOM for it exists. They are separate because the
   *  boot path seeds the flag true and only then builds — a single guard on
   *  `#visible` would have made that first `#show()` a no-op. */
  #engaged = false

  #show(): void {
    this.#visible = true
    if (this.#engaged) return
    this.#engaged = true
    this.classList.add('open')
    this.setAttribute('aria-label', t('chat.title', 'Chat'))
    this.activate()   // renderPanel + lane + session + grip + gear
  }

  #hide(): void {
    this.#visible = false
    if (!this.#engaged) return
    this.#engaged = false
    this.classList.remove('open')
    this.removeAttribute('aria-label')
    this.deactivate()   // clears the children — rebuild-on-open, like the `@if`
    this.#forgetChrome()
  }

  #forgetChrome(): void {
    this.#headerInset?.dispose(); this.#headerInset = null
    this.#footInset?.dispose(); this.#footInset = null
    this.#rows.clear()
    this.#branch = 'none'
    this.#railHost = null; this.#headerEl = null; this.#subjectEl = null
    this.#payloadEl = null; this.#clipBtn = null; this.#clipShelfEl = null
    this.#headerSpaceEl = null; this.#peekBtn = null; this.#providersBtn = null; this.#closeBtn = null
    this.#bodyEl = null; this.#lookEl = null; this.#lookStamp = ''
    this.#setupEl = null; this.#setupCompleteEl = null; this.#setupChecklist = []
    this.#setupHostBlock = null; this.#setupSkipEl = null; this.#setupNoteEl = null
    this.#setupHeadingEl = null; this.#setupBodyEl = null; this.#wizardEl = null
    this.#hostInputEl = null
    this.#barEl = null; this.#goalEl = null; this.#listEl = null
    this.#threadWrapEl = null; this.#threadEl = null; this.#pillEl = null
    this.#footEl = null; this.#linkEl = null; this.#linkTextEl = null
    this.#answeringEl = null
    this.#inputRowEl = null; this.#inputEl = null; this.#sendBtn = null
    this.#emptyEl = null; this.#streamEl = null; this.#streamTextEl = null
    this.#waitEl = null; this.#waitTextEl = null; this.#waitClockEl = null
    this.#waitHintEl = null
  }

  /** DockedPanelElement's close verb — the × and the lane's eviction fallback
   *  both land here. Exactly one `chat:window-state {open:false}` leaves per
   *  exit: `close()` returns early when it is already shut. */
  protected override closePanel(): void { this.close() }

  // ── the fold (peek) ──────────────────────────────────────────────────

  /** Fold the window away to the hive, or bring it back. */
  togglePeek(): void {
    const next = !this.#peeking
    this.#peeking = next
    // Folding away closes the things that only make sense over a transcript —
    // and a full-bleed picture would cover the live hive the fold exists to
    // show. Closed, not merely hidden: an invisible surface still standing is
    // one Escape would unwind before the fold, which reads as a dead key.
    if (next) { this.#clipboardOpen = false; this.#listOpen = false; this.closePicture() }
    this.classList.toggle('peeking', next)
    this.#claimSurface(!next)
    this.#applyFold()
    this.#render()
    if (!next) this.#focus()
  }

  /** EVERYTHING THAT FOLLOWS THE FOLD, in one place — so park, close, open and
   *  the toggle cannot disagree about it. Three things follow:
   *
   *  1. WHO IS GATHERING. The hexagons grow a per-tile "add to the request"
   *     icon while folded away and lose it again when the window comes back
   *     (chat-context-action.drone.ts) — an affordance for a shelf nobody can
   *     see would be an affordance for nothing.
   *  2. THE BARS RESERVE THE EDGES they are floating over, so the canvas owner
   *     squeezes the hive into the band between them.
   *  3. THE LAYER'S SAVED FRAMING IS NOT OURS TO CHANGE. Reserving the bars
   *     resizes the canvas, and the canvas owner answers a resize by recentring
   *     and refitting — which is exactly what we want to SEE and exactly what
   *     must not be WRITTEN. `suspend()` blocks automatic writes only, so a pan
   *     or zoom the participant performs while folded is still theirs. */
  #applyFold(): void {
    const folded = this.#visible && this.#peeking
    EffectBus.emit('chat:peek', { peeking: folded })
    this.#headerInset?.setActive(folded)
    this.#footInset?.setActive(folded)

    if (folded === this.#foldSuspendedViewport) return
    const viewport = get<ViewportPersistenceLike>(VIEWPORT_PERSISTENCE_IOC_KEY)
    if (!viewport?.suspend || !viewport.resume) return
    // Only ever resume what THIS window suspended — the flag is global and a
    // blanket resume would clear somebody else's.
    if (folded) viewport.suspend()
    else viewport.resume()
    this.#foldSuspendedViewport = folded
  }

  /** THE SURFACE IS OWNED, and the owner is counted (ModeRegistry). A full
   *  screen window is a view covering the canvas by any honest reading, and
   *  everything that hides itself for a view — the pixi canvas, the post-it
   *  stickies, the empty-collection prompt — was drawing straight over this
   *  window because it never said so. Peeking releases the claim, which is what
   *  makes the hive underneath live and clickable again. */
  #claimSurface(active: boolean): void {
    this.#surfaceWanted = active
    const modes = get<ModeRegistryLike>(MODE_REGISTRY_IOC_KEY)
    if (!modes) {
      // The registry is an essentials bee and this window can boot open before
      // it lands. Claim on the SETTLED intent when it arrives, never on the
      // intent that was current when this call was made.
      if (active) {
        window.ioc?.whenReady?.(MODE_REGISTRY_IOC_KEY, value => {
          if (!this.#surfaceWanted) return
          const late = value as ModeRegistryLike
          late.enter('view:active', SURFACE_OWNER)
          late.enter(KEEPS_CONTROLS, SURFACE_OWNER)
        })
      }
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

  // ── window / document listeners (added and removed by reference) ─────
  #onSync = (): void => { if (this.#visible) { this.#refreshContext(); this.#render() } }
  #onRailQuery = (event: MediaQueryListEvent): void => {
    this.#railVisible = event.matches
    this.#render()
  }
  #onStorage = (event: StorageEvent): void => {
    if (event.key !== PARTICIPANT_AI_HOST_STORAGE_KEY && event.key !== null) return
    const configured = isParticipantAiHostConfigured()
    this.#hostConfigured = configured
    this.#render()
    if (configured && this.#visible && !this.#activeId) void this.#resume()
  }

  /** The Escape cascade. The template bound a RAW `(keydown)` on the aside, so
   *  every press arrives here and only `Escape` is acted on — there was never
   *  any modifier filtering to reproduce. */
  #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    // The cascade unwinds the smallest commitment first: the tile you are
    // talking to, then the window — matching the escape-cascade's
    // outermost-first rule.
    // LOOKING AT A PICTURE is the smallest of all: nothing was composed, put
    // down or chosen, so it unwinds before even the flyout.
    if (this.#viewing) { this.closePicture(); return }
    // The flyout is the next smallest thing open.
    if (this.#clipboardOpen) { this.#clipboardOpen = false; this.#renderHeader(); return }
    // Folded away is a smaller commitment than the window itself.
    if (this.#peeking) { this.togglePeek(); return }
    // Then the RAIL'S OWN picks; a reference on the shelf is let go with its ×
    // or by dragging it back, never by a keystroke that means "go up".
    if (this.#railSeen.size) { this.#rail?.clearSelection(); return }
    if (this.#railSubject) { this.#rail?.clearSubject(); return }
    this.close()
  }

  // ── chrome, built once per activation ────────────────────────────────

  protected override renderPanel(): void {
    // THE LEFT SIDEBAR — the tiles rail, for choosing what the conversation is
    // about. Built by essentials (agent-tiles-rail.ts) and mounted through IoC;
    // absolutely positioned, so the column flow of the window is untouched.
    // Hidden by the stylesheet while folded away, never removed: the rail holds
    // the level you walked to and the picks you made.
    const rail = el('div', 'chat-rail')
    rail.setAttribute('aria-label', t('chat.rail', 'Your tiles, one conversation each'))
    this.#railHost = rail

    const railGrip = el('div', 'chat-rail-grip')
    railGrip.setAttribute('role', 'separator')
    railGrip.setAttribute('aria-orientation', 'vertical')
    railGrip.setAttribute('aria-label', t('chat.rail.resize', 'Resize the tiles rail'))
    railGrip.title = t('chat.rail.resize', 'Resize the tiles rail')
    railGrip.tabIndex = 0
    railGrip.addEventListener('pointerdown', this.#startRailDrag)
    railGrip.addEventListener('dblclick', () => this.#resetRailWidth())
    railGrip.addEventListener('keydown', this.#onRailGripKey)
    if (this.#railWidth) this.style.setProperty('--chat-rail-width', `${this.#railWidth}px`)

    const header = el('header', 'chat-header')
    header.append(sym('forum', 'mat-sym chat-glyph'))

    // WHOSE CONVERSATION IS THIS, and WHAT THE NEXT REQUEST CARRIES.
    const subject = el('span', 'chat-subject')
    this.#subjectEl = subject

    // ONE DROP AREA, always open. A long rectangle holding a single list of
    // signature-related tiles: everything the request should READ. Present
    // whether or not it holds anything, because a drop target that only appears
    // once you are already dragging is a target nobody discovers.
    const payload = el('div', 'chat-payload')
    payload.setAttribute('role', 'group')
    payload.setAttribute('aria-label', t('chat.payload', 'What this request carries'))
    payload.addEventListener('dragover', this.#onDragOver)
    payload.addEventListener('dragleave', this.#onDragLeave)
    payload.addEventListener('drop', this.#onDropReference)
    this.#payloadEl = payload

    const space = el('span', 'chat-header-space')
    this.#headerSpaceEl = space

    // FOLD AWAY TO THE HIVE. Not a second shape to choose between.
    const peek = button('chat-peek', 'peek')
    peek.setAttribute('aria-pressed', 'false')
    peek.append(sym('unfold_less'))
    peek.addEventListener('click', () => this.togglePeek())
    this.#peekBtn = peek

    const providers = button('chat-providers', 'providers')
    providers.append(sym('hub'))
    providers.addEventListener('click', () => this.openProviders())
    this.#providersBtn = providers

    const close = button('chat-close', 'close')
    close.textContent = '×'
    close.addEventListener('click', () => this.close())
    this.#closeBtn = close

    // The close button must be the header's LAST child when activate() runs:
    // DockedPanelElement reads `header.lastElementChild` to size the gear's
    // inset and nudges that node over to make room for it.
    header.append(subject, payload, space, peek, providers, close)
    this.#headerEl = header

    // `display: contents` — the setup section, the bar, the list, the thread
    // wrap and the footer stay flex items of the PANEL (the thread wrap's
    // `flex: 1 1 auto` is what makes it the scrolling half), while one node
    // still holds everything the branch swap replaces. Without it, a rebuild
    // that reached for the panel's own children would take the base's resize
    // grip and settings gear with it.
    const body = el('div', 'chat-body')
    const reading = el('div', 'chat-reading')
    const providersHost = el('div', 'chat-providers-host')
    body.append(reading, providersHost)
    this.#bodyEl = reading

    this.append(rail, railGrip, header, body)

    // WHILE FOLDED, THE BARS ARE A FRAME AND THE HIVE IS WHAT IS BETWEEN THEM.
    // `hcDockInset="top"` on the header; the footer's `"bottom"` twin is
    // attached in `#buildChat()`, because the footer exists only in the chat
    // branch — exactly as the Angular directive existed only inside the
    // `@else`.
    this.#headerInset = attachInset(header, 'top')

    this.#headerInset.setActive(this.#visible && this.#peeking)

    this.#mountRail()
    this.#render()
  }

  /** Re-resolve the strings written ONCE per activation — the ones no render
   *  path revisits. Everything else comes back through its own render. */
  #relabel(): void {
    this.setAttribute('aria-label', t('chat.title', 'Chat'))
    this.#railHost?.setAttribute('aria-label', t('chat.rail', 'Your tiles, one conversation each'))
    this.#payloadEl?.setAttribute('aria-label', t('chat.payload', 'What this request carries'))
    this.#closeBtn?.setAttribute('aria-label', t('chat.close', 'Close the chat'))
    // The fold control. Lit while folded, because that is a state you can
    // otherwise only infer from the absence of the transcript — and the label
    // AND the glyph both flip, which is the whole of the `@if`-free binding.
    const peekLabel = this.#peeking
      ? t('chat.peek.off', 'Back to the conversation')
      : t('chat.peek.on', 'Fold away to the hive')
    const peek = this.#peekBtn
    if (peek) {
      peek.title = peekLabel
      peek.setAttribute('aria-label', peekLabel)
      peek.setAttribute('aria-pressed', String(this.#peeking))
      peek.classList.toggle('on', this.#peeking)
      const glyph = peek.querySelector('.mat-sym')
      if (glyph) glyph.textContent = this.#peeking ? 'unfold_more' : 'unfold_less'
    }
    const providerLabel = this.#providersOpen
      ? t('chat.providers.hide', 'Hide providers')
      : t('chat.providers.show', 'Show providers')
    if (this.#providersBtn) {
      this.#providersBtn.title = providerLabel
      this.#providersBtn.setAttribute('aria-label', providerLabel)
      this.#providersBtn.setAttribute('aria-pressed', String(this.#providersOpen))
      this.#providersBtn.classList.toggle('on', this.#providersOpen)
    }
    if (this.#inputEl) {
      const placeholder = t('chat.placeholder', 'Ask anything…')
      this.#inputEl.placeholder = placeholder
      this.#inputEl.setAttribute('aria-label', placeholder)
    }
  }

  #railBounds(): { min: number; max: number } {
    const room = this.getBoundingClientRect().width - CONVERSATION_MIN
    return { min: RAIL_MIN, max: Math.max(RAIL_MIN, Math.min(RAIL_MAX, room || RAIL_MAX)) }
  }

  #setRailWidth(next: number): void {
    const { min, max } = this.#railBounds()
    this.#railWidth = Math.round(Math.min(max, Math.max(min, next)))
    this.style.setProperty('--chat-rail-width', `${this.#railWidth}px`)
    try { localStorage.setItem(RAIL_WIDTH_KEY, String(this.#railWidth)) } catch { /* private mode */ }
  }

  readonly #startRailDrag = (event: PointerEvent): void => {
    const grip = event.currentTarget as HTMLElement | null
    const rail = this.#railHost
    if (!grip || !rail) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = rail.getBoundingClientRect().width
    grip.classList.add('dragging')
    try { grip.setPointerCapture(event.pointerId) } catch { /* window listeners still work */ }
    const move = (moved: PointerEvent): void => this.#setRailWidth(startWidth + moved.clientX - startX)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      grip.classList.remove('dragging')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  #resetRailWidth(): void {
    this.#railWidth = 0
    this.style.removeProperty('--chat-rail-width')
    try { localStorage.removeItem(RAIL_WIDTH_KEY) } catch { /* private mode */ }
  }

  readonly #onRailGripKey = (event: KeyboardEvent): void => {
    const step = event.shiftKey ? 40 : 12
    const current = this.#railWidth || this.#railHost?.getBoundingClientRect().width || RAIL_MIN
    if (event.key === 'ArrowLeft') { event.preventDefault(); this.#setRailWidth(current - step) }
    else if (event.key === 'ArrowRight') { event.preventDefault(); this.#setRailWidth(current + step) }
    else if (event.key === 'Home') { event.preventDefault(); this.#resetRailWidth() }
  }

  /** The rail. Created ONCE per window lifetime and re-mounted whenever the
   *  host div is rebuilt, so the trail you drilled and the tiles you chose
   *  survive a park. Essentials may register the factory AFTER this window is
   *  up (web loads its bees from OPFS), so a miss WAITS on the key instead of
   *  leaving the sidebar empty until the next refocus. */
  #mountRail(): void {
    const host = this.#railHost
    if (!host) return
    if (this.#rail) { this.#rail.mount(host); return }

    const bring = (factory: TilesRailFactoryLike | undefined): void => {
      if (this.#rail || !factory?.create) return
      const rail = factory.create()
      this.#rail = rail
      rail.onSubjectChanged = subject => { void this.#enterSubject(subject) }
      // Rail picks flow INTO the clipboard as deltas — never a wholesale
      // replace, because the clipboard also holds what the hive's takes and the
      // header's drops gathered, and a ctrl-click in the sidebar must not blow
      // those away.
      rail.onSelectionChanged = selection => {
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
      // factory lands — mount into whatever the panel is showing NOW.
      const live = this.#railHost
      if (live) rail.mount(live)
    }

    const now = get<TilesRailFactoryLike>(RAIL_FACTORY_IOC_KEY)
    if (now) bring(now)
    else window.ioc?.whenReady?.(RAIL_FACTORY_IOC_KEY, value => bring(value as TilesRailFactoryLike))
  }

  // ── rendering ────────────────────────────────────────────────────────
  //
  // Rebuild-on-change everywhere EXCEPT the three places where rebuilding
  // would cost something the participant owns: the composer's caret (built
  // once, never replaced), the transcript's rows (keyed, walked into place)
  // and the streaming answer (mutated in place, chunk by chunk).

  #render(): void {
    if (!this.#visible || !this.#bodyEl) return
    this.#renderHeader()
    this.#renderBody()
    this.#renderLook()
  }

  #renderHeader(): void {
    const subject = this.#subjectEl
    if (!subject) return
    subject.title = this.#subjectPath() || t('chat.subject.none', 'Not about a tile — open your conversations', { tile: '' })
    const name = this.#subjectName()
    subject.replaceChildren(name
      ? el('span', 'chat-subject-tile', name)
      // About no single tile is about the HIVE — the same thing the rail's top
      // row says, so the two agree on what you are in.
      : el('span', 'chat-subject-hive', t('agent.rail-hive', 'Hypercomb')))
    this.#renderPayload()
    this.#renderClipShelf()
    this.#relabel()
  }

  #renderPayload(): void {
    const payload = this.#payloadEl
    if (!payload) return
    // The payload holds the clipboard button and one × per reference; a rebuild
    // that landed while one of them held focus would drop the ring to <body>.
    // Snapshot by a key WE stamp (data-hc-row), never by a class.
    const snap = focusSnapshot(payload)
    payload.classList.toggle('over', this.#dragOverReference)

    const count = this.#clipboardHeld.length
    const clipLabel = t('chat.clipboard.show', 'Show the clipboard ({count})', { count })
    const clip = button('chat-clip', 'clipboard')
    clip.classList.toggle('on', this.#clipboardOpen)
    clip.classList.toggle('holding', count > 0)
    clip.title = clipLabel
    clip.setAttribute('aria-expanded', String(this.#clipboardOpen))
    clip.setAttribute('aria-label', clipLabel)
    clip.addEventListener('click', () => this.toggleClipboardShelf())
    clip.append(sym('content_paste'))
    if (count) clip.append(el('span', 'chat-clip-count', String(count)))
    this.#clipBtn = clip

    const parts: HTMLElement[] = [clip]

    // THE REFERENCES — supporting layers and meta contexts, there to be READ,
    // never changed. Each reads as a small sentence: the tile's picture shrunk
    // to a MARK, its name, then the branch it hangs off.
    this.#references.forEach((pick, index) => {
      const box = el('span', 'chat-box chat-box-context filled')
      box.draggable = true
      box.title = t('chat.context.one', '{tile} — supporting context, click to remove', { tile: pick.name })
      box.addEventListener('dragstart', event => this.#onReferenceDragStart(event, index))
      box.addEventListener('dragend', () => this.#onReferenceDragEnd())

      const url = this.#contextThumbs[pick.key]
      if (url) {
        // THE PICTURE IS THE WAY TO SEE THE PICTURE. A mark this small answers
        // WHICH and never WHAT, so pressing it opens the thing full size where
        // it already is.
        const lookLabel = t('chat.reference.look', 'Look at {tile}', { tile: pick.name })
        const look = button('chat-box-look', `look:${pick.key}`)
        look.title = lookLabel
        look.setAttribute('aria-label', lookLabel)
        look.addEventListener('click', event => this.openPicture(pick, event))
        const img = el('img', 'chat-box-img')
        img.src = url
        img.alt = ''
        look.append(img)
        box.append(look)
      } else {
        box.append(sym('hexagon', 'mat-sym chat-box-glyph'))
      }

      box.append(el('span', 'chat-box-name', pick.name))
      if (this.isPicture(pick)) {
        // A picture has no branch to come from; what it has is a weight.
        box.append(el('span', 'chat-box-branch',
          t('chat.reference.picture', 'picture · {size}', { size: this.sizeOf(pick) })))
      } else {
        const branch = this.branchOf(pick)
        if (branch) {
          const node = el('span', 'chat-box-branch', branch)
          node.title = this.pathOf(pick)
          box.append(node)
        }
      }

      const offLabel = t('chat.reference.off', 'Take {tile} off this request', { tile: pick.name })
      const off = button('chat-box-off', `off:${pick.key}`)
      off.textContent = '×'
      off.title = offLabel
      off.setAttribute('aria-label', offLabel)
      off.addEventListener('click', () => this.removeContext(index))
      box.append(off)
      parts.push(box)
    })

    if (!this.#references.length) {
      parts.push(el('span', 'chat-payload-hint',
        t('chat.reference.empty', 'Drop tiles or a picture here — or copy any tile in the hive')))
    }

    payload.replaceChildren(...parts)
    restoreFocus(payload, snap)
  }

  /** THE CLIPBOARD, WHERE THE COMPOSER IS. Not a second clipboard: the same
   *  entries the panel lists, shown here so a reference is one click away.
   *  `@if (clipboardOpen())` — so it genuinely leaves the DOM. */
  #renderClipShelf(): void {
    const header = this.#headerEl
    if (!header) return
    if (!this.#clipboardOpen) {
      this.#clipShelfEl?.remove()
      this.#clipShelfEl = null
      return
    }
    const shelf = this.#clipShelfEl ?? el('div', 'chat-clip-shelf')
    const snap = focusSnapshot(shelf)
    shelf.setAttribute('role', 'listbox')
    shelf.setAttribute('aria-label', t('chat.clipboard.title', 'Clipboard'))

    const rows: HTMLElement[] = []
    for (const pick of this.#clipboardHeld) {
      const item = button('chat-clip-item', `clip:${pick.key}`)
      item.setAttribute('role', 'option')
      item.setAttribute('aria-selected', 'false')
      item.title = t('chat.clipboard.paste', 'Paste {tile} as a reference', { tile: pick.name })
      item.addEventListener('click', () => this.pasteReference(pick))
      const url = this.#contextThumbs[pick.key]
      if (url) {
        const img = el('img', 'chat-clip-img')
        img.src = url
        img.alt = ''
        item.append(img)
      } else {
        item.append(sym('hexagon', 'mat-sym chat-clip-glyph'))
      }
      const text = el('span', 'chat-clip-text')
      text.append(el('span', 'chat-clip-name', pick.name))
      const branch = this.branchOf(pick)
      if (branch) {
        const node = el('span', 'chat-clip-branch', branch)
        node.title = this.pathOf(pick)
        text.append(node)
      }
      item.append(text)
      rows.push(item)
    }
    if (!rows.length) {
      rows.push(el('span', 'chat-clip-empty',
        t('chat.clipboard.empty', 'Nothing on the clipboard — copy a tile in the hive')))
    }
    shelf.replaceChildren(...rows)
    if (shelf.parentNode !== header) {
      // Placed where the template put it — before the spacer, so the gear the
      // base pinned after the close button stays the header's last child.
      header.insertBefore(shelf, this.#headerSpaceEl)
    }
    this.#clipShelfEl = shelf
    restoreFocus(shelf, snap)
  }

  /** Angular's `@if (showSetup()) { … } @else { … }`. The branch is rebuilt
   *  only when it actually CHANGES — otherwise the composer, which lives in the
   *  chat branch's footer, would be destroyed by any unrelated render. */
  #renderBody(): void {
    const body = this.#bodyEl
    if (!body) return
    const want: 'setup' | 'chat' = this.#showSetup() ? 'setup' : 'chat'
    if (want !== this.#branch) {
      this.#footInset?.dispose(); this.#footInset = null
      this.#footEl?.remove()
      body.replaceChildren()
      this.#rows.clear()
      this.#emptyEl = null; this.#streamEl = null; this.#streamTextEl = null
      this.#waitEl = null; this.#waitTextEl = null; this.#waitClockEl = null
      this.#waitHintEl = null; this.#inputEl = null
      this.#sendBtn = null; this.#barEl = null; this.#goalEl = null; this.#listEl = null
      this.#threadWrapEl = null; this.#threadEl = null; this.#pillEl = null
      this.#footEl = null; this.#linkEl = null; this.#linkTextEl = null
      this.#answeringEl = null; this.#inputRowEl = null
      this.#setupEl = null; this.#setupCompleteEl = null; this.#setupChecklist = []
      this.#setupHostBlock = null; this.#setupSkipEl = null; this.#setupNoteEl = null
      this.#setupHeadingEl = null; this.#setupBodyEl = null; this.#wizardEl = null
      this.#hostInputEl = null
      this.#branch = want
      if (want === 'setup') this.#buildSetup()
      else this.#buildChat()
    }
    if (this.#branch === 'setup') { this.#renderSetup(); return }
    this.#renderBar()
    this.#renderGoal()
    this.#renderList()
    this.#renderThread()
    this.#renderFoot()
  }

  // ── GUIDED SETUP — one step at a time ────────────────────────────────
  //
  // Each step verifies itself where reality can be asked: enabling flips the
  // config gate, the broker step completes on the worker's own `bridge:status`,
  // and the last step completes only when a real answer lands. Only the tools
  // step takes the participant's word.
  //
  // The scaffolding is built ONCE (including the host box, which holds a caret)
  // and only the `<ol>` is rebuilt as the checklist moves — with focus and
  // selection snapshotted across it.

  #buildSetup(): void {
    const section = el('section', 'chat-setup')
    section.setAttribute('role', 'status')
    section.setAttribute('aria-live', 'polite')

    // step 5 — the finish line, its own subtree
    const complete = el('div', 'chat-complete')
    complete.append(sym('task_alt', 'mat-sym chat-complete-glyph'))
    complete.append(el('h2'), el('p'))
    const start = button('chat-btn', 'setup-start')
    start.addEventListener('click', () => this.finishSetup())
    complete.append(start)
    this.#setupCompleteEl = complete

    // steps 1–4 — the checklist. Held as a LIST of siblings rather than in a
    // wrapper: `.chat-setup > p` styles the intro paragraph, and a wrapper div
    // (even `display: contents`) breaks a child combinator.
    const glyph = sym('rocket_launch', 'mat-sym chat-setup-glyph')
    const heading = el('h2')
    const intro = el('p')
    const wizard = el('ol', 'chat-wizard')

    // The other door: a host you control, no install at all.
    const hostBlock = el('div', 'chat-host')
    const hostLead = el('p')
    const hostRow = el('div', 'chat-host-row')
    const hostInput = el('input')
    hostInput.type = 'text'
    hostInput.dataset['hcRow'] = 'setup-host'
    // The node itself is kept across every setup re-render, so what is typed
    // in it — and the caret — survive a `bridge:status` landing mid-word.
    hostInput.addEventListener('keydown', event => {
      // `(keydown.enter)` plus `(keydown)="$event.stopPropagation()"` — the
      // hive binds bare letters as shortcuts, so every key is stopped here.
      event.stopPropagation()
      if (event.key === 'Enter') this.connectHost(hostInput.value)
    })
    const hostGo = button('', 'setup-host-go')
    hostGo.addEventListener('click', () => this.connectHost(hostInput.value))
    hostRow.append(hostInput, hostGo)
    hostBlock.append(hostLead, hostRow)
    this.#hostInputEl = hostInput

    const skip = button('chat-skip', 'setup-skip')
    skip.addEventListener('click', () => this.finishSetup())
    const note = el('p', 'chat-setup-note')

    hostGo.dataset['hcRow'] = 'setup-host-go'
    skip.dataset['hcRow'] = 'setup-skip'

    this.#setupChecklist = [glyph, heading, intro, wizard, hostBlock, skip, note]
    this.#setupHostBlock = hostBlock
    this.#setupSkipEl = skip
    this.#setupNoteEl = note
    this.#setupHeadingEl = heading
    this.#setupBodyEl = intro
    this.#wizardEl = wizard

    this.#setupEl = section
    this.#bodyEl?.append(section)
  }

  #renderSetup(): void {
    const section = this.#setupEl
    if (!section) return
    const complete = this.#setupCompleteEl
    // `@if (setupStep() === 5) { … } @else { … }` — genuinely one or the other,
    // so the branch that is not showing genuinely leaves the DOM.
    if (this.#setupStep() === 5) {
      for (const node of this.#setupChecklist) node.remove()
      if (complete && complete.parentNode !== section) section.append(complete)
      if (complete) {
        complete.querySelector('h2')!.textContent = t('chat.setup.complete.title', 'Your AI is connected')
        complete.querySelector('p')!.textContent =
          t('chat.setup.complete.body', 'The checklist is complete — the answer to your first question is waiting.')
        complete.querySelector('button')!.textContent = t('chat.setup.complete.start', 'Start chatting')
      }
      return
    }
    complete?.remove()
    for (const node of this.#setupChecklist) {
      if (node.parentNode !== section) section.append(node)
    }

    if (this.#setupHeadingEl) this.#setupHeadingEl.textContent = t('chat.setup.title', 'Set up your AI')
    if (this.#setupBodyEl) {
      this.#setupBodyEl.textContent = t('chat.setup.body',
        'Four steps, checked off as they happen. Your own Claude Code answers — nothing is shared.')
    }
    const hostTitle = t('chat.setup.host.title', 'Or connect an AI host instead')
    const hostBlock = this.#setupHostBlock
    if (hostBlock) hostBlock.querySelector('p')!.textContent = hostTitle
    if (this.#hostInputEl) {
      this.#hostInputEl.placeholder = t('chat.setup.host.placeholder', 'ai.yourdomain.com')
      this.#hostInputEl.setAttribute('aria-label', hostTitle)
    }
    if (hostBlock) {
      hostBlock.querySelector('.chat-host-row button')!.textContent =
        t('chat.setup.host.connect', 'Connect')
    }
    if (this.#setupSkipEl) this.#setupSkipEl.textContent = t('chat.setup.skip', "Skip — I know what I'm doing")
    if (this.#setupNoteEl) {
      this.#setupNoteEl.textContent = t('chat.setup.note',
        'You can close this window and use the rest of your hive normally.')
    }
    this.#renderWizard()
  }

  #renderWizard(): void {
    const wizard = this.#wizardEl
    if (!wizard) return
    const snap = focusSnapshot(wizard)
    const step = this.#setupStep()

    // 1 · the tools (one-time; the only step that takes your word)
    const tools = this.#step(1, this.#toolsDone, step === 1, t('chat.setup.step.tools.title', 'Get the tools'))
    if (step === 1) {
      const body = el('div', 'chat-step-body')
      body.append(el('p', undefined, t('chat.setup.step.tools.body',
        'One time only: install Claude Code, then clone and build the hive repo.')))
      body.append(this.#cmd('install', COMMANDS.install))
      body.append(this.#cmd('clone', COMMANDS.clone))
      body.append(this.#cmd('build', COMMANDS.build))
      const go = button('chat-btn', 'setup-tools')
      go.textContent = t('chat.setup.step.tools.done', 'I have them')
      go.addEventListener('click', () => this.markTools())
      body.append(go)
      tools.append(body)
    }

    // 2 · opt this tab in (verifies via the config gate)
    const enable = this.#step(2, this.#bridgeConfigured, step === 2, t('chat.setup.step.enable.title', 'Turn this tab on'))
    if (step === 2) {
      const body = el('div', 'chat-step-body')
      body.append(el('p', undefined, t('chat.setup.step.enable.body',
        'Let this tab talk to the bridge on your machine. Nothing leaves it.')))
      if (this.#loopback) {
        const go = button('chat-btn', 'setup-enable')
        go.textContent = t('chat.setup.step.enable.action', 'Enable this tab')
        go.addEventListener('click', () => this.enableBridge())
        body.append(go)
      } else {
        body.append(el('p', 'chat-step-hint', t('chat.setup.step.enable.loopback',
          'The local bridge only works when your hive is open at localhost.')))
      }
      enable.append(body)
    }

    // 3 · the broker (checks itself off on bridge:status)
    const broker = this.#step(3, this.#bridgeUp, step === 3, t('chat.setup.step.broker.title', 'Start the broker'))
    if (step === 3) {
      const body = el('div', 'chat-step-body')
      body.append(el('p', undefined, t('chat.setup.step.broker.body',
        "Run this in the repo's src folder, then connect this tab.")))
      body.append(this.#cmd('broker', COMMANDS.broker))
      const connect = button('chat-btn', 'setup-connect')
      connect.textContent = t('chat.setup.step.broker.connect', 'Connect to broker')
      connect.addEventListener('click', () => EffectBus.emit('claude-bridge:connect', {}))
      body.append(connect)
      body.append(el('p', 'chat-step-hint chat-step-live',
        t('chat.setup.step.broker.watching', 'The tab connects only when you ask it to.')))
      broker.append(body)
    }

    // 4 · park a session and prove the loop
    const listen = this.#step(4, this.#firstReply, step === 4,
      t('chat.setup.step.listen.title', 'Park Claude Code and prove it'))
    if (step === 4) {
      const body = el('div', 'chat-step-body')
      body.append(el('p', undefined, t('chat.setup.step.listen.body',
        'In a Claude Code session at the repo root, say:')))
      body.append(this.#cmd('claude', COMMANDS.claude))
      body.append(this.#cmd('listen', COMMANDS.listen))
      if (this.#tried) {
        body.append(el('p', 'chat-step-hint chat-step-live', t('chat.setup.step.listen.waitingReply',
          'Asked — this step completes when the answer lands.')))
      } else {
        const go = button('chat-btn', 'setup-try')
        go.textContent = t('chat.setup.step.listen.try', 'Ask your first question')
        go.addEventListener('click', () => this.tryAsk())
        body.append(go)
      }
      listen.append(body)
    }

    wizard.replaceChildren(tools, enable, broker, listen)
    restoreFocus(wizard, snap)
  }

  /** One checklist row's head. Done rows collapse to a check, the current row
   *  opens, later rows wait dimmed. */
  #step(n: number, done: boolean, current: boolean, title: string): HTMLElement {
    const row = el('li', 'chat-step')
    row.classList.toggle('done', done)
    row.classList.toggle('current', current)
    const head = el('div', 'chat-step-head')
    head.append(done ? sym('check_circle', 'mat-sym chat-step-check') : sym(String(n), 'chat-step-n'))
    head.append(el('span', undefined, title))
    row.append(head)
    return row
  }

  /** A command the checklist hands out: mono, one line, its own Copy. */
  #cmd(id: string, text: string): HTMLElement {
    const row = el('div', 'chat-cmd')
    row.append(el('code', undefined, text))
    const copy = button('', `cmd:${id}`)
    copy.textContent = this.#copied === id
      ? t('chat.setup.copied', 'Copied')
      : t('chat.setup.copy', 'Copy')
    copy.addEventListener('click', () => this.copyCmd(id, text))
    row.append(copy)
    return row
  }

  // ── THE CHAT BRANCH ──────────────────────────────────────────────────
  //
  // Built once: the conversation bar, the (detached) goal panel and roster,
  // the thread wrap with its scroller and pill, and the footer — INCLUDING the
  // composer, which from here on is never replaced by anything.

  #buildChat(): void {
    const body = this.#bodyEl
    if (!body) return

    // Which conversation you are in — the NAME, not a list.
    const bar = el('div', 'chat-bar')
    this.#barEl = bar

    // `@if (goalOpen() && activeGoal())` — detached until both are true.
    this.#goalEl = null

    // `@if (!railVisible() && listOpen())` — likewise.
    this.#listEl = null

    // The scroller and the pill that rides over its bottom edge — the wrap
    // exists to give the pill something to be positioned against that is not
    // the whole panel (whose footer height moves with the panel scale).
    const wrap = el('div', 'chat-threadwrap')
    const thread = el('div', 'chat-thread')
    thread.addEventListener('scroll', this.#onScroll)
    // ONE delegated click for the whole transcript: rendered markdown is not a
    // template, so its hive-path chips, code-copy buttons and links carry data
    // attributes and are routed here.
    thread.addEventListener('click', this.#onThreadClick)
    wrap.append(thread)
    this.#threadWrapEl = wrap
    this.#threadEl = thread

    const pill = button('chat-pill', 'pill')
    pill.append(sym('arrow_downward'), el('span'))
    pill.addEventListener('click', () => this.scrollToBottom())
    this.#pillEl = pill

    const foot = el('footer', 'chat-foot')

    // What can answer, on one line: live state, actual model, and provider.
    const link = el('div', 'chat-link')
    const dot = el('span', 'chat-dot')
    dot.setAttribute('aria-hidden', 'true')
    const answering = button('chat-answering', 'answering')
    answering.addEventListener('click', () => this.openProviders())
    const linkText = el('span')
    link.append(dot, answering, linkText)
    this.#linkEl = link
    this.#linkTextEl = linkText
    this.#answeringEl = answering

    const inputRow = el('div', 'chat-inputrow')
    // THE COMPOSER. Created here and NOWHERE else: from this line until the
    // panel deactivates, no render path replaces it or any ancestor of it, so a
    // chunk landing mid-sentence cannot cost the caret.
    const input = el('textarea', 'chat-input')
    input.rows = 1
    input.addEventListener('keydown', this.#onInputKey)
    input.addEventListener('paste', this.#onComposerPaste)
    input.addEventListener('input', this.#onInput)
    inputRow.append(input)
    this.#inputRowEl = inputRow
    this.#inputEl = input

    foot.append(link, inputRow)
    this.#footEl = foot

    body.append(bar, wrap)
    body.parentElement?.insertAdjacentElement('afterend', foot)

    // The footer's `hcDockInset="bottom"`, live only while folded away.
    this.#footInset = attachInset(foot, 'bottom')
    this.#footInset.setActive(this.#visible && this.#peeking)
  }

  #renderBar(): void {
    const bar = this.#barEl
    if (!bar) return
    const snap = focusSnapshot(bar)
    const parts: HTMLElement[] = []

    const title = this.#activeTitle() || t('chat.untitled', 'New chat')
    if (this.#railVisible) {
      // With the rail carrying the list, the name is only a NAME.
      const still = el('span', 'chat-current chat-current-still')
      still.append(el('span', 'chat-current-name', title))
      parts.push(still)
    } else {
      const open = button('chat-current', 'current')
      open.setAttribute('aria-expanded', String(this.#listOpen))
      open.title = t('chat.list.toggle', 'Switch conversation')
      open.append(sym(this.#listOpen ? 'expand_more' : 'chevron_right'))
      open.append(el('span', 'chat-current-name', title))
      open.addEventListener('click', () => this.toggleList())
      parts.push(open)
    }

    // ARCHIVE THE CHAT YOU ARE IN.
    if (this.#canArchive() && this.#activeId) {
      if (this.#activeGoal()) {
        const goalLabel = t('chat.goal.open', 'Goals attained — view goals')
        const goal = button('chat-goal', 'goal')
        goal.classList.toggle('on', this.#goalOpen)
        goal.setAttribute('aria-expanded', String(this.#goalOpen))
        goal.title = goalLabel
        goal.setAttribute('aria-label', goalLabel)
        goal.append(sym('verified'))
        goal.addEventListener('click', () => this.toggleGoal())
        parts.push(goal)
      }
      const filed = this.#activeArchived()
      const putLabel = filed
        ? t('chat.archive.restore', 'Bring this conversation back')
        : t('chat.archive.put', 'Archive this conversation')
      const put = button('chat-put', 'put')
      put.title = putLabel
      put.setAttribute('aria-label', putLabel)
      put.append(sym(filed ? 'unarchive' : 'archive'))
      put.addEventListener('click', () => { void this.archiveCurrent() })
      parts.push(put)
      const split = el('span', 'chat-bar-split')
      split.setAttribute('aria-hidden', 'true')
      parts.push(split)
    }

    const newLabel = t('chat.new', 'New chat')
    const fresh = button('chat-new', 'new')
    fresh.title = newLabel
    fresh.setAttribute('aria-label', newLabel)
    fresh.append(sym('add'))
    fresh.addEventListener('click', () => this.newChat())
    parts.push(fresh)

    bar.replaceChildren(...parts)
    restoreFocus(bar, snap)
  }

  /** `@if (goalOpen() && activeGoal())` — built and detached, never hidden. */
  #renderGoal(): void {
    const body = this.#bodyEl
    const goal = this.#goalOpen ? this.#activeGoal() : undefined
    if (!body || !goal) { this.#goalEl?.remove(); this.#goalEl = null; return }

    const section = el('section', 'chat-goal-details')
    section.setAttribute('role', 'dialog')
    section.setAttribute('aria-label', t('chat.goal.title', 'Goals attained'))
    const head = el('div', 'chat-goal-head')
    head.append(sym('task_alt'))
    const strong = document.createElement('strong')
    strong.textContent = t('chat.goal.title', 'Goals attained')
    head.append(strong)
    const close = button('', 'goal-close')
    close.textContent = '×'
    close.setAttribute('aria-label', t('chat.goal.close', 'Close attained goals'))
    close.addEventListener('click', () => this.toggleGoal())
    head.append(close)
    section.append(head, el('p', undefined, goal.details))
    const file = button('chat-goal-archive', 'goal-archive')
    file.append(sym('archive'), document.createTextNode(t('chat.goal.archive', 'Archive completed chat')))
    file.addEventListener('click', () => { void this.archiveCurrent() })
    section.append(file)

    this.#goalEl?.remove()
    // Straight after the bar, where the template put it.
    body.insertBefore(section, this.#barEl?.nextSibling ?? null)
    this.#goalEl = section
  }

  /** The flat roster — only when there is NO rail to carry it (a narrow shell
   *  hides the sidebar below 700px, the twin of the rule in the stylesheet). */
  #renderList(): void {
    const body = this.#bodyEl
    if (!body) return
    if (this.#railVisible || !this.#listOpen) {
      this.#listEl?.remove()
      this.#listEl = null
      return
    }
    const list = el('ul', 'chat-list')
    const snap = this.#listEl ? focusSnapshot(this.#listEl) : null

    const roster = this.#roster()
    if (roster.length === 0) {
      list.append(el('li', 'chat-list-empty', t('chat.list.empty', 'No conversations yet.')))
    }
    // WHAT IS LIVE. Archived conversations are whole and readable, they are
    // simply not rows you have to read past to find the one you want.
    for (const row of this.#liveRoster()) list.append(this.#listRow(row))

    // Absent entirely when nothing is archived: a disclosure for an empty set
    // is furniture.
    const filed = this.#filedRoster()
    if (filed.length) {
      const holder = el('li', 'chat-list-archived')
      const toggle = button('', 'archive-section')
      toggle.classList.toggle('on', this.#archiveOpen)
      toggle.setAttribute('aria-expanded', String(this.#archiveOpen))
      toggle.append(sym(this.#archiveOpen ? 'expand_more' : 'chevron_right'))
      toggle.append(document.createTextNode(
        t('chat.archive.section', 'Archived ({count})', { count: filed.length })))
      toggle.addEventListener('click', () => this.toggleArchive())
      holder.append(toggle)
      list.append(holder)
      if (this.#archiveOpen) for (const row of filed) list.append(this.#listRow(row))
    }

    if (this.#listEl) this.#listEl.replaceWith(list)
    else body.insertBefore(list, this.#threadWrapEl)
    this.#listEl = list
    restoreFocus(list, snap)
  }

  /** ONE ROW SHAPE for both shelves — a live conversation and an archived one
   *  are the same thing in different places, so drawing them from two copies of
   *  the markup is how they drift apart. */
  #listRow(row: RosterRow): HTMLElement {
    const item = el('li', 'chat-list-row')
    item.classList.toggle('on', row.convoId === this.#activeId)
    item.classList.toggle('filed', row.archived)

    const openIt = button('chat-list-body', `row:${row.convoId}`)
    openIt.addEventListener('click', () => { void this.pick(row.convoId) })
    // A tile chat is named by its TILE, not by its first sentence: that is what
    // you would look for when coming back to it.
    if (row.tile) {
      const tile = el('span', 'chat-list-tile', row.tile)
      tile.title = row.tile
      openIt.append(tile)
    }
    openIt.append(el('span', 'chat-list-name', row.title || t('chat.untitled', 'New chat')))
    const meta = el('span', 'chat-list-meta')
    if (row.draft) meta.append(el('span', 'chat-list-draft', t('chat.list.draft', 'draft')))
    if (row.turnCount) {
      meta.append(document.createTextNode(
        tCount('chat.turns', '{count} message', '{count} messages', row.turnCount)))
    }
    openIt.append(meta)
    item.append(openIt)

    // PUT IT AWAY, or bring it back — the same control both ways.
    if (this.#canArchive()) {
      const label = row.archived
        ? t('chat.archive.restore', 'Bring this conversation back')
        : t('chat.archive.put', 'Archive this conversation')
      const put = button('chat-list-put', `put:${row.convoId}`)
      put.title = label
      put.setAttribute('aria-label', label)
      put.append(sym(row.archived ? 'unarchive' : 'archive'))
      put.addEventListener('click', event => { void this.archive(row.convoId, !row.archived, event) })
      item.append(put)
    }

    // Arms on the first press, deletes on the second.
    const armed = this.#armed === row.convoId
    const delLabel = armed
      ? t('chat.delete.confirm', 'Press again to delete this conversation')
      : t('chat.delete', 'Delete this conversation')
    const del = button('chat-list-del', `del:${row.convoId}`)
    del.classList.toggle('armed', armed)
    del.title = delLabel
    del.setAttribute('aria-label', delLabel)
    del.append(sym(armed ? 'delete_forever' : 'close'))
    del.addEventListener('click', event => { void this.removeConversation(row.convoId, event) })
    item.append(del)
    return item
  }

  // ── THE TRANSCRIPT ───────────────────────────────────────────────────
  //
  // The one keyed surface in the panel, and the plan doc's one sanctioned
  // exception to rebuild-on-change. Three things would be lost by rebuilding
  // `.chat-thread` on every arrival:
  //
  //   • scrollTop — a fresh node starts at 0, so a turn landing while you read
  //     something further up would yank the view to the top;
  //   • focus — a keyboard user inside a message's action row would be dropped
  //     out to <body>;
  //   • the wait row's pulse animation, which would restart every second.
  //
  // So rows are kept in `#rows` by `${at}:${index}` (the template's own track
  // key) and placed with an ANCHOR WALK that SKIPS anything already where it
  // belongs — `insertBefore` moves a node, and a node not moved is not
  // touched. Departed rows are swept BEFORE the walk, never during it.

  #renderThread(): void {
    const thread = this.#threadEl
    if (!thread) return

    // The ordered contents, top to bottom: the empty line, every turn, then
    // EITHER the streaming answer or the wait row (never both — the template's
    // `@if (streaming()) … @else if (waiting())`).
    const order: HTMLElement[] = []

    if (this.#empty()) {
      const line = this.#emptyEl ?? el('p', 'chat-empty')
      this.#emptyEl = line
      line.textContent = t('chat.empty',
        'Ask your configured AI about your hive. It can see where you are standing and what you have selected.')
      order.push(line)
    } else {
      this.#emptyEl?.remove()
    }

    const alive = new Set<string>()
    for (const [index, turn] of this.#turns.entries()) {
      const key = `${turn.at}:${index}`
      alive.add(key)
      let row = this.#rows.get(key)
      // A key that comes back pointing at DIFFERENT text is a different turn
      // (a thread swap can reuse `at:index`), so the node is rebuilt rather
      // than left lying about what it holds.
      if (row && (row.turn.text !== turn.text || row.turn.role !== turn.role)) {
        row.el.remove()
        row = undefined
      }
      row ??= this.#buildTurnRow(turn, key)
      this.#rows.set(key, row)
      // The two fields that change on an EXISTING row — mutated, not rebuilt.
      row.copyGlyph.textContent = this.#copiedTurn === key ? 'check' : 'content_copy'
      row.retry.disabled = this.#waiting
      order.push(row.el)
    }

    // Sweep first, walk second.
    for (const [key, row] of this.#rows) {
      if (alive.has(key)) continue
      row.el.remove()
      this.#rows.delete(key)
    }

    if (this.#streaming) {
      order.push(this.#streamNode())
      this.#detachWait()
    } else if (this.#waiting) {
      // THE WAIT, TOLD HONESTLY. How long it has been, whether anything is
      // actually listening, and a way out of it.
      this.#detachStream()
      order.push(...this.#waitNodes())
    } else {
      this.#detachStream()
      this.#detachWait()
    }

    let anchor: ChildNode | null = thread.firstChild
    for (const node of order) {
      if (anchor === node) { anchor = node.nextSibling; continue }
      thread.insertBefore(node, anchor)
    }

    this.#renderPill()
    // Code blocks are highlighted AFTER the turn is in the DOM — highlight.js
    // works on live elements, and the loader is lazy, so the first fenced block
    // in a session pays for the library and none of the later ones do.
    this.#after(0, () => { void highlightBlocks(this.#threadEl) })
  }

  /** One message, built once. Detached — `#renderThread` places it. */
  #buildTurnRow(turn: ChatTurn, key: string): TurnRow {
    const node = el('div', 'chat-msg')
    node.classList.toggle('user', turn.role === 'user')
    node.classList.toggle('ai', turn.role === 'assistant')

    const text = el('div', 'chat-msg-text')
    // THE ONE innerHTML IN THE PANEL, and the reason it is sound: the string
    // comes from `renderChatMarkdown`, whose entire safety story is
    // ESCAPE-FIRST — every piece of model text passes through `esc()` before
    // any tag is emitted, code spans and finished anchors are lifted into
    // placeholders so no pass can look inside a tag it did not write, and
    // hrefs are scheme-checked (`javascript:` / `data:` never reach the DOM).
    // Angular reached the DOM through `bypassSecurityTrustHtml`, which is NOT a
    // sanitising step: the sanitizer was bypassed because it STRIPPED the
    // `data-` attributes the hive-path chips and code-copy buttons are
    // addressed by. Removing the framework therefore removes nothing that was
    // protecting anything — the renderer was always the whole boundary, and it
    // is unchanged. Read its header before touching it.
    text.innerHTML = this.#markdown(turn.text)
    node.append(text)

    // What you can DO with an answer. Quiet until the message is hovered or
    // focused; always reachable by keyboard.
    const acts = el('div', 'chat-acts')

    const copyLabel = t('chat.act.copy', 'Copy this message')
    const copy = button('', `copy:${key}`)
    copy.title = copyLabel
    copy.setAttribute('aria-label', copyLabel)
    const copyGlyph = sym('content_copy')
    copy.append(copyGlyph)
    copy.addEventListener('click', () => this.copyTurn(turn, key))
    acts.append(copy)

    if (turn.role === 'assistant') {
      const noteLabel = t('chat.act.note', 'Put this answer on the current tile')
      const note = button('', `note:${key}`)
      note.title = noteLabel
      note.setAttribute('aria-label', noteLabel)
      note.append(sym('sticky_note_2'))
      note.addEventListener('click', () => { void this.noteTurn(turn) })
      acts.append(note)
    } else {
      const editLabel = t('chat.act.edit', 'Edit and send again')
      const edit = button('', `edit:${key}`)
      edit.title = editLabel
      edit.setAttribute('aria-label', editLabel)
      edit.append(sym('edit'))
      edit.addEventListener('click', () => this.editTurn(turn))
      acts.append(edit)
    }

    const retryLabel = t('chat.act.retry', 'Ask this again')
    const retry = button('', `retry:${key}`)
    retry.title = retryLabel
    retry.setAttribute('aria-label', retryLabel)
    retry.disabled = this.#waiting
    retry.append(sym('refresh'))
    retry.addEventListener('click', () => this.retryTurn(turn))
    acts.append(retry)

    node.append(acts)
    return { el: node, turn, copyGlyph, retry }
  }

  /** The half-arrived answer's node — created once per stream and MUTATED per
   *  chunk. `data-streaming` keeps the highlighter off a block that is still
   *  being written. */
  #streamNode(): HTMLElement {
    let node = this.#streamEl
    if (!node) {
      node = el('div', 'chat-msg ai')
      node.setAttribute('data-streaming', '')
      node.setAttribute('aria-live', 'polite')
      const text = el('div', 'chat-msg-text')
      node.append(text)
      this.#streamEl = node
      this.#streamTextEl = text
    }
    // Deliberately NOT memoized: every chunk is a new string, and caching them
    // would be a leak with a hit rate of zero.
    if (this.#streamTextEl) this.#streamTextEl.innerHTML = renderChatMarkdown(this.#streaming)
    return node
  }

  #detachStream(): void {
    this.#streamEl?.remove()
    this.#streamEl = null
    this.#streamTextEl = null
  }

  #waitNodes(): HTMLElement[] {
    let node = this.#waitEl
    if (!node) {
      node = el('div', 'chat-msg ai chat-wait')
      node.setAttribute('role', 'status')
      node.setAttribute('aria-live', 'polite')
      const text = el('span', 'chat-msg-text')
      const clock = el('span', 'chat-wait-clock')
      node.append(text, clock)
      this.#waitEl = node
      this.#waitTextEl = text
      this.#waitClockEl = clock
    }
    const unattended = this.#unattended()
    const text = this.#waitTextEl
    if (text) {
      // `[class.chat-think]="!unattended()"` — the pulse says "something is
      // coming"; an unattended question is not coming, so it does not pulse.
      text.classList.toggle('chat-think', !unattended)
      text.textContent = unattended
        ? t('chat.unattended', 'Nothing is listening yet')
        : this.#bridgeUp
          ? t('chat.thinking', 'Thinking…')
          : t('chat.queued.wait', 'Queued — waiting for a session to pick it up')
    }
    if (this.#waitClockEl) this.#waitClockEl.textContent = this.#elapsedLabel()

    const nodes: HTMLElement[] = [node]
    if (unattended) {
      const hint = this.#waitHintEl ?? el('p', 'chat-wait-hint')
      this.#waitHintEl = hint
      hint.textContent = t('chat.unattended.hint.wait',
        'Your question is saved and will be answered the moment a Claude Code session connects. '
        + 'Start the broker, park a session and tell it to listen for hive asks — or withdraw the question below.')
      nodes.push(hint)
    } else {
      this.#waitHintEl?.remove()
    }
    return nodes
  }

  #detachWait(): void {
    this.#waitEl?.remove()
    this.#waitHintEl?.remove()
  }

  /** Scrolled up to read something: arrivals stop moving the view, and this is
   *  the way back to the newest turn. `@if (!atBottom())`. */
  #renderPill(): void {
    const wrap = this.#threadWrapEl
    const pill = this.#pillEl
    if (!wrap || !pill) return
    if (this.#atBottom) { pill.remove(); return }
    const label = t('chat.scrollDown', 'Jump to the newest message')
    pill.setAttribute('aria-label', label)
    pill.querySelector('span:not(.mat-sym)')!.textContent = label
    if (pill.parentNode !== wrap) wrap.append(pill)
  }

  // ── the footer ───────────────────────────────────────────────────────
  //
  // Nothing here rebuilds the composer. The link row's text is written into an
  // existing span, the status row keeps its `<select>` and path span and only
  // its two optional chips are replaced, and the input row's trailing BUTTON is
  // the single node that is swapped (send ⇄ stop).

  #renderFoot(): void {
    const link = this.#linkEl
    if (link && this.#linkTextEl) {
      link.classList.toggle('waiting', !this.#bridgeUp)
      const who = this.#designated
      this.#linkTextEl.textContent = who
        ? this.#bridgeUp
          ? t('chat.link.ready', '{provider} is ready', { provider: who.label })
          : this.#hostConfigured
            ? t('chat.link.host', 'Your AI host is configured')
            : t('chat.link.pending', '{provider} is configured and waiting', { provider: who.label })
        : this.#bridgeUp
          ? t('chat.link.ready.any', 'A configured provider is ready')
          : this.#hostConfigured
            ? t('chat.link.host', 'Your AI host is configured')
            : t('chat.link.pending.any', 'Waiting for a configured provider')
      if (this.#answeringEl) {
        const label = t('chat.answering', 'Provider answering this conversation')
        this.#answeringEl.title = this.#answeringWhy() || label
        this.#answeringEl.setAttribute('aria-label', label)
        this.#answeringEl.replaceChildren(sym('auto_awesome'), document.createTextNode(this.#answering()))
      }
    }

    const row = this.#inputRowEl
    if (!row) return
    // STOP means two different acts, because the tiers fail differently: a live
    // host stream is aborted, a queued bridge ask is withdrawn from the pool.
    // The label says which one this press would be.
    const stopping = this.#canStop()
    const label = stopping
      ? (this.#hostStreaming ? t('chat.stop', 'Stop this answer') : t('chat.withdraw', 'Withdraw this question'))
      : t('chat.send', 'Send')
    const want = stopping ? 'chat-send chat-stop' : 'chat-send'
    if (this.#sendBtn && this.#sendBtn.className === want) {
      this.#sendBtn.title = label
      this.#sendBtn.setAttribute('aria-label', label)
      return
    }
    const next = button(want, 'send')
    next.title = label
    next.setAttribute('aria-label', label)
    next.append(sym(stopping ? 'stop' : 'arrow_upward'))
    next.addEventListener('click', () => { if (stopping) void this.stop(); else void this.send() })
    this.#sendBtn?.remove()
    row.append(next)
    this.#sendBtn = next
  }

  // ── LOOKING AT WHAT THE REQUEST CARRIES ──────────────────────────────
  //
  // `@if (viewingUrl())` — the overlay is a child of the panel and covers only
  // it. Nothing is put down to look at something: the composer still holds an
  // unsent question and the shelf still holds what you gathered, and both
  // survive because nothing navigated.

  #renderLook(): void {
    const url = this.viewingUrl()
    if (!url) {
      this.#lookEl?.remove()
      this.#lookEl = null
      this.#lookStamp = ''
      return
    }
    const held = this.#viewing!
    // Rebuild only when what is on screen actually CHANGED. Angular's effect
    // re-ran on `viewing()`, not on every tick, and an overlay rebuilt under an
    // unrelated render would take the focus off the ← the participant is
    // holding and lose the count they were reading.
    const stamp = `${held.key}|${url}|${this.viewingCount()}|${this.viewingIndex()}`
    if (this.#lookEl && stamp === this.#lookStamp) return
    const firstOpen = !this.#lookEl
    this.#lookStamp = stamp
    const layer = el('div', 'chat-look')
    layer.setAttribute('role', 'dialog')
    layer.setAttribute('aria-modal', 'true')
    layer.tabIndex = -1
    layer.setAttribute('aria-label', t('chat.reference.look', 'Look at {tile}', { tile: held.name }))
    layer.addEventListener('keydown', this.#onPictureKey)
    layer.addEventListener('click', () => this.closePicture())

    // The picture takes the press without closing; only the ground around it
    // means "done looking".
    const img = el('img', 'chat-look-img')
    img.src = url
    img.alt = held.name
    img.addEventListener('click', event => event.stopPropagation())
    layer.append(img)

    const bar = el('div', 'chat-look-bar')
    bar.addEventListener('click', event => event.stopPropagation())
    const count = this.viewingCount()
    if (count > 1) {
      const previous = button('chat-look-step', 'look-prev')
      const label = t('chat.reference.previous', 'Previous picture')
      previous.title = label
      previous.setAttribute('aria-label', label)
      previous.append(sym('chevron_left'))
      previous.addEventListener('click', () => this.stepPicture(-1))
      bar.append(previous)
    }
    bar.append(el('span', 'chat-look-name', held.name))
    if (count > 1) {
      bar.append(el('span', 'chat-look-count', `${this.viewingIndex() + 1} / ${count}`))
      const next = button('chat-look-step', 'look-next')
      const label = t('chat.reference.next', 'Next picture')
      next.title = label
      next.setAttribute('aria-label', label)
      next.append(sym('chevron_right'))
      next.addEventListener('click', () => this.stepPicture(1))
      bar.append(next)
    }
    const off = button('chat-look-off', 'look-off')
    const offLabel = t('chat.reference.done', 'Done looking')
    off.title = offLabel
    off.setAttribute('aria-label', offLabel)
    off.append(sym('close'))
    off.addEventListener('click', () => this.closePicture())
    bar.append(off)
    layer.append(bar)

    this.#lookEl?.remove()
    this.append(layer)
    this.#lookEl = layer
    // TAKE THE FOCUS WHEN IT OPENS. The overlay's keys are the whole
    // interaction — step, step, done — and a surface you have to click before
    // the arrows work is one whose arrows nobody finds. The press that opened
    // it was on a button inside the shelf, so focus has to be moved
    // deliberately. Stepping keeps it, because the node it was on is gone.
    if (firstOpen) queueMicrotask(() => { if (this.#lookEl === layer) layer.focus() })
    else layer.focus()
  }

  /** The rendered markdown for one turn. Bounded; keyed by content, so an
   *  identical turn reaching two threads is parsed once. */
  #markdown(text: string): string {
    const hit = this.#rendered.get(text)
    if (hit !== undefined) return hit
    const html = renderChatMarkdown(text)
    if (this.#rendered.size >= RENDER_CACHE_MAX) {
      // Oldest first — Map preserves insertion order, and the oldest turn in a
      // long thread is the one furthest from the screen.
      const oldest = this.#rendered.keys().next().value
      if (oldest !== undefined) this.#rendered.delete(oldest)
    }
    this.#rendered.set(text, html)
    return html
  }

  // ── THE CLIPBOARD IS THE WAY IN ──────────────────────────────────────
  //
  // One kind of thing — an op-less sig reference — and WHERE IT SITS is what it
  // means: on the clipboard it is gathered, on the SHELF it is part of THIS
  // request. Moving between them is the whole interface.

  toggleClipboardShelf(): void { this.#clipboardOpen = !this.#clipboardOpen; this.#renderHeader() }

  /** PASTE AS REFERENCE — one click on a clipboard item puts it on the shelf
   *  and takes it off the clipboard. Same entry, new place. */
  pasteReference(pick: RailPickLike): void {
    if (!this.#references.some(held => held.key === pick.key)) {
      this.#references = [...this.#references, pick]
      this.#announceSet()
      void this.#refreshContextThumbs()
    }
    EffectBus.emit('clipboard:discard-items', { labels: [pick.name] })
    if (this.#clipboardHeld.length <= 1) this.#clipboardOpen = false
    this.#renderHeader()
  }

  /** RESTORE — a reference dragged off the shelf goes back to the clipboard. */
  restoreToClipboard(index: number): void {
    const held = this.#references[index]
    if (!held) return
    this.#references = this.#references.filter((_, at) => at !== index)
    this.#announceSet()
    EffectBus.emit('clipboard:take-entries', {
      entries: [{ label: held.name, sourceSegments: [...held.path], sig: held.sig || undefined }],
    })
    this.#renderHeader()
  }

  /** WHICH BRANCH IT CAME FROM. The last two segments are what distinguishes
   *  two same-named tiles in practice; the whole address rides the title. */
  branchOf(pick: RailPickLike): string {
    return pick.path.length ? pick.path.slice(-2).join(' / ') : ''
  }

  /** The full address, for the hover — same ` / ` crumb the clipboard panel
   *  writes, so one path is spelled one way everywhere. */
  pathOf(pick: RailPickLike): string { return pick.path.join(' / ') }

  /** Is this reference a picture rather than something in the hive's tree? */
  isPicture(pick: RailPickLike): boolean { return !!pick.kind?.startsWith('image/') }

  /** A picture's weight, where a tile's branch would be. */
  sizeOf(pick: RailPickLike): string {
    const bytes = pick.size ?? 0
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
    return `${bytes} B`
  }

  /** Same bounded-cache discipline as the clipboard panel: revoke what left the
   *  set, resolve only what is new, and let a superseding change win the race.
   *  Resolve for BOTH faces at once — the shelf and the flyout draw from one
   *  cache, so pasting never re-fetches a picture the flyout already had, and
   *  neither list can revoke the other's object-URLs. */
  async #refreshContextThumbs(): Promise<void> {
    const entries = [...this.#references, ...this.#clipboardHeld]
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
      const store = get<StoreLike>(STORE_IOC_KEY)
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
    this.#contextThumbs = map
    if (this.#visible) { this.#renderHeader(); this.#renderLook() }
  }

  /** The bytes at a signature, as something an `<img>` can show. */
  async #imageUrl(store: StoreLike | undefined, sig: string): Promise<string | null> {
    if (!store?.getResource || !/^[0-9a-f]{64}$/.test(sig)) return null
    try {
      const blob = await store.getResource(sig)
      return blob ? URL.createObjectURL(blob) : null
    } catch { return null }
  }

  // ── looking at a shelf picture ───────────────────────────────────────

  /** What to paint. Derived from the live cache rather than captured at open,
   *  so a refresh that re-resolves a picture cannot leave the viewer showing a
   *  URL that has since been revoked. */
  viewingUrl(): string {
    const held = this.#viewing
    return held ? this.#contextThumbs[held.key] ?? '' : ''
  }

  /** The shelf's pictures, in shelf order — what ← and → step through. A
   *  reference with no picture is not in the set. */
  #picturesOnShelf(): RailPickLike[] {
    return this.#references.filter(pick => !!this.#contextThumbs[pick.key])
  }

  viewingIndex(): number {
    const held = this.#viewing
    if (!held) return -1
    return this.#picturesOnShelf().findIndex(pick => pick.key === held.key)
  }

  viewingCount(): number { return this.#picturesOnShelf().length }

  /** Open a shelf picture. Guarded on there BEING one: the box falls back to a
   *  name chip when nothing resolved, and that must not open an empty screen. */
  openPicture(pick: RailPickLike, event?: Event): void {
    event?.stopPropagation()
    if (!this.#contextThumbs[pick.key]) return
    this.#viewing = { key: pick.key, name: pick.name }
    this.#renderLook()
  }

  closePicture(): void {
    if (!this.#viewing) return
    this.#viewing = null
    this.#renderLook()
  }

  /** ← and → walk the shelf WITHIN the viewer. Wraps, so a shelf of three is a
   *  loop rather than a corridor with two dead ends. */
  stepPicture(delta: 1 | -1): void {
    const pictures = this.#picturesOnShelf()
    if (pictures.length < 2) return
    const at = this.viewingIndex()
    if (at < 0) return
    const next = pictures[(at + delta + pictures.length) % pictures.length]
    if (next) { this.#viewing = { key: next.key, name: next.name }; this.#renderLook() }
  }

  /** The viewer's own keys. Escape also unwinds through the window's cascade
   *  (see `#onKey`) for when focus never reached the overlay. */
  #onPictureKey = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowRight') { event.preventDefault(); this.stepPicture(1); return }
    if (event.key === 'ArrowLeft') { event.preventDefault(); this.stepPicture(-1); return }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closePicture() }
  }

  // ── the shelf's contents ─────────────────────────────────────────────

  /** A tile dropped straight onto the shelf — dragged off the sidebar rail,
   *  never through the clipboard. */
  addContext(tile: DroppedTile): void {
    if (!tile.sig && !tile.path) return
    const segments = tile.path.split('/').filter(Boolean)
    const name = tile.name || segments[segments.length - 1] || ''
    const key = tile.path.startsWith('/') ? tile.path : '/' + segments.join('/')
    if (this.#references.some(held => held.key === key)) return
    this.#references = [...this.#references, {
      key, path: segments.slice(0, -1), name, sig: tile.sig || undefined,
    }]
    this.#announceSet()
    void this.#refreshContextThumbs()
    this.#renderHeader()
  }

  /** WHAT THE REQUEST CARRIES, structured. `layer` is a single tile's own
   *  content; `group` is a named set — a META CONTEXT, one reference standing
   *  for many. The TARGET is not in here: the tile whose conversation this is
   *  rides as the ask's target, because it is what may be CHANGED. */
  referencePayload(): { kind: string; sig: string; label: string }[] {
    return this.#references
      .filter(pick => !!pick.sig)
      .map(pick => ({ kind: pick.kind ?? 'layer', sig: pick.sig ?? '', label: pick.name }))
  }

  /** Tell the sidebar which tiles are in the set being asked about, so it can
   *  draw them as one handful. The window owns the set; the rail only shows it. */
  #announceSet(): void {
    const paths = this.#references.map(pick =>
      pick.key.startsWith('/') ? pick.key : '/' + [...pick.path, pick.name].join('/'))
    EffectBus.emit('context:active-set', { paths })
  }

  /** ON OR OFF, from a press out in the hive. The tile icon that raises this is
   *  the SAME control both directions — a lit icon you cannot un-press is an
   *  icon you have to come back to the window to undo. */
  toggleContext(tile: DroppedTile): void {
    const segments = tile.path.split('/').filter(Boolean)
    const key = tile.path.startsWith('/') ? tile.path : '/' + segments.join('/')
    if (this.#references.some(held => held.key === key)) {
      this.#references = this.#references.filter(held => held.key !== key)
      this.#announceSet()
      void this.#refreshContextThumbs()
      this.#renderHeader()
      return
    }
    this.addContext(tile)
  }

  /** The × — take it off the shelf and out of the request. Deliberately NOT a
   *  restore: dragging it back is how you say "not now, but keep it". */
  removeContext(index: number): void {
    const held = this.#references[index]
    if (!held) return
    this.#references = this.#references.filter((_, at) => at !== index)
    this.#announceSet()
    void this.#refreshContextThumbs()
    this.#renderHeader()
  }

  /** Clear the shelf — the request carries nothing extra again. The tiles are
   *  untouched and the clipboard is left alone. */
  clearContext(): void {
    this.#rail?.clearSelection()
    this.#references = []
    this.#announceSet()
    void this.#refreshContextThumbs()
    this.#renderHeader()
    this.#focus()
  }

  /** Read a dragged tile, whatever surface dropped it. Returns null for a drag
   *  that is not one of ours, so an accidental file drop does nothing. */
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

  #onDropReference = (event: DragEvent): void => {
    event.preventDefault()
    this.#dragOverReference = false
    const tile = this.readDrop(event)
    if (tile) { this.addContext(tile); return }
    // A PICTURE IS A REFERENCE TOO. Files dropped here are kept in the hive
    // like everything else — content in, signature out.
    const files = [...(event.dataTransfer?.files ?? [])].filter(file => file.type.startsWith('image/'))
    if (files.length) void this.#attachImages(files)
    else this.#renderPayload()
  }

  #onDragOver = (event: DragEvent): void => {
    if (!event.dataTransfer?.types?.includes(TILE_DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (this.#dragOverReference) return
    this.#dragOverReference = true
    this.#payloadEl?.classList.add('over')
  }

  #onDragLeave = (): void => {
    if (!this.#dragOverReference) return
    this.#dragOverReference = false
    this.#payloadEl?.classList.remove('over')
  }

  // ── DRAG IT BACK OFF THE SHELF ───────────────────────────────────────
  // A reference dragged out of the shelf and released anywhere off it goes back
  // to the clipboard. The drop is not caught by a target — the shelf is the
  // only thing that would accept it, so LEAVING the shelf IS the gesture.

  #onReferenceDragStart(event: DragEvent, index: number): void {
    const held = this.#references[index]
    if (!held) return
    this.#draggingRef = index
    // It travels in the same shape the rail sends, so anything that accepts a
    // hive tile accepts this one too.
    const payload = JSON.stringify({ name: held.name, path: held.key, sig: held.sig ?? '' })
    event.dataTransfer?.setData(TILE_DRAG_TYPE, payload)
    event.dataTransfer?.setData('text/plain', held.key)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }

  #onReferenceDragEnd(): void {
    const index = this.#draggingRef
    this.#draggingRef = null
    if (index === null || this.#dragOverReference) {
      this.#dragOverReference = false
      this.#payloadEl?.classList.remove('over')
      return
    }
    this.restoreToClipboard(index)
  }

  // ── PICTURES ─────────────────────────────────────────────────────────
  //
  // The image is CONTENT: `putResource` stores the bytes at the content root
  // under their own signature, exactly like a layer or a note body, so the same
  // picture pasted twice is stored once. What rides on the ask is that
  // signature plus the media type as its KIND — the responder resolves the
  // bytes itself rather than being handed a copy inline.

  /** Paste an image straight into the composer. */
  #onComposerPaste = (event: ClipboardEvent): void => {
    const files = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith('image/'))
    if (!files.length) return
    // Only when it IS a picture — pasting text must stay ordinary pasting.
    event.preventDefault()
    void this.#attachImages(files)
  }

  /** Store each picture and put it on the shelf. Anything that will not store
   *  says so rather than sitting there looking attached. */
  async #attachImages(files: readonly File[]): Promise<void> {
    const store = get<StoreLike>(STORE_IOC_KEY)
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
      if (this.#references.some(held => held.key === key)) continue
      this.#references = [...this.#references, {
        key,
        path: [],
        name: file.name || 'pasted image',
        sig,
        size: file.size,
        // The MEDIA TYPE is the kind: a responder reading the ask knows both
        // that this is a picture and how to open it, from one field.
        kind: file.type || 'image/png',
      }]
    }
    this.#announceSet()
    void this.#refreshContextThumbs()
    this.#renderHeader()
  }

  // ── opening and closing ──────────────────────────────────────────────

  /**
   * Show the window.
   *
   * With a PREFILL this is a new question, so it starts a NEW conversation and
   * sends immediately — `/opus what links these tiles?` should answer, not fill
   * a box you then have to press Enter on, and it must not graft an unrelated
   * question onto whatever thread happened to be last.
   *
   * With no prefill it RESUMES the most recent conversation.
   */
  async open(payload?: { model?: string; prefill?: string; convoId?: string }): Promise<void> {
    this.#refreshAvailability()
    this.#refreshDesignation()
    const prefill = String(payload?.prefill ?? '').trim()
    this.#show()
    rememberChatVisibility(true)
    // Reopening always lands on the conversation, never folded away.
    this.#peeking = false
    this.classList.remove('peeking')
    this.#claimSurface(true)
    this.#applyFold()
    // Announce symmetrically with close() — the controls-bar launcher light
    // (and anything else watching) reads this state.
    EffectBus.emit('chat:window-state', { open: true })
    if (!this.#enabled()) { this.#render(); return }
    this.#refreshContext()
    this.#bridgeUp = !!get<BridgeLike>(BRIDGE_IOC_KEY)?.connected
    this.#refreshDesignation()

    if (payload?.convoId) { await this.#refreshList(); await this.#load(payload.convoId) }
    else if (prefill) { await this.#refreshList(); this.newChat() }
    else await this.#resume()

    // After the conversation is settled, so it is not overwritten by the
    // remembered model of the thread we just loaded.
    if (payload?.model) this.setModel(payload.model)

    this.#render()
    if (prefill) { await this.send(prefill); return }
    await this.#restoreDraft()
    this.#focus()
  }

  /** Land on the most recent conversation without taking focus — the boot path,
   *  the re-run once the threads service registers, and open()'s no-payload
   *  branch. One pass: the list walk already read the newest thread's turns. */
  async #resume(): Promise<void> {
    const threads = this.#threads()
    if (!threads) return
    if (threads.listConversationsWithLatest) {
      const { conversations, latestTurns } = await threads.listConversationsWithLatest()
      this.#conversations = conversations
      this.#grandfather()
      // ANY current conversation is kept — including a just-minted empty New
      // chat, which is a thing the participant explicitly created and must
      // survive a close/reopen. (Guarding on turns.length here silently threw
      // that new chat away and landed back in the previous thread.)
      if (this.#activeId) { this.#render(); return }
      // AN ARCHIVED THREAD IS NEVER "where you were" — resuming into one would
      // undo the act on the next reload. `latestTurns` skips them for the same
      // reason, so the two agree about which thread this is.
      const recent = conversations.find(convo => !convo.archived)
      if (recent) {
        this.#activeId = recent.convoId
        this.#model = this.#rememberedModel(recent.convoId)
        this.#modelExplicit = false
        this.#streaming = ''
        this.#turns = latestTurns
        this.#syncWait(recent.convoId)
        this.#render()
        this.#scrollDown(true)
      } else if (!this.#activeId) {
        this.newChat(false)
      }
      return
    }
    // Older module build without the one-pass read — the two-read path.
    await this.#refreshList()
    this.#grandfather()
    if (this.#activeId) { this.#render(); return }
    const recent = this.#conversations.find(convo => !convo.archived)
    if (recent) await this.#load(recent.convoId)
    else this.newChat(false)
  }

  close(): void {
    if (!this.#visible) return
    rememberChatVisibility(false)
    this.#peeking = false
    this.classList.remove('peeking')
    this.#claimSurface(false)
    this.#listOpen = false
    this.#armed = ''
    // Closing the window is a real close: the sidebar's trail and subject go
    // down with it. The half-written thought does NOT: it is flushed first, so
    // closing the window is never how you lose it.
    void this.#flushDraft()
    this.#rail?.dispose()
    this.#rail = null
    this.#railSubject = null
    // The shelf is NOT reset: coming back to a conversation you were part-way
    // through composing must find the references you had put on it. What dies
    // with the window is the flyout and the rail's pick bookkeeping.
    this.#clipboardOpen = false
    this.#railSeen = new Map()
    this.#hide()
    this.#applyFold()
    EffectBus.emit('chat:window-state', { open: false })
  }

  // ── conversations ────────────────────────────────────────────────────

  async #refreshList(): Promise<void> {
    const threads = this.#threads()
    if (!threads) return
    this.#conversations = await threads.listConversations()
    await this.#refreshDrafts()
    this.#render()
  }

  /** Read every held draft, so the roster can show the conversations that exist
   *  only as something you were part-way through saying. */
  async #refreshDrafts(): Promise<void> {
    const threads = this.#threads()
    if (!threads?.listTileDrafts) return
    try {
      const held = await threads.listTileDrafts()
      this.#drafts = held.map(entry => ({ key: entry.path, text: entry.text }))
      this.#render()
    } catch { /* the roster degrades to turns-only, never to an error */ }
  }

  /** Move a conversation to the top of the IN-MEMORY list after a turn lands —
   *  the pool is already the truth. Returns false when the conversation is not
   *  in the list and cannot be derived here, and the caller falls back to the
   *  real walk.
   *
   *  `added` is used only when the conversation is NOT the active one. The host
   *  tier stores TWO turns per send (question + streamed answer) in one bump. */
  #bumpList(convoId: string, added = 1): boolean {
    const turnsHere = convoId === this.#activeId ? this.#turns : null
    const list = this.#conversations
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
    this.#conversations = [summary, ...rest].sort((a, b) => b.lastAt - a.lastAt)
    this.#render()
    return true
  }

  async #load(convoId: string): Promise<void> {
    const threads = this.#threads()
    if (!threads || !convoId) return
    this.#activeId = convoId
    this.#model = this.#rememberedModel(convoId)
    this.#modelExplicit = false
    this.#streaming = ''
    const turns = await threads.readTurns(convoId)
    // A slow read landing after the participant moved on must not paint one
    // thread's turns under another thread's name — checked BEFORE the paint.
    if (this.#activeId !== convoId) return
    this.#turns = turns
    this.#syncWait(convoId)
    // Arriving IS reading: the newest turn here is no longer unread, which is
    // what takes the bold off this tile's row in the list.
    threads.markConversationSeen?.(convoId, turns[turns.length - 1]?.at ?? Date.now())
    EffectBus.emit('chat:threads-changed', { convoId })
    this.#render()
    // Switching threads re-pins: you are arriving at a conversation, and its
    // newest turn is where arriving means.
    this.#scrollDown(true)
  }

  /** PUT AWAY, NOT THROWN AWAY. Same button both ways — un-archiving is this
   *  act with the flag flipped. The list is updated optimistically because this
   *  is a one-press act on a row under the pointer; the refresh behind it
   *  corrects a write that failed. Archiving the conversation you are IN leaves
   *  you in it: what changed is where it sits in the list. */
  async archive(convoId: string, archived: boolean, event?: MouseEvent): Promise<void> {
    event?.stopPropagation()
    // A row half-way through arming a DELETE must not silently keep that arming
    // after a different button was pressed.
    this.#armed = ''
    this.#conversations = this.#conversations.map(convo =>
      convo.convoId === convoId ? { ...convo, archived } : convo)
    if (!archived && !this.#filedRoster().length) this.#archiveOpen = false
    this.#render()
    await this.#threads()?.setConversationArchived?.(convoId, archived)
    await this.#refreshList()
  }

  toggleArchive(): void { this.#archiveOpen = !this.#archiveOpen; this.#render() }
  toggleGoal(): void { this.#goalOpen = !this.#goalOpen; this.#render() }

  /** ARCHIVE THE ONE YOU ARE READING — and then MOVE ON. A press that files the
   *  conversation and leaves it on screen looks like a press that did nothing,
   *  so the window lands on the next live thread, or on a fresh chat when that
   *  was the last one. Bringing one BACK does stay put. */
  async archiveCurrent(): Promise<void> {
    const convoId = this.#activeId
    if (!convoId) return
    const filing = !this.#activeArchived()
    this.#goalOpen = false
    await this.archive(convoId, filing)
    if (!filing) return

    const next = this.#conversations.find(convo => !convo.archived && convo.convoId !== convoId)
    if (next) { await this.#load(next.convoId); await this.#restoreDraft(); this.#focus() }
    else this.newChat()
  }

  // ── a conversation per tile ──────────────────────────────────────────
  //
  // Clicking a row in the sidebar IS entering that tile's chat, so two things
  // move together: the transcript becomes that tile's thread, and the composer
  // becomes that tile's unsent thinking. Neither ACTIVATES anything — arriving
  // at a tile starts nothing, and the words you left there start nothing until
  // you send them.

  /** Where the composer's text is held: the tile, when the open conversation
   *  belongs to one, else the conversation itself. */
  #draftKey(): string {
    const id = this.#activeId
    return this.#threads()?.tilePathOf?.(id) || id
  }

  /** Hold what is in the composer. Debounced: typing must not be a write per
   *  keystroke, and the flushes on the way out of anything mean the debounce
   *  can never be the last word. */
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
    const text = this.#inputEl?.value ?? ''
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
    const element = this.#inputEl
    if (!element) return
    element.value = text
    this.autosize(element)
  }

  /** The sidebar clicked a row: leave the current thinking where it is, then
   *  arrive in that tile's conversation. A tile nobody has spoken to reads as
   *  an empty thread — dormant, not missing. */
  async #enterSubject(subject: RailPickLike | null): Promise<void> {
    await this.#flushDraft()
    this.#railSubject = subject
    if (!subject) { this.#render(); return }
    // WHICH conversation, not just which tile. The rail hands the exact id — a
    // tile holds several, and the hive's own row hands a global one whose path
    // is `/`, which no tile-name derivation could ever produce.
    const convoId = subject.convoId
      || this.#threads()?.tileConvoId?.([...subject.path, subject.name])
    if (convoId) await this.#load(convoId)
    await this.#restoreDraft()
    this.#listOpen = false
    this.#render()
    this.#focus()
  }

  /** Start a fresh thread. It does not appear in the list until it holds a
   *  turn. `focus` is false only on the boot path: the default view opens
   *  beside the command line and must not steal its cursor. */
  newChat(focus = true): void {
    const threads = this.#threads()
    void this.#flushDraft()
    // A CHAT ABOUT A TILE BELONGS UNDER THAT TILE. When the rail has a tile in
    // hand it mints the id and lists the new row itself; it answers false when
    // there is no tile, and then a free chat is the honest thing to make.
    if (this.#rail?.newChatOnSubject?.()) { if (focus) this.#focus(); return }
    this.#activeId = threads?.newConvoId() ?? ''
    this.#heldDraft = ''
    const box = this.#inputEl
    if (box) { box.value = ''; this.autosize(box) }
    this.#turns = []
    this.#streaming = ''
    this.#model = ''
    this.#modelExplicit = false
    this.#refreshDesignation()
    this.#endWait()
    this.#listOpen = false
    this.#armed = ''
    this.#atBottom = true
    this.#render()
    if (focus) this.#focus()
  }

  async pick(convoId: string): Promise<void> {
    this.#listOpen = false
    this.#armed = ''
    await this.#flushDraft()
    this.#railSubject = null
    this.#rail?.clearSubject()
    await this.#load(convoId)
    // Every conversation holds its own unsent thinking, whether or not it
    // belongs to a tile — arriving anywhere puts it back.
    await this.#restoreDraft()
    this.#focus()
  }

  /** First press arms, second deletes. */
  async removeConversation(convoId: string, event: MouseEvent): Promise<void> {
    event.stopPropagation()
    if (this.#armed !== convoId) { this.#armed = convoId; this.#render(); return }
    this.#armed = ''
    const threads = this.#threads()
    if (!threads) { this.#render(); return }

    // A DRAFT-ONLY ROW IS THE DRAFT. Deleting the (empty) bucket would leave the
    // words in the pool and the row would come straight back on the next
    // refresh. A conversation that HOLDS TURNS is different: its tile's unsent
    // thinking is standing intent about the tile, and it stays.
    const row = this.#roster().find(entry => entry.convoId === convoId)
    if (row && row.turnCount === 0 && row.draft) {
      const key = threads.tilePathOf?.(convoId) || convoId
      await threads.saveTileDraft?.(key, '')
    }

    // Leaving the conversation being deleted must not carry its words into the
    // next one: the box is emptied and the pending debounce cancelled BEFORE
    // anything else is loaded.
    if (this.#activeId === convoId) {
      if (this.#draftTimer !== null) { clearTimeout(this.#draftTimer); this.#draftTimer = null }
      this.#heldDraft = ''
      const box = this.#inputEl
      if (box) { box.value = ''; this.autosize(box) }
    }

    await threads.deleteConversation(convoId)
    await this.#refreshList()
    if (this.#activeId === convoId) {
      // Never land in something that was put away — the same rule resume follows.
      const next = this.#conversations.find(convo => !convo.archived)
      if (next) { await this.#load(next.convoId); await this.#restoreDraft() }
      else this.newChat()
    }
  }

  toggleList(): void {
    this.#armed = ''
    this.#listOpen = !this.#listOpen
    this.#render()
  }

  // ── model ────────────────────────────────────────────────────────────

  #modelMap(): Record<string, string> {
    try { return JSON.parse(localStorage.getItem(MODEL_KEY) ?? '{}') as Record<string, string> }
    catch { return {} }
  }

  #rememberedModel(convoId: string): string {
    const remembered = this.#modelMap()[convoId]
    return typeof remembered === 'string' ? remembered.trim().toLowerCase() : ''
  }

  setModel(requested: string): void {
    const next = String(MODEL_ALIASES[requested] ?? requested ?? '').trim().toLowerCase()
    if (!next) return
    this.#model = next
    this.#modelExplicit = true
    this.#remember(next)
    this.#refreshDesignation()
  }

  #remember(model: string): void {
    const id = this.#activeId
    if (!id || !model) return
    try {
      const map = this.#modelMap()
      if (map[id] === model) return
      map[id] = model
      localStorage.setItem(MODEL_KEY, JSON.stringify(map))
    } catch { /* participant-local convenience — never worth failing a send */ }
  }

  // ── context ──────────────────────────────────────────────────────────

  /** Where we are and what is selected. Read live from the hive, never stored
   *  on the conversation: a thread outlives the page it was started on. */
  #refreshContext(): void {
    const lineage = get<LineageLike>(LINEAGE_IOC_KEY)
    this.#here = (lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)

    const selection = get<SelectionLike>(SELECTION_IOC_KEY)
    this.#targets = [...(selection?.selected ?? [])]

    // Attached context — the cheap unresolved read (decoration index verbatim).
    try {
      const tileContext = get<TileContextLike>(TILE_CONTEXT_IOC_KEY)
      this.#contextCount = tileContext?.branchesFor?.(this.#here)?.length ?? 0
    } catch { this.#contextCount = 0 }
  }

  /** What the question is about: the canvas selection, plus the tile whose
   *  conversation is open. A subject on the CURRENT page rides as a bare name
   *  and one from a drilled level as its full `/path/name`. */
  #chosenTargets(): string[] {
    // THE TARGET IS THE CONVERSATION'S OWN TILE. Nothing to choose and nothing
    // to keep in step: you are talking to a tile, so that tile is what the
    // answer may change.
    const path = this.#subjectPath()
    if (!path || path === '/') return [...new Set(this.#targets)]
    const segments = path.split('/').filter(Boolean)
    const hereJson = JSON.stringify(this.#here)
    const parent = segments.slice(0, -1)
    const named = JSON.stringify(parent) === hereJson ? segments[segments.length - 1] : path
    return [...new Set([...this.#targets, named])]
  }

  /** The tile's attached context, resolved to content sigs for the SHALLOW tier
   *  (the host caps them server-side). Best-effort: context is a grade of
   *  service, never a reason a question fails to leave. */
  async #contextSigs(): Promise<readonly string[]> {
    try {
      const tileContext = get<TileContextLike>(TILE_CONTEXT_IOC_KEY)
      return await tileContext?.signaturesFor?.(this.#here) ?? []
    } catch { return [] }
  }

  // ── the wait, told honestly ──────────────────────────────────────────
  //
  // A WAIT BELONGS TO ITS CONVERSATION, not to the window. It used to be one
  // flag: opening another thread cleared it, so a question still out on the
  // thread you left lost its clock, its Stop button and its withdraw handle.
  // With a chat per tile that is the ordinary move, so outstanding asks are
  // held per convoId and the window merely SHOWS the active one.
  //
  // `#outstanding` is a MAP KEYED BY CONVERSATION, which is what makes every
  // path into it idempotent: a second delivery of the same start (or the same
  // recovery record) SETS the same entry rather than accumulating a second one,
  // and `#endWait` guards its `agent:end` on the delete actually removing
  // something. Nothing here counts or appends.

  #startWait(convoId: string, question = ''): void {
    this.#outstanding.set(convoId, { sig: '', askedAt: Date.now() })
    this.#announceBusy(convoId, true)
    this.#raiseBee(convoId, question)
    this.#syncWait(convoId)
  }

  /** One bee per conversation — `#outstanding` is keyed the same way, so a
   *  second question cannot exist while the first is out. */
  #beeId(convoId: string): string { return `chat:${convoId}` }

  /** WHO IS ABOUT TO ANSWER. With a session on the bridge it is the model the
   *  composer is set to; without one the shallow host takes it, and that tier
   *  has its own model. */
  #answeringModel(): string {
    return this.#providerReady ? this.#answering() : this.#bridgeUp ? this.#answering() : HOST_TIER_MODEL
  }

  /** A QUESTION IS A UNIT OF WORK, so it gets a bee. The registry derives
   *  kind → vendor → tier from the model at spawn, so declaring `kind:'model'`
   *  and the model in hand is the whole of the branding — this surface never
   *  names a colour. WHERE THE BEE SITS is the tile's own label, with the rest
   *  of its path as the segments; a chat about no tile leaves both empty, which
   *  is how the bee drone spells "hive-wide". */
  #raiseBee(convoId: string, question: string, model = this.#answeringModel()): void {
    const path = this.#threads()?.tilePathOf?.(convoId) ?? ''
    const parts = path.split('/').filter(Boolean)
    EffectBus.emit('agent:start', {
      id: this.#beeId(convoId),
      behavior: model,
      kind: 'model',
      model,
      request: question,
      targets: parts.length ? [parts[parts.length - 1]] : [],
      segments: parts.slice(0, -1),
    })
  }

  /** Stop waiting, whatever ended it — an answer, a failure, a withdrawal.
   *  Guarded on the delete: several paths can fire for one question, and
   *  raising a second `agent:end` on an id the registry has already retired is
   *  noise in its log. */
  #endWait(convoId: string = this.#activeId): void {
    if (this.#outstanding.delete(convoId)) {
      this.#announceBusy(convoId, false)
      EffectBus.emit('agent:end', { id: this.#beeId(convoId), ok: true })
    }
    if (convoId === this.#activeId) this.#syncWait(convoId)
  }

  /** Paint the wait state of one conversation — called on every arrival at a
   *  thread, so a question still out is found exactly as it was left. */
  #syncWait(convoId: string): void {
    const out = this.#outstanding.get(convoId)
    this.#stopClock()
    if (!out) {
      this.#waiting = false
      this.#hostStreaming = false
      this.#streaming = ''
      this.#pendingSig = ''
      this.#elapsed = 0
      this.#render()
      return
    }
    this.#waiting = true
    this.#askedAt = out.askedAt
    this.#pendingSig = out.sig
    // A HOST ANSWER STILL ARRIVING ON THIS THREAD. The run kept the text while
    // the window was elsewhere; arriving is where it gets picked back up.
    this.#attachHostRun(convoId)
    this.#elapsed = Math.max(0, Math.round((Date.now() - out.askedAt) / 1000))
    this.#render()
    this.#elapsedTimer = setInterval(() => {
      if (!this.#waiting) { this.#stopClock(); return }
      this.#elapsed = Math.max(0, Math.round((Date.now() - this.#askedAt) / 1000))
      // The CLOCK only — a full render every second would rebuild the
      // conversation bar and the roster once per tick for one changed word.
      if (this.#waitClockEl) this.#waitClockEl.textContent = this.#elapsedLabel()
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

  // ── A QUESTION SURVIVES THE PAGE ─────────────────────────────────────
  //
  // THE ASK WAS ALWAYS DURABLE; THE WAITING WAS NOT. A bridge question is a
  // record in the optimization pool and its answer is written to the thread by
  // the worker, with or without a window open. What died on every reload was
  // everything that SAID SO. So the wait is REBUILT FROM THE RECORD.

  /**
   * Put back every wait the page interruption took away.
   *
   *   the pool     a bridge ask still marked pending — the clock, Stop and the
   *                bee come back and the tile is marked as thinking again
   *   checkpoints  a host answer that was mid-stream — its connection cannot
   *                outlive the page, so what IS recoverable is the text, filed
   *                as the turn it was becoming
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
        if (this.#activeId) void this.#load(this.#activeId)
      }
    } catch { /* the checkpoint stays on disk; the next boot tries again */ }

    const store = get<StoreLike>(STORE_IOC_KEY)
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
          mode?: string; askSig?: string; status?: string; convoId?: string
          askedAt?: number; prompt?: string; model?: string
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
      // what is out there was asked of a particular tier.
      this.#raiseBee(ask.convoId, ask.prompt, ask.model || this.#answeringModel())
      if (ask.convoId === this.#activeId) this.#syncWait(ask.convoId)
    }
  }

  /**
   * Call the question back.
   *
   * The two tiers fail differently and so they are stopped differently. A host
   * answer is a live HTTP stream: aborting it is all there is, and whatever had
   * already arrived is kept, because the host really did say it. A bridge ask
   * is a durable RECORD sitting in the optimization pool — stopping it means
   * taking that record out, plus the same `mode:'stop'` marker AgentRegistry
   * leaves for a responder already mid-flight.
   */
  async stop(): Promise<void> {
    if (this.#hostStreaming) {
      // The run keeps whatever had already arrived and stores it — stopping is
      // not discarding. Its `chat:host-done` ends the wait.
      stopHostRun(this.#activeId)
      return
    }
    await this.withdraw()
  }

  /** Retire a queued ask. Idempotent, and safe when the record is already gone. */
  async withdraw(): Promise<void> {
    const sig = this.#pendingSig
    this.#endWait()
    if (!sig) return

    const store = get<StoreLike>(STORE_IOC_KEY)
    if (!store?.removeOptimization) return
    try {
      await store.removeOptimization(sig)
      // The courtesy marker: a responder that already has this ask in hand
      // learns it was withdrawn. Same shape AgentRegistry.#retireAsk writes.
      if (store.putOptimization) {
        const marker = {
          kind: 'ask',
          appliesTo: [...this.#targets],
          payload: { mode: 'stop', askSig: sig, status: 'stopped', askedAt: Date.now() },
          mark: 'persistent',
        }
        await store.putOptimization(new Blob([JSON.stringify(marker)], { type: 'application/json' }))
      }
    } catch { /* the ask is out of the pool or was never in it — either way, done */ }
  }

  // ── guided setup actions ─────────────────────────────────────────────

  /** Step 1 — the only step that takes the participant's word. */
  markTools(): void {
    this.#toolsDone = true
    writeFlag(SETUP_TOOLS_KEY)
    this.#render()
  }

  /** Step 2 — remember that this tab may use the local bridge. Socket creation
   *  stays in step 3, after the participant has started the broker, so an
   *  expected offline broker never becomes a browser network error. */
  enableBridge(): void {
    try { localStorage.setItem(CLAUDE_BRIDGE_ENABLED_STORAGE_KEY, '1') } catch { /* private mode */ }
    this.#bridgeConfigured = isLocalClaudeBridgeConfigured()
    this.#render()
  }

  /** Step 4 — prove the loop with a real question. Completes when the answer
   *  lands (`#onReply` sets the first-reply flag). */
  tryAsk(): void {
    const i18n = get<I18nProvider>(I18N_IOC_KEY)
    const starter = i18n?.t?.('chat.setup.starter') || 'What do you see in this hive?'
    this.#tried = true
    this.#render()
    void this.send(starter)
  }

  /** Copy a checklist command; the button flashes "Copied" briefly. */
  copyCmd(id: string, text: string): void {
    void navigator.clipboard?.writeText(text).then(() => {
      this.#copied = id
      this.#render()
      this.#after(1_400, () => { if (this.#copied === id) { this.#copied = ''; this.#render() } })
    }).catch(() => { /* clipboard unavailable — the text is still visible */ })
  }

  /** Complete (or skip) the checklist and land in the chat. */
  finishSetup(): void {
    this.#setupDone = true
    writeFlag(SETUP_DONE_KEY)
    this.#render()
    this.#focus()
  }

  /** The host door — configure a participant-controlled AI host directly.
   *  `setHost` announces `host-ai:configuration`, which this window already
   *  follows into `#hostConfigured` and a resume. */
  connectHost(domain: string): void {
    const bare = String(domain ?? '').trim()
    if (!bare) return
    const host = get<HostAiLike>(HOST_AI_IOC_KEY)
    if (!host?.setHost) {
      EffectBus.emit('toast:show', { type: 'warning', message: 'Host service unavailable — try again in a moment.' })
      return
    }
    host.setHost(bare)
  }

  /** A participant with existing conversations predates the checklist — never
   *  greet them with a wizard for a loop they already run. */
  #grandfather(): void {
    if (!this.#setupDone && this.#conversations.length > 0) {
      this.#setupDone = true
      writeFlag(SETUP_DONE_KEY)
    }
  }

  // ── sending ──────────────────────────────────────────────────────────

  /**
   * Send a message on the active conversation.
   *
   * The user's turn is written to the thread BEFORE the ask goes out. It used
   * not to be — only replies were stored — so a reload showed answers with no
   * questions above them.
   */
  async send(text?: string): Promise<void> {
    this.#refreshAvailability()
    this.#refreshDesignation()
    if (!this.#enabled()) return
    const element = this.#inputEl
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

    let convoId = this.#activeId
    if (!convoId) { convoId = threads.newConvoId(); this.#activeId = convoId }

    if (element && text === undefined) { element.value = ''; this.autosize(element) }
    // SENT IS NOT HELD. The thinking became a turn; leaving a copy in the
    // drafts pool would show the tile as still having something unsaid.
    void this.#flushDraft()

    const turn: ChatTurn = { kind: 'chat-turn', convoId, role: 'user', text: message, at: Date.now() }
    this.#turns = [...this.#turns, turn]
    this.#startWait(convoId, message)
    // Sending is the one arrival the participant caused, so it re-pins the
    // transcript even if they had scrolled up to read something.
    this.#scrollDown(true)

    const stored = await threads.appendTurn(convoId, 'user', message)
    if (!stored) console.warn('[chat] the question was not stored — it will be missing after a reload')

    // Direct/local/keyed providers route first and apply the standing policy.
    const routed = await this.#askProvider(convoId, message)
    if (routed === 'answered' || routed === 'aborted') return

    // The legacy host and bridge tiers remain honest fallbacks. With a session on the bridge, the question goes to
    // it: that is the deep tier, and the only one that can read the hive. With
    // nothing listening, the host's AI answers immediately instead. If the host
    // tier is unreachable and a local bridge is configured, the question is
    // QUEUED there.
    if (!this.#bridgeUp) {
      // THE ENDING IS NOT THIS CALL'S RETURN VALUE. `chat:host-done` paints,
      // stores and counts it, because the run outlives this element. What comes
      // back is only the ROUTING decision.
      const outcome = await this.#askHost(convoId, message)
      if (outcome === 'answered') return
      // STOPPED BY THE PARTICIPANT. Handing a question they just called back to
      // the durable bridge queue would be the opposite of what Stop means.
      if (outcome === 'aborted') return
    }

    // A participant-host failure is retryable, but without a configured local
    // bridge there is nobody who could ever drain the durable bridge queue.
    if (!this.#bridgeConfigured || !queen?.submitChat) {
      this.#endWait()
      EffectBus.emit('toast:show', {
        type: 'warning',
        message: 'Your AI host is unavailable. Check its setup and try again.',
      })
      return
    }

    const transcript = this.#turns
      .slice(-TRANSCRIPT_TURNS)
      .map(item => ({ role: item.role, text: item.text }))

    // THE TIER CHANGED UNDER THE QUESTION. Getting here with the bridge down
    // means the shallow host declined it and the durable queue will answer
    // instead — with the composer's model, not the host's.
    if (!this.#bridgeUp) this.#raiseBee(convoId, message, this.#answering())

    queen.activeModel = this.#answering()
    this.#remember(this.#answering())
    const queued = await queen.submitChat(
      convoId, message, this.#chosenTargets(), transcript, this.referencePayload())
    if (!queued) {
      this.#endWait()
      EffectBus.emit('toast:show', { type: 'warning', message: 'Could not send — try again.' })
    } else if (typeof queued === 'string') {
      // The ask's record signature: the handle Withdraw pulls on. Stored ON the
      // conversation so stepping away and back finds Withdraw still armed.
      const out = this.#outstanding.get(convoId)
      if (out) this.#outstanding.set(convoId, { ...out, sig: queued })
      if (convoId === this.#activeId) { this.#pendingSig = queued; this.#renderFoot() }
    }
    if (!this.#bumpList(convoId)) void this.#refreshList()
  }

  /** Route ordinary chat through the provider registry before legacy
   *  transports. This path sees only the transcript and explicit references;
   *  it never claims to have walked the hive. */
  async #askProvider(convoId: string, message: string): Promise<'answered' | 'declined' | 'aborted'> {
    const router = get<LlmRouterLike>(LLM_ROUTER_IOC_KEY)
    const need = { tier: 'fast', streaming: true }
    const namedModel = this.#modelExplicit ? this.#model || undefined : undefined
    const preferModel = !this.#modelExplicit ? this.#model || undefined : undefined
    if (!router?.stream || !router.ready?.({ model: namedModel, preferModel, need })) return 'declined'

    const messages = this.#turns.slice(-TRANSCRIPT_TURNS).map(turn => ({
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
        component.#designated = {
          providerId: chunk.providerId,
          label: chunk.providerLabel,
          vendor: chunk.vendor,
          tier: 'fast',
          model: chunk.model,
          name: chunk.model,
        }
        component.#model = chunk.model
        component.#modelExplicit = false
        component.#remember(chunk.model)
        yield chunk.text
      }
      return ''
    }

    EffectBus.emit('agent:progress', {
      id: this.#beeId(convoId),
      activity: `routing to ${this.#designated?.label ?? 'a configured provider'}`,
    })
    if (convoId === this.#activeId) { this.#hostStreaming = true; this.#renderFoot() }
    const threads = this.#threads()
    return startHostRun(convoId, message, { ask }, {
      appendTurn: (id, role, text) => threads?.appendTurn(id, role as TurnRole, text) ?? Promise.resolve(false),
      saveStreamCheckpoint: (id, text) => threads?.saveStreamCheckpoint?.(id, text) ?? Promise.resolve(false),
    })
  }

  /**
   * The shallow tier: stream an answer from the host's AI.
   *
   *   'answered'  the host said something and it is stored
   *   'declined'  the host cannot answer — fall through to the bridge queue
   *   'aborted'   the PARTICIPANT stopped it — never re-queue a recalled ask
   *
   * THE RUN IS NOT THIS ELEMENT'S. It lives in `host-stream.ts`, at module
   * scope, keyed by conversation — because a streamed answer must survive
   * everything short of the page itself going away. The loop stores the turn
   * itself; what is left here is the painting.
   */
  async #askHost(convoId: string, message: string): Promise<'answered' | 'declined' | 'aborted'> {
    const host = get<HostAiLike>(HOST_AI_IOC_KEY)
    // The bundled address is not a shared/free allowance. Only a host the
    // participant explicitly configured may be used as the shallow fallback.
    if (!host?.configured || !host.ask) return 'declined'

    // The attached-context sigs the host inlines server-side from its own heap.
    const contextSigs = await this.#contextSigs()

    // The shallow tier cannot read the hive, so chosen tiles reach it the only
    // way they can: named in the question itself. Wire-only — the stored turn
    // stays the participant's own words.
    const about = this.#chosenTargets()
    const question = about.length ? `${message}\n\n(About: ${about.join(', ')})` : message

    EffectBus.emit('agent:progress', {
      id: this.#beeId(convoId),
      activity: 'answering on the shallow tier — your AI host',
    })

    if (convoId === this.#activeId) { this.#hostStreaming = true; this.#renderFoot() }

    // The threads module is resolved ONCE and handed to the run, because the
    // run may still be going when this window is not.
    const threads = this.#threads()
    return startHostRun(convoId, question, host as { ask?: HostAsk }, {
      appendTurn: (id, role, text) => threads?.appendTurn(id, role as TurnRole, text) ?? Promise.resolve(false),
      saveStreamCheckpoint: (id, text) => threads?.saveStreamCheckpoint?.(id, text) ?? Promise.resolve(false),
    }, { contextSigs })
  }

  /** A chunk landed. Only the conversation on screen is painted — the text
   *  itself is accumulated in the run, not here, so switching away and back
   *  finds the answer exactly as far along as it really is.
   *
   *  THE HOT PATH OF THE WHOLE PANEL. It mutates the live streaming node and
   *  nothing else: no transcript rebuild, no footer rebuild unless the
   *  streaming FLAG actually changed, and therefore nothing that could touch
   *  the composer's caret while a token arrives every few milliseconds. */
  #onHostChunk(payload?: { convoId?: string; text?: string }): void {
    const convoId = String(payload?.convoId ?? '')
    if (!convoId || convoId !== this.#activeId) return
    const wasStreaming = this.#hostStreaming
    this.#hostStreaming = true
    this.#streaming = String(payload?.text ?? '')
    const text = this.#streamTextEl
    if (!wasStreaming || !this.#streamEl || !text) {
      // First chunk: the wait row gives way to the answer, and the Stop button
      // changes meaning. One full thread pass, once.
      this.#renderThread()
      this.#renderFoot()
    } else {
      // EVERY OTHER CHUNK: one innerHTML write on a node that is already in the
      // document. Nothing above it is rebuilt, so the transcript keeps its
      // scroll, the action rows keep focus, and the composer keeps its caret.
      text.innerHTML = renderChatMarkdown(this.#streaming)
    }
    this.#scrollDown()
  }

  /**
   * A host answer finished — stored by the run before this fired. TERMINAL: the
   * wait ends, the bee is retired, and the turn is painted if this window is
   * still on that thread.
   */
  #onHostDone(payload?: { convoId?: string; text?: string; outcome?: string }): void {
    const convoId = String(payload?.convoId ?? '')
    if (!convoId) return
    const text = String(payload?.text ?? '')
    const outcome = String(payload?.outcome ?? '')

    if (convoId === this.#activeId) {
      this.#streaming = ''
      this.#hostStreaming = false
    }

    // DECLINED IS NOT AN ENDING. The host could not take the question, and
    // `send()` is still standing there deciding whether the durable bridge
    // queue gets it — ending the wait here would blink the indicator off under
    // a question that is about to be asked again.
    if (outcome === 'declined' && !text.trim()) { this.#render(); return }

    if (text.trim()) {
      if (convoId === this.#activeId) {
        this.#turns = [...this.#turns, {
          kind: 'chat-turn', convoId, role: 'assistant', text, at: Date.now(),
        }]
        this.#threads()?.markConversationSeen?.(convoId, Date.now())
        this.#render()
        this.#scrollDown()
      }
      if (!this.#bumpList(convoId, 2)) void this.#refreshList()
      EffectBus.emit('chat:threads-changed', { convoId })
    }
    this.#endWait(convoId)
  }

  /** Re-attach to an answer still arriving on the conversation being shown. A
   *  window rebuilt mid-stream finds the partial where the run kept it. */
  #attachHostRun(convoId: string): void {
    const live = liveHostRun(convoId)
    if (!live) return
    this.#hostStreaming = true
    this.#streaming = live.text
  }

  #onReply(payload?: { convoId?: string; text?: string }): void {
    const convoId = String(payload?.convoId ?? '')
    const text = String(payload?.text ?? '')
    if (!convoId || !text) return

    // The loop is PROVEN — an answer came back over the bridge. This is the
    // checklist's final verification, whichever thread it landed in.
    if (!this.#firstReply) {
      this.#firstReply = true
      writeFlag(FIRST_REPLY_KEY)
    }

    // A reply for another thread: it is on disk, so all that is owed here is a
    // list that shows it moved to the top. Its wait ends all the same, and its
    // tile is left UNREAD, which is the mark that brings you back to it.
    if (convoId !== this.#activeId) {
      this.#endWait(convoId)
      if (!this.#bumpList(convoId)) void this.#refreshList()
      EffectBus.emit('chat:threads-changed', { convoId })
      return
    }

    const at = Date.now()
    this.#turns = [...this.#turns, { kind: 'chat-turn', convoId, role: 'assistant', text, at }]
    this.#endWait(convoId)
    // Read as it lands: you are looking straight at it.
    this.#threads()?.markConversationSeen?.(convoId, at)
    this.#render()
    this.#scrollDown()
    if (!this.#bumpList(convoId)) void this.#refreshList()
    EffectBus.emit('chat:threads-changed', { convoId })
  }

  // ── input ────────────────────────────────────────────────────────────

  /**
   * Enter sends, Shift+Enter opens a line.
   *
   * Propagation is stopped on EVERY key, not just the ones handled here: the
   * hive binds bare letters as shortcuts, so a message typed into an input that
   * let its keys through would drive the canvas as it was written.
   */
  #onInputKey = (event: KeyboardEvent): void => {
    event.stopPropagation()
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void this.send()
      return
    }
    // Through the SAME cascade the window itself runs — the caret lives in this
    // box (every focus() lands here), so an Escape that closed the whole window
    // directly would throw away picked tiles and the drilled trail from the one
    // place Escape is most likely to be pressed.
    if (event.key === 'Escape') this.#onKey(event)
  }

  /** Grow with the message, to a ceiling — past that the box scrolls, so the
   *  transcript never loses the screen to a long draft. */
  autosize(element: HTMLTextAreaElement): void {
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`
  }

  #onInput = (event: Event): void => {
    this.autosize(event.target as HTMLTextAreaElement)
    this.#holdDraft()
  }

  #focus(): void { this.#after(0, () => this.#inputEl?.focus()) }

  // ── scroll anchoring ─────────────────────────────────────────────────
  //
  // The transcript used to pin `scrollTop` to the bottom on every chunk, which
  // meant a streaming answer could not be read from the top. So: follow the
  // bottom only while the participant is AT the bottom, and when they are not,
  // say so with a pill instead of overruling them.

  #onScroll = (): void => {
    const element = this.#threadEl
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    const next = distance <= NEAR_BOTTOM_PX
    if (next === this.#atBottom) return
    this.#atBottom = next
    this.#renderPill()
  }

  /** After the turn is in the DOM, not before. `force` is for arrivals the
   *  participant caused — their own message, a thread they just opened. */
  #scrollDown(force = false): void {
    if (!force && !this.#atBottom) return
    this.#after(0, () => {
      const element = this.#threadEl
      if (!element) return
      element.scrollTop = element.scrollHeight
      this.#atBottom = true
      this.#renderPill()
    })
  }

  /** The pill. Back to the newest turn, and following again from here. */
  scrollToBottom(): void { this.#scrollDown(true) }

  // ── per-message actions ──────────────────────────────────────────────
  //
  // An answer you cannot act on is a screenshot. Copy takes it out of the hive,
  // note puts it IN — and retry and edit exist because the first phrasing of a
  // question is usually not the good one. Nothing here rewrites history: a
  // thread is append-only, so editing a question sends a NEW turn.

  /** The question that produced this turn: itself, if it is the question. */
  #questionFor(turn: ChatTurn): string {
    if (turn.role === 'user') return turn.text
    const list = this.#turns
    const index = list.indexOf(turn)
    for (let i = (index < 0 ? list.length : index) - 1; i >= 0; i--) {
      if (list[i].role === 'user') return list[i].text
    }
    return ''
  }

  copyTurn(turn: ChatTurn, key: string): void {
    void navigator.clipboard?.writeText(turn.text).then(() => {
      this.#copiedTurn = key
      this.#renderThread()
      this.#after(1_400, () => {
        if (this.#copiedTurn !== key) return
        this.#copiedTurn = ''
        this.#renderThread()
      })
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
    const element = this.#inputEl
    if (!element) return
    element.value = turn.text
    this.autosize(element)
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }

  /**
   * Put this answer on the tile it is about, as a note.
   *
   * The tile is the ONE selected tile if there is exactly one, else the page the
   * participant is standing in. `addAtSegments` takes an explicit path for
   * exactly this reason — the `note:commit` effect writes to a child of the
   * current location, which is a different tile than the one the status line
   * above the composer has been naming all along.
   */
  async noteTurn(turn: ChatTurn): Promise<void> {
    const here = [...this.#here]
    const selected = this.#targets
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

    const notes = get<NotesLike>(NOTES_IOC_KEY)
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

  // ── links inside an answer ───────────────────────────────────────────

  /**
   * One delegated click for the whole transcript.
   *
   * Rendered markdown is not a template, so its interactive parts carry `data-`
   * attributes and this reads them. The anchor branch is the important one: an
   * `<a href>` left to itself navigates the shell document, which on the native
   * client means the window is gone and on the web means every drone unloads.
   */
  #onThreadClick = (event: MouseEvent): void => {
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
        this.#after(1_400, () => { copy.textContent = 'copy' })
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
    get<NavigationLike>(NAVIGATION_IOC_KEY)?.goRaw?.(segments)
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

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host with no
// ShellSurfaceRegistry (diamond-core-processor mounts these tags directly in
// its own template) still needs the tag to be a real element rather than an
// inert unknown one — so the define cannot wait on the registry. Only the ADD
// does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, ChatWindowElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/ChatWindowElement',
    element: SURFACE_NAME,
    order: 113,
  })
})
