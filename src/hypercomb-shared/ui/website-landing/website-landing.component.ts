// hypercomb-shared/ui/website-landing/website-landing.component.ts
//
// Professional "Websites" landing page — the websites group's launcher surface.
// Instead of floating Pixi launcher tiles, the websites group presents a clean,
// clickable directory of every site in the hive. Clicking a card opens that site
// EXACTLY as a launcher tile did (WebsitesGroup.open → navigate + website mode),
// so routing is unchanged.
//
// It shows only when the participant is actually IN the websites launcher: the
// shared aggregator location is current AND websites is the sole enabled group
// (mutually-exclusive selection). Gating on the location — not just the enabled
// flag — keeps it from popping over the hive on boot, since the aggregator is
// never auto-entered at init (stillness rule).
//
// Self-registers as a shell surface (no app.html edit, no web/dev drift).
// Shell-level: resolves Lineage through the global ioc at call time; the group
// registry is a shared singleton. Never imports essentials.

import { Component, OnDestroy, signal } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { groupRegistry, type GroupMember } from '../../core/group-registry'
import { registerShellSurface } from '../../core/shell-surface-registry'

/** The websites group's page is its OWN root location, /websites — the group
 *  id IS the segment (see mixed-group-bag.ts). */
const WEBSITES = 'websites'

type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }
type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<Record<string, unknown> | null>
  getLayerBySig?(sig: string): Promise<Record<string, unknown> | null>
}
type StoreLike = {
  getResource(sig: string): Promise<Blob | null>
  preheatResource(sig: string): Promise<Blob | null>
}
const SIG = /^[0-9a-f]{64}$/
/** Decoration kind carrying a generated site page (payload.htmlSig). */
const PAGE_KIND = 'visual:website:page'
const ioc = (): { get(k: string): unknown } | undefined =>
  (globalThis as { ioc?: { get(k: string): unknown } }).ioc

@Component({
  selector: 'hc-website-landing',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './website-landing.component.html',
  styleUrls: ['./website-landing.component.scss'],
})
export class WebsiteLandingComponent implements OnDestroy {
  readonly sites = signal<GroupMember[]>([])
  readonly open = signal(false)
  /** site.key → object URL of the site's representative tile image. Resolved
   *  asynchronously once the surface opens (each site's own hex-tile picture,
   *  or a child tile's), so cards show real imagery from the hive. Revoked on
   *  destroy. */
  readonly images = signal<ReadonlyMap<string, string>>(new Map())

  #lineage: LineageLike | null = null
  #lineageBound = false
  /** Tracks the open/closed transition so the Pixi hive is hidden only while the
   *  landing actually owns the screen — and reliably restored when it doesn't. */
  #hidHive = false
  /** Sites whose page has already been warmed (hover prewarm), so re-hovering is
   *  a no-op. */
  #warmed = new Set<string>()
  /** Live image object URLs (held for revocation) and the set of sites whose
   *  image resolution has already been kicked off (dedupe across refreshes). */
  #imageUrls = new Map<string, string>()
  #imageRequested = new Set<string>()
  #onChange = (): void => this.#refresh()

  constructor() {
    groupRegistry.addEventListener('change', this.#onChange)
    window.addEventListener('keydown', this.#onKey, true)
    this.#ensureLineage()
    this.#refresh()
  }

  ngOnDestroy(): void {
    groupRegistry.removeEventListener('change', this.#onChange)
    this.#lineage?.removeEventListener?.('change', this.#onChange)
    window.removeEventListener('keydown', this.#onKey, true)
    if (this.#hidHive) EffectBus.emit('render:set-hive-visible', { visible: true })
    for (const url of this.#imageUrls.values()) URL.revokeObjectURL(url)
  }

  /** Deterministic per-site accent (hue from the name) — gives each card its own
   *  identity tint, the same idea as the hive's label-derived tile colours. */
  accent(label: string): string {
    let h = 5381
    for (let i = 0; i < label.length; i++) h = ((h << 5) + h + label.charCodeAt(i)) | 0
    return `hsl(${(h >>> 0) % 360} 68% 66%)`
  }

  /** Hover a card → warm that site's PAGE in the background so the click opens it
   *  instantly (today the page HTML is a cold read on first open). Reads the
   *  site's layer head (currentLayerAt — read-only, no navigation), finds its
   *  HTML sig (the first-class `website` slot, else a `visual:website:page`
   *  decoration — the same places SiteViewDrone looks), and preheats that blob
   *  into the Store cache (= exactly what the renderer fetches on mount).
   *  Best-effort and deduped per site. */
  warmSite(site: GroupMember): void {
    if (this.#warmed.has(site.key)) return
    this.#warmed.add(site.key)
    void this.#warmSite(site)
  }

  async #warmSite(site: GroupMember): Promise<void> {
    const history = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
    const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
    if (!history?.sign || !store?.preheatResource) return
    const locSig = await history.sign({ explorerSegments: () => site.segments }).catch(() => '')
    if (!locSig) return
    const layer = await history.currentLayerAt(locSig).catch(() => null)
    if (!layer) return

    // First-class `website` slot wins (newest = current page); else scan the
    // cell's decorations for the generated-page record.
    let htmlSig = ''
    const slot = layer['website']
    if (Array.isArray(slot)) {
      const sigs = slot.map(s => String(s)).filter(s => SIG.test(s))
      if (sigs.length) htmlSig = sigs[sigs.length - 1]
    }
    if (!htmlSig && Array.isArray(layer['decorations'])) {
      for (const d of layer['decorations'] as unknown[]) {
        const dsig = String(d)
        if (!SIG.test(dsig)) continue
        const blob = await store.getResource(dsig).catch(() => null)
        if (!blob) continue
        try {
          const rec = JSON.parse(await blob.text()) as { kind?: string; payload?: { htmlSig?: string } }
          const h = rec?.payload?.htmlSig
          if (rec?.kind === PAGE_KIND && typeof h === 'string' && SIG.test(h)) { htmlSig = h; break }
        } catch { /* malformed — skip */ }
      }
    }
    if (htmlSig) await store.preheatResource(htmlSig).catch(() => null)
  }

  /** Resolve a representative tile image for a site and publish its object URL.
   *  Best-effort, deduped per site. Reads the site root's tile properties the
   *  same way the hive renderer does (layer → `properties[0]` → JSON →
   *  `small.image`), falling back to the first child tile that carries an image
   *  so text-only site roots still show a picture. Shell-safe: window.ioc only. */
  async #resolveImage(site: GroupMember): Promise<void> {
    const history = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
    const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
    if (!history?.sign || !store?.getResource) { this.#imageRequested.delete(site.key); return }
    const imageSig = await this.#siteImageSig(site.segments, history, store)
    if (!imageSig) return
    const blob = await store.getResource(imageSig).catch(() => null)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    this.#imageUrls.set(site.key, url)
    this.images.set(new Map(this.#imageUrls))   // new map instance → signal fires
  }

  /** A site's picture sig: the root cell's own tile image, else the first child
   *  (by layer link) that has one. The child scan is bounded — sites are few
   *  and this runs on open, not on the render path. */
  async #siteImageSig(segments: readonly string[], history: HistoryLike, store: StoreLike): Promise<string> {
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
      const childLayer = history.getLayerBySig
        ? await history.getLayerBySig(csig).catch(() => null)
        : null
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

  /** Open a site — same routing as the launcher tile (navigate + website mode).
   *  The lineage leaves the aggregator, so this surface hides on the next tick. */
  openSite(site: GroupMember): void {
    groupRegistry.get(WEBSITES)?.open(site)
  }

  /** Close the directory — leave the aggregator (plain navigation back to the
   *  last real page), which hides this surface. */
  close(): void {
    groupRegistry.exitBag()
  }

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
    if (e.key === 'Escape' && this.open()) { e.preventDefault(); this.close() }
  }

  #refresh(): void {
    this.#ensureLineage()
    const segs = (this.#lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    // currentId() derives from the location (segs[0] === 'websites'), so the
    // one check covers icon clicks, cold reloads, and typed /websites alike.
    const active = segs.length === 1 && groupRegistry.currentId() === WEBSITES

    // Truly REPLACE the floating launcher (don't just cover it): hide the Pixi
    // hive mesh while the landing owns the screen, restore it when it doesn't.
    // Emit only on the transition so we never fight the screensaver's own use of
    // this effect frame-to-frame. (show-cell consumes render:set-hive-visible.)
    if (active !== this.#hidHive) {
      this.#hidHive = active
      EffectBus.emit('render:set-hive-visible', { visible: !active })
    }

    this.open.set(active)
    const members = active ? (groupRegistry.get(WEBSITES)?.members() ?? []) : []
    this.sites.set(members)

    // Resolve each site's tile image once the directory is showing. Deduped by
    // site key across refreshes; best-effort and off the render path.
    for (const site of members) {
      if (this.#imageRequested.has(site.key)) continue
      this.#imageRequested.add(site.key)
      void this.#resolveImage(site)
    }
  }
}

registerShellSurface({
  name: 'hc-website-landing',
  owner: '@hypercomb.shared/WebsiteLandingComponent',
  component: WebsiteLandingComponent,
  order: 60,
})
