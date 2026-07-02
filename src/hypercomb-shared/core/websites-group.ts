// hypercomb-shared/core/websites-group.ts
//
// The "websites" launch group — discovers every site root in the hive (the
// topmost cell on each branch carrying a `visual:website:page` decoration, or a
// first-class `website` slot) and surfaces them as group members. The discovery
// walk re-runs (debounced) whenever decorations change or a branch is adopted.
//
// Shell-level: HistoryService / Store / Navigation / ViewMode are resolved
// through window.ioc at call time (never imports essentials). The walk re-runs
// (debounced) whenever decorations change or a branch is adopted.

import { EffectBus } from '@hypercomb/core'
import { groupRegistry, type GroupMember } from './group-registry'
import { LaunchGroupBase } from './launch-group-base'

const SIG = /^[0-9a-f]{64}$/
const PAGE_KIND = 'visual:website:page'
/** Depth guard for the discovery walk — matches the build drone's MAX_DEPTH. */
const MAX_DEPTH = 24
const SITE = 'website'

type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<{ decorations?: unknown; children?: unknown; website?: unknown } | null>
  getLayerBySig(sig: string): Promise<{ name?: unknown } | null>
}
type StoreLike = { getResource(sig: string): Promise<Blob | null> }
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
    // First scan shortly after boot (let HistoryService/Store register), then
    // re-scan whenever the set of sites could have changed.
    this.#scheduleScan(400)
    EffectBus.on('decorations:changed', () => this.#scheduleScan())
    EffectBus.on('adopt:done', () => this.#scheduleScan())
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

  /** The site surface's on-screen state is the ViewMode: anything other than
   *  the hexagon canvas means it's up. EventTarget has no last-value replay,
   *  so prime by hand — arming from the website-landing directory (already in
   *  website mode) must start with the surface SEEN OPEN, or the eventual
   *  return to hexagons would not count as a close. */
  protected override watchSurface(_m: GroupMember, report: (open: boolean) => void): () => void {
    const vm = get<ViewModeLike>('@hypercomb.social/ViewMode')
    if (!vm?.addEventListener) return () => { /* no ViewMode yet — nothing to watch */ }
    const onChange = (): void => report((vm.mode ?? 'hexagons') !== 'hexagons')
    vm.addEventListener('change', onChange)
    onChange()
    return () => vm.removeEventListener('change', onChange)
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
      if (!history || !store?.getResource) { this.#scheduleScan(700); return }   // boot not ready — retry
      this.#members = await findWebsiteSites(history, store)
      groupRegistry.notifyChanged()
    } finally {
      this.#scanning = false
    }
  }
}

/** Walk the tree from the hive root, returning one member per SITE ROOT (the
 *  topmost page-bearing cell on each branch). Stops descending once a root is
 *  found — the site is a single launcher entry, not one per sub-page. */
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
   *  or `{}` for a first-class `website`-slot page (presence, no payload), or
   *  null when the cell carries no page. */
  const siteAt = async (
    layer: { decorations?: unknown; website?: unknown },
  ): Promise<{ icon: string; label: string } | null> => {
    const decos = Array.isArray(layer?.decorations) ? layer.decorations : []
    for (const entry of decos) {
      const sig = String(entry ?? '')
      if (!SIG.test(sig)) continue
      const blob = await store.getResource(sig).catch(() => null)
      if (!blob) continue
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
    return null
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
