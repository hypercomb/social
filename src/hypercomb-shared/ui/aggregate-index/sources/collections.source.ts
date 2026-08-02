// hypercomb-shared/ui/aggregate-index/sources/collections.source.ts
//
// Collections (reference sets) as an aggregate index source. This is the whole
// of what used to be `collections-landing/` minus every scrap of chrome — the
// panel draws the rows, this supplies the data and the intent.
//
// A collection is its OWN ROOT lineage; `sets/` is just the index of them (the
// VARIABLE-ROOT hop — see entrances-and-sets.md and tile-overlay.drone's sets
// branch). So opening one navigates to `/[name]`, never `/sets/[name]`, and its
// picture is resolved from its root.
//
// MANAGE:
//   • add — the participant selects tiles on the canvas and presses Add; each
//     becomes a REFERENCE under `sets/` pointing at where it already lives.
//   • move — the same selection, filed away instead: the tiles LEAVE the page
//     they were on and become children of the collection you are standing in.
//     Add and move are the two readings of "put this in there" and the panel
//     offers both side by side; add is an appearance, move is custody.
//   • create — the + beside the panel's search field. This ADDS a way in rather
//     than replacing add: you have somewhere to gather things before you have
//     the things, and the tile it makes is PARENTLESS — a root at `/<name>`,
//     under nothing, which is exactly what a collection is. The index then
//     holds an ordinary reference to it, the same shape `add` writes, so a
//     created collection and an adopted one are indistinguishable afterwards.
//   • rename — NOT a mutation. A cell is immutable + content-addressed, so this
//     RE-HOMES the same child sigs under a new root (no byte copy) and swaps the
//     sets/ membership. The old name's history stays intact, merely unreferenced.
//   • remove — index entry only, and only while the collection is EMPTY, so a
//     manage gesture can never silently drop content.
//
// Shell-level: every write goes through an IoC-resolved essentials service (the
// sanctioned route the command line uses). Never imports essentials.

import { EffectBus, hypercomb } from '@hypercomb/core'
import {
  registerAggregateSource,
  type AddedRows, type AggregateItem, type AggregateSource, type StagedEntry,
} from '../aggregate-source'
import { dropReferenceTile } from '../aggregate-drop'

const SETS = 'sets'
const TAG_KIND = 'tag'
const TITLE_KIND = 'title'
const REFERENCE_KIND = 'reference'
const SIG = /^[0-9a-f]{64}$/

type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<Record<string, unknown> | null>
  getLayerBySig?(sig: string): Promise<Record<string, unknown> | null>
  commitLayer?(locationSig: string, layer: Record<string, unknown>): Promise<string>
}
type StoreLike = { getResource(sig: string): Promise<Blob | null> }
type NavigationLike = { goRaw?: (segments: readonly string[]) => void }
type CommitterLike = {
  update?: (
    segments: readonly string[],
    layer: { name?: string; [slot: string]: unknown },
    nameSlots?: ReadonlySet<string>,
  ) => Promise<string>
  /** `removes` entries are OBJECTS, not bare sigs — the committer reads `r.sig`
   *  and falls back to `r.label` (layer-committer's deltas reducer). Declaring
   *  them as strings here is what let a silent no-op through: a bare string has
   *  no `.sig`, so every remove matched nothing and reported success. */
  commitChildrenDeltas?: (
    segments: readonly string[],
    deltas: {
      appends?: readonly string[]
      removes?: readonly { sig?: string; label?: string }[]
    },
  ) => Promise<unknown>
}
/** MoveDrone's one re-home primitive — see move.drone.ts. Returns the labels
 *  that actually landed; a name already taken at the destination is skipped
 *  rather than clobbered, because a name is an address. */
type MoveLike = {
  commitMoveInto?: (
    labels: readonly string[],
    sourceSegments: readonly string[],
    targetSegments: readonly string[],
  ) => Promise<readonly string[]>
}
type DecorationServiceLike = {
  list<T>(o: { kind: string; segments: readonly string[] }): Promise<Array<{ sig: string; record: { payload?: T } }>>
  setTitle?(
    segments: readonly string[],
    text: string,
    locale?: string,
  ): Promise<'set' | 'cleared' | 'noop' | 'duplicate'>
}

/** One row's backing entry in the `sets/` index.
 *
 *  `name` is the index child's own address; `segments` is WHERE THE COLLECTION
 *  ACTUALLY LIVES, read from the child's `reference` decoration. The two differ
 *  for anything nested — that difference is the whole point of holding
 *  references here rather than names (see the header note). */
type Entry = {
  readonly name: string
  /** The index child's marker sig — what a removal splices out. */
  readonly sig: string
  readonly segments: readonly string[]
}

const segmentsEqual = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((s, i) => s === b[i])

const ioc = (): { get(k: string): unknown } | undefined =>
  (globalThis as { ioc?: { get(k: string): unknown } }).ioc

const history = () => ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
const committer = () => ioc()?.get('@diamondcoreprocessor.com/LayerCommitter') as CommitterLike | undefined
const store = () => ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined

class CollectionsSource implements AggregateSource {
  readonly id = 'collections'
  // Not a map pin: a collection is a Portal — a way OUT of this page into
  // another root. Same glyph the controls-bar rail uses for Portals.
  readonly icon = 'nearby'
  readonly titleKey = 'collections-landing.title'
  readonly ledeKey = 'collections-landing.lede'
  readonly createKey = 'collections-landing.new'
  readonly addKey = 'collections-landing.add'
  readonly moveKey = 'collections-landing.move'
  readonly activeAt = [SETS] as const

  /** name → object URL of its representative tile picture. Revoked when the
   *  name leaves the index. */
  readonly #images = new Map<string, string>()
  #imageRequested = new Set<string>()
  readonly #tags = new Map<string, readonly string[]>()
  /** name → display title, when the collection carries one. A rename writes a
   *  title on the TARGET rather than moving anything: the name is the address. */
  readonly #titles = new Map<string, string>()
  #setsSig = ''
  /** The membership as last read. Writes are composed from these ENTRIES, never
   *  from a list of names — a name list is what auto-mints at commit, and that
   *  is exactly how listing an aggregate once materialised it as a real member. */
  #entries: readonly Entry[] = []

  /** Announces pictures / keywords / titles that resolved AFTER `items()` had
   *  already answered, so the panel re-reads and shows them.
   *
   *  Those resolutions are deliberately detached — a row must appear as soon as
   *  its name is known rather than waiting on a blob — which leaves the returned
   *  rows momentarily bare. Before this existed nothing re-published them, so
   *  they filled in only when some unrelated `synchronize` happened to trigger a
   *  reload: correct by accident. Each resolver below dispatches ONLY when the
   *  value actually changed, which is what stops the re-read it causes from
   *  resolving again in a loop. */
  readonly changed = new EventTarget()

  #announce(): void {
    this.changed.dispatchEvent(new CustomEvent('change'))
  }

  async #signSets(): Promise<string> {
    if (!this.#setsSig) {
      this.#setsSig = await history()?.sign({ explorerSegments: () => [SETS] }).catch(() => '') ?? ''
    }
    return this.#setsSig
  }

  /** The `sets/` layer to read FROM: the history cursor's CURRENT position
   *  (rewound-aware) when it is bound here — so an undo shows the index as of
   *  that step — else the live head. */
  async #readSetsLayer(): Promise<Record<string, unknown> | null> {
    const h = history()
    const sig = await this.#signSets()
    if (!h || !sig) return null
    const cursor = ioc()?.get('@diamondcoreprocessor.com/HistoryCursorService') as
      { currentLayerSig?: string; state?: { locationSig?: string } } | undefined
    if (cursor?.currentLayerSig && cursor.state?.locationSig === sig && h.getLayerBySig) {
      const l = await h.getLayerBySig(cursor.currentLayerSig).catch(() => null)
      if (l) return l
    }
    return await h.currentLayerAt(sig).catch(() => null)
  }

  async items(): Promise<readonly AggregateItem[]> {
    const h = history()
    if (!h?.sign) return []
    const layer = await this.#readSetsLayer()
    const childSigs = Array.isArray(layer?.['children']) ? (layer!['children'] as unknown[]) : []
    // CONCURRENTLY, not in sequence. Each row costs a layer read plus a
    // reference-decoration read (itself a sign + layer read + a resource read),
    // and none of them depends on another — read one after another and the panel
    // pays the sum of every row's latency before it can show ANY of them, which
    // on a real index is the difference between a flicker and seconds.
    // `Promise.all` preserves order, so the index still reads in its own order.
    const resolved = await Promise.all(childSigs.map(async (raw): Promise<Entry | null> => {
      const sig = String(raw ?? '')
      if (!SIG.test(sig)) return null
      const child = h.getLayerBySig ? await h.getLayerBySig(sig).catch(() => null) : null
      const nm = child?.['name']
      if (typeof nm !== 'string' || !nm.length) return null
      return { name: nm, sig, segments: await this.#targetOf(nm) }
    }))
    const entries = resolved.filter((e): e is Entry => e !== null)
    // Launch-group aggregates are NOT merged in any more. Each aggregate is its
    // own source with its own index now, so listing them here would be a second
    // representation of the same thing — and composing a write from a list that
    // contained them is exactly what used to materialise `games`/`help` as real
    // members of sets/ (`children` names auto-mint at commit).
    this.#entries = entries
    this.#forgetAllBut(entries.map(e => e.name))

    for (const entry of entries) {
      if (!this.#imageRequested.has(entry.name)) {
        this.#imageRequested.add(entry.name)
        void this.#resolveImage(entry.name, entry.segments)
      }
      void this.#resolveTags(entry.name, entry.segments)
      void this.#resolveTitle(entry.name, entry.segments)
    }

    return entries.map(entry => ({
      key: entry.name,
      label: this.#titles.get(entry.name) || entry.name,
      segments: entry.segments,
      image: this.#images.get(entry.name),
      tags: this.#tags.get(entry.name),
    }))
  }

  /** Where the collection behind index child `name` actually LIVES.
   *
   *  The index entry is a REFERENCE, so the answer comes from its `reference`
   *  decoration — which is what lets a collection be ANY tile at any depth
   *  rather than only a top-level root. Entries written before that (a bare
   *  `{name}` stub) fall back to `[name]`: the variable-root hop the whole
   *  index used to assume. Read both shapes, write only the new one — nothing
   *  to migrate. */
  async #targetOf(name: string): Promise<readonly string[]> {
    const svc = ioc()?.get('@diamondcoreprocessor.com/DecorationService') as DecorationServiceLike | undefined
    if (!svc?.list) return [name]
    try {
      const rows = await svc.list<{ targetSegments?: unknown }>({
        kind: REFERENCE_KIND,
        segments: [SETS, name],
      })
      for (const row of rows) {
        const raw = row.record.payload?.targetSegments
        if (!Array.isArray(raw)) continue
        const segs = raw.map(s => String(s ?? '')).filter(Boolean)
        if (segs.length) return segs
      }
    } catch { /* unreadable decoration — fall through to the legacy shape */ }
    return [name]
  }

  open(item: AggregateItem): void {
    ;(ioc()?.get('@hypercomb.social/Navigation') as NavigationLike | undefined)?.goRaw?.(item.segments)
  }

  /** Removal is INDEX-ONLY — it splices a reference out of `sets/` and never
   *  touches the collection itself, so there is nothing to protect against and
   *  no reason to gate on emptiness. (The old empty-only rule existed because
   *  an entry WAS the collection; now it is a pointer at one.) Taking a
   *  populated tile back out of the index is the ordinary case. */
  canRemove(): boolean { return true }

  /** Add already-existing tiles to the index — the gesture that makes "any tile
   *  can be a collection" real.
   *
   *  Each becomes a REFERENCE under `sets/` pointing at where it already lives.
   *  Nothing is moved, copied or converted: the tile stays exactly where it is
   *  and simply gains an appearance here. That is why depth doesn't matter and
   *  why a tile with no children qualifies — an empty collection is a page with
   *  nothing in it yet.
   *
   *  ONE pulse for the whole batch, at the end. The references are independent
   *  writes but they are a single gesture, and a pulse repaints the entire hive —
   *  so pulsing per entry made a five-tile Add cost five repaints that nobody
   *  ever saw, each one blocking the next write. */
  async add(entries: readonly StagedEntry[], into?: AggregateItem): Promise<AddedRows> {
    // No destination → the entries join the INDEX, i.e. they become collections.
    // A destination → they are gathered INTO that collection. One code path:
    // the only thing that differs is which parent the reference lands under.
    const parent = into ? into.segments : [SETS]
    const written: AggregateItem[] = []
    for (const entry of entries) {
      if (!entry.segments.length) continue                       // the hive root is not a member
      if (!into && this.#entries.some(e => e.name === entry.label)) continue   // already indexed
      if (segmentsEqual(entry.segments, parent)) continue        // never reference yourself
      EffectBus.emit('cell:added', { cell: entry.label, segments: parent, viaUpdate: true })
      const name = await dropReferenceTile(
        { key: entry.label, label: entry.label, segments: entry.segments }, parent)
      if (name) written.push({ key: name, label: name, segments: entry.segments })
    }
    if (!written.length) return
    await new hypercomb().act()
    if (into) return   // these landed in a collection, not in this index
    await this.#syncCursorToHead()
    return written
  }

  /** MOVE the staged tiles into the collection being managed — custody, not an
   *  appearance. They leave the page they were on and live in here.
   *
   *  This is the other half of Add, and the half that was missing: Add writes a
   *  reference, so the tile stays where it is and merely gains a doorway. That is
   *  right for "this belongs in several places" and wrong for "put this away".
   *  Filing something is a MOVE, and until now nothing in the app could do it
   *  across pages — drag-onto-a-tile only reaches the page you are standing on.
   *
   *  The write is MoveDrone's one re-home primitive (the same act as Ctrl+drag
   *  onto a tile and `/into`), reached through IoC the way every write from this
   *  window is. Nothing is deleted: the moved subtree keeps its bytes, markers
   *  and history bag, so undo at either page puts it back.
   *
   *  Grouped by SOURCE PAGE, because a selection survives navigation: two staged
   *  tiles may well have been picked on two different pages, and each of those
   *  pages needs its own removal commit. */
  async move(entries: readonly StagedEntry[], into: AggregateItem): Promise<void> {
    const mover = ioc()?.get('@diamondcoreprocessor.com/MoveDrone') as MoveLike | undefined
    if (!mover?.commitMoveInto || !into.segments.length) return
    const groups = new Map<string, { parent: string[]; labels: string[] }>()
    for (const entry of entries) {
      if (!entry.segments.length) continue                        // the hive root is not a tile
      const parent = entry.segments.slice(0, -1).map(String)
      const label = String(entry.segments[entry.segments.length - 1])
      if (!label) continue
      // JSON, not a joined string: it needs no separator, so there is no character
      // a tile name could contain that would make two different pages look like one.
      const key = JSON.stringify(parent)
      const group = groups.get(key) ?? { parent, labels: [] }
      group.labels.push(label)
      groups.set(key, group)
    }
    // Sequentially: each group is two commits on the same lineage machine, and
    // the destination's own head has to settle before the next group appends to
    // it — concurrent groups would both read the pre-move head.
    for (const group of groups.values()) {
      await mover.commitMoveInto(group.labels, group.parent, into.segments)
    }
  }

  /** Make a brand-new collection from a typed name — the + on the search field.
   *
   *  Two writes, in this order:
   *    1. the ROOT itself — one marker in `sign([name])`'s own bag, so `/<name>`
   *       is a real place with a head rather than a path nothing has ever
   *       written to. It is PARENTLESS by construction: a single-segment
   *       location has no parent to be a child of.
   *    2. a reference to it under `sets/`, through the SAME dropReferenceTile
   *       every other way into this index uses — so nothing downstream can tell
   *       a created collection from an adopted one.
   *
   *  A name already in the index is a no-op: the row you asked for is there. */
  async create(name: string): Promise<AddedRows> {
    const cell = name.trim()
    if (!cell || this.#entries.some(e => e.name === cell)) return
    const h = history()
    if (!h?.sign || !h.commitLayer) return
    const rootSig = await h.sign({ explorerSegments: () => [cell] }).catch(() => '')
    if (!rootSig) return
    // Don't overwrite a root that already exists — /<name> may be a page the
    // participant already has; this only needs to guarantee it EXISTS.
    const existing = await h.currentLayerAt(rootSig).catch(() => null)
    if (!existing) await h.commitLayer(rootSig, { name: cell })
    EffectBus.emit('cell:added', { cell, segments: [SETS], viaUpdate: true })
    const added = await dropReferenceTile({ key: cell, label: cell, segments: [cell] }, [SETS])
    if (!added) return
    await new hypercomb().act()
    await this.#syncCursorToHead()
    return [{ key: added, label: added, segments: [cell] }]
  }

  async remove(item: AggregateItem): Promise<void> {
    const c = committer()
    const entry = this.#entries.find(e => e.name === item.key)
    if (!c?.commitChildrenDeltas || !entry) return
    EffectBus.emit('cell:removed', { cell: item.key, segments: [SETS], viaUpdate: true })
    // Splice by SIG. Re-listing the survivors by NAME would re-resolve every
    // sibling through the auto-minting name path — the mechanism that once
    // materialised launcher aggregates as real members of sets/, and which
    // would now overwrite each remaining reference with an empty husk.
    //
    // `label` rides along as the committer's sanctioned fallback for when our
    // view of the child sig lags the head — without it, a stale sig is a silent
    // no-op and the row just comes back.
    await c.commitChildrenDeltas([SETS], { removes: [{ sig: entry.sig, label: entry.name }] })
    await new hypercomb().act()
    await this.#syncCursorToHead()   // else the re-read can resurrect the row
    this.#forget(item.key)
  }

  /** Rename = a TITLE on the collection. The name is the address: it keys the
   *  history bag, the viewport, the substrate, the swarm channel and every
   *  inbound reference, so moving it strands all of them. A title changes what
   *  the row reads while the address stays put — one ordinary commit on the
   *  target, undoable and per-location like any other decoration.
   *
   *  This replaces the old re-home-the-history-into-a-new-root rename, which
   *  only ever made sense while a collection was forced to be a top-level root.
   *  A nested collection has no new root to move to, and needs none. */
  async rename(item: AggregateItem, next: string): Promise<void> {
    const svc = ioc()?.get('@diamondcoreprocessor.com/DecorationService') as DecorationServiceLike | undefined
    if (!svc?.setTitle) return
    const result = await svc.setTitle(item.segments, next).catch(() => 'noop' as const)
    if (result === 'duplicate') return
    await new hypercomb().act()
    this.#titles.set(item.key, next)
  }

  // ── per-item resolution ────────────────────────────────────────────────────

  async #resolveImage(name: string, segments: readonly string[]): Promise<void> {
    const h = history()
    const s = store()
    if (!h?.sign || !s?.getResource) { this.#imageRequested.delete(name); return }
    const sig = await this.#imageSig(segments) || await this.#imageSig([SETS, name])
    if (!sig) return
    const blob = await s.getResource(sig).catch(() => null)
    if (!blob) return
    const prev = this.#images.get(name)
    if (prev) URL.revokeObjectURL(prev)
    this.#images.set(name, URL.createObjectURL(blob))
    this.#announce()   // deduped by #imageRequested, so this fires once per name
  }

  async #imageSig(segments: readonly string[]): Promise<string> {
    const h = history()
    if (!h?.sign) return ''
    const loc = await h.sign({ explorerSegments: () => segments }).catch(() => '')
    if (!loc) return ''
    const layer = await h.currentLayerAt(loc).catch(() => null)
    const props = layer?.['properties']
    const first = Array.isArray(props) ? props[0] as Record<string, unknown> | undefined : undefined
    const small = first?.['small'] as Record<string, unknown> | undefined
    const img = small?.['image']
    return typeof img === 'string' && SIG.test(img) ? img : ''
  }

  /** The collection's display title, if it carries one for the active locale.
   *  Read from the TARGET — a rename titles the collection itself, never the
   *  index entry pointing at it. */
  async #resolveTitle(name: string, segments: readonly string[]): Promise<void> {
    const svc = ioc()?.get('@diamondcoreprocessor.com/DecorationService') as DecorationServiceLike | undefined
    if (!svc?.list) return
    const locale = document.documentElement.lang || 'en'
    try {
      const rows = await svc.list<{ text?: Record<string, string> }>({ kind: TITLE_KIND, segments })
      const prev = this.#titles.get(name)
      for (const row of rows) {
        const text = row.record.payload?.text?.[locale]
        // No cross-locale fallback: titling in English must not put English in
        // front of a Japanese reader — the untitled row shows its address.
        if (typeof text === 'string' && text.trim()) {
          const next = text.trim()
          this.#titles.set(name, next)
          if (next !== prev) this.#announce()
          return
        }
      }
      if (this.#titles.delete(name)) this.#announce()
    } catch { /* a title is decoration, never load-bearing */ }
  }

  async #resolveTags(name: string, segments: readonly string[]): Promise<void> {
    const svc = ioc()?.get('@diamondcoreprocessor.com/DecorationService') as DecorationServiceLike | undefined
    if (!svc?.list) return
    try {
      const rows = await svc.list<{ name?: string }>({ kind: TAG_KIND, segments })
      const names = new Set<string>()
      for (const r of rows) {
        const t = r.record.payload?.name
        if (typeof t === 'string' && t.trim()) names.add(t.trim())
      }
      const next = [...names].sort((a, b) => a.localeCompare(b))
      const prev = this.#tags.get(name) ?? []
      this.#tags.set(name, next)
      // Only when it actually moved — an unconditional announce would make every
      // re-read cause the next one.
      if (prev.length !== next.length || next.some((t, i) => t !== prev[i])) this.#announce()
    } catch { /* tags are decoration, never load-bearing */ }
  }

  /** After a commit here, re-bind the cursor to the fresh head so it picks up
   *  the new marker and any rewound state clears. Only meaningful while the
   *  participant is standing on the index; show-cell owns the cursor otherwise.
   *
   *  AWAITED, because `#readSetsLayer` reads the index THROUGH this cursor: left
   *  detached, the re-read that follows a write can resolve against the cursor's
   *  previous position and answer without the child just committed — so the row
   *  would appear and then vanish as the authoritative list replaced it. */
  async #syncCursorToHead(): Promise<void> {
    const cursor = ioc()?.get('@diamondcoreprocessor.com/HistoryCursorService') as
      { load?: (sig: string) => Promise<void> | void } | undefined
    if (!cursor?.load || !this.#setsSig) return
    try { await cursor.load(this.#setsSig) } catch { /* head fallback */ }
  }

  #forget(name: string): void {
    const url = this.#images.get(name)
    if (url) URL.revokeObjectURL(url)
    this.#images.delete(name)
    this.#imageRequested.delete(name)
    this.#tags.delete(name)
    this.#titles.delete(name)
  }

  #forgetAllBut(names: readonly string[]): void {
    const keep = new Set(names)
    for (const name of [...this.#images.keys()]) if (!keep.has(name)) this.#forget(name)
  }
}

registerAggregateSource(new CollectionsSource())
