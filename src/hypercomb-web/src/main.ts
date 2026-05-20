// hypercomb-web/src/main.ts
/// <reference path="../../hypercomb-shared/global.d.ts" />

// boot perf trail — persists across crash + reload via localStorage.
// Read back from Safari Web Inspector → Storage → Local Storage on
// `hc:perf-boot-marks` (in-progress) or `hc:perf-boot-marks-final`
// (last snapshot before pagehide). Any shared/essentials code that
// calls `(window as any).__hcBoot?.('label')` lights up here.
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

window.addEventListener('pagehide', () => {
  try { localStorage.setItem('hc:perf-boot-marks-final', JSON.stringify((window as any).__hcBootMarks ?? [])) } catch {}
})

import '@hypercomb/shared/core/ioc.web'

import { bootstrapApplication } from '@angular/platform-browser'
import { ensureInstall, resyncFromSentinel } from './setup/ensure-install'
import { initSentinel, type SentinelBridge } from './setup/sentinel-bridge'
import { resolveImportMap } from './setup/resolve-import-map'
import { appConfig } from './app.config'
import { App } from './app/app'
import { DependencyLoader, initializeRuntime } from '@hypercomb/shared/core'

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
  ;(window as any).__hcBoot?.('bootstrap() entry')
  await ensureSwControl()
  ;(window as any).__hcBoot?.('ensureSwControl done')

  // Capture install state BEFORE ensureInstall so the cold-install path
  // is detectable. ensureInstall flips this flag when the first sync
  // produces content; the subsequent resyncAndEnforce branch reloads
  // immediately so the user doesn't sit on an empty shell.
  const wasInstalledAtBoot = localStorage.getItem('hypercomb.installed') === 'true'

  // Push-only contract: NO DCP iframe is mounted at boot. Boot reads
  // OPFS only. The sentinel bridge is created lazily on the first
  // explicit user action that needs DCP — opening the installer from
  // the menu, the install-needed prompt, or the in-app DCP portal.
  await ensureInstall(null)
  ;(window as any).__hcBoot?.('ensureInstall done')
  await attachImportMap()
  ;(window as any).__hcBoot?.('attachImportMap done')

  // Snapshot the sync signature applied at boot. Anything that drifts
  // from this (toggles in DCP, intake from web→DCP, etc.) means the
  // running shell is showing stale state — when the user leaves DCP
  // we reload to commit the new state.
  const bootSyncSig = localStorage.getItem('sentinel.sync-signature') ?? ''

  // Load dependency namespaces so services self-register before Angular renders
  const loader = get('@hypercomb.social/DependencyLoader') as DependencyLoader | undefined
  await loader?.load?.()
  ;(window as any).__hcBoot?.('DependencyLoader.load done')

  // Run runtime init (i18n catalogs, layer materialization, etc.) BEFORE
  // bootstrapApplication. Without this, bootstrap fires Angular's first
  // change-detection pass while CoreAdapter.initialize() is still loading
  // i18n catalogs in parallel — translations land mid-CD and the impure
  // `t` pipe's value flips from key to translated string within the same
  // tick, triggering ExpressionChangedAfterItHasBeenCheckedError on every
  // boot. Dev shell already does this (see hypercomb-dev/src/main.ts);
  // web didn't, which is why the error showed on 4200 but not 4250.
  await initializeRuntime({ logOpfs: false })
  ;(window as any).__hcBoot?.('initializeRuntime done')

  const appRef = await bootstrapApplication(App, appConfig)
  ;(window as any).__hcBoot?.('bootstrapApplication done')

  // Lazy sentinel: no iframe until the user explicitly opens DCP. The
  // first call to getSentinel() mounts the hidden iframe at /sentinel
  // and performs the handshake; subsequent calls reuse the same bridge.
  let sentinelPromise: Promise<SentinelBridge | null> | null = null
  const getSentinel = (): Promise<SentinelBridge | null> => {
    if (!sentinelPromise) {
      sentinelPromise = initSentinel().then(bridge => {
        if (bridge) {
          bridge.onToggleChanged = resyncAndEnforce
          bridge.onDcpClosed = () => reloadIfDrifted('dcp tab closed')
        }
        return bridge
      })
    }
    return sentinelPromise
  }

  // Toggle-changed: keep OPFS in sync silently. Do NOT reload while
  // hypercomb is foregrounded — the running shell continues with its
  // currently loaded drones. Reload happens when the user leaves DCP
  // (embed close, or standalone tab close) and we detect drift from
  // bootSyncSig.
  const resyncAndEnforce = async () => {
    const sentinel = await getSentinel()
    if (!sentinel) return
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
    const sentinel = await getSentinel()
    if (!sentinel) return
    await resyncFromSentinel(sentinel)
    const currentSyncSig = localStorage.getItem('sentinel.sync-signature') ?? ''
    if (currentSyncSig && currentSyncSig !== bootSyncSig) {
      console.log(`[main] ${source} with drift — reloading`)
      location.reload()
    }
  }

  // Mount the sentinel iframe ONLY on explicit user actions that
  // signal DCP is in use: opening the installer / portal from a menu,
  // or DCP-driven events that imply the user is actively engaging with
  // the installer surface. Until one of these fires, no cross-origin
  // request goes out at all.
  window.addEventListener('portal:open', (e) => {
    if ((e as CustomEvent).detail?.target === 'dcp') void getSentinel()
  })
  window.addEventListener('actions:available', resyncAndEnforce)
  window.addEventListener('dcp:embed-closed', () => reloadIfDrifted('dcp embed closed'))
}

bootstrap().catch(err => console.error(err))
