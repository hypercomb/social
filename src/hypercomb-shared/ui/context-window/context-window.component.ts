// hypercomb-shared/ui/context-window/context-window.component.ts
//
// THE CONTEXT WINDOW — what a tile's AI requests are allowed to know, and the
// place you manage it.
//
// A tile carries `context` decorations: signatures pointing at BRANCHES that
// have meaning for questions about it. They are written by dragging a portal
// onto the tile, which is a one-second gesture with a permanent consequence —
// so there has to be somewhere that shows what is attached and takes it back
// off. An attachment you cannot see is indistinguishable from one that never
// saved, and an attachment you cannot remove is a decision you made once and
// can never revisit.
//
// ── This window shows the RESOLUTION, not just the list ─────────────────────
//
// Listing the branch names would answer "what did I attach" and leave the
// question that actually matters unanswered: how much does the model see? A
// branch is a live pointer at a subtree's current head, so what it brings grows
// and shrinks on its own. Every row therefore reports the walk — how many tiles
// it reached, and whether a budget cut it short. A window that showed a tidy
// name while quietly feeding 240 tiles into every request would be the exact
// failure it exists to prevent.
//
// Resolution is DERIVED and recomputed on open (see assistant/tile-context.ts).
// Nothing here is cached onto the tile: caching would re-freeze precisely what
// the lineage address exists to keep live.
//
// Shell UI — resolves everything through `window.ioc` at call time and never
// imports essentials.

import { Component, computed, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'

/** One attached branch, as `TileContext.resolve` returns it. */
type ContextBranch = {
  segments: readonly string[]
  targetSig: string
  decorationSig: string
  label: string
  nodeCount: number
  signatures: readonly string[]
  truncated: boolean
  error?: string
}

type TileContextLike = {
  resolve(segments: readonly string[]): Promise<readonly ContextBranch[]>
  detach(segments: readonly string[], decorationSig: string): boolean
}
type LineageLike = { explorerSegments?: () => readonly string[] }
type NavigationLike = { goRaw?(segments: readonly string[]): void }

const ioc = (): { get(k: string): unknown } | undefined =>
  (globalThis as { ioc?: { get(k: string): unknown } }).ioc

const sameSegments = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

@Component({
  selector: 'hc-context-window',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './context-window.component.html',
  styleUrls: ['./context-window.component.scss'],
})
export class ContextWindowComponent implements OnDestroy {

  readonly visible = signal(false)

  /** Parked while the hive is covered, and brought back with the same tile —
   *  `close()` drops the resolved list, and a window that returned empty would
   *  read as "my context vanished". */
  readonly session = signalSession(
    this.visible,
    open => EffectBus.emit('context:window-state', { open }),
    { close: () => this.close() },
  )

  /** The tile being managed, absolute. Captured on open, NOT derived from
   *  wherever the hive has since wandered: this window's whole subject is one
   *  tile's attachments, and re-resolving `here + label` after a hop would
   *  quietly start managing a different tile that shares the name. */
  readonly segments = signal<readonly string[]>([])
  readonly label = computed(() => {
    const s = this.segments()
    return s.length ? s[s.length - 1] : 'hive'
  })

  readonly branches = signal<readonly ContextBranch[]>([])
  readonly loading = signal(false)

  readonly count = computed(() => this.branches().length)

  /** Total signatures across every branch, deduped — what a request would
   *  carry. The honest headline number, and the reason this window exists. */
  readonly signatureCount = computed(() => {
    const seen = new Set<string>()
    for (const b of this.branches()) for (const s of b.signatures) seen.add(s)
    return seen.size
  })

  readonly tileCount = computed(() =>
    this.branches().reduce((n, b) => n + b.nodeCount, 0))

  /** True when ANY branch hit a walk budget — the totals above are floors,
   *  not counts, and the footer has to say so. */
  readonly anyTruncated = computed(() => this.branches().some(b => b.truncated))

  readonly anyBroken = computed(() => this.branches().some(b => !!b.error))

  #cleanups: (() => void)[] = []

  constructor() {
    this.#cleanups.push(EffectBus.on<{ segments?: readonly string[]; cell?: string }>(
      'context:window-open', (p) => this.open(this.#resolveTarget(p))))

    this.#cleanups.push(EffectBus.on<{ segments?: readonly string[]; cell?: string }>(
      'context:window-toggle', (p) => {
        const target = this.#resolveTarget(p)
        if (this.visible() && sameSegments(target, this.segments())) { this.close(); return }
        this.open(target)
      }))

    this.#cleanups.push(EffectBus.on('context:window-close', () => {
      if (this.visible()) this.close()
    }))

    // Something else changed this tile's attachments (a drop landed while the
    // window was open). Re-resolve rather than patch: the walk is the truth and
    // it is cheap enough to redo.
    this.#cleanups.push(EffectBus.on<{ segments?: readonly string[] }>('context:tile-changed', (p) => {
      if (!this.visible()) return
      if (p?.segments && !sameSegments(p.segments, this.segments())) return
      void this.refresh()
    }))
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
  }

  /** Where the caller meant. An explicit path wins; a bare cell name is read
   *  against the page being stood on (how a tile action reports itself); with
   *  neither, the window manages the page itself. */
  #resolveTarget(p?: { segments?: readonly string[]; cell?: string }): readonly string[] {
    if (p?.segments?.length) return [...p.segments]
    const here = (ioc()?.get('@hypercomb.social/Lineage') as LineageLike | undefined)
      ?.explorerSegments?.() ?? []
    const clean = here.map(s => String(s ?? '').trim()).filter(Boolean)
    return p?.cell ? [...clean, p.cell] : clean
  }

  open(segments: readonly string[]): void {
    this.segments.set([...segments])
    if (!this.visible()) {
      this.visible.set(true)
      EffectBus.emit('context:window-state', { open: true })
    }
    void this.refresh()
  }

  close(): void {
    if (!this.visible()) return
    this.visible.set(false)
    this.branches.set([])
    this.segments.set([])
    this.loading.set(false)
    EffectBus.emit('context:window-state', { open: false })
  }

  /** Re-walk every attached branch.
   *
   *  The result is DISCARDED if the window has since been pointed at a
   *  different tile — a slow walk landing late must never paint one tile's
   *  context under another tile's name. */
  async refresh(): Promise<void> {
    const svc = ioc()?.get('@diamondcoreprocessor.com/TileContext') as TileContextLike | undefined
    const asked = this.segments()
    if (!svc?.resolve) { this.branches.set([]); return }
    this.loading.set(true)
    let rows: readonly ContextBranch[] = []
    try { rows = await svc.resolve(asked) }
    catch { rows = [] }
    if (!sameSegments(asked, this.segments())) return
    this.branches.set(rows)
    this.loading.set(false)
  }

  // ── row actions ─────────────────────────────────────────────────────────

  /** Walk to the branch. It is a real place — the fastest way to judge whether
   *  it belongs here is to go and look at it. */
  visit(branch: ContextBranch): void {
    const nav = ioc()?.get('@hypercomb.social/Navigation') as NavigationLike | undefined
    nav?.goRaw?.([...branch.segments])
  }

  /** Take a branch back off. Detaching is the point of this window, so it is
   *  one press with no confirm: nothing is deleted (the branch is untouched —
   *  only the pointer goes), and re-attaching is a drag away. */
  detach(branch: ContextBranch): void {
    const svc = ioc()?.get('@diamondcoreprocessor.com/TileContext') as TileContextLike | undefined
    if (!svc?.detach || !branch.decorationSig) return
    // Optimistic: the row goes now. The write is a local decoration delta and
    // `context:tile-changed` re-resolves behind it, so a failure corrects
    // itself rather than leaving a row that ignores its own button.
    this.branches.update(list => list.filter(b => b !== branch))
    svc.detach(this.segments(), branch.decorationSig)
  }

  /** Ask about this tile. The window's reason to exist in one press: everything
   *  listed here is what that question gets to draw on — TRUE since the wiring
   *  pass, because the ask composers (llm.queen submitChat/submitAsk and the
   *  chat window's host tier) re-derive `contextSignaturesFor(segments)` at
   *  send. Nothing needs to travel from here: derivation is cheap, always
   *  current, and re-deriving beats carrying a list that could go stale between
   *  this press and the send. */
  ask(): void {
    EffectBus.emit('ask:open', { prefill: '' })
  }

  /** Path for the row's second line — a branch is a place, and its address is
   *  how you tell two same-named branches apart. */
  pathOf(branch: ContextBranch): string {
    return branch.segments.length ? '/' + branch.segments.join('/') : '/'
  }

}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-context-window',
  owner: '@hypercomb.shared/ContextWindowComponent',
  component: ContextWindowComponent,
  order: 112,
})
