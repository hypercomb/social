// pools/pools-mode.drone.ts
//
// POOLS MODE, ON THE PAGE. The header's lock opens the stage between private
// and the swarm (LIGHTS_MODE, lights-contract.ts): every tile is on or off, a
// tap turns one on, and what is on is offered. This drone is what makes that
// stage legible and usable: it owns the pools bar (pools-bar.ts), the frame
// around the viewport and the green ground (pools-background.provider.ts), and
// it carries out the one act the mode exists for.
//
// THE ACT IS PUBLISH, AND ONLY A PRESS DOES IT (T5). Entering the mode sends
// nothing. Lighting a tile sends nothing. Publish asks every contribution what
// the lit tiles carry and leaves it in the participant's pools at their own
// root domain (pool-contributions.ts, T9), which is the whole of an insert:
// a row offered where anyone who follows the host can read it (T8). Nothing is
// staged, no site is built, and no pool holds truth (P6).
//
// The bar is mounted on the body like the select pill
// (selection/select-mode.drone.ts) and stands down wherever that pill does: a
// view that owns the viewport, a published visitor shell. It also stands down
// while tiles are being picked and while the join selector is open, because
// each of those owns the same ground.
//
// It meets the header, the domain shelf and the word `pools` on the EffectBus
// and imports none of them. Commands go out transient; what happened
// (LIGHTS_PUBLISHED) goes out as a last value.
//
// POSTS are one line of the bar (open-entries-panel.ts `entryPostsLine`): how
// many pages take posts from phones, read each time the mode comes up, and the
// press that opens the "Collect from phones" card. The card is its own
// full-screen dialog, put up by this drone with or without the bar: the word
// `recipe posts` asks for it (ENTRY_POSTS_WANTED) and needs no pools mode.

import { Drone, EffectBus, get } from '@hypercomb/core'
import { isBranchPublic, isCellPublic, isIndividuallyPublic } from '../presentation/tiles/tile-public.js'
import { isPublishedVisitorShell } from '../sharing/behavior-enablement.js'
import {
  DOMAIN_SHELF_WANTED, LIGHTS_CHANGED, LIGHTS_JOIN_SWARM, LIGHTS_LEAVE, LIGHTS_MODE, LIGHTS_PUBLISH, LIGHTS_PUBLISHED,
  type DomainShelfWanted, type LightsMode,
} from './lights-contract.js'
import { litCountHere } from './lit-tiles.js'
import { ENTRY_POSTS_WANTED } from './open-entries-forms.js'
import type { EntryLeaderDeps } from './open-entries-leader.js'
import { EntryPostsControl, entryPostsLine, entryPostsPanel } from './open-entries-panel.js'
import { litPoolPreview, poolContributions, publishLitPools } from './pool-contributions.js'
import { PoolsBackgroundProvider } from './pools-background.provider.js'
import { poolsBar, poolsBarOutcome, poolsFrame, poolsSay, type PoolsBarPool, type PoolsBarState } from './pools-bar.js'

const VIEW_MODE_KEY = '@hypercomb.social/ViewMode'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const BACKGROUND_KEY = '@diamondcoreprocessor.com/BackgroundDrone'
/** The name this drone asks for the domain shelf under. */
const SHELF_OWNER = 'pools-mode'
/** The name the hive's keymap is held under while the posts card is up. */
const POSTS_KEYMAP_REASON = 'pools-posts-card'
/** How long the lights settle before the counts are read again: a lit tile's record lands a moment after its mark. */
const RECOUNT_MS = 180

type ViewModeLike = EventTarget & { mode?: string }
type BackgroundLike = { addProvider(provider: PoolsBackgroundProvider): void; requestRedraw: () => void }
type CellCountPayload = { labels?: unknown; coords?: unknown; externalLabels?: unknown }
/** One of your own tiles on this page, as a tile action names it. */
type TileHere = { label: string; q: number; r: number; index: number }

const typing = (): boolean => {
  const focused = document.activeElement
  return focused instanceof HTMLElement && (focused.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName))
}

const fingerFirst = (): boolean => {
  try { return window.matchMedia?.('(pointer: coarse)').matches === true } catch { return false }
}

export class PoolsModeDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Pools mode: the bar that says which tiles are on, publishes what they carry to your pools, and leads on to the swarm.'

  protected override deps = {}
  protected override listens = [
    LIGHTS_MODE, LIGHTS_CHANGED, LIGHTS_PUBLISH, 'render:cell-count', 'render:set-hive-visible',
    'view:active', 'select:mode', 'sample:mode', 'mesh:modal-open', 'global:escape', ENTRY_POSTS_WANTED, 'locale:changed',
  ]
  protected override emits = [
    LIGHTS_PUBLISHED, LIGHTS_PUBLISH, LIGHTS_LEAVE, LIGHTS_JOIN_SWARM, DOMAIN_SHELF_WANTED, 'tile:action', 'activity:log',
    'keymap:hold', 'keymap:release',
  ]

  #bound = false
  /** Pools mode is up (the header's word). */
  #active = false
  #tiles: TileHere[] = []
  #viewActive = false
  #hiveHidden = false
  #selecting = false
  #sampling = false
  #selectorOpen = false
  #viewMode: ViewModeLike | null = null
  readonly #onViewModeChange = (): void => { this.#reconcile() }

  /** The bar and its frame, built once per showing and updated in place. */
  #bar: ReturnType<typeof poolsBar> | null = null
  #frame: HTMLElement | null = null
  /** The leader's pools opened for posts: its own state, kept while the drone lives, drawn while the bar is up. */
  #posts: EntryPostsControl | null = null
  /** The bar's one line about posts. */
  #postsRow: ReturnType<typeof entryPostsLine> | null = null
  /** The "Collect from phones" card: its own full-screen dialog, up with or without the bar. */
  #postsCard: ReturnType<typeof entryPostsPanel> | null = null
  /** What the leader's side runs with: a spec hands its own in. */
  postsDeps: EntryLeaderDeps = {}

  #here = 0
  #total = 0
  #pools: PoolsBarPool[] = []
  #publishing = false
  #outcome: PoolsBarState['outcome'] = null
  #recountTimer: ReturnType<typeof setTimeout> | null = null
  /** Each recount's turn, so a slow read never overwrites a newer one. */
  #turn = 0
  /** The page the hive's counts were last asked for on. */
  #countedAt: string | null = null

  get active(): boolean { return this.#active }

  protected override heartbeat = async (): Promise<void> => {
    if (this.#bound) return
    this.#bound = true

    if (!this.#ensureViewMode()) {
      // ViewMode is shell-owned and can register after the essentials graph.
      window.ioc?.whenReady?.<ViewModeLike>(VIEW_MODE_KEY, viewMode => {
        this.#bindViewMode(viewMode)
        this.#reconcile()
      })
    }

    // The cascade's last rung (keyboard/escape-cascade.ts): nothing else took
    // the press, so it closes the mode. Only while the bar is up, which also
    // lets the old press replayed at this subscription fall on nothing: the
    // bar is not built until the end of this heartbeat.
    this.onEffect('global:escape', () => {
      if (this.#bar && !typing()) EffectBus.emitTransient(LIGHTS_LEAVE, {})
    })

    this.onEffect<LightsMode>(LIGHTS_MODE, mode => this.#setActive(mode?.active === true))

    this.onEffect<CellCountPayload>('render:cell-count', payload => {
      const labels = Array.isArray(payload?.labels) ? payload.labels : []
      const coords = Array.isArray(payload?.coords) ? payload.coords as { q?: number; r?: number }[] : []
      const external = new Set(Array.isArray(payload?.externalLabels) ? payload.externalLabels.map(String) : [])
      this.#tiles = []
      labels.forEach((raw, index) => {
        const label = String(raw ?? '')
        // A peer's tile is on the page and is not yours to offer.
        if (label && !external.has(label)) this.#tiles.push({ label, q: coords[index]?.q ?? 0, r: coords[index]?.r ?? 0, index })
      })
      // A repaint of the same page changes what is on here at most; arriving
      // on another page is also when what the lit tiles carry may have changed.
      this.#recountHere()
      if (this.#location() !== this.#countedAt) this.#recountSoon()
    })

    // A light turned: what was published no longer says what is on.
    this.onEffect(LIGHTS_CHANGED, () => {
      this.#outcome = null
      this.#recountHere()
      this.#recountSoon()
    })

    this.onEffect(LIGHTS_PUBLISH, () => { void this.#publish() })
    // A language chosen while the bar is up: its words are laid when it is built, so it is built again.
    this.onEffect('locale:changed', () => {
      // The card says every word again on each state it is handed.
      if (this.#postsCard && this.#posts) this.#postsCard.update(this.#posts.state)
      if (!this.#bar || this.#builtIn === document.documentElement.lang) return
      this.#teardown()
      this.#reconcile()
    })

    // Transient, so an old ask is never replayed into a new bar. The word asks
    // for pools mode first: when the mode did not come up the ask is dropped,
    // and while something else holds the bar down it waits for the bar.
    this.onEffect(ENTRY_POSTS_WANTED, () => this.#openPostsCard())

    this.onEffect<{ active?: boolean }>('view:active', payload => { this.#viewActive = !!payload?.active; this.#reconcile() })
    this.onEffect<{ visible?: boolean }>('render:set-hive-visible', payload => { this.#hiveHidden = payload?.visible === false; this.#reconcile() })
    this.onEffect<{ active?: boolean }>('select:mode', payload => { this.#selecting = !!payload?.active; this.#reconcile() })
    this.onEffect<{ active?: boolean }>('sample:mode', payload => { this.#sampling = !!payload?.active; this.#reconcile() })
    this.onEffect<{ open?: boolean }>('mesh:modal-open', payload => { this.#selectorOpen = !!payload?.open; this.#reconcile() })

    this.#reconcile()
  }

  protected override dispose(): void {
    this.#closePostsCard()
    if (this.#recountTimer) clearTimeout(this.#recountTimer)
    this.#recountTimer = null
    this.#viewMode?.removeEventListener('change', this.#onViewModeChange)
    this.#viewMode = null
    // The shelf was asked for under this drone's name: let it go with the drone.
    if (this.#active) EffectBus.emitTransient<DomainShelfWanted>(DOMAIN_SHELF_WANTED, { owner: SHELF_OWNER, wanted: false })
    this.#active = false
    this.#teardown()
  }

  // ── the mode ──────────────────────────────────────────────────────

  #setActive(active: boolean): void {
    if (active === this.#active) return
    this.#active = active
    // Sources are part of this experience: which hosts you draw from sits
    // beside which tiles you offer. Another package builds the shelf.
    EffectBus.emitTransient<DomainShelfWanted>(DOMAIN_SHELF_WANTED, { owner: SHELF_OWNER, wanted: active })
    if (!active) this.#outcome = null
    this.#recountHere()
    this.#recountSoon()
    this.#reconcile()
  }

  // ── the bar ───────────────────────────────────────────────────────

  /** Whether the bar belongs on screen: the mode is up and the hexagons are what is showing. */
  #wanted(): boolean {
    if (!this.#active) return false
    if (isPublishedVisitorShell()) return false
    if ((this.#ensureViewMode()?.mode ?? 'hexagons') !== 'hexagons') return false
    if (this.#viewActive || this.#hiveHidden) return false
    // A picker owns the taps and the same slot, and the selector covers the page.
    if (this.#selecting || this.#sampling || this.#selectorOpen) return false
    return true
  }

  #ensureViewMode(): ViewModeLike | undefined {
    const viewMode = window.ioc?.get?.<ViewModeLike>(VIEW_MODE_KEY)
    if (viewMode) this.#bindViewMode(viewMode)
    return viewMode ?? this.#viewMode ?? undefined
  }

  #bindViewMode(viewMode: ViewModeLike): void {
    if (this.#viewMode === viewMode || typeof viewMode.addEventListener !== 'function') return
    this.#viewMode?.removeEventListener('change', this.#onViewModeChange)
    this.#viewMode = viewMode
    viewMode.addEventListener('change', this.#onViewModeChange)
  }

  /** The page's language when the bar was built. */
  #builtIn = ''

  #reconcile(): void {
    if (!this.#wanted()) { this.#teardown(); return }
    if (!this.#bar) {
      const control = this.#postsControl()
      this.#postsRow = entryPostsLine(poolsSay, () => this.#openPostsCard())
      this.#bar = poolsBar({
        posts: this.#postsRow.element,
        say: poolsSay,
        onPublish: () => EffectBus.emitTransient(LIGHTS_PUBLISH, {}),
        onJoin: () => EffectBus.emitTransient(LIGHTS_JOIN_SWARM, {}),
        onClose: () => EffectBus.emitTransient(LIGHTS_LEAVE, {}),
        onAllOn: () => this.#allHere(true),
        onAllOff: () => this.#allHere(false),
      })
      this.#builtIn = document.documentElement.lang
      this.#frame = poolsFrame()
      document.body.append(this.#frame, this.#bar.element)
      this.#postsRow.update(control.state)
      // The leader's pools are read each time the bar comes up, unless the card is up and reading them itself.
      if (!this.#postsCard) void control.refresh()
    }
    this.#paint()
  }

  #postsControl(): EntryPostsControl {
    return this.#posts ??= new EntryPostsControl({
      say: poolsSay,
      deps: this.postsDeps,
      onChange: state => { this.#postsRow?.update(state); this.#postsCard?.update(state) },
    })
  }

  /** Put the "Collect from phones" card up: once, over everything but the code it shows. The hive's keymap is held
   *  while it is up, so a letter typed into its name is never a shortcut. */
  #openPostsCard(): void {
    if (this.#postsCard) return
    const control = this.#postsControl()
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    this.#postsCard = entryPostsPanel(poolsSay, control.actions, Date.now, { onDismiss: () => this.#closePostsCard(opener) })
    document.body.append(this.#postsCard.element)
    EffectBus.emitTransient('keymap:hold', { reason: POSTS_KEYMAP_REASON })
    this.#postsCard.update(control.state)
    void control.begin()
  }

  #closePostsCard(opener: HTMLElement | null = null): void {
    if (!this.#postsCard) return
    this.#posts?.cancel()
    this.#postsCard.dispose()
    this.#postsCard = null
    EffectBus.emitTransient('keymap:release', { reason: POSTS_KEYMAP_REASON })
    if (opener?.isConnected) opener.focus()
  }

  #teardown(): void {
    this.#bar?.dispose()
    this.#bar = null
    this.#postsRow = null
    this.#frame?.remove()
    this.#frame = null
  }

  #paint(): void {
    if (!this.#bar) return
    const location = this.#location()
    this.#bar.update({
      here: this.#here,
      total: this.#total,
      pools: this.#pools,
      busy: this.#publishing,
      outcome: this.#outcome,
      canOn: this.#tiles.some(tile => !isCellPublic(location, tile.label)),
      canOff: this.#tiles.some(tile => isIndividuallyPublic(location, tile.label) || isBranchPublic(location, tile.label)),
      touch: fingerFirst(),
    })
  }

  // ── the counts ────────────────────────────────────────────────────

  #location(): string {
    return get<{ explorerLabel?(): string }>(LINEAGE_KEY)?.explorerLabel?.() ?? '/'
  }

  /** How many of this page's tiles are on: read at once, from the marks' own cache. */
  #recountHere(): void {
    if (!this.#active) return
    this.#here = litCountHere(this.#location(), this.#tiles.map(tile => tile.label))
    this.#paint()
  }

  /** How many tiles are on in the whole hive and what Publish would leave: read once the lights have settled. */
  #recountSoon(): void {
    if (!this.#active) return
    if (this.#recountTimer) clearTimeout(this.#recountTimer)
    this.#recountTimer = setTimeout(() => {
      this.#recountTimer = null
      void this.#recountHive()
    }, RECOUNT_MS)
  }

  async #recountHive(): Promise<void> {
    const turn = ++this.#turn
    const at = this.#location()
    // One read answers both: the routes Publish would walk ARE what is on in
    // all, a lit branch counted with everything under it, which is how "on
    // here" counts it. The marks alone would say one for a whole branch.
    const preview = await litPoolPreview()
    if (turn !== this.#turn || !this.#active) return
    this.#countedAt = at
    this.#total = preview.lit
    this.#pools = preview.pools
    this.#paint()
  }

  // ── the lights on this page ───────────────────────────────────────

  /**
   * Turn every tile on this page on, or off, through the same action a tap
   * sends. A tile already there is left alone. Off takes back only what was
   * turned on HERE: a tile lit by a branch above it stays lit until that
   * branch is turned off where it is rooted.
   */
  #allHere(on: boolean): void {
    const location = this.#location()
    const act = (action: string, tile: TileHere): void =>
      this.emitEffect('tile:action', { action, label: tile.label, q: tile.q, r: tile.r, index: tile.index })
    for (const tile of this.#tiles) {
      if (on) {
        if (!isCellPublic(location, tile.label)) act('make-public', tile)
        continue
      }
      if (isIndividuallyPublic(location, tile.label)) act('make-public', tile)
      if (isBranchPublic(location, tile.label)) act('make-branch-public', tile)
    }
  }

  // ── publish ───────────────────────────────────────────────────────

  /**
   * Leave what the lit tiles carry in the participant's pools. Runs whether or
   * not the bar is showing (the word `pools publish` asks for it too), says so
   * in the activity log, and announces what happened as a last value.
   */
  async #publish(): Promise<void> {
    if (this.#publishing) return
    this.#publishing = true
    this.#outcome = null
    this.#paint()
    const published = await publishLitPools()
    this.#publishing = false
    const labels = new Map(poolContributions().map(contribution => [contribution.meaning, contribution.label]))
    const text = poolsBarOutcome(poolsSay, published, meaning => labels.get(meaning))
    this.#outcome = { text, ok: published.ok }
    this.emitEffect(LIGHTS_PUBLISHED, published)
    this.emitEffect('activity:log', { message: text })
    this.#paint()
  }
}

// THE BEE WIRES: the ground is a dependency this behaviour hands to the
// background drone, which is render-critical and normally here first.
window.ioc.whenReady<BackgroundLike>(BACKGROUND_KEY, background => {
  background.addProvider(new PoolsBackgroundProvider(background.requestRedraw))
})

const _poolsMode = new PoolsModeDrone()
window.ioc.register('@diamondcoreprocessor.com/PoolsModeDrone', _poolsMode)
