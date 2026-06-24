// hypercomb-shared/ui/edit-actions/edit-actions.component.ts
//
// Fixed bottom-right cluster for history navigation + commit:
//
//   [ undo ] [ redo ]   save
//    icon     icon      word — redo and save appear ONLY once you've
//                       rewound (pressed undo at least once); before that
//                       there's nothing to redo and nothing to merge.
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

  #cursorUnsub: (() => void) | null = null

  ngOnInit(): void {
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
  }

  ngOnDestroy(): void {
    this.#cursorUnsub?.()
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
