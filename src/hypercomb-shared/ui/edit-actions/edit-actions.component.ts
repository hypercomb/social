// hypercomb-shared/ui/edit-actions/edit-actions.component.ts
//
// Fixed bottom-right cluster for history navigation + commit:
//
//   [ undo ] [ redo ]   save
//    icon     icon      word — redo and save appear ONLY once you've
//                       rewound (pressed undo at least once); before that
//                       there's nothing to redo and nothing to merge.
//
// While tiles are SELECTED (and the cursor is at head) the cluster also
// grows the selection verbs — to shelf · remove — to the left of undo. To
// shelf puts the selection on the shelf at the top (`shelf:take-selection`,
// answered by PortalCarryDrone): a reference, never a cut. Remove rides the
// same `controls:action` bus the retired floating selection menu used, so
// RemoveQueenBee answers it unchanged. Hidden while rewound: scrub-back is
// view-only, and the cluster should read as the merge decision alone.
//
// Undo/redo reuse the EXACT keyboard path: they emit the same
// `keymap:invoke` command the Ctrl+Z / Ctrl+Y bindings fire (the same call
// the history right-click menu makes), so the HistorySliderDrone handler —
// and its global-time-clock branch — runs unchanged. Enabled state comes
// from the cursor's `history:cursor-changed` broadcast.
//
// SAVE is the merge. It only shows once the cursor is rewound (you pressed
// undo at least once), because that is the only moment there's a choice to
// commit: you've gone back, and "save" is how you choose what to move
// forward with. It promotes the rewound state to head (HistoryService
// .promoteToHead — append-only, never truncates). At head there is nothing
// to merge, so no Save.
//
// SAVE IS LOCAL AND SENDS NOTHING. It also offers the promoted head to a
// sentinel bridge as a named branch, but nothing has assigned
// `__sentinelBridge` since the installer was deleted, so that half never
// runs. It used to drain a push queue on the way past; that channel is gone
// (`essentials/sharing/retired-push-pool.ts`).
//
// Shell UI: NEVER imports essentials — it reaches the runtime only through
// window.ioc (the local `get` helper) and EffectBus.

import { ChangeDetectionStrategy, Component, ElementRef, inject, type AfterViewInit, type OnDestroy, type OnInit, signal } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { ensureViewportInsetVars } from '../../core/viewport-inset-vars'

/** Runtime service locator — shared must never statically import essentials,
 *  so cross-service resolution goes through window.ioc at call time. */
const get = (key: string): any => (globalThis as { ioc?: { get(k: string): unknown } }).ioc?.get(key)

type CursorStateLike = { position?: number; total?: number; rewound?: boolean }
type CursorLike = {
  state?: { locationSig?: string }
  currentLayerSig?: string
  load?: (locationSig: string) => Promise<void>
  jumpToLatest?: () => void
}
type HistoryLike = { promoteToHead?: (locationSig: string, layerSig: string) => Promise<string | null> }
type SentinelBridgeLike = { saveBranch?: (name: string) => Promise<string | null> }

@Component({
  selector: 'hc-edit-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './edit-actions.component.html',
  styleUrls: ['./edit-actions.component.scss'],
})
export class EditActionsComponent implements AfterViewInit, OnInit, OnDestroy {

  // can-undo: cursor sits above pre-history (something to step back to).
  // can-redo: cursor is rewound (something to step forward to).
  // rewound: cursor is off head — the only state where Save makes sense.
  readonly canUndo = signal(false)
  readonly canRedo = signal(false)
  readonly rewound = signal(false)
  // saving: guards re-entry while the merge (promote + optional branch) runs.
  readonly saving = signal(false)
  // sync: this device is paired with another (the word shows only then), and a
  // walk is running (the word dims). Both come from the one `device-sync:state`
  // the service publishes — the button never asks the service anything.
  readonly syncPaired = signal(false)
  readonly syncing = signal(false)
  // selected tiles — gates the to-shelf and remove verbs.
  readonly selectionCount = signal(0)
  // selected tiles that are somebody else's (the renderer reported them
  // EXTERNAL) — gates the adopt verb. Selecting several shaded tiles and
  // pressing it is the multi-take; SwarmAdoptDrone queues every pick, so the
  // batch survives a reload.
  readonly adoptableCount = signal(0)
  #selected: string[] = []
  #external = new Set<string>()
  // Current hive orientation, used to describe the rotate button's destination.
  // The actual toggle remains owned by runtime-initializer.
  readonly flatTop = signal(false)

  /**
   * A full-viewport view (website, slides, tree, tutor, photo …) owns the
   * screen. The document actions edit the HIVE, not the view, so the whole
   * cluster steps aside unless the view reserves the shell's space through
   * `view:keeps-shell`. Without this the bottom-right cluster paints over the
   * website's own exit control and reads as the site's chrome.
   */
  readonly viewActive = signal(false)

  /** Can this browser photograph its own screen? `getDisplayMedia` is absent
   *  on every phone, so the door is not offered there — the sheet would take
   *  ink and then have nothing to do with it. Read once: a browser does not
   *  grow the capability mid-session. */
  readonly canAnnotate = signal(
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia)

  readonly #host = inject(ElementRef) as ElementRef<HTMLElement>

  /** Watches the cluster's live width — see ngAfterViewInit. */
  #widthWatch: ResizeObserver | null = null

  #cursorUnsub: (() => void) | null = null
  #selectionUnsub: (() => void) | null = null
  #cellCountUnsub: (() => void) | null = null
  #orientationUnsub: (() => void) | null = null
  #viewActiveUnsub: (() => void) | null = null
  #syncUnsub: (() => void) | null = null

  ngOnInit(): void {
    // Start the shared inset→CSS-var bridge. edit-actions is template-mounted in
    // both shells, so this runs at bootstrap and the vars track every docked
    // toolwindow from the first one opened. Idempotent — safe if youtube-viewer
    // (the other consumer) already started it.
    ensureViewportInsetVars()

    // Last-value replayed: a late mount immediately receives the current
    // cursor state, so the buttons reflect reality with no manual initial read.
    this.#cursorUnsub = EffectBus.on<CursorStateLike>('history:cursor-changed', (s) => {
      const position = s?.position ?? 0
      const total = s?.total ?? 0
      const rewound = !!s?.rewound || position < total
      this.canUndo.set(position > 0)
      this.canRedo.set(rewound)
      this.rewound.set(rewound)
    })

    // SelectionService broadcasts every mutation (clicks, URL brackets,
    // Escape-clear) — last-value replayed, so a late mount sees the live set.
    this.#selectionUnsub = EffectBus.on<{ selected?: string[] }>('selection:changed', (s) => {
      this.#selected = (s?.selected ?? []).map(l => String(l ?? '')).filter(Boolean)
      this.selectionCount.set(this.#selected.length)
      this.#refreshAdoptable()
    })

    // show-cell reports which painted tiles are not yours on every render
    // (last-value replayed). Adopt shows only for the selected ones among them.
    this.#cellCountUnsub = EffectBus.on<{ externalLabels?: string[] }>('render:cell-count', (p) => {
      this.#external = new Set((p?.externalLabels ?? []).map(l => String(l ?? '')).filter(Boolean))
      this.#refreshAdoptable()
    })

    this.flatTop.set(localStorage.getItem('hc:hex-orientation') === 'flat-top')
    this.#orientationUnsub = EffectBus.on<{ flat?: boolean }>('render:set-orientation', ({ flat }) => {
      this.flatTop.set(!!flat)
    })

    this.#viewActiveUnsub = EffectBus.on<{ active: boolean }>('view:shell-hidden', ({ active }) => {
      this.viewActive.set(!!active)
    })

    // Last-value replayed, so a late mount sees whether this device is paired.
    this.#syncUnsub = EffectBus.on<{ paired?: boolean; phase?: string }>('device-sync:state', (s) => {
      this.syncPaired.set(!!s?.paired)
      this.syncing.set(s?.phase === 'syncing')
    })
  }

  /**
   * HOW MUCH BOTTOM-RIGHT CORNER THIS CLUSTER ACTUALLY TAKES, published as
   * `--hc-actions-width`.
   *
   * The pheromone strip runs along the same bottom band from the other side
   * and has to stop before this cluster. It used to stop 12rem short — a
   * static guess made when the cluster held two buttons, and wrong in both
   * directions since: the cluster GROWS (selection verbs, save, annotate,
   * rotate) and it DISAPPEARS entirely under a full-viewport view. A guess
   * that is too generous leaves a visible gap between the tags and the
   * toolwindow beside them; one that is too tight puts tags under the icons.
   *
   * So it is measured. `display: none` reports 0, which is the right answer:
   * a cluster that is not on screen reserves nothing and the tags may run all
   * the way to whatever the panel left free.
   */
  ngAfterViewInit(): void {
    const cluster = this.#host.nativeElement.querySelector('.edit-actions') as HTMLElement | null
    if (!cluster || typeof ResizeObserver === 'undefined') return
    const publish = (): void => {
      const width = Math.round(cluster.getBoundingClientRect().width)
      document.documentElement.style.setProperty('--hc-actions-width', `${width}px`)
    }
    this.#widthWatch = new ResizeObserver(publish)
    this.#widthWatch.observe(cluster)
    publish()
  }

  ngOnDestroy(): void {
    this.#widthWatch?.disconnect()
    this.#widthWatch = null
    // Removed, not zeroed: a consumer's own fallback is a better answer than
    // "the cluster is 0 wide" once nobody is publishing.
    document.documentElement.style.removeProperty('--hc-actions-width')
    this.#cursorUnsub?.()
    this.#selectionUnsub?.()
    this.#cellCountUnsub?.()
    this.#orientationUnsub?.()
    this.#viewActiveUnsub?.()
    this.#syncUnsub?.()
  }

  // ── sync = walk the other devices' trees (only shown when paired) ─
  // The service answers on the bus, like every verb in this cluster; what it
  // moved is reported by its own toast. Pressing while a walk runs does nothing.

  readonly sync = (): void => {
    if (this.syncing()) return
    EffectBus.emit('device-sync:run', {})
  }

  // Reuse the keyboard command path so persistence, rendering and layout
  // history stay identical whether the participant clicks here or presses J.
  readonly toggleOrientation = (): void => {
    EffectBus.emit('keymap:invoke', { cmd: 'render.toggleOrientation' })
  }

  /** ANNOTATE THE SCREEN — the drawing sheet over the whole app. It reads the
   *  location it was opened at by itself, so this corner has nothing to name:
   *  one press, from wherever you are standing. */
  readonly annotate = (): void => {
    EffectBus.emit('markup:open', {})
  }

  // ── undo / redo ──────────────────────────────────────────
  // Emit the same command the Ctrl+Z / Ctrl+Y keybindings fire so the
  // existing handler (incl. global-time-clock stepping) runs unchanged.

  readonly undo = (): void => {
    if (!this.canUndo()) return
    EffectBus.emit('keymap:invoke', { cmd: 'history.undo' })
  }

  readonly redo = (): void => {
    if (!this.canRedo()) return
    EffectBus.emit('keymap:invoke', { cmd: 'history.redo' })
  }

  // ── selection verbs (shown only while tiles are selected) ─
  // To shelf: the selection onto the shelf, as references (PortalCarryDrone
  // answers). Remove: RemoveQueenBee answers, with its own nested-children
  // confirm.

  readonly toShelf = (): void => {
    EffectBus.emit('shelf:take-selection', {})
  }

  #adoptable = (): string[] => this.#selected.filter(l => this.#external.has(l))
  #refreshAdoptable = (): void => { this.adoptableCount.set(this.#adoptable().length) }

  // Adopt: the selected peer tiles, as page tiles, through SwarmAdoptDrone's
  // `adopt` verb — the same path the wand takes, every pick queued durably.
  readonly adopt = (): void => {
    const labels = this.#adoptable()
    if (labels.length === 0) return
    EffectBus.emit('tile:action', { action: 'adopt', labels })
  }

  readonly remove = (): void => {
    EffectBus.emit('controls:action', { action: 'remove' })
  }

  // ── save = merge (only meaningful while rewound) ─────────

  readonly save = async (): Promise<void> => {
    if (this.saving() || !this.rewound()) return
    const cursor = get('@diamondcoreprocessor.com/HistoryCursorService') as CursorLike | undefined
    const history = get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
    const locationSig = cursor?.state?.locationSig
    const layerSig = cursor?.currentLayerSig
    if (!history?.promoteToHead || !cursor || !locationSig || !layerSig) return

    this.saving.set(true)
    try {
      // THE MERGE: promote the rewound state to head — "choose what to move
      // forward with". History stays linear/append-only; this appends a new
      // head marker pointing at the chosen layer. The cursor then jumps to
      // head, `rewound` clears, and the Save word hides itself.
      await history.promoteToHead(locationSig, layerSig)
      await cursor.load?.(locationSig)
      cursor.jumpToLatest?.()
      // The page's cached cell list and slot state predate the promotion; drop
      // them AFTER the cursor is live so the render that follows reads the new head.
      EffectBus.emit('fs:changed', { segments: [] })

      // If a sentinel bridge is ever there, also freeze the promoted head as
      // a named branch. Nothing has assigned `__sentinelBridge` since the
      // installer was deleted, so today this is a no-op; the local merge
      // above is the whole act either way.
      //
      // This used to drain PushQueueService first, "so every leaf is received
      // before the branch is stamped". That queue was the installer's push
      // channel and is gone (`essentials/sharing/retired-push-pool.ts`); it
      // never received anything, because the same missing bridge that skips
      // the stamp also failed every push. Do not reach for another queue
      // here — getting bytes to a node is its own gesture, not a rider on
      // Save (write-conformance check 10).
      const bridge = (globalThis as { __sentinelBridge?: SentinelBridgeLike }).__sentinelBridge
      if (bridge?.saveBranch) await bridge.saveBranch('')   // '' → auto-named save-N
    } finally {
      this.saving.set(false)
    }
  }

}
