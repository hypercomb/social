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

// The shipped locale catalogs. They used to live inside runtime-initializer;
// that module is in @hypercomb/runtime now and ships none of its own, because
// a locale is content and which languages exist is the host's answer. Web and
// dev still bundle theirs — Angular lazy-chunks them — so pass them in
// explicitly and nothing about these shells changes.
import { bundledCatalogs, bundledLocales } from '@hypercomb/shared/core/bundled-catalogs'
import '@hypercomb/shared/core/ioc.web'
// The escape cascade's door. This used to ride into every shell inside
// runtime-initializer; the runtime package cannot reach hypercomb-shared/ui,
// so the shell that wants tool windows imports them itself.
import '@hypercomb/shared/ui/tool-windows'
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

import { bootstrapApplication } from '@angular/platform-browser'
import { EffectBus } from '@hypercomb/core'
import { Store } from '@hypercomb/shared'
import { PACKED_STORE_MEANING } from '@hypercomb/shared/core/packed-store-engine'
import { packedStoreBlocksBoot } from '@hypercomb/shared/core/packed-store-gate'
import { ensureInstall, opfsWritable, upgradeFromBundled, type BootStatus } from './setup/ensure-install'
import { cacheImportMap, IMPORT_MAP_STORAGE_KEY, resolveImportMap } from './setup/resolve-import-map'
import { appConfig } from './app.config'
import { App } from './app/app'
import {
  DependencyLoader,
  initializeRuntime,
  protectOriginStorage,
} from '@hypercomb/shared/core'
import { postCommunityDomainsToServiceWorker } from '@hypercomb/shared/core/sw-domains'
import { nativeAvailable } from '@hypercomb/shared/core/native-filesystem'

// Ensure side-effect registration
const _deps = [DependencyLoader]

const ensureSwControl = async (): Promise<void> => {
  if (!('serviceWorker' in navigator)) return

  // The native shell stamps window.__hcSwV with the worker's content hash at
  // bake time: WebView2 would not re-install a changed worker at the same URL
  // on the custom protocol (verified live — new bytes served, old SW stayed
  // active). A versioned URL makes every worker change a fresh registration.
  // Web is untouched: __hcSwV is undefined there.
  const swV = (window as any).__hcSwV

  // A worker that CANNOT be registered is a missing feature, not a failed
  // boot. WebKitGTK — the Linux native shell's webview — exposes
  // navigator.serviceWorker on the tauri:// custom scheme, so the guard above
  // passes, and then rejects register() outright. This sits one statement
  // before bootstrapApplication, so the rejection took the whole shell down:
  // boot stopped at milestone #11 and never painted, on the one platform
  // whose smoke test is a hard gate. Nothing on the first-paint path needs a
  // worker — its /@resource/ route serves embedded-site composition only,
  // exactly as the controller gate below already notes — so degrade loudly
  // and carry on. macOS and WebView2 register normally and are unaffected.
  let reg: ServiceWorkerRegistration | null = null
  try {
    await navigator.serviceWorker.register('/hypercomb.worker.js' + (swV ? '?v=' + swV : ''), { scope: '/' })
    reg = await navigator.serviceWorker.ready
  } catch (error) {
    console.warn('[main] service worker unavailable — embedded-site resources will not stream from a host', error)
  }
  if (!reg) return

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

// The import map has to be LIVE before the browser triggers any module script
// load — and Angular's `main.js` (this file) is itself a module script, so a
// map appended from here is always late. Chrome/Edge 133+ merge late maps;
// Safari and older Chrome ignore them outright and every bare specifier a bee
// or dependency imports throws "Failed to resolve module specifier". The map
// can only be derived asynchronously (OPFS scan), so the contract is:
//   - index.html replays the cached map synchronously, before the module graph;
//   - here we keep that cache truthful against OPFS, and when what landed early
//     doesn't match what this session actually needs, reload ONCE so the early
//     script wins. Steady-state boots match and never reload.
/** A published website must NEVER reload itself. Its store is session memory,
 *  so every boot legitimately re-installs the bundled renderer and re-derives
 *  the import map — conditions the participant shell only ever hits once, and
 *  answers with a reload. On the visitor that turns into an endless boot loop
 *  the visitor can never exit, because nothing it learns survives the reload.
 *  Reload sites all route through here; the visitor simply carries on with
 *  the late-appended map (proven to resolve every dep in one pass). */
const reloadUnlessVisitor = (why: string): boolean => {
  if ((window as Window & { __HC_READONLY__?: boolean }).__HC_READONLY__ === true) {
    console.log(`[main] visitor: skipping reload (${why}) — a published website never reloads itself`)
    return false
  }
  location.reload()
  return true
}

const appendImportMap = (json: string): void => {
  const script = document.createElement('script')
  script.type = 'importmap'
  script.textContent = json
  document.head.appendChild(script)
}

const attachImportMap = async (): Promise<void> => {
  const imports = await resolveImportMap()
  const json = JSON.stringify({ imports })

  // Already applied by index.html before the module graph loaded — done.
  if ((window as any).__hcImportMapApplied === json) return

  try { localStorage.setItem(IMPORT_MAP_STORAGE_KEY, json) } catch {}

  // Late append: correct on browsers that merge late maps, ignored (with a
  // console warning) on those that don't — hence the reload guard below.
  appendImportMap(JSON.stringify({ imports }, null, 2))

  // No dependency aliases resolved (nothing installed yet) → no bare specifier
  // gets resolved this session; the next boot picks the cache up early.
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
  if (!reloadUnlessVisitor('import map not live')) return
  // Stop boot here; the reload is in flight and nothing below should run.
  await new Promise<never>(() => {})
}

const bootstrap = async (): Promise<void> => {
  ;(window as any).__hcBoot('bootstrap() started')
  const readonlyVisitor = (window as Window & { __HC_READONLY__?: boolean }).__HC_READONLY__ === true
  // ONE-WAY DOOR GATE. Must be the FIRST thing in ${0,0}main — before any module can
  // acquire OPFS. A hive drained into the packed store is not fully present in
  // the flat layout, and booting on it would silently build atop a partial
  // hive. Returns true only when a POPULATED pack exists and packed mode is
  // not engaging; it renders its own explanation and seals storage.
  if (await packedStoreBlocksBoot(await Store.poolSignature(PACKED_STORE_MEANING))) return


  // The real 'hypercomb:start-install' handler registers at the END of
  // bootstrap, after Angular is up. An early dispatch — the native shell's
  // auto-install fires from the App constructor, DURING Angular bootstrap —
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
  if (!readonlyVisitor) {
    void protectOriginStorage()
  }

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
  const swChain = readonlyVisitor
    // Published trees use ordinary immutable HTTP GETs. They neither register
    // the participant service worker nor teach one about community hosts.
    ? Promise.resolve()
    : (async () => {
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

  // Boot reads OPFS only. Content arrives by replicating a root signature
  // (documentation/install-by-replication.md) — there is no installer to
  // consult and no cross-origin bridge to mount.
  await ensureInstall()
  ;(window as any).__hcBoot('ensureInstall done')

  // Every visitor refresh starts with a new memory filesystem. Seed the
  // generic renderer from this deployment's hash-addressed /content package
  // before resolving the import map. ensureInstall
  // above has already initialized Store and corrected any stale localStorage
  // claim left by the previous, now-discarded session root.
  if (readonlyVisitor && localStorage.getItem('hypercomb.installed') !== 'true') {
    const installed = await upgradeFromBundled()
    if (!installed) throw new Error('visitor renderer package is unavailable')
    ;(window as any).__hcBoot('visitor bundled renderer installed in memory')
  }

  // Capture install state only AFTER ensureInstall has initialized the store
  // and normalized localStorage against the real cache. Reading the flag first
  // let a stale `true` suppress the cold-install reload even though no usable
  // install existed — the shell stayed up with no bees and no tiles.
  const wasInstalledAtBoot = localStorage.getItem('hypercomb.installed') === 'true'

  await attachImportMap()
  ;(window as any).__hcBoot('attachImportMap (resolveImportMap) done')

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
  await initializeRuntime({ logOpfs: false, catalogs: bundledCatalogs, locales: bundledLocales })
  ;(window as any).__hcBoot('initializeRuntime done')

  // Join the overlapped SW chain before Angular boots: same guarantee as the
  // old serial order (SW controlled + domains posted before first paint), and
  // a failure aborts boot exactly like it did when the chain was awaited
  // up top (rethrows into bootstrap().catch).
  await swChain

  const appRef = await bootstrapApplication(App, appConfig)
  ;(window as any).__hcBoot('bootstrapApplication done (Angular first paint)')
  // Visitor builds wait for this boundary before handing the signed site
  // descriptor to HiveVisitDrone. By here dependencies and bees are loaded,
  // Angular is painted, and the existing preview path can receive the root.
  window.dispatchEvent(new Event('hypercomb:runtime-ready'))

  // First-run "Start" — the welcome card's single button, fully unattended.
  // One source, one contract: the package bundled with this shell, every
  // byte sha256-verified against its signature before it is admitted. When
  // it comes up empty the card re-arms (boot:status install-needed).
  window.addEventListener('hypercomb:start-install', () => {
    if (readonlyVisitor) return
    console.log('[main] start-install received')
    // Persistent storage is the substrate — without OPFS the bundled write
    // fails and the card loops Start → Starting…. Private
    // windows and pre-16.4 Safari lack navigator.storage.getDirectory;
    // detect that up front and explain instead of attempting.
    // Native excepted: its hive is a real directory reached over IPC, and it
    // has no navigator.storage.getDirectory to offer. WebKitGTK exposes none,
    // so the Linux client refused to unpack the content it shipped with and
    // came up empty every launch — while app.ts, seeing install-needed, kept
    // auto-firing this same handler into the same refusal.
    if (!nativeAvailable() && typeof navigator.storage?.getDirectory !== 'function') {
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

      if (localStorage.getItem('hypercomb.installed') === 'true') return
      // Log the failure rather than swallowing it. A bundled install that
      // throws is the difference between "no content available" and "the
      // install crashed", and without this both look identical from outside —
      // which cost real time diagnosing the native shell's first boot.
      const ok = await upgradeFromBundled().catch(err => {
        console.warn('[main] bundled install threw', err)
        return false
      })
      if (ok) { await cacheImportMap(); reloadUnlessVisitor('first-run bundled install'); return }
      console.warn('[main] first-run install found no bundled package')
      EffectBus.emit('boot:status', { kind: 'install-needed', reason: 'no-source' } as BootStatus)
    })()
  })

  // Replay an auto-install that fired before the handler above existed.
  if (startInstallBeforeReady) {
    console.log('[main] replaying early start-install (auto-install raced bootstrap)')
    window.dispatchEvent(new CustomEvent('hypercomb:start-install'))
  }
}

bootstrap().catch(err => console.error(err))
