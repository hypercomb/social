// hypercomb-shared/ui/features-viewer/features-viewer.component.ts
//
// Right-docked "Beehaviors" panel — TWO surfaces, one state model (see
// src/documentation/behaviors-view-simplification.md):
//
//   • THE STORE — no tile subject. Every behavior the app knows, one row
//     each. The row reads dim (off) / lit (on) / lit + badge (in use —
//     decorations referencing it exist). Clicking the row flips the ONE
//     global switch: off = dormant everywhere AND withheld from every swarm.
//     No verbs, no tabs, no gate chips — the light is the whole story.
//
//   • ON THIS TILE — opened from a tile's puzzle-piece icon (or the ADOPT
//     fold). The rows ARE the tile's decorations; membership is positive.
//     Remove = remove the decoration. Inherited behaviors get one quiet
//     "from {cell}" line, never a tab ladder. The Apply picker below offers
//     only behaviors whose light is on. While open the panel FOLLOWS
//     NAVIGATION — behaviors are managed where they apply.
//
// Three facts, never conflated: adopted (you have it) · lit (the global
// switch) · in use (derived — counted decorations, never stored). What is
// gone from the old panel: the reach ladder, the hidden/carve-out pool UI,
// scope attribution, master-switch resets, per-row gate chips. Legacy
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
  /** True when the behaviour rides a decoration the painter can copy. */
  paintable?: boolean
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
  /** True when this kind's light is off, or it belongs to another tile — the
   *  row is not offered at all. */
  globalOff?: boolean
  /** Set when this behaviour belongs to this tile: it is offered HERE because
   *  this is the one place it means anything. */
  bound?: BehaviorBinding
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
}

/** Shell-safe slice of the essentials picker, resolved through IoC. */
type SelectModeLike = { arm(): void }
const SELECT_MODE_KEY = '@diamondcoreprocessor.com/SelectModeDrone'

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
  //   • the top rail's switch — no tile in hand, so the subject is the
  //     CONTEXT: the layer that is loaded. Walk deeper and the subject walks
  //     with you; every arrival lands on self again.
  //   • a tile's puzzle-piece — that TILE becomes the subject, a child of
  //     self, and it stays there. Standing on the parent does not drag the
  //     panel back up; you asked about the tile.
  //
  // The crumb above the rows says which of the two you are looking at, and
  // its self step is the way back — no navigation required.

  /** Where the participant is STANDING — the loaded layer's path. Kept fresh
   *  even while the panel is closed, so the crumb is right the moment it
   *  opens. Empty = the hive root. */
  readonly contextPath = signal<readonly string[]>([])

  /** The loaded layer's display name — its last segment, the hive at `/`. */
  readonly selfName = computed(() => {
    const segs = this.contextPath()
    return segs.length ? segs[segs.length - 1] : this.#t('features.context.hive', 'the hive')
  })

  /** True while the subject IS the loaded layer rather than a tile on it. */
  readonly subjectIsSelf = computed(() => {
    const g = this.group()
    if (!g) return true
    const here = this.contextPath()
    // Step by step: a tile name may hold any character, so no joined-string
    // key is safe as an identity test here.
    return g.segments.length === here.length && here.every((s, i) => g.segments[i] === s)
  })

  /** Ellipsis crumb between self and the subject — raised when the subject is
   *  more than one hop down, or off this branch entirely (the adopt fold can
   *  point the panel anywhere). '' = the subject is a direct child. */
  readonly subjectGap = computed(() => {
    const g = this.group()
    if (!g || this.subjectIsSelf()) return ''
    const here = this.contextPath()
    const beneath = g.segments.length > here.length
      && here.every((s, i) => g.segments[i] === s)
    if (!beneath) return '…'
    return g.segments.length - here.length > 1 ? '…' : ''
  })

  /** Put the subject back on the LOADED LAYER — the crumb's self step. Same
   *  pipeline navigation uses, so the arrival is indistinguishable. */
  readonly goSelf = (): void => {
    if (this.subjectIsSelf()) return
    this.#openAt(this.contextPath())
  }

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

  // ── the three modes ──────────────────────────────────────────────
  //
  // TILE (default) — the decorations this tile carries + the Apply picker.
  // PAINT — rows narrow to what's ON here; each row is a PICK for the brush.
  // STORE — no tile subject: every behavior, one light each.

  readonly mode = signal<'tile' | 'paint' | 'store'>('tile')

  /** The store rows, as last delivered by `features:roster`. */
  readonly storeRows = signal<StoreRow[]>([])

  readonly isStore = computed(() => this.mode() === 'store')

  /** Store rows surviving the header query, grouped by category. */
  readonly storeGroups = computed<{ category: string; rows: StoreRow[] }[]>(() => {
    const q = this.query().trim().toLowerCase()
    const rows = this.storeRows().filter(r => !q
      || r.label.toLowerCase().includes(q)
      || r.kind.toLowerCase().includes(q)
      || r.description.toLowerCase().includes(q)
      || (r.slashCommand ?? '').toLowerCase().includes(q))
    const byCat = new Map<string, StoreRow[]>()
    for (const r of rows) {
      const list = byCat.get(r.category) ?? []
      list.push(r)
      byCat.set(r.category, list)
    }
    return [...byCat.entries()].map(([category, list]) => ({ category, rows: list }))
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

  /** The short form of a binding's location signature — enough to recognise
   *  it, and to check it against a tile without reading 64 characters. */
  readonly boundSigShort = (binding: BehaviorBinding | undefined): string =>
    (binding?.sig ?? '').slice(0, 8)

  /** Flip one light. Optimistic row update — the writer emits
   *  `behavior:enablement-changed`, so every other surface reacts at once.
   *  Turning a light ON is also the participant's OK: no separate gate chip
   *  ever asks again from a list row (the review surface handles real code
   *  review when the render gate demands it). */
  readonly storeToggle = (row: StoreRow): void => {
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

  /** The behaviour kinds loaded in the brush (paint mode). */
  readonly brush = signal<ReadonlySet<string>>(new Set())

  /** Names of the tiles currently selected on the canvas — paint targets. */
  readonly canvasSelection = signal<readonly string[]>([])

  /** Plain-words outcome of the last paint ('' = none). */
  readonly paintNote = signal('')

  /** Multi-selected rows (Ctrl/Shift-click) — what the bulk bar acts on. */
  readonly selectedKeys = signal<ReadonlySet<string>>(new Set())

  /** Rows whose add/remove is in flight — guards double-clicks. */
  readonly pending = signal<ReadonlySet<string>>(new Set())

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

  /** Selected APPLIED rows that are enterable views AND on. */
  readonly openableSelectedCount = computed(() => {
    const group = this.group()
    if (!group) return 0
    const picked = this.selectedKeys()
    let n = 0
    for (const feat of group.applied) {
      if (feat.openable && picked.has(this.rowKey(group, feat)) && this.isOn(group, feat)) n++
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
      this.canvasSelection.set(selected.map(String).filter(Boolean))
    }))

    // The painter's answer — how many behaviours landed on how many tiles.
    this.#cleanups.push(EffectBus.on<{ painted?: number; tiles?: number; skipped?: string[] }>(
      'features:paint-result',
      (p) => {
        const painted = Number(p?.painted ?? 0) || 0
        const tiles = Number(p?.tiles ?? 0) || 0
        if (painted > 0) {
          this.paintNote.set(this.#tp('features.paint.done', { count: painted, tiles }, `${painted} on ${tiles} tiles`))
          this.brush.set(new Set())
        } else {
          this.paintNote.set(this.#t('features.paint.nothing', 'nothing to paint — no record to copy'))
        }
      },
    ))
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
      // One tile at a time: re-clicking the SAME tile refreshes in place;
      // a DIFFERENT tile replaces the subject.
      const prev = this.group()
      if (prev?.cell !== group.cell) {
        this.selectedKeys.set(new Set())
        this.rowNotes.set(new Map())
        this.query.set('')
        this.brush.set(new Set())
        this.paintNote.set('')
      }
      this.group.set(group)
      if (!this.visible()) {
        this.visible.set(true)
        EffectBus.emit('features:viewer-state', { open: true })
      }
      // A fresh group replaces its rows — any in-flight action is settled.
      if (this.pending().size) this.pending.set(new Set())
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
      this.brush.set(new Set())
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
      const segs = this.#currentSegments()
      this.contextPath.set(segs)
      this.#openAt(segs)
    }))

    // ── the panel FOLLOWS NAVIGATION ──────────────────────────────────
    //
    // Arriving on a layer makes it the subject — SELF — even when a tile's
    // puzzle-piece had pinned a child before the walk. The context is tracked
    // whether the panel is open or shut, so the crumb is already right the
    // moment it opens.
    const lineage = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<EventTarget & { explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    this.contextPath.set(this.#currentSegments())
    if (lineage?.addEventListener) {
      this.#lastNavKey = (lineage.explorerSegments?.() ?? []).join('\u0000')
      const onNav = (): void => {
        const segs = this.#currentSegments()
        const key = segs.join('\u0000')
        if (key === this.#lastNavKey) return
        this.#lastNavKey = key
        this.contextPath.set(segs)
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
        if (this.pending().size) this.pending.set(new Set())
        return
      }
      const key = this.rowKey(group, feat)
      this.pending.update(set => {
        if (!set.has(key)) return set
        const next = new Set(set)
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
    this.pending.set(new Set())
    this.rowNotes.set(new Map())
    this.query.set('')
    this.mode.set('tile')
    this.brush.set(new Set())
    this.paintNote.set('')
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

  /** The Apply picker rows: only behaviors whose light is on. */
  visibleAvailable(group: FeatureGroup): AvailableRow[] {
    return group.available.filter(f => !f.globalOff && this.#matchesQuery(group, f))
  }

  /** Is this row live here? Suppression is the legacy drain; a WEBSITE at
   *  its scope root is additionally on only when the site is a MEMBER of the
   *  websites menu (membership IS what mints the /websites link). */
  isOn(group: FeatureGroup, feat: FeatureRow): boolean {
    if (this.isSuppressed(group, feat)) return false
    if (feat.view === 'website' && this.#isScopeRoot(group, feat)) {
      return this.websiteMembers().has(group.segments.join('/'))
    }
    return true
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

  /** Can this row be ENTERED as a view? */
  isOpenable(group: FeatureGroup, feat: FeatureRow): boolean {
    return feat.openable === true && this.isOn(group, feat)
  }

  // ── paint mode ────────────────────────────────────────────────────

  toggleMode(): void {
    if (this.mode() === 'paint') {
      this.mode.set('tile')
      this.brush.set(new Set())
      this.paintNote.set('')
      return
    }
    this.mode.set('paint')
    this.selectedKeys.set(new Set())   // row selection is a tile-mode idea
  }

  isPainting(): boolean {
    return this.mode() === 'paint'
  }

  /** The rows paint mode shows: behaviours ON at this tile. */
  paintable(group: FeatureGroup): FeatureRow[] {
    return this.visibleApplied(group).filter(f => this.isOn(group, f))
  }

  /** Only decoration-backed behaviours can ride the brush. */
  canPaint(feat: FeatureRow): boolean {
    return feat.paintable === true
  }

  isPicked(feat: FeatureRow): boolean {
    return this.brush().has(feat.kind)
  }

  /** Pick / unpick a behaviour into the brush. */
  pick(feat: FeatureRow): void {
    if (!this.canPaint(feat)) return
    this.paintNote.set('')
    this.brush.update(cur => {
      const next = new Set(cur)
      if (next.has(feat.kind)) next.delete(feat.kind)
      else next.add(feat.kind)
      return next
    })
  }

  readonly brushCount = computed(() => this.brush().size)

  readonly canApplyBrush = computed(() =>
    this.brush().size > 0 && this.canvasSelection().length > 0)

  /** Land the brush: every picked behaviour onto every selected tile. */
  applyBrush(): void {
    const group = this.group()
    if (!group || !this.canApplyBrush()) return
    this.paintNote.set('')
    EffectBus.emit('features:paint', {
      source: [...group.segments],
      kinds: [...this.brush()],
      targets: [...this.canvasSelection()],
    })
  }

  /** Row click. PAINT mode: pick into the brush. Ctrl/Shift: select for the
   *  bulk bar. A suppressed row: restore (the legacy drain). The website
   *  root: flip menu membership. Anything else: select — actions live on the
   *  row's own buttons, a plain click never destroys anything. */
  rowClick(group: FeatureGroup, feat: FeatureRow, event?: MouseEvent): void {
    if (this.mode() === 'paint') {
      this.pick(feat)
      return
    }
    if (event && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      this.selectRow(group, feat)
      return
    }
    if (this.isPending(group, feat)) return
    if (this.isSuppressed(group, feat)) { this.restoreLegacy(group, feat); return }
    if (this.isWebsiteRoot(group, feat)) { void this.toggleWebsite(group, feat); return }
    this.selectRow(group, feat)
  }

  /** An available row's click: ADD when mechanically addable; Ctrl/Shift
   *  selects; non-addable rows only select. */
  availableRowClick(group: FeatureGroup, feat: AvailableRow, event?: MouseEvent): void {
    if (event && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      this.selectRow(group, feat)
      return
    }
    if (feat.addable) this.enableAvailable(group, feat)
    else this.selectRow(group, feat)
  }

  /** The website root's ONE toggle: membership of the websites menu —
   *  positive membership, consistent with the model (the /websites link
   *  exists exactly while the site is a member). Optimistic both ways. */
  async toggleWebsite(group: FeatureGroup, feat: FeatureRow): Promise<void> {
    const segments = [...group.segments]
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
    this.pending.update(set => new Set([...set, key]))
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

  /** Same as `#t`, with interpolation params. */
  #tp(key: string, params: Record<string, unknown>, fallback: string): string {
    const i18n = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<{ t: (k: string, p?: Record<string, unknown>) => string }>('@hypercomb.social/I18n')
    const v = i18n?.t?.(key, params)
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

  /** OPEN this view behaviour — navigate in (or mount in place) and flip the
   *  render surface to its view. */
  openBehavior(group: FeatureGroup, feat: FeatureRow): void {
    if (!feat.openable || !feat.view) return
    if (feat.opensInPlace) {
      EffectBus.emit('view:open-for-tile', { view: feat.view, segments: [...group.segments] })
      this.close()
      return
    }
    const nav = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<{ go?: (s: readonly string[]) => void }>('@hypercomb.social/Navigation')
    // A CASCADE row is the scope's behaviour seen from a member cell — its
    // surface lives at the scope root (a website's home page), not here.
    // Navigating to the clicked cell mounted a page-less member and the view
    // came up empty; `scopeSegments` is the root the row was minted from.
    nav?.go?.([...(feat.scopeSegments?.length ? feat.scopeSegments : group.segments)])
    EffectBus.emit('view:toggle', { view: feat.view, mode: 'on' })
    this.close()
  }

  /** Bulk-bar Open — enter the first selected openable behaviour. */
  openSelected(): void {
    const group = this.group()
    if (!group) return
    const feat = group.applied.find(f =>
      f.openable && this.selectedKeys().has(this.rowKey(group, f)) && this.isOn(group, f))
    if (feat) this.openBehavior(group, feat)
  }

  isPending(group: FeatureGroup, feat: RowLike): boolean {
    return this.pending().has(this.rowKey(group, feat))
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

  /** Backstop leash for a row action: the drone answers every add/remove
   *  with `features:outcome` — this fires only when the producer died. */
  #armRowLeash(key: string): void {
    setTimeout(() => {
      if (!this.pending().has(key)) return
      this.pending.update(set => {
        const next = new Set(set)
        next.delete(key)
        return next
      })
      this.rowNotes.update(m => new Map(m).set(key, this.#t('features.note.noanswer', 'no answer — try again')))
    }, 4000)
  }

  /** ADD an available feature to the tile. Explicit segments — never the
   *  current selection or location — so the attach can't land wrong. */
  enableAvailable(group: FeatureGroup, feat: AvailableRow): void {
    if (!feat.addable) return
    const key = this.rowKey(group, feat)
    if (this.pending().has(key)) return
    this.pending.update(set => new Set([...set, key]))
    this.#clearNote(key)
    EffectBus.emit('features:enable', {
      cell: group.cell,
      segments: [...group.segments],
      kind: feat.kind,
      view: feat.view,
    })
    this.#armRowLeash(key)
  }

  /** One level back per press: a review, then paint, then the search, then the
   *  store. False = nothing of ours was open, and the shell cascade carries on.
   *  Reached from the session; there is no listener here. */
  dismiss(): boolean {
    if (this.reviewTarget()) { this.cancelReview(); return true }
    if (this.mode() === 'paint') { this.toggleMode(); return true }
    if (this.query()) { this.query.set(''); return true }
    if (this.mode() === 'store') { this.closeStore(); return true }
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
