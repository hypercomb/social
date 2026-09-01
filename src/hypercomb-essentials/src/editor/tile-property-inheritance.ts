/** Layer metadata: pinned keys cannot be overwritten by a later outer layer. */
export const TILE_PROPERTY_PINS = 'propertyPins'

const pinsOf = (properties: Readonly<Record<string, unknown>>): string[] => {
  const raw = properties[TILE_PROPERTY_PINS]
  if (!Array.isArray(raw)) return []
  return [...new Set(raw
    .filter((key): key is string => typeof key === 'string')
    .map(key => key.trim())
    .filter(key => key.length > 0 && key !== TILE_PROPERTY_PINS))]
    .sort()
}

/**
 * Compose the fixed-name root defaults with one lineage appearance.
 *
 * Properties are deliberately shallow: each top-level property is one value
 * in the Life layer. The root (inner) object supplies defaults and the
 * appearance's outer object replaces only the keys it explicitly carries.
 * Artifact incidences are therefore inherited by signature; they are never
 * copied, re-minted, or unwrapped while composing a view.
 */
export const inheritTileProperties = (
  innerDefaults: Readonly<Record<string, unknown>>,
  outerOverrides: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const innerPins = pinsOf(innerDefaults)
  const outerPins = pinsOf(outerOverrides)
  const locked = new Set(innerPins)
  const effective: Record<string, unknown> = { ...innerDefaults }
  delete effective[TILE_PROPERTY_PINS]
  for (const [key, value] of Object.entries(outerOverrides)) {
    if (key !== TILE_PROPERTY_PINS && !locked.has(key)) effective[key] = value
  }
  for (const key of outerPins) {
    if (locked.has(key)) continue
    // Pinning an absent outer value means "always absent" and suppresses the
    // inherited default without inventing a null resource/value dialect.
    if (!Object.prototype.hasOwnProperty.call(outerOverrides, key)) delete effective[key]
  }
  const effectivePins = [...new Set([...innerPins, ...outerPins])].sort()
  if (effectivePins.length > 0) effective[TILE_PROPERTY_PINS] = effectivePins
  return effective
}

const sameJsonValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJsonValue(value, right[index]))
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord).sort()
  const rightKeys = Object.keys(rightRecord).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index]
      && sameJsonValue(leftRecord[key], rightRecord[key]))
}

/**
 * Keep an outer layer sparse. Values identical to the root default are not an
 * override and must not be materialized, otherwise an editor round-trip would
 * silently pin today's default and stop that appearance following root edits.
 */
export const sparseTileOverrides = (
  innerDefaults: Readonly<Record<string, unknown>>,
  outerValues: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const sparse: Record<string, unknown> = {}
  const inheritedPins = new Set(pinsOf(innerDefaults))
  // A complete editor form carries the effective union of inherited + local
  // pins. Store only the pins introduced here; inherited locks remain rooted
  // in the inner layer and must not be copied outward.
  const localPins = pinsOf(outerValues).filter(key => !inheritedPins.has(key))
  const pinned = new Set(localPins)
  for (const [key, value] of Object.entries(outerValues)) {
    if (key === TILE_PROPERTY_PINS) continue
    if (inheritedPins.has(key)) continue
    if (pinned.has(key) || !(key in innerDefaults) || !sameJsonValue(innerDefaults[key], value)) {
      sparse[key] = value
    }
  }
  if (localPins.length > 0) sparse[TILE_PROPERTY_PINS] = localPins
  return sparse
}
