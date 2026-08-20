// diamondcoreprocessor.com/pheromones/pheromone-tiles.drone.ts
//
// The Pheromones window's bridge to the tiles themselves. The panel
// (hypercomb-shared/ui/tags-viewer) manages the KEYWORDS; this drone lets the
// participant put those keywords ON tiles and take them OFF, directly on the
// hive, while the window is open.
//
//   THE COLLECTING WALK — the staging path, the additive twin of bulk removal.
//     The panel gathers a bouquet of keywords; gathering arms it
//     (`tags:apply-begin {tags}`) — there is no separate "start" step. The hive
//     is NOT taken over: you walk it exactly as always (click, enter, hold),
//     and ctrl+click COLLECTS the tile under the pointer into the grouping
//     (`tags:apply-paint {label, add}` — SelectionInputDrone owns the gesture;
//     ctrl+click a collected tile to release it, ctrl+drag to sweep). Collected
//     tiles are pure intent — nothing is written — shown as a future-add mark
//     on the hive (show-cell reads the same `tags:apply-pending {cells}`) and
//     listed as the grouping at the top of the panel. `Done`
//     (`tags:apply-commit`) writes every collected tile in one pass and pulses
//     the processor; closing or Escape (`tags:apply-cancel` / `tags:apply-end`)
//     throws the staging away. This mirrors TagRemovalDrone — stage, review,
//     commit — and replaced the paint brush: painting hijacked every click, so
//     you could not walk while marking, and collecting is the easier verb.
//
//   DROP — a pheromone dragged out of the panel onto a tile lands immediately
//     (`pheromone:drop`). Unlike the brush this is one unambiguous act, so it
//     writes at once rather than staging; addTag is idempotent.
//
//   PEEK / REMOVE — hovering a pheromone-bearing tile shows the tile's keywords
//     as a small draggable card of coloured chips, each with an ×. The card
//     composes the shared hover-pin stack (`pheromone:*`, PinnableHoverBase)
//     exactly like contact cards, and carries its OWN pin control. It used to be
//     pinned by an on-tile `pheromones` icon on the hover band; the band no
//     longer shows while this window is open (TileOverlayDrone stands it down —
//     it covered this card and ate the press), so that icon had nowhere left to
//     appear and is gone. An × emits `pheromone:remove-from-tile`, spliced live.
//
// Mirrors ContactDrone: a Drone that wires its EffectBus handlers in heartbeat,
// resolves shell services (Lineage, DecorationService, IconProviderRegistry,
// I18n) lazily from IoC, and NEVER imports shared. Keywords are the author-tier
// pheromone (a tag = the author's pheromone, no decay — see
// documentation/pheromones.md); the write path is DecorationService's tag API.

import { Drone, hypercomb, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { tagsForLabel } from '../commands/decoration-kind-index.js'

type LineageLike = { explorerSegments?: () => readonly string[] }
type DecorationServiceLike = {
  addTag(segments: readonly string[], name: string): Promise<string>
  removeTag(segments: readonly string[], name: string): Promise<void>
}

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

export class PheromoneTilesDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'pheromones'

  public override description =
    'Puts pheromone keywords onto tiles and takes them off: the collecting walk (ctrl+click tiles into the grouping, then Done commits), the drag-drop quick apply, and the on-tile ×-to-remove card — all while the Pheromones window is open.'

  protected override listens = [
    'tags:view-state', 'tags:removal-pending',
    'tags:apply-begin', 'tags:apply-paint', 'tags:apply-commit',
    'tags:apply-cancel', 'tags:apply-end', 'render:cell-count',
    'tile:hover',
    'pheromone:remove-from-tile', 'pheromone:card-left', 'pheromone:drop', 'tags:changed',
  ]
  protected override emits = [
    'tags:apply-pending', 'tags:changed', 'toast:show',
    'pheromone:hover-show', 'pheromone:hover-hide',
  ]

  #wired = false
  /** The Pheromones window is open — the whole tile bridge is gated on it. */
  #windowOpen = false
  /** A bulk removal is armed (TagRemovalDrone) — suppress the hover card so the
   *  two takeovers never fight over the same tile click. */
  #removalArmed = false
  /** The keywords loaded into the brush — empty when the brush is down. A brush
   *  can carry SEVERAL: the painter picks a set, and every staged tile gets all
   *  of them on commit. Non-empty === the paint takeover is armed. */
  #brushTags: string[] = []
  /** Tiles STAGED to receive the brush — pure intent, nothing written until the
   *  commit. Feeds the renderer's future-add mark and the panel's list, exactly
   *  as TagRemovalDrone's `#pending` feeds the future-remove mark. */
  #staged = new Set<string>()
  /** Absolute path per label, captured from the render scan — a tile can live
   *  anywhere, so its name alone doesn't locate it at commit time. */
  #paths = new Map<string, string[]>()
  /** Label currently driving the hover card (avoids redundant re-emits). */
  #hoverLabel: string | null = null
  #committing = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#wired) return
    this.#wired = true

    this.onEffect<{ open?: boolean; parked?: boolean }>('tags:view-state', (p) => {
      const open = p?.open === true
      if (open === this.#windowOpen) return
      this.#windowOpen = open
      // CLOSING drops the brush — that is a decision the participant made, and
      // an armed brush with no panel to disarm it would hijack every tile click.
      //
      // PARKING does not. The shell parks a window when it needs the edge (a
      // lane pushing out its oldest occupant, a rail flyout borrowing the side,
      // the installer covering the hive) and a shell decision must cost the
      // participant nothing — which for this window means the bouquet they
      // gathered and the tiles they had already staged. Park and close used to
      // arrive here as the same `open:false`, so the panel's own promise to keep
      // an armed brush across a park could not be kept.
      //
      // A parked brush is inert, not dangerous: the tile overlay drops entirely
      // on `open === false`, so nothing is hijacked while the panel is away.
      if (!open) {
        if (p?.parked !== true) this.#disarm()
        this.#hideHover()
      }
    })

    this.onEffect<{ active?: boolean }>('tags:removal-pending', (p) => {
      this.#removalArmed = p?.active === true
      if (this.#removalArmed) this.#hideHover()
    })

    // The pointer left the card, so the shell is dismissing it. Forget which
    // tile was showing — otherwise the same-label de-dupe in #onHover would
    // refuse to re-open this tile's card the next time it is hovered. The card
    // is already going away, so this must NOT emit hover-hide.
    this.onEffect('pheromone:card-left', () => { this.#hoverLabel = null })

    // ── the painter: arm → stage → commit ────────────────────────
    //
    // Loading the brush. `tags` is the painter's picked set; `tag` is the old
    // single-keyword shape, still accepted. Re-arming while already painting
    // (the painter changed its selection mid-session) KEEPS the staged tiles;
    // only picking the brush up from empty starts a fresh session.
    this.onEffect<{ tag?: string; tags?: string[] }>('tags:apply-begin', (p) => {
      const raw = Array.isArray(p?.tags) ? p.tags : (p?.tag ? [p.tag] : [])
      const tags = [...new Set(raw.map(t => String(t ?? '').trim()).filter(Boolean))]
      if (tags.length === 0) { this.#disarm(); return }
      if (this.#brushTags.length === 0) this.#staged.clear()
      this.#brushTags = tags
      this.#emitPending(true)
    })

    // A tile was painted (or un-painted) by the brush — pure staging, no write.
    // `add` is the stroke intent from the overlay: true stages, false lifts.
    this.onEffect<{ label?: string; add?: boolean }>('tags:apply-paint', (p) => {
      const label = String(p?.label ?? '').trim()
      if (!label || this.#brushTags.length === 0) return
      const add = p?.add !== false
      if (add) this.#staged.add(label)
      else this.#staged.delete(label)
      this.#emitPending(true)
    })

    this.onEffect('tags:apply-commit', () => { void this.#commit() })
    this.onEffect('tags:apply-cancel', () => this.#disarm())
    this.onEffect('tags:apply-end', () => this.#disarm())

    // Absolute paths for the visible labels: a painted tile can live anywhere in
    // reach, so its name alone won't locate it. (Painting is normally
    // unfiltered, so flatPaths is empty and the location fallback applies — but
    // capturing keeps every write correct if a filter is up.)
    //
    // REPLACED per render, never accumulated: flatPaths describes ONE flatten
    // and nothing else — show-cell clears its own copy for the same reason. A
    // remembered path outliving its filter is worse than none, because the next
    // same-named tile you paint silently gets tagged at the OLD location.
    this.onEffect<{ flatPaths?: Record<string, string[]> }>('render:cell-count', (p) => {
      const paths = p?.flatPaths ?? {}
      this.#paths.clear()
      for (const [label, path] of Object.entries(paths)) {
        if (Array.isArray(path) && path.length > 0) this.#paths.set(label, [...path])
      }
    })

    // ── hover card feed ──────────────────────────────────────────
    this.onEffect<{ label?: string | null }>('tile:hover', (p) => {
      this.#onHover(p?.label ?? null)
    })

    // A pheromone was DRAGGED out of the panel and dropped on a tile (or on
    // that tile's own card). A drop is unambiguous intent — "put this here" —
    // so unlike the brush it does not stage; it ADDS at once (addTag is
    // idempotent, so dropping one already there is a harmless no-op).
    // `label` is only set when the drop landed on a tile's own card, which names
    // itself. Everywhere else the hive is the target and we resolve the RELEASE
    // POINT — never a remembered hover, which goes null the moment the drag
    // crosses the panel it started in (see TileOverlayDrone.labelAtClient).
    this.onEffect<{ label?: string; tag?: string; x?: number; y?: number }>('pheromone:drop', (p) => {
      const tag = String(p?.tag ?? '').trim()
      if (!tag) return
      let label = String(p?.label ?? '').trim()
      if (!label && typeof p?.x === 'number' && typeof p?.y === 'number') {
        label = ioc<{ labelAtClient(x: number, y: number): string | null }>(
          '@diamondcoreprocessor.com/TileOverlayDrone',
        )?.labelAtClient(p.x, p.y) ?? ''
      }
      if (label) void this.#drop(label, tag)
    })

    // An × on a chip → splice that keyword off that tile, live.
    this.onEffect<{ label?: string; name?: string; segments?: string[] }>('pheromone:remove-from-tile', (p) => {
      const name = String(p?.name ?? '').trim()
      const label = String(p?.label ?? '').trim()
      if (!name || !label) return
      const segments = Array.isArray(p?.segments) && p.segments.length
        ? p.segments.map(String)
        : this.#segmentsFor(label)
      void this.#removeOne(segments, label, name)
    })

    // A keyword changed on some tile (any path) — refresh the card if it is the
    // one we are showing.
    this.onEffect<{ updates?: { cell?: string }[] }>('tags:changed', (p) => {
      if (!this.#hoverLabel) return
      const touched = (p?.updates ?? []).some(u => u?.cell === this.#hoverLabel)
      if (touched) this.#refreshHover(this.#hoverLabel)
    })
  }

  // ── the painter: commit / disarm ───────────────────────────────

  /** Write every staged tile in one pass, then pulse the processor once. Mirror
   *  of TagRemovalDrone.#commit: nothing was written until now, so a commit with
   *  nothing staged just means "never mind". Each tile gets every brush keyword
   *  it is missing; addTag is idempotent, so re-painting an existing one is a
   *  no-op. Disarms afterwards — the committed tiles now carry the keywords for
   *  real, and the future-add marks clear as `tags:apply-pending` goes inactive. */
  async #commit(): Promise<void> {
    const tags = [...this.#brushTags]
    const cells = [...this.#staged]
    if (this.#committing) return
    if (tags.length === 0 || cells.length === 0) { this.#disarm(); return }
    this.#committing = true

    const decorations = ioc<DecorationServiceLike>('@diamondcoreprocessor.com/DecorationService')

    const updates: { cell: string; tag: string }[] = []
    for (const label of cells) {
      const segments = this.#segmentsFor(label)
      const carried = tagsForLabel(label)
      for (const tag of tags) {
        if (carried.includes(tag)) continue
        try {
          await decorations?.addTag(segments, tag)
          updates.push({ cell: label, tag })
        } catch (err) {
          console.warn('[pheromone-tiles] paint-commit failed for', label, tag, err)
        }
      }
    }

    this.#committing = false
    if (updates.length > 0) this.emitEffect('tags:changed', { updates })
    await new hypercomb().act()
    this.#toastCommit(cells.length, tags)
    this.#disarm()
  }

  /** One toast for the whole commit — N tiles, the keyword(s) they got. */
  #toastCommit(tileCount: number, tags: readonly string[]): void {
    const i18n = ioc<I18nProvider>(I18N_IOC_KEY)
    const list = tags.map(t => `"${t}"`).join(', ')
    const single = tags.length === 1 ? tags[0] : ''
    this.emitEffect('toast:show', {
      type: 'success',
      title: tags.length === 1
        ? (i18n?.t('pheromone.painted.title', { tag: single }) ?? `Painted "${single}"`)
        : (i18n?.t('pheromone.painted.many.title', { count: tags.length }) ?? `Painted ${tags.length} pheromones`),
      message: i18n?.t('pheromone.committed.message', { count: tileCount, tags: list })
        ?? `${list} on ${tileCount} tile${tileCount === 1 ? '' : 's'}.`,
    })
  }

  /** Land a dragged pheromone on a tile. Add-only (see the listener), immediate
   *  (the drag is one deliberate act, not a stroke to review), and it refreshes
   *  the tile's card if that card is the one showing so the new chip appears
   *  where you dropped it. */
  async #drop(label: string, tag: string): Promise<void> {
    const segments = this.#segmentsFor(label)
    const decorations = ioc<DecorationServiceLike>('@diamondcoreprocessor.com/DecorationService')
    const carried = [...tagsForLabel(label)]
    const already = carried.includes(tag)
    try {
      if (!already) await decorations?.addTag(segments, tag)
      this.emitEffect('tags:changed', { updates: [{ cell: label, tag }] })
      await new hypercomb().act()
      // Show the tile's card on what it now carries. Explicit set for the same
      // index-lag reason as the commit path: the kind-index rebuilds off
      // `decorations:changed` a beat behind the write we just awaited.
      this.#hoverLabel = label
      this.#emitHover('pheromone:hover-show', label, already ? carried : [...carried, tag])
      const i18n = ioc<I18nProvider>(I18N_IOC_KEY)
      this.emitEffect('toast:show', {
        type: already ? 'info' : 'success',
        title: already
          ? (i18n?.t('pheromone.already.title', { tag }) ?? `"${tag}" already there`)
          : (i18n?.t('pheromone.painted.title', { tag }) ?? `Painted "${tag}"`),
        message: already
          ? (i18n?.t('pheromone.already.message', { tag, cell: label }) ?? `"${label}" already carries "${tag}".`)
          : (i18n?.t('pheromone.painted.message', { tag, cell: label }) ?? `"${tag}" on "${label}".`),
      })
    } catch (err) {
      console.warn('[pheromone-tiles] drop failed for', label, tag, err)
    }
  }

  async #removeOne(segments: readonly string[], label: string, name: string): Promise<void> {
    const decorations = ioc<DecorationServiceLike>('@diamondcoreprocessor.com/DecorationService')
    try {
      await decorations?.removeTag(segments, name)
      this.emitEffect('tags:changed', { updates: [{ cell: label, tag: name }] })
      await new hypercomb().act()
      // The card refreshes off the tags:changed we just emitted; if the tile has
      // no keywords left, that refresh hides it.
    } catch (err) {
      console.warn('[pheromone-tiles] remove failed for', label, name, err)
    }
  }

  /** Put the brush down and throw away any staging — the only paths that write
   *  are #commit and #drop. */
  #disarm(): void {
    if (this.#brushTags.length === 0 && this.#staged.size === 0) return
    this.#brushTags = []
    this.#staged.clear()
    this.#emitPending(false)
  }

  /** The one place the sticky brush state is shaped. `tag` stays in the payload
   *  for readers that only ever knew a single keyword; `tags` is the truth, and
   *  `cells` is what is STAGED — the overlay reads it for stroke toggle-intent,
   *  show-cell for the future-add marks, the panel for its list. */
  #emitPending(active: boolean): void {
    this.emitEffect('tags:apply-pending', {
      active,
      tags: [...this.#brushTags],
      tag: this.#brushTags.length === 1 ? this.#brushTags[0] : (this.#brushTags[0] ?? null),
      cells: [...this.#staged],
    })
  }

  // ── hover card ─────────────────────────────────────────────────

  /** The card sits BESIDE the hex, so the pointer must cross empty canvas to
   *  reach the ×'s — and that emits `tile:hover {label:null}`. Tearing the card
   *  down on tile-exit therefore made it impossible to click a chip: it
   *  vanished on the way there. So leaving a tile does NOT dismiss it. Only a
   *  DIFFERENT pheromone-bearing tile replaces it; leaving the card itself is
   *  what dismisses it (PinnableHoverBase's peek-leave), which is the gesture
   *  that actually means "done with this". */
  #onHover(label: string | null): void {
    if (!this.#canHover()) { this.#hideHover(); return }
    if (!label || label === this.#hoverLabel) return
    if (tagsForLabel(label).length === 0) return
    this.#hoverLabel = label
    this.#emitHover('pheromone:hover-show', label)
  }

  /** Re-emit the CURRENT card for a label whose keywords changed. Hides it when
   *  nothing is left to show. */
  #refreshHover(label: string): void {
    if (tagsForLabel(label).length === 0) { this.#hideHover(); return }
    this.#emitHover('pheromone:hover-show', label)
  }

  /** `pheromones` overrides the index read for callers that already know the
   *  tile's set — see #drop, where the index can lag the write by a beat.
   *  `anchor` is the tile's screen geometry (centre + radius, client coords):
   *  the card stands BESIDE the hex, in one stable spot per tile, rather than
   *  wherever the cursor happened to be when the hover fired. */
  #emitHover(
    effect: 'pheromone:hover-show',
    label: string,
    pheromones?: readonly string[],
  ): void {
    const overlay = ioc<{ clientAnchorForLabel?(label: string): { x: number; y: number; radius: number } | null }>(
      '@diamondcoreprocessor.com/TileOverlayDrone',
    )
    this.emitEffect(effect, {
      label,
      segments: this.#segmentsFor(label),
      pheromones: [...(pheromones ?? tagsForLabel(label))],
      anchor: overlay?.clientAnchorForLabel?.(label) ?? null,
    })
  }

  #hideHover(): void {
    if (this.#hoverLabel === null) return
    this.#hoverLabel = null
    this.emitEffect('pheromone:hover-hide', {})
  }

  /** The hover card appears whenever the window is open. It deliberately
   *  survives an ARMED BRUSH: while painting, the card is the only per-tile
   *  readout of what a tile carries, and hiding it was the single biggest thing
   *  the painter took away (reported immediately in first use — "all of the
   *  tiles when you mouse over them should show their pheromone card"). It is
   *  safe with the brush loaded because the card anchors BESIDE the cursor, so
   *  a press at the cursor still reaches the canvas; only a deliberate move
   *  onto the card hits its ×'s, which is the gesture that means "take this
   *  off" rather than "paint here".
   *
   *  Bulk REMOVAL still suppresses it: that takeover paints tiles struck
   *  through as you stage them, and a card of ×'s over the top would offer two
   *  contradictory ways to remove the same keyword. */
  #canHover(): boolean {
    return this.#windowOpen && !this.#removalArmed
  }

  #parentSegments(): string[] {
    const lineage = ioc<LineageLike>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** Where the tile named `label` actually LIVES. The ONE resolution every
   *  write goes through: a flattened match can sit anywhere in the hive, so
   *  `here + label` would name a phantom path and the tag would land on a
   *  cell that isn't the one you painted. This is the write-side twin of the
   *  decoration index's location keying — the two must agree, or a write goes
   *  one place and the read-back looks somewhere else. */
  #segmentsFor(label: string): string[] {
    return this.#paths.get(label) ?? [...this.#parentSegments(), label]
  }
}

// ── registration ────────────────────────────────────────
const _pheromoneTiles = new PheromoneTilesDrone()
window.ioc.register('@diamondcoreprocessor.com/PheromoneTilesDrone', _pheromoneTiles)
