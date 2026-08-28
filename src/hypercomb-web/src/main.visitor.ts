import { installMemoryFilesystem } from './setup/memory-filesystem'
import { installReadonlyNetwork } from './setup/readonly-network'

interface SiteDescriptor {
  head?: string
  hosts?: string[]
  lineage?: string
  pubkey?: string
  segments?: string[]
  title?: string
}

const SIG_RE = /^[a-f0-9]{64}$/

installMemoryFilesystem()
installReadonlyNetwork()

// The standard boot graph is deliberately imported only after the OPFS gate
// above is installed. It loads the same verified core and render path as the
// participant shell, but every filesystem operation lands in session memory.
const { EffectBus } = await import('@hypercomb/core')
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
    const off = EffectBus.on<{ active?: boolean; label?: string }>('preview:mode', preview => {
      if (!preview?.active) return
      off()
      document.documentElement.dataset['visitorReady'] = 'true'
      const navigation = window.ioc?.get<{
        go?: (parts: readonly string[]) => void
        setUrlBase?: (parts: readonly string[]) => void
      }>('@hypercomb.social/Navigation')
      // Bare / opens the creation itself — the subdomain names it, so the
      // visitor never sees the empty hive root the adoption folded into.
      const label = String(preview.label ?? rootName)
      navigation?.setUrlBase?.([label])
      navigation?.go?.([label, ...route])
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
  })
}, { once: true })
