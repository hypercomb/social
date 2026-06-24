// hypercomb-web/src/setup/ensure-install.ts
// Runs BEFORE the import map is set, so that OPFS dependencies are written
// before the browser freezes the import-map entries.
//
// Two-source install: the sentinel is the preferred source (DCP audits
// content, can push deltas). The bundled `/content/` shipped with the
// web shell is the fallback — used when DCP is unreachable, and as a
// reference for stale-cache detection so a new deploy is picked up
// even when the sentinel hasn't pushed yet.

import { EffectBus, SignatureStore } from '@hypercomb/core'
import { Store } from '@hypercomb/shared/core'
import type { SentinelBridge } from './sentinel-bridge'

export type BootStatus =
  | { kind: 'cached' }
  | { kind: 'installing' }
  | { kind: 'installed' }
  | { kind: 'install-needed'; reason: 'no-sentinel' | 'sentinel-empty' | 'no-storage' }

const MANIFEST_KEY = 'core-adapter.installed-manifest'
const SIG_STORE_KEY = 'hypercomb.signature-store'
const SYNC_SIG_KEY = 'sentinel.sync-signature'
const INSTALLED_FLAG_KEY = 'hypercomb.installed'

// ensure side-effect registrations
const _deps = [Store]

type InstallManifest = {
  version: number
  layers: string[]
  bees: string[]
  dependencies: string[]
  beeDeps?: Record<string, string[]>
  dependenciesBag?: string
  beesBag?: string
  // Sidecar branch metadata (does not affect packageSig). Ignored at install.
  label?: string
  at?: string
  previous?: string | null
  // Provenance of THIS install — which source produced it. 'bundled' = the
  // shell's `/content/` package (so the bundle IS the update authority);
  // 'sentinel' = a DCP logical union (DCP is the authority, the bundle is not).
  // checkForUpdate gates on this so a DCP-sourced install never raises a phantom
  // "New features" by diffing against the shell's (possibly older/divergent)
  // bundle. Absent on pre-provenance manifests → inferred from the bee sets.
  source?: 'bundled' | 'sentinel'
}

export const ensureInstall = async (sentinel: SentinelBridge | null): Promise<void> => {
  // register the central signature allowlist — scripts in the store skip re-verification
  const sigStore = new SignatureStore()
  register('@hypercomb/SignatureStore', sigStore)

  const store = get('@hypercomb.social/Store') as Store | undefined
  if (!store) {
    console.warn('[ensure-install] Store not registered')
    return
  }

  await store.initialize()

  if (!store.opfsAvailable) {
    // 'no-storage', not 'no-sentinel' — the welcome card renders an
    // explanation (private window / old Safari) instead of a Start button
    // that can only loop: every install source needs OPFS to land bytes.
    console.warn('[ensure-install] OPFS unavailable — skipping install; app will boot without persistence')
    EffectBus.emit('boot:status', { kind: 'install-needed', reason: 'no-storage' } as BootStatus)
    return
  }

  // Push-only contract. Boot reads OPFS only — no `/content/manifest.json`
  // fetch, no staleness comparison against bundled, no silent fallback
  // install. The boot path's job is:
  //
  //   1) If a usable cached install is on disk → boot from cache.
  //   2) Otherwise → emit `install-needed` and let the user explicitly
  //      open DCP (push-driven install) or click "Upgrade Hypercomb"
  //      (user-initiated bundled refresh — see {@link upgradeFromBundled}).
  //
  // The previous behaviour fetched `/content/manifest.json` on every
  // single boot just to do a staleness diff against the cached sigs.
  // That meant every reload paid a network round-trip and could
  // silently reinstall from the shell's bundled content even when DCP
  // was the user's intended source of truth. Push-only means: DCP
  // initiates upgrades, the user initiates upgrades. Boot never does.
  const cachedManifest = tryParseManifest(localStorage.getItem(MANIFEST_KEY) ?? '')
  const usableCache = cachedManifest && cachedManifest.bees.length > 0
  if (usableCache) {
    // Verify EVERY bee + EVERY dep + EVERY layer file is in OPFS. Partial
    // installs (e.g. Edge cold-load with SW race, network glitch mid-fetch)
    // used to leave some files on disk and others missing, then the next
    // reload trusted the cached manifest and the dependency-loader threw
    // "Failed to fetch dynamically imported module" for the missing ones.
    // One missing file → wipe + reinstall.
    // ONE directory listing per dir instead of ~97 serial getFileHandle
    // probes (59 bees + 28 deps + 10 beeDep values, each a sequential
    // awaited OPFS roundtrip blocking the import map, dep loading, and
    // first paint). Enumerate names once, check membership in memory.
    const [beeNames, depNames] = await Promise.all([
      listFileNames(store.bees),
      listFileNames(store.dependencies),
    ])
    const beeOk = (cachedManifest.bees ?? []).every(sig => beeNames.has(`${sig}.js`))
    const beeDepSigs = new Set(Object.values(cachedManifest.beeDeps ?? {}).flatMap(list => list ?? []))
    const beeDepsOk = [...beeDepSigs].every(sig => depNames.has(`${sig}.js`))
    const allDepsOk = (cachedManifest.dependencies ?? []).every(sig => depNames.has(`${sig}.js`))
    if (beeOk && beeDepsOk && allDepsOk) {
      if (sentinel) {
        try {
          await resyncFromSentinel(sentinel)
        } catch (err) {
          console.warn('[ensure-install] boot resync failed; continuing with cached state', err)
        }
      }
      console.log('[ensure-install] booting from cached state')
      restoreSignatureStore(sigStore)
      restoreCachedBeeDeps()
      // Existing installs predate the flag — adopt them on first cached
      // boot so they don't get punted to the install prompt if the
      // cache is ever invalidated.
      if (localStorage.getItem(INSTALLED_FLAG_KEY) !== 'true') {
        localStorage.setItem(INSTALLED_FLAG_KEY, 'true')
      }
      EffectBus.emit('boot:status', { kind: 'cached' } as BootStatus)
      return
    }
    console.warn('[ensure-install] cached state spot-check failed — wiping and awaiting fresh install')
    localStorage.removeItem(MANIFEST_KEY)
    localStorage.removeItem(SYNC_SIG_KEY)
    await purgeStaleOpfsArtifacts(store)
  }

  // Cold boot / cache miss. Only DCP push is allowed to install; no
  // bundled silent fallback. If a sentinel is already wired (rare —
  // main.ts passes null here per push-only contract), let it try.
  // Otherwise surface install-needed so the install-prompt UI can
  // route the user to DCP or to the explicit Upgrade button.
  if (sentinel) {
    console.log('[ensure-install] cold/refresh boot — awaiting sentinel sync')
    EffectBus.emit('boot:status', { kind: 'installing' } as BootStatus)
    await resyncFromSentinel(sentinel)
    const postSyncManifest = tryParseManifest(localStorage.getItem(MANIFEST_KEY) ?? '')
    if (!postSyncManifest || postSyncManifest.bees.length === 0) {
      EffectBus.emit('boot:status', { kind: 'install-needed', reason: 'sentinel-empty' } as BootStatus)
      return
    }
    EffectBus.emit('boot:status', { kind: 'installed' } as BootStatus)
    return
  }

  console.log('[ensure-install] no cached install + no sentinel — surfacing install-needed')
  EffectBus.emit('boot:status', { kind: 'install-needed', reason: 'no-sentinel' } as BootStatus)
}

// ─────────────────────────────────────────────────────────────────────
// Update check (post-boot, off the critical path). The push-only boot
// contract forbids a staleness fetch DURING boot, but once the app is
// up we may compare the cached install against the shell's bundled
// `/content/` package to surface an "update available" affordance. This
// never installs anything — it only emits `update:available` so the UI
// can show an upgrade icon that routes the user to the installer.
// ─────────────────────────────────────────────────────────────────────

export const checkForUpdate = async (): Promise<void> => {
  const cached = tryParseManifest(localStorage.getItem(MANIFEST_KEY) ?? '')
  // Not installed yet (cold/welcome state) — the install prompt handles that,
  // there's no "update" to offer over an absent install.
  if (!cached || cached.bees.length === 0) return
  const bundled = await fetchBundledPackage()
  // No bundled manifest (dev shell has no /content/, or offline) — stay quiet.
  if (!bundled) return

  // ── Update-authority gate ────────────────────────────────────────────
  // The shell's bundled `/content/` is the update reference ONLY for installs
  // that came FROM the bundle. A DCP/sentinel-sourced install is a logical
  // UNION of enabled branches whose source of truth is DCP — DCP surfaces its
  // own updates. Diffing such an install against the single bundled package
  // raised phantom "New features" the moment the two drifted (a newer DCP
  // build, or the union enabling content the shell never bundled), and routing
  // the participant to DCP for those phantom sigs is a dead end: DCP can't show
  // bees it doesn't serve, and the resulting installer view has nothing to
  // commit. Provenance is now stamped on every manifest write; for legacy
  // manifests (no `source`) we INFER it — an install holding bees the bundle
  // lacks has diverged from the bundle lineage, so the bundle is not its
  // authority. When the bundle is not the authority, emit a definitive
  // available:false so any stale indicator clears. (A legacy BUNDLE install
  // whose update merely DROPPED bees is misclassified sentinel once; it self-
  // heals on the next upgradeFromBundled, which stamps source:'bundled'.)
  const bundledBeeSet = new Set(bundled.bees)
  const divergedFromBundle = cached.bees.some(sig => !bundledBeeSet.has(sig))
  const bundleIsAuthority = cached.source === 'bundled'
    || (cached.source !== 'sentinel' && !divergedFromBundle)
  if (!bundleIsAuthority) {
    EffectBus.emit('update:available', {
      available: false,
      newCount: 0,
      newBees: [],
      packageSig: bundled.packageSig,
      previous: bundled.previous ?? null,
      label: bundled.label,
    })
    return
  }

  const available = bundledDiffersFromCached(bundled, cached)
  const cachedSet = new Set(cached.bees)
  // The DELTA — bees present in the new bundle but not in the cached install.
  // The header indicator is a notify-and-route affordance only: it hands this
  // changed-sig list (not just a count) to the DCP installer, which is where
  // the participant reviews the changed items and opts in. Nothing installs or
  // runs in the hive from here — only an enable in DCP syncs a delta bee back.
  const newBees = bundled.bees.filter(sig => !cachedSet.has(sig))
  EffectBus.emit('update:available', {
    available,
    newCount: newBees.length,
    newBees,
    packageSig: bundled.packageSig,
    previous: bundled.previous ?? null,
    label: bundled.label,
  })
}

// ─────────────────────────────────────────────────────────────────────
// User-initiated bundled upgrade. Fired explicitly by the "Upgrade
// Hypercomb" button in the install prompt UI. Walks the same path
// the old auto-fallback used (fetch /content/manifest.json → install
// every sig listed → reload), but only on click — not at boot.
// ─────────────────────────────────────────────────────────────────────

/**
 * Force an install from the shell's bundled `/content/` package. Called
 * by the "Upgrade Hypercomb" UI button. Unlike {@link ensureInstall},
 * which is automatic and push-only, this path is ALWAYS user-initiated.
 * On success the caller is expected to `location.reload()` so the
 * freshly-installed bees take over.
 *
 * Returns `true` when at least one bee landed in OPFS, `false`
 * otherwise (network down, no bundled package, partial fetch).
 */
export const upgradeFromBundled = async (): Promise<boolean> => {
  const store = get('@hypercomb.social/Store') as Store | undefined
  if (!store || !store.opfsAvailable) {
    console.warn('[upgrade-from-bundled] Store unavailable')
    return false
  }
  const sigStore = get('@hypercomb/SignatureStore') as SignatureStore | undefined
  if (!sigStore) {
    console.warn('[upgrade-from-bundled] SignatureStore not registered')
    return false
  }
  EffectBus.emit('install:sync', { active: true, source: 'bundled' })
  try {
    const bundled = await fetchBundledPackage()
    if (!bundled) {
      console.warn('[upgrade-from-bundled] no bundled /content/manifest.json available')
      return false
    }
    // Wipe stale artifacts before reinstall so signatures dropped from
    // the new bundle don't linger and load on next boot.
    const cached = tryParseManifest(localStorage.getItem(MANIFEST_KEY) ?? '')
    if (cached) {
      localStorage.removeItem(MANIFEST_KEY)
      localStorage.removeItem(SYNC_SIG_KEY)
      await purgeStaleOpfsArtifacts(store)
    }
    await installFromBundled(bundled, sigStore)
    return true
  } finally {
    EffectBus.emit('install:sync', { active: false, source: 'bundled' })
  }
}

// -------------------------------------------------
// bundled-content fallback — used when sentinel is unreachable, and
// also to detect stale OPFS cache when a new shell deploy lands but
// DCP hasn't pushed yet.
// -------------------------------------------------

type BundledPackage = {
  packageSig: string
  bees: string[]
  dependencies: string[]
  layers: string[]
  beeDeps?: Record<string, string[]>
  // Sigbag (Phase 1 additive): when present, the bundle ships
  // `__dependencies__/<dependenciesBag>/0000…` and `__bees__/<beesBag>/0000…`
  // alongside the flat leaves. Absent for older bundles.
  dependenciesBag?: string
  beesBag?: string
  // Sidecar branch metadata (does not affect packageSig). Ignored at install.
  label?: string
  at?: string
  previous?: string | null
}

const fetchBundledPackage = async (): Promise<BundledPackage | null> => {
  try {
    const res = await fetch('/content/manifest.json', { cache: 'no-store' })
    if (!res.ok) return null
    const content = await res.json() as { packages?: Record<string, { bees?: string[]; dependencies?: string[]; layers?: string[]; beeDeps?: Record<string, string[]>; dependenciesBag?: string; beesBag?: string; label?: string; at?: string; previous?: string | null }> }
    const sig = Object.keys(content.packages ?? {})[0]
    if (!sig) return null
    const pkg = content.packages![sig]
    return {
      packageSig: sig,
      bees: pkg.bees ?? [],
      dependencies: pkg.dependencies ?? [],
      layers: pkg.layers ?? [],
      beeDeps: pkg.beeDeps,
      dependenciesBag: pkg.dependenciesBag,
      beesBag: pkg.beesBag,
      // Sidecar branch metadata — carried through so the post-boot update
      // check can hand the installer the version's walkback link + label.
      label: pkg.label,
      at: pkg.at,
      previous: pkg.previous ?? null,
    }
  } catch {
    return null
  }
}

const bundledDiffersFromCached = (bundled: BundledPackage, cached: InstallManifest): boolean => {
  if (bundled.bees.length !== cached.bees.length) return true
  const cachedSet = new Set(cached.bees)
  for (const sig of bundled.bees) {
    if (!cachedSet.has(sig)) return true
  }
  return false
}

const installFromBundled = async (bundled: BundledPackage, sigStore: SignatureStore): Promise<void> => {
  const store = get('@hypercomb.social/Store') as Store | undefined
  if (!store) return

  // All layers — boot bundle, sentinel sync, user commits — share one
  // flat pool at `__layers__/<sig>`. No subdirectories. Sig-keyed
  // content-addressed storage means there's no "install-scope" to
  // partition by; everything that lives at sig X is, by definition,
  // the bytes that hash to X.
  const layerDir = store.layers

  const fetchBytes = async (path: string): Promise<ArrayBuffer | null> => {
    try {
      const res = await fetch(path, { cache: 'no-store' })
      if (!res.ok) return null
      return await res.arrayBuffer()
    } catch {
      return null
    }
  }

  const writeAll = async (
    sigs: string[],
    urlFor: (sig: string) => string,
    dir: FileSystemDirectoryHandle,
    nameFor: (sig: string) => string,
  ): Promise<number> => {
    let written = 0
    await Promise.all(sigs.map(async (sig) => {
      const bytes = await fetchBytes(urlFor(sig))
      if (!bytes) return
      const handle = await dir.getFileHandle(nameFor(sig), { create: true })
      const writable = await handle.createWritable()
      await writable.write(bytes)
      await writable.close()
      written++
    }))
    return written
  }

  const beeCount = await writeAll(bundled.bees, (s) => `/content/__bees__/${s}.js`, store.bees, (s) => `${s}.js`)
  const depCount = await writeAll(bundled.dependencies, (s) => `/content/__dependencies__/${s}.js`, store.dependencies, (s) => `${s}.js`)
  const layerCount = await writeAll(bundled.layers, (s) => `/content/__layers__/${s}.json`, layerDir, (s) => s)

  // Sigbag fetch (Phase 2 additive): when the bundle declares a bag sig,
  // fetch each indexed entry and write under <bagSig>/<index>. Entry count
  // matches the flat array length by construction (the build emits both).
  const writeBag = async (
    parentDir: FileSystemDirectoryHandle,
    bagSig: string,
    entryCount: number,
    contentPath: string,
  ): Promise<number> => {
    const bagDir = await parentDir.getDirectoryHandle(bagSig, { create: true })
    let written = 0
    await Promise.all(Array.from({ length: entryCount }, (_, i) => i).map(async (i) => {
      const indexName = String(i).padStart(4, '0')
      const bytes = await fetchBytes(`${contentPath}/${bagSig}/${indexName}`)
      if (!bytes) return
      const handle = await bagDir.getFileHandle(indexName, { create: true })
      const writable = await handle.createWritable()
      await writable.write(bytes)
      await writable.close()
      written++
    }))
    return written
  }

  // Single-bag invariant: before writing the new bag dir, evict any prior
  // bag dirs so `__dependencies__/` and `__bees__/` each contain exactly
  // one bag dir after install. The receiver's importmap build relies on
  // a `readdir` finding only the active bag — no pointer file needed.
  const evictOldBagDirs = async (parentDir: FileSystemDirectoryHandle, keepSig: string): Promise<void> => {
    const stale: string[] = []
    for await (const [name, handle] of parentDir.entries()) {
      if (handle.kind !== 'directory') continue
      if (!/^[a-f0-9]{64}$/i.test(name)) continue
      if (name === keepSig) continue
      stale.push(name)
    }
    for (const name of stale) {
      try { await parentDir.removeEntry(name, { recursive: true }) } catch { /* skip */ }
    }
  }
  if (bundled.dependenciesBag) await evictOldBagDirs(store.dependencies, bundled.dependenciesBag)
  if (bundled.beesBag) await evictOldBagDirs(store.bees, bundled.beesBag)

  let depBagCount = 0
  let beeBagCount = 0
  if (bundled.dependenciesBag) {
    depBagCount = await writeBag(store.dependencies, bundled.dependenciesBag, bundled.dependencies.length, '/content/__dependencies__')
  }
  if (bundled.beesBag) {
    beeBagCount = await writeBag(store.bees, bundled.beesBag, bundled.bees.length, '/content/__bees__')
  }

  // Loud failure mode. If any file failed to land, surface it now —
  // otherwise the next boot's spot-check will silently wipe and retry,
  // and the user just sees a flash of the install prompt.
  if (beeCount !== bundled.bees.length || depCount !== bundled.dependencies.length || layerCount !== bundled.layers.length) {
    console.warn(
      `[ensure-install] partial bundled install: bees ${beeCount}/${bundled.bees.length}, deps ${depCount}/${bundled.dependencies.length}, layers ${layerCount}/${bundled.layers.length} — next reload will retry`,
    )
  }

  // Mirror the manifest + sync state that resyncFromSentinel would write
  // so the next reload boots through the cached fast path. Bag sigs are
  // included so `resolveImportMap` can prefer the bag over flat scan.
  const manifest = {
    version: 2,
    layers: bundled.layers,
    bees: bundled.bees,
    dependencies: bundled.dependencies,
    beeDeps: bundled.beeDeps,
    dependenciesBag: bundled.dependenciesBag,
    beesBag: bundled.beesBag,
    // Came from the shell's bundled package → the bundle IS this install's
    // update authority (checkForUpdate compares against it).
    source: 'bundled' as const,
  }
  localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest))
  localStorage.setItem(SYNC_SIG_KEY, bundled.packageSig)
  localStorage.setItem(INSTALLED_FLAG_KEY, 'true')
  if (bundled.beeDeps) (globalThis as any).__hypercombBeeDeps = bundled.beeDeps
  sigStore.trustAll([...bundled.bees, ...bundled.dependencies, ...bundled.layers])
  localStorage.setItem(SIG_STORE_KEY, JSON.stringify(sigStore.toJSON()))
  console.log(`[ensure-install] bundled install complete: ${bundled.packageSig.slice(0, 12)} (${beeCount}/${bundled.bees.length} bees, ${depCount}/${bundled.dependencies.length} deps, ${layerCount}/${bundled.layers.length} layers, bags: deps=${depBagCount} bees=${beeBagCount})`)
}

/**
 * Wipe stale bees, deps, and layer files from OPFS so the next sync
 * starts from a clean slate. Without this, old artifacts linger in
 * OPFS forever — even after a successful resync — because resync only
 * writes the new files; it never removes signatures that fell out of
 * the manifest. The script-preloader can then still find and load a
 * stale dep with broken Angular code in it.
 */
const purgeStaleOpfsArtifacts = async (store: Store): Promise<void> => {
  const purgeDir = async (dir: FileSystemDirectoryHandle) => {
    const names: string[] = []
    try {
      for await (const [name] of dir.entries()) names.push(name)
    } catch { return }
    for (const name of names) {
      try { await dir.removeEntry(name, { recursive: true }) } catch { /* skip */ }
    }
  }
  await Promise.all([purgeDir(store.bees), purgeDir(store.dependencies)])
  try {
    for await (const [, handle] of store.layers.entries()) {
      if (handle.kind === 'directory') await purgeDir(handle as FileSystemDirectoryHandle)
    }
  } catch { /* skip */ }
  // Also drop the SW module cache so refetches aren't served from a stale entry.
  try {
    if ('caches' in self) await caches.delete('hypercomb-modules-v2')
  } catch { /* skip */ }
}

// -------------------------------------------------
// resync — the SOLE install/update path
// -------------------------------------------------

export const resyncFromSentinel = async (sentinel: SentinelBridge): Promise<void> => {
  const store = get('@hypercomb.social/Store') as Store | undefined
  if (!store || !store.opfsAvailable) return

  // Visual cue: bracket the whole pass so the sync-indicator shows while
  // the sentinel computes the diff, streams files, and we apply them to
  // OPFS. Every exit path (no result, no-op diff, throw) lands in the
  // finally so the cue can never get stuck on. Own lane ('resync') so an
  // overlapping first-run install keeps its counts and the cue stays up
  // until BOTH lanes are quiet.
  EffectBus.emit('install:sync', { active: true, source: 'resync' })
  try {
    await resyncPass(sentinel, store)
  } finally {
    EffectBus.emit('install:sync', { active: false, source: 'resync' })
  }
}

const resyncPass = async (sentinel: SentinelBridge, store: Store): Promise<void> => {
  const currentSyncSig = (localStorage.getItem(SYNC_SIG_KEY) ?? '').trim() || undefined

  // INCREMENTAL RECONCILE: tell the sentinel which sigs we already hold so it
  // streams ONLY the missing ones ("fill in if any files are missing"), instead
  // of re-streaming the whole enabled set on every toggle. The enabled* arrays
  // in the result are still the full set, so stale-GC (removeDisabled) and the
  // cached manifest stay correct — only the BYTES are deltaed.
  const have = await collectPresentSigs(store)
  const result = await sentinel.sync(currentSyncSig, have)
  if (!result) return

  const { syncSig, enabledBees, enabledDeps, enabledLayers, beeDeps, files } = result

  if (!files.length && currentSyncSig === syncSig) return

  const enabledBeeSet = new Set(enabledBees)
  const enabledDepSet = new Set(enabledDeps)
  const enabledLayerSet = new Set(enabledLayers)

  // Bag-aware GC (Phase 3): the sentinel result doesn't carry bag sigs yet,
  // so preserve whichever bag the previously-cached manifest declared.
  // When sentinel later pushes its own bag sigs, swap in those instead.
  const priorManifest = tryParseManifest(localStorage.getItem(MANIFEST_KEY) ?? '')

  await removeDisabled(store.bees, enabledBeeSet, '.js', priorManifest?.beesBag)
  await removeDisabled(store.dependencies, enabledDepSet, '.js', priorManifest?.dependenciesBag)

  // The dependency *bag* is the import-map's source of truth: resolveImportMap
  // reads the bag's leaf sigs to build the alias→`/opfs/__dependencies__/<sig>`
  // map. But resync only maintains the FLAT `<sig>.js` dep files — it writes
  // enabledDeps and removeDisabled() above just deleted the rest. It never
  // rebuilds the bag. So a bag carried over from the last bundled install
  // still points at leaf sigs that no longer exist on disk, and the next
  // boot's import map resolves aliases to files the SW 404s on — surfacing as
  // "Failed to fetch dynamically imported module" for every dep. Evict the bag
  // here so resolveImportMap drops to its flat-scan fallback, which derives the
  // map straight from the `// @scope/name` first line of each flat file this
  // pass wrote — always consistent with what's actually on disk.
  await evictBagDirs(store.dependencies)
  // Layers live flat in `__layers__/<sig>` shared with user commits.
  // We can't blindly remove sigs not in `enabledLayerSet` here — that
  // would also delete every user-committed layer. GC for the layer
  // pool requires a separate reachability sweep (mark-and-sweep over
  // history markers + install set). For now, layers grow monotonically;
  // a future `/sweep` command cleans unreachable sigs.
  const layerDir = store.layers
  await clearStaleCaches()

  let appliedCount = 0
  for (const file of files) {
    switch (file.kind) {
      case 'layer':
        await writeBytes(layerDir, file.signature, file.bytes)
        await seedCacheEntry(`/opfs/__layers__/${file.signature}.json`, file.bytes, 'application/json; charset=utf-8')
        break
      case 'bee':
        await writeBytes(store.bees, `${file.signature}.js`, file.bytes)
        await seedCacheEntry(`/opfs/__bees__/${file.signature}.js`, file.bytes, 'application/javascript; charset=utf-8')
        break
      case 'dependency':
        await writeBytes(store.dependencies, `${file.signature}.js`, file.bytes)
        await seedCacheEntry(`/opfs/__dependencies__/${file.signature}.js`, file.bytes, 'application/javascript; charset=utf-8')
        break
    }
    appliedCount++
    EffectBus.emit('install:sync', { active: true, source: 'resync', current: appliedCount, total: files.length })
  }

  // RECEIPT VERIFY — read-back confirm, not bare stream-ok. Synchronizing a
  // sigbag is a normal update(layer): we only advance to the new HEAD (syncSig)
  // once we can confirm the hive actually holds every file the current logical
  // names. A byte dropped mid-stream (or one DCP couldn't resolve) must NOT
  // advance syncSig — otherwise the next boot trusts a manifest whose bytes are
  // missing and falls back to the wipe path. Re-list OPFS post-apply (the
  // receipt) and compare against the enabled set; leave syncSig/manifest
  // untouched on a miss so the next resync re-requests the gap.
  const present = new Set(await collectPresentSigs(store))
  const missing = [...enabledBees, ...enabledDeps, ...enabledLayers]
    .filter(sig => !present.has(sig.toLowerCase()))
  if (missing.length) {
    console.warn(
      `[ensure-install] sync receipt FAILED for ${syncSig.slice(0, 12)} — `
      + `${missing.length} enabled file(s) missing after apply; NOT advancing syncSig `
      + `(next resync re-requests the gap):`,
      missing.slice(0, 8),
    )
    return
  }

  const sigStore = get('@hypercomb/SignatureStore') as SignatureStore | undefined
  if (sigStore) {
    const allSigs = [...enabledBees, ...enabledDeps, ...enabledLayers]
    sigStore.trustAll(allSigs)
    localStorage.setItem(SIG_STORE_KEY, JSON.stringify(sigStore.toJSON()))
  }

  // The dependency bag was just evicted (see evictBagDirs above), so the
  // manifest must NOT advertise one — otherwise the next boot's
  // resolveImportMap would scan for a bag, find none, and that's fine, but
  // recording a stale bag sig here invites future code to trust it. Null it
  // out; resolveImportMap rebuilds the map from flat files. The bee bag is
  // left intact: nothing on the receiver's read path consults it (bees load
  // by sig, not by alias), so its staleness is inert.
  const syncManifest = {
    version: 2,
    layers: enabledLayers,
    bees: enabledBees,
    dependencies: enabledDeps,
    beeDeps,
    dependenciesBag: undefined,
    beesBag: priorManifest?.beesBag,
    // DCP logical union → DCP is this install's update authority, NOT the shell
    // bundle. checkForUpdate uses this to suppress phantom bundle-drift updates.
    source: 'sentinel' as const,
  }
  localStorage.setItem(SYNC_SIG_KEY, syncSig)
  localStorage.setItem(MANIFEST_KEY, JSON.stringify(syncManifest))
  if (beeDeps) (globalThis as any).__hypercombBeeDeps = beeDeps

  // First successful resync that produced a non-empty install satisfies
  // the cold-boot consent gate. Adding a domain in DCP fires
  // toggle-changed, which lands content here and flips the flag so the
  // post-resync reload boots through the cached fast path.
  if (enabledBees.length > 0 && localStorage.getItem(INSTALLED_FLAG_KEY) !== 'true') {
    localStorage.setItem(INSTALLED_FLAG_KEY, 'true')
  }

  console.log(`[ensure-install] resync complete + receipt OK: ${syncSig.slice(0, 12)} (${enabledBees.length} bees, ${enabledDeps.length} deps, ${enabledLayers.length} layers synchronized)`)
}

// ----- helpers -----

const clearStaleCaches = async (): Promise<void> => {
  // Clear Service Worker Cache API — old signature entries are stale after resync
  if ('caches' in self) {
    const deleted = await caches.delete('hypercomb-modules-v2')
    if (deleted) console.log('[ensure-install] cleared SW module cache')
  }
  // Prune signature store — old trusted sigs are irrelevant after resync
  localStorage.removeItem(SIG_STORE_KEY)
}

const tryParseManifest = (json: string): InstallManifest | null => {
  try {
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return null
    return {
      version: parsed.version ?? 0,
      layers: Array.isArray(parsed.layers) ? parsed.layers : [],
      bees: Array.isArray(parsed.bees) ? parsed.bees : [],
      dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies : [],
      beeDeps: parsed.beeDeps && typeof parsed.beeDeps === 'object' ? parsed.beeDeps : undefined,
      dependenciesBag: typeof parsed.dependenciesBag === 'string' ? parsed.dependenciesBag : undefined,
      beesBag: typeof parsed.beesBag === 'string' ? parsed.beesBag : undefined,
      source: parsed.source === 'bundled' || parsed.source === 'sentinel' ? parsed.source : undefined,
    }
  } catch {
    return null
  }
}

const writeBytes = async (dir: FileSystemDirectoryHandle, name: string, bytes: ArrayBuffer): Promise<void> => {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(bytes)
  await writable.close()
}

const seedCacheEntry = async (path: string, bytes: ArrayBuffer, contentType: string): Promise<void> => {
  try {
    const cache = await caches.open('hypercomb-modules-v2')
    const url = new URL(path, location.origin).toString()
    const existing = await cache.match(url)
    if (existing) return

    const headers = new Headers()
    headers.set('content-type', contentType)
    headers.set('cache-control', 'no-store')
    await cache.put(url, new Response(bytes, { headers }))
  } catch {
    // non-fatal
  }
}

/**
 * Remove files from a directory whose signature is NOT in the enabled set.
 * Handles files stored as `{sig}{ext}` or bare `{sig}`.
 *
 * Bag-aware (Phase 3): directories whose name is a 64-hex sig are treated as
 * sigbags. The currently active bag (passed as `enabledBagSig`) is preserved;
 * any other bag-shaped directory is recursively removed. When `enabledBagSig`
 * is undefined, ALL bag-shaped directories are left untouched — this keeps
 * older bundled-install bags alive across sentinel resyncs that don't yet
 * carry bag info in their payload.
 */
const removeDisabled = async (
  dir: FileSystemDirectoryHandle,
  enabledSigs: Set<string>,
  ext: string,
  enabledBagSig?: string,
): Promise<void> => {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'directory') {
      // Bag directory: only act when an explicit active-bag sig is known.
      // Without it, we have no authority to remove — leave bags alone.
      if (enabledBagSig === undefined) continue
      if (/^[a-f0-9]{64}$/i.test(name) && name !== enabledBagSig) {
        try { await dir.removeEntry(name, { recursive: true }) } catch { /* skip */ }
      }
      continue
    }
    const sig = ext ? name.replace(new RegExp(`\\${ext}$`, 'i'), '') : name
    if (/^[a-f0-9]{64}$/i.test(sig) && !enabledSigs.has(sig)) {
      try { await dir.removeEntry(name) } catch { /* skip */ }
    }
  }
}

/**
 * Remove EVERY sigbag directory from a pool. Unlike installFromBundled's
 * evictOldBagDirs (which keeps the active bag because the bundled install
 * writes a fresh, consistent one), resync writes no bag at all — it only
 * maintains the flat `<sig>.js` files. Any bag left behind is therefore
 * stale by definition, so resync drops all of them.
 */
const evictBagDirs = async (dir: FileSystemDirectoryHandle): Promise<void> => {
  const stale: string[] = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'directory') continue
    if (!/^[a-f0-9]{64}$/i.test(name)) continue
    stale.push(name)
  }
  for (const name of stale) {
    try { await dir.removeEntry(name, { recursive: true }) } catch { /* skip */ }
  }
}

// ----- signature store helpers -----

const restoreCachedBeeDeps = (): void => {
  const cached = localStorage.getItem(MANIFEST_KEY)
  if (cached) {
    const m = tryParseManifest(cached)
    if (m?.beeDeps) (globalThis as any).__hypercombBeeDeps = m.beeDeps
  }
}

const restoreSignatureStore = (sigStore: SignatureStore): void => {
  try {
    const raw = localStorage.getItem(SIG_STORE_KEY)
    if (!raw) return
    sigStore.restore(JSON.parse(raw))
    console.log(`[ensure-install] signature store restored: ${sigStore.size} trusted sigs`)
  } catch {
    // non-fatal
  }
}

/** Sigs already present in OPFS (flat bee/dep/layer files), so the sentinel can
 *  stream only the delta on resync. Bees/deps are `<sig>.js`; layers are bare
 *  `<sig>` in the shared flat pool (user-committed layers included — harmless:
 *  they're sigs the hive genuinely holds, and the sentinel only checks the
 *  enabled set against this). Bag subdirectories are skipped — resyncPass writes
 *  the flat files, so flat presence is what the delta is computed against. */
const collectPresentSigs = async (store: Store): Promise<string[]> => {
  const sigs = new Set<string>()
  const addFrom = async (dir: FileSystemDirectoryHandle, ext: string): Promise<void> => {
    try {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== 'file') continue
        const sig = ext ? name.replace(new RegExp(`\\${ext}$`, 'i'), '') : name
        if (/^[a-f0-9]{64}$/i.test(sig)) sigs.add(sig.toLowerCase())
      }
    } catch { /* dir unreadable — treat as empty (sentinel streams more, never fewer) */ }
  }
  await addFrom(store.bees, '.js')
  await addFrom(store.dependencies, '.js')
  await addFrom(store.layers, '')
  return [...sigs]
}

/** All file names in a directory as a Set — one enumeration replaces N
 *  serial getFileHandle existence probes on the boot spot-check. */
const listFileNames = async (dir: FileSystemDirectoryHandle): Promise<Set<string>> => {
  const names = new Set<string>()
  try {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file') names.add(name)
    }
  } catch { /* dir unreadable — empty set fails the spot-check, triggering reinstall */ }
  return names
}

