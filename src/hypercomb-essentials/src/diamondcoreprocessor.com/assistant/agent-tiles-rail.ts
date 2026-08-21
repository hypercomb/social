// diamondcoreprocessor.com/assistant/agent-tiles-rail.ts
//
// THE TILES RAIL — the left sidebar of a full-screen surface: the agent
// panel mounts it directly, and the chat window (shared shell, which must
// never import essentials) reaches it through the IoC factory registered at
// the bottom. It carries its own stylesheet so it looks the same wherever it
// is mounted.
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
//   click        enter this tile's conversation (what you type goes here)
//   the ›        open the tile's CHATS — a tile is a subject, not a single
//                thread, so the arrow unfolds the conversations it holds and
//                lets you pick one (or start another). The pick is sticky:
//                coming back to the tile reopens the chat you were in.
//   ctrl-click   CHOOSE it — add the tile to the context the next request
//                carries. Any number, gathered across any number of levels
//                (the choice survives walking in and out), because what is
//                being built is a LIST OF SIGNATURES: content-addressed, so
//                the same choice composes the same payload every time.
//   hold         go INSIDE it — the same hold-to-enter the hive itself uses,
//                so the list is walked with the gesture already in the hands
//   right-click  come back out
//
// All three are pointer gestures, and a list that can only be walked with a
// mouse is a list some people cannot walk at all — so the same three moves
// answer to the keyboard: Enter opens the conversation, → goes inside, ←
// comes back out, ↑↓ walk the rows, and the level that arrives takes the
// focus so a keyboard is never stranded on a row that no longer exists.
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

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import {
  foldTileConversations, listTileConversations, listTileDrafts, newTileConvoId, tileConvoId, tilePath,
  type TileConversation,
} from './chat-thread.js'
import { walkTree, type WalkHistory, type WalkStore } from '../presentation/tiles/tree-walk.js'
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

type RailStore = WalkStore & ThumbnailStore

/** Enough for any real page; a level larger than this is truncated silently
 *  rather than hanging the rail — the canvas behind it still shows it all. */
const MAX_ROWS = 500

/** Hold-to-enter, matched to the hive's own (TILE_ENTER_HOLD_MS in
 *  presentation/tiles/tile-overlay.drone.ts). The same wait means the same
 *  gesture: whatever the hands learned on the hexagons works in the list. */
const ENTER_HOLD_MS = 450

/** A press that wanders this far was a scroll, not a hold. */
const HOLD_SLOP = 9

const pathKey = (segments: readonly string[]): string => segments.join('\u0000')

/** The inverse of {@link pathKey} — a row's own key back to its segments, so
 *  the separator is written down exactly once. */
const keySegments = (key: string): string[] => key.split('\u0000').filter(Boolean)

/** Which chat you were last in, per tile. */
const STICKY_KEY = 'hc:rail-chat'

/** What a dragged row carries. Shared with the chat window's header boxes —
 *  the shell may not import this module, so the CONTRACT is the mime type and
 *  the JSON shape, not a type. */
export const TILE_DRAG_TYPE = 'application/x-hypercomb-tile'

const STYLE_ID = 'hc-tiles-rail-styles'
const STEEL = '126, 182, 214'
/** Amber says THE HIVE: work in flight, or something waiting for you. It is
 *  never used for your own unsent words — those wear the name's white. */
const AMBER = '226, 196, 140'

/** The rail's own stylesheet — installed on first mount so the rail reads
 *  identically inside the agent panel and the chat window. Host geometry
 *  (where the rail sits, how wide) stays with whichever surface mounts it. */
const ensureRailStyles = (): void => {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
.hc-rail-head{display:flex;align-items:center;gap:0.35rem;flex:0 0 auto;
  padding:0.8rem 0.85rem 0.5rem;}
.hc-rail-back{width:1.7rem;height:1.9rem;flex:0 0 auto;border:none;background:none;
  color:rgba(${STEEL},0.75);font-size:1.4rem;line-height:1;cursor:pointer;border-radius:var(--hc-radius-control, 2px);}
.hc-rail-back:hover{color:whitesmoke;background:rgba(255,255,255,0.07);}
.hc-rail-back[hidden]{display:none;}
.hc-rail-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-family:var(--hc-mono,monospace);font-size:0.72rem;font-weight:600;letter-spacing:0.12em;
  text-transform:uppercase;color:rgba(${STEEL},0.85);}
.hc-rail-find{flex:0 0 auto;padding:0 0.85rem 0.5rem;}
.hc-rail-find input{width:100%;box-sizing:border-box;padding:0.33rem 0.55rem;border-radius:var(--hc-radius-control, 2px);
  border:1px solid rgba(${STEEL},0.22);background:rgba(255,255,255,0.04);
  color:rgba(238,244,250,0.92);font:inherit;font-size:0.8rem;}
.hc-rail-find input::placeholder{color:rgba(216,230,238,0.35);}
.hc-rail-find input:focus{outline:none;border-color:rgba(${STEEL},0.55);
  background:rgba(255,255,255,0.06);}
.hc-rail-find input::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none;
  width:0.7rem;height:0.7rem;cursor:pointer;background:rgba(${STEEL},0.7);
  mask:conic-gradient(from 45deg,#000 0 100%) 50%/0.16rem 100%,
    conic-gradient(from 45deg,#000 0 100%) 50%/100% 0.16rem;
  mask-repeat:no-repeat;transform:rotate(45deg);}
.hc-rail-list{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;
  gap:2px;padding:0.15rem 0.5rem 0.7rem;scrollbar-width:thin;
  scrollbar-color:rgba(${STEEL},0.3) transparent;}
@keyframes hcRailIn{from{opacity:0;transform:translateX(0.6rem);}to{opacity:1;transform:none;}}
@keyframes hcRailOut{from{opacity:0;transform:translateX(-0.6rem);}to{opacity:1;transform:none;}}
.hc-rail-row{display:flex;align-items:center;border-radius:var(--hc-radius-control, 2px);}
.hc-rail-row:hover{background:rgba(255,255,255,0.05);}
.hc-rail-row.holding{background:rgba(${STEEL},0.16);transition:background 0.12s ease;}
.hc-rail-row.current{background:rgba(${STEEL},0.1);box-shadow:inset 0 0 0 1px rgba(${STEEL},0.4);}
.hc-rail-main{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:0.6rem;
  padding:0.35rem 0.2rem 0.35rem 0.45rem;border:0;background:none;text-align:left;font:inherit;
  cursor:pointer;border-radius:var(--hc-radius-control, 2px);color:inherit;}
.hc-rail-main:focus-visible{outline:1px solid rgba(${STEEL},0.6);outline-offset:-1px;}
.hc-rail-icon{width:2.15rem;height:2.15rem;flex:0 0 auto;border-radius:var(--hc-radius-card, 3px);overflow:hidden;
  display:grid;place-items:center;background:rgba(${STEEL},0.08);
  border:1px solid rgba(${STEEL},0.14);color:rgba(${STEEL},0.55);
  font-size:0.95rem;font-weight:600;}
.hc-rail-icon img{width:100%;height:100%;object-fit:cover;display:block;}
.hc-rail-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:0.86rem;color:rgba(238,244,250,0.92);}
.hc-rail-bees{flex:0 0 auto;min-width:1.15rem;text-align:center;padding:0.06rem 0.3rem;
  border-radius:999px;border:1px solid rgba(226,196,140,0.5);color:rgba(226,196,140,0.95);
  font-size:0.66rem;line-height:1.2;}
.hc-rail-bees[hidden]{display:none;}
.hc-rail-chev{flex:0 0 auto;color:rgba(216,230,238,0.35);font-size:1.05rem;line-height:1;
  padding-right:0.1rem;}
.hc-rail-chev[hidden]{display:none;}
.hc-rail-draft{flex:0 0 auto;width:0.42rem;height:0.42rem;margin-right:0.55rem;
  border-radius:999px;background:rgba(226,196,140,0.9);}
.hc-rail-draft[hidden]{display:none;}
.hc-rail-skel{height:2.5rem;border-radius:var(--hc-radius-control, 2px);background:rgba(255,255,255,0.045);
  animation:hcRailPulse 1.1s ease-in-out infinite;}
@keyframes hcRailPulse{0%,100%{opacity:0.5;}50%{opacity:1;}}
.hc-rail-empty{padding:0.9rem 0.45rem;font-size:0.78rem;color:rgba(216,230,238,0.45);}

/* ── WHAT A ROW HAS TO SAY ─────────────────────────────────────────────
   Three places, each meaning exactly one thing, so states co-occur without
   negotiating a slot:

     LEFT GUTTER  steel, vertical    the conversation — its depth, then unread
     ICON EDGE    white, horizontal  YOUR unsent sentence
     RIGHT DIGIT  amber, a numeral   work in flight; nothing to do but wait

   A dormant tile draws NOTHING. Forty quiet rows in fifty cost no ink, which
   is what makes the marks that are there worth looking at. Every mark is
   absolutely positioned or metric-neutral, so a state arriving can never
   re-ellipsize a name — the old inline draft dot did exactly that. */

.hc-rail-row{position:relative;}
.hc-rail-main{padding-left:0.85rem;}

/* THE GUTTER. One slot, centred whatever the mark's size, so growing the
   mark never moves it. */
.hc-rail-row::before{content:'';position:absolute;left:0.4rem;top:50%;
  transform:translate(-50%,-50%);width:2px;height:0;border-radius:1px;
  background:rgba(${STEEL},0.62);pointer-events:none;}

/* HISTORY — the tick is as tall as the conversation is deep: 6px at one
   turn, 14px from a dozen on. Height is pre-attentive, so a level reads as a
   ragged margin you scan for the deep ones without reading a word. */
.hc-rail-row.spoken::before{height:calc(6px + var(--hc-rail-depth, 0) * 8px);}

/* UNREAD — the tick becomes a SEALED COMB CELL: the house pointy-top
   hexagon, the only one in the list, the only amber in the gutter. Shape
   carries it and colour only agrees. Must stay after .spoken — equal
   specificity, source order decides. */
.hc-rail-row.unread::before{width:0.58rem;height:0.66rem;border-radius:0;
  background:rgba(${AMBER},0.95);
  clip-path:polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);}

/* The name is the cheapest mark of all: dormant sits back, anything spoken
   to steps forward, unread thickens with text-stroke — which has no glyph
   advance, so the ellipsis point never moves. */
.hc-rail-name{color:rgba(238,244,250,0.62);}
.hc-rail-row.spoken .hc-rail-name,
.hc-rail-row.draft .hc-rail-name{color:rgba(238,244,250,0.92);}
.hc-rail-row.unread .hc-rail-name{color:rgba(246,250,255,0.99);
  -webkit-text-stroke:0.35px currentColor;}

/* DRAFT — your unsent thinking, laid under the thing it is about: a white
   rule inside the picture's bottom edge over a dark hairline, so it holds on
   a bright photograph. ::after, never an inset shadow — the <img> paints
   over those. */
.hc-rail-icon{position:relative;}
.hc-rail-row.draft .hc-rail-icon::after{content:'';position:absolute;
  left:0;right:0;bottom:0;height:3px;pointer-events:none;
  background:linear-gradient(rgba(8,12,18,0.85) 0 1px,rgba(238,244,250,0.85) 1px 3px);}

/* A SET ACTIVE TOGETHER. The bracket is one line down the right edge of the
   run, capped where the run starts and ends — the typographic brace, which is
   the oldest way of saying "these, together". It sits opposite the gutter so
   it can never be read as a conversation state. */
.hc-rail-row.grouped{box-shadow:inset -2px 0 0 rgba(${STEEL},0.55);}
.hc-rail-row.grouped::after{content:'';position:absolute;right:0;width:0.5rem;
  height:2px;background:rgba(${STEEL},0.55);pointer-events:none;opacity:0;}
.hc-rail-row.grouped-first::after{opacity:1;top:2px;}
.hc-rail-row.grouped-last::after{opacity:1;bottom:2px;top:auto;}
.hc-rail-row.grouped-first.grouped-last::after{opacity:1;top:50%;}

/* CHOSEN — gathered as context for the next request. A ring on the picture
   and a tick in its corner: it belongs to the tile as an OBJECT, which is
   what a signature in a payload is, and it stays clear of all three state
   places so a chosen row can still be deep, unread and drafting at once. */
.hc-rail-row.chosen .hc-rail-icon{box-shadow:0 0 0 2px rgba(${STEEL},0.95);}
.hc-rail-row.chosen .hc-rail-icon::before{content:'';position:absolute;z-index:1;
  left:2px;top:2px;width:0.62rem;height:0.62rem;border-radius:50%;
  background:rgba(${STEEL},0.95);
  clip-path:polygon(50% 0,100% 0,100% 100%,0 100%,0 0);
  box-shadow:inset 0 0 0 2px #0c1118;}
.hc-rail-row.chosen{background:rgba(${STEEL},0.07);}

/* LIVE — the count, no ring. A digit is information a colour cannot be, and
   it is its own reduced-motion fallback: the breath is affect, the numeral
   is the fact. The slot is held open always, so a bee arriving never
   reflows the name. */
.hc-rail-bees{flex:0 0 auto;width:1.05rem;min-width:0;overflow:hidden;
  padding:0;border:0;border-radius:0;background:none;text-align:center;
  font-family:var(--hc-mono,monospace);font-size:0.68rem;font-weight:600;
  line-height:1;font-variant-numeric:tabular-nums;color:rgba(${AMBER},0.95);}
.hc-rail-bees[hidden]{display:block;visibility:hidden;}
@keyframes hcRailBreath{0%,100%{opacity:0.5;}50%{opacity:1;}}
.hc-rail-bees:not([hidden]){animation:hcRailBreath 2.6s ease-in-out infinite;}

/* THE ARROW IS A CONTROL. It opens the tile's conversations, so it needs a
   real hit area and a real focus ring — and it must stop failing contrast:
   0.35 was 2.76:1 on this ground, 0.44 is 3.69:1. */
.hc-rail-chev{flex:0 0 auto;width:1.4rem;height:1.7rem;margin-right:0.15rem;
  border:0;background:none;cursor:pointer;
  color:rgba(216,230,238,0.44);font-size:1.05rem;line-height:1;
  border-radius:var(--hc-radius-control, 2px);
  transition:transform 0.14s ease,color 0.14s ease;}
.hc-rail-chev:hover{color:rgba(238,244,250,0.9);background:rgba(255,255,255,0.06);}
.hc-rail-chev:focus-visible{outline:1px solid rgba(${STEEL},0.6);outline-offset:-1px;}
.hc-rail-chev[aria-expanded="true"]{transform:rotate(90deg);color:rgba(${STEEL},0.95);}

/* THE TILE'S CONVERSATIONS, unfolded under its row. Indented to the width of
   the picture so they read as belonging to it, and quiet enough that an open
   panel never competes with the list it sits inside. */
.hc-rail-chats{display:flex;flex-direction:column;gap:1px;
  margin:1px 0 4px 3.4rem;padding-left:0.5rem;
  border-left:1px solid rgba(${STEEL},0.25);}
.hc-rail-chat{display:flex;align-items:baseline;gap:0.5rem;width:100%;
  padding:0.28rem 0.45rem;border:0;background:none;cursor:pointer;
  text-align:left;font:inherit;font-size:0.8rem;
  color:rgba(238,244,250,0.72);border-radius:var(--hc-radius-control, 2px);}
.hc-rail-chat:hover{background:rgba(255,255,255,0.05);color:rgba(238,244,250,0.95);}
.hc-rail-chat:focus-visible{outline:1px solid rgba(${STEEL},0.6);outline-offset:-1px;}
.hc-rail-chat.current{background:rgba(${STEEL},0.12);color:rgba(238,244,250,0.98);
  box-shadow:inset 2px 0 0 rgba(${STEEL},0.9);}
.hc-rail-chat.unread{color:rgba(246,250,255,0.99);}
.hc-rail-chat.unread .hc-rail-chat-name::after{content:'';display:inline-block;
  width:0.42rem;height:0.48rem;margin-left:0.35rem;vertical-align:baseline;
  background:rgba(${AMBER},0.95);
  clip-path:polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);}
.hc-rail-chat-name{flex:1 1 auto;min-width:0;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;}
.hc-rail-chat-meta{flex:0 0 auto;font-family:var(--hc-mono,monospace);
  font-size:0.68rem;color:rgba(216,230,238,0.5);}
.hc-rail-chat-new{color:rgba(${STEEL},0.9);}

/* Same defect, same pass: placeholder text needs 4.5:1, not 2.76:1. */
.hc-rail-find input::placeholder{color:rgba(216,230,238,0.6);}

@media (prefers-reduced-motion:reduce){
  .hc-rail-bees:not([hidden]){animation:none;opacity:1;}
  .hc-rail-list{animation:none !important;}
}
`
  document.head.appendChild(style)
}

export class AgentTilesRail {
  #host: HTMLElement | null = null
  #back: HTMLButtonElement | null = null
  #title: HTMLSpanElement | null = null
  #find: HTMLInputElement | null = null
  #list: HTMLDivElement | null = null
  /** What the search box holds — a filter over THIS level's names, kept
   *  across re-mounts like the trail, dropped whenever the level changes. */
  #query = ''
  /** The trail of levels, root first; the last entry is what the list shows. */
  #trail: string[][] = [[]]
  /** Levels already walked — "back" repaints instantly, then refreshes. */
  readonly #levels = new Map<string, RailRow[]>()
  /** propsSig → object URL (null: looked, no picture to be had). */
  readonly #icons = new Map<string, string | null>()
  /** propsSig being read → the icon elements waiting on it. */
  readonly #waiters = new Map<string, Set<HTMLElement>>()
  /** The row you are IN — the conversation everything typed belongs to. */
  #subject: RailPick | null = null
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
  /** A hold already acted — eat the click that ends the same press. */
  #swallowClick = false
  /** The level changed from the keyboard: put focus on the level that
   *  arrives, or the keyboard is stranded on a row that no longer exists. */
  #focusFirstRow = false
  #registry: AgentRegistry | undefined
  /** Guards stale walks: only the newest load may touch the list. */
  #epoch = 0
  #disposed = false
  /** The trail seeds from the participant's location once — a RE-mount (the
   *  panel swapping subjects rebuilds its DOM) keeps the trail as it stood. */
  #seeded = false

  /** The surface listens here to follow the participant into a conversation. */
  onSubjectChanged: (subject: RailPick | null) => void = () => {}

  readonly #onRegistryChange = (): void => this.#paintStatus()
  #dropDraftWatch: (() => void) | null = null
  #dropChatWatch: (() => void) | null = null
  #dropBusyWatch: (() => void) | null = null
  #dropGroupWatch: (() => void) | null = null

  /** The tile whose conversation is open, or null before anything is chosen. */
  get subject(): RailPick | null { return this.#subject }

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
    back.textContent = '‹'
    back.addEventListener('click', () => this.#up())
    const title = document.createElement('span')
    title.className = 'hc-rail-title'
    head.append(back, title)
    this.#back = back
    this.#title = title

    // Search sits under the title, above the rows: a level of a real hive
    // runs to dozens of tiles, and typing two letters is faster than
    // scrolling for one. It filters the level in the hand — no walk, no
    // wait — and Escape empties it before the escape cascade sees the key.
    const find = document.createElement('div')
    find.className = 'hc-rail-find'
    const search = document.createElement('input')
    search.type = 'search'
    search.value = this.#query
    search.autocomplete = 'off'
    search.spellcheck = false
    const findLabel = this.#t('agent.rail-find', 'Search this level')
    search.placeholder = findLabel
    search.setAttribute('aria-label', findLabel)
    search.addEventListener('input', () => this.#setQuery(search.value))
    search.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !this.#query) return
      event.stopPropagation()
      event.preventDefault()
      this.#setQuery('')
    })
    find.appendChild(search)
    this.#find = search

    const list = document.createElement('div')
    list.className = 'hc-rail-list'
    list.setAttribute('role', 'list')
    this.#list = list

    host.append(head, find, list)

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
    host.addEventListener('contextmenu', event => {
      event.preventDefault()
      this.#up()
    })

    this.#registry = ioc<AgentRegistry>('@diamondcoreprocessor.com/AgentRegistry')
    this.#registry?.removeEventListener('change', this.#onRegistryChange)
    this.#registry?.addEventListener('change', this.#onRegistryChange)

    // The marks follow the pool, not this surface: a draft written from the
    // composer, from another window, or by a sweep shows up here the same way.
    this.#dropDraftWatch?.()
    this.#dropDraftWatch = EffectBus.on('chat:drafts-changed', () => { void this.#refreshDrafts() })
    this.#dropChatWatch?.()
    this.#dropChatWatch = EffectBus.on('chat:threads-changed', () => { void this.#refreshChats() })
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
    void this.#refreshDrafts()
    void this.#refreshChats()

    void this.#load(0)
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
    this.#dropDraftWatch?.()
    this.#dropDraftWatch = null
    this.#dropChatWatch?.()
    this.#dropChatWatch = null
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
    this.#query = ''
    if (this.#find) this.#find.value = ''
    this.#trail.push([...segments])
    void this.#load(1)
  }

  #up(): void {
    if (this.#trail.length <= 1) return
    this.#query = ''
    if (this.#find) this.#find.value = ''
    this.#trail.pop()
    void this.#load(-1)
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
    if (!this.#query) return rows
    const needle = this.#query.toLowerCase()
    return rows.filter(row => row.name.toLowerCase().includes(needle))
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

    if (this.#title) this.#title.textContent = path[path.length - 1] ?? this.#t('agent.rail-root', 'hive')
    if (this.#back) {
      this.#back.hidden = this.#trail.length <= 1
      const parent = this.#trail[this.#trail.length - 2]
      const label = this.#t('agent.rail-back', 'Back to {name}')
        .replace('{name}', parent?.[parent.length - 1] ?? this.#t('agent.rail-root', 'hive'))
      this.#back.title = label
      this.#back.setAttribute('aria-label', label)
    }

    list.textContent = ''
    if (direction !== 0) {
      // Restart the slide even when one is mid-flight: none → reflow → set.
      list.style.animation = 'none'
      void list.offsetWidth
      list.style.animation = `${direction > 0 ? 'hcRailIn' : 'hcRailOut'} 0.18s ease`
    }

    if (rows === null) {
      for (let i = 0; i < 4; i++) {
        const skeleton = document.createElement('div')
        skeleton.className = 'hc-rail-skel'
        skeleton.style.animationDelay = `${i * 0.09}s`
        list.appendChild(skeleton)
      }
      return
    }

    if (!rows.length) {
      const empty = document.createElement('div')
      empty.className = 'hc-rail-empty'
      empty.textContent = this.#t('agent.rail-empty', 'Nothing inside this tile yet.')
      list.appendChild(empty)
      return
    }

    const visible = this.#matching(rows)
    if (!visible.length) {
      const empty = document.createElement('div')
      empty.className = 'hc-rail-empty'
      empty.textContent = this.#t('agent.rail-no-match', 'No tile here matches “{query}”.')
        .replace('{query}', this.#query)
      list.appendChild(empty)
      return
    }

    const counts = this.#agentCounts()
    const talkHint = this.#t('agent.rail-talk', 'Talk to this tile')
    // Short on purpose: a tooltip on every row is furniture, and the one
    // gesture worth teaching there is the hold. The keyboard moves answer to
    // the arrow keys a list is already expected to honour.
    const insideHint = this.#t('agent.rail-inside', 'hold to go inside')
    for (const row of visible) {
      const key = pathKey(row.segments)
      const current = this.#subject?.key === key
      const wrap = document.createElement('div')
      wrap.className = 'hc-rail-row'
      wrap.dataset['key'] = key
      wrap.setAttribute('role', 'listitem')
      wrap.classList.toggle('current', current)
      wrap.classList.toggle('chosen', this.#chosen.has(key))

      const main = document.createElement('button')
      main.type = 'button'
      main.className = 'hc-rail-main'
      main.title = row.childCount ? `${talkHint} · ${insideHint}` : talkHint
      // The conversation you are in, said to a screen reader as well as to
      // the eye — `current` is only a background colour.
      if (current) main.setAttribute('aria-current', 'true')
      // Chosen is a TOGGLE, and a toggle says so: aria-pressed is the whole
      // difference between "this row is lit" and "this row is switched on".
      main.setAttribute('aria-pressed', this.#chosen.has(key) ? 'true' : 'false')

      const icon = document.createElement('span')
      icon.className = 'hc-rail-icon'
      icon.textContent = [...row.name.trim()][0]?.toUpperCase() ?? '·'
      if (row.propsSig) this.#settleIcon(icon, row.propsSig)

      const name = document.createElement('span')
      name.className = 'hc-rail-name'
      name.textContent = row.name

      const bees = document.createElement('span')
      bees.className = 'hc-rail-bees'
      const busy = counts.get(key) ?? 0
      bees.textContent = String(busy)
      bees.hidden = busy === 0

      main.append(icon, name, bees)

      // CLICK TALKS, CTRL-CLICK CHOOSES, HOLD GOES IN. A plain click can never
      // navigate — it is the gesture you make while mid-thought, so it only
      // ever changes who you are talking to. Ctrl-click gathers context and
      // never moves the list either. Going deeper is the deliberate one, and
      // it is the hive's own hold-to-enter, so the list is walked with the
      // gesture the hands already know.
      if (row.childCount > 0) this.#armHold(main, wrap, row)
      main.addEventListener('click', event => {
        // The hold already went in; the click that ends it must not also
        // drag the conversation to the row we just left.
        if (this.#swallowClick) { this.#swallowClick = false; return }
        if (event.ctrlKey || event.metaKey) this.#toggleChosen(wrap, key, row)
        else this.#enter(wrap, key, row)
      })

      // THE SAME THREE MOVES, FROM THE KEYBOARD. Hold and right-click are
      // pointer gestures, and a list you can only walk with a mouse is a
      // list some people cannot walk at all: → goes inside, ← comes back
      // out, ↑↓ move between rows, and Enter (the button's own default) is
      // the click that opens the conversation.
      main.addEventListener('keydown', event => {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        if (event.key === 'ArrowRight') {
          if (row.childCount === 0) return
          event.preventDefault()
          this.#focusFirstRow = true
          this.#drill(row.segments)
        } else if (event.key === 'ArrowLeft') {
          if (this.#trail.length <= 1) return
          event.preventDefault()
          this.#focusFirstRow = true
          this.#up()
        } else if (event.key === ' ' || event.key === 'Spacebar') {
          // The keyboard's ctrl-click. Enter still opens the conversation.
          event.preventDefault()
          this.#toggleChosen(wrap, key, row)
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          this.#step(wrap, event.key === 'ArrowDown' ? 1 : -1)
        }
      })

      // A ROW IS DRAGGABLE, because the header's boxes are where a request is
      // composed and dragging is how you fill them. What travels is the tile's
      // SIGNATURE plus enough to name it on screen — never a live object, so
      // the drop is the same whether it lands now or after a reload.
      main.draggable = true
      main.addEventListener('dragstart', event => {
        const payload = JSON.stringify({ name: row.name, path: tilePath(row.segments), sig: row.sig ?? '' })
        event.dataTransfer?.setData(TILE_DRAG_TYPE, payload)
        event.dataTransfer?.setData('text/plain', tilePath(row.segments))
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
      })

      // THE ARROW OPENS THE TILE'S CHATS. It is its own control, not part of
      // the row: pressing it must never change who you are talking to, only
      // show you what there is to talk in.
      const chevron = document.createElement('button')
      chevron.type = 'button'
      chevron.className = 'hc-rail-chev'
      chevron.textContent = '›'
      const chatsLabel = this.#t('agent.rail-chats', 'Conversations on this tile')
      chevron.title = chatsLabel
      chevron.setAttribute('aria-label', chatsLabel)
      chevron.setAttribute('aria-expanded', this.#expanded.has(key) ? 'true' : 'false')
      chevron.addEventListener('click', event => {
        event.stopPropagation()
        this.#toggleChats(key, row)
      })

      wrap.append(main, chevron)
      list.appendChild(wrap)
      if (this.#expanded.has(key)) list.appendChild(this.#chatsPanel(key, row))
    }

    // The rows exist; now say what each one holds.
    this.#paintStatus()

    // After a level change the focus that was on a now-removed row would be
    // lost to the body, stranding a keyboard mid-list. Put it on the first
    // row of the level that just arrived — but only when the rail is where
    // the participant already was.
    if (this.#focusFirstRow) {
      this.#focusFirstRow = false
      list.querySelector<HTMLElement>('.hc-rail-main')?.focus()
    }
  }

  /** Move focus one row up or down, staying inside the level. */
  #step(from: HTMLElement, delta: 1 | -1): void {
    const rows = [...(this.#list?.querySelectorAll<HTMLElement>('.hc-rail-row') ?? [])]
    const index = rows.indexOf(from)
    if (index < 0) return
    rows[Math.min(rows.length - 1, Math.max(0, index + delta))]?.querySelector<HTMLElement>('.hc-rail-main')?.focus()
  }

  /** Hold a row to go inside it. Cancelled by a pointer that wanders (that
   *  was a scroll), by lifting early (that was a click), and by the level
   *  changing under it. */
  #armHold(main: HTMLElement, wrap: HTMLElement, row: RailRow): void {
    let timer: ReturnType<typeof setTimeout> | null = null
    let from: { x: number; y: number } | null = null

    const stop = (): void => {
      if (timer !== null) { clearTimeout(timer); timer = null }
      from = null
      wrap.classList.remove('holding')
    }

    main.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      from = { x: event.clientX, y: event.clientY }
      wrap.classList.add('holding')
      timer = setTimeout(() => {
        timer = null
        stop()
        // Swallow the click this press will end with — on touch it arrives
        // after the hold has already moved the list.
        this.#swallowClick = true
        this.#drill(row.segments)
      }, ENTER_HOLD_MS)
    })
    main.addEventListener('pointermove', event => {
      if (!from) return
      if (Math.abs(event.clientX - from.x) > HOLD_SLOP || Math.abs(event.clientY - from.y) > HOLD_SLOP) stop()
    })
    for (const name of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      main.addEventListener(name, stop)
    }
  }

  /** Fold a tile's conversations open or shut. */
  #toggleChats(key: string, row: RailRow): void {
    if (this.#expanded.has(key)) this.#expanded.delete(key)
    else this.#expanded.add(key)
    this.#renderLevel(this.#here(), this.#levels.get(pathKey(this.#here())) ?? null, 0)
  }

  /** Repaint open panels in place when the thread pool moves under them. */
  #repaintExpanded(): void {
    const list = this.#list
    if (!list) return
    for (const panel of list.querySelectorAll<HTMLElement>('.hc-rail-chats')) {
      const key = panel.dataset['key'] ?? ''
      const rows = this.#levels.get(pathKey(this.#here())) ?? []
      const row = rows.find(candidate => pathKey(candidate.segments) === key)
      if (row) panel.replaceWith(this.#chatsPanel(key, row))
    }
  }

  /** THE TILE'S CONVERSATIONS. Every thread that names this tile, newest
   *  first, plus the way to start another — because a tile is a subject and
   *  two subjects' worth of thinking should not share one transcript. */
  #chatsPanel(key: string, row: RailRow): HTMLElement {
    const path = tilePath(row.segments)
    const panel = document.createElement('div')
    panel.className = 'hc-rail-chats'
    panel.dataset['key'] = key
    panel.setAttribute('role', 'list')

    const chats = this.#chatsFor(path)
    const open = this.#subject?.convoId ?? this.#stickyChat(path)

    for (const chat of chats) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'hc-rail-chat'
      item.setAttribute('role', 'listitem')
      item.classList.toggle('current', chat.convoId === open)
      if (chat.unread) item.classList.add('unread')

      const title = document.createElement('span')
      title.className = 'hc-rail-chat-name'
      title.textContent = chat.title || this.#t('agent.rail-chat-untitled', 'Untitled')

      const meta = document.createElement('span')
      meta.className = 'hc-rail-chat-meta'
      meta.textContent = this.#t('agent.rail-turns', '{count} turns').replace('{count}', String(chat.turns))

      item.append(title, meta)
      item.addEventListener('click', event => {
        event.stopPropagation()
        this.#enterChat(row, key, chat.convoId)
      })
      panel.appendChild(item)
    }

    const fresh = document.createElement('button')
    fresh.type = 'button'
    fresh.className = 'hc-rail-chat hc-rail-chat-new'
    fresh.textContent = this.#t('agent.rail-chat-new', '+ New conversation')
    fresh.addEventListener('click', event => {
      event.stopPropagation()
      // The FIRST chat on a tile is the derived id — no suffix, no
      // bookkeeping. Only a second one needs minting.
      const id = chats.length ? newTileConvoId(row.segments) : tileConvoId(row.segments)
      this.#enterChat(row, key, id)
    })
    panel.appendChild(fresh)
    return panel
  }

  /** Enter one named conversation on a tile, and remember it as this tile's
   *  chat so coming back resumes it. */
  #enterChat(row: RailRow, key: string, convoId: string): void {
    const path = tilePath(row.segments)
    this.#rememberChat(path, convoId)
    const wrap = this.#list?.querySelector<HTMLElement>(`.hc-rail-row[data-key="${CSS.escape(key)}"]`)
    if (wrap) this.#markCurrent(wrap)
    this.#subject = { key, path: row.segments.slice(0, -1), name: row.name, sig: row.sig, convoId }
    this.onSubjectChanged(this.#subject)
    this.#repaintExpanded()
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

  /** Enter a row's conversation. One at a time: the previous row lets go, so
   *  what you type after this belongs to the tile you just clicked. */
  #enter(wrap: HTMLElement, key: string, row: RailRow): void {
    this.#markCurrent(wrap)
    // Clicking the row resumes the chat you were last in on this tile, or its
    // first one. Which conversation you land in is never a surprise.
    const path = tilePath(row.segments)
    const convoId = this.#stickyChat(path) || tileConvoId(row.segments)
    this.#rememberChat(path, convoId)
    this.#subject = { key, path: row.segments.slice(0, -1), name: row.name, sig: row.sig, convoId }
    this.onSubjectChanged(this.#subject)
    this.#repaintExpanded()
  }

  /** Light exactly one row as the conversation in hand — in colour AND in the
   *  accessibility tree, which is the half a class toggle silently skips. */
  #markCurrent(wrap: HTMLElement | null): void {
    for (const other of this.#list?.querySelectorAll('.hc-rail-row.current') ?? []) {
      other.classList.remove('current')
      other.querySelector('.hc-rail-main')?.removeAttribute('aria-current')
    }
    if (!wrap) return
    wrap.classList.add('current')
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

  /** Which tiles hold a conversation at all, and whether it has been read. */
  async #refreshChats(): Promise<void> {
    let chats: TileConversation[] = []
    try { chats = await listTileConversations() } catch { return }
    if (this.#disposed) return
    this.#chatList = chats
    this.#chats = foldTileConversations(chats)
    this.#paintStatus()
    // An unfolded list showing yesterday's threads is worse than none.
    if (this.#expanded.size) this.#repaintExpanded()
  }

  /** The conversations on one tile, newest first. */
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

      // LIVE is agents on the tile plus a question of your own still out —
      // one number, because from the row's side they are the same fact.
      const busy = (counts.get(key) ?? 0) + (this.#busy.has(path) ? 1 : 0)
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
// The chat window lives in hypercomb-shared, and shared must never import
// essentials — so the rail is offered structurally, the same loose-IoC seam
// TileContext uses. A fresh rail per call: each surface keeps its own trail
// and picks.
window.ioc.register('@diamondcoreprocessor.com/AgentTilesRailFactory', {
  create: (): AgentTilesRail => new AgentTilesRail(),
})
