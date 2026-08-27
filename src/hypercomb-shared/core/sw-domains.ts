// hypercomb-shared/core/sw-domains.ts
//
// Page → service-worker host-domain hand-off (signed content streaming).
//
// The service worker serves embedded-site resources at /@resource/<sig> and
// executable modules at /opfs/<pool>/<sig>; on an OPFS miss, either may stream
// verified bytes from a host. But a service worker has no
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
  const readList = (key: string): void => {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const arr: unknown = JSON.parse(raw)
        if (Array.isArray(arr)) {
          for (const d of arr) if (typeof d === 'string' && d.trim()) out.push(d.trim())
        }
      }
    } catch { /* malformed / absent — ignore */ }
  }
  readList('hc:community:domains')
  // Learned publisher hosts, persisted by the content broker (`hc:known-domains`
  // — same key-only contract as the broker's reader). Without these the SW can
  // only try self + community hosts after a reload, and an adopted site's
  // not-yet-streamed images/stylesheets 404 forever.
  readList('hc:known-domains')
  return [...new Set(out)]   // dedupe, preserve order
}

/**
 * Post the current host domains (self + community) to the controlling service
 * worker so it can resolve signature misses from a host. The worker always
 * tries its own origin without this message; the posted list adds self-hosted,
 * community, and learned publisher domains. No-op when there is no service
 * worker, active worker, or configured external domain. Best-effort and
 * idempotent — safe to call on every boot.
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
