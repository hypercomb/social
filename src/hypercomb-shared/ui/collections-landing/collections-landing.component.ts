// hypercomb-shared/ui/collections-landing/collections-landing.component.ts
//
// The "Collections" landing — the welcome page of the `sets/` layer, the sibling
// of the Websites landing (hc-website-landing) but for reference sets. Instead
// of dropping the participant onto a bare hive page, `sets/` opens a clean,
// centred directory: a title above, every existing collection as its own hex
// tile below, and a create row so a new referenceable collection is one line
// away. Clicking a collection portals to it.
//
// A collection (a reference set) is its OWN ROOT lineage — the `sets/` page is
// just the index of them (the VARIABLE-ROOT hop, see entrances-and-sets.md and
// tile-overlay.drone's sets branch). So a card click navigates to `/[name]`,
// never `/sets/[name]`, and a collection's picture is resolved from its root.
//
// Shows ONLY while the participant is AT the sets index (segments === ['sets']),
// mirroring the Websites landing's location gate — never over the hive on boot.
// Self-registers as a shell surface (no app.html edit, no web/dev drift) and
// resolves everything through the global ioc at call time. Never imports
// essentials — creation and navigation go through the same sanctioned IoC
// services the command line uses.

import { Component, OnDestroy, signal } from '@angular/core'
import { EffectBus, hypercomb } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { registerShellSurface } from '../../core/shell-surface-registry'

/** The reserved lineage that indexes every reference set. */
const SETS = 'sets'

type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }
type NavigationLike = { goRaw?: (segments: readonly string[]) => void; back?: () => void }
type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<Record<string, unknown> | null>
  getLayerBySig?(sig: string): Promise<Record<string, unknown> | null>
}
type StoreLike = { getResource(sig: string): Promise<Blob | null> }
/** The command line's create primitive — appends the membership child under the
 *  sets index. Read from IoC (essentials service); imports stay forbidden. */
type CommitterLike = {
  importTree?: (updates: { segments: readonly string[]; layer: { name?: string } }[]) => Promise<void>
}

const SIG = /^[0-9a-f]{64}$/
const BACKSLASH = String.fromCharCode(92)
/** Names become path segments — drop separators and control characters (mirrors
 *  the UNSAFE_CELL_NAME guard essentials uses). */
const safeCellName = (raw: string): string =>
  [...(raw ?? '')].filter(ch => ch !== '/' && ch !== BACKSLASH && ch.charCodeAt(0) > 31).join('').trim()

const ioc = (): { get(k: string): unknown } | undefined =>
  (globalThis as { ioc?: { get(k: string): unknown } }).ioc

@Component({
  selector: 'hc-collections-landing',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './collections-landing.component.html',
  styleUrls: ['./collections-landing.component.scss'],
})
export class CollectionsLandingComponent implements OnDestroy {
  /** Names of the reference sets under `sets/` (the collection index). */
  readonly collections = signal<readonly string[]>([])
  readonly open = signal(false)
  readonly creating = signal(false)
  /** collection name → object URL of its representative tile image (resolved
   *  from the collection's ROOT lineage). Revoked on destroy. */
  readonly images = signal<ReadonlyMap<string, string>>(new Map())

  #lineage: LineageLike | null = null
  #lineageBound = false
  /** Only hide the Pixi hive while the landing actually owns the screen, and
   *  reliably restore it when it doesn't. */
  #hidHive = false
  #imageUrls = new Map<string, string>()
  #imageRequested = new Set<string>()
  #onChange = (): void => this.#refresh()

  constructor() {
    window.addEventListener('keydown', this.#onKey, true)
    this.#ensureLineage()
    this.#refresh()
  }

  ngOnDestroy(): void {
    this.#lineage?.removeEventListener?.('change', this.#onChange)
    window.removeEventListener('keydown', this.#onKey, true)
    if (this.#hidHive) EffectBus.emit('render:set-hive-visible', { visible: true })
    for (const url of this.#imageUrls.values()) URL.revokeObjectURL(url)
  }

  /** Deterministic per-collection accent (hue from the name) — each card gets
   *  its own identity tint, the same idea as the hive's label-derived colours. */
  accent(label: string): string {
    let h = 5381
    for (let i = 0; i < label.length; i++) h = ((h << 5) + h + label.charCodeAt(i)) | 0
    return `hsl(${(h >>> 0) % 360} 62% 64%)`
  }

  /** Open a collection — the VARIABLE-ROOT hop: a set is its own root, so we
   *  travel to `/[name]`, not `/sets/[name]` (matches tile-overlay's sets
   *  branch and the collections home widget). */
  openCollection(name: string): void {
    const nav = ioc()?.get('@hypercomb.social/Navigation') as NavigationLike | undefined
    nav?.goRaw?.([name])
  }

  /** Reveal / hide the inline create field. */
  toggleCreate(): void {
    this.creating.update(v => !v)
  }

  /** Create a new referenceable collection: append the membership child under
   *  the `sets/` index via the same importTree primitive the command line uses,
   *  then pulse the processor. The new tile is shown optimistically — the hive
   *  is hidden here, so there is no incremental placement to reflect it, and a
   *  fresh index read can lag a just-made commit. The authoritative read runs on
   *  the next open. */
  async create(input: HTMLInputElement): Promise<void> {
    const name = safeCellName(input.value)
    if (!name) { input.focus(); return }
    if (!this.collections().includes(name)) {
      const committer = ioc()?.get('@diamondcoreprocessor.com/LayerCommitter') as CommitterLike | undefined
      if (!committer?.importTree) return
      try {
        EffectBus.emit('cell:added', { cell: name, segments: [SETS], viaUpdate: true })
        await committer.importTree([{ segments: [SETS, name], layer: { name } }])
        await new hypercomb().act()
      } catch { return }   // commit failed — leave the field intact to retry
      // Show it now (a brand-new collection has no picture yet → fallback hex).
      this.collections.update(list => list.includes(name) ? list : [...list, name])
    }
    input.value = ''
    this.creating.set(false)
  }

  /** Close the directory — step back out of the sets index (plain navigation),
   *  which drops segments below ['sets'] and hides this surface. */
  close(): void {
    const nav = ioc()?.get('@hypercomb.social/Navigation') as NavigationLike | undefined
    if (nav?.back) nav.back()
    else nav?.goRaw?.([])
  }

  // ── image resolution — the collection's own tile picture (root lineage) ─────

  /** Resolve a representative image for a collection and publish its object URL.
   *  A set is its own root, so we read the ROOT layer (`[name]`) — the same
   *  `small.image` the hex renderer draws — falling back to the first child tile
   *  that carries one, so a text-only collection root still shows a picture.
   *  Best-effort and deduped per name. Shell-safe: window.ioc only. */
  async #resolveImage(name: string): Promise<void> {
    const history = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
    const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
    if (!history?.sign || !store?.getResource) { this.#imageRequested.delete(name); return }
    const imageSig = await this.#collectionImageSig([name], history, store)
    if (!imageSig) return
    const blob = await store.getResource(imageSig).catch(() => null)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    this.#imageUrls.set(name, url)
    this.images.set(new Map(this.#imageUrls))   // new map instance → signal fires
  }

  async #collectionImageSig(segments: readonly string[], history: HistoryLike, store: StoreLike): Promise<string> {
    const locSig = await history.sign({ explorerSegments: () => segments }).catch(() => '')
    if (!locSig) return ''
    const layer = await history.currentLayerAt(locSig).catch(() => null)
    if (!layer) return ''
    const own = await this.#imageSigFromLayer(layer, store)
    if (own) return own
    const children = Array.isArray(layer['children']) ? (layer['children'] as unknown[]) : []
    let scanned = 0
    for (const entry of children) {
      if (scanned >= 16) break
      const csig = String(entry ?? '')
      if (!SIG.test(csig)) continue
      scanned++
      const childLayer = history.getLayerBySig ? await history.getLayerBySig(csig).catch(() => null) : null
      if (!childLayer) continue
      const img = await this.#imageSigFromLayer(childLayer, store)
      if (img) return img
    }
    return ''
  }

  /** Pull a tile image sig out of a layer's properties blob — the same
   *  `small.image` (point-top hex thumbnail) the hex renderer reads, with the
   *  flat-orientation thumbnail and the full-size image as fallbacks. */
  async #imageSigFromLayer(layer: Record<string, unknown>, store: StoreLike): Promise<string> {
    const propsArr = layer['properties']
    const propSig = Array.isArray(propsArr) ? String(propsArr[0] ?? '') : ''
    if (!SIG.test(propSig)) return ''
    const blob = await store.getResource(propSig).catch(() => null)
    if (!blob) return ''
    try {
      const props = JSON.parse(await blob.text()) as {
        small?: { image?: unknown }
        flat?: { small?: { image?: unknown } }
        large?: { image?: unknown }
      }
      const sig = props?.small?.image ?? props?.flat?.small?.image ?? props?.large?.image
      return (typeof sig === 'string' && SIG.test(sig)) ? sig : ''
    } catch { return '' }
  }

  // ── membership index — the names under `sets/` ──────────────────────────────

  /** Read the collection names from the `sets/` layer's `children` (each child's
   *  `name`). Inlines the essentials `childNamesOf` walk — shared can't import
   *  it — reading through the parent's children (the authoritative membership
   *  path the renderer uses). */
  async #loadCollections(): Promise<void> {
    const history = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
    if (!history?.sign) { this.collections.set([]); return }
    const locSig = await history.sign({ explorerSegments: () => [SETS] }).catch(() => '')
    const layer = locSig ? await history.currentLayerAt(locSig).catch(() => null) : null
    const childSigs = Array.isArray(layer?.['children']) ? (layer!['children'] as unknown[]) : []
    const names: string[] = []
    for (const sig of childSigs) {
      const csig = String(sig ?? '')
      if (!SIG.test(csig)) continue
      const child = history.getLayerBySig ? await history.getLayerBySig(csig).catch(() => null) : null
      const nm = child?.['name']
      if (typeof nm === 'string' && nm.length > 0) names.push(nm)
    }
    this.collections.set(names)

    // Resolve each collection's picture once, deduped across refreshes.
    for (const name of names) {
      if (this.#imageRequested.has(name)) continue
      this.#imageRequested.add(name)
      void this.#resolveImage(name)
    }
  }

  // ── activation / lifecycle ──────────────────────────────────────────────────

  // Lineage may not be registered at construction; resolve + bind lazily.
  #ensureLineage(): void {
    if (this.#lineageBound) return
    const l = ioc()?.get('@hypercomb.social/Lineage') as LineageLike | undefined
    if (l?.addEventListener) {
      this.#lineage = l
      l.addEventListener('change', this.#onChange)
      this.#lineageBound = true
    }
  }

  #onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.open()) return
    // Escape closes the create field first, then the whole surface.
    e.preventDefault()
    if (this.creating()) this.creating.set(false)
    else this.close()
  }

  #refresh(): void {
    this.#ensureLineage()
    const segs = (this.#lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const active = segs.length === 1 && segs[0] === SETS

    // Replace the floating hive (don't just cover it): hide the Pixi mesh while
    // the landing owns the screen, restore it when it doesn't. Emit only on the
    // transition so we never fight the screensaver frame-to-frame.
    if (active !== this.#hidHive) {
      this.#hidHive = active
      EffectBus.emit('render:set-hive-visible', { visible: !active })
    }

    this.open.set(active)
    if (active) void this.#loadCollections()
    else { this.collections.set([]); this.creating.set(false) }
  }
}

registerShellSurface({
  name: 'hc-collections-landing',
  owner: '@hypercomb.shared/CollectionsLandingComponent',
  component: CollectionsLandingComponent,
  order: 61,
})
