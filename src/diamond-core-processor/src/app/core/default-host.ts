// diamond-core-processor/src/app/core/default-host.ts
//
// Single source of truth for "what is this DCP instance's canonical host?"
// Every install UI in the top bar reads from here — relay-panel default URL,
// trusted-domain default, and anything else that needs to answer "where am I
// hosted?" — so the choice between jwize.com vs diamondcoreprocessor.com vs
// any other operator domain lives in exactly one place.
//
// Principle: the host that served you the page IS your authoritative host.
// On a real domain (anything that isn't loopback) we return that origin
// verbatim. On localhost we return whatever per-feature fallback the caller
// supplied so dev still works unchanged.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

/** True iff the current page is loaded from a real (non-loopback) host. */
export function isOnRealHost(): boolean {
  try { return !LOCAL_HOSTS.has(window.location.hostname) }
  catch { return false }
}

/**
 * Canonical host origin for this DCP instance.
 *
 * Resolves in three steps:
 *
 *   1. Real host (jwize.com, alice.dev, etc.) → the page's
 *      `window.location.origin` verbatim. Production case.
 *   2. Loopback origin (localhost, 127.0.0.1, ::1) + the operator's
 *      env.js has set `window.HYPERCOMB_DEV_HOST` → an `https://<that>`
 *      URL. This is the dev-as-operator case: the participant is on
 *      localhost:4250 in the browser but their identity / install
 *      source is their production host (jwize.com). The installer
 *      should suggest jwize.com, not Azure.
 *   3. Loopback origin and no dev-host override → fall back to the
 *      `localFallback` the caller supplied (cold-start install URL).
 *      This is the "fresh repo clone, no config" case.
 *
 * The dev-host override matches how `runtime-initializer.ts` resolves
 * `hc:nostrmesh:self-domain` on first boot, so install UIs and the
 * broker's self-domain are in lockstep.
 */
export function defaultHostOrigin(localFallback: string): string {
  if (isOnRealHost()) return window.location.origin
  try {
    const devHost = String((window as { HYPERCOMB_DEV_HOST?: string }).HYPERCOMB_DEV_HOST ?? '').trim()
      .replace(/^wss?:\/\//i, '')
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '')
      .toLowerCase()
    if (devHost) return `https://${devHost}`
  } catch { /* fall through */ }
  return localFallback
}

/**
 * DEV-ONLY default-baseline bootstrap: a hard-coded (domain, sig) so the
 * installer dashboard is NEVER empty in development — it resolves a default
 * baseline exactly the way an adopt does (a signature filled out by a
 * domain). Returns null on a real host; production seeds the baseline from
 * the deploy's own default signature instead (not yet wired).
 *
 *   domain — a host serving the content (layers/bees/deps/resources +
 *            manifest.json) with CORS. The local relay does this:
 *              cd hypercomb-relay && node relay.js --port 7777 --memory \
 *                --content-dir ../hypercomb-web/public/content
 *   sig    — the baseline's root signature. If it goes stale (a rebuild
 *            changes content sigs) the caller falls back to the domain's
 *            current manifest root, so dev never breaks on a rebuild.
 *
 * Override either value while developing (or set window.HYPERCOMB_DEV_DEFAULT
 * = { domain, sig } in env.js) to point at your own host / a specific
 * baseline.
 */
export function devDefaultBootstrap(): { host: string; byteSource: string; sig?: string } | null {
  if (isOnRealHost()) return null
  try {
    const override = (window as {
      HYPERCOMB_DEV_DEFAULT?: { host?: string; byteSource?: string; domain?: string; sig?: string }
    }).HYPERCOMB_DEV_DEFAULT
    if (override?.host || override?.byteSource || override?.domain) {
      const byteSource = String(override.byteSource ?? override.domain ?? '').replace(/\/+$/, '')
      const host = String(override.host ?? override.domain ?? byteSource).replace(/^https?:\/\//i, '').replace(/\/+$/, '')
      if (byteSource) return { host, byteSource, sig: override.sig }
    }
  } catch { /* fall through to hard-coded dev default */ }
  return {
    // host = the capture-source identity → the installer's DOMAIN FOLDER
    // label. We self-host on jwize.com, so adopted/default content lands in
    // a `jwize.com/` folder.
    host: 'jwize.com',
    // byteSource = where dev actually FETCHES the bytes. The app never
    // dials localhost: jwize.com serves its own content (the relay's
    // content dir, kept current by copy-to-dcp), and it resolves locally
    // anyway when the tunnel terminates on this machine. If the host is
    // down, the bootstrap is simply unavailable — functionality lost,
    // never redirected to a local port.
    byteSource: 'https://jwize.com',
    sig: '82dfae009ba26dc568be55d2b24833e6e2f8027c2723600248d6bb8467ab3373',
  }
}
