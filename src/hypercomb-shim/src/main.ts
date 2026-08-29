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
import '@hypercomb/shared/core/ioc.web'

import type { DependencyLoader } from '@hypercomb/shared/core/dependency-loader'
import { PACKED_STORE_MEANING } from '@hypercomb/shared/core/packed-store-engine'
import { packedStoreBlocksBoot } from '@hypercomb/shared/core/packed-store-gate'
import { initializeRuntime } from '@hypercomb/shared/core/runtime-initializer'
import { Store } from '@hypercomb/shared/core/store'
import { postCommunityDomainsToServiceWorker } from '@hypercomb/shared/core/sw-domains'

// NO ensure-install HERE, deliberately. Acquisition is not the shim's job —
// plan doc Phase 4 carves ensure-install (1,103 lines) + sentinel-bridge into
// ONE sig-addressed bootstrap bundle that the shim fetches by pinned
// signature, and the install prompt becomes that bee's surface. Importing it
// here would fuse the shim to the thing it is supposed to load.
//
// It is also load-bearing in a way worth recording: ensure-install reaches
// shared through the `@hypercomb/shared/core` BARREL, and that barrel is what
// makes the ambient `register()` global exist by the time store.ts evaluates
// its module-scope registration. Narrowing that import to
// `@hypercomb/shared/core/store` compiles and ships fine, but breaks
// ensure-install.spec.ts, which imports the module without a shell to install
// the global first. Left alone until the carve-out makes the question moot.
import { IMPORT_MAP_STORAGE_KEY, resolveImportMap } from '../../hypercomb-web/src/setup/resolve-import-map'

import { mountSurfaces, surfaceReport } from './surfaces'

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

  // Dependency namespaces self-register their services before anything asks
  // for them.
  const loader = window.ioc?.get<DependencyLoader>('@hypercomb.social/DependencyLoader')
  await loader?.load?.()
  ;(window as any).__hcBoot('DependencyLoader.load done')

  // i18n catalogs, layer materialization, host resolution.
  await initializeRuntime({ logOpfs: false })
  ;(window as any).__hcBoot('initializeRuntime done')

  const report = mountSurfaces()
  ;(window as any).__hcBoot(`surfaces mounted (${report.mounted} element, ${report.angular} angular)`)

  // The scoreboard, printed every boot. `angular` is the number of panels
  // still owing a conversion; it may only go down.
  console.log(
    `[shim] surfaces — ${report.mounted} element-shaped mounted, ${report.angular} still Angular-shaped`,
    report.angularNames,
  )
  ;(window as any).__hcSurfaces = surfaceReport

  document.getElementById('hc-splash')?.remove()
  window.dispatchEvent(new Event('hypercomb:runtime-ready'))
}

boot().catch(err => {
  console.error('[shim] boot failed', err)
  renderBootFailure(err)
})
