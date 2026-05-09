// hypercomb-dev/src/main.ts

import '@hypercomb/shared/core/ioc.web'
import { bootstrapApplication } from '@angular/platform-browser'
import { SignatureStore } from '@hypercomb/core'
import { Store } from '@hypercomb/shared'
import { initializeRuntime, DroneRegistry, IconProviderRegistry } from '@hypercomb/shared/core'
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
    await navigator.serviceWorker.ready
    if (navigator.serviceWorker.controller) return
    await new Promise<void>(resolve => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
      setTimeout(resolve, 3000)
    })
  } catch (err) {
    console.warn('[hypercomb-dev] service-worker registration failed', err)
  }
}

const main = async (): Promise<void> => {

  // central signature allowlist — signText() memoizes repeated computeSignatureLocation calls
  register('@hypercomb/SignatureStore', new SignatureStore())

  await ensureSwControl()
  await initializeRuntime()

  await bootstrapApplication(App, appConfig)
}

main().catch(err => console.error(err))
