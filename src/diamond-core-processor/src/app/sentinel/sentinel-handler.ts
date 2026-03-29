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
}

export type SentinelRequest =
  | { type: 'install'; rid: string; installedSig?: string }
  | { type: 'sync'; rid: string; currentSyncSig?: string }
  | { type: 'fetch-content'; rid: string; signature: string; kind: 'layer' | 'bee' | 'dependency'; rootSig: string }

export type SentinelResponse =
  | { type: 'result'; rid: string; ok: true; data: ArrayBuffer | string | object }
  | { type: 'result'; rid: string; ok: false; error: string }
  | { type: 'progress'; rid: string; phase: string; current: number; total: number }
  | { type: 'file'; rid: string; signature: string; kind: string; bytes: ArrayBuffer }
  | { type: 'install-done'; rid: string; manifest: object; rootSig: string; beeDeps?: Record<string, string[]> }
  | { type: 'sync-result'; rid: string; syncSig: string; add: { signature: string; kind: string; bytes: ArrayBuffer }[]; remove: { signature: string; kind: string }[] }

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
      const rootSig = await this.#fetchLatest(domain)
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

    for (const sig of syncManifest.bees) {
      const bytes = await this.#store.readFile(this.#store.bees, `${sig}.js`)
        ?? await this.#store.readFile(this.#store.bees, sig)
      if (bytes) add.push({ signature: sig, kind: 'bee', bytes })
    }

    for (const sig of syncManifest.dependencies) {
      const bytes = await this.#store.readFile(this.#store.dependencies, `${sig}.js`)
        ?? await this.#store.readFile(this.#store.dependencies, sig)
      if (bytes) add.push({ signature: sig, kind: 'dependency', bytes })
    }

    for (const sig of syncManifest.layers) {
      // Layers are domain-scoped — check each domain dir
      let bytes: ArrayBuffer | null = null
      for (const domain of this.#loadDomains()) {
        const domainName = new URL(domain).hostname
        const dir = await this.#store.domainLayersDir(domainName)
        bytes = await this.#store.readFile(dir, sig)
          ?? await this.#store.readFile(dir, `${sig}.json`)
        if (bytes) break
      }
      if (bytes) add.push({ signature: sig, kind: 'layer', bytes })
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
   */
  async #computeSyncManifest(): Promise<SyncManifest> {
    const enabledBees: string[] = []
    const enabledDeps = new Set<string>()
    const enabledLayers: string[] = []
    const allBeeDeps: Record<string, string[]> = {}

    const domains = this.#loadDomains()
    const toggles = this.#loadToggles()

    for (const domain of domains) {
      const domainName = new URL(domain).hostname
      // Check if this domain is toggled off
      if (toggles[domain] === false || toggles[domainName] === false) continue

      const rootSig = await this.#fetchLatest(domain)
      if (!rootSig) continue

      const manifest = await this.#readCachedManifest(domain, rootSig)
      if (!manifest) continue

      // Collect bees that are enabled
      for (const sig of (manifest.bees ?? [])) {
        const nodeId = sig  // node IDs for bees use the signature
        if (toggles[nodeId] === false) continue
        enabledBees.push(sig)

        // Collect deps required by this bee
        const deps = (manifest.beeDeps ?? {})[sig] ?? []
        for (const dep of deps) enabledDeps.add(dep)
        if (deps.length) allBeeDeps[sig] = deps
      }

      // All deps of enabled bees, plus any standalone deps that are toggled on
      for (const sig of (manifest.dependencies ?? [])) {
        if (enabledDeps.has(sig)) continue  // already included via beeDeps
        if (toggles[sig] === false) continue
        enabledDeps.add(sig)
      }

      for (const sig of (manifest.layers ?? [])) {
        if (toggles[sig] === false) continue
        enabledLayers.push(sig)
      }
    }

    const depsList = [...enabledDeps].sort()
    const allSigs = [...enabledBees.sort(), ...depsList, ...enabledLayers.sort()]
    const syncSig = await SignatureService.sign(new TextEncoder().encode(allSigs.join(',')).buffer as ArrayBuffer)

    return { syncSig, bees: enabledBees, dependencies: depsList, layers: enabledLayers, beeDeps: allBeeDeps }
  }

  async #readCachedManifest(domain: string, rootSig: string): Promise<any> {
    // Try reading from DCP's OPFS first (already installed)
    const domainName = new URL(domain).hostname
    const dir = await this.#store.domainLayersDir(domainName)
    const bytes = await this.#store.readFile(dir, 'manifest.cache.json')
    if (bytes) {
      try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { /* fall through */ }
    }
    // Fetch fresh content manifest and extract package by rootSig
    try {
      const res = await fetch(`${domain}/manifest.json`, { cache: 'no-store' })
      if (!res.ok) return null
      const content = await res.json()
      return content?.packages?.[rootSig] ?? null
    } catch {
      return null
    }
  }

  #loadToggles(): Record<string, boolean> {
    try {
      const raw = localStorage.getItem(TOGGLE_KEY)
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
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
      const rootSig = msg.rootSig || await this.#fetchLatest(domain)
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

  async #fetchLatest(base: string): Promise<string | null> {
    try {
      const res = await fetch(`${base}/latest.json`, { cache: 'no-store' })
      if (!res.ok) return null
      const data = await res.json()
      const seed = ((data?.seed ?? '') as string).replace(/\uFEFF/g, '').trim()
      return /^[a-f0-9]{64}$/i.test(seed) ? seed.toLowerCase() : null
    } catch {
      return null
    }
  }

  #loadDomains(): string[] {
    try {
      return JSON.parse(localStorage.getItem(DOMAINS_KEY) ?? '[]')
    } catch {
      return []
    }
  }
}
