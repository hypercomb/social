// diamond-core-processor/src/app/sentinel/sentinel-handler.ts
//
// Headless message handler for the DCP sentinel.
// Receives content requests from hypercomb-web over a MessagePort,
// fetches from trusted domains, verifies signatures, and returns bytes.

import { inject, Injectable } from '@angular/core'
import { SignatureService } from '@hypercomb/core'
import { DcpInstallerService } from '../core/dcp-installer.service'
import { DcpStore } from '../core/dcp-store'
import { ToggleStateService } from '../core/toggle-state.service'

const DOMAINS_KEY = 'dcp.domains'
const TOGGLE_KEY = 'dcp.toggleState'

export type SyncManifest = {
  syncSig: string
  bees: string[]
  dependencies: string[]
  layers: string[]
  beeDeps?: Record<string, string[]>
  /** Bee sigs whose source declared `static readonly bootPriority = true`.
   *  Carried through the sync so ScriptPreloader can prioritise them on
   *  the web side. Always intersected with enabled bees so a disabled
   *  drone never appears here. */
  bootPriority?: string[]
}

export type IntakeKind = 'layer' | 'bee' | 'dependency' | 'resource'

export type SentinelRequest =
  | { type: 'install'; rid: string; installedSig?: string }
  | { type: 'sync'; rid: string; currentSyncSig?: string }
  | { type: 'fetch-content'; rid: string; signature: string; kind: 'layer' | 'bee' | 'dependency'; rootSig: string }
  | { type: 'intake'; rid: string; signature: string; kind: IntakeKind; bytes: ArrayBuffer }

export type SentinelResponse =
  | { type: 'result'; rid: string; ok: true; data: ArrayBuffer | string | object }
  | { type: 'result'; rid: string; ok: false; error: string }
  | { type: 'progress'; rid: string; phase: string; current: number; total: number }
  | { type: 'file'; rid: string; signature: string; kind: string; bytes: ArrayBuffer }
  | { type: 'install-done'; rid: string; manifest: object; rootSig: string; beeDeps?: Record<string, string[]> }
  | { type: 'sync-result'; rid: string; syncSig: string; add: { signature: string; kind: string; bytes: ArrayBuffer }[]; remove: { signature: string; kind: string }[] }
  | { type: 'intake-ack'; rid: string; ok: boolean; error?: string }

@Injectable({ providedIn: 'root' })
export class SentinelHandler {

  #installer = inject(DcpInstallerService)
  #store = inject(DcpStore)
  #toggleState = inject(ToggleStateService)

  async handle(msg: SentinelRequest, port: MessagePort): Promise<void> {
    switch (msg.type) {
      case 'install': return this.#handleInstall(msg, port)
      case 'sync': return this.#handleSync(msg, port)
      case 'fetch-content': return this.#handleFetchContent(msg, port)
      case 'intake': return this.#handleIntake(msg, port)
    }
  }

  async #handleInstall(msg: SentinelRequest & { type: 'install' }, port: MessagePort): Promise<void> {
    const domains = this.#loadDomains()
    if (!domains.length) {
      port.postMessage({ type: 'result', rid: msg.rid, ok: false, error: 'No trusted domains configured in DCP' })
      return
    }

    await this.#store.initialize()

    for (const domain of domains) {
      const rootSig = await this.#fetchRootSignature(domain)
      if (!rootSig) continue

      // Skip install if caller already has this signature
      if (msg.installedSig && msg.installedSig === rootSig) {
        port.postMessage({ type: 'install-done', rid: msg.rid, manifest: {}, rootSig, beeDeps: undefined })
        return
      }

      const domainName = new URL(domain).hostname
      const manifest = await this.#installer.install(domain, rootSig, domainName, (p) => {
        port.postMessage({ type: 'progress', rid: msg.rid, phase: p.phase, current: p.current, total: p.total })
      })

      if (!manifest) continue

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
    }

    port.postMessage({ type: 'result', rid: msg.rid, ok: false, error: 'No content found on any trusted domain' })
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

    // Web tells us what it has via currentSyncSig — but to compute the diff
    // we need to know what sigs web currently holds. We'll send the full enabled
    // set and let web compute what to add/remove locally (it knows its own OPFS).
    // Stream all enabled files, mark the sync sig for web to store.
    const add: { signature: string; kind: string; bytes: ArrayBuffer }[] = []

    const domains = this.#loadDomains()

    for (const sig of syncManifest.bees) {
      let bytes = await this.#store.readFile(this.#store.bees, `${sig}.js`)
        ?? await this.#store.readFile(this.#store.bees, sig)
      if (!bytes) bytes = await this.#fetchFromDomains(domains, sig, 'bee')
      if (bytes) add.push({ signature: sig, kind: 'bee', bytes })
    }

    for (const sig of syncManifest.dependencies) {
      let bytes = await this.#store.readFile(this.#store.dependencies, `${sig}.js`)
        ?? await this.#store.readFile(this.#store.dependencies, sig)
      if (!bytes) bytes = await this.#fetchFromDomains(domains, sig, 'dependency')
      if (bytes) add.push({ signature: sig, kind: 'dependency', bytes })
    }

    for (const sig of syncManifest.layers) {
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

    // Log all resolved files with signatures
    console.log(`[sentinel] sync resolved ${add.length} files:`)
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
      beeDeps: syncManifest.beeDeps,
      bootPriority: syncManifest.bootPriority,
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
    const enabledBees: string[] = []
    const enabledDeps = new Set<string>()
    const enabledLayers: string[] = []
    const allBeeDeps: Record<string, string[]> = {}
    const bootPriorityCollected = new Set<string>()

    const domains = this.#loadDomains()
    const toggles = this.#loadToggles()

    for (const domain of domains) {
      const domainName = new URL(domain).hostname
      if (toggles[domain] === false || toggles[domainName] === false) continue

      const rootSig = await this.#fetchRootSignature(domain)
      if (!rootSig) continue

      const manifest = await this.#readCachedManifest(domain, rootSig)
      if (!manifest) continue

      const beeDeps: Record<string, string[]> = manifest.beeDeps ?? {}
      const packagePriority: string[] = Array.isArray(manifest.bootPriority) ? manifest.bootPriority : []
      const visited = new Set<string>()

      await this.#walkEnabled(
        rootSig,
        domain,
        domainName,
        toggles,
        beeDeps,
        enabledBees,
        enabledDeps,
        enabledLayers,
        allBeeDeps,
        visited,
      )

      // Intersect this package's declared bootPriority with what is
      // actually enabled (toggle gates). A disabled drone must not
      // surface as priority — that would force it to load on the web
      // side regardless of the user's toggle.
      const enabledBeesSet = new Set(enabledBees)
      for (const sig of packagePriority) {
        if (enabledBeesSet.has(sig)) bootPriorityCollected.add(sig)
      }
    }

    const depsList = [...enabledDeps].sort()
    const allSigs = [...enabledBees.sort(), ...depsList, ...enabledLayers.sort()]
    const syncSig = await SignatureService.sign(new TextEncoder().encode(allSigs.join(',')).buffer as ArrayBuffer)

    return {
      syncSig,
      bees: enabledBees,
      dependencies: depsList,
      layers: enabledLayers,
      beeDeps: allBeeDeps,
      bootPriority: [...bootPriorityCollected].sort(),
    }
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
  ): Promise<void> {
    if (visited.has(layerSig)) return
    visited.add(layerSig)

    if (toggles[layerSig] === false) return

    const layer = await this.#readLayerJson(domain, domainName, layerSig)
    if (!layer) return

    enabledLayers.push(layerSig)

    for (const raw of (layer.bees ?? [])) {
      const sig = raw.replace(/\.js$/i, '')
      if (toggles[sig] === false) continue
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
      )
    }
  }

  /**
   * Read a single layer JSON for the tree-walk. Tries DCP's OPFS cache
   * first; on miss, fetches from the domain's `__layers__/<sig>.json`,
   * verifies the hash, and writes it back to OPFS so the next walk hits
   * the cache. This is the path that lets a freshly-deployed essentials
   * (new rootSig, new layer signatures) propagate through sync without
   * needing DCP to re-run a full install first.
   */
  async #readLayerJson(
    domain: string,
    domainName: string,
    layerSig: string,
  ): Promise<{ bees?: string[]; dependencies?: string[]; cells?: string[]; layers?: string[]; children?: string[] } | null> {
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
   * to __from-hypercomb__/{kind}/, append to the provenance manifest,
   * broadcast on `dcp-from-hypercomb` so any DCP main tab refreshes
   * its tree, and ack.
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
    const ext = kind === 'layer' ? '.json' : '.js'
    const folder = kind === 'layer' ? '__layers__' : kind === 'bee' ? '__bees__' : '__dependencies__'
    const url = `${base}/${folder}/${sig}${ext}`

    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return null

      const bytes = await res.arrayBuffer()
      const actual = await SignatureService.sign(bytes)
      if (actual !== sig) {
        console.error(`[sentinel] signature mismatch: expected ${sig}, got ${actual}`)
        return null
      }
      return bytes
    } catch {
      return null
    }
  }

  async #fetchRootSignature(base: string): Promise<string | null> {
    try {
      const res = await fetch(`${base}/manifest.json`, { cache: 'no-store' })
      if (!res.ok) return null
      const content = await res.json()
      const sigs = Object.keys(content?.packages ?? {})
      const sig = sigs[0]?.replace(/\uFEFF/g, '').trim()
      return sig && /^[a-f0-9]{64}$/i.test(sig) ? sig.toLowerCase() : null
    } catch {
      return null
    }
  }

  #loadDomains(): string[] {
    const selfOrigin = location.origin
    try {
      const stored: string[] = JSON.parse(localStorage.getItem(DOMAINS_KEY) ?? '[]')
      // DCP always includes its own origin — modules are bundled in public/
      if (!stored.includes(selfOrigin)) return [selfOrigin, ...stored]
      return stored
    } catch {
      return [selfOrigin]
    }
  }
}
