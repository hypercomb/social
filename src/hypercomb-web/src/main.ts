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
// NATIVE SHELL: route every OPFS acquisition to the one native hive BEFORE
// anything can capture the original — nine files call
// navigator.storage.getDirectory() directly, and WebView2 has a real OPFS
// bucket they would otherwise silently write into. No-op in a browser.
import { installNativeStorageOverride, installNativeSwBridge } from '@hypercomb/shared/core/native-filesystem'
installNativeStorageOverride()
// Answer the service worker's byte requests from the native store — the SW
// global can see neither the Tauri bridge nor the storage override.
installNativeSwBridge()
// Capture a `/<sig>` meeting-place invite link before navigation parses the
// URL — stashes the sig for the receive-side MeetingInviteWorker.
import '@hypercomb/shared/core/invite-capture'
// Restore the persisted header-size preset before first paint + register the
// `/header` slash command (auto-wires via ioc.onRegister).
import '@hypercomb/shared/core/header-size'

import { BEE_RESOLVER_KEY, EffectBus } from '@hypercomb/core'
import { Store } from '@hypercomb/shared/core/store'
import { PACKED_STORE_MEANING } from '@hypercomb/shared/core/packed-store-engine'
import { packedStoreBlocksBoot } from '@hypercomb/shared/core/packed-store-gate'
import { fetchPinnedPackage } from './setup/pinned-package'
import type { BootStatus } from './setup/ensure-install'
import type { SentinelBridge } from './setup/sentinel-bridge'
import { cacheImportMap, IMPORT_MAP_STORAGE_KEY, resolveImportMap } from './setup/resolve-import-map'
import { App } from './app/app'
import { DependencyLoader } from '@hypercomb/shared/core/dependency-loader'
import { ScriptPreloader } from '@hypercomb/shared/core/script-preloader'
import { importSignatureModule } from '@hypercomb/shared/core/signature-module-loader'
import { initializeRuntime } from '@hypercomb/shared/core/runtime-initializer'
import { protectOriginStorage } from '@hypercomb/shared/core/storage-persistence'
import { postCommunityDomainsToServiceWorker } from '@hypercomb/shared/core/sw-domains'

// Ensure side-effect registration
const _deps = [DependencyLoader, ScriptPreloader]
type AcquisitionModule = typeof import('./setup/acquisition-bootstrap')

const loadAcquisition = async (): Promise<AcquisitionModule> => {
  const pinned = await fetchPinnedPackage()
  if (pinned.status === 'absent') {
    console.warn('[main] bootstrap pin absent — using the bounded legacy acquisition chunk')
    return import('./setup/acquisition-bootstrap')
  }
  if (pinned.status === 'invalid') {
    throw new Error(`bootstrap pin rejected: ${pinned.reason}`)
  }
  const poolSignature = await Store.poolSignature('dependencies')
  const loaded = await importSignatureModule(poolSignature, pinned.package.acquisition)
  return loaded as AcquisitionModule
}

const ensureSwControl = async (): Promise<void> => {
  if (!('serviceWorker' in navigator)) return

  // The native shell stamps window.__hcSwV with the worker's content hash at
  // bake time: WebView2 would not re-install a changed worker at the same URL
  // on the custom protocol (verified live — new bytes served, old SW stayed
  // active). A versioned URL makes every worker change a fresh registration.
  // Web is untouched: __hcSwV is undefined there.
  const swV = (window as any).__hcSwV
  await navigator.serviceWorker.register('/hypercomb.worker.js' + (swV ? '?v=' + swV : ''), { scope: '/' })
  const reg = await navigator.serviceWorker.ready

  const reloadGuard = 'hc:sw-control-reload'
  if (navigator.serviceWorker.controller) {
    try { sessionStorage.removeItem(reloadGuard) } catch {}
    return
  }

  // The acquisition bundle itself now arrives through `/opfs/<pool>/<sig>`,
  // so page control is a real boot invariant rather than an optional resource
  // optimization. A newly activating worker normally claims within this
  // window. An already-active worker cannot retroactively claim a page that
  // navigated uncontrolled, so reload once and let the next navigation start
  // under it; the guard converts a genuinely broken registration into an
  // explicit failure instead of an infinite loop.
  await new Promise<void>(resolve => {
    navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
    setTimeout(resolve, 1500)
  })
  if (navigator.serviceWorker.controller) {
    try { sessionStorage.removeItem(reloadGuard) } catch {}
    return
  }
  let alreadyReloaded = false
  try { alreadyReloaded = sessionStorage.getItem(reloadGuard) === 'true' } catch {}
  if (alreadyReloaded) throw new Error('service worker did not take control after the bootstrap reload')
  try { sessionStorage.setItem(reloadGuard, 'true') } catch {}
  location.reload()
  await new Promise<never>(() => {})
}

// Current content modules embed exact OPFS signature URLs and require no
// browser import map. This replay path is a bounded compatibility bridge for
// an already-installed package that predates signed @hypercomb/core / pixi.js
// leaves. Such a map has to be LIVE before a module script loads, so index.html
// replays the cached legacy map and this boot keeps that cache truthful until
// the participant adopts a current package.
const appendImportMap = (json: string): void => {
  const script = document.createElement('script')
  script.type = 'importmap'
  script.textContent = json
  document.head.appendChild(script)
}

const attachImportMap = async (): Promise<void> => {
  const imports = await resolveImportMap()

  // Current signed package (or no installed package): the dependency scan was
  // still useful for alias metadata, but there is no executable map. Remove a
  // stale compatibility cache; exact module URLs make a reload unnecessary.
  if (Object.keys(imports).length === 0) {
    try { localStorage.removeItem(IMPORT_MAP_STORAGE_KEY) } catch {}
    return
  }

  const json = JSON.stringify({ imports })

  // Already applied by index.html before the module graph loaded — done.
  if ((window as any).__hcImportMapApplied === json) return

  try { localStorage.setItem(IMPORT_MAP_STORAGE_KEY, json) } catch {}

  // Late append: correct on browsers that merge late maps, ignored (with a
  // console warning) on those that don't — hence the reload guard below.
  appendImportMap(JSON.stringify({ imports }, null, 2))

  // No installed dependency metadata → no legacy module will load this
  // session; the next boot picks the compatibility map cache up early.
  const aliasMap = (globalThis as any).__hypercombAliasMap as Map<string, string> | undefined
  if (!aliasMap?.size) return

  // The map this session needs was NOT live at module-load time. On a browser
  // that ignored the late append, every dep and bee import is about to fail.
  // Reload once per map per session so index.html applies it up front; the
  // guard means a browser that DID accept the late map never loops.
  let guard: string | null = null
  try { guard = sessionStorage.getItem(IMPORT_MAP_STORAGE_KEY) } catch {}
  if (guard === json) return

  try { sessionStorage.setItem(IMPORT_MAP_STORAGE_KEY, json) } catch { return }
  console.warn('[main] import map was not live at module load — reloading once to apply it early')
  location.reload()
  // Stop boot here; the reload is in flight and nothing below should run.
  await new Promise<never>(() => {})
}

const bootstrap = async (): Promise<void> => {
  ;(window as any).__hcBoot('bootstrap() started')
  // ONE-WAY DOOR GATE. Must be the FIRST thing in ${0,0}main — before any module can
  // acquire OPFS. A hive drained into the packed store is not fully present in
  // the flat layout, and booting on it would silently build atop a partial
  // hive. Returns true only when a POPULATED pack exists and packed mode is
  // not engaging; it renders its own explanation and seals storage.
  if (await packedStoreBlocksBoot(await Store.poolSignature(PACKED_STORE_MEANING))) return


  // The real 'hypercomb:start-install' handler registers at the END of
  // bootstrap, after Angular is up. An early dispatch — the native shell's
  // auto-install fires when hc-install-prompt connects DURING Angular bootstrap —
  // lands before that handler exists and is silently lost, leaving the card
  // on "Starting…" forever. (A human click seconds later never hits this,
  // which is why the web shell never saw it.) Catch the early dispatch here
  // and replay it once the real handler is live.
  let startInstallBeforeReady = false
  window.addEventListener(
    'hypercomb:start-install',
    () => { startInstallBeforeReady = true },
    { once: true },
  )

  // OPFS starts as best-effort storage. Check its eviction protection without
  // delaying boot, then request persistence inside the participant's first
  // trusted interaction (Firefox may prompt; Chromium/Safari decide silently).
  void protectOriginStorage()

  // The first executable thing behind the mutable deployment pin is an exact
  // `/opfs/<pool>/<sig>` import, so SW control precedes package discovery.
  await ensureSwControl()
  await postCommunityDomainsToServiceWorker()
  ;(window as any).__hcBoot('ensureSwControl + sw-domains done')

  const acquisition = await loadAcquisition()
  const {
    ensureInstall,
    initSentinel,
    opfsWritable,
    resyncFromSentinel,
    upgradeFromBundled,
  } = acquisition
  ;(window as any).__hcBoot('signed acquisition bootstrap loaded')

  // Push-only contract: NO DCP iframe is mounted at boot. Boot reads
  // OPFS only. The sentinel bridge is created lazily on the first
  // explicit user action that needs DCP — opening the installer from
  // the menu, the install-needed prompt, or the in-app DCP portal.
  await ensureInstall(null)
  ;(window as any).__hcBoot('ensureInstall done')

  // Capture install state only AFTER ensureInstall has initialized the store
  // and normalized localStorage against the real cache. Reading the flag first
  // let a stale `true` suppress the cold-install reload even though no usable
  // install existed — the shell stayed up with no bees and no tiles.
  const wasInstalledAtBoot = localStorage.getItem('hypercomb.installed') === 'true'

  await attachImportMap()
  ;(window as any).__hcBoot('attachImportMap (resolveImportMap) done')

  // Snapshot the sync signature applied at boot. Anything that drifts
  // from this (toggles in DCP, intake from web→DCP, etc.) means the
  // running shell is showing stale state — when the user leaves DCP
  // we reload to commit the new state.
  const bootSyncSig = localStorage.getItem('sentinel.sync-signature') ?? ''

  // Load dependency namespaces so services self-register before the shell renders.
  const loader = get('@hypercomb.social/DependencyLoader') as DependencyLoader | undefined
  await loader?.load?.()
  ;(window as any).__hcBoot('DependencyLoader.load done')

  // Run runtime init (i18n catalogs, layer materialization, etc.) before the
  // framework-free host starts its bees, so their first pulse sees complete
  // catalogs and materialized layers.
  await initializeRuntime({ logOpfs: false })
  ;(window as any).__hcBoot('initializeRuntime done')

  const preloader = get('@hypercomb.social/ScriptPreloader')
  register(BEE_RESOLVER_KEY, preloader)
  const appRoot = document.querySelector('app-root')
  if (!(appRoot instanceof App)) throw new Error('framework-free app-root did not upgrade')
  void appRoot.start().catch(error => console.error('[app] runtime start failed', error))
  ;(window as any).__hcBoot('app-root connected (framework-free first paint)')

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
          // accept (→ actions:available, below — the embedded installer's own
          // confirm, never its Done button, which only leaves) or closing a
          // standalone DCP tab (onDcpClosed). First-run "Start"
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
  ;(globalThis as any).__getSentinel = getSentinel

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
      // Cache the map the install just made resolvable, so the reload boots
      // with it live before the module graph (see attachImportMap).
      await cacheImportMap()
      location.reload()
      return
    }

    const preloader = get('@hypercomb.social/ScriptPreloader') as any
    if (preloader?.find) await preloader.find('')
    appRoot.refresh()
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
      await cacheImportMap()
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
  // Install/resync ONLY on the participant's explicit accept
  // (`actions:available`). Every installer EXIT — the Done button, the
  // backdrop, Escape, a touch-drag — fires `dcp:embed-closed` instead, and
  // that must NOT pull bytes or activate anything: nothing runs before
  // authorization. reloadIfDrifted resyncs and reloads the shell only if the
  // accepted change advanced the sync sig.
  window.addEventListener('actions:available', event => {
    const detail = (event as CustomEvent<{ contentChanges?: number; transactionId?: string }>).detail
    const expectedContentChanges = Math.max(0, Number(detail?.contentChanges ?? 0))
    const transactionId = String(detail?.transactionId ?? '')

    // Subscribe before the first await: SwarmAdoptDrone receives the same
    // window event and may finish a small fold quickly. The update is not
    // complete until BOTH the package resync and the website/content fold
    // report success.
    const foldDone = expectedContentChanges > 0
      ? new Promise<void>((resolve, reject) => {
          let unsub: (() => void) | null = null
          const timer = window.setTimeout(() => {
            unsub?.()
            reject(new Error('content adoption did not finish in time'))
          }, 60_000)
          unsub = EffectBus.on<{ unavailable?: number; transactionId?: string }>('fold:receipt', receipt => {
            if (transactionId && receipt?.transactionId !== transactionId) return
            window.clearTimeout(timer)
            unsub?.()
            if ((receipt?.unavailable ?? 0) > 0) {
              reject(new Error(`${receipt.unavailable} adopted item(s) are still unavailable`))
            } else {
              resolve()
            }
          })
        })
      : Promise.resolve()

    void (async () => {
      try {
        EffectBus.emit('update:status', { phase: 'applying', message: 'Adopting packages and website…' })
        // Content first, then package/code. If the website fold cannot finish,
        // no new executable package is loaded into the live session. If the
        // later package leg fails, the already-committed named restore point
        // still provides a one-gesture return path for the content leg.
        await foldDone
        await resyncAndEnforce()

        const currentSyncSig = localStorage.getItem('sentinel.sync-signature') ?? ''
        const drifted = !!currentSyncSig && currentSyncSig !== bootSyncSig
        if (drifted) await cacheImportMap()

        // Persisted by the indicator so the check survives a required reload.
        EffectBus.emit('update:status', { phase: 'complete', message: 'Everything is updated' })
        if (drifted) {
          console.log('[main] installer accepted with drift — reloading after all adoption work completed')
          location.reload()
        }
      } catch (err) {
        console.error('[main] accepted DCP update failed safely', err)
        EffectBus.emit('update:status', {
          phase: 'error',
          message: 'Update incomplete — your restore point is safe',
        })
      }
    })()
  })

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
    console.log('[main] start-install received')
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
    // iOS 16.4–18.3 passes the gate above but cannot WRITE (no
    // createWritable until 18.4) — every install source would throw and the
    // card would loop Start → Starting… forever. Explain instead.
    if (!opfsWritable()) {
      console.warn('[main] OPFS present but not writable — browser too old to install')
      EffectBus.emit('boot:status', { kind: 'install-needed', reason: 'no-writable' } as BootStatus)
      return
    }
    void (async () => {
      // Note: boot status stays 'install-needed' while this runs so the
      // welcome card remains visible with its "Starting…" state — the
      // participant watches one card until the shell reloads ready.

      // THE INSTALLED FLAG IS A CLAIM, NOT EVIDENCE. It lives in
      // localStorage; the content it claims to describe lives in the store.
      // Those can disagree — a store reset, a half-finished install, or a
      // shell pointed at a fresh store all leave the flag true with nothing
      // installed. The bundled fallback below then returns early and the card
      // loops Start → Starting… forever, with no error anywhere, because
      // every step "succeeded".
      //
      // So verify the claim against the store before trusting it.
      try {
        const store = get('@hypercomb.social/Store') as
          { bees?: { keys(): AsyncIterable<string> } } | undefined
        if (localStorage.getItem('hypercomb.installed') === 'true' && store?.bees) {
          let any = false
          for await (const _ of store.bees.keys()) { any = true; break }
          if (!any) {
            console.warn('[main] installed flag set but no bees present — clearing and reinstalling')
            localStorage.removeItem('hypercomb.installed')
          }
        }
      } catch (err) {
        console.warn('[main] could not verify the installed flag', err)
      }

      try {
        // NATIVE SHELL: bundled-only, deliberately. The DCP sentinel
        // handshake requires DCP to recognise the embedding origin, and it
        // does not know `tauri.localhost` — the iframe loads, the handshake
        // neither succeeds nor fails, and getSentinel() waits forever with
        // "Starting…" on screen. Skipping DCP entirely (rather than racing
        // it) makes the native first-run deterministic: the client installs
        // from its own bundled content, which is the right contract for a
        // self-contained desktop install anyway. DCP returns when its
        // allowlist learns the native origin.
        const { nativeAvailable } = await import('@hypercomb/shared/core/native-filesystem')
        console.log('[main] resolving sentinel (native skips DCP)')
        const sentinel = nativeAvailable() ? null : await getSentinel()
        console.log('[main] sentinel:', sentinel ? 'present' : 'skipped/absent')
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
        // NATIVE: skip the sentinel resync as well — resyncFromSentinel
        // mounts the DCP iframe itself, and awaiting a handshake DCP will
        // never answer for the native origin is exactly the hang the sentinel
        // skip above exists to avoid. Verified live over CDP: "resyncAndEnforce
        // starting" was the last line the install ever printed. Bundled is the
        // native install path, and it is next.
        if (!nativeAvailable()) {
          console.log('[main] resyncAndEnforce starting')
          await resyncAndEnforce()   // reloads on cold-install success
          console.log('[main] resyncAndEnforce done')
        }
      } catch (err) {
        console.warn('[main] first-run sentinel install failed', err)
      }
      if (localStorage.getItem('hypercomb.installed') === 'true') return
      // Log the failure rather than swallowing it. A bundled install that
      // throws is the difference between "no content available" and "the
      // install crashed", and without this both look identical from outside —
      // which cost real time diagnosing the native shell's first boot.
      const ok = await upgradeFromBundled().catch(err => {
        console.warn('[main] bundled install threw', err)
        return false
      })
      if (ok) { await cacheImportMap(); location.reload(); return }
      console.warn('[main] first-run install exhausted both sources (sentinel + bundled)')
      EffectBus.emit('boot:status', { kind: 'install-needed', reason: 'no-sentinel' } as BootStatus)
    })()
  })

  // Replay an auto-install that fired before the handler above existed.
  if (startInstallBeforeReady) {
    console.log('[main] replaying early start-install (auto-install raced bootstrap)')
    window.dispatchEvent(new CustomEvent('hypercomb:start-install'))
  }
}

bootstrap().catch(err => console.error(err))
