// presentation/tiles/quick-tray.element.ts
//
// <hc-quick-tray> — THE SHELF. A full-width shelf under the header, in view
// whenever it holds the references you are carrying: a tile's shelf icon sends one
// here (`quick-tray:take`, PortalCarryDrone), the bottom-right "to shelf"
// button sends the selection, and a row dragged off it onto the hive places it
// (documentation/recents-and-the-quick-tray.md, codex A9). The clipboard it
// replaces is gone: nothing is cut or copied, only referenced.
//
// A framework-free custom element contributed through the ShellSurfaceRegistry
// by QuickTrayDrone (`element:` shape via IoC — never an app.html tag, never an
// Angular class), so the shim mounts it too. It takes the shell's vocabulary
// through custom properties that inherit across the shadow boundary (the
// radius ladder, the window inks, the pane, the edge reservations) with local
// fallbacks. Its look is the clipboard window's swap stage: the cyan wash and
// the drawn cut line, set on the shelf instead of on the whole viewport.
//
// THE SHELF HOLDS ITS OWN BAND. It reserves the top of the canvas
// (`viewport:inset`, pixi-host shrinks its box and refits), so fitted tiles
// are framed below it, never under it. Folded, it gives the band back — and
// so does an empty shelf: holding nothing, it shows nothing. The selection
// shelf (below) holds no band of its own.
//
// Nothing is written at the take. The shelf holds {label, source page, the sig
// the page lists it by} — a selection that survives navigation: walk through a
// portal, into another hive, down a branch, and it is still here. Session-only,
// no pool, no localStorage: it is what you are holding, not a record. It
// announces what it holds on `shelf:changed` (last-value), which the chat reads
// as the set it is talking about, and lets go on `shelf:let-go`.
//
// THE DROP is the only moment anything is written, and it decides:
//   • appearance — a plain release adds an incidence on the page under the
//     pointer: over a tile, INTO that tile; over an empty hex, here, in that
//     seat. The source page is untouched.
//   • custody    — Shift held at the release MOVES it: the same append, then
//     the source stops listing it.
// Both ride `shelf:place` (shelf-placement.worker.ts), which seals the LIVE
// subtree at the drop and commits ONE delta on the target. The worker answers
// `shelf:placed` and the rows that landed leave the shelf; a row that failed
// stays.
//
// THE STRIP (jwize, 2026-11-26): icon, "Shelf", count, search, the icons, and
// an arrow at the right end. The icons are squares that wrap to three rows,
// the name on hover. A CLICK places the icon on the page on screen and it
// leaves the strip in the same frame — a run of clicks must keep up with the
// hand — while the placements go one at a time behind it. The arrow opens the
// NAMED RINGS (context groups): a vertical list, the default shelf first, one
// line per ring — its name (a click types a new one), then what it holds, cut
// to the line. Open, the items can show as image, text, or both. A ring that
// empties is used up and removed, unless pinned.
//
// A row let go on a Portals-window row adds the tile to that portal through
// the index's own `portal-carry:drop`. A release back on the shelf is a
// cancelled drag, never a write.
//
// Hideable: the chevron folds the shelf away, and `shelf:toggle` (the shell's
// shelf button, beside show / hide agents) folds it or brings it back. Folding
// lets go of nothing; `shelf:changed` carries `folded` with the rows, so the
// button can say the shelf still holds something. The rows last the session;
// the fold is sticky — one current record in the `shelf:state` pool, read
// back on boot (a press that lands before the read wins).
//
// THE SELECTION SHELF takes the shelf's slot while two or more tiles are
// selected: it lists what the next act will fall on — the multi-tile quick
// menu, the image wall in turn — BEFORE anything fires, so a participant sees
// the set and can trim it (a row's × takes that tile out of the selection,
// nothing else). It is the shelf's slot, never a second strip: the shelf's
// rows are kept as they were and come back when the selection drops below
// two. A fresh selection brings it FORWARD, one strip at a time, and while two
// or more are selected a pair of icons at the strip's end (the shelf, the
// selection) says which is forward and brings the other forward on a click
// (jwize, 2026-11-06: "the selection shelf and the shelf should be togglable
// … an icon that you can change"). The strip brought forward shows whatever it
// holds, however the shelf was folded, so the pair never vanishes under the
// pointer; the shell's shelf button brings the shelf forward too. It has no
// fold — it is what you are about to act on — and no drag: a
// selected tile is already on the hive. It never speaks on `shelf:changed`
// (the controls bar and the chat count what is HELD there); it says what it
// lists on `selection-shelf:changed`. While the image wall walks the set
// (`images:queue`), the tile being chosen for is lit and the ones done are
// ticked. The switch between the two is taken on a frame, so a selection
// rebuilt in a burst never shows the shelf for the instant it is empty.
//
// IT NEVER MOVES THE CANVAS. The selection shelf lays over the top of the hive
// and reserves nothing: `viewport:inset` stays at whatever the shelf had
// reserved before the selection began (a held, unfolded shelf keeps its band; a
// folded or empty one has none), so selecting and un-selecting never resize or
// refit the hive (jwize, 2026-11-06: "the selection tray shouldn't affect the
// container").
//
// AND IT WAITS FOR THE HAND TO LIFT. The slot changes hands only once no button
// and no modifier is down: a strip that lands mid-select — the button down on a
// paint drag, Ctrl held between clicks — would cover the tiles under the
// pointer at the top of the hive. (First needed 2026-11-05, when the switch
// also shifted the canvas.) Rows on a slot already taken still update at once.

import { EffectBus, I18N_IOC_KEY, POINTER_GESTURE_END, type I18nProvider } from '@hypercomb/core'
import { deleteGroup, listGroups, readGroup, renameGroup, setGroupMembers, startGroup, type ContextGroup } from '../../assistant/context-groups.js'
import { dropEntries, entryKey, takeEntries, type TrayEntry } from './quick-tray.entries.js'
import { entriesToMembers, membersToEntries, tagSignature } from './quick-tray.ring.js'

export const QUICK_TRAY_SURFACE = 'hc-quick-tray'

/** Movement before a press counts as a drag rather than a click — the same
 *  threshold the aggregate index's rows use, so a row-drag feels the same
 *  wherever it starts. */
const DRAG_THRESHOLD = 5
/** How long a folded shelf stays open after a take, unless the pointer arrives. */
const PEEK_MS = 4000
/** A click's placement that has had no answer in this long comes back to the shelf. */
const EJECT_TIMEOUT_MS = 8000
const SIG_RE = /^[0-9a-f]{64}$/
/** The shelf's tiles, in px a side: the size slider in the open panel sets it. */
const ITEM_MIN = 24
const ITEM_MAX = 72
const ITEM_DEFAULT = 32

type LineageLike = { explorerSegments?: () => readonly string[] }
type OverlayLike = {
  labelAtClient(x: number, y: number): string | null
  dropTargetAtClient?(x: number, y: number): { label: string | null; occupied: boolean; index: number } | null
}
type StoreLike = {
  getResource?: (sig: string) => Promise<Blob | null>
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle) => Promise<ArrayBuffer | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey: undefined, options: { keep: 'current' }) => Promise<unknown>
}
type TagRegistryLike = { names?: string[]; ensureLoaded?: () => Promise<void>; add?: (name: string, color?: string) => Promise<void> }
type PlacementLike = { propsSigAt?: (segments: readonly string[]) => Promise<string | null> }
type SelectionLike = EventTarget & { selected?: ReadonlySet<string>; remove?: (label: string) => void }
/** The image wall walking the selection, one tile at a time (sharing/image-choice.drone.ts). */
type ImageQueue = { segments?: string[]; labels?: string[]; done?: string[]; current?: string | null }

type IocLike = { get?: (k: string) => unknown; whenReady?: (k: string, cb: (v: unknown) => void) => void }
const ioc = (): IocLike | undefined => (globalThis as { ioc?: IocLike }).ioc
const STORE_KEY = '@hypercomb.social/Store'
const SELECTION_KEY = '@diamondcoreprocessor.com/SelectionService'
/** Fewer selected than this is a single tile's business: the shelf stays. */
const SELECTION_SHELF_MIN = 2

const here = (): string[] =>
  ((ioc()?.get?.('@hypercomb.social/Lineage') as LineageLike | undefined)?.explorerSegments?.() ?? [])
    .map(s => String(s ?? '').trim()).filter(Boolean)
/** Where the fold is kept: one current record, written only by a press. */
const STATE_POOL = 'shelf:state'

const t = (key: string, fallback: string): string => {
  const said = (ioc()?.get?.(I18N_IOC_KEY) as I18nProvider | undefined)?.t?.(key)
  // A key the catalog lacks comes back as the key itself: say the fallback.
  return said && said !== key ? said : fallback
}

/** THE DEFAULT IMAGE: a tile with no picture is drawn as a tile — a pointy-top
 *  hexagon, the hive's own cell, with the name's first letter inside, so a
 *  shelf of pictureless tiles can still be told apart at a glance. */
const tileIcon = (label: string): string => {
  const letter = [...label.trim()][0]?.toUpperCase() ?? ''
  return `<span class="glyph tile-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 1.8 20.8 6.9v10.2L12 22.2 3.2 17.1V6.9z" fill="rgba(var(--shelf),0.14)" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><text x="12" y="12.4" text-anchor="middle" dominant-baseline="central" fill="currentColor">${letter.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)}</text></svg></span>`
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The thumbnail is the hex capture the hive draws, read-only: the placement
 *  worker's warm props lookup, then the picture it names. A miss shows the
 *  default tile icon (tileIcon). */
const resolveThumb = async (entry: TrayEntry): Promise<string | null> => {
  const store = ioc()?.get?.('@hypercomb.social/Store') as StoreLike | undefined
  const placement = ioc()?.get?.('@diamondcoreprocessor.com/ShelfPlacementWorker') as PlacementLike | undefined
  if (!store?.getResource || !placement?.propsSigAt) return null
  try {
    const propsSig = await placement.propsSigAt([...entry.sourceSegments, entry.label])
    if (!propsSig) return null
    const propsBlob = await store.getResource(propsSig)
    if (!propsBlob) return null
    const props = JSON.parse(await propsBlob.text()) as {
      small?: { image?: unknown }; flat?: { small?: { image?: unknown } }
    }
    const image = props.small?.image ?? props.flat?.small?.image
    if (typeof image !== 'string' || !SIG_RE.test(image)) return null
    const blob = await store.getResource(image)
    return blob ? URL.createObjectURL(blob) : null
  } catch { return null }
}

// Under the header (60000): the shelf is the band below it, and everything
// that drops from the command line (its suggestions, the indicator menu, both
// at 60001 inside the header's layer) must fall OVER the shelf, never under.
// Above the canvas (59989), banners and the participants' hive (59995).
const STYLE = `
:host{position:fixed;inset:0;z-index:59998;pointer-events:none;
  --shelf:73,214,208;
  /* The selection shelf's accent: the quick menu's honey, so the strip and the
     ring that acts on it read as one gesture, apart from the cyan shelf. */
  --pick:255,206,110;
  --shelf-top:calc(var(--hc-header-anchor,0px) + 0.375rem);
  --shelf-left:calc(max(var(--hc-controls-left,0px),var(--hc-inset-left,0px),var(--hc-seam-right,0px)) + 0.5rem);
  --shelf-right:calc(var(--hc-inset-right,0px) + 0.5rem);}
:host(.lifting){z-index:2147483600;}
.shelf{pointer-events:auto;position:absolute;top:var(--shelf-top);left:var(--shelf-left);right:var(--shelf-right);
  --inset:0.6rem;--inset-x:0.85rem;
  height:calc(2rem + 2 * var(--inset));box-sizing:border-box;display:flex;align-items:center;
  gap:var(--inset);padding:0 var(--inset-x);border-radius:var(--hc-radius-floating,4px);
  background:rgba(var(--hc-panel-pane,12,28,46),0.9);
  backdrop-filter:blur(10px) saturate(1.1);-webkit-backdrop-filter:blur(10px) saturate(1.1);
  box-shadow:inset 0 0 2.75rem -1.25rem rgba(var(--shelf),0.55),0 8px 28px rgba(var(--hc-panel-shadow,0,0,0),0.28);
  font-family:var(--hc-font,system-ui);font-size:0.85rem;font-weight:400;color:var(--hc-window-ink-loud,currentColor);user-select:none;}
.shelf::before{content:'';position:absolute;inset:0.25rem;pointer-events:none;border-radius:var(--hc-radius-control,2px);
  --cut:rgba(var(--shelf),0.6);
  background-image:repeating-linear-gradient(90deg,var(--cut) 0 7px,transparent 7px 14px),
    repeating-linear-gradient(90deg,var(--cut) 0 7px,transparent 7px 14px),
    repeating-linear-gradient(180deg,var(--cut) 0 7px,transparent 7px 14px),
    repeating-linear-gradient(180deg,var(--cut) 0 7px,transparent 7px 14px);
  background-size:100% 1px,100% 1px,1px 100%,1px 100%;background-position:0 0,0 100%,0 0,100% 0;background-repeat:no-repeat;}
.shelf.dragging{cursor:grabbing;}
.legend{position:relative;flex:0 0 auto;display:inline-flex;align-items:center;gap:0.45rem;letter-spacing:0.12em;text-transform:uppercase;font-family:var(--hc-mono,system-ui);
  font-size:0.68rem;font-weight:600;color:rgb(var(--shelf));white-space:nowrap;}
.legend svg{width:1rem;height:1rem;display:block;flex:0 0 auto;}
.tools{position:relative;flex:0 0 auto;display:inline-flex;align-items:center;gap:0.15rem;}
.swap{display:inline-flex;align-items:center;gap:0.1rem;}
.swap-btn{position:relative;appearance:none;width:1.75rem;height:1.75rem;display:inline-grid;place-items:center;border:0;padding:0;
  border-radius:var(--hc-radius-control,2px);background:transparent;color:var(--hc-window-ink-plain,currentColor);opacity:0.6;cursor:pointer;}
.swap-btn:hover,.swap-btn:focus-visible{opacity:1;background:rgba(var(--shelf),0.16);outline:none;}
.swap-btn.on{opacity:1;color:rgb(var(--shelf));background:rgba(var(--shelf),0.2);box-shadow:inset 0 0 0 1px rgba(var(--shelf),0.55);}
.swap-btn svg{width:1.05rem;height:1.05rem;display:block;}
.swap-btn.holding::after{content:'';position:absolute;top:0.2rem;right:0.2rem;width:0.3rem;height:0.3rem;border-radius:50%;background:rgb(var(--shelf));}
.count{min-width:1.5em;height:1.4em;box-sizing:border-box;display:inline-grid;place-items:center;padding:0 0.35em;
  border-radius:var(--hc-radius-control,2px);background:rgba(var(--shelf),0.16);color:var(--hc-window-ink-loud,currentColor);
  font-variant-numeric:tabular-nums;letter-spacing:0;}
.rows{position:relative;flex:1 1 0;display:flex;align-items:center;gap:0.3rem;margin:0;padding:0;list-style:none;min-width:0;height:100%;
  overflow-x:auto;overflow-y:hidden;scrollbar-width:none;
  mask-image:linear-gradient(90deg,#000 calc(100% - 1.5rem),transparent);-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 1.5rem),transparent);}
.rows::-webkit-scrollbar{display:none;}
.row{flex:0 0 auto;position:relative;display:inline-flex;align-items:center;gap:0.4rem;height:1.9rem;box-sizing:border-box;
  padding:0 0.2rem 0 0.25rem;border-radius:var(--hc-radius-control,2px);border:1px solid rgba(var(--shelf),0.22);
  background:rgba(var(--shelf),0.06);cursor:grab;white-space:nowrap;touch-action:none;outline:none;
  transition:border-color 120ms ease,background-color 120ms ease;}
.row:hover,.row:focus-visible{border-color:rgba(var(--shelf),0.6);background:rgba(var(--shelf),0.12);}
.row:focus-visible{box-shadow:0 0 0 1px rgba(var(--shelf),0.6);}
.row.lifted{opacity:0.4;}
.thumb,.glyph{width:1.4rem;height:1.4rem;flex:0 0 auto;display:inline-grid;place-items:center;overflow:hidden;}
.thumb img{width:100%;height:100%;object-fit:contain;display:block;}
.glyph{color:rgb(var(--shelf));font-size:0.95rem;line-height:1;}
.tile-icon svg{width:100%;height:100%;display:block;overflow:visible;}
.tile-icon text{font-family:var(--hc-font,system-ui);font-size:9px;font-weight:600;}
.label{max-width:11rem;overflow:hidden;text-overflow:ellipsis;}
.remove{appearance:none;width:1.25rem;height:1.25rem;display:inline-grid;place-items:center;border:0;padding:0;
  border-radius:var(--hc-radius-control,2px);background:transparent;color:var(--hc-window-ink-plain,currentColor);
  font:inherit;font-size:0.95rem;line-height:1;cursor:pointer;opacity:0;transition:opacity 120ms ease;}
.row:hover .remove,.row:focus-within .remove{opacity:0.75;}
.remove:hover,.remove:focus-visible{opacity:1;background:rgba(var(--shelf),0.2);outline:none;}
.row.tag{cursor:pointer;}
.row.tag.lit{outline:1px solid currentColor;}
/* THE SEARCH: an inlaid box, not an underline — a darker well a shade below
   the shelf, a light edge, padded, centred on the head's line. */
.add{width:10rem;min-width:3rem;box-sizing:border-box;height:1.65rem;padding:0 0.6rem;color:inherit;font:inherit;outline:none;
  background:rgba(0,0,0,0.22);border:1px solid rgba(var(--shelf),0.22);border-radius:var(--hc-radius-control,2px);
  box-shadow:inset 0 1px 2px rgba(0,0,0,0.25);transition:border-color 120ms ease,background-color 120ms ease;}
.add:hover{border-color:rgba(var(--shelf),0.38);}
.add:focus{border-color:rgba(var(--shelf),0.7);background:rgba(0,0,0,0.3);}
.add::placeholder{color:inherit;opacity:0.5;}
/* THE STRIP: icon, name, count, search, the icons, the arrow — one bar. The
   icons are squares that wrap, three rows at most, then they scroll. Open,
   the rings hang under the bar inside the shelf, so the band it holds (and
   the breadcrumb below it) grows with them. */
/* BALANCED: measured to what is SEEN — the shelf glyph on the left and the
   arrow's glyph on the right stand the same --inset-x in from the sides, the
   row the same --inset from top and bottom, and --inset between label,
   search, tiles and arrow. */
.shelf:not(.picks){height:auto;min-height:calc(2rem + 2 * var(--inset));flex-direction:column;align-items:stretch;gap:var(--inset);padding:var(--inset) var(--inset-x);}
.bar{position:relative;display:flex;align-items:flex-start;gap:var(--inset,0.6rem);min-width:0;--row:max(2rem,var(--item,2rem));}
/* ONE CENTRE LINE: the head (2rem) and the first row of tiles (the size the
   slider sets) are both centred on a row as tall as the taller of the two. */
.bar>.legend,.bar>.add,.bar>.tools{height:2rem;align-self:flex-start;margin-top:calc((var(--row) - 2rem) / 2);}
.bar>.items{margin-top:calc((var(--row) - var(--item,2rem)) / 2);}
.bar>.add{flex:0 0 auto;height:1.65rem;margin-top:calc((var(--row) - 1.65rem) / 2);}
.items{flex:1 1 0;flex-wrap:wrap;align-content:flex-start;align-items:flex-start;gap:0.4rem;height:auto;
  max-height:calc(3 * var(--item,2rem) + 2 * 0.4rem);overflow-x:hidden;overflow-y:auto;scrollbar-width:thin;mask-image:none;-webkit-mask-image:none;}
.items:empty{min-height:var(--item,2rem);}
.items .row{width:var(--item,2rem);height:var(--item,2rem);padding:0;gap:0;justify-content:center;transition:none;}
.items .thumb,.items .glyph{width:calc(var(--item,2rem) - 0.3rem);height:calc(var(--item,2rem) - 0.3rem);}
.items .label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}
.items .remove{position:absolute;top:-0.35rem;right:-0.35rem;width:0.95rem;height:0.95rem;font-size:0.75rem;border-radius:50%;
  background:rgba(var(--hc-panel-pane,12,28,46),0.95);box-shadow:0 0 0 1px rgba(var(--shelf),0.55);transition:none;}
.items .row:hover .remove{opacity:0.9;}
/* Bare icons: a picture needs no frame. The frame comes back only where it
   says something — under the pointer, pressed or focused, and lifted in a
   drag — and always in text-only, where the frame is the item's edge. */
.shelf:not(.face-text) .items .row{border-color:transparent;background:transparent;}
.shelf:not(.face-text) .items .row:hover,.shelf:not(.face-text) .items .row:focus-visible,
.shelf:not(.face-text) .items .row:active,.shelf:not(.face-text) .items .row.lifted{border-color:rgba(var(--shelf),0.6);background:rgba(var(--shelf),0.12);}
.shelf.face-both .items .row,.shelf.face-text .items .row{width:auto;max-width:12rem;padding:0 0.45rem 0 0.15rem;gap:0.35rem;justify-content:flex-start;}
.shelf.face-both .items .label,.shelf.face-text .items .label{position:static;width:auto;height:auto;clip:auto;max-width:9.5rem;overflow:hidden;text-overflow:ellipsis;}
.shelf.face-text .items .thumb,.shelf.face-text .items .glyph{display:none;}
.shelf.face-text .items .row{padding-left:0.45rem;}
.tool{position:relative;appearance:none;width:1.6rem;height:1.6rem;flex:0 0 auto;display:inline-grid;place-items:center;border:0;padding:0;
  border-radius:var(--hc-radius-control,2px);background:transparent;color:var(--hc-window-ink-plain,currentColor);opacity:0.65;cursor:pointer;}
.tool:hover,.tool:focus-visible{opacity:1;background:rgba(var(--shelf),0.16);outline:none;}
.tool.on{opacity:1;color:rgb(var(--shelf));background:rgba(var(--shelf),0.18);}
.tool svg{width:1rem;height:1rem;display:block;}
/* The arrow: a generous target (2.2rem by the row's height) whose glyph still
   stands --inset-x from the edge like the shelf glyph opposite — the extra
   width reaches out into the padding, where nothing is drawn. It answers
   hover and open with colour, never a box, so the reach stays invisible. */
.tool.expand{width:2.2rem;height:2rem;margin-right:-0.6rem;background:transparent;}
/* Alone in the tools, it reaches left into the gap too, so the space from the
   last tile to the glyph stays one --inset like every other gap on the row. */
.tools>.tool.expand:first-child{margin-left:-0.6rem;}
.tool.expand:hover,.tool.expand:focus-visible,.tool.expand.on{background:transparent;color:rgb(var(--shelf));opacity:1;}
.tip{position:fixed;z-index:2147483600;pointer-events:none;transform:translateX(-50%);max-width:16rem;padding:0.2rem 0.5rem;
  border-radius:var(--hc-radius-control,2px);background:rgba(var(--hc-panel-pane,12,28,46),0.96);box-shadow:0 0 0 1px rgba(var(--shelf),0.5);
  color:var(--hc-window-ink-loud,currentColor);font-family:var(--hc-font,system-ui);font-size:0.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
/* THE RINGS: one line each — the name, then what it holds, cut to the line. */
/* THE DIVIDER is balanced: one --inset above it (the gap under the top row)
   and one below it, and the open content shares the top row's side edges. */
.rings{position:relative;max-height:16rem;overflow-y:auto;margin:0;padding:var(--inset,0.6rem) 0 0;list-style:none;
  border-top:1px solid rgba(var(--shelf),0.25);}
.faces{display:flex;align-items:center;gap:0.5rem;padding:0 0 0.3rem;}
.size{display:inline-flex;align-items:center;gap:0.35rem;margin-left:auto;font-family:var(--hc-mono,system-ui);font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;opacity:0.8;}
.size input{width:8rem;margin:0;accent-color:rgb(var(--shelf));cursor:pointer;}
.face-btn{appearance:none;border:1px solid rgba(var(--shelf),0.3);border-radius:1px;background:none;color:inherit;
  font-family:var(--hc-mono,system-ui);font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;padding:0.15rem 0.55rem;cursor:pointer;opacity:0.7;}
.face-btn:hover{opacity:1;}
.face-btn.on{opacity:1;color:rgb(var(--shelf));border-color:rgba(var(--shelf),0.8);background:rgba(var(--shelf),0.14);}
.ring{display:flex;align-items:center;gap:0.4rem;height:1.9rem;padding:0;border-radius:var(--hc-radius-control,2px);}
.ring.current{background:rgba(var(--shelf),0.14);}
.ring-name,.ring-items,.ring-new{appearance:none;border:0;background:none;color:inherit;font:inherit;cursor:pointer;text-align:left;padding:0 0.3rem;height:1.6rem;border-radius:var(--hc-radius-control,2px);}
.ring-name{flex:0 0 7rem;color:rgb(var(--shelf));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ring-name:disabled{cursor:default;}
.ring-name-input{flex:0 0 7rem;width:7rem;box-sizing:border-box;background:transparent;color:inherit;border:0;border-bottom:1px solid rgb(var(--shelf));font:inherit;padding:0 0.3rem;outline:none;}
.ring-items{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0.85;}
.ring-items .empty{opacity:0.5;}
.ring-name:not(:disabled):hover,.ring-items:hover,.ring-new:hover{background:rgba(var(--shelf),0.14);}
.pin,.pin-gap{flex:0 0 1.5rem;width:1.5rem;height:1.5rem;}
.pin{appearance:none;display:inline-grid;place-items:center;border:0;padding:0;background:none;color:inherit;opacity:0.35;cursor:pointer;border-radius:var(--hc-radius-control,2px);}
.pin:hover{opacity:0.8;}
.pin.on{opacity:1;color:rgb(var(--shelf));}
.pin svg{width:0.9rem;height:0.9rem;display:block;}
.ring.new .ring-new{display:inline-flex;align-items:center;gap:0.35rem;opacity:0.75;width:100%;}
.ring-new svg{width:0.9rem;height:0.9rem;}
@keyframes hc-shelf-taken{from{background:rgba(var(--shelf),0.45);border-color:rgba(var(--shelf),0.9);}}
.taken{animation:hc-shelf-taken 700ms ease-out;}
@media (prefers-reduced-motion:reduce){.taken{animation:none;}.row,.remove{transition:none;}}
@media (max-width:640px){.shelf{--inset:0.5rem;--inset-x:0.7rem;}.label{max-width:7rem;}.legend .word{display:none;}.add{width:6rem;}}
.ghost{position:fixed;z-index:2147483600;pointer-events:none;margin-left:0.8rem;margin-top:-0.9rem;max-width:14rem;
  padding:0.3rem 0.6rem;display:flex;align-items:center;gap:0.4rem;border-radius:var(--hc-radius-floating,4px);
  background:rgba(var(--hc-panel-pane,12,28,46),0.94);box-shadow:0 0 0 1px rgba(var(--shelf),0.55),0 6px 20px rgba(var(--hc-panel-shadow,0,0,0),0.3);
  color:var(--hc-window-ink-loud,currentColor);font-family:var(--hc-font,system-ui);font-size:0.85rem;line-height:1.2;white-space:nowrap;}
.ghost .verb{font-family:var(--hc-mono,system-ui);font-size:0.65rem;letter-spacing:0.08em;text-transform:uppercase;color:rgb(var(--shelf));}
.ghost.custody .verb{color:var(--hc-window-warn,#ffc46b);}
.ghost .name{overflow:hidden;text-overflow:ellipsis;}
.shelf.picks{--shelf:var(--pick);}
.shelf.picks::before{--cut:rgba(var(--pick),0.5);}
.pick{cursor:default;}
.pick.current{border-color:rgba(var(--pick),0.9);background:rgba(var(--pick),0.2);box-shadow:0 0 0 1px rgba(var(--pick),0.5);}
.pick.done{opacity:0.7;}
.pick .mark{color:rgb(var(--pick));font-size:0.85rem;line-height:1;}
`

/** Chevrons drawn inline: an icon font does not reach into a shadow root. */
const CHEVRON_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>'
const icon = (d: string, rule = 'nonzero'): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="${rule}" d="${d}"/></svg>`
/** The shelf: the same tray the shell's shelf button draws. */
const SHELF_ICON = icon('M19 3H4.99c-1.11 0-1.98.9-1.98 2L3 19c0 1.1.88 2 1.99 2H19c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 12h-4c0 1.66-1.35 3-3 3s-3-1.34-3-3H4.99V5H19v10zm-3-5h-2V7h-4v3H8l4 4 4-4z')
/** The selection: a dashed marquee round a tile. */
const SELECT_ICON = icon('M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z')
const CHEVRON_RIGHT = icon('M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z')
const CHEVRON_DOWN = icon('M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z')
const PIN_ICON = icon('M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z')
const ADD_ICON = icon('M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z')

/** Owner of the shelf's reservation on the canvas (viewport:inset). */
const INSET_OWNER = 'quick-tray'
/** Clear air under the shelf before the hive starts, in px. */
const INSET_GAP = 6

export class QuickTrayElement extends HTMLElement {
  #root: ShadowRoot
  #entries: readonly TrayEntry[] = []
  #thumbs = new Map<string, string>()
  #offs: Array<() => void> = []
  #pending: { entry: TrayEntry; x: number; y: number; row: HTMLElement | null } | null = null
  #dragging: TrayEntry | null = null
  #custody = false
  #ghost: HTMLDivElement | null = null
  /** Disarms the guard on a drag's trailing click, when one is armed. */
  #trailingClickCleanup: (() => void) | null = null
  /** Folded away. The rows are still held. */
  #folded = false
  /** A press landed this session, so the saved fold no longer speaks. */
  #pressed = false
  /** The top band last reserved on the canvas, in px. */
  #reserved = -1
  /** The band the shelf itself last measured. The selection shelf reserves
   *  nothing, so while it stands this is what the canvas keeps. */
  #band = 0
  /** Which of the pair is forward while two or more are selected. A fresh
   *  selection brings the selection shelf forward; the participant's press
   *  on the pair's icons changes it, and it holds until the selection falls
   *  below two. */
  #forward: 'shelf' | 'picks' = 'picks'
  #measureFrame = 0
  /** Watches the shelf's own box: it wraps, opens and narrows without a
   *  repaint, and the band it holds (which the breadcrumb and the hive
   *  follow, through `--hc-inset-top`) must track every one of those. */
  #sizeWatch: ResizeObserver | null = null
  #watched: Element | null = null
  /** Open only because a take just landed, and not yet hovered. */
  #peeking = false
  #peekTimer: ReturnType<typeof setTimeout> | undefined
  /** The selection as last painted, in selection order. Two or more and the
   *  band is the selection shelf. */
  #picks: readonly string[] = []
  /** The page the picks were read on: a selection is a set of names on it. */
  #picksPage: readonly string[] = []
  #pickThumbs = new Map<string, string>()
  #selection: SelectionLike | null = null
  #selectionFrame = 0
  /** A select may be in progress: the primary button is down, or Ctrl/Meta is. */
  #buttonDown = false
  #modifierDown = false
  /** The band should have changed hands, but a select was still in progress. */
  #switchOwed = false
  #queue: ImageQueue | null = null
  /** Open for typing though empty: the shell's shelf button brought it up. */
  #opened = false
  /** The words typed in the search: only the icons whose names hold them show. */
  #filter = ''
  /** The tags the hive is filtered on (the sticky `tags:filter`), and the reach
   *  they were set with. Mirrored, never owned: the shelf toggles, the hive filters. */
  #lens: readonly string[] = []
  #reach: 'local' | 'children' | 'global' = 'local'
  /** How the items show: the picture, the name, or both. Kept in `shelf:state`. */
  #face: 'image' | 'text' | 'both' = 'image'
  /** How big the shelf's tiles are, px a side. Kept in `shelf:state`. */
  #itemSize = ITEM_DEFAULT
  /** THE RINGS. The shelf is one of several named collections: the session's
   *  own (null, never stored) or a named ring (a context group, written
   *  through as rows come and go). A named ring that empties is removed,
   *  unless pinned; a pinned one stays, and the arrows still reach it. */
  #ringId: string | null = null
  #rings: readonly ContextGroup[] = []
  #pinned = new Set<string>()
  /** The session shelf's rows while a named ring is forward. */
  #sessionEntries: readonly TrayEntry[] = []
  /** The arrow at the right end opened the rings. */
  #expanded = false
  /** The ring whose name is being typed in the list. */
  #renaming: string | null = null
  #ringWrite: ReturnType<typeof setTimeout> | undefined
  /** The rows painted last, by position: a row's data-index reads this. */
  #shown: readonly TrayEntry[] = []
  /** THE CLICK THAT EJECTS. A clicked icon leaves the shelf at once and waits
   *  here to be placed on the page; one placement is in flight at a time and
   *  clicks made meanwhile go together in the next, so a burst of clicks never
   *  races two commits on one page. A failure puts the row back. */
  #ejectQueue: { entry: TrayEntry; custody: boolean }[] = []
  #inflight: { entry: TrayEntry; custody: boolean }[] = []
  #inflightTimer: ReturnType<typeof setTimeout> | undefined
  /** The extra keys the state record carried that this shelf does not read, kept on write. */
  #stateExtra: Record<string, unknown> = {}

  constructor() {
    super()
    this.#root = this.attachShadow({ mode: 'open' })
  }

  /** What the shelf holds — read by specs and the bee, never written from outside. */
  get entries(): readonly TrayEntry[] { return this.#entries }

  /** What the selection shelf lists — empty while the shelf has the band. */
  get picks(): readonly string[] { return this.#picking() ? this.#picks : [] }

  connectedCallback(): void {
    this.#offs.push(EffectBus.on<{ label?: string; segments?: string[]; sig?: string; loose?: true }>('quick-tray:take', (p) => {
      if (!p?.label) return
      this.take([{
        label: p.label,
        sourceSegments: Array.isArray(p.segments) ? p.segments : [],
        sig: p.sig,
        ...(p.loose ? { loose: true as const } : {}),
      }])
    }))
    // The worker's answer to a drop: what landed leaves the shelf, what failed
    // stays — a partial drop loses nothing you were carrying. The chat lets go
    // the same way when a row is removed from its context.
    const letGoOf = (p: { placed?: { label?: string; sourceSegments?: string[] }[]; entries?: { label?: string; sourceSegments?: string[] }[] } | undefined): void => {
      const keys = (p?.placed ?? p?.entries ?? [])
        .filter((e): e is { label: string; sourceSegments: string[] } => typeof e?.label === 'string')
        .map(e => entryKey({ label: e.label, sourceSegments: e.sourceSegments ?? [] }))
      if (keys.length > 0) this.letGo(new Set(keys))
    }
    this.#offs.push(EffectBus.on<{ placed?: { label?: string }[]; failed?: string[] } | undefined>('shelf:placed', (p) => {
      letGoOf(p)
      this.#settleEject(p)
    }))
    this.#offs.push(EffectBus.on('shelf:let-go', letGoOf))
    this.#offs.push(EffectBus.on('context:groups-changed', () => { void this.#loadRings() }))
    // The ring: keep what the shelf holds as a group, or bring a kept one back.
    // Both are presses, sent transient, so a shelf that mounts later never
    // replays one.
    this.#offs.push(EffectBus.on<{ active?: string[]; scope?: 'local' | 'children' | 'global' } | undefined>('tags:filter', (p) => {
      this.#lens = Array.isArray(p?.active) ? p.active : []
      if (p?.scope) this.#reach = p.scope
      this.#render()
    }))
    this.#offs.push(EffectBus.on('shelf:save', () => { void this.#keepShelf() }))
    this.#offs.push(EffectBus.on<{ name?: string } | undefined>('shelf:take-tag', (p) => {
      if (typeof p?.name === 'string') void this.#takeTag(p.name)
    }))
    this.#offs.push(EffectBus.on<{ id?: string } | undefined>('shelf:recall', (p) => {
      if (typeof p?.id === 'string') void this.#recallShelf(p.id)
    }))
    // A canvas owner that started late asks for every reservation again.
    this.#offs.push(EffectBus.on('viewport:inset-poll', () => { this.#reserved = -1; this.#reserve() }))
    // Transient on the sender's side: a shelf that mounts later must not
    // replay an old press and fold itself.
    this.#offs.push(EffectBus.on<{ open?: boolean } | undefined>('shelf:toggle', (p) => {
      // Over a selection the press asks for the shelf: bring it forward, and
      // leave the fold as the participant keeps it.
      if (this.#selected() && this.#forward === 'picks' && p?.open !== false) { this.#bring('shelf'); return }
      if (p?.open === true || (p?.open === undefined && this.#folded)) { this.#opened = true; this.#render() }
      this.#press(typeof p?.open === 'boolean' ? !p.open : !this.#folded)
    }))
    // The image wall walking the selection says where it is on every step;
    // the rows tick and light from it. Last-value, so a shelf that mounts
    // mid-walk still marks it.
    this.#offs.push(EffectBus.on<ImageQueue>('images:queue', (q) => {
      this.#queue = q && Array.isArray(q.labels) && q.labels.length > 0 ? q : null
      if (this.#picking()) this.#render()
    }))
    // A tile in the selection that took a new picture (the wall walking it)
    // must show that picture now: the cached thumbnail is the old one, and
    // nothing else would let it go while the selection lasts.
    this.#offs.push(EffectBus.on<{ cell?: string; label?: string; segments?: readonly string[] }>('tile:saved', (p) => {
      const label = p?.cell ?? p?.label
      if (!label || !this.#picks.includes(label)) return
      if (Array.isArray(p?.segments) && p.segments.join('\u0000') !== this.#picksPage.join('\u0000')) return
      const key = entryKey({ label, sourceSegments: this.#picksPage })
      const url = this.#pickThumbs.get(key)
      if (url) { URL.revokeObjectURL(url); this.#pickThumbs.delete(key) }
      if (this.#picking()) void this.#loadPickThumb(label, this.#picksPage)
    }))
    window.addEventListener('resize', this.#onResize)
    this.addEventListener('pointerenter', this.#endPeek)
    this.#watchGesture(true)
    this.#watchSelection()
    this.#render()
    this.#announce()
    this.#announcePicks()
    this.#recallFold()
    void this.#loadRings()
  }

  disconnectedCallback(): void {
    for (const off of this.#offs.splice(0)) off()
    window.removeEventListener('resize', this.#onResize)
    this.removeEventListener('pointerenter', this.#endPeek)
    this.#sizeWatch?.disconnect()
    this.#sizeWatch = null
    this.#watched = null
    this.#watchGesture(false)
    this.#buttonDown = false
    this.#modifierDown = false
    this.#switchOwed = false
    this.#selection?.removeEventListener('change', this.#onSelectionChange)
    this.#selection = null
    cancelAnimationFrame(this.#selectionFrame)
    this.#selectionFrame = 0
    for (const url of this.#pickThumbs.values()) URL.revokeObjectURL(url)
    this.#pickThumbs.clear()
    // Forget what was listed too, so a remount with the same selection is a
    // change: it repaints and loads its pictures again.
    this.#picks = []
    this.#picksPage = []
    clearTimeout(this.#peekTimer)
    clearTimeout(this.#inflightTimer)
    this.#flushRingWrite()
    cancelAnimationFrame(this.#measureFrame)
    EffectBus.emit('viewport:inset', { owner: INSET_OWNER, side: 'top', size: 0 })
    // Last-value: a late reader must not be told a shelf is on screen.
    EffectBus.emit('selection-shelf:changed', { labels: [], shown: false })
    this.#trailingClickCleanup?.()
    this.#detachDrag()
    this.#ghost?.remove()
    for (const url of this.#thumbs.values()) URL.revokeObjectURL(url)
    this.#thumbs.clear()
  }

  // ── holding ──────────────────────────────────────────────────────────────

  take(incoming: readonly TrayEntry[]): void {
    this.#peek()
    this.#entries = takeEntries(this.#entries, incoming)
    for (const entry of this.#entries) void this.#loadThumb(entry)
    this.#render()
    this.#answer(incoming)
    this.#announce()
    this.#writeRing()
  }

  /** A tag onto the shelf, created if the hive does not know it yet. */
  async #takeTag(raw: string): Promise<void> {
    const name = raw.trim()
    if (!name) return
    const registry = ioc()?.get?.('@hypercomb.social/TagRegistry') as TagRegistryLike | undefined
    if (registry) { await registry.ensureLoaded?.(); if (!registry.names?.includes(name)) await registry.add?.(name) }
    this.take([{ label: name, sourceSegments: [], sig: await tagSignature(name), kind: 'tag' }])
  }

  /** Toggle one tag in the hive's filter. The reach stays as it was set. */
  #filterBy(tag: string): void {
    const active = this.#lens.includes(tag) ? this.#lens.filter(t => t !== tag) : [...this.#lens, tag]
    EffectBus.emit('tags:filter', { active, scope: this.#reach })
  }

  /** Keep the shelf as a new named ring (`shelf:save`). An empty shelf, or one
   *  whose rows have no signature to name them by, keeps nothing. */
  async #keepShelf(): Promise<void> {
    const members = entriesToMembers(this.#entries)
    if (members.length === 0) return
    const count = (await listGroups()).length + 1
    await startGroup(`${t('shelf.ring.name', 'ring')} ${count}`, members)
  }

  /** Bring a kept ring forward (`shelf:recall`). */
  async #recallShelf(id: string): Promise<void> {
    await this.#loadRings()
    if (!this.#rings.some(ring => ring.id === id)) return
    this.#peek()
    await this.#switchRing(id)
  }

  // ── the rings ────────────────────────────────────────────────────────────

  async #loadRings(): Promise<void> {
    try { this.#rings = [...(await listGroups())].reverse() } catch { this.#rings = [] }
    // A ring removed elsewhere while forward: the session shelf comes back.
    if (this.#ringId && !this.#rings.some(ring => ring.id === this.#ringId)) {
      this.#ringId = null
      this.#entries = this.#sessionEntries
      this.#sessionEntries = []
      this.#announce()
    }
    if (this.isConnected) this.#render()
  }

  #ringName(): string {
    if (!this.#ringId) return t('quick-tray.title', 'Shelf')
    return this.#rings.find(ring => ring.id === this.#ringId)?.label ?? t('quick-tray.title', 'Shelf')
  }

  /** Bring a ring forward (null: the session shelf). The rows held now go
   *  with the ring they belong to; the target's rows come up in their place. */
  async #switchRing(id: string | null, stayOpen = true): Promise<void> {
    if (id === this.#ringId) return
    // Walked to on purpose, the shelf stays up even on an empty ring, so the
    // arrows that brought it there are still under the pointer.
    if (stayOpen) this.#opened = true
    this.#endDrag()
    this.#flushRingWrite()
    if (this.#ringId === null) this.#sessionEntries = this.#entries
    let next: readonly TrayEntry[]
    if (id === null) next = this.#sessionEntries
    else {
      const ring = this.#rings.find(r => r.id === id) ?? await readGroup(id)
      if (!ring) return
      next = membersToEntries(ring.members)
    }
    this.#ringId = id
    if (id === null) this.#sessionEntries = []
    this.#entries = next
    for (const entry of this.#entries) void this.#loadThumb(entry)
    this.#render()
    this.#announce()
  }

  /** Name a new ring. On the session shelf the rows held become the ring (the
   *  save is named); elsewhere it starts empty. Either way it comes forward
   *  with its name ready to type. */
  async #newRing(): Promise<void> {
    const fromSession = this.#ringId === null && this.#entries.length > 0
    const members = fromSession ? entriesToMembers(this.#entries) : []
    const ring = await startGroup(`${t('shelf.ring.name', 'ring')} ${this.#rings.length + 1}`, members)
    if (!ring) return
    // An empty ring stays only while pinned, so a fresh empty one starts
    // pinned; it can be unpinned like any other.
    if (members.length === 0) { this.#pinned.add(ring.id); void this.#keepState() }
    await this.#loadRings()
    if (fromSession) {
      const keep = this.#entries
      this.#entries = []
      await this.#switchRing(ring.id)
      // Rows with no signature cannot be stored, but are still in hand.
      if (keep.length > membersToEntries(members).length) this.take(keep)
    } else await this.#switchRing(ring.id)
    this.#renaming = ring.id
    this.#expanded = true
    this.#render()
  }

  #togglePin(id: string): void {
    if (this.#pinned.has(id)) this.#pinned.delete(id)
    else this.#pinned.add(id)
    void this.#keepState()
    const ring = this.#rings.find(r => r.id === id)
    // Unpinned and empty: used up, so it goes now.
    const empty = id === this.#ringId ? this.#entries.length === 0 : (ring?.members.length ?? 0) === 0
    if (!this.#pinned.has(id) && empty) void this.#retireRing(id)
    else this.#render()
  }

  async #retireRing(id: string): Promise<void> {
    if (id === this.#ringId) await this.#switchRing(null, false)
    this.#pinned.delete(id)
    void this.#keepState()
    await deleteGroup(id)
    await this.#loadRings()
  }

  async #renameRing(id: string, label: string): Promise<void> {
    this.#renaming = null
    const name = label.trim()
    if (name) await renameGroup(id, name)
    await this.#loadRings()
  }

  /** The forward ring keeps what it holds — written a beat later, so a burst
   *  of clicks is one write. A named ring that empties is used up: removed,
   *  unless pinned. */
  #writeRing(): void {
    const id = this.#ringId
    if (!id) return
    clearTimeout(this.#ringWrite)
    this.#ringWrite = undefined
    if (this.#entries.length === 0 && !this.#pinned.has(id)) { void this.#retireRing(id); return }
    const members = entriesToMembers(this.#entries)
    this.#ringWrite = setTimeout(() => {
      this.#ringWrite = undefined
      void setGroupMembers(id, members)
    }, 250)
  }

  #flushRingWrite(): void {
    if (this.#ringWrite === undefined || !this.#ringId) return
    clearTimeout(this.#ringWrite)
    this.#ringWrite = undefined
    void setGroupMembers(this.#ringId, entriesToMembers(this.#entries))
  }

  // ── the click that ejects ────────────────────────────────────────────────

  /** A click on an icon: it leaves the shelf NOW (the icon goes from the strip
   *  in this frame, nothing waits on the write) and is placed on the page on
   *  screen, at its next open seat. Shift moves it, as on a drop. */
  #eject(entry: TrayEntry, custody: boolean, row: HTMLElement | null): void {
    this.#ejectQueue.push({ entry, custody: custody && !entry.loose })
    row?.remove()
    this.#hideTip()
    this.#letGoQuietly(entryKey(entry))
    this.#pumpEject()
  }

  #pumpEject(): void {
    if (this.#inflight.length > 0 || this.#ejectQueue.length === 0) return
    // Custody is per release: a run of clicks goes together while it agrees.
    const custody = this.#ejectQueue[0].custody
    const cut = this.#ejectQueue.findIndex(item => item.custody !== custody)
    const send = this.#ejectQueue.splice(0, cut < 0 ? this.#ejectQueue.length : cut)
    this.#inflight = send
    clearTimeout(this.#inflightTimer)
    this.#inflightTimer = setTimeout(() => this.#settleEject(undefined, true), EJECT_TIMEOUT_MS)
    EffectBus.emit('shelf:place', {
      entries: send.map(({ entry }) => ({
        label: entry.label,
        sourceSegments: [...entry.sourceSegments],
        ...(entry.loose && entry.sig ? { sig: entry.sig } : {}),
      })),
      targetSegments: here(),
      custody,
    })
  }

  /** The worker answered (or never did): what failed comes back to the shelf,
   *  and the next run of clicks goes. */
  #settleEject(answer: { placed?: { label?: string }[]; failed?: string[] } | undefined, timedOut = false): void {
    if (this.#inflight.length === 0) return
    const placed = new Set((answer?.placed ?? []).map(e => e?.label))
    const failed = new Set(answer?.failed ?? [])
    const ours = this.#inflight.some(({ entry }) => placed.has(entry.label) || failed.has(entry.label))
    if (!timedOut && !ours) return
    clearTimeout(this.#inflightTimer)
    const back = this.#inflight.filter(({ entry }) => timedOut || failed.has(entry.label))
    this.#inflight = []
    if (back.length > 0) this.take(back.map(({ entry }) => entry))
    this.#pumpEject()
  }

  /** What the shelf holds, for every reader (last-value replayed, so a chat
   *  that opens later still sees it). */
  #announce(): void {
    EffectBus.emit('shelf:changed', {
      entries: this.#entries.map(e => ({
        label: e.label,
        sourceSegments: [...e.sourceSegments],
        ...(e.sig ? { sig: e.sig } : {}),
        ...(e.loose ? { loose: true } : {}),
      })),
      folded: this.#folded,
    })
  }

  /** A take must answer where it landed. A tile already held changes no row,
   *  so without this the click looks dead. A folded shelf has no rows to light;
   *  its count travels on `shelf:changed` to the shell's button. */
  #answer(incoming: readonly TrayEntry[]): void {
    if (this.#folded) return
    const keys = new Set(incoming.map(entryKey))
    this.#shown.forEach((entry, index) => {
      if (keys.has(entryKey(entry))) this.#root.querySelector(`.row[data-index="${index}"]`)?.classList.add('taken')
    })
  }

  letGo(keys: ReadonlySet<string>): void {
    const before = this.#entries.length
    this.#entries = dropEntries(this.#entries, keys)
    this.#sessionEntries = dropEntries(this.#sessionEntries, keys)
    if (this.#entries.length === before) return
    for (const key of keys) {
      const url = this.#thumbs.get(key)
      if (url) { URL.revokeObjectURL(url); this.#thumbs.delete(key) }
    }
    this.#render()
    this.#announce()
    this.#writeRing()
  }

  /** Let go of a row whose icon is already off the strip: no repaint unless the
   *  shelf has to close, so the next click lands on the strip as it stands. */
  #letGoQuietly(key: string): void {
    this.#entries = dropEntries(this.#entries, new Set([key]))
    const url = this.#thumbs.get(key)
    if (url) { URL.revokeObjectURL(url); this.#thumbs.delete(key) }
    const count = this.#root.querySelector('.shelf:not(.picks) .legend .count')
    if (count) count.textContent = String(this.#entries.length)
    if (this.#entries.length === 0) this.#render()
    this.#announce()
    this.#writeRing()
  }

  async #loadThumb(entry: TrayEntry): Promise<void> {
    if (entry.kind === 'tag') return
    const key = entryKey(entry)
    if (this.#thumbs.has(key)) return
    const url = await resolveThumb(entry)
    if (!url) return
    // The row may have left while the picture loaded — never leak its URL.
    if (!this.#entries.some(e => entryKey(e) === key)) { URL.revokeObjectURL(url); return }
    this.#thumbs.set(key, url)
    // The picture goes into its icon where it stands: a repaint would trade
    // every row under the pointer for a new one mid-click.
    const index = this.#shown.findIndex(e => entryKey(e) === key)
    const glyph = index < 0 ? null : this.#root.querySelector(`.row[data-index="${index}"] .glyph`)
    if (glyph) glyph.outerHTML = `<span class="thumb"><img src="${url}" alt="" draggable="false"></span>`
  }

  // ── the selection shelf ──────────────────────────────────────────────────

  /** Two or more tiles are selected: the slot is a pair, shelf and selection. */
  #selected(): boolean { return this.#picks.length >= SELECTION_SHELF_MIN }

  /** The selection shelf is the one forward. */
  #picking(): boolean { return this.#selected() && this.#forward === 'picks' }

  /** Bring one of the pair forward. Only while a selection stands, and only a
   *  press does it — a selection rebuilt in a burst never flips the slot. The
   *  canvas is not asked for anything: a selection holds the band as it was. */
  #bring(which: 'shelf' | 'picks'): void {
    if (!this.#selected() || this.#forward === which) return
    this.#forward = which
    if (which === 'picks') {
      // A shelf row in flight has nowhere to land on the other strip.
      this.#endDrag()
      for (const label of this.#picks) void this.#loadPickThumb(label, this.#picksPage)
    }
    this.#render()
    this.#announcePicks()
  }

  /** The pair's two icons: which strip is forward is lit, the other brings
   *  itself forward on a click. A dot on the shelf's says it holds something
   *  while the selection is forward — the shell's shelf button says the same. */
  #swapHtml(): string {
    const shelf = esc(t('quick-tray.bring-shelf', 'Bring the shelf forward'))
    const picks = esc(t('quick-tray.bring-picks', 'Bring the selection forward'))
    const holding = this.#forward === 'picks' && this.#entries.length > 0
    return `<span class="swap" role="group" aria-label="${esc(t('quick-tray.bring', 'Which shelf is forward'))}">
        <button class="swap-btn${this.#forward === 'shelf' ? ' on' : ''}${holding ? ' holding' : ''}" type="button" data-bring="shelf" aria-pressed="${this.#forward === 'shelf'}" title="${shelf}" aria-label="${shelf}">${SHELF_ICON}</button>
        <button class="swap-btn${this.#forward === 'picks' ? ' on' : ''}" type="button" data-bring="picks" aria-pressed="${this.#forward === 'picks'}" title="${picks}" aria-label="${picks}">${SELECT_ICON}</button>
      </span>`
  }

  #wireSwap(): void {
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>('.swap-btn')) {
      button.addEventListener('click', () => this.#bring(button.dataset['bring'] === 'picks' ? 'picks' : 'shelf'))
    }
  }

  /** Follow the selection. The service may register after the shelf mounts,
   *  so this waits for it; a shelf taken off the page meanwhile stays off. */
  #watchSelection(): void {
    const attach = (service: SelectionLike | undefined): void => {
      if (!service || !this.isConnected || this.#selection === service) return
      this.#selection?.removeEventListener('change', this.#onSelectionChange)
      this.#selection = service
      service.addEventListener('change', this.#onSelectionChange)
      // Nothing is on the band yet that a half-built set could flash through,
      // so the first read is painted at once.
      this.#commitPicks()
    }
    const container = ioc()
    const service = container?.get?.(SELECTION_KEY) as SelectionLike | undefined
    if (service) attach(service)
    else container?.whenReady?.(SELECTION_KEY, v => attach(v as SelectionLike))
  }

  /** A selection can be rebuilt as a burst of announcements (cleared, then
   *  added to one by one). Read it once, on the next frame, so the band shows
   *  where the burst ended and never the empty set it passed through. */
  #onSelectionChange = (): void => {
    if (this.#selectionFrame) return
    this.#selectionFrame = requestAnimationFrame(() => {
      this.#selectionFrame = 0
      this.#commitPicks()
    })
  }

  // ── the hand on the select ─────────────────────────────────────────────

  #watchGesture(on: boolean): void {
    const bind = on ? document.addEventListener.bind(document) : document.removeEventListener.bind(document)
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) bind(type, this.#onPointer as EventListener, true)
    for (const type of ['keydown', 'keyup'] as const) bind(type, this.#onKey as EventListener, true)
    const win = on ? window.addEventListener.bind(window) : window.removeEventListener.bind(window)
    win(POINTER_GESTURE_END, this.#onHandLifted)
    win('blur', this.#onHandLifted)
  }

  /** The event is the truth about the button, never a remembered press: a
   *  release swallowed at window capture still shows as `buttons` without the
   *  primary bit on the next move. */
  #onPointer = (e: PointerEvent): void => {
    const down = e.type === 'pointerdown' ? e.button === 0
      : e.type === 'pointermove' ? (e.buttons & 1) === 1
      : false
    if (down === this.#buttonDown) return
    this.#buttonDown = down
    this.#settleHand()
  }

  #onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Control' && e.key !== 'Meta') return
    const down = e.type === 'keydown'
    if (down === this.#modifierDown) return
    this.#modifierDown = down
    this.#settleHand()
  }

  #onHandLifted = (): void => {
    if (!this.#buttonDown && !this.#modifierDown) return
    this.#buttonDown = false
    this.#modifierDown = false
    this.#settleHand()
  }

  #selecting(): boolean { return this.#buttonDown || this.#modifierDown }

  /** The hand lifted: a band switch that waited happens now. */
  #settleHand(): void {
    if (this.#selecting() || !this.#switchOwed) return
    this.#switchOwed = false
    this.#commitPicks()
  }

  #commitPicks(): void {
    const next = [...(this.#selection?.selected ?? [])]
    const page = here()
    const same = next.length === this.#picks.length && next.every((label, i) => label === this.#picks[i])
      && page.join('\u0000') === this.#picksPage.join('\u0000')
    if (same) return
    const wasSelected = this.#selected()
    const wasPicking = this.#picking()
    // The slot would change hands mid-select: wait for the hand to lift.
    if (wasSelected !== next.length >= SELECTION_SHELF_MIN && this.#selecting()) { this.#switchOwed = true; return }
    this.#switchOwed = false
    this.#picks = next
    this.#picksPage = page
    // A fresh selection brings the selection shelf forward; one that is only
    // added to or trimmed leaves the pair as the participant set it.
    if (!wasSelected && this.#selected()) this.#forward = 'picks'
    // A picture whose tile left the selection is let go now, not on unmount.
    const keep = new Set(next.map(label => entryKey({ label, sourceSegments: page })))
    for (const [key, url] of this.#pickThumbs) {
      if (!keep.has(key)) { URL.revokeObjectURL(url); this.#pickThumbs.delete(key) }
    }
    // The band changes hands: a shelf row in flight has nowhere to land.
    if (!wasPicking && this.#picking()) this.#endDrag()
    if (this.#picking()) for (const label of next) void this.#loadPickThumb(label, page)
    this.#render()
    this.#announcePicks()
  }

  async #loadPickThumb(label: string, page: readonly string[]): Promise<void> {
    const key = entryKey({ label, sourceSegments: page })
    if (this.#pickThumbs.has(key)) return
    const url = await resolveThumb({ label, sourceSegments: [...page] })
    if (!url) return
    const still = this.#picks.includes(label) && page.join('\u0000') === this.#picksPage.join('\u0000')
    if (!still || this.#pickThumbs.has(key)) { URL.revokeObjectURL(url); return }
    this.#pickThumbs.set(key, url)
    if (this.#picking()) this.#render()
  }

  /** What the selection shelf lists, apart from `shelf:changed`: the shelf's
   *  readers count what is held, and a selection is not held. */
  #announcePicks(): void {
    const shown = this.#picking()
    EffectBus.emit('selection-shelf:changed', { labels: shown ? [...this.#picks] : [], shown })
  }

  /** The × on a selection row: that tile leaves the selection. The service
   *  announces it, and the band follows on the next frame. */
  #unpick(label: string | undefined): void {
    if (label) this.#selection?.remove?.(label)
  }

  #renderPicks(): void {
    const queue = this.#queue
    const done = new Set(queue?.done ?? [])
    const current = queue?.current ?? null
    const remove = esc(t('quick-tray.unselect', 'Take it out of the selection'))
    const doneWord = esc(t('quick-tray.done', 'done'))
    const rows = this.#picks.map((label, index) => {
      const thumb = this.#pickThumbs.get(entryKey({ label, sourceSegments: this.#picksPage }))
      const face = thumb
        ? `<span class="thumb"><img src="${thumb}" alt="" draggable="false"></span>`
        : tileIcon(label)
      const isDone = done.has(label)
      const state = `${isDone ? ' done' : ''}${current === label ? ' current' : ''}`
      const mark = isDone ? `<span class="mark" title="${doneWord}" aria-label="${doneWord}">✓</span>` : ''
      return `<li class="row pick${state}" data-pick="${index}" tabindex="0"${current === label ? ' aria-current="true"' : ''}>
        ${face}<span class="label">${esc(label)}</span>${mark}
        <button class="remove" type="button" data-pick="${index}" tabindex="-1" aria-label="${remove}: ${esc(label)}" title="${remove}">×</button>
      </li>`
    }).join('')
    const title = esc(t('quick-tray.selected', 'Selected'))
    // No fold: this is the set the next act falls on, and hiding it would hide
    // what is about to change. The pair of icons stands where a fold would.
    this.#root.innerHTML = `<style>${STYLE}</style>
      <section class="shelf picks" aria-label="${title}" data-consumes-wheel>
        <span class="legend">${SELECT_ICON}<span class="word">${title}</span><span class="count">${this.#picks.length}</span></span>
        <ul class="rows" aria-label="${title}">${rows}</ul>
        <span class="tools">${this.#swapHtml()}</span>
      </section>`
    for (const row of this.#root.querySelectorAll<HTMLLIElement>('.pick')) {
      row.addEventListener('keydown', (e) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return
        e.preventDefault()
        this.#unpick(this.#picks[Number(row.dataset['pick'])])
      })
    }
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>('.pick .remove')) {
      button.addEventListener('click', (e) => {
        e.stopPropagation()
        this.#unpick(this.#picks[Number(button.dataset['pick'])])
      })
    }
    this.#wireWheel()
    this.#wireSwap()
    this.#reserve()
  }

  // ── paint ────────────────────────────────────────────────────────────────

  #render(): void {
    // Two or more selected, the selection shelf forward: it shows whatever the
    // shelf holds or however it is folded. The shelf's rows wait, untouched.
    if (this.#picking()) { this.#renderPicks(); return }
    // The shelf brought forward over a selection shows whatever it holds,
    // folded or empty: the pair of icons that bring the selection back is on it.
    const paired = this.#selected()
    // Nothing held, nothing shown: an empty shelf is a band with no use. A
    // pinned ring is the exception — it is kept to be reached, empty or not.
    const keptEmpty = this.#ringId !== null && this.#pinned.has(this.#ringId)
    if (!paired && (this.#folded || (this.#entries.length === 0 && !this.#opened && !keptEmpty))) {
      this.#root.innerHTML = `<style>${STYLE}</style>`
      this.#shown = []
      this.#reserve()
      return
    }
    const title = esc(this.#ringName())
    const search = esc(t('quick-tray.search', 'search'))
    const expandTip = esc(this.#expanded ? t('quick-tray.collapse', 'Close the rings') : t('quick-tray.expand', 'Open the rings'))
    this.#root.innerHTML = `<style>${STYLE}</style>
      <section class="shelf face-${this.#face}${this.#expanded ? ' open' : ''}${this.#dragging ? ' dragging' : ''}" style="--item:${this.#itemSize}px" aria-label="${title}" data-consumes-wheel>
        <div class="bar">
          <span class="legend">${SHELF_ICON}<span class="word">${title}</span><span class="count">${this.#entries.length}</span></span>
          <input class="add" type="text" spellcheck="false" autocomplete="off" value="${esc(this.#filter)}" placeholder="${search}" aria-label="${search}">
          <ul class="rows items" aria-label="${title}"></ul>
          <span class="tools">${paired ? this.#swapHtml() : ''}<button class="tool expand${this.#expanded ? ' on' : ''}" type="button" aria-expanded="${this.#expanded}" title="${expandTip}" aria-label="${expandTip}">${this.#expanded ? CHEVRON_DOWN : CHEVRON_RIGHT}</button></span>
        </div>
        ${this.#expanded ? this.#ringsHtml() : ''}
      </section>`
    this.#paintItems()
    this.#wireSwap()
    this.#wireHead()
    this.#reserve()
  }

  /** The icons alone — repainted as the search narrows them, without touching
   *  the head, so the search keeps its caret. */
  #paintItems(): void {
    const list = this.#root.querySelector<HTMLUListElement>('.items')
    if (!list) return
    // Rows are addressed by POSITION in what was painted, never by key: a key
    // holds a NUL, which an HTML parser rewrites.
    const words = this.#filter.trim().toLowerCase()
    this.#shown = words ? this.#entries.filter(e => e.label.toLowerCase().includes(words)) : [...this.#entries]
    const drag = esc(t('quick-tray.drag', 'Click to place it here · drag onto the hive · hold Shift to move it'))
    const remove = esc(t('quick-tray.remove', 'Take it off the shelf'))
    list.innerHTML = this.#shown.map((entry, index) => {
      const thumb = this.#thumbs.get(entryKey(entry))
      const face = entry.kind === 'tag'
        ? `<span class="glyph" aria-hidden="true">#</span>`
        : thumb
        ? `<span class="thumb"><img src="${thumb}" alt="" draggable="false"></span>`
        : tileIcon(entry.label)
      const lit = entry.kind === 'tag' && this.#lens.includes(entry.label)
      return `<li class="row${this.#dragging === entry ? ' lifted' : ''}${entry.kind === 'tag' ? ' tag' : ''}${lit ? ' lit' : ''}"${entry.kind === 'tag' ? ` aria-pressed="${lit}"` : ''} data-index="${index}" tabindex="0" aria-label="${esc(entry.label)} · ${drag}">
        ${face}<span class="label">${esc(entry.label)}</span>
        <button class="remove" type="button" data-index="${index}" tabindex="-1" aria-label="${remove}: ${esc(entry.label)}" title="${remove}">×</button>
      </li>`
    }).join('')
    for (const row of list.querySelectorAll<HTMLLIElement>('.row')) {
      const entry = (): TrayEntry | undefined => this.#shown[Number(row.dataset['index'])]
      row.addEventListener('pointerdown', (e) => this.#onRowPointerDown(e, entry(), row))
      row.addEventListener('pointerenter', () => { if (this.#face === 'image' && !this.#dragging) this.#showTip(row, entry()?.label) })
      row.addEventListener('pointerleave', () => this.#hideTip())
      row.addEventListener('keydown', (e) => {
        const it = entry()
        if (!it) return
        // Delete or Backspace takes a focused row off, as its × does; Enter places it here.
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.letGo(new Set([entryKey(it)])) }
        else if (e.key === 'Enter' && it.kind !== 'tag') { e.preventDefault(); this.#eject(it, e.shiftKey, row) }
      })
    }
    // A tag is a lens: a click on it filters the hive by it, a second lets it go.
    for (const row of list.querySelectorAll<HTMLLIElement>('.row.tag')) {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.remove')) return
        const tag = this.#shown[Number(row.dataset['index'])]?.label
        if (tag) this.#filterBy(tag)
      })
    }
    for (const button of list.querySelectorAll<HTMLButtonElement>('.remove')) {
      button.addEventListener('pointerdown', (e) => e.stopPropagation())
      button.addEventListener('click', (e) => {
        e.stopPropagation()
        const entry = this.#shown[Number(button.dataset['index'])]
        if (entry) this.letGo(new Set([entryKey(entry)]))
      })
    }
    this.#wireWheel()
  }

  /** The rings, one line each: the name on the left (a click types a new one),
   *  then what the ring holds, cut to the line. A click on the line brings it
   *  forward; the pin keeps it when it empties. */
  #ringsHtml(): string {
    const pinTip = esc(t('quick-tray.pin', 'Pin: keep it when it empties'))
    const newTip = esc(t('quick-tray.ring-new', 'name a new ring'))
    const line = (id: string | null, name: string, items: readonly string[]): string => {
      const pinned = id !== null && this.#pinned.has(id)
      const nameCell = id !== null && this.#renaming === id
        ? `<input class="ring-name-input" type="text" spellcheck="false" autocomplete="off" value="${esc(name)}" data-ring="${esc(id)}" aria-label="${esc(name)}">`
        : `<button class="ring-name" type="button"${id === null ? ' disabled' : ` data-ring="${esc(id)}"`}>${esc(name)}</button>`
      return `<li class="ring${id === this.#ringId ? ' current' : ''}">
          ${nameCell}
          <button class="ring-items" type="button" data-pick-ring="${id === null ? '' : esc(id)}">${items.length ? esc(items.join(' · ')) : '<span class="empty">—</span>'}</button>
          ${id === null ? '<span class="pin-gap"></span>' : `<button class="pin${pinned ? ' on' : ''}" type="button" data-pin="${esc(id)}" aria-pressed="${pinned}" title="${pinTip}" aria-label="${pinTip}">${PIN_ICON}</button>`}
        </li>`
    }
    const session = this.#ringId === null ? this.#entries : this.#sessionEntries
    const rows = [
      line(null, t('quick-tray.title', 'Shelf'), session.map(e => e.label)),
      ...this.#rings.map(ring => line(ring.id, ring.label,
        ring.id === this.#ringId ? this.#entries.map(e => e.label) : membersToEntries(ring.members).map(e => e.label))),
    ].join('')
    const faces = (['image', 'text', 'both'] as const).map(face => {
      const word = esc(t(`quick-tray.face-${face}`, face))
      return `<button class="face-btn${this.#face === face ? ' on' : ''}" type="button" data-face="${face}" aria-pressed="${this.#face === face}">${word}</button>`
    }).join('')
    return `<ul class="rings" aria-label="${esc(t('quick-tray.rings', 'Named rings'))}">
        <li class="faces" role="group" aria-label="${esc(t('quick-tray.face', 'Show the items as'))}">${faces}
          <label class="size">${esc(t('quick-tray.size', 'size'))}<input class="size-input" type="range" min="${ITEM_MIN}" max="${ITEM_MAX}" step="1" value="${this.#itemSize}" aria-label="${esc(t('quick-tray.size-tip', 'Size of the shelf\'s tiles'))}"></label>
        </li>${rows}
        <li class="ring new"><button class="ring-new" type="button">${ADD_ICON}<span>${newTip}</span></button></li>
      </ul>`
  }

  /** The name on hover, at once: the native title waits too long to read a strip by. */
  #showTip(row: HTMLElement, label: string | undefined): void {
    if (!label) return
    let tip = this.#root.querySelector<HTMLDivElement>('.tip')
    if (!tip) {
      tip = document.createElement('div')
      tip.className = 'tip'
      tip.setAttribute('aria-hidden', 'true')
      this.#root.appendChild(tip)
    }
    const box = row.getBoundingClientRect()
    tip.textContent = label
    tip.style.left = `${box.left + box.width / 2}px`
    tip.style.top = `${box.bottom + 4}px`
  }

  #hideTip(): void { this.#root.querySelector('.tip')?.remove() }

  /** The head's own acts: type to narrow the icons, Enter to add a word no
   *  icon holds as a tag, the arrow that opens the rings, and the rings. */
  #wireHead(): void {
    const input = this.#root.querySelector<HTMLInputElement>('.add')
    input?.addEventListener('input', () => { this.#filter = input.value; this.#paintItems(); this.#reserve() })
    input?.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') { input.value = ''; this.#filter = ''; this.#paintItems(); return }
      if (e.key !== 'Enter' || !input.value.trim()) return
      e.preventDefault()
      if (this.#shown.length > 0) return
      const name = input.value
      this.#filter = ''
      void this.#takeTag(name)
    })
    this.#root.querySelector('.expand')?.addEventListener('click', () => {
      this.#expanded = !this.#expanded
      this.#renaming = null
      if (this.#expanded) void this.#loadRings()
      this.#render()
    })
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>('.face-btn')) {
      button.addEventListener('click', () => {
        const face = button.dataset['face']
        if (face !== 'image' && face !== 'text' && face !== 'both') return
        this.#face = face
        void this.#keepState()
        this.#render()
      })
    }
    const size = this.#root.querySelector<HTMLInputElement>('.size-input')
    size?.addEventListener('input', () => {
      this.#itemSize = Math.min(ITEM_MAX, Math.max(ITEM_MIN, Math.round(Number(size.value)) || ITEM_DEFAULT))
      this.#root.querySelector<HTMLElement>('.shelf')?.style.setProperty('--item', `${this.#itemSize}px`)
    })
    size?.addEventListener('change', () => { void this.#keepState() })
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>('.ring-name[data-ring]')) {
      button.addEventListener('click', () => { this.#renaming = button.dataset['ring'] ?? null; this.#render() })
    }
    const nameInput = this.#root.querySelector<HTMLInputElement>('.ring-name-input')
    if (nameInput) {
      nameInput.focus()
      nameInput.select()
      let done = false
      const commit = (keep: boolean): void => {
        if (done) return
        done = true
        if (keep) void this.#renameRing(nameInput.dataset['ring'] ?? '', nameInput.value)
        else { this.#renaming = null; this.#render() }
      }
      nameInput.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'Enter') { e.preventDefault(); commit(true) }
        else if (e.key === 'Escape') { e.preventDefault(); commit(false) }
      })
      nameInput.addEventListener('blur', () => commit(true))
    }
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>('.ring-items')) {
      button.addEventListener('click', () => { void this.#switchRing(button.dataset['pickRing'] || null) })
    }
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>('.pin')) {
      button.addEventListener('click', () => this.#togglePin(button.dataset['pin'] ?? ''))
    }
    this.#root.querySelector('.ring-new')?.addEventListener('click', () => { void this.#newRing() })
  }

  /** A wheel over the rows scrolls them sideways, so a long shelf reads with a mouse. */
  #wireWheel(): void {
    this.#root.querySelector('.rows:not(.items)')?.addEventListener('wheel', (e) => {
      const rowsEl = e.currentTarget as HTMLElement
      const ev = e as WheelEvent
      if (Math.abs(ev.deltaY) <= Math.abs(ev.deltaX)) return
      rowsEl.scrollLeft += ev.deltaY
      ev.preventDefault()
    }, { passive: false })
  }

  /** Hold the band under the shelf on the canvas, measured after layout. A
   *  folded shelf holds nothing. The selection shelf lays over the canvas and
   *  holds no band: while it stands, the band stays as the shelf last measured
   *  it, so the hive does not resize or refit when a selection comes and goes. */
  #reserve(): void {
    this.#watchSize()
    cancelAnimationFrame(this.#measureFrame)
    this.#measureFrame = requestAnimationFrame(() => {
      const shelf = this.#root.querySelector('.shelf')
      const size = this.#selected()
        ? this.#band
        : shelf ? Math.round(shelf.getBoundingClientRect().bottom + INSET_GAP) : 0
      this.#band = size
      if (size === this.#reserved) return
      this.#reserved = size
      EffectBus.emit('viewport:inset', { owner: INSET_OWNER, side: 'top', size })
    })
  }

  #onResize = (): void => { this.#reserve() }

  /** Follow the shelf now on screen; a repaint makes a new box to follow. */
  #watchSize(): void {
    if (typeof ResizeObserver === 'undefined') return
    this.#sizeWatch ??= new ResizeObserver(() => this.#reserve())
    const shelf = this.#root.querySelector('.shelf')
    if (shelf === this.#watched) return
    this.#watched = shelf
    this.#sizeWatch.disconnect()
    if (shelf) this.#sizeWatch.observe(shelf)
  }

  /** A take on a folded shelf shows it for PEEK_MS, so the add is seen. The
   *  pointer arriving within that time keeps it open; nothing is saved either
   *  way — the participant's own fold stays what it was. */
  #peek(): void {
    if (this.#folded) {
      this.#peeking = true
      this.#setFolded(false)
    }
    if (!this.#peeking) return
    clearTimeout(this.#peekTimer)
    this.#peekTimer = setTimeout(() => {
      if (!this.#peeking) return
      this.#peeking = false
      this.#setFolded(true)
    }, PEEK_MS)
  }

  /** The pointer is over the shelf, or a press took over: the peek is over. */
  #endPeek = (): void => {
    this.#peeking = false
    clearTimeout(this.#peekTimer)
  }

  /** A participant's fold: applied, and kept for the next boot. */
  #press(folded: boolean): void {
    this.#endPeek()
    this.#pressed = true
    if (folded === this.#folded) return
    this.#setFolded(folded)
    void this.#keepState()
  }

  /** The fold, how the items show, and the pinned rings: one current record. */
  async #keepState(): Promise<void> {
    const store = ioc()?.get?.(STORE_KEY) as StoreLike | undefined
    const pool = await store?.getPool?.(STATE_POOL)
    if (!pool || !store?.putPoolDoc) return
    const record = { ...this.#stateExtra, folded: this.#folded, face: this.#face, size: this.#itemSize, pinned: [...this.#pinned], at: Date.now() }
    const bytes = new TextEncoder().encode(JSON.stringify(record)).buffer as ArrayBuffer
    await store.putPoolDoc(pool, bytes, undefined, { keep: 'current' }).catch(() => undefined)
  }

  /** The fold the participant left it in. The store may register after the
   *  shelf mounts, so this waits for it; a press made meanwhile wins. */
  #recallFold(): void {
    const read = async (store: StoreLike | undefined): Promise<void> => {
      const pool = await store?.getPool?.(STATE_POOL)
      if (!pool || !store?.getPoolDoc) return
      try {
        const bytes = await store.getPoolDoc(pool)
        if (!bytes) return
        const record = JSON.parse(new TextDecoder().decode(bytes)) as { folded?: unknown; face?: unknown; size?: unknown; pinned?: unknown } & Record<string, unknown>
        const { folded: _f, face, size, labels: _l, pinned, at: _a, ...extra } = record
        this.#stateExtra = extra
        if (face === 'image' || face === 'text' || face === 'both') this.#face = face
        if (typeof size === 'number' && Number.isFinite(size)) this.#itemSize = Math.min(ITEM_MAX, Math.max(ITEM_MIN, Math.round(size)))
        if (Array.isArray(pinned)) for (const id of pinned) if (typeof id === 'string') this.#pinned.add(id)
        this.#render()
        if (this.#pressed) return
        if (record?.folded === true) this.#setFolded(true)
      } catch { /* no record, or not ours: the shelf stays open */ }
    }
    const container = ioc()
    const store = container?.get?.(STORE_KEY) as StoreLike | undefined
    if (store) void read(store)
    else container?.whenReady?.(STORE_KEY, v => { void read(v as StoreLike) })
  }

  #setFolded(folded: boolean): void {
    if (folded === this.#folded) return
    this.#folded = folded
    if (folded) this.#endDrag()
    this.#render()
    this.#announce()
  }

  #paintGhost(x: number, y: number): void {
    if (!this.#dragging) return
    if (!this.#ghost) {
      this.#ghost = document.createElement('div')
      this.#root.appendChild(this.#ghost)
    }
    // The ghost names the VERB the release will do — place, or with Shift,
    // move — so the decision the drop makes is readable before it lands.
    this.#ghost.className = `ghost${this.#custody ? ' custody' : ''}`
    this.#ghost.setAttribute('aria-hidden', 'true')
    this.#ghost.style.left = `${x}px`
    this.#ghost.style.top = `${y}px`
    this.#ghost.innerHTML = `<span class="verb">${esc(this.#custody ? t('quick-tray.custody', 'move') : t('quick-tray.appearance', 'place'))}</span><span class="name">${esc(this.#dragging.label)}</span>`
  }

  // ── the drop ─────────────────────────────────────────────────────────────

  #onRowPointerDown(event: PointerEvent, entry: TrayEntry | undefined, row: HTMLElement | null = null): void {
    if (event.button !== 0 || !entry || entry.kind === 'tag') return
    if ((event.target as HTMLElement | null)?.closest?.('.remove')) return
    this.#pending = { entry, x: event.clientX, y: event.clientY, row }
    document.addEventListener('pointermove', this.#onDragMove)
    document.addEventListener('pointerup', this.#onDragUp)
    document.addEventListener('pointercancel', this.#onDragCancel)
  }

  #detachDrag(): void {
    document.removeEventListener('pointermove', this.#onDragMove)
    document.removeEventListener('pointerup', this.#onDragUp)
    document.removeEventListener('pointercancel', this.#onDragCancel)
  }

  #endDrag(): void {
    this.#pending = null
    this.#detachDrag()
    this.#ghost?.remove()
    this.#ghost = null
    this.classList.remove('lifting')
    if (this.#dragging) {
      this.#dragging = null
      EffectBus.emit('drop:dragging', { active: false })
      EffectBus.emit('portal-carry:drag-end', {})
      this.#render()
    }
  }

  #onDragCancel = (): void => { this.#endDrag() }

  #onDragMove = (event: PointerEvent): void => {
    const p = this.#pending
    if (!p) return
    if (!this.#dragging) {
      if (Math.hypot(event.clientX - p.x, event.clientY - p.y) < DRAG_THRESHOLD) return
      this.#dragging = p.entry
      this.#hideTip()
      // Chrome sits at the header's level, under dialogs; only a row in flight
      // rises over every window, so its ghost reads above a Portals row too.
      this.classList.add('lifting')
      // The overlay becomes a bare drop surface (icons hidden) and previews
      // the carried tile under the pointer — the contract a Portals row drag uses.
      EffectBus.emit('drop:dragging', { active: true, targetTile: { label: p.entry.label } })
      // Portals rows light as drop zones while a row rides the pointer. A loose
      // atom has nothing a portal could point at, so they stay dark for it.
      if (!p.entry.loose) EffectBus.emit('portal-carry:drag-start', { label: p.entry.label })
      this.#render()
    }
    this.#custody = event.shiftKey
    this.#paintGhost(event.clientX, event.clientY)
  }

  #onDragUp = (event: PointerEvent): void => {
    const p = this.#pending
    const wasDragging = this.#dragging !== null
    this.#endDrag()
    if (!p) return
    // No drag: a click. The icon leaves on the release, never on a later
    // click event, so a run of clicks keeps up with the hand.
    if (!wasDragging) { this.#eject(p.entry, event.shiftKey, p.row); return }
    this.#suppressTrailingClick()
    this.#drop(p.entry, event)
  }

  #drop(entry: TrayEntry, event: PointerEvent): void {
    // Release point, never a remembered hover: crossing chrome makes the
    // overlay broadcast a null hover at exactly the moment it is needed.
    const under = document.elementFromPoint?.(event.clientX, event.clientY) as HTMLElement | null
    // Letting go back on the shelf is a cancelled drag, not a drop.
    if (under?.closest?.(QUICK_TRAY_SURFACE)) return

    // A Portals row: add the tile to that portal through the index's own
    // handler — the same write every other way into a portal uses.
    const portalKey = under?.closest?.('[data-portal-drop]')?.getAttribute('data-portal-drop')
    // A reference needs a place to point at, and a loose atom has none, so it
    // lands on a page first.
    const ownPath = [...entry.sourceSegments, entry.label]
    if (portalKey) {
      if (!entry.loose) EffectBus.emit('portal-carry:drop', { label: entry.label, segments: ownPath, targetKey: portalKey })
      return
    }
    if (under?.closest?.('hc-aggregate-index')) {
      if (!entry.loose) EffectBus.emit('portal-carry:drop', { label: entry.label, segments: ownPath })
      return
    }

    const overlay = ioc()?.get?.('@diamondcoreprocessor.com/TileOverlayDrone') as OverlayLike | undefined
    const exact = overlay?.dropTargetAtClient?.(event.clientX, event.clientY) ?? null
    const label = exact?.label ?? overlay?.labelAtClient?.(event.clientX, event.clientY) ?? null
    const page = here()

    let targetSegments: string[]
    let targets: Record<string, number> | undefined
    if (label) {
      // Over a tile: INTO it — the incidence lands as that tile's child.
      targetSegments = [...page, label]
    } else if (exact && !exact.occupied) {
      // Over an empty hex: here, in that seat.
      targetSegments = page
      if (exact.index >= 0) targets = { [entry.label]: exact.index }
    } else {
      return   // not over the hive — nothing happens
    }

    // A loose atom has no page to release, so Shift cannot make it a move.
    EffectBus.emit('shelf:place', {
      entries: [{
        label: entry.label,
        sourceSegments: [...entry.sourceSegments],
        ...(entry.loose && entry.sig ? { sig: entry.sig } : {}),
      }],
      targetSegments,
      ...(targets ? { targets } : {}),
      custody: event.shiftKey && !entry.loose,
    })
  }

  /** A drag may synthesize a click after pointerup, which must not land as a
   *  press on whatever is under the release. It may also synthesize none: the
   *  shelf re-renders during a drag, and a pressed row that is gone produces no
   *  click. So the participant's next press disarms the guard, or their own
   *  next click would be swallowed. Same guard as the aggregate index. */
  #suppressTrailingClick(): void {
    this.#trailingClickCleanup?.()
    let armed = true
    const cleanup = (): void => {
      if (!armed) return
      armed = false
      window.removeEventListener('click', swallow, true)
      window.removeEventListener('pointerdown', cleanup, true)
      if (this.#trailingClickCleanup === cleanup) this.#trailingClickCleanup = null
    }
    const swallow = (event: MouseEvent): void => {
      cleanup()
      event.stopImmediatePropagation()
      event.preventDefault()
    }
    window.addEventListener('click', swallow, true)
    window.addEventListener('pointerdown', cleanup, true)
    this.#trailingClickCleanup = cleanup
  }
}

/** Define the element once; safe under hot reload and in specs. */
export const defineQuickTray = (): void => {
  if (!customElements.get(QUICK_TRAY_SURFACE)) customElements.define(QUICK_TRAY_SURFACE, QuickTrayElement)
}
