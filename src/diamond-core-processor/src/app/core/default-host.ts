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
