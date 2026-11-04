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
// so does an empty shelf: holding nothing, it shows nothing.
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
// THE SELECTION SHELF takes the same band while two or more tiles are
// selected: it lists what the next act will fall on — the multi-tile quick
// menu, the image wall in turn — BEFORE anything fires, so a participant sees
// the set and can trim it (a row's × takes that tile out of the selection,
// nothing else). It is the shelf's slot, never a second strip: the shelf's
// rows are kept as they were and come back when the selection drops below
// two. It has no fold — it is what you are about to act on — and no drag: a
// selected tile is already on the hive. It never speaks on `shelf:changed`
// (the controls bar and the chat count what is HELD there); it says what it
// lists on `selection-shelf:changed`. While the image wall walks the set
// (`images:queue`), the tile being chosen for is lit and the ones done are
// ticked. The switch between the two is taken on a frame, so a selection
// rebuilt in a burst never shows the shelf for the instant it is empty.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { listGroups, readGroup, startGroup } from '../../assistant/context-groups.js'
import { dropEntries, entryKey, takeEntries, type TrayEntry } from './quick-tray.entries.js'
import { bouquetOf, entriesToMembers, membersToEntries, shelfType, tagSignature } from './quick-tray.ring.js'

export const QUICK_TRAY_SURFACE = 'hc-quick-tray'

/** Movement before a press counts as a drag rather than a click — the same
 *  threshold the aggregate index's rows use, so a row-drag feels the same
 *  wherever it starts. */
const DRAG_THRESHOLD = 5
/** How long a folded shelf stays open after a take, unless the pointer arrives. */
const PEEK_MS = 4000
/** A shelf this full asks to be kept as a group — the seven-tile flower: one
 *  at the heart and the six around it, the same shape as the quick menu ring. */
const DEFAULT_FILL = 7
const FILL_MIN = 2
const FILL_MAX = 24
const SIG_RE = /^[0-9a-f]{64}$/

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

/** The tags set on this layer's tiles — the ones in use here, never the hive's
 *  whole list. A tag counts when a visible tile carries it. */
const layerTags = (): string[] => {
  const names = (ioc()?.get?.('@hypercomb.social/TagRegistry') as TagRegistryLike | undefined)?.names ?? []
  const metrics = ioc()?.get?.('@diamondcoreprocessor.com/OverlapMetrics') as { tagCount?: (name: string) => number } | undefined
  return names.filter(name => (metrics?.tagCount?.(name) ?? 0) > 0).sort((a, b) => a.localeCompare(b))
}

const t = (key: string, fallback: string): string =>
  (ioc()?.get?.(I18N_IOC_KEY) as I18nProvider | undefined)?.t?.(key) ?? fallback

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The thumbnail is the hex capture the hive draws, read-only: the placement
 *  worker's warm props lookup, then the picture it names. A miss shows ⬢. */
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
  height:2.75rem;box-sizing:border-box;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;
  gap:0.75rem;padding:0 0.45rem 0 0.95rem;border-radius:var(--hc-radius-floating,4px);
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
.legend{position:relative;display:inline-flex;align-items:center;gap:0.45rem;letter-spacing:0.12em;text-transform:uppercase;font-family:var(--hc-mono,system-ui);
  font-size:0.68rem;font-weight:600;color:rgb(var(--shelf));white-space:nowrap;}
.count{min-width:1.5em;height:1.4em;box-sizing:border-box;display:inline-grid;place-items:center;padding:0 0.35em;
  border-radius:var(--hc-radius-control,2px);background:rgba(var(--shelf),0.16);color:var(--hc-window-ink-loud,currentColor);
  font-variant-numeric:tabular-nums;letter-spacing:0;}
.rows{position:relative;display:flex;align-items:center;gap:0.3rem;margin:0;padding:0;list-style:none;min-width:0;height:100%;
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
.label{max-width:11rem;overflow:hidden;text-overflow:ellipsis;}
.remove{appearance:none;width:1.25rem;height:1.25rem;display:inline-grid;place-items:center;border:0;padding:0;
  border-radius:var(--hc-radius-control,2px);background:transparent;color:var(--hc-window-ink-plain,currentColor);
  font:inherit;font-size:0.95rem;line-height:1;cursor:pointer;opacity:0;transition:opacity 120ms ease;}
.row:hover .remove,.row:focus-within .remove{opacity:0.75;}
.remove:hover,.remove:focus-visible{opacity:1;background:rgba(var(--shelf),0.2);outline:none;}
.row.tag{cursor:pointer;}
.row.tag.lit{outline:1px solid currentColor;}
.ask{display:inline-flex;align-items:center;gap:0.4rem;}
.ask button{appearance:none;border:1px solid currentColor;border-radius:var(--hc-radius-control,2px);background:none;color:inherit;font:inherit;cursor:pointer;padding:0 0.5em;}
.fill{width:3rem;box-sizing:border-box;background:transparent;color:inherit;border:0;border-bottom:1px solid currentColor;font:inherit;padding:0.1em 0.2em;opacity:0.8;outline:none;}
.apply{appearance:none;border:1px solid currentColor;border-radius:var(--hc-radius-control,2px);background:none;color:inherit;font:inherit;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;padding:0 0.6em;}
.kind{appearance:none;border:0;background:none;color:inherit;font:inherit;letter-spacing:0.12em;text-transform:uppercase;opacity:0.7;cursor:pointer;padding:0 0.4em;}
.add{min-width:8rem;max-width:14rem;box-sizing:border-box;background:transparent;color:inherit;border:0;border-bottom:1px solid currentColor;opacity:0.85;font:inherit;padding:0.1em 0.3em;outline:none;}
.fold{position:relative;appearance:none;width:1.75rem;height:1.75rem;display:inline-grid;place-items:center;border:0;padding:0;
  border-radius:var(--hc-radius-control,2px);background:transparent;color:var(--hc-window-ink-plain,currentColor);cursor:pointer;}
.fold:hover,.fold:focus-visible{background:rgba(var(--shelf),0.16);color:var(--hc-window-ink-loud,currentColor);outline:none;}
.fold svg{width:1rem;height:1rem;display:block;}
@keyframes hc-shelf-taken{from{background:rgba(var(--shelf),0.45);border-color:rgba(var(--shelf),0.9);}}
.taken{animation:hc-shelf-taken 700ms ease-out;}
@media (prefers-reduced-motion:reduce){.taken{animation:none;}.row,.remove{transition:none;}}
@media (max-width:640px){.shelf{gap:0.5rem;padding-left:0.75rem;}.label{max-width:7rem;}.legend .word{display:none;}}
.ghost{position:fixed;z-index:2147483600;pointer-events:none;margin-left:0.8rem;margin-top:-0.9rem;max-width:14rem;
  padding:0.3rem 0.6rem;display:flex;align-items:center;gap:0.4rem;border-radius:var(--hc-radius-floating,4px);
  background:rgba(var(--hc-panel-pane,12,28,46),0.94);box-shadow:0 0 0 1px rgba(var(--shelf),0.55),0 6px 20px rgba(var(--hc-panel-shadow,0,0,0),0.3);
  color:var(--hc-window-ink-loud,currentColor);font-family:var(--hc-font,system-ui);font-size:0.85rem;line-height:1.2;white-space:nowrap;}
.ghost .verb{font-family:var(--hc-mono,system-ui);font-size:0.65rem;letter-spacing:0.08em;text-transform:uppercase;color:rgb(var(--shelf));}
.ghost.custody .verb{color:var(--hc-window-warn,#ffc46b);}
.ghost .name{overflow:hidden;text-overflow:ellipsis;}
.shelf.picks{--shelf:var(--pick);grid-template-columns:auto minmax(0,1fr);padding-right:0.95rem;}
.shelf.picks::before{--cut:rgba(var(--pick),0.5);}
.pick{cursor:default;}
.pick.current{border-color:rgba(var(--pick),0.9);background:rgba(var(--pick),0.2);box-shadow:0 0 0 1px rgba(var(--pick),0.5);}
.pick.done{opacity:0.7;}
.pick .mark{color:rgb(var(--pick));font-size:0.85rem;line-height:1;}
`

/** Chevrons drawn inline: an icon font does not reach into a shadow root. */
const CHEVRON_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>'

/** Owner of the shelf's reservation on the canvas (viewport:inset). */
const INSET_OWNER = 'quick-tray'
/** Clear air under the shelf before the hive starts, in px. */
const INSET_GAP = 6

export class QuickTrayElement extends HTMLElement {
  #root: ShadowRoot
  #entries: readonly TrayEntry[] = []
  #thumbs = new Map<string, string>()
  #offs: Array<() => void> = []
  #pending: { entry: TrayEntry; x: number; y: number } | null = null
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
  #measureFrame = 0
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
  #queue: ImageQueue | null = null
  /** The participant chose a number this session, so the saved one no longer speaks. */
  #fillChosen = false
  /** Open for typing though empty: the shell's shelf button brought it up. */
  #opened = false
  /** Which kept shelves the wheel walks, and the words that narrow them. Both
   *  last the session only: a refresh starts on every shelf again. */
  #type: 'all' | 'tags' | 'tiles' = 'all'
  #filter = ''
  /** The kept shelf the wheel last brought back. */
  #cycled: string | null = null
  /** The tags the hive is filtered on (the sticky `tags:filter`), and the reach
   *  they were set with. Mirrored, never owned: the shelf toggles, the hive filters. */
  #lens: readonly string[] = []
  /** How many a shelf holds before it asks to become a group. The participant's
   *  number, kept with the fold in `shelf:state`. */
  #fill = DEFAULT_FILL
  /** The size the shelf was at when it last asked, so it asks again only after
   *  another full fill has gathered. */
  #askedAt = 0
  #asking = false
  #reach: 'local' | 'children' | 'global' = 'local'

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
    this.#offs.push(EffectBus.on('shelf:placed', letGoOf))
    this.#offs.push(EffectBus.on('shelf:let-go', letGoOf))
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
    this.#watchSelection()
    this.#render()
    this.#announce()
    this.#announcePicks()
    this.#recallFold()
  }

  disconnectedCallback(): void {
    for (const off of this.#offs.splice(0)) off()
    window.removeEventListener('resize', this.#onResize)
    this.removeEventListener('pointerenter', this.#endPeek)
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
    this.#asking = this.#entries.length >= this.#askedAt + this.#fill
    this.#render()
    this.#answer(incoming)
    this.#announce()
  }

  /** Keep what the shelf holds as a group and clear it, so the next handful starts fresh. */
  async #keepAndClear(): Promise<void> {
    await this.#keepShelf()
    this.#asking = false
    this.#askedAt = 0
    this.letGo(new Set(this.#entries.map(entryKey)))
  }

  /** A tag onto the shelf, created if the hive does not know it yet. */
  async #takeTag(raw: string): Promise<void> {
    const name = raw.trim()
    if (!name) return
    const registry = ioc()?.get?.('@hypercomb.social/TagRegistry') as TagRegistryLike | undefined
    if (registry) { await registry.ensureLoaded?.(); if (!registry.names?.includes(name)) await registry.add?.(name) }
    this.take([{ label: name, sourceSegments: [], sig: await tagSignature(name), kind: 'tag' }])
  }

  /** The wheel: the next kept shelf of the chosen type that matches the words
   *  typed, brought back as what the shelf holds. */
  async #cycle(step: 1 | -1): Promise<void> {
    const kept = (await listGroups()).filter(group =>
      (this.#type === 'all' || shelfType(group) === this.#type)
      && group.label.toLowerCase().includes(this.#filter.toLowerCase()))
    if (kept.length === 0) return
    const at = kept.findIndex(group => group.id === this.#cycled)
    const next = kept[(at + step + kept.length) % kept.length]
    this.#cycled = next.id
    await this.#recallShelf(next.id)
  }

  /** Put the shelf's tags to work: on the picked tiles at once, or, with none
   *  picked, in hand for the hive to shade and the next click to scent. This is
   *  the pheromone bridge's own lane (pheromone-tiles.drone.ts), unchanged. */
  #applyBouquet(): void {
    const tags = bouquetOf(this.#entries)
    if (tags.length === 0) return
    const picked = [...((ioc()?.get?.(SELECTION_KEY) as SelectionLike | undefined)?.selected ?? [])]
    EffectBus.emitTransient('tags:apply-begin', { tags })
    if (picked.length === 0) return
    for (const label of picked) EffectBus.emitTransient('tags:apply-paint', { label, add: true })
    EffectBus.emitTransient('tags:apply-commit', {})
  }

  /** Toggle one tag in the hive's filter. The reach stays as it was set. */
  #filterBy(tag: string): void {
    const active = this.#lens.includes(tag) ? this.#lens.filter(t => t !== tag) : [...this.#lens, tag]
    EffectBus.emit('tags:filter', { active, scope: this.#reach })
  }

  #turnType(): void {
    this.#type = this.#type === 'all' ? 'tags' : this.#type === 'tags' ? 'tiles' : 'all'
    this.#cycled = null
    this.#render()
  }

  /** Keep the shelf as a new group on the ring. An empty shelf, or one whose
   *  rows have no signature to name them by, keeps nothing. */
  async #keepShelf(): Promise<void> {
    const members = entriesToMembers(this.#entries)
    if (members.length === 0) return
    const count = (await listGroups()).length + 1
    await startGroup(`${t('shelf.ring.name', 'shelf')} ${count}`, members)
  }

  /** Bring a kept group back as what the shelf holds. */
  async #recallShelf(id: string): Promise<void> {
    const group = await readGroup(id)
    if (!group) return
    this.#entries = membersToEntries(group.members)
    for (const entry of this.#entries) void this.#loadThumb(entry)
    this.#peek()
    this.#render()
    this.#announce()
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
    const keys = new Set(incoming.map(entryKey))
    const lit = this.#folded ? [] : this.#entries.flatMap((entry, index) =>
      keys.has(entryKey(entry)) ? [this.#root.querySelector(`.row[data-index="${index}"]`)] : [])
    for (const element of lit) element?.classList.add('taken')
  }

  letGo(keys: ReadonlySet<string>): void {
    this.#entries = dropEntries(this.#entries, keys)
    this.#askedAt = Math.min(this.#askedAt, this.#entries.length)
    if (this.#entries.length < this.#askedAt + this.#fill) this.#asking = false
    for (const key of keys) {
      const url = this.#thumbs.get(key)
      if (url) { URL.revokeObjectURL(url); this.#thumbs.delete(key) }
    }
    this.#render()
    this.#announce()
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
    this.#render()
  }

  // ── the selection shelf ──────────────────────────────────────────────────

  #picking(): boolean { return this.#picks.length >= SELECTION_SHELF_MIN }

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

  #commitPicks(): void {
    const next = [...(this.#selection?.selected ?? [])]
    const page = here()
    const same = next.length === this.#picks.length && next.every((label, i) => label === this.#picks[i])
      && page.join('\u0000') === this.#picksPage.join('\u0000')
    if (same) return
    const wasPicking = this.#picking()
    this.#picks = next
    this.#picksPage = page
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
        : `<span class="glyph" aria-hidden="true">⬢</span>`
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
    // what is about to change.
    this.#root.innerHTML = `<style>${STYLE}</style>
      <section class="shelf picks" aria-label="${title}" data-consumes-wheel>
        <span class="legend"><span class="word">${title}</span><span class="count">${this.#picks.length}</span></span>
        <ul class="rows" aria-label="${title}">${rows}</ul>
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
    this.#reserve()
  }

  // ── paint ────────────────────────────────────────────────────────────────

  #render(): void {
    // Two or more selected: the band is the selection's, whatever the shelf
    // holds or however it is folded. The shelf's rows wait, untouched.
    if (this.#picking()) { this.#renderPicks(); return }
    // Nothing held, nothing shown: an empty shelf is a band with no use.
    if (this.#folded || (this.#entries.length === 0 && !this.#opened)) {
      this.#root.innerHTML = `<style>${STYLE}</style>`
      this.#reserve()
      return
    }
    // Rows are addressed by POSITION, never by key: a key holds a NUL, which an
    // HTML parser rewrites, so a key read back from an attribute matches nothing.
    const drag = esc(t('quick-tray.drag', 'Drag onto the hive to place it · hold Shift to move it'))
    const remove = esc(t('quick-tray.remove', 'Take it off the shelf'))
    const rows = this.#entries.map((entry, index) => {
      const key = entryKey(entry)
      const thumb = this.#thumbs.get(key)
      const face = entry.kind === 'tag'
        ? `<span class="glyph" aria-hidden="true">#</span>`
        : thumb
        ? `<span class="thumb"><img src="${thumb}" alt="" draggable="false"></span>`
        : `<span class="glyph" aria-hidden="true">⬢</span>`
      const lit = entry.kind === 'tag' && this.#lens.includes(entry.label)
      return `<li class="row${this.#dragging === entry ? ' lifted' : ''}${entry.kind === 'tag' ? ' tag' : ''}${lit ? ' lit' : ''}"${entry.kind === 'tag' ? ` aria-pressed="${lit}"` : ''} data-index="${index}" tabindex="0" title="${drag}">
        ${face}<span class="label">${esc(entry.label)}</span>
        <button class="remove" type="button" data-index="${index}" tabindex="-1" aria-label="${remove}: ${esc(entry.label)}" title="${remove}">×</button>
      </li>`
    }).join('')
    const body = `<ul class="rows" aria-label="${esc(t('quick-tray.title', 'Shelf'))}">${rows}</ul>`
    const hide = esc(t('quick-tray.hide', 'Hide the shelf'))
    this.#root.innerHTML = `<style>${STYLE}</style>
      <section class="shelf${this.#dragging ? ' dragging' : ''}" aria-label="${esc(t('quick-tray.title', 'Shelf'))}" data-consumes-wheel>
        <span class="legend"><span class="word">${esc(t('quick-tray.title', 'Shelf'))}</span><span class="count">${this.#entries.length}</span></span>
        ${this.#asking ? `<span class="ask"><span class="ask-word">${esc(t('quick-tray.ask', 'keep these as a group?'))}</span><button class="ask-keep" type="button">${esc(t('quick-tray.ask-keep', 'keep'))}</button><button class="ask-later" type="button">${esc(t('quick-tray.ask-later', 'not yet'))}</button></span>` : ''}
        <input class="fill" type="number" min="${FILL_MIN}" max="${FILL_MAX}" value="${this.#fill}" title="${esc(t('quick-tray.fill', 'How many gather before the shelf asks to keep them as a group'))}" aria-label="${esc(t('quick-tray.fill', 'How many gather before the shelf asks to keep them as a group'))}">
        ${bouquetOf(this.#entries).length > 0 ? `<button class="apply" type="button" title="${esc(t('quick-tray.apply', 'Scent the picked tiles with these tags, or hold them for the next tile you click'))}">${esc(t('quick-tray.apply-word', 'apply'))}</button>` : ''}
        <button class="kind" type="button" title="${esc(t('quick-tray.type', 'Wheel: next shelf · Shift+wheel: kind of shelf'))}">${esc(this.#type)}</button>
        <input class="add" type="text" list="hc-shelf-tags" spellcheck="false" autocomplete="off" value="${esc(this.#filter)}" placeholder="${esc(t('quick-tray.add', 'search or add a tag'))}" aria-label="${esc(t('quick-tray.add', 'search or add a tag'))}">
        <datalist id="hc-shelf-tags">${layerTags().map(n => `<option value="${esc(n)}">`).join('')}</datalist>
        ${body}
        <button class="fold" type="button" aria-expanded="true" title="${hide}" aria-label="${hide}">${CHEVRON_UP}</button>
      </section>`
    for (const row of this.#root.querySelectorAll<HTMLLIElement>('.row')) {
      row.addEventListener('pointerdown', (e) => this.#onRowPointerDown(e, this.#entries[Number(row.dataset['index'])]))
      // Delete or Backspace takes a focused row off, as its × does.
      row.addEventListener('keydown', (e) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return
        e.preventDefault()
        const entry = this.#entries[Number(row.dataset['index'])]
        if (entry) this.letGo(new Set([entryKey(entry)]))
      })
    }
    // A tag is a lens: a click on its row filters the hive by it, a second click lets it go.
    for (const row of this.#root.querySelectorAll<HTMLLIElement>('.row.tag')) {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.remove')) return
        const tag = this.#entries[Number(row.dataset['index'])]?.label
        if (tag) this.#filterBy(tag)
      })
    }
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>('.remove')) {
      button.addEventListener('pointerdown', (e) => e.stopPropagation())
      button.addEventListener('click', (e) => {
        e.stopPropagation()
        const entry = this.#entries[Number(button.dataset['index'])]
        if (entry) this.letGo(new Set([entryKey(entry)]))
      })
    }
    this.#wireWheel()
    this.#wireFold()
    this.#wireHead()
    this.#reserve()
  }

  /** The head's own acts: type to narrow the wheel's shelves, Enter to add the
   *  word as a tag, the kind button to turn between kinds, the wheel to walk. */
  #wireHead(): void {
    const input = this.#root.querySelector<HTMLInputElement>('.add')
    input?.addEventListener('input', () => { this.#filter = input.value; this.#cycled = null })
    input?.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key !== 'Enter' || !input.value.trim()) return
      e.preventDefault()
      const name = input.value
      this.#filter = ''
      void this.#takeTag(name)
    })
    this.#root.querySelector('.kind')?.addEventListener('click', () => this.#turnType())
    this.#root.querySelector('.apply')?.addEventListener('click', () => this.#applyBouquet())
    this.#root.querySelector('.ask-keep')?.addEventListener('click', () => { void this.#keepAndClear() })
    this.#root.querySelector('.ask-later')?.addEventListener('click', () => {
      this.#asking = false
      this.#askedAt = this.#entries.length
      this.#render()
    })
    const fill = this.#root.querySelector<HTMLInputElement>('.fill')
    fill?.addEventListener('keydown', (e) => e.stopPropagation())
    fill?.addEventListener('change', () => {
      const n = Math.round(Number(fill.value))
      this.#fill = Number.isFinite(n) ? Math.min(FILL_MAX, Math.max(FILL_MIN, n)) : DEFAULT_FILL
      this.#fillChosen = true
      void this.#keepFold(this.#folded)
      this.#render()
    })
    for (const head of this.#root.querySelectorAll('.legend, .kind, .add')) {
      head.addEventListener('wheel', (e) => {
        const ev = e as WheelEvent
        ev.preventDefault()
        if (ev.shiftKey) { if (ev.deltaY !== 0 || ev.deltaX !== 0) this.#turnType(); return }
        void this.#cycle(ev.deltaY > 0 || ev.deltaX > 0 ? 1 : -1)
      }, { passive: false })
    }
  }

  /** A wheel over the rows scrolls them sideways, so a long shelf reads with a mouse. */
  #wireWheel(): void {
    this.#root.querySelector('.rows')?.addEventListener('wheel', (e) => {
      const rowsEl = e.currentTarget as HTMLElement
      const ev = e as WheelEvent
      if (Math.abs(ev.deltaY) <= Math.abs(ev.deltaX)) return
      rowsEl.scrollLeft += ev.deltaY
      ev.preventDefault()
    }, { passive: false })
  }

  /** Hold the band under the shelf on the canvas, measured after layout. A
   *  folded shelf holds nothing. Both shelves hold it under ONE owner, so the
   *  hive does not jump when they trade places. */
  #reserve(): void {
    cancelAnimationFrame(this.#measureFrame)
    this.#measureFrame = requestAnimationFrame(() => {
      // A folded shelf paints no band; the selection shelf paints one whatever the fold.
      const shelf = this.#root.querySelector('.shelf')
      const size = shelf ? Math.round(shelf.getBoundingClientRect().bottom + INSET_GAP) : 0
      if (size === this.#reserved) return
      this.#reserved = size
      EffectBus.emit('viewport:inset', { owner: INSET_OWNER, side: 'top', size })
    })
  }

  #onResize = (): void => { this.#reserve() }

  #wireFold(): void {
    this.#root.querySelector('.fold')?.addEventListener('click', () => { this.#press(!this.#folded) })
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
    void this.#keepFold(folded)
  }

  async #keepFold(folded: boolean): Promise<void> {
    const store = ioc()?.get?.(STORE_KEY) as StoreLike | undefined
    const pool = await store?.getPool?.(STATE_POOL)
    if (!pool || !store?.putPoolDoc) return
    const bytes = new TextEncoder().encode(JSON.stringify({ folded, fill: this.#fill, at: Date.now() })).buffer as ArrayBuffer
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
        const record = JSON.parse(new TextDecoder().decode(bytes)) as { folded?: unknown; fill?: unknown }
        if (typeof record?.fill === 'number' && !this.#fillChosen) {
          this.#fill = Math.min(FILL_MAX, Math.max(FILL_MIN, Math.round(record.fill)))
          this.#render()
        }
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

  #onRowPointerDown(event: PointerEvent, entry: TrayEntry | undefined): void {
    if (event.button !== 0 || !entry || entry.kind === 'tag') return
    this.#pending = { entry, x: event.clientX, y: event.clientY }
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
    if (!wasDragging || !p) return
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
