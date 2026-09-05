// sequence/sequence-cycle.drone.ts
//
// SequenceCycleDrone — press `a` to arrange tiles by the next sequence
// ====================================================================
// `a` repacks the tiles at the current location onto the NEXT tile target
// sequence in the cycle; pressing `a` again advances to the one after.
// `Shift+A` walks back. Tiles keep their relative order (sorted by their
// existing index) — only WHICH spiral slot each occupies changes, so the
// view reorganises without scrambling the order the participant built.
//
// The cycle is:
//   [ Rectangle, Flowers, …every set saved via /sequence ]
// The phone's rails are deliberately NOT an arrangement at all any more: they
// are a PROJECTION of the layer's order owned by RailProjectionDrone
// (documentation/mobile-rails-projection.md), never a commit, so nothing
// here knows about lanes.
// The built-ins (commands/../arrangements.ts) are computed live from
// the current tile count, so they always fit. The saved sets are the ones
// "we have already created" — authored with the SequenceEditorBee and held
// by SequenceService (content-addressed, shareable, bound per-location via
// the cascading `sequence:target` decoration).
//
// The active position in the cycle is participant-local (localStorage,
// keyed by location) — it is a view preference, like the viewport, not
// shared content. The arrangement itself IS committed: the reorder goes
// through `writeTilePropertiesAt({ index })` per tile exactly like a drag,
// so it is one undoable / time-travelable change.
//
// After each press the bounding box of the tiles changes shape, so we
// re-fit the viewport to the new arrangement — the freshly organised set
// lands centred and fully in view on every iteration (the same
// fit-to-center as the `0` / `r` shortcuts, ZoomDrone.zoomToFit). The fit
// is deferred so the reorder render + new hex-mesh geometry lands first;
// zoomToFit reads live bounds, so firing before the render would fit the
// stale pre-arrange rectangle (mirrors AutoFitFirstAddDrone's deferred fit).

import { Drone, hypercomb } from '@hypercomb/core'
import type { Axial } from '../navigation/hex-detector.js'
import { writeTilePropertiesAt } from '../editor/tile-properties.js'
import {
  type AxialLike,
  buildCoordToIndex,
  applyToExisting,
  BUILTIN_ARRANGEMENTS,
} from './arrangements.js'
import {
  writeSequenceTarget,
  listSequenceTargetHere,
  removeSequenceTarget,
} from './sequence-target.js'

type CellCountPayload = {
  count: number
  labels: string[]
  coords?: Axial[]
  /** True only on a pass's FINAL batch — every tile is on screen. */
  settled?: boolean
  locationKey?: string
  renderPassId?: number
}

type AxialServiceLike = { items?: Map<number, AxialLike> }
type LineageLike = { explorerSegments?: () => readonly string[] }
type SequenceServiceLike = {
  list(): string[]
  get(name: string): { name: string; indexes: number[] } | null
  applyTo(segments: readonly string[], name: string): Promise<void>
}
type StoreLike = { putResource(blob: Blob): Promise<string> }
type I18nLike = { t: (k: string, p?: Record<string, string | number>) => string }

const ACTIVE_KEY = 'hc:arrange-active'

/** How long the arrange gate will wait for a targeted pass to settle. */
const PAINT_SETTLE_TIMEOUT = 3000

/** One slot in the cycle: a built-in generator or a saved palette set. */
type CycleEntry =
  | { kind: 'builtin'; id: string; label: string; labelKey: string }
  | { kind: 'saved'; id: string; label: string; labelKey: string }

export class SequenceCycleDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'arrangement'
  override description =
    'Press "a" to arrange the current tiles by the next tile target sequence (Rectangle, Flowers, or any saved /sequence set); Shift+A steps back. Tiles keep their relative order.'

  protected override deps = {
    axial: '@diamondcoreprocessor.com/AxialService',
    lineage: '@hypercomb.social/Lineage',
    sequences: '@diamondcoreprocessor.com/SequenceService',
  }
  protected override listens = [
    'render:tiles-target', 'render:cell-count', 'keymap:invoke', 'sequence:select', 'sequence:edit',
  ]
  protected override emits = [
    'arrange:preview', 'cell:reorder', 'toast:show',
  ]

  // Live snapshot of the current location's tiles (label ↔ axial coord),
  // tracked off render:cell-count exactly like MoveDrone.
  #cellLabels: string[] = []
  #cellCoords: Axial[] = []

  #busy = false
  // The tile pass the renderer has TARGETED, and the newest one known to have
  // finished painting. Tiles arrive in batches, so while the first is ahead of
  // the second the snapshot below holds only the tiles that have come into
  // view so far — see #cycle's gate. Two counters rather than one flag because
  // every effect here replays its last value on subscribe, in whatever order
  // the handlers are registered; comparing two monotonic numbers converges to
  // the same answer either way round, where a flag would strand itself armed.
  #targetedPass = 0
  #paintedPass = 0
  #paintWatchdog: ReturnType<typeof setTimeout> | null = null
  #effectsRegistered = false
  #fitTimer: ReturnType<typeof setTimeout> | null = null
  #commitTail: Promise<void> = Promise.resolve()
  readonly #commitRevision = new Map<string, number>()

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    // A pass has been targeted: from here until its final snapshot lands, the
    // tiles are still coming into view.
    this.onEffect<{ renderPassId?: number }>('render:tiles-target', (payload) => {
      this.#targetedPass = Math.max(this.#targetedPass, Number(payload?.renderPassId ?? 0))
      if (this.#tilesComingIntoView()) this.#armPaintWatchdog()
    })

    this.onEffect<CellCountPayload>('render:cell-count', (payload) => {
      this.#cellLabels = payload.labels ?? []
      this.#cellCoords = payload.coords ?? []
      this.#notePaintSettled(payload)
    })

    this.onEffect<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
      if (cmd === 'sequence.cycle') void this.#cycle(+1)
      else if (cmd === 'sequence.cyclePrev') void this.#cycle(-1)
    })
    this.onEffect<{ id?: string }>('sequence:select', ({ id }) => {
      if (id) void this.#cycle(+1, id)
    })
    this.onEffect<{ name?: string }>('sequence:edit', ({ name }) => {
      const lineage = this.resolve<LineageLike>('lineage')
      const segments = (lineage?.explorerSegments?.() ?? []).map(String).filter(Boolean)
      const editor = window.ioc.get<{ openEditor(n: string, s: readonly string[]): Promise<void> }>(
        '@diamondcoreprocessor.com/SequenceEditorBee',
      )
      void editor?.openEditor?.((name || 'default').trim() || 'default', segments)
    })
  }

  // ── cycle ───────────────────────────────────────────────────────────

  /** True while the newest targeted pass is still painting. */
  #tilesComingIntoView = (): boolean => this.#targetedPass > this.#paintedPass

  /** Mark a pass painted. Three shapes arrive on this effect and they mean
   *  different things:
   *    `settled: true`  — the pass's FINAL batch; every tile is on screen.
   *    `settled: false` — an intermediate batch; more tiles are still coming.
   *    no `settled` key — an in-place touch-up published long after the pass
   *                       painted (an image landing, a shade flip), which is
   *                       itself proof that its pass finished.
   *  Only the middle one leaves the gate closed. */
  #notePaintSettled = (payload: CellCountPayload): void => {
    if (payload?.settled === false) return
    const pass = Number(payload?.renderPassId ?? 0)
    if (pass <= this.#paintedPass) return
    this.#paintedPass = pass
    if (!this.#tilesComingIntoView()) this.#clearPaintWatchdog()
  }

  /** A pass that never publishes a final snapshot must not disable arranging
   *  for the rest of the session — a silently dead command is a worse fault
   *  than the glitch this gate exists to prevent. A healthy pass settles in
   *  well under this window, so the timer firing is itself a bug worth seeing
   *  in the log. */
  #armPaintWatchdog = (): void => {
    this.#clearPaintWatchdog()
    this.#paintWatchdog = setTimeout(() => {
      this.#paintWatchdog = null
      if (!this.#tilesComingIntoView()) return
      console.warn('[sequence-cycle] tile pass never settled — releasing the arrange gate')
      this.#paintedPass = this.#targetedPass
    }, PAINT_SETTLE_TIMEOUT)
  }

  #clearPaintWatchdog = (): void => {
    if (this.#paintWatchdog === null) return
    clearTimeout(this.#paintWatchdog)
    this.#paintWatchdog = null
  }

  #cycle = async (dir: number, requestedId?: string): Promise<void> => {
    if (this.#busy) return

    // TILES FIRST, THEN THE ARRANGEMENT. A page paints in batches, and the
    // snapshot this drone arranges from is whatever the last batch published —
    // so arranging mid-reveal repacks the tiles that happen to be on screen
    // and leaves the rest to land on top of the new layout. The participant
    // sees the page tear itself apart, and the index writes that follow are
    // computed against that partial set. Refuse until the pass has settled;
    // the reveal is short and the key can simply be pressed again.
    if (this.#tilesComingIntoView()) return

    const axialSvc = this.resolve<AxialServiceLike>('axial')
    if (!axialSvc?.items?.size) return

    // Current tiles → name → existing index, read from the live render
    // snapshot via the grid's reverse map (coord → index).
    const coordToIndex = buildCoordToIndex(axialSvc.items)
    const current = new Map<string, number>()
    for (let i = 0; i < this.#cellLabels.length; i++) {
      const label = this.#cellLabels[i]
      const coord = this.#cellCoords[i]
      if (!label || !coord) continue
      const idx = coordToIndex.get(`${coord.q},${coord.r}`)
      if (idx !== undefined) current.set(label, idx)
    }
    if (current.size === 0) return

    // Relative order preserved: tiles sorted by their existing index.
    const orderedNames = [...current.keys()].sort(
      (a, b) => current.get(a)! - current.get(b)!,
    )

    const cycle = this.#buildCycle()
    if (cycle.length === 0) return

    this.#busy = true
    try {
      const lineage = this.resolve<LineageLike>('lineage')
      const segments = (lineage?.explorerSegments?.() ?? [])
        .map((s) => String(s ?? '').trim())
        .filter(Boolean)

      const locationKey = segments.join('/')
      const active = this.#readActive(locationKey)
      const requestedIdx = requestedId
        ? cycle.findIndex((candidate) => candidate.id === requestedId)
        : -1
      const nextIdx = requestedIdx >= 0
        ? requestedIdx
        : ((active + dir) % cycle.length + cycle.length) % cycle.length
      if (nextIdx < 0) return
      const entry = cycle[nextIdx]

      const indexes = this.#indexesFor(entry, orderedNames.length, coordToIndex)
      if (!indexes || indexes.length === 0) return

      const placement = applyToExisting(orderedNames, indexes)
      const revision = (this.#commitRevision.get(locationKey) ?? 0) + 1
      this.#commitRevision.set(locationKey, revision)

      // Presentation first: move the already-rendered tiles using the
      // renderer's in-memory geometry path. No layer/resource read or write is
      // on the activation path. The scoped preview remains authoritative for
      // this location until the background commit catches up.
      this.#writeActive(locationKey, nextIdx)
      this.emitEffect('sequence:selected', { id: entry.id, kind: entry.kind, location: locationKey })
      this.emitEffect('arrange:preview', {
        location: locationKey,
        names: this.#sparseNames(placement),
      })
      this.#toast(entry)
      this.#fitToCenter()

      this.#enqueueCommit({
        segments: [...segments],
        locationKey,
        entry,
        indexes: [...indexes],
        placement: new Map(placement),
        revision,
      })
    } catch (err) {
      console.warn('[sequence-cycle] apply failed:', err)
    } finally {
      this.#busy = false
    }
  }

  // ── fit-to-center after arranging ───────────────────────────────────
  //
  // Re-fit the viewport so the new arrangement lands centred and fully in
  // view. Deferred so the cell:reorder render + new hex-mesh geometry
  // lands first — zoomToFit reads live bounds from the content layer, so
  // firing before the render fits the stale pre-arrange rectangle. Rapid
  // `a` presses coalesce: the pending fit is cancelled and rescheduled so
  // only the final arrangement is fitted, once it settles. Source 'user'
  // so the recomposed view persists like the `0` / `r` fit shortcuts.
  // (A phone in rails fits across its strip — zoomToFit derives that itself.)
  #fitToCenter = (): void => {
    if (this.#fitTimer !== null) clearTimeout(this.#fitTimer)
    this.#fitTimer = setTimeout(() => {
      this.#fitTimer = null
      const zoom = window.ioc.get<{
        zoomToFit?: (snap?: boolean, source?: 'user' | 'auto') => void
      }>('@diamondcoreprocessor.com/ZoomDrone')
      zoom?.zoomToFit?.(false, 'user')
    }, 80)
  }

  /** Built-ins first, then every saved set in the palette. */
  #buildCycle = (): CycleEntry[] => {
    const entries: CycleEntry[] = BUILTIN_ARRANGEMENTS.map((b) => ({
      kind: 'builtin' as const,
      id: b.id,
      label: b.label,
      labelKey: b.labelKey,
    }))
    const svc = this.resolve<SequenceServiceLike>('sequences')
    for (const name of svc?.list() ?? []) {
      entries.push({ kind: 'saved', id: name, label: name, labelKey: '' })
    }
    return entries
  }

  /** The index list for a cycle entry — generated (built-in) or looked
   *  up from the saved set (palette). */
  #indexesFor = (
    entry: CycleEntry,
    count: number,
    coordToIndex: Map<string, number>,
  ): number[] | null => {
    if (entry.kind === 'builtin') {
      const builtin = BUILTIN_ARRANGEMENTS.find((b) => b.id === entry.id)
      return builtin ? builtin.generate(count, coordToIndex) : null
    }
    const svc = this.resolve<SequenceServiceLike>('sequences')
    const set = svc?.get(entry.id)
    return set?.indexes?.length ? [...set.indexes] : null
  }

  // ── commit ──────────────────────────────────────────────────────────
  //
  // Same authoritative write as a drag (MoveDrone.#persistPinnedIndices):
  // each tile's `index` property = its new spiral slot. The per-tile write
  // lock inside writeTilePropertiesAt serialises against concurrent
  // substrate/image writes so the index is never lost. The processor pulse
  // coalesces the visual update; cell:reorder invalidates render caches
  // (show-cell must NOT renumber on receipt — it is a cache signal only).

  #persistPlacement = async (
    segments: readonly string[],
    placement: Map<string, number>,
  ): Promise<void> => {
    for (const [label, index] of placement) {
      try {
        await writeTilePropertiesAt(segments, label, { index })
      } catch (err) {
        console.warn('[sequence-cycle] persist index failed for', label, err)
      }
    }
  }

  #sparseNames = (placement: Map<string, number>): string[] => {
    let maxIndex = -1
    for (const index of placement.values()) maxIndex = Math.max(maxIndex, index)
    const names = new Array(Math.max(0, maxIndex + 1)).fill('')
    for (const [label, index] of placement) names[index] = label
    return names
  }

  #enqueueCommit = (commit: {
    segments: readonly string[]
    locationKey: string
    entry: CycleEntry
    indexes: readonly number[]
    placement: Map<string, number>
    revision: number
  }): void => {
    // Preserve write order across rapid arrangement changes. Different tiles
    // have independent property locks, but their ancestor cascades and the
    // single sequence-target binding must still land in gesture order.
    this.#commitTail = this.#commitTail
      .catch(() => { /* keep the queue live after a failed prior commit */ })
      .then(async () => {
        await this.#persistPlacement(commit.segments, commit.placement)

        // Bind the arrangement as a drop-target so NEW tiles continue its
        // pattern.
        await this.#bind(commit.segments, commit.entry, commit.indexes)
        void new hypercomb().act()

        // A newer gesture at this location owns the preview. Only the newest
        // completed commit may release it and ask the renderer to re-read the
        // now-durable indices.
        if (this.#commitRevision.get(commit.locationKey) !== commit.revision) return
        const dense = [...commit.placement.entries()]
          .sort((a, b) => a[1] - b[1])
          .map(([label]) => label)
        this.emitEffect('cell:reorder', { labels: dense })
        this.emitEffect('arrange:preview', { location: commit.locationKey, names: null })
      })
      .catch((err) => {
        console.warn('[sequence-cycle] background commit failed:', err)
        if (this.#commitRevision.get(commit.locationKey) === commit.revision) {
          this.emitEffect('arrange:preview', { location: commit.locationKey, names: null })
        }
      })
  }

  // ── bind as drop-target (new tiles continue the pattern) ────────────
  //
  // One binding per location: clear any existing `sequence:target` here
  // first so repeated presses don't pile up decorations. Saved sets bind
  // via SequenceService.applyTo (palette-backed + primes the resolver);
  // built-ins store their freshly generated index list as a content-
  // addressed set resource and bind that, without polluting the palette.

  #bind = async (
    segments: readonly string[],
    entry: CycleEntry,
    indexes: readonly number[],
  ): Promise<void> => {
    try {
      const existing = await listSequenceTargetHere(segments)
      for (const e of existing) removeSequenceTarget(e.sig, segments)

      if (entry.kind === 'saved') {
        const svc = this.resolve<SequenceServiceLike>('sequences')
        await svc?.applyTo?.(segments, entry.id)
        return
      }

      const store = window.ioc.get<StoreLike>('@hypercomb.social/Store')
      if (!store?.putResource) return
      const record = { kind: 'sequence', name: entry.id, indexes: [...indexes] }
      const blob = new Blob([JSON.stringify(record)], { type: 'application/json' })
      const sig = await store.putResource(blob)
      await writeSequenceTarget(segments, entry.id, sig)
    } catch (err) {
      console.warn('[sequence-cycle] bind drop-target failed:', err)
    }
  }

  // ── active pointer (participant-local, per location) ────────────────

  #readActive = (locationKey: string): number => {
    try {
      const map = JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? '{}') as Record<string, number>
      const n = map?.[locationKey]
      return Number.isFinite(n) ? n : -1
    } catch {
      return -1
    }
  }

  #writeActive = (locationKey: string, idx: number): void => {
    try {
      const map = JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? '{}') as Record<string, number>
      map[locationKey] = idx
      localStorage.setItem(ACTIVE_KEY, JSON.stringify(map))
    } catch {
      /* ignore quota / disabled storage */
    }
  }

  // ── feedback ────────────────────────────────────────────────────────

  #toast = (entry: CycleEntry): void => {
    const i18n = window.ioc.get<I18nLike>('@hypercomb.social/I18n')
    const name =
      entry.labelKey && i18n?.t
        ? (() => {
            const t = i18n.t(entry.labelKey)
            return t && t !== entry.labelKey ? t : entry.label
          })()
        : entry.label
    const prefix = i18n?.t ? i18n.t('arrange.toast', { name }) : ''
    const message = prefix && prefix !== 'arrange.toast' ? prefix : `Arranged: ${name}`
    this.emitEffect('toast:show', { type: 'tip', message })
  }
}

const _sequenceCycle = new SequenceCycleDrone()
window.ioc.register('@diamondcoreprocessor.com/SequenceCycleDrone', _sequenceCycle)
