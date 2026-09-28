// tile-narrowing.ts — WHAT NARROWS THE PAGE. A branch of the tile renderer
// (documentation/tile-renderer-tree.md): the participant's tag lens, a
// reference's requirement, and a gathered set, and the cross-page walk that
// turns them into one flat set of tiles to paint. show-cell asks this module
// whether the page is narrowed and what to paint; it never holds the state.
//
// The host is the renderer: it knows where the participant stands, the tags
// a cell carried in its properties, how to paint again, and how to travel.

import { tagsForLabel } from '../../commands/decoration-kind-index.js'

/** One flattened match. `dir` is null under the layer model (sub-locations
 *  have no on-disk folder). `path` is the ABSOLUTE lineage of the match — a
 *  flattened tile can live anywhere, so entering it must goRaw(path);
 *  appending the label to the current location would mint a phantom segment.
 *  `hasChildren` is structural truth (drives the branch flag); `matchesInside`
 *  counts matches strictly below it, which is what the filter would show if
 *  you entered — 0 means entering lands on an empty mesh, so the click is
 *  refused instead. */
export type FlattenRow = {
  label: string
  dir: FileSystemDirectoryHandle | null
  path: string[]
  hasChildren: boolean
  matchesInside: number
}

export type NarrowingScope = 'local' | 'children' | 'global'

type HistoryReader = {
  sign: (l: { explorerSegments?: () => readonly string[] }) => Promise<string>
  currentLayerAt: (sig: string) => Promise<Record<string, unknown> | null>
  getLayerBySig: (sig: string) => Promise<{ name?: string } | null>
}
type ResourceReader = { getResource: (sig: string) => Promise<Blob | null> }

export interface NarrowingHost {
  /** Where the participant stands. */
  segments(): string[]
  /** Legacy `properties.tags` a cell carried (tagged before the decoration migration). */
  cachedTags(label: string): readonly string[] | undefined
  emit(effect: string, payload: unknown): void
  /** The narrowing changed: drop the render key and paint again. */
  repaint(): void
  /** Paint again without dropping the render key. */
  requestRender(): void
  /** Travel to an absolute lineage (restoring where a lens was opened). */
  goRaw(segments: string[]): void
  /** What the cross-page walk reads; undefined until wired. */
  history(): HistoryReader | undefined
  store(): ResourceReader | undefined
}

const SIG_RE = /^[0-9a-f]{64}$/
const MAX_DEPTH = 32

export class TileNarrowing {
  /** The participant's lens: OR-semantics (a cell matching ANY active mark shows). */
  lens = new Set<string>()
  /** Marks a REFERENCE demands of what it shows, in force while the
   *  participant stands inside what that reference points at (see
   *  reference-requirement.drone). A SECOND source, deliberately not merged
   *  into the lens: folding a requirement into OR-semantics would BROADEN the
   *  page instead of narrowing it — the exact opposite of what a requirement
   *  means. The two sets are ANDed instead: satisfy the lens (if any) AND the
   *  requirement (if any). Never listed, never toggleable — a requirement is
   *  part of the reference's identity, not lens state. */
  required = new Set<string>()
  /** How wide the lens reaches: 'local' = current page only, 'children' =
   *  the current subtree, 'global' = the whole hive. */
  scope: NarrowingScope = 'local'
  /** Flat list of matches from the cross-page scan. null = normal mode. */
  results: FlattenRow[] | null = null
  /** Absolute path per flattened label — handed to tile-overlay so a click
   *  travels to the match's real location instead of appending its name. */
  paths = new Map<string, string[]>()
  /** Flattened labels whose subtree holds no match under the active filter.
   *  tile-overlay refuses entry and toasts rather than opening a blank page. */
  blocked = new Set<string>()
  /** Lineage the scan last ran from — re-scan when the location moves under a
   *  live filter, which is what makes the filter FOLLOW you as you drill in. */
  scanKey: string | null = null
  /** A GATHERED SET — tiles handed to us by name and absolute path rather than
   *  found by a predicate, painted through the same flatten machinery. This is
   *  the "show me these, wherever they live" lane (the agent audit uses it):
   *  nothing is committed, no layer is minted, and it is gone the moment the
   *  participant walks anywhere — a gathered view is a look, not a place. */
  #gathered: { label: string; path: string[] }[] | null = null
  /** Identity of the current gather, so a different set rebuilds the geometry. */
  #gatherKey = ''
  /** Where the gather was raised. Leaving clears it (see settle). */
  #gatherAnchorKey = ''
  /** Where the lens was switched on. A global lens reads the whole hive from
   *  the root only while you stand here; once you enter a match the walk
   *  re-roots to the current location (otherwise every level would show the
   *  identical global flatten and entering would be a no-op). */
  #anchorKey: string | null = null
  /** Lineage before the lens was switched on — restored when it clears. */
  #preFilterSegments: string[] | null = null

  constructor(private readonly host: NarrowingHost) {}

  /** Is anything narrowing the page — the lens, a reference's requirement, a
   *  gathered set? Every flatten guard asks this rather than the lens size,
   *  so a requirement alone (entered through a reference with no lens set)
   *  still flattens. */
  get active(): boolean {
    return this.lens.size > 0 || this.required.size > 0 || this.#gathered !== null
  }

  /** Tags applied to a cell: the union of the decoration index (canonical,
   *  tags ride the `tag` decoration kind) and the legacy `properties.tags`
   *  cache (back-compat for cells tagged before the decoration migration). */
  tagsFor(label: string): string[] {
    const out = new Set<string>(this.host.cachedTags(label) ?? [])
    for (const t of tagsForLabel(label)) out.add(t)
    return [...out]
  }

  /** Emit render:tags (name+count) for the controls-bar tag list — the tags
   *  defining the current page. There is no on-tile tag icon; the bottom tag
   *  list lights up per-tile on hover (tile:hover-tags). */
  emitRenderTags(cells: readonly { label: string }[]): void {
    const counts = new Map<string, number>()
    // Per-tile tags ride alongside the counts. The tag strip only ever
    // needed the totals, but a tag is the hive's own way of saying what a
    // tile IS, so anything grouping tiles by kind (the organism's texture
    // projection) needs to know WHICH tile wears WHICH — and re-deriving
    // that outside this loop would mean a second reader of the lens,
    // filters and requirements that already resolved here.
    const byLabel: Record<string, string[]> = {}
    for (const cell of cells) {
      const tags = this.tagsFor(cell.label)
      if (tags.length) byLabel[cell.label] = [...tags]
      for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    const tags = [...counts.entries()].map(([name, count]) => ({ name, count }))
    this.host.emit('render:tags', { tags, byLabel })
  }

  /** Identity of the current narrowing, for the render key. Both sources,
   *  kept apart: `a|b` and `b|a` are different renders. */
  key(): string {
    return [...this.lens].sort().join(',') + '|' + [...this.required].sort().join(',') + '|' + this.#gatherKey
  }

  /** The render key of a flatten: the scan root is part of its identity, or
   *  a drill-down into a match would reuse the parent level's geometry. */
  renderKey(): string {
    return `tag-flatten:${this.scope}:${this.scanKey ?? ''}:` + this.key()
  }

  /** What tile-overlay needs to enter a flattened match, for render:cell-count. */
  entry(): { flatPaths: Record<string, string[]>; filterBlocked: string[] } {
    return {
      // A match can live anywhere, so entering it travels to its absolute path;
      // appending the label to wherever you're standing mints a phantom segment.
      flatPaths: this.active ? Object.fromEntries(this.paths) : {},
      // Matches with children but nothing tagged inside: entering would land on
      // a blank filtered mesh, so tile-overlay refuses and says why.
      filterBlocked: this.active ? [...this.blocked] : [],
    }
  }

  /** Put a gathered set down. Called when the participant navigates away and
   *  when the gatherer sends an empty list. */
  clearGather(): void {
    this.#gathered = null
    this.#gatherKey = ''
    this.#gatherAnchorKey = ''
    this.results = null
    this.paths.clear()
    this.blocked.clear()
    this.host.emit('render:gathered', { active: false, count: 0 })
  }

  /**
   * Before a render reads the narrowing. The filter FOLLOWS you: entering a
   * match re-roots the walk at wherever you landed, so the flatten narrows as
   * you drill in rather than redrawing the same set at every level. A moved
   * location means the scan is stale. A GATHERED SET is only ever the view
   * you raised it from: clicking one of its tiles travels to that tile's real
   * home — and the audit is over, so the gather clears rather than following
   * you there and painting the same set again at the destination.
   *
   * Then the flatten state is dropped: it describes ONE flatten render and
   * nothing else, so an ordinary page can never inherit the previous
   * filter's paths — a stale entry would redirect (or refuse) a click on an
   * unrelated tile. A flatten render repopulates it (adopt).
   */
  async settle(): Promise<void> {
    if (this.#gathered && this.host.segments().join('/') !== this.#gatherAnchorKey) this.clearGather()
    if (this.active && !this.#gathered && this.host.segments().join('/') !== this.scanKey) await this.scan()
    this.paths.clear()
    this.blocked.clear()
  }

  /** A flatten render is painting these rows: remember where each lives and
   *  which ones hold nothing to enter. */
  adopt(rows: readonly FlattenRow[]): void {
    this.paths = new Map(rows.map(r => [r.label, r.path]))
    this.blocked = new Set(rows.filter(r => r.hasChildren && r.matchesInside === 0).map(r => r.label))
  }

  /** The lineage a flattened label lives under, for reading its own layer;
   *  null for an ordinary render. */
  parentOf(label: string): readonly string[] | null {
    const flat = this.paths.get(label)
    return flat && flat.length > 0 && flat[flat.length - 1] === label ? flat.slice(0, -1) : null
  }

  // ── what changes it (the renderer's listeners hand these over) ──────────────

  /** render:gather-set — a set handed over by name and path. Nothing is
   *  committed; an empty list (or walking anywhere) puts the hive back. */
  gather(key: string | undefined, items: readonly { label?: string; path?: string[] }[] | undefined): void {
    const rows = (items ?? [])
      .map(item => ({ label: String(item?.label ?? '').trim(), path: (item?.path ?? []).map(String) }))
      .filter(row => row.label)
    if (rows.length === 0) {
      if (this.#gathered) { this.clearGather(); this.host.repaint() }
      return
    }
    this.#gathered = rows
    this.#gatherKey = String(key ?? '') || rows.map(r => r.label).join(',')
    this.#gatherAnchorKey = this.host.segments().join('/')
    this.results = rows.map(row => ({ label: row.label, dir: null, path: row.path, hasChildren: true, matchesInside: 1 }))
    this.host.repaint()
    this.host.emit('render:gathered', { active: true, count: rows.length, key: this.#gatherKey })
  }

  /** tags:required — the marks a REFERENCE demands of what it shows, in force
   *  while the participant stands inside what it points at. ANDed with the
   *  lens; never merged into it, never listed as chips, and it deliberately
   *  does NOT touch the pre-filter lineage — walking out of a requirement is
   *  an ordinary navigation, not a filter being cleared, so there is nowhere
   *  to restore anyone to. */
  require(marks: readonly string[] | undefined): void {
    const next = new Set((marks ?? []).map(m => String(m ?? '').trim()).filter(Boolean))
    if (next.size === this.required.size && [...next].every(m => this.required.has(m))) return
    this.required = next
    // The previous walk answered a different question.
    this.scanKey = null
    if (!this.active) {
      this.results = null
      this.paths.clear()
      this.blocked.clear()
    }
    void (async () => {
      if (this.active) await this.scan()
      this.host.repaint()
    })()
  }

  /** tags:filter — the lens, scoped to page / children / global. */
  filter(active: readonly string[], scope: NarrowingScope | undefined): void {
    const wasFiltering = this.lens.size > 0
    this.scope = scope ?? 'local'
    this.lens = new Set(active)
    // Any change to the tag set or the scope invalidates the previous walk.
    this.scanKey = null
    if (this.lens.size > 0) {
      const here = this.host.segments()
      // Save location before entering filter mode
      if (!wasFiltering) this.#preFilterSegments = here
      // Re-anchor on EVERY filter change, not just activation: the anchor is
      // "where you were when you last touched the filter". A global filter
      // reads the whole hive while you stand on its anchor and re-roots once
      // you enter a match — so widening the scope after drilling in has to
      // move the anchor here, or global would never actually go global.
      this.#anchorKey = here.join('/')
      // Scan the whole tree, THEN render — the flatten override reads the
      // freshly-populated results. Drop the render key so the flatten
      // geometry rebuilds rather than reusing the prior page.
      void (async () => {
        await this.scan()
        if (!this.active) return // narrowing dropped mid-scan
        this.host.repaint()
      })()
    } else if (this.required.size > 0) {
      // The lens cleared but a reference's requirement still stands — the
      // page stays narrowed to what that reference demands rather than
      // falling back to the unfiltered layer. Re-scan, because the walk that
      // just ran answered "lens AND requirement" and this one answers
      // "requirement alone".
      this.#anchorKey = null
      this.#preFilterSegments = null
      void (async () => {
        await this.scan()
        this.host.repaint()
      })()
    } else {
      this.results = null
      this.paths.clear()
      this.blocked.clear()
      this.#anchorKey = null
      // Restore the pre-filter location ONLY if the filter never moved us.
      // Entering a match is now a real, path-correct navigation the user
      // chose — teleporting them back to where they opened the filter would
      // throw that away. (The restore exists because the old flatten had no
      // way to enter a match without minting a phantom segment.)
      if (this.#preFilterSegments !== null) {
        if (this.host.segments().join('/') === this.#preFilterSegments.join('/')) this.host.goRaw(this.#preFilterSegments)
        this.#preFilterSegments = null
      }
      this.host.repaint()
    }
  }

  /** Walk the whole layer tree from the scope's root and collect every cell
   *  whose tag set meets the lens AND the requirement, populating `results`
   *  for the flatten render. Tags are read per cell from BOTH the `tag`
   *  decoration kind (canonical) and legacy `properties.tags` — the same
   *  union the controls-bar pills use — so old and new tags both filter.
   *  Mirrors the `walkLayer` pattern (website.queen / flattenLayerTree): sign
   *  each path, read its layer, recurse its `children`. */
  async scan(): Promise<void> {
    const active = this.lens
    const required = this.required
    if (active.size === 0 && required.size === 0) { this.results = null; return }

    const history = this.host.history()
    const store = this.host.store()
    if (!history?.sign || !history?.currentLayerAt || !store?.getResource) {
      this.results = null
      // Stamp the key anyway — otherwise the render-side "location moved"
      // check sees an unscanned location and re-runs this on every frame.
      this.scanKey = this.host.segments().join('/')
      return
    }

    const results: FlattenRow[] = []
    const seen = new Set<string>()

    // Scope decides where the walk starts and how deep it reaches:
    //  • global   — the whole hive from the root, unbounded depth
    //  • children — the current subtree, unbounded depth
    //  • local    — the current page only (its immediate cells; depth 1)
    const currentSegments = this.host.segments()
    const currentKey = currentSegments.join('/')
    // A global filter reads from the hive root only while you stand at the
    // location where you switched it on. Enter a match and the walk re-roots
    // to where you now are — the filter follows you down instead of redrawing
    // the same hive-wide flatten at every level.
    const rootPath: string[] = (this.scope === 'global' && currentKey === this.#anchorKey) ? [] : currentSegments
    const recordDepth = this.scope === 'local' ? 1 : MAX_DEPTH
    // Walk ONE level past the deepest recorded row purely to count. A local
    // filter records depth 1, but the enterability gate for those rows asks
    // "would depth 1 FROM there hold anything?" — which is depth 2 from here.
    const maxRelDepth = Math.min(recordDepth + 1, MAX_DEPTH)

    // Tag names on a single layer: tag-kind decorations ∪ legacy properties.tags.
    const tagNamesOf = async (layer: Record<string, unknown>): Promise<Set<string>> => {
      const names = new Set<string>()
      const decorations = Array.isArray(layer['decorations']) ? layer['decorations'] as unknown[] : []
      for (const sig of decorations) {
        if (typeof sig !== 'string' || !SIG_RE.test(sig)) continue
        try {
          const blob = await store.getResource(sig)
          if (!blob) continue
          const rec = JSON.parse(await blob.text()) as { kind?: string; payload?: { name?: unknown } }
          if (rec?.kind === 'tag' && typeof rec.payload?.name === 'string') names.add(rec.payload.name)
        } catch { /* malformed — skip */ }
      }
      const props = Array.isArray(layer['properties']) ? layer['properties'] as unknown[] : []
      const propSig = props[0]
      if (typeof propSig === 'string' && SIG_RE.test(propSig)) {
        try {
          const blob = await store.getResource(propSig)
          if (blob) {
            const p = JSON.parse(await blob.text()) as { tags?: unknown }
            if (Array.isArray(p?.tags)) for (const t of p.tags) if (typeof t === 'string') names.add(t)
          }
        } catch { /* malformed — skip */ }
      }
      return names
    }

    // relDepth is measured from the scope root: 0 is the root itself (a page
    // container — never a result), 1 is its immediate cells, and so on.
    // Returns how many matches sit AT `path` or below it, which is what lets a
    // recorded row learn whether entering it would show anything.
    const walk = async (path: string[], relDepth: number): Promise<number> => {
      if (relDepth > maxRelDepth) return 0
      let layer: Record<string, unknown> | null
      try {
        const locSig = await history.sign({ explorerSegments: () => path })
        layer = await history.currentLayerAt(locSig)
      } catch { return 0 }
      if (!layer) return 0

      const rawChildren = Array.isArray(layer['children']) ? layer['children'] as unknown[] : []

      // Push the row before recursing; matchesInside is patched in below, since
      // it isn't knowable until the subtree has been counted.
      let selfMatched = false
      let row: FlattenRow | null = null
      if (relDepth >= 1) {
        const label = path[path.length - 1]!
        const names = await tagNamesOf(layer)
        // Two sources, ANDed. Within each, ANY mark matching is enough — the
        // rule the participant's lens already uses, applied unchanged to the
        // requirement rather than inventing a second one. An empty source
        // demands nothing, so a lens alone behaves exactly as it did before
        // requirements existed.
        const meetsLens = active.size === 0 || [...active].some(t => names.has(t))
        const meetsRequirement = required.size === 0 || [...required].some(t => names.has(t))
        selfMatched = meetsLens && meetsRequirement
        // Rows are recorded only down to recordDepth — anything past that is
        // walked purely to answer "is there a match in here?".
        if (selfMatched && relDepth <= recordDepth && !seen.has(label)) {
          seen.add(label)
          row = { label, dir: null, path: [...path], hasChildren: rawChildren.length > 0, matchesInside: 0 }
          results.push(row)
        }
      }

      let below = 0
      if (relDepth < maxRelDepth) {
        for (const entry of rawChildren) {
          const s = String(entry ?? '').trim()
          if (!s) continue
          let childName = s
          if (SIG_RE.test(s)) {
            try {
              const child = await history.getLayerBySig(s)
              if (!child?.name) continue
              childName = String(child.name)
            } catch { continue }
          }
          below += await walk([...path, childName], relDepth + 1)
          // The counting-only level records nothing, so one hit already answers
          // the gate — stop reading siblings instead of paying for the rest.
          if (below > 0 && relDepth + 1 > recordDepth) break
        }
      }

      if (row) row.matchesInside = below
      return (selfMatched ? 1 : 0) + below
    }

    await walk(rootPath, 0)
    this.results = results
    this.scanKey = currentKey
  }
}
