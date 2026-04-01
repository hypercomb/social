// hypercomb-web/src/main.ts
/// <reference path="../../hypercomb-shared/global.d.ts" />
import '@hypercomb/shared/core/ioc.web'

import { ApplicationRef } from '@angular/core'
import { bootstrapApplication } from '@angular/platform-browser'
import { ensureInstall, resyncFromSentinel } from './setup/ensure-install'
import { initSentinel } from './setup/sentinel-bridge'
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
  const sentinel = await initSentinel()
  await ensureInstall(sentinel)
  await attachImportMap()

  // Load dependency namespaces so services self-register before Angular renders
  const loader = get('@hypercomb.social/DependencyLoader') as DependencyLoader | undefined
  await loader?.load?.()

  const appRef = await bootstrapApplication(App, appConfig)

  // Shared resync logic: resync with sentinel, reload if import map changed,
  // otherwise let find() enforce the updated manifest (evicts disabled bees).
  const resyncAndEnforce = async () => {
    if (!sentinel) return

    const previousSyncSig = localStorage.getItem('sentinel.sync-signature') ?? ''
    await resyncFromSentinel(sentinel)
    const currentSyncSig = localStorage.getItem('sentinel.sync-signature') ?? ''

    // Sync signature changed → new content was installed.
    // A page reload is required because the browser import map is frozen.
    if (currentSyncSig && currentSyncSig !== previousSyncSig) {
      location.reload()
      return
    }

    // No new content — just refresh bees in case manifest changed without
    // new dependencies (e.g. toggling existing bees on/off).
    // find() enforces the manifest: disabled bees are disposed and evicted.
    const preloader = get('@hypercomb.social/ScriptPreloader') as any
    if (preloader?.find) await preloader.find('')
    appRef.tick()
  }

  // After DCP portal installs, resync with sentinel then reload so the
  // browser picks up the new import-map entries (import maps are immutable
  // once injected).  If nothing changed, skip the reload.
  window.addEventListener('actions:available', resyncAndEnforce)

  // Live toggle enforcement: when DCP toggles a bee on/off, resync
  // immediately so the bee stops (or starts) on the very next pulse.
  if (sentinel) {
    sentinel.onToggleChanged = resyncAndEnforce
  }
}

bootstrap().catch(err => console.error(err))
