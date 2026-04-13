// hypercomb-web/src/main.ts
/// <reference path="../../hypercomb-shared/global.d.ts" />
import '@hypercomb/shared/core/ioc.web'

import { ApplicationRef } from '@angular/core'
import { bootstrapApplication } from '@angular/platform-browser'
import { EffectBus } from '@hypercomb/core'
import { ensureInstall, resyncFromSentinel, backgroundSync, type SyncState } from './setup/ensure-install'
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

  // ── Background sync: status check + lazy sentinel ──
  // Runs after Angular has rendered so the user sees content immediately.
  // Only loads the sentinel iframe if the cheap manifest.json status check
  // detects that DCP has new content to install.
  let cachedSentinel: SentinelBridge | null = null

  // Forward-declared so lazyInitSentinel can wire it as the toggle callback
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

  // Always sync with sentinel on page load — toggle changes don't
  // change the manifest, so backgroundSync won't detect them.
  // resyncAndEnforce checks the sync sig and reloads if it changed.
  void resyncAndEnforce()

  const emitState = (state: SyncState, detail?: { changedFiles?: number; error?: string }) => {
    EffectBus.emit('install:state', { state, ...(detail ?? {}) })
  }

  // After DCP portal installs, resync + reload (import map is frozen).
  window.addEventListener('actions:available', resyncAndEnforce)

  // Defer the background status check so the UI thread isn't competing
  // with Angular's first render.
  setTimeout(() => {
    void backgroundSync({
      initSentinel: lazyInitSentinel,
      onState: emitState,
    })
  }, 0)
}

bootstrap().catch(err => console.error(err))
