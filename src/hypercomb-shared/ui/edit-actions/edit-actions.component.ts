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
// .promoteToHead — append-only, never truncates) and, where the DCP
// sentinel bridge exists, freezes that promoted head as a named branch so
// the chosen state is also saved into DCP. At head there is nothing to
// merge, so no Save.
//
// Shell UI: NEVER imports essentials — it reaches the runtime only through
// window.ioc (the local `get` helper) and EffectBus.

import { Component, type OnDestroy, type OnInit, signal } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { ensureViewportInsetVars } from '@hypercomb/core'

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
type PushQueueLike = { drain?: () => Promise<void>; pending?: () => Promise<string[]> }
type SentinelBridgeLike = { saveBranch?: (name: string) => Promise<string | null> }

@Component({
  selector: 'hc-edit-actions',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './edit-actions.component.html',
  styleUrls: ['./edit-actions.component.scss'],
})
export class EditActionsComponent implements OnInit, OnDestroy {

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

  // Share-feedback panel open/closed — lights the feedback button. The toggle
  // moved here from the command line's tools rail (Jaime, 2026-08-12): the
  // forum glyph belongs to feedback, and its home is the bottom-right corner
  // the old FAB owned — now a proper member of the document cluster, left of
  // the rotate icon.
  readonly feedbackOpen = signal(false)

  #cursorUnsub: (() => void) | null = null
  #selectionUnsub: (() => void) | null = null
  #orientationUnsub: (() => void) | null = null
  #viewActiveUnsub: (() => void) | null = null
  #feedbackUnsub: (() => void) | null = null

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

    this.#feedbackUnsub = EffectBus.on<{ open?: boolean }>('feedback:panel-state', ({ open }) => {
      this.feedbackOpen.set(!!open)
    })
  }

  ngOnDestroy(): void {
    this.#cursorUnsub?.()
    this.#selectionUnsub?.()
    this.#orientationUnsub?.()
    this.#viewActiveUnsub?.()
    this.#feedbackUnsub?.()
  }

  // Reuse the keyboard command path so persistence, rendering and layout
  // history stay identical whether the participant clicks here or presses J.
  readonly toggleOrientation = (): void => {
    EffectBus.emit('keymap:invoke', { cmd: 'render.toggleOrientation' })
  }

  /** Flip the feedback panel — FeedbackViewerComponent listens and
   *  broadcasts state back via `feedback:panel-state`. */
  readonly toggleFeedback = (): void => {
    EffectBus.emit('feedback:toggle', {})
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

      // Where DCP is reachable (web shell), also freeze the promoted head as
      // a named branch — "save those pushed changes". Drain the push queue
      // first so every leaf is received before the branch is stamped.
      // Bridge-absent (e.g. dev shell) → the local merge above still stands.
      const bridge = (globalThis as { __sentinelBridge?: SentinelBridgeLike }).__sentinelBridge
      if (bridge?.saveBranch) {
        const pq = get('@diamondcoreprocessor.com/PushQueueService') as PushQueueLike | undefined
        if (pq) {
          await pq.drain?.()
          await this.#waitForPushDrain(pq)
        }
        await bridge.saveBranch('')   // '' → DCP auto-names save-N
      }
    } finally {
      this.saving.set(false)
    }
  }

  /** Poll the push queue until nothing is pending (or the timeout fires).
   *  Bounded so a stalled/absent host can't hang Save. */
  readonly #waitForPushDrain = async (pq: PushQueueLike, timeoutMs = 8000): Promise<void> => {
    const start = Date.now()
    for (;;) {
      const pending = (await pq.pending?.()) ?? []
      if (pending.length === 0) return
      if (Date.now() - start > timeoutMs) return
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }
}
