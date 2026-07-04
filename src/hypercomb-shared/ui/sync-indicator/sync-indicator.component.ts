// hypercomb-shared/ui/sync-indicator/sync-indicator.component.ts
//
// Header-row cell that surfaces content acquisition work — mounted
// inside the shared .header-bar (both shells) as a flex cell that shows
// the number of files synchronized and a progress bar (determinate when
// the producer streams current/total, an indeterminate sweep otherwise):
//
//   · installer synchronization — sentinel resync passes (DCP toggle
//     changes, portal close), first-run package installs, and bundled
//     upgrades, all bracketed by the `install:sync` effect
//   · adoption — the hive-side daisy-chain walk (`broker.adopt`) that
//     recursively pulls an adopted branch's layers + resources into the
//     local pool, observed via the broker's existing `adopt:meta` /
//     `adopt:progress` / `adopt:done` effects
//
// Hidden until something starts. Shows a light text line + progress bar:
// "{current} of {total} files · {left} left" when the producer streams
// counts, a climbing "adopting… {n} fetched" for the frontier-unknown
// adopt walk, and a brief confirmation with the final file count
// ("synchronized · 214 files") on completion before fading out. The text
// is the anti-stall cue — a bare bar reads as "maybe broken"; a counting
// line reads as "receiving". When sync and adoption overlap, adoption
// wins the label (it is the user's own gesture) and the pill stays up
// until BOTH are quiet.
//
// EffectBus last-value replay means a component mounted mid-activity
// catches up immediately; terminal events replayed while nothing is
// active are ignored. Producers that die mid-stream are covered by a
// stale guard that silently hides the pill after prolonged silence.
//
// Note: this deliberately does NOT touch the retired `install:state`
// channel — verify-share-flow.cjs asserts InstallMonitor stays idle
// through adoption, and that contract is preserved.

import { Component, computed, signal, type OnDestroy, type OnInit } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

interface InstallSyncPayload {
  active?: boolean
  /** Producer lane ('install' | 'resync' | 'bundled' | …). Each producer
   *  brackets its OWN lane so overlapping work can't cross-cancel: the
   *  cue stays up until every lane is quiet, and a count-less bracket
   *  from one lane never wipes another lane's counts. Untagged legacy
   *  emits share one default lane. */
  source?: string
  phase?: string
  current?: number
  total?: number
}

interface AdoptStatsPayload {
  sig?: string
  root?: string
  layers?: number
  leaves?: number
  failed?: number
}

/** Hide a stuck pill after this much silence. A producer that dies
 *  mid-stream (e.g. a first-run install racing its timeout keeps
 *  streaming progress with no terminating event, or an adopt walk
 *  pinned on an egg that never hatches) would otherwise show forever.
 *  Any new event re-arms the guard. */
const STALE_GUARD_MS = 90_000

// Long enough to actually READ the completion line ("synchronized · 214
// files") — 2s made arrival easy to miss, which read as "did it finish?".
const DONE_FLASH_MS = 3_500

@Component({
  selector: 'hc-sync-indicator',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './sync-indicator.component.html',
  styleUrls: ['./sync-indicator.component.scss'],
})
export class SyncIndicatorComponent implements OnInit, OnDestroy {

  #unsubs: (() => void)[] = []
  #doneTimer: ReturnType<typeof setTimeout> | null = null
  #staleTimer: ReturnType<typeof setTimeout> | null = null

  /** Active sync lanes — one entry per producer currently between its
   *  {active:true} and {active:false} brackets. Counts live per lane so
   *  a count-less bracket-open from one producer can't wipe another's
   *  streaming progress. */
  readonly #syncLanes = signal<Map<string, { current: number; total: number }>>(new Map())
  readonly #adoptActive = signal(false)

  /** Adoption progress — running count of filled sigs (layers + leaves).
   *  The walk discovers its frontier as it goes, so there is no total. */
  readonly #adoptItems = signal(0)

  /** Brief post-completion confirmation, labelled by what finished. */
  readonly #done = signal(false)
  readonly #doneKind = signal<'sync' | 'adopt'>('sync')

  /** Highest file count seen during the current activity — what the done
   *  flash reports ("synchronized · {count} files"). Peak, not final-read:
   *  lanes are deleted (and adopt items zeroed) before the flash, so the
   *  live signals are already empty by then. */
  #peakCount = 0

  /** File count carried into the done flash (0 = no counts were streamed —
   *  the flash falls back to the plain "synchronized"/"adopted" label). */
  readonly #doneCount = signal(0)

  readonly adopting = computed(() => this.#adoptActive())
  readonly done = computed(() => this.#done())
  readonly visible = computed(() => this.#syncLanes().size > 0 || this.#adoptActive() || this.#done())
  /** Summed across lanes with announced totals — two determinate streams
   *  read as one combined "files synchronized" figure. */
  readonly current = computed(() => {
    let n = 0
    for (const lane of this.#syncLanes().values()) if (lane.total > 0) n += lane.current
    return n
  })
  readonly total = computed(() => {
    let n = 0
    for (const lane of this.#syncLanes().values()) n += lane.total
    return n
  })
  readonly hasCounts = computed(() => this.total() > 0)
  readonly adoptItems = computed(() => this.#adoptItems())
  readonly doneKind = computed(() => this.#doneKind())
  readonly doneCount = computed(() => this.#doneCount())
  /** Files still to come — the "how many are left" half of the label. */
  readonly left = computed(() => Math.max(0, this.total() - this.current()))

  /** Determinate fill percentage for the progress bar. Clamped — a
   *  producer that overshoots its announced total must not blow the
   *  track. */
  readonly percent = computed(() => {
    const total = this.total()
    if (total <= 0) return 0
    return Math.min(100, Math.round((this.current() / total) * 100))
  })

  ngOnInit(): void {
    this.#unsubs.push(
      EffectBus.on<InstallSyncPayload>('install:sync', (payload) => {
        const lane = String(payload?.source ?? 'sync')
        if (payload?.active === true) {
          this.#begin()
          this.#syncLanes.update(m => {
            const next = new Map(m)
            const prior = next.get(lane)
            // Only adopt counts the payload actually carries — a bare
            // bracket-open re-emit must not zero a streaming lane.
            next.set(lane, {
              current: payload?.current ?? prior?.current ?? 0,
              total: payload?.total ?? prior?.total ?? 0,
            })
            return next
          })
          this.#peakCount = Math.max(this.#peakCount, this.current() + this.#adoptItems())
          return
        }
        if (!this.#syncLanes().has(lane)) return
        this.#syncLanes.update(m => {
          const next = new Map(m)
          next.delete(lane)
          return next
        })
        this.#maybeFinish('sync')
      }),

      // Adoption walk — broker.adopt announces the root before walking
      // (adopt:meta), streams per-layer fills (adopt:progress, leaves
      // counted in the same stats object), and always terminates with
      // adopt:done.
      EffectBus.on<{ rootSig?: string }>('adopt:meta', () => {
        this.#begin()
        this.#adoptActive.set(true)
        this.#adoptItems.set(0)
      }),
      EffectBus.on<AdoptStatsPayload>('adopt:progress', (payload) => {
        this.#begin()
        this.#adoptActive.set(true)
        this.#adoptItems.set((payload?.layers ?? 0) + (payload?.leaves ?? 0))
        this.#peakCount = Math.max(this.#peakCount, this.current() + this.#adoptItems())
      }),
      EffectBus.on<AdoptStatsPayload>('adopt:done', () => {
        if (!this.#adoptActive()) return
        this.#adoptActive.set(false)
        this.#adoptItems.set(0)
        this.#maybeFinish('adopt')
      }),
    )
  }

  /** Activity (re)started: cancel any pending confirmation, re-arm the
   *  stale guard. */
  #begin(): void {
    this.#clearTimer('done')
    this.#done.set(false)
    this.#armStaleGuard()
  }

  /** One source went quiet. Only flash the confirmation when nothing
   *  else is still running — overlapping work keeps the pill up. */
  #maybeFinish(kind: 'sync' | 'adopt'): void {
    if (this.#syncLanes().size > 0 || this.#adoptActive()) return
    this.#clearTimer('stale')
    this.#doneKind.set(kind)
    this.#doneCount.set(this.#peakCount)
    this.#peakCount = 0
    this.#done.set(true)
    this.#clearTimer('done')
    this.#doneTimer = setTimeout(() => {
      this.#done.set(false)
      this.#doneTimer = null
    }, DONE_FLASH_MS)
  }

  /** Prolonged silence while "active" means the producer died — hide
   *  without a confirmation (we don't know that it completed). */
  #armStaleGuard(): void {
    this.#clearTimer('stale')
    this.#staleTimer = setTimeout(() => {
      this.#staleTimer = null
      this.#syncLanes.set(new Map())
      this.#adoptActive.set(false)
      this.#adoptItems.set(0)
      this.#peakCount = 0
      this.#done.set(false)
    }, STALE_GUARD_MS)
  }

  #clearTimer(which: 'done' | 'stale'): void {
    if (which === 'done' && this.#doneTimer) {
      clearTimeout(this.#doneTimer)
      this.#doneTimer = null
    }
    if (which === 'stale' && this.#staleTimer) {
      clearTimeout(this.#staleTimer)
      this.#staleTimer = null
    }
  }

  ngOnDestroy(): void {
    for (const u of this.#unsubs) u()
    this.#unsubs.length = 0
    this.#clearTimer('done')
    this.#clearTimer('stale')
  }
}
