// diamondcoreprocessor.com/assistant/agent-tiles-rail.ts
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
//   click        GO INSIDE it — a row with children opens, the way a row with
//                children opens in every other list in the shell. A LEAF has
//                nowhere to go, so there a click enters the tile's
//                conversation instead. (Hold-to-enter is retired: the rail is
//                how you FIND a tile, and hiding the walk behind a press
//                nobody discovers made its ordinary gesture the one thing it
//                is not for.)
//   the chat     TALK ABOUT it — the icon unfolds conversations that actually
//   icon         hold an exchange and resumes the one you were last in. An
//                empty composer is already the way to begin the FIRST one, so
//                a tile nobody has spoken to shows no fold furniture at all.
//                A fold that DOES list conversations ends with one quiet
//                "+ New conversation" line — the way to the next thread. It
//                is a link, not a row: pressing it swaps the window to a
//                fresh composer and mints nothing; the conversation appears
//                in the list when its first turn lands and names it.
//   ctrl-click   CHOOSE it — add the tile to the context the next request
//                carries. Any number, gathered across any number of levels
//                (the choice survives walking in and out), because what is
//                being built is a LIST OF SIGNATURES: content-addressed, so
//                the same choice composes the same payload every time. Out in
//                the HIVE the same gathering is a per-tile ICON, not this
//                chord (assistant/chat-context-action.drone.ts) — on a
//                hexagon ctrl-click is already the selection toggle, and one
//                chord meaning two things by invisible state is the thing
//                this window was built to kill.
//   right-click  come back out
//
// All of them are pointer gestures, and a list that can only be walked with a
// mouse is a list some people cannot walk at all — so the same moves answer to
// the keyboard: → goes inside, ← comes back out, ↑↓ walk the rows, Space
// chooses, and the level that arrives takes the focus so a keyboard is never
// stranded on a row that no longer exists.
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
  newTileConvoId, readConversationSummary, setConversationArchived, tileConvoId,
  tilePath, tilePathOf,
  type TileConversation,
} from './chat-thread.js'
import { readBlurbs, type ChatBlurb } from './chat-blurb.js'
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

/** HOW A SURFACE WANTS THE LIST. The rail is the hive's one tile list — the
 *  chat window's sidebar and the notes panel's tile picker are the same rows,
 *  the same pictures, the same collapse-by-name, the same search box — but
 *  they are not the same JOB, so the parts that are about CHATS are optional.
 *
 *  Defaults are the chat window's, so the surface that has always mounted the
 *  rail keeps mounting it unchanged. */
export type RailProfile = {
  /** Can the list move? False keeps it on ONE level: no hold-to-enter, no
   *  back, no right-click out. The notes panel writes on the tiles of the
   *  location it is standing at — a row from a level below would open some
   *  other tile's notes under its name. */
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
  /** What the search box says it does. */
  readonly findLabel?: string
  /** What a click on a row does, for the row's tooltip. */
  readonly clickLabel?: string
}

const PROFILE_DEFAULTS: Required<Pick<RailProfile, 'walk' | 'chats' | 'choose'>> =
  { walk: true, chats: true, choose: true }

type RailStore = WalkStore & ThumbnailStore

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

/** GO INSIDE. The row talks; this chevron is the separate control that walks. */
const WALK_GLYPH = 'chevron_right'
const ARCHIVE_GLYPH = 'archive'
const UNARCHIVE_GLYPH = 'unarchive'

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
const RAIL_CSS = `
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
/* UP AND DOWN ONLY. A sideways scrollbar under a list of names is never
   the answer to anything — the names ellipsise and the rows fit, so a bar
   there means something is overflowing and the participant is being asked
   to go and find it. An overflow-y of auto alone could not say this: naming
   ONE axis makes the other compute to auto as well, so the bar arrived
   the moment anything (a fold row a hair too wide, the 0.6rem slide a
   level change rides in on) reached past the edge. Both axes are named.
   The cause is still fixed at the cause — this is the floor under it. */
.hc-rail-list{flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;
  display:flex;flex-direction:column;
  gap:2px;padding:0.15rem 0.5rem 0.7rem;scrollbar-width:thin;
  scrollbar-color:rgba(${STEEL},0.3) transparent;}
@keyframes hcRailIn{from{opacity:0;transform:translateX(0.6rem);}to{opacity:1;transform:none;}}
@keyframes hcRailOut{from{opacity:0;transform:translateX(-0.6rem);}to{opacity:1;transform:none;}}
/* THE HIVE'S BLOCK. It is not a tile and must never be mistaken for one, so
   nothing about it is a tile's: a GOLD COMB CELL where a picture would be,
   the name in the hive's own uppercase letterforms, and a rule under it that
   says everything below is this page while this is the whole thing. */
.hc-rail-hive{margin-bottom:0.35rem;padding-bottom:0.3rem;
  border-bottom:1px solid rgba(${STEEL},0.18);}
.hc-rail-hive .hc-rail-name{font-family:var(--hc-mono,monospace);font-size:0.78rem;
  font-weight:600;letter-spacing:0.14em;text-transform:uppercase;
  color:rgba(${AMBER},0.92);}
.hc-rail-hive .hc-rail-main{padding-top:0.5rem;padding-bottom:0.5rem;}
.hc-rail-hive .hc-rail-row:hover{background:rgba(${AMBER},0.08);}
.hc-rail-hive.current{background:rgba(${AMBER},0.1);
  box-shadow:inset 0 0 0 1px rgba(${AMBER},0.42);}
.hc-rail-hive .hc-rail-chat.current{background:rgba(${AMBER},0.14);
  box-shadow:inset 2px 0 0 rgba(${AMBER},0.9);}
.hc-rail-hive .hc-rail-chat-new{color:rgba(${AMBER},0.85);}
/* Its gutter tick is the hive's colour too — the same sentence, said in the
   one place the eye is already reading state. */
.hc-rail-hive .hc-rail-row.spoken::before{background:rgba(${AMBER},0.7);}

/* A TILE'S BLOCK — its row, and under it whatever the row has unfolded. The
   lit edge goes here so an open tile is one object, never a box with a list
   loose beneath it. */
.hc-rail-group{display:flex;flex-direction:column;
  border-radius:var(--hc-radius-control, 2px);}
.hc-rail-group.current{background:rgba(${STEEL},0.1);
  box-shadow:inset 0 0 0 1px rgba(${STEEL},0.4);}
.hc-rail-row{display:flex;align-items:center;border-radius:var(--hc-radius-control, 2px);}
.hc-rail-row:hover{background:rgba(255,255,255,0.05);}
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
.hc-rail-threads{flex:0 0 auto;font-family:var(--hc-mono,monospace);
  font-size:0.64rem;line-height:1;color:rgba(${STEEL},0.6);}
.hc-rail-threads[hidden]{display:none;}
.hc-rail-row.unread .hc-rail-threads{color:rgba(${AMBER},0.9);}
.hc-rail-bees{flex:0 0 auto;min-width:1.15rem;text-align:center;padding:0.06rem 0.3rem;
  border-radius:999px;border:1px solid rgba(226,196,140,0.5);color:rgba(226,196,140,0.95);
  font-size:0.66rem;line-height:1.2;}
.hc-rail-bees[hidden]{display:none;}
.hc-rail-walk{flex:0 0 auto;color:rgba(216,230,238,0.35);font-size:1.05rem;line-height:1;
  padding-right:0.1rem;}
.hc-rail-walk[hidden]{display:none;}
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

/* ACTIVE — something is happening in this conversation RIGHT NOW: a question
   of yours is still out, or an agent is working on the tile. It is the one
   state in this list that is about the present tense, so it is the one mark
   that MOVES: amber (which in this list already means the hive is doing
   something), breathing on the same slow cycle as the count at the other end
   of the row, so the two read as one fact said twice.

   Drawn even when the tile has never been spoken to — .spoken sets the
   height and a brand-new conversation has none, yet a question just sent is
   exactly when you most need to see WHICH line it went to. Sits before
   .unread on purpose: an unread reply has landed and is no longer in
   progress, so at equal specificity source order lets it win. */
.hc-rail-row.live::before{min-height:7px;background:rgba(${AMBER},0.85);
  animation:hcRailBreath 2.6s ease-in-out infinite;}

/* The hive's own tick is amber at rest (it is the hive), so live has to be
   told apart from it by more than colour: full strength, and the breath. */
.hc-rail-hive .hc-rail-row.live::before{background:rgba(${AMBER},0.95);}

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

/* THE WAY INSIDE A TILE. The row talks, so the control at its right edge
   walks. It fills the row top-to-bottom and derives width from height: a
   stable square Go target, never the old narrow floating glyph. */
.hc-rail-walk{flex:0 0 auto;align-self:stretch;aspect-ratio:1;
  width:auto;height:auto;box-sizing:border-box;padding:0;margin:0;
  display:grid;place-items:center;overflow:hidden;
  border:0;background:none;cursor:pointer;
  font-family:'Material Symbols Outlined','Material Symbols Rounded';
  font-weight:400;font-style:normal;letter-spacing:normal;text-transform:none;
  white-space:nowrap;direction:ltr;-webkit-font-feature-settings:'liga';
  font-feature-settings:'liga';-webkit-font-smoothing:antialiased;
  color:rgba(216,230,238,0.5);font-size:1.05rem;line-height:1;
  border-radius:var(--hc-radius-control, 2px);
  transition:color 0.14s ease,background 0.14s ease;}
.hc-rail-walk:hover{color:rgba(238,244,250,0.95);background:rgba(255,255,255,0.06);}
.hc-rail-walk:focus-visible{outline:1px solid rgba(${STEEL},0.6);outline-offset:-1px;}

/* THE TILE'S CONVERSATIONS, unfolded under its row. A SHORT step in, no rule
   down the side: the fold already says what they belong to, and a line plus a
   picture's worth of indent turned a list of two chats into a diagram. */
.hc-rail-chats{display:flex;flex-direction:column;gap:1px;
  margin:1px 0 4px 0.9rem;padding-left:0;}
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

/* A CHAT ROW IS TWO CONTROLS, not one: the name opens it, the mark at the end
   puts it away. So the row is the box and the name is a button inside it —
   otherwise archiving would be a button inside a button, which is not a thing
   the DOM allows and not a thing a screen reader can read out. The "+ New"
   row and the archive disclosure are still plain buttons wearing the same
   row styling, which is why the padding lives on the ROW and never on the
   body. */
/* THE ROW IS A COLUMN NOW, because a thread is named by TWO things: the first
   thing you said (the title, which is what you did not know yet) and what it
   turned out to be about (the blurb). The head keeps the old baseline row —
   name on the left, turn count on the right — and the blurb hangs under it.
   A row with no blurb draws exactly what it drew before. */
.hc-rail-chat-body{flex:1 1 auto;display:flex;flex-direction:column;
  align-items:stretch;gap:0.1rem;
  min-width:0;padding:0;border:0;background:none;cursor:pointer;
  text-align:left;font:inherit;color:inherit;}
.hc-rail-chat-head{display:flex;align-items:baseline;gap:0.5rem;min-width:0;}
/* ONE LINE IN THE LIST, the whole thing in the one you are IN. Forty rows are
   scanned, and a row that wraps to three lines stops the list being scannable;
   the conversation you have opened has the room to say more. */
.hc-rail-chat-blurb{font-size:0.72rem;line-height:1.25;
  color:rgba(216,230,238,0.6);overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;}
.hc-rail-chat.current .hc-rail-chat-blurb{white-space:normal;overflow:visible;
  color:rgba(216,230,238,0.72);}
/* THE POINTS, only on the open conversation — the list of things it decided,
   asked, built or left open. This is the "click it and it is clear" half:
   scanning gets one line, choosing gets the notes. */
.hc-rail-chat-points{flex:1 0 100%;margin:0 0 0.3rem;padding:0 0.45rem 0 1.35rem;
  font-size:0.7rem;line-height:1.35;color:rgba(216,230,238,0.55);}
.hc-rail-chat-points li{margin:0 0 0.12rem;}
.hc-rail-chat-body:focus-visible{outline:1px solid rgba(${STEEL},0.6);outline-offset:1px;}
/* IN THE OPEN, because it is on ONE row now. It used to be drawn on every
   conversation and kept at zero opacity until the pointer found it — a
   control nobody can see is a control nobody uses, and the reason it had to
   hide was that there were a dozen of them. There is one.

   THE SAME COLUMN AS THE BLOCK ABOVE IT. A square of the row's own height,
   flush to the fold's right edge, so its edge lines up with the chat block
   on the tile's row rather than floating a padding's width inside it. It
   takes its width from its height for the same reason that one does.

   STEEL, which in this list means THE CONVERSATION — never amber, which
   says the hive is doing something or waiting on you, and putting a thread
   away is neither. */
.hc-rail-chat-put{flex:0 0 auto;align-self:stretch;aspect-ratio:1;
  width:auto;height:auto;box-sizing:border-box;padding:0;margin:0;border:0;
  display:grid;place-items:center;overflow:hidden;
  background:none;cursor:pointer;
  font-family:'Material Symbols Outlined','Material Symbols Rounded';
  font-weight:400;font-style:normal;letter-spacing:normal;text-transform:none;
  white-space:nowrap;direction:ltr;-webkit-font-feature-settings:'liga';
  font-feature-settings:'liga';-webkit-font-smoothing:antialiased;
  font-size:1rem;line-height:1;color:rgba(${STEEL},0.8);
  border-radius:var(--hc-radius-control, 2px);
  transition:color 0.12s ease,background 0.12s ease;}
.hc-rail-chat-put:hover{color:rgba(${STEEL},1);background:rgba(${STEEL},0.18);}
.hc-rail-chat-put:focus-visible{outline:1px solid rgba(${STEEL},0.6);outline-offset:-1px;}
/* PUT AWAY, and it reads that way: dimmer than a live thread, so the section
   under the disclosure is visibly a different shelf. */
.hc-rail-chat.filed{color:rgba(238,244,250,0.48);}
.hc-rail-archived{color:rgba(216,230,238,0.5);font-size:0.72rem;
  font-family:var(--hc-mono,monospace);letter-spacing:0.04em;}
.hc-rail-archived.on{color:rgba(${STEEL},0.85);}

/* Same defect, same pass: placeholder text needs 4.5:1, not 2.76:1. */
.hc-rail-find input::placeholder{color:rgba(216,230,238,0.6);}

@media (prefers-reduced-motion:reduce){
  .hc-rail-bees:not([hidden]){animation:none;opacity:1;}
  /* The mark stays; only the breath goes. Amber in the gutter is still the
     whole of what "in progress" says. */
  .hc-rail-row.live::before{animation:none;}
  .hc-rail-list{animation:none !important;}
}
`

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

  readonly #onRegistryChange = (): void => this.#paintStatus()
  #dropDraftWatch: (() => void) | null = null
  #dropChatWatch: (() => void) | null = null
  #dropBlurbWatch: (() => void) | null = null
  /** What each conversation turned out to be about, by convoId. DERIVED and
   *  never load-bearing: a row whose blurb is missing, stale or wiped draws
   *  exactly as it did before blurbs existed. */
  #blurbs = new Map<string, ChatBlurb>()
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
    back.hidden = !this.#profile.walk
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
    const findLabel = this.#profile.findLabel ?? this.#t('agent.rail-find', 'Search this level')
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
    if (this.#profile.walk) {
      host.addEventListener('contextmenu', event => {
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
    if (this.#profile.chats) {
      this.#dropDraftWatch = EffectBus.on('chat:drafts-changed', () => { void this.#refreshDrafts() })
      this.#dropChatWatch = EffectBus.on<{ convoId?: string }>(
        'chat:threads-changed', payload => { void this.#chatChanged(String(payload?.convoId ?? '')) })
      // The label follows the POOL, not this surface: a blurb minted by the
      // orchestrator while the rail is open shows up without a reopen.
      this.#dropBlurbWatch = EffectBus.on('chat:blurbs-changed', () => { void this.#refreshBlurbs() })
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
  showCurrent(name: string | null): void {
    if (!name) { this.#subject = null; this.#markCurrent(null); return }
    const segments = [...this.#here(), name]
    const key = pathKey(segments)
    if (this.#subject?.key === key) return
    this.#subject = { key, path: [...this.#here()], name }
    this.#markCurrent(this.#rowFor(key))
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
    if (!this.#profile.walk) return
    this.#query = ''
    if (this.#find) this.#find.value = ''
    this.#trail.push([...segments])
    void this.#load(1)
  }

  #up(): void {
    if (!this.#profile.walk || this.#trail.length <= 1) return
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
    const admits = this.#profile.admits
    const listed = admits ? rows.filter(row => admits(row)) : rows
    if (!this.#query) return listed
    const needle = this.#query.toLowerCase()
    const also = this.#profile.matches
    return listed.filter(row =>
      row.name.toLowerCase().includes(needle)
      || this.#blurbMatches(row, needle)
      || (also ? also(row, this.#query) : false))
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
      // A find box with nothing standing says so; a level narrowed to nothing
      // by the surface itself is simply empty.
      empty.textContent = this.#query
        ? this.#t('agent.rail-no-match', 'No tile here matches “{query}”.').replace('{query}', this.#query)
        : this.#t('agent.rail-empty', 'Nothing inside this tile yet.')
      list.appendChild(empty)
      return
    }

    const counts = this.#agentCounts()
    const talkHint = this.#profile.clickLabel ?? this.#t('agent.rail-talk', 'Talk to this tile')
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
      main.title = talkHint
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

      // THE TILE TALKS; THE SQUARE GO CONTROL WALKS. Every row opens its
      // conversation, including parents. A second press on the current open
      // row folds its thread list without leaving the conversation.
      main.addEventListener('click', event => {
        if ((event.ctrlKey || event.metaKey) && this.#profile.choose) {
          this.#toggleChosen(wrap, key, row)
          return
        }
        if (current && this.#expanded.has(key)) { this.#toggleChats(key, row); return }
        this.#enter(wrap, key, row)
      })

      // THE SAME THREE MOVES, FROM THE KEYBOARD. Hold and right-click are
      // pointer gestures, and a list you can only walk with a mouse is a
      // list some people cannot walk at all: → goes inside, ← comes back
      // out, ↑↓ move between rows, and Enter (the button's own default) is
      // the click that opens the conversation.
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

      // GO INSIDE — a full-height square at the right edge, and absent on
      // leaves. It owns navigation so clicking anywhere else on the tile can
      // consistently open that tile's chat.
      const walk = document.createElement('button')
      walk.type = 'button'
      walk.className = 'hc-rail-walk'
      walk.hidden = !(row.childCount > 0 && this.#profile.walk)
      walk.textContent = WALK_GLYPH
      const walkLabel = this.#t('agent.rail-go', 'Go inside {name}').replace('{name}', row.name)
      walk.title = walkLabel
      walk.setAttribute('aria-label', walkLabel)
      walk.addEventListener('click', event => {
        event.stopPropagation()
        this.#drill(row.segments)
      })

      // ONE BLOCK PER TILE. The conversations are not a sibling of the row
      // they belong to — they are INSIDE it, so an unfolded tile is one
      // object with a lit edge around all of it. Appended beside the row,
      // they hung outside the lit box and read as belonging to nothing.
      const group = document.createElement('div')
      group.className = 'hc-rail-group'
      group.dataset['key'] = key
      group.classList.toggle('current', current)
      wrap.append(main, walk)
      group.appendChild(wrap)
      if (this.#profile.chats && this.#expanded.has(key)) group.appendChild(this.#chatsPanel(key, row))
      list.appendChild(group)
    }

    // The rows exist; now say what each one holds.
    this.#paintStatus()

    // After a level change the focus that was on a now-removed row would be
    // lost to the body, stranding a keyboard mid-list. Put it on the first
    // row of the level that just arrived — but only when the rail is where
    // the participant already was.
    if (this.#focusFirstRow) {
      this.#focusFirstRow = false
      // The first TILE, not the hive's row above them: the keyboard walked
      // into this level and the level is what it should land in.
      list.querySelector<HTMLElement>('.hc-rail-group:not(.hc-rail-hive) .hc-rail-main')?.focus()
    }
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
    // second grammar: it is the same one, on a row with no inside.
    main.addEventListener('click', event => {
      event.stopPropagation()
      if (current && this.#expanded.has(HIVE_KEY)) { this.#toggleChats(HIVE_KEY, row); return }
      this.#enterChat(row, HIVE_KEY, this.#stickyChat(tilePath([])) || tileConvoId([]))
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
   *  The fold ends with "+ New conversation" — the way to the NEXT thread on
   *  a tile that already holds some. It creates nothing: the press puts a
   *  fresh composer in the window, and the row appears only when the first
   *  turn lands and names it. Absent when the fold lists nothing, because
   *  there the empty composer IS the new conversation. */
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

      const title = document.createElement('span')
      title.className = 'hc-rail-chat-name'
      title.textContent = chat.title
        || (chat.turns
          ? this.#t('agent.rail-chat-untitled', 'Untitled')
          : this.#t('agent.rail-chat-fresh', 'New conversation'))

      const meta = document.createElement('span')
      meta.className = 'hc-rail-chat-meta'
      // "0 turns" is a fact nobody needs. A conversation with nothing in it
      // is named by being EMPTY, not by counting what is not there.
      meta.textContent = chat.turns
        ? this.#t('agent.rail-turns', '{count} turns').replace('{count}', String(chat.turns))
        : this.#t('agent.rail-chat-empty', 'empty')

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

      // THE ONE CONTROL, BOTH WAYS, ON ONE ROW. Archiving and un-archiving
      // are the same act with the flag flipped, so they are the same button —
      // no separate "restore" living somewhere else for you to go and find.
      //
      // AND IT IS ONLY ON THE CONVERSATION YOU ARE IN. A mark on every row
      // was a column of controls down the side of a list whose job is to be
      // scanned for a NAME, and hiding that column until the pointer was over
      // it only meant the control could not be found at all. One row carries
      // it, the row you are already reading, where it is worth the ink and
      // can stand in the open. An archived thread is reached the same way it
      // always was — click it, you are in it, and the way back out is right
      // there on it.
      if (chat.convoId === open) {
        const put = document.createElement('button')
        put.type = 'button'
        put.className = 'hc-rail-chat-put'
        put.textContent = chat.archived ? UNARCHIVE_GLYPH : ARCHIVE_GLYPH
        const label = chat.archived
          ? this.#t('agent.rail-chat-unarchive', 'Bring this conversation back')
          : this.#t('agent.rail-chat-archive', 'Archive this conversation')
        put.title = label
        put.setAttribute('aria-label', label)
        put.addEventListener('click', event => {
          event.stopPropagation()
          void this.#setArchived(key, chat, !chat.archived)
        })
        item.append(body, put)
        // THE LIST, on the conversation you are IN. On the ROW and not inside
        // the body, because the body is a <button> and a list inside a button
        // is not something the DOM allows or a screen reader can read out —
        // the same reason the archive mark is a sibling rather than a child.
        if (blurb?.points.length) {
          const points = document.createElement('ul')
          points.className = 'hc-rail-chat-points'
          for (const point of blurb.points) {
            const entry = document.createElement('li')
            entry.textContent = point
            points.append(entry)
          }
          item.append(points)
        }
        return item
      }

      item.append(body)
      return item
    }

    for (const chat of live) panel.appendChild(drawChat(chat))

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

    // THE WAY TO THE NEXT ONE, at the bottom where a list grows. A link,
    // not a row — it enters a freshly minted thread id without writing a
    // thing, so pressing it and walking away leaves no husk behind.
    if (chats.length) {
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

    return panel
  }

  /** Put a conversation away, or bring it back.
   *
   *  The local copy is flipped BEFORE the write and the fold repainted
   *  immediately: this is a one-press act on a row under the pointer, and a
   *  press that does nothing until a disk round-trip completes reads as a
   *  press that did not land. The pool is still the truth — the refresh
   *  behind it will correct an optimistic flip that failed.
   *
   *  Archiving the conversation you are IN leaves you in it. It is still
   *  open, still readable, still where what you type goes; what changed is
   *  where it sits in the list, and yanking someone out of a thread they can
   *  see is not what "put this away" asks for. */
  async #setArchived(key: string, chat: TileConversation, archived: boolean): Promise<void> {
    const index = this.#chatList.findIndex(entry => entry.convoId === chat.convoId)
    if (index >= 0) this.#chatList[index] = { ...this.#chatList[index]!, archived }
    // Bringing one back with the archive open must not leave the fold showing
    // a section that is now empty.
    if (!archived && !this.#chatList.some(entry => entry.archived && entry.path === chat.path)) {
      this.#archiveOpen.delete(key)
    }
    this.#repaintExpanded()
    await setConversationArchived(chat.convoId, archived)
    if (this.#disposed) return
    await this.#refreshChats()
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

  /** Enter a row's conversation. One at a time: the previous row lets go, so
   *  what you type after this belongs to the tile you just clicked. */
  #enter(wrap: HTMLElement, key: string, row: RailRow): void {
    this.#markCurrent(wrap)
    // Clicking the row resumes the chat you were last in on this tile, or its
    // first one. Which conversation you land in is never a surprise. A surface
    // with no chats picks the tile and nothing else.
    if (!this.#profile.chats) {
      this.#subject = { key, path: row.segments.slice(0, -1), name: row.name, sig: row.sig }
      this.onSubjectChanged(this.#subject)
      return
    }
    // Clicking a row is entering one of its conversations, so it UNFOLDS —
    // the sticky one you land in is lit, and the rest of the tile's threads
    // are there without a second gesture at the arrow.
    const path = tilePath(row.segments)
    this.#enterChat(row, key, this.#stickyChat(path) || tileConvoId(row.segments))
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
      // A conversation becomes a list item when an exchange exists. The
      // first user turn alone is still the composer waiting for its return.
      .filter((chat): chat is TileConversation => !!chat && (chat.archived || chat.turns >= 2))
    if (this.#disposed || !fresh.length) return
    const byId = new Map(this.#chatList.map(chat => [chat.convoId, chat]))
    for (const chat of fresh) byId.set(chat.convoId, chat)
    this.#chatList = [...byId.values()].sort((a, b) => b.lastAt - a.lastAt)
    this.#chats = foldTileConversations(this.#chatList)
    this.#paintStatus()
    if (this.#expanded.size) this.#repaintExpanded()
    void this.#refreshBlurbs()
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
    if (this.#expanded.size) this.#repaintExpanded()
  }

  /** Which tiles hold a conversation at all, and whether it has been read.
   *  ONE walk: a chat about no tile is filed at the hive's own address, so
   *  the tiles' threads and the hive's arrive together. */
  async #refreshChats(): Promise<void> {
    let chats: TileConversation[] = []
    try { chats = (await listRailConversations()).filter(chat => chat.archived || chat.turns >= 2) } catch { return }
    if (this.#disposed) return
    this.#chatList = chats
    this.#chats = foldTileConversations(chats)
    this.#paintStatus()
    // An unfolded list showing yesterday's threads is worse than none.
    if (this.#expanded.size) this.#repaintExpanded()
    void this.#refreshBlurbs()
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
window.ioc.register('@diamondcoreprocessor.com/AgentTilesRailFactory', {
  create: (profile?: RailProfile): AgentTilesRail => new AgentTilesRail(profile),
})
