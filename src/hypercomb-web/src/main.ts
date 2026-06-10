// hypercomb-web/src/main.ts
/// <reference path="../../hypercomb-shared/global.d.ts" />
import '@hypercomb/shared/core/ioc.web'

import { bootstrapApplication } from '@angular/platform-browser'
import { EffectBus } from '@hypercomb/core'
import { ensureInstall, resyncFromSentinel, upgradeFromBundled, type BootStatus } from './setup/ensure-install'
import { initSentinel, type SentinelBridge } from './setup/sentinel-bridge'
import { resolveImportMap } from './setup/resolve-import-map'
import { appConfig } from './app.config'
import { App } from './app/app'
import { DependencyLoader, initializeRuntime } from '@hypercomb/shared/core'
import { postCommunityDomainsToServiceWorker } from '@hypercomb/shared/core/sw-domains'

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

  // Hand the service worker the host domains (self + community) so an
  // embedded-site /@resource/<sig> request can stream from a host on an OPFS
  // miss. The SW has no localStorage/IoC, so the page must post them.
  await postCommunityDomainsToServiceWorker()

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
  await attachImportMap()

  // Snapshot the sync signature applied at boot. Anything that drifts
  // from this (toggles in DCP, intake from web→DCP, etc.) means the
  // running shell is showing stale state — when the user leaves DCP
  // we reload to commit the new state.
  const bootSyncSig = localStorage.getItem('sentinel.sync-signature') ?? ''

  // Load dependency namespaces so services self-register before Angular renders
  const loader = get('@hypercomb.social/DependencyLoader') as DependencyLoader | undefined
  await loader?.load?.()

  // Run runtime init (i18n catalogs, layer materialization, etc.) BEFORE
  // bootstrapApplication. Without this, bootstrap fires Angular's first
  // change-detection pass while CoreAdapter.initialize() is still loading
  // i18n catalogs in parallel — translations land mid-CD and the impure
  // `t` pipe's value flips from key to translated string within the same
  // tick, triggering ExpressionChangedAfterItHasBeenCheckedError on every
  // boot. Dev shell already does this (see hypercomb-dev/src/main.ts);
  // web didn't, which is why the error showed on 4200 but not 4250.
  await initializeRuntime({ logOpfs: false })

  const appRef = await bootstrapApplication(App, appConfig)

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

  // First-run "Start" — the welcome card's single button, fully unattended.
  // Mount the hidden sentinel and pull DCP's enabled set: DCP resolves
  // everything from its content domains, so a sig (or several) + the
  // domain is the entire barrier to entry. resyncAndEnforce already
  // reloads the shell when the cold install lands. If DCP is unreachable
  // (no installer deployed, offline), fall back silently to the package
  // bundled with this shell — same contract either way, every byte
  // sha256-verified against its signature. Only when BOTH sources come
  // up empty does the card re-arm (boot:status install-needed).
  window.addEventListener('hypercomb:start-install', () => {
    void (async () => {
      // Note: boot status stays 'install-needed' while this runs so the
      // welcome card remains visible with its "Starting…" state — the
      // participant watches one card until the shell reloads ready.
      try {
        await resyncAndEnforce()   // reloads on cold-install success
      } catch (err) {
        console.warn('[main] first-run sentinel install failed', err)
      }
      if (localStorage.getItem('hypercomb.installed') === 'true') return
      const ok = await upgradeFromBundled().catch(() => false)
      if (ok) { location.reload(); return }
      console.warn('[main] first-run install exhausted both sources (sentinel + bundled)')
      EffectBus.emit('boot:status', { kind: 'install-needed', reason: 'no-sentinel' } as BootStatus)
    })()
  })
}

bootstrap().catch(err => console.error(err))
