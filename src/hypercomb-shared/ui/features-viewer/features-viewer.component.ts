// hypercomb-shared/ui/features-viewer/features-viewer.component.ts
//
// Right-docked "Beehaviors" panel — TWO surfaces, ONE control (see
// src/documentation/behaviors-view-simplification.md):
//
//   • THE POOL — no tile subject. Every behavior the app knows, one row
//     each, one light bulb each. Everything starts OFF; clicking lights it
//     globally. Off = dormant everywhere AND withheld from every swarm.
//
//   • THIS LAYER — the same rows, the same bulb, scoped here. Every
//     globally-lit behavior is listed; lit = its record is deposited on
//     this layer (directly, or flowing from an ancestor), dim = not here
//     yet. Clicking ON deposits the record and nothing else — it WAITS on
//     the objects beneath, and the behavior gives them meaning when they
//     meet (context-behaviors.md). Clicking OFF removes the record here
//     (undoable). Inherited rows carry one quiet "from {cell}" line and
//     flip at their origin. While open the panel FOLLOWS NAVIGATION.
//
// No verbs, no buttons on rows — the bulb is the whole story. Legacy
// hidden-pool records remain READABLE (a suppressed row renders dim with a
// one-tap restore) but are never minted again.
//
// Shell UI, so it must NOT import essentials — module services are reached
// only through window.ioc at runtime; row data arrives pre-computed on
// `features:open` / `features:roster`.

import { registerShellSurface } from '../../core/shell-surface-registry'
import { Component, computed, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { onSelection } from '../../core/selection-context'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'
import { PHONE_QUERY } from '../breakpoints'
import { markVerified, markAllowedRoot, branchRootFor } from './feature-verified'
import { restoreFeature, loadHidden, hiddenKey, type HiddenFeature } from './feature-hidden'
import { setKindGlobalOn, ENABLEMENT_CHANGED } from './behavior-enablement'
import { enableAggregation, disableAggregation, listAggregation } from '../../core/aggregation-layer'

/** How long a row treats another press as THE SAME PRESS. See #isRepeatPress:
 *  a switch nobody saw move gets pressed again, and without this the second
 *  press undoes the first. */
const PRESS_REPEAT_MS = 400

/** A feature applied to the tile — a decoration (or slot) it carries. */
interface FeatureRow {
  view: string
  /** Material Symbols ligature declared by this behavior. */
  icon: string
  kind: string
  label: string
  description: string
  slashCommand?: string
  behavior?: string
  /** True when this is a VIEW BEHAVIOUR whose view can be entered (slides,
   *  website, home, tutor). The row gets an Open action. */
  openable?: boolean
  /** True when the view opens IN PLACE over the current layer (no navigation). */
  opensInPlace?: boolean
  /** True when this behaviour has a REACH to choose — its content can be read
   *  from the layer's own children or from the whole hierarchy beneath. That
   *  is the one thing a row has to MANAGE. */
  manageScopes?: boolean
  /** Which reach it is reading right now. */
  sourceScope?: 'layer' | 'hierarchy'
  /** The bee to ask for a reach change (`scope layer` / `scope hierarchy`). */
  queenKey?: string
  branchSig?: string
  /** True when this feature, declared on a container, flows to its subtree. */
  cascades?: boolean
  /** `direct` = on this tile; `cascade` = inherited from an ancestor
   *  (named by `originCell`, absent = the hive root). */
  origin?: 'direct' | 'cascade'
  originCell?: string
  originSegments?: string[]
  /** For a SCOPE feature (a website): the site ROOT's path. */
  scopeSegments?: string[]
  /** Legacy row-key scope marker (kept for stable row keys). */
  hideAt?: 'node' | 'origin'
  /** True when no module here declares this kind — named from its kind,
   *  inert until its module arrives. */
  foreign?: boolean
  module?: string
  /** Gate data still stamped by the producer — the download path uses the
   *  sig; the panel renders no chip for it (the review surface is the gate). */
  gated?: boolean
  gateSig?: string
  publisherDomain?: string
  /** True when the global light is off for this kind. The store is where it
   *  comes back — a dormant row is filtered from the tile view entirely. */
  dormant?: boolean
  /** Set when this behaviour BELONGS to this tile — bound to its location
   *  signature, so it shows here and is withdrawn everywhere else. The row
   *  says whose it is. */
  bound?: BehaviorBinding
}

/** Where a behaviour belongs — the bound tile's LOCATION signature (stable
 *  across every edit of that tile), its canonical path, and its name. */
interface BehaviorBinding {
  sig: string
  path: string
  name?: string
}

/** One row of THE STORE — every behavior the app knows. `on` is the light;
 *  `used` is the badge (decorations referencing it, counted, never stored). */
interface StoreRow {
  view: string
  icon: string
  kind: string
  label: string
  description: string
  category: string
  slashCommand?: string
  foreign?: boolean
  module?: string
  on: boolean
  used?: number
  /** Present when the behaviour is bound to one or more tiles — the store is
   *  the census, so it is the one surface that names every binding at once.
   *  Absent means it belongs to the whole hive (the default). */
  bound?: BehaviorBinding[]
}

/** A behavior the app knows but this tile doesn't carry yet. */
interface AvailableRow {
  view: string
  icon: string
  kind: string
  label: string
  description: string
  slashCommand?: string
  cascades?: boolean
  /** True when the panel can ADD this feature mechanically. View bees whose
   *  content must be authored carry the slash-command chip instead. */
  addable?: boolean
  /** True when this behaviour is a VIEW — a surface you can be standing in.
   *  An applied row carries the same fact as `openable`. */
  isView?: boolean
  /** True when this kind's light is off, or it belongs to another tile — the
   *  row is not offered at all. */
  globalOff?: boolean
  /** Set when this behaviour belongs to this tile: it is offered HERE because
   *  this is the one place it means anything. */
  bound?: BehaviorBinding
}

/** One row of THIS LAYER's single list — an applied row and an available
 *  row flattened to the same shape, so the template renders one control:
 *  the bulb. `feat` keeps the source row for the selection/bulk helpers. */
interface LayerRow {
  kind: string
  view: string
  icon: string
  label: string
  description: string
  slashCommand?: string
  on: boolean
  applied: boolean
  /** Lit from an ancestor (or a website scope root) — flips at its origin. */
  inherited: boolean
  /** A lit view behaviour can be ENTERED — the hover-only Open affordance. */
  openable: boolean
  /** This behaviour is a VIEW. Views live in the same list as everything
   *  else — the only difference is the row's background, and that only a
   *  view can be the layer's DEFAULT. */
  isView: boolean
  /** This row has a reach to choose — it grows the manage affordance. */
  manageScopes: boolean
  sourceScope?: 'layer' | 'hierarchy'
  queenKey?: string
  originCell?: string
  foreign?: boolean
  module?: string
  bound?: BehaviorBinding
  feat: FeatureRow | AvailableRow
}

/** Minimal shape the selection / bulk helpers need. */
type RowLike = {
  kind: string
  view: string
  label: string
  branchSig?: string
  gateSig?: string
  originSegments?: string[]
  hideAt?: 'node' | 'origin'
}

interface FeatureGroup {
  cell: string
  segments: string[]
  applied: FeatureRow[]
  available: AvailableRow[]
  adopted: boolean
}

/** Download-leash trip point: this much SILENCE (no progress tick, no done)
 *  means the producer died mid-walk — matches the sync pill's stale guard. */
const DOWNLOAD_STALL_MS = 90_000

/** One row of the download pathway stepper: sent → receiving → done. */
interface DownloadPath {
  cell: string
  stage: 1 | 2 | 3
  active: boolean
  ok: boolean
  stalled?: boolean
  files: number
  failed: number
}

interface FeaturesOpenPayload {
  cell: string
  segments: string[]
  applied: FeatureRow[]
  available: AvailableRow[]
  adopted?: boolean
  /** The view this layer OPENS AS — '' when it has none. */
  defaultView?: string
}

/** Shell-safe slice of the essentials picker, resolved through IoC. */
type SelectModeLike = { arm(): void }
const SELECT_MODE_KEY = '@diamondcoreprocessor.com/SelectModeDrone'

/** Sticky pool filter: '0' = anchored (tile-bound) behaviors hidden. */
const ANCHORED_PREF_KEY = 'hc:behaviors-pool-anchored'

@Component({
  selector: 'hc-features-viewer',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './features-viewer.component.html',
  styleUrls: ['./features-viewer.component.scss'],
})
export class FeaturesViewerComponent implements OnDestroy {

  readonly visible = signal(false)

  /** Put away while the hive is covered, brought back on the way home — the
   *  panel's rows, selection and query all survive, which `close()` would not
   *  (it empties the panel on purpose). */
  readonly session = signalSession(
    this.visible,
    open => EffectBus.emit('features:viewer-state', { open }),
    { dismiss: () => this.dismiss(), close: () => this.close() },
  )

  /** The ONE tile the panel is describing. Null = closed / store only. */
  readonly group = signal<FeatureGroup | null>(null)

  // ── SELF and CHILD ────────────────────────────────────────────────
  //
  // The panel has TWO doors and they mean different things:
  //
  //   • the top rail's switch (and an empty layer, which sends the same
  //     signal on arrival) — no tile in hand, so the subject is the CONTEXT:
  //     the layer that is loaded. Walk deeper and the subject walks with
  //     you; every arrival lands on self again.
  //   • the selection menu's features button — that TILE becomes the
  //     subject, a child of self, and it stays there. Standing on the parent
  //     does not drag the panel back up; you asked about the tile.
  //
  // THE HEADER NAMES THE SUBJECT — `Beehaviors / <tile>` — and in the pool,
  // where there is no subject to name, it says `global` instead (Jaime,
  // 2026-08-24). TWO SEGMENTS, NEVER THREE: an earlier pass hung the scope
  // word off the app AND the name, and on a tile named for what it holds
  // that read `Beehaviors / local / behaviors` — the same word twice, and
  // shaped like a path. The scope word earns its place only when it is the
  // whole answer, which is exactly the pool: not attached to any tile.

  /** The subject's name for the header title — `Beehaviors / <name>`. Empty at
   *  the HIVE ROOT (no segments, or a bare `/` label): there is no name below
   *  the app there, and a separator with nothing after it read as `Beehaviors
   *  //`. The pool has no subject at all and says `global` in its place. */
  readonly subjectName = computed(() => {
    const g = this.group()
    if (!g || g.segments.length === 0) return ''
    const cell = String(g.cell ?? '').trim()
    return cell === '/' ? '' : cell
  })

  /** A foreign feature the participant has been asked to REVIEW before
   *  enabling — set from `feature:review:open` (the website gate). */
  readonly reviewTarget = signal<{
    cell: string; segments: string[]; sig: string; kind: string; label: string; code: string
  } | null>(null)

  /** Phone-shaped viewport (narrow OR short). */
  readonly isPhone = signal(
    typeof window !== 'undefined'
      ? window.matchMedia(PHONE_QUERY).matches
      : false,
  )
  #phoneQuery: MediaQueryList | null = null
  #phoneHandler = (e: MediaQueryListEvent): void => { this.isPhone.set(e.matches) }

  /** The review code is showing (phone: a place you GO, never beside the
   *  decision). */
  readonly codeOpen = signal(false)
  readonly openCode = (): void => { this.codeOpen.set(true) }
  readonly closeCode = (): void => { this.codeOpen.set(false) }

  /** Leave it gated and get on with things. */
  readonly waitForCommunity = (): void => {
    this.codeOpen.set(false)
    this.reviewTarget.set(null)
  }

  /** LEGACY hidden-pool records, read-only drain: a row one suppresses
   *  renders dim with a one-tap restore. Nothing writes new records. */
  readonly hidden = signal<HiddenFeature[]>([])

  /** The header search — filters every section's rows live. */
  readonly query = signal('')

  // ── the two modes ────────────────────────────────────────────────
  //
  // TILE (default) — the decorations this tile carries + the Apply picker.
  // STORE — no tile subject: every behavior, one light each.

  readonly mode = signal<'tile' | 'store'>('tile')

  /** THE LENS — which KINDS the LOCAL list shows. TWO positions, mutually
   *  exclusive, because A VIEW IS A BEEHAVIOUR (Jaime, 2026-08-24): views are
   *  a SUBSET, not a rival kind, so `behaviors` is the WHOLE list — views
   *  included, told apart only by the ground the row stands on — and `views`
   *  narrows it to the surfaces.
   *
   *  There is no third `all` position: it would be a second name for
   *  `behaviors`. Two independent toggles over a set and its subset can be
   *  put into a state that means nothing (both dark = an empty list), and
   *  needed a rule to climb back out of it; a choice between two cannot.
   *
   *  WHERE you are reading — this layer or the pool — is NOT a lens position:
   *  that is `mode`, and the two are separate controls because they answer
   *  different questions (Jaime, 2026-08-22). */
  readonly lens = signal<'behaviors' | 'views'>('behaviors')

  /** The two kind buttons, as the strip draws them — EXACTLY ONE is ever
   *  lit, so the pair reads as a choice, never as two switches. */
  readonly showBehaviors = computed(() => this.lens() === 'behaviors')
  readonly showViews = computed(() => this.lens() === 'views')

  /** Pick a kind. Clicking the lit one is a no-op: there is nothing to
   *  un-pick, only the other one to pick. */
  readonly setLens = (kind: 'behaviors' | 'views'): void => { this.lens.set(kind) }

  /** THE SCOPE. Local = this layer's rows; Global = the pool, every
   *  beehaviour with one global light each. ONE toggle, two positions —
   *  the glyph names WHERE YOU ARE (not where the next click goes), and
   *  the header title spells the word out beside it. */
  //  `features.where.*`, NOT `features.scope.*` — `features.scope.layer`
  //  was already taken by the manage strip ("This layer" vs "Everything
  //  beneath"), and a second key by that name is a SILENT duplicate: JSON
  //  keeps the last one, so the title would have read the wrong string.
  readonly scopeKey = computed(() => this.isStore() ? 'features.where.global' : 'features.where.layer')
  readonly scopeHintKey = computed(() => this.isStore() ? 'features.where.layer.hint' : 'features.where.global.hint')
  readonly scopeIcon = computed(() => this.isStore() ? 'storefront' : 'layers')

  readonly toggleScope = (): void => {
    if (this.mode() === 'store') this.closeStore()
    else this.openStore()
  }

  /** The view this LAYER opens as - '' when it opens as hexagons. One per
   *  layer: choosing a second view is the same gesture as choosing the first,
   *  because the writer replaces rather than appends. */
  readonly defaultView = signal('')

  /** The row whose MANAGE strip is open (by kind), '' when none is. Manage is
   *  not a mode and not a window - it is the row telling you the one thing it
   *  has to decide, and only while you ask. */
  readonly managing = signal('')

  /** The store rows, as last delivered by `features:roster`. */
  readonly storeRows = signal<StoreRow[]>([])

  readonly isStore = computed(() => this.mode() === 'store')

  /** STICKY POOL FILTER — anchored (tile-bound) behaviors in or out, so the
   *  pool can be read as just the hive-wide ones. The icon is the filter;
   *  the choice persists across sessions. */
  readonly showAnchored = signal(localStorage.getItem(ANCHORED_PREF_KEY) !== '0')

  readonly toggleAnchored = (): void => {
    const next = !this.showAnchored()
    this.showAnchored.set(next)
    try { localStorage.setItem(ANCHORED_PREF_KEY, next ? '1' : '0') } catch { /* private-browsing */ }
  }

  /** The pool, flat: one row per behavior, A→Z, through the header query.
   *  No categories, no badges — a list of lights. */
  readonly storeList = computed<StoreRow[]>(() => {
    const q = this.query().trim().toLowerCase()
    return this.storeRows()
      .filter(r => this.showAnchored() || !(r.bound?.length))
      .filter(r => !q
        || r.label.toLowerCase().includes(q)
        || r.kind.toLowerCase().includes(q)
        || r.description.toLowerCase().includes(q)
        || (r.slashCommand ?? '').toLowerCase().includes(q))
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label))
  })

  readonly storeOnCount = computed(() => this.storeRows().filter(r => r.on).length)

  /** How many behaviours belong to one tile rather than to the whole hive. */
  readonly storeBoundCount = computed(() =>
    this.storeRows().filter(r => (r.bound?.length ?? 0) > 0).length)

  /** The tiles a behaviour belongs to, as one plain phrase. Names, not paths:
   *  the signature is the identity, but nobody reads a hash — the name is how
   *  the author said it and how the panel says it back. */
  readonly boundTo = (bindings: readonly BehaviorBinding[] | undefined): string =>
    (bindings ?? []).map(b => b.name || b.path).join(', ')

  /** Flip one light. Optimistic row update — the writer emits
   *  `behavior:enablement-changed`, so every other surface reacts at once.
   *  Turning a light ON is also the participant's OK: no separate gate chip
   *  ever asks again from a list row (the review surface handles real code
   *  review when the render gate demands it). */
  readonly storeToggle = (row: StoreRow): void => {
    if (this.#isRepeatPress('pool/' + row.kind)) return
    const next = !row.on
    setKindGlobalOn(row.kind, next)
    this.storeRows.set(this.storeRows().map(r => r.kind === row.kind ? { ...r, on: next } : r))
  }

  /** Open the store (header button; WORLD stage and the join selector emit
   *  the same effect). show-features answers with the rows. */
  readonly openStore = (): void => {
    EffectBus.emit('features:roster-open', {})
  }

  /** Leave the store back to the per-tile surface. The group's rows carry
   *  the dormant/global-off marks computed when the group was OPENED — any
   *  switch flipped in the store made them stale, so re-request the group
   *  rather than showing rows that should have disappeared (dormant means
   *  gone) or offers that should have been withdrawn. */
  readonly closeStore = (): void => {
    if (this.mode() !== 'store') return
    this.mode.set('tile')
    this.#refreshGroup()
  }

  /** Re-request the current group so the drone re-marks its rows (fresh
   *  dormant/global-off state). Same pipeline follow-navigation uses. */
  #refreshGroup(): void {
    const g = this.group()
    if (!g) return
    this.#openAt(g.segments, g.cell)
  }

  /** Ask the drone to describe a LOCATION — the one way this panel changes
   *  subject, whether the trigger is navigation, the rail switch, the crumb's
   *  self step or a roster flip. Empty segments are the hive ROOT and must
   *  say so: `root: true` is what tells the drone not to resolve the label as
   *  a tile at the current location. */
  #openAt(segments: readonly string[], rootLabel = 'hypercomb'): void {
    const segs = segments.map(s => String(s ?? '').trim()).filter(Boolean)
    if (segs.length === 0) {
      EffectBus.emit('tile:action', { action: 'features', label: rootLabel, segments: [], root: true })
      return
    }
    EffectBus.emit('tile:action', { action: 'features', label: segs[segs.length - 1], segments: segs })
  }

  /** Where the participant is standing, read fresh from lineage. */
  #currentSegments(): string[] {
    const lineage = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** Multi-selected rows (Ctrl/Shift-click) — what the bulk bar acts on. */
  readonly selectedKeys = signal<ReadonlySet<string>>(new Set())

  /** Rows whose add/remove is in flight — guards double-clicks. */
  readonly pending = signal<ReadonlyMap<string, boolean>>(new Map())

  /** Row-level FAILURE notes by row key (`features:outcome`). Success is the
   *  state flipping — ok outcomes only clear. */
  readonly rowNotes = signal<ReadonlyMap<string, string>>(new Map())

  /** Latest content-health condition — the quiet WHY under a failure note. */
  readonly health = signal<{ condition: string; host: string | null } | null>(null)

  /** Bulk downloads in flight (by cell). */
  readonly downloading = signal<ReadonlySet<string>>(new Set())

  /** Files fetched since this download batch started. */
  readonly downloadedCount = signal(0)

  /** Per-cell download outcomes, in arrival order. */
  readonly downloadResults = signal<{ cell: string; ok: boolean; files: number; failed: number; stalled?: boolean }[]>([])

  /** The visible download pathway: one stepper row per cell. */
  readonly pathway = computed<DownloadPath[]>(() => {
    const out: DownloadPath[] = []
    const receiving = this.downloadedCount() > 0
    for (const cell of this.downloading()) {
      out.push({ cell, stage: receiving ? 2 : 1, active: true, ok: false, files: 0, failed: 0 })
    }
    for (const r of this.downloadResults()) {
      out.push({ cell: r.cell, stage: 3, active: false, ok: r.ok, stalled: r.stalled, files: r.files, failed: r.failed })
    }
    return out
  })

  readonly selectedCount = computed(() => this.selectedKeys().size)

  /** Selected rows with anything to fetch — what bulk-download acts on. */
  readonly downloadableCount = computed(() => {
    let n = 0
    for (const { feat } of this.#selectedRows()) {
      if (feat.branchSig || feat.gateSig) n++
    }
    return n
  })

  /** Canvas-selection response (documentation/selection-tool-windows.md). */
  readonly canvasSelectionCount = signal(0)
  readonly canvasSelectionHasFeatures = signal(false)
  readonly showCanvasSelectionAffordance = computed(() =>
    this.canvasSelectionCount() > 0 && this.canvasSelectionHasFeatures())

  #cleanups: (() => void)[] = []

  /** Last navigation path seen (joined) — follow-navigation re-targets only
   *  when this actually changes, never on fs-only invalidations. */
  #lastNavKey = ''

  constructor() {
    this.#phoneQuery = window.matchMedia(PHONE_QUERY)
    this.isPhone.set(this.#phoneQuery.matches)
    this.#phoneQuery.addEventListener('change', this.#phoneHandler)

    this.#cleanups.push(onSelection(({ selected }) => {
      this.canvasSelectionCount.set(selected.length)
    }))
    this.#cleanups.push(EffectBus.on<{ value?: boolean }>('selection:has-features', (p) => {
      this.canvasSelectionHasFeatures.set(p?.value === true)
    }))
    // Legacy hidden-pool records restored elsewhere drop from the drain list.
    this.#cleanups.push(
      EffectBus.on<{ featKind?: string; segments?: readonly string[] }>(
        'feature:restored',
        (payload) => {
          const featKind = String(payload?.featKind ?? '').trim()
          const segments = (payload?.segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
          if (!featKind) return
          const key = hiddenKey(featKind, segments)
          this.hidden.update(list => list.filter(record =>
            hiddenKey(record.featKind, record.appliesTo) !== key))
        },
      ),
      EffectBus.on('feature:activation-settled', () => {
        if (this.visible()) void this.#refreshHidden()
      }),
      // An enablement flip (roster switch, wake-here, publisher-withheld
      // record at adopt) re-marks the open tile group — its rows filter on
      // dormant/global-off, and those flags only exist at group-open time.
      // Tile mode only: while IN the store the rows are the switches
      // themselves, and a features:open arriving would yank the panel out
      // of the store mid-flip (closeStore refreshes on the way back).
      EffectBus.on(ENABLEMENT_CHANGED, () => {
        if (this.visible() && this.mode() === 'tile') this.#refreshGroup()
      }),
    )
    this.#cleanups.push(EffectBus.on<FeaturesOpenPayload>('features:open', (p) => {
      if (!p?.cell) return
      // No sibling is closed here — see the note in files-viewer. The lane
      // decides what fits on an edge, and it parks rather than closes.
      const group: FeatureGroup = {
        cell: p.cell,
        segments: Array.isArray(p.segments) ? p.segments : [],
        applied: Array.isArray(p.applied) ? p.applied : [],
        available: Array.isArray(p.available) ? p.available : [],
        adopted: p.adopted === true,
      }
      // The layer says how it opens. Read from the payload rather than
      // derived from the rows: a layer can name a default whose row is
      // currently dim, and that is still the truth about the layer.
      this.defaultView.set(String(p.defaultView ?? '').trim())
      // One tile at a time: re-clicking the SAME tile refreshes in place;
      // a DIFFERENT tile replaces the subject.
      const prev = this.group()
      if (prev?.cell !== group.cell) {
        this.selectedKeys.set(new Set())
        this.rowNotes.set(new Map())
        this.query.set('')
        // A new subject has nothing being managed. An in-place REFRESH does —
        // choosing a reach re-opens the group, and closing the strip under the
        // participant would hide the answer they just gave.
        this.managing.set('')
      }
      this.group.set(group)
      if (!this.visible()) {
        this.visible.set(true)
        EffectBus.emit('features:viewer-state', { open: true })
      }
      // A fresh group replaces its rows — any in-flight action is settled,
      // and the truth it carries is what the wish was standing in for.
      if (this.pending().size) this.pending.set(new Map())
      void this.#refreshHidden()
      void this.#refreshMembers()
      // A tile subject arriving takes the panel out of the store.
      if (this.mode() === 'store') this.mode.set('tile')
    }))

    // ── THE STORE arriving (features:roster-open → show-features) ──
    this.#cleanups.push(EffectBus.on<{ rows?: StoreRow[] }>('features:roster', (p) => {
      const rows = Array.isArray(p?.rows) ? p!.rows! : []
      this.storeRows.set(rows)
      this.query.set('')
      this.selectedKeys.set(new Set())
      this.mode.set('store')
      if (!this.visible()) {
        this.visible.set(true)
        EffectBus.emit('features:viewer-state', { open: true })
      }
    }))

    // ── the top rail's Beehaviors switch ──────────────────────────────
    //
    // No tile in hand, so the subject is the CONTEXT — the loaded layer.
    // Everything after that is the ordinary pipeline: the drone answers with
    // `features:open`, and that is what raises the panel.
    this.#cleanups.push(EffectBus.on('features:context-open', () => {
      this.#openAt(this.#currentSegments())
    }))

    // ── /views (and anything else that wants a particular lens) ───────
    //
    // Views used to be a window of their own. They are rows here now, so the
    // command raises this panel on the loaded layer and narrows the lens to
    // them — the same list, in the one place behaviours live.
    this.#cleanups.push(EffectBus.on<{ lens?: string }>('features:lens', (p) => {
      const want = String(p?.lens ?? '').trim()
      if (want === 'global') { this.openStore(); return }
      // `all` is the retired third position — it meant what `behaviors`
      // means now that views are counted among them, so an older caller
      // still lands on the whole list.
      if (want === 'all' || want === 'behaviors') this.lens.set('behaviors')
      else if (want === 'views') this.lens.set('views')
      else return
      if (this.mode() === 'store') this.mode.set('tile')
      this.#openAt(this.#currentSegments())
    }))

    // ── the panel FOLLOWS NAVIGATION ──────────────────────────────────
    //
    // Arriving on a layer makes it the subject — SELF — even when a tile's
    // puzzle-piece had pinned a child before the walk.
    const lineage = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<EventTarget & { explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    if (lineage?.addEventListener) {
      this.#lastNavKey = (lineage.explorerSegments?.() ?? []).join('\u0000')
      const onNav = (): void => {
        const segs = this.#currentSegments()
        const key = segs.join('\u0000')
        if (key === this.#lastNavKey) return
        this.#lastNavKey = key
        if (!this.visible()) return
        // Root is a context too — the hive itself. Leaving the panel on the
        // previous tile's group after backing out to `/` showed a subject the
        // participant is no longer standing on. (#openAt raises `root: true`
        // for the empty path, which is what tells the drone to describe the
        // hive rather than resolve the label at the current location.)
        this.#openAt(segs)
      }
      lineage.addEventListener('change', onNav)
      this.#cleanups.push(() => lineage.removeEventListener('change', onNav))
    }

    this.#cleanups.push(EffectBus.on('features:viewer-close', () => {
      if (this.visible()) this.close()
    }))

    // The website gate blocked a foreign, unverified page — review it here.
    this.#cleanups.push(EffectBus.on<{ cell: string; segments: string[]; sig: string; kind: string; label: string }>(
      'feature:review:open',
      (p) => {
        if (!p?.sig) return
        void this.#fetchCode(p.sig).then(code => {
          this.reviewTarget.set({
            cell: p.cell ?? '',
            segments: Array.isArray(p.segments) ? p.segments : [],
            sig: p.sig,
            kind: p.kind ?? '',
            label: p.label ?? 'Feature',
            code,
          })
          if (!this.visible()) {
            this.visible.set(true)
            EffectBus.emit('features:viewer-state', { open: true })
          }
        })
      },
    ))

    // A bulk download finished for a tile.
    this.#cleanups.push(EffectBus.on<{ cell?: string; ok?: boolean; files?: number; failed?: number }>('features:download:done', (p) => {
      const cell = String(p?.cell ?? '')
      if (!cell) return
      const wasBusy = this.downloading().has(cell)
      this.downloading.update(set => {
        if (!set.has(cell)) return set
        const next = new Set(set)
        next.delete(cell)
        return next
      })
      if (!wasBusy) return   // last-value replay of an old done — not ours
      this.#recordResult({
        cell,
        ok: p?.ok === true,
        files: Number(p?.files ?? 0) || 0,
        failed: Number(p?.failed ?? 0) || 0,
      })
      if (this.downloading().size > 0) this.#armDownloadLeash()
      else this.#clearDownloadLeash()
    }))

    // One `adopt:progress` per sig the broker fills — the climbing count.
    this.#cleanups.push(EffectBus.on('adopt:progress', () => {
      if (this.downloading().size === 0) return
      this.downloadedCount.update(n => n + 1)
      this.#armDownloadLeash()
    }))

    // Row-level outcomes: the drone answers a row's action with the SAME
    // plain-words sentence the activity log gets.
    this.#cleanups.push(EffectBus.on<{ cell?: string; kind?: string; ok?: boolean; message?: string }>('features:outcome', (p) => {
      const group = this.group()
      if (!group || !p?.cell || p.cell !== group.cell) return
      const kind = String(p.kind ?? '')
      const feat = kind
        ? (group.applied.find(f => f.kind === kind) ?? group.available.find(f => f.kind === kind))
        : undefined
      if (!feat) {
        if (this.pending().size) this.pending.set(new Map())
        return
      }
      const key = this.rowKey(group, feat)
      this.pending.update(map => {
        if (!map.has(key)) return map
        const next = new Map(map)
        next.delete(key)
        return next
      })
      this.rowNotes.update(m => {
        if (p.ok === true && !m.has(key)) return m
        const next = new Map(m)
        if (p.ok === true) next.delete(key)
        else next.set(key, String(p.message ?? '').trim())
        return next
      })
    }))

    // The overall fetch-health condition.
    this.#cleanups.push(EffectBus.on<{ condition?: string; host?: string | null }>('content:health', (p) => {
      this.health.set(p?.condition ? { condition: String(p.condition), host: p.host ?? null } : null)
    }))

  }

  // ── download stall leash ──────────────────────────────────────────
  #downloadLeash: ReturnType<typeof setTimeout> | null = null

  #armDownloadLeash(): void {
    this.#clearDownloadLeash()
    this.#downloadLeash = setTimeout(() => {
      this.#downloadLeash = null
      const open = [...this.downloading()]
      if (!open.length) return
      this.downloading.set(new Set())
      for (const cell of open) this.#recordResult({ cell, ok: false, files: 0, failed: 0, stalled: true })
    }, DOWNLOAD_STALL_MS)
  }

  #clearDownloadLeash(): void {
    if (!this.#downloadLeash) return
    clearTimeout(this.#downloadLeash)
    this.#downloadLeash = null
  }

  /** Upsert one cell's download outcome. */
  #recordResult(r: { cell: string; ok: boolean; files: number; failed: number; stalled?: boolean }): void {
    this.downloadResults.update(list => [...list.filter(x => x.cell !== r.cell), r])
  }

  /** Read a feature resource's bytes as text for review (capped). */
  async #fetchCode(sig: string): Promise<string> {
    try {
      const store = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
        ?.get<{ getResource?: (s: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
      const blob = await store?.getResource?.(sig)
      if (!blob) return '(could not load feature code)'
      const text = await blob.text()
      return text.length > 200_000 ? text.slice(0, 200_000) + '\n… (truncated for review)' : text
    } catch {
      return '(could not load feature code)'
    }
  }

  /** Accept the reviewed feature (or BYPASS as an explicit override). */
  acceptReview(bypassed: boolean): void {
    const t = this.reviewTarget()
    if (!t) return
    this.codeOpen.set(false)
    markVerified({ sig: t.sig, cell: t.cell, kind: t.kind, label: t.label, bypassed })
    if (t.kind === 'website' && t.segments.length) markAllowedRoot(branchRootFor(t.segments))
    EffectBus.emit('feature:verified', { sig: t.sig })
    this.reviewTarget.set(null)
  }

  cancelReview(): void {
    this.codeOpen.set(false)
    this.reviewTarget.set(null)
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
    this.#clearDownloadLeash()
    this.#phoneQuery?.removeEventListener('change', this.#phoneHandler)
  }

  /** Re-target this window at the canvas selection. */
  readonly openSelectionFeatures = (): void => {
    EffectBus.emit('controls:action', { action: 'features' })
  }

  /** Phone-only door back to the hive in picking mode. */
  readonly selectTile = (): void => {
    if (!this.isPhone()) return
    const picker = window.ioc?.get?.(SELECT_MODE_KEY) as SelectModeLike | undefined
    if (!picker?.arm) return
    this.close()
    picker.arm()
  }

  close(): void {
    this.visible.set(false)
    EffectBus.emit('features:viewer-state', { open: false })
    this.group.set(null)
    this.selectedKeys.set(new Set())
    this.pending.set(new Map())
    this.rowNotes.set(new Map())
    this.query.set('')
    this.mode.set('tile')
    this.downloadResults.set([])
    // In-flight downloads keep running — only the panel-local status resets.
  }

  // ── legacy hidden-pool drain (read + restore only) ────────────────

  /** WHERE this row's records scope to — kept identical to the old writer so
   *  legacy records and row keys still resolve. */
  #segmentsFor(group: FeatureGroup, feat: RowLike): string[] {
    if (feat.hideAt === 'node') return [...group.segments]
    return feat.originSegments?.length ? [...feat.originSegments] : [...group.segments]
  }

  /** Stable per-row key (feature kind @ scope). */
  rowKey(group: FeatureGroup, feat: RowLike): string {
    return hiddenKey(feat.kind, this.#segmentsFor(group, feat))
  }

  isSelected(group: FeatureGroup, feat: RowLike): boolean {
    return this.selectedKeys().has(this.rowKey(group, feat))
  }

  /** Toggle a row in the multi-selection the bulk bar acts on. */
  selectRow(group: FeatureGroup, feat: RowLike): void {
    const k = this.rowKey(group, feat)
    this.selectedKeys.update(cur => {
      const next = new Set(cur)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  clearSelection(): void {
    this.selectedKeys.set(new Set())
  }

  /** Every currently-selected row of the active tile. */
  #selectedRows(): { group: FeatureGroup; feat: RowLike }[] {
    const group = this.group()
    if (!group) return []
    const picked = this.selectedKeys()
    const out: { group: FeatureGroup; feat: RowLike }[] = []
    for (const feat of group.applied) {
      if (picked.has(this.rowKey(group, feat))) out.push({ group, feat })
    }
    for (const feat of group.available) {
      if (picked.has(this.rowKey(group, feat))) out.push({ group, feat })
    }
    return out
  }

  /** The LEGACY hidden record currently suppressing this row (at this node,
   *  or an ancestor for scope features). Null = nothing suppressed. */
  #suppressingRecord(group: FeatureGroup, feat: RowLike): HiddenFeature | null {
    const byKey = (key: string): HiddenFeature | undefined =>
      this.hidden().find(r => hiddenKey(r.featKind, r.appliesTo) === key)
    const own = byKey(this.rowKey(group, feat))
    if (own) return own
    if (feat.hideAt !== 'node') return null
    for (let depth = group.segments.length - 1; depth >= 1; depth--) {
      const rec = byKey(hiddenKey(feat.kind, group.segments.slice(0, depth)))
      if (rec) return rec
    }
    return null
  }

  /** True when a legacy hidden record still suppresses this row here — it
   *  renders dim and clicking restores it (the one-tap drain). */
  isSuppressed(group: FeatureGroup, feat: RowLike): boolean {
    return this.#suppressingRecord(group, feat) != null
  }

  /** Restore a legacy-suppressed row: remove the record that silences it. */
  restoreLegacy(group: FeatureGroup, feat: FeatureRow): void {
    const rec = this.#suppressingRecord(group, feat)
    if (!rec) return
    // Optimistic: the row lights up now; a failed write puts it back.
    this.hidden.update(list => list.filter(r => r.recordSig !== rec.recordSig))
    void restoreFeature(rec.recordSig, {
      featKind: rec.featKind,
      view: rec.view || feat.view,
      segments: rec.appliesTo,
    }).then(ok => {
      if (ok) return
      this.hidden.update(list => [...list, rec])
      this.rowNotes.update(m => new Map(m).set(this.rowKey(group, feat), this.#t('features.note.noanswer', 'no answer — try again')))
    }).catch(() => undefined)
  }

  /** Case-insensitive substring across the row's searchable text. */
  #matchesQuery(
    group: FeatureGroup,
    feat: { label?: string; kind?: string; description?: string; slashCommand?: string; originSegments?: string[] },
  ): boolean {
    const q = this.query().trim().toLowerCase()
    if (!q) return true
    const segs = feat.originSegments?.length ? feat.originSegments : group.segments
    const lineage = segs.join('/')
    return [feat.label, feat.kind, feat.description, feat.slashCommand, lineage, group.cell]
      .some(v => typeof v === 'string' && v.toLowerCase().includes(q))
  }

  onQuery(value: string): void {
    this.query.set(String(value ?? ''))
  }

  /** The tile's rows — its decorations (direct + inherited), through the
   *  search filter. A DORMANT kind (light off in the store) is filtered
   *  totally: off means gone, and the store is where it comes back. */
  visibleApplied(group: FeatureGroup): FeatureRow[] {
    return group.applied.filter(f => !f.dormant && this.#matchesQuery(group, f))
  }

  /** The offerable rows: only behaviors whose global light is on. */
  visibleAvailable(group: FeatureGroup): AvailableRow[] {
    return group.available.filter(f => !f.globalOff && this.#matchesQuery(group, f))
  }

  /** THIS LAYER, one list: every behavior that could live here — lit when
   *  its record is deposited (directly, or flowing from an ancestor), dim
   *  when not here yet. Same rows, same bulb as the pool. */
  layerRows(group: FeatureGroup): LayerRow[] {
    const rows: LayerRow[] = []
    for (const f of this.visibleApplied(group)) {
      rows.push({
        kind: f.kind, view: f.view, icon: f.icon, label: f.label,
        description: f.description, slashCommand: f.slashCommand,
        on: this.#painted(group, f, this.isOn(group, f)), applied: true,
        inherited: f.origin === 'cascade',
        openable: f.openable === true && this.isOn(group, f),
        // Deliberately NOT ANDed with on-ness the way `openable` is: a view
        // merely offered here is still a view, and the background is how the
        // list says so.
        isView: f.openable === true,
        manageScopes: f.manageScopes === true,
        sourceScope: f.sourceScope, queenKey: f.queenKey,
        originCell: f.originCell, foreign: f.foreign, module: f.module,
        bound: f.bound, feat: f,
      })
    }
    for (const f of this.visibleAvailable(group)) {
      rows.push({
        kind: f.kind, view: f.view, icon: f.icon, label: f.label,
        description: f.description, slashCommand: f.slashCommand,
        on: this.#painted(group, f, false), applied: false, inherited: false, openable: false,
        isView: f.isView === true, manageScopes: false,
        bound: f.bound, feat: f,
      })
    }
    // Beehaviours INCLUDE views, so that position filters NOTHING — only the
    // narrow one has anything to drop.
    return this.lens() === 'views' ? rows.filter(r => r.isView) : rows
  }

  /** THE DEFAULT - clicking a VIEW row's own icon.
   *
   *  "When you come to this layer, open as this." Mutually exclusive by
   *  construction: the record is REPLACED, never appended, so choosing a
   *  second view is the same gesture as choosing the first, and clicking the
   *  lit one clears it.
   *
   *  Only a view can be a default (a behaviour that is not a surface has
   *  nothing to open as), and only a row that is ON here (a default has to be
   *  something this layer can actually mount). An inherited row is managed
   *  where it flows from, defaults included. */
  setDefaultView(group: FeatureGroup, row: LayerRow, event?: Event): void {
    event?.stopPropagation()
    if (!this.canDefault(row)) return
    const clear = this.defaultView() === row.view
    this.defaultView.set(clear ? '' : row.view)
    EffectBus.emit('features:default', {
      cell: group.cell,
      segments: [...group.segments],
      view: row.view,
      clear,
    })
  }

  readonly isDefaultView = (row: LayerRow): boolean =>
    row.isView && !!row.view && this.defaultView() === row.view

  /** Can this row's icon be pressed to make it the layer's default? */
  readonly canDefault = (row: LayerRow): boolean =>
    row.isView && !!row.view && row.on && !row.inherited

  /** Open (or put away) the row's manage strip. */
  toggleManage(row: LayerRow, event?: Event): void {
    event?.stopPropagation()
    if (!row.manageScopes) return
    this.managing.set(this.managing() === row.kind ? '' : row.kind)
  }

  readonly isManaging = (row: LayerRow): boolean =>
    row.manageScopes && this.managing() === row.kind

  /** THE ONE THING A ROW MANAGES - where the behaviour reads from: this
   *  layer's own children, or the whole hierarchy beneath it. The bee owns
   *  the write; the panel only asks, the way it asks for everything else it
   *  cannot write itself. */
  async setSourceScope(group: FeatureGroup, row: LayerRow, scope: 'layer' | 'hierarchy'): Promise<void> {
    if (!row.manageScopes || !row.queenKey || row.sourceScope === scope) return
    const queen = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<{ invoke?: (args: string) => Promise<void> | void }>(row.queenKey)
    if (!queen?.invoke) return
    // Onto the SOURCE row, not the LayerRow: layerRows() rebuilds its objects
    // on every change-detection pass, so a choice written on the row itself is
    // gone by the next tick. The re-open below confirms it for real.
    ;(row.feat as FeatureRow).sourceScope = scope
    row.sourceScope = scope
    await queen.invoke('scope ' + scope)
    this.#openAt(group.segments, group.cell)
  }

  /** ENTER a lit view behaviour — the hover-only Open. Navigates to the
   *  row's scope root (a cascade row's surface lives there, not here) and
   *  flips the render surface to its view; in-place views mount over the
   *  current layer instead. */
  openBehavior(group: FeatureGroup, row: LayerRow): void {
    if (!row.openable || !row.view) return
    const feat = row.feat as FeatureRow
    if (feat.opensInPlace) {
      EffectBus.emit('view:open-for-tile', { view: row.view, segments: [...group.segments] })
      this.close()
      return
    }
    const nav = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<{ go?: (s: readonly string[]) => void }>('@hypercomb.social/Navigation')
    nav?.go?.([...(feat.scopeSegments?.length ? feat.scopeSegments : group.segments)])
    EffectBus.emit('view:toggle', { view: row.view, mode: 'on' })
    this.close()
  }

  /** The one gesture: click flips the row's light for this layer.
   *  Off → on is a DEPOSIT; on → off removes the record here. A website at
   *  its own root keeps its one meaning (membership of the /websites menu);
   *  a legacy-suppressed row restores; an inherited row flips at its origin,
   *  so here it only explains itself. Ctrl/Shift still selects for the
   *  bulk download bar. */
  toggleRow(group: FeatureGroup, row: LayerRow, event?: MouseEvent): void {
    if (event && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      this.selectRow(group, row.feat)
      return
    }
    if (this.isPending(group, row.feat)) return
    if (this.#isRepeatPress(this.rowKey(group, row.feat))) return
    if (!row.applied) {
      this.enableHere(group, row.feat as AvailableRow)
      return
    }
    const feat = row.feat as FeatureRow
    if (this.isSuppressed(group, feat)) { this.restoreLegacy(group, feat); return }
    // A WEBSITE BELONGS TO ITS ROOT TILE (Jaime, 2026-08-20): the row shows
    // anywhere within the site's branch, and its control acts at THAT
    // parent — the tile the website belongs to — from wherever you stand.
    // Never "apply it here": a site applied where you happen to be standing
    // is a site divorced from its tile. The one exception stays local: a
    // child that CARRIES its own page (a direct decoration) turns that page
    // off in place via removeHere below — the site itself is still managed
    // at its root.
    if (feat.view === 'website' && (this.#isScopeRoot(group, feat) || feat.origin === 'cascade')) {
      void this.toggleWebsite(group, feat)
      return
    }
    if (feat.origin === 'cascade') return
    this.removeHere(group, feat)
  }

  /** Is this row live here? Suppression is the legacy drain; a WEBSITE row is
   *  additionally on only when its SITE — keyed by the scope root, wherever
   *  in the branch you stand — is a MEMBER of the websites menu (membership
   *  IS what mints the /websites link). */
  isOn(group: FeatureGroup, feat: FeatureRow): boolean {
    if (this.isSuppressed(group, feat)) return false
    if (feat.view === 'website' && (this.#isScopeRoot(group, feat) || feat.origin === 'cascade')) {
      return this.websiteMembers().has(this.#websiteRootSegments(group, feat).join('/'))
    }
    return true
  }

  /** The tile a website row's control acts on: its scope ROOT — the parent
   *  the site belongs to — falling back to the row's own tile when the row
   *  IS the root (or a fresh site is being declared here). */
  #websiteRootSegments(group: FeatureGroup, feat: FeatureRow): string[] {
    return [...(feat.scopeSegments?.length ? feat.scopeSegments : group.segments)]
  }

  /** Is this node the row's scope ROOT (the site's declaring tile)? */
  #isScopeRoot(group: FeatureGroup, feat: FeatureRow): boolean {
    if (!feat.scopeSegments?.length) return true
    return feat.scopeSegments.join('/') === group.segments.join('/')
  }

  /** True when the row is a website at ITS OWN root — the one row whose
   *  action is a membership toggle rather than remove. */
  isWebsiteRoot(group: FeatureGroup, feat: FeatureRow): boolean {
    return feat.view === 'website' && this.#isScopeRoot(group, feat)
  }

  /** Can this row be REMOVED here — a decoration this tile itself carries?
   *  Inherited rows are managed at their origin; the website root's toggle is
   *  its own control; a suppressed row restores instead. */
  canRemove(group: FeatureGroup, feat: FeatureRow): boolean {
    return feat.origin !== 'cascade'
      && !this.isWebsiteRoot(group, feat)
      && !this.isSuppressed(group, feat)
  }

  /** The website's ONE toggle: membership of the websites menu — positive
   *  membership, consistent with the model (the /websites link exists
   *  exactly while the site is a member). Acts at the site's ROOT — the
   *  tile the website belongs to — from anywhere within the branch.
   *  Optimistic both ways. */
  async toggleWebsite(group: FeatureGroup, feat: FeatureRow): Promise<void> {
    const segments = this.#websiteRootSegments(group, feat)
    const memberKey = segments.join('/')
    const wasMember = this.websiteMembers().has(memberKey)
    if (wasMember) {
      this.websiteMembers.update(s => { const next = new Set(s); next.delete(memberKey); return next })
      void disableAggregation('websites', segments).catch(() => false)
      return
    }
    this.websiteMembers.update(s => new Set(s).add(memberKey))
    void enableAggregation('websites', segments, {
      label: segments[segments.length - 1] ?? group.cell,
    }).then(marker => {
      if (marker) return
      this.websiteMembers.update(s => { const next = new Set(s); next.delete(memberKey); return next })
      this.rowNotes.update(m => new Map(m).set(this.rowKey(group, feat), this.#t('features.note.noanswer', 'no answer — try again')))
    }).catch(() => undefined)
  }

  /** REMOVE this tile's decoration for the row — membership is positive, so
   *  removal is the whole off. The drone answers with `features:outcome` and
   *  re-opens the group. */
  removeHere(group: FeatureGroup, feat: FeatureRow): void {
    if (!this.canRemove(group, feat)) return
    const key = this.rowKey(group, feat)
    if (this.pending().has(key)) return
    this.pending.update(map => new Map(map).set(key, false))
    this.#clearNote(key)
    EffectBus.emit('features:remove', {
      cell: group.cell,
      segments: [...group.segments],
      kind: feat.kind,
    })
    this.#armRowLeash(key)
  }

  /** Resolve an i18n key at runtime (shell-side — the provider lives in ioc). */
  #t(key: string, fallback: string): string {
    const i18n = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<{ t: (k: string) => string }>('@hypercomb.social/I18n')
    const v = i18n?.t?.(key)
    return typeof v === 'string' && v && v !== key ? v : fallback
  }

  async #refreshHidden(): Promise<void> {
    this.hidden.set(await loadHidden())
  }

  /** Current websites-menu membership (path keys). */
  readonly websiteMembers = signal<ReadonlySet<string>>(new Set())

  async #refreshMembers(): Promise<void> {
    const list = await listAggregation('websites').catch(() => [])
    this.websiteMembers.set(new Set(list.map(m => m.segments.join('/'))))
  }

  /** Bulk download — mirror every selected feature's bytes onto this machine. */
  downloadSelected(): void {
    const cells = new Set<string>()
    for (const { group, feat } of this.#selectedRows()) {
      if (!feat.branchSig && !feat.gateSig) continue
      cells.add(group.cell)
      EffectBus.emit('features:download', {
        cell: group.cell,
        segments: [...group.segments],
        ...(feat.branchSig ? { branchSig: feat.branchSig } : {}),
        ...(feat.gateSig ? { gateSig: feat.gateSig } : {}),
      })
    }
    if (!cells.size) return
    if (this.downloading().size === 0) this.downloadedCount.set(0)
    this.downloadResults.update(list => list.filter(r => !cells.has(r.cell)))
    this.downloading.update(set => new Set([...set, ...cells]))
    this.#armDownloadLeash()
  }

  isDownloading(): boolean {
    return this.downloading().size > 0
  }

  isPending(group: FeatureGroup, feat: RowLike): boolean {
    return this.pending().has(this.rowKey(group, feat))
  }

  /** THE PRESS ANSWERS ITSELF. A layer row's truth comes back from the drone,
   *  and until it does the row paints WHAT THE PRESS ASKED FOR. `pending`
   *  carries that wish for exactly the right window — set on the press,
   *  dropped when the fresh group lands — so a slow answer can never look
   *  like a press that did nothing. The pool never needed this: its switch is
   *  a localStorage write, so it was always instant, and the two scopes now
   *  behave the same way for the same reason.
   *
   *  ONLY THE PAINT IS OPTIMISTIC. Every handler still branches on the truth
   *  (`applied`, `origin`, suppression) — which is why a second press has to
   *  be refused while the first is in flight. */
  #painted(group: FeatureGroup, feat: RowLike, truth: boolean): boolean {
    const wish = this.pending().get(this.rowKey(group, feat))
    return wish === undefined ? truth : wish
  }

  /** The row's plain-words outcome note ('' = none). Failures only. */
  rowNote(group: FeatureGroup, feat: RowLike): string {
    return this.rowNotes().get(this.rowKey(group, feat)) ?? ''
  }

  /** The WHY line under a failure note while fetching is degraded. */
  healthWhy(): string {
    const h = this.health()
    if (!h || h.condition === 'healthy') return ''
    const i18n = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<{ t: (k: string, p?: Record<string, unknown>) => string }>('@hypercomb.social/I18n')
    return i18n?.t(`health.${h.condition}`, { host: h.host ?? '' }) ?? ''
  }

  /** Drop one row's note (a retry starts clean). */
  #clearNote(key: string): void {
    this.rowNotes.update(m => {
      if (!m.has(key)) return m
      const next = new Map(m)
      next.delete(key)
      return next
    })
  }

  /** ONE PRESS PER SETTLED STATE. A switch that answers in 136ms on an empty
   *  hive answers slower on a full one, and a participant who does not see it
   *  move presses again — landing a SECOND flip that puts the row back where
   *  it started. That reads as "I had to click it twice", and with a third
   *  press to fix it, as a three-stage control. A repeat press on the SAME row
   *  inside this window is that doubt, not a change of mind, so it is dropped.
   *  Long enough to cover a double-click and an impatient re-press, far short
   *  of anyone deciding they wanted it the other way after all. */
  #isRepeatPress(key: string): boolean {
    const now = Date.now()
    const last = this.#lastPress.get(key) ?? 0
    // Stamped even when the press is dropped: a held-down repeat stays one
    // gesture instead of leaking a flip every other press.
    this.#lastPress.set(key, now)
    return now - last < PRESS_REPEAT_MS
  }

  readonly #lastPress = new Map<string, number>()

  /** Backstop leash for a row action: the drone answers every add/remove
   *  with `features:outcome` — this fires only when the producer died. */
  #armRowLeash(key: string): void {
    setTimeout(() => {
      if (!this.pending().has(key)) return
      this.pending.update(map => {
        const next = new Map(map)
        next.delete(key)
        return next
      })
      this.rowNotes.update(m => new Map(m).set(key, this.#t('features.note.noanswer', 'no answer — try again')))
    }, 4000)
  }

  /** Turn a behavior ON for this layer — the drone deposits its record at
   *  these explicit segments (never the current selection or location), and
   *  the record waits on what's beneath. */
  enableHere(group: FeatureGroup, feat: AvailableRow): void {
    const key = this.rowKey(group, feat)
    if (this.pending().has(key)) return
    this.pending.update(map => new Map(map).set(key, true))
    this.#clearNote(key)
    EffectBus.emit('features:enable', {
      cell: group.cell,
      segments: [...group.segments],
      kind: feat.kind,
      view: feat.view,
    })
    this.#armRowLeash(key)
  }

  /** One level back per press: a review, a manage strip, the search, then the
   *  lens back to its resting position (the pool first, then the narrowing
   *  to views — back to the beehaviours, which are all of them).
   *  False = nothing of ours was open, and the shell cascade carries on.
   *  Reached from the session; there is no listener here. */
  dismiss(): boolean {
    if (this.reviewTarget()) { this.cancelReview(); return true }
    if (this.managing()) { this.managing.set(''); return true }
    if (this.query()) { this.query.set(''); return true }
    if (this.mode() === 'store') { this.closeStore(); return true }
    if (this.lens() !== 'behaviors') { this.lens.set('behaviors'); return true }
    return false
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-features-viewer',
  owner: '@hypercomb.shared/FeaturesViewerComponent',
  component: FeaturesViewerComponent,
  order: 120,
})
