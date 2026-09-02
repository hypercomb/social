import { installMemoryFilesystem } from './setup/memory-filesystem'
import { installReadonlyNetwork } from './setup/readonly-network'

interface SiteDescriptor {
  head?: string
  hosts?: string[]
  icon?: string
  lineage?: string
  pubkey?: string
  segments?: string[]
  title?: string
}

const SIG_RE = /^[a-f0-9]{64}$/

// ── the tab mark ───────────────────────────────────────────────────────────
// index.visitor.html already carries the Hypercomb hexagon, so every
// published door has a mark by default. A site that brings its OWN says so
// with `site.icon`: a SAME-ORIGIN absolute path, in practice a
// content-addressed `/<sig>/name.svg` the host serves from the creation's own
// heap with the type the suffix declares.
//
// Off-origin icons are refused rather than fetched. An icon is a request
// every single visit makes, and handing a third party the visitor's IP, UA
// and Referer that often is exactly what documentation/no-third-party-
// requests.md forbids. The visitor CSP (img-src 'self' data: blob:) would
// block it regardless — refusing here keeps the mark instead of trading it
// for nothing.
const ICON_TYPES: Record<string, string> = {
  svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon',
  gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
}

const applySiteIcon = (icon: string): void => {
  const href = icon.trim()
  if (!href.startsWith('/') || href.startsWith('//')) {
    console.warn('[visitor] site icon ignored — not a same-origin absolute path:', href)
    return
  }
  const type = ICON_TYPES[href.slice(href.lastIndexOf('.') + 1).toLowerCase()]
  // Replace, never append: browsers pick among the links they are given, and
  // a leftover hexagon would win on some of them.
  for (const link of Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]'))) {
    link.remove()
  }
  const mark = document.createElement('link')
  mark.rel = 'icon'
  mark.href = href
  if (type) mark.type = type
  document.head.appendChild(mark)
  // iOS flattens the home-screen icon and will not take an SVG.
  if (type === 'image/png') {
    const touch = document.createElement('link')
    touch.rel = 'apple-touch-icon'
    touch.href = href
    document.head.appendChild(touch)
  }
}

installMemoryFilesystem()
installReadonlyNetwork()

// The standard boot graph is deliberately imported only after the OPFS gate
// above is installed. It loads the same verified core and render path as the
// participant shell, but every filesystem operation lands in session memory.
const { EffectBus } = await import('@hypercomb/core')

// ── the loading dot owns the screen until the SITE is on it ────────────────
// `.site-loading` starts inside <app-root>, which Angular REPLACES at
// bootstrap (~1.4s) — a beat before the published view mounts (~3s). That gap
// showed the hive's own visuals (background rings, the empty prompt) between
// the dot and the page. Re-parent the loader to <body> so it survives
// bootstrap, and take it down only when the deployed experience is up:
//   • pinned view (view:arrival names a view) → when the body is COVERED by
//     the takeover surface (body.hc-view-covered — the same signal that
//     neutralises the canvas), so the ground under the fade is the themed
//     body, never hexagons;
//   • hexagons site (empty verdict) → when real tiles land (count>0), or the
//     location is genuinely settled-empty — the splash contract.
const siteLoader = document.querySelector('.site-loading')
if (siteLoader) document.body.appendChild(siteLoader)
const removeSiteLoader = (): void => {
  const el = document.querySelector('.site-loading')
  if (!el) return
  ;(el as HTMLElement).style.transition = 'opacity .3s ease'
  ;(el as HTMLElement).style.opacity = '0'
  setTimeout(() => el.remove(), 340)
}
{
  // EffectBus REPLAYS the last value SYNCHRONOUSLY inside .on(), so a
  // `const off = EffectBus.on(..., () => off())` pattern dies in the TDZ
  // when the replay fires the handler before the const exists — the exact
  // silent death that left the dot up until the failsafe. Guard with a
  // flag; unsubscribe on the next tick, when the binding is real.
  let arrivalSeen = false
  let offArrival: (() => void) | undefined
  let offCells: (() => void) | undefined
  const onVerdict = (view: string): void => {
    if (view) {
      const tick = (): void => {
        if (document.body.classList.contains('hc-view-covered')) removeSiteLoader()
        else requestAnimationFrame(tick)
      }
      tick()
      return
    }
    let cellsSeen = false
    offCells = EffectBus.on<{ count?: number; settled?: boolean }>('render:cell-count', pl => {
      if (cellsSeen) return
      if ((pl?.count ?? 0) > 0 || pl?.settled) {
        cellsSeen = true
        removeSiteLoader()
        setTimeout(() => offCells?.(), 0)
      }
    })
  }
  offArrival = EffectBus.on<{ view?: string }>('view:arrival', p => {
    if (arrivalSeen) return
    arrivalSeen = true
    setTimeout(() => offArrival?.(), 0)
    onVerdict(String(p?.view ?? ''))
  })
  // Failsafe: a boot that never reaches a verdict (engine error, unreachable
  // index) must not strand the visitor behind an eternal dot.
  setTimeout(removeSiteLoader, 25_000)
}

await import('./main')

const waitForIoc = async (key: string, timeoutMs = 30_000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (window.ioc?.get?.(key)) return true
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return false
}

window.addEventListener('hypercomb:runtime-ready', () => {
  void (async () => {
    const descriptorUrl = new URL('/site.json', location.origin)
    const selectedPublisher = new URLSearchParams(location.search).get('publisher')
    if (selectedPublisher) descriptorUrl.searchParams.set('publisher', selectedPublisher)
    const response = await fetch(descriptorUrl, { cache: 'no-store' })
    if (!response.ok) throw new Error(`site descriptor unavailable (${response.status})`)
    const site = await response.json() as SiteDescriptor
    const pubkey = String(site.pubkey ?? '').toLowerCase()
    const head = String(site.head ?? '').toLowerCase()
    const segments = (site.segments ?? String(site.lineage ?? '').split('/'))
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const hosts = (site.hosts ?? [location.host]).map(h => String(h ?? '').trim()).filter(Boolean)
    if (!SIG_RE.test(pubkey) || !SIG_RE.test(head) || segments.length === 0 || hosts.length === 0) {
      throw new Error('site descriptor is incomplete')
    }
    if (site.title) document.title = site.title
    if (site.icon) applySiteIcon(String(site.icon))
    if (!(await waitForIoc('@diamondcoreprocessor.com/HiveVisitDrone'))) {
      throw new Error('read-only visit engine did not become ready')
    }
    const route = location.pathname.split('/').map(s => decodeURIComponent(s).trim()).filter(Boolean)
    const rootName = segments[segments.length - 1]
    if (route[0]?.toLowerCase() === rootName?.toLowerCase()) {
      // The subdomain IS the creation's name — a leading /<rootName> in the
      // URL is redundant. Accept it (old links) but normalize it away.
      route.shift()
      history.replaceState(history.state, '', '/' + route.map(encodeURIComponent).join('/') + location.search + location.hash)
    }
    // Keep every URL the engine writes 1:1 with the subdomain via
    // Navigation's own URL base (navigation.ts #urlBase): readers prepend
    // the creation's name, writers strip it. The previous history.pushState
    // monkey-patch stripped only the WRITE half — Navigation.go() would
    // push '/', immediately re-parse '/' as the hive root, and every visit
    // landed on "Your hive is empty" instead of the published creation.
    const off = EffectBus.on<{ active?: boolean; label?: string; segments?: string[] }>('preview:mode', preview => {
      if (!preview?.active) return
      off()
      document.documentElement.dataset['visitorReady'] = 'true'
      const navigation = window.ioc?.get<{
        go?: (parts: readonly string[]) => void
        setUrlBase?: (parts: readonly string[]) => void
      }>('@hypercomb.social/Navigation')
      // Bare / opens the creation itself — the subdomain names it, so the
      // visitor never sees the empty hive root the adoption folded into.
      // A nested lineage mounts at the publisher's full segments (the visit
      // engine says where via `segments`); the URL base hides them all.
      const label = String(preview.label ?? rootName)
      const base = Array.isArray(preview.segments) && preview.segments.length > 0
        ? preview.segments.map(s => String(s ?? '').trim()).filter(Boolean)
        : [label]
      navigation?.setUrlBase?.(base)
      navigation?.go?.([...base, ...route])
    })
    console.log('[visitor] opening publication', { head: head.slice(0, 12), segments, hosts })
    EffectBus.emit('hive:link', {
      kind: 'hypercomb.hive-link',
      v: 1,
      pubkey,
      rootSig: head,
      segments,
      hosts,
    })
  })().catch(error => {
    console.error('[visitor] failed to open publication', error)
    document.documentElement.dataset['visitorError'] = 'true'
    removeSiteLoader()
  })
}, { once: true })
