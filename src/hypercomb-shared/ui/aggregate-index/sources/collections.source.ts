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
//   • create — the command line's `importTree` primitive
//   • rename — NOT a mutation. A cell is immutable + content-addressed, so this
//     RE-HOMES the same child sigs under a new root (no byte copy) and swaps the
//     sets/ membership. The old name's history stays intact, merely unreferenced.
//   • remove — index entry only, and only while the collection is EMPTY, so a
//     manage gesture can never silently drop content.
//
// Shell-level: every write goes through an IoC-resolved essentials service (the
// sanctioned route the command line uses). Never imports essentials.

import { EffectBus, hypercomb } from '@hypercomb/core'
import { registerAggregateSource, type AggregateItem, type AggregateSource } from '../aggregate-source'

const SETS = 'sets'
const TAG_KIND = 'tag'
const SIG = /^[0-9a-f]{64}$/

type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<Record<string, unknown> | null>
  getLayerBySig?(sig: string): Promise<Record<string, unknown> | null>
}
type StoreLike = { getResource(sig: string): Promise<Blob | null> }
type NavigationLike = { goRaw?: (segments: readonly string[]) => void }
type CommitterLike = {
  importTree?: (u: { segments: readonly string[]; layer: { name?: string } }[]) => Promise<void>
  update?: (
    segments: readonly string[],
    layer: { name?: string; [slot: string]: unknown },
    nameSlots?: ReadonlySet<string>,
  ) => Promise<string>
}
type DecorationServiceLike = {
  list<T>(o: { kind: string; segments: readonly string[] }): Promise<Array<{ sig: string; record: { payload?: T } }>>
}

const ioc = (): { get(k: string): unknown } | undefined =>
  (globalThis as { ioc?: { get(k: string): unknown } }).ioc

const history = () => ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
const committer = () => ioc()?.get('@diamondcoreprocessor.com/LayerCommitter') as CommitterLike | undefined
const store = () => ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined

class CollectionsSource implements AggregateSource {
  readonly id = 'collections'
  readonly icon = 'workspaces'
  readonly titleKey = 'collections-landing.title'
  readonly ledeKey = 'collections-landing.lede'
  readonly createKey = 'collections-landing.new'
  readonly activeAt = [SETS] as const

  /** name → object URL of its representative tile picture. Revoked when the
   *  name leaves the index. */
  readonly #images = new Map<string, string>()
  #imageRequested = new Set<string>()
  /** name → whether its root has no items yet (gates removal). */
  readonly #empty = new Map<string, boolean>()
  readonly #tags = new Map<string, readonly string[]>()
  #setsSig = ''
  /** The membership as last read — the ONLY list a write may be composed from. */
  #members: readonly string[] = []

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
    const names: string[] = []
    for (const raw of childSigs) {
      const sig = String(raw ?? '')
      if (!SIG.test(sig)) continue
      const child = h.getLayerBySig ? await h.getLayerBySig(sig).catch(() => null) : null
      const nm = child?.['name']
      if (typeof nm === 'string' && nm.length > 0) names.push(nm)
    }
    // Launch-group aggregates are NOT merged in any more. Each aggregate is its
    // own source with its own index now, so listing them here would be a second
    // representation of the same thing — and composing a write from a list that
    // contained them is exactly what used to materialise `games`/`help` as real
    // members of sets/ (`children` names auto-mint at commit).
    this.#members = names
    this.#forgetAllBut(names)

    for (const name of names) {
      if (!this.#imageRequested.has(name)) {
        this.#imageRequested.add(name)
        void this.#resolveImage(name)
      }
      void this.#resolveEmptiness(name)
      void this.#resolveTags(name)
    }

    return names.map(name => ({
      key: name,
      label: name,
      segments: [name],          // a set is its OWN root — the variable-root hop
      image: this.#images.get(name),
      tags: this.#tags.get(name),
    }))
  }

  open(item: AggregateItem): void {
    ;(ioc()?.get('@hypercomb.social/Navigation') as NavigationLike | undefined)?.goRaw?.(item.segments)
  }

  canRemove(item: AggregateItem): boolean { return this.#empty.get(item.key) === true }

  async create(name: string): Promise<void> {
    if (this.#members.includes(name)) return
    const c = committer()
    if (!c?.importTree) return
    EffectBus.emit('cell:added', { cell: name, segments: [SETS], viaUpdate: true })
    await c.importTree([{ segments: [SETS, name], layer: { name } }])
    await new hypercomb().act()
    this.#empty.set(name, true)          // brand new → empty → removable
    this.#syncCursorToHead()
  }

  async remove(item: AggregateItem): Promise<void> {
    if (!this.canRemove(item)) return
    const c = committer()
    if (!c?.update) return
    const next = this.#members.filter(n => n !== item.key)
    EffectBus.emit('cell:removed', { cell: item.key, segments: [SETS], viaUpdate: true })
    await c.update([SETS], { children: next })
    await new hypercomb().act()
    this.#syncCursorToHead()
    this.#forget(item.key)
  }

  /** Rename = MOVE the collection's history to a new signature pool. The new
   *  root references the SAME child sigs (no byte copy); the old name's history
   *  is left intact, immutable and merely unreferenced from the index. */
  async rename(item: AggregateItem, next: string): Promise<void> {
    if (this.#members.includes(next)) return   // name taken
    const c = committer()
    const h = history()
    if (!c?.update) return

    let childSigs: string[] = []
    if (h?.sign) {
      const rootSig = await h.sign({ explorerSegments: () => [item.key] }).catch(() => '')
      const root = rootSig ? await h.currentLayerAt(rootSig).catch(() => null) : null
      const raw = Array.isArray(root?.['children']) ? (root!['children'] as unknown[]) : []
      childSigs = raw.map(s => String(s ?? '')).filter(s => SIG.test(s))
    }

    const members = this.#members.map(n => n === item.key ? next : n)
    EffectBus.emit('cell:removed', { cell: item.key, segments: [SETS], viaUpdate: true })
    EffectBus.emit('cell:added', { cell: next, segments: [SETS], viaUpdate: true })
    // Re-home the items into the new root's signature pool (sigs, EMPTY nameSlots).
    if (childSigs.length) await c.update([next], { children: childSigs }, new Set<string>())
    await c.update([SETS], { children: members })
    await new hypercomb().act()
    this.#syncCursorToHead()
    this.#empty.set(next, childSigs.length === 0)
    this.#forget(item.key)
  }

  // ── per-item resolution ────────────────────────────────────────────────────

  async #resolveImage(name: string): Promise<void> {
    const h = history()
    const s = store()
    if (!h?.sign || !s?.getResource) { this.#imageRequested.delete(name); return }
    const sig = await this.#imageSig([name]) || await this.#imageSig([SETS, name])
    if (!sig) return
    const blob = await s.getResource(sig).catch(() => null)
    if (!blob) return
    const prev = this.#images.get(name)
    if (prev) URL.revokeObjectURL(prev)
    this.#images.set(name, URL.createObjectURL(blob))
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

  async #resolveEmptiness(name: string): Promise<void> {
    const h = history()
    if (!h?.sign) return
    const loc = await h.sign({ explorerSegments: () => [name] }).catch(() => '')
    const layer = loc ? await h.currentLayerAt(loc).catch(() => null) : null
    const kids = Array.isArray(layer?.['children']) ? (layer!['children'] as unknown[]) : []
    this.#empty.set(name, kids.length === 0)
  }

  async #resolveTags(name: string): Promise<void> {
    const svc = ioc()?.get('@diamondcoreprocessor.com/DecorationService') as DecorationServiceLike | undefined
    if (!svc?.list) return
    try {
      const rows = await svc.list<{ name?: string }>({ kind: TAG_KIND, segments: [name] })
      const names = new Set<string>()
      for (const r of rows) {
        const t = r.record.payload?.name
        if (typeof t === 'string' && t.trim()) names.add(t.trim())
      }
      this.#tags.set(name, [...names].sort((a, b) => a.localeCompare(b)))
    } catch { /* tags are decoration, never load-bearing */ }
  }

  /** After a commit here, re-bind the cursor to the fresh head so it picks up
   *  the new marker and any rewound state clears. Only meaningful while the
   *  participant is standing on the index; show-cell owns the cursor otherwise. */
  #syncCursorToHead(): void {
    const cursor = ioc()?.get('@diamondcoreprocessor.com/HistoryCursorService') as
      { load?: (sig: string) => unknown } | undefined
    if (cursor?.load && this.#setsSig) { try { void cursor.load(this.#setsSig) } catch { /* ignore */ } }
  }

  #forget(name: string): void {
    const url = this.#images.get(name)
    if (url) URL.revokeObjectURL(url)
    this.#images.delete(name)
    this.#imageRequested.delete(name)
    this.#empty.delete(name)
    this.#tags.delete(name)
  }

  #forgetAllBut(names: readonly string[]): void {
    const keep = new Set(names)
    for (const name of [...this.#images.keys()]) if (!keep.has(name)) this.#forget(name)
  }
}

registerAggregateSource(new CollectionsSource())
