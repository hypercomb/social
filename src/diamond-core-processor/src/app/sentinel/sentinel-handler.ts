// diamond-core-processor/src/app/sentinel/sentinel-handler.ts
//
// Headless message handler for the DCP sentinel.
// Receives content requests from hypercomb-web over a MessagePort,
// fetches from trusted domains, verifies signatures, and returns bytes.

import { inject, Injectable } from '@angular/core'
import { SignatureService } from '@hypercomb/core'
import { DcpDomainStorage } from '../core/dcp-domain-storage.service'
import { DcpInstallerService } from '../core/dcp-installer.service'
import { DcpStore } from '../core/dcp-store'
import { PatchStore } from '../core/patch-store'
import { collapseRevisions, identityKey } from '../core/revision-identity'
import { ToggleStateService } from '../core/toggle-state.service'
import { TreeResolverService } from '../core/tree-resolver.service'

const DOMAINS_KEY = 'dcp.domains'
const TOGGLE_KEY = 'dcp.toggleState'

export type SyncManifest = {
  syncSig: string
  bees: string[]
  dependencies: string[]
  layers: string[]
  beeDeps?: Record<string, string[]>
}

export type IntakeKind = 'layer' | 'bee' | 'dependency' | 'resource'

export type SentinelRequest =
  | { type: 'install'; rid: string; installedSig?: string; bundledBase?: string }
  | { type: 'sync'; rid: string; currentSyncSig?: string; have?: string[] }
  | { type: 'fetch-content'; rid: string; signature: string; kind: 'layer' | 'bee' | 'dependency'; rootSig: string }
  | { type: 'intake'; rid: string; signature: string; kind: IntakeKind; bytes: ArrayBuffer }
  // `save-branch` freezes the logical INSTALL root under a name. When
  // `sealSig` is present the caller is instead naming a HIVE CONTENT root
  // (a `sealSubtree([])` merkle sig pushed up from hypercomb) — a
  // different kind of "current", so it lands in its own lineage.
  | { type: 'save-branch'; rid: string; name?: string; sealSig?: string }
  // Adopt-by-signature resolution: the installer is the MESSENGER — give it a
  // signature, get back the domain(s) that can serve it. The hive then
  // interprets the location (`<domain>/<sig>`) and does the fetch itself.
  | { type: 'domains-for'; rid: string; signature?: string }
  // The deploy chains, so a hive can OFFER version choice without holding any
  // of what makes the choice safe. Read (`revisions`) and pick (`use-revision`)
  // are separate verbs because they are separate authorities: anything may ask
  // what exists; changing what runs is re-validated here before it lands.
  | { type: 'revisions'; rid: string; domain?: string }
  | { type: 'use-revision'; rid: string; domain: string; rootSig: string }
  | { type: 'backup-export'; rid: string }
  | { type: 'backup-import-file'; rid: string; path: string; sha256: string; bytes: ArrayBuffer }

export type SentinelResponse =
  | { type: 'result'; rid: string; ok: true; data: ArrayBuffer | string | object }
  | { type: 'result'; rid: string; ok: false; error: string }
  | { type: 'progress'; rid: string; phase: string; current: number; total: number }
  | { type: 'file'; rid: string; signature: string; kind: string; bytes: ArrayBuffer }
  | { type: 'install-done'; rid: string; manifest: object; rootSig: string; beeDeps?: Record<string, string[]> }
  | { type: 'sync-result'; rid: string; syncSig: string; add: { signature: string; kind: string; bytes: ArrayBuffer }[]; remove: { signature: string; kind: string }[] }
  | { type: 'intake-ack'; rid: string; ok: boolean; error?: string }
  | { type: 'save-branch-result'; rid: string; ok: boolean; rootSig?: string | null; error?: string }
  | { type: 'domains-result'; rid: string; ok: boolean; domains: string[]; error?: string }
  | { type: 'revisions-result'; rid: string; ok: boolean; groups: RevisionGroup[]; error?: string }
  | { type: 'use-revision-result'; rid: string; ok: boolean; error?: string }
  | { type: 'backup-file'; rid: string; path: string; sha256: string; bytes: ArrayBuffer }
  | { type: 'backup-done'; rid: string; ok: boolean; files: number; bytes: number; error?: string }
  | { type: 'backup-import-ack'; rid: string; ok: boolean; error?: string }

/** One host's published chain — every deployed root in its manifest, plus the
 *  one currently in effect for this participant. */
export type RevisionGroup = {
  domain: string
  activeRootSig: string
  revisions: { rootSig: string; label: string; deployedAt?: string }[]
}

/** Participant-local rename of a deployed version, same key the installer's own
 *  version-name editor writes (home.component). */
const LABEL_KEY_PREFIX = 'dcp:label:'

// Overlap ratio at or above which a later domain's package is judged to be
// the SAME logical package as one already collected (another deploy
// generation or an identical mirror). Generations of one package share most
// sigs (a deploy changes a handful of bundles); unrelated packages share
// approximately none — the wide gap makes the threshold insensitive.
const SAME_PACKAGE_OVERLAP = 0.5

@Injectable({ providedIn: 'root' })
export class SentinelHandler {

  #installer = inject(DcpInstallerService)
  #store = inject(DcpStore)
  #patchStore = inject(PatchStore)
  #toggleState = inject(ToggleStateService)
  #domainStorage = inject(DcpDomainStorage)
  #resolver = inject(TreeResolverService)

  async handle(msg: SentinelRequest, port: MessagePort): Promise<void> {
    switch (msg.type) {
      case 'install': return this.#handleInstall(msg, port)
      case 'sync': return this.#handleSync(msg, port)
      case 'fetch-content': return this.#handleFetchContent(msg, port)
      case 'intake': return this.#handleIntake(msg, port)
      case 'save-branch': return this.#handleSaveBranch(msg, port)
      case 'domains-for': return this.#handleDomainsFor(msg, port)
      case 'revisions': return this.#handleRevisions(msg, port)
      case 'use-revision': return this.#handleUseRevision(msg, port)
      case 'backup-export': return this.#handleBackupExport(msg, port)
      case 'backup-import-file': return this.#handleBackupImportFile(msg, port)
    }
  }

  async #handleBackupImportFile(
    msg: SentinelRequest & { type: 'backup-import-file' },
    port: MessagePort,
  ): Promise<void> {
    const parts = String(msg.path ?? '').split('/')
    const name = parts.pop()
    const valid = (part: string): boolean =>
      !!part && part !== '.' && part !== '..' && !/[\\/]/.test(part)
    if (!name || !valid(name) || !parts.every(valid)
        || !/^[a-f0-9]{64}$/.test(msg.sha256)) {
      port.postMessage({ type: 'backup-import-ack', rid: msg.rid, ok: false, error: 'unsafe path' })
      return
    }
    if (await SignatureService.sign(msg.bytes) !== msg.sha256) {
      port.postMessage({ type: 'backup-import-ack', rid: msg.rid, ok: false, error: 'hash mismatch' })
      return
    }
    try {
      await this.#store.initialize()
      let dir = this.#store.root
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
      let existing: ArrayBuffer | null = null
      try {
        existing = await (await (await dir.getFileHandle(name, { create: false })).getFile()).arrayBuffer()
      } catch { /* missing */ }
      if (existing) {
        if (await SignatureService.sign(existing) !== msg.sha256) {
          throw new Error('existing DCP file differs')
        }
      } else {
        const handle = await dir.getFileHandle(name, { create: true })
        const writable = await handle.createWritable()
        try { await writable.write(msg.bytes) } finally { await writable.close() }
        const readBack = await (await handle.getFile()).arrayBuffer()
        if (await SignatureService.sign(readBack) !== msg.sha256) {
          throw new Error('DCP restore read-back failed')
        }
      }
      port.postMessage({ type: 'backup-import-ack', rid: msg.rid, ok: true })
    } catch (error) {
      port.postMessage({
        type: 'backup-import-ack',
        rid: msg.rid,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Stream a byte-for-byte inventory of DCP's own OPFS. The receiver writes
   * these under a separate disk namespace; paths never enter the hive OPFS.
   * Every file carries its sha256 so the disk writer can verify read-back.
   */
  async #handleBackupExport(
    msg: SentinelRequest & { type: 'backup-export' },
    port: MessagePort,
  ): Promise<void> {
    try {
      await this.#store.initialize()
      let files = 0
      let bytes = 0
      const walk = async (dir: FileSystemDirectoryHandle, prefix = ''): Promise<void> => {
        for await (const [name, handle] of (dir as any).entries()) {
          if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) continue
          const path = prefix ? `${prefix}/${name}` : name
          if (handle.kind === 'directory') {
            await walk(handle as FileSystemDirectoryHandle, path)
            continue
          }
          const data = await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer()
          const sha256 = await SignatureService.sign(data)
          files++
          bytes += data.byteLength
          port.postMessage(
            { type: 'backup-file', rid: msg.rid, path, sha256, bytes: data },
            [data],
          )
          if (files % 25 === 0) {
            port.postMessage({
              type: 'progress',
              rid: msg.rid,
              phase: 'streaming DCP files',
              current: files,
              total: 0,
            })
          }
        }
      }
      await walk(this.#store.root)
      port.postMessage({ type: 'backup-done', rid: msg.rid, ok: true, files, bytes })
    } catch (error) {
      port.postMessage({
        type: 'backup-done',
        rid: msg.rid,
        ok: false,
        files: 0,
        bytes: 0,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Report the deploy chain per trusted host: every package root the host's
   * manifest publishes, plus the revision active for this participant.
   *
   * Read-only, and that is the point of it living here. The hive gets to DRAW a
   * version list without holding the trusted-domain list, without fetching a
   * manifest on its own origin, and without any way to invent a root that was
   * never deployed — the answer is assembled from what DCP already trusts.
   */
  async #handleRevisions(msg: SentinelRequest & { type: 'revisions' }, port: MessagePort): Promise<void> {
    try {
      const wanted = String(msg.domain ?? '').trim().toLowerCase()
      const groups: RevisionGroup[] = []

      for (const base of this.#loadDomains()) {
        let host: string
        try { host = new URL(base).hostname } catch { continue }
        if (wanted && host.toLowerCase() !== wanted) continue

        const packages = await this.#resolver.fetchPackages(base)
        if (!packages.length) continue

        // Newest first — the manifest's deploy timestamp is the only ordering
        // that means anything to a reader; sig order means nothing.
        const revisions = packages
          .map(pkg => ({
            rootSig: pkg.sig,
            label: this.#versionLabel(pkg.sig, pkg.label),
            deployedAt: pkg.at,
          }))
          .sort((a, b) => (b.deployedAt ?? '').localeCompare(a.deployedAt ?? ''))

        // '' ⇒ no explicit pick, and the sync path then takes the manifest's
        // default. Report the SAME sig that would actually be honoured rather
        // than leaving the list with nothing marked.
        const picked = (await this.#patchStore.activeRoot(host) ?? '').trim().toLowerCase()
        const activeRootSig = revisions.some(r => r.rootSig === picked) ? picked : (packages[0]?.sig ?? '')

        groups.push({ domain: host, activeRootSig, revisions })
      }

      port.postMessage({ type: 'revisions-result', rid: msg.rid, ok: true, groups })
    } catch (e) {
      port.postMessage({ type: 'revisions-result', rid: msg.rid, ok: false, groups: [], error: String((e as { message?: string })?.message ?? e) })
    }
  }

  /**
   * Make a published revision the active one for a host.
   *
   * RE-VALIDATED HERE, never trusted from the caller: the sig must be well
   * formed AND must be a root the host's own manifest actually publishes. A
   * caller that could name any sig would be able to point the sync path at
   * arbitrary content through an origin the participant trusts — which is the
   * whole reason the pick lives on this side of the port.
   */
  async #handleUseRevision(msg: SentinelRequest & { type: 'use-revision' }, port: MessagePort): Promise<void> {
    const fail = (error: string) => port.postMessage({ type: 'use-revision-result', rid: msg.rid, ok: false, error })
    try {
      const host = String(msg.domain ?? '').trim().toLowerCase()
      const rootSig = String(msg.rootSig ?? '').trim().toLowerCase()
      if (!host) return fail('missing domain')
      if (!/^[a-f0-9]{64}$/.test(rootSig)) return fail('invalid signature format')

      const base = this.#loadDomains().find(d => {
        try { return new URL(d).hostname.toLowerCase() === host } catch { return false }
      })
      if (!base) return fail(`not a trusted domain: ${host}`)

      const packages = await this.#resolver.fetchPackages(base)
      if (!packages.some(p => p.sig === rootSig)) return fail('signature is not a published root of that domain')

      await this.#patchStore.setActiveRoot(host, rootSig)
      port.postMessage({ type: 'use-revision-result', rid: msg.rid, ok: true })
    } catch (e) {
      fail(String((e as { message?: string })?.message ?? e))
    }
  }

  /** Deploy label for a version: the participant's local rename first (the same
   *  override the installer's editor writes), then the deploy-time name, then a
   *  short sig — never nothing. */
  #versionLabel(sig: string, deployLabel?: string): string {
    try {
      const local = localStorage.getItem(`${LABEL_KEY_PREFIX}${sig}`)
      if (local && local.trim()) return local.trim()
    } catch { /* storage unavailable — fall through */ }
    return (deployLabel ?? '').trim() || sig.slice(0, 8)
  }

  /**
   * Resolve the domain(s) that can serve a signature — the "installer as
   * messenger" half of adopt-by-signature. We return the participant's trusted
   * domain source-order (own origin first, then stored hosts); the hive then
   * interprets the location (`<domain>/<sig>` flat, or the typed fallback) and
   * fetches the bytes itself, sha256-gating every one. Returning the candidate
   * list (not a single resolved host) lets the hive try them in order and fall
   * through on a miss, exactly like #fetchFromDomains does internally.
   */
  async #handleDomainsFor(msg: SentinelRequest & { type: 'domains-for' }, port: MessagePort): Promise<void> {
    try {
      const domains = this.#loadDomains()
      port.postMessage({ type: 'domains-result', rid: msg.rid, ok: true, domains })
    } catch (e) {
      port.postMessage({ type: 'domains-result', rid: msg.rid, ok: false, domains: [], error: String((e as { message?: string })?.message ?? e) })
    }
  }

  /**
   * Freeze the current logical HEAD as a named branch revision in the
   * home history — the "Save" action from the hive's controls bar. By
   * the time this fires the web side has drained its push queue, so
   * every leaf the frozen root references is already present in DCP and
   * the branch will dereference cleanly for peers. Replies with the new
   * home root sig, or ok:false on failure.
   */
  async #handleSaveBranch(msg: SentinelRequest & { type: 'save-branch' }, port: MessagePort): Promise<void> {
    try {
      const seal = String(msg.sealSig ?? '').trim().toLowerCase()
      const rootSig = /^[a-f0-9]{64}$/.test(seal)
        ? await this.#domainStorage.saveHiveSnapshot((msg.name ?? '').toString(), seal)
        : await this.#domainStorage.saveBranch((msg.name ?? '').toString())
      port.postMessage({ type: 'save-branch-result', rid: msg.rid, ok: !!rootSig, rootSig: rootSig ?? null })
    } catch (e) {
      console.warn('[sentinel] save-branch failed', e)
      port.postMessage({ type: 'save-branch-result', rid: msg.rid, ok: false, error: String((e as { message?: string })?.message ?? e) })
    }
  }

  async #handleInstall(msg: SentinelRequest & { type: 'install' }, port: MessagePort): Promise<void> {
    const domains = this.#loadDomains()
    // The caller's bundled content base is a LAST-RESORT content domain —
    // "bundled" is just a domain like any other (the shell ships
    // /content/manifest.json + flat sig files). Lets a fresh participant
    // complete the first run with zero network beyond their own origin;
    // sha256 verification gates the bytes exactly like every other source.
    const bundled = (msg.bundledBase ?? '').trim()
    if (/^https?:\/\//i.test(bundled) && !domains.includes(bundled)) domains.push(bundled)
    if (!domains.length) {
      port.postMessage({ type: 'result', rid: msg.rid, ok: false, error: 'No trusted domains configured in DCP' })
      return
    }

    await this.#store.initialize()

    for (const domain of domains) {
     try {
      const rootSig = await this.#fetchRootSignature(domain)
      if (!rootSig) continue

      // Skip install if caller already has this signature
      if (msg.installedSig && msg.installedSig === rootSig) {
        port.postMessage({ type: 'install-done', rid: msg.rid, manifest: {}, rootSig, beeDeps: undefined })
        return
      }

      // Guarded: a malformed stored domain (e.g. a bare host with no
      // protocol) makes `new URL` THROW — and an escaped throw here meant
      // NO reply was ever posted, so the caller's install promise hung
      // forever ("Starting…" that never finishes). The per-domain
      // try/catch turns any bad entry into "skip to the next source".
      const domainName = new URL(domain).hostname
      const manifest = await this.#installer.install(domain, rootSig, domainName, (p) => {
        port.postMessage({ type: 'progress', rid: msg.rid, phase: p.phase, current: p.current, total: p.total })
      })

      if (!manifest) continue

      // REGISTER the installed package in the registry. The hive can RUN
      // content streamed straight into pools, but only a recorded branch is
      // visible/manageable in the installer tree — without this the
      // installer looked empty while everything ran ("how is it running if
      // there are no modules installed"). Branch root = the package's root
      // LAYER (the one no other layer references) so the section resolves
      // and walks exactly like an adopted branch, every feature toggleable
      // from the start. Enabled by default: installing IS the
      // participant's intent to use (same doctrine as adopt auto-enable);
      // the master switch stays one click to turn anything off.
      try {
        const rootLayer = await this.#findPackageRootLayer(domainName, (manifest as { layers?: string[] }).layers ?? [])
        if (rootLayer) {
          // 'package' — a manifest install is functionality provenance: its
          // refs join the logical union, but it never renders visual tiles.
          await this.#domainStorage.addDomainBranch(domainName, rootLayer, [], domainName, undefined, 'package')
          await this.#domainStorage.setFeatureEnabled(rootLayer, true)
          await this.#domainStorage.recomputeLogical()
        }
      } catch (e) {
        console.warn('[sentinel] baseline registry record failed', e)
      }

      // Stream verified files back to web
      await this.#streamFiles(port, msg.rid, domain, rootSig, manifest)

      port.postMessage({
        type: 'install-done',
        rid: msg.rid,
        manifest,
        rootSig,
        beeDeps: (manifest as any).beeDeps
      })
      return
     } catch (e) {
      // One bad source must never kill the whole install — and must NEVER
      // leave the request unanswered (the caller would hang). Skip to the
      // next candidate; the ok:false post below covers total failure.
      console.warn('[sentinel] install attempt failed for', domain, e)
      continue
     }
    }

    port.postMessage({ type: 'result', rid: msg.rid, ok: false, error: 'No content found on any trusted domain' })
  }

  /** The package's root layer: the one no other layer in the package
   *  references as a child. Children live in `cells` (canonical) or
   *  `layers`/`children` (legacy) — mirrors the resolver's acceptance. */
  async #findPackageRootLayer(domainName: string, layerSigs: string[]): Promise<string | null> {
    if (!layerSigs.length) return null
    const dir = await this.#store.domainLayersDir(domainName)
    const referenced = new Set<string>()
    for (const sig of layerSigs) {
      const bytes = await this.#store.readFile(dir, sig)
        ?? await this.#store.readFile(dir, `${sig}.json`)
      if (!bytes) continue
      try {
        const layer = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
        const kids = Array.isArray(layer?.['cells']) ? layer['cells'] as unknown[]
          : Array.isArray(layer?.['layers']) ? layer['layers'] as unknown[]
          : Array.isArray(layer?.['children']) ? layer['children'] as unknown[]
          : []
        for (const k of kids) if (typeof k === 'string') referenced.add(k.toLowerCase())
      } catch { /* unparsable layer — skip */ }
    }
    const roots = layerSigs.filter(s => !referenced.has(String(s).toLowerCase()))
    return roots[0] ?? null
  }

  /**
   * Sync: compute what's enabled in DCP toggles, diff against web's current state,
   * and send only the adds/removes needed. Uses a sync signature to short-circuit
   * when already in sync.
   */
  async #handleSync(msg: SentinelRequest & { type: 'sync' }, port: MessagePort): Promise<void> {
    await this.#store.initialize()

    // Build the effective manifest from all installed domains + toggle state
    const syncManifest = await this.#computeSyncManifest()

    // Short-circuit if already in sync
    if (msg.currentSyncSig && msg.currentSyncSig === syncManifest.syncSig) {
      port.postMessage({
        type: 'sync-result',
        rid: msg.rid,
        syncSig: syncManifest.syncSig,
        add: [],
        remove: []
      })
      return
    }

    // INCREMENTAL DELTA. The hive tells us which sigs it already holds in OPFS
    // via `msg.have`; we stream ONLY the enabled files it's MISSING — not the
    // whole enabled set on every change. Content is sig-addressed, so a sig the
    // hive already holds is by definition the correct bytes — re-streaming it
    // each sync was the "clear and install everytime" inefficiency. The
    // sync-result below still reports the FULL enabled arrays, so the hive's
    // stale-GC (removeDisabled) and cached manifest stay correct — only the
    // BYTES are deltaed. `have` empty/absent (older hive) ⇒ stream all (the
    // prior behavior), so this is backward compatible.
    const have = new Set((msg.have ?? []).map(s => String(s).trim().toLowerCase()))
    const add: { signature: string; kind: string; bytes: ArrayBuffer }[] = []
    let skipped = 0

    const domains = this.#loadDomains()

    for (const sig of syncManifest.bees) {
      if (have.has(sig.toLowerCase())) { skipped++; continue }
      let bytes = await this.#store.readFile(this.#store.bees, `${sig}.js`)
        ?? await this.#store.readFile(this.#store.bees, sig)
      if (!bytes) bytes = await this.#fetchFromDomains(domains, sig, 'bee')
      if (bytes) add.push({ signature: sig, kind: 'bee', bytes })
    }

    for (const sig of syncManifest.dependencies) {
      if (have.has(sig.toLowerCase())) { skipped++; continue }
      let bytes = await this.#store.readFile(this.#store.dependencies, `${sig}.js`)
        ?? await this.#store.readFile(this.#store.dependencies, sig)
      if (!bytes) bytes = await this.#fetchFromDomains(domains, sig, 'dependency')
      if (bytes) add.push({ signature: sig, kind: 'dependency', bytes })
    }

    for (const sig of syncManifest.layers) {
      if (have.has(sig.toLowerCase())) { skipped++; continue }
      let bytes: ArrayBuffer | null = null
      for (const domain of domains) {
        const domainName = new URL(domain).hostname
        const dir = await this.#store.domainLayersDir(domainName)
        bytes = await this.#store.readFile(dir, sig)
          ?? await this.#store.readFile(dir, `${sig}.json`)
        if (bytes) break
      }
      if (!bytes) bytes = await this.#fetchFromDomains(domains, sig, 'layer')
      if (bytes) add.push({ signature: sig, kind: 'layer', bytes })
    }

    // Log the delta — streamed vs skipped (already on the hive).
    console.log(`[sentinel] sync delta: streaming ${add.length} file(s), skipped ${skipped} already-present`)
    for (const item of add) {
      console.log(`  [${item.signature}] ${item.kind}`)
    }

    // Transfer files — web will diff against its own OPFS
    for (const item of add) {
      port.postMessage(
        { type: 'file', rid: msg.rid, signature: item.signature, kind: item.kind, bytes: item.bytes },
        [item.bytes]
      )
    }

    port.postMessage({
      type: 'sync-result',
      rid: msg.rid,
      syncSig: syncManifest.syncSig,
      add: [],  // files already streamed above
      remove: [],
      enabledBees: syncManifest.bees,
      enabledDeps: syncManifest.dependencies,
      enabledLayers: syncManifest.layers,
      beeDeps: syncManifest.beeDeps
    })
  }

  /**
   * Walk all installed manifests, filter by toggle state,
   * and produce the set of enabled signatures + a sync signature.
   *
   * Tree-aware: walks each domain's layer tree from root, skipping
   * whole subtrees whose layer signature is toggled off. Per-bee and
   * per-dep toggles are independent gates applied within enabled
   * layers. Both must pass for a bee/dep to be included.
   */
  async #computeSyncManifest(): Promise<SyncManifest> {
    const enabledBees = new Set<string>()
    const enabledDeps = new Set<string>()
    const enabledLayers = new Set<string>()
    const allBeeDeps: Record<string, string[]> = {}

    const domains = this.#loadDomains()
    const toggles = this.#loadToggles()

    // sig → identity for every bee collected, plus the order/rank needed to
    // pick a winner when one identity arrives under two signatures. Rank is
    // the domain's index in #loadDomains() — the canonical origin first, the
    // same precedence the overlap guard below relies on.
    const beeIdentity = new Map<string, string>()
    const beeRank = new Map<string, { rank: number, order: number }>()
    let beeOrder = 0

    for (const [domainIndex, domain] of domains.entries()) {
      const domainName = new URL(domain).hostname
      if (toggles[domain] === false || toggles[domainName] === false) continue

      const rootSig = await this.#fetchRootSignature(domain)
      if (!rootSig) continue

      const manifest = await this.#readCachedManifest(domain, rootSig)
      if (!manifest) continue

      const beeDeps: Record<string, string[]> = manifest.beeDeps ?? {}
      const visited = new Set<string>()

      // Collect this domain's contribution in ISOLATION first, so a
      // cross-domain generation skew is detectable before it pollutes
      // the union. Two trusted domains serving different DEPLOY
      // GENERATIONS of the same package (own origin fresh, a stored
      // operator host stale — or vice versa) would otherwise union
      // newGen ∪ oldGen; the shell then installs and loads BOTH
      // bundles of every changed drone, and the duplicate instances
      // fight over IoC keys and the canvas.
      const domainBees: string[] = []
      const domainDeps = new Set<string>()
      const domainLayers: string[] = []
      const domainBeeDeps: Record<string, string[]> = {}

      await this.#walkEnabled(
        rootSig,
        domain,
        domainName,
        toggles,
        beeDeps,
        domainBees,
        domainDeps,
        domainLayers,
        domainBeeDeps,
        visited,
        beeIdentity,
      )

      // First-source-wins across domains for the SAME logical package.
      // There is no version field to rank recency (the build omits one
      // deliberately), so precedence is #loadDomains() order — canonical
      // origin first, by design. A later domain whose package mostly
      // overlaps what's already collected is the same package at another
      // generation (or an identical mirror), not new content: skip it
      // whole. Genuinely different packages (community modules) share
      // few or no sigs and merge normally.
      const candidate = new Set([...domainBees, ...domainLayers])
      const collectedSize = enabledBees.size + enabledLayers.size
      if (candidate.size > 0 && collectedSize > 0) {
        let shared = 0
        for (const sig of candidate) {
          if (enabledBees.has(sig) || enabledLayers.has(sig)) shared++
        }
        const overlap = shared / candidate.size
        if (overlap >= SAME_PACKAGE_OVERLAP) {
          const dropped = candidate.size - shared
          if (dropped > 0) {
            console.log(
              `[sentinel] sync: skipping ${domainName} root ${rootSig.slice(0, 12)} — `
              + `${(overlap * 100).toFixed(0)}% of its package is already provided by an earlier source; `
              + `treating its ${dropped} differing sig(s) as another generation of the same package, not new content`,
            )
          }
          continue
        }
      }

      for (const sig of domainBees) {
        enabledBees.add(sig)
        if (!beeRank.has(sig)) beeRank.set(sig, { rank: domainIndex, order: beeOrder++ })
      }
      for (const sig of domainDeps) enabledDeps.add(sig)
      for (const sig of domainLayers) enabledLayers.add(sig)
      Object.assign(allBeeDeps, domainBeeDeps)
    }

    // ONE REVISION PER DRONE. The overlap guard above is a whole-domain
    // heuristic — it catches a wholesale generation skew between two sources
    // and nothing else. This is the exact rule underneath it: when the same
    // artifact (`<lineage>/<ClassName>`) is enabled under two signatures —
    // from two sections of one domain, a partial overlap the heuristic let
    // through, or a stale sig left enabled by the opt-OUT toggle default —
    // only one may ship. Both bundles reaching the shell is the failure this
    // exists to prevent: the preloader loads both, and the duplicate instances
    // fight over the IoC key and the canvas.
    //
    // BEES ONLY. Dependencies are module aliases, not instantiated drones, so
    // a duplicate costs an import-map entry rather than a second live drone —
    // and pruning one that a surviving bee still imports would break loading.
    // Layers are inert refs, same reasoning.
    const { losers: staleBees } = collapseRevisions(
      [...enabledBees].map(sig => ({
        sig,
        identity: beeIdentity.get(sig) ?? null,
        rank: beeRank.get(sig)?.rank ?? Number.MAX_SAFE_INTEGER,
        order: beeRank.get(sig)?.order ?? Number.MAX_SAFE_INTEGER,
        item: sig,
      })),
    )
    for (const sig of staleBees) {
      enabledBees.delete(sig)
      delete allBeeDeps[sig]
    }
    if (staleBees.size) {
      console.log(`[sentinel] sync: dropped ${staleBees.size} superseded bee revision(s) — `
        + `a newer generation of each is already in this manifest`)
    }

    const beesList = [...enabledBees].sort()
    const depsList = [...enabledDeps].sort()
    const layersList = [...enabledLayers].sort()
    const allSigs = [...beesList, ...depsList, ...layersList]
    const syncSig = await SignatureService.sign(new TextEncoder().encode(allSigs.join(',')).buffer as ArrayBuffer)

    return { syncSig, bees: beesList, dependencies: depsList, layers: layersList, beeDeps: allBeeDeps }
  }


  /**
   * Recursive walk: descend the layer tree, skip subtrees whose layer
   * is toggled off. Bees and deps inside a disabled layer never get
   * added; bees/deps inside an enabled layer pass their own toggle
   * gate before being collected.
   */
  async #walkEnabled(
    layerSig: string,
    domain: string,
    domainName: string,
    toggles: Record<string, boolean>,
    beeDeps: Record<string, string[]>,
    enabledBees: string[],
    enabledDeps: Set<string>,
    enabledLayers: string[],
    allBeeDeps: Record<string, string[]>,
    visited: Set<string>,
    beeIdentity: Map<string, string>,
    parentLineage = '',
  ): Promise<void> {
    if (visited.has(layerSig)) return
    visited.add(layerSig)

    if (toggles[layerSig] === false) return

    const layer = await this.#readLayerJson(domain, domainName, layerSig)
    if (!layer) return

    enabledLayers.push(layerSig)

    // Lineage for IDENTITY only. Built from layer names exactly as the
    // installer's resolver builds it, but the two are never compared with each
    // other — identity is only ever compared inside a single collapse pass, so
    // an off-by-one root segment between the two services is harmless.
    const lineage = parentLineage ? `${parentLineage}/${layer.name ?? ''}` : (layer.name ?? '')

    for (const raw of (layer.bees ?? [])) {
      const sig = raw.replace(/\.js$/i, '')
      if (toggles[sig] === false) continue
      const className = layer.docs?.bees?.[sig]?.className
      const identity = identityKey(lineage, className)
      if (identity) beeIdentity.set(sig, identity)
      enabledBees.push(sig)
      const deps = beeDeps[sig] ?? []
      for (const dep of deps) {
        if (toggles[dep] === false) continue
        enabledDeps.add(dep)
      }
      if (deps.length) allBeeDeps[sig] = deps
    }

    for (const raw of (layer.dependencies ?? [])) {
      const sig = raw.replace(/\.js$/i, '')
      if (enabledDeps.has(sig)) continue
      if (toggles[sig] === false) continue
      enabledDeps.add(sig)
    }

    const children: string[] = layer.cells ?? layer.layers ?? layer.children ?? []
    for (const childSig of children) {
      await this.#walkEnabled(
        childSig,
        domain,
        domainName,
        toggles,
        beeDeps,
        enabledBees,
        enabledDeps,
        enabledLayers,
        allBeeDeps,
        visited,
        beeIdentity,
        lineage,
      )
    }
  }

  /**
   * Read a single layer JSON for the tree-walk. Tries DCP's OPFS cache
   * first (the domain's identity scope); on miss, fetches from the domain
   * (flat `/<sig>` first, legacy `__layers__/<sig>.json` fallback for
   * un-migrated hosts), verifies the hash, and writes it back to OPFS so
   * the next walk hits the cache. This is the path that lets a
   * freshly-deployed essentials
   * (new rootSig, new layer signatures) propagate through sync without
   * needing DCP to re-run a full install first.
   */
  async #readLayerJson(
    domain: string,
    domainName: string,
    layerSig: string,
  ): Promise<{
    name?: string
    docs?: { bees?: Record<string, { className?: string }> }
    bees?: string[]
    dependencies?: string[]
    cells?: string[]
    layers?: string[]
    children?: string[]
  } | null> {
    try {
      const dir = await this.#store.domainLayersDir(domainName)
      let bytes =
        await this.#store.readFile(dir, layerSig)
        ?? await this.#store.readFile(dir, `${layerSig}.json`)
      if (!bytes) {
        bytes = await this.#fetchAndVerify(domain, '', layerSig, 'layer')
        if (!bytes) return null
        try { await this.#store.writeFile(dir, layerSig, bytes) } catch { /* non-fatal */ }
      }
      return JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      return null
    }
  }

  async #readCachedManifest(domain: string, rootSig: string): Promise<any> {
    // Always fetch fresh — manifest lives in public/ and must reflect the latest deploy
    try {
      const res = await fetch(`${domain}/manifest.json`, { cache: 'no-store' })
      if (res.ok) {
        const content = await res.json()
        return content?.packages?.[rootSig] ?? null
      }
    } catch { /* fall through to OPFS cache */ }

    // Offline fallback: read from DCP's OPFS cache
    const domainName = new URL(domain).hostname
    const dir = await this.#store.domainLayersDir(domainName)
    const bytes = await this.#store.readFile(dir, 'manifest.cache.json')
    if (bytes) {
      try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { /* ignore */ }
    }
    return null
  }

  #loadToggles(): Record<string, boolean> {
    try {
      const raw = localStorage.getItem(TOGGLE_KEY)
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  }

  /**
   * Receive a sig + bytes from hypercomb-web. Verify the hash, write
   * to the sign('from-hypercomb') pool's sign(kind) sub-pool, append to
   * the provenance index, broadcast on `dcp-from-hypercomb` so any DCP
   * main tab refreshes its tree, and ack.
   *
   * On ack=false the web side leaves the queue entry in place; next
   * drain will retry. So this method is conservative: any failure
   * returns ok=false rather than swallowing.
   */
  async #handleIntake(msg: SentinelRequest & { type: 'intake' }, port: MessagePort): Promise<void> {
    const { rid, signature, kind, bytes } = msg

    if (!/^[a-f0-9]{64}$/.test(signature)) {
      port.postMessage({ type: 'intake-ack', rid, ok: false, error: 'invalid signature format' })
      return
    }

    const actual = await SignatureService.sign(bytes)
    if (actual !== signature) {
      console.warn(`[sentinel] intake hash mismatch: expected ${signature}, got ${actual}`)
      port.postMessage({ type: 'intake-ack', rid, ok: false, error: 'hash mismatch' })
      return
    }

    try {
      await this.#store.initialize()
      const dir = await this.#store.fromHypercombKindDir(kind)
      const fileName = this.#intakeFileName(signature, kind)
      await this.#store.writeFile(dir, fileName, bytes)
      await this.#appendIntakeIndex(signature, kind)
    } catch (e) {
      console.warn(`[sentinel] intake write failed for ${signature.slice(0, 12)}`, e)
      port.postMessage({ type: 'intake-ack', rid, ok: false, error: 'write failed' })
      return
    }

    port.postMessage({ type: 'intake-ack', rid, ok: true })

    try {
      const channel = new BroadcastChannel('dcp-from-hypercomb')
      channel.postMessage({ signature, kind, at: Date.now() })
      channel.close()
    } catch { /* BroadcastChannel unavailable — UI will pick up on next reload */ }
  }

  #intakeFileName(signature: string, kind: IntakeKind): string {
    if (kind === 'layer') return signature
    if (kind === 'resource') return signature
    return `${signature}.js`
  }

  /**
   * Append-only provenance index. Each line is a JSON record. Cheap to
   * write (no read-modify-write parsing), trivially recoverable, and
   * tolerant of partial writes — a corrupt last line just gets
   * skipped on read.
   */
  async #appendIntakeIndex(signature: string, kind: IntakeKind): Promise<void> {
    const dir = await this.#store.fromHypercombDir()
    const handle = await dir.getFileHandle('index.jsonl', { create: true })
    const file = await handle.getFile()
    const existing = await file.arrayBuffer()
    const record = JSON.stringify({ signature, kind, at: Date.now() }) + '\n'
    const recordBytes = new TextEncoder().encode(record)
    const merged = new Uint8Array(existing.byteLength + recordBytes.byteLength)
    merged.set(new Uint8Array(existing), 0)
    merged.set(recordBytes, existing.byteLength)
    const writable = await handle.createWritable()
    try { await writable.write(merged) } finally { await writable.close() }
  }

  async #handleFetchContent(msg: SentinelRequest & { type: 'fetch-content' }, port: MessagePort): Promise<void> {
    await this.#store.initialize()

    const { signature, kind, rid } = msg

    // Check DCP's OPFS cache first
    const dir = this.#dirForKind(kind)
    if (dir) {
      const fileName = kind === 'layer' ? signature : `${signature}.js`
      const cached = await this.#store.readFile(dir, fileName)
      if (cached) {
        port.postMessage(
          { type: 'result', rid, ok: true, data: cached } as SentinelResponse,
          [cached]
        )
        return
      }
    }

    // Fetch from trusted domains
    const domains = this.#loadDomains()
    for (const domain of domains) {
      const rootSig = msg.rootSig || await this.#fetchRootSignature(domain)
      if (!rootSig) continue

      const bytes = await this.#fetchAndVerify(domain, rootSig, signature, kind)
      if (bytes) {
        // Cache in DCP's OPFS
        if (dir) {
          const fileName = kind === 'layer' ? signature : `${signature}.js`
          await this.#store.writeFile(dir, fileName, bytes)
        }

        port.postMessage(
          { type: 'result', rid, ok: true, data: bytes } as SentinelResponse,
          [bytes]
        )
        return
      }
    }

    port.postMessage({ type: 'result', rid, ok: false, error: `Content not found: ${signature}` })
  }

  async #streamFiles(
    port: MessagePort,
    rid: string,
    domain: string,
    rootSig: string,
    manifest: any
  ): Promise<void> {
    const domainName = new URL(domain).hostname

    // Stream layers
    for (const sig of (manifest.layers ?? [])) {
      const domainDir = await this.#store.domainLayersDir(domainName)
      const bytes = await this.#store.readFile(domainDir, sig)
        ?? await this.#store.readFile(domainDir, `${sig}.json`)
      if (bytes) {
        port.postMessage({ type: 'file', rid, signature: sig, kind: 'layer', bytes }, [bytes])
      }
    }

    // Stream bees
    for (const sig of (manifest.bees ?? [])) {
      const bytes = await this.#store.readFile(this.#store.bees, `${sig}.js`)
        ?? await this.#store.readFile(this.#store.bees, sig)
      if (bytes) {
        port.postMessage({ type: 'file', rid, signature: sig, kind: 'bee', bytes }, [bytes])
      }
    }

    // Stream dependencies
    for (const sig of (manifest.dependencies ?? [])) {
      const bytes = await this.#store.readFile(this.#store.dependencies, `${sig}.js`)
        ?? await this.#store.readFile(this.#store.dependencies, sig)
      if (bytes) {
        port.postMessage({ type: 'file', rid, signature: sig, kind: 'dependency', bytes }, [bytes])
      }
    }
  }

  #dirForKind(kind: string): FileSystemDirectoryHandle | null {
    switch (kind) {
      case 'bee': return this.#store.bees
      case 'dependency': return this.#store.dependencies
      default: return null  // layers need domain-scoped dir, handled separately
    }
  }

  async #fetchFromDomains(domains: string[], sig: string, kind: 'layer' | 'bee' | 'dependency'): Promise<ArrayBuffer | null> {
    for (const domain of domains) {
      const bytes = await this.#fetchAndVerify(domain, '', sig, kind)
      if (bytes) return bytes
    }
    return null
  }

  async #fetchAndVerify(
    base: string,
    rootSig: string,
    sig: string,
    kind: 'layer' | 'bee' | 'dependency'
  ): Promise<ArrayBuffer | null> {
    // FLAT heap first: `/<sig>` is the canonical address (one bucket, no
    // typed pools, no extensions — sha256 below is the gate). Host-sync
    // pushes land flat, so freshly-backed-up content only resolves there.
    // The typed path is the legacy fallback for hosts that haven't
    // migrated (static layouts: Azure blob, ng-serve public/content).
    const ext = kind === 'layer' ? '.json' : '.js'
    const folder = kind === 'layer' ? '__layers__' : kind === 'bee' ? '__bees__' : '__dependencies__'
    for (const url of [`${base}/${sig}`, `${base}/${folder}/${sig}${ext}`]) {
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) continue
        // SPA fallback guard: sig-addressed bytes are never text/html.
        if ((res.headers.get('content-type') || '').toLowerCase().includes('text/html')) continue

        const bytes = await res.arrayBuffer()
        const actual = await SignatureService.sign(bytes)
        if (actual !== sig) {
          console.error(`[sentinel] signature mismatch: expected ${sig}, got ${actual}`)
          continue
        }
        return bytes
      } catch {
        // network error on this shape — try the next
      }
    }
    return null
  }

  async #fetchRootSignature(base: string): Promise<string | null> {
    try {
      const res = await fetch(`${base}/manifest.json`, { cache: 'no-store' })
      if (!res.ok) return null
      const content = await res.json()
      const clean = (s: string) => s?.replace(/\uFEFF/g, '').trim().toLowerCase()
      const valid = (s: string | null | undefined): s is string => !!s && /^[a-f0-9]{64}$/i.test(s)
      const packages = (content?.packages ?? {}) as Record<string, { at?: string }>
      const sigs = Object.keys(packages).map(clean).filter(valid)
      if (!sigs.length) return null

      // Honor the chosen revision: when active.json names a DEPLOYED package
      // (present in this manifest), sync THAT root instead of the default \u2014
      // this is what makes "move between revisions" reach the running hive,
      // not just the installer's display. A patch root (local-only, not in
      // the manifest) or an absent/invalid pick falls back to the default
      // package, so existing single-version / no-pick flows are unchanged.
      const active = clean(await this.#patchStore.activeRoot(new URL(base).hostname) ?? '')
      if (valid(active) && sigs.includes(active)) return active

      // No explicit pick: the NEWEST deploy, the same fallback the installer's
      // revision pick uses. These two must agree — when they don't, the
      // installer displays one revision while the hive runs another. `at` is
      // ISO so it sorts chronologically; entries without it keep manifest key
      // order, which is the pre-`at` behaviour (build-module writes a
      // single-package manifest; the deploy merge puts the new package first).
      const deployedAt = new Map<string, string>()
      for (const [key, entry] of Object.entries(packages)) {
        const sig = clean(key)
        if (valid(sig)) deployedAt.set(sig, typeof entry?.at === 'string' ? entry.at : '')
      }
      // Stable sort: entries with no `at` tie at '' and keep manifest key order.
      const newest = [...sigs].sort((a, b) => (deployedAt.get(b) ?? '').localeCompare(deployedAt.get(a) ?? ''))
      return newest[0]
    } catch {
      return null
    }
  }

  #loadDomains(): string[] {
    // SOURCE-OF-TRUTH ORDER for the default package:
    //   1. DCP's OWN ORIGIN — the installer app and its default package
    //      deploy together (diamondcoreprocessor.com in production, the
    //      dev server locally; copy-to-dcp stages manifest.json + the
    //      flat sig dirs at the origin root), so deploying DCP IS
    //      publishing the default content. The canonical origin outranks
    //      stored hosts here: a participant/dev-seeded host serving a
    //      stale manifest must not shadow the baseline (Azure-first had
    //      exactly that bug; jwize-seeded dev hit it again).
    //   2. participant-stored domains — additional content sources.
    // No central-storage tier: Azure is retired (domain-as-identity —
    // operator domains are the hosts). The caller's bundledBase, appended
    // in #handleInstall, already covers the fresh cold start.
    const own = globalThis.location?.origin ?? ''
    const out: string[] = []
    if (own) out.push(own)
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(DOMAINS_KEY) ?? '[]')
      if (Array.isArray(stored)) {
        for (const d of stored) if (typeof d === 'string' && d && !out.includes(d)) out.push(d)
      }
    } catch { /* malformed — fall through to defaults */ }
    return out
  }
}
