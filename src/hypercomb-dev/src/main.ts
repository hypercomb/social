// hypercomb-dev/src/main.ts

// ── boot perf trail ──────────────────────────────────────────────────────────
// T0 = the earliest point we can capture inside the module graph. Any
// shared/essentials code that calls window.__hcBoot('label') from here on
// gets a `[boot] +Nms label` line in the console and pushes into
// window.__hcBootMarks. Helper is dev-only; no-op on shells that don't set
// __hcBootT0, so shared code can call it unconditionally.
;(window as any).__hcBootT0 = performance.now()
;(window as any).__hcBootMarks = [] as string[]
;(window as any).__hcBoot = (label: string, extra?: string) => {
  const t0 = (window as any).__hcBootT0
  if (typeof t0 !== 'number') return
  const t = performance.now() - t0
  const msg = `+${t.toFixed(0)}ms ${label}${extra ? ` ${extra}` : ''}`
  console.log(`[boot] ${msg}`)
  ;(window as any).__hcBootMarks.push(msg)
  try { localStorage.setItem('hc:perf-boot-marks', JSON.stringify((window as any).__hcBootMarks)) } catch {}
}
;(window as any).__hcBoot('main.ts module evaluated')

import '@hypercomb/shared/core/ioc.web'
import { bootstrapApplication } from '@angular/platform-browser'
import { SignatureStore } from '@hypercomb/core'
import { Store } from '@hypercomb/shared'
import { initializeRuntime, DroneRegistry, IconProviderRegistry } from '@hypercomb/shared/core'
import { postCommunityDomainsToServiceWorker } from '@hypercomb/shared/core/sw-domains'
import { appConfig } from './app/app.config'
import { App } from './app/app'

// keep this as a value-use so the module can't be elided
void Store
void DroneRegistry
void IconProviderRegistry

/**
 * Register the same service worker prod uses. It serves
 * `/@resource/<sig>` from OPFS `__resources__/`, with content-type
 * inferred from the URL tail extension (or sniffed from the blob).
 * Per-cell pages link shared chrome via `<link href="resource:<sig>">`
 * — the renderer rewrites to `/@resource/<sig>` before injection,
 * and the worker resolves it. Without the worker the dev shell
 * would 404 those URLs and composition breaks.
 */
const ensureSwControl = async (): Promise<void> => {
  if (!('serviceWorker' in navigator)) return
  try {
    await navigator.serviceWorker.register('/hypercomb.worker.js', { scope: '/' })
    const reg = await navigator.serviceWorker.ready
    if (navigator.serviceWorker.controller) return
    // Hard-reload state: active worker, nothing installing/waiting —
    // controllerchange can never fire (claim ran long ago) and the page
    // stays uncontrolled regardless; waiting 3s here bought nothing.
    // First tiles never touch the SW route, so proceed immediately.
    if (reg.active && !reg.installing && !reg.waiting) return
    // Worker genuinely installing/updating: claim fires sub-second.
    await new Promise<void>(resolve => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
      setTimeout(resolve, 1500)
    })
  } catch (err) {
    console.warn('[hypercomb-dev] service-worker registration failed', err)
  }
}

const main = async (): Promise<void> => {

  // central signature allowlist — signText() memoizes repeated computeSignatureLocation calls
  register('@hypercomb/SignatureStore', new SignatureStore())

  ;(window as any).__hcBoot('main() started')
  await ensureSwControl()

  // Hand the service worker the host domains (self + community) so an
  // embedded-site /@resource/<sig> request can stream from a host on an
  // OPFS miss. The SW has no localStorage/IoC, so the page must post them.
  await postCommunityDomainsToServiceWorker()
  ;(window as any).__hcBoot('ensureSwControl done')
  await initializeRuntime()
  ;(window as any).__hcBoot('initializeRuntime done')

  await bootstrapApplication(App, appConfig)
  ;(window as any).__hcBoot('bootstrapApplication done')
}

main().catch(err => console.error(err))
