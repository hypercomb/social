// diamond-core-processor/src/app/core/merkle-patch.service.ts

import { inject, Injectable } from '@angular/core'
import { SignatureService } from '@hypercomb/core'
import { DcpStore } from './dcp-store'
import { EsbuildService } from '../dcp/esbuild.service'

export type PatchResult = {
  originalSig: string
  newFileSig: string
  newRootSig: string
  kind: 'bee' | 'dependency'
  lineage: string
  cascadedLayers: { oldSig: string; newSig: string }[]
}

export type BatchPatchResult = {
  patchedFiles: { originalSig: string; newFileSig: string; kind: 'bee' | 'dependency' }[]
  newRootSig: string
  cascadedLayers: { oldSig: string; newSig: string }[]
}

type LayerJson = {
  version?: number
  name: string
  rel?: string
  bees?: string[]
  dependencies?: string[]
  layers?: string[]
  children?: string[]
  docs?: Record<string, unknown>
}

@Injectable({ providedIn: 'root' })
export class MerklePatchService {

  #store = inject(DcpStore)
  #esbuild = inject(EsbuildService)

  /**
   * Apply a patch: compile modified source, cascade through the Merkle tree,
   * produce a new root. All patched files are written to __patches__/{domain}/,
   * never touching the original installation.
   */
  async applyPatch(params: {
    originalSig: string
    kind: 'bee' | 'dependency'
    modifiedSource: string
    rootSig: string
    domain: string
    lineage: string
  }): Promise<PatchResult> {
    const { originalSig, kind, modifiedSource, rootSig, domain, lineage } = params

    await this.#store.initialize()

    // 1. compile modified source
    const compiled = await this.#esbuild.transform(modifiedSource)
    const compiledBytes = new TextEncoder().encode(compiled).buffer as ArrayBuffer

    // 2. sign compiled output
    const newFileSig = await SignatureService.sign(compiledBytes)

    // 3. store in patch directory (never in the original)
    const patchedDir = kind === 'bee'
      ? await this.#store.patchedBeesDir(domain)
      : await this.#store.patchedDepsDir(domain)
    await this.#store.writeFile(patchedDir, `${newFileSig}.js`, compiledBytes)

    // 4. build ancestry index from root
    const ancestry = await this.#buildAncestryIndex(rootSig, domain)

    // 5. cascade up the tree
    const cascadedLayers: { oldSig: string; newSig: string }[] = []
    const patchedLayersDir = await this.#store.patchedLayersDir(domain)

    let currentOldSig = originalSig
    let currentNewSig = newFileSig
    let currentKind = kind

    while (true) {
      const parentLayerSig = ancestry.get(currentOldSig)
      if (!parentLayerSig) break

      // read parent layer JSON (check patched layers first, then originals)
      const layerJson = await this.#readLayerJson(parentLayerSig, domain)
      if (!layerJson) {
        throw new Error(`Layer ${parentLayerSig.slice(0, 12)} not found in OPFS`)
      }

      // replace old sig with new sig in the appropriate array
      this.#replaceSigInLayer(layerJson, currentOldSig, currentNewSig, currentKind)

      // serialize, sign, store the new layer
      const layerBytes = new TextEncoder().encode(JSON.stringify(layerJson)).buffer as ArrayBuffer
      const newLayerSig = await SignatureService.sign(layerBytes)
      await this.#store.writeFile(patchedLayersDir, newLayerSig, layerBytes)

      cascadedLayers.push({ oldSig: parentLayerSig, newSig: newLayerSig })

      // walk up: the parent layer sig is now the "changed" sig
      currentOldSig = parentLayerSig
      currentNewSig = newLayerSig
      currentKind = 'bee' // layers are referenced in parent layers' layers[] array, handled below
    }

    const newRootSig = cascadedLayers.length > 0
      ? cascadedLayers[cascadedLayers.length - 1].newSig
      : rootSig

    return {
      originalSig,
      newFileSig,
      newRootSig,
      kind,
      lineage,
      cascadedLayers
    }
  }

  /**
   * Apply multiple patches in a single Merkle cascade. Compiles all changed files,
   * builds the ancestry index once, then cascades all replacements upward.
   */
  async applyBatch(params: {
    changes: { originalSig: string; kind: 'bee' | 'dependency'; modifiedSource: string; lineage: string }[]
    rootSig: string
    domain: string
  }): Promise<BatchPatchResult> {
    const { changes, rootSig, domain } = params

    await this.#store.initialize()

    const patchedBeesDir = await this.#store.patchedBeesDir(domain)
    const patchedDepsDir = await this.#store.patchedDepsDir(domain)
    const patchedLayersDir = await this.#store.patchedLayersDir(domain)

    // 1. compile, sign, and store all changed files
    const replacements: { originalSig: string; newFileSig: string; kind: 'bee' | 'dependency' }[] = []

    for (const change of changes) {
      const compiled = await this.#esbuild.transform(change.modifiedSource)
      const compiledBytes = new TextEncoder().encode(compiled).buffer as ArrayBuffer
      const newFileSig = await SignatureService.sign(compiledBytes)
      const dir = change.kind === 'bee' ? patchedBeesDir : patchedDepsDir
      await this.#store.writeFile(dir, `${newFileSig}.js`, compiledBytes)
      replacements.push({ originalSig: change.originalSig, newFileSig, kind: change.kind })
    }

    // 2. build ancestry index once
    const ancestry = await this.#buildAncestryIndex(rootSig, domain)

    // 3. collect all affected layers and apply replacements bottom-up
    //    track which layers have been rewritten so cascading picks up intermediate changes
    const layerRewrites = new Map<string, string>() // oldLayerSig → newLayerSig
    const cascadedLayers: { oldSig: string; newSig: string }[] = []

    for (const { originalSig, newFileSig, kind } of replacements) {
      let currentOldSig = originalSig
      let currentNewSig = newFileSig
      let currentKind: 'bee' | 'dependency' = kind

      while (true) {
        // resolve through any already-rewritten layers
        let parentLayerSig = ancestry.get(currentOldSig)
        if (!parentLayerSig) break

        // if this parent was already rewritten by a prior replacement, use the new sig
        const rewrittenParent = layerRewrites.get(parentLayerSig)
        const readSig = rewrittenParent ?? parentLayerSig

        const layerJson = await this.#readLayerJson(readSig, domain)
        if (!layerJson) {
          throw new Error(`Layer ${readSig.slice(0, 12)} not found in OPFS`)
        }

        this.#replaceSigInLayer(layerJson, currentOldSig, currentNewSig, currentKind)

        const layerBytes = new TextEncoder().encode(JSON.stringify(layerJson)).buffer as ArrayBuffer
        const newLayerSig = await SignatureService.sign(layerBytes)
        await this.#store.writeFile(patchedLayersDir, newLayerSig, layerBytes)

        // update ancestry so subsequent replacements find the rewritten layer
        const originalParent = rewrittenParent ? parentLayerSig : parentLayerSig
        layerRewrites.set(originalParent, newLayerSig)
        // also map the intermediate rewritten sig so the next walk-up finds it
        if (rewrittenParent) layerRewrites.set(rewrittenParent, newLayerSig)

        cascadedLayers.push({ oldSig: readSig, newSig: newLayerSig })

        currentOldSig = parentLayerSig
        currentNewSig = newLayerSig
        currentKind = 'bee' // layers reference child layers in layers[]
      }
    }

    const newRootSig = cascadedLayers.length > 0
      ? cascadedLayers[cascadedLayers.length - 1].newSig
      : rootSig

    return { patchedFiles: replacements, newRootSig, cascadedLayers }
  }

  /**
   * Build a reverse index: childSig → parentLayerSig.
   * Walks the layer tree recursively starting from rootSig.
   */
  async #buildAncestryIndex(rootSig: string, domain: string): Promise<Map<string, string>> {
    const index = new Map<string, string>()
    await this.#walkTree(rootSig, domain, index)
    return index
  }

  async #walkTree(layerSig: string, domain: string, index: Map<string, string>): Promise<void> {
    const layer = await this.#readLayerJson(layerSig, domain)
    if (!layer) return

    // bees in this layer → parent is this layer
    for (const raw of layer.bees ?? []) {
      const sig = raw.replace(/\.js$/i, '')
      index.set(sig, layerSig)
    }

    // dependencies in this layer → parent is this layer
    for (const raw of layer.dependencies ?? []) {
      const sig = raw.replace(/\.js$/i, '')
      index.set(sig, layerSig)
    }

    // child layers → parent is this layer, then recurse
    for (const childSig of layer.layers ?? layer.children ?? []) {
      index.set(childSig, layerSig)
      await this.#walkTree(childSig, domain, index)
    }
  }

  /**
   * Read a layer JSON from OPFS — check patched layers first, then originals.
   */
  async #readLayerJson(sig: string, domain: string): Promise<LayerJson | null> {
    // check patched layers first
    const patchedDir = await this.#store.patchedLayersDir(domain)
    let bytes = await this.#store.readFile(patchedDir, sig)
    if (bytes) {
      return JSON.parse(new TextDecoder().decode(bytes)) as LayerJson
    }

    // fall back to original layers
    const domainDir = await this.#store.domainLayersDir(domain)
    bytes = await this.#store.readFile(domainDir, sig)
    if (bytes) {
      return JSON.parse(new TextDecoder().decode(bytes)) as LayerJson
    }

    return null
  }

  /**
   * Replace oldSig with newSig in the layer's arrays.
   */
  #replaceSigInLayer(layer: LayerJson, oldSig: string, newSig: string, kind: 'bee' | 'dependency'): void {
    if (kind === 'bee') {
      // could be in bees[] (bee/worker/drone)
      if (layer.bees) {
        const idx = layer.bees.indexOf(oldSig)
        if (idx >= 0) { layer.bees[idx] = newSig; return }
        // try with .js extension
        const idxJs = layer.bees.indexOf(`${oldSig}.js`)
        if (idxJs >= 0) { layer.bees[idxJs] = `${newSig}.js`; return }
      }
    }

    if (kind === 'dependency') {
      if (layer.dependencies) {
        const idx = layer.dependencies.indexOf(oldSig)
        if (idx >= 0) { layer.dependencies[idx] = newSig; return }
        const idxJs = layer.dependencies.indexOf(`${oldSig}.js`)
        if (idxJs >= 0) { layer.dependencies[idxJs] = `${newSig}.js`; return }
      }
    }

    // also check layers[]/children[] for cascaded layer sig replacements
    if (layer.layers) {
      const idx = layer.layers.indexOf(oldSig)
      if (idx >= 0) { layer.layers[idx] = newSig; return }
    }
    if (layer.children) {
      const idx = layer.children.indexOf(oldSig)
      if (idx >= 0) { layer.children[idx] = newSig; return }
    }
  }
}
