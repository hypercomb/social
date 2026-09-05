// hypercomb-web/src/setup/ensure-install.ts
// Runs BEFORE the import map is set, so that OPFS dependencies are written
// before the browser freezes the import-map entries.
//
// Content arrives ONLY by replication (documentation/install-by-replication.md):
// one root signature, resolved into the local heap, verified at admission.
// There is no installer and no second source. The bundled `/content/`
// package shipped with the shell is an ORIGIN the walker may pull atoms
// from — never a competing install machine.

import { EffectBus, MARKER_NAME, SignatureStore, hardDeleteVetoFor, planNamedRemovalFor } from '@hypercomb/core'
import { isComplete, resolveInventory, Store, validateSealedPackage, type ReplicationIo } from '@hypercomb/shared/core'
import { seedDarkOnFreshInstall } from '@hypercomb/shared/ui/features-viewer/behavior-enablement'
import { nativeAvailable } from '@hypercomb/runtime/native-filesystem'
import { isVisitorSession } from './visitor-session'
// Cold-boot acquisition. Same implementation the shim uses and the same one
// behind window.hypercomb.acquire — there is one acquisition, not three.
import { acquire, deriveInventory, headPackage, listHostPackages, reportDivergence } from '@hypercomb/runtime/acquire'
import { deriveBeeDeps } from '@hypercomb/runtime/bee-deps'
import { checkCoreCompatibility, CoreMismatchError, describeCoreMismatch } from '@hypercomb/runtime/core-surface'
import { aliasOf, bagEntryName, bagSignature, beeEntries, dependencyEntries, orderedEntries } from '@hypercomb/runtime/bags'
import { HOST_PACKAGES_MEANING, markerIndices, parseMember, parsePoolListing, poolEntryName } from '@hypercomb/runtime/host-pool'
import { registerPoolMeaning } from '@hypercomb/core'
import { stampInstalledPackage } from '@hypercomb/runtime/installed-package'
import { DEFAULT_HOST_ZONES, listHostZones } from '@hypercomb/runtime/host-zones'
import { cacheImportMap } from './resolve-import-map'

export type BootStatus =
  | { kind: 'cached' }
  | { kind: 'installing' }
  | { kind: 'installed' }
  | { kind: 'install-needed'; reason: 'no-source' | 'no-storage' | 'no-writable' }

/** Can this browser actually WRITE to OPFS? `getDirectory` alone is not the
 *  answer: iOS Safari 16.4–18.3 has it, but every write in the store goes
 *  through `FileSystemFileHandle.createWritable`, which Safari only added in
 *  18.4. On those iPhones the storage gate passes, the install starts, every
 *  write throws, and the welcome card loops Start → Starting… forever with no
 *  message — the worst first-run stall we know of. One prototype check turns
 *  that loop into an honest "update your browser" card. */
export const opfsWritable = (): boolean =>
  // THE NATIVE SHELL HAS NO OPFS TO BE TOO OLD FOR. Its hive is a real
  // directory reached over IPC, and its writes never touch
  // FileSystemFileHandle — so this global-prototype probe asks a question
  // about a storage backend it is not using. WebKitGTK answers it the way
  // iOS 16.4 does (the handle exists, createWritable does not), and the Linux
  // client refused to install its own bundled content: an empty shell, every
  // launch, with 'browser too old' in the log. macOS and Windows were never
  // asked, because their webviews happen to have createWritable.
  nativeAvailable() ||
  (typeof FileSystemFileHandle !== 'undefined' &&
   typeof FileSystemFileHandle.prototype.createWritable === 'function')

// AN INSTALL-OWNED EVICTOR MAY ONLY REMOVE A BAG IT WROTE.
//
// `hardDeleteVetoFor` returns null for an EMPTY directory — "there is
// nothing to lose" — which is true at a lineage address and false at a
// molecule address: there it is a NAMESPACE another tab or a replication may
// be mid-write into, and the window between `getDirectoryHandle(create:
// true)` and the first claim write is exactly when an install pass runs.
// Nothing this code wrote is ever empty, so an empty directory is positive
// evidence the install did NOT write it. Proof of a bag is at least one
// marker; absence of proof refuses.
const bagEvictionVeto = async (dir: FileSystemDirectoryHandle): Promise<string | null> => {
  const veto = await hardDeleteVetoFor(dir)
  if (veto) return veto
  try {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file' && MARKER_NAME.test(name)) return null
    }
  } catch (err) { return `could not be read (${String((err as Error)?.message ?? err)})` }
  return 'is empty — an install pass never leaves a bag empty'
}

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

export const ensureInstall = async (): Promise<void> => {
  // register the central signature allowlist — scripts in the store skip re-verification
  const sigStore = new SignatureStore()
  register('@hypercomb/SignatureStore', sigStore)

  const store = get('@hypercomb.social/Store') as Store | undefined
  if (!store) {
    console.warn('[ensure-install] Store not registered')
    return
  }

  await store.initialize()

  // The localStorage flag is only a summary of the install cache. A reset,
  // interrupted install, or origin/store change can leave it true after the
  // manifest has disappeared. Normalize that impossible state here, AFTER
  // Store.initialize() but BEFORE the browser gates below, so first-run UI and
  // reload decisions cannot trust a claim whose required manifest is absent.
  // The gates return early, and a claim that survives them keeps
  // `shouldBootstrap` (runtime-mediator) and main.ts's first-run path believing
  // this hive is installed while nothing is on disk. The claim describes
  // localStorage's own manifest, so it is answerable whether or not OPFS opened.
  const cachedManifest = tryParseManifest(localStorage.getItem(MANIFEST_KEY) ?? '')
  const usableCache = cachedManifest && cachedManifest.bees.length > 0
  if (!usableCache) localStorage.removeItem(INSTALLED_FLAG_KEY)

  // A NEW INSTALL STARTS DARK. This is the one moment the shell can tell a
  // fresh hive from an existing one — no install cache means nothing has ever
  // been installed here — so it is where the opt-in on-list is materialized
  // EMPTY: every behaviour arrives globally off, and the participant lights
  // what they want from the Beehaviors roster. Without this, essentials'
  // census seed (`seedGlobalOnKinds`, 8s after boot) would light every kind
  // the module graph brought, which is the OPPOSITE of opt-in for someone who
  // has chosen nothing yet. Writing the list here makes that seed a no-op
  // forever after. An existing hive already HAS the list, so this cannot
  // darken it — and a hive whose install cache was wiped is unaffected for
  // the same reason.
  //
  // EXCEPT FOR A VISITOR. A published site is not a fresh hive someone is
  // about to make their own — it is somebody else's finished creation, being
  // read. The visitor has no Beehaviors roster to opt in from, and the
  // memory filesystem means `usableCache` can NEVER be true there, so every
  // single visit re-took the dark path and every published site rendered as
  // shaded hexagons with default art, permanently: the `'*'` cohort stamp is
  // built to stop any later seed lighting anything, which is right for a
  // participant and a trap for a reader. The publisher already decided what
  // this creation looks like — `publish:lights` on the branch root carries
  // that decision, and the visit adopts it (sharing/publish-lights.ts).
  if (!usableCache && !isVisitorSession()) seedDarkOnFreshInstall()

  if (!store.opfsAvailable) {
    // 'no-storage', not 'no-sentinel' — the welcome card renders an
    // explanation (private window / old Safari) instead of a Start button
    // that can only loop: every install source needs OPFS to land bytes.
    console.warn('[ensure-install] OPFS unavailable — skipping install; app will boot without persistence')
    EffectBus.emit('boot:status', { kind: 'install-needed', reason: 'no-storage' } as BootStatus)
    return
  }

  if (!opfsWritable()) {
    // OPFS opens but cannot be written (iOS 16.4–18.3): explain, don't loop.
    console.warn('[ensure-install] OPFS present but createWritable missing — browser too old to install')
    EffectBus.emit('boot:status', { kind: 'install-needed', reason: 'no-writable' } as BootStatus)
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
    // UNION the sign(meaning) pool with its legacy `__x__` drain dir:
    // the Store's absorb runs detached, so on the first post-upgrade
    // boot a file can still be mid-drain in the legacy dir. An empty
    // pool with a live legacy dir is NOT "nothing installed" — without
    // the union this spot-check would wipe the manifest and punt every
    // existing user to the install prompt.
    const [beeNames, depNames] = await Promise.all([
      listFileNames(store.bees, store.legacyBees),
      listFileNames(store.dependencies, store.legacyDependencies),
    ])
    const beeOk = (cachedManifest.bees ?? []).every(sig => beeNames.has(`${sig}.js`))
    const beeDepSigs = new Set(Object.values(cachedManifest.beeDeps ?? {}).flatMap(list => list ?? []))
    const beeDepsOk = [...beeDepSigs].every(sig => depNames.has(`${sig}.js`))
    const allDepsOk = (cachedManifest.dependencies ?? []).every(sig => depNames.has(`${sig}.js`))
    if (beeOk && beeDepsOk && allDepsOk) {
      // THE NATIVE SHELL IS ITS OWN UPDATE AUTHORITY.
      //
      // Push-only is right for the web: DCP pushes, the user upgrades, boot
      // never decides. But the native client deliberately skips DCP (the
      // sentinel handshake does not know `tauri.localhost`), so on the desktop
      // there is NO pusher — and the bundled package is not a fallback there,
      // it is the version of the application you installed. Without this, a
      // hive keeps the bees from its FIRST launch forever: every later binary
      // ships new content that is never adopted, and each new feature looks
      // "broken on Windows" while working on the web. Measured on the real
      // hive: the app shipped package 5d001713… while the store still ran
      // e89773f1…, several builds behind.
      //
      // A new binary means new bundled bytes, so the comparison is exact and
      // free (a local asset read), and the adopt happens at most once per
      // installed version.
      if (await adoptNativeBundle()) {
        console.log('[ensure-install] native bundle adopted — reloading into it')
        location.reload()
        return
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
    // Name the evidence. A bare "spot-check failed" is undiagnosable after
    // the fact — during the native-client bring-up this line fired for
    // legitimate reasons (a genuinely broken install) but reads identically
    // to a misfire, and a misfire here costs the user a full reinstall
    // cycle. NOTE the wipe below is scoped to the INSTALL CACHE only
    // (bees/deps pools + legacy drains + SW cache) — it must never grow to
    // touch root content, lineage bags, or user pools.
    const missingBees = (cachedManifest.bees ?? []).filter(sig => !beeNames.has(`${sig}.js`))
    const missingDeps = [...new Set([...beeDepSigs, ...(cachedManifest.dependencies ?? [])])]
      .filter(sig => !depNames.has(`${sig}.js`))
    console.warn(
      `[ensure-install] cached state spot-check failed — wiping install cache and awaiting fresh install ` +
      `(missing ${missingBees.length} bees, ${missingDeps.length} deps: ` +
      `${[...missingBees, ...missingDeps].slice(0, 3).map(s => s.slice(0, 8)).join(', ')}…)`,
    )
    localStorage.removeItem(MANIFEST_KEY)
    localStorage.removeItem(SYNC_SIG_KEY)
    localStorage.removeItem(INSTALLED_FLAG_KEY)
    await purgeStaleOpfsArtifacts(store, installArtifactSigs(cachedManifest))
  }

  // Cold boot / cache miss. Nothing is installed, so there is nothing to
  // protect and nothing to swap under: this is the ONE moment where reaching
  // for content on the participant's behalf is not a policy change but the
  // only way the shell can be useful at all.
  //
  // WHY THIS IS NOT A REVERSAL OF THE PUSH-ONLY CONTRACT. That contract exists
  // so a WARM hive is never re-versioned underneath someone who did not ask —
  // "the user initiates upgrades, boot never does". A cold shell has no
  // version to change and no hive to disturb; the alternative is a welcome
  // card that can only say "you have nothing, and I know where to get it, and
  // I will not." Warm boots are untouched by this and still go through the
  // upgrade affordance.
  const acquired = await autoloadFromHosts()
  if (acquired) return

  console.log('[ensure-install] no cached content — surfacing install-needed')
  EffectBus.emit('boot:status', { kind: 'install-needed', reason: 'no-source' } as BootStatus)
}

/**
 * COLD-BOOT ACQUISITION from the domains this participant carries.
 *
 * Asks every carried domain what it publishes and takes the newest package
 * anyone offers. No signature has to be known in advance — on a cold boot
 * there is none to know — so "newest" is the only available answer, and the
 * manifest's own `generation` counter is what orders it.
 *
 * Silent on every failure. No carried domains, none reachable, none
 * publishing, an incomplete walk — all of them fall through to the welcome
 * card, which is the honest surface for "you have nothing yet". A cold boot
 * that cannot reach the network must not become an error message about hosts.
 *
 * Returns true only when a package was actually installed, which by the
 * complete-or-absent gate means its whole closure is on disk.
 */
/**
 * Resolve once the service worker is in control, or give up after a bounded
 * wait. Never rejects and never blocks a boot indefinitely: a browser with no
 * service-worker support, a registration that fails for its own reasons, or a
 * worker that is simply slow all end the same way — we reload anyway, because
 * a reload that might be early is better than a boot that never happens.
 *
 * `navigator.serviceWorker.ready` alone is not enough: it never settles when
 * no registration exists at all, which is precisely the first-load case.
 */
const serviceWorkerSettled = async (timeoutMs = 4000): Promise<void> => {
  try {
    if (!('serviceWorker' in navigator)) return
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise(resolve => setTimeout(resolve, timeoutMs)),
    ])
  } catch { /* a worker we cannot wait for is one we do not wait for */ }
}

const autoloadFromHosts = async (): Promise<boolean> => {
  try {
    // A COLD CLIENT CARRIES NOTHING. The pool that holds the domains you have
    // added is empty on a first run, and the drone that seeds it ships inside
    // the package we are trying to fetch — so falling back to the one known
    // host is not a convenience here, it is the only way the cycle opens.
    const carried = await listHostZones()
    const zones = carried.length ? carried : [...DEFAULT_HOST_ZONES]
    if (!zones.length) return false

    // ASK EACH DOMAIN FOR ITS HEAD. Discovery is the pool at
    // `sign('host:packages')` — an address every client derives for itself, so
    // there is nothing published saying where to look and no catalogue to read
    // (documentation/host-packages-pool.md).
    //
    // THE FIRST CARRIED DOMAIN THAT ANSWERS WINS, and the order is the
    // participant's own. This used to be "newest wins", ranked by a counter
    // the manifest stamped — but a counter is per-host bookkeeping, and asking
    // two hosts to be comparable by it was always a fiction. Ranking ACROSS
    // hosts is the signed sentinel's job; a host can only answer for itself.
    // Nothing is risked by the simpler rule: every answer is content-addressed,
    // so whichever host replies, the bytes verify or they are refused.
    const heads = (await Promise.all(zones.map(async zone => {
      try { return await headPackage(zone) } catch { return null }
    }))).filter((offer): offer is NonNullable<typeof offer> => offer !== null)
    if (!heads.length) return false

    const newest = heads[0]!

    EffectBus.emit('boot:status', { kind: 'installing' } as BootStatus)
    console.log(`[ensure-install] cold boot — acquiring ${newest.packageSig.slice(0, 12)}… from ${zones.join(', ')}`)

    // Every domain that publishes it is a byte source for it.
    const outcome = await acquire(newest.packageSig, zones)
    if (!outcome.ok) {
      console.warn('[ensure-install] cold acquisition incomplete —', outcome.error ?? `${outcome.holes.length} hole(s)`)
      return false
    }

    // WAIT FOR THE SERVICE WORKER BEFORE RELOADING.
    //
    // Reloading the instant the bytes land looks harmless and is not: on the
    // very FIRST load of an origin the service worker is still registering,
    // the navigation aborts it, and the failure then sticks for that origin —
    // `register()` keeps answering "unknown error when fetching the script".
    // Nothing recovers on its own, and the symptom is far from the cause: the
    // package is installed and correct, `hypercomb.installed` is true, 124
    // bees are on disk, and the hive still comes up blank forever, because
    // every `/opfs/<sig>` module URL 404s without a worker to answer it.
    //
    // Observed on two virgin origins; the manual path never hit it only
    // because a person takes seconds to reload and the worker wins that race.
    await serviceWorkerSettled()

    // CACHE THE IMPORT MAP THE ACQUISITION JUST MADE RESOLVABLE.
    //
    // The map is built from the dependency pool and then FROZEN by the browser
    // at first module evaluation, so a reload that boots before the map is
    // cached gets a map missing the very deps we just wrote. The bees land,
    // the pool is right, and `Settings` never registers — which fails
    // `PixiHostWorker.ready()`'s resolve('settings') gate and paints an
    // empty hive with no error anywhere. The bundled-upgrade path has always
    // done this for the same reason; the cold path needs it just as much.
    try { await cacheImportMap() } catch (error) {
      console.warn('[ensure-install] import map not cached before reload', error)
    }

    console.log(`[ensure-install] acquired ${outcome.fetched} atom(s) — reloading onto the package`)
    location.reload()
    return true
  } catch (error) {
    console.warn('[ensure-install] cold acquisition failed', error)
    return false
  }
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

  // MERKLE FIRST. A package signature IS the closure it names, so equal sigs
  // mean equal trees and there is nothing to offer — no set comparison can say
  // more than that. It also keeps the comparisons below honest now that the
  // cached arrays are DERIVED from the signed tree while `bundled.*` is still
  // what /content/manifest.json asserts: the two are only ever put side by side
  // when the packages genuinely differ.
  if (localStorage.getItem(SYNC_SIG_KEY) === bundled.packageSig) {
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

  // ── Update-authority gate ────────────────────────────────────────────
  // The shell's bundled `/content/` is the update reference ONLY for installs
  // that came FROM the bundle. A host-sourced install has its own authority
  // and surfaces its own updates; diffing it against the bundled package
  // raised phantom "New features" the moment the two drifted. Provenance is
  // stamped on every manifest write, and an install without one is treated as
  // NOT ours — conservative, and it self-heals on the next upgradeFromBundled,
  // which stamps `source: 'bundled'`.
  //
  // This used to INFER provenance by diffing bee sets. It cannot any more, and
  // should not: the bundle no longer states an inventory, because nothing a
  // publisher writes down decides what a client installs.
  if (cached.source !== 'bundled') {
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

  // THE SIGNATURE IS THE ANSWER. Equal signatures returned above, so reaching
  // here means the bundle is a different tree — which is what an update IS.
  //
  // What went with the manifest is the DELTA: "and here are the 4 new bees".
  // That list existed only because a document enumerated an inventory, and
  // computing it honestly now would mean resolving the new package's whole
  // closure to render a number. The pill says a newer build is here; what
  // changed in it is a release note's job, not the installer's.
  EffectBus.emit('update:available', {
    available: true,
    newCount: 0,
    newBees: [],
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
 * Returns `true` only when the package resolved COMPLETELY (every declared
 * layer, bee and dependency held and verified). A partial resolution returns
 * `false` and does not activate — complete-or-absent.
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
    // INSTALL FIRST, PURGE AFTER. This used to wipe the current install before
    // fetching the next one, so any refusal on the way in (an incomplete
    // closure, a core the shell cannot serve) left the participant with NO
    // install at all. Now the current package stays live until the new one has
    // fully resolved and passed every gate; only then are the atoms it dropped
    // purged — by name, old minus new — so nothing stale loads on the next
    // boot. Present atoms are reused by the walker, so this is also less to
    // fetch, not more.
    const previous = tryParseManifest(localStorage.getItem(MANIFEST_KEY) ?? '')
    // Report what actually happened. This used to return `true`
    // unconditionally, so a partial install told the caller it had succeeded
    // and main.ts reloaded into a hive with bees missing.
    const ok = await installFromBundled(bundled, sigStore)
    if (ok && previous) {
      const current = tryParseManifest(localStorage.getItem(MANIFEST_KEY) ?? '')
      const keep = new Set(installArtifactSigs(current))
      await purgeStaleOpfsArtifacts(store, installArtifactSigs(previous).filter(sig => !keep.has(sig)))
    }
    return ok
  } finally {
    EffectBus.emit('install:sync', { active: false, source: 'bundled' })
  }
}

/**
 * Adopt the bundled package when the NATIVE shell is carrying one the store
 * has not installed. No-op on the web (where push-only is the contract) and
 * no-op when the store is already on the shipped package — so the ordinary
 * cost is one local manifest read.
 *
 * Returns `true` when the store changed and the caller must reload; the sig is
 * stamped by `installFromBundled` before that, so a failed reload cannot loop.
 */
const adoptNativeBundle = async (): Promise<boolean> => {
  try {
    const { nativeAvailable } = await import('@hypercomb/runtime/native-filesystem')
    if (!nativeAvailable()) return false
    const bundled = await fetchBundledPackage()
    if (!bundled) return false
    if (localStorage.getItem(SYNC_SIG_KEY) === bundled.packageSig) return false
    console.log(
      `[ensure-install] native bundle ${bundled.packageSig.slice(0, 12)} ≠ installed ` +
      `${(localStorage.getItem(SYNC_SIG_KEY) ?? 'none').slice(0, 12)} — adopting the shipped package`,
    )
    return await upgradeFromBundled()
  } catch (err) {
    // A hive that boots on yesterday's bees beats a hive that does not boot.
    console.warn('[ensure-install] native bundle adopt failed; continuing on cached state', err)
    return false
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
  // Sigbag (Phase 1 additive): when present, the bundle ships a
  // `<bagSig>/0000…` dir alongside the flat leaves. New flat builds put
  // the bag dir at the content root; legacy bundles nested it inside the
  // retired `__dependencies__/` / `__bees__/` dirs (fetch falls back to
  // that URL shape). Absent for older bundles.
  // Sidecar branch metadata (does not affect packageSig). Ignored at install.
  label?: string
  at?: string
  previous?: string | null
}

/**
 * THE SHELL'S OWN BUNDLED PACKAGE — read the same way a host's is.
 *
 * `/content/` is a host like any other: it carries the `host:packages` pool at
 * the address every client derives, and the head of that pool is the package
 * this build ships. There is no manifest to read, and nothing here states an
 * inventory — the sets are derived from the sealed root at admission, the
 * beeDeps from the bytes, the bags computed outright.
 *
 * A directory listing when the shell is served by something that can list one;
 * the ship's `index.html` when it cannot. Both answer the same URL, which is
 * why this needs no branch for "am I on a dev server or a bucket".
 */
const fetchBundledPackage = async (): Promise<BundledPackage | null> => {
  try {
    const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)

    const entryAt = async (index: number): Promise<{ text: string; at: string } | null> => {
      const res = await fetch(`/content/${pool}/${poolEntryName(index)}`)
      if (!res.ok) return null
      const text = await res.text()
      if (text.includes('<')) return null
      const modified = res.headers.get('last-modified')
      const at = modified ? new Date(modified).toISOString() : ''
      return { text, at: at === 'Invalid Date' ? '' : at }
    }

    // One request for the listing; the head is the max marker in it.
    const listing = await fetch(`/content/${pool}/`, { cache: 'no-store' })
      .then(async res => (res.ok ? parsePoolListing(await res.text()) : null))
      .catch(() => null)

    let head = -1
    if (listing) {
      const indices = markerIndices(listing)
      head = indices.length ? indices[indices.length - 1]! : -1
    } else {
      // A dev server that serves files but cannot list a directory. Walk
      // forward until the gap — the bundle is one build's worth of entries,
      // not a host's whole history, so this stays short.
      while (head < 4096 && await entryAt(head + 1) !== null) head++
    }
    if (head < 0) return null

    const fetched = await entryAt(head)
    const member = parseMember(fetched?.text ?? null)
    if (!member) return null

    return {
      packageSig: member.packageSig,
      bees: [],
      dependencies: [],
      layers: [],
      label: member.label || undefined,
      at: fetched?.at,
      previous: null,
    }
  } catch {
    return null
  }
}


const installFromBundled = async (bundled: BundledPackage, sigStore: SignatureStore): Promise<boolean> => {
  const store = get('@hypercomb.social/Store') as Store | undefined
  if (!store) return false

  const fetchBytes = async (path: string): Promise<Uint8Array<ArrayBuffer> | null> => {
    try {
      // Default cache mode, NOT 'no-store': every URL through here is
      // sig-addressed immutable content — same bytes forever, so the HTTP
      // cache is free bandwidth. The mutable /content/manifest.json fetch
      // (fetchBundledPackage) keeps its no-store; that one must revalidate.
      const res = await fetch(path)
      if (!res.ok) return null
      // SPA fallback guard: an extension-less flat /content/<sig> on a
      // dev-server origin returns index.html with 200. Sig-addressed bytes
      // are never text/html.
      //
      // NATIVE EXCEPTION: Tauri's asset server guesses mime by extension, so
      // every extension-less sig file arrives as text/html — the guard
      // rejected all 203 bundled files and the install reported 0/107 with no
      // error (verified live: correct bytes, wrong header). There is no SPA
      // fallback inside the native shell, and the walker's sha256 check is
      // the real gate — index.html bytes could never hash to a declared sig.
      const { nativeAvailable } = await import('@hypercomb/runtime/native-filesystem')
      if (!nativeAvailable() &&
          (res.headers.get('content-type') || '').toLowerCase().includes('text/html')) return null
      return new Uint8Array(await res.arrayBuffer()) as Uint8Array<ArrayBuffer>
    } catch {
      return null
    }
  }

  // Delivery-format bridge: new builds emit FLAT sig-named files at the
  // content root; content deployed before that stays old-layout. Flat URL
  // first, legacy typed URL shape second.
  const fetchFirst = (urlsFor: (sig: string) => string[]) =>
    async (sig: string): Promise<Uint8Array<ArrayBuffer> | null> => {
      for (const url of urlsFor(sig)) {
        const bytes = await fetchBytes(url)
        if (bytes) return bytes
      }
      return null
    }

  const readFrom = (dirs: (FileSystemDirectoryHandle | undefined)[], namesFor: (sig: string) => string[]) =>
    async (sig: string): Promise<Uint8Array<ArrayBuffer> | null> => {
      for (const dir of dirs) {
        if (!dir) continue
        for (const name of namesFor(sig)) {
          try {
            const handle = await dir.getFileHandle(name, { create: false })
            return new Uint8Array(await (await handle.getFile()).arrayBuffer()) as Uint8Array<ArrayBuffer>
          } catch { /* try the next name / dir */ }
        }
      }
      return null
    }

  // The write side owns PLACEMENT and the service-worker cache seed. The
  // walker itself knows no kinds, pools, or URL shapes (its squeaky-clean
  // rule) — everything kind-shaped lives here, in the caller's io wiring.
  const writeTo = (
    dir: FileSystemDirectoryHandle | undefined,
    nameFor: (sig: string) => string,
    cacheUrlFor: (sig: string) => string,
    contentType: string,
  ) => async (sig: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> => {
    if (!dir) throw new Error(`[ensure-install] no destination for ${sig.slice(0, 12)}`)
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    await writeBytes(dir, nameFor(sig), buffer)
    await seedCacheEntry(cacheUrlFor(sig), buffer, contentType)
  }

  const beesUrlBase = `/opfs/${await Store.poolSignature(Store.BEES_MEANING)}`
  const depsUrlBase = `/opfs/${await Store.poolSignature(Store.DEPENDENCIES_MEANING)}`

  // DERIVE THE INVENTORY FROM THE SEALED ROOT (documentation/host-packages-pool.md).
  // `bundled.layers` / `.bees` / `.dependencies` are what /content/manifest.json
  // ASSERTS; the layer closure is what the signed bytes SAY. The two agree for
  // every package the build has ever emitted — which is exactly why the
  // assertion can go: it was a copy, and it was the only unsigned thing
  // deciding which modules the preloader would run. Same derivation the shim
  // and window.hypercomb.acquire use; there is one acquisition, not three.
  const layersIo = {
    read: readFrom([store.hypercombRoot, store.legacyHive, store.legacyHypercombIo, store.layers], sig => [sig, `${sig}.json`]),
    fetch: fetchFirst(sig => [`/content/${sig}`, `/content/__layers__/${sig}.json`]),
    write: writeTo(store.hypercombRoot, sig => sig, sig => `/opfs/__layers__/${sig}.json`, 'application/json; charset=utf-8'),
  } satisfies ReplicationIo

  const { inventory, result: layersResult } = await deriveInventory(bundled.packageSig, layersIo)

  // SEALED RECORD (install-by-replication step 3), now checked against the
  // DERIVED sets: root declared in its own layer set, every sig well-formed,
  // beeDeps closed over what the tree actually holds. Nothing outside it is
  // ever fetched.
  const sealed = validateSealedPackage(bundled.packageSig, inventory)
  if (!sealed.valid) {
    console.warn(`[ensure-install] bundled package ${bundled.packageSig.slice(0, 12)} is not sealed: ${sealed.errors.join('; ')}`)
    return false
  }

  reportDivergence('the bundled package', bundled, inventory)

  // One call per derived set. `resolveInventory` is the EXACT-inventory
  // shape: no mining, no recursion — the closure that named these signatures
  // IS the inventory identity. Every byte is sha256-verified against its name
  // before admission, a present-and-correct file is reused, and a repeat call
  // is an idempotent delta repair.
  const [depsResult, beesResult] = await Promise.all([
    resolveInventory(bundled.packageSig, inventory.dependencies, {
      read: readFrom([store.dependencies, store.legacyDependencies], sig => [`${sig}.js`, sig]),
      fetch: fetchFirst(sig => [`/content/${sig}`, `/content/__dependencies__/${sig}.js`]),
      write: writeTo(store.dependencies, sig => `${sig}.js`, sig => `${depsUrlBase}/${sig}`, 'application/javascript; charset=utf-8'),
    } satisfies ReplicationIo),
    resolveInventory(bundled.packageSig, inventory.bees, {
      read: readFrom([store.bees, store.legacyBees], sig => [`${sig}.js`, sig]),
      fetch: fetchFirst(sig => [`/content/${sig}`, `/content/__bees__/${sig}.js`]),
      write: writeTo(store.bees, sig => `${sig}.js`, sig => `${beesUrlBase}/${sig}.js`, 'application/javascript; charset=utf-8'),
    } satisfies ReplicationIo),
  ])

  // CAN THIS SHELL RUN IT? (core-surface.ts). The admitted modules name what
  // they import from `@hypercomb/core`; the shell's own runtime core is asked
  // what it exports. A package built against a newer core than this shell
  // ships is refused HERE, by name — never activated to die at evaluation
  // ("does not provide an export named …", nine dependencies down, live
  // 2026-09-04). Thrown rather than returned so the caller unwinds before it
  // touches the install it is replacing; the bytes stay for the delta repair.
  const compat = await checkCoreCompatibility(
    [...inventory.bees, ...inventory.dependencies],
    readFrom([store.bees, store.legacyBees, store.dependencies, store.legacyDependencies], sig => [`${sig}.js`, sig]),
  )
  if (!compat.ok) {
    console.warn(`[ensure-install] bundled package ${bundled.packageSig.slice(0, 12)} ${describeCoreMismatch(compat.missing)}`)
    throw new CoreMismatchError(compat.missing)
  }

  // beeDeps, worked out from the bytes just admitted rather than taken from
  // the bundled manifest (bee-deps.ts). A HINT: an empty map means every
  // dependency loads eagerly, which is correct and merely heavier at boot.
  const beeDeps = await deriveBeeDeps(
    inventory.bees,
    inventory.dependencies,
    readFrom([store.bees, store.legacyBees, store.dependencies, store.legacyDependencies], sig => [`${sig}.js`, sig]),
  )

  // THE BAGS, BUILT HERE RATHER THAN DOWNLOADED (bags.ts).
  //
  // A bag is the index the import map is assembled from, and every input to it
  // is on disk once the sets above resolve: a dependency's alias is the first
  // line of its own bytes, a bee has none, and the bag's address is the sha256
  // of those entries. The bundle's `beesBag` / `dependenciesBag` were the last
  // two fields anyone could argue a publisher had to assert; they are computed
  // now, so nothing is fetched and nothing is claimed.
  //
  // Single-bag invariant: evict any prior bag first, so the import map's
  // readdir finds exactly one and needs no pointer file. Scoped STRICTLY to the
  // install-owned pools — at the OPFS root the same 64-hex dir shape is a user
  // lineage sigbag.
  const evictOldBagDirs = async (parentDir: FileSystemDirectoryHandle, keepSig: string): Promise<void> => {
    const stale: string[] = []
    for await (const [name, handle] of parentDir.entries()) {
      if (handle.kind !== 'directory') continue
      if (!/^[a-f0-9]{64}$/i.test(name)) continue
      if (name === keepSig) continue
      stale.push(name)
    }
    for (const name of stale) {
      // A 64-hex SUBDIRECTORY of a pool is an author bucket as readily as a
      // stale bag. Let it prove which: a bag holds only `bagEntryName(i)`
      // markers, so `hardDeleteVetoFor` passes; a bucket or a nested pool
      // holds members and refuses.
      try {
        const child = await parentDir.getDirectoryHandle(name, { create: false })
        const veto = await bagEvictionVeto(child)
        if (veto) { console.warn(`[ensure-install] not evicting ${name.slice(0, 8)}… — it ${veto}`); continue }
        await parentDir.removeEntry(name, { recursive: true })
      } catch { /* skip */ }
    }
  }

  const putBag = async (
    parentDir: FileSystemDirectoryHandle | undefined,
    entries: { sig: string; content: string }[],
  ): Promise<number> => {
    if (!parentDir || !entries.length) return 0
    const bagSig = await bagSignature(entries)
    await evictOldBagDirs(parentDir, bagSig)
    const bagDir = await parentDir.getDirectoryHandle(bagSig, { create: true })
    const ordered = orderedEntries(entries)
    await Promise.all(ordered.map(async (entry, index) => {
      const bytes = new TextEncoder().encode(entry.content)
      await writeBytes(bagDir, bagEntryName(index), bytes.buffer.slice(0, bytes.byteLength) as ArrayBuffer)
    }))
    return ordered.length
  }

  const readDep = readFrom([store.dependencies, store.legacyDependencies], sig => [`${sig}.js`, sig])
  const aliases = new Map<string, string>()
  for (const sig of inventory.dependencies) aliases.set(sig, aliasOf(await readDep(sig)))

  const depBagCount = await putBag(store.dependencies, dependencyEntries(inventory.dependencies, sig => aliases.get(sig) ?? ''))
  const beeBagCount = await putBag(store.bees, beeEntries(inventory.bees))

  // COMPLETE OR ABSENT (install-by-replication step 4). The gate reads the
  // CLOSURE RESULT, not the individual files. This used to warn about a
  // partial install and then set the installed flag anyway, so an incomplete
  // tree activated: the shell booted with bees missing, the preloader logged
  // nulls, and the participant saw a hive with features silently absent.
  // A tree that did not fully resolve is not installed.
  const complete = [layersResult, depsResult, beesResult].every(isComplete)
  const manifest = {
    version: 2,
    layers: inventory.layers,
    bees: inventory.bees,
    dependencies: inventory.dependencies,
    beeDeps,
    // Came from the shell's bundled package → the bundle IS this install's
    // update authority (checkForUpdate compares against it).
    source: 'bundled' as const,
  }
  if (!complete) {
    console.warn(
      `[ensure-install] bundled package ${bundled.packageSig.slice(0, 12)} did not fully resolve — NOT activating. ` +
      `holes layers/deps/bees: ${layersResult.holes.length}/${depsResult.holes.length}/${beesResult.holes.length}, ` +
      `refused: ${layersResult.refused.length}/${depsResult.refused.length}/${beesResult.refused.length}`,
    )
    // Keep what DID land — every admitted byte is verified, so the next
    // attempt is a delta repair rather than a refetch — but never claim the
    // hive is installed.
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest))
    localStorage.removeItem(SYNC_SIG_KEY)
    return false
  }

  localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest))
  localStorage.setItem(SYNC_SIG_KEY, bundled.packageSig)
  // The one stamp every activation path leaves — what the host directory reads
  // to say which build this shell is on.
  stampInstalledPackage(bundled.packageSig)
  localStorage.setItem(INSTALLED_FLAG_KEY, 'true')
  if (Object.keys(beeDeps).length) (globalThis as any).__hypercombBeeDeps = beeDeps
  sigStore.trustAll([...inventory.bees, ...inventory.dependencies, ...inventory.layers])
  localStorage.setItem(SIG_STORE_KEY, JSON.stringify(sigStore.toJSON()))
  const held = (r: { present: number; fetched: number; total: number }): string => `${r.present + r.fetched}/${r.total}`
  console.log(
    `[ensure-install] bundled package complete: ${bundled.packageSig.slice(0, 12)} ` +
    `(bees ${held(beesResult)}, deps ${held(depsResult)}, layers ${held(layersResult)}, ` +
    `bags: deps=${depBagCount} bees=${beeBagCount})`,
  )
  return true
}

/**
 * Wipe stale bees, deps, and layer files from OPFS so the next sync
 * starts from a clean slate. Without this, old artifacts linger in
 * OPFS forever — even after a successful resync — because resync only
 * writes the new files; it never removes signatures that fell out of
 * the manifest. The script-preloader can then still find and load a
 * stale dep with broken Angular code in it.
 *
 * Scope: install-cache POOL CONTENTS only (sign('bees') /
 * sign('dependencies') pools plus their legacy `__x__` drain dirs).
 * Never the pool dirs themselves, never the flat root (layer bytes
 * share it with user commits), never lineage bags.
 */
/** An entry an install pass writes: `<sig>` or `<sig>.js`. Nothing else in
 *  an install cache is this code's to remove. */
export const isInstallArtifactName = (name: string): boolean => /^[0-9a-f]{64}(?:\.js)?$/i.test(name)

/**
 * Empty a LEGACY install-cache directory of what an install wrote — and of
 * nothing else. This was the one `purgeDir` in the file that removed every
 * entry by enumeration (write-conformance, ensure-install.ts:983) while its
 * neighbours proved each removal. The same rule as theirs, per entry: a FILE
 * goes only if it is named like an install artifact; a DIRECTORY goes only if
 * `bagEvictionVeto` is null (a bag this install wrote — at least one marker,
 * nothing foreign). Anything else stays, and the caller's non-recursive
 * `removeEntry` on the directory then fails, which is the design: a legacy
 * dir disappears only once it is genuinely empty. Returns what was refused.
 */
export const purgeInstallCacheDir = async (dir: FileSystemDirectoryHandle): Promise<string[]> => {
  const entries: Array<[string, FileSystemHandle]> = []
  try {
    for await (const entry of dir.entries()) entries.push(entry)
  } catch { return [] }
  const refused: string[] = []
  for (const [name, handle] of entries) {
    try {
      if (handle.kind === 'file') {
        if (!isInstallArtifactName(name)) { refused.push(name); continue }
        await dir.removeEntry(name)
      } else {
        const veto = await bagEvictionVeto(handle as FileSystemDirectoryHandle)
        if (veto) { refused.push(name); continue }
        await dir.removeEntry(name, { recursive: true })
      }
    } catch { refused.push(name) }
  }
  if (refused.length) console.warn(`[ensure-install] left ${refused.length} entr${refused.length === 1 ? 'y' : 'ies'} in ${dir.name} — not an install's to remove`)
  return refused
}

/** Every install-cache atom a manifest accounts for: its bees, its
 *  dependencies, and the dependencies its bees claim. */
const installArtifactSigs = (manifest: ReturnType<typeof tryParseManifest>): string[] =>
  [...new Set([
    ...(manifest?.bees ?? []),
    ...(manifest?.dependencies ?? []),
    ...Object.values(manifest?.beeDeps ?? {}).flatMap(list => list ?? []),
  ])]

const purgeStaleOpfsArtifacts = async (store: Store, sigs: readonly string[]): Promise<void> => {
  const purgeDir = purgeInstallCacheDir

  // THE POOLS ARE NOT WIPED — they are purged by NAME.
  //
  // "Install-cache pool contents only" scopes the HANDLE, not the ADDRESS.
  // `store.bees` IS sign('bees'), and sign('bees') IS the molecule of a tile
  // named `bees`; the same for `dependencies`. An enumerate-and-remove-all
  // there destroys another participant's markers, buckets and atoms.
  //
  // So the removal set is what THIS installer wrote, read back from the
  // cached manifest — and note the shape: an install-cache file is named
  // `<sig>.js`, which classifies as FOREIGN, not as a member. That is
  // precisely why this must be a NAMED-SET removal and can never be
  // simplified back into a kind-based sweep.
  //
  // A manifest may only NARROW the set: every name is still classified, and
  // the whole plan is refused if a marker is present. The caller says WHICH
  // manifest's atoms — the one being replaced, minus what the replacement
  // still uses — so a purge after a successful install never eats the install.
  const own = new Set<string>()
  for (const sig of sigs) {
    own.add(sig); own.add(`${sig}.js`)
  }
  const purgeOwned = async (dir: FileSystemDirectoryHandle | undefined): Promise<void> => {
    if (!dir) return
    // Bag DIRS are not in any manifest — their names are computed. Each one
    // proves itself instead: `hardDeleteVetoFor` passes only for a directory
    // that is all markers (which a bag is) or empty, and refuses an author
    // bucket or a nested pool.
    // THE WHOLE-DIRECTORY REFUSAL COMES FIRST. `planNamedRemovalFor` refuses
    // the entire plan when this directory holds markers — which is how it
    // recognises a participant's lineage living at `sign('bees')` — and the
    // directory loop used to run BEFORE it, so that protection never gated the
    // sub-directory removals at all. One refusal, then nothing is touched.
    const plan = await planNamedRemovalFor(dir, own)
    if (plan.refused) {
      console.warn(`[ensure-install] not purging ${dir.name.slice(0, 8)}… — it ${plan.refused}`)
      return
    }
    const dirs: string[] = []
    try {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') dirs.push(name)
      }
    } catch { return }
    for (const name of dirs) {
      try {
        const child = await dir.getDirectoryHandle(name, { create: false })
        const veto = await bagEvictionVeto(child)
        if (veto) { console.warn(`[ensure-install] not purging ${name.slice(0, 8)}… — it ${veto}`); continue }
        await dir.removeEntry(name, { recursive: true })
      } catch { /* skip */ }
    }
    for (const name of plan.remove) {
      try { await dir.removeEntry(name, { recursive: true }) } catch { /* skip */ }
    }
  }
  await Promise.all([purgeOwned(store.bees), purgeOwned(store.dependencies)])
  // The legacy `__bees__`/`__dependencies__` drain dirs are the same
  // install cache — empty them in the same wipe so the Store's detached
  // absorb can't re-seed the pools with the stale sigs we just purged,
  // then remove the emptied dir (non-recursive: only succeeds once
  // genuinely empty) so it stays gone. Self-cleaning, not user data.
  const dropLegacy = async (dir: FileSystemDirectoryHandle | undefined, name: string): Promise<boolean> => {
    if (!dir) return false
    await purgeDir(dir)
    try { await store.opfsRoot.removeEntry(name); return true } catch { return false }
  }
  if (await dropLegacy(store.legacyBees, Store.LEGACY_BEES_DIRECTORY)) store.legacyBees = undefined
  if (await dropLegacy(store.legacyDependencies, Store.LEGACY_DEPENDENCIES_DIRECTORY)) store.legacyDependencies = undefined
  try {
    // Legacy `__layers__` may be absent (retired — layer bytes live flat
    // at the OPFS root now); only legacy installs still have stale
    // per-domain manifest subdirs to purge here. Its flat sig files are
    // left for the Store's content relocation to drain.
    if (store.layers) {
      for await (const [, handle] of store.layers.entries()) {
        if (handle.kind === 'directory') await purgeDir(handle as FileSystemDirectoryHandle)
      }
    }
  } catch { /* skip */ }
  // Also drop the SW module cache so refetches aren't served from a stale entry.
  try {
    if ('caches' in self) await caches.delete('hypercomb-modules-v2')
  } catch { /* skip */ }
}


// ----- helpers -----

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

/** All file names across the given directories as one Set — a single
 *  enumeration per dir replaces N serial getFileHandle existence probes
 *  on the boot spot-check. Callers pass a pool plus its legacy drain dir
 *  so the union covers files still mid-drain. */
const listFileNames = async (...dirs: (FileSystemDirectoryHandle | undefined)[]): Promise<Set<string>> => {
  const names = new Set<string>()
  for (const dir of dirs) {
    if (!dir) continue
    try {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'file') names.add(name)
      }
    } catch { /* dir unreadable — missing names fail the spot-check, triggering reinstall */ }
  }
  return names
}
