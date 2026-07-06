// diamond-core-processor/src/app/core/dcp-store.ts

//
// THE STORAGE MODEL — no typed folders, ever.
//
// Mirrors the pools-of-meaning model of hypercomb-shared/core/store.ts so
// DCP and the hive stay convention-compatible: the only folders are
// sig-named. Two folder kinds exist at the DCP OPFS root:
//
//   <sign(meaning)>/   POOLS OF MEANING — the dir name is the sha256 of the
//                      UTF-8 bytes of the meaning string ('bees',
//                      'dependencies', 'patches', 'from-hypercomb'),
//                      derived by convention so any tier (the hive's Store,
//                      tooling, a peer) computes the identical address with
//                      no registry.
//   <domainKey>/       IDENTITY SCOPES — one dir per adopted/installed
//                      domain at the root, holding that domain's sig-named
//                      layer files plus its manifest.cache.json (the sigbag
//                      model's "one folder per domain").
//
// Every `__x__` name below is a LEGACY drain source: opened WITHOUT
// `create` (so it stays gone once drained), read as a fallback after the
// canonical location misses, and never written again. A detached, delayed
// self-clean absorbs each legacy dir into its signed location — copy →
// remove per record, gated final removeEntry only once the dir is fully
// drained — so stragglers survive to a later boot and nothing is ever
// deleted before it is confirmed copied.

import { Injectable } from '@angular/core'
import { SignatureService } from '@hypercomb/core'

const SIG_RE = /^[a-f0-9]{64}$/i
const SIG_JSON_RE = /^[a-f0-9]{64}\.json$/i

const entriesOf = (dir: FileSystemDirectoryHandle) =>
  (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()

/** sign(meaning) → pool address, memoized. Module-level (not a static
 *  `#field`) because `@Injectable` + a static private member trips
 *  TS18036 under experimentalDecorators; the derivation IS the registry
 *  either way — the hive's Store computes the identical addresses. */
const POOL_SIGNATURES = new Map<string, string>()

/** How long after init the self-clean waits before draining legacy dirs —
 *  keeps the absorb clear of the first install/sync burst. Module-level
 *  (not a static `#field`) for the same TS18036 reason as POOL_SIGNATURES. */
const SELF_CLEAN_DELAY_MS = 5_000

@Injectable({ providedIn: 'root' })
export class DcpStore {

  /** Pool meanings — sign(meaning) IS the folder name. */
  static readonly BEES_MEANING = 'bees'
  static readonly DEPENDENCIES_MEANING = 'dependencies'
  static readonly PATCHES_MEANING = 'patches'
  static readonly FROM_HYPERCOMB_MEANING = 'from-hypercomb'
  /** Kind sub-pools inside the from-hypercomb pool. */
  static readonly LAYERS_MEANING = 'layers'
  static readonly RESOURCES_MEANING = 'resources'

  // ---- Legacy `__x__` drain sources. Read-fallback only; never created,
  // ---- never written. Removed by the self-clean once fully absorbed.
  static readonly LEGACY_BEES_DIRECTORY = '__bees__'
  static readonly LEGACY_DEPENDENCIES_DIRECTORY = '__dependencies__'
  static readonly LEGACY_LAYERS_DIRECTORY = '__layers__'
  static readonly LEGACY_RESOURCES_DIRECTORY = '__resources__'
  static readonly LEGACY_PATCHES_DIRECTORY = '__patches__'
  static readonly LEGACY_FROM_HYPERCOMB_DIRECTORY = '__from-hypercomb__'

  /** sign(meaning) → pool address: sha256 of the UTF-8 bytes of the
   *  meaning string, memoized via the module-level POOL_SIGNATURES map.
   *  The derivation IS the registry — the hive's Store computes the
   *  identical addresses. */
  static async poolSignature(meaning: string): Promise<string> {
    let sig = POOL_SIGNATURES.get(meaning)
    if (!sig) {
      sig = await SignatureService.sign(new TextEncoder().encode(meaning).buffer as ArrayBuffer)
      POOL_SIGNATURES.set(meaning, sig)
    }
    return sig
  }

  #root!: FileSystemDirectoryHandle
  #bees!: FileSystemDirectoryHandle
  #dependencies!: FileSystemDirectoryHandle
  #patches!: FileSystemDirectoryHandle
  #fromHypercomb!: FileSystemDirectoryHandle
  // Legacy handles — undefined when absent or already drained.
  #legacyBees?: FileSystemDirectoryHandle
  #legacyDependencies?: FileSystemDirectoryHandle
  #legacyLayers?: FileSystemDirectoryHandle
  #legacyResources?: FileSystemDirectoryHandle
  #legacyPatches?: FileSystemDirectoryHandle
  #legacyFromHypercomb?: FileSystemDirectoryHandle
  #initPromise: Promise<void> | null = null

  get root(): FileSystemDirectoryHandle { return this.#root }
  /** sign('bees') pool — every bee bundle (installed, patched, network-
   *  cached) as `<sig>.js`. Sig-distinct content never collides. */
  get bees(): FileSystemDirectoryHandle { return this.#bees }
  /** sign('dependencies') pool — dep bundles as `<sig>.js` (alias in each
   *  file's first-line comment, as before). */
  get dependencies(): FileSystemDirectoryHandle { return this.#dependencies }
  // Legacy handles for readers that union/fall back while a drain source
  // still exists (addendum rule: never treat an empty pool as "nothing
  // installed" while the legacy dir is still there).
  get legacyBees(): FileSystemDirectoryHandle | undefined { return this.#legacyBees }
  get legacyDependencies(): FileSystemDirectoryHandle | undefined { return this.#legacyDependencies }
  get legacyFromHypercomb(): FileSystemDirectoryHandle | undefined { return this.#legacyFromHypercomb }

  initialize(): Promise<void> {
    return this.#initPromise ??= this.#doInit()
  }

  async #doInit(): Promise<void> {
    this.#root = await navigator.storage.getDirectory()
    // sign(meaning) pools — the only dirs init ever creates.
    const pool = async (meaning: string) =>
      this.#root.getDirectoryHandle(await DcpStore.poolSignature(meaning), { create: true })
    // Legacy drain sources: opened WITHOUT create so a drained dir stays
    // gone (create:true would resurrect it empty every boot). Absent →
    // undefined; every reader tolerates that.
    const legacy = async (name: string) => {
      try { return await this.#root.getDirectoryHandle(name) } catch { return undefined }
    }
    ;[this.#bees, this.#dependencies, this.#patches, this.#fromHypercomb] = await Promise.all([
      pool(DcpStore.BEES_MEANING),
      pool(DcpStore.DEPENDENCIES_MEANING),
      pool(DcpStore.PATCHES_MEANING),
      pool(DcpStore.FROM_HYPERCOMB_MEANING),
    ])
    ;[this.#legacyBees, this.#legacyDependencies, this.#legacyLayers,
      this.#legacyResources, this.#legacyPatches, this.#legacyFromHypercomb] = await Promise.all([
      legacy(DcpStore.LEGACY_BEES_DIRECTORY),
      legacy(DcpStore.LEGACY_DEPENDENCIES_DIRECTORY),
      legacy(DcpStore.LEGACY_LAYERS_DIRECTORY),
      legacy(DcpStore.LEGACY_RESOURCES_DIRECTORY),
      legacy(DcpStore.LEGACY_PATCHES_DIRECTORY),
      legacy(DcpStore.LEGACY_FROM_HYPERCOMB_DIRECTORY),
    ])
    // SELF-CLEANING: when legacy sources exist, migrate everything into
    // the signed locations and remove the orphaned folders — detached and
    // delayed so it never competes with the first install/sync burst.
    // Reads stay correct meanwhile via every reader's legacy fallback.
    if (this.#legacyBees || this.#legacyDependencies || this.#legacyLayers ||
        this.#legacyResources || this.#legacyPatches || this.#legacyFromHypercomb) {
      setTimeout(() => { void this.#selfClean() }, SELF_CLEAN_DELAY_MS)
    }
  }

  /** OPFS directory names can't contain `/` or `:`, so a scoped domain like
   *  `https://jwize.com` or `branch://<sig>` must be reduced to a safe key
   *  (`jwize.com`). Both the live-adopt write and the lineage-rebuild read go
   *  through here, so they always land in the same per-domain scope. */
  #domainKey(domain: string): string {
    return (String(domain || 'default')
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')   // strip scheme (https://, branch://, wss://)
      .replace(/[^a-z0-9._-]/gi, '_')             // remaining illegal chars → _
      .toLowerCase()) || 'default'
  }

  /** The domain's IDENTITY SCOPE at the OPFS root: sig-named layer files
   *  (installed, adopted, and patched-cascade — all sig-distinct) plus
   *  the domain's manifest.cache.json. Was `__layers__/<domainKey>/`;
   *  that dir is now a legacy drain source (legacyDomainLayersDir). */
  async domainLayersDir(domain: string): Promise<FileSystemDirectoryHandle> {
    return await this.#root.getDirectoryHandle(this.#domainKey(domain), { create: true })
  }

  /** Legacy `__layers__/<domainKey>/` — read-fallback while it drains. */
  async legacyDomainLayersDir(domain: string): Promise<FileSystemDirectoryHandle | undefined> {
    if (!this.#legacyLayers) return undefined
    try { return await this.#legacyLayers.getDirectoryHandle(this.#domainKey(domain)) } catch { return undefined }
  }

  /** sign('patches')/<domainKey>/ — patch BOOKKEEPING only: sequential
   *  patch records + active.json. Patched CONTENT is re-signed (new
   *  bytes ⇒ new sig) and lives with the originals — layers in the
   *  domain scope, bees/deps in their pools. */
  async domainPatchesDir(domain: string): Promise<FileSystemDirectoryHandle> {
    return await this.#patches.getDirectoryHandle(this.#domainKey(domain), { create: true })
  }

  /** Legacy `__patches__/<domainKey>/` — read-fallback while it drains. */
  async legacyDomainPatchesDir(domain: string): Promise<FileSystemDirectoryHandle | undefined> {
    if (!this.#legacyPatches) return undefined
    try { return await this.#legacyPatches.getDirectoryHandle(this.#domainKey(domain)) } catch { return undefined }
  }

  /** Patched (cascaded) layers write into the domain scope alongside the
   *  originals — content addressing keeps them distinct, and the
   *  installer's purge is manifest-diff-scoped so it never touches them. */
  async patchedLayersDir(domain: string): Promise<FileSystemDirectoryHandle> {
    return this.domainLayersDir(domain)
  }

  /** Patched bees land in the sign('bees') pool — sig-distinct from the
   *  originals they replace. */
  async patchedBeesDir(_domain: string): Promise<FileSystemDirectoryHandle> {
    return this.#bees
  }

  /** Patched deps land in the sign('dependencies') pool. */
  async patchedDepsDir(_domain: string): Promise<FileSystemDirectoryHandle> {
    return this.#dependencies
  }

  // Legacy `__patches__/<domainKey>/__x__/` patched-content sub-dirs —
  // read-fallback only while the patches drain runs.
  async legacyPatchedLayersDir(domain: string): Promise<FileSystemDirectoryHandle | undefined> {
    return this.#legacyPatchedSubDir(domain, DcpStore.LEGACY_LAYERS_DIRECTORY)
  }
  async legacyPatchedBeesDir(domain: string): Promise<FileSystemDirectoryHandle | undefined> {
    return this.#legacyPatchedSubDir(domain, DcpStore.LEGACY_BEES_DIRECTORY)
  }
  async legacyPatchedDepsDir(domain: string): Promise<FileSystemDirectoryHandle | undefined> {
    return this.#legacyPatchedSubDir(domain, DcpStore.LEGACY_DEPENDENCIES_DIRECTORY)
  }
  async #legacyPatchedSubDir(domain: string, sub: string): Promise<FileSystemDirectoryHandle | undefined> {
    const patchDir = await this.legacyDomainPatchesDir(domain)
    if (!patchDir) return undefined
    try { return await patchDir.getDirectoryHandle(sub) } catch { return undefined }
  }

  /**
   * sign('from-hypercomb') pool — content the web app pushed up via
   * sentinel intake, plus the index.jsonl provenance log. Kept as its own
   * pool for PROVENANCE (what did the hive push, when), not collision
   * safety — sig addressing cannot collide with authored content.
   */
  async fromHypercombDir(): Promise<FileSystemDirectoryHandle> {
    return this.#fromHypercomb
  }

  /**
   * Kind sub-pool: sign('from-hypercomb')/<sign(kind meaning)>/ — the
   * kind meanings are 'layers', 'bees', 'dependencies', 'resources'.
   * Layers/resources store as bare `<sig>`, bees/deps as `<sig>.js`,
   * mirroring the canonical naming so received content is structurally
   * identical to authored content.
   */
  async fromHypercombKindDir(kind: 'layer' | 'bee' | 'dependency' | 'resource'): Promise<FileSystemDirectoryHandle> {
    const meaning =
      kind === 'layer' ? DcpStore.LAYERS_MEANING :
      kind === 'bee' ? DcpStore.BEES_MEANING :
      kind === 'dependency' ? DcpStore.DEPENDENCIES_MEANING :
      DcpStore.RESOURCES_MEANING
    return await this.#fromHypercomb.getDirectoryHandle(await DcpStore.poolSignature(meaning), { create: true })
  }

  /** Legacy `__from-hypercomb__/__x__/` — read-fallback while it drains. */
  async legacyFromHypercombKindDir(kind: 'layer' | 'bee' | 'dependency' | 'resource'): Promise<FileSystemDirectoryHandle | undefined> {
    if (!this.#legacyFromHypercomb) return undefined
    const sub =
      kind === 'layer' ? DcpStore.LEGACY_LAYERS_DIRECTORY :
      kind === 'bee' ? DcpStore.LEGACY_BEES_DIRECTORY :
      kind === 'dependency' ? DcpStore.LEGACY_DEPENDENCIES_DIRECTORY :
      DcpStore.LEGACY_RESOURCES_DIRECTORY
    try { return await this.#legacyFromHypercomb.getDirectoryHandle(sub) } catch { return undefined }
  }

  async writeFile(dir: FileSystemDirectoryHandle, name: string, bytes: ArrayBuffer): Promise<void> {
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(bytes)
    await writable.close()
  }

  async readFile(dir: FileSystemDirectoryHandle, name: string): Promise<ArrayBuffer | null> {
    try {
      const handle = await dir.getFileHandle(name)
      const file = await handle.getFile()
      return await file.arrayBuffer()
    } catch {
      return null
    }
  }

  async hasFile(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
    try {
      await dir.getFileHandle(name)
      return true
    } catch {
      return false
    }
  }

  /** Dual-read: try each source dir × candidate name, canonical location
   *  first, legacy drain sources after. Undefined dirs (already drained /
   *  never existed) are skipped. */
  async readFirst(
    dirs: (FileSystemDirectoryHandle | undefined)[],
    names: string[],
  ): Promise<ArrayBuffer | null> {
    for (const dir of dirs) {
      if (!dir) continue
      for (const name of names) {
        const bytes = await this.readFile(dir, name)
        if (bytes) return bytes
      }
    }
    return null
  }

  /** Presence check UNIONED across the canonical dir and its legacy drain
   *  sources — during the drain window a sig may still live only in the
   *  legacy dir, and that must count as present. */
  async hasAny(
    dirs: (FileSystemDirectoryHandle | undefined)[],
    names: string[],
  ): Promise<boolean> {
    for (const dir of dirs) {
      if (!dir) continue
      for (const name of names) {
        if (await this.hasFile(dir, name)) return true
      }
    }
    return false
  }

  // -------------------------------------------------
  // self-cleaning drains — legacy `__x__` → signed locations
  // -------------------------------------------------

  /** Drain every legacy `__x__` dir into its signed location, then remove
   *  the emptied folder. Detached + delayed from init; sequential so
   *  single-threaded OPFS isn't hammered. Copy → remove per record; every
   *  final removeEntry is non-recursive ON PURPOSE — it only succeeds once
   *  the folder is empty, so a straggler (or an unexpected entry) is never
   *  destroyed. Idempotent and resumable: a partial pass just finishes on
   *  a later boot. */
  async #selfClean(): Promise<void> {
    try {
      if (this.#legacyBees && await this.#drainFiles(this.#legacyBees, this.#bees)
          && await this.#removeLegacyRoot(DcpStore.LEGACY_BEES_DIRECTORY)) {
        this.#legacyBees = undefined
      }
      if (this.#legacyDependencies && await this.#drainFiles(this.#legacyDependencies, this.#dependencies)
          && await this.#removeLegacyRoot(DcpStore.LEGACY_DEPENDENCIES_DIRECTORY)) {
        this.#legacyDependencies = undefined
      }
      // __resources__ was created empty on every boot and has no writers;
      // any sig-named stray is content and lands flat at the root scope.
      if (this.#legacyResources && await this.#drainFiles(this.#legacyResources, this.#root,
            n => SIG_RE.test(n) ? n : null)
          && await this.#removeLegacyRoot(DcpStore.LEGACY_RESOURCES_DIRECTORY)) {
        this.#legacyResources = undefined
      }
      if (this.#legacyLayers && await this.#drainLegacyLayers()
          && await this.#removeLegacyRoot(DcpStore.LEGACY_LAYERS_DIRECTORY)) {
        this.#legacyLayers = undefined
      }
      if (this.#legacyPatches && await this.#drainLegacyPatches()
          && await this.#removeLegacyRoot(DcpStore.LEGACY_PATCHES_DIRECTORY)) {
        this.#legacyPatches = undefined
      }
      if (this.#legacyFromHypercomb && await this.#drainLegacyFromHypercomb()
          && await this.#removeLegacyRoot(DcpStore.LEGACY_FROM_HYPERCOMB_DIRECTORY)) {
        this.#legacyFromHypercomb = undefined
      }
    } catch (err) {
      console.warn('[dcp-store] legacy drain pass aborted — retried next boot', err)
    }
  }

  /** Gated GC of a fully-drained legacy root dir. Non-recursive: fails
   *  (and returns false) while anything at all remains inside. */
  async #removeLegacyRoot(name: string): Promise<boolean> {
    try {
      await this.#root.removeEntry(name)
      console.log(`[dcp-store] ${name} fully drained — legacy dir removed`)
      return true
    } catch { return false }  // not yet empty — dual-reads keep working
  }

  /** Copy every plain file into `target` (an existing target entry wins —
   *  the legacy copy is by definition older), then remove it from the
   *  source. `rename` maps a legacy name to its canonical one (null =
   *  not ours to move; left in place, defers the dir's removal). Returns
   *  true iff the source holds nothing afterwards. NEVER removes a file
   *  that isn't confirmed present at the target. */
  async #drainFiles(
    source: FileSystemDirectoryHandle,
    target: FileSystemDirectoryHandle,
    rename?: (name: string) => string | null,
  ): Promise<boolean> {
    let remaining = 0
    try {
      for await (const [name, handle] of entriesOf(source)) {
        if (handle.kind !== 'file') { remaining++; continue }
        const targetName = rename ? rename(name) : name
        if (targetName === null) { remaining++; continue }
        try {
          let present = true
          try { await target.getFileHandle(targetName) } catch { present = false }
          if (!present) {
            const blob = await (handle as FileSystemFileHandle).getFile()
            const dest = await target.getFileHandle(targetName, { create: true })
            const writable = await dest.createWritable()
            try { await writable.write(blob) } finally { await writable.close() }
          }
          await source.removeEntry(name)
        } catch { remaining++ }  // straggler — absorbed on a later boot
      }
    } catch { return false }
    return remaining === 0
  }

  /** `__layers__/<domainKey>/…` → the domain's identity scope at the root.
   *  `<sig>.json` names normalize to bare `<sig>`; manifest.cache.json
   *  moves along under its own name. */
  async #drainLegacyLayers(): Promise<boolean> {
    const src = this.#legacyLayers!
    let clean = true
    for await (const [name, handle] of entriesOf(src)) {
      if (handle.kind !== 'directory') { clean = false; continue }  // stray file — defer
      const target = await this.#root.getDirectoryHandle(name, { create: true })
      if (await this.#drainFiles(handle as FileSystemDirectoryHandle, target,
            n => SIG_JSON_RE.test(n) ? n.slice(0, -5) : n)) {
        try { await src.removeEntry(name) } catch { clean = false }
      } else clean = false
    }
    return clean
  }

  /** `__patches__/<domainKey>/` → sign('patches')/<domainKey>/ for the
   *  bookkeeping (records + active.json); the nested patched-content
   *  `__x__` sub-dirs split by kind — layers into the domain scope,
   *  bees/deps into their pools (all sig-distinct from originals). */
  async #drainLegacyPatches(): Promise<boolean> {
    const src = this.#legacyPatches!
    let clean = true
    for await (const [dk, handle] of entriesOf(src)) {
      if (handle.kind !== 'directory') { clean = false; continue }
      const domainSrc = handle as FileSystemDirectoryHandle
      let domainClean = true
      for await (const [name, sub] of entriesOf(domainSrc)) {
        if (sub.kind !== 'directory') continue  // records drain below
        let target: FileSystemDirectoryHandle | null = null
        let rename: ((n: string) => string | null) | undefined
        if (name === DcpStore.LEGACY_LAYERS_DIRECTORY) {
          target = await this.#root.getDirectoryHandle(dk, { create: true })
          rename = n => SIG_JSON_RE.test(n) ? n.slice(0, -5) : n
        } else if (name === DcpStore.LEGACY_BEES_DIRECTORY) {
          target = this.#bees
        } else if (name === DcpStore.LEGACY_DEPENDENCIES_DIRECTORY) {
          target = this.#dependencies
        }
        if (!target) { domainClean = false; continue }  // unexpected dir — defer
        if (await this.#drainFiles(sub as FileSystemDirectoryHandle, target, rename)) {
          try { await domainSrc.removeEntry(name) } catch { domainClean = false }
        } else domainClean = false
      }
      // the flat files (sequential patch records + active.json)
      const recordsTarget = await this.#patches.getDirectoryHandle(dk, { create: true })
      if (!await this.#drainFiles(domainSrc, recordsTarget)) domainClean = false
      if (domainClean) { try { await src.removeEntry(dk) } catch { clean = false } }
      else clean = false
    }
    return clean
  }

  /** `__from-hypercomb__/__x__/` → the pool's sign(kind) sub-pools;
   *  index.jsonl → the pool root (skipped when the pool copy already
   *  exists — #appendIntakeIndex seeds its first pool write from the
   *  legacy log, so those lines are already carried forward). */
  async #drainLegacyFromHypercomb(): Promise<boolean> {
    const src = this.#legacyFromHypercomb!
    let clean = true
    const kinds: Record<string, 'layer' | 'bee' | 'dependency' | 'resource'> = {
      [DcpStore.LEGACY_LAYERS_DIRECTORY]: 'layer',
      [DcpStore.LEGACY_BEES_DIRECTORY]: 'bee',
      [DcpStore.LEGACY_DEPENDENCIES_DIRECTORY]: 'dependency',
      [DcpStore.LEGACY_RESOURCES_DIRECTORY]: 'resource',
    }
    for await (const [name, handle] of entriesOf(src)) {
      if (handle.kind !== 'directory') continue  // index.jsonl drains below
      const kind = kinds[name]
      if (!kind) { clean = false; continue }
      const target = await this.fromHypercombKindDir(kind)
      if (await this.#drainFiles(handle as FileSystemDirectoryHandle, target)) {
        try { await src.removeEntry(name) } catch { clean = false }
      } else clean = false
    }
    if (!await this.#drainFiles(src, this.#fromHypercomb)) clean = false
    return clean
  }
}
