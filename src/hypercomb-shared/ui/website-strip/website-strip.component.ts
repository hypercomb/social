// hypercomb-shared/ui/website-strip/website-strip.component.ts
//
// The website launcher — a small strip of site icons pinned to the top of the
// screen, present in BOTH render modes so you can jump to any site anytime
// from anywhere. Clicking an icon navigates the lineage to that site's ROOT
// cell and flips into website mode, so the site renders from its home page.
//
// Discovery walks the layer tree (via HistoryService, the same traversal
// `/website list` uses) looking for the topmost page-bearing cell on each
// branch — the site root — and reads its `visual:website:page` decoration
// payload for the site's own icon + label (the same identity the command-line
// toggle and the bottom-right exit FAB wear). Once a root is found we stop
// descending: the whole site is one launcher entry, not one per sub-page.
//
// Shell UI: it NEVER imports essentials. HistoryService / Store / Navigation /
// ViewMode are resolved at call time through window.ioc; the walk re-runs
// (debounced) whenever decorations change or a branch is adopted.

import { Component, OnDestroy, signal } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

const get = (key: string): any => (globalThis as { ioc?: { get(k: string): unknown } }).ioc?.get(key)

const SIG = /^[0-9a-f]{64}$/
const PAGE_KIND = 'visual:website:page'
/** Depth guard for the discovery walk — matches the build drone's MAX_DEPTH. */
const MAX_DEPTH = 24
const SITE = 'website'

type Site = {
  segments: string[]
  label: string
  /** Material Symbols ligature — the site's own glyph (or `web` fallback). */
  icon: string
  /** Stable @for track id. */
  key: string
}

type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<{ decorations?: unknown; children?: unknown; website?: unknown } | null>
  getLayerBySig(sig: string): Promise<{ name?: unknown } | null>
}
type StoreLike = { getResource(sig: string): Promise<Blob | null> }
type NavigationLike = { goRaw?: (segments: readonly string[]) => void }
type ViewModeLike = { setMode(next: string): void }

@Component({
  selector: 'hc-website-strip',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './website-strip.component.html',
  styleUrls: ['./website-strip.component.scss'],
})
export class WebsiteStripComponent implements OnDestroy {
  readonly sites = signal<Site[]>([])

  #unsubs: (() => void)[] = []
  #debounce: ReturnType<typeof setTimeout> | null = null
  #scanning = false

  constructor() {
    // First scan shortly after boot (let HistoryService/Store register), then
    // re-scan whenever the set of sites could have changed.
    this.#scheduleScan(400)
    this.#unsubs.push(
      EffectBus.on('decorations:changed', () => this.#scheduleScan()),
      EffectBus.on('adopt:done', () => this.#scheduleScan()),
    )
  }

  ngOnDestroy(): void {
    if (this.#debounce) clearTimeout(this.#debounce)
    for (const u of this.#unsubs) { try { u() } catch { /* noop */ } }
  }

  // ── click → go to the site root + render it ──────────────

  open(site: Site): void {
    const nav = get('@hypercomb.social/Navigation') as NavigationLike | undefined
    // Navigate first (synchronous dispatch updates the lineage) so the site
    // renderer captures THIS site's root as the entry floor when the surface
    // flips.
    nav?.goRaw?.(site.segments)
    const vm = get('@hypercomb.social/ViewMode') as ViewModeLike | undefined
    vm?.setMode?.(SITE)
  }

  // ── discovery ────────────────────────────────────────────

  #scheduleScan(delay = 450): void {
    if (this.#debounce) clearTimeout(this.#debounce)
    this.#debounce = setTimeout(() => { this.#debounce = null; void this.#scan() }, delay)
  }

  async #scan(): Promise<void> {
    if (this.#scanning) return
    this.#scanning = true
    try {
      const history = get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
      const store = get('@hypercomb.social/Store') as StoreLike | undefined
      if (!history || !store?.getResource) { this.#scheduleScan(700); return }   // boot not ready — retry
      this.sites.set(await findWebsiteSites(history, store))
    } finally {
      this.#scanning = false
    }
  }
}

/** Walk the tree from the hive root, returning one entry per SITE ROOT (the
 *  topmost page-bearing cell on each branch). Stops descending once a root is
 *  found — the site is a single launcher entry, not one per sub-page. */
async function findWebsiteSites(history: HistoryLike, store: StoreLike): Promise<Site[]> {
  const out: Site[] = []
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
      out.push({ segments: [...segments], label, icon: site.icon || 'web', key: JSON.stringify(segments) })
      return   // site root found — the whole site is one entry; don't descend
    }
    for (const name of await childNames(layer)) await walk([...segments, name], depth - 1)
  }

  await walk([], MAX_DEPTH)
  return out.sort((a, b) => a.label.localeCompare(b.label))
}
