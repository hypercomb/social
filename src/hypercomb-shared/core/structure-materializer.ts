// hypercomb-shared/core/structure-materializer.ts
//
// Materializes the installed layer tree as OPFS directories under __structure__/
// so ShowCellDrone can render the DCP install structure as navigable cells.
//
// The directory tree mirrors the layer hierarchy:
//   __structure__/<domain>/<layerName>/<childLayerName>/...
//                                    /<BeeName>           (leaf bee entries)
//
// Each directory gets a 0000 properties file with { signature, kind, lineage }
// so the structure atomizer can identify what was dropped on.

import { Store } from './store.js'

// ─── types ───────────────────────────────────────────────────────────────────

type StructureLayerNode = {
  name: string
  signature: string
  childLayerSigs: string[]
  bees: StructureBeeEntry[]
}

type StructureBeeEntry = {
  signature: string
  className: string
  kind: string
}

// ─── constants ───────────────────────────────────────────────────────────────

const STRUCTURE_DIRECTORY = '__structure__'
const PROPS_FILE = '0000'
const MAX_DEPTH = 8

// ─── public api ──────────────────────────────────────────────────────────────

export const materializeStructure = async (store: Store): Promise<void> => {
  try {
    const raw = localStorage.getItem('core-adapter.installed-manifest')
    if (!raw) return

    let manifest: unknown
    try { manifest = JSON.parse(raw) } catch { return }

    const layerSigs: string[] = Array.isArray((manifest as any)?.layers)
      ? ((manifest as any).layers as unknown[]).map(s => String(s)).filter(s => isSignature(s))
      : []
    if (!layerSigs.length) return

    // Find which domain directory holds these layer files
    let layerDir: FileSystemDirectoryHandle | null = null
    let domainKey = ''
    for (const domain of ['sentinel', 'local']) {
      try {
        const candidate = await store.domainLayersDirectory(domain)
        await candidate.getFileHandle(layerSigs[0])
        layerDir = candidate
        domainKey = domain
        break
      } catch { /* try next domain */ }
    }
    if (!layerDir) return

    // Parse all layer nodes (with bee docs)
    const layerMap = new Map<string, StructureLayerNode>()
    for (const sig of layerSigs) {
      const node = await readStructureLayerNode(layerDir, sig)
      if (node) layerMap.set(sig, node)
    }
    if (!layerMap.size) return

    // Find root layer (not referenced as a child of any other)
    const allChildSigs = new Set<string>()
    for (const { childLayerSigs } of layerMap.values()) {
      for (const c of childLayerSigs) allChildSigs.add(c)
    }
    const rootSig = layerSigs.find(sig => layerMap.has(sig) && !allChildSigs.has(sig))
    if (!rootSig) return

    // Create __structure__/ root
    const opfsRoot = await navigator.storage.getDirectory()
    const structureRoot = await opfsRoot.getDirectoryHandle(STRUCTURE_DIRECTORY, { create: true })

    // Determine domain name from root layer
    const rootNode = layerMap.get(rootSig)!
    const domainName = rootNode.name || domainKey

    // Check if already materialized (skip if domain dir exists and is non-empty)
    try {
      const existing = await structureRoot.getDirectoryHandle(domainName, { create: false })
      let hasEntries = false
      for await (const _ of existing.entries()) { hasEntries = true; break }
      if (hasEntries) return
    } catch { /* doesn't exist yet — proceed */ }

    // Create domain directory and populate
    const domainDir = await structureRoot.getDirectoryHandle(domainName, { create: true })
    await writeProps(domainDir, {
      signature: rootSig,
      kind: 'domain',
      lineage: domainName,
    })

    await applyStructureLayer(domainDir, rootNode, layerMap, domainName, 0)

    console.log(`[structure-materializer] materialized install tree into ${STRUCTURE_DIRECTORY}/${domainName}/`)
  } catch (err) {
    console.warn('[structure-materializer] materialization failed (non-fatal):', err)
  }
}

// ─── internals ───────────────────────────────────────────────────────────────

const readStructureLayerNode = async (
  dir: FileSystemDirectoryHandle,
  sig: string,
): Promise<StructureLayerNode | null> => {
  try {
    const handle = await dir.getFileHandle(sig)
    const file = await handle.getFile()
    const parsed = JSON.parse(await file.text())
    const name = String(parsed?.name ?? '').trim()
    if (!name) return null

    // Layer JSON uses "layers" for child sigs in build output,
    // "children" in some cached forms — accept both
    const rawChildren = Array.isArray(parsed?.layers) ? parsed.layers
      : Array.isArray(parsed?.children) ? parsed.children
      : []
    const childLayerSigs = (rawChildren as unknown[])
      .map(c => String(c).trim())
      .filter(c => isSignature(c))

    // Extract bee entries from docs
    const bees: StructureBeeEntry[] = []
    const docsMap = parsed?.docs?.bees
    if (docsMap && typeof docsMap === 'object') {
      for (const [beeSig, doc] of Object.entries(docsMap)) {
        const d = doc as any
        const className = String(d?.className ?? '').trim()
        if (!className) continue
        const kind = String(d?.kind ?? 'bee').trim()
        // Strip .js suffix from signature if present
        const cleanSig = beeSig.replace(/\.js$/, '')
        bees.push({ signature: cleanSig, className, kind })
      }
    }

    return { name, signature: sig, childLayerSigs, bees }
  } catch {
    return null
  }
}

const applyStructureLayer = async (
  targetDir: FileSystemDirectoryHandle,
  layer: StructureLayerNode,
  layerMap: Map<string, StructureLayerNode>,
  lineagePrefix: string,
  depth: number,
): Promise<void> => {
  if (depth > MAX_DEPTH) return

  // Create directories for child layers
  for (const childSig of layer.childLayerSigs) {
    const childLayer = layerMap.get(childSig)
    if (!childLayer?.name) continue
    try {
      const childDir = await targetDir.getDirectoryHandle(childLayer.name, { create: true })
      const childLineage = `${lineagePrefix}/${childLayer.name}`
      await writeProps(childDir, {
        signature: childSig,
        kind: 'layer',
        lineage: childLineage,
      })
      await applyStructureLayer(childDir, childLayer, layerMap, childLineage, depth + 1)
    } catch { /* skip individual failures */ }
  }

  // Create directories for bees (leaf entries)
  for (const bee of layer.bees) {
    try {
      const beeDir = await targetDir.getDirectoryHandle(bee.className, { create: true })
      await writeProps(beeDir, {
        signature: bee.signature,
        kind: bee.kind,
        lineage: `${lineagePrefix}/${bee.className}`,
      })
    } catch { /* skip individual failures */ }
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const isSignature = (value: string): boolean =>
  /^[a-f0-9]{64}$/i.test(value)

const writeProps = async (
  dir: FileSystemDirectoryHandle,
  props: Record<string, unknown>,
): Promise<void> => {
  const handle = await dir.getFileHandle(PROPS_FILE, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(JSON.stringify(props))
  } finally {
    await writable.close()
  }
}
