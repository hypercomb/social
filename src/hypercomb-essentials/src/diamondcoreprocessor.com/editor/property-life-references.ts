import { isReferentField, isSignature } from '@hypercomb/core'

export type EnsureResourceIncidence = (sig: string, relation: string) => Promise<string>

const relationFor = (path: readonly string[]): string => {
  const leaf = path[path.length - 1] ?? 'property'
  return leaf === 'imageSig' || leaf === 'image' ? 'image' : leaf
}

/**
 * Canonicalize every artifact reference inside a properties bag to a typed
 * Life Primitive resource incidence. Inline values remain inline; declared
 * referents (targetSig/groupSig) remain addresses and are never wrapped as
 * fetchable content.
 */
export async function canonicalPropertyLifeReferences(
  value: unknown,
  ensureResource: EnsureResourceIncidence,
  path: readonly string[] = [],
): Promise<unknown> {
  const field = path[path.length - 1] ?? ''
  if (isSignature(value)) {
    const sig = String(value).toLowerCase()
    return isReferentField(field)
      ? sig
      : ensureResource(sig, relationFor(path))
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map(entry => canonicalPropertyLifeReferences(entry, ensureResource, path)))
  }
  if (!value || typeof value !== 'object') return value

  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = await canonicalPropertyLifeReferences(entry, ensureResource, [...path, key])
  }
  return out
}
