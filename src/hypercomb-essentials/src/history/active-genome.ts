// Active genome — the exact, derived inventory of the hive's live closure.
//
// This is deliberately a computation, not a layer slot. Writing the answer
// into the tree being measured would change the tree and make the result
// self-referential. The runtime service stores the canonical result in the
// sign('computed') meaning pool.

import { CHILD_SLOTS, isReferentField } from '@hypercomb/core'

export const ACTIVE_GENOME_VERSION = 1 as const

export type ActiveGenomeObjectKind = 'layer' | 'resource' | 'bee' | 'dependency'

export type ActiveGenomeObject = {
  kind: ActiveGenomeObjectKind
  sig: string
  bytes: number
}

export type ActiveGenomeHead = {
  lineage: string
  path: string[]
  marker: string | null
  layer: string
  bytes: number
}

export type ActiveGenomeMissing = {
  kind: ActiveGenomeObjectKind
  sig: string
}

export type ActiveGenomeRecord = {
  version: typeof ACTIVE_GENOME_VERSION
  seal: string
  complete: boolean
  heads: ActiveGenomeHead[]
  objects: ActiveGenomeObject[]
  missing: ActiveGenomeMissing[]
  totals: {
    lineages: number
    virtualHeads: number
    objects: number
    markerBytes: number
    contentBytes: number
    knownBytes: number
    activeBytes: number | null
  }
}

export type ActiveGenomeLayer = {
  bytes: number
  value: { name?: string; [slot: string]: unknown }
}

export type ActiveGenomeHeadSource = {
  marker: string
  layer: string
  bytes: number
}

export type ActiveGenomeContent = {
  bytes: number
  /** Parsed JSON when the resource is expandable; absent for opaque bytes. */
  value?: unknown
}

export type ActiveGenomeSource = {
  epoch(): number
  /** Read-only current root head. This must never materialize or seal data. */
  root(): Promise<string | null>
  lineage(path: readonly string[]): Promise<string>
  layer(sig: string): Promise<ActiveGenomeLayer | null>
  head(lineage: string): Promise<ActiveGenomeHeadSource | null>
  resource(sig: string): Promise<ActiveGenomeContent | null>
  beeBytes(sig: string): Promise<number | null>
  dependencyBytes(sig: string): Promise<number | null>
}

export type ActiveGenomeCollection = {
  record: ActiveGenomeRecord | null
  stable: boolean
}

export const formatGenomeBytes = (bytes: number): string => {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return unit === 0 ? `${value} ${units[unit]}` : `${value.toFixed(1)} ${units[unit]}`
}

const SIG_RE = /^[0-9a-f]{64}$/
/** The child roster, from core — never restated (documentation/life-primitive.md). */
const CHILD_SLOT_SET: ReadonlySet<string> = new Set(CHILD_SLOTS)

const sig = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return SIG_RE.test(text) ? text : null
}

/** One kind of thing a census reaches, and where it is stored. */
type Found = { kind: ActiveGenomeObjectKind; sig: string; bytes: number }
type Lost = { kind: ActiveGenomeObjectKind; sig: string }

/** What one layer or resource adds to the census by itself: the objects it
 *  reaches and the ones it names that are not here. */
type Contribution = { objects: Found[]; missing: Lost[] }

/** A location's own share of the census, with its children named so a
 *  replay can walk on without reading the layer again. */
type GenomeNode = Contribution & { children: Array<{ sig: string; name: string }> }

/**
 * WHAT A CENSUS REMEMBERS BETWEEN RUNS (2026-11-12).
 *
 * The census used to read the whole hive on every run — every layer, every
 * child layer again just for its name, every resource, every head — about
 * 35,000 store calls on an 11,600-bag hive, and it ran again on every armed
 * optimize pass. Everything it reads by SIGNATURE is immutable, so it is
 * kept here by signature and never read twice:
 *
 *   layers / resources  the bytes and parsed value of a content sig
 *   contributions       what a resource's JSON reaches, expanded
 *   pools               a bee's or dependency's size
 *   nodes               a location's own share, keyed `lineage|layerSig`
 *   lineages            the address of a path
 *
 * Only what was FOUND is kept, and a node or expansion only when it names
 * nothing missing (complete-or-absent): a bee or resource that is absent now
 * may arrive later. Heads are NOT kept here — a head moves without the
 * layer above it changing, so the caller's `head` must answer for that.
 * Pure derivation of sig-addressed inputs, never load-bearing: drop the
 * memo and the next census reads everything again and gets the same answer.
 */
export class ActiveGenomeMemo {
  readonly layers = new Map<string, ActiveGenomeLayer>()
  readonly resources = new Map<string, ActiveGenomeContent>()
  readonly contributions = new Map<string, Contribution>()
  readonly pools = new Map<string, number>()
  readonly nodes = new Map<string, GenomeNode>()
  readonly lineages = new Map<string, string>()
  readonly #cap: number

  constructor(cap = 100_000) { this.#cap = Math.max(1, cap) }

  /** Remember, dropping the whole map rather than growing past the cap. */
  keep<V>(map: Map<string, V>, key: string, value: V): void {
    if (map.size >= this.#cap && !map.has(key)) map.clear()
    map.set(key, value)
  }
}

/**
 * Collect one optimistic snapshot. Callers discard and retry when `stable`
 * is false: a head moved while the closure was being read.
 *
 * With a `memo`, a census reads only what it has not seen: unchanged
 * locations replay their remembered share, so a run after a small edit
 * reads the moved heads and the new layers, not the hive.
 */
export async function collectActiveGenome(
  source: ActiveGenomeSource,
  memo: ActiveGenomeMemo = new ActiveGenomeMemo(),
): Promise<ActiveGenomeCollection> {
  const epoch = source.epoch()
  const root = sig(await source.root())
  if (!root) return { record: null, stable: source.epoch() === epoch }

  const objects = new Map<string, ActiveGenomeObject>()
  const missing = new Map<string, ActiveGenomeMissing>()
  const heads: ActiveGenomeHead[] = []
  const walkedLocations = new Set<string>()

  // Layers and resources share the flat content root and therefore dedupe
  // physically. Bees and dependencies live in distinct meaning pools.
  const storageOf = (kind: ActiveGenomeObjectKind, signature: string): string =>
    (kind === 'layer' || kind === 'resource') ? `root:${signature}` : `${kind}:${signature}`

  const addMissing = (kind: ActiveGenomeObjectKind, signature: string): void => {
    const storage = storageOf(kind, signature)
    if (!missing.has(storage)) missing.set(storage, { kind, sig: signature })
  }

  const addObject = (kind: ActiveGenomeObjectKind, signature: string, bytes: number): void => {
    const storage = storageOf(kind, signature)
    const prior = objects.get(storage)
    if (!prior || (prior.kind === 'resource' && kind === 'layer')) {
      objects.set(storage, { kind, sig: signature, bytes })
    }
    missing.delete(storage)
  }

  /** Fold a remembered or freshly read share into this census. */
  const apply = (share: Contribution): void => {
    for (const found of share.objects) addObject(found.kind, found.sig, found.bytes)
    for (const lost of share.missing) addMissing(lost.kind, lost.sig)
  }

  const layerOf = async (signature: string): Promise<ActiveGenomeLayer | null> => {
    const known = memo.layers.get(signature)
    if (known) return known
    const layer = await source.layer(signature)
    if (layer) memo.keep(memo.layers, signature, layer)
    return layer
  }

  const poolBytes = async (kind: 'bee' | 'dependency', signature: string): Promise<number | null> => {
    const key = `${kind}:${signature}`
    const known = memo.pools.get(key)
    if (known !== undefined) return known
    const bytes = kind === 'bee' ? await source.beeBytes(signature) : await source.dependencyBytes(signature)
    if (bytes !== null) memo.keep(memo.pools, key, bytes)
    return bytes
  }

  const lineageOf = async (path: readonly string[]): Promise<string> => {
    const key = JSON.stringify(path)
    const known = memo.lineages.get(key)
    if (known) return known
    const lineage = await source.lineage(path)
    memo.keep(memo.lineages, key, lineage)
    return lineage
  }

  /** A resource and everything its JSON reaches — immutable, so a complete
   *  expansion is remembered by its signature. `seen` breaks cycles. */
  let expandResource: (signature: string, seen: Set<string>) => Promise<Contribution>

  /** Everything a value reaches: bees, dependencies, and resources expanded
   *  through their own JSON. */
  const expandValue = async (value: unknown, key: string, into: Contribution, seen: Set<string>): Promise<void> => {
    if (Array.isArray(value)) {
      for (const item of value) await expandValue(item, key, into, seen)
      return
    }
    if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
        // A referent (`prev`, a restore point's `seal`, an identity) points
        // AT something — usually the past. The genome is the current state
        // only, and it is what replication and hosts are allowed to send.
        if (isReferentField(childKey)) continue
        await expandValue(child, childKey, into, seen)
      }
      return
    }
    const signature = sig(value)
    if (!signature) return
    if (key === 'bees' || key === 'dependencies') {
      const kind = key === 'bees' ? 'bee' : 'dependency'
      const bytes = await poolBytes(kind, signature)
      if (bytes === null) into.missing.push({ kind, sig: signature })
      else into.objects.push({ kind, sig: signature, bytes })
      return
    }
    const share = await expandResource(signature, seen)
    into.objects.push(...share.objects)
    into.missing.push(...share.missing)
  }

  expandResource = async (signature: string, seen: Set<string>): Promise<Contribution> => {
    const known = memo.contributions.get(signature)
    if (known) return known
    if (seen.has(signature)) return { objects: [], missing: [] }
    seen.add(signature)
    const share: Contribution = { objects: [], missing: [] }
    let content = memo.resources.get(signature) ?? null
    if (!content) {
      content = await source.resource(signature)
      if (content) memo.keep(memo.resources, signature, content)
    }
    if (!content) {
      share.missing.push({ kind: 'resource', sig: signature })
      return share
    }
    share.objects.push({ kind: 'resource', sig: signature, bytes: content.bytes })
    if (content.value !== undefined) await expandValue(content.value, '', share, seen)
    if (share.missing.length === 0) memo.keep(memo.contributions, signature, share)
    return share
  }

  /** A location's own share, read from its layer. */
  const readNode = async (signature: string): Promise<GenomeNode> => {
    const node: GenomeNode = { objects: [], missing: [], children: [] }
    const layer = await layerOf(signature)
    if (!layer) {
      node.missing.push({ kind: 'layer', sig: signature })
      return node
    }
    node.objects.push({ kind: 'layer', sig: signature, bytes: layer.bytes })
    for (const [key, value] of Object.entries(layer.value)) {
      if (key === 'name' || isReferentField(key)) continue
      if (CHILD_SLOT_SET.has(key) && Array.isArray(value)) {
        for (const childRaw of value) {
          const childSig = sig(childRaw)
          if (!childSig) continue
          const child = await layerOf(childSig)
          const name = String(child?.value?.name ?? '').trim()
          if (!name) {
            node.missing.push({ kind: 'layer', sig: childSig })
            continue
          }
          node.children.push({ sig: childSig, name })
        }
        continue
      }
      await expandValue(value, key, node, new Set())
    }
    return node
  }

  const visitLayer = async (raw: unknown, path: readonly string[]): Promise<void> => {
    const carriedSignature = sig(raw)
    if (!carriedSignature) return
    const lineage = await lineageOf(path)
    const head = await source.head(lineage)
    // A parent may carry an older child generation under leaf-only history.
    // The active genome follows the location's latest real marker when one
    // exists; the parent-carried sig remains the fallback for virtual heads.
    const signature = head?.layer ?? carriedSignature
    const locationKey = `${lineage}|${signature}`
    if (walkedLocations.has(locationKey)) return
    walkedLocations.add(locationKey)
    heads.push({
      lineage,
      path: [...path],
      marker: head?.marker ?? null,
      layer: head?.layer ?? signature,
      bytes: head?.bytes ?? 0,
    })

    let node = memo.nodes.get(locationKey)
    if (!node) {
      node = await readNode(signature)
      if (node.missing.length === 0) memo.keep(memo.nodes, locationKey, node)
    }
    apply(node)
    for (const child of node.children) await visitLayer(child.sig, [...path, child.name])
  }

  await visitLayer(root, [])

  heads.sort((a, b) => a.path.join('/').localeCompare(b.path.join('/')))
  const objectList = [...objects.values()].sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.sig.localeCompare(b.sig))
  const missingList = [...missing.values()].sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.sig.localeCompare(b.sig))
  const markerBytes = heads.reduce((total, head) => total + head.bytes, 0)
  const contentBytes = objectList.reduce((total, object) => total + object.bytes, 0)
  const knownBytes = markerBytes + contentBytes
  const complete = missingList.length === 0

  const endRoot = sig(await source.root())
  return {
    stable: source.epoch() === epoch && endRoot === root,
    record: {
      version: ACTIVE_GENOME_VERSION,
      // Compatibility name: this is the read-only root head used for this
      // census, not a sharing seal. The computed document's own signature is
      // the integrity identity of the complete inventory.
      seal: root,
      complete,
      heads,
      objects: objectList,
      missing: missingList,
      totals: {
        lineages: heads.length,
        virtualHeads: heads.filter(head => head.marker === null).length,
        objects: objectList.length,
        markerBytes,
        contentBytes,
        knownBytes,
        activeBytes: complete ? knownBytes : null,
      },
    },
  }
}
