// Active genome — the exact, derived inventory of the hive's live closure.
//
// This is deliberately a computation, not a layer slot. Writing the answer
// into the tree being measured would change the tree and make the result
// self-referential. The runtime service stores the canonical result in the
// sign('computed') meaning pool.

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
const CHILD_SLOTS = new Set(['cells', 'layers', 'children'])

const sig = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return SIG_RE.test(text) ? text : null
}

/**
 * Collect one optimistic snapshot. Callers discard and retry when `stable`
 * is false: a head moved while the closure was being read.
 */
export async function collectActiveGenome(
  source: ActiveGenomeSource,
): Promise<ActiveGenomeCollection> {
  const epoch = source.epoch()
  const root = sig(await source.root())
  if (!root) return { record: null, stable: source.epoch() === epoch }

  const objects = new Map<string, ActiveGenomeObject>()
  const missing = new Map<string, ActiveGenomeMissing>()
  const heads: ActiveGenomeHead[] = []
  const walkedLocations = new Set<string>()
  const expandedResources = new Set<string>()

  const addMissing = (kind: ActiveGenomeObjectKind, signature: string): void => {
    const storage = (kind === 'layer' || kind === 'resource') ? `root:${signature}` : `${kind}:${signature}`
    if (!missing.has(storage)) missing.set(storage, { kind, sig: signature })
  }

  const addObject = (kind: ActiveGenomeObjectKind, signature: string, bytes: number): void => {
    // Layers and resources share the flat content root and therefore dedupe
    // physically. Bees and dependencies live in distinct meaning pools.
    const storage = (kind === 'layer' || kind === 'resource') ? `root:${signature}` : `${kind}:${signature}`
    const prior = objects.get(storage)
    if (!prior || (prior.kind === 'resource' && kind === 'layer')) {
      objects.set(storage, { kind, sig: signature, bytes })
    }
    missing.delete(storage)
  }

  const visitBee = async (raw: unknown): Promise<void> => {
    const signature = sig(raw)
    if (!signature) return
    const bytes = await source.beeBytes(signature)
    if (bytes === null) addMissing('bee', signature)
    else addObject('bee', signature, bytes)
  }

  const visitDependency = async (raw: unknown): Promise<void> => {
    const signature = sig(raw)
    if (!signature) return
    const bytes = await source.dependencyBytes(signature)
    if (bytes === null) addMissing('dependency', signature)
    else addObject('dependency', signature, bytes)
  }

  let visitResource: (raw: unknown) => Promise<void>

  const expandValue = async (value: unknown, key = ''): Promise<void> => {
    if (Array.isArray(value)) {
      if (key === 'bees') {
        for (const item of value) await visitBee(item)
        return
      }
      if (key === 'dependencies') {
        for (const item of value) await visitDependency(item)
        return
      }
      for (const item of value) await expandValue(item, key)
      return
    }
    if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
        await expandValue(child, childKey)
      }
      return
    }
    if (key === 'bees') await visitBee(value)
    else if (key === 'dependencies') await visitDependency(value)
    else await visitResource(value)
  }

  visitResource = async (raw: unknown): Promise<void> => {
    const signature = sig(raw)
    if (!signature || expandedResources.has(signature)) return
    expandedResources.add(signature)
    const content = await source.resource(signature)
    if (!content) {
      addMissing('resource', signature)
      return
    }
    addObject('resource', signature, content.bytes)
    if (content.value !== undefined) await expandValue(content.value)
  }

  const visitLayer = async (raw: unknown, path: readonly string[]): Promise<void> => {
    const carriedSignature = sig(raw)
    if (!carriedSignature) return
    const lineage = await source.lineage(path)
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

    const layer = await source.layer(signature)
    if (!layer) {
      addMissing('layer', signature)
      return
    }
    addObject('layer', signature, layer.bytes)

    for (const [key, value] of Object.entries(layer.value)) {
      if (key === 'name') continue
      if (CHILD_SLOTS.has(key) && Array.isArray(value)) {
        for (const childRaw of value) {
          const childSig = sig(childRaw)
          if (!childSig) continue
          const child = await source.layer(childSig)
          const name = String(child?.value?.name ?? '').trim()
          if (!name) {
            addMissing('layer', childSig)
            continue
          }
          await visitLayer(childSig, [...path, name])
        }
        continue
      }
      await expandValue(value, key)
    }
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
