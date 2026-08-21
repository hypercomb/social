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
//   hold         go INSIDE it — the same hold-to-enter the hive itself uses,
//                so the list is walked with the gesture already in the hands
//                (ctrl-click does it too, for a fast mouse)
//   right-click  come back out
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
import { listTileDrafts, tilePath } from './chat-thread.js'
import { walkTree, type WalkHistory, type WalkStore } from '../presentation/tiles/tree-walk.js'
import { readThumbnail, type ThumbnailStore } from '../presentation/tiles/thumbnails.js'
import { tilePictureCandidates } from '../editor/tile-properties.js'
import type { AgentRegistry } from './agent-registry.service.js'

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** One tile named by the rail: the level it sits on, its label there, and the
 *  rail's own key for it — so a row is recognised again without re-deriving
 *  the join. What the surface calls its SUBJECT. */
export type RailPick = { readonly key: string; readonly path: readonly string[]; readonly name: string }

type RailRow = {
  readonly name: string
  readonly segments: readonly string[]
  readonly childCount: number
  readonly propsSig?: string
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

const STYLE_ID = 'hc-tiles-rail-styles'
const STEEL = '126, 182, 214'

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
  color:rgba(${STEEL},0.75);font-size:1.4rem;line-height:1;cursor:pointer;border-radius:6px;}
.hc-rail-back:hover{color:whitesmoke;background:rgba(255,255,255,0.07);}
.hc-rail-back[hidden]{display:none;}
.hc-rail-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-family:var(--hc-mono,monospace);font-size:0.72rem;font-weight:600;letter-spacing:0.12em;
  text-transform:uppercase;color:rgba(${STEEL},0.85);}
.hc-rail-find{flex:0 0 auto;padding:0 0.85rem 0.5rem;}
.hc-rail-find input{width:100%;box-sizing:border-box;padding:0.33rem 0.55rem;border-radius:7px;
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
.hc-rail-row{display:flex;align-items:center;border-radius:9px;}
.hc-rail-row:hover{background:rgba(255,255,255,0.05);}
.hc-rail-row.holding{background:rgba(${STEEL},0.16);transition:background 0.12s ease;}
.hc-rail-row.current{background:rgba(${STEEL},0.1);box-shadow:inset 0 0 0 1px rgba(${STEEL},0.4);}
.hc-rail-main{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:0.6rem;
  padding:0.35rem 0.2rem 0.35rem 0.45rem;border:0;background:none;text-align:left;font:inherit;
  cursor:pointer;border-radius:9px;color:inherit;}
.hc-rail-main:focus-visible{outline:1px solid rgba(${STEEL},0.6);outline-offset:-1px;}
.hc-rail-icon{width:2.15rem;height:2.15rem;flex:0 0 auto;border-radius:8px;overflow:hidden;
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
.hc-rail-skel{height:2.5rem;border-radius:9px;background:rgba(255,255,255,0.045);
  animation:hcRailPulse 1.1s ease-in-out infinite;}
@keyframes hcRailPulse{0%,100%{opacity:0.5;}50%{opacity:1;}}
.hc-rail-empty{padding:0.9rem 0.45rem;font-size:0.78rem;color:rgba(216,230,238,0.45);}
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
  /** Tile paths holding unsent thinking, for the mark on the row. */
  #drafts = new Set<string>()
  /** A hold already acted — eat the click that ends the same press. */
  #swallowClick = false
  #registry: AgentRegistry | undefined
  /** Guards stale walks: only the newest load may touch the list. */
  #epoch = 0
  #disposed = false
  /** The trail seeds from the participant's location once — a RE-mount (the
   *  panel swapping subjects rebuilds its DOM) keeps the trail as it stood. */
  #seeded = false

  /** The surface listens here to follow the participant into a conversation. */
  onSubjectChanged: (subject: RailPick | null) => void = () => {}

  readonly #onRegistryChange = (): void => this.#paintBadges()
  #dropDraftWatch: (() => void) | null = null

  /** The tile whose conversation is open, or null before anything is chosen. */
  get subject(): RailPick | null { return this.#subject }

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
    void this.#refreshDrafts()

    void this.#load(0)
  }

  /** Leave the conversation without entering another — Escape's first stop. */
  clearSubject(): void {
    if (!this.#subject) return
    this.#subject = null
    for (const row of this.#list?.querySelectorAll('.hc-rail-row.current') ?? []) row.classList.remove('current')
    this.onSubjectChanged(null)
  }

  dispose(): void {
    this.#disposed = true
    this.#dropDraftWatch?.()
    this.#dropDraftWatch = null
    this.#registry?.removeEventListener('change', this.#onRegistryChange)
    for (const url of this.#icons.values()) {
      if (url) { try { URL.revokeObjectURL(url) } catch { /* already gone */ } }
    }
    this.#icons.clear()
    this.#waiters.clear()
    this.#levels.clear()
    this.#subject = null
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
    const insideHint = this.#t('agent.rail-inside', 'Ctrl-click to go inside · right-click to come back')
    for (const row of visible) {
      const key = pathKey(row.segments)
      const wrap = document.createElement('div')
      wrap.className = 'hc-rail-row'
      wrap.dataset['key'] = key
      wrap.classList.toggle('current', this.#subject?.key === key)

      const main = document.createElement('button')
      main.type = 'button'
      main.className = 'hc-rail-main'
      main.title = row.childCount ? `${talkHint} · ${insideHint}` : talkHint

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

      const draft = document.createElement('span')
      draft.className = 'hc-rail-draft'
      draft.hidden = !this.#drafts.has(tilePath(row.segments))
      draft.title = this.#t('agent.rail-draft', 'Unsent thinking waiting here')

      const chevron = document.createElement('span')
      chevron.className = 'hc-rail-chev'
      chevron.textContent = '›'
      chevron.hidden = row.childCount === 0

      main.append(icon, name, draft, bees, chevron)

      // CLICK TALKS, HOLD GOES IN. A plain click can never navigate — it is
      // the gesture you make while mid-thought, so it only ever changes who
      // you are talking to. Going deeper is the deliberate one, and it is the
      // hive's own hold-to-enter, so the list is walked with the gesture the
      // hands already know. (Ctrl-click does it too, for a fast mouse.)
      if (row.childCount > 0) this.#armHold(main, wrap, row)
      main.addEventListener('click', event => {
        // The hold already went in; the click that ends it must not also
        // drag the conversation to the row we just left.
        if (this.#swallowClick) { this.#swallowClick = false; return }
        if ((event.ctrlKey || event.metaKey) && row.childCount > 0) this.#drill(row.segments)
        else this.#enter(wrap, key, row)
      })

      wrap.append(main)
      list.appendChild(wrap)
    }
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

  /** Enter a row's conversation. One at a time: the previous row lets go, so
   *  what you type after this belongs to the tile you just clicked. */
  #enter(wrap: HTMLElement, key: string, row: RailRow): void {
    for (const other of this.#list?.querySelectorAll('.hc-rail-row.current') ?? []) other.classList.remove('current')
    wrap.classList.add('current')
    this.#subject = { key, path: row.segments.slice(0, -1), name: row.name }
    this.onSubjectChanged(this.#subject)
  }

  /** Which tiles hold unsent thinking. Read on mount and whenever a draft is
   *  written — the mark is a fact about the pool, never local state. */
  async #refreshDrafts(): Promise<void> {
    let held: string[] = []
    try { held = (await listTileDrafts()).map(d => d.path) } catch { return }
    if (this.#disposed) return
    this.#drafts = new Set(held)
    this.#paintDrafts()
  }

  #paintDrafts(): void {
    const list = this.#list
    if (!list) return
    for (const row of list.querySelectorAll<HTMLElement>('.hc-rail-row')) {
      const mark = row.querySelector<HTMLElement>('.hc-rail-draft')
      if (!mark) continue
      const segments = keySegments(row.dataset['key'] ?? '')
      mark.hidden = !this.#drafts.has(tilePath(segments))
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

  /** Registry moved — patch the badges in place, nothing else re-renders. */
  #paintBadges(): void {
    const list = this.#list
    if (!list) return
    const counts = this.#agentCounts()
    for (const row of list.querySelectorAll<HTMLElement>('.hc-rail-row')) {
      const badge = row.querySelector<HTMLElement>('.hc-rail-bees')
      if (!badge) continue
      const busy = counts.get(row.dataset['key'] ?? '') ?? 0
      badge.textContent = String(busy)
      badge.hidden = busy === 0
    }
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
