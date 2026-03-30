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

  // After DCP portal installs, resync with sentinel, reload bees, then force CD
  window.addEventListener('actions:available', async () => {
    if (sentinel) {
      await resyncFromSentinel(sentinel)
    }
    const preloader = get('@hypercomb.social/ScriptPreloader') as any
    if (preloader?.find) await preloader.find('')
    appRef.tick()
  })
}

bootstrap().catch(err => console.error(err))
