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

// ── Boot trace ──────────────────────────────────────────────────────
// Aggressive instrumentation: every phase logs its duration. Set
// localStorage.removeItem('hc:boot-trace') to silence. Defaults ON
// while we hunt boot-time regressions.
const BOOT_T0 = performance.now()
const BOOT_PHASES: Array<{ name: string; t: number; dt: number }> = []
const traceEnabled = (): boolean => {
  try { return localStorage.getItem('hc:boot-trace') !== '0' } catch { return true }
}
const tracePhase = (name: string): void => {
  const t = performance.now() - BOOT_T0
  const prev = BOOT_PHASES.length > 0 ? BOOT_PHASES[BOOT_PHASES.length - 1].t : 0
  const dt = t - prev
  BOOT_PHASES.push({ name, t, dt })
  if (traceEnabled()) {
    console.log(`[boot] +${dt.toFixed(0).padStart(5)}ms  total ${t.toFixed(0).padStart(5)}ms  ${name}`)
  }
}
;(globalThis as any).__hcBootPhases = BOOT_PHASES
const printBootSummary = (): void => {
  if (!traceEnabled()) return
  const total = performance.now() - BOOT_T0
  console.log(`[boot] ───────── summary (total ${total.toFixed(0)}ms) ─────────`)
  for (const p of BOOT_PHASES) {
    const bar = '█'.repeat(Math.min(40, Math.round(p.dt / Math.max(1, total) * 40)))
    console.log(`[boot] ${p.dt.toFixed(0).padStart(5)}ms ${bar} ${p.name}`)
  }
}
;(globalThis as any).__hcPrintBootSummary = printBootSummary

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
  tracePhase('bootstrap:enter')
  await ensureSwControl()
  tracePhase('ensureSwControl')

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
  tracePhase('ensureInstall')
  await attachImportMap()
  tracePhase('attachImportMap')

  // Snapshot the sync signature applied at boot. Anything that drifts
  // from this (toggles in DCP, intake from web→DCP, etc.) means the
  // running shell is showing stale state — when the user leaves DCP
  // we reload to commit the new state.
  const bootSyncSig = localStorage.getItem('sentinel.sync-signature') ?? ''

  // Load dependency namespaces so services self-register before Angular renders
  const loader = get('@hypercomb.social/DependencyLoader') as DependencyLoader | undefined
  await loader?.load?.()
  tracePhase('DependencyLoader.load')

  const appRef = await bootstrapApplication(App, appConfig)
  tracePhase('bootstrapApplication')

  // Print summary after the next paint so the timeline is captured
  // including initial render, then leave it accessible at
  // window.__hcPrintBootSummary() for re-run.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    tracePhase('first-paint')
    printBootSummary()
  }))

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
