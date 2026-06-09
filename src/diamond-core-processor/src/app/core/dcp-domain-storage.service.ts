// diamond-core-processor/src/app/core/dcp-domain-storage.service.ts
//
// Sigbags as the UNIVERSAL storage primitive.
//
// Everything the installer persists — adopted packages, the hosts you
// connect to, AND your settings — is a NAMED LINEAGE: a sigbag of markers
// (0000…000x) where the max marker is the current root, each change appends
// one marker, and the whole thing is therefore undoable. localStorage is
// replaced; the sigbag is the preferred (only) storage location.
//
// Confirmed in the 2026-06 architecture conversation:
//   "storage primitives can be at any sigbag location as long as there is a
//    way to load into the hive. This makes the preferred storage location
//    sigbags and nothing else. instead of localStorage we can load and save
//    a settings sigbag and it essentially has an undoable history."
//   "any bees can take part in the sigbag, they just need to be reachable."
//   "sign('domains', location segments)."
//
// Three reserved lineages (all sigbags, all siloed, all undoable):
//   domains       — adopted packages; tiles = source domains
//   host-domains  — mesh/storage hosts you connect to; tiles = hosts
//   settings      — participant-local config (visibility, prefs); kv layer
//
// Siloing is the structural win: a change to one lineage cascades only
// within itself. host-domains edits never re-sign the domains tree.
// "cost = depth, not tree-size" (the fractal principle).
//
// OPFS layout:
//   __content__/<sig>          content-addressed bytes (layer JSONs + blobs),
//                              deduplicated across ALL lineages.
//   __lineages__/<name>/000x   per-lineage sigbag markers. Each marker file's
//                              content is that lineage's root sig at that
//                              revision. Max marker = HEAD. The NAME is the
//                              address (the sign("<name>", …segments) ideal;
//                              for these reserved root lineages segments are
//                              empty so the name alone locates the sigbag).
//
// The write atom is the same one MerklePatchService uses: mutate a layer
// JSON → SignatureService.sign(bytes) → write to the content bucket →
// cascade → append a marker.

import { Injectable } from '@angular/core'
import { SignatureService } from '@hypercomb/core'

// ── Path + lineage constants ──────────────────────────────────────────────────

export const CONTENT_DIRECTORY = '__content__'
export const LINEAGES_DIRECTORY = '__lineages__'

export const DOMAINS_LINEAGE = 'domains'
export const HOST_DOMAINS_LINEAGE = 'host-domains'
export const SETTINGS_LINEAGE = 'settings'
// `default` = the base (restorable starting point; always-in refs).
// `logical` = the live effective install = union(default ⊕ enabled domain
// refs), recomputed (never differentiated) on every toggle/adopt/install.
export const DEFAULT_LINEAGE = 'default'
export const LOGICAL_LINEAGE = 'logical'
// `home` = the revision history: default (base) + named branch saves. Each
// save freezes the current logical HEAD under a name; restore makes a saved
// (or default) logical root the new HEAD via Make-HEAD append (linear).
export const HOME_LINEAGE = 'home'

const MARKER_RE = /^\d{4}$/
const SIG_RE = /^[a-f0-9]{64}$/i
const LINEAGE_NAME_RE = /^[a-z0-9-]+$/   // reserved-lineage dir names

// ── Layer shapes ──────────────────────────────────────────────────────────────

/** A tile-hive root (domains, host-domains): children are tile sigs. */
export interface HiveRootLayer {
  name: string
  children: string[]
}

/** A tile in a hive: name = domain/host; children = branch-entry sigs. */
export interface TileLayer {
  name: string
  children: string[]
}

/** A branch-entry — one adopted branch at a placement location. `refs` are
 *  the content sigs this branch contributes to the logical union (its layers/
 *  bees/deps/resources). The logical install unions refs across ENABLED
 *  branches; content-addressing dedupes, so a shared sig appears once and
 *  survives as long as ANY enabled silo (incl. your always-on data) lists it. */
export interface BranchEntryLayer {
  name: string
  branchSig: string
  at: string[]
  refs?: string[]
}

/** The settings-lineage root: a flat key→value map. Its own shape (kv), not
 *  a tile-hive — "no unified layer interface; shapes differ, only the
 *  signature is universal". */
export interface SettingsLayer {
  name: string
  values: Record<string, unknown>
}

/** A resolved tile for the UI — "load it like any other hive and choose". */
export interface ResolvedTile {
  name: string
  tileSig: string
  branchCount: number
}

// ── Key normalisation ───────────────────────────────────────────────────────

export function normalizeDomainKey(input: string): string {
  const raw = String(input ?? '').trim()
  if (!raw) return ''
  try {
    const url = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`)
    const host = url.hostname.toLowerCase()
    if (!/^[a-z0-9.-]+$/.test(host)) return ''
    return host
  } catch { return '' }
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class DcpDomainStorage {

  #root: FileSystemDirectoryHandle | null = null
  #contentDir: FileSystemDirectoryHandle | null = null
  #lineagesDir: FileSystemDirectoryHandle | null = null
  #initPromise: Promise<void> | null = null

  // In-memory mirror of the settings lineage HEAD, for synchronous reads
  // (the template's isDomainVisible must be sync). Loaded once on init;
  // updated optimistically on write while the sigbag append runs async.
  #settingsCache: Record<string, unknown> | null = null

  initialize(): Promise<void> {
    return this.#initPromise ??= this.#doInit()
  }

  async #doInit(): Promise<void> {
    this.#root = await navigator.storage.getDirectory()
    this.#contentDir = await this.#root.getDirectoryHandle(CONTENT_DIRECTORY, { create: true })
    this.#lineagesDir = await this.#root.getDirectoryHandle(LINEAGES_DIRECTORY, { create: true })
  }

  // ── content bucket (sig-addressed, deduplicated across all lineages) ──────

  async getContent(sig: string): Promise<Uint8Array | null> {
    if (!this.#contentDir) await this.initialize()
    if (!SIG_RE.test(sig)) return null
    try {
      const fh = await this.#contentDir!.getFileHandle(sig.toLowerCase())
      return new Uint8Array(await (await fh.getFile()).arrayBuffer())
    } catch { return null }
  }

  async putContent(sig: string, bytes: Uint8Array): Promise<void> {
    if (!this.#contentDir) await this.initialize()
    if (!SIG_RE.test(sig)) throw new Error(`invalid sig: ${sig}`)
    const fh = await this.#contentDir!.getFileHandle(sig.toLowerCase(), { create: true })
    const w = await fh.createWritable()
    await w.write(new Blob([bytes as BlobPart]))
    await w.close()
  }

  async hasContent(sig: string): Promise<boolean> {
    if (!this.#contentDir) await this.initialize()
    if (!SIG_RE.test(sig)) return false
    try { await this.#contentDir!.getFileHandle(sig.toLowerCase()); return true }
    catch { return false }
  }

  async #signJson(obj: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(obj))
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
    await this.putContent(sig, bytes)
    return sig
  }

  async #loadJson<T>(sig: string): Promise<T | null> {
    const bytes = await this.getContent(sig)
    if (!bytes) return null
    try { return JSON.parse(new TextDecoder().decode(bytes)) as T } catch { return null }
  }

  // ── generic sigbag markers (per named lineage) ────────────────────────────

  async #lineageDir(name: string): Promise<FileSystemDirectoryHandle> {
    if (!this.#lineagesDir) await this.initialize()
    if (!LINEAGE_NAME_RE.test(name)) throw new Error(`invalid lineage name: ${name}`)
    return this.#lineagesDir!.getDirectoryHandle(name, { create: true })
  }

  async #markerNumbers(lineage: string): Promise<number[]> {
    const dir = await this.#lineageDir(lineage)
    const nums: number[] = []
    for await (const [n, h] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
      if (h.kind === 'file' && MARKER_RE.test(n)) nums.push(parseInt(n, 10))
    }
    return nums.sort((a, b) => a - b)
  }

  async markerCount(lineage: string): Promise<number> {
    return (await this.#markerNumbers(lineage)).length
  }

  async rootAtMarker(lineage: string, n: number): Promise<string | null> {
    const dir = await this.#lineageDir(lineage)
    try {
      const fh = await dir.getFileHandle(String(n).padStart(4, '0'))
      const text = (await (await fh.getFile()).text()).trim().toLowerCase()
      return SIG_RE.test(text) ? text : null
    } catch { return null }
  }

  /** Current HEAD sig for a lineage (root at max marker), or null if empty. */
  async currentRootSig(lineage: string): Promise<string | null> {
    const nums = await this.#markerNumbers(lineage)
    if (nums.length === 0) return null
    return this.rootAtMarker(lineage, nums[nums.length - 1])
  }

  /** Append a marker pointing at rootSig. One marker = one undoable action. */
  async #appendMarker(lineage: string, rootSig: string): Promise<number> {
    const dir = await this.#lineageDir(lineage)
    const nums = await this.#markerNumbers(lineage)
    const next = nums.length === 0 ? 0 : nums[nums.length - 1] + 1
    const fh = await dir.getFileHandle(String(next).padStart(4, '0'), { create: true })
    const w = await fh.createWritable()
    await w.write(new Blob([rootSig.toLowerCase()]))
    await w.close()
    return next
  }

  // ── tile-hive lineages (domains, host-domains) ────────────────────────────

  async #currentHiveRoot(lineage: string): Promise<HiveRootLayer> {
    const sig = await this.currentRootSig(lineage)
    if (!sig) return { name: lineage, children: [] }
    return (await this.#loadJson<HiveRootLayer>(sig)) ?? { name: lineage, children: [] }
  }

  async #findTile(root: HiveRootLayer, tileName: string):
    Promise<{ sig: string; layer: TileLayer } | null> {
    const key = normalizeDomainKey(tileName)
    for (const childSig of root.children) {
      const layer = await this.#loadJson<TileLayer>(childSig)
      if (layer && normalizeDomainKey(layer.name) === key) return { sig: childSig, layer }
    }
    return null
  }

  /** Add a named tile to a hive lineage. Idempotent — no marker if present. */
  async addTile(lineage: string, tileName: string): Promise<string | null> {
    const key = normalizeDomainKey(tileName)
    if (!key) return null
    const root = await this.#currentHiveRoot(lineage)
    if (await this.#findTile(root, key)) return this.currentRootSig(lineage)
    const tileSig = await this.#signJson({ name: key, children: [] } as TileLayer)
    const newRootSig = await this.#signJson({ name: lineage, children: [...root.children, tileSig] })
    await this.#appendMarker(lineage, newRootSig)
    return newRootSig
  }

  /** Remove a tile from a hive lineage by appending a new root that omits it.
   *  History retained (earlier markers still reference it); HEAD drops it —
   *  removal-as-append, consistent with linear append-only history. */
  async removeTile(lineage: string, tileName: string): Promise<string | null> {
    const key = normalizeDomainKey(tileName)
    if (!key) return null
    const root = await this.#currentHiveRoot(lineage)
    const found = await this.#findTile(root, key)
    if (!found) return this.currentRootSig(lineage)   // not present — no-op
    const newChildren = root.children.filter(c => c !== found.sig)
    const newRootSig = await this.#signJson({ name: lineage, children: newChildren })
    await this.#appendMarker(lineage, newRootSig)
    return newRootSig
  }

  /** Adopt a branch under a tile (creating the tile if absent). Cascades to a
   *  new root, appends a marker. Idempotent on (branchSig, at). `refs` = the
   *  content sigs this branch contributes to the logical union. */
  async addBranch(lineage: string, tileName: string, branchSig: string, at: string[], label?: string, refs?: string[]):
    Promise<string | null> {
    const key = normalizeDomainKey(tileName)
    const sig = String(branchSig ?? '').trim().toLowerCase()
    if (!key || !SIG_RE.test(sig)) return null
    const root = await this.#currentHiveRoot(lineage)
    const existing = await this.#findTile(root, key)
    const tile: TileLayer = existing?.layer ?? { name: key, children: [] }

    for (const entrySig of tile.children) {
      const entry = await this.#loadJson<BranchEntryLayer>(entrySig)
      if (entry && entry.branchSig === sig && JSON.stringify(entry.at) === JSON.stringify(at)) {
        return this.currentRootSig(lineage)  // idempotent
      }
    }

    const cleanRefs = Array.isArray(refs)
      ? refs.map(r => String(r ?? '').trim().toLowerCase()).filter(r => SIG_RE.test(r))
      : []
    const entrySig = await this.#signJson({
      name: label || sig.slice(0, 8), branchSig: sig, at: Array.isArray(at) ? at : [],
      ...(cleanRefs.length ? { refs: cleanRefs } : {}),
    } as BranchEntryLayer)
    const newTileSig = await this.#signJson({ name: key, children: [...tile.children, entrySig] })
    const newChildren = existing
      ? root.children.map(c => (c === existing.sig ? newTileSig : c))
      : [...root.children, newTileSig]
    const newRootSig = await this.#signJson({ name: lineage, children: newChildren })
    await this.#appendMarker(lineage, newRootSig)
    return newRootSig
  }

  /** Load a hive lineage's tiles — "load it like any other hive and choose". */
  async loadHive(lineage: string): Promise<ResolvedTile[]> {
    const root = await this.#currentHiveRoot(lineage)
    const out: ResolvedTile[] = []
    for (const tileSig of root.children) {
      const tile = await this.#loadJson<TileLayer>(tileSig)
      if (tile) out.push({
        name: normalizeDomainKey(tile.name), tileSig,
        branchCount: Array.isArray(tile.children) ? tile.children.length : 0,
      })
    }
    return out
  }

  async loadTileBranches(lineage: string, tileName: string): Promise<BranchEntryLayer[]> {
    const root = await this.#currentHiveRoot(lineage)
    const found = await this.#findTile(root, tileName)
    if (!found) return []
    const out: BranchEntryLayer[] = []
    for (const entrySig of found.layer.children) {
      const entry = await this.#loadJson<BranchEntryLayer>(entrySig)
      if (entry) out.push(entry)
    }
    return out
  }

  // ── domains lineage (public wrappers) ──────────────────────────────────────

  addDomain(domain: string) { return this.addTile(DOMAINS_LINEAGE, domain) }
  removeDomain(domain: string) { return this.removeTile(DOMAINS_LINEAGE, domain) }
  addDomainBranch(domain: string, branchSig: string, at: string[], label?: string, refs?: string[]) {
    return this.addBranch(DOMAINS_LINEAGE, domain, branchSig, at, label, refs)
  }
  loadDomainsHive() { return this.loadHive(DOMAINS_LINEAGE) }
  loadDomainBranches(domain: string) { return this.loadTileBranches(DOMAINS_LINEAGE, domain) }

  // ── default lineage (base / always-in refs) ────────────────────────────────
  // The restorable starting point. Its refs are ALWAYS in the logical union
  // (they represent your base + own data — never dropped by feature toggles).
  addDefaultBranch(branchSig: string, at: string[], label?: string, refs?: string[]) {
    return this.addBranch(DEFAULT_LINEAGE, DEFAULT_LINEAGE, branchSig, at, label, refs)
  }
  loadDefaultBranches() { return this.loadTileBranches(DEFAULT_LINEAGE, DEFAULT_LINEAGE) }

  // ── logical install (union-recompute over enabled silos — NEVER a differential) ──

  /** Collect the content-sig refs contributed by branches in a lineage,
   *  optionally filtered to an enabled set of branchSigs. Walks tiles →
   *  branch entries → their refs[]. Disabled branches contribute nothing. */
  async #collectRefs(lineage: string, enabled?: Set<string>): Promise<Set<string>> {
    const out = new Set<string>()
    const root = await this.#currentHiveRoot(lineage)
    for (const tileSig of root.children) {
      const tile = await this.#loadJson<TileLayer>(tileSig)
      if (!tile) continue
      for (const entrySig of tile.children) {
        const entry = await this.#loadJson<BranchEntryLayer>(entrySig)
        if (!entry) continue
        if (enabled && !enabled.has(entry.branchSig)) continue   // disabled silo → excluded
        for (const ref of (entry.refs ?? [])) out.add(ref)
      }
    }
    return out
  }

  /** Recompute the logical install = union( default refs ∪ enabled domain refs ).
   *  This is a PURE FUNCTION of the enabled set — NEVER a differential. A sig
   *  survives iff some enabled silo (incl. the always-in default/own-data
   *  silo) references it, so turning off an overlapping feature can never
   *  remove content another enabled silo still needs. Materializes the union
   *  as the `logical` lineage HEAD (one marker per recompute = the undoable
   *  step). `enabledBranchSigs` undefined = treat all domain branches enabled. */
  async computeLogicalInstall(enabledBranchSigs?: Set<string>):
    Promise<{ refs: string[]; rootSig: string | null }> {
    await this.initialize()
    // default lineage = base / own data — ALWAYS in (not gated by enabled set)
    const union = await this.#collectRefs(DEFAULT_LINEAGE)
    // domains lineage = adopted — include only enabled branches
    const domainRefs = await this.#collectRefs(DOMAINS_LINEAGE, enabledBranchSigs)
    for (const r of domainRefs) union.add(r)
    const refs = [...union].sort()
    const rootSig = await this.#signJson({ name: LOGICAL_LINEAGE, refs })
    await this.#appendMarker(LOGICAL_LINEAGE, rootSig)
    return { refs, rootSig }
  }

  /** Read the current logical install's refs (the effective installed set). */
  async loadLogical(): Promise<string[]> {
    await this.initialize()
    const sig = await this.currentRootSig(LOGICAL_LINEAGE)
    if (!sig) return []
    const layer = await this.#loadJson<{ name: string; refs: string[] }>(sig)
    return layer?.refs ?? []
  }

  /** A read-only projection of the registry for the consumer surface
   *  (hypercomb.io) — what's effectively installed + which domains are
   *  present/visible. The hive uses `logical` as its render filter (only
   *  show/activate effectively-installed content) and direct-fetches the
   *  bytes itself. This is the control-plane → data-plane bridge: DCP owns
   *  the registry; the hive reads its projection. No bytes here, just the
   *  effective set + domain visibility. */
  async getRegistrySnapshot(): Promise<{
    logical: string[]
    logicalRootSig: string | null
    domains: { name: string; visible: boolean; branchCount: number }[]
    generatedAt: number
  }> {
    await this.initialize()
    const logical = await this.loadLogical()
    const logicalRootSig = await this.currentRootSig(LOGICAL_LINEAGE)
    const hive = await this.loadDomainsHive()
    const domains = hive.map(d => ({
      name: d.name,
      visible: this.isDomainVisible(d.name),
      branchCount: d.branchCount,
    }))
    return { logical, logicalRootSig, domains, generatedAt: Date.now() }
  }

  // ── save / branch / home-history (default → v1 → v2 …) ─────────────────────
  //
  // SAVE = freeze the current logical HEAD as a NAMED branch revision in the
  // home history. The logical is unchanged (it was already current — we only
  // take the named snapshot). RESTORE = make a saved (or default) logical
  // root the new logical HEAD via Make-HEAD append (forward, linear,
  // never truncates — per the append-only history model).

  /** Save the current logical HEAD under a name. Returns the home root sig. */
  async saveBranch(name: string): Promise<string | null> {
    await this.initialize()
    const logicalRoot = await this.currentRootSig(LOGICAL_LINEAGE)
    if (!logicalRoot) return null
    const count = await this.markerCount(HOME_LINEAGE)
    const label = String(name ?? '').trim() || `save-${count + 1}`
    // The home entry's branchSig = the frozen logical root sig (the snapshot).
    return this.addBranch(HOME_LINEAGE, HOME_LINEAGE, logicalRoot, [], label)
  }

  /** The home revision history: named branch saves, in save order.
   *  (`default` is the implicit base; restoreDefault() returns to it.) */
  async loadHomeHistory(): Promise<{ name: string; logicalRootSig: string }[]> {
    const branches = await this.loadTileBranches(HOME_LINEAGE, HOME_LINEAGE)
    return branches.map(b => ({ name: b.name, logicalRootSig: b.branchSig }))
  }

  /** Restore: make a saved logical root the current logical HEAD via
   *  Make-HEAD append (the saved state becomes current; history preserved). */
  async restoreLogicalRoot(logicalRootSig: string): Promise<void> {
    const sig = String(logicalRootSig ?? '').trim().toLowerCase()
    if (!SIG_RE.test(sig)) return
    await this.initialize()
    await this.#appendMarker(LOGICAL_LINEAGE, sig)
  }

  /** Restore to the base: recompute the logical with NO domains enabled, so
   *  only the `default` (base) refs remain — the restorable starting point. */
  async restoreDefault(): Promise<{ refs: string[]; rootSig: string | null }> {
    return this.computeLogicalInstall(new Set<string>())
  }

  // ── host-domains lineage (public wrappers) ─────────────────────────────────

  addHostDomain(host: string) { return this.addTile(HOST_DOMAINS_LINEAGE, host) }
  removeHostDomain(host: string) { return this.removeTile(HOST_DOMAINS_LINEAGE, host) }
  loadHostDomains() { return this.loadHive(HOST_DOMAINS_LINEAGE) }

  // ── settings lineage (kv, undoable — replaces localStorage) ────────────────

  async #currentSettings(): Promise<SettingsLayer> {
    const sig = await this.currentRootSig(SETTINGS_LINEAGE)
    if (!sig) return { name: SETTINGS_LINEAGE, values: {} }
    return (await this.#loadJson<SettingsLayer>(sig)) ?? { name: SETTINGS_LINEAGE, values: {} }
  }

  /** Load the settings HEAD into the in-memory cache for synchronous reads.
   *  Call once on init; reads thereafter hit the cache. */
  async loadSettingsCache(): Promise<Record<string, unknown>> {
    const layer = await this.#currentSettings()
    this.#settingsCache = { ...layer.values }
    return this.#settingsCache
  }

  /** Read a setting from the cache (sync). Loads-lazily-empty if the cache
   *  hasn't been warmed yet; call loadSettingsCache() on init for accuracy. */
  getSetting<T = unknown>(key: string, fallback: T): T {
    const cache = this.#settingsCache
    if (!cache || !(key in cache)) return fallback
    return cache[key] as T
  }

  /** Set a setting: update the cache synchronously (instant UI), then persist
   *  to the settings sigbag asynchronously (one marker = one undoable change).
   *  Returns the persist promise for callers that want to await durability. */
  setSetting(key: string, value: unknown): Promise<string | null> {
    if (!this.#settingsCache) this.#settingsCache = {}
    this.#settingsCache[key] = value
    return this.#persistSettings()
  }

  async #persistSettings(): Promise<string | null> {
    const values = { ...(this.#settingsCache ?? {}) }
    const newRootSig = await this.#signJson({ name: SETTINGS_LINEAGE, values })
    await this.#appendMarker(SETTINGS_LINEAGE, newRootSig)
    return newRootSig
  }

  // ── visibility (participant-local, now backed by the settings sigbag) ─────
  //
  // Key shape: `visibility.<domain>` = false when hidden (absent = visible).
  // Sync reads from the settings cache; writes persist to the undoable
  // settings sigbag. Replaces the prior localStorage-backed implementation.

  isDomainVisible(domain: string): boolean {
    const key = normalizeDomainKey(domain)
    return this.getSetting<boolean>(`visibility.${key}`, true) !== false
  }

  /** Toggle visibility. Optimistic cache update + async sigbag persist. */
  setDomainVisible(domain: string, visible: boolean): Promise<string | null> {
    const key = normalizeDomainKey(domain)
    if (!key) return Promise.resolve(null)
    if (!this.#settingsCache) this.#settingsCache = {}
    if (visible) delete this.#settingsCache[`visibility.${key}`]   // absent = visible
    else this.#settingsCache[`visibility.${key}`] = false
    return this.#persistSettings()
  }

  // ── feature enable/disable (participant-local) + logical recompute ────────
  //
  // Per-feature on/off is participant-local DECORATION (settings sigbag),
  // keyed by branchSig — NEVER written into the domain lineage content or a
  // canonical layer (so toggling pollutes nothing and never re-signs content).
  // Turning a feature off and recomputing the logical is the union-recompute:
  // the feature's silo leaves the enabled set; shared/own content survives.

  /** Default ENABLED unless explicitly turned off (absent key = on). */
  isFeatureEnabled(branchSig: string): boolean {
    const sig = String(branchSig ?? '').trim().toLowerCase()
    if (!SIG_RE.test(sig)) return false
    return this.getSetting<boolean>(`feature.${sig}`, true) !== false
  }

  /** Set + persist a feature's enabled flag (participant-local, sticky).
   *  Does NOT touch the domain lineage or content — only the settings sigbag. */
  setFeatureEnabled(branchSig: string, enabled: boolean): Promise<string | null> {
    const sig = String(branchSig ?? '').trim().toLowerCase()
    if (!SIG_RE.test(sig)) return Promise.resolve(null)
    if (!this.#settingsCache) this.#settingsCache = {}
    if (enabled) delete this.#settingsCache[`feature.${sig}`]    // absent = enabled
    else this.#settingsCache[`feature.${sig}`] = false
    return this.#persistSettings()
  }

  /** The set of currently-enabled branch sigs across all domain silos —
   *  derived from the participant-local feature flags. Feeds the logical
   *  recompute. (Default-enabled branches are included unless turned off.) */
  async enabledBranchSigs(): Promise<Set<string>> {
    await this.initialize()
    const set = new Set<string>()
    const root = await this.#currentHiveRoot(DOMAINS_LINEAGE)
    for (const tileSig of root.children) {
      const tile = await this.#loadJson<TileLayer>(tileSig)
      if (!tile) continue
      for (const entrySig of tile.children) {
        const entry = await this.#loadJson<BranchEntryLayer>(entrySig)
        if (!entry) continue
        if (this.isFeatureEnabled(entry.branchSig)) set.add(entry.branchSig)
      }
    }
    return set
  }

  /** Recompute the logical install from the CURRENT participant-local
   *  enabled set. Call after any toggle/adopt. This is the bridge from
   *  "feature on/off" to "logical reflects it" — union-recompute, never a
   *  differential. The domain lineage + content layers are untouched; only
   *  the `logical` lineage advances (the recompute) and the `settings`
   *  lineage holds the flags. */
  async recomputeLogical(): Promise<{ refs: string[]; rootSig: string | null }> {
    return this.computeLogicalInstall(await this.enabledBranchSigs())
  }
}
