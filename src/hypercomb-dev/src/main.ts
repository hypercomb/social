// hypercomb-dev/src/main.ts

// ── boot perf trail ──────────────────────────────────────────────────────────
// T0 = the earliest point we can capture inside the module graph. Any
// shared/essentials code that calls window.__hcBoot('label') from here on
// gets a `[boot] +Nms label` line in the console and pushes into
// window.__hcBootMarks. Helper is dev-only; no-op on shells that don't set
// __hcBootT0, so shared code can call it unconditionally.
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
// later mark logs `[nav] +Nms label`. Shared/essentials code calls
// window.__hcNav?.('label') unconditionally; shells that don't define it
// no-op. Lets any profile answer "which stage of THIS navigation was slow"
// straight from the console, no external tooling.
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
import { PACKED_STORE_MEANING } from '@hypercomb/shared/core/packed-store-engine'
import { packedStoreBlocksBoot } from '@hypercomb/shared/core/packed-store-gate'
import { installScaleProbe } from '@hypercomb/shared/core/packed-store-scale-probe'
import { EffectBus, SignatureStore } from '@hypercomb/core'
import { Store } from '@hypercomb/shared'
import {
  initializeRuntime,
  DroneRegistry,
  IconProviderRegistry,
  protectOriginStorage,
} from '@hypercomb/shared/core'
import { postCommunityDomainsToServiceWorker } from '@hypercomb/shared/core/sw-domains'
import { initSentinel, type SentinelBridge } from '../../hypercomb-web/src/setup/sentinel-bridge'
import { appConfig } from './app/app.config'
import { App } from './app/app'

// keep this as a value-use so the module can't be elided
void Store
void DroneRegistry
void IconProviderRegistry

/**
 * Boot runs before Angular owns the page. If storage cannot be reopened (for
 * example, a restored packed hive is busy in another tab), Angular never gets
 * a chance to render its ordinary error surfaces. Do not leave the participant
 * looking at an inert background: replace the splash with a plain-DOM failure
 * panel that works even when the framework did not start.
 */
const renderBootFailure = (error: unknown): void => {
  try {
    document.getElementById('hc-splash')?.remove()
    const root = document.querySelector('app-root') ?? document.body
    root.replaceChildren()

    const panel = document.createElement('main')
    panel.setAttribute('role', 'alert')
    panel.style.cssText = [
      'box-sizing:border-box',
      'max-width:48rem',
      'margin:12vh auto 0',
      'padding:1.5rem',
      'color:#dce7ef',
      'background:rgba(8,13,19,.94)',
      'border:1px solid rgba(126,182,214,.38)',
      'border-radius:4px',
      'font:14px/1.55 system-ui,sans-serif',
    ].join(';')

    const heading = document.createElement('h1')
    heading.textContent = 'Hypercomb could not open this local hive'
    heading.style.cssText = 'margin:0 0 .75rem;font-size:1.15rem;color:#f1f6fa'

    const explanation = document.createElement('p')
    explanation.textContent =
      'Nothing was deleted. If this hive uses the packed store, close any other tab using this same address and retry.'

    const detail = document.createElement('pre')
    detail.textContent = error instanceof Error ? error.message : String(error)
    detail.style.cssText =
      'white-space:pre-wrap;overflow-wrap:anywhere;padding:.8rem;background:#090d12;color:#9fb4c4;border-radius:4px'

    const retry = document.createElement('button')
    retry.type = 'button'
    retry.textContent = 'Retry opening this hive'
    retry.style.cssText =
      'margin-top:.5rem;padding:.65rem .9rem;border:1px solid #6e9fbd;border-radius:4px;background:#183044;color:#eef7ff;cursor:pointer'
    retry.addEventListener('click', () => window.location.reload())

    panel.append(heading, explanation, detail, retry)
    root.append(panel)
  } catch {
    // The original console error remains the last-resort diagnostic.
  }
}

/**
 * Register the same service worker prod uses. It serves
 * `/@resource/<sig>` from the flat OPFS root (sig-named content files;
 * the legacy `__resources__/` dir is a read-fallback drain source only),
 * with content-type inferred from the URL tail extension (or sniffed
 * from the blob).
 * Per-cell pages link shared chrome via `<link href="resource:<sig>">`
 * — the renderer rewrites to `/@resource/<sig>` before injection,
 * and the worker resolves it. Without the worker the dev shell
 * would 404 those URLs and composition breaks.
 */
const ensureSwControl = async (): Promise<void> => {
  if (!('serviceWorker' in navigator)) return
  try {
    await navigator.serviceWorker.register('/hypercomb.worker.js', { scope: '/' })
    const reg = await navigator.serviceWorker.ready
    if (navigator.serviceWorker.controller) return
    // Hard-reload state: active worker, nothing installing/waiting —
    // controllerchange can never fire (claim ran long ago) and the page
    // stays uncontrolled regardless; waiting 3s here bought nothing.
    // First tiles never touch the SW route, so proceed immediately.
    if (reg.active && !reg.installing && !reg.waiting) return
    // Worker genuinely installing/updating: claim fires sub-second.
    await new Promise<void>(resolve => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
      setTimeout(resolve, 1500)
    })
  } catch (err) {
    console.warn('[hypercomb-dev] service-worker registration failed', err)
  }
}

const main = async (): Promise<void> => {

  // central signature allowlist — signText() memoizes repeated computeSignatureLocation calls
  register('@hypercomb/SignatureStore', new SignatureStore())

  ;(window as any).__hcBoot('main() started')
  // Dev-only: the packed-store scale probe, driven from the console. It
  // writes only when explicitly told to — see the file's safety notes.
  installScaleProbe()
  // ONE-WAY DOOR GATE. Must be the FIRST thing in ${0,0}main — before any module can
  // acquire OPFS. A hive drained into the packed store is not fully present in
  // the flat layout, and booting on it would silently build atop a partial
  // hive. Returns true only when a POPULATED pack exists and packed mode is
  // not engaging; it renders its own explanation and seals storage.
  if (await packedStoreBlocksBoot(await Store.poolSignature(PACKED_STORE_MEANING))) return

  // Match production's OPFS eviction protection without putting the permission
  // check or a possible Firefox prompt on the boot path.
  void protectOriginStorage()
  await ensureSwControl()

  // Hand the service worker the host domains (self + community) so an
  // embedded-site /@resource/<sig> request can stream from a host on an
  // OPFS miss. The SW has no localStorage/IoC, so the page must post them.
  await postCommunityDomainsToServiceWorker()
  ;(window as any).__hcBoot('ensureSwControl done')
  await initializeRuntime()
  ;(window as any).__hcBoot('initializeRuntime done')

  // ── the accepted install reports that it FINISHED ────────────────────
  // portal-overlay lights the header banner ("Adopting packages and
  // website…") the moment an accept lands, and only a terminal
  // `update:status` puts it out. Production's counterpart lives in
  // hypercomb-web/src/main.ts, which owns TWO legs — the content fold and
  // a package resync into OPFS. The dev shell imports its drones directly,
  // so it has no package leg at all, and it had no listener either: the
  // banner came on and nothing in this shell could ever turn it off. It sat
  // there as dead text, and because `busy()` gates the available-update
  // branch, the indicator could not announce another update until reload.
  //
  // So dev closes the ONE leg it actually has. SwarmAdoptDrone receives the
  // same window event and answers with `fold:receipt`; subscribe before the
  // first await, because a small fold can land immediately. No content to
  // fold means nothing to wait for — the accept is already complete.
  window.addEventListener('actions:available', event => {
    const detail = (event as CustomEvent<{ contentChanges?: number; transactionId?: string }>).detail
    const expectedContentChanges = Math.max(0, Number(detail?.contentChanges ?? 0))
    const transactionId = String(detail?.transactionId ?? '')
    if (expectedContentChanges <= 0) {
      EffectBus.emit('update:status', { phase: 'complete', message: 'Everything is updated' })
      return
    }
    let unsub: (() => void) | null = null
    const timer = window.setTimeout(() => {
      unsub?.()
      console.error('[hypercomb-dev] content adoption did not finish in time')
      EffectBus.emit('update:status', {
        phase: 'error',
        message: 'Update incomplete — your restore point is safe',
      })
    }, 60_000)
    unsub = EffectBus.on<{ unavailable?: number; transactionId?: string }>('fold:receipt', receipt => {
      if (transactionId && receipt?.transactionId !== transactionId) return
      window.clearTimeout(timer)
      unsub?.()
      const unavailable = receipt?.unavailable ?? 0
      if (unavailable > 0) {
        console.error(`[hypercomb-dev] ${unavailable} adopted item(s) are still unavailable`)
        EffectBus.emit('update:status', {
          phase: 'error',
          message: 'Update incomplete — your restore point is safe',
        })
      } else {
        EffectBus.emit('update:status', { phase: 'complete', message: 'Everything is updated' })
      }
    })
  })

  await bootstrapApplication(App, appConfig)
  ;(window as any).__hcBoot('bootstrapApplication done')

  // Dev uses the same explicit, lazy DCP transaction channel as production.
  // Folder hard-copy and the push queue can request it without making DCP part
  // of the startup critical path.
  let sentinelPromise: Promise<SentinelBridge | null> | null = null
  ;(globalThis as any).__getSentinel = (): Promise<SentinelBridge | null> =>
    sentinelPromise ??= initSentinel()
}

main().catch(err => {
  console.error(err)
  renderBootFailure(err)
})
