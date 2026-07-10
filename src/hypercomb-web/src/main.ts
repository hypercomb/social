// hypercomb-web/src/main.ts
/// <reference path="../../hypercomb-shared/global.d.ts" />

// ── boot perf trail ──────────────────────────────────────────────────────────
// Mirror of hypercomb-dev/src/main.ts. T0 = earliest point in the module graph.
// Any shared/essentials code that calls window.__hcBoot('label') gets a
// `[boot] +Nms label` console line + a push into window.__hcBootMarks (also
// persisted to localStorage['hc:perf-boot-marks'] so the trail survives the
// reload it measures). Web previously never defined __hcBoot, so every mark in
// shared/essentials was a silent no-op here and production boot was unmeasurable.
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

// ── navigation perf trail ────────────────────────────────────────────────────
// Same contract as __hcBoot but per NAVIGATION: 'nav:start' resets T0, every
// later mark logs `[nav] +Nms label`. Shared/essentials call __hcNav?.('label')
// unconditionally; shells that don't define it no-op.
;(window as any).__hcNavT0 = 0
;(window as any).__hcNav = (label: string, extra?: string) => {
  const now = performance.now()
  if (label === 'nav:start') (window as any).__hcNavT0 = now
  const t0 = (window as any).__hcNavT0 || now
  console.log(`[nav] +${(now - t0).toFixed(0)}ms ${label}${extra ? ` ${extra}` : ''}`)
}

import '@hypercomb/shared/core/ioc.web'
// Capture a `/<sig>` meeting-place invite link before navigation parses the
// URL — stashes the sig for the receive-side MeetingInviteWorker.
import '@hypercomb/shared/core/invite-capture'
// Restore the persisted header-size preset before first paint + register the
// `/header` slash command (auto-wires via ioc.onRegister).
import '@hypercomb/shared/core/header-size'

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
  const reg = await navigator.serviceWorker.ready

  if (navigator.serviceWorker.controller) return

  // Uncontrolled page + active worker + nothing installing/waiting is the
  // HARD-RELOAD state: clients.claim() ran long ago, controllerchange can
  // never fire, and the page stays uncontrolled for its lifetime no
  // matter how long we wait — this gate used to stall every hard reload
  // the full 3s for nothing. Nothing on the first-tiles path needs page
  // control (the SW's /@resource/ route serves embedded-site composition
  // only), so proceed immediately.
  if (reg.active && !reg.installing && !reg.waiting) return

  // A worker IS installing/waiting (first visit / worker update):
  // clients.claim() fires controllerchange sub-second — wait for it,
  // briefly.
  await new Promise<void>(resolve => {
    navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
    setTimeout(resolve, 1500)
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
  ;(window as any).__hcBoot('bootstrap() started')

  // SW readiness runs OVERLAPPED with the install chain instead of gating it.
  // ensureSwControl can block up to 1500ms waiting for controllerchange on a
  // first visit / worker update, and nothing in ensureInstall → attachImportMap
  // → loader.load() depends on page control (the SW's /@resource/ route serves
  // embedded-site composition only — see ensureSwControl's hard-reload note;
  // every hard reload already boots fully uncontrolled). Relative order INSIDE
  // the chain is preserved: domains are posted only after control is ensured,
  // so the message reaches the controlling/active worker as before. The chain
  // is awaited below, before bootstrapApplication, so the end state at first
  // paint is unchanged.
  const swChain = (async () => {
    await ensureSwControl()
    // Hand the service worker the host domains (self + community) so an
    // embedded-site /@resource/<sig> request can stream from a host on an OPFS
    // miss. The SW has no localStorage/IoC, so the page must post them.
    await postCommunityDomainsToServiceWorker()
    ;(window as any).__hcBoot('ensureSwControl + sw-domains done')
  })()
  // Keep a handler attached from the start so a rejection during the install
  // overlap can't surface as an unhandledrejection; the real `await swChain`
  // below rethrows it, preserving the serial chain's abort-boot semantics.
  swChain.catch(() => {})

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
  ;(window as any).__hcBoot('ensureInstall done')
  await attachImportMap()
  ;(window as any).__hcBoot('attachImportMap (resolveImportMap) done')

  // Snapshot the sync signature applied at boot. Anything that drifts
  // from this (toggles in DCP, intake from web→DCP, etc.) means the
  // running shell is showing stale state — when the user leaves DCP
  // we reload to commit the new state.
  const bootSyncSig = localStorage.getItem('sentinel.sync-signature') ?? ''

  // Load dependency namespaces so services self-register before Angular renders
  const loader = get('@hypercomb.social/DependencyLoader') as DependencyLoader | undefined
  await loader?.load?.()
  ;(window as any).__hcBoot('DependencyLoader.load done')

  // Run runtime init (i18n catalogs, layer materialization, etc.) BEFORE
  // bootstrapApplication. Without this, bootstrap fires Angular's first
  // change-detection pass while CoreAdapter.initialize() is still loading
  // i18n catalogs in parallel — translations land mid-CD and the impure
  // `t` pipe's value flips from key to translated string within the same
  // tick, triggering ExpressionChangedAfterItHasBeenCheckedError on every
  // boot. Dev shell already does this (see hypercomb-dev/src/main.ts);
  // web didn't, which is why the error showed on 4200 but not 4250.
  await initializeRuntime({ logOpfs: false })
  ;(window as any).__hcBoot('initializeRuntime done')

  // Join the overlapped SW chain before Angular boots: same guarantee as the
  // old serial order (SW controlled + domains posted before first paint), and
  // a failure aborts boot exactly like it did when the chain was awaited
  // up top (rethrows into bootstrap().catch).
  await swChain

  const appRef = await bootstrapApplication(App, appConfig)
  ;(window as any).__hcBoot('bootstrapApplication done (Angular first paint)')

  // Lazy sentinel: no iframe until the user explicitly opens DCP. The
  // first call to getSentinel() mounts the hidden iframe at /sentinel
  // and performs the handshake; subsequent calls reuse the same bridge.
  let sentinelPromise: Promise<SentinelBridge | null> | null = null
  const getSentinel = (): Promise<SentinelBridge | null> => {
    if (!sentinelPromise) {
      sentinelPromise = initSentinel().then(bridge => {
        if (bridge) {
          // Per-toggle resync is DELIBERATELY not wired. Toggling a feature in
          // DCP (embedded installer OR standalone tab — both broadcast over the
          // same-origin dcp-toggle-state channel) must NOT pull or run anything
          // in the live session: nothing activates before the participant is
          // done. The host syncs DCP's FINAL enabled set only on an explicit
          // done — the embedded "Done" button (→ actions:available, below) or
          // closing a standalone DCP tab (onDcpClosed). First-run "Start"
          // (hypercomb:start-install) is the cold-install equivalent. Leaving
          // onToggleChanged unset means the sentinel still relays toggle events
          // but the host ignores them.
          bridge.onDcpClosed = () => reloadIfDrifted('dcp tab closed')
        }
        return bridge
      })
    }
    return sentinelPromise
  }

  // The resync pass: pull DCP's enabled set into OPFS, then either reload
  // (cold install) or load + run the enabled drones in place. It runs ONLY
  // on an explicit done (accept / tab-close / first-run Start), never per
  // toggle — the running shell keeps its currently loaded drones until the
  // participant authorizes the change.
  //
  // SINGLE-FLIGHT + COALESCE. A done can still overlap an in-flight pass
  // (e.g. accept landing while a first-run install is still streaming).
  // Two passes racing means one pass's removeDisabled/write can yank a bee
  // file out from under another pass's getBee() — the preloader logs
  // "returned null", that drone never registers, and the session runs
  // without it (dead selection, missing critical sigs) until a reload. One
  // pass runs at a time; calls that arrive mid-pass coalesce into a single
  // trailing rerun.
  const runResyncPass = async () => {
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
  let syncInFlight: Promise<void> | null = null
  let syncQueued = false
  const resyncAndEnforce = (): Promise<void> => {
    if (syncInFlight) { syncQueued = true; return syncInFlight }
    syncInFlight = (async () => {
      try {
        do {
          syncQueued = false
          await runResyncPass()
        } while (syncQueued)
      } finally {
        syncInFlight = null
      }
    })()
    return syncInFlight
  }

  const reloadIfDrifted = async (source: string) => {
    // Route through the same single-flight gate — a direct
    // resyncFromSentinel here would race a toggle-changed pass's
    // preloader exactly like concurrent toggle events did.
    await resyncAndEnforce()
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
  // Install/resync ONLY on the participant's explicit accept (Done →
  // `actions:available`). A passive installer close (× / backdrop / Escape /
  // touch-drag) fires `dcp:embed-closed`, but that must NOT pull bytes or
  // activate anything — nothing runs before authorization. reloadIfDrifted
  // resyncs and reloads the shell only if the accepted change advanced the
  // sync sig.
  window.addEventListener('actions:available', () => reloadIfDrifted('installer accepted'))

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
    // Persistent storage is the install's substrate — without OPFS every
    // source fails (slowly: sentinel timeout → resync no-op → bundled
    // write failure) and the card loops Start → Starting…. Private
    // windows and pre-16.4 Safari lack navigator.storage.getDirectory;
    // detect that up front and explain instead of attempting.
    if (typeof navigator.storage?.getDirectory !== 'function') {
      console.warn('[main] persistent storage unavailable — install cannot proceed')
      EffectBus.emit('boot:status', { kind: 'install-needed', reason: 'no-storage' } as BootStatus)
      return
    }
    void (async () => {
      // Note: boot status stays 'install-needed' while this runs so the
      // welcome card remains visible with its "Starting…" state — the
      // participant watches one card until the shell reloads ready.
      try {
        const sentinel = await getSentinel()
        if (sentinel) {
          // DCP-FIRST: the installer fetches + verifies + RECORDS the
          // baseline package in its registry (so every feature is
          // visible and toggleable in the installer from the start),
          // offering the shell's own bundled /content/ as the
          // last-resort content domain. The sync below then streams the
          // recorded, enabled set into this shell's OPFS.
          try {
            // Bounded: the bridge promise only settles when DCP replies — a
            // handler that dies mid-request would otherwise pin the card at
            // "Starting…" forever. On timeout, fall through to the sync +
            // bundled fallback; a slow-but-alive install keeps streaming in
            // the background and the resync picks its results up.
            const INSTALL_TIMEOUT_MS = 180_000
            try {
              await Promise.race([
                sentinel.install(
                  undefined,
                  // Stream install progress into the sync-indicator's
                  // 'install' lane. Each producer gets its own lane so
                  // the resync that follows can't wipe these counts or
                  // end the cue while this is still streaming.
                  ({ phase, current, total }) =>
                    EffectBus.emit('install:sync', { active: true, source: 'install', phase, current, total }),
                  `${location.origin}/content`,
                ),
                new Promise(resolve => setTimeout(resolve, INSTALL_TIMEOUT_MS)),
              ])
            } finally {
              // Terminate the lane on completion AND on timeout — a
              // timed-out install may keep streaming in the background,
              // but the resync that follows owns the visible cue from
              // here (its lane re-activates the indicator).
              EffectBus.emit('install:sync', { active: false, source: 'install' })
            }
          } catch (err) {
            console.warn('[main] first-run dcp install failed', err)
          }
        }
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
