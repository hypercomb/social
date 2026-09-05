// meadowverse/src/ensure-install.ts
// runs BEFORE the import map is set, so that OPFS dependencies are written
// before the browser freezes the import-map entries.
//
// Storage model (see hypercomb-runtime/src/store.ts): bees and dependencies
// live in their sign(meaning) POOLS (store.bees / store.dependencies —
// the handles already point at the pools); layers live as bare sig-named
// files at the FLAT OPFS ROOT. The legacy `__bees__`/`__dependencies__`/
// `__layers__` dirs are read-fallback drain sources only: presence checks
// UNION pool + legacy while a legacy handle exists, and install-cache
// deletions touch pools + legacy dirs ONLY — never the flat root, which is
// shared, content-addressed space (a stale layer sig file there is inert;
// GC is a deliberate separate phase, never an install side effect).

import { SignatureStore } from '@hypercomb/core'
import { isComplete, resolveInventory, Store, validateSealedPackage } from '../../hypercomb-shared/core'

const AZURE_CONTENT_URL = 'https://storagemeadowverse.blob.core.windows.net/content'
const isLocalDev = typeof window !== 'undefined'
  && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
const CONTENT_BASE_URL = isLocalDev
  ? `${window.location.origin}/content`
  : AZURE_CONTENT_URL
const SIGNATURE_REGEX = /^[a-f0-9]{64}$/i
const INSTALLED_KEY = 'meadowverse.installed-signature'
const MANIFEST_KEY = 'meadowverse.installed-manifest'
const SIG_STORE_KEY = 'meadowverse.signature-store'

// ensure side-effect registrations
const _deps = [Store]

type InstallManifest = {
  version: number
  layers: string[]
  bees: string[]
  dependencies: string[]
  beeDeps?: Record<string, string[]>
}

export const ensureInstall = async (): Promise<void> => {
  const sigStore = new SignatureStore()
  register('@hypercomb/SignatureStore', sigStore)

  const store = get('@hypercomb.social/Store') as Store | undefined
  if (!store) {
    console.warn('[meadowverse:install] Store not registered')
    return
  }

  await store.initialize()

  const signature = resolveSignatureFromUrl()
    ?? await resolveLatestSignature()
  if (!signature) {
    console.warn('[meadowverse:install] no content signature — add ?content=<sig> or ensure manifest.json is served')
    return
  }
  console.log(`[meadowverse:install] active signature: ${signature} (source: ${resolveSignatureFromUrl() ? 'url' : 'manifest.json'})`)

  // Always fetch the live manifest first — it's the source of truth for
  // what should be in OPFS. The localStorage cache is only used as a
  // fallback when offline.
  const contentBase = await resolveContentBase(signature)
  const newManifest = await fetchManifest(contentBase, signature)

  const shouldInstall = await needsInstall(store, signature, newManifest)

  if (!shouldInstall) {
    console.log('[meadowverse:install] already installed:', signature)
    restoreSignatureStore(sigStore)

    // Refresh beeDeps + cached manifest from the live fetch so any
    // stale beeDeps in localStorage (from prior build-cache bugs) gets
    // overwritten. The rootLayerSig only encodes layers' bees +
    // dependencies arrays, not the beeDeps map, so a same-sig manifest
    // CAN have a different beeDeps and we must trust the live one.
    if (newManifest) {
      if (newManifest.beeDeps) (globalThis as any).__hypercombBeeDeps = newManifest.beeDeps
      localStorage.setItem(MANIFEST_KEY, JSON.stringify(newManifest))
    } else {
      // Live fetch failed (offline) — fall back to cache.
      const cached = localStorage.getItem(MANIFEST_KEY)
      if (cached) {
        const m = tryParseManifest(cached)
        if (m?.beeDeps) (globalThis as any).__hypercombBeeDeps = m.beeDeps
      }
    }
    return
  }

  // The live manifest is the inventory record; without it there is nothing
  // sealed to install against. (Offline with a matching prior install already
  // returned above via needsInstall.)
  if (!newManifest) {
    console.warn('[meadowverse:install] live manifest unavailable — cannot install; will retry next load')
    return
  }

  // Admission-time authority gate (install-by-replication.md): the package
  // record must be sealed — the root sig declared in its own layer set, every
  // sig well-formed, beeDeps closed over the declared sets. Nothing outside
  // the sealed record is an install candidate.
  const sealed = validateSealedPackage(signature, newManifest)
  if (!sealed.valid) {
    console.warn(`[meadowverse:install] package ${signature.slice(0, 12)} is not sealed: ${sealed.errors.join('; ')}`)
    return
  }

  const oldManifestJson = localStorage.getItem(MANIFEST_KEY)
  const oldManifest = oldManifestJson ? tryParseManifest(oldManifestJson) : null

  if (oldManifest) {
    console.log('[meadowverse:install] incremental update:', signature)
    // bees/deps: install-cache pools + their legacy drain dirs.
    await removeStale([store.bees, store.legacyBees], oldManifest.bees, newManifest.bees)
    await removeStale([store.dependencies, store.legacyDependencies], oldManifest.dependencies, newManifest.dependencies)
    // layers: clean the LEGACY dir only. Dropped layer sigs at the flat
    // root stay put — content-addressed, so they can only be absent or
    // correct, and the root is not an install-owned location.
    await removeStale([store.layers], oldManifest.layers, newManifest.layers)
  } else {
    console.log('[meadowverse:install] full install:', signature)
    // Wipe the install-cache POOLS (bees/deps) and any legacy install
    // dirs still draining. NEVER the flat root (see header comment).
    await clearDirectories(store.bees, store.legacyBees)
    await clearDirectories(store.dependencies, store.legacyDependencies)
    await clearDirectories(store.layers)
  }

  // Replication engine (documentation/install-by-replication.md): the sealed
  // package is an exact inventory — resolve each kind through the walker,
  // which verifies every byte against its name before write and reuses what
  // is present (idempotent delta repair). Placement (pool vs flat root) and
  // legacy drain fallbacks live HERE in the io wiring; the walker itself is
  // kind- and legacy-free.
  const [layersResult, depsResult, beesResult] = await Promise.all([
    resolveInventory(signature, newManifest.layers, {
      read: readFrom([store.hypercombRoot, store.legacyHive, store.legacyHypercombIo, store.layers], sig => [sig, `${sig}.json`]),
      fetch: fetchFrom(sig => [`${contentBase}/${sig}`, `${contentBase}/__layers__/${sig}.json`]),
      write: writeTo(store.hypercombRoot, sig => sig),
    }),
    resolveInventory(signature, newManifest.dependencies, {
      read: readFrom([store.dependencies, store.legacyDependencies], sig => [`${sig}.js`, sig]),
      fetch: fetchFrom(sig => [`${contentBase}/${sig}`, `${contentBase}/__dependencies__/${sig}.js`]),
      write: writeTo(store.dependencies, sig => `${sig}.js`),
    }),
    resolveInventory(signature, newManifest.bees, {
      read: readFrom([store.bees, store.legacyBees], sig => [`${sig}.js`, sig]),
      fetch: fetchFrom(sig => [`${contentBase}/${sig}`, `${contentBase}/__bees__/${sig}.js`]),
      write: writeTo(store.bees, sig => `${sig}.js`),
    }),
  ])
  const complete = [layersResult, depsResult, beesResult].every(isComplete)
  if (!complete) {
    console.warn(
      `[meadowverse:install] incomplete — holes layers/deps/bees: `
      + `${layersResult.holes.length}/${depsResult.holes.length}/${beesResult.holes.length}, `
      + `refused: ${layersResult.refused.length}/${depsResult.refused.length}/${beesResult.refused.length}`,
    )
  }

  await populateSignatureStore(sigStore, contentBase, signature)

  if (complete) {
    localStorage.setItem(INSTALLED_KEY, signature)
    if (newManifest) {
      localStorage.setItem(MANIFEST_KEY, JSON.stringify(newManifest))
      if (newManifest.beeDeps) (globalThis as any).__hypercombBeeDeps = newManifest.beeDeps
    }
    console.log('[meadowverse:install] done:', signature)
  } else {
    if (newManifest) {
      if (newManifest.beeDeps) (globalThis as any).__hypercombBeeDeps = newManifest.beeDeps
      localStorage.setItem(MANIFEST_KEY, JSON.stringify(newManifest))
    }
    console.warn('[meadowverse:install] install incomplete — will resume on next load')
  }
}

// ----- helpers -----

// Replication io wiring — kind-specific placement and drain-window fallbacks
// belong here, never in the walker.

/** Probe the given dirs (pool + legacy drain sources) for any name shape;
 *  return the bytes so the walker can re-verify them against the sig. */
const readFrom = (
  dirs: (FileSystemDirectoryHandle | undefined)[],
  names: (sig: string) => string[],
) => async (sig: string): Promise<Uint8Array<ArrayBuffer> | null> => {
  for (const dir of dirs) {
    if (!dir) continue
    for (const name of names(sig)) {
      try {
        const file = await (await dir.getFileHandle(name)).getFile()
        return new Uint8Array(await file.arrayBuffer()) as Uint8Array<ArrayBuffer>
      } catch { /* next shape */ }
    }
  }
  return null
}

/** Fetch the first URL that answers with non-HTML bytes (SPA fallback guard:
 *  an extension-less /<sig> on a dev-server origin returns index.html 200;
 *  sig-addressed bytes are never text/html). Flat URL first, legacy typed
 *  URL shape as the unmigrated-host fallback. */
const fetchFrom = (urls: (sig: string) => string[]) =>
  async (sig: string): Promise<Uint8Array<ArrayBuffer> | null> => {
    for (const url of urls(sig)) {
      try {
        const res = await fetch(url)
        if (!res.ok) continue
        if ((res.headers.get('content-type') || '').toLowerCase().includes('text/html')) continue
        return new Uint8Array(await res.arrayBuffer()) as Uint8Array<ArrayBuffer>
      } catch { /* next source */ }
    }
    return null
  }

/** Admit verified bytes at their kind's location. */
const writeTo = (dir: FileSystemDirectoryHandle, name: (sig: string) => string) =>
  async (sig: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> => {
    const handle = await dir.getFileHandle(name(sig), { create: true })
    const writable = await handle.createWritable()
    await writable.write(bytes)
    await writable.close()
  }

const needsInstall = async (
  store: Store,
  signature: string,
  liveManifest: InstallManifest | null,
): Promise<boolean> => {
  const installed = (localStorage.getItem(INSTALLED_KEY) ?? '').trim().toLowerCase()
  if (installed !== signature) return true

  // Presence probes UNION each pool with its legacy drain dir — during the
  // drain window a half-absorbed pool must not read as "nothing installed".
  const hasBees = await hasAny(store.bees, store.legacyBees)
  const hasDeps = await hasAny(store.dependencies, store.legacyDependencies)
  // Layers live flat at the OPFS root now, so "is the dir non-empty" is
  // meaningless there (the root also holds pools and other sig files, and
  // a drained-away `__layers__` must not read as genesis). Genesis is
  // re-keyed on the root LAYER SIG itself: present ⇒ installed.
  const hasRootLayer = await presentIn(
    [store.hypercombRoot, store.layers],
    [signature, `${signature}.json`],
  )
  if (!(hasBees && hasDeps && hasRootLayer)) return true

  // CRITICAL: also verify every dep + bee + layer sig referenced by the
  // LIVE manifest exists in OPFS. A previous build-cache bug (or
  // mid-build interruption) could leave OPFS with a stale dep set even
  // though the rootSig matches. We use the live manifest (not the
  // localStorage cache) so that any beeDeps fixed mid-rebuild forces a
  // re-install when the new dep file isn't in OPFS.
  if (!liveManifest) return false  // offline — trust whatever's in OPFS
  if (!(await allPresent([store.bees, store.legacyBees], liveManifest.bees))) return true
  if (!(await allPresent([store.dependencies, store.legacyDependencies], liveManifest.dependencies))) return true
  if (!(await allPresent([store.hypercombRoot, store.layers], liveManifest.layers))) return true
  return false
}

// Name shapes vary across eras: pools/flat root hold bare `<sig>` while the
// legacy dirs (and some installer writes) used `<sig>.js` / `<sig>.json`.
// Every probe dual-checks all shapes so a shape flip never reads as absence.
const NAME_SHAPES = ['', '.js', '.json']

const probe = async (dir: FileSystemDirectoryHandle, names: string[]): Promise<boolean> => {
  for (const name of names) {
    try { await dir.getFileHandle(name); return true } catch { /* next shape */ }
  }
  return false
}

const presentIn = async (
  dirs: (FileSystemDirectoryHandle | undefined)[],
  names: string[],
): Promise<boolean> => {
  for (const dir of dirs) {
    if (dir && await probe(dir, names)) return true
  }
  return false
}

const allPresent = async (
  dirs: (FileSystemDirectoryHandle | undefined)[],
  sigs: string[],
): Promise<boolean> => {
  for (const sig of sigs) {
    if (!(await presentIn(dirs, NAME_SHAPES.map(ext => `${sig}${ext}`)))) return false
  }
  return true
}

// TS's DOM lib still lacks the async-iterator members on
// FileSystemDirectoryHandle — same duck-type cast Store uses.
const dirEntries = (dir: FileSystemDirectoryHandle): AsyncIterable<[string, FileSystemHandle]> =>
  (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()

const hasAny = async (...dirs: (FileSystemDirectoryHandle | undefined)[]): Promise<boolean> => {
  for (const dir of dirs) {
    if (!dir) continue
    for await (const _ of dirEntries(dir)) return true
  }
  return false
}

// Install-cache wipe — pools and legacy drain dirs only; callers must never
// hand this the flat root.
const clearDirectories = async (...dirs: (FileSystemDirectoryHandle | undefined)[]): Promise<void> => {
  for (const dir of dirs) {
    if (!dir) continue
    for await (const [name] of dirEntries(dir)) {
      try { await dir.removeEntry(name, { recursive: true }) } catch { /* skip */ }
    }
  }
}

const resolveSignatureFromUrl = (): string | null => {
  const params = new URLSearchParams(window.location.search)
  return extractSignature(params.get('content'))
}

const resolveLatestSignature = async (): Promise<string | null> => {
  const local = await fetchJson(`${CONTENT_BASE_URL}/manifest.json`)
  if (local) return extractRootFromManifest(local)
  if (isLocalDev) {
    console.log('[meadowverse:install] local manifest.json not found, falling back to server')
    const remote = await fetchJson(`${AZURE_CONTENT_URL}/manifest.json`)
    return remote ? extractRootFromManifest(remote) : null
  }
  return null
}

const extractRootFromManifest = (content: any): string | null => {
  const sigs = Object.keys(content?.packages ?? {})
  return extractSignature(sigs[0])
}

const fetchJson = async (url: string): Promise<Record<string, unknown> | null> => {
  try {
    const r = await fetch(url, { cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch { return null }
}

const extractSignature = (raw: string | null | undefined): string | null => {
  const text = (raw ?? '').replace(/﻿/g, '').trim()
  if (!text) return null
  const fromPath = text.split('/').filter(Boolean).at(-1) ?? text
  const clean = fromPath.replace(/\.json$/i, '').replace(/\.txt$/i, '')
  return SIGNATURE_REGEX.test(clean) ? clean.toLowerCase() : null
}

const resolveContentBase = async (signature: string): Promise<string> => {
  if (!isLocalDev) return AZURE_CONTENT_URL
  const localManifest = await fetchJson(`${CONTENT_BASE_URL}/manifest.json`)
  if (localManifest?.packages && (localManifest.packages as Record<string, unknown>)[signature]) return CONTENT_BASE_URL
  console.log('[meadowverse:install] content not found locally, using server')
  return AZURE_CONTENT_URL
}

const fetchManifest = async (contentBase: string, signature: string): Promise<InstallManifest | null> => {
  const content = await fetchJson(`${contentBase}/manifest.json`)
  if (!content?.packages) return null
  const pkg = (content.packages as Record<string, unknown>)[signature]
  return pkg ? tryParseManifest(JSON.stringify(pkg)) : null
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
    }
  } catch {
    return null
  }
}

// Removes sigs dropped between manifests from the given install-cache dirs
// (pool + legacy drain dir). Tries every name shape; absent entries no-op.
const removeStale = async (
  dirs: (FileSystemDirectoryHandle | undefined)[],
  oldSigs: string[],
  newSigs: string[],
): Promise<void> => {
  const keep = new Set(newSigs)
  for (const sig of oldSigs) {
    if (keep.has(sig)) continue
    for (const dir of dirs) {
      if (!dir) continue
      for (const ext of NAME_SHAPES) {
        try { await dir.removeEntry(`${sig}${ext}`) } catch { /* already gone */ }
      }
    }
  }
}

const populateSignatureStore = async (sigStore: SignatureStore, contentBase: string, rootSig: string): Promise<void> => {
  try {
    const res = await fetch(`${contentBase}/manifest.json`)
    if (!res.ok) return
    const content = await res.json()
    const manifest = content?.packages?.[rootSig]
    if (!manifest) return

    const allSigs = [
      ...(manifest.layers || []),
      ...(manifest.bees || []),
      ...(manifest.dependencies || []),
    ].filter(Boolean)

    sigStore.trustAll(allSigs)
    sigStore.trust(rootSig)

    localStorage.setItem(SIG_STORE_KEY, JSON.stringify(sigStore.toJSON()))
    console.log(`[meadowverse:install] signature store populated: ${sigStore.size} trusted sigs`)
  } catch {
    // non-fatal
  }
}

const restoreSignatureStore = (sigStore: SignatureStore): void => {
  try {
    const raw = localStorage.getItem(SIG_STORE_KEY)
    if (!raw) return
    sigStore.restore(JSON.parse(raw))
    console.log(`[meadowverse:install] signature store restored: ${sigStore.size} trusted sigs`)
  } catch {
    // non-fatal
  }
}
