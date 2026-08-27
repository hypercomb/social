// diamondcoreprocessor.com/commands/canonical-reference.service.ts
//
// The one write door for Portals. A source may be discovered anywhere, but its
// fixed name promotes it into one canonical root bag. Every lineage appearance
// points to that root and pins the selected detail signatures; the marked
// Portal inventory row stays a slim future-default authoring pointer.

import {
  CANONICAL_REFERENCE_SERVICE_KEY,
  CHILD_SLOTS,
  EffectBus,
  buildCanonicalReferenceRecord,
  buildCanonicalVariantRecord,
  canonicalReferenceName,
  canonicalRootSegments,
  type CanonicalReferenceService,
  type CanonicalRoot,
  type PlaceCanonicalReferenceOptions,
} from '@hypercomb/core'
import {
  childLayerOf,
  flattenLayerTree,
  resolveLayerAt,
  type PlacementHistory,
  type PlacementLayer,
} from '../history/layer-placement.js'

type StoreLike = {
  putResource(blob: Blob, options?: { emit?: boolean }): Promise<string>
  getPool?(meaning: string): Promise<FileSystemDirectoryHandle | null>
}
type LineageLike = { readonly domain?: unknown }
type CommitterLike = {
  importTree(
    updates: { segments: readonly string[]; layer: { name?: string; [slot: string]: unknown } }[],
    nameSlots?: ReadonlySet<string>,
  ): Promise<void>
  commitChildrenDeltas(
    segments: readonly string[],
    changes: { appends?: readonly string[] },
  ): Promise<string>
}

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

const sameSegments = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((segment, index) => segment === b[index])

export class CanonicalReferenceServiceImpl implements CanonicalReferenceService {
  /** Retain immutable same-name candidates without advancing the root head. */
  async #retainVariant(
    name: string,
    history: PlacementHistory,
    layer: PlacementLayer,
    knownLayerSig?: string,
  ): Promise<void> {
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store?.getPool) return
    const layerSig = knownLayerSig
      ?? await history.materializeLayer?.(layer).catch(() => undefined)
    if (!layerSig) return
    const record = buildCanonicalVariantRecord({ name, layerSig })
    if (!record) return
    const bytes = new TextEncoder().encode(JSON.stringify(record))
    const recordSig = await store.putResource(
      new Blob([bytes], { type: 'application/json' }),
      { emit: false },
    )
    const pool = await store.getPool(name)
    if (!pool) return
    const handle = await pool.getFileHandle(recordSig, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(bytes) } finally { await writable.close() }
  }

  async #discoveredVariant(
    history: PlacementHistory,
    domain: unknown,
    rootSegments: readonly string[],
    sourceSegments: readonly string[] | null,
  ): Promise<{ layer: PlacementLayer; sig?: string } | null> {
    if (!sourceSegments || sourceSegments.length === 0 || sameSegments(sourceSegments, rootSegments)) return null
    const layer = await resolveLayerAt(history, domain, sourceSegments)
    if (!layer) return null
    const parent = await resolveLayerAt(history, domain, sourceSegments.slice(0, -1))
    const child = await childLayerOf(history, parent, sourceSegments[sourceSegments.length - 1])
    return { layer, ...(child?.sig ? { sig: child.sig } : {}) }
  }

  async ensureRoot(
    rawName: string,
    sourceSegments: readonly string[] | null,
  ): Promise<CanonicalRoot | null> {
    const name = canonicalReferenceName(rawName)
    const segments = canonicalRootSegments(name)
    if (!name || segments.length !== 1) return null

    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const committer = get<CommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    if (!history || !committer?.importTree || !committer.commitChildrenDeltas) return null

    const targetSig = await history.sign({
      domain: lineage?.domain,
      explorerSegments: () => segments,
    })
    const discovered = await this.#discoveredVariant(
      history, lineage?.domain, segments, sourceSegments,
    )

    // Root membership is authoritative. Seed its history bag when the child
    // exists only as its parent's carried content signature.
    const hiveRoot = await resolveLayerAt(history, lineage?.domain, [])
    const listed = await childLayerOf(history, hiveRoot, name)
    if (listed) {
      await history.commitLayer(targetSig, listed.layer)
      await this.#retainVariant(name, history, listed.layer, listed.sig)
      if (discovered) await this.#retainVariant(name, history, discovered.layer, discovered.sig)
      return { name, segments, targetSig }
    }

    // Re-link a detached but valid fixed-name root; never replace it from a
    // later same-name discovery.
    const direct = await history.currentLayerAt(targetSig)
    if (direct) {
      const layer: PlacementLayer = { ...direct, name }
      const headSig = await history.commitLayer(targetSig, layer)
      await committer.commitChildrenDeltas([], { appends: [headSig] })
      await this.#retainVariant(name, history, layer, headSig)
      if (discovered) await this.#retainVariant(name, history, discovered.layer, discovered.sig)
      return { name, segments, targetSig }
    }

    let source: PlacementLayer | null = null
    if (sourceSegments && sourceSegments.length > 0) {
      source = await resolveLayerAt(history, lineage?.domain, sourceSegments)
      if (!source) return null
    } else if (sourceSegments !== null) {
      // `[]` is the hive itself, never an item to promote.
      return null
    }

    if (source) {
      const updates = await flattenLayerTree(history, source, segments)
      if (updates.length === 0) return null
      updates[0] = { ...updates[0], layer: { ...updates[0].layer, name } }
      await committer.importTree(updates, new Set(['children']))
    } else {
      await committer.importTree([{ segments, layer: { name } }], new Set(['children']))
    }

    const landed = await resolveLayerAt(history, lineage?.domain, segments)
    if (!landed) return null
    await this.#retainVariant(name, history, landed)
    if (discovered) await this.#retainVariant(name, history, discovered.layer, discovered.sig)
    return { name, segments, targetSig }
  }

  async place(options: PlaceCanonicalReferenceOptions): Promise<string | null> {
    const name = canonicalReferenceName(options.name)
    if (!name) return null
    const root = await this.ensureRoot(name, options.sourceSegments)
    if (!root) return null

    const parentSegments = options.parentSegments.map(s => String(s ?? '').trim()).filter(Boolean)
    if (sameSegments(parentSegments, [])) return root.name

    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const committer = get<CommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    const store = get<StoreLike>('@hypercomb.social/Store')
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    if (!history || !committer?.commitChildrenDeltas || !store?.putResource) return null

    const parent = await resolveLayerAt(history, lineage?.domain, parentSegments)
    if (await childLayerOf(history, parent, name)) return null

    const record = buildCanonicalReferenceRecord({
      name,
      targetSig: root.targetSig,
      requiredMarks: options.requiredMarks,
      requiredBouquet: options.requiredBouquet,
      editsRootDefault: options.editsRootDefault,
    })
    const decorationSig = await store.putResource(
      new Blob([JSON.stringify(record)], { type: 'application/json' }),
    )

    const childSegments = [...parentSegments, name]
    const childLocationSig = await history.sign({
      domain: lineage?.domain,
      explorerSegments: () => childSegments,
    })
    // An ordinary activation takes a SNAPSHOT OF THE CURRENT ROOT DETAILS.
    // It shares the exact same resource/decorations/notes signatures, so no
    // bytes are copied, but its appearance head is independent: creating or
    // editing `/team/jaime` can never repaint `/friends/jaime`. The reference
    // still points at the fixed root pool for identity/navigation.
    //
    // The Portal inventory row is the exception. It is the explicit default-
    // authoring surface, so it remains a slim live pointer and its editor is
    // routed to the root. Changing that root seeds FUTURE activations only.
    let childLayer: PlacementLayer = { name, decorations: [decorationSig] }
    if (options.editsRootDefault !== true) {
      const rootLayer = await resolveLayerAt(history, lineage?.domain, root.segments)
      if (!rootLayer) return null
      const details: PlacementLayer = { name }
      for (const [slot, value] of Object.entries(rootLayer)) {
        if (slot === 'name' || (CHILD_SLOTS as readonly string[]).includes(slot)) continue
        details[slot] = value
      }
      const inheritedDecorations = Array.isArray(details['decorations'])
        ? details['decorations'].filter((sig): sig is string => typeof sig === 'string')
        : []
      childLayer = {
        ...details,
        decorations: [...new Set([...inheritedDecorations, decorationSig])],
      }
    }
    const childMarkerSig = await history.commitLayer(childLocationSig, childLayer)
    await committer.commitChildrenDeltas(parentSegments, { appends: [childMarkerSig] })

    EffectBus.emit('decorations:changed', {
      segments: childSegments, op: 'append', sig: decorationSig,
    })
    EffectBus.emit('cell:added', {
      cell: name, segments: [...parentSegments], viaUpdate: true, reference: true,
    })
    return name
  }
}

const canonicalReferenceService = new CanonicalReferenceServiceImpl()
window.ioc.register(CANONICAL_REFERENCE_SERVICE_KEY, canonicalReferenceService)
