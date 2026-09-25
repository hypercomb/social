import { installMemoryFilesystem } from './setup/memory-filesystem'
import { installReadonlyNetwork } from './setup/readonly-network'
import { readArrivalTrial, startArrivalTrial } from './setup/arrival-trial'

interface SiteDescriptor {
  head?: string
  hosts?: string[]
  icon?: string
  lineage?: string
  pubkey?: string
  segments?: string[]
  title?: string
  /** The publisher's arrival plan (signed index `plan:<lineage>`): a record
   *  naming the bees this branch's arrival needs, by IoC key. */
  plan?: string
  /** The publisher's participant-only features (signed index
   *  `pool:features:participant`): a snapshot record naming them. */
  quiet?: string
}

const SIG_RE = /^[a-f0-9]{64}$/

/** The portal supplies its own origin when it opens a creation. The visitor
 *  shows one return action; the home host reads the target's signed offering
 *  pool and verifies the payload before recording it. */
const offerHome = (pubkey: string, lineage: string): void => {
  const raw = new URLSearchParams(location.search).get('home')
  if (!raw) return
  let home: URL
  let native = false
  try {
    home = new URL(raw)
    native = home.href === 'hypercomb://offering/'
    const loopback = home.hostname === 'localhost' || home.hostname.endsWith('.localhost')
    if ((!native && home.protocol !== 'https:' && !(loopback && home.protocol === 'http:'))
      || home.pathname !== '/' || home.search || home.hash || home.username || home.password) return
  } catch { return }
  const handoff = native ? new URL(home) : new URL('/hosts', home)
  handoff.searchParams.set('add', `${location.origin}/`)
  handoff.searchParams.set('publisher', pubkey)
  handoff.searchParams.set('lineage', lineage)
  const source = new URLSearchParams(location.search).get('source')
  if (source) handoff.searchParams.set('source', source)
  const action = document.createElement('a')
  action.href = handoff.href
  action.textContent = native ? 'Review in my hive' : 'Turn on or off in my hive'
  action.title = native ? 'Open the local hive to review this creation'
    : `Return to ${home.host} to verify and switch this creation`
  action.setAttribute('aria-label', native ? 'Review this creation in my local hive'
    : `Turn this creation on or off at ${home.host}`)
  Object.assign(action.style, {
    position: 'fixed', right: '1rem', bottom: '1rem', zIndex: '2147483000',
    padding: '.7rem 1rem', borderRadius: 'var(--hc-radius-card, 3px)',
    color: 'var(--md-on-primary)', background: 'var(--md-primary)',
    boxShadow: 'var(--md-elev-3)',
    font: '600 14px system-ui, sans-serif', textDecoration: 'none',
  })
  document.body.append(action)
}

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

// ── what this site is, read FIRST ──────────────────────────────────────────
// The descriptor names the publication and, when its publisher planned one,
// the ARRIVAL: the bees this branch's first view needs (hypercomb-runtime
// arrival-plan.ts). The runtime's first bee load reads the plan, so both
// reads start here, before the boot graph, and run beside it — a plan that
// is slow or absent simply means the whole package loads, as always.
const descriptorUrl = new URL('/site.json', location.origin)
{
  const selectedPublisher = new URLSearchParams(location.search).get('publisher')
  if (selectedPublisher) descriptorUrl.searchParams.set('publisher', selectedPublisher)
}
const siteRead: Promise<SiteDescriptor | null> = fetch(descriptorUrl, { cache: 'no-store' })
  .then(response => response.ok ? response.json() as Promise<SiteDescriptor> : null)
  .catch(() => null)
// A TRIAL (`?arrival=`, setup/arrival-trial.ts) replaces the signed plan for
// this one visit — the Publish window's Optimize section tries a plan with it.
const arrivalTrial = readArrivalTrial()
;(globalThis as { __hcArrival?: Promise<string[] | null> }).__hcArrival = arrivalTrial ? Promise.resolve(arrivalTrial) : siteRead.then(async site => {
  const plan = String(site?.plan ?? '').toLowerCase()
  if (!SIG_RE.test(plan)) return null
  // Served by the door that served this code: its host hashed the bytes on
  // upload, and nothing here stores them — read, never re-hashed.
  const response = await fetch(`/content/${plan}`)
  if (!response.ok) return null
  const record = await response.json() as { arrive?: unknown }
  return Array.isArray(record?.arrive) ? record.arrive.map(name => String(name ?? '')) : null
}).catch(() => null)
// FEATURES FOR PARTICIPANTS ONLY: the snapshot of the publisher's
// `features:participant` pool (signed index `pool:features:participant`,
// essentials sharing/participant-features.ts). A read-only reader never loads
// what it names (hypercomb-runtime script-preloader.ts #quietBees).
;(globalThis as { __hcQuietFeatures?: Promise<string[] | null> }).__hcQuietFeatures = siteRead.then(async site => {
  const quiet = String(site?.quiet ?? '').toLowerCase()
  if (!SIG_RE.test(quiet)) return null
  const response = await fetch(`/content/${quiet}`)
  if (!response.ok) return null
  const record = await response.json() as { features?: unknown }
  return Array.isArray(record?.features) ? record.features.map(name => String(name ?? '')) : null
}).catch(() => null)

// The standard boot graph is deliberately imported only after the OPFS gate
// above is installed. It loads the same verified core and render path as the
// participant shell, but every filesystem operation lands in session memory.
const { EffectBus } = await import('@hypercomb/core')
if (arrivalTrial) startArrivalTrial(EffectBus, arrivalTrial)

// ── the loading cover owns the screen until the SITE is on it ──────────────
// `.site-loading` starts inside <app-root>, which Angular REPLACES at
// bootstrap (~1.4s) — a beat before the published view mounts (~3s). That gap
// showed the hive's own visuals (background rings, the empty prompt) between
// the cover and the page. Re-parent the loader to <body> so it survives
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
  // silent death that left the cover up until the failsafe. Guard with a
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
  // index) must not strand the visitor behind an eternal cover.
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

// ── the approach: leaving the page for the hive wakes the rest ─────────────
// A planned arrival loads only what its page needs; everything else is
// passive. The moment the visitor steps off the page into the hexagons (the
// takeover surface lifts), the runtime wakes it — the renderers first.
{
  let wasCovered = false
  const watch = new MutationObserver(() => {
    const covered = document.body.classList.contains('hc-view-covered')
    if (covered) { wasCovered = true; return }
    if (!wasCovered) return
    watch.disconnect()
    EffectBus.emit('loader:activate', { reason: 'hive' })
  })
  watch.observe(document.body, { attributes: true, attributeFilter: ['class'] })
}

window.addEventListener('hypercomb:runtime-ready', () => {
  void (async () => {
    const site = await siteRead
    if (!site) throw new Error('site descriptor unavailable')
    const pubkey = String(site.pubkey ?? '').toLowerCase()
    const head = String(site.head ?? '').toLowerCase()
    const segments = (site.segments ?? String(site.lineage ?? '').split('/'))
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const hosts = (site.hosts ?? [location.host]).map(h => String(h ?? '').trim()).filter(Boolean)
    if (!SIG_RE.test(pubkey) || !SIG_RE.test(head) || segments.length === 0 || hosts.length === 0) {
      throw new Error('site descriptor is incomplete')
    }
    offerHome(pubkey, String(site.lineage ?? ''))
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
    // THE BASE GOES IN FIRST. The engine walks into the creation before it
    // reports `preview:mode`, and any URL written in that window carried the
    // creation's own name (`behaviors.<zone>/behaviors`) — and stuck, since
    // nothing wrote the bar again. Set the base from the descriptor's
    // segments now; `preview:mode` below corrects it for a nested mount.
    type VisitorNavigation = { go?: (parts: readonly string[]) => void; setUrlBase?: (parts: readonly string[]) => void }
    if (await waitForIoc('@hypercomb.social/Navigation', 5_000)) {
      window.ioc?.get<VisitorNavigation>('@hypercomb.social/Navigation')?.setUrlBase?.(segments)
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
