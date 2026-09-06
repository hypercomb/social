// presentation/tiles/organism.drone.ts
//
// THE ORGANISM — density as a place, in two projections.
//
// Both are PROJECTIONS and neither is a commit. `AxialService.project()`
// swaps the slot→coordinate matrix; every tile's canonical `index` is left
// exactly as the participant arranged it, so leaving the mode restores the
// hive byte for byte and nothing was written by looking. The phone's rails
// (sequence/rail-projection.drone.ts) do the same thing for the same reason
// — see documentation/mobile-rails-projection.md, and
// documentation/organism-view.md for this one.
//
//   ORGANISM — the densest tile takes the centre and everything crowds
//   around it, thinning outward until the set runs out. While the mode is
//   on, THAT is how the tiles are indexed: position reports rank instead of
//   arrangement. A type can be lifted to the top layer — you meet its tiles
//   first — while everything keeps its canonical order underneath.
//
//   TEXTURE — each kind is laid as a contiguous run, kinds ordered by their
//   own total weight. What comes out is not a list but a texture of blobs,
//   each bleeding into the next. A top layer does not apply: lifting a type
//   out of a texture would tear its run in half.
//
// The kinds are TAGS — the hive's own way of saying what a tile is — so
// "different ontologies" is not a feature to build, it is what happens when
// you tag differently. Weight comes from organism-weight.ts: holders when a
// swarm answers, descendants otherwise.
//
// The grid has ONE projector. If the rails already own it (a phone), the
// organism refuses rather than fighting over the matrix.
//
// TWO CONTRACTS, both learned the hard way, both load-bearing:
//
//   A PROJECTION IS A FULL SLOT MATRIX, NOT A PAGE'S WORTH. `project()`
//   REPLACES AxialService.items outright, so a matrix holding only this
//   page's eleven slots leaves a grid of eleven slots and strands every
//   other index — a tile added afterwards has nowhere to land. The rail
//   projection passes `axial.capacity` for exactly this reason. What the
//   organism re-orders is a PERMUTATION of the slots the page already
//   occupies; every other slot keeps its spiral coordinate.
//
//   A PROJECTION MUST NOT ANSWER ITS OWN RENDER. Projecting asks for a
//   repaint, the repaint republishes `render:cell-count`, and that is the
//   very effect that triggers a re-rank. Left open it is an infinite loop —
//   and a destructive one, because each pass re-ranked from the tiles the
//   LAST pass had drawn, so anything missing from one frame was evicted for
//   good. The matrix is therefore compared before it is applied: an
//   unchanged matrix is not projected, not announced, and does not repaint.

import { Drone } from '@hypercomb/core'
import { organismMatrix, type OrganismMember, type SlotMatrix } from './organism-layout.js'
import { organismWeights, type OrganismOntology } from './organism-weight.js'

export type OrganismMode = 'off' | 'organism' | 'texture'

/** Ask for a mode. `promote` names the tag lifted to the top layer, and is
 *  ignored by the texture. */
export const ORGANISM_SET = 'organism:set'
/** What the mode is now, for the chrome and for the word's answer. */
export const ORGANISM_CHANGED = 'organism:changed'

export interface OrganismSetPayload {
  readonly mode: OrganismMode
  readonly promote?: string
}

export interface OrganismChangedPayload {
  readonly mode: OrganismMode
  readonly ontology: OrganismOntology
  readonly promote: string | null
  /** How many tiles the promoted kind actually lifted. 0 with a promote set
   *  means the word named a kind nothing here wears — worth saying, because
   *  the projection otherwise looks identical to the plain organism and the
   *  participant would read a silent no-op as "that tag did nothing". */
  readonly promoted: number
  readonly placed: number
  /** Present only when the mode could not be entered. */
  readonly refused?: string
}

type AxialLike = {
  project?: (matrix: SlotMatrix | null) => boolean
  readonly items?: ReadonlyMap<number, { q: number; r: number }>
  readonly projected?: boolean
}

type LineageLike = { explorerSegments?: () => readonly string[] }

type CellCountPayload = {
  labels?: string[]
  coords?: { q: number; r: number }[]
}

const coordKey = (q: number, r: number): string => `${q},${r}`

export class OrganismDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'arrangement'
  override description =
    'Ranks the tiles by how densely populated they are and projects them around the thickest one — as a single organism, or as a texture of kinds. A way of looking, never a commit.'

  protected override deps = {
    axial: '@diamondcoreprocessor.com/AxialService',
    lineage: '@hypercomb.social/Lineage',
  }
  protected override listens = [
    'render:cell-count', 'render:tags', ORGANISM_SET, 'location:changed',
  ]
  protected override emits = [ORGANISM_CHANGED, 'render:grid-changed']

  #bound = false
  #mode: OrganismMode = 'off'
  #promote: string | null = null

  /** The unprojected spiral, snapshotted before we take the grid. It is both
   *  the rank→coordinate source and the coordinate→index inverse, and it
   *  cannot be read back off AxialService once we have projected over it. */
  #spiral: Map<number, { q: number; r: number }> | null = null

  /** Inverse of the matrix WE projected: coordinate → canonical slot. While
   *  the organism holds the grid this is the only correct way to read a drawn
   *  tile back to its slot — the spiral only says where it WOULD be. */
  #activeInverse = new Map<string, number>()
  /** The last matrix applied, as a comparable key. An identical matrix is not
   *  re-projected — that is what stops the render feeding itself. */
  #lastMatrixKey = ''
  /** Are WE the projector? The only honest way to ask whether a projected
   *  grid is ours or somebody else's. */
  #owning = false

  /** Last page seen: labels in render order, and where each one sits. */
  #labels: string[] = []
  #indexByLabel = new Map<string, number>()
  #tagsByLabel: Readonly<Record<string, string[]>> = {}
  /** Guards against a re-entrant apply while a descendant read is in flight. */
  #applying = false
  #reapply = false
  #reapplyAsked = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#bound) return
    this.#bound = true

    this.onEffect<OrganismSetPayload>(ORGANISM_SET, (payload) => {
      const mode = payload?.mode ?? 'off'
      this.#promote = typeof payload?.promote === 'string' && payload.promote.length
        ? payload.promote
        : null
      if (mode === 'off') { this.#release(); return }
      this.#mode = mode
      void this.#apply(true)
    })

    // A page's tiles arrive here. The organism re-ranks on every pass while
    // active: tiles added, a lens narrowing the page, or a peer publishing a
    // version all change what "densest" means, and a stale ranking would
    // quietly keep claiming the old one.
    this.onEffect<CellCountPayload>('render:cell-count', (payload) => {
      this.#readPage(payload)
      if (this.#mode !== 'off') void this.#apply()
    })

    this.onEffect<{ byLabel?: Record<string, string[]> }>('render:tags', (payload) => {
      this.#tagsByLabel = payload?.byLabel ?? {}
      if (this.#mode === 'texture') void this.#apply()
    })

    // Walking into a tile leaves the ranking behind. The organism ranks ONE
    // page's tiles against each other; carrying it through a walk would
    // silently re-sort a page the participant never asked about.
    this.onEffect('location:changed', () => this.#release())
  }

  protected override dispose(): void { this.#release() }

  /** Label → its canonical slot, inverted from the spiral. The renderer only
   *  ever tells us where a tile IS; the projection needs to know which slot
   *  put it there. */
  #readPage(payload: CellCountPayload): void {
    const labels = payload?.labels ?? []
    const coords = payload?.coords ?? []
    this.#labels = []
    this.#indexByLabel = new Map()

    // Whichever grid is answering, invert THAT one: our own matrix while we
    // hold the grid, the live grid otherwise. Inverting the drawn coordinate
    // rather than remembering labels means a tile that appears mid-mode reads
    // back correctly instead of being dropped for being unfamiliar.
    //
    // READING MUST NOT SNAPSHOT. This runs on every render pass, mode or no
    // mode, and caching the spiral here would leave `#spiral` permanently set
    // after the first pass — which silently disarms the one-projector guard
    // in `#applyOnce`, because that guard asks whether we are already holding
    // the grid by asking whether we have a snapshot. The snapshot is taken at
    // the moment of projecting and nowhere else.
    let indexByCoord = this.#activeInverse
    if (indexByCoord.size === 0) {
      const grid = this.#spiral ?? this.resolve<AxialLike>('axial')?.items
      if (!grid) return
      indexByCoord = new Map<string, number>()
      for (const [index, coord] of grid) indexByCoord.set(coordKey(coord.q, coord.r), index)
    }

    for (let i = 0; i < labels.length; i++) {
      const label = labels[i]
      const coord = coords[i]
      if (!label || !coord) continue
      const index = indexByCoord.get(coordKey(coord.q, coord.r))
      if (index === undefined) continue
      this.#labels.push(label)
      this.#indexByLabel.set(label, index)
    }
  }

  #snapshotSpiral(): Map<number, { q: number; r: number }> | null {
    const axial = this.resolve<AxialLike>('axial')
    if (!axial?.items || axial.items.size === 0) return null
    // Never snapshot a grid somebody else is already projecting — we would
    // freeze their matrix and hand it back as "the spiral" on release.
    if (axial.projected) return null
    const spiral = new Map<number, { q: number; r: number }>()
    for (const [index, coord] of axial.items) spiral.set(index, { q: coord.q, r: coord.r })
    this.#spiral = spiral
    return spiral
  }

  /** `asked` marks an apply the PARTICIPANT set going, as opposed to one a
   *  repaint triggered. An asked apply always answers — the word is waiting
   *  on `organism:changed` and a silent path leaves it timing out — while a
   *  repaint that changes nothing stays quiet, which is what keeps the
   *  render from feeding itself. */
  async #apply(asked = false): Promise<void> {
    if (this.#applying) { this.#reapply = true; this.#reapplyAsked ||= asked; return }
    this.#applying = true
    try { await this.#applyOnce(asked) }
    finally {
      this.#applying = false
      if (this.#reapply) {
        this.#reapply = false
        const carried = this.#reapplyAsked
        this.#reapplyAsked = false
        void this.#apply(carried)
      }
    }
  }

  async #applyOnce(asked: boolean): Promise<void> {
    const quiet = (refused: string): void => { if (asked) this.#announce(0, 'none', refused) }

    const axial = this.resolve<AxialLike>('axial')
    if (!axial?.project) { quiet('the tile grid is not up yet'); return }

    // ONE PROJECTOR. Someone else holding the grid — the phone's rails — is
    // asked about directly: are WE the ones projecting? Asking instead
    // whether we happen to hold a spiral snapshot is what let the organism
    // flatten the rail matrix, because any earlier render pass had already
    // left a snapshot lying around.
    if (axial.projected && !this.#owning) {
      this.#mode = 'off'
      this.#announce(0, 'none', 'the rails are holding the grid — the organism needs the map')
      return
    }
    const spiral = this.#spiral ?? this.#snapshotSpiral()
    if (!spiral) { quiet('the tile grid is not up yet'); return }
    if (this.#labels.length === 0) { quiet('there are no tiles here to rank'); return }

    const segments = this.resolve<LineageLike>('lineage')?.explorerSegments?.() ?? []
    const { ontology, weightByLabel } = await organismWeights(this.#labels, segments)
    if (ontology === 'none') {
      this.#announce(0, ontology, 'nothing here has a density to rank')
      return
    }
    // The mode may have been turned off while the descendant read ran.
    if (this.#mode === 'off') return

    const texture = this.#mode === 'texture'
    const members: OrganismMember[] = []
    for (const label of this.#labels) {
      const index = this.#indexByLabel.get(label)
      if (index === undefined) continue
      const weight = weightByLabel.get(label) ?? 0
      // A tile's kind is its FIRST tag — the one it leads with. Untagged
      // tiles share the unnamed group and settle together at the edge.
      const group = texture ? (this.#tagsByLabel[label]?.[0] ?? '') : undefined
      members.push(group === undefined ? { index, weight } : { index, weight, group })
    }
    if (members.length === 0) { quiet('there are no tiles here to rank'); return }

    // Kinds are matched case-insensitively: the word is typed by a person and
    // a tag's capitalisation is not part of what it means.
    const promote = this.#promote?.toLowerCase() ?? null
    const wears = (m: OrganismMember): boolean =>
      (this.#tagsByLabel[this.#labelOf(m.index)] ?? []).some(t => t.toLowerCase() === promote)
    let promoted = 0
    if (promote && !texture) for (const m of members) if (wears(m)) promoted++

    // THE DESTINATIONS ARE THE PAGE'S OWN SLOTS. Ranking re-orders the tiles
    // ACROSS the coordinates they already occupy — the densest takes whichever
    // of those sits closest to the centre, which is the right one because the
    // page's slots were handed out from the spiral centre outward to begin
    // with. Confining the permutation this way is what makes it total: no
    // coordinate outside the page is touched, so nothing can collide.
    const slots = members.map(m => m.index).sort((a, b) => a - b)
    const places = new Map<number, { q: number; r: number }>()
    for (let rank = 0; rank < slots.length; rank++) {
      const coord = spiral.get(slots[rank])
      if (coord) places.set(rank, coord)
    }

    const pageMatrix = organismMatrix(members, places, {
      ...(promote && !texture ? { promote: wears } : {}),
    })

    // An unchanged matrix is a NO-OP — see the header. Without this, the
    // repaint we ask for returns as a cell-count that asks us to rank again.
    const key = [...pageMatrix].sort((a, b) => a[0] - b[0])
      .map(([i, c]) => `${i}:${c.q},${c.r}`).join('|') + `#${this.#mode}#${promote ?? ''}`
    if (key === this.#lastMatrixKey) {
      // Already showing exactly this. Say so when ASKED — silence leaves the
      // word waiting for an answer that never comes — but stay quiet for a
      // repaint, which is the loop guard doing its job.
      if (asked) this.#announce(pageMatrix.size, ontology, undefined, promoted)
      return
    }

    // A FULL slot matrix: the spiral, with this page's slots permuted into
    // rank order. Projecting only the page's own entries would shrink the grid
    // to that many slots and strand every other index.
    const full = new Map(spiral)
    for (const [index, coord] of pageMatrix) full.set(index, coord)
    if (!axial.project(full)) { quiet('the tile grid refused the projection'); return }

    this.#owning = true
    this.#lastMatrixKey = key
    this.#activeInverse = new Map<string, number>()
    for (const [index, coord] of pageMatrix) this.#activeInverse.set(coordKey(coord.q, coord.r), index)

    this.emitEffect('render:grid-changed', { active: true, organism: this.#mode })
    this.#announce(pageMatrix.size, ontology, undefined, promoted)
  }

  #labelOf(index: number): string {
    for (const [label, i] of this.#indexByLabel) if (i === index) return label
    return ''
  }

  /** Give the grid back. ALWAYS ANSWERS, even when there was nothing to give
   *  back: the word waits for `organism:changed` before it reports, so a
   *  silent early return here left `/organism off` — said twice, or said
   *  first — hanging until a four-second timeout and then claiming the tile
   *  surface never answered. A no-op is a fine outcome; not saying so is not. */
  #release(): void {
    if (this.#mode === 'off') { this.#announce(0, 'none'); return }
    this.#mode = 'off'
    this.#promote = null
    this.#activeInverse = new Map()
    this.#lastMatrixKey = ''
    const axial = this.resolve<AxialLike>('axial')
    if (this.#owning) axial?.project?.(null)
    this.#owning = false
    this.#spiral = null
    this.emitEffect('render:grid-changed', { active: false, organism: 'off' })
    this.#announce(0, 'none')
  }

  #announce(
    placed: number,
    ontology: OrganismOntology,
    refused?: string,
    promoted = 0,
  ): void {
    this.emitEffect<OrganismChangedPayload>(ORGANISM_CHANGED, {
      mode: this.#mode,
      ontology,
      promote: this.#promote,
      promoted,
      placed,
      ...(refused ? { refused } : {}),
    })
  }
}

const organism = new OrganismDrone()
;(window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/OrganismDrone', organism,
)
