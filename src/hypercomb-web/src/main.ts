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

  const wasInstalledAtBoot = localStorage.getItem('hypercomb.installed') === 'true'

  // Push-only contract: no DCP iframe is mounted at boot. Boot reads OPFS
  // only. The sentinel bridge is created lazily when DCP-driven events
  // (actions:available / dcp:embed-closed) signal the user has finished
  // a portal session and pushed changes back.
  await ensureInstall(Promise.resolve(null))
  await attachImportMap()

  const bootSyncSig = localStorage.getItem('sentinel.sync-signature') ?? ''

  const loader = get('@hypercomb.social/DependencyLoader') as DependencyLoader | undefined
  await loader?.load?.()

  const appRef = await bootstrapApplication(App, appConfig)

  let sentinelPromise: Promise<SentinelBridge | null> | null = null
  const getSentinel = (): Promise<SentinelBridge | null> => {
    if (!sentinelPromise) sentinelPromise = initSentinel()
    return sentinelPromise
  }

  const resyncAndEnforce = async () => {
    const sentinel = await getSentinel()
    if (!sentinel) return
    await resyncFromSentinel(sentinel)

    if (!wasInstalledAtBoot && localStorage.getItem('hypercomb.installed') === 'true') {
      console.log('[main] cold install completed — reloading')
      location.reload()
      return
    }

    const preloader = get('@hypercomb.social/ScriptPreloader') as any
    if (preloader?.find) await preloader.find('')
    appRef.tick()
  }

  const reloadIfDrifted = async (source: string) => {
    const sentinel = await getSentinel()
    if (!sentinel) return
    await resyncFromSentinel(sentinel)
    const currentSyncSig = localStorage.getItem('sentinel.sync-signature') ?? ''
    if (currentSyncSig && currentSyncSig !== bootSyncSig) {
      console.log(`[main] ${source} with drift — reloading`)
      location.reload()
    }
  }

  window.addEventListener('actions:available', resyncAndEnforce)
  window.addEventListener('dcp:embed-closed', () => reloadIfDrifted('dcp embed closed'))
}

bootstrap().catch(err => console.error(err))
