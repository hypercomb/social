// diamond-core-processor/src/app/core/tree-resolver.service.ts

import { inject, Injectable } from '@angular/core'
import { SignatureService } from '@hypercomb/core'
import { AuditorService } from './auditor.service'
import { DcpInstallerService, type InstallProgress } from './dcp-installer.service'
import { DcpStore } from './dcp-store'
import type { AuditResult, BeeDocEntry, LayerDocs, TreeNode, TreeNodeKind } from './tree-node'

/** A package entry from a host's manifest.json, with its sidecar branch
 *  metadata. `label`/`at`/`previous` are optional — older manifests and the
 *  genesis deploy may omit some. The `sig` is the package's rootLayerSig. */
export interface PackageMeta {
  sig: string
  label?: string
  at?: string
  previous?: string | null
}

/** PascalCase → 'lower case words' (e.g. MeshAdapterDrone → mesh adapter drone) */
function humanize(name: string): string {
  return name
    .replace(/^_+/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
}

// Hard cap on a single layer network probe. resolveBranchFromDomain awaits
// #fetchLayer directly with no surrounding timeout, so without this an
// unreachable-but-stalling byteSource leaves the installer's section pinned on
// the loading bar forever. 3s covers a healthy host's 404 while bounding the
// pathological stall — same budget as the content-broker's HTTP probe.
const LAYER_FETCH_TIMEOUT_MS = 3000

type LayerJson = {
  version?: number
  name: string
  rel?: string
  bees?: string[]
  dependencies?: string[]
  cells?: string[]
  layers?: string[]
  children?: string[]
  docs?: LayerDocs
}

@Injectable({ providedIn: 'root' })
export class TreeResolverService {

  #cache = new Map<string, LayerJson>()
  // depSig → namespace lineage (e.g. "diamondcoreprocessor.com/core/axial")
  #depLineage = new Map<string, string>()
  #auditor = inject(AuditorService)
  #installer = inject(DcpInstallerService)
  #store = inject(DcpStore)

  async fetchAllRootSignatures(contentBase: string): Promise<string[]> {
    return (await this.fetchPackages(contentBase)).map(p => p.sig)
  }

  /** Fetch the host's manifest.json and return one PackageMeta per package
   *  entry — the root sig plus its sidecar branch metadata (label/at/previous).
   *  Same validation/normalisation as the sig-only path; entries with an
   *  invalid root sig are dropped. */
  async fetchPackages(contentBase: string): Promise<PackageMeta[]> {
    const base = (contentBase ?? '').replace(/\/+$/, '')
    if (!base) return []
    return this.#fetchPackages(base)
  }

  async resolveRoot(
    contentBase: string,
    rootSig: string,
    domain: string,
    onInstallProgress?: (p: InstallProgress) => void
  ): Promise<TreeNode | null> {
    const base = (contentBase ?? '').replace(/\/+$/, '')
    if (!base || !rootSig) return null

    await this.#store.initialize()

    // upfront install: download all layers, bees, deps to OPFS
    const manifest = await this.#installer.install(base, rootSig, domain, onInstallProgress)
    if (!manifest) return null

    // resolve dep → namespace lineage from first-line comments
    this.#depLineage.clear()
    await this.#resolveDepLineages(manifest.dependencies ?? [])

    // fetch root layer JSON
    const rootLayer = await this.#fetchLayer(base, rootSig, rootSig, domain)
    if (!rootLayer) return null

    // build root tree node
    const root = this.#buildNode(rootLayer, rootSig, '', undefined, 0)

    // populate all children recursively
    await this.#expandAll(root, base, rootSig, domain)

    // audit all known signatures
    const allSigs = this.#collectSignatures(root)
    if (allSigs.length > 0 && this.#auditor.endpoints.length > 0) {
      const auditResults = await this.#auditor.auditBatch(allSigs)
      this.#applyAuditResults(root, auditResults)
    }

    return root
  }

  /**
   * Resolve an arbitrary BRANCH (a layer signature, not necessarily a manifest
   * package) by FETCHING it from a domain: download the branch layer + walk
   * its refs recursively, caching layers to OPFS as it goes. Unlike
   * resolveRoot this does NOT run the package installer (a branch is not a
   * package) — it fetches only what the tree needs to render (layers; bees/
   * deps stay lazy for analysis/run). This is the adopt byte path: "send the
   * signature → fetch from the domain → the tree fills." Returns null if the
   * branch layer can't be fetched (no endpoint serves it → egg).
   */
  async resolveBranchFromDomain(contentBase: string, branchSig: string, domain: string): Promise<TreeNode | null> {
    const base = (contentBase ?? '').replace(/\/+$/, '')
    const sig = (branchSig ?? '').trim().toLowerCase()
    if (!base || !/^[a-f0-9]{64}$/.test(sig)) return null

    await this.#store.initialize()
    this.#depLineage.clear()

    const rootLayer = await this.#fetchLayer(base, sig, sig, domain)
    if (!rootLayer) return null

    const root = this.#buildNode(rootLayer, sig, '', undefined, 0)
    await this.#expandAll(root, base, sig, domain)

    const allSigs = this.#collectSignatures(root)
    if (allSigs.length > 0 && this.#auditor.endpoints.length > 0) {
      const auditResults = await this.#auditor.auditBatch(allSigs)
      this.#applyAuditResults(root, auditResults)
    }
    return root
  }

  /**
   * Resolve a tree from local OPFS only — no network calls.
   * Used after patching to rebuild the tree from a new root sig
   * where all layers/bees/deps are already stored locally.
   */
  async resolveFromLocal(rootSig: string, domain: string): Promise<TreeNode | null> {
    await this.#store.initialize()

    // resolve dep lineages from all deps in patched + original OPFS
    this.#depLineage.clear()
    await this.#resolveDepLineagesFromLocal(domain)

    // fetch root layer JSON from local (patched layers first, then originals)
    const rootLayer = await this.#fetchLayerLocal(rootSig, domain)
    if (!rootLayer) return null

    const root = this.#buildNode(rootLayer, rootSig, '', undefined, 0)

    // populate all children recursively (local only)
    await this.#expandAllLocal(root, domain)

    // audit
    const allSigs = this.#collectSignatures(root)
    if (allSigs.length > 0 && this.#auditor.endpoints.length > 0) {
      const auditResults = await this.#auditor.auditBatch(allSigs)
      this.#applyAuditResults(root, auditResults)
    }

    return root
  }

  async expandNode(node: TreeNode, contentBase: string, rootSig: string, domain: string): Promise<void> {
    if (node.loaded) return
    const base = (contentBase ?? '').replace(/\/+$/, '')
    if (!base) return

    await this.#expandChildren(node, base, rootSig, domain)
    node.loaded = true

    // audit newly loaded sigs
    const newSigs = this.#collectSignatures(node).filter(s => s !== node.signature)
    if (newSigs.length > 0 && this.#auditor.endpoints.length > 0) {
      const results = await this.#auditor.auditBatch(newSigs)
      for (const child of node.children) {
        this.#applyAuditResults(child, results)
      }
    }
  }

  async #expandChildren(parent: TreeNode, base: string, rootSig: string, domain: string): Promise<void> {
    if (parent.kind !== 'domain' && parent.kind !== 'layer') return

    const layer = this.#cache.get(parent.signature ?? parent.id)
    if (!layer) return

    const childSigs = layer.cells ?? layer.layers ?? layer.children ?? []
    const beeSigs = (layer.bees ?? []).map(s => s.replace(/\.js$/i, ''))

    for (const childSig of childSigs) {
      const childLayer = await this.#fetchLayer(base, rootSig, childSig, domain)
      if (!childLayer) continue

      const lineage = parent.lineage ? `${parent.lineage}/${childLayer.name}` : childLayer.name
      const child = this.#buildNode(childLayer, childSig, lineage, parent.id, parent.depth + 1)
      parent.children.push(child)
    }

    const beeDocs = layer.docs?.bees

    for (const beeSig of beeSigs) {
      const doc = beeDocs?.[beeSig]
      const { kind: beeKind, className } = doc
        ? { kind: doc.kind as TreeNodeKind, className: doc.className }
        : await this.#detectBeeInfo(beeSig)
      const beeNode: TreeNode = {
        id: beeSig,
        name: className ? humanize(className) : beeSig.slice(0, 12) + '...',
        kind: beeKind,
        signature: beeSig,
        lineage: parent.lineage,
        parentId: parent.id,
        children: [],
        expanded: false,
        loaded: true,
        depth: parent.depth + 1,
        doc,
      }
      parent.children.push(beeNode)
    }

    // add queen docs (keyed by "queen:ClassName", no individual sig)
    if (beeDocs) {
      for (const [key, doc] of Object.entries(beeDocs)) {
        if (!key.startsWith('queen:')) continue
        const queenNode: TreeNode = {
          id: `${parent.id}:${key}`,
          name: humanize(doc.className),
          kind: 'bee',
          lineage: parent.lineage,
          parentId: parent.id,
          children: [],
          expanded: false,
          loaded: true,
          depth: parent.depth + 1,
          doc,
        }
        parent.children.push(queenNode)
      }
    }

    // add deps whose namespace matches this layer's lineage
    const parentLineage = parent.lineage || layer.rel || ''
    for (const [depSig, depNs] of this.#depLineage) {
      if (depNs === parentLineage) {
        const depName = await this.#detectDepClassName(depSig)
        const depNode: TreeNode = {
          id: `${parent.id}:${depSig}`,
          name: depName ? humanize(depName) : depSig.slice(0, 12) + '...',
          kind: 'dependency',
          signature: depSig,
          lineage: parentLineage,
          parentId: parent.id,
          children: [],
          expanded: false,
          loaded: true,
          depth: parent.depth + 1
        }
        parent.children.push(depNode)
      }
    }

    parent.loaded = true
  }

  async #expandAll(node: TreeNode, base: string, rootSig: string, domain: string): Promise<void> {
    await this.#expandChildren(node, base, rootSig, domain)
    for (const child of node.children) {
      if (child.kind === 'layer' || child.kind === 'domain') {
        await this.#expandAll(child, base, rootSig, domain)
      }
    }
  }

  // -------------------------------------------------
  // read first-line namespace comment from each dep
  // -------------------------------------------------

  async #resolveDepLineages(depSigs: string[]): Promise<void> {
    for (const raw of depSigs) {
      const sig = raw.replace(/\.js$/i, '')
      const bytes = await this.#store.readFile(this.#store.dependencies, `${sig}.js`)
      if (!bytes) continue

      // read first 512 bytes to extract the alias comment
      const slice = bytes.byteLength > 512 ? bytes.slice(0, 512) : bytes
      const text = new TextDecoder().decode(slice)
      const firstLine = text.split('\n')[0]
      const match = firstLine.match(/^\/\/\s*@(.+)/)
      if (match) {
        this.#depLineage.set(sig, match[1].trim())
      }
    }
  }

  async #detectBeeInfo(sig: string): Promise<{ kind: TreeNodeKind, className: string | null }> {
    try {
      const bytes = await this.#store.readFile(this.#store.bees, `${sig}.js`)
      if (bytes) {
        const text = new TextDecoder().decode(bytes)
        // match: var ClassName = class extends Worker/Drone/Bee
        // or:    class ClassName extends Worker/Drone/Bee
        const m = text.match(/(?:var\s+(\w+)\s*=\s*class|class\s+(\w+))\s+extends\s+(Worker|Drone|Bee)\b/)
        if (m) {
          const className = m[1] || m[2]
          const kind = m[3].toLowerCase() as TreeNodeKind
          return { kind: kind === 'bee' ? 'bee' : kind, className }
        }
      }
    } catch { /* fallback */ }
    return { kind: 'bee', className: null }
  }

  async #detectDepClassName(sig: string): Promise<string | null> {
    try {
      const bytes = await this.#store.readFile(this.#store.dependencies, `${sig}.js`)
      if (bytes) {
        const text = new TextDecoder().decode(bytes)
        const m = text.match(/(?:var\s+(\w+)\s*=\s*class|class\s+(\w+))/)
        if (m) return m[1] || m[2]
      }
    } catch { /* fallback */ }
    return null
  }

  #buildNode(layer: LayerJson, sig: string, lineage: string, parentId: string | undefined, depth: number): TreeNode {
    return {
      id: sig,
      name: layer.name || sig.slice(0, 12) + '...',
      kind: depth === 0 ? 'domain' : 'layer',
      signature: sig,
      lineage,
      parentId,
      children: [],
      expanded: false,
      loaded: false,
      depth,
      layerDocs: layer.docs,
    }
  }

  async #fetchPackages(base: string): Promise<PackageMeta[]> {
    try {
      const res = await fetch(`${base}/manifest.json`, { cache: 'no-store' })
      if (!res.ok) return []
      const content = await res.json()
      const packages = (content?.packages ?? {}) as Record<string, { label?: string; at?: string; previous?: string | null }>
      return Object.entries(packages)
        .map(([sig, entry]) => ({ sig: sig.trim().toLowerCase(), entry }))
        .filter(({ sig }) => /^[a-f0-9]{64}$/i.test(sig))
        .map(({ sig, entry }) => ({
          sig,
          label: typeof entry?.label === 'string' ? entry.label : undefined,
          at: typeof entry?.at === 'string' ? entry.at : undefined,
          previous: typeof entry?.previous === 'string' ? entry.previous : undefined,
        }))
    } catch {
      return []
    }
  }

  async #fetchLayer(base: string, rootSig: string, layerSig: string, domain: string): Promise<LayerJson | null> {
    if (this.#cache.has(layerSig)) return this.#cache.get(layerSig)!

    // check OPFS first
    const domainDir = await this.#store.domainLayersDir(domain)
    const cached = await this.#store.readFile(domainDir, layerSig)
    if (cached) {
      const actual = await SignatureService.sign(cached)
      if (actual === layerSig) {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(cached)) as LayerJson
          this.#cache.set(layerSig, parsed)
          return parsed
        } catch { /* cached bytes aren't a JSON layer — fall through to refetch */ }
      }
    }

    // Fetch from network — FLAT heap first: `/<sig>` is the canonical
    // address (one bucket, no typed pools, no extensions; the sha256 check
    // below is the gate, the URL carries identity only). Host-sync pushes
    // land flat, so this is where freshly-backed-up branches live. The
    // typed path is the legacy fallback for hosts that haven't migrated
    // (static layouts: Azure blob, ng-serve public/content).
    for (const url of [`${base}/${layerSig}`, `${base}/__layers__/${layerSig}.json`]) {
      // Bounded probe: resolveBranchFromDomain awaits this directly, so a
      // host that ACCEPTS the connection but stalls the body (an unreachable
      // byteSource — e.g. a slow https://jwize.com) would otherwise wedge the
      // await forever and pin the installer section on the loading bar ("never
      // completes"). Aborting after LAYER_FETCH_TIMEOUT_MS lets resolution fall
      // through to the local/mesh poll, which is what delivers a same-swarm
      // single-tile adopt. Comfortably covers a healthy host's 404.
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), LAYER_FETCH_TIMEOUT_MS)
      try {
        const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal })
        if (!res.ok) continue
        // SPA fallback guard: sig-addressed bytes are never text/html.
        if ((res.headers.get('content-type') || '').toLowerCase().includes('text/html')) continue

        const bytes = await res.arrayBuffer()
        const actual = await SignatureService.sign(bytes)
        if (actual !== layerSig) continue

        // persist to OPFS
        await this.#store.writeFile(domainDir, layerSig, bytes)

        const text = new TextDecoder().decode(bytes)
        const parsed = JSON.parse(text) as LayerJson
        this.#cache.set(layerSig, parsed)
        return parsed
      } catch {
        // network error / abort timeout / non-JSON — try the next shape
      } finally {
        clearTimeout(timer)
      }
    }
    return null
  }

  #collectSignatures(node: TreeNode): string[] {
    const sigs: string[] = []
    if (node.signature) sigs.push(node.signature)
    for (const child of node.children) {
      sigs.push(...this.#collectSignatures(child))
    }
    return sigs
  }

  #applyAuditResults(node: TreeNode, results: Map<string, AuditResult>): void {
    if (node.signature) {
      node.audit = results.get(node.signature)
    }
    for (const child of node.children) {
      this.#applyAuditResults(child, results)
    }
  }

  // -------------------------------------------------
  // local-only resolution (for patched trees)
  // -------------------------------------------------

  /** Parse local bytes as a layer JSON and cache by sig. Returns null when the
   *  bytes are absent OR aren't valid JSON — a stray non-layer blob sitting at
   *  a sig name must skip to the next source, never throw resolution out (the
   *  poll's catch would otherwise burn a retry and ultimately surface an egg
   *  for content that's actually fetchable from a later source). */
  #parseLayer(layerSig: string, bytes: ArrayBuffer | null): LayerJson | null {
    if (!bytes) return null
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as LayerJson
      this.#cache.set(layerSig, parsed)
      return parsed
    } catch { return null }
  }

  async #fetchLayerLocal(layerSig: string, domain: string): Promise<LayerJson | null> {
    if (this.#cache.has(layerSig)) return this.#cache.get(layerSig)!

    // check patched layers first
    const patchedDir = await this.#store.patchedLayersDir(domain)
    const patchedBytes = await this.#store.readFile(patchedDir, layerSig)
    const fromPatched = this.#parseLayer(layerSig, patchedBytes)
    if (fromPatched) return fromPatched

    // check original layers
    const domainDir = await this.#store.domainLayersDir(domain)
    const bytes = await this.#store.readFile(domainDir, layerSig)
    const fromOriginal = this.#parseLayer(layerSig, bytes)
    if (fromOriginal) return fromOriginal

    // check layers received from hypercomb-web
    const fromHcDir = await this.#store.fromHypercombKindDir('layer')
    const receivedBytes = await this.#store.readFile(fromHcDir, layerSig)
    const fromReceived = this.#parseLayer(layerSig, receivedBytes)
    if (fromReceived) return fromReceived

    return null
  }

  /**
   * Layer signatures received from hypercomb-web via sentinel intake.
   * Each one is a complete content-addressed layer the user authored
   * in the web app. UI surfaces these as a top-level "Received" list
   * so the user can navigate any prior state of their work after
   * switching over to DCP.
   */
  async listReceivedLayers(): Promise<string[]> {
    await this.#store.initialize()
    const dir = await this.#store.fromHypercombKindDir('layer')
    const sigs: string[] = []
    try {
      for await (const [name, handle] of (dir as any).entries()) {
        if (handle.kind !== 'file') continue
        if (/^[a-f0-9]{64}$/.test(name)) sigs.push(name)
      }
    } catch { /* dir might not exist yet */ }
    return sigs
  }

  async #expandChildrenLocal(parent: TreeNode, domain: string): Promise<void> {
    if (parent.kind !== 'domain' && parent.kind !== 'layer') return

    const layer = this.#cache.get(parent.signature ?? parent.id)
    if (!layer) return

    const childSigs = layer.cells ?? layer.layers ?? layer.children ?? []
    const beeSigs = (layer.bees ?? []).map(s => s.replace(/\.js$/i, ''))

    for (const childSig of childSigs) {
      const childLayer = await this.#fetchLayerLocal(childSig, domain)
      if (!childLayer) continue

      const lineage = parent.lineage ? `${parent.lineage}/${childLayer.name}` : childLayer.name
      const child = this.#buildNode(childLayer, childSig, lineage, parent.id, parent.depth + 1)
      parent.children.push(child)
    }

    const beeDocs = layer.docs?.bees

    for (const beeSig of beeSigs) {
      const doc = beeDocs?.[beeSig]
      const { kind: beeKind, className } = doc
        ? { kind: doc.kind as TreeNodeKind, className: doc.className }
        : await this.#detectBeeInfoLocal(beeSig, domain)
      const beeNode: TreeNode = {
        id: beeSig,
        name: className ? humanize(className) : beeSig.slice(0, 12) + '...',
        kind: beeKind,
        signature: beeSig,
        lineage: parent.lineage,
        parentId: parent.id,
        children: [],
        expanded: false,
        loaded: true,
        depth: parent.depth + 1,
        doc,
      }
      parent.children.push(beeNode)
    }

    if (beeDocs) {
      for (const [key, doc] of Object.entries(beeDocs)) {
        if (!key.startsWith('queen:')) continue
        const queenNode: TreeNode = {
          id: `${parent.id}:${key}`,
          name: humanize(doc.className),
          kind: 'bee',
          lineage: parent.lineage,
          parentId: parent.id,
          children: [],
          expanded: false,
          loaded: true,
          depth: parent.depth + 1,
          doc,
        }
        parent.children.push(queenNode)
      }
    }

    const parentLineage = parent.lineage || layer.rel || ''
    for (const [depSig, depNs] of this.#depLineage) {
      if (depNs === parentLineage) {
        const depName = await this.#detectDepClassNameLocal(depSig, domain)
        const depNode: TreeNode = {
          id: `${parent.id}:${depSig}`,
          name: depName ? humanize(depName) : depSig.slice(0, 12) + '...',
          kind: 'dependency',
          signature: depSig,
          lineage: parentLineage,
          parentId: parent.id,
          children: [],
          expanded: false,
          loaded: true,
          depth: parent.depth + 1
        }
        parent.children.push(depNode)
      }
    }

    parent.loaded = true
  }

  async #expandAllLocal(node: TreeNode, domain: string): Promise<void> {
    await this.#expandChildrenLocal(node, domain)
    for (const child of node.children) {
      if (child.kind === 'layer' || child.kind === 'domain') {
        await this.#expandAllLocal(child, domain)
      }
    }
  }

  async #resolveDepLineagesFromLocal(domain: string): Promise<void> {
    // scan patched, original, and received dependency directories
    const dirs = [
      await this.#store.patchedDepsDir(domain),
      this.#store.dependencies,
      await this.#store.fromHypercombKindDir('dependency')
    ]
    for (const dir of dirs) {
      try {
        for await (const name of (dir as any).keys()) {
          if (!name.endsWith('.js')) continue
          const sig = name.replace(/\.js$/i, '')
          if (this.#depLineage.has(sig)) continue
          const bytes = await this.#store.readFile(dir, name)
          if (!bytes) continue
          const slice = bytes.byteLength > 512 ? bytes.slice(0, 512) : bytes
          const text = new TextDecoder().decode(slice)
          const firstLine = text.split('\n')[0]
          const match = firstLine.match(/^\/\/\s*@(.+)/)
          if (match) this.#depLineage.set(sig, match[1].trim())
        }
      } catch { /* directory might not exist yet */ }
    }
  }

  async #detectBeeInfoLocal(sig: string, domain: string): Promise<{ kind: TreeNodeKind, className: string | null }> {
    // check patched bees first
    try {
      const patchedDir = await this.#store.patchedBeesDir(domain)
      const bytes = await this.#store.readFile(patchedDir, `${sig}.js`)
      if (bytes) {
        const text = new TextDecoder().decode(bytes)
        const m = text.match(/(?:var\s+(\w+)\s*=\s*class|class\s+(\w+))\s+extends\s+(Worker|Drone|Bee)\b/)
        if (m) return { kind: (m[3].toLowerCase() === 'bee' ? 'bee' : m[3].toLowerCase()) as TreeNodeKind, className: m[1] || m[2] }
      }
    } catch { /* fallback */ }
    // check received bees
    try {
      const fromHcDir = await this.#store.fromHypercombKindDir('bee')
      const bytes = await this.#store.readFile(fromHcDir, `${sig}.js`)
      if (bytes) {
        const text = new TextDecoder().decode(bytes)
        const m = text.match(/(?:var\s+(\w+)\s*=\s*class|class\s+(\w+))\s+extends\s+(Worker|Drone|Bee)\b/)
        if (m) return { kind: (m[3].toLowerCase() === 'bee' ? 'bee' : m[3].toLowerCase()) as TreeNodeKind, className: m[1] || m[2] }
      }
    } catch { /* fallback */ }
    return this.#detectBeeInfo(sig)
  }

  async #detectDepClassNameLocal(sig: string, domain: string): Promise<string | null> {
    try {
      const patchedDir = await this.#store.patchedDepsDir(domain)
      const bytes = await this.#store.readFile(patchedDir, `${sig}.js`)
      if (bytes) {
        const text = new TextDecoder().decode(bytes)
        const m = text.match(/(?:var\s+(\w+)\s*=\s*class|class\s+(\w+))/)
        if (m) return m[1] || m[2]
      }
    } catch { /* fallback */ }
    try {
      const fromHcDir = await this.#store.fromHypercombKindDir('dependency')
      const bytes = await this.#store.readFile(fromHcDir, `${sig}.js`)
      if (bytes) {
        const text = new TextDecoder().decode(bytes)
        const m = text.match(/(?:var\s+(\w+)\s*=\s*class|class\s+(\w+))/)
        if (m) return m[1] || m[2]
      }
    } catch { /* fallback */ }
    return this.#detectDepClassName(sig)
  }
}
