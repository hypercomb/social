// hypercomb-runtime/src/acquire.ts
//
// ACQUISITION. What a host offers, and how one of its packages becomes yours.
//
// The whole of it is: ask a domain what it publishes, then resolve one
// package's declared inventory into the local heap, sha256-verifying every
// atom against its own name before admission. Present atoms are reused, so a
// repeat call is an idempotent delta repair, and a package is runnable only
// when its inventory resolves with no holes and nothing refused —
// complete-or-absent (documentation/install-by-replication.md).
//
// The walk itself is NOT written here. `resolveInventory` already
// IS the protocol, and it is deliberately kind-blind: it knows nothing about
// pools, `.js` suffixes or URL shapes. Everything kind-shaped lives in the io
// wiring below, which is where it belongs and where it stays.
//
// WHAT THIS DOES NOT DECIDE — stated rather than implied, because it is the
// line between the two halves of admission: the pool a domain serves is NOT
// signed. Every atom is verified, so a hostile or hijacked host cannot serve
// you wrong bytes — but it CAN offer you a different tree and call it
// current. Binding "current" to a publisher identity is the signed sentinel,
// and `installPackage` asks it FIRST (activation-authority.ts): a package no
// publisher the participant follows has signed is refused by name before a
// byte is fetched. Adding a domain makes it a byte source and a door — never
// an authority.

// MOVED HERE FROM THE SHIM (2026-08-31). It began shim-side because the shim
// is the cold-boot shell and acquisition is the first thing it does — but the
// WEB SHELL needs the identical call for the identical reason, and it cannot
// import the shim. Nothing about it was ever shim-specific: it reaches the
// Store through IoC and touches only `window` and `location`. So it lives in
// runtime, both shells import it, and there is ONE acquisition rather than a
// second one that drifts.
//
// NARROW IMPORTS, NOT THE BARREL. `@hypercomb/shared/core` re-exports
// Angular-flavoured modules, so one barrel import pulls @angular/core into the
// bundle — 120 modules instead of 43, and a shim that cannot boot (the
// directives use standard field decorators and throw "not supported in JIT
// mode" without the AOT compiler). The build's `✓ framework-free` check caught
// exactly this; keep every import here module-specific.
// `@hypercomb/core` is EXTERNAL — the import map resolves it to the runtime
// the shim already loaded, so this bundle shares its instances rather than
// minting a second set.
import { INSTALL_IOC_KEY, MARKER_NAME, askUntried, hardDeleteVetoFor, holdArrivals, mayRunBee, registerPoolMeaning, SignatureService, SignatureStore, type ArrivalKind, type EggProbe, type InstallProvider } from '@hypercomb/core'
// These two are PURE — stateless functions over bytes, no IoC registration, no
// module state — which is the entire reason they may be bundled in here. The
// walker IS the protocol; only the io wiring below is ours.
import { isComplete, resolveInventory, resolveSignatureClosure, type ReplicationIo, type ReplicationResult } from './replication-walker.js'
import { headPackage, hostBases, listHostPackages, type HostPackage } from './host-packages.js'
// The live-package stamp lives in installed-package.ts so the web shell's bundled
// install can leave the SAME mark — one key, one reader, one answer to "which
// build am I on". Re-exported so existing callers keep their import site.
import { installedPackageSig, stampInstalledPackage } from './installed-package.js'
// The second half of admission: may this tree run HERE. Asked before a byte
// moves — see the file for the three doors (self, genesis, attested).
import { activationAuthority, registeredAttester } from './activation-authority.js'
import { hostZone } from './host-zones.js'
export { installedPackageSig }

// Re-exported so the shim's own callers keep one import site. The
// IMPLEMENTATION moved to runtime (the app needs the same answer and cannot
// import the shim); nothing about the shape changed.
export { headPackage, hostBases, listHostPackages, type HostPackage }
import { validateSealedPackage } from './sealed-package.js'
import { deriveBeeDeps } from './bee-deps.js'
import { TRANSFER_PACKS_MEANING, decodeTransferPack, gunzipBytes } from './transfer-pack.js'
import { checkCoreCompatibility, describeCoreMismatch } from './core-surface.js'
import { aliasOf, bagEntryName, bagSignature, beeEntries, dependencyEntries, orderedEntries } from './bags.js'
// WHICH PARTS OF THE TREE RUN. The trunk with the participant's picks laid
// over it, minus the paths they turned off (package-tree.ts).
import { changedUnits, dependencyUnits, packageUnits, readOffUnits, writeOffUnits } from './package-units.js'
import {
  composeDependencies, enabledBees, isPath, layerAt, missingNamespaces, movedPaths, namespaceOf, orderRevisions,
  readPicks, sigsOf, walkTree, withAncestors, within, writePicks, type Picks, type RevisionSource,
} from './package-tree.js'

// Store is reached STRUCTURALLY, never imported. Importing the module would
// bundle a second Store class AND run its module-scope
// `register('@hypercomb.social/Store', new Store())` — a second instance over
// the same OPFS, which is the one thing a packed/flat store must never have.
// The shim already registered the real one; this is the shape we need of it.
type StoreLike = {
  initialize(): Promise<void>
  readonly opfsAvailable: boolean
  readonly hypercombRoot?: FileSystemDirectoryHandle
  readonly bees: FileSystemDirectoryHandle
  readonly dependencies: FileSystemDirectoryHandle
}

const STORE_KEY = '@hypercomb.social/Store'

/** Pool addresses are DERIVED, never hardcoded — `sign(meaning)` through the
 *  registry, so addressing a pool also registers its meaning. Both meanings
 *  below are in core's frozen bare-word set. */
const BEES_MEANING = 'bees'
const DEPENDENCIES_MEANING = 'dependencies'

const SIG_RE = /^[a-f0-9]{64}$/

export type InstallOutcome = {
  ok: boolean
  packageSig: string
  fetched: number
  present: number
  holes: string[]
  refused: string[]
  error?: string
  /** Files that arrived inside a transfer pack rather than one by one. */
  packed?: number
}

/** This origin's content bases — a byte source only through {@link originAmong}. */
export const selfBases = (): string[] => [`${location.origin}/content`, location.origin]

/** Is this origin one of the domains asked? Only then is it a byte source: a
 *  node serving its own content carries itself, and a shell that is not a host
 *  (hypercomb.io) never serves a byte (documentation/packages-window.md). */
export const originAmong = (zones: readonly string[]): boolean => {
  const self = hostZone(location.host)
  return !!self && zones.some(zone => hostZone(zone) === self)
}

// What one host said about one signature. A 404/410, or an HTML page where
// sig-addressed bytes belong (the SPA fallback), is a definite "not here" and
// lays an egg (core/eggs.ts); a network error or any other status is the host
// being unreachable and records nothing.
const probeBytes = async (url: string, onThrow?: () => void): Promise<EggProbe<Uint8Array<ArrayBuffer>>> => {
  try {
    // Default cache mode, NOT 'no-store': every URL through here is
    // sig-addressed immutable content, so the HTTP cache is free bandwidth.
    const res = await fetch(url)
    if (res.status === 404 || res.status === 410) return 'absent'
    if (!res.ok) return 'unreachable'
    // SPA fallback guard: an extension-less flat `/<sig>` on a dev-server
    // origin answers index.html with 200. Sig-addressed bytes are never
    // text/html. The sha256 check is the real gate; this only saves the
    // pointless hash of a 404 page.
    if ((res.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) return 'absent'
    return new Uint8Array(await res.arrayBuffer()) as Uint8Array<ArrayBuffer>
  } catch { onThrow?.(); return 'unreachable' }
}

/**
 * Fetch a signature from the first of `origins` that holds it, never asking
 * again a host that already said it does not (core/eggs.ts).
 *
 * A base whose fetch THROWS is not answering this client at all — the network
 * is down, or the answer carried no CORS header (the Azure apex's 404 page
 * does not, so every miss there is a thrown TypeError, not a 404). Asking it
 * again for the next atom can only throw again, so it goes silent for the
 * rest of THIS walk. Nothing durable is recorded: a thrown fetch says nothing
 * about the bytes, and the next walk asks the base afresh. A 5xx or other
 * status stays a per-atom 'unreachable' — that host did answer.
 */
export const fetchAcross = (origins: readonly string[]) => {
  const silent = new Set<string>()
  return (sig: string): Promise<Uint8Array<ArrayBuffer> | null> =>
    askUntried(sig, origins.filter(base => !silent.has(base)), base =>
      probeBytes(`${base}/${sig}`, () => silent.add(base)))
}

/** THE TRANSFER PACK, when it pays (transfer-pack.ts). A package mostly
 *  missing here arrives as one pack instead of file by file; an update that
 *  changes a handful of files does not — a whole pack for a few files would
 *  move more than it saves. Every member is hashed against its own name as it
 *  is unpacked, and the walker hashes it again at admission; a member that
 *  fails, and anything the pack does not carry, is fetched loose.
 *
 *  A HINT, SO IT CAN NEVER COST AN INSTALL. Every failure here — a throw, a
 *  host that hangs, bytes that are not a pack, a pack that inflates without
 *  end, a pack for some other tree — ends in loose fetching. Downloads are
 *  capped in time and size, the unzip is capped in size, and a pack that
 *  covers less than half of what is missing is passed over for the next
 *  origin's. */
const PACK_MIN_MISSING = 32
const POINTER_MAX_BYTES = 1024
const POINTER_TIMEOUT_MS = 5_000
const PACK_MAX_BYTES = 64 * 1024 * 1024
const PACK_TIMEOUT_MS = 60_000
const PACK_MAX_UNPACKED = 256 * 1024 * 1024

/** One GET with a deadline and a size cap; null for anything but bytes. */
const cappedBytes = async (url: string, maxBytes: number, timeoutMs: number): Promise<Uint8Array<ArrayBuffer> | null> => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok || !res.body) return null
    // The SPA fallback answers any path with a page; sig-addressed bytes are never html.
    if ((res.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) return null
    if (Number(res.headers.get('content-length') ?? 0) > maxBytes) return null
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) { await reader.cancel(); return null }
      chunks.push(value)
    }
    const out = new Uint8Array(total)
    let at = 0
    for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength }
    return out
  } catch {
    return null
  }
}

export const packedFetch = async (
  root: string,
  /** What the install needs, or null before the layers are known (a cold
   *  hive): then the size test is skipped and every verified member is kept. */
  wanted: readonly string[] | null,
  held: ReadonlySet<string>,
  origins: readonly string[],
  loose: (sig: string) => Promise<Uint8Array<ArrayBuffer> | null>,
): Promise<{ fetch: (sig: string) => Promise<Uint8Array<ArrayBuffer> | null>; served: () => number }> => {
  let served = 0
  const plain = { fetch: loose, served: () => served }
  try {
    const missing = wanted ? new Set(wanted.filter(sig => !held.has(sig))) : null
    if (missing && (missing.size < PACK_MIN_MISSING || missing.size * 2 < wanted!.length)) return plain
    const pool = await registerPoolMeaning(TRANSFER_PACKS_MEANING)
    for (const base of origins) {
      const pointer = await cappedBytes(`${base}/${pool}/${root}`, POINTER_MAX_BYTES, POINTER_TIMEOUT_MS)
      const packSig = pointer ? new TextDecoder().decode(pointer).trim() : ''
      if (!SIG_RE.test(packSig)) continue
      const packed = await cappedBytes(`${base}/${packSig}`, PACK_MAX_BYTES, PACK_TIMEOUT_MS)
      if (!packed || (await SignatureService.sign(packed.buffer)) !== packSig) continue
      let members: Array<[string, Uint8Array<ArrayBuffer>]> | null
      try { members = decodeTransferPack(await gunzipBytes(packed, PACK_MAX_UNPACKED)) } catch { members = null }
      if (!members) continue
      // Only what this install is missing is kept, and only after it hashes.
      const verified = new Map<string, Uint8Array<ArrayBuffer>>()
      await Promise.all(members.filter(([sig]) => !missing || missing.has(sig)).map(async ([sig, bytes]) => {
        if ((await SignatureService.sign(bytes.buffer)) === sig) verified.set(sig, bytes)
      }))
      console.log(`[acquire] transfer pack ${packSig.slice(0, 12)}: ${verified.size} ${missing ? `of ${missing.size} missing files` : 'files'} carried`)
      if (missing ? verified.size * 2 < missing.size : !verified.size) continue
      return {
        fetch: async sig => {
          const hit = verified.get(sig)
          if (!hit) return loose(sig)
          verified.delete(sig)
          served++
          return hit
        },
        served: () => served,
      }
    }
  } catch (error) {
    console.warn('[acquire] transfer pack skipped — installing file by file:', error)
  }
  return plain
}

/** The bare signatures a module pool holds (`<sig>.js` or `<sig>`). */
const heldIn = async (dir: FileSystemDirectoryHandle | undefined): Promise<string[]> => {
  const names: string[] = []
  if (!dir) return names
  try {
    for await (const [name] of dir.entries()) names.push(name.replace(/\.js$/i, ''))
  } catch { /* an unreadable pool holds nothing we can count on */ }
  return names
}

const writeBytes = async (dir: FileSystemDirectoryHandle, name: string, bytes: ArrayBuffer): Promise<void> => {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  try { await writable.write(bytes) } finally { await writable.close() }
}

/** Seed the service worker's cache so the first module import does not make a
 *  second round trip for bytes already in hand. Best-effort. */
const seedCache = async (path: string, bytes: ArrayBuffer, contentType: string): Promise<void> => {
  try {
    const cache = await caches.open('hypercomb-modules-v2')
    const url = new URL(path, location.origin).toString()
    if (await cache.match(url)) return
    const headers = new Headers({ 'content-type': contentType, 'cache-control': 'no-store' })
    await cache.put(url, new Response(bytes, { headers }))
  } catch { /* non-fatal */ }
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

const writeTo = (
  dir: FileSystemDirectoryHandle | undefined,
  nameFor: (sig: string) => string,
  cacheUrlFor: (sig: string) => string,
  contentType: string,
) => async (sig: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> => {
  if (!dir) throw new Error(`[replicate] no destination for ${sig.slice(0, 12)}`)
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  await writeBytes(dir, nameFor(sig), buffer)
  await seedCache(cacheUrlFor(sig), buffer, contentType)
}

const merge = (root: string, parts: ReplicationResult[]): ReplicationResult =>
  parts.reduce<ReplicationResult>((acc, r) => ({
    root,
    total: acc.total + r.total,
    present: acc.present + r.present,
    fetched: acc.fetched + r.fetched,
    held: [...acc.held, ...r.held],
    holes: [...acc.holes, ...r.holes],
    refused: [...acc.refused, ...r.refused],
    limited: acc.limited || r.limited,
  }), { root, total: 0, present: 0, fetched: 0, held: [], holes: [], refused: [], limited: false })

/** The three sets an install resolves — layers, bees, dependencies. Derived
 *  from the sealed root every time; never taken from what a host asserted. */
export type PackageInventory = {
  layers: string[]
  bees: string[]
  dependencies: string[]
}

/** Records name atoms with the suffix the WRITER used (`<sig>.js` inside a
 *  layer, bare on the wire). Identity is the signature, so the suffix is
 *  folded out before anything compares or fetches. */
const bare = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase().replace(/\.(?:js|json)$/, '')

/** A layer names its child layers in `cells` — that, and only that, is the
 *  frontier of the layer walk. The `bees` and `dependencies` a layer declares
 *  are INVENTORY, not frontier: they are leaves here and resolve into their
 *  own pools afterwards. A record that will not parse is a leaf too. */
const childLayers = (bytes: Uint8Array<ArrayBuffer>): string[] => {
  try {
    const record = JSON.parse(new TextDecoder().decode(bytes)) as { cells?: unknown[] }
    return (record?.cells ?? [])
      .map(cell => bare(typeof cell === 'string' ? cell : (cell as { sig?: unknown })?.sig))
      .filter(sig => SIG_RE.test(sig))
  } catch { return [] }
}

/**
 * THE INVENTORY, READ OUT OF THE SIGNED TREE.
 *
 * Walk the layer closure from the package root (`cells`, structurally — not
 * by mining every 64-hex literal, which would sweep bees and deps into the
 * layer pool), then union what those layers themselves declare: `bees` and
 * `dependencies`. Every layer is admitted through the same verify-before-write
 * boundary as any other atom, so the sets come out of bytes that hashed to
 * their own names.
 *
 * Measured against the full published chain (176 packages, 2026-09-01): the
 * derived sets match the manifest's arrays exactly, every generation. The
 * arrays were always a copy — this reads the original instead.
 */
export const deriveInventory = async (
  rootSig: string,
  io: ReplicationIo,
): Promise<{ inventory: PackageInventory; result: ReplicationResult }> => {
  const result = await resolveSignatureClosure(rootSig, io, { children: childLayers })
  const bees = new Set<string>()
  const dependencies = new Set<string>()

  for (const sig of result.held) {
    const bytes = await io.read(sig)
    if (!bytes) continue
    let record: { bees?: unknown[]; dependencies?: unknown[] }
    try { record = JSON.parse(new TextDecoder().decode(bytes)) as typeof record } catch { continue }
    for (const bee of record?.bees ?? []) {
      const value = bare(typeof bee === 'string' ? bee : (bee as { sig?: unknown })?.sig)
      if (SIG_RE.test(value)) bees.add(value)
    }
    for (const dep of record?.dependencies ?? []) {
      const value = bare(typeof dep === 'string' ? dep : (dep as { sig?: unknown })?.sig)
      if (SIG_RE.test(value)) dependencies.add(value)
    }
  }

  return {
    inventory: {
      layers: [...result.held],
      bees: [...bees].sort(),
      dependencies: [...dependencies].sort(),
    },
    result,
  }
}

/** What the host CLAIMED, against what its own signed layers say. Never fatal
 *  — the derived set is simply the one that installs — but said out loud,
 *  because a host whose manifest names atoms its layers do not is either
 *  stale or trying. */
export const reportDivergence = (
  source: string,
  claimed: { layers?: string[]; bees?: string[]; dependencies?: string[] },
  inventory: PackageInventory,
): void => {
  // A source that asserts NOTHING is not diverging — it is the projection,
  // which carries no inventory by design. Only a host still shipping arrays
  // can disagree with its own layers.
  const asserts = (claimed.layers?.length ?? 0) + (claimed.bees?.length ?? 0) + (claimed.dependencies?.length ?? 0)
  if (!asserts) return

  const kinds: [string, string[], string[]][] = [
    ['layers', claimed.layers ?? [], inventory.layers],
    ['bees', claimed.bees ?? [], inventory.bees],
    ['dependencies', claimed.dependencies ?? [], inventory.dependencies],
  ]
  for (const [kind, asserted, derived] of kinds) {
    const held = new Set(derived)
    const extra = [...new Set(asserted.map(bare))].filter(sig => SIG_RE.test(sig) && !held.has(sig))
    const missing = derived.filter(sig => !asserted.some(c => bare(c) === sig))
    if (!extra.length && !missing.length) continue
    console.warn(
      `[acquire] ${source} declares a ${kind} set its layers do not:`,
      `${extra.length} not in the signed tree (ignored), ${missing.length} it failed to declare (installed anyway)`,
    )
  }
}

/**
 * The host row for a zone that SERVES a root's file, or null. Asked only for
 * a root no carried pool lists. The bytes must hash to the name: a host that
 * answers every path with its page (an SPA fallback) is not a holder.
 */
export const rootHolder = async (
  zone: string,
  packageSig: string,
  get: (url: string) => Promise<ArrayBuffer | null> = async url => {
    const res = await fetch(url, { cache: 'no-store' })
    return res.ok ? res.arrayBuffer() : null
  },
): Promise<HostPackage | null> => {
  for (const base of hostBases(zone)) {
    try {
      const bytes = await get(`${base}/${packageSig}`)
      if (bytes && await SignatureService.sign(bytes) === packageSig) {
        return { zone, base, packageSig, label: packageSig.slice(0, 12), at: '', generation: null, layers: [], bees: [], dependencies: [] }
      }
    } catch { /* this base does not answer; the next may */ }
  }
  return null
}

/**
 * ACQUIRE ONE SIGNATURE FROM THE DOMAINS YOU CARRY.
 *
 * The whole question, in the form it is actually asked: *here is a package
 * signature and here are the domains I know — get it.* Which host answers is
 * not the caller's business, and must not be: a signature names one closure,
 * so every domain publishing it is offering the identical bytes, and picking
 * one of them up front would throw away the others the moment it 404s.
 *
 * So every domain that publishes the signature becomes a byte source for it,
 * and the walk draws from all of them. This is where "a second host is a COPY,
 * not another door" stops being a slogan: one mirror missing an atom costs a
 * 404 and the next mirror supplies it, instead of an install that cannot
 * complete.
 *
 * A domain that does not publish the signature is simply not a source — it is
 * not an error, and it is not worth reporting. Not carrying the bytes is the
 * ordinary condition of most hosts for most signatures.
 *
 * Returns the same complete-or-absent outcome as {@link installPackage}: holes
 * or refusals mean nothing is marked installed and the next call repairs the
 * delta.
 */
export const acquire = async (
  packageSig: string,
  zones: readonly string[],
  /** `floor`: the shell found the live package below its floor
   *  (activation-authority.ts, FLOOR). Only the shell passes it. */
  opts: { floor?: boolean } = {},
): Promise<InstallOutcome> => {
  const fail = (error: string): InstallOutcome =>
    ({ ok: false, packageSig, fetched: 0, present: 0, holes: [], refused: [], error })

  if (!SIG_RE.test(packageSig)) return fail('not a signature')
  const carried = [...new Set(zones.map(z => String(z ?? '').trim()).filter(Boolean))]
  if (!carried.length) return fail('no domains to ask')

  // Ask every domain at once — they are independent origins and one slow host
  // must not decide how long the others take.
  const answers = await Promise.all(carried.map(async zone => {
    try { return (await listHostPackages(zone)).find(p => p.packageSig === packageSig) ?? null }
    catch { return null }
  }))

  let holders = answers.filter((p): p is HostPackage => p !== null)
  // A NAMED ROOT NEEDS NO LISTING. A host's packages pool is how a package is
  // FOUND; a root a followed publisher's signed pointer already names has
  // been found. A package committed from inside a hive (module commit) is
  // uploaded file by file to a host that serves signatures but whose pool the
  // browser cannot append to, so its holders are the hosts that serve its
  // root. Nothing is trusted more for it: the authority gate still decides
  // whether it may run, and every file is checked against its own name.
  if (!holders.length) holders = (await Promise.all(carried.map(zone => rootHolder(zone, packageSig)))).filter((p): p is HostPackage => p !== null)
  if (!holders.length) return fail(`no carried domain publishes ${packageSig.slice(0, 12)}…`)

  // The record is the SEAL and every holder declares the same one for the same
  // signature — installPackage re-validates it, so taking the first is safe.
  // The rest are byte sources.
  const [first, ...rest] = holders
  return installPackage(first!, rest.map(p => p.zone), opts)
}

/**
 * Make one package yours. Sealed first, then resolved, then gated:
 *
 *   1. SEAL — the record must declare its own root and close `beeDeps` over
 *      the declared sets. Nothing outside the record is ever a candidate.
 *   2. RESOLVE — three exact inventories (no mining, no recursion). Every
 *      fetched atom is sha256-verified before write; present atoms are reused.
 *   3. GATE — complete-or-absent. Holes or refusals mean nothing is marked
 *      installed, and the next attempt repairs the delta rather than starting
 *      over.
 */
export const installPackage = async (
  pkg: HostPackage,
  /** Extra domains to pull the SAME signature from. Every carried host that
   *  publishes it is a byte source for it — see {@link acquire}. */
  alsoFrom: readonly string[] = [],
  opts: { floor?: boolean } = {},
): Promise<InstallOutcome> => {
  const fail = (error: string): InstallOutcome =>
    ({ ok: false, packageSig: pkg.packageSig, fetched: 0, present: 0, holes: [], refused: [], error })

  // MAY IT RUN HERE? Integrity below proves the bytes; this proves the
  // publisher, and it is settled before the store is even opened. A refusal
  // is complete-or-absent like every other: nothing fetched, nothing stamped,
  // and the sentence says what to do instead (activation-authority.ts).
  const authority = await activationAuthority({
    packageSig: pkg.packageSig,
    zone: pkg.zone,
    self: location.host,
    installed: installedPackageSig(),
    zones: alsoFrom,
    attester: registeredAttester(),
    floor: opts.floor === true,
  })
  if (!authority.ok) return fail(authority.error)

  const store = window.ioc?.get?.<StoreLike>(STORE_KEY)
  if (!store) return fail('store unavailable')
  await store.initialize()
  if (!store.opfsAvailable) return fail('OPFS unavailable')

  // BYTE SOURCES: the host that offered it, then every other domain that
  // publishes the same signature, then this origin — only when it is itself
  // one of the domains asked. A shell is not a host.
  //
  // A signature names one closure, so any host holding it holds the SAME
  // bytes — which is what makes a second domain a COPY rather than another
  // door, and what turns one host's missing atom into a 404 that costs
  // nothing instead of an install that cannot complete.
  //
  // Order is a bandwidth preference and nothing more. Every fetched atom is
  // sha256-verified against its own name before admission, so a wrong or
  // hostile source costs a 404, never a wrong byte — which is precisely why
  // widening this list needs no trust argument at all.
  const origins = [...new Set([
    pkg.base,
    ...alsoFrom.flatMap(zone => hostBases(zone)),
    ...(originAmong([pkg.zone, ...alsoFrom]) ? selfBases() : []),
  ])]
  const fetchFrom = fetchAcross(origins)

  const beesUrlBase = `/opfs/${await registerPoolMeaning(BEES_MEANING)}`
  const depsUrlBase = `/opfs/${await registerPoolMeaning(DEPENDENCIES_MEANING)}`

  // A HIVE THAT HOLDS ALMOST NOTHING — a sandbox door's first visit — takes
  // the layers from the transfer pack too (packedFetch), so the whole install
  // is a handful of requests. Everyone else walks the layers loose and asks
  // for a pack only once the inventory says most of it is missing.
  const heldModules = new Set([...await heldIn(store.dependencies), ...await heldIn(store.bees)])
  const early = heldModules.size < PACK_MIN_MISSING
    ? await packedFetch(pkg.packageSig, null, heldModules, origins, fetchFrom)
    : null

  const layersIo = {
    read: readFrom([store.hypercombRoot], sig => [sig, `${sig}.json`]),
    fetch: early?.fetch ?? fetchFrom,
    write: writeTo(store.hypercombRoot, sig => sig, sig => `/opfs/${sig}`, 'application/json; charset=utf-8'),
  } satisfies ReplicationIo

  // DERIVE, THEN SEAL. The inventory is read out of the layer closure the
  // package root names — never out of the arrays the host handed us. Those
  // arrays are a COPY of what the layers already state, and the copy is the
  // one link in the chain nothing verifies: a host that shortens or pads the
  // bee list is choosing which modules `activate()` will run. Walking the
  // signed tree removes the choice (documentation/host-packages-pool.md).
  const { inventory, result: layerResult } = await deriveInventory(pkg.packageSig, layersIo)
  if (!isComplete(layerResult)) {
    return {
      ok: false,
      packageSig: pkg.packageSig,
      fetched: layerResult.fetched,
      present: layerResult.present,
      holes: layerResult.holes,
      refused: layerResult.refused,
      error: layerResult.refused.length
        ? `${layerResult.refused.length} layer(s) refused — served bytes did not hash to their name`
        : `${layerResult.holes.length} layer(s) unreachable — the root's closure has holes`,
    }
  }

  // The seal is about the sets ABOUT TO RESOLVE, so it is checked against the
  // derived inventory alone. `beeDeps` is no longer part of it: it is derived
  // from the admitted bytes further down, and a hint cannot seal anything.
  const sealed = validateSealedPackage(pkg.packageSig, inventory)
  if (!sealed.valid) return fail(`package is not sealed: ${sealed.errors.join('; ')}`)

  reportDivergence(pkg.zone, pkg, inventory)

  // A package mostly missing here comes as one transfer pack (packedFetch).
  const modules = early ?? await packedFetch(pkg.packageSig, [...inventory.dependencies, ...inventory.bees], heldModules, origins, fetchFrom)

  const results = await Promise.all([
    resolveInventory(pkg.packageSig, inventory.dependencies, {
      read: readFrom([store.dependencies], sig => [`${sig}.js`, sig]),
      fetch: modules.fetch,
      write: writeTo(store.dependencies, sig => `${sig}.js`, sig => `${depsUrlBase}/${sig}`, 'application/javascript; charset=utf-8'),
    } satisfies ReplicationIo),
    resolveInventory(pkg.packageSig, inventory.bees, {
      read: readFrom([store.bees], sig => [`${sig}.js`, sig]),
      fetch: modules.fetch,
      write: writeTo(store.bees, sig => `${sig}.js`, sig => `${beesUrlBase}/${sig}.js`, 'application/javascript; charset=utf-8'),
    } satisfies ReplicationIo),
  ])

  const held = merge(pkg.packageSig, [layerResult, ...results])
  if (!isComplete(held)) {
    return {
      ok: false,
      packageSig: pkg.packageSig,
      fetched: held.fetched,
      present: held.present,
      holes: held.holes,
      refused: held.refused,
      error: held.refused.length
        ? `${held.refused.length} atom(s) refused — served bytes did not hash to their name`
        : `${held.holes.length} atom(s) unreachable`,
    }
  }

  // PICKS RIDE ACROSS A TRUNK MOVE. What the participant took at a path stays
  // taken on the new trunk, so the selection is composed over what is now
  // held — and passes every gate below again, over the composed set.
  if (Object.keys(readPicks()).length) {
    const selection = await applySelection(pkg.packageSig, held.held)
    if (!selection.ok) return fail(selection.error)
    return { ok: true, packageSig: pkg.packageSig, fetched: held.fetched, present: held.present, holes: [], refused: [], packed: modules.served() }
  }

  // CAN THIS SHELL RUN IT? (core-surface.ts). The modules just admitted name
  // what they import from `@hypercomb/core`; the shell's runtime core is asked
  // what it exports. A shell that is short refuses HERE, by name, instead of
  // activating a package whose every module dies at evaluation. The bytes stay
  // — once the shell ships, the same call is a delta repair.
  const readAtom = readFrom([store.bees, store.dependencies], sig => [`${sig}.js`, sig])
  const compat = await checkCoreCompatibility([...inventory.bees, ...inventory.dependencies], readAtom)
  if (!compat.ok) {
    console.warn(`[acquire] ${pkg.packageSig.slice(0, 12)} ${describeCoreMismatch(compat.missing)}`)
    return fail(`package ${describeCoreMismatch(compat.missing)}`)
  }

  // beeDeps, worked out from the bytes just admitted rather than taken from
  // anything a host said (bee-deps.ts). A HINT: an empty map means every
  // dependency loads eagerly, which is correct and merely heavier at boot.
  const beeDeps = await deriveBeeDeps(
    inventory.bees,
    inventory.dependencies,
    readFrom([store.bees, store.dependencies], sig => [`${sig}.js`, sig]),
  )

  // The bags. Each is a sig-named dir INSIDE the pool whose entries carry the
  // alias→sig pairs the import map is assembled from — legitimate structure,
  // not a typed folder.
  await writeBags(store, inventory)

  // THE BROOD (core/brood.ts). Bytes are admitted and verified; nothing has
  // been imported. Anything the participant's rules do not clear is held here,
  // and the loader refuses to read it until a hand — or enough vouches from
  // communities they follow — says otherwise.
  const heldBack = await holdArrivals(inventory.bees, arrivalKindOf(authority.by), {
    zone: pkg.zone,
    packageSig: pkg.packageSig,
    how: 'package install',
  })
  if (heldBack.length) {
    console.warn(`[acquire] ${heldBack.length} bee(s) held in the brood — accept them before they run`)
  }

  await activate(pkg.packageSig, inventory, beeDeps, held.held, await enabledOf(pkg.packageSig, inventory.bees, layersIo))
  return {
    ok: true,
    packageSig: pkg.packageSig,
    fetched: held.fetched,
    present: held.present,
    holes: [],
    refused: [],
    packed: modules.served(),
  }
}

/** The key ScriptPreloader reads to learn which bees to import. Written ONLY
 *  after the complete-or-absent gate passes — an install that did not fully
 *  resolve leaves its admitted bytes in place (so the next attempt is a delta
 *  repair) but never claims the hive is runnable. */
const INSTALL_MANIFEST_KEY = 'core-adapter.installed-manifest'
const SIG_STORE_KEY = 'hypercomb.signature-store'

/**
 * Make the resolved package the LIVE one. Replication put verified bytes in
 * the heap; nothing reads them until this says which package is current — the
 * one place where "held" becomes "running", kept separate for exactly that
 * reason.
 */
/** The io a layer walk uses in this origin: held layers first, then every
 *  domain given (this origin only when it is one of them), each verified
 *  before it is written. */
export const layersIoFor = async (zones: readonly string[]): Promise<ReplicationIo | null> => {
  const store = window.ioc?.get?.<StoreLike>(STORE_KEY)
  if (!store) return null
  await store.initialize()
  if (!store.opfsAvailable) return null
  const origins = [...new Set([...zones.flatMap(zone => hostBases(zone)), ...(originAmong(zones) ? selfBases() : [])])]
  return {
    read: readFrom([store.hypercombRoot], sig => [sig, `${sig}.json`]),
    fetch: fetchAcross(origins),
    write: writeTo(store.hypercombRoot, sig => sig, sig => `/opfs/${sig}`, 'application/json; charset=utf-8'),
  }
}

/** The bees that run from one root with nothing picked: all of them, minus
 *  the paths that are off. A tree that cannot be walked loads whole. */
const enabledOf = async (root: string, bees: string[], layers: ReplicationIo): Promise<string[]> => {
  const off = readOffUnits()
  if (!off.size) return bees
  const walk = await walkTree(root, { ...layers, fetch: async () => null })
  return walk.complete ? enabledBees(walk, off) : bees
}

/**
 * REPOINT THE LIVE SELECTION FROM WHAT IS ALREADY HELD. Turning a package on
 * or off, or dropping a pick, changes which bytes run, not which exist: the
 * trunk and every pick stay in the heap, so this composes them locally and
 * writes the activation record again — no host asked, no byte fetched. False
 * when the held selection does not compose, in which case nothing is changed.
 */
export const applyUnits = async (): Promise<boolean> => {
  const trunk = installedPackageSig()
  return !!trunk && (await applySelection(trunk)).ok
}

export type SelectionOutcome = { ok: true } | { ok: false; error: string }

/**
 * THE SELECTION, COMPOSED AND MADE LIVE. The trunk's tree with the picks laid
 * over it by path; each pick's namespace dependencies from the root it was
 * picked from; the paths that are off left out of what loads. Everything is
 * read from what is held — admission happened before this — and every gate an
 * install passes is passed again over the composed set: complete, runnable by
 * this shell's core, and no picked module importing a namespace the selection
 * does not carry. The picks are written only once all of that holds.
 */
export const applySelection = async (
  trunk: string,
  admitted: readonly string[] = [],
  picks: Picks = readPicks(),
): Promise<SelectionOutcome> => {
  const fail = (error: string): SelectionOutcome => ({ ok: false, error })
  const store = window.ioc?.get?.<StoreLike>(STORE_KEY)
  const io = await layersIoFor([])
  if (!store || !io) return fail('store unavailable')
  const local: ReplicationIo = { ...io, fetch: async () => null }

  // A pick from the trunk itself is no pick: the trunk already names it.
  const live: Picks = Object.fromEntries(Object.entries(picks).filter(([, pick]) => pick.root !== trunk))
  const walk = await walkTree(trunk, local, live)
  if (!walk.complete) return fail('the selection names a layer that is not held here')

  const readModule = readFrom([store.bees, store.dependencies], sig => [`${sig}.js`, sig])
  const readDependency = readFrom([store.dependencies], sig => [`${sig}.js`, sig])
  const namespaces = new Map<string, Promise<string | null>>()
  const readNamespace = (sig: string): Promise<string | null> => {
    let pending = namespaces.get(sig)
    if (!pending) { pending = readDependency(sig).then(bytes => bytes ? namespaceOf(bytes) : null); namespaces.set(sig, pending) }
    return pending
  }

  const sources: { path: string; dependencies: string[] }[] = []
  for (const path of walk.applied) {
    const bytes = await local.read(live[path]!.root)
    let record: { dependencies?: unknown } | null = null
    try { record = bytes ? JSON.parse(new TextDecoder().decode(bytes)) as { dependencies?: unknown } : null } catch { record = null }
    if (!record) return fail(`the root ${path} was picked from is not held here`)
    sources.push({ path, dependencies: sigsOf(record.dependencies) })
  }
  // Only what may run is composed: a picked bundle held in the brood waits,
  // and the trunk's bundle for its namespace keeps running meanwhile.
  const runs = new Map<string, Promise<boolean>>()
  const mayRun = (sig: string): Promise<boolean> => {
    let known = runs.get(sig)
    if (!known) { known = mayRunBee(sig).catch(() => false); runs.set(sig, known) }
    return known
  }
  const dependencies = sources.length
    ? await composeDependencies(walk.rootDependencies, sources, walk.applied, readNamespace, mayRun)
    : walk.rootDependencies
  const bees = [...new Set([...walk.rootBees, ...walk.nodes.flatMap(node => node.bees)])].sort()
  for (const sig of [...bees, ...dependencies]) {
    if (!(await readModule(sig))) return fail(`${sig.slice(0, 12)}… is not held here`)
  }
  const inventory: PackageInventory = { layers: walk.layers, bees, dependencies }
  const off = readOffUnits()
  const enabled = enabledBees(walk, off)
  // Held code is inert: its imports need not resolve and its core surface need
  // not match until it is accepted — then the selection is composed again.
  const runnable = async (sigs: readonly string[]): Promise<string[]> =>
    (await Promise.all(sigs.map(async sig => (await mayRun(sig)) ? sig : null))).filter((sig): sig is string => !!sig)

  // SIDEWAYS. A picked module that imports a namespace the selection does not
  // carry would die at evaluation — refused, by name. Only what the picks
  // introduced is judged: a trunk that already reaches for something it does
  // not ship is the trunk's own business, and was running before this.
  if (sources.length) {
    const provided = async (deps: readonly string[]): Promise<Set<string>> =>
      new Set((await Promise.all(deps.map(readNamespace))).filter((ns): ns is string => !!ns))
    const trunkWalk = await walkTree(trunk, local)
    const before = new Set(await missingNamespaces(
      [...enabledBees(trunkWalk, off), ...walk.rootDependencies], await provided(walk.rootDependencies), readModule))
    const missing = (await missingNamespaces([...await runnable(enabled), ...dependencies], await provided(dependencies), readModule))
      .filter(ns => !before.has(ns))
    if (missing.length) {
      return fail(`this selection needs ${missing.join(', ')}, which nothing picked and nothing on the trunk carries — take ${missing.length === 1 ? 'it' : 'them'} as well`)
    }
  }

  const compat = await checkCoreCompatibility([...await runnable(bees), ...dependencies], readModule)
  if (!compat.ok) return fail(`selection ${describeCoreMismatch(compat.missing)}`)
  const beeDeps = await deriveBeeDeps(bees, dependencies, readModule)
  await writeBags(store, inventory)
  writePicks(live)
  await activate(trunk, inventory, beeDeps, [...admitted, ...walk.layers, ...bees, ...dependencies], enabled)
  return { ok: true }
}

/** Has this shell already trusted a root — it ran here, or was admitted here? */
/**
 * WHICH RULE GOVERNS THIS ARRIVAL (brood-rules.ts). The authority gate has
 * already decided the package MAY run here; this only says under whose name,
 * so the participant's own rules can hold it anyway — "I wrote it, hold it
 * until I have tested it" is the ordinary case.
 *
 * The seed bootstrap (genesis, and the floor) counts as followed, not as your own: it is somebody
 * else's code, trusted once, and a participant who holds followed code should
 * see it too.
 */
const arrivalKindOf = (by: 'self' | 'genesis' | 'attested' | 'floor' | 'hand'): ArrivalKind =>
  by === 'self' ? 'own' : by === 'hand' ? 'stranger' : 'followed'

const trustedHere = (sig: string): boolean => {
  try {
    const store = new SignatureStore()
    const raw = localStorage.getItem(SIG_STORE_KEY)
    if (raw) store.restore(JSON.parse(raw) as { sigs?: string[]; storeSig?: string | null })
    return store.isTrusted(sig)
  } catch { return false }
}

/**
 * TAKE ONE REVISION AT ONE PATH.
 *
 * The pairing is never taken on trust: a candidate root must name that layer
 * at that path. It must also be a root this shell already trusts, or one the
 * authority gate admits — the same three doors as an install — so an older
 * revision is pickable exactly when a publisher you follow once named a root
 * carrying it. Then only what the pick needs is admitted: the branch's layers
 * and bees, and the root's namespace bundles under the path. Nothing becomes
 * live until the selection composes (applySelection).
 *
 * BY HAND (`byHand`): the participant's own pick of a root nothing here
 * vouches for — a community trial — passes the gate's HAND door as a
 * STRANGER's arrival. Every bee and bundle it brings that the trunk does not
 * already run is held in the brood; the root itself is never recorded as
 * trusted, so the next pick from it asks again; and the pick remembers it was
 * made by hand.
 */
export const pickRevision = async (
  path: string,
  revision: { layer: string; root: string; roots?: readonly string[] },
  zones: readonly string[],
  options: { hides?: boolean; byHand?: boolean } = {},
): Promise<InstallOutcome> => {
  let fetched = 0
  let present = 0
  const fail = (error: string): InstallOutcome =>
    ({ ok: false, packageSig: revision.root, fetched, present, holes: [], refused: [], error })

  const trunk = installedPackageSig()
  if (!trunk) return fail('nothing is installed here to pick onto')
  if (!isPath(path) || !SIG_RE.test(revision.layer)) return fail('not a revision')
  const store = window.ioc?.get?.<StoreLike>(STORE_KEY)
  const carried = [...new Set(zones.map(zone => String(zone ?? '').trim()).filter(Boolean))]
  const io = await layersIoFor(carried)
  if (!store || !io) return fail('store unavailable')

  let root = ''
  let refusal = ''
  // A revision already trusted here is the participant's own; anything else is
  // whatever the authority gate called it.
  let pickedKind: ArrivalKind = 'own'
  for (const candidate of [...new Set([revision.root, ...(revision.roots ?? [])])].filter(sig => SIG_RE.test(sig))) {
    if ((await layerAt(candidate, path, io)) !== revision.layer) {
      refusal ||= `${candidate.slice(0, 12)}… does not carry that revision of ${path}`
      continue
    }
    if (!trustedHere(candidate)) {
      const verdict = await activationAuthority({
        packageSig: candidate,
        zone: carried[0] ?? '',
        self: location.host,
        installed: trunk,
        zones: carried.slice(1),
        attester: registeredAttester(),
        byHand: options.byHand === true,
      })
      if (!verdict.ok) { refusal = verdict.error; continue }
      pickedKind = arrivalKindOf(verdict.by)
    }
    root = candidate
    break
  }
  if (!root) return fail(refusal || 'no root carries that revision')

  const origins = [...new Set([...carried.flatMap(zone => hostBases(zone)), ...(originAmong(carried) ? selfBases() : [])])]
  const fetchFrom = fetchAcross(origins)

  // THE BRANCH: its layer closure, and the bees it declares.
  const branch = await deriveInventory(revision.layer, io)
  fetched += branch.result.fetched
  present += branch.result.present
  if (!isComplete(branch.result)) return fail(`${branch.result.holes.length + branch.result.refused.length} layer(s) of ${path} could not be admitted`)
  const beesUrlBase = `/opfs/${await registerPoolMeaning(BEES_MEANING)}`
  const depsUrlBase = `/opfs/${await registerPoolMeaning(DEPENDENCIES_MEANING)}`
  const bees = await resolveInventory(revision.layer, branch.inventory.bees, {
    read: readFrom([store.bees], sig => [`${sig}.js`, sig]),
    fetch: fetchFrom,
    write: writeTo(store.bees, sig => `${sig}.js`, sig => `${beesUrlBase}/${sig}.js`, 'application/javascript; charset=utf-8'),
  } satisfies ReplicationIo)
  fetched += bees.fetched
  present += bees.present
  if (!isComplete(bees)) return fail(`${bees.holes.length + bees.refused.length} bee(s) of ${path} could not be admitted`)

  // THE BROOD (core/brood.ts). These bees just arrived from somebody else's
  // root; they are verified and not yet imported. Whatever the participant's
  // rules do not clear is held, and the loader will not read it until a hand
  // — or enough vouches from communities they follow — says otherwise.
  // A stranger's pick holds only what is NEW here: a bee byte-identical to one
  // the trunk runs is the trunk's own code, and holding its signature would
  // hold the trunk's copy too.
  const stranger = pickedKind === 'stranger'
  const trunkCode = stranger ? await trunkCodeOf(trunk, io) : new Set<string>()
  const pickedHeld = await holdArrivals(stranger ? bees.held.filter(sig => !trunkCode.has(sig)) : bees.held, pickedKind, {
    zone: carried[0] ?? '',
    packageSig: root,
    how: `picked revision of ${path}`,
  })
  if (pickedHeld.length) {
    console.warn(`[acquire] ${pickedHeld.length} bee(s) of ${path} held in the brood — accept them before they run`)
  }

  // ITS NAMESPACE BUNDLES: every dependency the root lists whose alias falls
  // under the path — read where held, else fetched, verified, and kept only
  // when it belongs. A bundle that cannot be read at all could be one of them,
  // so it fails the pick rather than leaving a hole nobody named.
  let rootDependencies: string[] = []
  try {
    const bytes = await io.read(root)
    rootDependencies = sigsOf((JSON.parse(new TextDecoder().decode(bytes!)) as { dependencies?: unknown }).dependencies)
  } catch { return fail(`${root.slice(0, 12)}… could not be read`) }
  const readDependency = readFrom([store.dependencies], sig => [`${sig}.js`, sig])
  const writeDependency = writeTo(store.dependencies, sig => `${sig}.js`, sig => `${depsUrlBase}/${sig}`, 'application/javascript; charset=utf-8')
  const unreadable: string[] = []
  const bundles: string[] = []
  for (const sig of rootDependencies) {
    const held = await readDependency(sig)
    if (held) {
      present++
      if (within(namespaceOf(held), path)) bundles.push(sig)
      continue
    }
    const bytes = await fetchFrom(sig)
    if (!bytes || (await SignatureService.sign(bytes.buffer)) !== sig) { unreadable.push(sig); continue }
    if (!within(namespaceOf(bytes), path)) continue
    await writeDependency(sig, bytes)
    bundles.push(sig)
    fetched++
  }
  if (unreadable.length) return fail(`${unreadable.length} namespace bundle(s) of ${root.slice(0, 12)}… could not be admitted`)
  // A bundle is code too: a stranger's is held like its bees, and while it is
  // held the selection keeps the trunk's bundle for its namespace.
  if (stranger) {
    await holdArrivals(bundles.filter(sig => !trunkCode.has(sig)), pickedKind, {
      zone: carried[0] ?? '',
      packageSig: root,
      how: `picked revision of ${path} — a dependency bundle`,
    })
  }

  const outcome = await applySelection(trunk, [...(stranger ? [] : [root]), ...branch.result.held, ...bees.held], {
    ...readPicks(),
    [path]: { layer: revision.layer, root, hides: options.hides === true, at: Date.now(), ...(stranger ? { byHand: true } : {}) },
  })
  if (!outcome.ok) return fail(outcome.error)
  return { ok: true, packageSig: root, fetched, present, holes: [], refused: [] }
}

/** Every bee and dependency bundle the trunk's own tree runs — read from what
 *  is held, never fetched. */
const trunkCodeOf = async (trunk: string, io: ReplicationIo): Promise<Set<string>> => {
  const walk = await walkTree(trunk, { ...io, fetch: async () => null })
  return new Set([...walk.rootBees, ...walk.nodes.flatMap(node => node.bees), ...walk.rootDependencies])
}

/** Drop the pick at a path: the trunk's layer runs there again. */
export const unpickRevision = async (path: string): Promise<SelectionOutcome> => {
  const trunk = installedPackageSig()
  if (!trunk) return { ok: false, error: 'nothing is installed here' }
  const picks = readPicks()
  if (!picks[path]) return { ok: true }
  delete picks[path]
  return applySelection(trunk, [], picks)
}

const activate = async (
  packageSig: string,
  inventory: PackageInventory,
  beeDeps: Record<string, string[]>,
  held: readonly string[],
  /** The bees that load — every bee the selection names, minus the paths that
   *  are off. Their layers and bytes stay held either way. */
  bees: readonly string[],
): Promise<void> => {
  try {
    stampInstalledPackage(packageSig)
    localStorage.setItem(INSTALL_MANIFEST_KEY, JSON.stringify({
      version: 2,
      layers: inventory.layers,
      bees: [...bees],
      dependencies: inventory.dependencies,
      beeDeps,
      // Answerable to the channel the participant follows — the web has no
      // bundled authority, because the origin is the shell, not a host.
      source: 'sentinel',
    }))
    // Per-bee dependency closure, read by the preloader when it lazy-loads a
    // bee's deps. A global rather than storage because it is re-derived every
    // boot from the manifest above.
    if (Object.keys(beeDeps).length) (globalThis as { __hypercombBeeDeps?: unknown }).__hypercombBeeDeps = beeDeps
    // Every admitted signature is trusted BY CONSTRUCTION — its bytes hashed
    // to its name at the admission boundary. Runtime performs zero
    // verification, which is the design, not an optimization. Serialized
    // through SignatureStore itself so the on-disk shape can never drift from
    // the reader's.
    const sigStore = new SignatureStore()
    try {
      const existing = localStorage.getItem(SIG_STORE_KEY)
      if (existing) sigStore.restore(JSON.parse(existing) as { sigs?: string[]; storeSig?: string | null })
    } catch { /* unreadable — start from the set we just admitted */ }
    sigStore.trustAll(held)
    localStorage.setItem(SIG_STORE_KEY, JSON.stringify(sigStore.toJSON()))
  } catch { /* storage unavailable — OPFS presence is still the truth */ }
}

/**
 * THE BAGS, BUILT HERE RATHER THAN DOWNLOADED.
 *
 * A bag is the index the import map is assembled from, and every input to it
 * is already on disk once admission completes: a dependency's alias is the
 * first line of its own bytes, a bee has none, and the bag's address is the
 * sha256 of those entries. So the client builds both bags itself — no fetch,
 * no host claim, and nothing left on the wire that a package signature does
 * not already imply (bags.ts).
 *
 * Single-bag invariant: evict any prior bag before writing the new one, so the
 * import map's readdir finds exactly one and needs no pointer file. Scoped
 * STRICTLY to the install-owned pools — at the OPFS root the same 64-hex dir
 * shape is a user lineage sigbag.
 */
const writeBags = async (store: StoreLike, inventory: PackageInventory): Promise<void> => {
  // "Scoped strictly to the install-owned pools" scopes the HANDLE, not the
  // ADDRESS: `store.bees` IS sign('bees'), and sign('bees') IS the molecule of
  // a tile named `bees`. A 64-hex SUBDIRECTORY there is an author bucket as
  // readily as it is a stale bag. So a candidate is evicted only when its own
  // contents prove it is a bag: all markers, or empty.
  const evict = async (parent: FileSystemDirectoryHandle, keep: string): Promise<void> => {
    const stale: string[] = []
    for await (const [name, handle] of parent.entries()) {
      if (handle.kind === 'directory' && SIG_RE.test(name) && name !== keep) stale.push(name)
    }
    for (const name of stale) {
      try {
        const dir = await parent.getDirectoryHandle(name, { create: false })
        // `hardDeleteVetoFor` passes an EMPTY directory ("nothing to lose"),
        // which at a molecule address is a namespace a replication or another
        // tab may be mid-write into. Nothing this code wrote is ever empty, so
        // proof of a bag is at least one MARKER; absence of proof refuses.
        let veto = await hardDeleteVetoFor(dir)
        if (!veto) {
          let markers = 0
          for await (const [entry, handle] of dir.entries()) {
            if (handle.kind === 'file' && MARKER_NAME.test(entry)) { markers++; break }
          }
          if (markers === 0) veto = 'is empty — an install pass never leaves a bag empty'
        }
        if (veto) { console.warn(`[acquire] not evicting ${name.slice(0, 8)}… — it ${veto}`); continue }
        await parent.removeEntry(name, { recursive: true })
      } catch { /* skip */ }
    }
  }

  const put = async (parent: FileSystemDirectoryHandle | undefined, entries: { sig: string; content: string }[]): Promise<void> => {
    if (!parent || !entries.length) return
    const bagSig = await bagSignature(entries)
    await evict(parent, bagSig)
    const bagDir = await parent.getDirectoryHandle(bagSig, { create: true })
    await Promise.all(orderedEntries(entries).map(async (entry, index) => {
      const bytes = new TextEncoder().encode(entry.content)
      await writeBytes(bagDir, bagEntryName(index), bytes.buffer.slice(0, bytes.byteLength) as ArrayBuffer)
    }))
  }

  const readDep = readFrom([store.dependencies], sig => [`${sig}.js`, sig])
  const aliases = new Map<string, string>()
  for (const sig of inventory.dependencies) aliases.set(sig, aliasOf(await readDep(sig)))

  await put(store.dependencies, dependencyEntries(inventory.dependencies, sig => aliases.get(sig) ?? ''))
  await put(store.bees, beeEntries(inventory.bees))
}

// ── the install port ────────────────────────────────────────────────────────
// Registered under the key CORE declares (install.types.ts), so a module that
// imports core and nothing else can ask what runs here, walk a tree, list a
// path's revisions, turn a path on or off, and take a revision or a root —
// through the same gated acquisition as every shell.

/** Recent roots a domain lists, per revisions question. Each is a few layer
 *  reads the first time and none after. */
const REVISION_ROOTS = 25

const installProvider: InstallProvider = {
  installedSig: () => installedPackageSig(),
  unitsOf: async (root, zones) => {
    const io = await layersIoFor(zones)
    return io ? packageUnits(root, io) : []
  },
  nodesOf: async (root, zones) => {
    const io = await layersIoFor(zones)
    return io ? (await walkTree(root, io)).nodes : []
  },
  headOf: async (zone) => (await headPackage(zone))?.packageSig ?? null,
  movedUnits: async (installedRoot, nextRoot, zones) => {
    const io = await layersIoFor(zones)
    const store = window.ioc?.get?.<StoreLike>(STORE_KEY)
    if (!io || !store) return []
    const [mine, next] = await Promise.all([packageUnits(installedRoot, io), packageUnits(nextRoot, io)])
    const moved = changedUnits(mine, next)
    const readHeld = readFrom([store.dependencies], sig => [`${sig}.js`, sig])
    for (const name of await dependencyUnits(installedRoot, nextRoot, io, readHeld)) moved.add(name)
    return [...moved].sort()
  },
  movedPaths: async (nextRoot, zones) => {
    const trunk = installedPackageSig()
    const io = await layersIoFor(zones)
    const store = window.ioc?.get?.<StoreLike>(STORE_KEY)
    if (!trunk || !io || !store) return []
    const [mine, next] = await Promise.all([
      walkTree(trunk, { ...io, fetch: async () => null }, readPicks()),
      walkTree(nextRoot, io),
    ])
    const moved = movedPaths(mine.nodes, next.nodes)
    // A queen, a view or a service moves only its namespace bundle, which the
    // root lists — so a bundle the next root runs and this shell does not
    // marks the namespace it names.
    let running: string[] = []
    try { running = (JSON.parse(localStorage.getItem(INSTALL_MANIFEST_KEY) ?? '{}') as { dependencies?: string[] }).dependencies ?? [] } catch { running = [] }
    const before = new Set(running)
    const readHeld = readFrom([store.dependencies], sig => [`${sig}.js`, sig])
    for (const sig of next.rootDependencies.filter(dep => !before.has(dep))) {
      let bytes = await readHeld(sig)
      if (!bytes) {
        const fetchedBytes = await io.fetch(sig)
        bytes = fetchedBytes && (await SignatureService.sign(fetchedBytes.buffer)) === sig ? fetchedBytes : null
      }
      const ns = namespaceOf(bytes)
      if (ns) moved.add(ns)
    }
    return [...withAncestors(moved)].sort()
  },
  selection: async () => {
    const trunk = installedPackageSig()
    const picks = readPicks()
    const io = trunk ? await layersIoFor([]) : null
    if (!trunk || !io) return { trunk, picks, applied: [], eclipsed: [], nodes: [] }
    const walk = await walkTree(trunk, { ...io, fetch: async () => null }, picks)
    return { trunk, picks, applied: walk.applied, eclipsed: walk.eclipsed, nodes: walk.nodes }
  },
  revisionsOf: async (path, zones, roots = []) => {
    const io = await layersIoFor(zones)
    if (!io || !isPath(path)) return []
    const found: { layer: string; source: RevisionSource }[] = []
    const trunk = installedPackageSig()
    const held = [...new Set([trunk ?? '', ...Object.values(readPicks()).map(pick => pick.root), ...roots])].filter(sig => SIG_RE.test(sig))
    await Promise.all(held.map(async root => {
      const layer = await layerAt(root, path, io)
      if (layer) found.push({ layer, source: { root, zone: '', at: '', rank: 0 } })
    }))
    await Promise.all(zones.map(async zone => {
      const rows = await listHostPackages(zone, { limit: REVISION_ROOTS }).catch(() => [])
      await Promise.all(rows.map(async (row, rank) => {
        const layer = await layerAt(row.packageSig, path, io)
        // A member that names nothing is labelled by its own signature prefix;
        // that is a placeholder for display, not a name to group under.
        const name = row.label && row.label !== row.packageSig.slice(0, 12) ? row.label : ''
        if (layer) found.push({ layer, source: { root: row.packageSig, zone, at: row.at, rank, name } })
      }))
    }))
    return orderRevisions(found).map(revision => ({
      layer: revision.layer,
      at: revision.at,
      sources: revision.sources.map(({ root, zone, at, name }) => ({ root, zone, at, ...(name ? { name } : {}) })),
    }))
  },
  revisionNodes: async (path, root, zones) => {
    const io = await layersIoFor(zones)
    if (!io) return []
    const layer = await layerAt(root, path, io)
    if (!layer) return []
    const walk = await walkTree(layer, io)
    const under = (relative: string): string => `${path}/${relative}`
    return walk.nodes.map(node => ({ ...node, path: under(node.path), children: node.children.map(under) }))
  },
  pick: async (path, revision, zones, options) => {
    const outcome = await pickRevision(path, revision, zones, options)
    return { ok: outcome.ok, fetched: outcome.fetched, present: outcome.present, ...(outcome.error ? { error: outcome.error } : {}) }
  },
  unpick: async (path) => {
    const outcome = await unpickRevision(path)
    return { ok: outcome.ok, fetched: 0, present: 0, ...(outcome.ok ? {} : { error: outcome.error }) }
  },
  acquire: async (root, zones) => {
    const outcome = await acquire(root, zones)
    return { ok: outcome.ok, fetched: outcome.fetched, present: outcome.present, ...(outcome.error ? { error: outcome.error } : {}) }
  },
  applyUnits,
  offUnits: () => readOffUnits(),
  setOffUnits: (names) => writeOffUnits(names),
}

try {
  ;(globalThis as { ioc?: { register?: (k: string, v: unknown) => void } })
    .ioc?.register?.(INSTALL_IOC_KEY, installProvider)
} catch { /* no ioc in this environment — direct importers still work */ }
