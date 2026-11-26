// recipe/recipe-catalogue-view.drone.ts
//
// THE CATALOGUE VIEW: the full-surface page that answers "what is offered
// here?". It joins what the other recipe files already are: it gathers the
// rows (recipe-entries.ts), mounts the list (recipe-catalogue.ts), and puts a
// read-only recipe page (recipe-page.ts) over the list when a row is opened.
//
// ── Two places, one page ─────────────────────────────────────────────────
//
// IN A HIVE the rows are the union of what the reader's own sources offer
// (T9): the domains switched on in the domain shelf and, when this tab is
// joined to a room, the room's entries. Whom a reader takes from is theirs to
// choose (T5), so the shelf is asked into view while the catalogue is up, the
// search is one search in both, and the view tells the shelf what it found:
// the participants as nodes, and how many rows each domain offers.
//
// ON A PUBLISHED DOOR the rows are what the door's own zone offers, and
// nothing else is asked. Publishing is the whole step (P1, T9): no menu entry
// and no page is made for it. The view comes up by itself only on a door whose
// root settled with no tiles and names no view of its own
// (recipe-catalogue.queen.ts decides that, and says why); the word `catalogue`
// opens it on any door.
//
// A POOL THE LEADER OPENED FOR POSTS is one more source in a hive
// (documentation/open-entry-pools.md): its rows sit under the person who
// signed them, read along the same way, and the leader has Hide beside each
// poster and under each of their entries, and Show again beside each poster or
// entry hidden (the design's rule 6: "a poster or one of their entries").
// Hiding is the leader's own
// list named in their index (pools/open-entries-flows.ts setEntryHidden): it
// changes what honest readers show, never what the host holds.
//
// ── Opening is not keeping ───────────────────────────────────────────────
//
// A row is an offer. Opening one fetches and verifies it and writes nothing
// (T4); every piece is trusted by its own bytes, never because a list named
// it (M1, S3). "Bring it to my hive" is the press that keeps: the publisher's
// bytes under their own signatures and one tile on the page the reader stands
// on, a forward commit like any other (H2). A shell that only reads is never
// offered that press.
//
// A picture is shown only once its bytes are here (I2, T7): the list draws a
// plate of initials until a row has been opened, and nothing on this page
// makes the browser ask a host for an image.
//
// ── Leaving ──────────────────────────────────────────────────────────────
//
// The view opens over the place the reader stands and never moves them, so
// leaving has one destination: the surface that was up when it opened
// (presentation/tiles/view-spawn.ts). On a door with nothing under it the
// face holds: there is nowhere to go back to.
//
// The drone sleeps until its view is asked for (`renders`), which is why
// nothing else names its key or imports this file.

import { Drone, EffectBus, I18N_IOC_KEY, get, hypercomb, type I18nProvider } from '@hypercomb/core'
import type { BackGesture } from '../navigation/back-gesture.service.js'
import {
  DOMAIN_SHELF_WANTED,
  SOURCES_CHANGED,
  SOURCES_COUNTED,
  SOURCES_NODES,
  SOURCES_QUERY,
  type DomainShelfWanted,
  type SourcesCounted,
  type SourcesNodes,
  type SourcesState,
} from '../pools/lights-contract.js'
import { entryPoolSentence } from '../pools/open-entries.js'
import { setEntryHidden, type EntryRefused } from '../pools/open-entries-flows.js'
import { readOpenedSources, type EntryLeaderDeps, type OpenedSource } from '../pools/open-entries-leader.js'
import { poolNodeTitle, uniquePoolNodes, type PoolNode } from '../pools/pool-node.js'
import { roomStanding } from '../pools/room-entries.js'
import { HEXAGONS, VIEW_SPAWN_EFFECT, spawnForView, viewExitTarget, type ViewSpawn } from '../presentation/tiles/view-spawn.js'
import { isPublishedVisitorShell } from '../sharing/behavior-enablement.js'
import { mapBounded } from '../sharing/bounded-fetch.js'
import { zoneDoor } from '../sharing/zone-door.js'
import { recipeCatalogue, type RecipeCatalogueHandle, type RecipeCatalogueHeldBack, type RecipeCatalogueNodeAction, type RecipeCatalogueRow } from './recipe-catalogue.js'
import { DEFAULT_RECIPE_TEMPLATES } from './recipe-defaults.js'
import {
  RECIPE_ENTRY_MEANING,
  findRecipeEntries,
  openRecipeEntry,
  postedRecipeOffers,
  takeRecipeHome,
  type RecipeEntryOffer,
  type RecipeEntryOpened,
} from './recipe-entries.js'
import { recipePage, type RecipePageHandle } from './recipe-page.js'
import { ensureRecipeStyles } from './recipe-style.js'
import type { RecipeTemplateDocument } from './recipe-template.js'
import { recipeViewFresh, recipeViewQuery, recipeViewZones } from './recipe-view-state.js'

/** The view-mode token. */
const VIEW = 'catalogue'
/** The view's owner in the mode registry, the back gesture, the keymap hold and the domain shelf. */
const OWNER = 'recipe-catalogue'
const HOST_ID = 'hc-recipe-catalogue-host'
/** THE RECIPE VIEW'S EDGES (recipe-view.drone.ts), so stepping between the
 *  two never moves the page: the top is the safe edge or whatever band is
 *  reserved off the top (the domain shelf), never the shell header's anchor,
 *  which is an empty band while `view:active` hides that header. The shell's
 *  rail stays outside on the left, a docked panel on the right, the controls
 *  underneath. Opaque. */
const HOST_STYLE =
  'position:fixed;' +
  'top:max(var(--hc-inset-top,0px),var(--hc-safe-top,0px));' +
  'left:var(--hc-controls-left,var(--hc-inset-left,0px));' +
  'right:max(var(--hc-inset-right,0px),var(--hc-controls-right,0px));' +
  'bottom:calc(max(var(--hc-controls-bottom,0px),var(--hc-safe-bottom,0px)) + var(--hc-mobile-row-lift,0px));' +
  'z-index:60001;overflow:hidden;' +
  'background:rgb(var(--hc-panel-pane,12,19,27));'
/** Domains asked at once. */
const ZONES_AT_ONCE = 4
/** What the grid says after each paint: how many tiles the page under the view holds. */
const CELLS_COUNTED = 'render:cell-count'

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }
type ModeRegistryShape = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void }

/** A recipe opened over the list. */
type Opened = {
  offer: RecipeEntryOffer
  opened: RecipeEntryOpened
  page: RecipePageHandle
  /** The addresses its pictures are shown from: let go when it closes. */
  urls: string[]
  /** The name of the tile it was kept as, '' until it is. */
  kept: string
  keeping: boolean
}

type Mount = {
  host: HTMLDivElement
  catalogue: RecipeCatalogueHandle | null
  /** True on a published door: the rows are what is published at this address. */
  door: boolean
  /** The door's own zone. '' in a hive. */
  zone: string
  /** False only on a door with nothing under it: there the face holds. */
  leavable: boolean
  /** The zones drawn from, in the shelf's order. */
  zones: string[]
  /** The nodes switched on, when the shelf says which. */
  nodes: readonly PoolNode[] | undefined
  /** What each zone asked so far offers, kept for the life of the view. */
  byZone: Map<string, readonly RecipeEntryOffer[]>
  asking: Set<string>
  /** What the room offers. Null until it answered, and where no room is joined. */
  roomOffers: readonly RecipeEntryOffer[] | null
  roomAsking: boolean
  /** The room's name when this tab is joined to one. */
  room: string
  joined: boolean
  /** The pools this hive opened for posts, as last read, by H. Empty on a door and in a shell that only reads. */
  posted: Map<string, { source: OpenedSource; offers: readonly RecipeEntryOffer[] }>
  postedAsking: boolean
  /** The posters' names as they typed them, by key: what a hidden poster is still called. */
  posterNames: Map<string, string>
  /** Posters whose Hide or Show again is being written, by key; one entry's, by `<key>:<page>`. */
  hiding: Set<string>
  /** What each poster's entry was called, by `<key>:<page>`: what a hidden entry is still called. */
  entryTitles: Map<string, string>
  /** The rows on the page by signature: what a press opens. */
  offers: Map<string, RecipeEntryOffer>
  /** The search words as the domain shelf announces them, and as typed here. */
  query: string
  typed: string
  /** A sentence that stands in for the note: a row being opened, or why it did not open. */
  said: string
  /** The row being fetched, '' for none. */
  opening: string
  opened: Opened | null
  /** Covers whose bytes arrived with an opened row, by signature: let go on exit. */
  covers: Map<string, string>
  offs: (() => void)[]
}

const live = <T>(key: string): T | undefined => {
  try { return get<T>(key) } catch { return undefined }
}

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  let said: string | undefined
  try { said = live<I18nProvider>(I18N_IOC_KEY)?.t(key, params) } catch { said = undefined }
  const text = said && said !== key ? said : fallback
  return params ? text.replace(/\{(\w+)\}/g, (hole, name: string) => name in params ? String(params[name]) : hole) : text
}

const names = (segments: unknown): string[] =>
  Array.isArray(segments) ? segments.map(part => String(part ?? '').trim()).filter(Boolean) : []

/** A shell that only reads: a published site's visitor, or a hive opened read-only. */
const readOnlyShell = (): boolean =>
  isPublishedVisitorShell() || (globalThis as { __HC_READONLY__?: boolean }).__HC_READONLY__ === true

/** An address for bytes that are already here. '' where the browser makes none. */
const addressOf = (bytes: Uint8Array): string => {
  try {
    const exact = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    return URL.createObjectURL(new Blob([exact]))
  } catch { return '' }
}

const letGo = (url: string): void => {
  try { URL.revokeObjectURL(url) } catch { /* nothing was held */ }
}

/** How many rows each zone asked so far offers: what the shelf's chips say. */
const countsOf = (byZone: ReadonlyMap<string, readonly RecipeEntryOffer[]>): Record<string, number> =>
  Object.fromEntries([...byZone].map(([zone, offered]) => [zone, offered.length]))

export class RecipeCatalogueViewDrone extends Drone {
  /** THE VIEW THIS BEE RENDERS, and nowhere else does it act: it may sleep
   *  until the view mode enters it (essentials scripts/passive-queen.ts). */
  readonly renders: readonly string[] = ['catalogue']

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Full-screen catalogue. When the view mode is "catalogue", lists the recipes the domains you follow and the room you joined offer, or what is published at this address, and opens one to read.'

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    viewMode: '@hypercomb.social/ViewMode',
  }
  protected override listens: string[] = [VIEW_SPAWN_EFFECT, SOURCES_CHANGED, CELLS_COUNTED]
  protected override emits: string[] = [
    'view:active', DOMAIN_SHELF_WANTED, SOURCES_QUERY, SOURCES_COUNTED, SOURCES_NODES,
    'keymap:hold', 'keymap:release', 'activity:log',
  ]

  #bound = false
  #mount: Mount | null = null
  #viewActive = false
  /** The surface and place the catalogue was opened from: where leaving lands. */
  #spawn: ViewSpawn | null = null
  /** A catalogue session is up, so an unrelated mode flip never moves anyone. */
  #session = false
  /** Leaving sets the view mode a second time, from inside the mode-change handler. */
  #restoring = false

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#bound) this.#bind()
    this.#reconcile()
  }

  protected override dispose(): void {
    this.#teardown()
  }

  // ── binding ────────────────────────────────────────────────────────────

  #bind(): void {
    this.#bound = true
    const vm = this.#vm()
    if (vm?.addEventListener) {
      this.listen(vm, 'change', this.#onModeChange)
      // Woken by the mode itself: the session began before this bee was listening.
      if (vm.mode === VIEW) this.#session = true
    }
    this.listen(window, 'keydown', this.#onKeyDown as EventListener, true)

    // Where the catalogue was asked for FROM. The subscription's own replay is
    // honoured only while its stamp is fresh: that is the press that just woke
    // this bee, never a record from an earlier session.
    let replay = true
    this.onEffect<{ at?: unknown }>(VIEW_SPAWN_EFFECT, payload => {
      if (replay && !recipeViewFresh(payload?.at, Date.now())) return
      const spawn = spawnForView(payload, VIEW)
      if (spawn) this.#spawn = spawn
    })
    replay = false

    // One registration feeds the right button and browser / hardware BACK
    // (navigation/back-gesture.service.ts). The owner is the one the view
    // enters `view:active` with, so the entry answers only while the page is up.
    const dropBack = live<BackGesture>('@diamondcoreprocessor.com/BackGesture')
      ?.register({ owner: OWNER, back: () => this.#back() })
    if (dropBack) this.own(dropBack)
  }

  #vm(): ViewModeShape | undefined {
    return this.resolve<ViewModeShape>('viewMode')
  }

  #here(): string[] {
    return names([...(this.resolve<LineageShape>('lineage')?.explorerSegments?.() ?? [])])
  }

  // ── reactivity ─────────────────────────────────────────────────────────

  /** Track the session, and on the way out to the hexagons come back to the
   *  surface the catalogue was opened from. A flip onto another view is a
   *  change of face, not a way out. */
  readonly #onModeChange = (): void => {
    if (!this.#restoring) {
      const mode = this.#vm()?.mode
      if (mode === VIEW) this.#session = true
      else if (this.#session) {
        const spawn = this.#spawn
        this.#session = false
        this.#spawn = null
        if (spawn && mode === HEXAGONS) this.#returnToSpawn(spawn)
      }
    }
    this.#reconcile()
  }

  /** The catalogue opened in place, so the place is where it was: only the
   *  surface comes back, and only when the reader has not walked since. */
  #returnToSpawn(spawn: ViewSpawn): void {
    const target = viewExitTarget(spawn, spawn.segments, this.#here(), HEXAGONS)
    if (!target || target.mode === VIEW) return
    this.#restoring = true
    try { this.#vm()?.setMode(target.mode) } finally { this.#restoring = false }
  }

  /** Escape that neither page took. The list hears keys only while focus is
   *  inside it, and an opened recipe answers from inside itself and from
   *  nowhere: what is left is a key pressed with nothing focused, or on the
   *  shell around the view. A field elsewhere keeps its own Escape. */
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    const mount = this.#mount
    if (event.key !== 'Escape' || !mount || this.#vm()?.mode !== VIEW) return
    const from = event.composedPath?.()[0] ?? event.target
    const element = from instanceof Element ? from : null
    const nowhere = !element || element === document.body || element === document.documentElement
    if (element && mount.host.contains(element)) return
    if (mount.opened && nowhere) return
    if (element?.closest('input, textarea, select, [contenteditable]')) return
    if (!mount.opened && !mount.leavable) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.#back()
  }

  // ── reconcile / mount ──────────────────────────────────────────────────

  #reconcile(): void {
    if (this.#vm()?.mode !== VIEW) { this.#teardown(); return }
    if (!this.#mount) this.#build()
  }

  #build(): void {
    const door = isPublishedVisitorShell()
    const standing = door ? { joined: false, room: '' } : roomStanding()
    const zone = door ? zoneDoor(location.host) : ''

    ensureRecipeStyles(document)
    const host = document.createElement('div')
    host.id = HOST_ID
    host.setAttribute('style', HOST_STYLE)
    // The page owns its surface: without this the hex wheel-zoom handler
    // takes the wheel and the list cannot scroll.
    host.setAttribute('data-consumes-wheel', '')

    const mount: Mount = {
      host, catalogue: null, door, zone,
      leavable: !door,
      zones: zone ? [zone] : [],
      nodes: undefined,
      byZone: new Map(), asking: new Set(),
      roomOffers: null, roomAsking: false,
      room: standing.room, joined: standing.joined,
      posted: new Map(), postedAsking: false, posterNames: new Map(), hiding: new Set(), entryTitles: new Map(),
      offers: new Map(),
      query: '', typed: '', said: '', opening: '',
      opened: null,
      covers: new Map(),
      offs: [],
    }
    this.#mount = mount
    if (door) {
      // A door with tiles under the catalogue has somewhere to go back to, and
      // says so with a Close. The grid counts them after each paint, and the
      // replay on subscribe is the count as it stands.
      mount.offs.push(EffectBus.on<{ count?: unknown }>(CELLS_COUNTED, counted => this.#onTiles(mount, Number(counted?.count ?? 0) > 0)))
    }
    this.#raise(mount)
    document.body.appendChild(host)
    this.#setViewActive(true)
    // The page's keys are its own while it is up: the hive's shortcuts stand aside.
    EffectBus.emitTransient('keymap:hold', { reason: OWNER })
    mount.catalogue?.focus()

    if (door) { void this.#ask(mount); return }
    EffectBus.emitTransient<DomainShelfWanted>(DOMAIN_SHELF_WANTED, { owner: OWNER, wanted: true })
    // State, not a command: the replay on subscribe is which domains are on right now.
    mount.offs.push(EffectBus.on<SourcesState>(SOURCES_CHANGED, state => this.#onSources(mount, state)))
    if (mount.joined) void this.#askRoom(mount)
    // The pools the leader opened for posts are the leader's own: never asked in a shell that only reads.
    if (!readOnlyShell()) void this.#askPosted(mount)
  }

  /** What the leader's side reads the opened pools with: a spec hands its own in. */
  postsDeps: EntryLeaderDeps = {}

  /** Put the list on the host, under anything opened over it. Built again only when what it offers to do changes. */
  #raise(mount: Mount): void {
    const shown = this.#shown(mount)
    const held = mount.catalogue !== null && mount.catalogue.element.contains(document.activeElement)
    mount.catalogue?.dispose()
    const catalogue = recipeCatalogue({
      say: t,
      ...shown,
      query: mount.typed,
      pictureUrl: sig => mount.covers.get(sig) ?? '',
      onOpen: sig => { void this.#open(mount, sig) },
      onQuery: query => this.#typed(mount, query),
      ...(mount.leavable ? { onClose: () => this.#backOut() } : {}),
      nodeAction: node => this.#nodeAction(mount, node),
      rowAction: (row, node) => this.#rowAction(mount, row.sig, node),
    })
    // The list fills the host, not the viewport: the header and the shelves stay in view above it.
    catalogue.element.style.position = 'absolute'
    catalogue.element.inert = mount.opened !== null
    mount.host.prepend(catalogue.element)
    mount.catalogue = catalogue
    if (held) catalogue.focus()
  }

  /** The page under a door's catalogue gained or lost its tiles. */
  #onTiles(mount: Mount, beneath: boolean): void {
    if (this.#mount !== mount || mount.leavable === beneath) return
    mount.leavable = beneath
    if (mount.catalogue) this.#raise(mount)
  }

  // ── what is shown ──────────────────────────────────────────────────────

  /** Where the rows come from, in words: "3 domains and the room marble cove". */
  #from(mount: Mount): string {
    const count = mount.zones.length
    const domains = count === 1
      ? t('recipe.catalogue.from.domains.one', '1 domain', { count })
      : t('recipe.catalogue.from.domains.other', '{count} domains', { count })
    const room = !mount.joined ? ''
      : mount.room
        ? t('recipe.catalogue.from.room', 'the room {room}', { room: mount.room })
        : t('recipe.catalogue.from.room-unnamed', 'the room you joined')
    const opened = mount.posted.size
    const posts = !opened ? ''
      : opened === 1
        ? t('pools.posts.catalogue.from.one', 'your pool open for posts', { count: opened })
        : t('pools.posts.catalogue.from.other', 'your {count} pools open for posts', { count: opened })
    if (!count && !room && !posts) {
      return t('recipe.catalogue.from.none', 'Switch a domain on in the shelf, or join a room, to see what is offered.')
    }
    const named = [count ? domains : '', room, posts].filter(Boolean)
    const sources = named.length === 1
      ? named[0] as string
      : named.length === 2
        ? t('recipe.catalogue.from.both', '{domains} and {room}', { domains: named[0] as string, room: named[1] as string })
        : t('pools.posts.catalogue.from.three', '{domains}, {room} and {posts}', { domains: named[0] as string, room: named[1] as string, posts: named[2] as string })
    const from = t('recipe.catalogue.from', 'From {sources}', { sources })
    // A pool of the leader's that could not be drawn as it should says why, one sentence each.
    const told = [...mount.posted.values()]
      .filter(({ source }) => source.read.why || source.read.over || !source.read.reached || (source.read.state !== 'open' && source.read.state !== 'closed'))
      .map(({ source }) => `${source.title}: ${entryPoolSentence(source.read)}`)
    return [from, ...told].join('. ')
  }

  /** The rows as one table: one row per signature, with every node that offers it. */
  #gather(mount: Mount): RecipeCatalogueRow[] {
    const merged = new Map<string, RecipeEntryOffer>()
    const take = (offer: RecipeEntryOffer): void => {
      const held = merged.get(offer.sig)
      if (!held) { merged.set(offer.sig, offer); return }
      const at = Math.max(held.at ?? 0, offer.at ?? 0)
      merged.set(offer.sig, { ...held, nodes: uniquePoolNodes([...held.nodes, ...offer.nodes]), ...(at ? { at } : {}) })
    }
    // Only the zones that are on: one switched off keeps what it answered, and shows none of it.
    for (const zone of mount.zones) for (const offer of mount.byZone.get(zone) ?? []) take(offer)
    for (const offer of mount.roomOffers ?? []) take(offer)
    for (const { offers } of mount.posted.values()) for (const offer of offers) take(offer)
    mount.offers = merged
    return [...merged.values()].map(offer => ({
      sig: offer.sig,
      name: offer.entry.name,
      ...(offer.entry.cover ? { cover: offer.entry.cover } : {}),
      nodes: offer.nodes,
      ...(offer.at !== undefined ? { at: offer.at } : {}),
    }))
  }

  #shown(mount: Mount): { title: string; note: string; rows: RecipeCatalogueRow[]; nodes: readonly PoolNode[] | undefined; loading: boolean; heldBack: RecipeCatalogueHeldBack[] } {
    const here = t('recipe.catalogue.published', 'Published here')
    return {
      title: mount.door ? mount.zone || here : t('recipe.catalogue.title', 'Recipes from your nodes'),
      note: mount.said || (mount.door ? here : this.#from(mount)),
      rows: this.#gather(mount),
      nodes: mount.nodes,
      loading: mount.asking.size > 0 || mount.roomAsking || mount.postedAsking,
      heldBack: this.#heldBack(mount),
    }
  }

  /** Show the list what it now has. `query` is passed only to put the shelf's words in its field. */
  #paint(mount: Mount, query?: string): void {
    if (this.#mount !== mount) return
    mount.catalogue?.update({ ...this.#shown(mount), ...(query !== undefined ? { query } : {}) })
  }

  /** A quiet sentence in place of the note. '' gives the note back. */
  #tell(mount: Mount, words: string): void {
    mount.said = words
    this.#paint(mount)
  }

  // ── the sources ────────────────────────────────────────────────────────

  /** The domain shelf said which sources are on and what is searched for. */
  #onSources(mount: Mount, state: SourcesState | undefined): void {
    if (this.#mount !== mount) return
    mount.zones = recipeViewZones(names(state?.zones))
    mount.nodes = Array.isArray(state?.nodes) ? state.nodes : undefined
    const query = recipeViewQuery(typeof state?.query === 'string' ? state.query : '')
    // Words typed into the catalogue come back in the shelf's form: the field
    // is rewritten only when the words were typed somewhere else.
    const elsewhere = query !== recipeViewQuery(mount.typed)
    mount.query = query
    if (elsewhere) mount.typed = query
    this.#paint(mount, elsewhere ? query : undefined)
    void this.#ask(mount)
  }

  /** The catalogue's own search: in a hive the shelf's field and this one stay one. */
  #typed(mount: Mount, query: string): void {
    mount.typed = query
    if (!mount.door) EffectBus.emitTransient(SOURCES_QUERY, { query })
  }

  /** Ask each zone that is on and not asked yet what it offers. Every read is
   *  bounded and verified by the reader it stands on (recipe-entries.ts); what
   *  comes back is held in the view only, and kept nowhere. */
  async #ask(mount: Mount): Promise<void> {
    const wanted = mount.zones.filter(zone => !mount.byZone.has(zone) && !mount.asking.has(zone))
    if (!wanted.length) return
    for (const zone of wanted) mount.asking.add(zone)
    this.#paint(mount)
    await mapBounded(wanted, ZONES_AT_ONCE, async zone => {
      const offered = await findRecipeEntries({ zones: [zone] })
      mount.asking.delete(zone)
      mount.byZone.set(zone, offered)
      if (this.#mount !== mount) return
      if (!mount.door) EffectBus.emit<SourcesCounted>(SOURCES_COUNTED, { meaning: RECIPE_ENTRY_MEANING, counts: countsOf(mount.byZone) })
      this.#paint(mount)
    })
  }

  /** Ask the room this tab is joined to, once, and tell the shelf who was found there. */
  async #askRoom(mount: Mount): Promise<void> {
    mount.roomAsking = true
    this.#paint(mount)
    const offered = await findRecipeEntries({ zones: [], room: true })
    mount.roomAsking = false
    mount.roomOffers = offered
    if (this.#mount !== mount) return
    this.#announcePeople(mount)
    this.#paint(mount)
  }

  /** Tell the shelf who was found: the room's people and the pools' posters, so the reader can switch each off. */
  #announcePeople(mount: Mount): void {
    const offered = [...(mount.roomOffers ?? []), ...[...mount.posted.values()].flatMap(({ offers }) => offers)]
    const people = uniquePoolNodes(offered.flatMap(offer => offer.nodes).filter(node => node.kind === 'participant'))
    EffectBus.emit<SourcesNodes>(SOURCES_NODES, { nodes: people })
  }

  // ── the pools opened for posts ─────────────────────────────────────────

  /** Read every pool this hive opened for posts, as a reader reads it, and draw its recipes. Kept nowhere. */
  async #askPosted(mount: Mount): Promise<void> {
    mount.postedAsking = true
    this.#paint(mount)
    const sources = await readOpenedSources(this.postsDeps).catch(() => [] as OpenedSource[])
    const posted = new Map<string, { source: OpenedSource; offers: readonly RecipeEntryOffer[] }>()
    for (const source of sources) {
      if (source.meaning !== RECIPE_ENTRY_MEANING) continue
      for (const row of source.read.rows) {
        if (row.label) mount.posterNames.set(row.signer, row.label)
        if (row.title) mount.entryTitles.set(`${row.signer}:${row.page}`, row.title)
      }
      const offers = await postedRecipeOffers(source.read.rows, { pool: source.pool, host: source.page, template: source.template })
      posted.set(source.pool, { source, offers })
    }
    if (this.#mount !== mount) return
    mount.postedAsking = false
    mount.posted = posted
    this.#announcePeople(mount)
    this.#paint(mount)
  }

  /** The leader's pools a poster posted to or is hidden in, by the poster's key. */
  #poolsOf(mount: Mount, key: string): OpenedSource[] {
    return [...mount.posted.values()]
      .filter(({ source, offers }) => offers.some(offer => offer.nodes.some(node => node.kind === 'participant' && node.id === key))
        || !!source.read.hidden.list?.keys.includes(`k:${key}`))
      .map(({ source }) => source)
  }

  /** The posters the leader's lists hide, across their pools. */
  #hiddenKeys(mount: Mount): Set<string> {
    const keys = new Set<string>()
    for (const { source } of mount.posted.values()) {
      for (const line of source.read.hidden.list?.keys ?? []) keys.add(line.slice(2))
    }
    return keys
  }

  /** Hide beside a poster with rows here, Show again beside one held back. Nothing for any other node. */
  #nodeAction(mount: Mount, node: PoolNode): RecipeCatalogueNodeAction | null {
    if (node.kind !== 'participant' || node.you || !this.#poolsOf(mount, node.id).length) return null
    const hidden = this.#hiddenKeys(mount).has(node.id)
    const typed = mount.posterNames.get(node.id)
    const name = poolNodeTitle({ ...node, ...(typed ? { name: typed } : {}) })
    return {
      label: hidden ? t('pools.posts.catalogue.show', 'Show again') : t('pools.posts.catalogue.hide', 'Hide'),
      title: hidden
        ? t('pools.posts.catalogue.show-title', 'Show what {name} posted to readers again', { name })
        : t('pools.posts.catalogue.hide-title', 'Hide what {name} posted from readers', { name }),
      busy: mount.hiding.has(node.id),
      onPress: () => { void this.#hide(mount, node.id, !hidden) },
    }
  }

  /** The leader's pools that offer this row under this poster, each with the poster's entry page for it. */
  #entryOf(mount: Mount, sig: string, key: string): { source: OpenedSource; page: string }[] {
    const out: { source: OpenedSource; page: string }[] = []
    for (const { source, offers } of mount.posted.values()) {
      const line = offers.find(offer => offer.sig === sig)?.posted?.lines?.find(one => one.signer === key)
      if (line) out.push({ source, page: line.page })
    }
    return out
  }

  /** Hide under a poster's entry, in their group: that one entry, not the poster. Nothing for any other row. */
  #rowAction(mount: Mount, sig: string, node: PoolNode): RecipeCatalogueNodeAction | null {
    if (node.kind !== 'participant' || node.you) return null
    const found = this.#entryOf(mount, sig, node.id)
    const page = found[0]?.page
    if (!page) return null
    const title = mount.entryTitles.get(`${node.id}:${page}`) ?? mount.offers.get(sig)?.entry.name ?? ''
    return {
      label: t('pools.posts.catalogue.hide-entry', 'Hide this entry'),
      title: t('pools.posts.catalogue.hide-entry-title', 'Hide "{title}" from readers', { title }),
      busy: mount.hiding.has(`${node.id}:${page}`) || mount.hiding.has(node.id),
      onPress: () => { void this.#hideEntry(mount, found.map(one => one.source), node.id, page, true) },
    }
  }

  /** The entries the leader's lists hide one by one, across their pools: `<key>:<page>` and the pools that hide it. */
  #hiddenEntries(mount: Mount): Map<string, { key: string; page: string; sources: OpenedSource[] }> {
    const out = new Map<string, { key: string; page: string; sources: OpenedSource[] }>()
    for (const { source } of mount.posted.values()) {
      for (const line of source.read.hidden.list?.pages ?? []) {
        const [key, page] = line.split(':')
        if (!key || !page) continue
        const held = out.get(line)
        if (held) held.sources.push(source)
        else out.set(line, { key, page, sources: [source] })
      }
    }
    return out
  }

  #heldBack(mount: Mount): RecipeCatalogueHeldBack[] {
    const posters = [...this.#hiddenKeys(mount)].map((key): RecipeCatalogueHeldBack => {
      const name = mount.posterNames.get(key)
      const node: PoolNode = { kind: 'participant', id: key, ...(name ? { name } : {}) }
      return { node, note: t('pools.posts.catalogue.hidden', 'Hidden from everyone who reads your pools. Show again puts it back.') }
    })
    const entries = [...this.#hiddenEntries(mount)].map(([line, { key, page, sources }]): RecipeCatalogueHeldBack => {
      const name = mount.posterNames.get(key)
      const node: PoolNode = { kind: 'participant', id: key, ...(name ? { name } : {}) }
      const title = mount.entryTitles.get(line)
      return {
        node, id: line,
        note: title
          ? t('pools.posts.catalogue.entry-hidden', 'One entry, "{title}", is hidden from everyone who reads your pools.', { title })
          : t('pools.posts.catalogue.entry-hidden-untitled', 'One of their entries is hidden from everyone who reads your pools.'),
        action: {
          label: t('pools.posts.catalogue.show', 'Show again'),
          title: t('pools.posts.catalogue.show-entry-title', 'Show this entry to readers again'),
          busy: mount.hiding.has(line),
          onPress: () => { void this.#hideEntry(mount, sources, key, page, false) },
        },
      }
    })
    return [...posters, ...entries]
  }

  /** Hide or show again one entry of one poster, in each pool of the leader's that names it, then read the pools again. */
  async #hideEntry(mount: Mount, sources: readonly OpenedSource[], key: string, page: string, hide: boolean): Promise<void> {
    const id = `${key}:${page}`
    if (mount.hiding.has(id) || !sources.length) return
    mount.hiding.add(id)
    this.#paint(mount)
    let failed: EntryRefused | null = null
    for (const source of sources) {
      const done = await setEntryHidden({ host: source.host, pool: source.pool, line: { key, page }, hide, page: source.page }, this.postsDeps)
      if (!done.ok) { failed = done; break }
    }
    mount.hiding.delete(id)
    if (this.#mount !== mount) return
    const title = mount.entryTitles.get(id) || t('pools.posts.catalogue.entry-untitled', 'That entry')
    const words = failed
      ? failed.reason
      : hide
        ? t('pools.posts.catalogue.entry-hid', '"{title}" is hidden from the readers of your pools.', { title })
        : t('pools.posts.catalogue.entry-shown', '"{title}" shows again.', { title })
    EffectBus.emit('activity:log', { message: words })
    mount.said = words
    await this.#askPosted(mount)
  }

  /** Hide or show again one poster in every pool of the leader's they posted to, then read the pools again. */
  async #hide(mount: Mount, key: string, hide: boolean): Promise<void> {
    if (mount.hiding.has(key)) return
    const pools = this.#poolsOf(mount, key)
    mount.hiding.add(key)
    this.#paint(mount)
    let failed: EntryRefused | null = null
    for (const source of pools) {
      const done = await setEntryHidden({ host: source.host, pool: source.pool, line: { key }, hide, page: source.page }, this.postsDeps)
      if (!done.ok) { failed = done; break }
    }
    mount.hiding.delete(key)
    if (this.#mount !== mount) return
    const name = mount.posterNames.get(key) || poolNodeTitle({ kind: 'participant', id: key })
    const words = failed
      ? failed.reason
      : hide
        ? t('pools.posts.catalogue.hid', 'What {name} posted is hidden from the readers of your pools.', { name })
        : t('pools.posts.catalogue.shown', 'What {name} posted shows again.', { name })
    EffectBus.emit('activity:log', { message: words })
    mount.said = words
    await this.#askPosted(mount)
  }

  // ── opening a row ──────────────────────────────────────────────────────

  /** A row was pressed: fetch and verify it, then put it over the list to read. Nothing is kept. */
  async #open(mount: Mount, sig: string): Promise<void> {
    if (this.#mount !== mount || mount.opened || mount.opening) return
    const offer = mount.offers.get(sig)
    if (!offer) {
      this.#tell(mount, t('recipe.catalogue.gone', 'That recipe is no longer offered here.'))
      return
    }
    mount.opening = sig
    this.#tell(mount, t('recipe.catalogue.opening', 'Opening {name}', { name: offer.entry.name }))
    const opened = await openRecipeEntry(offer)
    if (this.#mount !== mount) return
    mount.opening = ''
    if (!opened.ok) {
      // Why it would not open, said where the list is read.
      this.#tell(mount, opened.reason)
      mount.catalogue?.focus()
      return
    }
    mount.said = ''
    this.#show(mount, offer, opened)
  }

  #show(mount: Mount, offer: RecipeEntryOffer, opened: RecipeEntryOpened): void {
    const urls = new Map<string, string>()
    for (const [sig, bytes] of opened.pictures) {
      const url = addressOf(bytes)
      if (url) urls.set(sig, url)
    }
    // The cover's bytes are here now: the list may show it from this device.
    const cover = offer.entry.cover
    const coverBytes = cover && !mount.covers.has(cover) ? opened.pictures.get(cover) : undefined
    const coverUrl = coverBytes ? addressOf(coverBytes) : ''
    if (cover && coverUrl) mount.covers.set(cover, coverUrl)

    const template: RecipeTemplateDocument = opened.template ?? DEFAULT_RECIPE_TEMPLATES[0]
    const named = opened.recipe.template
    const session: Opened = {
      offer, opened, urls: [...urls.values()], kept: '', keeping: false,
      page: recipePage({
        title: offer.entry.name,
        recipe: { ...(named ? { template: named } : {}), values: opened.recipe.values },
        template,
        mode: 'read',
        readOnly: true,
        say: t,
        pictureUrl: sig => urls.get(sig) ?? '',
        // A page that only reads changes nothing: these are never asked for.
        onChange: () => undefined,
        onLayout: () => undefined,
        takePictures: async () => [],
        // No template chooser is handed over: an offered recipe is read through the layout it
        // names, and the page draws no button for a choice that could do nothing.
        onClose: () => this.#closeOpened(mount),
        // The press that keeps is a participant's own: a shell that only reads is never offered it.
        ...(readOnlyShell() ? {} : {
          primaryAction: {
            label: t('recipe.catalogue.bring', 'Bring it to my hive'),
            onPress: () => { void this.#bring(mount, session) },
          },
        }),
      }),
    }
    mount.opened = session
    const list = mount.catalogue?.element
    if (list) {
      // The list is under the page now: its keys and its cards stand aside.
      if (document.activeElement instanceof HTMLElement && list.contains(document.activeElement)) document.activeElement.blur()
      list.inert = true
    }
    // The page fills the host and is mounted after the list, so it is on top.
    session.page.element.style.position = 'absolute'
    mount.host.append(session.page.element)
    this.#paint(mount)
  }

  /** "Bring it to my hive": the opened recipe becomes a tile on the page the reader stands on. */
  async #bring(mount: Mount, session: Opened): Promise<void> {
    if (session.keeping) return
    const say = (words: string, tone: 'plain' | 'good' | 'bad'): void => {
      if (mount.opened === session) session.page.setStatus(words, tone)
    }
    if (session.kept) {
      say(t('recipe.catalogue.brought-already', 'Already in your hive as {name}', { name: session.kept }), 'plain')
      return
    }
    session.keeping = true
    say(t('recipe.catalogue.bringing', 'Bringing it to your hive'), 'plain')
    const taken = await takeRecipeHome(session.offer, session.opened, this.#here())
    session.keeping = false
    if (!taken.ok) {
      EffectBus.emit('activity:log', { message: taken.reason })
      say(taken.reason, 'bad')
      return
    }
    session.kept = taken.segments[taken.segments.length - 1] ?? ''
    const words = t('recipe.catalogue.brought', 'Kept in your hive as {name}', { name: session.kept })
    EffectBus.emit('activity:log', { message: words })
    say(words, 'good')
    // The tile is committed: one pass of the processor lets the grid under the view paint it.
    void new hypercomb().act().catch(() => undefined)
  }

  /** Take the opened recipe off the list and give the list its keys back. */
  #closeOpened(mount: Mount, refocus = true): void {
    const session = mount.opened
    if (!session) return
    mount.opened = null
    session.page.dispose()
    session.page.element.remove()
    for (const url of session.urls) letGo(url)
    const catalogue = mount.catalogue
    if (!catalogue) return
    catalogue.element.inert = false
    if (refocus && this.#mount === mount) catalogue.focus()
  }

  // ── leaving ────────────────────────────────────────────────────────────

  /** One step back: the opened recipe when one is up, else the catalogue, where there is somewhere to go. */
  #back(): void {
    const mount = this.#mount
    if (mount?.opened) this.#closeOpened(mount)
    else if (mount?.leavable) this.#exit()
  }

  /** The catalogue's own Close obeys the arrival-face rule the right button does. */
  #backOut(): void {
    const vm = this.#vm()
    if (!vm || vm.mode !== VIEW) return
    const peel = (): void => {
      this.#teardown()
      vm.setMode(HEXAGONS)
    }
    const gesture = live<BackGesture>('@diamondcoreprocessor.com/BackGesture')
    if (gesture?.backOutOfView) gesture.backOutOfView(peel)
    else peel()
  }

  #exit(): void {
    this.#teardown()
    this.#vm()?.setMode(HEXAGONS)
  }

  #teardown(): void {
    const mount = this.#mount
    if (mount) {
      this.#mount = null
      for (const off of mount.offs) off()
      this.#closeOpened(mount, false)
      mount.catalogue?.dispose()
      for (const url of mount.covers.values()) letGo(url)
      mount.host.remove()
      if (!mount.door) {
        EffectBus.emitTransient<DomainShelfWanted>(DOMAIN_SHELF_WANTED, { owner: OWNER, wanted: false })
        // The pool is no longer on screen: the shelf drops its people and its counts.
        EffectBus.emit<SourcesNodes>(SOURCES_NODES, { nodes: [] })
        EffectBus.emit<SourcesCounted>(SOURCES_COUNTED, { meaning: RECIPE_ENTRY_MEANING, counts: {} })
      }
      EffectBus.emitTransient('keymap:release', { reason: OWNER })
    }
    this.#setViewActive(false)
  }

  #setViewActive(active: boolean): void {
    if (this.#viewActive === active) return
    this.#viewActive = active
    // Owner-counted, never a raw boolean: something closing on top of the
    // catalogue must not unhide the chrome while the catalogue is still open.
    const modes = live<ModeRegistryShape>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', OWNER)
    else modes?.exit('view:active', OWNER)
  }
}

window.ioc.register('@diamondcoreprocessor.com/RecipeCatalogueViewDrone', new RecipeCatalogueViewDrone())
