import { EffectBus } from '@hypercomb/core'
import type { Lineage } from './lineage'
import type { LocalizationService } from './i18n.service'
import type { Navigation } from './navigation'
import { OpfsTreeLogger } from './tree-logger'
import { collectProximity } from './proximity-registry'
import './install-monitor'
import './registry-snapshot'
import type { BootstrapHistory } from './bootstrap-history'
import { Store } from './store'

// Note: the legacy layer-tree materializers (materializeInstalledLayers,
// materializeStructure) and their helpers (readLayerNode, applyLayerToDir)
// were removed. They mirrored layer.children as folders under hypercomb.io/
// and __structure__/ — a parallel-store violation now that layers are the
// only source of truth for hierarchy. Render reads layer.children directly;
// no on-disk mirror is needed or wanted.

export type RuntimeInitializerOptions = {
  logOpfs?: boolean
  onMeshStateChange?: (enabled: boolean) => void
}

// Dev-build defaults, applied on a LOOPBACK origin only (the operator's own
// dev machine) and only when the value is unset — so two localhost tabs join
// the same swarm (same host + same room secret) with zero manual setup, while
// a real deployed origin (non-loopback) is never affected. An env.js
// HYPERCOMB_DEV_HOST still overrides the host; an explicit clear still empties
// the secret. The mesh relay's own loopback default (nostr-mesh.drone) lands
// on the same jwize.com relay.
const DEV_DEFAULT_HOST = 'jwize.com'
const DEV_DEFAULT_SECRET = 'downtown'

// Idempotent: callers in different parts of the boot sequence (web's
// main.ts, then App constructor → CoreAdapter.initialize) used to each
// call initializeRuntime, double-registering EffectBus listeners and
// double-loading translations. Cache the in-flight / completed promise
// and return it to subsequent callers.
let _initializeRuntimePromise: Promise<void> | null = null

export const initializeRuntime = async (
  options: RuntimeInitializerOptions = {},
): Promise<void> => {
  if (_initializeRuntimePromise) return _initializeRuntimePromise
  _initializeRuntimePromise = _runInitializeRuntime(options)
  return _initializeRuntimePromise
}

const _runInitializeRuntime = async (
  options: RuntimeInitializerOptions = {},
): Promise<void> => {
  const {
    logOpfs = false,
    onMeshStateChange,
  } = options

  // Every participant has a host. Three cases, resolved in order:
  //
  //   1. Real domain origin (jwize.com, alice.dev) — auto-bootstrap to the
  //      page's origin. Casual visitors and operators-in-production both
  //      get the right value with zero config.
  //
  //   2. Loopback origin + a `window.HYPERCOMB_DEV_HOST` global set by the
  //      shell's env.js — auto-bootstrap to that. This is how an operator
  //      tells their dev shell "I am jwize.com, even though the browser
  //      loaded me from localhost:4250." env.js is gitignored so the value
  //      is per-developer, not committed.
  //
  //   3. Loopback origin and no dev-host global — default to DEV_DEFAULT_HOST
  //      (jwize.com) so the operator's dev tabs auto-resolve against the host
  //      with zero config. The mesh-modal still lets them change it.
  try {
    const rawOrigin = String(window.location.origin ?? '')
    const isLoopback = /^https?:\/\/(localhost|127(?:\.\d+){3}|\[?::1\]?)(:|\/|$)/i.test(rawOrigin)
    const normalize = (raw: string): string => raw
      .replace(/^wss?:\/\//i, '')
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '')
      .toLowerCase()

    // ── host (self-domain) ──
    if (!localStorage.getItem('hc:nostrmesh:self-domain')) {
      let candidate = ''
      if (!isLoopback) {
        // Case 1 — real domain. Use the page's origin.
        candidate = normalize(rawOrigin)
      } else {
        // Case 2 — env.js per-developer override (gitignored); Case 3 — the
        // dev-build default host.
        const devHost = normalize(String((window as { HYPERCOMB_DEV_HOST?: string }).HYPERCOMB_DEV_HOST ?? ''))
        candidate = devHost || DEV_DEFAULT_HOST
      }
      if (candidate) localStorage.setItem('hc:nostrmesh:self-domain', candidate)
    }

    // ── beta ramp: live relay + byte mirrors (real origins only) ──
    // On a DEPLOYED origin, seed hc:nostrmesh:use-live-relay='1' ONCE so the
    // whole beta routing is explicit and stable rather than merely implied by
    // the unset origin-default: this single flag steers BOTH the mesh
    // (→ wss://jwize.com, nostr-mesh.drone loadRelays) AND ContentBroker's byte
    // fallback (→ jwize.com + pluginthematrix.io, #liveRelayActive). The
    // one-time marker (hc:beta-relay-seeded) means a later `/use-live-relay
    // clear` is respected — we never re-seed over an explicit clear. Loopback
    // dev is never seeded (it resolves from the local relay; force with
    // `/use-live-relay on` to test the live path). Opt out on a real origin
    // anytime with `/use-live-relay off`. Revisit when third-party operators
    // federate (no MANDATORY central chokepoint).
    if (!isLoopback
        && localStorage.getItem('hc:nostrmesh:use-live-relay') === null
        && localStorage.getItem('hc:beta-relay-seeded') === null) {
      localStorage.setItem('hc:nostrmesh:use-live-relay', '1')
      localStorage.setItem('hc:beta-relay-seeded', '1')
    }

    // ── location secret (dev-build default) ──
    // On loopback, seed the room secret so two localhost tabs land in the same
    // swarm room without typing it. Respects an explicit clear; never touches
    // a real origin.
    if (isLoopback) {
      const cleared = (() => { try { return localStorage.getItem('hc:secret-cleared') === '1' } catch { return false } })()
      const secretStore = get('@hypercomb.social/SecretStore') as { value: string; set: (s: string) => void } | undefined
      if (secretStore && !secretStore.value && !cleared) secretStore.set(DEV_DEFAULT_SECRET)
    }
  } catch { /* private mode — readers handle the empty case */ }

  if (logOpfs) {
    const logger = get('@hypercomb.social/OpfsTreeLogger') as OpfsTreeLogger | undefined
    await logger?.log?.()
  }

  const store = get('@hypercomb.social/Store') as Store | undefined
  await store?.initialize?.()
  ;(window as any).__hcBoot?.('store.initialize done')

  // Legacy layer-tree materialization removed. Layers are the only source
  // of truth for hierarchy; no on-disk mirror.

  // Load host translations for the i18n service
  const i18n = get('@hypercomb.social/I18n') as LocalizationService | undefined
  if (i18n) {
    try {
      const [en, ja, zh, es, ar, pt, fr, de, ko, ru, hi, id, tr, it] = await Promise.all([
        import('../i18n/en.json', { with: { type: 'json' } }),
        import('../i18n/ja.json', { with: { type: 'json' } }),
        import('../i18n/zh.json', { with: { type: 'json' } }),
        import('../i18n/es.json', { with: { type: 'json' } }),
        import('../i18n/ar.json', { with: { type: 'json' } }),
        import('../i18n/pt.json', { with: { type: 'json' } }),
        import('../i18n/fr.json', { with: { type: 'json' } }),
        import('../i18n/de.json', { with: { type: 'json' } }),
        import('../i18n/ko.json', { with: { type: 'json' } }),
        import('../i18n/ru.json', { with: { type: 'json' } }),
        import('../i18n/hi.json', { with: { type: 'json' } }),
        import('../i18n/id.json', { with: { type: 'json' } }),
        import('../i18n/tr.json', { with: { type: 'json' } }),
        import('../i18n/it.json', { with: { type: 'json' } }),
      ])
      i18n.registerTranslations('app', 'en', en.default)
      i18n.registerTranslations('app', 'ja', ja.default)
      i18n.registerTranslations('app', 'zh', zh.default)
      i18n.registerTranslations('app', 'es', es.default)
      i18n.registerTranslations('app', 'ar', ar.default)
      i18n.registerTranslations('app', 'pt', pt.default)
      i18n.registerTranslations('app', 'fr', fr.default)
      i18n.registerTranslations('app', 'de', de.default)
      i18n.registerTranslations('app', 'ko', ko.default)
      i18n.registerTranslations('app', 'ru', ru.default)
      i18n.registerTranslations('app', 'hi', hi.default)
      i18n.registerTranslations('app', 'id', id.default)
      i18n.registerTranslations('app', 'tr', tr.default)
      i18n.registerTranslations('app', 'it', it.default)
    } catch { /* translations unavailable — graceful degradation */ }
    ;(window as any).__hcBoot?.('i18n catalogs loaded')

    // User override layer — a CONTENT-ADDRESSED document in the
    // sign('overrides') document pool, shape { "<locale>": { "<key>":
    // "<value>" } }. Loaded after defaults so savvy users/consumers can
    // shadow any key without editing the shipped catalogs. Read the pool
    // first, then the legacy non-signed `overrides/i18n.json` (Store's boot
    // absorb content-addresses it into the pool and removes it).
    try {
      let json: Record<string, Record<string, string>> | null = null
      const poolBuf = store?.overrides ? await store.getPoolDoc(store.overrides) : null
      if (poolBuf) {
        try { json = JSON.parse(new TextDecoder().decode(poolBuf)) } catch { json = null }
      }
      if (!json) {
        const root = await navigator.storage.getDirectory()
        const dir = await root.getDirectoryHandle(Store.LEGACY_OVERRIDES_DIRECTORY, { create: false }).catch(() => null)
        const fileHandle = await dir?.getFileHandle('i18n.json', { create: false }).catch(() => null)
        if (fileHandle) {
          try { json = JSON.parse(await (await fileHandle.getFile()).text()) } catch { json = null }
        }
      }
      if (json) {
        for (const [locale, catalog] of Object.entries(json)) {
          if (catalog && typeof catalog === 'object') {
            i18n.registerOverrides('app', locale, catalog)
          }
        }
      }
    } catch { /* no overrides or malformed — ignore silently */ }
  }

  const lineage = get('@hypercomb.social/Lineage') as Lineage | undefined
  await lineage?.initialize?.()
  ;(window as any).__hcBoot?.('lineage.initialize done')

  // Boot-time data preload. Two-path access discipline says renders
  // should hit the cache exclusively; bag scans are the cold-miss
  // fallback only. To make that real, warm the cache here BEFORE the
  // first drone heartbeat — by the time show-cell asks for layers,
  // they're already in `#preloaderCache` / `#parsedLayerCache`.
  //
  // Step 1: `preloadAllBags` indexes every bag's head marker (cheap
  //          enumerate + one read per bag). After this, every lineage's
  //          head sig is in cache.
  // Step 2: `preloadFromRoot(rootSig)` walks layer.children from the
  //          root, fetching every reachable descendant via the
  //          cache-first `getLayerBySig` primitive. Cold descendants
  //          land in cache as the walk finds them.
  //
  // Logs in both methods show counts + timing so a stuck preload is
  // visible. Failures are non-fatal: cold render is correct, just slower.
  const historyService = get('@diamondcoreprocessor.com/HistoryService') as {
    preloadAllBags?: () => Promise<void>
    preloadFromRoot?: (rootSig: string) => Promise<void>
    preloadNeighbourhood?: (locationSig: string, maxDepth?: number) => Promise<void>
    sign?: (l: { explorerSegments: () => readonly string[] }) => Promise<string>
    latestMarkerSigFor?: (lineageSig: string, name: string) => Promise<string>
  } | undefined
  console.log('[preload] runtime-initializer reached preload step. history methods:', {
    historyExists: !!historyService,
    preloadAllBags: typeof historyService?.preloadAllBags,
    preloadFromRoot: typeof historyService?.preloadFromRoot,
    sign: typeof historyService?.sign,
    latestMarkerSigFor: typeof historyService?.latestMarkerSigFor,
  })
  // NO global preload. The old idle-deferred `preloadAllBags()` enumerated
  // every bag + every marker (O(hive): ~30s on a 1200-bag hive) and its OPFS
  // churn starved the first render's own reads. Heads are now resolved ON
  // DEMAND, one bag at a time (`currentLayerAt` → `#warmLineageHead`: one dir
  // listing + one marker read), and the head index grows incrementally as
  // lineages are touched. A bounded, passive warmer can drip the current
  // neighbourhood's heads behind the shell; the full marker history is read
  // only when working with history. There is no brute-force pass on boot.
  void historyService
  ;(window as any).__hcBoot?.('history preload skipped (on-demand head resolution)')

  const navigation = get('@hypercomb.social/Navigation') as Navigation | undefined
  navigation?.listen?.()

  // Walk the cell tree from root to current URL, loading markers at each depth.
  // encounter() calls find() → reads markers → loads bees → pulses them.
  const history = get('@hypercomb.social/BootstrapHistory') as BootstrapHistory | undefined
  await history?.run?.()
  ;(window as any).__hcBoot?.('BootstrapHistory.run done (Phase-1 URL restore; bees load in Phase-2 background)')

  // ── Bounded neighbourhood pre-warm ──────────────────────────────────
  // 79c36e63 removed the whole-hive substrate walk that (as a SIDE EFFECT)
  // warmed the click targets, so the first interaction at any location was cold
  // and show-cell's completeness gate held the canvas blank until the neighbour
  // layers landed (project_boot_first_click_warming; also the "post-adopt
  // nothing shows" symptom). This is the bounded, passive warmer the disabled
  // global preload above alludes to: on boot and on every navigation, breadth-
  // warm the CURRENT location's bounded subtree (depth ≤ 3) via the already-
  // bounded, cooperatively-sliced preloadFromRoot — NOT the O(hive) walk that
  // starved paint. Debounced so a nav/fs burst coalesces; idle-deferred so it
  // never steals the paint it's warming for; HistoryService dedups on head sig.
  // Non-fatal throughout.
  if (lineage && typeof historyService?.preloadNeighbourhood === 'function') {
    const idle = (cb: () => void): void => {
      const ric = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback
      if (typeof ric === 'function') ric(cb, { timeout: 1200 })
      else setTimeout(cb, 200)
    }
    // Proximity is warmed as ONE pattern with the current location: after the
    // current subtree, warm every one-click destination a visible surface has
    // DECLARED (collections cards, website cards, launch-group members — see
    // proximity-registry). The current location re-warms every nav (its head may
    // have moved); each declared destination warms ONCE per session (its lineage
    // sig is stable — content changes surface as a fresh sig, or as the current-
    // location warm when the user actually arrives). Capped per pass so a huge
    // declared set drains over several navs instead of flooding one idle slice.
    const warmedProximity = new Set<string>()
    const PROXIMITY_WARM_CAP = 16
    const warmCurrent = (): void => {
      void (async () => {
        try {
          const sig = await lineage.currentSig()
          if (sig) await historyService.preloadNeighbourhood!(sig)
        } catch { /* non-fatal: a cold render is correct, just slower */ }
        try {
          const proximate = await collectProximity()
          let warmed = 0
          for (const psig of proximate) {
            if (warmedProximity.has(psig)) continue
            if (warmed >= PROXIMITY_WARM_CAP) {
              console.log(
                `[preload] proximity warm capped at ${PROXIMITY_WARM_CAP} this pass; ` +
                `${proximate.length} declared, remainder drains on the next navigations`,
              )
              break
            }
            warmedProximity.add(psig)
            warmed++
            await historyService.preloadNeighbourhood!(psig)
          }
        } catch { /* non-fatal: a cold render is correct, just slower */ }
      })()
    }
    let warmTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleWarm = (): void => {
      if (warmTimer) clearTimeout(warmTimer)
      warmTimer = setTimeout(() => { warmTimer = null; idle(warmCurrent) }, 180)
    }
    lineage.addEventListener('change', scheduleWarm)
    idle(warmCurrent)  // boot: warm the restored location once first paint is past
  }

  // console.log('[runtime-initializer] ioc keys:', list())

  // pivot: restore persisted state + handle toggle command
  let pivotOn = localStorage.getItem('hc:hex-pivot') === 'true'
  if (pivotOn) {
    EffectBus.emit('render:set-pivot', { pivot: true })
  }
  EffectBus.on<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
    if (cmd !== 'render.togglePivot') return
    pivotOn = !pivotOn
    localStorage.setItem('hc:hex-pivot', String(pivotOn))
    EffectBus.emit('render:set-pivot', { pivot: pivotOn })
  })

  // mesh: toggle public/private on keymap command
  EffectBus.on<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
    if (cmd !== 'mesh.togglePublic') return
    const current = localStorage.getItem('hc:mesh-public') === 'true'
    const next = !current
    localStorage.setItem('hc:mesh-public', String(next))
    const mesh = get('@diamondcoreprocessor.com/NostrMeshDrone') as any
    mesh?.setNetworkEnabled?.(next, true)
    EffectBus.emit('mesh:public-changed', { public: next })
  })

  // Probe mesh state for UI toggle
  const mesh = get('@diamondcoreprocessor.com/NostrMeshDrone') as any
  if (mesh) {
    try {
      onMeshStateChange?.(!!mesh.isNetworkEnabled?.())
    } catch {
      // ignore mesh state probe failures
    }
  }
}