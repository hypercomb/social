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

  // Capture install state BEFORE ensureInstall so the cold-install path
  // is detectable. ensureInstall flips this flag when the first sync
  // produces content; the subsequent resyncAndEnforce branch reloads
  // immediately so the user doesn't sit on an empty shell.
  const wasInstalledAtBoot = localStorage.getItem('hypercomb.installed') === 'true'

  // Bring up the sentinel bridge before anything else runs. Push-only
  // install: sentinel is the SOLE source of content. Web→DCP intake
  // requires it; cold install requires it. If unreachable, boot
  // continues with whatever is cached (or empty if nothing is cached);
  // resyncAndEnforce will pick up content once DCP is online.
  const sentinel = await initSentinel()

  await ensureInstall(sentinel)
  await attachImportMap()

  // Snapshot the sync signature applied at boot. Anything that drifts
  // from this (toggles in DCP, intake from web→DCP, etc.) means the
  // running shell is showing stale state — when the user leaves DCP
  // we reload to commit the new state.
  const bootSyncSig = localStorage.getItem('sentinel.sync-signature') ?? ''

  // Load dependency namespaces so services self-register before Angular renders
  const loader = get('@hypercomb.social/DependencyLoader') as DependencyLoader | undefined
  await loader?.load?.()

  const appRef = await bootstrapApplication(App, appConfig)

  if (!sentinel) {
    // No DCP — nothing to resync against. App still boots from cached state.
    return
  }

  // Toggle-changed: keep OPFS in sync silently. Do NOT reload while
  // hypercomb is foregrounded — the running shell continues with its
  // currently loaded drones. Reload happens when the user leaves DCP
  // (embed close, or standalone tab close) and we detect drift from
  // bootSyncSig.
  const resyncAndEnforce = async () => {
    await resyncFromSentinel(sentinel)

    // Cold-install reload: we booted into install-needed state. The first
    // resync that produces content flips hypercomb.installed → true. Reload
    // immediately so the user sees the populated shell rather than the
    // install prompt.
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
    await resyncFromSentinel(sentinel)
    const currentSyncSig = localStorage.getItem('sentinel.sync-signature') ?? ''
    if (currentSyncSig && currentSyncSig !== bootSyncSig) {
      console.log(`[main] ${source} with drift — reloading`)
      location.reload()
    }
  }

  sentinel.onToggleChanged = resyncAndEnforce
  sentinel.onDcpClosed = () => reloadIfDrifted('dcp tab closed')
  window.addEventListener('actions:available', resyncAndEnforce)
  window.addEventListener('dcp:embed-closed', () => reloadIfDrifted('dcp embed closed'))
}

bootstrap().catch(err => console.error(err))
