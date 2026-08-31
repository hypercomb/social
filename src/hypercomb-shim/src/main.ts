// hypercomb-shim/src/main.ts
//
// THE FRAMEWORK-FREE SHIM. Phase 5 of the shrink plan, pulled to the front so
// it can be grown into rather than arrived at.
//
// hypercomb-web/src/main.ts already IS this boot — every step below is the
// same call in the same order — except that it ends in bootstrapApplication()
// and this ends in mountSurfaces(). That one line is the whole difference
// today, and it is why the shim is worth standing up now: the boot sequence
// does not have to be invented, only unfused from Angular.
//
// What this deliberately does NOT carry (it lives in web/src/main.ts and
// belongs in the pinned bootstrap bee, plan doc Phase 4):
//   • the cold-install / Start welcome flow
//   • sentinel resync, drift enforcement, upgrade orchestration
//   • the visitor (read-only website) path
// The shim's job is: gate storage, get the SW in control, get an install,
// resolve the module graph, start the runtime, mount what registered. If
// OPFS is cold it reports and stops rather than growing an install UI.
//
// Read the boot-race comments in hypercomb-web/src/main.ts before changing
// the ORDER of anything here. They were paid for.

// ── boot perf trail ──────────────────────────────────────────────────────────
// Same contract as both shells: shared/essentials code calls
// window.__hcBoot('label') unconditionally and no-ops where it is undefined.
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
;(window as any).__hcBoot('shim main.ts module evaluated')

;(window as any).__hcNavT0 = 0
;(window as any).__hcNav = (label: string, extra?: string) => {
  const now = performance.now()
  if (label === 'nav:start') (window as any).__hcNavT0 = now
  console.log(`[nav] +${(now - (window as any).__hcNavT0 || now).toFixed(0)}ms ${label}${extra ? ` ${extra}` : ''}`)
}

// ioc.web FIRST — it installs window.ioc, and every module below registers
// into it at module scope. Importing it late means those registrations land
// on an ioc that does not exist yet.
import '@hypercomb/runtime/ioc.web'
// NO TOOL WINDOWS HERE, and that is not an omission. `@hypercomb.social/
// ToolWindows` is the docked-panel escape rung, and a host has no docked
// panels — every panel is still Angular in shared/ui, unreachable from here.
// Its only consumer resolves it optionally and documents the absent case:
// "with no panel showing, this rung answers false and the press falls
// straight through" (essentials/keyboard/escape-cascade.ts). Importing it
// would tie a publishable host to the monorepo to register a service
// nothing here can use. It arrives when panels do — as drones.

// The processor itself, and the key it resolves bees through.
import { BEE_RESOLVER_KEY, hypercomb } from '@hypercomb/core'

// SIDE-EFFECT IMPORT, and it must stay one. `import type` here compiles, ships,
// and silently does nothing: the module's module-scope
// `register('@hypercomb.social/DependencyLoader', …)` never runs, the lookup
// below answers undefined, and `loader?.load?.()` no-ops. The boot then prints
// "DependencyLoader.load done" in 0ms, no namespace bundle is ever imported,
// and every service they register — Settings, AxialService — is simply absent,
// so the renderer's `ready()` gate fails and the hive comes up blank with no
// error anywhere. A type-only import of a self-registering module is a silent
// removal of the module.
import '@hypercomb/runtime/dependency-loader'
import type { DependencyLoader } from '@hypercomb/runtime/dependency-loader'
// THE RUNNER'S OTHER HALF. Imported for its side effect: the module registers
// `@hypercomb.social/ScriptPreloader` at module scope, and BootstrapHistory
// (inside initializeRuntime) resolves it through IoC to import the installed
// bees. Without this import that lookup answers undefined, every boot mounts
// 0 surfaces, and nothing says why — the heap can be complete and verified and
// the hive still comes up empty.
import '@hypercomb/runtime/script-preloader'
// Same shape again: LocalizationService self-registers at module scope, and
// runtime-initializer's whole i18n block is gated on
// `get('@hypercomb.social/I18n')`. Without this import that lookup answered
// undefined, the block never ran, and the shim had NO translations at all —
// while still shipping 2.9 MB of catalogs for the service that never existed.
// Third self-registering module to be missing here; the pattern is the bug.
import '@hypercomb/runtime/i18n.service'
import { PACKED_STORE_MEANING } from '@hypercomb/runtime/packed-store-engine'
import { packedStoreBlocksBoot } from '@hypercomb/runtime/packed-store-gate'
import { initializeRuntime } from '@hypercomb/runtime/runtime-initializer'
import { Store } from '@hypercomb/runtime/store'
import { postCommunityDomainsToServiceWorker } from '@hypercomb/runtime/sw-domains'

// NO ACQUISITION CODE HERE. Not ensure-install, and no longer the shim's own
// replicate either — acquisition is SIGNED CONTENT now, fetched by pinned
// signature and verified before it runs (src/bootstrap-loader.ts). The shim
// keeps exactly three things, and this is the list:
//
//   1. service-worker registration and control
//   2. the packed-store one-way-door gate
//   3. the pinned-sig fetch path
//
// Everything else it does below is RUNTIME, not acquisition: ioc, the store,
// the module graph, the processor pulse. Those cannot be content — they are
// what content runs on.
//
// EVERY IMPORT BELOW IS MODULE-SPECIFIC, never the `@hypercomb/shared/core`
// barrel. The barrel re-exports Angular-flavoured modules, so a single import
// of it pulls @angular/core in — and that does not merely bloat the shim, it
// stops it booting (field decorators throw "not supported in JIT mode" with no
// AOT compiler). `ioc.web` above is what installs the ambient `register()` /
// `get()` globals the narrow modules expect at their module scope, which is
// why narrowing is safe here and the import ORDER is not cosmetic.
import { IMPORT_MAP_STORAGE_KEY, resolveImportMap } from './import-map'
// Only the LOADER is compiled in — the acquisition it loads is not. That
// bundle is fetched by signature at boot and verified before it runs, so
// nothing below imports it and the type is the only thing that crosses.
import { loadBootstrap, type BootstrapHandle } from './bootstrap-loader'
// Locales resolve by signature from the host, never from this bundle.
import { signatureCatalogs } from './locales'

import { mountSurfaces, scoreboardLine, surfaceReport } from './surfaces'

/** Register the OPFS module server. It serves `/@resource/<sig>` from the
 *  flat root; without it, composed pages 404 their shared chrome. */
const ensureSwControl = async (): Promise<void> => {
  if (!('serviceWorker' in navigator)) return
  try {
    await navigator.serviceWorker.register('/hypercomb.worker.js', { scope: '/' })
    const reg = await navigator.serviceWorker.ready
    if (navigator.serviceWorker.controller) return
    // Hard-reload state: active worker, nothing installing/waiting —
    // controllerchange can never fire, so waiting buys nothing.
    if (reg.active && !reg.installing && !reg.waiting) return
    await new Promise<void>(resolve => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
      setTimeout(resolve, 1500)
    })
  } catch (err) {
    console.warn('[shim] service-worker registration failed', err)
  }
}

/** Late-append the import map. The shim keeps the RELOAD-ONCE half out: it
 *  is a boot-flow decision that belongs to the installer bee, and a shim
 *  that reloads itself is much harder to reason about while it is being
 *  built. Browsers that merge late maps (Chrome/Edge 133+) resolve fine;
 *  index.html's synchronous replay covers the rest from the second boot. */
const attachImportMap = async (): Promise<void> => {
  const imports = await resolveImportMap()
  const json = JSON.stringify({ imports })
  if ((window as any).__hcImportMapApplied === json) return
  try { localStorage.setItem(IMPORT_MAP_STORAGE_KEY, json) } catch {}
  const script = document.createElement('script')
  script.type = 'importmap'
  script.textContent = json
  document.head.appendChild(script)
}

const renderBootFailure = (error: unknown): void => {
  try {
    document.getElementById('hc-splash')?.remove()
    const panel = document.createElement('main')
    panel.setAttribute('role', 'alert')
    panel.style.cssText = [
      'box-sizing:border-box', 'max-width:48rem', 'margin:12vh auto 0', 'padding:1.5rem',
      'color:#dce7ef', 'background:rgba(8,13,19,.94)', 'border:1px solid rgba(126,182,214,.38)',
      'border-radius:6px', 'font:14px/1.55 system-ui,sans-serif',
    ].join(';')
    const heading = document.createElement('h1')
    heading.textContent = 'Hypercomb could not start'
    heading.style.cssText = 'margin:0 0 .75rem;font-size:1.15rem;color:#f1f6fa'
    const detail = document.createElement('pre')
    detail.textContent = error instanceof Error ? (error.stack ?? error.message) : String(error)
    detail.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;padding:.8rem;background:#090d12;color:#9fb4c4;border-radius:4px'
    panel.append(heading, detail)
    document.body.append(panel)
  } catch { /* the console error remains the last-resort diagnostic */ }
}

const boot = async (): Promise<void> => {
  ;(window as any).__hcBoot('shim boot() started')

  // ONE-WAY DOOR GATE. Before ANY module can acquire OPFS. A hive drained
  // into the packed store is not fully present in the flat layout, and
  // booting on it would silently build atop a partial hive. It renders its
  // own explanation and seals storage.
  if (await packedStoreBlocksBoot(await Store.poolSignature(PACKED_STORE_MEANING))) return

  await ensureSwControl()
  await postCommunityDomainsToServiceWorker()
  ;(window as any).__hcBoot('sw control done')

  await attachImportMap()
  ;(window as any).__hcBoot('import map attached')

  // ACQUISITION, BY SIGNATURE. Loaded after the map because the bundle imports
  // `@hypercomb/core` as a bare specifier — the map's core entry is
  // unconditional, so it resolves on the coldest possible boot — and before
  // the module graph, because whatever it installs has to be on disk before
  // the preloader goes looking.
  let acquisition: BootstrapHandle | null = null
  try {
    acquisition = await loadBootstrap({ reason: 'cold' })
  } catch (error) {
    console.error('[shim] bootstrap failed to load', error)
  }
  ;(window as any).__hcBoot(
    acquisition ? `bootstrap ${acquisition.pin.slice(0, 12)} running` : 'bootstrap UNAVAILABLE',
  )

  // Dependency namespaces self-register their services before anything asks
  // for them.
  const loader = window.ioc?.get<DependencyLoader>('@hypercomb.social/DependencyLoader')
  await loader?.load?.()
  ;(window as any).__hcBoot('DependencyLoader.load done')

  // i18n catalogs, layer materialization, host resolution.
  await initializeRuntime({ logOpfs: false, catalogs: signatureCatalogs })
  ;(window as any).__hcBoot('initializeRuntime done')

  // THE PROCESSOR'S BEE SOURCE. `hypercomb.act()` resolves bees through
  // BEE_RESOLVER_KEY and does nothing at all when it answers undefined — no
  // error, no warning, just an empty pulse. The shells wire this in an
  // Angular `provideAppInitializer`; the shim wires it here. Without it a
  // complete, verified heap still comes up as an empty hive.
  const preloader = window.ioc?.get('@hypercomb.social/ScriptPreloader')
  if (preloader) window.ioc?.register(BEE_RESOLVER_KEY, preloader)

  // Surfaces mount BEFORE the first pulse, and stay live after it: the
  // registry announces every late registration and the reconciler is
  // subscribed, so a bee that registers a surface halfway through the pulse
  // still lands. Mounting first also means the count below is a floor, never
  // a race.
  const report = mountSurfaces()
  ;(window as any).__hcBoot(`surfaces mounted pre-pulse (${report.mounted} element, ${report.unreachable} unreachable)`)
  ;(window as any).__hcSurfaces = surfaceReport

  // THE FIRST PULSE. This is the whole runner: the processor asks the resolver
  // for bees, imports them, and pulses each one. Everything the hive is —
  // render, navigation, panels, behaviours — arrives from here.
  await new hypercomb().act()
  const live = surfaceReport()
  ;(window as any).__hcBoot(`first pulse done (${live.mounted} element, ${live.unreachable} unreachable)`)

  // The scoreboard, printed every boot. `unreachable` is the number of panels
  // still owing a conversion — counted from shared's barrel at BUILD time,
  // because the shim cannot see them at runtime. It may only go down.
  console.log(scoreboardLine(live), live.angularNames)

  document.getElementById('hc-splash')?.remove()
  window.dispatchEvent(new Event('hypercomb:runtime-ready'))

  // NOTHING CAME UP ⇒ ASK FOR A DOMAIN. The card is the shim's only surface
  // and this is the only place it appears. The test is what actually MOUNTED
  // after a pulse, not what localStorage claims: a hive whose package was
  // half-written, or whose OPFS was cleared under a stale installed-marker, is
  // empty in the way that matters however confident the marker is. Anything
  // that reached a surface boots straight past this and never sees it.
  if (live.mounted === 0 && live.angular === 0) {
    console.log('[shim] 0 surfaces — no package is live')
    if (acquisition) acquisition.prompt()
    else renderBootFailure(new Error(
      'Nothing is installed, and the bootstrap could not be loaded — so there is no way to install anything. ' +
      'The origin must publish /pin and serve the bundle it names.',
    ))
  }
}

boot().catch(err => {
  console.error('[shim] boot failed', err)
  renderBootFailure(err)
})
