// assistant/agent-tiles-rail.ts
//
// THE TILES RAIL — THE hive list. Wherever the product shows "the tiles at
// this level", it is this: the agent panel mounts it directly, and the chat
// window and the notes panel (shared shell, which must never import
// essentials) reach it through the IoC factory registered at the bottom. It
// carries its own stylesheet so it looks the same wherever it is mounted —
// same rows, same square pictures, same search box, same collapse by name.
//
// A second list would drift, and did: the notes panel drew its own chips off
// its own read and showed letters where this shows pictures, three rows where
// this shows one. So the differences between surfaces are a PROFILE
// (RailProfile) on one list, not a second list — what a click means, whether
// the list can walk, what the badge counts, what the find box searches. The
// defaults are the chat window's.
//
// One level of the hive at a time, as a vertical list: square picture icons,
// names, a chevron where there is structure inside, and a quiet count of the
// bees already working each tile. Selecting a tile that has children fills
// the rail with those children; the ‹ at the top walks back out. The rail
// opens on the level the participant is standing on, with the way UP already
// in the trail — so "back" can climb past the starting point to the root.
// The search box under the title filters the level in hand by name; moving
// to another level empties it, because a filter held over fresh children
// reads as an empty tile.
//
// One row per NAME, never one per child sig: the collapse lives in the walk
// (presentation/tiles/tree-walk.ts), so the rail shows exactly what the
// canvas shows even when a parent's `children` still carries a superseded
// sig beside its replacement.
//
// EVERY ROW IS A CONVERSATION. A tile and a chat about that tile are the same
// thing said two ways, so the list of tiles IS the list of chats — there is no
// separate roster to keep in step and no control to opt a tile in. Three
// gestures, and nothing else:
//
//   click        MOVE to that layer. The panel then lists its children. The
//                reading pane stays where it was. Coming back out is what
//                puts the conversation in view. A chat row has no arrow:
//                the click is the drill.
//   the chat     TALK ABOUT it — the icon unfolds conversations that actually
//   icon         hold an exchange and resumes the one you were last in. An
//                empty composer is already the way to begin the FIRST one, so
//                a tile nobody has spoken to shows no fold furniture at all.
//                On the tile you are IN, the fold carries one quiet
//                "+ New conversation" line under the live rows — the way to
//                the next thread. It is a link, not a row: pressing it swaps
//                the window to a fresh composer and mints nothing; the
//                conversation appears in the list when its first turn lands
//                and names it.
//   ctrl-click   CHOOSE it — add the tile to the context the next request
//                carries. Any number, gathered across any number of levels
//                (the choice survives walking in and out), because what is
//                being built is a LIST OF SIGNATURES: content-addressed, so
//                the same choice composes the same payload every time. Out in
//                the HIVE the same gathering is the shelf — a tile's shelf
//                icon, or To shelf on a selection — not this chord. On a
//                hexagon ctrl-click is already the selection toggle, and one
//                chord meaning two things by invisible state is the thing
//                this window was built to kill.
//   right-click  come back out
//
// All of them are pointer gestures, and a list that can only be walked with a
// mouse is a list some people cannot walk at all — so the same moves answer to
// the keyboard: → drills one layer, ← comes back out, ↑↓ walk the rows, Space
// chooses, and the level that arrives takes the focus so a keyboard is never
// stranded on a row that no longer exists. An empty level keeps that focus on
// the hive's own line, which is what ← still has to press.
//
// Archiving is NOT one of the row's gestures. A thread is put away from the
// PANE, on the conversation you have opened; this list only ever READS what
// was put away, behind the fold's "Archived (n)" disclosure.
//
// A tile nobody has spoken to is DORMANT: the conversation is derived, not
// minted, so it costs nothing until a draft or a turn lands in it. A row
// holding unsent thinking wears a quiet mark, which is how you find your way
// back to what you were part-way through saying.
//
// Icons read the tile's picture AS A PICTURE: `tilePictureCandidates` puts
// `large.image` first because these are rectangles — the hex captures carry
// the gold rim in their pixels and it does not belong inside a square (see
// editor/tile-properties.ts). The square 96px thumbnail pool serves the
// bytes; a miss falls back to the original and asks the optimize phase to
// mint the thumbnail for next time.

import {
  EffectBus, I18N_IOC_KEY, writePortableTileTransfer, type I18nProvider,
} from '@hypercomb/core'
import {
  HIVE_PATH, foldTileConversations, listRailConversations, listTileDrafts,
  newTileConvoId, readConversationSummary, tileConvoId,
  tilePath, tilePathOf,
  type TileConversation,
} from './chat-thread.js'
import {
  conversationGroup, readConversationStandings,
  type ConversationGroup, type ConversationStanding,
} from './chat-threads.js'
import { readBlurbs, type ChatBlurb } from './chat-blurb.js'
import { isLongPressMenu } from '../navigation/browser-menu.js'
import { walkTree, type WalkHistory, type WalkStore } from '../presentation/tiles/tree-walk.js'
import { RAIL_CSS, RAIL_STYLE_ID } from './tiles-rail.css.js'
import { readThumbnail, type ThumbnailStore } from '../presentation/tiles/thumbnails.js'
import { tilePictureCandidates } from '../editor/tile-properties.js'
import type { AgentRegistry } from './agent-registry.service.js'

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** One tile named by the rail: the level it sits on, its label there, and the
 *  rail's own key for it — so a row is recognised again without re-deriving
 *  the join. What the surface calls its SUBJECT. */
export type RailPick = {
  readonly key: string
  readonly path: readonly string[]
  readonly name: string
  /** The tile's layer signature, when the walk could resolve one. */
  readonly sig?: string
  /** WHICH conversation on that tile — a tile can hold several. */
  readonly convoId?: string
}

type RailRow = {
  readonly name: string
  readonly segments: readonly string[]
  readonly childCount: number
  readonly propsSig?: string
  /** The tile's own LAYER signature — what a chosen row contributes to a
   *  request's context. A signature, not a name, is what makes the payload
   *  deterministic: the same choice composes the same bytes forever. */
  readonly sig?: string
}

/** HOW A SURFACE WANTS THE LIST. The rail is the hive's one tile list — the
 *  chat window's sidebar and the notes panel's tile picker are the same rows,
 *  the same pictures, the same collapse-by-name, the same search box — but
 *  they are not the same JOB, so the parts that are about CHATS are optional.
 *
 *  Defaults are the chat window's, so the surface that has always mounted the
 *  rail keeps mounting it unchanged. */
export type RailProfile = {
  /** Can the list move? False keeps it on ONE level: no hold-to-enter, no
   *  back, no right-click out. A surface whose rows must name tiles of ONE
   *  place either turns this off or follows `onLevelChanged` and MOVES with
   *  the list — what the notes desk does, so a row it walks to is a tile it
   *  can honestly write on. Off with no follower, the rows would name cells at
   *  a level the surface is not standing at. */
  readonly walk?: boolean
  /** Chat furniture: the › that unfolds a tile's conversations, the spoken /
   *  unread / draft marks, the live-agent count. */
  readonly chats?: boolean
  /** Ctrl-click to gather a row as context, and drag a row out as a
   *  reference. Off for a surface that has nothing to gather into. */
  readonly choose?: boolean
  /** The number at the end of a row. Default: agents at work on the tile.
   *  The notes panel counts what is written on it instead. */
  readonly badge?: (row: { readonly name: string; readonly segments: readonly string[] }) => number
  /** Rows the surface will not list at all — the notes panel drops tiles the
   *  page's own filter has narrowed away. */
  readonly admits?: (row: { readonly name: string; readonly segments: readonly string[] }) => boolean
  /** A match the NAME does not make. The notes panel's find box searches what
   *  is written on a tile as well as what it is called. */
  readonly matches?: (row: { readonly name: string; readonly segments: readonly string[] }, query: string) => boolean
  /** The pointer entering (event) or leaving (null) a row. The notes panel
   *  peeks at what is written on the tile under the pointer. */
  readonly onHover?: (row: { readonly name: string; readonly segments: readonly string[] }, event: PointerEvent | null) => void
  /** A SECOND CHORD FOR THE SAME ROW: ctrl/meta/shift-click and Space call
   *  this instead of gathering the row as context, and return. For a surface
   *  whose rows are not context but MEMBERS of something it edits together
   *  (the tile editor's group). Without it the chord keeps the meaning
   *  `choose` gives it, and with `choose` off it is an ordinary open. */
  readonly toggle?: (row: { readonly name: string; readonly segments: readonly string[] }) => void
  /** What a row READS as. The row's name is the tile's ADDRESS, and a tile
   *  that was given a name in this language reads as that name everywhere
   *  else — a list that drew only the address would never show a rename. The
   *  address stays in the row's tooltip, and the find box matches both. */
  readonly labelOf?: (row: { readonly name: string; readonly segments: readonly string[] }) => string
  /** What the search box says it does. */
  readonly findLabel?: string
  /** What a click on a row does, for the row's tooltip. */
  readonly clickLabel?: string
  /** The head names the layer. The chat window's header is that name, so the
   *  chat passes false: this band stays the word hive, and its mark climbs
   *  back when you are inside a layer. */
  readonly title?: boolean
}

const PROFILE_DEFAULTS: Required<Pick<RailProfile, 'walk' | 'chats' | 'choose'>> =
  { walk: true, chats: true, choose: true }

type RailStore = WalkStore & ThumbnailStore

/** A conversation belongs to the layer in hand when it IS that layer, or it
 *  sits on that layer. A deeper tile's threads appear after you go inside. */
const conversationOnLayer = (path: string, here: readonly string[]): boolean => {
  const layer = '/' + here.map(part => String(part ?? '').trim()).filter(Boolean).join('/')
  if (path === layer) return true
  const cut = path.lastIndexOf('/')
  const parent = cut <= 0 ? '/' : path.slice(0, cut)
  return parent === layer
}

/** Enough for any real page; a level larger than this is truncated silently
 *  rather than hanging the rail — the canvas behind it still shows it all. */
const MAX_ROWS = 500

/** How long a burst of landing turns is gathered before the list is folded.
 *  Long enough that a drain delivering several replies is one repaint, short
 *  enough that a reply you are watching for appears as it lands. */
const CHAT_SETTLE_MS = 180

/** Past this many changed threads in one burst, a single walk of the pool is
 *  cheaper than reading each bucket — so take the walk. */
const CHAT_MERGE_CAP = 12

const pathKey = (segments: readonly string[]): string => segments.join('\u0000')

/** The inverse of {@link pathKey} — a row's own key back to its segments, so
 *  the separator is written down exactly once. */
const keySegments = (key: string): string[] => key.split('\u0000').filter(Boolean)

/** THE HIVE ITSELF, at the top of every level. Its key is the ROOT's key —
 *  `pathKey([])` — because that is what it is: the location every tile hangs
 *  under, holding the conversations that are about no single tile. A tile can
 *  never claim it (a tile has at least one segment). */
const HIVE_KEY = ''

/** Which chat you were last in, per tile. */
const STICKY_KEY = 'hc:rail-chat'

/** THE RAIL'S GLYPHS, lowercase so scripts/icon-names.cjs ships each one.
 *  Arrows walk (in, back); the hive's mark is home; search opens the field. */
const walkIcon = 'arrow_forward'
const backIcon = 'arrow_back'
const rootIcon = 'hive'
const findIcon = 'search'
const convosIcon = 'forum'

/** A glyph as the shell draws one: the ligature in a .mat-sym span. */
const glyphSpan = (name: string): HTMLSpanElement => {
  const span = document.createElement('span')
  span.className = 'mat-sym'
  span.setAttribute('aria-hidden', 'true')
  span.textContent = name
  return span
}

/** What a dragged row carries. Shared with the chat window's header boxes —
 *  the shell may not import this module, so the CONTRACT is the mime type and
 *  the JSON shape, not a type. */
export const TILE_DRAG_TYPE = 'application/x-hypercomb-tile'

const STYLE_ID = RAIL_STYLE_ID

/** Who a conversation waits on, as the list groups it. */
type ConvoGroup = ConversationGroup

/** A conversation's standing as an icon. Every name is in the shipped subset. */
const CONVO_ICONS = { waiting: 'help', open: 'pending', done: 'check_circle', asked: 'hourglass_empty', filed: 'archive' } as const

/** What a conversation's organized workflow says, as the list reads it. */
type ConvoStanding = ConversationStanding


/** Install or REFRESH the sheet.
 *
 *  It used to return the moment the element existed, which is correct once
 *  per page and wrong every time this module is replaced under a running
 *  page: the new code paints new class names against the old stylesheet, so a
 *  rule added here silently does nothing until a hard reload — and what you
 *  see instead is an unstyled control, which reads as a bug in the control.
 *  Writing the current text is idempotent and costs a string compare. */
const ensureRailStyles = (): void => {
  const held = document.getElementById(STYLE_ID)
  if (held?.textContent === RAIL_CSS) return
  const style = held ?? document.createElement('style')
  style.id = STYLE_ID
  style.textContent = RAIL_CSS
  if (!style.isConnected) document.head.appendChild(style)
}

export class AgentTilesRail {
  readonly #profile: RailProfile & Required<Pick<RailProfile, 'walk' | 'chats' | 'choose'>>

  constructor(profile: RailProfile = {}) {
    this.#profile = { ...PROFILE_DEFAULTS, ...profile }
  }

  #host: HTMLElement | null = null
  #back: HTMLButtonElement | null = null
  #title: HTMLSpanElement | null = null
  #find: HTMLInputElement | null = null
  #findToggle: HTMLButtonElement | null = null
  #head: HTMLDivElement | null = null
  /** The search field stands in the title's place while this is on. */
  #finding = false
  #list: HTMLDivElement | null = null
  /** What the search box holds — a filter over THIS level's names, kept
   *  across re-mounts like the trail, dropped whenever the level changes. */
  #query = ''
  /** The trail of levels, root first; the last entry is what the list shows. */
  #trail: string[][] = [[]]
  /** Levels already walked — "back" repaints instantly, then refreshes. */
  readonly #levels = new Map<string, RailRow[]>()
  /** Where each level was scrolled when it was left by drilling in, so
   *  coming back out lands on the rows you went in from — not the top of a
   *  long list you would have to scroll down again every trip. */
  readonly #scrolls = new Map<string, number>()
  /** The level being returned to and the row it was left through, until a
   *  render of that level with rows puts the list back where it was. */
  #returning: { level: string; out: string } | null = null
  /** The row just come out of — where ← lands the keyboard, so the focus
   *  does not drag the restored list back to its first row. */
  #cameOutOf: HTMLElement | null = null
  /** propsSig → object URL (null: looked, no picture to be had). */
  readonly #icons = new Map<string, string | null>()
  /** propsSig being read → the icon elements waiting on it. */
  readonly #waiters = new Map<string, Set<HTMLElement>>()
  /** The row you are IN — the conversation everything typed belongs to. */
  #subject: RailPick | null = null
  /** Rows the SURFACE marks as chosen without the rail having been asked —
   *  the tile editor's group, which the editor decides (it can refuse a
   *  toggle) and the rail only shows. Drawn exactly as a chosen row. */
  readonly #marked = new Set<string>()
  /** The row a refused name collided with (a path key), or null. */
  #sibling: string | null = null
  /** Rows CHOSEN as context, by row key. Survives walking levels on purpose:
   *  gathering is the whole point, and a set that emptied every time you went
   *  inside a tile could never span a hive. */
  readonly #chosen = new Map<string, RailPick>()
  /** WHAT A ROW HAS TO SAY, gathered from three places that do not know about
   *  each other: the drafts pool (yours, unsent), the threads pool (a
   *  conversation exists, and whether its newest turn has been read), and the
   *  chat window's own announcement that a question is out right now. The
   *  rail owns none of these facts — it hears them and paints them. */
  #drafts = new Set<string>()
  /** Every tile conversation, and the per-tile fold the row marks read. */
  #chatList: TileConversation[] = []
  /** Conversations a turn has landed in since the last merge, and the timer
   *  that folds them in together. */
  #chatDirty = new Set<string>()
  #chatSettle: ReturnType<typeof setTimeout> | null = null
  #chats = new Map<string, { turns: number; unread: boolean; chats: number; lastAt: number }>()
  #busy = new Set<string>()
  /** Row keys whose chat list is unfolded. */
  readonly #expanded = new Set<string>()
  /** Tile paths in the context set that is ACTIVE RIGHT NOW. Rows in it are
   *  drawn as one thing — a set asked about together should look like a set,
   *  not like several tiles that happen to be lit. Membership says nothing
   *  about a tile's own conversations: it can be in three sets and still have
   *  a solo chat about nothing but itself. */
  #grouped = new Set<string>()
  /** The level changed from the keyboard: put focus on the level that
   *  arrives, or the keyboard is stranded on a row that no longer exists. */
  #focusFirstRow = false
  #registry: AgentRegistry | undefined
  /** Folds whose ARCHIVE is showing, by row key. Not persisted: putting a
   *  conversation away is durable, wanting to look at what you put away is
   *  a thing you are doing right now. */
  #archiveOpen = new Set<string>()
  /** Guards stale walks: only the newest load may touch the list. */
  #epoch = 0
  #disposed = false
  /** The trail seeds from the participant's location once — a RE-mount (the
   *  panel swapping subjects rebuilds its DOM) keeps the trail as it stood. */
  #seeded = false

  /** The surface listens here to follow the participant into a conversation. */
  onSubjectChanged: (subject: RailPick | null) => void = () => {}

  /** THE LIST MOVED, and here is the level it moved to. Fired only by the
   *  rail's own walk (the ‹ , the ›, → and ←) — never by `showLevel`, which is
   *  the surface telling the rail where it already is and would bounce
   *  straight back. A surface that must AGREE with the level in hand (the
   *  notes desk writes on the tiles of one place) follows this; the chat
   *  window, which walks the hive freely while the participant stays put,
   *  simply leaves it unset. */
  onLevelChanged: (segments: readonly string[]) => void = () => {}

  readonly #onRegistryChange = (): void => this.#paintStatus()
  #dropDraftWatch: (() => void) | null = null
  #dropChatWatch: (() => void) | null = null
  #dropBlurbWatch: (() => void) | null = null
  /** What each conversation turned out to be about, by convoId. DERIVED and
   *  never load-bearing: a row whose blurb is missing, stale or wiped draws
   *  exactly as it did before blurbs existed. */
  #blurbs = new Map<string, ChatBlurb>()
  #dropFlowWatch: (() => void) | null = null
  /** What each conversation's organized workflow says, by convoId — read
   *  from the flows pool, never derived here, and never load-bearing. */
  #standings = new Map<string, ConvoStanding>()
  #standingsEpoch = 0
  /** Is the conversations list's archive shelf showing? Not persisted. */
  #convosArchiveOpen = false
  /** Is the list showing the layer's CONVERSATIONS instead of its tiles?
   *  A tab, not a stack (jwize, 2026-11-12: "too invasive to look at
   *  together") — the head band's icon switches, and carries the count of
   *  conversations waiting on you so nothing is missed while it is shut. */
  #convosTab = false
  #convosToggle: HTMLButtonElement | null = null
  /** Where the tiles were scrolled when the conversations tab opened. */
  #tilesScroll = 0
  /** The conversation the window has open, however it was opened. */
  #openConvo = ''
  #dropBusyWatch: (() => void) | null = null
  #dropGroupWatch: (() => void) | null = null

  /** Tile paths whose conversation is open. Coming back is what shows it. */
  #armed = new Set<string>()

  /** The tile whose conversation is open, or null before anything is chosen. */
  get subject(): RailPick | null { return this.#subject }

  /** The layer the list is standing on. The chat header names this place. */
  here(): readonly string[] { return [...this.#here()] }

  /** True once a click or a step inside has opened this tile's conversation. */
  armed(path: string): boolean { return this.#armed.has(path) }

  /** Open the conversation for these segments without announcing it. The
   *  reading pane stays on whatever it was showing. A later press of the same
   *  tile, or coming back out of it, is what puts the conversation in view. */
  visit(segments: readonly string[]): void {
    if (!this.#profile.chats) return
    const path = [...segments].map(part => String(part ?? '').trim()).filter(Boolean)
    const id = tilePath(path)
    const key = pathKey(path)
    const onHive = path.length === 0
    const name = onHive ? this.#t('agent.rail-hive', 'Hypercomb') : path[path.length - 1]!
    const parent = path.slice(0, -1)
    const row = onHive
      ? undefined
      : (this.#levels.get(pathKey(parent)) ?? []).find(candidate => pathKey(candidate.segments) === key)
    const convoId = this.#stickyChat(id) || tileConvoId(path)
    this.#rememberChat(id, convoId)
    this.#armed.add(id)
    this.#subject = { key, path: parent, name, sig: row?.sig, convoId }
    this.#markCurrent(this.#rowFor(key))
  }

  /** The conversation a visit opened for these segments, or null. Sets it as
   *  the subject so the row lights when the level draws it. */
  recall(segments: readonly string[]): RailPick | null {
    if (!this.#profile.chats) return null
    const path = [...segments].map(part => String(part ?? '').trim()).filter(Boolean)
    const id = tilePath(path)
    if (!this.#armed.has(id)) return null
    const key = pathKey(path)
    const name = path[path.length - 1] ?? this.#t('agent.rail-hive', 'Hypercomb')
    const parent = path.slice(0, -1)
    const row = (this.#levels.get(pathKey(parent)) ?? []).find(candidate => pathKey(candidate.segments) === key)
    const pick: RailPick = this.#subject && tilePath([...this.#subject.path, this.#subject.name]) === id
      ? this.#subject
      : { key, path: parent, name, sig: row?.sig, convoId: this.#stickyChat(id) || tileConvoId(path) }
    this.#subject = pick
    this.#markCurrent(this.#rowFor(key))
    return pick
  }

  /** The tiles chosen as context, in the order they were chosen. */
  get selection(): RailPick[] { return [...this.#chosen.values()] }

  /** The signatures those tiles resolve to — the deterministic payload a
   *  request carries. Order-preserving and duplicate-free; a row whose sig the
   *  walk could not resolve contributes nothing rather than a guess. */
  get selectionSigs(): string[] {
    return [...new Set(this.selection.map(pick => pick.sig).filter((sig): sig is string => !!sig))]
  }

  /** The surface listens here to show what the next request will carry. */
  onSelectionChanged: (selection: RailPick[]) => void = () => {}

  /** Let go of every chosen tile — Escape's first stop, before the subject. */
  clearSelection(): void {
    if (!this.#chosen.size) return
    this.#chosen.clear()
    for (const row of this.#list?.querySelectorAll('.hc-rail-row.chosen') ?? []) {
      row.classList.remove('chosen')
      row.querySelector('.hc-rail-main')?.setAttribute('aria-pressed', 'false')
    }
    this.onSelectionChanged([])
  }

  /** What an ask sent from this surface works on. One tile: the one you are
   *  talking to. Kept as a list because that is the shape every caller and
   *  the ask protocol already speak. */
  get applied(): RailPick[] { return this.#subject ? [this.#subject] : [] }

  #t(key: string, fallback: string): string {
    const value = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key)
    return value && value !== key ? value : fallback
  }

  mount(host: HTMLElement): void {
    ensureRailStyles()
    this.#host = host
    host.textContent = ''

    const head = document.createElement('div')
    head.className = 'hc-rail-head'
    const back = document.createElement('button')
    back.type = 'button'
    back.className = 'hc-rail-back'
    back.hidden = !this.#profile.walk
    back.addEventListener('click', () => this.#up())
    const title = document.createElement('span')
    title.className = 'hc-rail-title'
    this.#back = back
    this.#title = title
    this.#head = head

    // ONE BAND (jwize, 2026-10-01: "minimal"): the way back, where you are,
    // and search as an icon that opens the field in the title's place — the
    // rail's head is the window header's height, so the two share one line.
    // Search filters the level in the hand — no walk, no wait — and Escape
    // empties it, then closes it, before the escape cascade sees the key.
    const find = document.createElement('div')
    find.className = 'hc-rail-find'
    const search = document.createElement('input')
    search.type = 'search'
    search.value = this.#query
    search.autocomplete = 'off'
    search.spellcheck = false
    // Escape here clears, then closes the field — never the window round it.
    search.setAttribute('data-escape-local', '')
    const findLabel = this.#profile.findLabel ?? this.#t('agent.rail-find', 'Search this level')
    search.placeholder = findLabel
    search.setAttribute('aria-label', findLabel)
    search.addEventListener('input', () => this.#setQuery(search.value))
    search.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.preventDefault()
      if (this.#query || search.value) this.#setQuery('')
      else this.#setFinding(false)
    })
    search.addEventListener('blur', () => { if (!search.value.trim()) this.#setFinding(false) })
    find.appendChild(search)
    this.#find = search

    const findToggle = document.createElement('button')
    findToggle.type = 'button'
    findToggle.className = 'hc-rail-find-toggle'
    findToggle.title = findLabel
    findToggle.setAttribute('aria-label', findLabel)
    findToggle.append(glyphSpan(findIcon))
    findToggle.addEventListener('click', () => this.#setFinding(!this.#finding || !!this.#query))
    this.#findToggle = findToggle
    head.append(back, title, find)
    if (this.#profile.chats) {
      const convosToggle = document.createElement('button')
      convosToggle.type = 'button'
      convosToggle.className = 'hc-rail-convos-toggle'
      const badge = document.createElement('span')
      badge.className = 'hc-rail-convos-badge'
      badge.hidden = true
      convosToggle.append(glyphSpan(convosIcon), badge)
      convosToggle.addEventListener('click', () => this.#setConvosTab(!this.#convosTab))
      this.#convosToggle = convosToggle
      head.append(convosToggle)
    } else {
      this.#convosToggle = null
    }
    head.append(findToggle)
    this.#setFinding(!!this.#query)

    const list = document.createElement('div')
    list.className = 'hc-rail-list'
    list.setAttribute('role', 'list')
    this.#list = list

    host.append(head, list)

    // Open on the level the participant is standing on, with the whole way
    // up already in the trail — back climbs toward the root from move one.
    if (!this.#seeded) {
      this.#seeded = true
      const lineage = ioc<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
      const here = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '')).filter(Boolean)
      this.#trail = [[]]
      for (let i = 1; i <= here.length; i++) this.#trail.push(here.slice(0, i))
    }

    // RIGHT-CLICK COMES OUT. The way back is the cheapest gesture in the
    // list because it is the one made most: the ‹ is still there for a mouse
    // that would rather aim, and this is the same move without the aiming.
    if (this.#profile.walk) {
      host.addEventListener('contextmenu', event => {
        // A held finger (holding a row) is the browser's long-press, never
        // the walk back up.
        if (isLongPressMenu(event)) return
        // At the ROOT there is nothing to go back to: leave the gesture
        // alone so whoever owns the surface (BackGesture) can back out.
        if (this.#trail.length <= 1) return
        event.preventDefault()
        this.#up()
      })
    }

    this.#registry = ioc<AgentRegistry>('@diamondcoreprocessor.com/AgentRegistry')
    this.#registry?.removeEventListener('change', this.#onRegistryChange)
    this.#registry?.addEventListener('change', this.#onRegistryChange)

    // The marks follow the pool, not this surface: a draft written from the
    // composer, from another window, or by a sweep shows up here the same way.
    this.#dropDraftWatch?.()
    this.#dropChatWatch?.()
    this.#dropBlurbWatch?.()
    this.#dropFlowWatch?.()
    if (this.#profile.chats) {
      this.#dropDraftWatch = EffectBus.on('chat:drafts-changed', () => { void this.#refreshDrafts() })
      this.#dropChatWatch = EffectBus.on<{ convoId?: string }>(
        'chat:threads-changed', payload => { void this.#chatChanged(String(payload?.convoId ?? '')) })
      // The label follows the POOL, not this surface: a blurb minted by the
      // orchestrator while the rail is open shows up without a reopen.
      this.#dropBlurbWatch = EffectBus.on('chat:blurbs-changed', () => { void this.#refreshBlurbs() })
      // A conversation's workflow is written in the background; its row follows.
      this.#dropFlowWatch = EffectBus.on('chat:route-flow-changed', () => { void this.#refreshStandings() })
    }
    this.#dropGroupWatch?.()
    this.#dropGroupWatch = EffectBus.on<{ paths?: readonly string[] }>('context:active-set', payload => {
      this.#grouped = new Set((payload?.paths ?? []).map(String))
      this.#paintStatus()
    })
    this.#dropBusyWatch?.()
    this.#dropBusyWatch = EffectBus.on<{ path?: string; busy?: boolean }>('chat:tile-busy', payload => {
      const path = String(payload?.path ?? '')
      if (!path) return
      if (payload?.busy) this.#busy.add(path)
      else this.#busy.delete(path)
      this.#paintStatus()
    })
    if (this.#profile.chats) {
      void this.#refreshDrafts()
      void this.#refreshChats()
    }

    void this.#load(0)
  }

  /** Re-read the level in hand. The surface calls this when the hive moves
   *  under it (`synchronize`) — the rows repaint from the fresh walk, and the
   *  cached shape holds the list steady in the meantime. */
  refresh(): void {
    if (!this.#host) return
    void this.#load(0)
  }

  /** Repaint the level in hand from what is already resolved — no walk, no
   *  wait. For when the SURFACE's facts moved rather than the hive's: a note
   *  was written (the badge counts notes), the page's filter narrowed what the
   *  list may show. */
  paint(): void {
    if (!this.#host) return
    this.#renderLevel(this.#here(), this.#levels.get(pathKey(this.#here())) ?? null, 0)
  }

  /** Put the list ON a level, dropping the trail behind it. What a surface
   *  bound to the participant's location (the notes panel writes on the tiles
   *  of ONE place) calls when the location changes. */
  showLevel(segments: readonly string[]): void {
    const path = [...segments].map(s => String(s ?? '')).filter(Boolean)
    this.#seeded = true
    if (pathKey(path) === pathKey(this.#here())) { this.refresh(); return }
    this.#query = ''
    if (this.#find) this.#find.value = ''
    this.#trail = [[]]
    for (let i = 1; i <= path.length; i++) this.#trail.push(path.slice(0, i))
    void this.#load(0)
  }

  /** Light the row for `name` on the level in hand WITHOUT announcing it —
   *  the surface already knows (the tile was clicked on the canvas). Silent
   *  on purpose: announcing would bounce straight back as another change. */
  showCurrent(name: string | null, level?: readonly string[]): void {
    if (!name) { this.#subject = null; this.#markCurrent(null); return }
    // With a `level` the tile may be on a level the list is not showing (the
    // editor moved to a tile somewhere else in the hive): the subject is set
    // FIRST so the level that arrives draws the row already lit.
    const path = level ? [...level].map(s => String(s ?? '')).filter(Boolean) : [...this.#here()]
    const segments = [...path, name]
    const key = pathKey(segments)
    if (this.#subject?.key !== key) this.#subject = { key, path, name }
    if (level && pathKey(path) !== pathKey(this.#here())) { this.showLevel(path); return }
    this.#markCurrent(this.#rowFor(key))
  }

  /** Mark exactly these tiles as chosen WITHOUT announcing it — the surface
   *  decides which tiles are chosen (the editor's group can refuse a toggle),
   *  and a rail that kept its own count would drift from it. Paths are full
   *  tile paths; marks survive walking levels, like the rail's own picks. */
  showSelection(paths: readonly (readonly string[])[]): void {
    this.#marked.clear()
    for (const path of paths) this.#marked.add(pathKey(path))
    for (const row of this.#list?.querySelectorAll<HTMLElement>('.hc-rail-row') ?? []) {
      const on = this.#isChosen(row.dataset['key'] ?? '')
      row.classList.toggle('chosen', on)
      row.querySelector('.hc-rail-main')?.setAttribute('aria-pressed', on ? 'true' : 'false')
    }
  }

  /** Quietly outline the row at `segments` (full tile path) with the words
   *  "same name" — the tile a refused name collided with. `null` clears it.
   *  Silent: nothing is announced. The mark survives a repaint and a walk. */
  markSibling(segments: readonly string[] | null): void {
    this.#sibling = segments && segments.length ? pathKey(segments) : null
    for (const wrap of this.#list?.querySelectorAll<HTMLElement>('.hc-rail-row') ?? []) {
      this.#paintSibling(wrap, wrap.dataset['key'] ?? '')
    }
  }

  #paintSibling(wrap: HTMLElement, key: string): void {
    const on = this.#sibling !== null && key === this.#sibling
    wrap.classList.toggle('sibling', on)
    const main = wrap.querySelector('.hc-rail-main')
    const word = wrap.querySelector('.hc-rail-same')
    if (!on) { word?.remove(); return }
    if (word || !main) return
    const same = document.createElement('span')
    same.className = 'hc-rail-same'
    same.textContent = this.#t('editor.same-name', 'same name')
    main.querySelector('.hc-rail-name')?.after(same)
  }

  /** Chosen by the rail's own gesture, or marked by the surface. */
  #isChosen(key: string): boolean {
    return this.#chosen.has(key) || this.#marked.has(key)
  }

  /** Light the conversation the window has open WITHOUT announcing it — the
  *  window opened it (from the list, a tile, a command) and already knows. */
  showConversation(convoId: string): void {
    const id = String(convoId ?? '')
    if (id === this.#openConvo) return
    this.#openConvo = id
    this.#repaintConvos()
  }

  /** Re-read every row's badge from the surface, in place. */
  #paintBadges(): void {
    const list = this.#list
    if (!list) return
    const badge = this.#profile.badge
    if (!badge) return
    for (const row of list.querySelectorAll<HTMLElement>('.hc-rail-row')) {
      const segments = keySegments(row.dataset['key'] ?? '')
      const name = segments[segments.length - 1] ?? ''
      const count = badge({ name, segments })
      const slot = row.querySelector<HTMLElement>('.hc-rail-bees')
      if (!slot) continue
      slot.textContent = String(count)
      slot.hidden = count === 0
    }
  }

  /** ANOTHER CONVERSATION ON THE TILE YOU ARE IN. The composer's own "new
   *  chat" press lands here rather than minting a free-floating thread: a
   *  conversation about a tile belongs UNDER that tile, where it can be found
   *  again, and the rail is the only place that list lives. Unfolds the tile
   *  so the new row is seen being made. Returns false when there is no tile
   *  in hand — then a free chat is the honest answer and the caller mints it.
   */
  newChatOnSubject(): boolean {
    if (!this.#profile.chats) return false
    const subject = this.#subject
    // No tile in hand — or the hive itself is what you are in: the new
    // conversation is a GLOBAL one, and it lists under the hive's own row.
    const onHive = !subject || subject.key === HIVE_KEY
    const segments = onHive ? [] : [...subject.path, subject.name]
    const key = onHive ? HIVE_KEY : subject.key
    const path = tilePath(segments)
    const row: RailRow = {
      name: onHive ? this.#t('agent.rail-hive', 'Hypercomb') : subject.name,
      segments,
      childCount: 0,
      sig: onHive ? undefined : subject.sig,
    }
    const held = this.#chatsFor(path)
    const convoId = held.length ? newTileConvoId(segments) : tileConvoId(segments)
    this.#expanded.add(key)
    this.#enterChat(row, key, convoId)
    this.#renderLevel(this.#here(), this.#levels.get(pathKey(this.#here())) ?? null, 0)
    return true
  }

  /** Leave the conversation without entering another — Escape's first stop. */
  clearSubject(): void {
    if (!this.#subject) return
    this.#subject = null
    this.#markCurrent(null)
    this.onSubjectChanged(null)
  }

  dispose(): void {
    this.#disposed = true
    if (this.#chatSettle) { clearTimeout(this.#chatSettle); this.#chatSettle = null }
    this.#dropDraftWatch?.()
    this.#dropDraftWatch = null
    this.#dropChatWatch?.()
    this.#dropChatWatch = null
    this.#dropBlurbWatch?.()
    this.#dropBlurbWatch = null
    this.#dropFlowWatch?.()
    this.#dropFlowWatch = null
    this.#dropBusyWatch?.()
    this.#dropBusyWatch = null
    this.#dropGroupWatch?.()
    this.#dropGroupWatch = null
    this.#registry?.removeEventListener('change', this.#onRegistryChange)
    for (const url of this.#icons.values()) {
      if (url) { try { URL.revokeObjectURL(url) } catch { /* already gone */ } }
    }
    this.#icons.clear()
    this.#waiters.clear()
    this.#levels.clear()
    this.#subject = null
    this.#chosen.clear()
    this.#host = null
    this.#list = null
    this.#find = null
  }

  // ── levels ──────────────────────────────────────────────────────────

  #here(): string[] { return this.#trail[this.#trail.length - 1] }

  #drill(segments: readonly string[]): void {
    this.#descend([segments])
  }

  /** Walk these levels in order. Each one is armed on the way through. The
   *  reading pane stays put until the way back. */
  #descend(levels: readonly (readonly string[])[]): void {
    if (!this.#profile.walk || !levels.length) return
    if (this.#list) this.#scrolls.set(pathKey(this.#here()), this.#list.scrollTop)
    this.#returning = null
    this.#query = ''
    if (this.#find) this.#find.value = ''
    for (const segments of levels) {
      const path = [...segments]
      const row = (this.#levels.get(pathKey(path.slice(0, -1))) ?? [])
        .find(candidate => pathKey(candidate.segments) === pathKey(path))
      this.visit(row?.segments ?? path)
      this.#trail.push(path)
    }
    this.onLevelChanged(this.#here())
    void this.#load(1)
  }

  #up(): void {
    if (!this.#profile.walk || this.#trail.length <= 1) return
    const left = [...this.#here()]
    this.#query = ''
    if (this.#find) this.#find.value = ''
    this.#trail.pop()
    this.#returning = { level: pathKey(this.#here()), out: pathKey(left) }
    this.onLevelChanged(this.#here())
    const pick = this.recall(left)
    if (pick && pick.convoId !== this.#openConvo) this.onSubjectChanged(pick)
    void this.#load(-1)
  }

  /** Open or close the search field in the head band. A standing query keeps
   *  it open: the filter is never hidden while it is narrowing the list. */
  #setFinding(on: boolean): void {
    const open = on || !!this.#query
    this.#finding = open
    this.#head?.classList.toggle('finding', open)
    this.#findToggle?.setAttribute('aria-pressed', open ? 'true' : 'false')
    if (on && this.#find && document.activeElement !== this.#find) queueMicrotask(() => this.#find?.focus())
  }

  /** Repaint the level in hand through the new filter — the rows are already
   *  resolved, so searching never re-walks and never waits. */
  #setQuery(raw: string): void {
    const query = raw.trim()
    if (query === this.#query) return
    this.#query = query
    if (this.#find && this.#find.value !== raw) this.#find.value = raw
    this.#renderLevel(this.#here(), this.#levels.get(pathKey(this.#here())) ?? null, 0)
  }

  /** The rows a query leaves standing — plain case-insensitive containment,
   *  which is what a name filter is expected to do. */
  #matching(rows: RailRow[]): RailRow[] {
    const admits = this.#profile.admits
    const listed = admits ? rows.filter(row => admits(row)) : rows
    if (!this.#query) return listed
    const needle = this.#query.toLowerCase()
    const also = this.#profile.matches
    return listed.filter(row =>
      row.name.toLowerCase().includes(needle)
      || this.#readingOf(row).toLowerCase().includes(needle)
      || this.#blurbMatches(row, needle)
      || (also ? also(row, this.#query) : false))
  }

  /** What a row reads as: the surface's reading, or the address. */
  #readingOf(row: RailRow): string {
    const label = this.#profile.labelOf?.(row)
    return label && label.trim() ? label : row.name
  }

  /** Does anything said on this tile match? A blurb is written down, so the
   *  filter can reach INTO the conversations a tile holds rather than only at
   *  its name — which is the thing a derived-on-open summary could never do,
   *  because it would not exist until you were already looking at the row.
   *  Absent blurbs simply never match; the name filter is unchanged. */
  #blurbMatches(row: RailRow, needle: string): boolean {
    if (!this.#profile.chats || !this.#blurbs.size) return false
    const path = tilePath(row.segments)
    for (const chat of this.#chatList) {
      if (chat.path !== path) continue
      const blurb = this.#blurbs.get(chat.convoId)
      if (!blurb) continue
      if (blurb.line.toLowerCase().includes(needle)) return true
      if (blurb.points.some(point => point.toLowerCase().includes(needle))) return true
    }
    return false
  }

  /** Show a level: the cached shape instantly (else a skeleton), then the
   *  fresh walk when it lands — so back never waits and drift never lasts. */
  async #load(direction: -1 | 0 | 1): Promise<void> {
    const epoch = ++this.#epoch
    const path = this.#here()
    const key = pathKey(path)
    const cached = this.#levels.get(key)
    this.#renderLevel(path, cached ?? null, direction)

    const history = ioc<WalkHistory>('@diamondcoreprocessor.com/HistoryService')
    const store = ioc<RailStore>('@hypercomb.social/Store')
    if (!history || !store) return
    const result = await walkTree({ segments: path }, history, store, { maxDepth: 1, maxNodes: MAX_ROWS })
    if (this.#disposed || epoch !== this.#epoch) return

    const rows: RailRow[] = result.nodes
      .filter(node => node.depth === 1)
      .map(node => ({
        name: node.name,
        segments: node.segments ?? [...path, node.name],
        childCount: node.childCount,
        propsSig: node.propsSig,
        sig: node.sig,
      }))
    this.#levels.set(key, rows)
    // The cached shape was already on screen; repainting an identical level
    // would only flicker it and orphan icons still loading.
    if (cached && JSON.stringify(cached) === JSON.stringify(rows)) return
    this.#renderLevel(path, rows, 0)
  }

  #renderLevel(path: readonly string[], rows: RailRow[] | null, direction: -1 | 0 | 1): void {
    const list = this.#list
    if (!list) return

    if (this.#title) {
      // The chat header names the layer, so this band stays the hive. Every
      // other surface names the layer it is standing on.
      const pinned = this.#profile.title === false
      const hive = this.#t('agent.rail-root', 'hive')
      this.#title.hidden = false
      this.#title.classList.toggle('hive', pinned)
      this.#title.textContent = pinned ? hive : (path[path.length - 1] ?? hive)
      this.#title.title = pinned ? hive : (['', ...path].join(' / ') || '/')
    }
    if (this.#back && this.#profile.walk) {
      // HOME OR BACK, in one place. The chat keeps the hive mark on every
      // layer; clicking it climbs. A surface that names the layer swaps the
      // mark for a back arrow once you are inside.
      const atRoot = this.#trail.length <= 1
      const pinned = this.#profile.title === false
      this.#back.hidden = false
      this.#back.disabled = atRoot
      this.#back.classList.toggle('root', atRoot || pinned)
      this.#back.replaceChildren(glyphSpan(pinned || atRoot ? rootIcon : backIcon))
      const parent = this.#trail[this.#trail.length - 2]
      const label = atRoot ? '' : this.#t('agent.rail-back', 'Back to {name}')
        .replace('{name}', parent?.[parent.length - 1] ?? this.#t('agent.rail-root', 'hive'))
      this.#back.title = label
      if (label) this.#back.setAttribute('aria-label', label)
      else this.#back.removeAttribute('aria-label')
      this.#back.setAttribute('aria-hidden', atRoot ? 'true' : 'false')
    }

    // A repaint of the level already on screen (the fresh walk landing, a
    // synchronize, a filter) keeps its place; a different level starts at
    // the top unless it is the one being returned to.
    const level = pathKey(path)
    const kept = list.dataset['level'] === level ? list.scrollTop : 0
    list.dataset['level'] = level
    list.textContent = ''
    if (direction !== 0) {
      // Restart the slide even when one is mid-flight: none → reflow → set.
      list.style.animation = 'none'
      void list.offsetWidth
      list.style.animation = `${direction > 0 ? 'hcRailIn' : 'hcRailOut'} 0.18s ease`
    }

    // THE CONVERSATIONS for the layer in hand are a TAB, never stacked over
    // the tiles: with it open the list is the conversations and nothing else.
    // A standing search is over tiles, so it shows the tiles.
    this.#paintConvosToggle()
    if (this.#profile.chats && this.#convosTab && !this.#query) {
      list.appendChild(this.#convosSection())
      this.#returning = null
      list.scrollTop = kept
      return
    }

    // THE HIVE ITSELF, first and always. Every tile can hold a conversation
    // and the hive could not — the one place with nothing to hang a global
    // question on. It sits above the level whatever level you are on, so
    // "ask about the whole thing" is never somewhere else. Hidden only while
    // the find box is narrowing the list: it is not one of the matches.
    if (this.#profile.chats && !this.#query) list.appendChild(this.#hiveGroup())

    if (rows === null) {
      for (let i = 0; i < 4; i++) {
        const skeleton = document.createElement('div')
        skeleton.className = 'hc-rail-skel'
        skeleton.style.animationDelay = `${i * 0.09}s`
        list.appendChild(skeleton)
      }
      list.scrollTop = 0
      return
    }

    if (!rows.length) {
      const empty = document.createElement('div')
      empty.className = 'hc-rail-empty'
      empty.textContent = this.#t('agent.rail-empty', 'Nothing inside this tile yet.')
      list.appendChild(empty)
      this.#settleScroll(list, level, kept)
      this.#landFocus()
      return
    }

    const visible = this.#matching(rows)
    if (!visible.length) {
      const empty = document.createElement('div')
      empty.className = 'hc-rail-empty'
      // A find box with nothing standing says so; a level narrowed to nothing
      // by the surface itself is simply empty.
      empty.textContent = this.#query
        ? this.#t('agent.rail-no-match', 'No tile here matches “{query}”.').replace('{query}', this.#query)
        : this.#t('agent.rail-empty', 'Nothing inside this tile yet.')
      list.appendChild(empty)
      this.#settleScroll(list, level, kept)
      this.#landFocus()
      return
    }

    const counts = this.#agentCounts()
    for (const row of visible) {
      const talkHint = this.#profile.clickLabel
        ?? (this.#profile.chats
          ? this.#t('agent.rail-into', 'Move into {name}').replace('{name}', row.name)
          : this.#t('agent.rail-talk', 'Talk to this tile'))
      const key = pathKey(row.segments)
      const current = this.#subject?.key === key
      const wrap = document.createElement('div')
      wrap.className = 'hc-rail-row'
      wrap.dataset['key'] = key
      wrap.setAttribute('role', 'listitem')
      wrap.classList.toggle('current', current)
      wrap.classList.toggle('chosen', this.#isChosen(key))

      const main = document.createElement('button')
      main.type = 'button'
      main.className = 'hc-rail-main'
      main.title = talkHint
      // The conversation you are in, said to a screen reader as well as to
      // the eye — `current` is only a background colour.
      if (current) main.setAttribute('aria-current', 'true')
      // Chosen is a TOGGLE, and a toggle says so: aria-pressed is the whole
      // difference between "this row is lit" and "this row is switched on".
      main.setAttribute('aria-pressed', this.#isChosen(key) ? 'true' : 'false')

      // WHAT THE ROW READS AS: the surface's reading of the tile (its name in
      // this language) when it has one, otherwise the address. The address
      // stays reachable in the tooltip.
      const reading = this.#readingOf(row)
      if (reading !== row.name) main.title = `${talkHint} — ${row.name}`

      const icon = document.createElement('span')
      icon.className = 'hc-rail-icon'
      icon.textContent = [...reading.trim()][0]?.toUpperCase() ?? '·'
      if (row.propsSig) this.#settleIcon(icon, row.propsSig)

      const name = document.createElement('span')
      name.className = 'hc-rail-name'
      name.textContent = reading

      // HOW MANY CONVERSATIONS THIS TILE HOLDS, beside the thing they are
      // about. Now that the line IS the conversation control, "which one am
      // I about to land in?" is a fair question to have on the row — and a
      // tile is a SUBJECT, so several threads about it is the normal case,
      // not an oddity you should have to unfold the tile to discover.
      //
      // The gutter tick says the tile has been SPOKEN TO and how deep; this
      // says in how many separate places. Archived threads are not counted:
      // they are not in the fold either, so a row promising four and listing
      // three would be lying about the same set.
      const threads = document.createElement('span')
      threads.className = 'hc-rail-threads'
      threads.hidden = true

      // The number at the end of the row: agents at work by default, or
      // whatever the surface counts (the notes panel counts notes).
      const bees = document.createElement('span')
      bees.className = 'hc-rail-bees'
      const busy = this.#profile.badge ? this.#profile.badge(row) : (counts.get(key) ?? 0)
      bees.textContent = String(busy)
      bees.hidden = busy === 0

      main.append(icon, name, threads, bees)

      // THE ROW MOVES TO THIS LAYER. The arrow moves to its child. A surface
      // without chats still picks the tile. Ctrl-click only gathers context.
      main.addEventListener('click', event => {
        // The surface's own chord first: a row that is a MEMBER (the editor's
        // group) rather than context takes ctrl, meta and shift alike.
        if ((event.ctrlKey || event.metaKey || event.shiftKey) && this.#profile.toggle) {
          event.preventDefault()
          this.#profile.toggle(row)
          return
        }
        if ((event.ctrlKey || event.metaKey) && this.#profile.choose) {
          this.#toggleChosen(wrap, key, row)
          return
        }
        if (this.#profile.chats && this.#profile.walk) { this.#drill(row.segments); return }
        if (current && this.#expanded.has(key)) { this.#toggleChats(key, row); return }
        this.#enter(wrap, key, row)
      })

      // THE SAME MOVES, FROM THE KEYBOARD. → drills one layer, ← comes back
      // out, ↑↓ move between rows, and Enter (the button's own default) is
      // the click that moves into the layer.
      main.addEventListener('keydown', event => {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        if (event.key === 'ArrowRight') {
          if (row.childCount === 0 || !this.#profile.walk) return
          event.preventDefault()
          this.#focusFirstRow = true
          this.#drill(row.segments)
        } else if (event.key === 'ArrowLeft') {
          if (this.#trail.length <= 1 || !this.#profile.walk) return
          event.preventDefault()
          this.#focusFirstRow = true
          this.#up()
        } else if (event.key === ' ' || event.key === 'Spacebar') {
          // The keyboard's ctrl-click. Enter still opens the conversation.
          if (this.#profile.toggle) {
            event.preventDefault()
            this.#profile.toggle(row)
            return
          }
          if (!this.#profile.choose) return
          event.preventDefault()
          this.#toggleChosen(wrap, key, row)
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          this.#step(wrap, event.key === 'ArrowDown' ? 1 : -1)
        }
      })

      const hover = this.#profile.onHover
      if (hover) {
        main.addEventListener('pointerenter', event => hover(row, event))
        main.addEventListener('pointerleave', () => hover(row, null))
      }

      // A ROW IS DRAGGABLE, because the header's boxes are where a request is
      // composed and dragging is how you fill them. What travels is the tile's
      // SIGNATURE plus enough to name it on screen — never a live object, so
      // the drop is the same whether it lands now or after a reload.
      main.draggable = this.#profile.choose
      main.addEventListener('dragstart', event => {
        // The PICTURE's address rides too: a reference is drawn as the tile's
        // own square, and the surface that draws it cannot walk the hive to
        // find one.
        const payload = JSON.stringify({
          name: row.name,
          path: tilePath(row.segments),
          sig: row.sig ?? '',
          propsSig: row.propsSig ?? '',
        })
        if (event.dataTransfer) {
          const wrotePortable = writePortableTileTransfer(event.dataTransfer, {
            name: row.name,
            path: tilePath(row.segments),
            sig: row.sig ?? '',
            propsSig: row.propsSig ?? '',
          })
          // A cold row can briefly be sig-less. Keep the local-path transfer
          // alive until its signature resolves and the tile becomes portable.
          if (!wrotePortable) {
            event.dataTransfer.setData(TILE_DRAG_TYPE, payload)
            event.dataTransfer.setData('text/plain', tilePath(row.segments))
          }
          event.dataTransfer.effectAllowed = 'copy'
        }
      })

      // ONE BLOCK PER TILE. The conversations are not a sibling of the row
      // they belong to — they are INSIDE it, so an unfolded tile is one
      // object with a lit edge around all of it. Appended beside the row,
      // they hung outside the lit box and read as belonging to nothing.
      const group = document.createElement('div')
      group.className = 'hc-rail-group'
      group.dataset['key'] = key
      group.classList.toggle('current', current)
      wrap.append(main)
      // A chat click is the drill, so the row has no second control. A list
      // whose click picks the tile (the notes desk, the tile editor) still
      // walks with this.
      if (!this.#profile.chats && row.childCount > 0 && this.#profile.walk) {
        const walk = document.createElement('button')
        walk.type = 'button'
        walk.className = 'hc-rail-walk'
        walk.replaceChildren(glyphSpan(walkIcon))
        const walkLabel = this.#t('agent.rail-go', 'Go inside {name}').replace('{name}', row.name)
        walk.title = walkLabel
        walk.setAttribute('aria-label', walkLabel)
        walk.addEventListener('click', event => {
          event.stopPropagation()
          this.#drill(row.segments)
        })
        wrap.append(walk)
      }
      this.#paintSibling(wrap, key)
      group.appendChild(wrap)
      if (this.#profile.chats && this.#expanded.has(key)) group.appendChild(this.#chatsPanel(key, row))
      list.appendChild(group)
    }

    this.#settleScroll(list, level, kept)
    // The rows exist; now say what each one holds.
    this.#paintStatus()
    this.#landFocus()
  }

  /** Put the list where the reader left it. Coming back out of a tile
   *  restores the scroll this level had when it was drilled from, then makes
   *  sure the row you came out of is on screen (centred when there is no
   *  remembered scroll — a level you started inside was never scrolled). */
  #settleScroll(list: HTMLElement, level: string, kept: number): void {
    const returning = this.#returning
    if (!returning || returning.level !== level) {
      list.scrollTop = kept
      return
    }
    this.#returning = null
    const saved = this.#scrolls.get(level)
    list.scrollTop = saved ?? 0
    const row = [...list.querySelectorAll<HTMLElement>('.hc-rail-group')]
      .find(group => group.dataset['key'] === returning.out)
    if (!row) return
    this.#cameOutOf = row
    const frame = list.getBoundingClientRect()
    const box = row.getBoundingClientRect()
    if (saved === undefined) {
      list.scrollTop += (box.top - frame.top) - (list.clientHeight - box.height) / 2
    } else if (box.top < frame.top) {
      list.scrollTop += box.top - frame.top
    } else if (box.bottom > frame.bottom) {
      list.scrollTop += box.bottom - frame.bottom
    }
  }

  /** After a level change the focus that was on a now-removed row would be
   *  lost to the body. Land on the first tile of the level that arrived, or
   *  on the hive line when that level is empty, so ← still has a row. */
  #landFocus(): void {
    const out = this.#cameOutOf
    this.#cameOutOf = null
    if (!this.#focusFirstRow) return
    this.#focusFirstRow = false
    const list = this.#list
    if (!list) return
    const landed = (out?.isConnected ? out.querySelector<HTMLElement>('.hc-rail-main') : null)
      ?? list.querySelector<HTMLElement>('.hc-rail-group:not(.hc-rail-hive) .hc-rail-main')
      ?? list.querySelector<HTMLElement>('.hc-rail-hive .hc-rail-main')
    landed?.focus()
  }

  /** Move focus one row up or down, staying inside the level. */
  #step(from: HTMLElement, delta: 1 | -1): void {
    const rows = [...(this.#list?.querySelectorAll<HTMLElement>('.hc-rail-row') ?? [])]
    const index = rows.indexOf(from)
    if (index < 0) return
    rows[Math.min(rows.length - 1, Math.max(0, index + delta))]?.querySelector<HTMLElement>('.hc-rail-main')?.focus()
  }

  /** Fold a tile's conversations open or shut. ONE AT A TIME: opening one
   *  shuts the rest, so the level is always a list of tiles with at most one
   *  of them showing its threads. Six open folds is not a list any more. */
  #toggleChats(key: string, row: RailRow): void {
    const wasOpen = this.#expanded.has(key)
    this.#expanded.clear()
    if (!wasOpen) this.#expanded.add(key)
    this.#renderLevel(this.#here(), this.#levels.get(pathKey(this.#here())) ?? null, 0)
  }

  /** Repaint open panels in place when the thread pool moves under them. */
  #repaintExpanded(): void {
    const list = this.#list
    if (!list) return
    this.#repaintConvos()
    for (const panel of list.querySelectorAll<HTMLElement>('.hc-rail-chats')) {
      const key = panel.dataset['key'] ?? ''
      if (key === HIVE_KEY) { panel.replaceWith(this.#chatsPanel(key, this.#hiveRow())); continue }
      const rows = this.#levels.get(pathKey(this.#here())) ?? []
      const row = rows.find(candidate => pathKey(candidate.segments) === key)
      if (row) panel.replaceWith(this.#chatsPanel(key, row))
    }
  }

  /** THE HIVE'S ROW — one block at the top, drawn as itself: a gold comb cell
   *  instead of a tile's picture, its name in the hive's own letterforms, and
   *  a rule under it separating what is GLOBAL from what is on this page.
   *  Same fold, same "+ New conversation" as any tile; what hangs under it is
   *  every conversation that is about the hive rather than one tile in it. */
  #hiveRow(): RailRow {
    return { name: this.#t('agent.rail-hive', 'Hypercomb'), segments: [], childCount: 0 }
  }

  #hiveGroup(): HTMLElement {
    const row = this.#hiveRow()
    const name = row.name
    const current = this.#subject?.key === HIVE_KEY

    const group = document.createElement('div')
    group.className = 'hc-rail-group hc-rail-hive'
    group.dataset['key'] = HIVE_KEY
    group.classList.toggle('current', current)

    const wrap = document.createElement('div')
    wrap.className = 'hc-rail-row'
    wrap.dataset['key'] = HIVE_KEY
    wrap.setAttribute('role', 'listitem')
    wrap.classList.toggle('current', current)

    const main = document.createElement('button')
    main.type = 'button'
    main.className = 'hc-rail-main'
    const hint = this.#t('agent.rail-hive-hint', 'Conversations about the whole hive')
    main.title = hint
    if (current) main.setAttribute('aria-current', 'true')

    // NO MARK OF ITS OWN. A comb cell here sat beside the gutter's unread
    // cell — two hexagons in a row, one meaning "this is the hive" and one
    // meaning "something is unread", and nothing to tell them apart. The
    // gutter keeps the shape (it is the vocabulary of STATE everywhere in
    // this list) and the hive is named instead: amber, uppercase, over a
    // rule. Identity in the letterforms, state in the hexagon.
    const label = document.createElement('span')
    label.className = 'hc-rail-name'
    label.textContent = name

    // THE SAME DETAILS AS EVERY OTHER LINE. The hive is a conversation like
    // the tiles under it — deeper than most, usually — and it was the one row
    // in this list with nowhere to put what it holds: no count of its
    // threads, no live mark, so a question asked about the whole hive
    // vanished from the surface the moment it was sent. #paintStatus already
    // resolves its state (its key is the root's, so its path is HIVE_PATH);
    // it had no slots to write into.
    const threads = document.createElement('span')
    threads.className = 'hc-rail-threads'
    threads.hidden = true

    const bees = document.createElement('span')
    bees.className = 'hc-rail-bees'
    bees.hidden = true

    main.append(label, threads, bees)

    // THE LINE TALKS HERE TOO, second press and all — the hive has nowhere to
    // walk INTO, so it is the one row that carries no arrow. That is not a
    // second grammar: it is the same one, on a row with no inside. ← still
    // climbs out from here, which is the row an empty level can focus.
    main.addEventListener('click', event => {
      event.stopPropagation()
      if (current && this.#expanded.has(HIVE_KEY)) { this.#toggleChats(HIVE_KEY, row); return }
      this.#openRow(row, HIVE_KEY)
    })
    main.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'ArrowLeft') {
        if (this.#trail.length <= 1 || !this.#profile.walk) return
        event.preventDefault()
        this.#focusFirstRow = true
        this.#up()
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        this.#step(wrap, event.key === 'ArrowDown' ? 1 : -1)
      }
    })

    wrap.append(main)
    group.appendChild(wrap)
    if (this.#expanded.has(HIVE_KEY)) group.appendChild(this.#chatsPanel(HIVE_KEY, row))
    return group
  }

  /** THE TILE'S CONVERSATIONS. Only conversations containing real turns are
   *  rows. An empty composer is an invitation to type, not a conversation
   *  record and not another piece of navigation furniture.
   *
   *  Under the live rows sits "+ New conversation" — the way to the NEXT
   *  thread on a tile that already holds some, above the archive because the
   *  archive is a different shelf. It creates nothing: the press puts a
   *  fresh composer in the window, and the row appears only when the first
   *  turn lands and names it. Only on the tile you are IN, and absent when
   *  the fold lists nothing — there the empty composer IS the invitation.
   *
   *  NO ROW CARRIES AN ARCHIVE MARK. This list is scanned for a NAME;
   *  putting a thread away is done from the PANE, on the conversation you
   *  have opened, where every other thing you can do to it already lives.
   *  What stays here is READING what was put away — the disclosure below
   *  says how many and opens onto them. */
  #chatsPanel(key: string, row: RailRow): HTMLElement {
    const path = tilePath(row.segments)
    const panel = document.createElement('div')
    panel.className = 'hc-rail-chats'
    panel.dataset['key'] = key
    panel.setAttribute('role', 'list')

    const chats = this.#chatsFor(path)
    const open = this.#subject?.convoId ?? this.#stickyChat(path)

    // PUT AWAY IS NOT THROWN AWAY. An archived thread keeps every turn; it
    // just stops being one of the rows you have to read past. So the fold
    // shows the live ones, and says how many are put away underneath.
    const live = chats.filter(chat => !chat.archived)
    const filed = chats.filter(chat => chat.archived)

    const drawChat = (chat: TileConversation): HTMLElement => {
      const item = document.createElement('div')
      item.className = 'hc-rail-chat'
      item.setAttribute('role', 'listitem')
      item.classList.toggle('current', chat.convoId === open)
      if (chat.unread) item.classList.add('unread')
      if (chat.archived) item.classList.add('filed')

      const body = document.createElement('button')
      body.type = 'button'
      body.className = 'hc-rail-chat-body'

      // A QUESTION IN FLIGHT HAS NO NAME YET. Until the first reply lands
      // there is no subject — only the thing you did not know when you typed
      // it — so the row says what is actually true about it and waits. When
      // the answer arrives the thread is named from the exchange
      // (chat-name.ts) and this row picks the name up on the repaint.
      //
      // NOT ON THE ARCHIVE SHELF. A thread you put away without an answer is
      // not waiting for one — you stopped it. There it wears its opening
      // line, which is the only thing it was ever going to be called.
      const waiting = !chat.replied && !chat.archived
      if (waiting) item.classList.add('awaiting')

      const title = document.createElement('span')
      title.className = 'hc-rail-chat-name'
      title.textContent = waiting
        ? this.#t('agent.rail-chat-waiting', 'waiting for reply…')
        : (chat.title || this.#t('agent.rail-chat-untitled', 'Untitled'))

      const meta = document.createElement('span')
      meta.className = 'hc-rail-chat-meta'
      // Nothing to count while the question is still out — the name is
      // already saying what this row's state is, and "1 turns" beside it is
      // the same fact said worse.
      meta.textContent = waiting
        ? ''
        : this.#t('agent.rail-turns', '{count} turns').replace('{count}', String(chat.turns))

      // THE HEAD IS THE OLD ROW — name left, turn count right. Everything
      // below it is new, and absent when there is no blurb.
      const head = document.createElement('span')
      head.className = 'hc-rail-chat-head'
      head.append(title, meta)
      body.append(head)

      // WHAT IT TURNED OUT TO BE ABOUT. The title is the first thing you
      // said, which is what you did not know yet; this is the other end of
      // the thread. Purely additive — no blurb, and the row is what it was.
      const blurb = this.#blurbs.get(chat.convoId)
      if (blurb?.line) {
        const line = document.createElement('span')
        line.className = 'hc-rail-chat-blurb'
        line.textContent = blurb.line
        line.title = blurb.line
        body.append(line)
      }

      body.addEventListener('click', event => {
        event.stopPropagation()
        this.#enterChat(row, key, chat.convoId)
      })

      item.append(body)

      // NO POINTS LIST, AND NO ARCHIVE MARK. Two things used to ride the open
      // row and both are gone for the same reason: a row in this list is
      // SCANNED, and every row has to be the same box in every state or the
      // list moves under your hand as you choose. The points were the last
      // thing that grew a row on selection — up to four bullets appearing
      // under the one conversation you pressed, shunting every row below it.
      //
      // The blurb points are NOT deleted: they are still minted, still stored,
      // and the find field still reaches into them (#blurbMatches), so a
      // thread is still findable by what it decided. What changed is where
      // they are read — the conversation you opened, not the list you opened
      // it from. Reaching an archived thread is unchanged too: open it, and
      // the way back out is in the pane with everything else you can do to it.

      return item
    }

    for (const chat of live) panel.appendChild(drawChat(chat))

    // THE WAY TO THE NEXT ONE, right under the conversations it would join —
    // above the archive, which is a different shelf. Only on the tile you are
    // IN: a fold browsed in passing lists what exists; the invitation to add
    // belongs where you already are. A link, not a row — it enters a freshly
    // minted thread id without writing a thing, so pressing it and walking
    // away leaves no husk behind.
    //
    // ALWAYS EXACTLY ONE, an EMPTY fold included. It used to be absent when
    // there was nothing listed, on the theory that the empty composer in the
    // window is the invitation — which is true of the tile you have already
    // walked into, and false of the hive's own fold, where a participant with
    // no conversations yet opened the root chat and found a list with nothing
    // in it and no way to start. The other half of "exactly one" is that no
    // ROW is ever called "New conversation" any more: a thread appears here
    // when its question is sent, wearing what it is waiting for.
    if (this.#subject?.key === key) {
      const fresh = document.createElement('button')
      fresh.type = 'button'
      fresh.className = 'hc-rail-chat hc-rail-chat-new'
      fresh.textContent = this.#t('agent.rail-chat-new', '+ New conversation')
      fresh.addEventListener('click', event => {
        event.stopPropagation()
        this.#enterChat(row, key, newTileConvoId(row.segments))
      })
      panel.appendChild(fresh)
    }

    // WHAT YOU PUT AWAY, and the way back to it — right here under the
    // conversations it was one of, not in a separate screen. Absent entirely
    // when nothing is archived: a disclosure for an empty set is furniture.
    if (filed.length) {
      const showing = this.#archiveOpen.has(key)
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'hc-rail-chat hc-rail-archived'
      toggle.classList.toggle('on', showing)
      toggle.setAttribute('aria-expanded', showing ? 'true' : 'false')
      toggle.textContent = this.#t('agent.rail-chat-archived', 'Archived ({count})')
        .replace('{count}', String(filed.length))
      toggle.addEventListener('click', event => {
        event.stopPropagation()
        if (showing) this.#archiveOpen.delete(key)
        else this.#archiveOpen.add(key)
        this.#repaintExpanded()
      })
      panel.appendChild(toggle)
      if (showing) for (const chat of filed) panel.appendChild(drawChat(chat))
    }

    return panel
  }

  /** Read what every listed conversation's workflow says. A pool read each and
   *  no model call; a conversation nothing has organized is simply absent. */
  async #refreshStandings(): Promise<void> {
    if (!this.#profile.chats) return
    const epoch = ++this.#standingsEpoch
    const ids = this.#chatList.filter(chat => !chat.archived).map(chat => chat.convoId)
    const next = await readConversationStandings(ids)
    if (this.#disposed || epoch !== this.#standingsEpoch) return
    this.#standings = next
    this.#repaintConvos()
  }

  /** Who a conversation waits on: YOU when its newest reply asked a question;
   *  nobody when every organized step is settled and nothing newer came in;
   *  otherwise it is open. */
  #convoGroup(chat: TileConversation): ConvoGroup {
    return conversationGroup(chat, this.#standings.get(chat.convoId))
  }

  /** How long since a conversation moved, in the fewest characters. */
  #age(at: number): string {
    const minutes = Math.floor(Math.max(0, Date.now() - at) / 60_000)
    if (minutes < 1) return this.#t('agent.rail-age-now', 'now')
    if (minutes < 60) return this.#t('agent.rail-age-minutes', '{count}m').replace('{count}', String(minutes))
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return this.#t('agent.rail-age-hours', '{count}h').replace('{count}', String(hours))
    return this.#t('agent.rail-age-days', '{count}d').replace('{count}', String(Math.floor(hours / 24)))
  }

  /** Open or shut the conversations tab. The tiles keep their place: the
   *  scroll they had is put back when the tab shuts. */
  #setConvosTab(on: boolean): void {
    if (on === this.#convosTab || !this.#profile.chats) return
    const list = this.#list
    if (on && list) this.#tilesScroll = list.scrollTop
    this.#convosTab = on
    this.paint()
    if (list) list.scrollTop = on ? 0 : this.#tilesScroll
  }

  /** The head band's conversations icon: pressed while the tab is open, and
   *  wearing how many conversations on this layer wait on you. */
  #paintConvosToggle(): void {
    const toggle = this.#convosToggle
    if (!toggle) return
    const waiting = this.#convoGroups().groups.waiting.length
    const badge = toggle.querySelector<HTMLElement>('.hc-rail-convos-badge')
    if (badge) {
      badge.textContent = waiting ? String(waiting) : ''
      badge.hidden = waiting === 0
    }
    toggle.classList.toggle('waiting', waiting > 0)
    toggle.setAttribute('aria-pressed', this.#convosTab ? 'true' : 'false')
    const label = this.#convosTab
      ? this.#t('agent.rail-convos-hide', 'Back to the tiles')
      : waiting
        ? this.#t('agent.rail-convos-show', 'Conversations — {count} waiting on you').replace('{count}', String(waiting))
        : this.#t('agent.rail-convos', 'Conversations')
    toggle.title = label
    toggle.setAttribute('aria-label', label)
  }

  /** The layer's conversations by who they wait on, and what was put away.
   *  A thread shows while you are on its layer: the layer's own, and the
   *  tiles sitting on it. Done threads older than today drop out. */
  #convoGroups(): { groups: Record<ConvoGroup, TileConversation[]>; filed: TileConversation[] } {
    const onLayer = (chat: TileConversation): boolean => conversationOnLayer(chat.path, this.#here())
    const live = this.#chatList.filter(chat => !chat.archived && onLayer(chat))
    const filed = this.#chatList.filter(chat => chat.archived && onLayer(chat))
    const startOfToday = new Date().setHours(0, 0, 0, 0)
    const groups: Record<ConvoGroup, TileConversation[]> = { waiting: [], open: [], done: [] }
    for (const chat of live) {
      const group = this.#convoGroup(chat)
      if (group === 'done' && chat.lastAt < startOfToday) continue
      groups[group].push(chat)
    }
    return { groups, filed }
  }

  /** THE CONVERSATIONS for the layer in hand, by who they wait on: a question
   *  out to you, still open, done today — and what was put away, folded shut
   *  under them. Deeper threads appear after you go inside. A tile's own fold
   *  still lists that tile's threads. */
  #convosSection(): HTMLElement {
    const section = document.createElement('section')
    section.className = 'hc-rail-convos'
    const heading = this.#t('agent.rail-convos', 'Conversations')
    section.setAttribute('aria-label', heading)
    const { groups, filed } = this.#convoGroups()

    const head = document.createElement('div')
    head.className = 'hc-rail-convos-head'
    const title = document.createElement('span')
    title.textContent = heading
    const count = document.createElement('span')
    count.className = 'hc-rail-convos-count'
    const open = groups.waiting.length + groups.open.length
    count.textContent = open ? this.#t('agent.rail-convos-open', '{count} open').replace('{count}', String(open)) : ''
    // A WAY TO START, on the list itself (jwize, 2026-09-26: the level page
    // listed every conversation and offered no way to begin one — the only
    // "+ New conversation" lived inside a tile's fold, one click away from a
    // list that never says so). The thread begins on the level in hand.
    const fresh = document.createElement('button')
    fresh.type = 'button'
    fresh.className = 'hc-rail-convos-new'
    fresh.textContent = this.#t('agent.rail-chat-new', '+ New conversation')
    fresh.addEventListener('click', event => {
      event.stopPropagation()
      this.#startConvoHere()
    })
    head.append(title, count, fresh)
    section.appendChild(head)

    const current = this.#openConvo || this.#subject?.convoId || ''
    const labels: Record<ConvoGroup, string> = {
      waiting: this.#t('agent.rail-convos-waiting', 'Waiting on you'),
      open: this.#t('agent.rail-convos-active', 'Open'),
      done: this.#t('agent.rail-convos-done', 'Done today'),
    }
    for (const group of ['waiting', 'open', 'done'] as const) {
      if (!groups[group].length) continue
      const label = document.createElement('div')
      label.className = 'hc-rail-convos-group'
      label.textContent = labels[group]
      section.appendChild(label)
      for (const chat of groups[group]) section.appendChild(this.#convoRow(chat, group, current))
    }

    if (filed.length) {
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'hc-rail-convos-archived'
      toggle.classList.toggle('on', this.#convosArchiveOpen)
      toggle.setAttribute('aria-expanded', this.#convosArchiveOpen ? 'true' : 'false')
      toggle.textContent = this.#t('agent.rail-chat-archived', 'Archived ({count})').replace('{count}', String(filed.length))
      toggle.addEventListener('click', event => {
        event.stopPropagation()
        this.#convosArchiveOpen = !this.#convosArchiveOpen
        this.#repaintConvos()
      })
      section.appendChild(toggle)
      if (this.#convosArchiveOpen) for (const chat of filed) section.appendChild(this.#convoRow(chat, null, current))
    }
    return section
  }

  /** One conversation: what it is, where it stands, how long since it moved. */
  #convoRow(chat: TileConversation, group: ConvoGroup | null, current: string): HTMLElement {
    const standing = this.#standings.get(chat.convoId)
    const asked = !chat.replied && !chat.archived
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'hc-rail-convo'
    if (group) row.dataset['group'] = group
    row.classList.toggle('current', !!current && chat.convoId === current)
    row.classList.toggle('unread', chat.unread)
    row.classList.toggle('filed', chat.archived)

    const icon = document.createElement('span')
    icon.className = 'hc-rail-convo-icon'
    icon.setAttribute('aria-hidden', 'true')
    icon.textContent = asked ? CONVO_ICONS.asked : group ? CONVO_ICONS[group] : CONVO_ICONS.filed

    const text = document.createElement('span')
    text.className = 'hc-rail-convo-text'
    const name = document.createElement('span')
    name.className = 'hc-rail-convo-name'
    name.textContent = asked
      ? this.#t('agent.rail-chat-waiting', 'waiting for reply…')
      : (standing?.name || chat.title || this.#t('agent.rail-chat-untitled', 'Untitled'))
    text.appendChild(name)
    const said = asked ? chat.title : (standing?.stands || this.#blurbs.get(chat.convoId)?.line || '')
    if (said) {
      const line = document.createElement('span')
      line.className = 'hc-rail-convo-line'
      line.textContent = said
      text.appendChild(line)
    }

    const age = document.createElement('span')
    age.className = 'hc-rail-convo-age'
    age.textContent = this.#age(chat.lastAt)

    row.append(icon, text, age)
    row.title = said ? `${name.textContent}\n${said}` : name.textContent ?? ''
    row.addEventListener('click', event => {
      event.stopPropagation()
      this.#enterConvo(chat)
    })
    return row
  }

  /** A NEW conversation on the level in hand: the hive's own at the root,
   *  otherwise the tile this level is inside. Nothing is created — the
   *  press puts a fresh composer in the window, and the row appears when
   *  the first turn lands and names it. */
  #startConvoHere(): void {
    const segments = this.#here()
    if (!segments.length) { this.#enterChat(this.#hiveRow(), HIVE_KEY, newTileConvoId([])); return }
    const key = pathKey(segments)
    const parent = this.#trail[this.#trail.length - 2] ?? []
    const row = (this.#levels.get(pathKey(parent)) ?? []).find(candidate => pathKey(candidate.segments) === key)
      ?? { name: segments[segments.length - 1]!, segments: [...segments], childCount: 0 }
    this.#enterChat(row, key, newTileConvoId(row.segments))
  }

  /** Enter a conversation from the list, wherever its tile is. A tile on the
   *  level in hand lends its row (picture, signature); one elsewhere is named
   *  by the path the conversation already carries. */
  #enterConvo(chat: TileConversation): void {
    const segments = chat.path.split('/').filter(Boolean)
    if (!segments.length) { this.#enterChat(this.#hiveRow(), HIVE_KEY, chat.convoId); return }
    const key = pathKey(segments)
    const level = this.#levels.get(pathKey(this.#here())) ?? []
    const row = level.find(candidate => pathKey(candidate.segments) === key)
      ?? { name: segments[segments.length - 1]!, segments, childCount: 0 }
    this.#enterChat(row, key, chat.convoId)
  }

  /** Redraw the conversations in place — the icon's count always, the list
   *  itself only while its tab is open. */
  #repaintConvos(): void {
    this.#paintConvosToggle()
    const list = this.#list
    if (!list || !this.#profile.chats || !this.#convosTab || this.#query) return
    const old = [...list.children].find(element => element.classList.contains('hc-rail-convos')) as HTMLElement | undefined
    const scrolled = list.scrollTop
    const fresh = this.#convosSection()
    if (old) old.replaceWith(fresh)
    else list.prepend(fresh)
    list.scrollTop = scrolled
  }

  /** Enter one named conversation on a tile, and remember it as this tile's
   *  chat so coming back resumes it. */
  #enterChat(row: RailRow, key: string, convoId: string): void {
    const path = tilePath(row.segments)
    // ONE FOLD AT A TIME. Entering a conversation shuts every other tile's
    // list: you are in one thread, the rail should show one tile's threads,
    // and a column of half a dozen open folds is a list you have to read
    // rather than scan.
    this.#expanded.clear()
    this.#expanded.add(key)
    this.#rememberChat(path, convoId)
    const wrap = this.#rowFor(key)
    if (wrap) this.#markCurrent(wrap)
    this.#subject = { key, path: row.segments.slice(0, -1), name: row.name, sig: row.sig, convoId }
    this.onSubjectChanged(this.#subject)
    // A fold that is already drawn repaints in place; one that has never been
    // opened has to be drawn, and only a level pass can do that — and a pass
    // replaces the row the keyboard was standing on, so the focus has to be
    // put back where the hands left it.
    const held = document.activeElement
    const refocus = held instanceof HTMLElement && this.#list?.contains(held)
    if (this.#panelFor(key)) this.#repaintExpanded()
    else {
      this.#renderLevel(this.#here(), this.#levels.get(pathKey(this.#here())) ?? null, 0)
      if (refocus) this.#rowFor(key)?.querySelector<HTMLElement>('.hc-rail-main')?.focus()
    }
  }

  /** A row by its key, WITHOUT an attribute selector. Keys carry the NUL that
   *  joins path segments, so they must be escaped to go in a selector — and
   *  `CSS.escape` is absent in more environments than you would think (jsdom,
   *  where this list is tested, is one). Walking the rows costs nothing at
   *  this size and cannot be broken by a character in a tile's name. */
  #rowFor(key: string): HTMLElement | null {
    for (const row of this.#list?.querySelectorAll<HTMLElement>('.hc-rail-row') ?? []) {
      if ((row.dataset['key'] ?? '') === key) return row
    }
    return null
  }

  /** The open fold for a key, by the same rule. */
  #panelFor(key: string): HTMLElement | null {
    for (const panel of this.#list?.querySelectorAll<HTMLElement>('.hc-rail-chats') ?? []) {
      if ((panel.dataset['key'] ?? '') === key) return panel
    }
    return null
  }

  /** Choose or release a row as CONTEXT. Independent of the conversation you
   *  are in: you can gather five tiles and then ask about them from any of
   *  them, or from none. */
  #toggleChosen(wrap: HTMLElement, key: string, row: RailRow): void {
    const main = wrap.querySelector('.hc-rail-main')
    if (this.#chosen.delete(key)) {
      wrap.classList.remove('chosen')
      main?.setAttribute('aria-pressed', 'false')
    } else {
      this.#chosen.set(key, { key, path: row.segments.slice(0, -1), name: row.name, sig: row.sig })
      wrap.classList.add('chosen')
      main?.setAttribute('aria-pressed', 'true')
    }
    this.onSelectionChanged(this.selection)
  }

  /** Enter a row's conversation. The first press opens it and leaves the
   *  reading pane alone. Pressing the same tile again puts it in view. A
   *  surface with no chats picks the tile and nothing else. */
  #enter(wrap: HTMLElement, key: string, row: RailRow): void {
    this.#markCurrent(wrap)
    this.#openRow(row, key)
  }

  #openRow(row: RailRow, key: string): void {
    if (!this.#profile.chats) {
      this.#subject = { key, path: row.segments.slice(0, -1), name: row.name, sig: row.sig }
      this.onSubjectChanged(this.#subject)
      return
    }
    const id = tilePath(row.segments)
    if (this.#armed.has(id) && this.#subject?.key === key) {
      this.#enterChat(row, key, this.#stickyChat(id) || tileConvoId(row.segments))
      return
    }
    this.visit(row.segments)
  }

  /** Light exactly one row as the conversation in hand — in colour AND in the
   *  accessibility tree, which is the half a class toggle silently skips. */
  #markCurrent(wrap: HTMLElement | null): void {
    for (const other of this.#list?.querySelectorAll('.hc-rail-row.current') ?? []) {
      other.classList.remove('current')
      other.querySelector('.hc-rail-main')?.removeAttribute('aria-current')
    }
    for (const other of this.#list?.querySelectorAll('.hc-rail-group.current') ?? []) {
      other.classList.remove('current')
    }
    if (!wrap) return
    wrap.classList.add('current')
    wrap.closest('.hc-rail-group')?.classList.add('current')
    wrap.querySelector('.hc-rail-main')?.setAttribute('aria-current', 'true')
  }

  /** Which tiles hold unsent thinking. Read on mount and whenever a draft is
   *  written — the mark is a fact about the pool, never local state. */
  async #refreshDrafts(): Promise<void> {
    let held: string[] = []
    try { held = (await listTileDrafts()).map(d => d.path) } catch { return }
    if (this.#disposed) return
    this.#drafts = new Set(held)
    this.#paintStatus()
  }

  /** A TURN LANDED. What changed is ONE conversation, and the pool can say so
   *  without being walked end to end — which matters because this fires on
   *  every reply, and a session grinding away over the bridge is already
   *  using the same main thread the bees pulse on. The full walk is kept for
   *  the case it is actually needed: a change that does not name its thread.
   *
   *  Named changes are also COALESCED — a drain that delivers six replies in
   *  a burst is one repaint, not six. */
  async #chatChanged(convoId: string): Promise<void> {
    if (!convoId) { void this.#refreshChats(); return }
    this.#chatDirty.add(convoId)
    if (this.#chatSettle) return
    this.#chatSettle = setTimeout(() => {
      this.#chatSettle = null
      const ids = [...this.#chatDirty]
      this.#chatDirty.clear()
      // Past the cap, reading each bucket costs more than one walk of the
      // pool — so take the walk rather than a hundred directory opens.
      if (ids.length > CHAT_MERGE_CAP) { void this.#refreshChats(); return }
      void this.#mergeChats(ids)
    }, CHAT_SETTLE_MS)
  }

  /** Fold what those conversations say now into the list already in hand. */
  async #mergeChats(ids: readonly string[]): Promise<void> {
    const fresh = (await Promise.all(ids.map(id => readConversationSummary(id).catch(() => null))))
      // A conversation becomes a list item the moment it holds a turn. It
      // used to wait for the whole exchange — which meant a question you had
      // just sent was nowhere on the surface until its answer came back, and
      // the one thing you wanted to watch was the one thing not listed.
      .filter((chat): chat is TileConversation => !!chat && (chat.archived || chat.turns >= 1))
    if (this.#disposed || !fresh.length) return
    const byId = new Map(this.#chatList.map(chat => [chat.convoId, chat]))
    for (const chat of fresh) byId.set(chat.convoId, chat)
    this.#chatList = [...byId.values()].sort((a, b) => b.lastAt - a.lastAt)
    this.#chats = foldTileConversations(this.#chatList)
    this.#paintStatus()
    if (this.#expanded.size) this.#repaintExpanded()
    void this.#refreshBlurbs()
    void this.#refreshStandings()
  }

  /** What the threads in hand turned out to be about. A pool read per
   *  conversation and no model call — the orchestrator does the deriving, so
   *  this surface only ever READS. Absent blurbs are simply absent; the map
   *  is replaced wholesale so a wiped pool clears the lines rather than
   *  leaving yesterday's labels standing. */
  async #refreshBlurbs(): Promise<void> {
    if (!this.#profile.chats) return
    const ids = this.#chatList.map(chat => chat.convoId)
    if (!ids.length) {
      if (!this.#blurbs.size) return
      this.#blurbs = new Map()
      if (this.#expanded.size) this.#repaintExpanded()
      return
    }
    let blurbs: Map<string, ChatBlurb>
    try { blurbs = await readBlurbs(ids) } catch { return }
    if (this.#disposed) return
    this.#blurbs = blurbs
    this.#repaintConvos()
    if (this.#expanded.size) this.#repaintExpanded()
  }

  /** Which tiles hold a conversation at all, and whether it has been read.
   *  ONE walk: a chat about no tile is filed at the hive's own address, so
   *  the tiles' threads and the hive's arrive together. */
  async #refreshChats(): Promise<void> {
    let chats: TileConversation[] = []
    try { chats = (await listRailConversations()).filter(chat => chat.archived || chat.turns >= 1) } catch { return }
    if (this.#disposed) return
    this.#chatList = chats
    this.#chats = foldTileConversations(chats)
    this.#paintStatus()
    // An unfolded list showing yesterday's threads is worse than none.
    if (this.#expanded.size) this.#repaintExpanded()
    void this.#refreshBlurbs()
    void this.#refreshStandings()
  }

  /** The conversations on one tile, newest first. The pool is the list:
   *  nothing is rendered merely because somebody focused an empty composer. */
  #chatsFor(path: string): TileConversation[] {
    return this.#chatList.filter(chat => chat.path === path)
  }

  /** THE CHAT YOU WERE LAST IN on this tile — sticky, so coming back to a
   *  tile resumes where you were rather than dropping you in its first
   *  thread. Per device, like every other read-position in the product. */
  #stickyChat(path: string): string {
    try { return JSON.parse(localStorage.getItem(STICKY_KEY) ?? '{}')[path] ?? '' } catch { return '' }
  }

  #rememberChat(path: string, convoId: string): void {
    try {
      const map = JSON.parse(localStorage.getItem(STICKY_KEY) ?? '{}') as Record<string, string>
      map[path] = convoId
      localStorage.setItem(STICKY_KEY, JSON.stringify(map))
    } catch { /* participant-local convenience */ }
  }

  /** Paint every row's state from the three sources at once. One pass, so a
   *  row can never show half an answer, and cheap enough to run whenever any
   *  source moves — it touches classes and one custom property, never the
   *  DOM's shape. */
  #paintStatus(): void {
    const list = this.#list
    if (!list) return
    // A surface with no chats has no spoken/unread/draft/live to paint — its
    // badge is the surface's own count, written once when the row was drawn.
    if (!this.#profile.chats) { this.#paintBadges(); return }
    const counts = this.#agentCounts()
    for (const row of list.querySelectorAll<HTMLElement>('.hc-rail-row')) {
      const key = row.dataset['key'] ?? ''
      const path = tilePath(keySegments(key))
      const chat = this.#chats.get(path)
      const turns = chat?.turns ?? 0
      const draft = this.#drafts.has(path)
      const unread = !!chat?.unread

      // A SET, DRAWN AS ONE. Rows in the active set carry a bracket down
      // their edge, closed at the top and bottom of each contiguous run, so
      // three tiles chosen together read as one handful rather than three
      // coincidences. A run that is broken by a tile you did not choose is
      // drawn as two brackets, which is the truth.
      const inSet = this.#grouped.has(path)
      row.classList.toggle('grouped', inSet)
      if (inSet) {
        const rows = [...list.querySelectorAll<HTMLElement>('.hc-rail-row')]
        const at = rows.indexOf(row)
        const pathOf = (element?: HTMLElement): string =>
          element ? tilePath(keySegments(element.dataset['key'] ?? '')) : ''
        row.classList.toggle('grouped-first', !this.#grouped.has(pathOf(rows[at - 1])))
        row.classList.toggle('grouped-last', !this.#grouped.has(pathOf(rows[at + 1])))
      } else {
        row.classList.remove('grouped-first', 'grouped-last')
      }

      row.classList.toggle('spoken', turns > 0)
      row.classList.toggle('unread', unread)
      row.classList.toggle('draft', draft)
      row.style.setProperty('--hc-rail-depth', String(Math.min(turns, 12) / 12))

      const held = chat?.chats ?? 0
      const threads = row.querySelector<HTMLElement>('.hc-rail-threads')
      if (threads) {
        threads.textContent = String(held)
        threads.hidden = held === 0
      }

      // LIVE is agents on the tile — and a question of your own IS one of
      // them now: sending it raises a bee on the same lane a routine does
      // (chat-window's #raiseBee), so the registry already counts it.
      //
      // NOT A SUM. It used to add the chat's own busy flag to the registry's
      // count, which was right while a question raised no agent and would now
      // count the same question twice — one live chat reading "2". The flag
      // stays as the FALLBACK for a shell whose registry is absent, where it
      // is the only thing that knows.
      const working = counts.get(key) ?? 0
      const busy = working || (this.#busy.has(path) ? 1 : 0)
      // ACTIVE, as a mark and not only as a digit — see the .live rule. The
      // count is the fact; the gutter is what you see without reading.
      row.classList.toggle('live', busy > 0)
      const badge = row.querySelector<HTMLElement>('.hc-rail-bees')
      if (badge) {
        badge.textContent = String(busy)
        badge.hidden = busy === 0
      }

      // EVERY MARK HERE IS CSS, therefore silent. The row's accessible name
      // has to carry the same sentence, or the vocabulary is sighted-only.
      const main = row.querySelector<HTMLElement>('.hc-rail-main')
      const label = row.querySelector<HTMLElement>('.hc-rail-name')?.textContent ?? ''
      if (main && label) {
        const said: string[] = [label]
        if (held > 0) said.push(this.#t('agent.rail-threads', '{count} conversations').replace('{count}', String(held)))
        if (turns > 0) said.push(this.#t('agent.rail-turns', '{count} turns').replace('{count}', String(turns)))
        if (unread) said.push(this.#t('agent.rail-unread', 'unread reply'))
        if (draft) said.push(this.#t('agent.rail-draft', 'draft waiting'))
        if (busy > 0) said.push(this.#t('agent.rail-working', '{count} working').replace('{count}', String(busy)))
        main.setAttribute('aria-label', said.join(' · '))
      }
    }
  }

  // ── bees on rows ────────────────────────────────────────────────────

  /** How many agents are on each tile, keyed by the tile's own path. A
   *  targeted agent lands on segments+target; a page-wide one on its page. */
  #agentCounts(): Map<string, number> {
    const counts = new Map<string, number>()
    const bump = (key: string): void => { counts.set(key, (counts.get(key) ?? 0) + 1) }
    for (const agent of this.#registry?.list() ?? []) {
      if (agent.kind === 'orchestrator') continue
      if (agent.status !== 'pending' && agent.status !== 'working' && agent.status !== 'blocked') continue
      const base = agent.segments.map(String)
      if (agent.targets.length) for (const target of agent.targets) bump(pathKey([...base, target]))
      else if (base.length) bump(pathKey(base))
    }
    return counts
  }



  // ── icons ───────────────────────────────────────────────────────────

  /** Resolve a tile's square icon and swap it in when it lands. Cached by
   *  props sig; tri-state so a pictureless tile is never asked twice. A
   *  re-render mid-load joins the waiters instead of starting a second
   *  read, and the landing bytes go to every waiter still on screen. */
  #settleIcon(icon: HTMLElement, propsSig: string): void {
    const known = this.#icons.get(propsSig)
    if (known) { this.#showIcon(icon, known); return }
    if (known === null) return
    const waiting = this.#waiters.get(propsSig)
    if (waiting) { waiting.add(icon); return }
    this.#waiters.set(propsSig, new Set([icon]))
    void this.#loadIcon(propsSig).then(url => {
      const waiters = this.#waiters.get(propsSig)
      this.#waiters.delete(propsSig)
      if (this.#disposed) { if (url) URL.revokeObjectURL(url); return }
      this.#icons.set(propsSig, url)
      if (!url) return
      for (const element of waiters ?? []) {
        if (element.isConnected) this.#showIcon(element, url)
      }
    })
  }

  #showIcon(icon: HTMLElement, url: string): void {
    icon.textContent = ''
    const img = document.createElement('img')
    img.alt = ''
    img.decoding = 'async'
    img.src = url
    icon.appendChild(img)
  }

  async #loadIcon(propsSig: string): Promise<string | null> {
    const store = ioc<RailStore & { getResource(sig: string): Promise<Blob | null> }>('@hypercomb.social/Store')
    if (!store?.getResource) return null
    try {
      const blob = await store.getResource(propsSig)
      if (!blob) return null
      const props = JSON.parse(await blob.text()) as unknown
      // First candidate whose BYTES are actually here — a tile can name an
      // original that stayed with its publisher (adoption travels the props
      // blob, not the heavy large), and a broken square is worse than the
      // next candidate down.
      for (const sig of tilePictureCandidates(props)) {
        const thumbnail = await readThumbnail(store, sig)
        if (thumbnail) return URL.createObjectURL(thumbnail)
        const bytes = await store.getResource(sig)
        if (bytes && bytes.size > 0) {
          try { EffectBus.emit('thumbnail:wanted', { sig }) } catch { /* non-fatal */ }
          return URL.createObjectURL(bytes)
        }
      }
      return null
    } catch {
      return null
    }
  }
}

// ── the seam to the shell ──────────────────────────────────────────────
//
// The chat window and the notes panel live in hypercomb-shared, and shared
// must never import essentials — so the rail is offered structurally, the same
// loose-IoC seam TileContext uses. A fresh rail per call, with that surface's
// profile: each keeps its own trail, its own picks, its own idea of what a
// click means.
// The orchestrator bee registers it (atomic-modules-plan.md).
export const agentTilesRailFactory = {
  create: (profile?: RailProfile): AgentTilesRail => new AgentTilesRail(profile),
}
