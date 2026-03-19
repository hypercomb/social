// src/app/core/tree-resolver.service.ts
import { inject, Injectable } from '@angular/core'
import { SignatureService } from '@hypercomb/core'
import { AuditorService } from './auditor.service'
import { DcpStore } from './dcp-store'
import type { AuditResult, TreeNode } from './tree-node'

type LayerJson = {
  version?: number
  name: string
  rel?: string
  bees?: string[]
  dependencies?: string[]
  layers?: string[]
  children?: string[]
}

type InstallManifest = {
  version?: number
  layers?: string[]
  bees?: string[]
  dependencies?: string[]
  beeDeps?: Record<string, string[]>
}

@Injectable({ providedIn: 'root' })
export class TreeResolverService {

  #cache = new Map<string, LayerJson>()
  #auditor = inject(AuditorService)
  #store = inject(DcpStore)

  async resolveRoot(contentBase: string, domain: string): Promise<TreeNode | null> {
    const base = (contentBase ?? '').replace(/\/+$/, '')
    if (!base) return null

    await this.#store.initialize()

    // fetch latest.txt to get root signature
    const rootSig = await this.#fetchLatest(base)
    if (!rootSig) return null

    // fetch install manifest
    const manifest = await this.#fetchManifest(base, rootSig, domain)
    if (!manifest) return null

    // fetch root layer JSON
    const rootLayer = await this.#fetchLayer(base, rootSig, rootSig, domain)
    if (!rootLayer) return null

    // build root tree node
    const root = this.#buildNode(rootLayer, rootSig, '', undefined, 0)

    // populate immediate children
    await this.#expandChildren(root, base, rootSig, domain)

    // audit all known signatures
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

    const childSigs = layer.layers ?? layer.children ?? []
    const beeSigs = layer.bees ?? []

    for (const childSig of childSigs) {
      const childLayer = await this.#fetchLayer(base, rootSig, childSig, domain)
      if (!childLayer) continue

      const lineage = parent.lineage ? `${parent.lineage}/${childLayer.name}` : childLayer.name
      const child = this.#buildNode(childLayer, childSig, lineage, parent.id, parent.depth + 1)
      parent.children.push(child)
    }

    for (const beeSig of beeSigs) {
      const beeNode: TreeNode = {
        id: beeSig,
        name: beeSig.slice(0, 12) + '...',
        kind: 'bee',
        signature: beeSig,
        lineage: parent.lineage,
        parentId: parent.id,
        children: [],
        expanded: false,
        loaded: true,
        depth: parent.depth + 1
      }
      parent.children.push(beeNode)
    }

    parent.loaded = true
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
      depth
    }
  }

  async #fetchLatest(base: string): Promise<string | null> {
    try {
      const res = await fetch(`${base}/latest.txt`, { cache: 'no-store' })
      if (!res.ok) return null
      const text = await res.text()
      return text.trim() || null
    } catch {
      return null
    }
  }

  async #fetchManifest(base: string, rootSig: string, domain: string): Promise<InstallManifest | null> {
    try {
      const url = `${base}/${rootSig}/install.manifest.json`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return null

      const bytes = await res.arrayBuffer()
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as InstallManifest

      // persist to OPFS — same path Hypercomb expects
      const domainDir = await this.#store.domainLayersDir(domain)
      await this.#store.writeFile(domainDir, 'install.manifest.json', bytes)

      return parsed
    } catch {
      return null
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
        const parsed = JSON.parse(new TextDecoder().decode(cached)) as LayerJson
        this.#cache.set(layerSig, parsed)
        return parsed
      }
    }

    // fetch from network
    try {
      const url = `${base}/${rootSig}/__layers__/${layerSig}.json`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return null

      const bytes = await res.arrayBuffer()
      const actual = await SignatureService.sign(bytes)
      if (actual !== layerSig) return null

      // persist to OPFS
      await this.#store.writeFile(domainDir, layerSig, bytes)

      const text = new TextDecoder().decode(bytes)
      const parsed = JSON.parse(text) as LayerJson
      this.#cache.set(layerSig, parsed)
      return parsed
    } catch {
      return null
    }
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
}
