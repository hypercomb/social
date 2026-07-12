// hypercomb-shared/core/websites-group.ts
//
// The "websites" launch group — surfaces the participant's registered sites
// as group members. Membership is the sign('websites:menu') POOL OF MEANING
// (websites-pool.ts): declared truth, curated by the participant, never
// derived from tree structure at read time.
//
// The old decoration-walk discovery survives ONLY as a one-time seed: on a
// profile whose pool has never been seeded, the walk runs once (topmost
// page-bearing cell per branch), folds its findings into the pool, and marks
// the seed done. After that, membership changes only through:
//   - a `website:build` event (a site built/upgraded at a scope registers it)
//   - explicit curation (the landing page's remove affordance, pool API)
// Adopting or copying a page-stamped subtree does NOT touch the menu —
// membership is extrinsic and stays with the participant who declared it.
//
// Shell-level: HistoryService / Store / Navigation / ViewMode are resolved
// through window.ioc at call time (never imports essentials).

import { EffectBus } from '@hypercomb/core'
import { groupRegistry, type GroupMember } from './group-registry'
import { LaunchGroupBase } from './launch-group-base'
import { enableWebsite, isSeeded, listWebsites, markSeeded } from './websites-pool'

const SIG = /^[0-9a-f]{64}$/
const PAGE_KIND = 'visual:website:page'
/** Depth guard for the seed walk — matches the build drone's MAX_DEPTH. */
const MAX_DEPTH = 24
const SITE = 'website'

type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<{ decorations?: unknown; children?: unknown; website?: unknown } | null>
  getLayerBySig(sig: string): Promise<{ name?: unknown } | null>
}
type StoreLike = {
  getResource(sig: string): Promise<Blob | null>
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
}
type NavigationLike = { goRaw?: (segments: readonly string[]) => void }
type ViewModeLike = EventTarget & { mode?: string; setMode(next: string): void }

class WebsitesGroup extends LaunchGroupBase {
  override readonly id = 'websites'
  override readonly icon = 'language'
  override readonly label = 'Websites'
  readonly shape = 'flower-pot'

  #members: GroupMember[] = []
  #debounce: ReturnType<typeof setTimeout> | null = null
  #scanning = false

  constructor() {
    super()
    // First read shortly after boot (let HistoryService/Store register), then
    // re-read whenever the pool changes.
    this.#scheduleScan(400)
    EffectBus.on('websites:changed', () => this.#scheduleScan())
    // A site build/upgrade at a scope IS a declaration — enable its root.
    // One history item in the pool (deduped at head); the append emits
    // websites:changed, which refreshes the members.
    EffectBus.on<{ scope?: string; scopeSegments?: string[] }>('website:build', p => {
      const segs = (p?.scopeSegments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
      if (p?.scope === 'root' || segs.length === 0) return   // '/' is not a menu entry
      void enableWebsite(segs)
    })
  }

  override members(): GroupMember[] { return this.#members }

  protected override activate(m: GroupMember): void {
    const nav = get<NavigationLike>('@hypercomb.social/Navigation')
    // Navigate first (synchronous dispatch updates the lineage) so the site
    // renderer captures THIS site's root as the entry floor when the surface
    // flips.
    nav?.goRaw?.(m.segments)
    const vm = get<ViewModeLike>('@hypercomb.social/ViewMode')
    vm?.setMode?.(SITE)
  }

  #scheduleScan(delay = 450): void {
    if (this.#debounce) clearTimeout(this.#debounce)
    this.#debounce = setTimeout(() => { this.#debounce = null; void this.#scan() }, delay)
  }

  async #scan(): Promise<void> {
    if (this.#scanning) return
    this.#scanning = true
    try {
      const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
      const store = get<StoreLike>('@hypercomb.social/Store')
      if (!history || !store?.getResource || !store?.getPool) { this.#scheduleScan(700); return }   // boot not ready — retry

      // One-time migration: fold the legacy decoration walk into the pool —
      // one enable history item per discovered site root.
      if (!(await isSeeded())) {
        const legacy = await findWebsiteSites(history, store)
        for (const m of legacy) await enableWebsite(m.segments, { label: m.label, icon: m.icon }, { silent: true })
        await markSeeded()
      }

      this.#members = (await listWebsites())
        .map(r => ({
          key: JSON.stringify(r.segments),
          label: r.label || r.segments[r.segments.length - 1],
          segments: r.segments,
          icon: r.icon || 'web',
        }))
        .sort((a, b) => a.label.localeCompare(b.label))
      groupRegistry.notifyChanged()
    } finally {
      this.#scanning = false
    }
  }
}

/** SEED WALK (one-time, per profile). Walk the tree from the hive root,
 *  returning one member per SITE ROOT (the topmost page-bearing cell on each
 *  branch). Stops descending once a root is found. A cell whose decorations
 *  cannot all be resolved is OPAQUE: it is neither classified as a site nor
 *  descended into — a missing blob must not promote a site's sub-pages into
 *  the menu (the availability fall-through that polluted the directory). */
async function findWebsiteSites(history: HistoryLike, store: StoreLike): Promise<GroupMember[]> {
  const out: GroupMember[] = []
  const visited = new Set<string>()

  const childNames = async (layer: { children?: unknown }): Promise<string[]> => {
    const children = Array.isArray(layer?.children) ? layer.children : []
    const names: string[] = []
    for (const entry of children) {
      const s = String(entry ?? '').trim()
      if (!s) continue
      if (SIG.test(s)) {
        const child = await history.getLayerBySig(s).catch(() => null)
        const n = child?.name
        if (typeof n === 'string' && n) names.push(n)
      } else {
        names.push(s)
      }
    }
    return names
  }

  /** A site's identity at this cell: its page-decoration payload (icon/label),
   *  `{}` for a first-class `website`-slot page, `'opaque'` when a decoration
   *  sig failed to resolve (classification unknowable — prune the branch), or
   *  null when the cell provably carries no page. */
  const siteAt = async (
    layer: { decorations?: unknown; website?: unknown },
  ): Promise<{ icon: string; label: string } | 'opaque' | null> => {
    const decos = Array.isArray(layer?.decorations) ? layer.decorations : []
    let unresolved = false
    for (const entry of decos) {
      const sig = String(entry ?? '')
      if (!SIG.test(sig)) continue
      const blob = await store.getResource(sig).catch(() => null)
      if (!blob) { unresolved = true; continue }
      try {
        const rec = JSON.parse(await blob.text()) as { kind?: string; payload?: { icon?: unknown; label?: unknown } }
        if (rec?.kind === PAGE_KIND) {
          const p = rec.payload ?? {}
          return {
            icon: typeof p.icon === 'string' ? p.icon.trim() : '',
            label: typeof p.label === 'string' ? p.label.trim() : '',
          }
        }
      } catch { /* malformed — skip */ }
    }
    const slot = layer?.website
    if (Array.isArray(slot) && slot.some(s => SIG.test(String(s)))) return { icon: '', label: '' }
    return unresolved ? 'opaque' : null
  }

  const walk = async (segments: string[], depth: number): Promise<void> => {
    if (depth < 0) return
    const key = segments.join('/')
    if (visited.has(key)) return
    visited.add(key)
    const locSig = await history.sign({ explorerSegments: () => segments }).catch(() => null)
    if (!locSig) return
    const layer = await history.currentLayerAt(locSig).catch(() => null)
    if (!layer) return
    const site = await siteAt(layer)
    if (site === 'opaque') return   // unknowable — never promote sub-pages
    if (site) {
      const label = site.label || (segments.length ? segments[segments.length - 1] : '/')
      out.push({ key: JSON.stringify(segments), label, segments: [...segments], icon: site.icon || 'web' })
      return   // site root found — the whole site is one entry; don't descend
    }
    for (const name of await childNames(layer)) await walk([...segments, name], depth - 1)
  }

  await walk([], MAX_DEPTH)
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

groupRegistry.register(new WebsitesGroup())
