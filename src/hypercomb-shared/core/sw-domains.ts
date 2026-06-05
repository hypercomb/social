// hypercomb-shared/core/sw-domains.ts
//
// Page → service-worker host-domain hand-off (resource streaming, Phase 2).
//
// The service worker serves embedded-site resources at /@resource/<sig> and,
// on an OPFS miss, streams them from a host. But a service worker has no
// localStorage / IoC, so it can't discover host domains on its own — the page
// must tell it. This mirrors the content broker's candidate set on the main
// thread (self-domain + community domains); the SW verifies sha256 on whatever
// it fetches, so an out-of-date or hostile domain list can only cost a 404,
// never serve wrong bytes.

const SW_DOMAINS_MSG = 'hc:sw:domains'

const readDomains = (): string[] => {
  const out: string[] = []
  try {
    const self = localStorage.getItem('hc:nostrmesh:self-domain')?.trim()
    if (self) out.push(self)
  } catch { /* localStorage unavailable — ignore */ }
  try {
    const raw = localStorage.getItem('hc:community:domains')
    if (raw) {
      const arr: unknown = JSON.parse(raw)
      if (Array.isArray(arr)) {
        for (const d of arr) if (typeof d === 'string' && d.trim()) out.push(d.trim())
      }
    }
  } catch { /* malformed / absent — ignore */ }
  return [...new Set(out)]   // dedupe, preserve order
}

/**
 * Post the current host domains (self + community) to the controlling service
 * worker so it can resolve /@resource/<sig> misses from a host. No-op when
 * there's no service worker, no active worker yet, or no domains configured.
 * Best-effort and idempotent — safe to call on every boot.
 */
export const postCommunityDomainsToServiceWorker = async (): Promise<void> => {
  try {
    if (!('serviceWorker' in navigator)) return
    const domains = readDomains()
    if (domains.length === 0) return
    const target =
      navigator.serviceWorker.controller ??
      (await navigator.serviceWorker.getRegistration())?.active ??
      null
    target?.postMessage({ type: SW_DOMAINS_MSG, domains })
  } catch { /* best-effort — the SW also reloads its persisted copy on activate */ }
}
