import { isMetaEnvelope, metaPayloadOf } from '@hypercomb/core'

export interface LocalResourceReferenceStore {
  /** Raw bytes at the named sig, including a meta envelope when sig is meta. */
  getResourceLocal(sig: string): Promise<Blob | null>
  /** Preferred central resolver when the Store version provides it. */
  getResourceResolvedLocal?(sig: string): Promise<Blob | null>
  getOptimizedVisual?(sig: string): Promise<Blob | null>
}

/**
 * Resolve the terminal resource bytes for a Life Primitive incidence without
 * leaving the local hot path. The outer incidence remains the cache/provenance
 * key; only the bytes handed to a consumer are dereferenced.
 *
 * The fallback walk keeps mixed-version bundles compatible while Store owns
 * the canonical getResourceResolvedLocal implementation.
 */
export async function resolveLocalResourceReference(
  store: LocalResourceReferenceStore,
  sig: string,
  options: { optimized?: boolean; maxDepth?: number } = {},
): Promise<Blob | null> {
  const optimized = options.optimized === true
  const maxDepth = options.maxDepth ?? 4

  if (!optimized && store.getResourceResolvedLocal) {
    return store.getResourceResolvedLocal(sig)
  }

  const seen = new Set<string>()
  let current = sig
  for (let depth = 0; depth <= maxDepth; depth++) {
    if (seen.has(current)) return null
    seen.add(current)

    if (optimized) {
      const derived = (await store.getOptimizedVisual?.(current)) ?? null
      if (derived) return derived
    }

    const blob = await store.getResourceLocal(current)
    if (!blob) return null
    if (blob.size > 64 * 1024) return blob

    try {
      const parsed = JSON.parse(await blob.text())
      if (!isMetaEnvelope(parsed)) return blob
      const payload = metaPayloadOf(parsed)
      if (!payload || payload.kind !== 'resource') return null
      current = payload.sig
    } catch {
      return blob
    }
  }
  return null
}
