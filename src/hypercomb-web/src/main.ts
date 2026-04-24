// hypercomb-web/src/main.ts
/// <reference path="../../hypercomb-shared/global.d.ts" />
import '@hypercomb/shared/core/ioc.web'

import { bootstrapApplication } from '@angular/platform-browser'
import { ensureInstall, resyncFromSentinel } from './setup/ensure-install'
import { initSentinel, type SentinelBridge } from './setup/sentinel-bridge'
import { resolveImportMap } from './setup/resolve-import-map'
import { appConfig } from './app.config'
import { App } from './app/app'
import { DependencyLoader } from '@hypercomb/shared/core'

// Ensure side-effect registration
const _deps = [DependencyLoader]

const ensureSwControl = async (): Promise<void> => {
  if (!('serviceWorker' in navigator)) return

  await navigator.serviceWorker.register('/hypercomb.worker.js', { scope: '/' })
  await navigator.serviceWorker.ready

  if (navigator.serviceWorker.controller) return

  // Wait for clients.claim() to propagate (fires controllerchange)
  await new Promise<void>(resolve => {
    navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
    setTimeout(resolve, 3000)
  })
}

const attachImportMap = async (): Promise<void> => {
  const imports = await resolveImportMap()

  const script = document.createElement('script')
  script.type = 'importmap'
  script.textContent = JSON.stringify({ imports }, null, 2)
  document.head.appendChild(script)

  await Promise.resolve()
}

const bootstrap = async (): Promise<void> => {
  await ensureSwControl()
  await ensureInstall()
  await attachImportMap()

  // Load dependency namespaces so services self-register before Angular renders
  const loader = get('@hypercomb.social/DependencyLoader') as DependencyLoader | undefined
  await loader?.load?.()

  const appRef = await bootstrapApplication(App, appConfig)

  // ── Push-only updates: sentinel is lazy, initialized on demand ──
  // No per-load polling. Updates arrive via the `actions:available` event
  // dispatched by the DCP portal after an explicit push.
  let cachedSentinel: SentinelBridge | null = null

  const resyncAndEnforce = async () => {
    const sentinel = await lazyInitSentinel()
    if (!sentinel) return

    const previousSyncSig = localStorage.getItem('sentinel.sync-signature') ?? ''
    await resyncFromSentinel(sentinel)
    const currentSyncSig = localStorage.getItem('sentinel.sync-signature') ?? ''

    if (currentSyncSig && currentSyncSig !== previousSyncSig) {
      location.reload()
      return
    }

    const preloader = get('@hypercomb.social/ScriptPreloader') as any
    if (preloader?.find) await preloader.find('')
    appRef.tick()
  }

  const lazyInitSentinel = async (): Promise<SentinelBridge | null> => {
    if (cachedSentinel) return cachedSentinel
    cachedSentinel = await initSentinel()
    if (cachedSentinel) cachedSentinel.onToggleChanged = resyncAndEnforce
    return cachedSentinel
  }

  // After DCP portal installs, resync + reload (import map is frozen).
  window.addEventListener('actions:available', resyncAndEnforce)
}

bootstrap().catch(err => console.error(err))
