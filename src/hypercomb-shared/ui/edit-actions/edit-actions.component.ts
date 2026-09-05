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
// grows the selection verbs — cut · copy · remove — to the left of undo.
// They emit the same `controls:action` bus the controls-bar pills and the
// retired floating selection menu used, so the essentials drones that
// answer (ClipboardWorker, RemoveQueenBee) are unchanged. Hidden while
// rewound: scrub-back is view-only — cut/remove commits are refused there,
// and the cluster should read as the merge decision alone.
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

import { Component, ElementRef, inject, type AfterViewInit, type OnDestroy, type OnInit, signal } from '@angular/core'
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
  // selected tiles — gates the cut/copy/remove verbs.
  readonly selectionCount = signal(0)
  // Current hive orientation, used to describe the rotate button's destination.
  // The actual toggle remains owned by runtime-initializer.
  readonly flatTop = signal(false)

  /**
   * A full-viewport view (website, slides, tree, tutor, photo …) owns the
   * screen. The document actions edit the HIVE, not the view, so the whole
   * cluster steps aside while one is up — same `view:active` contract the
   * controls-bar uses. Without this the bottom-right cluster paints over the
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
  #orientationUnsub: (() => void) | null = null
  #viewActiveUnsub: (() => void) | null = null

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
      this.selectionCount.set(s?.selected?.length ?? 0)
    })

    this.flatTop.set(localStorage.getItem('hc:hex-orientation') === 'flat-top')
    this.#orientationUnsub = EffectBus.on<{ flat?: boolean }>('render:set-orientation', ({ flat }) => {
      this.flatTop.set(!!flat)
    })

    this.#viewActiveUnsub = EffectBus.on<{ active: boolean }>('view:active', ({ active }) => {
      this.viewActive.set(!!active)
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
    this.#orientationUnsub?.()
    this.#viewActiveUnsub?.()
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
  // Same `controls:action` bus as the controls-bar pills — ClipboardWorker
  // answers cut/copy (capturing the selection), RemoveQueenBee answers
  // remove (with its own nested-children confirm).

  readonly cut = (): void => {
    EffectBus.emit('controls:action', { action: 'cut' })
  }

  readonly copy = (): void => {
    EffectBus.emit('controls:action', { action: 'copy' })
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
